import {mkdtempSync,writeFileSync,rmSync,readFileSync,mkdirSync,unlinkSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach,expect,it} from "vitest";
import {createCatalogueFixture} from "./helpers/catalogue-fixtures.js";
import {importSienergy} from "../src/main/sources/sienergy/import.js";
import {resolveConfiguration} from "../src/main/catalogue/configuration-resolver.js";
import {readEngineeringReadiness} from "../src/main/catalogue/engineering-readiness.js";
import {SIENERGY_ENGINEERING_ADAPTER} from "../src/main/sources/sienergy/adapter.js";
import {getCatalogueProductSnapshot} from "../src/main/catalogue/catalogue-queries.js";
import {digest} from "../src/main/sources/sienergy/drawings.js";
import {readFrontVectorAssets} from "../src/main/catalogue/vector-assets.js";
import {ProjectDocumentService} from "../src/main/project/project-document-service.js";

const roots:string[]=[];afterEach(()=>{for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});});
function master(width=27){return [
 "EXEL S.R.L. integra5 5.5.14.14 30/10/2026 10:18:6 '' 1 98101",
 "1 3 a 50 00000000 ''","0 'C' 'Apparecchi' ;",
 "2 5 b 52 00000000 ''","0 0 0 0 0","14 0 -2 '' 'Modulari' '' '' ;",
 ...["5ST3053","ONLY-OTHER-BRAND"].flatMap((code,i)=>[
 `3 7 ${10+i} 70 00000000 ''`,"0 0 0 0 0",`1 0 113 351 '${code}' '${code}' '' 'Articolo' 0 ;`,
 "0 36 3 1 -1 -1 -1 -1 -1 -1 -1 -1 1 '' 0:c[2](0 1) '' 0 ;"]),
 "3 7 c 70 00000000 ''","0 0 0 0 0","2 0 -2 -2 '' 'DIN-X' '' 'DIN' 0 ;",
 "0 168 3 1 -1 -1 -1 -1 -1 -1 -1 -1 1 'DIN-X' -1 '' 132 1 '03-COMPONENTI' 0 0 0",
 "0 0 0 0","0 0 0 0000","0 0 0 0",`0 ${width.toFixed(6)}`,
 "0 10 f 0 ;"].join("\n");}
