import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { createCatalogueFixture, type CatalogueFixture } from "./helpers/catalogue-fixtures.js";
import { classifyProducts } from "../src/main/catalogue/category-classifier.js";
import { enrichProductAttributes, type AttributeParserRegistry } from "../src/main/catalogue/attribute-enrichment.js";
import { synchronizeEngineeringVocabulary, loadEngineeringVocabularySeed, type EngineeringVocabularySeed } from "../src/main/catalogue/engineering-vocabulary.js";
import type { CategorySeed } from "../src/main/catalogue/category-seed.js";
import type { AttributeSeed } from "../src/main/catalogue/attribute-seed.js";
import { synchronizeCategorySeed } from "../src/main/catalogue/category-seed.js";
import { synchronizeAttributeSeed } from "../src/main/catalogue/attribute-seed.js";
import { engineeringVocabularyWarnings } from "../src/main/catalogue/engineering-vocabulary.js";
import { Report, reportEngineeringVocabularyWarnings } from "../src/main/sources/tiquadri/import.js";

const categories: CategorySeed = {
  categories: [
    {code:"root",parentCode:null,name:"Root",sortOrder:0,active:true},
    {code:"root.breaker",parentCode:"root",name:"Breaker",sortOrder:1,active:true},
    {code:"root.contactor",parentCode:"root",name:"Contactor",sortOrder:2,active:true},
  ],
  mappings: [
    {code:"brk",issuerSigla:null,brandMarchio:null,sourceType:"STATISTICA",matchMode:"exact",matchValue:"BRK",categoryCode:"root.breaker",priority:0,notes:null},
    {code:"con",issuerSigla:null,brandMarchio:null,sourceType:"STATISTICA",matchMode:"exact",matchValue:"CON",categoryCode:"root.contactor",priority:0,notes:null},
  ],
};
const attributes: AttributeSeed = {
  attributes:[{code:"rated_current",name:"In",dataType:"number",unit:"A",active:true,options:[]}],
  categoryAttributes:[{categoryCode:"root.breaker",attributeCode:"rated_current",sortOrder:1,isFilterable:true,isRequired:false,filterWidget:"range"}],
};
const parser: AttributeParserRegistry = new Map([["BTI",{code:"test.tiq",version:"1",parse:({description}) => {
  const match=/\bIn=(\d+)\b/.exec(description);
  return {values:new Map(match?[["rated_current",{kind:"number" as const,value:Number(match[1])}]]:[]),ambiguous:[]};
}}]]);
let fixture:CatalogueFixture, db:Database.Database, importId:number, brandId:number, breakerId:number, contactorId:number, attributeId:number;
const id=(table:string,where:string,value:string):number=>db.prepare(`SELECT id FROM ${table} WHERE ${where}=?`).pluck().get(value) as number;
const product=(code:string)=>id("cat_product","manufacturer_code",code);
const row=(code:string)=>db.prepare(`SELECT * FROM cat_product_attribute WHERE product_id=? AND attribute_id=?`).get(product(code),attributeId) as Record<string,unknown>|undefined;
const diagnostics=(code:string)=>db.prepare(`SELECT topic,value_a,value_b,source_b FROM cat_source_conflict WHERE subject_key=? AND topic LIKE 'derived.%' ORDER BY topic`).all(`BTI:${code}`) as Array<{topic:string;value_a:string;value_b:string|null;source_b:string|null}>;
const run=()=>db.transaction(()=>{classifyProducts(db);return enrichProductAttributes(db,parser);})();
function model(code:string,category:number|null=breakerId):number {
  const info=db.prepare(`INSERT INTO cat_config_model(brand_id,code,name,model_kind,category_id,category_source,definition_fingerprint,source,source_import_id)
    VALUES(?,?,?,'device',?,'manual','fixture','import',?)`).run(brandId,code,code,category,importId);
  return Number(info.lastInsertRowid);
}
function value(code:string,label:string,current:number):number {
  const dimension=id("cat_config_dimension","code","tq.label.51");
  const info=db.prepare(`INSERT INTO cat_config_dimension_value(dimension_id,code,label,source) VALUES(?,?,?,'import')`).run(dimension,code,label);
  db.prepare(`INSERT INTO cat_config_value_attribute(value_id,attribute_id,value_num,source) VALUES(?,?,?,'seed')`).run(Number(info.lastInsertRowid),attributeId,current);
  return Number(info.lastInsertRowid);
}
function entry(code:string,modelId:number,valueId:number) {
  let axis=db.prepare(`SELECT id FROM cat_config_axis WHERE model_id=?`).pluck().get(modelId) as number|undefined;
  axis??=Number(db.prepare(`INSERT INTO cat_config_axis(model_id,dimension_id,sort_order,label,visibility,requirement,binding,selects_primary)
    VALUES(?,(SELECT id FROM cat_config_dimension WHERE code='tq.label.51'),0,'Taratura','visible','required','none',1)`).run(modelId).lastInsertRowid);
  let option=db.prepare(`SELECT id FROM cat_config_option WHERE axis_id=? AND value_id=?`).pluck().get(axis,valueId) as number|undefined;
  option??=Number(db.prepare(`INSERT INTO cat_config_option(axis_id,value_id) VALUES(?,?)`).run(axis,valueId).lastInsertRowid);
  db.prepare(`INSERT INTO cat_config_model_entry(product_id,model_id,option_id) VALUES(?,?,?)`).run(product(code),modelId,option);
}
function secondEntry(code:string,modelId:number,valueId:number) { entry(code,modelId,valueId); }

