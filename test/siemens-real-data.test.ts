import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { openMigratedRawDatabase } from "../src/main/database/raw-migrations.js";
import { closeConfiguredDatabase } from "../src/main/database/sqlite-connection.js";
import { ingestMetelFileFromPath } from "../src/main/metel/raw-ingestion.js";
import { normalizeMetelDelivery } from "../src/main/metel/catalogue-normalization.js";
import { browseCatalogue, BROWSE_SCOPE_SQL } from "../src/main/catalogue/browse-queries.js";
import { synchronizeAttributeSeed } from "../src/main/catalogue/attribute-seed.js";
import { enrichProductAttributes } from "../src/main/catalogue/attribute-enrichment.js";
import { ATTRIBUTE_PARSERS } from "../src/main/catalogue/parsers/index.js";
import { siemensCoverage } from "../src/main/catalogue/siemens-coverage.js";
import type { CatalogueAttributeFilter } from "../src/shared/catalogue.js";
import { browseManufacturerNodes, manufacturerPositions } from "../src/main/catalogue/manufacturer-navigation.js";
import { loadSiemensNavigationSeed, synchronizeSiemensNavigation } from "../src/main/catalogue/siemens-navigation.js";
import { siemensNavigationReport } from "../src/main/catalogue/siemens-navigation-report.js";

const sourceRoot=process.env["LIBREQUADRI_METEL_DIR"] ?? "";
const paths={LSP:path.join(sourceRoot,"SIELSP_20260701.txt/SIELSP_20260701.txt"),FSC:path.join(sourceRoot,"SIEFSC.TXT/SIEFSC.TXT"),FST:path.join(sourceRoot,"SIEFST.TXT/SIEFST.TXT")};

