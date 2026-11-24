import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { openMigratedRawDatabase } from "../src/main/database/raw-migrations.js";
import { closeConfiguredDatabase } from "../src/main/database/sqlite-connection.js";
import { normalizeMetelDelivery } from "../src/main/metel/catalogue-normalization.js";
import { ingestMetelFileFromPath } from "../src/main/metel/raw-ingestion.js";
import { importTiQuadri, type TiQuadriImportResult } from "../src/main/sources/tiquadri/import.js";
import { browseRangeNodes, getConfigurationModel, getPhysicalProfile, listNodeModels, listProductModels } from "../src/main/catalogue/configuration-queries.js";
import { browseManufacturerNodes,listManufacturerModels,listManufacturerArticles,
  manufacturerPositions } from "../src/main/catalogue/manufacturer-navigation.js";
import { browseCatalogue } from "../src/main/catalogue/browse-queries.js";
import { loadRangeNavigationSeed } from "../src/main/catalogue/range-navigation-seed.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";
import { getCatalogueProductSnapshot } from "../src/main/catalogue/catalogue-queries.js";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { configurationRequest, selectableOptions } from "../src/renderer/configuration/presentation.js";
import { demoQuotationTotals } from "../src/renderer/quotation/demo-quotation.js";
import { classifyRawContribution } from "../src/main/sources/tiquadri/import.js";
import { TIQUADRI_ENGINEERING_ADAPTER } from "../src/main/sources/tiquadri/adapter.js";
import { readEngineeringReadiness } from "../src/main/catalogue/engineering-readiness.js";
import { discoverDesignCandidates, discoverDesignRangeNodes, guardDesignCandidate } from "../src/main/project/design-compatibility.js";
import { SELECTABLE_PACKAGE_SQL } from "../src/main/catalogue/manufacturer-navigation.js";
import { devicePool } from "../src/renderer/project/placement-workflow.js";
import { loadEngineeringVocabularySeed } from "../src/main/catalogue/engineering-vocabulary.js";
import { offerSelection, synchronizePackageOffers } from "../src/main/catalogue/package-offers.js";
import { configuredItemAddable } from "../src/main/catalogue/configuration-addability.js";
import { synchronizeDerivedCatalogue } from "../src/main/catalogue/derived-catalogue.js";
import { loadCategorySeed } from "../src/main/catalogue/category-seed.js";
import { loadAttributeSeed } from "../src/main/catalogue/attribute-seed.js";

const source=process.env["LIBREQUADRI_TIQUADRI_MDB"] ?? "";
const listino=process.env["LIBREQUADRI_LISTINOBT_MDB"] ?? "";
const metel=process.env["LIBREQUADRI_METEL_DIR"] ?? "";
const metelFile=(name:string)=>path.join(metel,name,name);
const available=existsSync(source)&&existsSync(listino)&&["BTILSP021.txt","BTIFSC.txt","BTIFST.txt"]
  .every(name=>existsSync(metelFile(name)));

it("requires reviewed approval and raw absence of both article row types",()=>{
  const approvals=[{sourceRef:"TiQuadri ANA_PACK 1778",commercialContribution:"none" as const,
    reviewedName:"Din generico - Solo spazio"}];
  const classify=(name:string,base:number,modalities:number,ref="TiQuadri ANA_PACK 1778")=>
    classifyRawContribution(ref,name,base,modalities,approvals);
  expect(classify("Din generico - Solo spazio",0,0))
    .toEqual({commercialContribution:"none",reviewCandidate:false,conflict:false});
  expect(classify("Other",0,0,"TiQuadri ANA_PACK 999"))
    .toEqual({commercialContribution:"articles",reviewCandidate:true,conflict:false});
  for(const [base,modalities] of [[1,0],[0,1]])
    expect(classify("Din generico - Solo spazio",base,modalities))
      .toEqual({commercialContribution:"articles",reviewCandidate:false,conflict:true});
  expect(classify("Renamed",0,0))
    .toEqual({commercialContribution:"articles",reviewCandidate:false,conflict:true});
});