beforeEach(()=>{
  fixture=createCatalogueFixture();db=fixture.lq;
  fixture.importDelivery({issuer:"BTI",listino:"1",validFrom:"2026-01-01",products:[
    {marchio:"BTI",code:"BRK",statisticalFamily:"BRK",description:"In=125"},
    {marchio:"BTI",code:"CON",statisticalFamily:"CON",description:"In=125"},
    {marchio:"BTI",code:"MIX",statisticalFamily:"BRK",description:"In=125"},
    {marchio:"BTI",code:"NONE",statisticalFamily:"BRK",description:"No parser value"},
  ]},categories,{seed:attributes,parsers:parser});
  brandId=id("cat_brand","metel_marchio","BTI"); breakerId=id("cat_category","code","root.breaker");
  contactorId=id("cat_category","code","root.contactor");attributeId=id("cat_attribute","code","rated_current");
  importId=Number(db.prepare(`INSERT INTO app_source_import(adapter_code,adapter_version,source_label,fingerprint,imported_at,became_current,summary_json)
    VALUES('tiquadri','32','fixture',?,'2026-10-19',1,'{}')`).run("a".repeat(64)).lastInsertRowid);
  db.prepare(`INSERT INTO cat_config_dimension(brand_id,code,name,source,source_import_id) VALUES(?,'tq.label.51','Taratura','import',?)`).run(brandId,importId);
});
afterEach(()=>fixture.close());

