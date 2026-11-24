import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { createCatalogueFixture, type CatalogueFixture } from "./helpers/catalogue-fixtures.js";
import { loadCategorySeed } from "../src/main/catalogue/category-seed.js";
import { loadAttributeSeed } from "../src/main/catalogue/attribute-seed.js";
import { ATTRIBUTE_PARSERS } from "../src/main/catalogue/parsers/index.js";
import { classifyProducts } from "../src/main/catalogue/category-classifier.js";
import { enrichProductAttributes } from "../src/main/catalogue/attribute-enrichment.js";
import { filterableAttributes } from "../src/main/catalogue/attribute-queries.js";

// Production category, link and parser seeds: the regression guards the reviewed
// Stage C contract, not a fixture vocabulary.
let fixture:CatalogueFixture, db:Database.Database, importId:number, brandId:number, dimensionId:number, ratedCurrentId:number;
const id=(table:string,where:string,value:string):number=>db.prepare(`SELECT id FROM ${table} WHERE ${where}=?`).pluck().get(value) as number;
const attributesOf=(code:string)=>db.prepare(`SELECT a.code,pa.value_num AS num,o.value AS option,pa.source
  FROM cat_product_attribute pa JOIN cat_product p ON p.id=pa.product_id JOIN cat_attribute a ON a.id=pa.attribute_id
  LEFT JOIN cat_attribute_option o ON o.id=pa.option_id WHERE p.manufacturer_code=? ORDER BY a.code`).all(code);
function model(code:string,category:string):number {
  return Number(db.prepare(`INSERT INTO cat_config_model(brand_id,code,name,model_kind,category_id,category_source,
    definition_fingerprint,source,source_import_id) VALUES(?,?,?,'device',?,'seed','fixture','import',?)`)
    .run(brandId,code,code,id("cat_category","code",category),importId).lastInsertRowid);
}
function taratura(modelId:number,valueCode:string,label:string,current:number):number {
  db.prepare(`INSERT OR IGNORE INTO cat_config_dimension_value(dimension_id,code,label,source) VALUES(?,?,?,'import')`)
    .run(dimensionId,valueCode,label);
  const value=id("cat_config_dimension_value","code",valueCode);
  db.prepare(`INSERT OR IGNORE INTO cat_config_value_attribute(value_id,attribute_id,value_num,source) VALUES(?,?,?,'seed')`)
    .run(value,ratedCurrentId,current);
  const axis=Number(db.prepare(`INSERT INTO cat_config_axis(model_id,dimension_id,sort_order,label,visibility,requirement,binding,selects_primary)
    VALUES(?,?,0,'Taratura','visible','required','none',1)`).run(modelId,dimensionId).lastInsertRowid);
  return Number(db.prepare(`INSERT INTO cat_config_option(axis_id,value_id,is_default) VALUES(?,?,1)`).run(axis,value).lastInsertRowid);
}
const select=(product:string,modelId:number,optionId:number)=>db.prepare(`INSERT INTO cat_config_model_entry(product_id,model_id,option_id)
  VALUES(?,?,?)`).run(id("cat_product","manufacturer_code",product),modelId,optionId);

beforeEach(()=>{
  fixture=createCatalogueFixture();db=fixture.lq;
  fixture.importDelivery({issuer:"BTI",listino:"1",validFrom:"2026-01-01",products:[
    {marchio:"BTI",code:"F311",description:"btdin - portafusibile sezionabile 1P 20A"},
    {marchio:"BTI",code:"T/4",description:"fusibili - tipo fusicolor T 8,5x31,5mm 4A"},
  ]},loadCategorySeed(),{seed:loadAttributeSeed(),parsers:ATTRIBUTE_PARSERS});
  brandId=id("cat_brand","metel_marchio","BTI");ratedCurrentId=id("cat_attribute","code","rated_current");
  importId=Number(db.prepare(`INSERT INTO app_source_import(adapter_code,adapter_version,source_label,fingerprint,imported_at,became_current,summary_json)
    VALUES('tiquadri','11','fixture',?,'2026-10-21',1,'{}')`).run("b".repeat(64)).lastInsertRowid);
  dimensionId=Number(db.prepare(`INSERT INTO cat_config_dimension(brand_id,code,name,source,source_import_id)
    VALUES(?,'tq.label.51','Taratura','import',?)`).run(brandId,importId).lastInsertRowid);
});
afterEach(()=>fixture.close());

describe("Stage C fuse-holder rating semantics",()=>{
  it("keeps holder and package Taratura ratings out of the Portafusibili In facet",()=>{
    // A fuse holder selected through Taratura "20 A" (TiQuadri Portafusibili) whose METEL
    // description also states 20A; and a Portafusibili package whose Taratura "4 A" is the
    // rating of the fuse-link it adds (tq.pack.1788 "Portafusibile 4A F313N").
    const holder=model("tq.pack.holder","protezione.portafusibili");
    select("F311",holder,taratura(holder,"tq.value.20a","20 A",20));
    const pack=model("tq.pack.package","protezione.portafusibili");
    taratura(pack,"tq.value.4a","4 A",4);
    // Positive control: the same Taratura mechanism gives a fuse-link its In.
    const fuse=model("tq.pack.fuse","protezione.fusibili");
    select("T/4",fuse,taratura(fuse,"tq.value.4a","4 A",4));
    db.transaction(()=>{classifyProducts(db);enrichProductAttributes(db,ATTRIBUTE_PARSERS);})();

    expect(db.prepare(`SELECT c.code FROM cat_product p JOIN cat_category c ON c.id=p.category_id
      WHERE p.manufacturer_code='F311'`).pluck().get()).toBe("protezione.portafusibili");
    expect(attributesOf("F311")).toEqual([{code:"poles",num:null,option:"1p",source:"parser"}]);
    expect(db.prepare(`SELECT COUNT(*) FROM cat_source_conflict WHERE subject_key='BTI:F311'`).pluck().get()).toBe(0);
    expect(attributesOf("T/4")).toEqual([{code:"rated_current",num:4,option:null,source:"engineering"}]);

    // The package's selected value does mean 4 A, but Portafusibili exposes no In facet,
    // so neither its articles nor a later package offer can be filtered as "In 4 A".
    expect(db.prepare(`SELECT va.value_num FROM cat_config_value_attribute va JOIN cat_config_option o ON o.value_id=va.value_id
      JOIN cat_config_axis a ON a.id=o.axis_id WHERE a.model_id=? AND va.attribute_id=?`).pluck().get(pack,ratedCurrentId)).toBe(4);
    expect(filterableAttributes(db,[id("cat_category","code","protezione.portafusibili")]).map(a=>a.code)).toEqual(["poles"]);
    expect(filterableAttributes(db,[id("cat_category","code","protezione.fusibili")]).map(a=>a.code)).toEqual(["rated_current"]);
  });
});
