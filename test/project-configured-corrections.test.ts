import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import type { ConfigurationResult } from "../src/shared/configuration.js";
import type { CatalogueProductSnapshotSource } from "../src/shared/project.js";

const roots:string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root,{recursive:true,force:true}); });
const product = (brand:string,code:string,price:number,listino="CURRENT-2026"):
  CatalogueProductSnapshotSource => ({brandMarchio:brand,brandName:brand,manufacturerCode:code,
    ean:null,shortDescription:code,description:`Article ${code}`,unitOfMeasure:"PCE",
    categoryCode:null,categoryPathLabel:null,familyCode:null,familyName:null,priceIssuerSigla:"BTI",
    priceListinoNumber:listino,priceValidFrom:listino === "OLD-2025" ? "2025-01-01" : "2026-07-01",
    listPriceUnitE4:price,priceMultiplierOriginal:1,attributes:[{code:"attribute",name:"Attribute",
      dataType:"text",unit:null,value:"value",label:null}]});
const resolved = (references:Array<{brand:string;code:string;id:number;source:CatalogueProductSnapshotSource}>):
  ConfigurationResult => ({model:{id:1,code:"model",name:"Model",kind:"accessory",
    brandMarchio:"BTI",active:true,obsolete:false,commercialContribution:"articles",definitionFingerprint:"definition",sourceRef:null,
    baseProfileId:null,maxInsertQty:null,axes:[],budgets:[],relations:[]},selectedOptionIds:[],
    defaultedOptionIds:[],commercialContribution:"articles",matchingRuleIds:[],fingerprint:"fingerprint",status:"complete",issues:[],
    bom:references.map(({brand,code,id,source},index) => ({brandMarchio:brand,manufacturerCode:code,
      productId:id,linkedBrandMarchio:source.brandMarchio,linkedManufacturerCode:source.manufacturerCode,
      priceIssuerSigla:source.priceIssuerSigla,priceListinoNumber:source.priceListinoNumber,
      priceValidFrom:source.priceValidFrom,priceMultiplierOriginal:source.priceMultiplierOriginal,
      quantity:1,roles:[index === 0 ? "primary" : "accessory"],
      description:source.description,unitPriceE4:source.listPriceUnitE4,rowTotalE4:source.listPriceUnitE4,
      currency:"EUR"})),totalE4:references.reduce((sum,row) => sum+row.source.listPriceUnitE4!,0),
    pricedSubtotalE4:references.reduce((sum,row) => sum+row.source.listPriceUnitE4!,0),
    budgets:[],physical:null,exclusions:[]});
const setup = (catalogueProducts:Map<number,CatalogueProductSnapshotSource>, result:ConfigurationResult) => {
  const root=mkdtempSync(path.join(tmpdir(),"lqp-review-fix-")); roots.push(root);
  const filename=path.join(root,"review.lqp");
  let currentResult=result;
  const service=new ProjectDocumentService({workingDirectory:path.join(root,"working"),
    incomingDirectory:path.join(root,"incoming"),backupDirectory:path.join(root,"backups"),
    migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
    resolveCatalogueProduct:id => catalogueProducts.get(id)!,resolveConfiguration:() => currentResult});
  const create=() => service.create({destinationPath:filename,title:"Review",description:"",notes:"",
    projectType:"civil",executor:"",date:"2026-09-24",companyName:"Client",companyDescription:""});
  return {root,filename,service,create,setResult:(next:ConfigurationResult) => {currentResult=next;}};
};