describe("Stage B TiQuadri generic derivation",()=>{
  it("classifies and enriches current engineering contributions without an adapter-code constant",()=>{
    db.prepare("UPDATE app_source_import SET adapter_code='listino_bt' WHERE id=?").run(importId);
    db.prepare("UPDATE cat_product SET statistical_family_id=NULL, category_id=NULL, category_source='unmapped' WHERE manufacturer_code='NONE'").run();
    const m=model("fixture.model"),v=value("fixture.value","40 A",40);entry("NONE",m,v);
    synchronizeCategorySeed(db,categories);
    synchronizeAttributeSeed(db,attributes,{parsers:parser});
    expect(db.prepare("SELECT category_id,category_model_id FROM cat_product WHERE id=?").get(product("NONE")))
      .toEqual({category_id:breakerId,category_model_id:m});
    expect(row("NONE")).toMatchObject({source:"engineering",value_num:40,source_import_id:importId});
    db.prepare("UPDATE app_source_import SET fingerprint=? WHERE id=?").run("c".repeat(64),importId);
    expect(synchronizeCategorySeed(db,categories).reclassified).toBe(true);
    expect(synchronizeAttributeSeed(db,attributes,{parsers:parser}).reenriched).toBe(true);
    expect(row("NONE")).toMatchObject({source:"engineering",value_num:40});
  });
  it("B-T1 agrees with parser, promotes provenance and is idempotent",()=>{
    const m=model("tq.pack.1"),v=value("tq.value.1","125 A",125);entry("BRK",m,v);
    expect(run()).toMatchObject({updated:1});
    expect(row("BRK")).toMatchObject({value_num:125,source:"engineering",source_import_id:importId,derivation_ref:"tq.pack.1/tq.value.1"});
    const before=row("BRK");expect(run()).toMatchObject({inserted:0,updated:0,deleted:0});expect(row("BRK")).toEqual(before);
  });
  it("B-T2 lets agreeing engineering override a different parser value and records it once",()=>{
    const m=model("tq.pack.1"),v=value("tq.value.1","160 A",160);entry("BRK",m,v);
    run();expect(row("BRK")?.value_num).toBe(160);
    expect(diagnostics("BRK")).toEqual([expect.objectContaining({topic:"derived.parser_disagrees",source_b:"parser"})]);
    const before=diagnostics("BRK");run();expect(diagnostics("BRK")).toEqual(before);
  });
  it("B-T3 suppresses a parser row on conflicting engineering evidence",()=>{
    const a=model("tq.pack.1"),b=model("tq.pack.2"),va=value("tq.value.1","160 A",160),vb=value("tq.value.2","125 A",125);
    entry("MIX",a,va);secondEntry("MIX",b,vb);run();
    expect(row("MIX")).toBeUndefined();expect(diagnostics("MIX")).toEqual([expect.objectContaining({topic:"derived.conflict",source_b:"parser"})]);
  });
  it("B-T4 removes an engineering row when a contradictory model fact arrives",()=>{
    const a=model("tq.pack.1"),b=model("tq.pack.2"),va=value("tq.value.1","125 A",125),vb=value("tq.value.2","125 A copy",125);
    entry("MIX",a,va);secondEntry("MIX",b,vb);run();expect(row("MIX")?.source).toBe("engineering");
    db.prepare(`INSERT INTO cat_config_model_attribute(model_id,attribute_id,value_num,source) VALUES(?,?,160,'seed')`).run(b,attributeId);
    run();expect(row("MIX")).toBeUndefined();expect(diagnostics("MIX").map(d=>d.topic)).toEqual(["derived.conflict"]);
  });
  it("B-T5 removes lost evidence and restores parser only where still applicable",()=>{
    const m=model("tq.pack.1"),v=value("tq.value.1","160 A",160);entry("BRK",m,v);run();
    db.prepare(`DELETE FROM cat_config_value_attribute WHERE value_id=?`).run(v);run();
    expect(row("BRK")).toMatchObject({source:"parser",value_num:125,source_import_id:null,derivation_ref:null});
    db.prepare(`INSERT INTO cat_config_value_attribute(value_id,attribute_id,value_num,source) VALUES(?,?,160,'seed')`).run(v,attributeId);
    run();db.prepare(`UPDATE cat_config_model SET active=0 WHERE id=?`).run(m);run();expect(row("BRK")?.source).toBe("parser");
    db.prepare(`UPDATE cat_config_model SET active=1 WHERE id=?`).run(m);run();
    db.prepare(`DELETE FROM cat_config_model_entry WHERE model_id=?`).run(m);run();expect(row("BRK")?.source).toBe("parser");
    entry("BRK",m,v);run();db.prepare(`DELETE FROM cat_category_attribute WHERE category_id=? AND attribute_id=?`).run(breakerId,attributeId);
    run();expect(row("BRK")).toBeUndefined();
  });
  it("B-T6 protects manual, seed and import_file rows across E states",()=>{
    const m=model("tq.pack.1"),v=value("tq.value.1","160 A",160);entry("BRK",m,v);
    for(const source of ["manual","seed","import_file"]){
      db.prepare(`UPDATE cat_product_attribute SET source=?,value_num=125,confidence=0.7 WHERE product_id=? AND attribute_id=?`).run(source,product("BRK"),attributeId);
      const before=row("BRK");
      db.prepare(`UPDATE cat_config_value_attribute SET value_num=125 WHERE value_id=?`).run(v);
      run();expect(row("BRK")).toEqual(before);expect(diagnostics("BRK")).toEqual([]);
      db.prepare(`UPDATE cat_config_value_attribute SET value_num=160 WHERE value_id=?`).run(v);
      run();expect(row("BRK")).toEqual(before);expect(diagnostics("BRK").map(d=>d.topic)).toEqual(["derived.shadowed"]);
      db.prepare(`INSERT INTO cat_config_model_attribute(model_id,attribute_id,value_num,source) VALUES(?,?,125,'seed') ON CONFLICT(model_id,attribute_id) DO UPDATE SET value_num=125`).run(m,attributeId);
      run();expect(row("BRK")).toEqual(before);expect(diagnostics("BRK").map(d=>d.topic)).toEqual(["derived.conflict"]);
      db.prepare(`DELETE FROM cat_config_model_attribute WHERE model_id=?`).run(m);
      db.prepare(`DELETE FROM cat_config_value_attribute WHERE value_id=?`).run(v);
      run();expect(row("BRK")).toEqual(before);expect(diagnostics("BRK")).toEqual([]);
      db.prepare(`INSERT INTO cat_config_value_attribute(value_id,attribute_id,value_num,source) VALUES(?,?,160,'seed')`).run(v,attributeId);
    }
  });
  it("B-T7 restores engineering after conflict disappears",()=>{
    const a=model("tq.pack.1"),b=model("tq.pack.2"),va=value("tq.value.1","160 A",160),vb=value("tq.value.2","125 A",125);
    entry("MIX",a,va);secondEntry("MIX",b,vb);run();expect(row("MIX")).toBeUndefined();
    db.prepare(`UPDATE cat_config_value_attribute SET value_num=160 WHERE value_id=?`).run(vb);run();
    expect(row("MIX")).toMatchObject({source:"engineering",value_num:160});
    expect(diagnostics("MIX").map(d=>d.topic)).toEqual(["derived.parser_disagrees"]);
  });
  it("B-T8 changes only provenance on identical reimport",()=>{
    const m=model("tq.pack.1"),v=value("tq.value.1","125 A",125);entry("BRK",m,v);run();
    const before=row("BRK")!;
    const next=Number(db.prepare(`INSERT INTO app_source_import(adapter_code,adapter_version,source_label,fingerprint,imported_at,became_current,summary_json)
      VALUES('tiquadri','32','fixture reimport',?,'2026-10-20',1,'{}')`).run("b".repeat(64)).lastInsertRowid);
    db.prepare(`UPDATE app_source_import SET became_current=0 WHERE id=?`).run(importId);
    db.prepare(`UPDATE cat_config_model SET source_import_id=? WHERE id=?`).run(next,m);
    run();expect(row("BRK")).toEqual({...before,source_import_id:next});
    const stable=row("BRK");expect(run()).toMatchObject({inserted:0,updated:0,deleted:0});expect(row("BRK")).toEqual(stable);
  });
  it("B-T9 rolls back row and diagnostic changes after derivation starts",()=>{
    const m=model("tq.pack.1"),v=value("tq.value.1","160 A",160);entry("BRK",m,v);
    const before=db.prepare(`SELECT * FROM cat_product_attribute ORDER BY product_id,attribute_id`).all();
    const beforeDiagnostics=db.prepare(`SELECT * FROM cat_source_conflict ORDER BY id`).all();
    expect(()=>db.transaction(()=>{run();throw new Error("injected after derivation");})()).toThrow("injected after derivation");
    expect(db.prepare(`SELECT * FROM cat_product_attribute ORDER BY product_id,attribute_id`).all()).toEqual(before);
    expect(db.prepare(`SELECT * FROM cat_source_conflict ORDER BY id`).all()).toEqual(beforeDiagnostics);
  });
  it("B-T10 uses six categorized T7304x125 evidence fixtures",()=>{
    const codes=["T7304F125","T7304F125D","T7304H125","T7304L125","T7304N125","T7304N125D"];
    db.prepare(`INSERT INTO cat_product(brand_id,manufacturer_code,code_norm,category_id,category_source,is_listed,updated_at)
      VALUES(?,?,?,?, 'manual',1,'2026-10-19')`);
    for(const code of codes) db.prepare(`INSERT INTO cat_product(brand_id,manufacturer_code,code_norm,category_id,category_source,is_listed,updated_at)
      VALUES(?,?,?,?, 'manual',1,'2026-10-19')`).run(brandId,code,code,breakerId);
    const a=model("tq.pack.20210"),b=model("tq.pack.20211"),va=value("tq.value.144","160 A",160),vb=value("tq.value.145","125 A",125);
    // Real TiQuadri values/entry pattern; category is assigned in this fixture only.
    for(const code of codes){entry(code,a,va);secondEntry(code,b,vb);}
    run();for(const code of codes){expect(row(code)).toBeUndefined();expect(diagnostics(code).map(d=>d.topic)).toEqual(["derived.conflict"]);}
  });
  it("keeps a shared In code from contaminating a categorized contactor",()=>{
    const m=model("tq.pack.shared",contactorId),v=value("tq.value.146","100 A",100);
    entry("CON",m,v);entry("BRK",m,v);run();
    expect(row("CON")).toBeUndefined();expect(row("BRK")).toMatchObject({source:"engineering",value_num:100});
  });
  it("uses stable source and attribute codes for model-fact provenance",()=>{
    const m=model("tq.pack.fact");
    db.prepare(`INSERT INTO cat_config_model_entry(product_id,model_id) VALUES(?,?)`).run(product("NONE"),m);
    db.prepare(`INSERT INTO cat_config_model_attribute(model_id,attribute_id,value_num,source) VALUES(?,?,40,'seed')`).run(m,attributeId);
    run();expect(row("NONE")).toMatchObject({source:"engineering",value_num:40,
      derivation_ref:"tq.pack.fact/model.rated_current"});
  });
});