function setup(){
 const fixture=createCatalogueFixture(),root=mkdtempSync(path.join(tmpdir(),"librequadri-sie-import-"));roots.push(root);
 fixture.importDelivery({issuer:"SIE",listino:"1",validFrom:"2026-01-01",products:[{marchio:"SIE",code:"5ST3053",priceCents:12345},{marchio:"SIE",code:"ONLYOTHERBRAND",priceCents:111}]});
 fixture.importDelivery({issuer:"BTI",listino:"1",validFrom:"2026-01-01",products:[{marchio:"BTI",code:"ONLY-OTHER-BRAND",priceCents:999}]});
 const source=path.join(root,"Siemens.bd");writeFileSync(source,master());
 return {fixture,root,source,options:{database:fixture.lq,sourcePath:source,archiveDirectory:path.join(root,"archive"),backupDirectory:path.join(root,"backups")}};
}
it("imports engineering occupancy, keeps METEL prices and strict Siemens identities, repeats without writes",async()=>{
 const {fixture,options}=setup(),db=fixture.lq;
 try{
  expect(readEngineeringReadiness(db).sources.some(r=>r.adapterCode==="sienergy")).toBe(false);
  const result=await importSienergy(options);expect(result.summary).toMatchObject({models:2,profiles:1,linkedModels:1,unlinkedModels:1});
  const model=db.prepare("SELECT id FROM cat_config_model WHERE code='sie.article.5ST3053'").pluck().get() as number;
  const resolution=resolveConfiguration(db,{modelId:model,selectedOptionIds:[]});
  expect(resolution.status).toBe("complete");expect(resolution.bom[0]).toMatchObject({brandMarchio:"SIE",manufacturerCode:"5ST3053",unitPriceE4:1234500});
  expect(resolution.physical?.demands).toMatchObject([{capacityKindCode:"din_rail",amount:3,displayDivisor:2}]);
  expect(resolution.physical?.views).toEqual([]);
  expect(resolution.physical?.constraints).toMatchObject([{relation:"parent",classCodes:["sie.unqualified_parent"]}]);
  expect(db.prepare("SELECT product_id FROM cat_config_model_article WHERE ref_manufacturer_code='ONLY-OTHER-BRAND'").pluck().get()).toBeNull();
  expect(db.prepare("SELECT din_half_modules FROM cat_product_physical").pluck().get()).toBe(3);
  expect(readEngineeringReadiness(db).sources.find(r=>r.adapterCode==="sienergy")).toMatchObject({status:"ready",requiredVersion:SIENERGY_ENGINEERING_ADAPTER.version});
  const changes=db.prepare("SELECT total_changes()").pluck().get();expect(await importSienergy(options)).toMatchObject({alreadyImported:true});
  expect(db.prepare("SELECT total_changes()").pluck().get()).toBe(changes);
 }finally{fixture.close();}
});
it("preserves manually maintained physical facts and deactivates old models when source evidence changes",async()=>{
 const {fixture,options,source}=setup(),db=fixture.lq;
 try{
  await importSienergy(options);db.prepare("UPDATE cat_product_physical SET source='manual',din_half_modules=8").run();
  writeFileSync(source,master(36));await importSienergy(options);
  expect(db.prepare("SELECT din_half_modules FROM cat_product_physical").pluck().get()).toBe(8);
  expect(db.prepare("SELECT COUNT(*) FROM app_source_import WHERE adapter_code='sienergy' AND became_current=1").pluck().get()).toBe(1);
  expect(db.pragma("foreign_key_check")).toEqual([]);
 }finally{fixture.close();}
});
it("rolls back activation and retains the old import if normalization fails",async()=>{
 const {fixture,options,source,root}=setup(),db=fixture.lq;
 try{
  const first=await importSienergy(options);writeFileSync(source,master(36));
  db.exec("CREATE TRIGGER reject_sienergy BEFORE INSERT ON cat_phys_profile BEGIN SELECT RAISE(ABORT,'injected failure'); END");
  await expect(importSienergy(options)).rejects.toThrow("injected failure");
  expect(db.prepare("SELECT fingerprint FROM app_source_import WHERE adapter_code='sienergy' AND became_current=1").pluck().get()).toBe(first.fingerprint);
  expect(db.prepare("SELECT amount FROM cat_phys_profile_demand").pluck().get()).toBe(3);
  expect(readFileSync(path.join(root,"archive",`${first.summary.sourceSha256}.bd`),"utf8")).toBe(master());
 }finally{fixture.close();}
});
it("copies occupancy and priced BOM into a portable project and reopens without a catalogue",async()=>{
 const {fixture,options,root}=setup(),db=fixture.lq;let service:ProjectDocumentService|undefined;
 try{
  await importSienergy(options);
  const modelId=db.prepare("SELECT id FROM cat_config_model WHERE code='sie.article.5ST3053'").pluck().get() as number;
  const make=(catalogue:boolean)=>new ProjectDocumentService({workingDirectory:path.join(root,"working"),incomingDirectory:path.join(root,"incoming"),backupDirectory:path.join(root,"project-backups"),
   migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",resolveCatalogueProduct:id=>getCatalogueProductSnapshot(db,id),resolveConfiguration:request=>{if(!catalogue)throw new Error("offline");return resolveConfiguration(db,request);}});
  service=make(true);await service.create({destinationPath:path.join(root,"initial.lqp"),title:"Siemens",description:"",notes:"",projectType:"industrial",executor:"",date:"2026-11-23",companyName:"",companyDescription:""});
  const added=service.addConfiguredItem({modelId,selectedOptionIds:[]},2);
  expect(added.configuredItems[0]?.demands).toBeDefined();
  const filename=path.join(root,"siemens.lqp");await service.saveAs(filename);service.close();service=make(false);
  const reopened=service.open(filename);expect(reopened.configuredItems).toEqual(added.configuredItems);expect(reopened.distinta).toEqual(added.distinta);
 }finally{service?.close();fixture.close();}
});
it("validates prepared drawings, exposes inert artwork and repairs missing installed assets on repeat import",async()=>{
 const {fixture,options,root,source}=setup(),db=fixture.lq;
 try{
  const prepared=path.join(root,"drawings"),assetsRoot=path.join(root,"assets");mkdirSync(prepared);
  const dwg=Buffer.from("synthetic source bytes"),svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -53 27 53"><path fill="none" stroke="currentColor" stroke-width="0.08" d="M 0 0 L 27 0 L 27 -53 L 0 -53 Z"/><path fill="currentColor" d=""/></svg>';
  const sourceSha256=digest(dwg),svgSha256=digest(svg);
  writeFileSync(path.join(prepared,`${sourceSha256}.dwg`),dwg);writeFileSync(path.join(prepared,`${svgSha256}.svg`),svg);
  writeFileSync(path.join(prepared,"manifest.json"),JSON.stringify({version:"3",converter:"fixture",masterSha256:digest(readFileSync(source)),drawings:[{profileId:"c",drawing:"DIN-X",sourceSha256,svgSha256}],rejected:{}}));
  const withDrawings={...options,preparedDrawings:prepared,assetsRoot};await importSienergy(withDrawings);
  expect(Object.keys(readFrontVectorAssets(db,assetsRoot,["sienergy/c"]))).toEqual(["sienergy/c"]);
  const installed=path.join(assetsRoot,"sienergy",`${svgSha256}.svg`);unlinkSync(installed);
  expect(await importSienergy(withDrawings)).toMatchObject({alreadyImported:true});expect(existsSync(installed)).toBe(true);
  const changes=db.prepare("SELECT total_changes()").pluck().get();
  writeFileSync(path.join(prepared,`${svgSha256}.svg`),svg+"<script/>");
  await expect(importSienergy(withDrawings)).rejects.toThrow("integrity");
  expect(db.prepare("SELECT total_changes()").pluck().get()).toBe(changes);
 }finally{fixture.close();}
});
it("offers only source-declared component combinations and counts their bill and DIN occupancy once",async()=>{
 const {fixture,options,source}=setup(),db=fixture.lq;
 try{
  const assembly=["3 7 f 70 00000000 ''","0 0 0 0 0","16385 0 -2 -2 '' '5ST3053+ONLY-OTHER-BRAND' '' 'Composition' 0 ;",
   "4 9 f1 24 00000000 ''","0:10[2](0 1) '' 0 1 51 ;","4 9 f2 24 00000000 ''","0:11[2](0 2) '' 0 1 19 ;"];
  writeFileSync(source,master().replace("0 10 f 0 ;",assembly.join("\n")+"\n0 10 f 0 ;"));
  const imported=await importSienergy(options);expect(imported.summary).toMatchObject({assemblyModels:1,modularAssemblies:1,accessoryModels:1});
  const modelId=db.prepare("SELECT id FROM cat_config_model WHERE code='sie.article.5ST3053'").pluck().get() as number;
  expect(db.prepare("SELECT m.code FROM cat_config_model_entry e JOIN cat_config_model m ON m.id=e.model_id WHERE e.product_id=(SELECT id FROM cat_product WHERE manufacturer_code='5ST3053')").pluck().all()).toEqual(["sie.article.5ST3053"]);
  const base=resolveConfiguration(db,{modelId,selectedOptionIds:[]});expect(base.bom).toHaveLength(1);expect(base.physical?.demands[0]?.amount).toBe(3);
  const option=db.prepare("SELECT o.id FROM cat_config_option o JOIN cat_config_dimension_value v ON v.id=o.value_id JOIN cat_config_axis a ON a.id=o.axis_id WHERE a.model_id=? AND v.code='f'").pluck().get(modelId) as number;
  const combined=resolveConfiguration(db,{modelId,selectedOptionIds:[option]});
  expect(combined.bom.map(row=>[row.manufacturerCode,row.quantity])).toEqual([["5ST3053",1],["ONLY-OTHER-BRAND",1]]);
  expect(combined.status).toBe("bom_incomplete");expect(combined.physical?.demands[0]?.amount).toBe(6);
  expect(db.prepare("SELECT din_half_modules FROM cat_product_physical").pluck().get()).toBe(3);
 }finally{fixture.close();}
});