describe("configured-item correction regressions",() => {
  it("still refuses every non-complete resolver status without changing the document",async () => {
    const source=product("BTI","MAIN",10_000);
    const base=resolved([{brand:"BTI",code:"MAIN",id:1,source}]);
    const {service,create,setResult}=setup(new Map([[1,source]]),base);
    await create();
    for (const status of ["invalid","incomplete","budget_exceeded","bom_incomplete",
      "price_incomplete","no_profile"] as const) {
      setResult({...base,status});
      expect(() => service.addConfiguredItem({modelId:1,selectedOptionIds:[]})).toThrow("completa e attiva");
      expect(service.current()).toMatchObject({dirty:false,configuredItems:[],lines:[]});
    }
    service.close();
  });

  it.each([
    ["normalized code", "BTI", "C9250F/6", "BTI", "C9250F6"],
    ["cross-brand link", "BTI", "028518", "LEG", "028518"],
  ])("inserts a %s using the linked catalogue product identity",async (_name,refBrand,refCode,linkedBrand,linkedCode) => {
    const source=product(linkedBrand,linkedCode,10_000);
    const {filename,service,create}=setup(new Map([[1,source]]),resolved([{
      brand:refBrand,code:refCode,id:1,source}]));
    await create();
    const view=service.addConfiguredItem({modelId:1,selectedOptionIds:[]});
    expect(view.configuredItems[0]?.bom[0]).toMatchObject({brandMarchio:linkedBrand,
      manufacturerCode:linkedCode,salePriceUnitE4:10_000});
    expect(view.distinta).toMatchObject([{brandMarchio:linkedBrand,manufacturerCode:linkedCode}]);
    await service.save();service.close();
    const db=new Database(filename,{readonly:true});
    try {expect(db.prepare("SELECT brand_marchio AS brand,manufacturer_code AS code FROM prj_product_snapshot").get())
      .toEqual({brand:linkedBrand,code:linkedCode});}
    finally {db.close();}
  });

  it("rejects reuse of an old FN82C16 snapshot without rewriting quotation history",async () => {
    const old=product("BTI","FN82C16",800_000,"OLD-2025");
    const current=product("BTI","FN82C16",921_700);
    const catalogue=new Map([[1,old]]);
    const {filename,service,create,setResult}=setup(catalogue,resolved([{brand:"BTI",code:"FN82C16",id:1,source:old}]));
    await create();service.addCatalogueProduct(1);await service.save();
    const before=readFileSync(filename);
    catalogue.set(1,current);
    setResult(resolved([{brand:"BTI",code:"FN82C16",id:1,source:current}]));
    expect(() => service.addConfiguredItem({modelId:1,selectedOptionIds:[]})).toThrow("prezzo o listino diverso");
    expect(service.current()).toMatchObject({dirty:false,configuredItems:[],lines:[{lineType:"product",
      unitListPriceE4:800_000}]});
    expect(readFileSync(filename)).toEqual(before);
    service.close();
  });

  it("cleans only unreferenced snapshots and their attributes when lines are removed",async () => {
    const first=product("BTI","MAIN",10_000),second=product("BTI","ADDON",20_000);
    const {filename,service,create}=setup(new Map([[1,first],[2,second]]),resolved([
      {brand:"BTI",code:"MAIN",id:1,source:first},{brand:"BTI",code:"ADDON",id:2,source:second}]));
    await create();
    const ordinary=service.addCatalogueProduct(1).lines[0]!;
    const item=service.addConfiguredItem({modelId:1,selectedOptionIds:[]}).lines.find(line => line.lineType === "item")!;
    service.removeLine(item.uuid);await service.save();
    let db=new Database(filename,{readonly:true});
    try {
      expect(db.prepare("SELECT manufacturer_code FROM prj_product_snapshot").pluck().all()).toEqual(["MAIN"]);
      expect(db.prepare("SELECT COUNT(*) FROM prj_product_snapshot_attribute").pluck().get()).toBe(1);
    } finally {db.close();}
    service.removeLine(ordinary.uuid);await service.save();service.close();
    db=new Database(filename,{readonly:true});
    try {
      expect(db.prepare("SELECT COUNT(*) FROM prj_product_snapshot").pluck().get()).toBe(0);
      expect(db.prepare("SELECT COUNT(*) FROM prj_product_snapshot_attribute").pluck().get()).toBe(0);
    } finally {db.close();}
  });
});