describe("TiQuadri seed audit",()=>{
  it("puts vocabulary warnings in the TiQuadri import report",()=>{
    const report=new Report();
    reportEngineeringVocabularyWarnings(report,{deferred:["tq.label.51\0tq.value.absent"],stale:["tq.pack.1"]});
    expect(report.skipped).toEqual({
      engineering_vocabulary_deferred:{count:1,sampleKeys:["tq.label.51/tq.value.absent"]},
      engineering_vocabulary_stale:{count:1,sampleKeys:["tq.pack.1"]},
    });
  });
  it("summarizes stale and deferred stable codes for lifecycle reports",()=>{
    expect(engineeringVocabularyWarnings({deferred:["tq.label.51\0tq.value.1"],stale:["tq.pack.1"]}))
      .toEqual({deferred:{count:1,sampleKeys:["tq.label.51/tq.value.1"]},stale:{count:1,sampleKeys:["tq.pack.1"]}});
    expect(engineeringVocabularyWarnings({deferred:[],stale:[]})).toBeNull();
  });
  it("covers all 171 reviewed source values without assigning the 12 contactor-only values",()=>{
    const seed=loadEngineeringVocabularySeed();
    const values=seed.values.filter(v=>v.dimension==="tq.label.51");
    const notApplicable=seed.notApplicable.filter(v=>v.dimension==="tq.label.51");
    expect(values).toHaveLength(112);expect(notApplicable).toHaveLength(59);
    expect(values.filter(v=>v.reviewedLabel.includes("gG"))).toHaveLength(21);
    expect(values.filter(v=>!v.reviewedLabel.includes("gG"))).toHaveLength(91);
    expect(notApplicable.filter(v=>v.reason.includes("Contactor"))).toHaveLength(12);
    expect(new Set([...values.map(v=>v.value),...notApplicable.map(v=>v.value)])).toHaveProperty("size",171);
  });
  it("synchronizes stable codes, defers absent rows, rejects stale labels and protects manual values",()=>{
    const mapped=value("tq.value.146","100 A",100);
    const reviewed:EngineeringVocabularySeed={adapterCode:"tiquadri",values:[
      {dimension:"tq.label.51",value:"tq.value.146",reviewedLabel:"100 A",attributes:[{attribute:"rated_current",number:100}]},
      {dimension:"tq.label.51",value:"tq.value.absent",reviewedLabel:"200 A",attributes:[{attribute:"rated_current",number:200}]},
    ],models:[],notApplicable:[]};
    expect(synchronizeEngineeringVocabulary(db,reviewed)).toMatchObject({appliedValues:1,deferred:["tq.label.51\u0000tq.value.absent"]});
    expect(db.prepare(`SELECT value_num,source FROM cat_config_value_attribute WHERE value_id=?`).get(mapped))
      .toEqual({value_num:100,source:"seed"});
    const original=db.prepare(`SELECT * FROM cat_config_value_attribute WHERE value_id=?`).get(mapped);
    synchronizeEngineeringVocabulary(db,reviewed);
    expect(db.prepare(`SELECT * FROM cat_config_value_attribute WHERE value_id=?`).get(mapped)).toEqual(original);
    db.prepare(`UPDATE cat_config_value_attribute SET source='manual',value_num=125 WHERE value_id=?`).run(mapped);
    synchronizeEngineeringVocabulary(db,{...reviewed,values:[]});
    expect(db.prepare(`SELECT value_num,source FROM cat_config_value_attribute WHERE value_id=?`).get(mapped))
      .toEqual({value_num:125,source:"manual"});
    db.prepare(`UPDATE cat_config_dimension_value SET label='Changed' WHERE id=?`).run(mapped);
    expect(synchronizeEngineeringVocabulary(db,reviewed).stale).toContain("tq.label.51\u0000tq.value.146");
    expect(db.prepare(`SELECT value_num,source FROM cat_config_value_attribute WHERE value_id=?`).get(mapped))
      .toEqual({value_num:125,source:"manual"});
  });
  it("preserves manual model category and fact overrides during vocabulary synchronization",()=>{
    const m=model("tq.pack.reviewed",contactorId);
    db.prepare(`INSERT INTO cat_config_model_attribute(model_id,attribute_id,value_num,source) VALUES(?,?,125,'manual')`).run(m,attributeId);
    const reviewed:EngineeringVocabularySeed={adapterCode:"tiquadri",values:[],notApplicable:[],models:[
      {model:"tq.pack.reviewed",reviewedName:"tq.pack.reviewed",category:"root.breaker",
        attributes:[{attribute:"rated_current",number:100}],evidence:"fixture reviewed"},
    ]};
    synchronizeEngineeringVocabulary(db,reviewed);
    expect(db.prepare(`SELECT category_id,category_source FROM cat_config_model WHERE id=?`).get(m))
      .toEqual({category_id:contactorId,category_source:"manual"});
    expect(db.prepare(`SELECT value_num,source FROM cat_config_model_attribute WHERE model_id=?`).get(m))
      .toEqual({value_num:125,source:"manual"});
    db.prepare(`UPDATE cat_config_model SET category_id=NULL,category_source='unmapped' WHERE id=?`).run(m);
    synchronizeEngineeringVocabulary(db,reviewed);
    expect(db.prepare(`SELECT category_id,category_source FROM cat_config_model WHERE id=?`).get(m))
      .toEqual({category_id:breakerId,category_source:"seed"});
    expect(db.prepare(`SELECT value_num,source FROM cat_config_model_attribute WHERE model_id=?`).get(m))
      .toEqual({value_num:125,source:"manual"});
  });
  it("places unanimous engineering classification above code rules and below STATISTICA",()=>{
    db.prepare(`INSERT INTO cat_product(brand_id,manufacturer_code,code_norm,is_listed,updated_at)
      VALUES(?,'ALT','ALT',1,'2026-10-19')`).run(brandId);
    db.prepare(`INSERT INTO cat_category_mapping(code,source_type,match_mode,match_value,category_id,priority,source)
      VALUES('fixture.prefix','CODE_PREFIX','prefix','ALT',?,0,'seed')`).run(contactorId);
    const a=model("tq.pack.alt"),v=value("tq.value.1","125 A",125);entry("ALT",a,v);
    classifyProducts(db);
    expect(db.prepare(`SELECT category_id,category_model_id,category_mapping_id FROM cat_product WHERE manufacturer_code='ALT'`).get())
      .toEqual({category_id:breakerId,category_model_id:a,category_mapping_id:null});
    const b=model("tq.pack.alt2",contactorId);secondEntry("ALT",b,v);classifyProducts(db);
    expect(db.prepare(`SELECT category_id,category_model_id,category_mapping_id FROM cat_product WHERE manufacturer_code='ALT'`).get())
      .toEqual({category_id:contactorId,category_model_id:null,category_mapping_id:id("cat_category_mapping","code","fixture.prefix")});
    expect(diagnostics("ALT").map(d=>d.topic)).toContain("derived.category_conflict");
    entry("BRK",b,v);classifyProducts(db);
    expect(db.prepare(`SELECT category_id,category_mapping_id FROM cat_product WHERE manufacturer_code='BRK'`).get())
      .toEqual({category_id:breakerId,category_mapping_id:id("cat_category_mapping","code","brk")});
  });
  it("keeps a STATISTICA category and records a shadowed engineering contribution",()=>{
    const m=model("tq.pack.stat.shadow",contactorId),v=value("tq.value.stat.shadow","125 A",125);
    entry("BRK",m,v);
    classifyProducts(db);
    expect(db.prepare(`SELECT category_id,category_mapping_id,category_model_id FROM cat_product WHERE manufacturer_code='BRK'`).get())
      .toEqual({category_id:breakerId,category_mapping_id:id("cat_category_mapping","code","brk"),category_model_id:null});
    expect(diagnostics("BRK")).toEqual([{topic:"derived.category_shadowed",value_a:String(contactorId),
      value_b:String(breakerId),source_b:"STATISTICA"}]);
    const before=db.prepare(`SELECT * FROM cat_source_conflict WHERE subject_key='BTI:BRK' AND topic='derived.category_shadowed'`).get();
    classifyProducts(db);
    expect(db.prepare(`SELECT * FROM cat_source_conflict WHERE subject_key='BTI:BRK' AND topic='derived.category_shadowed'`).get()).toEqual(before);
  });
  it("does not fall through conflicting STATISTICA rules to engineering",()=>{
    db.prepare(`INSERT INTO cat_category_mapping(code,source_type,match_mode,match_value,category_id,priority,source)
      VALUES('fixture.stat.conflict','STATISTICA','exact','BRK',?,0,'seed')`).run(contactorId);
    const m=model("tq.pack.stat.conflict"),v=value("tq.value.stat.conflict","125 A",125);
    entry("BRK",m,v);
    classifyProducts(db);
    expect(db.prepare(`SELECT category_id,category_source,category_mapping_id,category_model_id FROM cat_product WHERE manufacturer_code='BRK'`).get())
      .toEqual({category_id:null,category_source:"unmapped",category_mapping_id:null,category_model_id:null});
    expect(diagnostics("BRK")).toEqual([]);
    classifyProducts(db);
    expect(db.prepare(`SELECT category_id,category_source,category_mapping_id,category_model_id FROM cat_product WHERE manufacturer_code='BRK'`).get())
      .toEqual({category_id:null,category_source:"unmapped",category_mapping_id:null,category_model_id:null});
  });
  it("reconciles scoped diagnostics without changing other products' category or attribute diagnostics",()=>{
    const first=model("tq.pack.scoped.brk",contactorId),second=model("tq.pack.scoped.con"),
      third=model("tq.pack.scoped.mix");
    const firstValue=value("tq.value.scoped.brk","160 A",160),secondValue=value("tq.value.scoped.mix","160 A copy",160);
    entry("BRK",first,firstValue);entry("CON",second,firstValue);entry("MIX",third,secondValue);
    run();
    const outside=db.prepare(`SELECT * FROM cat_source_conflict WHERE subject_key IN ('BTI:CON','BTI:MIX')
      AND topic LIKE 'derived.%' ORDER BY subject_key,topic`).all();
    expect(outside.map((row:unknown)=>(row as {topic:string}).topic)).toEqual(["derived.category_shadowed","derived.parser_disagrees"]);
    db.prepare("UPDATE cat_config_model SET category_id=? WHERE id=?").run(breakerId,first);
    db.prepare("UPDATE cat_config_value_attribute SET value_num=125 WHERE value_id=?").run(firstValue);
    const affected=new Set([product("BRK")]);
    classifyProducts(db,affected);enrichProductAttributes(db,parser,affected);
    expect(diagnostics("BRK")).toEqual([]);
    expect(db.prepare(`SELECT * FROM cat_source_conflict WHERE subject_key IN ('BTI:CON','BTI:MIX')
      AND topic LIKE 'derived.%' ORDER BY subject_key,topic`).all()).toEqual(outside);
  });
});