describe.runIf(available)("Revision 8 Step 9.2 real TiQuadri import",()=>{
  let root:string,db:Database.Database,raw:Database.Database,result:TiQuadriImportResult;
  let parserRowsBeforeImport:unknown[];
  const one=(sql:string,...values:unknown[])=>db.prepare(sql).get(...values) as Record<string,unknown>|undefined;
  // Stage C scope by the source hierarchy recorded in each model's evidence.
  const stageCTypologies=new Set(["Magnetotermici","Magnetotermici differenziali","Differenziali monoblocco",
    "Differenziali puri","Sezionatori","Solo Magnetici","Portafusibili","Relè differenziale / Toroide",
    "Salvamotori","Limitatori di Sovratensione","Protezione"]);
  const stageCModel=(model:{model:string;evidence:string})=>{
    const [, group, typology]=/LQ group ([^;]+); Tipologia ([^;]+)/.exec(model.evidence)??[];
    return group==="Interruttori scatolati"||group==="Sezionatori con maniglia"||
      (group==="Dispositivi modulari"&&stageCTypologies.has(typology!))||
      ["tq.pack.14744","tq.pack.14745","tq.pack.14746","tq.pack.14747"].includes(model.model);
  };
  beforeAll(async()=>{
    root=mkdtempSync(path.join(tmpdir(),"librequadri-tiquadri-real-"));
    db=openMigratedLqDatabase({databaseFilename:path.join(root,"lq.db"),
      backupDirectory:path.join(root,"backups"),migrationsFolder:path.resolve("db/migrations/lq")});
    raw=openMigratedRawDatabase({databaseFilename:path.join(root,"raw.db"),
      migrationsFolder:path.resolve("db/migrations/raw")});
    const hash=(name:string)=>ingestMetelFileFromPath({database:raw,sourcePath:metelFile(name)}).fileSha256;
    normalizeMetelDelivery({lqDatabase:db,rawDatabase:raw,sources:{
      LSP:hash("BTILSP021.txt"),FSC:hash("BTIFSC.txt"),FST:hash("BTIFST.txt"),
    }});
    parserRowsBeforeImport=db.prepare(`SELECT * FROM cat_product_attribute WHERE source='parser' ORDER BY product_id,attribute_id`).all();
    result=await importTiQuadri({database:db,sourcePath:source,
      listinoPath:listino,
      archiveDirectory:path.join(root,"imports/tiquadri"),backupDirectory:path.join(root,"backups"),
      seedFolder:path.resolve("db/seed")});
  },240_000);
  afterAll(()=>{
    if(db)closeConfiguredDatabase(db);
    if(raw)closeConfiguredDatabase(raw);
    if(root)rmSync(root,{recursive:true,force:true});
  });

  it("Stage B covers all 171 v32 Taratura values and preserves prior Btdin parser rows",()=>{
    const seed=loadEngineeringVocabularySeed();
    const sourceValues=db.prepare(`SELECT v.code,v.label FROM cat_config_dimension_value v
      JOIN cat_config_dimension d ON d.id=v.dimension_id WHERE d.code='tq.label.51' ORDER BY v.code`).all() as Array<{code:string;label:string}>;
    const expected=[...seed.values.filter(v=>v.dimension==="tq.label.51").map(v=>({code:v.value,label:v.reviewedLabel})),
      ...seed.notApplicable.filter(v=>v.dimension==="tq.label.51").map(v=>({code:v.value!,label:v.reviewedLabel!}))].sort((a,b)=>a.code.localeCompare(b.code));
    expect(sourceValues).toEqual(expected);
    expect(db.prepare(`SELECT COUNT(*) FROM cat_config_value_attribute a JOIN cat_config_dimension_value v ON v.id=a.value_id
      JOIN cat_config_dimension d ON d.id=v.dimension_id WHERE d.code='tq.label.51' AND a.source='seed'`).pluck().get()).toBe(159);
    const afterRows=db.prepare(`SELECT * FROM cat_product_attribute ORDER BY product_id,attribute_id`).all() as Array<Record<string,unknown>>;
    const byKey=new Map(afterRows.map(row=>[`${row["product_id"]}:${row["attribute_id"]}`,row]));
    const original=parserRowsBeforeImport as Array<Record<string,unknown>>;
    expect(original).toHaveLength(3531);
    for(const before of original){
      const after=byKey.get(`${before["product_id"]}:${before["attribute_id"]}`);
      expect(after,`missing ${before["product_id"]}:${before["attribute_id"]}`).toBeDefined();
      expect([after!["value_num"],after!["option_id"],after!["value_bool"],after!["value_text"]])
        .toEqual([before["value_num"],before["option_id"],before["value_bool"],before["value_text"]]);
      expect(["parser","engineering"]).toContain(after!["source"]);
    }
    expect(db.prepare(`SELECT COUNT(*) FROM cat_source_conflict WHERE topic='derived.parser_disagrees'`).pluck().get()).toBe(0);
    for(const code of ["T7304F125","T7304F125D","T7304H125","T7304L125","T7304N125","T7304N125D"]){
      expect(one(`SELECT c.code AS category FROM cat_product p JOIN cat_category c ON c.id=p.category_id WHERE p.manufacturer_code=?`,code))
        .toEqual({category:code.endsWith("D") ? "protezione.interruttori_scatolati_differenziali" : "protezione.interruttori_scatolati"});
      expect(one(`SELECT pa.product_id FROM cat_product_attribute pa JOIN cat_product p ON p.id=pa.product_id
        JOIN cat_attribute a ON a.id=pa.attribute_id WHERE p.manufacturer_code=? AND a.code='rated_current'`,code)).toBeUndefined();
    }
  });

  it("Stage C classifies the protection primaries and preserves technical semantics",()=>{
    const seed=loadEngineeringVocabularySeed();
    // One reviewed seed now covers every Apparecchi model: Stage C's 819 plus Stage D's 480.
    expect(seed.models).toHaveLength(1299);
    expect(seed.models.filter(stageCModel)).toHaveLength(819);
    expect(seed.models.every(model=>model.evidence.includes("TiQuadri ANA_PACK "))).toBe(true);
    const seedKeys=[...seed.values.map(v=>`${v.dimension}/${v.value}`),
      ...seed.notApplicable.filter(v=>v.dimension).map(v=>`${v.dimension}/${v.value}`)];
    expect(new Set(seedKeys).size).toBe(seedKeys.length);
    expect(seed.notApplicable.every(v=>v.model!==undefined || (v.dimension!==undefined && v.value!==undefined))).toBe(true);
    const facts=(code:string)=>{
      const rows=db.prepare(`SELECT c.code AS category,a.code AS attribute,pa.value_num AS num,o.value AS option
        FROM cat_product p JOIN cat_category c ON c.id=p.category_id
        LEFT JOIN cat_product_attribute pa ON pa.product_id=p.id
        LEFT JOIN cat_attribute a ON a.id=pa.attribute_id
        LEFT JOIN cat_attribute_option o ON o.id=pa.option_id
        WHERE p.manufacturer_code=?`).all(code) as Array<{category:string;attribute:string|null;num:number|null;option:string|null}>;
      expect(rows,code).not.toHaveLength(0);
      return {category:rows[0]!.category,attributes:Object.fromEntries(rows.filter(r=>r.attribute)
        .map(r=>[r.attribute!,r.num??r.option]))};
    };
    const expected:Record<string,{category:string;attributes:Record<string,string|number>}>= {
      FH84C10:{category:"protezione.interruttori_automatici",attributes:{poles:"4p",rated_current:10,trip_curve:"c",declared_breaking_capacity:10}},
      GN8843A16:{category:"protezione.magnetotermici_differenziali",attributes:{poles:"4p",rated_current:16,residual_current_type:"a",rated_residual_current:30,declared_breaking_capacity:6}},
      G723AC40:{category:"protezione.differenziali_puri",attributes:{poles:"2p",rated_current:40,residual_current_type:"ac",rated_residual_current:30}},
      G723F63:{category:"protezione.differenziali_puri",attributes:{residual_current_type:"f"}},
      415920:{category:"protezione.rilevatori_arco",attributes:{poles:"1p_n",rated_current:10,trip_curve:"b",declared_breaking_capacity:6}},
      F82N16FV1:{category:"protezione.interruttori_automatici",attributes:{poles:"2p",rated_current:16}},
      417305:{category:"protezione.salvamotori",attributes:{poles:"3p"}},
      T723B100E:{category:"protezione.interruttori_scatolati",attributes:{poles:"3p",rated_current:100,rated_ultimate_breaking_capacity:25}},
      T724B40E:{category:"protezione.interruttori_scatolati",attributes:{poles:"4p",rated_current:40,rated_ultimate_breaking_capacity:25}},
      T744F250:{category:"protezione.interruttori_scatolati",attributes:{poles:"4p",rated_current:250,rated_ultimate_breaking_capacity:36}},
      T714B100D:{category:"protezione.interruttori_scatolati_differenziali",attributes:{poles:"4p",rated_current:100,rated_ultimate_breaking_capacity:25}},
      T804B1000:{category:"protezione.interruttori_aperti",attributes:{poles:"4p",rated_current:1000,rated_ultimate_breaking_capacity:42}},
      "T7234WF/250":{category:"manovra.sezionatori",attributes:{rated_current:250}},
      T723S250:{category:"manovra.sezionatori",attributes:{rated_current:250}},
      T7304F125:{category:"protezione.interruttori_scatolati",attributes:{poles:"4p",rated_ultimate_breaking_capacity:36}},
    };
    for(const [code,wanted] of Object.entries(expected)){
      const actual=facts(code);
      expect(actual.category,code).toBe(wanted.category);
      expect(actual.attributes,code).toMatchObject(wanted.attributes);
    }
    for(const code of ["F82N16FV1","T7234WF/250","T723S250"])
      expect(facts(code).attributes,code).not.toHaveProperty("rated_ultimate_breaking_capacity");
    expect(facts("F82N16FV1").attributes).not.toHaveProperty("declared_breaking_capacity");
    for(const [code,category] of [["F10AP2","protezione.limitatori_sovratensione"],
      ["G701N","protezione.rele_differenziali"],["RDBMRCD230","protezione.rele_differenziali"]] as const){
      const actual=facts(code);
      expect(actual.category,code).toBe(category);
      expect(actual.attributes,code).toEqual({});
    }
    for(const code of ["417305","T7304F125"])
      expect(facts(code).attributes,code).not.toHaveProperty("rated_current");
    expect(facts("T714B100D").attributes).not.toHaveProperty("rated_residual_current");
    expect(one(`SELECT pa.product_id FROM cat_product_attribute pa JOIN cat_product p ON p.id=pa.product_id
      JOIN cat_attribute a ON a.id=pa.attribute_id WHERE p.manufacturer_code='003506'
      AND a.code='rated_residual_current'`)).toBeUndefined();
    const conflicts=["T7304F125","T7304F125D","T7304H125","T7304L125","T7304N125","T7304N125D"];
    for(const code of conflicts){
      expect(facts(code).attributes,code).not.toHaveProperty("rated_current");
      expect(db.prepare(`SELECT COUNT(*) FROM cat_source_conflict WHERE subject_key=? AND topic='derived.conflict'`).pluck().get(`BTI:${code}`),code).toBe(1);
    }
    for(const [pack,cat] of [[14744,"protezione.portafusibili"],[14745,"protezione.portafusibili"],
      [14746,"protezione.portafusibili"],[14747,"protezione.fusibili"]] as const){
      expect(one(`SELECT c.code AS category FROM cat_config_model m JOIN cat_category c ON c.id=m.category_id WHERE m.code=?`,
        `tq.pack.${pack}`)).toEqual({category:cat});
    }
    // Integrated residual switch-disconnectors ("interr. manovra + diff") versus the MS4
    // assembly, whose plain switch primary gets its residual block from the Modulo Diff. axis.
    for(const code of ["T714S160DB","T724S250D","T7304S125D","T734S250D"])
      expect(facts(code),code).toMatchObject({category:"manovra.sezionatori_differenziali",attributes:{poles:"4p"}});
    for(const code of ["T744S400","T744S630"])
      expect(facts(code).category,code).toBe("manovra.sezionatori");
    const categoryConflicts=db.prepare(`SELECT COUNT(*) FROM cat_source_conflict WHERE topic='derived.category_conflict'`).pluck().get() as number;
    expect(categoryConflicts).toBe(0);
    expect(result.summary.skipped).not.toHaveProperty("engineering_vocabulary_deferred");
    expect(result.summary.skipped).not.toHaveProperty("engineering_vocabulary_stale");
    const classified=db.prepare(`SELECT COUNT(DISTINCT p.id) FROM cat_product p JOIN cat_config_model_entry e ON e.product_id=p.id
      JOIN cat_config_model m ON m.id=e.model_id WHERE m.category_source='seed' AND m.model_kind='device'
      AND m.active=1 AND m.obsolete=0 AND m.code IN (SELECT value FROM json_each(?))`)
      .pluck().get(JSON.stringify(seed.models.filter(stageCModel).map(model=>model.model))) as number;
    expect(classified).toBe(1938);
    expect(db.prepare(`SELECT COUNT(DISTINCT p.id) FROM cat_product p JOIN cat_config_model_entry e ON e.product_id=p.id
      JOIN cat_config_model m ON m.id=e.model_id WHERE m.category_source='seed' AND m.model_kind='device'
      AND m.active=1 AND m.obsolete=0 AND p.category_id IS NULL`).pluck().get()).toBe(0);
  });

  it("keeps unsafe description-parser readings out of the Stage C categories",()=>{
    const stageC=["protezione.interruttori_scatolati","protezione.interruttori_scatolati_differenziali",
      "protezione.interruttori_aperti","protezione.salvamotori","protezione.limitatori_sovratensione",
      "protezione.portafusibili","protezione.fusibili","protezione.rele_differenziali",
      "manovra.sezionatori","manovra.sezionatori_differenziali","manovra.sezionatori_fusibili"];
    const rows=db.prepare(`SELECT c.code AS category,a.code AS attribute,pa.source,COUNT(*) AS n
      FROM cat_product_attribute pa JOIN cat_product p ON p.id=pa.product_id
      JOIN cat_category c ON c.id=p.category_id JOIN cat_attribute a ON a.id=pa.attribute_id
      WHERE c.code IN (SELECT value FROM json_each(?)) GROUP BY 1,2,3`).all(JSON.stringify(stageC)) as
      Array<{category:string;attribute:string;source:string;n:number}>;
    // Residual, curve and modular-Icn readings are never applicable to these categories.
    expect(rows.filter(r=>["residual_current_type","rated_residual_current","trip_curve",
      "declared_breaking_capacity"].includes(r.attribute))).toEqual([]);
    // The only parser-owned values are the audited fuse-holder poles and the F32 fuse-link rating.
    expect(rows.filter(r=>r.source==="parser").map(r=>`${r.category}/${r.attribute}=${r.n}`).sort())
      .toEqual(["protezione.fusibili/rated_current=1","protezione.portafusibili/poles=10"]);
    expect(rows.every(r=>["parser","engineering"].includes(r.source))).toBe(true);
    const attributesOf=(code:string)=>(db.prepare(`SELECT a.code FROM cat_product_attribute pa
      JOIN cat_product p ON p.id=pa.product_id JOIN cat_attribute a ON a.id=pa.attribute_id
      WHERE p.manufacturer_code=? ORDER BY a.code`).pluck().all(code) as string[]);
    // The BTI parser reads "6300 A" as residual type A, "1250A" as 1.25 kA, SPD "20KA"
    // as Icn and fuse "tipo F" as residual type F; none of these may be stored.
    expect(attributesOf("T803L5000")).toEqual(["poles","rated_current","rated_ultimate_breaking_capacity"]);
    expect(attributesOf("T753S1250")).toEqual(["poles","rated_current"]);
    expect(attributesOf("T7813WF1250B")).toEqual(["poles","rated_current"]);
    expect(attributesOf("F10AZC2")).toEqual([]);
    expect(attributesOf("F32")).toEqual(["rated_current"]);
  });

  it("never turns Portafusibili package Taratura into an In facet",()=>{
    // Packs 1788 "Portafusibile 4A F313N" and 1802 "Portafusibile 20A F323N" add a holder
    // and a fuse-link; their Taratura is the fuse-link rating, not the holder's In.
    const packs=["tq.pack.1788","tq.pack.1802"];
    expect(db.prepare(`SELECT m.code,c.code AS category,va.value_num AS current FROM cat_config_model m
      JOIN cat_category c ON c.id=m.category_id JOIN cat_config_axis ax ON ax.model_id=m.id
      JOIN cat_config_option o ON o.axis_id=ax.id AND o.active=1
      JOIN cat_config_value_attribute va ON va.value_id=o.value_id
      JOIN cat_attribute a ON a.id=va.attribute_id AND a.code='rated_current'
      WHERE m.code IN (SELECT value FROM json_each(?)) ORDER BY m.code`).all(JSON.stringify(packs))).toEqual([
      {code:"tq.pack.1788",category:"protezione.portafusibili",current:4},
      {code:"tq.pack.1802",category:"protezione.portafusibili",current:20},
    ]);
    expect(db.prepare(`SELECT a.code FROM cat_category_attribute ca JOIN cat_category c ON c.id=ca.category_id
      JOIN cat_attribute a ON a.id=ca.attribute_id WHERE c.code='protezione.portafusibili'`).pluck().all()).toEqual(["poles"]);
    expect(db.prepare(`SELECT COUNT(*) FROM cat_product_attribute pa JOIN cat_product p ON p.id=pa.product_id
      JOIN cat_category c ON c.id=p.category_id JOIN cat_attribute a ON a.id=pa.attribute_id
      WHERE c.code='protezione.portafusibili' AND a.code='rated_current'`).pluck().get()).toBe(0);
    const nodeId=db.prepare(`SELECT nm.node_id FROM cat_range_node_model nm JOIN cat_config_model m ON m.id=nm.model_id
      WHERE m.code='tq.pack.1788'`).pluck().get() as number;
    const plain=browseCatalogue(db,{nodeId});
    expect(plain.packages.map(p=>p.name).sort()).toEqual(["Portafusibile 20A F323N","Portafusibile 4A F313N"]);
    const facet=plain.facets.attributes.find(a=>a.code==="rated_current");
    expect(facet===undefined || (!facet.applicable && facet.values.every(v=>v.count===0))).toBe(true);
    for(const value of [4,20]){
      const filtered=browseCatalogue(db,{nodeId,attributeFilters:[{attributeCode:"rated_current",values:[value]}]});
      expect([filtered.totalCount,filtered.packageCount],String(value)).toEqual([0,0]);
    }
  });

  it("reconciles Stage C source-group memberships by primary product identity",()=>{
    const groups=new Map<string,Set<string>>();
    const identities=new Map<string,string>();
    const entries=db.prepare(`SELECT p.id,b.metel_marchio,p.manufacturer_code FROM cat_config_model m
      JOIN cat_config_model_entry e ON e.model_id=m.id
      JOIN cat_product p ON p.id=e.product_id JOIN cat_brand b ON b.id=p.brand_id
      WHERE m.code=?`);
    for(const model of loadEngineeringVocabularySeed().models.filter(stageCModel)){
      const group=/LQ group ([^;]+);/.exec(model.evidence)?.[1];
      expect(group,model.model).toBeDefined();
      const members=groups.get(group!)??new Set<string>();
      groups.set(group!,members);
      for(const row of entries.all(model.model) as Array<{id:number;metel_marchio:string;manufacturer_code:string}>){
        const id=String(row.id);
        const identity=`${row.metel_marchio}:${row.manufacturer_code}`;
        expect(identities.get(id)??identity).toBe(identity);
        identities.set(id,identity);
        members.add(id);
      }
    }
    expect(Object.fromEntries([...groups].map(([group,ids])=>[group,ids.size]))).toEqual({
      "Dispositivi modulari":894,"Interruttori scatolati":1000,
      "Sezionatori con maniglia":44,"Prese industriali":4,
    });
    const memberships=new Map<string,string[]>();
    for(const [group,ids] of groups)for(const id of ids)
      memberships.set(id,[...(memberships.get(id)??[]),group]);
    expect([...groups.values()].reduce((sum,ids)=>sum+ids.size,0)).toBe(1942);
    expect(memberships.size).toBe(1938);
    expect([...memberships].filter(([,groupNames])=>groupNames.length>1)
      .map(([id])=>`${id}:${identities.get(id)}`).sort())
      .toEqual(["2768:BTI:F322","2769:BTI:F323","2770:BTI:F323N","3746:BTI:G701N"]);
    expect([...groups.get("Prese industriali")!].filter(id=>
      (memberships.get(id)??[]).length===1).map(id=>`${id}:${identities.get(id)}`))
      .toEqual(["2765:BTI:F32"]);
  });

  it("Stage D classifies every remaining primary and selectable package by function",()=>{
    const seed=loadEngineeringVocabularySeed();
    expect(seed.models.filter(model=>!stageCModel(model))).toHaveLength(480);
    // Every primary selected by an Apparecchi model has exactly one category.
    expect(db.prepare(`SELECT COUNT(DISTINCT e.product_id),SUM(p.category_id IS NULL) FROM cat_config_model_entry e
      JOIN cat_config_model m ON m.id=e.model_id AND m.category_source='seed' AND m.active=1 AND m.obsolete=0
      JOIN cat_product p ON p.id=e.product_id`).raw().get()).toEqual([2273,0]);
    expect(db.prepare(`SELECT COUNT(*) FROM cat_source_conflict WHERE topic='derived.category_conflict'`).pluck().get()).toBe(0);
    // All 160 Apparecchi selectable packages are classified; outside Apparecchi none are.
    const packages=Object.fromEntries(db.prepare(`SELECT c.code,COUNT(*) FROM cat_config_model m
      JOIN cat_category c ON c.id=m.category_id WHERE ${SELECTABLE_PACKAGE_SQL} AND m.code LIKE 'tq.pack.%'
      GROUP BY c.code`).raw().all() as Array<[string,number]>);
    expect(packages).toEqual({
      "alimentazione.alimentatori_trasformatori":3,"automazione.sistemi_edificio":8,"comando.contattori_rele":18,
      "manovra.sezionatori":3,"misura.strumenti_di_misura":8,"prese.prese_industriali":39,
      "protezione.differenziali_puri":4,"protezione.fusibili":45,"protezione.limitatori_sovratensione":30,
      "protezione.portafusibili":2,
    });
    expect(Object.values(packages).reduce((sum,n)=>sum+n,0)).toBe(160);
    const categoryOf=(identity:string)=>{
      const [marchio,code]=identity.split(":");
      return db.prepare(`SELECT c.code FROM cat_product p JOIN cat_brand b ON b.id=p.brand_id
        JOIN cat_category c ON c.id=p.category_id WHERE b.metel_marchio=? AND p.manufacturer_code=?`).pluck().get(marchio,code);
    };
    // The nine Modulari/Supervisione identities, plus the Supervisione-only IF4C001, by function.
    for(const identity of ["BTI:F21DM63N","BTI:F41DM63N","BTI:F41DM125","IMS:CE4DF3MTCL1","IMS:CE2DF3DTMID","IMS:CE6DMID56"])
      expect(categoryOf(identity),identity).toBe("misura.contatori_energia");
    for(const identity of ["BTI:F4N200","IMS:MFD4421"]) expect(categoryOf(identity),identity).toBe("misura.strumenti_di_misura");
    for(const identity of ["BTI:F4CON12","IMS:IF4C001"]) expect(categoryOf(identity),identity).toBe("supervisione.supervisione_impianto");
    // CTX3 + MPX assemblies contribute their MPX motor-protector primary's category.
    expect(db.prepare(`SELECT DISTINCT c.code FROM cat_config_model m JOIN cat_category c ON c.id=m.category_id
      WHERE m.name LIKE '%+ MPX'`).pluck().all()).toEqual(["protezione.salvamotori"]);
    // Stage D categories are low-data: no stored technical value of any source.
    expect(db.prepare(`SELECT COUNT(*) FROM cat_product_attribute pa JOIN cat_product p ON p.id=pa.product_id
      JOIN cat_category c ON c.id=p.category_id JOIN cat_category r ON r.id=c.parent_id
      WHERE r.code IN ('comando','misura','alimentazione','accessori','supervisione','automazione','prese')`).pluck().get()).toBe(0);
    // A.4 coverage: every active option value of every classified model is mapped or explicitly excluded.
    const covered=new Set([...seed.values,...seed.notApplicable.filter(v=>v.dimension)].map(v=>`${v.dimension}/${v.value}`));
    const used=db.prepare(`SELECT DISTINCT d.code||'/'||v.code FROM cat_config_option o JOIN cat_config_axis a ON a.id=o.axis_id
      JOIN cat_config_model m ON m.id=a.model_id AND m.category_source='seed'
      JOIN cat_config_dimension_value v ON v.id=o.value_id AND v.active=1
      JOIN cat_config_dimension d ON d.id=v.dimension_id WHERE o.active=1`).pluck().all() as string[];
    expect(used.length).toBeGreaterThan(900);
    expect(used.filter(key=>!covered.has(key))).toEqual([]);
    expect(new Set(seed.notApplicable.map(v=>v.reason)).has("")).toBe(false);
  });

  it("Stage E assigns trip-unit types only from explicit evidence",()=>{
    const counts=Object.fromEntries(db.prepare(`SELECT o.value,COUNT(*) FROM cat_product_attribute pa
      JOIN cat_attribute a ON a.id=pa.attribute_id AND a.code='trip_unit_type'
      JOIN cat_attribute_option o ON o.id=pa.option_id GROUP BY o.value`).raw().all() as Array<[string,number]>);
    expect(counts).toEqual({thermomagnetic:386,electronic:160,magnetic_only:110,
      electronic_li:50,electronic_lsi:38,electronic_lsig:38});
    const unit=(code:string)=>db.prepare(`SELECT o.value FROM cat_product_attribute pa JOIN cat_product p ON p.id=pa.product_id
      JOIN cat_attribute a ON a.id=pa.attribute_id AND a.code='trip_unit_type'
      JOIN cat_attribute_option o ON o.id=pa.option_id WHERE p.manufacturer_code=?`).pluck().get(code);
    expect(unit("T744F250")).toBe("thermomagnetic");
    expect(unit("T714B100D")).toBe("thermomagnetic");
    expect(unit("T723B100E")).toBe("electronic");
    expect(unit("T733F100MP")).toBe("magnetic_only");
    expect(unit("T743F250EB")).toBe("electronic_li");
    expect(unit("T743L250M")).toBe("electronic_lsi");
    expect(unit("T743L250MT")).toBe("electronic_lsig");
    // ACB "Mgt" and DMX3 labels give no trip-unit evidence; Icu is also withheld for DMX3.
    expect(db.prepare(`SELECT COUNT(*) FROM cat_product_attribute pa JOIN cat_product p ON p.id=pa.product_id
      JOIN cat_category c ON c.id=p.category_id JOIN cat_attribute a ON a.id=pa.attribute_id
      WHERE c.code='protezione.interruttori_aperti' AND a.code='trip_unit_type'`).pluck().get()).toBe(0);
    expect(unit("T804B1000")).toBeUndefined();
    expect(db.prepare(`SELECT COUNT(*) FROM cat_product_attribute pa JOIN cat_product p ON p.id=pa.product_id
      JOIN cat_config_model_entry e ON e.product_id=p.id JOIN cat_config_model m ON m.id=e.model_id
      JOIN cat_attribute a ON a.id=pa.attribute_id
      WHERE m.name LIKE 'DMX3 %' AND a.code='rated_ultimate_breaking_capacity'`).pluck().get()).toBe(0);
    // Facet at the Interruttori scatolati group, and a combined filter.
    const group=db.prepare(`SELECT id FROM cat_range_node WHERE code='tq.group.3.interruttori_scatolati'`).pluck().get() as number;
    const browse=browseCatalogue(db,{nodeId:group,attributeFilters:[{attributeCode:"trip_unit_type",values:["electronic_lsig"]},
      {attributeCode:"poles",values:["4p"]}]});
    expect(browse.totalCount).toBeGreaterThan(0);
    expect(browse.products.every(p=>p.attributes.some(a=>a.code==="trip_unit_type"))).toBe(true);
  });

  it("Stage F computes feasible package offers with reproducible witnesses",()=>{
    const states=db.prepare(`SELECT c.code AS category,COUNT(*) AS n,SUM(s.candidates) AS candidates,SUM(s.feasible) AS feasible,
      SUM(s.infeasible) AS infeasible,SUM(s.undecided) AS undecided,SUM(s.resolutions) AS resolutions,
      GROUP_CONCAT(DISTINCT s.status) AS statuses FROM cat_config_model_offer_state s
      JOIN cat_config_model m ON m.id=s.model_id JOIN cat_category c ON c.id=m.category_id GROUP BY c.code ORDER BY c.code`).all();
    // Only categories with a mapped applicable attribute get offers; every other package stays listed unfiltered.
    expect(states).toEqual([
      {category:"manovra.sezionatori",n:3,candidates:6,feasible:6,infeasible:0,undecided:0,resolutions:6,statuses:"complete"},
      {category:"protezione.differenziali_puri",n:4,candidates:8,feasible:8,infeasible:0,undecided:0,resolutions:8,statuses:"complete"},
      {category:"protezione.fusibili",n:45,candidates:250,feasible:250,infeasible:0,undecided:0,resolutions:250,statuses:"complete"},
    ]);
    expect(db.prepare(`SELECT COUNT(*) FROM cat_config_model_offer WHERE status<>'feasible'`).pluck().get()).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) FROM cat_source_conflict WHERE topic IN
      ('derived.offer_undecided','derived.offer_value_conflict','derived.offers_unavailable')`).pluck().get()).toBe(0);
    // Every stored witness maps back through stable codes to one option set that re-resolves as addable
    // with the stored fingerprint and values (offerSelection checks all three).
    const offers=db.prepare(`SELECT model_id AS modelId,offer_no AS offerNo FROM cat_config_model_offer`).all() as
      Array<{modelId:number;offerNo:number}>;
    expect(offers).toHaveLength(264);
    for(const offer of offers){
      const witness=offerSelection(db,offer.modelId,offer.offerNo);
      expect(witness.status,`${offer.modelId}/${offer.offerNo}`).toBe("ready");
      expect(configuredItemAddable(resolveConfiguration(db,{modelId:offer.modelId,
        selectedOptionIds:(witness as {selectedOptionIds:number[]}).selectedOptionIds}))).toBe(true);
    }
    // The packages above the 4,096 search bound are decided at defaults for both Taratura values.
    const currents=(code:string)=>db.prepare(`SELECT DISTINCT v.value_num FROM cat_config_model_offer_value v
      JOIN cat_config_model m ON m.id=v.model_id JOIN cat_attribute a ON a.id=v.attribute_id AND a.code='rated_current'
      WHERE m.code=? ORDER BY 1`).pluck().all(code);
    for(const code of ["tq.pack.4580","tq.pack.4581","tq.pack.4582"]) expect(currents(code),code).toEqual([125,160]);
    for(const code of ["tq.pack.14754","tq.pack.14755","tq.pack.14756","tq.pack.14757"]) expect(currents(code),code).toEqual([40,63]);
    // Type-B RCCB offers combine the selected Taratura with the reviewed model facts.
    const modular=db.prepare(`SELECT id FROM cat_range_node WHERE code='tq.group.3.dispositivi_modulari'`).pluck().get() as number;
    const typeB=browseCatalogue(db,{nodeId:modular,attributeFilters:[{attributeCode:"residual_current_type",values:["b"]},
      {attributeCode:"rated_residual_current",values:[30]},{attributeCode:"rated_current",values:[63]},{attributeCode:"poles",values:["4p"]}]});
    expect([typeB.totalCount,typeB.packages.map(p=>p.name)]).toEqual([0,['Diff. puro Tipo "B" 30mA - 4 Poli']]);
    expect(typeB.undecidedPackages).toEqual([]);
  });

  it("Stage F filters, opens and adds a Fusibili package on its witness",async()=>{
    const fusibili=db.prepare(`SELECT id FROM cat_range_node WHERE code='tq.group.3.fusibili'`).pluck().get() as number;
    const plain=browseCatalogue(db,{nodeId:fusibili});
    expect(plain.packageCount).toBe(45);
    const filtered=browseCatalogue(db,{nodeId:fusibili,attributeFilters:[{attributeCode:"rated_current",values:[16]}]});
    expect(filtered.packageCount).toBe(15);
    expect(filtered.packageOffersStale).toBe(false);
    const facet=filtered.facets.attributes.find(a=>a.code==="rated_current")!;
    expect(facet.applicable).toBe(true);
    // Persistent options: the Apparecchi root and this branch offer the same In values.
    const root=db.prepare(`SELECT id FROM cat_range_node WHERE code='tq.system.3'`).pluck().get() as number;
    expect(facet.values.map(v=>v.value)).toEqual(browseCatalogue(db,{nodeId:root}).facets.attributes
      .find(a=>a.code==="rated_current")!.values.map(v=>v.value));
    const modelId=db.prepare(`SELECT id FROM cat_config_model WHERE code='tq.pack.2244'`).pluck().get() as number;
    const item=filtered.packages.find(p=>p.modelId===modelId)!;
    expect(item.name).toBe("Fusibili 10,3x38 mm - 1 Polo");
    const witness=offerSelection(db,modelId,item.offerNo!);
    expect(witness.status).toBe("ready");
    const request={modelId,selectedOptionIds:(witness as {selectedOptionIds:number[]}).selectedOptionIds};
    const resolved=resolveConfiguration(db,request);
    expect(resolved.model.axes.flatMap(axis=>axis.options.filter(option=>resolved.selectedOptionIds.includes(option.id)))
      .map(option=>option.label)).toContain("16 A - Tipo gG");
    const projectRoot=mkdtempSync(path.join(tmpdir(),"lqp-real-offer-"));
    try{
      const service=new ProjectDocumentService({workingDirectory:path.join(projectRoot,"working"),
        incomingDirectory:path.join(projectRoot,"incoming"),backupDirectory:path.join(projectRoot,"backups"),
        migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
        resolveCatalogueProduct:id=>getCatalogueProductSnapshot(db,id),resolveConfiguration:r=>resolveConfiguration(db,r)});
      await service.create({destinationPath:path.join(projectRoot,"offer.lqp"),title:"Offerta",description:"",notes:"",
        projectType:"industrial",executor:"",date:"2026-10-21",companyName:"Cliente",companyDescription:""});
      const view=service.addConfiguredItem(request,1);
      expect(view.configuredItems).toHaveLength(1);
      expect(view.configuredItems[0]!.configFingerprint).toBe(resolved.fingerprint);
      service.close();
    }finally{rmSync(projectRoot,{recursive:true,force:true});}
  },30_000);

  it("Stage F leaves ineligible packages unevaluated, listed unfiltered and never matched",()=>{
    const devices=db.prepare(`SELECT m.id,m.code,c.code AS category,
        EXISTS(SELECT 1 FROM cat_category_attribute ca WHERE ca.category_id=m.category_id) AS linked,
        EXISTS(SELECT 1 FROM cat_config_model_offer_state s WHERE s.model_id=m.id) AS state,
        EXISTS(SELECT 1 FROM cat_config_model_offer o WHERE o.model_id=m.id) AS offer
      FROM cat_config_model m LEFT JOIN cat_category c ON c.id=m.category_id
      WHERE m.model_kind='device' AND ${SELECTABLE_PACKAGE_SQL} ORDER BY m.id`).all() as
      Array<{id:number;code:string;category:string;linked:number;state:number;offer:number}>;
    expect(devices).toHaveLength(160);
    const evaluated=devices.filter(row=>row.state);
    expect(evaluated).toHaveLength(52);
    expect(evaluated.every(row=>row.offer)).toBe(true);
    const ineligible=devices.filter(row=>!row.state);
    expect(ineligible).toHaveLength(108);
    expect(ineligible.some(row=>row.offer)).toBe(false);
    // Attribute-less categories never acquire offers; the two fuse-holder packages are in the poles-only
    // category, but neither their own option values nor their facts carry poles.
    expect(ineligible.filter(row=>row.linked).map(row=>[row.code,row.category])).toEqual([
      ["tq.pack.1788","protezione.portafusibili"],["tq.pack.1802","protezione.portafusibili"]]);
    // The unresolved Axolute pack 3836 joins the seven existing incomplete packages.
    // These stay unaddable, unevaluated and listed without filters.
    const incomplete=["tq.pack.3834","tq.pack.3835","tq.pack.3836","tq.pack.3837","tq.pack.8783","tq.pack.8784","tq.pack.8793","tq.pack.8794"];
    const byCode=new Map(devices.map(row=>[row.code,row]));
    for(const code of incomplete){
      const row=byCode.get(code)!;
      expect(row.state,code).toBe(0);
      const resolved=resolveConfiguration(db,{modelId:row.id,selectedOptionIds:[]});
      expect([resolved.status,configuredItemAddable(resolved)],code).toEqual(["bom_incomplete",false]);
    }
    expect(devices.filter(row=>!configuredItemAddable(resolveConfiguration(db,{modelId:row.id,selectedOptionIds:[]})))
      .map(row=>row.code)).toEqual(incomplete);
    const root=db.prepare(`SELECT id FROM cat_range_node WHERE code='tq.system.3'`).pluck().get() as number;
    const listed=new Set(browseCatalogue(db,{nodeId:root}).packages.map(p=>p.modelId));
    for(const row of ineligible) expect(listed.has(row.id),row.code).toBe(true);
    // Every In value any offer carries: exactly the 52 evaluated packages match, none of the others.
    const currents=db.prepare(`SELECT DISTINCT v.value_num FROM cat_config_model_offer_value v
      JOIN cat_attribute a ON a.id=v.attribute_id AND a.code='rated_current' ORDER BY 1`).pluck().all() as number[];
    const filtered=browseCatalogue(db,{nodeId:root,attributeFilters:[{attributeCode:"rated_current",values:currents}]});
    expect(filtered.packageCount).toBe(52);
    expect(filtered.packages.map(p=>p.modelId).sort((a,b)=>a-b)).toEqual(evaluated.map(row=>row.id));
    expect(filtered.undecidedPackages).toEqual([]);
  },60_000);

  it("Stage F fails closed on stale engineering data and recovers on a current import",()=>{
    const offerTables=()=>({
      offers:db.prepare("SELECT * FROM cat_config_model_offer ORDER BY model_id,offer_no").all(),
      selections:db.prepare("SELECT * FROM cat_config_model_offer_selection ORDER BY model_id,offer_no,value_id").all(),
      values:db.prepare("SELECT * FROM cat_config_model_offer_value ORDER BY model_id,offer_no,attribute_id").all(),
      states:db.prepare("SELECT * FROM cat_config_model_offer_state ORDER BY model_id").all(),
    });
    const before=offerTables();
    const fusibili=db.prepare(`SELECT id FROM cat_range_node WHERE code='tq.group.3.fusibili'`).pluck().get() as number;
    const filter=[{attributeCode:"rated_current",values:[16]}];
    const unavailable=()=>db.prepare(`SELECT COUNT(*) FROM cat_source_conflict WHERE topic='derived.offers_unavailable'`).pluck().get();
    const importId=db.prepare(`SELECT id FROM app_source_import WHERE adapter_code='tiquadri' AND became_current=1`).pluck().get() as number;
    const installed=TIQUADRI_ENGINEERING_ADAPTER.version;
    try{
      // An older installed interpretation: the derivation chain METEL normalization runs still completes.
      db.prepare("UPDATE app_source_import SET adapter_version=? WHERE id=?").run(String(Number(installed)-1),importId);
      expect(()=>db.transaction(()=>synchronizeDerivedCatalogue(db,{categorySeed:loadCategorySeed(),
        attributeSeed:loadAttributeSeed()}))()).not.toThrow();
      expect(db.prepare("SELECT COUNT(*) FROM cat_config_model_offer").pluck().get()).toBe(0);
      expect(unavailable()).toBe(52);
      expect(browseCatalogue(db,{nodeId:fusibili})).toMatchObject({packageCount:45,packageOffersStale:false});
      expect(browseCatalogue(db,{nodeId:fusibili,attributeFilters:filter}))
        .toMatchObject({packageCount:0,packages:[],undecidedPackages:[],packageOffersStale:true});
      const fuse=db.prepare(`SELECT id FROM cat_config_model WHERE code='tq.pack.2244'`).pluck().get() as number;
      expect(offerSelection(db,fuse,0)).toEqual({status:"offer_stale"});
      // Current again: offers return unchanged.
      db.prepare("UPDATE app_source_import SET adapter_version=? WHERE id=?").run(installed,importId);
      expect(synchronizePackageOffers(db)).toMatchObject({recomputed:true,unavailable:0,feasible:264});
      expect(offerTables()).toEqual(before);
      expect(unavailable()).toBe(0);
      // A newer running adapter invalidates every offer with no catalogue change, then recovers.
      expect(synchronizePackageOffers(db,{adapters:[{code:"tiquadri",version:String(Number(installed)+1)}]}))
        .toMatchObject({recomputed:true,unavailable:52,feasible:0});
      expect(browseCatalogue(db,{nodeId:fusibili,attributeFilters:filter}).packageCount).toBe(0);
      expect(synchronizePackageOffers(db)).toMatchObject({recomputed:true,unavailable:0});
      expect(offerTables()).toEqual(before);
    }finally{
      db.prepare("UPDATE app_source_import SET adapter_version=? WHERE id=?").run(installed,importId);
      synchronizePackageOffers(db);
    }
  },120_000);

  it("Stage C A.7 article facets use the stored values",()=>{
    const node=(code:string)=>{
      const row=one(`SELECT id FROM cat_range_node WHERE code=?`,code);
      expect(row,code).toBeDefined();return row!["id"] as number;
    };
    const m2=node("tq.g1.563");
    const magneto=one(`SELECT id FROM cat_range_node WHERE parent_id=? AND name='Magnetotermici'`,m2);
    expect(magneto).toBeDefined();
    const browse=(nodeId:number,attributeFilters:ReadonlyArray<{attributeCode:string;values:readonly (string|number)[]}>=[])=>
      browseCatalogue(db,{nodeId,attributeFilters});
    const base=browse(magneto!["id"] as number);
    const counts=(code:string)=>Object.fromEntries(base.facets.attributes.find(a=>a.code===code)!.values.map(v=>[v.value,v.count]));
    expect(counts("poles")).toMatchObject({"3p":48,"4p":48});
    expect(counts("rated_current")).toMatchObject({"40":24,"100":24,"160":24,"250":24});
    expect(counts("rated_ultimate_breaking_capacity")).toMatchObject({"25":32,"36":32,"70":32});
    const filtered=browse(magneto!["id"] as number,[{attributeCode:"poles",values:["3p"]},
      {attributeCode:"rated_current",values:[100]},
      {attributeCode:"rated_ultimate_breaking_capacity",values:[25]}]);
    expect(filtered.products.map(p=>p.manufacturerCode).sort()).toEqual(["T723B100E","T723B100M","T723B100T","T723B100MT"].sort());
    expect(browse(node("tq.group.3.interruttori_scatolati"),[{attributeCode:"poles",values:["4p"]},
      {attributeCode:"rated_current",values:[250]},
      {attributeCode:"rated_ultimate_breaking_capacity",values:[36]}]).totalCount).toBe(14);
    expect(browse(node("tq.group.3.dispositivi_modulari"),[{attributeCode:"poles",values:["2p"]},
      {attributeCode:"residual_current_type",values:["ac"]},
      {attributeCode:"rated_residual_current",values:[30]},
      {attributeCode:"rated_current",values:[40]}]).products.map(p=>p.manufacturerCode).sort())
      .toEqual(["G723AC40","G723AC40H","GC723AC40","GN823AC40"].sort());
  });

  it("reconciles every primary source measure and preserves provenance",()=>{
    const summary=result.summary;
    expect(summary.discrepancies).toEqual([]);
    expect(summary.counts).toMatchObject({activeModels:7823,obsoleteModels:2977,
      axes:10769,options:51307,rules:48609,articleEffectSourceRows:90950,
      articleEffectsAggregated:60830,baseArticleSourceRows:10714,
      baseArticlesAggregated:8923,deviceProfiles:6507,supportProfiles:1689,
      activeEnclosuresWithGeometry:595,activeEnclosuresWithoutGeometry:9,
      acceptSets:492,devicePanelAcceptSets:380,deviceEnclosureAcceptSets:53,
      panelEnclosureAcceptSets:59,distinctConcreteArticles:4718,devicePanelPairs:479707,
      deviceEnclosurePairs:173829,panelEnclosurePairs:6576,
      dinZones:220,slotPanels:1052,slotZones:1052,internalRailZones:36,
      blindPanels:367});
    expect(summary.hierarchy).toMatchObject({assignments:10800});
    expect(summary.physicalAudit).toMatchObject({singleOptionNoProfile:76,orphanEnclosureClasses:5});
    expect(summary.moduleComparison).toMatchObject({dinModuleConflicts:18});
    expect(summary.secondaryDiscrepancies).toEqual(expect.arrayContaining([
      expect.objectContaining({measure:"unresolvedBTBeforeCrossBrand",actual:174,reference:145}),
      expect.objectContaining({measure:"dinModuleConflicts",actual:18,reference:17}),
    ]));
    expect(summary.conflicts).toMatchObject({
      range_name_copy_disagrees:256,orphan_range_name_copy_disagrees:190,
    });
    expect(summary.skipped).toMatchObject({
      context_macrofamiglia_armadi_unapplied:{count:58},
      context_class_without_structure_unapplied:{count:1124},
    });
    expect(summary.counts).toMatchObject({sourceArticleFreePacks:91,
      approvedPhysicalOnlyModels:14,contributionReviewCandidates:77});
    expect(summary.factoryPresetModels).toBe(23);
    expect(one("SELECT COUNT(*) n FROM cat_config_model WHERE commercial_contribution='none'")).toEqual({n:37});
    expect(one("SELECT code,name FROM cat_config_model WHERE code='tq.pack.1778' AND commercial_contribution='none'"))
      .toEqual({code:"tq.pack.1778",name:"Din generico - Solo spazio"});
    // Adapter 9: the executable's falso-polo pack is the one designated DIN filler, all 20 half-module widths.
    expect(summary.capacityFillers).toEqual({designated:1,rejected:0,
      widths:{"tq.pack.1777":Array.from({length:20},(_,index)=>index+1)}});
    expect(db.prepare(`SELECT m.code,m.name,f.capacity_kind_code AS kind,f.source,f.source_ref AS ref
      FROM cat_config_capacity_filler f JOIN cat_config_model m ON m.id=f.model_id`).all())
      .toEqual([{code:"tq.pack.1777",name:"Falsi polo",kind:"din_rail",source:"import",ref:"TiQuadri ANA_PACK 1777"}]);
    expect(one("SELECT file_sha256,byte_size FROM app_source_import_file WHERE import_id=? AND role='master'",result.importId))
      .toMatchObject({byte_size:45862912});
    expect(one("SELECT COUNT(*) n FROM cat_asset")).toEqual({n:0});
    console.log("Navigation import evidence:",JSON.stringify({
      conflicts:Object.fromEntries(Object.entries(summary.conflicts as Record<string,unknown>).filter(([key])=>
        key.includes("range_name")||key.includes("hierarchy_parent"))),
      context:Object.fromEntries(Object.entries(summary.skipped as Record<string,unknown>).filter(([key])=>
        key.startsWith("context_"))),
    }));
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it.each([
    ["tq.pack.2026", "16 A", "T/16"],
    ["tq.pack.3218", undefined, "C9250F/6"],
  ])("refuses a punctuation-colliding BTicino substitute in %s", (code, optionLabel, reference) => {
    const modelId = db.prepare("SELECT id FROM cat_config_model WHERE code=?").pluck().get(code) as number;
    const option = getConfigurationModel(db, modelId).axes.flatMap(axis => axis.options)
      .find(candidate => candidate.label === optionLabel);
    if (optionLabel) expect(option).toBeDefined();
    const resolution = resolveConfiguration(db, { modelId, selectedOptionIds: option ? [option.id] : [] });
    expect(resolution.status).toBe("complete");
    expect(resolution.bom.find(row => row.manufacturerCode === reference)).toMatchObject({
      linkedBrandMarchio: "BTI", linkedManufacturerCode: reference,
    });
    expect(configuredItemAddable(resolution)).toBe(true);
  });

  it("keeps an Axolute video-display choice from quoting an unrelated Legrand cable channel", () => {
    const modelId = db.prepare("SELECT id FROM cat_config_model WHERE code='tq.pack.3836'").pluck().get() as number;
    const option = getConfigurationModel(db, modelId).axes.flatMap(axis => axis.options)
      .find(candidate => candidate.label === "Axolute Chiara")!;
    const resolution = resolveConfiguration(db, { modelId, selectedOptionIds: [option.id] });
    expect(resolution.status).toBe("bom_incomplete");
    expect(resolution.bom.find(row => row.manufacturerCode === "349311")).toMatchObject({ productId: null });
    expect(configuredItemAddable(resolution)).toBe(false);
  });

  it("accounts for the raw content flag without importing a placement binding",()=>{
    expect(result.summary.source).toMatchObject({adapterVersion:TIQUADRI_ENGINEERING_ADAPTER.version});
    expect(readEngineeringReadiness(db).sources[0]).toMatchObject({status:"ready",
      installedVersion:TIQUADRI_ENGINEERING_ADAPTER.version,requiredVersion:TIQUADRI_ENGINEERING_ADAPTER.version});
    expect(result.summary.skipped).toMatchObject({
      content_compatibility_flag_unapplied:{count:1123},
    });
    expect(one(`SELECT COUNT(*) n FROM cat_config_axis a JOIN cat_config_model m ON m.id=a.model_id
      WHERE m.code LIKE 'tq.pack.%' AND a.binding='match_container'`)).toEqual({n:0});
    const paired=one(`SELECT s.binding AS support_binding, sv.code AS support_value,
      d.binding AS device_binding, dv.code AS device_value
      FROM cat_config_model sm JOIN cat_config_axis s ON s.model_id=sm.id
      JOIN cat_config_dimension sd ON sd.id=s.dimension_id
      JOIN cat_config_option so ON so.axis_id=s.id JOIN cat_config_dimension_value sv ON sv.id=so.value_id
      JOIN cat_config_model dm ON dm.code='tq.pack.4395'
      JOIN cat_config_axis d ON d.model_id=dm.id AND d.dimension_id=s.dimension_id
      JOIN cat_config_option deo ON deo.axis_id=d.id
      JOIN cat_config_dimension_value dv ON dv.id=deo.value_id
      WHERE sm.code='tq.pack.598' AND sd.code='tq.label.54'
        AND sv.code='tq.value.302' AND dv.code='tq.value.231'`);
    expect(paired).toEqual({support_binding:"none",support_value:"tq.value.302",
      device_binding:"none",device_value:"tq.value.231"});
    expect(one(`SELECT COUNT(*) n FROM cat_config_model m
      JOIN cat_phys_profile p ON p.id=m.base_profile_id
      JOIN cat_phys_constraint c ON c.profile_id=p.id AND c.relation='parent'
      JOIN cat_phys_accept_set_member am ON am.set_id=c.accept_set_id
      JOIN cat_phys_class k ON k.id=am.class_id
      WHERE m.code='tq.pack.4395' AND k.code='tq.pan.8291'`)).toEqual({n:1});
  });

  it("imports BTDIN60 Taratura, expanded FN82C16 and its catalogue entry",()=>{
    const model=one("SELECT id,base_profile_id FROM cat_config_model WHERE code='tq.pack.4395'")!;
    expect(model.base_profile_id).toBeTypeOf("number");
    expect(one(`SELECT COUNT(*) n FROM cat_config_option o JOIN cat_config_axis a ON a.id=o.axis_id
      JOIN cat_config_dimension d ON d.id=a.dimension_id JOIN cat_config_model m ON m.id=a.model_id
      WHERE m.id=? AND d.name='Taratura'`,model.id)).toMatchObject({n:14});
    expect(one(`SELECT COUNT(*) n FROM cat_config_option o JOIN cat_config_axis a ON a.id=o.axis_id
      JOIN cat_config_dimension d ON d.id=a.dimension_id JOIN cat_config_model m ON m.id=a.model_id
      WHERE m.id=? AND d.name='Taratura' AND o.is_default=1`,model.id)).toEqual({n:1});
    expect(one(`SELECT COUNT(*) n FROM cat_config_rule_effect e JOIN cat_config_rule r ON r.id=e.rule_id
      WHERE r.model_id=? AND e.ref_manufacturer_code='FN82C16' AND e.article_role='primary'`,model.id))
      .toEqual({n:1});
    expect(one(`SELECT COUNT(*) n FROM cat_config_model_entry e JOIN cat_product p ON p.id=e.product_id
      JOIN cat_config_model m ON m.id=e.model_id WHERE m.id=? AND p.manufacturer_code='FN82C16'`,model.id))
      .toEqual({n:1});
  });

  it("keeps accessory article and physical offset on the same source rule",()=>{
    const rule=one(`SELECT r.id FROM cat_config_model m JOIN cat_config_rule r ON r.model_id=m.id
      JOIN cat_config_rule_effect e ON e.rule_id=r.id
      WHERE m.code='tq.pack.4395' AND e.ref_manufacturer_code='F80RC' LIMIT 1`)!;
    expect(one(`SELECT int_value FROM cat_config_rule_effect WHERE rule_id=?
      AND effect_kind='profile_key_delta'`,rule.id)).toEqual({int_value:2});
    expect(one(`SELECT d.amount FROM cat_phys_profile p JOIN cat_phys_profile_demand d ON d.profile_id=p.id
      WHERE p.code='tq.app.16402' AND d.capacity_kind_code='din_rail'`)).toEqual({amount:6});
  });

  it("browses the imported hierarchy, catalogue entries and real model options",()=>{
    const nodes=browseRangeNodes(db);
    expect(nodes.length).toBeGreaterThan(100);
    expect(nodes.some(node=>node.parentId!==null)).toBe(true);
    const reachable=one(`SELECT COUNT(DISTINCT m.id) AS n FROM cat_config_model m
      JOIN cat_range_node_model nm ON nm.model_id=m.id JOIN cat_range_node n ON n.id=nm.node_id
      WHERE m.active=1 AND m.obsolete=0 AND n.active=1`)!;
    expect(reachable.n).toBe(7823);
    console.log("Configura active models reachable:",reachable.n);
    const assigned=one(`SELECT node_id AS id FROM cat_range_node_model LIMIT 1`)!;
    expect(listNodeModels(db,assigned.id as number).length).toBeGreaterThan(0);
    const product=one(`SELECT p.id FROM cat_product p JOIN cat_config_model_entry e ON e.product_id=p.id
      JOIN cat_config_model m ON m.id=e.model_id WHERE p.manufacturer_code='FN82C16'
      AND m.code='tq.pack.4395' LIMIT 1`)!;
    expect(listProductModels(db,product.id as number).some(m=>m.code==='tq.pack.4395')).toBe(true);
    const modelId=one(`SELECT id FROM cat_config_model WHERE code='tq.pack.4395'`)!.id as number;
    const model=getConfigurationModel(db,modelId);
    expect(model.axes.some(a=>a.options.some(o=>o.isDefault))).toBe(true);
    expect(model.axes.flatMap(a=>a.options).length).toBeGreaterThan(14);
  });

  it("navigates source levels, models and concrete articles without inferred FST positions",()=>{
    const nodes=browseManufacturerNodes(db);
    const byCode=new Map(nodes.map(node=>[node.code,node]));
    const trace=(range:number,klass:number,pack:number,article:string,category:string)=>{
      const family=byCode.get(`tq.range.${range}.class.${klass}`)!;
      expect(family).toBeDefined();
      expect(family.levelLabel).toBe("Famiglia");
      const models=listManufacturerModels(db,family.id);
      const model=models.find(item=>item.code===`tq.pack.${pack}`)!;
      expect(model).toBeDefined();
      const articles=listManufacturerArticles(db,{modelId:model.id,limit:200});
      expect(articles.map(item=>item.manufacturerCode)).toContain(article);
      expect(listManufacturerArticles(db,{nodeId:family.id,limit:200})
        .map(item=>item.manufacturerCode)).toContain(article);
      const product=articles.find(item=>item.manufacturerCode===article)!;
      const positions=manufacturerPositions(db,product.id);
      expect(positions.some(position=>position.nodeId===family.id&&position.modelId===model.id))
        .toBe(true);
      expect(positions.every(position=>position.source==="import")).toBe(true);
      const path:string[]=[];
      for(let current:typeof family|undefined=family;current;current=current.parentId===null?undefined:
        nodes.find(node=>node.id===current.parentId)!)path.unshift(current.name);
      expect(path.slice(0,2)).toEqual(["Apparecchi",category]);
      console.log("Manufacturer path:",JSON.stringify({path,model:model.name,article}));
    };
    trace(5991,59911,4395,"FN82C16","Dispositivi modulari");
    trace(5301,53011,31411,"T754N800","Interruttori scatolati");
    trace(5901,59012,1550,"T7814WF800B","Sezionatori con maniglia");
    trace(7411,74112,2356,"F411/4","Automazione");
    expect(nodes.filter(node=>node.parentId===null&&node.source==="import")
      .map(node=>node.name)).toEqual(["Apparecchi"]);
    expect(browseRangeNodes(db).filter(node=>node.parentId===null).map(node=>node.name))
      .toEqual(expect.arrayContaining(["Apparecchi","Carpenterie","Pannelli"]));
    expect(byCode.has("tq.range.5991")).toBe(false);
    expect(byCode.get("tq.g2.5991")?.name).toBe("Magnetotermici");
    expect(one(`SELECT n.code AS code FROM cat_range_node c JOIN cat_range_node n
      ON n.id=c.parent_id WHERE c.code LIKE 'tq.range.5155.class.%' LIMIT 1`))
      .toEqual({code:"tq.g3.5155"});
    expect(one(`SELECT COUNT(*) n FROM cat_range_node WHERE code LIKE 'tq.orphan.range.%'`)).toEqual({n:44});
    expect(one(`SELECT COUNT(*) n FROM cat_range_node WHERE code LIKE 'tq.orphan.range.%'
      AND parent_id IS NOT NULL AND navigable=0`)).toEqual({n:43});
    expect(byCode.has("tq.orphan.range.99999")).toBe(false);
    const fn=one(`SELECT id FROM cat_product WHERE manufacturer_code='FN82C16'`)!;
    expect(manufacturerPositions(db,fn.id as number).filter(position=>position.source==="import").length)
      .toBeGreaterThanOrEqual(2);
    const fallback=one(`SELECT p.id,p.manufacturer_code AS code,f.code AS fstCode,
      f.description AS fstDescription FROM cat_product p
      JOIN cat_metel_family f ON f.id=p.statistical_family_id
      WHERE p.manufacturer_code='F460' AND p.governing_issuer_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM cat_config_model_entry e
        JOIN cat_config_model m ON m.id=e.model_id JOIN cat_range_node_model nm ON nm.model_id=m.id
        JOIN cat_range_node n ON n.id=nm.node_id
        WHERE e.product_id=p.id AND m.active=1 AND m.obsolete=0 AND n.active=1 AND n.navigable=1)
      ORDER BY p.id LIMIT 1`)!;
    const fallbackPositions=manufacturerPositions(db,fallback.id as number);
    expect(fallbackPositions.some(position=>position.source==="import")).toBe(false);
    expect(fallbackPositions.some(position=>position.source==="metel")).toBe(true);
    const mixedFamily=one(`SELECT f.id FROM cat_metel_family f WHERE f.code='IME-102-43-124'`)!;
    expect(one(`SELECT COUNT(DISTINCT e.product_id) AS n FROM cat_config_model_entry e
      JOIN cat_config_model m ON m.id=e.model_id JOIN cat_range_node_model nm ON nm.model_id=m.id
      JOIN cat_range_node n ON n.id=nm.node_id JOIN cat_product p ON p.id=e.product_id
      WHERE p.statistical_family_id=? AND m.active=1 AND m.obsolete=0
        AND n.active=1 AND n.navigable=1`,mixedFamily.id)).toEqual({n:7});
    const fstNeighbour=one(`SELECT p.id FROM cat_product p WHERE p.statistical_family_id=?
      AND NOT EXISTS(SELECT 1 FROM cat_config_model_entry e
        JOIN cat_config_model m ON m.id=e.model_id JOIN cat_range_node_model nm ON nm.model_id=m.id
        JOIN cat_range_node n ON n.id=nm.node_id
        WHERE e.product_id=p.id AND m.active=1 AND m.obsolete=0
          AND n.active=1 AND n.navigable=1) LIMIT 1`,mixedFamily.id)!;
    expect(manufacturerPositions(db,fstNeighbour.id as number).map(position=>position.source))
      .toEqual(["metel"]);
    const fstOnly=(code:string,segmentCode:string,segmentName:string)=>{
      const row=one(`SELECT p.id,p.manufacturer_code AS code,f.code AS fstCode,
        f.description AS fstDescription FROM cat_product p JOIN cat_metel_family f
        ON f.id=p.statistical_family_id WHERE p.manufacturer_code=?`,code)!;
      const positions=manufacturerPositions(db,row.id as number);
      expect(positions.map(position=>position.source)).toEqual(["metel"]);
      const fstNode=nodes.find(node=>node.id===positions[0]!.nodeId)!;
      expect(fstNode.levelLabel).toBe("Famiglia statistica");
      const segment=nodes.find(node=>node.id===fstNode.parentId)!;
      expect(segment.code.endsWith(`segment.${segmentCode}`)).toBe(true);
      expect(segment.name).toBe(segmentName);
      const path:string[]=[];
      for(let current:typeof fstNode|undefined=fstNode;current;
        current=current.parentId===null?undefined:nodes.find(node=>node.id===current.parentId))
        path.unshift(current.name);
      console.log("FST-only article:",JSON.stringify({...row,path}));
    };
    fstOnly("F460","CIV.-102","MY HOME DOMOTICA");
    fstOnly("68860N","IND.-112","SISTEMA QUADRO");
    const segmentCounts=one(`SELECT
      (SELECT COUNT(*) FROM cat_metel_family f JOIN cat_metel_issuer i ON i.id=f.issuer_id
        JOIN cat_brand b ON b.id=f.brand_id WHERE i.metel_sigla='BTI'
        AND b.metel_marchio='BTI' AND f.family_type='STATISTICA' AND f.code LIKE 'IND.%') AS indFamilies,
      (SELECT COUNT(*) FROM cat_metel_family f JOIN cat_metel_issuer i ON i.id=f.issuer_id
        JOIN cat_brand b ON b.id=f.brand_id WHERE i.metel_sigla='BTI'
        AND b.metel_marchio='BTI' AND f.family_type='STATISTICA' AND f.code LIKE 'CIV.%') AS civFamilies,
      (SELECT COUNT(DISTINCT n.name) FROM cat_range_node n JOIN cat_brand b ON b.id=n.brand_id
        WHERE b.metel_marchio='BTI' AND n.source_level='fst_segment'
        AND n.code LIKE '%.segment.IND.%') AS indSegments,
      (SELECT COUNT(DISTINCT n.name) FROM cat_range_node n JOIN cat_brand b ON b.id=n.brand_id
        WHERE b.metel_marchio='BTI' AND n.source_level='fst_segment'
        AND n.code LIKE '%.segment.CIV.%') AS civSegments`)!;
    expect(segmentCounts).toMatchObject({indFamilies:67,civFamilies:170});
    expect(segmentCounts.indSegments as number).toBeGreaterThan(1);
    expect(segmentCounts.civSegments as number).toBeGreaterThan(1);
    console.log("FST segment grouping:",JSON.stringify(segmentCounts));
    const coverage=one(`WITH positioned AS (
      SELECT DISTINCT e.product_id FROM cat_config_model_entry e
      JOIN cat_config_model m ON m.id=e.model_id
      JOIN cat_range_node_model nm ON nm.model_id=m.id
      JOIN cat_range_node n ON n.id=nm.node_id
      WHERE m.active=1 AND m.obsolete=0 AND n.active=1 AND n.navigable=1
    ), fallback AS (
      SELECT DISTINCT p.id FROM cat_product p
      JOIN cat_range_node_metel_family nf ON nf.metel_family_id=p.statistical_family_id
      JOIN cat_range_node n ON n.id=nf.node_id
      WHERE n.active=1 AND n.navigable=1
    ) SELECT COUNT(*) AS total,
      SUM(CASE WHEN positioned.product_id IS NOT NULL THEN 1 ELSE 0 END) AS tiquadri,
      SUM(CASE WHEN positioned.product_id IS NULL AND fallback.id IS NOT NULL THEN 1 ELSE 0 END) AS fstOnly,
      SUM(CASE WHEN positioned.product_id IS NULL AND fallback.id IS NULL THEN 1 ELSE 0 END) AS unreachable
      FROM cat_product p LEFT JOIN positioned ON positioned.product_id=p.id
      LEFT JOIN fallback ON fallback.id=p.id`)!;
    expect(coverage.total).toBe(24676);
    expect(coverage.unreachable).toBe(0);
    console.log("Manufacturer coverage:",JSON.stringify(coverage));
  });

  it("groups every approved Apparecchi Gamma under its catalogue category and reports the rest",()=>{
    const summary=result.summary;
    const skipped=summary.skipped as Record<string,{count:number;sampleKeys:string[]}>;
    expect(summary.hierarchy).toMatchObject({groupedNodes:60});
    // The 18 unmapped Gamme are obsolete branches with no active pack.
    expect(skipped.navigation_group_unmapped?.count).toBe(18);
    expect(skipped).not.toHaveProperty("navigation_group_member_missing");
    expect(summary.conflicts).not.toHaveProperty("navigation_group_member_name_disagrees");
    const groups=[...loadRangeNavigationSeed().groups].sort((a,b)=>a.sortOrder-b.sortOrder);
    expect(db.prepare(`SELECT g.name FROM cat_range_node g JOIN cat_range_node s ON s.id=g.parent_id
      WHERE g.source_level='lq_group' AND g.active=1 AND s.code='tq.system.3'
      ORDER BY g.sort_order`).pluck().all()).toEqual(groups.map(group=>group.name));
    const parent=db.prepare(`SELECT p.code FROM cat_range_node n JOIN cat_range_node p ON p.id=n.parent_id
      WHERE n.code=? AND n.active=1`).pluck();
    for(const group of groups)for(const member of group.members)for(const id of member.sourceIds)
      expect(parent.get(`tq.g1.${id}`),`${member.name} ${id}`).toBe(`tq.group.3.${group.code}`);
    expect(parent.get("tq.g1.544")).toBe("tq.group.3.interruttori_scatolati");
    expect(parent.get("tq.g1.803")).toBe("tq.group.3.automazione");
    const children=(nodes:ReadonlyArray<{id:number;parentId:number|null;name:string}>)=>{
      const root=nodes.find(node=>node.parentId===null&&node.name==="Apparecchi")!;
      return nodes.filter(node=>node.parentId===root.id).map(node=>node.name);
    };
    expect(children(browseRangeNodes(db))).toEqual(groups.map(group=>group.name));
    const catalogue=browseManufacturerNodes(db);
    // Every category now holds articles or selectable packages.
    expect(children(catalogue)).toEqual(groups.map(group=>group.name));
    const category=catalogue.find(node=>node.code==="tq.group.3.interruttori_scatolati")!;
    const gamma=catalogue.find(node=>node.code==="tq.g1.542")!;
    expect(gamma).toMatchObject({parentId:category.id,name:"Megatiker M3-250",levelLabel:"Gamma"});
    expect(catalogue.find(node=>node.code==="tq.g1.566")).toMatchObject({parentId:category.id,
      name:"Megatiker DIN M1-160"});
    const browsed=browseCatalogue(db,{nodeId:category.id,query:"T733F100"});
    expect(browsed.products.map(product=>[product.manufacturerCode,product.configurable]))
      .toContainEqual(["T733F100",true]);
    expect(browseCatalogue(db,{nodeId:category.id}).totalCount)
      .toBeGreaterThanOrEqual(browseCatalogue(db,{nodeId:gamma.id}).totalCount);
    console.log("Catalogue Apparecchi categories:",JSON.stringify(catalogue.filter(node=>node.parentId===category.parentId)
      .map(node=>[node.name,browseCatalogue(db,{nodeId:node.id,limit:1}).totalCount])));
  });

  it("exposes the resolvable model-only Apparecchi packs as Catalogo packages and nothing else",async()=>{
    const nodes=browseManufacturerNodes(db);
    const apparecchi=nodes.find(node=>node.parentId===null&&node.name==="Apparecchi")!;
    const all=browseCatalogue(db,{nodeId:apparecchi.id});
    expect(all.packageCount).toBe(160);
    expect(one(`SELECT COUNT(*) n FROM cat_config_model m JOIN cat_range_node_model nm ON nm.model_id=m.id
      JOIN cat_range_node n ON n.id=nm.node_id WHERE n.active=1 AND m.active=1 AND m.obsolete=0
      AND NOT EXISTS(SELECT 1 FROM cat_config_model_entry e WHERE e.model_id=m.id)
      AND n.code LIKE 'tq.range.%' AND n.navigable=1`)).toEqual({n:194});
    const packageIds=new Set(all.packages.map(item=>item.modelId));
    const idOf=(code:string)=>one("SELECT id FROM cat_config_model WHERE code=?",code)!.id as number;
    // Placeholder packs (no source articles) and unlinked references stay out.
    for(const code of ["tq.pack.2298","tq.pack.2307","tq.pack.1778","tq.pack.17900","tq.pack.1799","tq.pack.13400"])
      expect(packageIds.has(idOf(code)),code).toBe(false);
    for(const name of ["Contattori","Contattori con termico","Apparecchi Datacom"])
      expect(nodes.some(node=>node.code.startsWith("tq.g1.")&&node.name===name),name).toBe(false);
    expect(browseRangeNodes(db).filter(node=>["tq.g1.721","tq.g1.731","tq.g1.803"].includes(node.code))
      .map(node=>node.name)).toEqual(["Contattori","Contattori con termico","Apparecchi Datacom"]);
    const fuse=idOf("tq.pack.2245");
    expect(packageIds.has(fuse)).toBe(true);
    const fusibili=nodes.find(node=>node.code==="tq.group.3.fusibili")!;
    const family=nodes.find(node=>node.name==="Fusibili 10,3x38 mm"&&node.kind==="group")!;
    const trail:string[]=[];
    for(let current:typeof family|undefined=family;current;current=current.parentId===null?undefined:
      nodes.find(node=>node.id===current.parentId))trail.unshift(current.name);
    expect(trail).toEqual(["Apparecchi","Fusibili","Fusibili","Fusibili 10,3x38 mm","Fusibili 10,3x38 mm"]);
    expect(all.packages.find(item=>item.modelId===fuse)).toMatchObject({name:"Fusibili 10,3x38 mm - 1 Polo+N",
      brandMarchio:"BTI",kind:"device",groupName:"Fusibili 10,3x38 mm"});
    expect(browseCatalogue(db,{nodeId:fusibili.id})).toMatchObject({totalCount:0,packageCount:45});
    expect(browseCatalogue(db,{nodeId:family.id}).packages.map(item=>item.name)).toEqual([
      "Fusibili 10,3x38 mm - 1 Polo","Fusibili 10,3x38 mm - 1 Polo+N","Fusibili 10,3x38 mm - 2 Poli",
      "Fusibili 10,3x38 mm - 3 Poli","Fusibili 10,3x38 mm - 3 Poli+N"]);
    const model=getConfigurationModel(db,fuse);
    expect(model.axes.map(axis=>axis.label)).toEqual(["Taratura","Esecuzione"]);
    const defaults=resolveConfiguration(db,{modelId:fuse,selectedOptionIds:[]});
    const codes=(result:typeof defaults)=>result.bom.map(row=>`${row.linkedBrandMarchio}:${row.linkedManufacturerCode}`);
    expect(defaults.status).toBe("complete");
    expect(codes(defaults)).toEqual(["LEG:013300","LEG:013325","LEG:021400","LEG:021401","LEG:021696"]);
    expect(defaults.totalE4).toBe(553_579);
    const sixteen=model.axes[0]!.options.find(option=>option.label.startsWith("16 A"))!;
    const changed=resolveConfiguration(db,{modelId:fuse,selectedOptionIds:[sixteen.id]});
    expect(codes(changed)).toEqual(["LEG:013300","LEG:013316","LEG:021400","LEG:021401","LEG:021696"]);
    expect(changed.totalE4).toBe(560_658);
    const catalogueFn=browseCatalogue(db,{nodeId:apparecchi.id,query:"FN82C16"});
    expect(catalogueFn.products.find(item=>item.manufacturerCode==="FN82C16")?.configurable).toBe(true);
    expect(catalogueFn.packages).toEqual([]);
    console.log("Catalogo packages:",JSON.stringify(nodes.filter(node=>node.parentId===apparecchi.id)
      .map(node=>[node.name,browseCatalogue(db,{nodeId:node.id,limit:1}).packageCount])));

    const projectRoot=mkdtempSync(path.join(tmpdir(),"lqp-real-package-"));
    try{
      const filename=path.join(projectRoot,"fusibili.lqp");
      const service=(catalogue:boolean)=>new ProjectDocumentService({workingDirectory:path.join(projectRoot,`working-${catalogue}`),
        incomingDirectory:path.join(projectRoot,`incoming-${catalogue}`),backupDirectory:path.join(projectRoot,"backups"),
        migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
        resolveCatalogueProduct:catalogue?id=>getCatalogueProductSnapshot(db,id):()=>{throw new Error("no catalogue");},
        resolveConfiguration:catalogue?request=>resolveConfiguration(db,request):()=>{throw new Error("no catalogue");}});
      const writer=service(true);
      await writer.create({destinationPath:filename,title:"Fusibili",description:"",notes:"",projectType:"industrial",
        executor:"",date:"2026-09-25",companyName:"Cliente",companyDescription:""});
      const added=writer.addConfiguredItem({modelId:fuse,selectedOptionIds:[sixteen.id]},2);
      expect(added.configuredItems[0]!.bom.map(row=>row.manufacturerCode))
        .toEqual(["013300","013316","021400","021401","021696"]);
      expect(added.lines[0]).toMatchObject({quantity:2,lineTotalE4:560_658*2});
      expect(()=>writer.addConfiguredItem({modelId:idOf("tq.pack.8793"),selectedOptionIds:[]}))
        .toThrow("Solo una configurazione completa");
      await writer.save();writer.close();
      const reopened=service(false).open(filename);
      expect(reopened.configuredItems).toEqual(added.configuredItems);
      expect(reopened.lines).toEqual(added.lines);
      expect(reopened.distinta).toEqual(added.distinta);
    }finally{rmSync(projectRoot,{recursive:true,force:true});}
  },20_000);

  it("resolves, persists and reopens the approved physical-only DIN device",async()=>{
    const modelId=one("SELECT id FROM cat_config_model WHERE code='tq.pack.1778'")!.id as number;
    const model=getConfigurationModel(db,modelId);
    expect(model.commercialContribution).toBe("none");
    const choices=model.axes.flatMap(axis=>axis.options.filter(option=>option.label==="2 moduli"));
    expect(choices).toHaveLength(1);
    const request={modelId,selectedOptionIds:[choices[0]!.id]};
    const resolved=resolveConfiguration(db,request);
    expect(resolved).toMatchObject({status:"complete",commercialContribution:"none",bom:[],totalE4:null});
    expect(resolved.physical?.kind).toBe("device");
    expect(resolved.physical?.demands.find(d=>d.capacityKindCode==="din_rail")?.amount).toBe(4);
    expect(one("SELECT COUNT(*) n FROM cat_config_model_article WHERE model_id=?",modelId)).toEqual({n:0});
    expect(one(`SELECT COUNT(*) n FROM cat_config_rule_effect e JOIN cat_config_rule r ON r.id=e.rule_id
      WHERE r.model_id=? AND e.effect_kind='article'`,modelId)).toEqual({n:0});
    db.exec("SAVEPOINT contribution_conflict");
    try{
      db.prepare(`INSERT INTO cat_config_model_article(model_id,seq,ref_brand_marchio,
        ref_manufacturer_code,quantity,role) VALUES (?,1,'BTI','UNLINKED',1,'primary')`).run(modelId);
      const conflict=resolveConfiguration(db,request);
      expect(conflict.status).toBe("invalid");
      expect(conflict.issues.some(issue=>issue.code==="commercial_contribution_conflict")).toBe(true);
    }finally{db.exec("ROLLBACK TO contribution_conflict; RELEASE contribution_conflict");}
    const folder=mkdtempSync(path.join(tmpdir(),"lqp-physical-only-"));
    try{
      const filename=path.join(folder,"physical.lqp");
      const service=new ProjectDocumentService({workingDirectory:path.join(folder,"working"),
        incomingDirectory:path.join(folder,"incoming"),backupDirectory:path.join(folder,"backups"),
        migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
        resolveConfiguration:input=>resolveConfiguration(db,input),
        resolveCatalogueProduct:()=>{throw new Error("No catalogue article expected")}});
      await service.create({destinationPath:filename,title:"Physical only",description:"",notes:"",
        projectType:"civil",executor:"",date:"2026-09-30",companyName:"Client",companyDescription:""});
      let view=service.addConfiguredItem(request,2);
      expect(view.configuredItems[0]).toMatchObject({commercialContribution:"none",bom:[]});
      expect(view.lines[0]).toMatchObject({quantity:2,commercialContribution:"none",
        unitListPriceE4:null,lineTotalE4:null});
      expect(view.distinta).toEqual([]);
      expect(demoQuotationTotals(view.lines)).toMatchObject({unpricedLineCount:0,totalQuantity:2});
      view=service.addConfiguredItem(request,1);
      expect(view.lines).toHaveLength(1);
      expect(view.lines[0]?.quantity).toBe(3);
      const other=model.axes.flatMap(axis=>axis.options).find(option=>option.label==="3 moduli")!;
      view=service.addConfiguredItem({modelId,selectedOptionIds:[other.id]});
      expect(view.lines).toHaveLength(2);
      await service.save();service.close();
      const offline=new ProjectDocumentService({workingDirectory:path.join(folder,"offline"),
        incomingDirectory:path.join(folder,"offline-incoming"),backupDirectory:path.join(folder,"offline-backups"),
        migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
        resolveConfiguration:()=>{throw new Error("Catalogue unavailable")},
        resolveCatalogueProduct:()=>{throw new Error("Catalogue unavailable")}});
      expect(offline.open(filename).configuredItems).toHaveLength(2);
      offline.close();
      const corrupt=(name:string,change:(file:Database.Database)=>void,message:string)=>{
        const copy=path.join(folder,`${name}.lqp`);copyFileSync(filename,copy);
        const file=new Database(copy);try{change(file)}finally{file.close()}
        const reader=new ProjectDocumentService({workingDirectory:path.join(folder,`read-${name}`),
          incomingDirectory:path.join(folder,`incoming-${name}`),backupDirectory:path.join(folder,`backup-${name}`),
          migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
          resolveConfiguration:()=>{throw new Error("Catalogue unavailable")},
          resolveCatalogueProduct:()=>{throw new Error("Catalogue unavailable")}});
        expect(()=>reader.open(copy)).toThrow(message);reader.close();
      };
      corrupt("articles-empty",file=>file.exec("UPDATE prj_item SET commercial_contribution='articles'"),
        "distinta");
      corrupt("priced-none",file=>file.exec("UPDATE prj_line SET sale_price_unit_e4=1000,line_total_e4=1000"),
        "Contributo commerciale");
      corrupt("primary-none",file=>file.exec(`INSERT INTO prj_product_snapshot
        (id,uuid,brand_marchio,brand_name,manufacturer_code,snapshot_taken_at)
        VALUES(1,'00000000-0000-4000-8000-000000000001','BTI','BTicino','TEST','2026-09-30T00:00:00.000Z');
        UPDATE prj_item SET primary_snapshot_id=1 WHERE id=(SELECT MIN(id) FROM prj_item)`),
        "Contributo commerciale");
      corrupt("bom-none",file=>file.exec(`INSERT INTO prj_product_snapshot
        (id,uuid,brand_marchio,brand_name,manufacturer_code,snapshot_taken_at)
        VALUES(1,'00000000-0000-4000-8000-000000000001','BTI','BTicino','TEST','2026-09-30T00:00:00.000Z');
        INSERT INTO prj_item_bom(item_id,seq,snapshot_id,quantity_per_item,role)
        VALUES((SELECT MIN(id) FROM prj_item),1,1,1,'component')`),"Contributo commerciale");
    }finally{rmSync(folder,{recursive:true,force:true});}
  });

  it("keeps unapproved Contattore and rack-space models commercially invalid",()=>{
    for(const code of ["tq.pack.2298","tq.pack.17950"]){
      const modelId=one("SELECT id FROM cat_config_model WHERE code=?",code)!.id as number;
      const resolved=resolveConfiguration(db,{modelId,selectedOptionIds:[]});
      expect(resolved.commercialContribution,code).toBe("articles");
      expect(resolved.status,code).toBe("invalid");
      expect(resolved.issues.some(issue=>issue.code==="bom_empty"),code).toBe(true);
    }
  });

  it("discovers and places 1778 on a compatible selected Pannello through generic paths",async()=>{
    const folder=mkdtempSync(path.join(tmpdir(),"lqp-1778-placement-"));
    try{
      const filename=path.join(folder,"placed.lqp");
      const service=new ProjectDocumentService({workingDirectory:path.join(folder,"working"),
        incomingDirectory:path.join(folder,"incoming"),backupDirectory:path.join(folder,"backups"),
        migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
        resolveConfiguration:input=>resolveConfiguration(db,input),
        resolveCatalogueProduct:id=>getCatalogueProductSnapshot(db,id)});
      await service.create({destinationPath:filename,title:"Placement",description:"",notes:"",
        projectType:"civil",executor:"",date:"2026-09-30",companyName:"Client",companyDescription:""});
      const id=(code:string)=>one("SELECT id FROM cat_config_model WHERE code=?",code)!.id as number;
      for(const code of ["tq.pack.343","tq.pack.4083","tq.pack.1778"])
        service.addConfiguredItem({modelId:id(code),selectedOptionIds:[]});
      const items=new Map(service.current()!.configuredItems.map(item=>[item.modelCode,item.uuid]));
      const root=service.placeRoot({itemUuid:items.get("tq.pack.343")!,rootXMm:0,rootYMm:0,viewCode:"front"});
      const rootUuid=root.physicalNodes[0]!.uuid;
      const panel=service.placeChild({itemUuid:items.get("tq.pack.4083")!,parentUuid:rootUuid,
        zoneNo:0,startUnits:0,viewCode:"front"});
      const panelUuid=panel.physicalNodes[0]!.children[0]!.uuid;
      const working=path.join(folder,"working",readdirSync(path.join(folder,"working"))
        .find(name=>name.endsWith(".lqp"))!);
      const project= new Database(working,{readonly:true});
      try{
        const discovered=discoverDesignCandidates(db,project,{parentUuid:panelUuid,kind:"device"});
        expect(discovered.status).toBe("ready");
        expect(discovered.candidates).toContain(id("tq.pack.1778"));
        expect(discovered.candidates).not.toContain(id("tq.pack.2298"));
      }finally{project.close();}
      const targets=service.placementTargets({itemUuid:items.get("tq.pack.1778")!,parentUuid:panelUuid});
      expect(targets.targets.length).toBeGreaterThan(0);
      expect(service.checkPlacement({itemUuid:items.get("tq.pack.1778")!,parentUuid:panelUuid,
        zoneNo:0,startUnits:0,viewCode:"front"})).toMatchObject({ok:true});
      const placed=service.placeChild({itemUuid:items.get("tq.pack.1778")!,parentUuid:panelUuid,
        zoneNo:0,startUnits:0,viewCode:"front"});
      expect(placed.physicalNodes[0]!.children[0]!.children).toHaveLength(1);
      service.close();
    }finally{rmSync(folder,{recursive:true,force:true});}
  },20_000);

  it("adds 1778 from the Progettazione Apparecchi path, lists it in Da posizionare, places it and reopens offline",async()=>{
    const folder=mkdtempSync(path.join(tmpdir(),"lqp-1778-apparecchi-"));
    try{
      const filename=path.join(folder,"apparecchi.lqp");
      const summaries=(ids:number[])=>ids.map(modelId=>db.prepare(`SELECT m.id,m.code,m.name,m.model_kind AS kind,
        b.metel_marchio AS brandMarchio,m.commercial_contribution AS commercialContribution
        FROM cat_config_model m JOIN cat_brand b ON b.id=m.brand_id WHERE m.id=?`).get(modelId) as
        {id:number;code:string;name:string;kind:string;brandMarchio:string;commercialContribution:"articles"|"none"})
        .map(row=>({...row,active:true,obsolete:false}));
      const options={workingDirectory:path.join(folder,"working"),incomingDirectory:path.join(folder,"incoming"),
        backupDirectory:path.join(folder,"backups"),migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
        resolveConfiguration:(input:Parameters<typeof resolveConfiguration>[1])=>resolveConfiguration(db,input),
        resolveCatalogueProduct:(productId:number)=>getCatalogueProductSnapshot(db,productId),
        designNavigation:(project:Database.Database,request:Parameters<typeof discoverDesignRangeNodes>[2])=>{
          const result=discoverDesignRangeNodes(db,project,request);
          return {...result,candidates:summaries(result.candidates),
            nodes:result.nodes.map(({id,parentId,name,kind,sortOrder,modelIds})=>({id,parentId,name,kind,sortOrder,modelIds}))};
        },
        designGuard:(project:Database.Database,request:Parameters<typeof guardDesignCandidate>[2],
          configuration:Parameters<typeof resolveConfiguration>[1])=>
          guardDesignCandidate(db,project,request,{mode:"add",configuration})};
      const service=new ProjectDocumentService(options);
      await service.create({destinationPath:filename,title:"Apparecchi",description:"",notes:"",
        projectType:"civil",executor:"",date:"2026-09-30",companyName:"Client",companyDescription:""});
      const id=(code:string)=>one("SELECT id FROM cat_config_model WHERE code=?",code)!.id as number;
      for(const code of ["tq.pack.343","tq.pack.4083"])service.addConfiguredItem({modelId:id(code),selectedOptionIds:[]});
      const items=new Map(service.current()!.configuredItems.map(item=>[item.modelCode,item.uuid]));
      const rootUuid=service.placeRoot({itemUuid:items.get("tq.pack.343")!,rootXMm:0,rootYMm:0,viewCode:"front"})
        .physicalNodes[0]!.uuid;
      const panelUuid=service.placeChild({itemUuid:items.get("tq.pack.4083")!,parentUuid:rootUuid,zoneNo:0,
        startUnits:0,viewCode:"front"}).physicalNodes[0]!.children[0]!.uuid;
      const modelId=id("tq.pack.1778");
      // Discovery: the normalized Apparecchi navigation offers it for this Pannello, and only through design navigation.
      const navigation=service.designNavigation("device",panelUuid);
      expect(navigation.status).toBe("ready");
      expect(navigation.candidates.find(model=>model.id===modelId)).toMatchObject({commercialContribution:"none"});
      expect(navigation.nodes.some(node=>node.modelIds.includes(modelId))).toBe(true);
      expect(navigation.candidates.some(model=>model.code==="tq.pack.2298")).toBe(false);
      // The generic axis of the configuration model chooses the width.
      const model=getConfigurationModel(db,modelId);
      const option=(label:string)=>model.axes.flatMap(axis=>axis.options).find(entry=>entry.label===label)!;
      const request=(label:string)=>({modelId,selectedOptionIds:[option(label).id]});
      const demand=(label:string)=>resolveConfiguration(db,request(label)).physical!.demands
        .find(row=>row.capacityKindCode==="din_rail")!.amount;
      expect([demand("1 modulo"),demand("2 moduli"),demand("3 moduli")]).toEqual([2,4,6]);
      expect(model.axes.flatMap(axis=>axis.options).filter(entry=>/modul[oi]$/.test(entry.label))).toHaveLength(12);
      // Add: unplaced, no article, no price, no Distinta.
      const before=service.current()!;
      expect(()=>service.addStructural({configuration:request("2 moduli"),kind:"device",parentUuid:panelUuid}))
        .toThrow("senza posizionamento");
      expect(()=>service.addStructural({configuration:{modelId:id("tq.pack.2298"),selectedOptionIds:[]},
        kind:"device",parentUuid:panelUuid,place:false})).toThrow();
      expect(service.current()!.revision).toBe(before.revision);
      const added=service.addStructural({configuration:request("2 moduli"),kind:"device",parentUuid:panelUuid,place:false});
      const item=added.configuredItems.find(entry=>entry.modelCode==="tq.pack.1778")!;
      expect(item).toMatchObject({commercialContribution:"none",bom:[],physStatus:"resolved"});
      expect(added.lines.find(line=>line.itemUuid===item.uuid)).toMatchObject({quantity:1,unitListPriceE4:null,lineTotalE4:null});
      expect(added.distinta).toEqual(before.distinta);
      expect(added.distinta.length).toBeGreaterThan(0);
      expect(added.physicalNodes[0]!.children[0]!.children).toHaveLength(0);
      expect(devicePool(added).find(entry=>entry.item.uuid===item.uuid)).toMatchObject({available:1,quantity:1});
      // Q22: same configuration merges, another width is a separate configured item.
      const merged=service.addStructural({configuration:request("2 moduli"),kind:"device",parentUuid:panelUuid,place:false});
      expect(merged.lines.find(line=>line.itemUuid===item.uuid)?.quantity).toBe(2);
      const wider=service.addStructural({configuration:request("3 moduli"),kind:"device",parentUuid:panelUuid,place:false});
      expect(wider.configuredItems.filter(entry=>entry.modelCode==="tq.pack.1778")).toHaveLength(2);
      // Placement is the ordinary device placement; the drawn width follows the chosen modules.
      const placed=service.placeChild({itemUuid:item.uuid,parentUuid:panelUuid,zoneNo:0,startUnits:0,viewCode:"front"});
      const child=placed.physicalNodes[0]!.children[0]!.children;
      expect(child).toHaveLength(1);
      expect(child[0]).toMatchObject({nodeKind:"device",itemUuid:item.uuid});
      expect(devicePool(placed).find(entry=>entry.item.uuid===item.uuid)).toMatchObject({available:1,quantity:2});
      await service.save();service.close();
      const offline=new ProjectDocumentService({...options,resolveConfiguration:()=>{throw new Error("offline")},
        resolveCatalogueProduct:()=>{throw new Error("offline")},designNavigation:undefined,designGuard:undefined});
      const reopened=offline.open(filename)!;
      expect(reopened.physicalNodes[0]!.children[0]!.children.map(node=>node.itemUuid)).toEqual([item.uuid]);
      expect(reopened.configuredItems.filter(entry=>entry.modelCode==="tq.pack.1778")).toHaveLength(2);
      expect(reopened.distinta).toEqual(before.distinta);
      offline.close();
      // 1778 is not a Catalogo package.
      expect(one(`SELECT COUNT(*) n FROM cat_config_model m WHERE m.id=? AND ${SELECTABLE_PACKAGE_SQL}`,modelId)).toEqual({n:0});
    }finally{rmSync(folder,{recursive:true,force:true});}
  },30_000);

  const presetService=(folder:string)=>{
    const options={workingDirectory:path.join(folder,"working"),incomingDirectory:path.join(folder,"incoming"),
      backupDirectory:path.join(folder,"backups"),migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
      resolveConfiguration:(input:Parameters<typeof resolveConfiguration>[1])=>resolveConfiguration(db,input),
      resolveCatalogueProduct:(productId:number)=>getCatalogueProductSnapshot(db,productId),
      designDiscover:(project:Database.Database,request:Parameters<typeof discoverDesignCandidates>[2])=>{
        const found=discoverDesignCandidates(db,project,request);
        return {...found,candidates:found.candidates.map(id=>getConfigurationModel(db,id))};
      },
      designGuard:(project:Database.Database,request:Parameters<typeof guardDesignCandidate>[2],
        configuration:Parameters<typeof resolveConfiguration>[1])=>guardDesignCandidate(db,project,request,{mode:"add",configuration})};
    return {options,service:new ProjectDocumentService(options)};
  };
  const create=(service:ProjectDocumentService,filename:string)=>service.create({destinationPath:filename,
    title:"Presets",description:"",notes:"",projectType:"civil",executor:"",date:"2026-10-01",companyName:"Test",companyDescription:""});
  const modelId=(code:string)=>one("SELECT id FROM cat_config_model WHERE code=?",code)!.id as number;

  it("normalizes preset semantics and classifies exactly the reviewed physical-only supports",()=>{
    expect(db.prepare(`SELECT placement_mode AS mode,COUNT(*) AS n FROM cat_config_model_relation
      WHERE relation='preset_child' GROUP BY placement_mode ORDER BY placement_mode`).all())
      .toEqual([{mode:null,n:131},{mode:"blocked_device_compatibility",n:24},
        {mode:"factory_fixed",n:342},{mode:"fixed",n:635},{mode:"packed",n:93}]);
    // Relative occurrences with an offset are only the panel-level (Flatwall) presets; they stay unknown.
    expect(one(`SELECT COUNT(*) n FROM cat_config_model_relation r JOIN cat_config_model m ON m.id=r.from_model_id
      WHERE r.relation='preset_child' AND r.placement_mode IS NULL AND m.model_kind<>'support'`)).toEqual({n:0});
    expect((result.summary.skipped as Record<string,{count:number}>)["preset_relative_offset_unresolved"]?.count).toBe(131);
    expect(db.prepare(`SELECT code FROM cat_config_model WHERE commercial_contribution='none'
      AND code NOT LIKE 'tq.pack.factory.%' ORDER BY id`).pluck().all()
      .map(code=>Number(String(code).slice(8))).sort((a,b)=>a-b))
      .toEqual([1283,1778,2189,2190,2191,2192,2193,2194,2196,2898,2899,2900,2901,2902]);
    for(const code of ["tq.pack.2195","tq.pack.1284","tq.pack.3618","tq.pack.3833","tq.pack.4601","tq.pack.4604"])
      expect(one("SELECT commercial_contribution c FROM cat_config_model WHERE code=?",code)).toEqual({c:"articles"});
    // Fixed preset enclosures (every imported block variant) expose slots instead of a stack.
    const fixedProfiles=db.prepare(`SELECT DISTINCT p.id,z.layout FROM cat_phys_profile p
      JOIN cat_phys_profile_set s ON s.id=p.profile_set_id JOIN cat_phys_zone z ON z.profile_id=p.id
      WHERE s.code='tq.armadi.pack.2890'`).all() as {layout:string}[];
    expect(fixedProfiles.length).toBeGreaterThan(0);
    expect(new Set(fixedProfiles.map(row=>row.layout))).toEqual(new Set(["slots"]));
  });

  it.each([
    {cabinet:13470,devices:[1715],wrong:14699},
    {cabinet:13613,devices:[4478,4496],wrong:1715},
    {cabinet:34575,devices:[1715,14699],wrong:4478},
    {cabinet:5385,devices:[2869],wrong:14705},
  ])("creates and uses factory panels for $cabinet without adding phantom articles",async({cabinet,devices,wrong})=>{
    const folder=mkdtempSync(path.join(tmpdir(),"lqp-factory-panels-"));
    const {service}=presetService(folder);
    const filename=path.join(folder,"factory.lqp");
    const configuration=(pack:number)=>({modelId:modelId(`tq.pack.${pack}`),selectedOptionIds:[]});
    try {
      await create(service,filename);
      const added=service.addStructural({kind:"enclosure",configuration:configuration(cabinet)});
      expect(added.presetDiagnostics?.every(row=>row.status==="instantiated")).toBe(true);
      const root=added.physicalNodes[0]!;
      const panels=root.children;
      const resolved=resolveConfiguration(db,configuration(cabinet));
      expect(panels.map(panel=>[panel.slotNo,panel.xMm,panel.yMm]))
        .toEqual(resolved.physical!.slots.map(slot=>[slot.slotNo,slot.xMm,slot.yMm]));
      expect(added.distinta.map(row=>row.manufacturerCode).sort())
        .toEqual([...new Set(resolved.bom.map(row=>row.manufacturerCode))].sort());
      const windows=added.configuredItems.filter(item=>item.modelKind==="support");
      expect(windows.length).toBe(devices.length);
      for(const item of windows){
        expect(item).toMatchObject({commercialContribution:"none",bom:[]});
        const modelIdForWindow=modelId(item.modelCode);
        expect(()=>service.addConfiguredItem({modelId:modelIdForWindow,selectedOptionIds:[]}))
          .toThrow("aggiunto automaticamente");
      }
      const wrongItem=service.addConfiguredItem(configuration(wrong)).configuredItems
        .find(item=>item.modelCode===`tq.pack.${wrong}`)!;
      for(const panel of panels)
        expect(service.placementTargets({itemUuid:wrongItem.uuid,parentUuid:panel.uuid}).targets).toEqual([]);
      const first=service.addConfiguredItem(configuration(devices[0]!),1,true,true);
      expect(first.autoPlacement).toBe("placed");
      expect(first.physicalNodes[0]!.children[0]!.children).toHaveLength(1);
      expect(service.undo().physicalNodes[0]!.children[0]!.children).toHaveLength(0);
      expect(service.redo().physicalNodes[0]!.children[0]!.children).toHaveLength(1);
      service.undo();
      for(const [index,window] of windows.entries()){
        const panel=panels.find(row=>row.itemUuid===window.uuid)!;
        const code=devices[index]!;
        const pooled=service.addConfiguredItem(configuration(code)).configuredItems.find(row=>row.modelCode===`tq.pack.${code}`)!;
        const target=service.placementTargets({itemUuid:pooled.uuid,parentUuid:panel.uuid}).targets[0];
        if(target?.action!=="placeChild")throw Error("Expected a valid manual placement target");
        service.placeChild(target.input);
      }
      const expected=service.current()!;
      await service.save();
      service.close();
      const reopened=service.open(filename);
      expect(reopened.physicalNodes).toEqual(expected.physicalNodes);
      expect(reopened.distinta).toEqual(expected.distinta);
    } finally {service.close();rmSync(folder,{recursive:true,force:true});}
  });

  it("resolves reviewed DIN cable panels without articles and keeps other executions billable",()=>{
    for(const code of ["tq.pack.1284","tq.pack.1285","tq.pack.1286"]){
      const id=modelId(code),model=getConfigurationModel(db,id);
      expect(model.emptyBomRuleIds).toHaveLength(1);
      const plain=resolveConfiguration(db,{modelId:id,selectedOptionIds:[]});
      expect(plain).toMatchObject({status:"complete",commercialContribution:"none",bom:[],totalE4:null});
      expect(configuredItemAddable(plain)).toBe(true);
      const execution=model.axes.find(axis=>axis.dimensionCode==="tq.label.54")!;
      for(const option of execution.options.filter(option=>option.active&&!option.isDefault)){
        const wired=resolveConfiguration(db,{modelId:id,selectedOptionIds:[option.id]});
        expect(wired.commercialContribution).toBe("articles");expect(wired.bom.length).toBeGreaterThan(0);
      }
    }
  });

  it("creates Idroboard 2890 Finestre once, places Apparecchi on them, and reopens offline; MDX800 stays manual",async()=>{
    const folder=mkdtempSync(path.join(tmpdir(),"lqp-presets-"));
    const filename=path.join(folder,"presets.lqp");
    const {options,service}=presetService(folder);
    try {
      await create(service,filename);
      const configuration={modelId:modelId("tq.pack.2890"),selectedOptionIds:[]};
      const resolved=resolveConfiguration(db,configuration);
      expect(resolved.status).toBe("complete");
      expect(resolved.bom.map(row=>row.manufacturerCode)).toEqual(["F107N54D"]);
      expect(resolved.physical!.fitClass.code).toBe("tq.arm.18004");
      expect(resolved.physical!.zones.map(zone=>zone.layout)).toEqual(["slots"]);
      expect(resolved.physical!.slots.map(slot=>[slot.slotNo,slot.xMm,slot.yMm])).toEqual([[1,57,127],[2,57,277],[3,57,427]]);
      expect(resolved.model.relations.map(row=>[row.relation,row.seq,row.toModelCode,row.placementMode,row.positionXMm,row.positionYMm]))
        .toEqual([1,2,3].map(seq=>["preset_child",seq,"tq.pack.2902","fixed",57,[127,277,427][seq-1]]));

      const added=service.addStructural({kind:"enclosure",configuration});
      expect(added.presetDiagnostics?.map(row=>[row.seq,row.modelCode,row.status])).toEqual([
        [1,"tq.pack.2902","instantiated"],[2,"tq.pack.2902","instantiated"],[3,"tq.pack.2902","instantiated"]]);
      const root=added.physicalNodes[0]!;
      expect([root.nodeKind,root.xMm,root.yMm]).toEqual(["enclosure",0,0]);
      const panels=root.children;
      // Source anchors are measured from the enclosure frame's top-left (the root origin).
      expect(panels.map(panel=>[panel.nodeKind,panel.zoneNo,panel.slotNo,panel.startUnits,panel.xMm,panel.yMm])).toEqual([
        ["support",0,1,null,57,127],["support",0,2,null,57,277],["support",0,3,null,57,427]]);
      const window=added.configuredItems.find(item=>item.modelCode==="tq.pack.2902")!;
      expect(window).toMatchObject({modelKind:"support",commercialContribution:"none",bom:[],
        views:[expect.objectContaining({viewCode:"front",widthMm:334,heightMm:55})]});
      expect(panels.every(panel=>panel.itemUuid===window.uuid)).toBe(true);
      const windowLine=added.lines.find(line=>line.itemUuid===window.uuid)!;
      expect([windowLine.quantity,windowLine.unitListPriceE4,windowLine.lineTotalE4,windowLine.commercialContribution]).toEqual([3,null,null,"none"]);
      expect(added.distinta.map(row=>row.manufacturerCode)).toEqual(["F107N54D"]);

      // Apparecchi are discovered from the created Pannelli (panel family 2313 under class 18004).
      const offered=service.designDiscover("device",panels[0]!.uuid).candidates.map(row=>row.code);
      expect(offered).toEqual(expect.arrayContaining(["tq.pack.1778","tq.pack.4395"]));
      const placeOn=(code:string,panelUuid:string)=>{
        const item=service.addStructural({kind:"device",place:false,parentUuid:panelUuid,
          configuration:{modelId:modelId(code),selectedOptionIds:[]}}).configuredItems.find(row=>row.modelCode===code)!;
        const targets=service.placementTargets({itemUuid:item.uuid,parentUuid:panelUuid}).targets;
        const first=targets.find(target=>target.action==="placeChild")!;
        expect(first).toBeDefined();
        if(first.action!=="placeChild")throw Error("unexpected target");
        return service.placeChild(first.input);
      };
      placeOn("tq.pack.1778",panels[0]!.uuid);
      const withDevices=placeOn("tq.pack.4395",panels[1]!.uuid);
      expect(withDevices.physicalNodes[0]!.children.map(panel=>panel.children.map(device=>device.nodeKind)))
        .toEqual([["device"],["device"],[]]);
      // Distinta: the enclosure article plus the commercial device; Finestre and Din generico add nothing.
      const codes=withDevices.distinta.map(row=>row.manufacturerCode);
      expect(codes).toContain("F107N54D");
      expect(codes).toEqual(expect.arrayContaining(resolveConfiguration(db,{modelId:modelId("tq.pack.4395"),
        selectedOptionIds:[]}).bom.map(row=>row.manufacturerCode)));
      expect(withDevices.distinta.length).toBe(1+resolveConfiguration(db,{modelId:modelId("tq.pack.4395"),
        selectedOptionIds:[]}).bom.length);

      // Control: a Carpenteria without presets keeps the manual Pannello workflow.
      const manual=service.addStructural({kind:"enclosure",configuration:{modelId:modelId("tq.pack.343"),selectedOptionIds:[]}});
      expect(manual.presetDiagnostics).toBeUndefined();
      expect(manual.physicalNodes[1]!.children).toEqual([]);
      expect(manual.configuredItems.filter(item=>item.modelKind==="support").map(item=>item.modelCode)).toEqual(["tq.pack.2902"]);
      expect(service.designDiscover("support",manual.physicalNodes[1]!.uuid).candidates.map(row=>row.code))
        .toEqual(expect.arrayContaining(["tq.pack.851"]));

      const before=service.current()!;
      await service.save();service.close();
      const offline=new ProjectDocumentService({...options,resolveConfiguration:()=>{throw Error("offline")},
        resolveCatalogueProduct:()=>{throw Error("offline")},designGuard:undefined,designDiscover:undefined});
      try {
        const reopened=offline.open(filename);
        expect(reopened.presetDiagnostics).toBeUndefined();
        expect(reopened.physicalNodes).toEqual(before.physicalNodes);
        expect(reopened.configuredItems).toEqual(before.configuredItems);
        expect(reopened.lines).toEqual(before.lines);
        expect(reopened.distinta).toEqual(before.distinta);
        // Ordinary support lifecycle: an unplaced Finestra is not regenerated on save/reopen.
        offline.unplaceSubtree(panels[2]!.uuid);await offline.save();offline.closeCurrent();
        const again=offline.open(filename);
        expect(again.physicalNodes[0]!.children.map(panel=>panel.slotNo)).toEqual([1,2]);
        expect(again.lines.find(line=>line.itemUuid===window.uuid)?.quantity).toBe(3);
      }finally{offline.close();}
    }finally{service.close();rmSync(folder,{recursive:true,force:true});}
  },60_000);

  it("creates the complete SDX 428 packed set without phantom panel articles",async()=>{
    const folder=mkdtempSync(path.join(tmpdir(),"lqp-presets-packed-"));
    const {service}=presetService(folder);
    try {
      await create(service,path.join(folder,"packed.lqp"));
      const parent=resolveConfiguration(db,{modelId:modelId("tq.pack.428"),selectedOptionIds:[]});
      expect(parent.status).toBe("complete");
      expect(parent.physical!.zones.map(zone=>zone.layout)).toEqual(["stack"]);
      expect(parent.model.relations.map(row=>[row.seq,row.toModelCode,row.placementMode])).toEqual([
        [1,"tq.pack.1283","packed"],[2,"tq.pack.1286","packed"],[3,"tq.pack.1284","packed"],
        [4,"tq.pack.1284","packed"],[5,"tq.pack.1285","packed"]]);
      const added=service.addStructural({kind:"enclosure",configuration:{modelId:modelId("tq.pack.428"),selectedOptionIds:[]}});
      expect(added.physicalNodes[0]!.children).toHaveLength(5);
      expect(added.configuredItems.map(item=>item.modelCode)).toEqual(["tq.pack.428","tq.pack.1283","tq.pack.1286","tq.pack.1284","tq.pack.1285"]);
      expect(added.presetDiagnostics?.every(row=>row.status==="instantiated")).toBe(true);
      expect(added.configuredItems.filter(item=>item.modelKind==="support").every(item=>item.commercialContribution==="none"&&item.bom.length===0)).toBe(true);
      expect(added.distinta.map(row=>row.manufacturerCode)).toEqual(parent.bom.map(row=>row.manufacturerCode).sort());
    }finally{service.close();rmSync(folder,{recursive:true,force:true});}
  },60_000);

  it("never creates partial preset structures across every active preset enclosure",async()=>{
    const folder=mkdtempSync(path.join(tmpdir(),"lqp-presets-sweep-"));
    const {service}=presetService(folder);
    try {
      await create(service,path.join(folder,"sweep.lqp"));
      const parents=db.prepare(`SELECT DISTINCT m.id,m.code FROM cat_config_model m JOIN cat_config_model_relation r
        ON r.from_model_id=m.id WHERE r.relation='preset_child' AND m.model_kind='enclosure' AND m.active=1
        AND m.obsolete=0 ORDER BY m.id`).all() as {id:number;code:string}[];
      expect(parents).toHaveLength(259);
      const outcome={complete:[] as string[],withheld:0,notAddable:0,partial:0};
      const reasons:Record<string,number>={};
      for(const parent of parents){
        let added:ReturnType<ProjectDocumentService["addStructural"]>;
        try{added=service.addStructural({kind:"enclosure",configuration:{modelId:parent.id,selectedOptionIds:[]}});}
        catch{outcome.notAddable++;continue;}
        const created=added.presetDiagnostics?.filter(row=>row.status==="instantiated").length??0;
        const total=added.presetDiagnostics?.length??0;
        if(created===total&&total>0)outcome.complete.push(parent.code);
        else if(created===0){outcome.withheld++;
          for(const row of added.presetDiagnostics??[])if(row.code!=="preset_set_incomplete")reasons[row.code]=(reasons[row.code]??0)+1;}
        else outcome.partial++;
      }
      expect(outcome.partial).toBe(0);
      if(process.env["LIBREQUADRI_PANEL_PRESET_EVIDENCE"])writeFileSync(process.env["LIBREQUADRI_PANEL_PRESET_EVIDENCE"]!,JSON.stringify({outcome,reasons},null,2));
      expect(outcome.complete).toHaveLength(163);
      expect(outcome.complete).toEqual(expect.arrayContaining(["tq.pack.428","tq.pack.2890","tq.pack.12890",
        "tq.pack.13470","tq.pack.13611","tq.pack.13613","tq.pack.34575","tq.pack.34621","tq.pack.5385"]));
      expect(outcome.withheld).toBe(8);
      // The 88 orphan CEE enclosures resolve bom_incomplete exactly as before this milestone.
      expect(outcome.notAddable).toBe(88);
      expect(reasons).toEqual({blocked_device_compatibility:24});
    }finally{service.close();rmSync(folder,{recursive:true,force:true});}
  },180_000);

  it("resolves BTDIN60 primary entry, F80RC BOM and changed DIN profile",()=>{
    const modelId=one(`SELECT id FROM cat_config_model WHERE code='tq.pack.4395'`)!.id as number;
    const productId=one(`SELECT p.id FROM cat_product p WHERE p.manufacturer_code='FN82C16'
      AND EXISTS(SELECT 1 FROM cat_config_model_entry e WHERE e.product_id=p.id AND e.model_id=?)`,modelId)!.id as number;
    const base=resolveConfiguration(db,{modelId,productId,selectedOptionIds:[]});
    expect(base.status).toBe('complete');
    expect(base.selectedOptionIds.length).toBeGreaterThan(0);
    expect(base.bom.some(a=>a.manufacturerCode==='FN82C16')).toBe(true);
    expect(base.physical?.demands.find(d=>d.capacityKindCode==='din_rail')?.amount).toBe(4);
    const rule=one(`SELECT r.id FROM cat_config_rule r JOIN cat_config_rule_effect e ON e.rule_id=r.id
      WHERE r.model_id=? AND e.ref_manufacturer_code='F80RC' LIMIT 1`,modelId)!;
    const chosen=db.prepare(`SELECT option_id FROM cat_config_rule_condition WHERE rule_id=?`).pluck().all(rule.id) as number[];
    const visibleChoices = base.model.axes.flatMap(axis => selectableOptions(axis.options, base.selectedOptionIds));
    expect(chosen.every(id => visibleChoices.some(option => option.id === id) || base.selectedOptionIds.includes(id))).toBe(true);
    const accessory=resolveConfiguration(db,configurationRequest(modelId,chosen,productId));
    expect(accessory.status).toBe('complete');
    expect(accessory.bom.some(a=>a.manufacturerCode==='F80RC')).toBe(true);
    expect(accessory.physical?.demands.find(d=>d.capacityKindCode==='din_rail')?.amount).toBe(6);
    expect(accessory.physical?.code).not.toBe(base.physical?.code);
    expect(accessory.totalE4).toBe(1_641_600);
    expect(accessory.bom.map(article=>article.manufacturerCode)).toEqual(expect.arrayContaining(['FN82C16','F80RC']));
    console.log('Configurator acceptance:', JSON.stringify({model:accessory.model.name,
      selections:accessory.model.axes.flatMap(axis=>axis.options.filter(option=>accessory.selectedOptionIds.includes(option.id))
        .map(option=>`${axis.label}: ${option.label}`)),
      bom:accessory.bom.map(article=>article.manufacturerCode),totalE4:accessory.totalE4,
      dinHalfModules:accessory.physical?.demands.find(d=>d.capacityKindCode==='din_rail')?.amount}));
  });

  it("resolves other imported device, accessory and support structures",()=>{
    const device=one(`SELECT id FROM cat_config_model WHERE code='tq.pack.1550'`)!;
    const deviceResult=resolveConfiguration(db,configurationRequest(device.id as number,[]));
    expect(deviceResult.model.name).toContain('MW1600');
    expect(deviceResult.model.axes.length).toBeGreaterThanOrEqual(4);
    expect(deviceResult.matchingRuleIds.length).toBeGreaterThan(0);
    const accessory=one(`SELECT m.id,m.code FROM cat_config_model m
      WHERE m.active=1 AND m.model_kind='accessory'
      AND EXISTS(SELECT 1 FROM cat_config_model_article b WHERE b.model_id=m.id)
      ORDER BY m.id LIMIT 1`)!;
    const accessoryResult=resolveConfiguration(db,{modelId:accessory.id as number,selectedOptionIds:[]});
    expect(accessoryResult.model.kind).toBe('accessory');
    expect(accessoryResult.bom.length).toBeGreaterThan(0);
    const support=one(`SELECT m.id,m.code FROM cat_config_model m JOIN cat_config_rule r ON r.model_id=m.id
      JOIN cat_config_rule_effect e ON e.rule_id=r.id
      WHERE m.active=1 AND m.model_kind='support' GROUP BY m.id ORDER BY m.id LIMIT 1`)!;
    const supportRule=one(`SELECT r.id FROM cat_config_rule r JOIN cat_config_rule_effect e ON e.rule_id=r.id
      WHERE r.model_id=? LIMIT 1`,support.id)!;
    const supportOptions=db.prepare(`SELECT option_id FROM cat_config_rule_condition WHERE rule_id=?`)
      .pluck().all(supportRule.id) as number[];
    const supportResult=resolveConfiguration(db,{modelId:support.id as number,selectedOptionIds:supportOptions});
    expect(supportResult.model.kind).toBe('support');
    expect(supportResult.model.axes.length).toBeGreaterThan(0);
    expect(supportResult.matchingRuleIds).toContain(supportRule.id);
    const enclosure=one(`SELECT id FROM cat_config_model WHERE code='tq.pack.343'`)!;
    const enclosureResult=resolveConfiguration(db,{modelId:enclosure.id as number,selectedOptionIds:[]});
    expect(enclosureResult.model.kind).toBe('enclosure');
    expect(enclosureResult.physical?.zones.some(z=>z.layout==='stack')).toBe(true);
    console.log('Representative models:',deviceResult.model.code,accessoryResult.model.code,supportResult.model.code,enclosureResult.model.code);
  });

  it("keeps multiple real rule articles in a configuration BOM",()=>{
    const row=one(`SELECT r.model_id AS modelId,r.id AS ruleId FROM cat_config_rule r
      JOIN cat_config_model m ON m.id=r.model_id JOIN cat_config_rule_effect e ON e.rule_id=r.id
      WHERE m.active=1 AND e.effect_kind='article'
      GROUP BY r.id HAVING COUNT(DISTINCT e.ref_brand_marchio||'/'||e.ref_manufacturer_code)>1
      ORDER BY r.id LIMIT 1`)!;
    const selectedOptionIds=db.prepare(`SELECT option_id FROM cat_config_rule_condition WHERE rule_id=?`)
      .pluck().all(row.ruleId) as number[];
    const result=resolveConfiguration(db,{modelId:row.modelId as number,selectedOptionIds});
    expect(result.matchingRuleIds).toContain(row.ruleId);
    expect(result.bom.length).toBeGreaterThan(1);
  });

  it("checks imported population invariants and resolves a stratified sample",()=>{
    expect(one(`SELECT COUNT(*) n FROM cat_config_rule_condition c JOIN cat_config_rule r ON r.id=c.rule_id
      JOIN cat_config_option o ON o.id=c.option_id JOIN cat_config_axis a ON a.id=o.axis_id
      WHERE r.model_id<>a.model_id`)).toEqual({n:0});
    expect(one(`SELECT COUNT(*) n FROM cat_config_model_entry e JOIN cat_config_option o ON o.id=e.option_id
      JOIN cat_config_axis a ON a.id=o.axis_id WHERE e.model_id<>a.model_id`)).toEqual({n:0});
    expect(one(`SELECT COUNT(*) n FROM cat_config_option child JOIN cat_config_option parent
      ON parent.id=child.parent_option_id JOIN cat_config_axis a ON a.id=child.axis_id
      JOIN cat_config_axis pa ON pa.id=parent.axis_id WHERE a.model_id<>pa.model_id`)).toEqual({n:0});
    expect(one(`SELECT COUNT(*) n FROM (
      SELECT o.axis_id,o.parent_option_id FROM cat_config_option o
      JOIN cat_config_axis a ON a.id=o.axis_id JOIN cat_config_model m ON m.id=a.model_id
      WHERE m.active=1 AND o.active=1 AND o.is_default=1
      GROUP BY o.axis_id,o.parent_option_id HAVING COUNT(*)>1)`)).toEqual({n:3});
    for(const code of ['tq.pack.1557','tq.pack.1559','tq.pack.1561']){
      const id=one(`SELECT id FROM cat_config_model WHERE code=?`,code)!.id as number;
      expect(resolveConfiguration(db,{modelId:id,selectedOptionIds:[]}).issues.map(i=>i.code))
        .toContain('ambiguous_default');
    }
    expect(one(`SELECT COUNT(*) n FROM cat_config_model m JOIN cat_phys_profile p ON p.id=m.base_profile_id
      WHERE m.active=1 AND m.model_kind IN ('device','support','enclosure')
      AND m.model_kind<>p.profile_kind`)).toEqual({n:0});
    const constrained=one(`SELECT profile_id AS id FROM cat_phys_constraint LIMIT 1`)!;
    expect(getPhysicalProfile(db,constrained.id as number)?.constraints[0]?.classCodes.length).toBeGreaterThan(0);
    const sample=db.prepare(`SELECT id FROM cat_config_model WHERE active=1 AND id%41=0
      ORDER BY id LIMIT 200`).pluck().all() as number[];
    expect(sample.length).toBeGreaterThan(100);
    for(const modelId of sample){
      const result=resolveConfiguration(db,{modelId,selectedOptionIds:[]});
      expect(result.model.id).toBe(modelId);
      expect(result.bom.every(a=>a.quantity>0)).toBe(true);
      expect(result.physical?.demands.every(d=>Number.isInteger(d.amount))).not.toBe(false);
    }
  });

  it("imports enclosure, panel and enumerated compatibility evidence",()=>{
    expect(one(`SELECT v.width_mm AS width,z.length_mm AS usable_height,
      z.breadth_mm AS usable_width,z.origin_x_mm AS x,z.origin_y_mm AS y,z.pitch_mm AS pitch,
      p.outer_depth_mm AS outer_depth,p.usable_depth_mm AS usable_depth
      FROM cat_phys_profile p JOIN cat_phys_view v ON v.profile_id=p.id
      JOIN cat_phys_zone z ON z.profile_id=p.id
      WHERE p.code='tq.armadi.pack.343.block.1751'`)).toEqual({
        width:705,usable_height:1200,usable_width:600,x:52.5,y:45,pitch:50,
        outer_depth:230,usable_depth:164,
      });
    expect(one(`SELECT z.capacity_amount AS capacity,z.capacity_kind_code AS kind
      FROM cat_phys_profile p JOIN cat_phys_zone z ON z.profile_id=p.id
      WHERE p.code='tq.pan.6311'`)).toEqual({capacity:48,kind:"din_rail"});
    expect(one(`SELECT COUNT(*) n FROM cat_phys_constraint c
      JOIN cat_phys_profile p ON p.id=c.profile_id
      JOIN cat_phys_accept_set_member m ON m.set_id=c.accept_set_id
      JOIN cat_phys_class k ON k.id=m.class_id
      WHERE p.code='tq.pan.8311' AND c.relation='parent' AND k.code='tq.arm.5002'`))
      .toEqual({n:0});
  });

  it("is idempotent without adding source rows",async()=>{
    const repeated=await importTiQuadri({database:db,sourcePath:source,
      listinoPath:listino,
      archiveDirectory:path.join(root,"imports/tiquadri"),backupDirectory:path.join(root,"backups"),
      seedFolder:path.resolve("db/seed")});
    expect(repeated.alreadyImported).toBe(true);
    expect(repeated.importId).toBe(result.importId);
    expect(one("SELECT COUNT(*) n FROM app_source_import WHERE adapter_code='tiquadri'")).toEqual({n:1});
  });

  it("normalizes reviewed factory guides and ordinary physical panels without altering assets",()=>{
    const role=(code:string)=>one(`SELECT v.symbol_kind AS role,v.asset_key AS asset FROM cat_config_model m
      JOIN cat_phys_view v ON v.profile_id=m.base_profile_id WHERE m.code=? AND v.view_code='front'`,code);
    for(const id of [2898,2899,2900,2901,2902]) expect(role(`tq.pack.${id}`)).toEqual({role:"mounting_guide",asset:"senza"});
    expect(role("tq.pack.851")).toEqual({role:"physical_panel",asset:"16_Pan_din\\11-9531-24"});
    expect(role("tq.pack.1234")).toEqual({role:"physical_panel",asset:"16_Pan_din\\41-9531-24Q"});
    expect(role("tq.pack.820")).toEqual({role:"physical_panel",asset:"11-Pan_ciechi\\1-9527"});
    expect(role("tq.pack.1283")?.role).toBe("physical_panel");
    expect(role("tq.pack.1284")?.role).toBe("physical_panel");
    for(const id of [2189,2192,2193,3618,3619,3833]) expect(role(`tq.pack.${id}`)?.role).not.toBe("mounting_guide");
    for(const id of [3524,3525,3526,3527,4601,4602,4603,4604,4605,4606,4607,4697,4698])
      expect(role(`tq.pack.factory.${id}`)).toEqual({role:"mounting_guide",asset:"senza"});
    for(const id of [3624,3625]) expect(role(`tq.pack.factory.${id}`)).toEqual({role:"physical_panel",asset:"senza"});
    expect(one("SELECT COUNT(*) AS n FROM cat_phys_view WHERE symbol_kind='mounting_guide'")).toEqual({n:18});
    expect((result.summary.conflicts as Record<string,number>)["front_presentation"]).toBeUndefined();
  });

  // Runs last: it makes a second import current.
  it("recomputes identical Stage C derived state on a forced reimport with a new import identity",async()=>{
    const snapshot=()=>({
      models:db.prepare(`SELECT code,category_id,category_source FROM cat_config_model
        WHERE code LIKE 'tq.pack.%' ORDER BY code`).all(),
      products:db.prepare(`SELECT id,category_id,category_source,category_mapping_id,category_model_id
        FROM cat_product ORDER BY id`).all(),
      attributes:db.prepare(`SELECT product_id,attribute_id,value_num,option_id,value_bool,value_text,
        confidence,source,derivation_ref FROM cat_product_attribute ORDER BY product_id,attribute_id`).all(),
      diagnostics:db.prepare(`SELECT topic,subject_kind,subject_key,value_a,source_a,value_b,source_b,notes
        FROM cat_source_conflict WHERE topic LIKE 'derived.%' ORDER BY topic,subject_key,value_a,notes`).all(),
      // Offers hold stable model and dimension-value IDs, never option IDs.
      offers:db.prepare("SELECT * FROM cat_config_model_offer ORDER BY model_id,offer_no").all(),
      selections:db.prepare("SELECT * FROM cat_config_model_offer_selection ORDER BY model_id,offer_no,value_id").all(),
      offerValues:db.prepare("SELECT * FROM cat_config_model_offer_value ORDER BY model_id,offer_no,attribute_id").all(),
      offerStates:db.prepare("SELECT * FROM cat_config_model_offer_state ORDER BY model_id").all(),
    });
    const optionIds=()=>db.prepare("SELECT id FROM cat_config_option ORDER BY id").pluck().all();
    const before=snapshot();
    const optionsBefore=optionIds();
    expect(before.diagnostics).toHaveLength(6);
    expect(before.offers).toHaveLength(264);
    // Without ListinoBT evidence the source identity changes, so the whole import and
    // derivation chain runs again instead of returning the already-current import.
    const forced=await importTiQuadri({database:db,sourcePath:source,
      archiveDirectory:path.join(root,"imports/tiquadri"),backupDirectory:path.join(root,"backups"),
      seedFolder:path.resolve("db/seed")});
    expect(forced.alreadyImported).toBe(false);
    expect(forced.importId).not.toBe(result.importId);
    expect(snapshot()).toEqual(before);
    // Every option was rebuilt, yet every witness still maps back to one addable configuration.
    expect(optionIds()).not.toEqual(optionsBefore);
    for(const offer of before.offers as Array<{model_id:number;offer_no:number}>)
      expect(offerSelection(db,offer.model_id,offer.offer_no).status,`${offer.model_id}/${offer.offer_no}`).toBe("ready");
    expect(db.prepare(`SELECT COUNT(*) FROM cat_product_attribute WHERE source='engineering'
      AND source_import_id IS NOT ?`).pluck().get(forced.importId)).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) FROM cat_source_conflict WHERE topic LIKE 'derived.%'
      AND import_id<>?`).pluck().get(forced.importId)).toBe(0);
  },300_000);
});
