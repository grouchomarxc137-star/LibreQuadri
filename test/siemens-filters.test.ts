import { afterEach, describe, expect, it } from "vitest";
import { loadCategorySeed, synchronizeCategorySeed } from "../src/main/catalogue/category-seed.js";
import { synchronizeAttributeSeed } from "../src/main/catalogue/attribute-seed.js";
import { ATTRIBUTE_PARSERS } from "../src/main/catalogue/parsers/index.js";
import { sieDescriptionParser } from "../src/main/catalogue/parsers/sie-description.js";
import { SIE_FAMILY_PROFILES } from "../src/main/catalogue/parsers/sie-families.js";
import { browseCatalogue } from "../src/main/catalogue/browse-queries.js";
import { siemensCoverage } from "../src/main/catalogue/siemens-coverage.js";
import { createCatalogueFixture, type CatalogueFixture, type FixtureProduct } from "./helpers/catalogue-fixtures.js";

let fixture:CatalogueFixture|undefined;
afterEach(()=>fixture?.close());
const products:FixtureProduct[]=[
  {marchio:"SIE",code:"5SY62167",statisticalFamily:"P310 I22Y",description:"INT MT 2P C16 ICN 6KA ICU 30KA"},
  {marchio:"SIE",code:"5SY62106",statisticalFamily:"P310 I22Y",description:"INT MT 2P B10 ICN 6KA ICU 30KA"},
  {marchio:"SIE",code:"6ES72111AE400XB0",statisticalFamily:"R132 IC12",description:"CPU 1211C, DC/DC/DC, 6DI/4DO/2AI"},
  {marchio:"SIE",code:"1FK21020AG000MA0",statisticalFamily:"R220 I66B",description:"MOTORE SINCRONO 1FK2-HD 0,16 NM"},
  {marchio:"SIE",code:"8MF10002AA020",statisticalFamily:"P310 I769",description:"PIASTRA MONTAGGIO H1000 L1000"},
  {marchio:"SIE",code:"ACCESSORY",statisticalFamily:"P310 I22Y",description:"CALOTTA PER INT MT 2P C16 400V 10KA"},
  {marchio:"SIE",code:"SOFTWARE",statisticalFamily:"R1OS IE10",description:"SIMATIC WINCC BASIC V19 FLOATING"},
];
const deliver=(list=products,date="2026-01-01",parsers=ATTRIBUTE_PARSERS)=>fixture!.importDelivery(
  {issuer:"SIE",listino:date,validFrom:date,products:list},undefined,{parsers});
const dump=()=>fixture!.lq.prepare("SELECT * FROM cat_product_attribute ORDER BY product_id,attribute_id").all();
const values=(code:string)=>Object.fromEntries((fixture!.lq.prepare(`SELECT a.code,COALESCE(o.value,pa.value_num) AS value
 FROM cat_product p JOIN cat_product_attribute pa ON pa.product_id=p.id JOIN cat_attribute a ON a.id=pa.attribute_id
 LEFT JOIN cat_attribute_option o ON o.id=pa.option_id WHERE p.manufacturer_code=?`).all(code) as {code:string;value:unknown}[]).map(r=>[r.code,r.value]));