describe.runIf(Object.values(paths).every(existsSync))("full imported Siemens filter acceptance",()=>{
  let root:string,db:Database.Database,raw:Database.Database;
  beforeAll(()=>{
    root=mkdtempSync(path.join(tmpdir(),"librequadri-siemens-real-"));
    db=openMigratedLqDatabase({databaseFilename:path.join(root,"lq.db"),backupDirectory:path.join(root,"backups"),migrationsFolder:path.resolve("db/migrations/lq")});
    raw=openMigratedRawDatabase({databaseFilename:path.join(root,"raw.db"),migrationsFolder:path.resolve("db/migrations/raw")});
    const hash=(file:string)=>ingestMetelFileFromPath({database:raw,sourcePath:file}).fileSha256;
    normalizeMetelDelivery({lqDatabase:db,rawDatabase:raw,sources:{LSP:hash(paths.LSP),FSC:hash(paths.FSC),FST:hash(paths.FST)}});
  },180_000);
  afterAll(()=>{if(db)closeConfiguredDatabase(db);if(raw)closeConfiguredDatabase(raw);if(root)rmSync(root,{recursive:true,force:true});});

  it("covers all 212 families / 64,981 SIE products, with only valid applicable values and explicit gaps",()=>{
    const report=siemensCoverage(db);
    expect(report.products).toBe(64981);expect(report.families).toHaveLength(212);
    expect(report.families.every(f=>f.profile!==null && f.supported.length>0)).toBe(true);
    expect(db.prepare(`SELECT COUNT(*) FROM cat_product p JOIN cat_brand b ON b.id=p.brand_id WHERE b.metel_marchio='SIE' AND p.category_id IS NULL`).pluck().get()).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) FROM cat_product_attribute pa JOIN cat_product p ON p.id=pa.product_id
      LEFT JOIN cat_category_attribute ca ON ca.category_id=p.category_id AND ca.attribute_id=pa.attribute_id
      JOIN cat_attribute a ON a.id=pa.attribute_id LEFT JOIN cat_attribute_option o ON o.id=pa.option_id
      WHERE ca.attribute_id IS NULL OR (a.data_type='number' AND (pa.value_num IS NULL OR pa.value_num<=0))
        OR (a.data_type='enum' AND (o.id IS NULL OR o.attribute_id<>a.id OR o.active<>1))`).pluck().get()).toBe(0);
    expect(report.families.reduce((s,f)=>s+f.unresolvedKind,0)).toBeGreaterThan(0);
  });
  it("assigns the full population exactly once and proves every functional ancestor count independently", () => {
    const report = siemensNavigationReport(db);
    expect(report.products).toBe(64981); expect(report.families).toHaveLength(212);
    expect(report.assigned + report.unclassified).toBe(64981); expect(report.missing).toBe(0);
    expect(report.assigned).toBeGreaterThan(0); expect(report.unclassified).toBeGreaterThan(0);
    expect(loadSiemensNavigationSeed().familyReview.map(f => f.code).sort())
      .toEqual(report.families.map(f => f.code).sort());
    const nodes = browseManufacturerNodes(db).filter(n => n.code.startsWith("classified.sie."));
    const byId = new Map(nodes.map(n => [n.id, n]));
    const expected = new Map(nodes.map(n => [n.id, new Set<number>()]));
    const memberships = db.prepare("SELECT product_id AS productId,node_id AS nodeId FROM cat_range_node_product WHERE classification_code='classified.sie'")
      .all() as Array<{ productId: number; nodeId: number }>;
    expect(new Set(memberships.map(m => m.productId)).size).toBe(64981);
    for (const member of memberships) {
      let current: number | null = member.nodeId;
      while (current !== null) { expected.get(current)!.add(member.productId); current = byId.get(current)!.parentId; }
    }
    for (const n of nodes) {
      const actual = browseCatalogue(db, { nodeId: n.id, limit: 7 });
      expect(actual.totalCount, n.code).toBe(expected.get(n.id)!.size);
      expect(n.articleCount, n.code).toBe(actual.totalCount);
      expect(actual.products.every(p => expected.get(n.id)!.has(p.id)), n.code).toBe(true);
      expect(actual.packages).toEqual([]);
    }
    const breaker = nodes.find(n => n.code === "classified.sie.dispositivi_modulari.magnetotermici")!;
    const selected = browseCatalogue(db, { nodeId: breaker.id, query: "5SY62167" }).products[0]!;
    expect(selected).toBeDefined();
    const positions = manufacturerPositions(db, selected.id);
    expect(positions).toHaveLength(2);
    const fst = positions.find(p => p.nodeId !== breaker.id)!;
    expect(browseCatalogue(db, { nodeId: fst.nodeId, query: selected.manufacturerCode }).products[0]).toEqual(selected);
    expect(synchronizeSiemensNavigation(db)).toMatchObject({ changed: 0, removed: 0, products: 64981 });
  }, 180_000);
  it("advertises accurate counts for every value at every Siemens navigation level",()=>{
    const nodes=db.prepare(`SELECT n.id FROM cat_range_node n JOIN cat_brand b ON b.id=n.brand_id
      WHERE b.metel_marchio='SIE' AND n.active=1 AND n.navigable=1 ORDER BY n.id`).all() as {id:number}[];
    expect(nodes.length).toBeGreaterThanOrEqual(212);
    const expected=db.prepare(`${BROWSE_SCOPE_SQL} SELECT a.code,COALESCE(o.value,pa.value_num) AS value,COUNT(*) AS count
      FROM member m JOIN cat_product_attribute pa ON pa.product_id=m.product_id JOIN cat_attribute a ON a.id=pa.attribute_id
      LEFT JOIN cat_attribute_option o ON o.id=pa.option_id GROUP BY a.code,COALESCE(o.value,pa.value_num)`);
    const totals=db.prepare(`${BROWSE_SCOPE_SQL} SELECT COUNT(*) FROM member`);
    for(const node of nodes){
      const actual=browseCatalogue(db,{nodeId:node.id,limit:1});
      expect(actual.totalCount,`node ${node.id}`).toBe(totals.pluck().get({nodeId:node.id}));
      const counts=new Map((expected.all({nodeId:node.id}) as {code:string;value:string|number;count:number}[]).map(r=>[`${r.code}:${r.value}`,r.count]));
      for(const attr of actual.facets.attributes) for(const value of attr.values)
        expect(value.count,`node ${node.id} ${attr.code}:${value.value}`).toBe(counts.get(`${attr.code}:${value.value}`)??0);
    }
  },180_000);
  it("every advertised filter selects its counted articles, including combined filters, search and pagination",()=>{
    const nodeId=db.prepare(`SELECT n.id FROM cat_range_node n JOIN cat_brand b ON b.id=n.brand_id WHERE b.metel_marchio='SIE' AND n.parent_id IS NULL`).pluck().get() as number;
    const initial=browseCatalogue(db,{nodeId,limit:1});
    expect(initial.totalCount).toBe(64981);
    for(const attr of initial.facets.attributes){
      const value=attr.values[0]!;
      const filter:CatalogueAttributeFilter={attributeCode:attr.code,values:[value.value]};
      const result=browseCatalogue(db,{nodeId,attributeFilters:[filter],limit:1});
      expect(result.totalCount,`${attr.code}:${value.value}`).toBe(value.count);
      if(result.products.length) expect(result.products[0]!.attributes.find(a=>a.code===attr.code)?.value).toBe(value.value);
    }
    const attributeFilters=[{attributeCode:"trip_curve",values:["c"]},{attributeCode:"rated_current",values:[16]}];
    const request={nodeId,attributeFilters,query:"INT",limit:7};
    const result=browseCatalogue(db,request);
    expect(result.totalCount).toBeGreaterThan(7);
    const ids:number[]=[];
    for(let offset=0;offset<result.totalCount;offset+=7){
      const page=browseCatalogue(db,{...request,offset});ids.push(...page.products.map(p=>p.id));
      expect(page.products.every(p=>p.attributes.some(a=>a.code==="trip_curve" && a.value==="c") && p.attributes.some(a=>a.code==="rated_current" && a.value===16))).toBe(true);
    }
    expect(new Set(ids).size).toBe(result.totalCount);
    expect(browseCatalogue(db,{nodeId}).totalCount).toBe(initial.totalCount);
  },180_000);
  it("repeating full enrichment is unchanged and imports supply only valid proposals",()=>{
    const stats=db.transaction(()=>enrichProductAttributes(db,ATTRIBUTE_PARSERS))();
    expect(stats).toMatchObject({inserted:0,updated:0,deleted:0,invalid:0});
    expect(synchronizeAttributeSeed(db)).toMatchObject({reenriched:false,enrichment:null});
    const hash=ingestMetelFileFromPath({database:raw,sourcePath:paths.LSP}).fileSha256;
    normalizeMetelDelivery({lqDatabase:db,rawDatabase:raw,sources:{LSP:hash}});
    expect(db.transaction(()=>enrichProductAttributes(db,ATTRIBUTE_PARSERS))()).toMatchObject({inserted:0,updated:0,deleted:0,invalid:0});
  },180_000);
});
