import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { BROWSE_SCOPE_SQL, browseCatalogue } from "../src/main/catalogue/browse-queries.js";
import { browseManufacturerNodes } from "../src/main/catalogue/manufacturer-navigation.js";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { createCatalogueFixture } from "./helpers/catalogue-fixtures.js";

const roots: string[] = [];
function fixture(): BetterSqlite3.Database {
  const root = mkdtempSync(path.join(tmpdir(), "librequadri-browse-"));
  roots.push(root);
  const db = openMigratedLqDatabase({ databaseFilename: path.join(root, "lq.db"),
    backupDirectory: path.join(root, "backups"), migrationsFolder: path.resolve("db/migrations/lq") });
  db.exec(`INSERT INTO cat_metel_issuer(id,metel_sigla) VALUES(1,'ISS');
    INSERT INTO cat_brand(id,metel_marchio,name,source) VALUES
      (1,'ALP','Alpha','import'),(2,'BET','Beta','import');
    INSERT INTO cat_category(id,code,name,source) VALUES(1,'devices','Devices','seed');
    INSERT INTO cat_attribute(id,code,name,data_type,source) VALUES
      (1,'color','Color','enum','seed'),(2,'poles','Poles','number','seed');
    INSERT INTO cat_attribute_option(id,attribute_id,value,label,sort_order,source) VALUES
      (1,1,'red','Red',1,'seed'),(2,1,'blue','Blue',2,'seed'),(3,1,'green','Green',3,'seed');
    INSERT INTO cat_category_attribute(category_id,attribute_id,source) VALUES(1,1,'seed'),(1,2,'seed');
    INSERT INTO cat_metel_family(id,issuer_id,brand_id,family_type,code,is_known)
      VALUES(1,1,1,'STATISTICA','FST-1',1);
    INSERT INTO cat_product(id,brand_id,manufacturer_code,code_norm,short_description,
      is_listed,category_id,statistical_family_id,updated_at) VALUES
      (1,1,'A','A','switch red',1,1,NULL,'2026-09-24'),
      (2,1,'B','B','socket blue',0,1,NULL,'2026-09-24'),
      (3,1,'C','C','switch blue',1,1,NULL,'2026-09-24'),
      (4,1,'D','D','panel structural',1,1,1,'2026-09-24'),
      (5,1,'E','E','orphan',1,1,NULL,'2026-09-24'),
      (6,2,'F','F','switch green',1,1,NULL,'2026-09-24');
    INSERT INTO cat_product_attribute(product_id,attribute_id,option_id,source) VALUES
      (1,1,1,'manual'),(2,1,2,'manual'),(3,1,2,'manual'),(6,1,3,'manual');
    INSERT INTO cat_product_attribute(product_id,attribute_id,value_num,source) VALUES
      (1,2,2,'manual'),(2,2,2,'manual'),(3,2,4,'manual'),(6,2,4,'manual');
    INSERT INTO cat_range_node(id,brand_id,parent_id,code,name,node_kind,source,navigable) VALUES
      (10,1,NULL,'eng.root','Engineering','section','import',1),
      (11,1,10,'eng.left','Left','group','import',1),
      (12,1,10,'eng.right','Right','group','import',1),
      (13,1,10,'eng.hidden','Hidden','group','import',0),
      (20,1,NULL,'fst.root','FST','section','metel',1),
      (21,1,20,'fst.leaf','FST leaf','group','metel',1);
    INSERT INTO cat_range_node_metel_family(node_id,metel_family_id) VALUES(21,1);
    INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,definition_fingerprint,source,active,obsolete) VALUES
      (1,1,'device.one','One','device','x1','import',1,0),
      (2,1,'device.two','Two','device','x2','import',1,0),
      (3,1,'support','Support','support','x3','import',1,0),
      (4,1,'enclosure','Enclosure','enclosure','x4','import',1,0),
      (5,1,'obsolete','Old','device','x5','import',1,1),
      (6,1,'accessory','Accessory','accessory','x6','import',1,0);
    INSERT INTO cat_range_node_model(node_id,model_id) VALUES
      (11,1),(11,2),(11,3),(11,5),(12,6),(13,4);
    INSERT INTO cat_config_model_entry(product_id,model_id) VALUES
      (1,1),(1,2),(2,3),(3,6),(4,4),(5,5),(6,1);`);
  return db;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const codes = (db: BetterSqlite3.Database, nodeId: number, rest: Parameters<typeof browseCatalogue>[1] = { nodeId }) =>
  browseCatalogue(db, { ...rest, nodeId }).products.map(p => p.manufacturerCode);

describe("article-first manufacturer tree browse", () => {
  it("includes descendants once, confines leaves, text and listed filters, and pages deterministically", () => {
    const db = fixture();
    try {
      expect(codes(db, 10)).toEqual(["A", "C", "F", "B"]);
      expect(codes(db, 11)).toEqual(["A", "F", "B"]);
      expect(codes(db, 12)).toEqual(["C"]);
      expect(codes(db, 10, { nodeId: 10, query: "switch" })).toEqual(["A", "C", "F"]);
      expect(codes(db, 11, { nodeId: 11, listedOnly: true })).toEqual(["A", "F"]);
      expect([0, 1, 2, 3].flatMap(offset => codes(db, 10, { nodeId: 10, limit: 1, offset })))
        .toEqual(codes(db, 10));
      expect(browseCatalogue(db, { nodeId: 10, limit: 1 })).toMatchObject({ totalCount: 4, hasMore: true });
    } finally { db.close(); }
  });

  it("reports distinct browseable descendant articles for every navigation scope", () => {
    const db = fixture();
    try {
      // The root has no direct model or METEL-family membership. A is reached
      // through two models, and later through two separate descendant nodes.
      db.exec("INSERT INTO cat_range_node_model(node_id,model_id) VALUES(12,2)");
      const nodes = browseManufacturerNodes(db);
      expect(nodes.find(node => node.id === 10)).toMatchObject({ articleCount: 4, packageCount: 0 });
      expect(nodes.find(node => node.id === 11)).toMatchObject({ articleCount: 3 });
      expect(nodes.find(node => node.id === 12)).toMatchObject({ articleCount: 2 });
      expect(nodes.find(node => node.id === 20)).toMatchObject({ articleCount: 1 });
      expect(nodes.find(node => node.id === 21)).toMatchObject({ articleCount: 1 });
      for (const node of nodes) {
        expect(node.articleCount).toBe(browseCatalogue(db, { nodeId: node.id }).totalCount);
      }
    } finally { db.close(); }
  });

  it("returns useful disjunctive facets, retaining selected zero-count values", () => {
    const db = fixture();
    try {
      const base = browseCatalogue(db, { nodeId: 10 });
      expect(base.facets.brand?.values.map(v => v.value)).toEqual(["ALP", "BET"]);
      expect(base.facets.configurability?.values.map(v => v.value)).toEqual([false, true]);
      expect(base.facets.attributes.map(a => a.code)).toEqual(["color", "poles"]);
      const filtered = browseCatalogue(db, { nodeId: 10, query: "switch", listedOnly: true,
        brandMarchio: ["ALP"], attributeFilters: [{ attributeCode: "color", values: ["red"] }] });
      expect(filtered.products.map(p => p.manufacturerCode)).toEqual(["A"]);
      expect(filtered.totalCount).toBe(1);
      // Options of the whole tree stay offered; the ones without a match carry count 0.
      expect(filtered.facets.attributes[0]?.values.map(v => [v.value, v.count])).toEqual([
        ["red", 1], ["blue", 1], ["green", 0],
      ]);
      expect(filtered.facets.brand?.values.map(v => [v.value, v.count])).toEqual([["ALP", 1], ["BET", 0]]);
      const zero = browseCatalogue(db, { nodeId: 11, query: "switch",
        attributeFilters: [{ attributeCode: "color", values: ["blue"] }] });
      expect(zero.totalCount).toBe(0);
      expect(zero.facets.attributes[0]?.values.some(v => v.value === "blue" && v.count === 0 && v.selected)).toBe(true);
      const emptySelections = browseCatalogue(db, { nodeId: 12,
        brandMarchio: ["BET"], configurable: [false] });
      expect(emptySelections.totalCount).toBe(0);
      expect(emptySelections.facets.brand?.values.some(v => v.value === "BET" && v.count === 0 && v.selected)).toBe(true);
      expect(emptySelections.facets.configurability?.values.some(v => !v.value && v.count === 0 && v.selected)).toBe(true);
      // A narrower node keeps the parent's facets; availability follows the node's own articles.
      const leaf = browseCatalogue(db, { nodeId: 12 });
      expect(leaf.facets.brand?.values.map(v => [v.value, v.count])).toEqual([["ALP", 1], ["BET", 0]]);
      expect(leaf.facets.configurability?.values.map(v => [v.value, v.count])).toEqual([[false, 0], [true, 1]]);
      expect(leaf.facets.attributes.map(a => [a.code, a.applicable])).toEqual([["color", true], ["poles", true]]);
      expect(browseCatalogue(db, { nodeId: 12, attributeFilters: [{ attributeCode: "color", values: ["red"] }] })
        .facets.attributes[0]?.values.some(v => v.value === "red" && v.count === 0 && v.selected)).toBe(true);
    } finally { db.close(); }
  });

  it("groups numeric facet values separately and keeps disjunctive counts after selection", () => {
    const db = fixture();
    try {
      const numeric = browseCatalogue(db, { nodeId: 10 }).facets.attributes.find(a => a.code === "poles");
      expect(numeric?.values).toEqual([
        { value: 2, label: null, count: 2, selected: false },
        { value: 4, label: null, count: 2, selected: false },
      ]);
      const selected = browseCatalogue(db, { nodeId: 10,
        attributeFilters: [{ attributeCode: "poles", values: [2] }] });
      expect(selected.products.map(p => p.manufacturerCode)).toEqual(["A", "B"]);
      expect(selected.facets.attributes.find(a => a.code === "poles")?.values).toEqual([
        { value: 2, label: null, count: 2, selected: true },
        { value: 4, label: null, count: 2, selected: false },
      ]);
    } finally { db.close(); }
  });

  it("uses the existing parent index for recursive descendant lookup", () => {
    const db = fixture();
    try {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${BROWSE_SCOPE_SQL} SELECT COUNT(*) FROM tree`)
        .all({ nodeId: 10 }) as Array<{ detail: string }>;
      expect(plan.some(row => row.detail.includes("cat_range_node_parent_idx"))).toBe(true);
    } finally { db.close(); }
  });

  it("uses only eligible model entries for configurability and keeps FST structural articles", () => {
    const db = fixture();
    try {
      expect(codes(db, 11, { nodeId: 11, configurable: [true] })).toEqual(["A", "F"]);
      expect(codes(db, 11, { nodeId: 11, configurable: [false] })).toEqual(["B"]);
      expect(browseManufacturerNodes(db).some(n => n.id === 13)).toBe(false);
      expect(codes(db, 13)).toEqual([]);
      expect(codes(db, 20)).toEqual(["D"]);
      expect(codes(db, 21)).toEqual(["D"]);
      expect(browseCatalogue(db, { nodeId: 10 }).products.map(p => [p.manufacturerCode, p.configurable]))
        .toEqual([["A", true], ["C", true], ["F", true], ["B", false]]);
      expect(browseCatalogue(db, { nodeId: 20 }).products[0]?.configurable).toBe(false);
      expect(browseCatalogue(db, { nodeId: 20 }).products[0]?.price).toBeNull();
    } finally { db.close(); }
  });

  it("lists linked and out-of-catalogue model-only packages beside articles and includes them in brand and configurability counts", () => {
    const db = fixture();
    try {
      const requests = [{ nodeId: 10 }, { nodeId: 10, limit: 2, offset: 2 }, { nodeId: 10, query: "switch" }];
      const before = requests.map(request => browseCatalogue(db, request));
      db.exec(`INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,definition_fingerprint,source,active,obsolete) VALUES
          (7,2,'package.linked','Linked package','device','x7','import',1,0),
          (8,1,'package.unlinked','Unlinked package','device','x8','import',1,0),
          (9,1,'package.empty','Empty package','device','x9','import',1,0),
          (10,1,'package.hidden','Hidden package','device','x10','import',1,0),
          (11,1,'package.support','Support package','support','x11','import',1,0);
        INSERT INTO cat_range_node_model(node_id,model_id) VALUES(11,7),(12,8),(12,9),(13,10),(12,11);
        INSERT INTO cat_config_rule(id,model_id,seq) VALUES(1,7,1),(2,8,1),(3,10,1),(4,11,1);
        INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,product_id,ref_brand_marchio,
          ref_manufacturer_code,quantity,article_role) VALUES
          (1,1,'article',3,'ALP','C',1,'accessory'),(2,1,'article',NULL,'ALP','ZZZ',1,'accessory'),
          (3,1,'article',3,'ALP','C',1,'accessory'),(4,1,'article',3,'ALP','C',1,'accessory');`);
      const after = requests.map(request => browseCatalogue(db, request));
      expect(after.map(result => ({ products: result.products, totalCount: result.totalCount,
        offset: result.offset, hasMore: result.hasMore, attributes: result.facets.attributes })))
        .toEqual(before.map(result => ({ products: result.products, totalCount: result.totalCount,
          offset: result.offset, hasMore: result.hasMore, attributes: result.facets.attributes })));
      expect(after[0]?.facets.brand?.values.find(value => value.value === "BET")?.count).toBe(2);
      expect(after[0]?.facets.configurability?.values.find(value => value.value === true)?.count).toBe(5);
      expect(after[0]).toMatchObject({ packageCount: 2, packages: [{ modelId: 7, name: "Linked package",
        kind: "device", brandMarchio: "BET", groupName: "Left" }, {modelId:8,name:"Unlinked package"}] });
      expect(after[1]).toMatchObject({ packageCount: 0, packages: [] });
      expect(after[2]?.packages).toEqual([]);
      expect(browseCatalogue(db, { nodeId: 10, query: "linked" }).packages.map(item => item.modelId)).toEqual([7,8]);
      expect(browseCatalogue(db, { nodeId: 12 }).packages.map(item=>item.modelId)).toEqual([8]);
      expect(browseCatalogue(db, { nodeId: 10, attributeFilters: [{ attributeCode: "color", values: ["red"] }] })
        .packages).toEqual([]);
      const nodes = browseManufacturerNodes(db);
      expect(nodes.find(node => node.id === 10)).toMatchObject({ packageCount: 2 });
      expect(nodes.find(node => node.id === 11)).toMatchObject({ packageCount: 1 });
      expect(nodes.find(node => node.id === 12)).toMatchObject({ packageCount: 1 });
      db.exec("INSERT INTO cat_range_node_model(node_id,model_id) VALUES(12,7)");
      expect(browseManufacturerNodes(db).find(node => node.id === 10)?.packageCount).toBe(2);
      expect(browseManufacturerNodes(db).find(node => node.id === 12)?.packageCount).toBe(2);
      expect(browseCatalogue(db, { nodeId: 10 }).packageCount).toBe(2);
      db.exec("BEGIN; DELETE FROM cat_range_node_model WHERE model_id=7");
      expect(browseManufacturerNodes(db).find(node => node.id === 10)?.packageCount).toBe(1);
      db.exec("ROLLBACK");
      expect(browseManufacturerNodes(db).find(node => node.id === 10)?.packageCount).toBe(2);
      expect(nodes.some(node => node.id === 13)).toBe(false);
    } finally { db.close(); }
  });

  it("places same-named packages by their authoritative branch path, in navigation-tree order", () => {
    const db = fixture();
    try {
      db.exec(`INSERT INTO cat_range_node(id,brand_id,parent_id,code,name,node_kind,source,navigable,sort_order) VALUES
          (30,1,NULL,'pkg.root','Interruttori','section','import',1,0),
          (31,1,30,'pkg.gamma.a','Gamma A','level','import',1,2),
          (32,1,30,'pkg.gamma.b','Gamma B','level','import',1,1),
          (33,1,31,'pkg.class.a','Sezionatori','group','import',1,0),
          (34,1,32,'pkg.class.b','Sezionatori','group','import',1,0);
        INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,definition_fingerprint,source,active,obsolete) VALUES
          (7,1,'pack.a','Sezionatore 2P','device','x7','import',1,0),
          (8,1,'pack.b','Sezionatore 2P','device','x8','import',1,0);
        INSERT INTO cat_range_node_model(node_id,model_id,sort_order) VALUES(33,7,0),(34,8,0);
        INSERT INTO cat_config_rule(id,model_id,seq) VALUES(1,7,1),(2,8,1);
        INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,product_id,ref_brand_marchio,
          ref_manufacturer_code,quantity,article_role) VALUES
          (1,1,'article',3,'ALP','C',1,'component'),(2,1,'article',3,'ALP','C',1,'component');`);
      const root = browseCatalogue(db, { nodeId: 30 });
      // Source order puts Gamma B (sort 1) before Gamma A (sort 2); the names alone are identical.
      expect(root.packages.map(item => ({ modelId: item.modelId, groupId: item.groupId, groupPath: item.groupPath })))
        .toEqual([{ modelId: 8, groupId: 34, groupPath: ["Gamma B", "Sezionatori"] },
          { modelId: 7, groupId: 33, groupPath: ["Gamma A", "Sezionatori"] }]);
      expect(new Set(root.packages.map(item => item.name)).size).toBe(1);
      expect(root.packages.every(item => !item.groupPath.some(name => name.startsWith("pack.")))).toBe(true);
      expect(browseCatalogue(db, { nodeId: 31 }).packages[0]?.groupPath).toEqual(["Sezionatori"]);
      expect(browseCatalogue(db, { nodeId: 33 }).packages[0]).toMatchObject({ modelId: 7, groupPath: [] });
      expect(root.packageCount).toBe(2);
    } finally { db.close(); }
  });

  it("uses current governing price-list semantics", () => {
    const data = createCatalogueFixture();
    try {
      data.importDelivery({ issuer: "ISS", listino: "001", validFrom: "2026-01-01",
        products: [{ marchio: "ALP", code: "P1", description: "switch", priceCents: 1234 }] });
      const product = data.lq.prepare("SELECT id,brand_id FROM cat_product WHERE manufacturer_code='P1'")
        .get() as { id: number; brand_id: number };
      data.lq.prepare(`INSERT INTO cat_range_node(brand_id,code,name,node_kind,source)
        VALUES(?,'price.root','Prices','section','manual')`).run(product.brand_id);
      const nodeId = data.lq.prepare("SELECT id FROM cat_range_node WHERE code='price.root'").pluck().get() as number;
      data.lq.prepare(`INSERT INTO cat_config_model(brand_id,code,name,model_kind,definition_fingerprint,source)
        VALUES(?,'price.model','Price','device','x','manual')`).run(product.brand_id);
      const modelId = data.lq.prepare("SELECT id FROM cat_config_model WHERE code='price.model'").pluck().get() as number;
      data.lq.prepare("INSERT INTO cat_range_node_model(node_id,model_id) VALUES(?,?)").run(nodeId, modelId);
      data.lq.prepare("INSERT INTO cat_config_model_entry(product_id,model_id) VALUES(?,?)").run(product.id, modelId);
      expect(browseCatalogue(data.lq, { nodeId }).products[0]?.price?.unitPriceE4).toBe(123400);
      data.lq.prepare("UPDATE cat_product_listing SET is_listed=0 WHERE product_id=?").run(product.id);
      expect(browseCatalogue(data.lq, { nodeId }).products[0]?.price).toBeNull();
    } finally { data.close(); }
  });
});

const realCatalogue = process.env["LIBREQUADRI_REV83_REAL_DB"];
describe.runIf(realCatalogue !== undefined && existsSync(realCatalogue))("populated development catalogue browse", () => {
  it("distinguishes every same-named package in a broad real family by its branch path", () => {
    const db = new BetterSqlite3(realCatalogue!, { readonly: true, fileMustExist: true });
    try {
      const node = browseManufacturerNodes(db).find(n => n.source === "import" && n.name === "Interruttori scatolati");
      if (!node) return;
      const result = browseCatalogue(db, { nodeId: node.id });
      const keys = result.packages.map(item => `${item.groupPath.join(" › ")}|${item.name}`);
      expect(new Set(keys).size).toBe(result.packages.length);
      expect(result.packages.every(item => item.groupPath.length > 0 &&
        item.groupPath[item.groupPath.length - 1] === item.groupName)).toBe(true);
    } finally { db.close(); }
  }, 60_000);

  it("browses engineering and FST roots against the real catalogue read-only", () => {
    const db = new BetterSqlite3(realCatalogue!, { readonly: true, fileMustExist: true });
    try {
      const nodes = browseManufacturerNodes(db);
      const engineering = nodes.find(n => n.source === "import" && n.parentId === null);
      const fst = nodes.find(n => n.source === "metel" && n.parentId === null);
      expect(engineering).toBeDefined();
      expect(fst).toBeDefined();
      expect(nodes.some(n => n.source === "import" && ["Carpenterie", "Pannelli"].includes(n.name))).toBe(false);
      const totalProducts = db.prepare("SELECT COUNT(*) FROM cat_product").pluck().get() as number;
      const fstCovered = db.prepare(`SELECT COUNT(DISTINCT p.id) FROM cat_product p
        JOIN cat_range_node_metel_family nf ON nf.metel_family_id=p.statistical_family_id
        JOIN cat_range_node n ON n.id=nf.node_id WHERE n.active=1 AND n.navigable=1`)
        .pluck().get() as number;
      expect(fstCovered).toBe(totalProducts);
      const engineeringPage = browseCatalogue(db, { nodeId: engineering!.id, limit: 10 });
      const fstPage = browseCatalogue(db, { nodeId: fst!.id, limit: 10 });
      expect(engineeringPage.totalCount).toBeGreaterThan(0);
      expect(fstPage.totalCount).toBeGreaterThan(0);
      expect(engineeringPage.products.length).toBe(10);
      expect(fstPage.products.length).toBe(10);
      expect(new Set(engineeringPage.products.map(p => p.id)).size).toBe(10);
      expect(new Set(fstPage.products.map(p => p.id)).size).toBe(10);
      expect(fstPage.products.some(p => p.price !== null)).toBe(true);
    } finally { db.close(); }
  }, 60_000);
});