describe("Siemens transactional import and facets",()=>{
  it("classifies all 212 reviewed families and enriches startup idempotently",()=>{
    fixture=createCatalogueFixture();
    deliver(Object.keys(SIE_FAMILY_PROFILES).map((family,i)=>({marchio:"SIE",code:`FAMILY${i}`,statisticalFamily:family,description:"UNKNOWN"})));
    expect(fixture.lq.prepare("SELECT COUNT(*) FROM cat_product WHERE category_id IS NOT NULL").pluck().get()).toBe(212);
    const report=siemensCoverage(fixture.lq);
    expect(report.families).toHaveLength(212);
    expect(report.families.every(f=>f.profile!==null && f.supported.includes("article_kind"))).toBe(true);
    expect(synchronizeCategorySeed(fixture.lq)).toMatchObject({reclassified:false,changedProducts:0});
    expect(synchronizeAttributeSeed(fixture.lq)).toMatchObject({reenriched:false,enrichment:null});
  });
  it("uses actual product facts in filters, row attributes, search and paging",()=>{
    fixture=createCatalogueFixture();deliver();
    const db=fixture.lq;
    // A fixture FST hierarchy proves all existing depths use the shared attribute API.
    const brand=db.prepare("SELECT id FROM cat_brand WHERE metel_marchio='SIE'").pluck().get() as number;
    db.prepare(`INSERT INTO cat_range_node(id,brand_id,parent_id,code,name,node_kind,source,navigable) VALUES
      (100,?,NULL,'sie.root','Siemens','section','metel',1),(101,?,100,'sie.group','Protection','group','metel',1),
      (102,?,101,'sie.leaf','Leaf','group','metel',1)`).run(brand,brand,brand);
    db.exec(`INSERT INTO cat_range_node_metel_family SELECT 102,id FROM cat_metel_family WHERE code='P310 I22Y'`);
    const selection=[{attributeCode:"trip_curve",values:["c"]},{attributeCode:"rated_current",values:[16]}];
    const defs=(id:number)=>browseCatalogue(db,{nodeId:id}).facets.attributes.map(a=>a.code);
    expect(defs(100)).toEqual(defs(102));
    for(const nodeId of [100,101,102]){
      const result=browseCatalogue(db,{nodeId,attributeFilters:selection,query:"5SY"});
      expect(result.totalCount).toBe(1);expect(result.products[0]?.manufacturerCode).toBe("5SY62167");
      expect(result.products[0]?.attributes.find(a=>a.code==="rated_short_circuit_capacity")?.value).toBe(6);
      expect(result.facets.attributes.find(a=>a.code==="rated_current")?.values.find(v=>v.value===16)).toMatchObject({count:1,selected:true});
    }
    const page=browseCatalogue(db,{nodeId:100,limit:1});
    expect(page.totalCount).toBe(3);expect(page.hasMore).toBe(true);
    expect(browseCatalogue(db,{nodeId:100,limit:1,offset:1}).products[0]?.id).not.toBe(page.products[0]?.id);
    expect(browseCatalogue(db,{nodeId:102,attributeFilters:[]}).totalCount).toBe(3);
    expect(values("ACCESSORY")).toEqual({article_kind:"accessory"});
    expect(values("SOFTWARE")).toMatchObject({software_version:"v19",licence_type:"floating"});
  });
  it("refreshes changed descriptions, removes stale facts, and preserves manual categories and values",()=>{
    fixture=createCatalogueFixture();deliver();
    fixture.lq.exec(`UPDATE cat_product_attribute SET source='manual',value_num=20 WHERE attribute_id=(SELECT id FROM cat_attribute WHERE code='rated_current')
      AND product_id=(SELECT id FROM cat_product WHERE manufacturer_code='5SY62167');
      UPDATE cat_product SET category_source='manual' WHERE manufacturer_code='6ES72111AE400XB0'`);
    const updated=products.map(p=>p.code==="5SY62167"?{...p,description:"INT MT 4P B32 ICN 10KA ICU 50KA"}:p.code==="5SY62106"?{...p,description:"CALOTTA PER INT MT 2P B10"}:p);
    deliver(updated,"2026-02-01");
    expect(values("5SY62167")).toMatchObject({rated_current:20,poles:"4p",trip_curve:"b",rated_short_circuit_capacity:10});
    expect(values("5SY62106")).toEqual({article_kind:"accessory"});
    expect(fixture.lq.prepare("SELECT category_source FROM cat_product WHERE manufacturer_code='6ES72111AE400XB0'").pluck().get()).toBe("manual");
    const before=dump();
    expect(synchronizeAttributeSeed(fixture.lq,undefined,{parsers:new Map([["SIE",{...sieDescriptionParser,version:"bump"}]])})).toMatchObject({reenriched:true,enrichment:{inserted:0,updated:0,deleted:0}});
    expect(dump()).toEqual(before);
  });
  it("rolls back delivery, classification, attributes and fingerprints after parser failure",()=>{
    fixture=createCatalogueFixture();deliver();
    const before={values:dump(),products:fixture.lq.prepare("SELECT * FROM cat_product").all(),settings:fixture.lq.prepare("SELECT * FROM app_setting ORDER BY key").all(),deliveries:fixture.lq.prepare("SELECT * FROM app_import_delivery").all()};
    expect(()=>deliver(products.map(p=>({...p,description:"CHANGED"})),"2026-03-01",new Map([["SIE",{...sieDescriptionParser,version:"failure",parse(){throw new Error("forced Siemens parser failure");}}]]))).toThrow("forced Siemens parser failure");
    expect(dump()).toEqual(before.values);
    expect(fixture.lq.prepare("SELECT * FROM cat_product").all()).toEqual(before.products);
    expect(fixture.lq.prepare("SELECT * FROM app_setting ORDER BY key").all()).toEqual(before.settings);
    expect(fixture.lq.prepare("SELECT * FROM app_import_delivery").all()).toEqual(before.deliveries);
  });
  it("never changes unrelated brands or uses foreign issuer family context",()=>{
    fixture=createCatalogueFixture();
    fixture.importDelivery({issuer:"BTI",listino:"1",validFrom:"2026-01-01",products:[{marchio:"SIE",code:"FOREIGN",statisticalFamily:"P310 I22Y",description:"INT MT 2P C16"}]});
    expect(values("FOREIGN")).toEqual({});
    expect(fixture.lq.prepare("SELECT category_id FROM cat_product").pluck().get()).toBeNull();
    expect(loadCategorySeed().mappings.filter(m=>m.brandMarchio==="BTI")).toHaveLength(15);
  });
});
