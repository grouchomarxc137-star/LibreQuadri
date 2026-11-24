import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { MetelImportSession } from "../src/main/metel/import-session.js";
import { encodeMetelText, parseCompleteMetelDelivery, validateMetelInputs } from "../src/main/metel/import-input.js";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { metelFamilyFile, metelLspFile, type MetelFileProduct } from "./helpers/metel-files.js";
import type { MetelInput } from "../src/shared/metel-import.js";
import { decodeMetelSource } from "../src/main/metel/parser.js";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { getCatalogueProductSnapshot, getCatalogueOverview, searchCatalogue } from "../src/main/catalogue/catalogue-queries.js";
import { browseManufacturerNodes } from "../src/main/catalogue/manufacturer-navigation.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";

const roots:string[]=[];
const sessions:MetelImportSession[]=[];
const databases:Database.Database[]=[];
afterEach(()=>{for(const s of sessions.splice(0))s.close();for(const db of databases.splice(0))db.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function setup(){
  const root=mkdtempSync(path.join(tmpdir(),"librequadri-metel-import-test-"));roots.push(root);
  mkdirSync(path.join(root,"data"));
  const db=openMigratedLqDatabase({databaseFilename:path.join(root,"data/lq.db"),backupDirectory:path.join(root,"backups"),migrationsFolder:path.resolve("db/migrations/lq")});
  databases.push(db);
  const session=new MetelImportSession({dataRoot:root,applicationRoot:path.resolve(".")});sessions.push(session);
  return {root,db,session};
}
const product=(code:string,priceCents=100,marchio="AAA"):MetelFileProduct=>({marchio,code,priceCents,description:`Article ${code}`,discountFamily:"D1",statisticalFamily:"S1"});
function delivery(products:MetelFileProduct[],date="2026-01-01",issuer="AAA"):MetelInput[]{
  const brands=[...new Set(products.map(p=>p.marchio))];
  return [
    {kind:"file",name:"misleading-fst.txt",bytes:metelLspFile({issuer,validFrom:date,products})},
    {kind:"file",name:"discount.txt",bytes:metelFamilyFile({type:"FSC",issuer,families:brands.map(marchio=>({marchio,code:"D1",description:"Discount"}))})},
    {kind:"file",name:"statistical.txt",bytes:metelFamilyFile({type:"FST",issuer,families:brands.map(marchio=>({marchio,code:"S1",description:"Statistics"}))})},
  ];
}
const snapshot=(db:Database.Database)=>JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>{
  const name=(row as {name:string}).name;return [name,db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()];
}));
async function install(session:MetelImportSession,inputs:MetelInput[]){const preview=await session.preview(inputs);return session.apply(preview.token,preview.older);}

describe("complete METEL application imports",()=>{
  it("recognizes roles by content and round-trips pasted Windows-1252 characters without trimming padding",()=>{
    const inputs=delivery([product("A")]);
    expect(parseCompleteMetelDelivery([inputs[2]!,inputs[0]!,inputs[1]!]).map(s=>s.parsed.metadata.fileType)).toEqual(["FST","LSP","FSC"]);
    const text="è é € à ç –\r\n  ";expect(decodeMetelSource(encodeMetelText(text))).toBe(text.replace("\r\n","\n"));
    expect(()=>encodeMetelText("💡")).toThrow("Windows-1252");
    expect(()=>validateMetelInputs([{kind:"file",name:"../escape",bytes:new Uint8Array([1])},...inputs.slice(1)])).toThrow("Nome sorgente");
  });

  it.each(["missing","duplicate","issuer","malformed","empty","duplicate-product","currency"])("rejects %s inputs without installed database/raw/archive changes",async kind=>{
    const {root,session,db}=setup();const before=snapshot(db);let inputs=delivery([product("A")]);
    if(kind==="missing")inputs.pop();
    if(kind==="duplicate")inputs[2]=inputs[1]!;
    if(kind==="issuer")inputs[2]=delivery([product("A")],"2026-01-01","BBB")[2]!;
    if(kind==="malformed")inputs[1]={kind:"text",name:"invalid.txt",text:"not METEL"};
    if(kind==="empty")inputs[0]={kind:"file",name:"empty.txt",bytes:metelLspFile({issuer:"AAA",validFrom:"2026-01-01",products:[]})};
    if(kind==="duplicate-product")inputs=delivery([product("A"),product("A")]);
    if(kind==="currency"){
      const original=(inputs[0] as {bytes:Uint8Array}).bytes;const bytes=Buffer.from(original);
      bytes.write("USD",177+2+125,"ascii");inputs[0]={kind:"file",name:"usd.txt",bytes};
    }
    await expect(session.preview(inputs)).rejects.toThrow();
    expect(snapshot(db)).toBe(before);expect(existsSync(path.join(root,"data/metel_raw.db"))).toBe(false);
    expect(existsSync(path.join(root,"imports"))).toBe(false);
  });

  it("rehearses changes without activation, then updates prices/data/families and delists missing products atomically",async()=>{
    const {root,session,db}=setup();await install(session,delivery([product("KEEP"),product("OLD")]));
    db.prepare("UPDATE cat_product SET description='Manual description' WHERE manufacturer_code='KEEP'").run();
    const before=snapshot(db);
    const next=delivery([{...product("KEEP",250),description:"Changed METEL description"},product("NEW",300,"BBB")],"2026-02-01");
    const preview=await session.preview(next);
    expect(preview).toMatchObject({issuer:"AAA",addedProducts:1,updatedProducts:1,changedPrices:1,delistedListings:1,newlyUnlistedProducts:1,newBrands:1});
    expect(preview.delistedExamples).toEqual(["AAA / OLD"]);expect(snapshot(db)).toBe(before);
    const result=session.apply(preview.token,false);expect(result).toMatchObject({becameCurrent:true,productCount:2,alreadyImported:false});
    expect(db.prepare("SELECT is_listed FROM cat_product WHERE manufacturer_code='OLD'").pluck().get()).toBe(0);
    expect(db.prepare("SELECT description FROM cat_product WHERE manufacturer_code='KEEP'").pluck().get()).toBe("Manual description");
    expect(db.prepare("SELECT list_price_unit_e4 FROM com_product_price p JOIN com_price_list l ON l.id=p.price_list_id AND l.is_current=1 JOIN cat_product c ON c.id=p.product_id WHERE c.manufacturer_code='KEEP'").pluck().get()).toBe(25000);
    expect(db.prepare("SELECT count(*) FROM com_price_list").pluck().get()).toBe(2);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(readdirSync(path.join(root,"backups")).filter(n=>n.startsWith("metel-"))).toHaveLength(2);
    const archive=path.join(root,"imports/metel/AAA");expect(readdirSync(archive)).toHaveLength(2);
    const rawArchive=path.join(archive,readdirSync(archive).at(-1)!);expect(readdirSync(rawArchive).sort()).toEqual(["FSC.txt","FST.txt","LSP.txt","manifest.json"]);
    expect(()=>session.apply(preview.token,false)).toThrow("Anteprima assente");
  });

  it("does not delist another issuer’s listing and reactivates articles when they return",async()=>{
    const {session,db}=setup();await install(session,delivery([product("SHARED"),product("OTHER")]));
    await install(session,delivery([product("SHARED")],"2026-01-01","BBB"));
    const preview=await session.preview(delivery([product("OTHER")],"2026-02-01"));
    expect(preview).toMatchObject({delistedListings:1,newlyUnlistedProducts:0});session.apply(preview.token,false);
    expect(db.prepare("SELECT is_listed FROM cat_product WHERE manufacturer_code='SHARED'").pluck().get()).toBe(1);
    const returning=await session.preview(delivery([product("SHARED"),product("OTHER")],"2026-03-01"));
    expect(returning.reactivatedListings).toBe(1);session.apply(returning.token,false);
  });

  it("requires explicit older-delivery acceptance and preserves the current list and listing state",async()=>{
    const {session,db}=setup();await install(session,delivery([product("A",300)],"2026-02-01"));
    const preview=await session.preview(delivery([product("A",100)],"2026-01-01"));
    expect(preview).toMatchObject({older:true,changedPrices:0,delistedListings:0});
    expect(()=>session.apply(preview.token,false)).toThrow("Conferma esplicitamente");
    expect(session.apply(preview.token,true).becameCurrent).toBe(false);
    expect(db.prepare("SELECT valid_from FROM com_price_list WHERE is_current=1").pluck().get()).toBe("2026-02-01");
  });

  it("treats repeat imports as no-ops with no extra backup or archive",async()=>{
    const {session,root,db}=setup();const inputs=delivery([product("A")]);await install(session,inputs);
    const before=snapshot(db);const backups=readdirSync(path.join(root,"backups"));
    const preview=await session.preview(inputs);expect(preview.alreadyImported).toBe(true);
    expect(session.apply(preview.token,false).alreadyImported).toBe(true);
    expect(snapshot(db)).toBe(before);expect(readdirSync(path.join(root,"backups"))).toEqual(backups);
  });

  it("rejects a stale preview after another connection writes, before making backup/archive changes",async()=>{
    const {session,db,root}=setup();const preview=await session.preview(delivery([product("A")]));
    db.prepare("INSERT INTO app_setting(key,value) VALUES('test','keep')").run();const before=snapshot(db);
    expect(()=>session.apply(preview.token,false)).toThrow("catalogo è cambiato");
    expect(snapshot(db)).toBe(before);expect(existsSync(path.join(root,"imports"))).toBe(false);
    expect(()=>session.apply(preview.token,false)).toThrow("Anteprima assente");
  });

  it("rejects a normalization failure during rehearsal with every installed table unchanged",async()=>{
    const {session,db,root}=setup();
    db.exec("CREATE TRIGGER refuse_price BEFORE INSERT ON com_product_price BEGIN SELECT RAISE(ABORT,'forced price failure'); END");
    const before=snapshot(db);
    await expect(session.preview(delivery([product("A")]))).rejects.toThrow("forced price failure");
    expect(snapshot(db)).toBe(before);expect(existsSync(path.join(root,"imports"))).toBe(false);
  });

  it("rolls back the live delivery when a failure occurs after article writes, retaining only backup/source evidence",async()=>{
    const {session,db,root}=setup();
    db.exec(`CREATE TRIGGER refuse_live_price BEFORE INSERT ON com_product_price
      WHEN (SELECT file FROM pragma_database_list WHERE name='main') NOT LIKE '%candidate.db'
      BEGIN SELECT RAISE(ABORT,'forced live price failure'); END`);
    const before=snapshot(db);
    const preview=await session.preview(delivery([product("A")]));
    expect(preview.addedProducts).toBe(1);
    expect(()=>session.apply(preview.token,false)).toThrow("forced live price failure");
    expect(snapshot(db)).toBe(before);
    expect(readdirSync(path.join(root,"imports/metel/AAA"))).toHaveLength(1);
    expect(()=>session.apply(preview.token,false)).toThrow("Anteprima assente");
  });

  it("preserves an open saved project and all of its price/discount snapshots through catalogue updates and delisting",async()=>{
    const {session,db,root}=setup();await install(session,delivery([product("A",100),product("B",200)]));
    const project=new ProjectDocumentService({workingDirectory:path.join(root,"working"),incomingDirectory:path.join(root,"incoming"),
      backupDirectory:path.join(root,"project-backups"),migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
      resolveCatalogueProduct:id=>getCatalogueProductSnapshot(db,id)});
    try{
      const filename=path.join(root,"historical.lqp");
      await project.create({destinationPath:filename,title:"Price snapshot",description:"",notes:"",projectType:"civil",executor:"",date:"2026-01-01",companyName:"",companyDescription:""});
      const id=db.prepare("SELECT id FROM cat_product WHERE manufacturer_code='A'").pluck().get() as number;
      const line=project.addCatalogueProduct(id,2).lines[0]!;
      project.setLineDiscount(line.uuid,500);
      await project.save();
      const before=project.current();const bytes=readFileSync(filename);
      await install(session,delivery([product("B",500)],"2026-02-01"));
      expect(project.current()).toEqual(before);expect(readFileSync(filename)).toEqual(bytes);
      expect(db.prepare("SELECT is_listed FROM cat_product WHERE id=?").pluck().get(id)).toBe(0);
    }finally{project.close();}
  });
});

describe("brand management and removal",()=>{
  it("protects cross-brand engineering references and refuses configurations using a disabled brand",async()=>{
    const {session,db}=setup();await install(session,delivery([product("A"),product("B",100,"BBB")]));
    const manager=session.brands(),brand=manager.list().find(b=>b.code==="AAA")!;
    const other=manager.list().find(b=>b.code==="BBB")!;
    const model=Number(db.prepare(`INSERT INTO cat_config_model(brand_id,code,name,model_kind,definition_fingerprint,source)
      VALUES(?,'cross-brand','Cross brand','device','fingerprint','manual')`).run(other.id).lastInsertRowid);
    db.prepare(`INSERT INTO cat_config_model_article(model_id,seq,ref_brand_marchio,ref_manufacturer_code,quantity,role)
      VALUES(?,1,'AAA','A',1,'primary')`).run(model);
    // Even an unresolved explicit brand reference prevents destructive cleanup.
    expect(manager.previewRemoval(brand.id).blockers.join(" ")).toContain("Altri modelli");
    db.prepare("UPDATE cat_config_model_article SET product_id=(SELECT id FROM cat_product WHERE brand_id=?) WHERE model_id=?").run(brand.id,model);
    manager.setActive(brand.id,false);
    const resolution=resolveConfiguration(db,{modelId:model,selectedOptionIds:[]});
    expect(resolution.status).toBe("invalid");expect(resolution.fingerprint).toBeNull();
    expect(resolution.issues.some(i=>i.code==="inactive_brand")).toBe(true);
  });

  it("preserves saved and open project snapshots through removal and reopen",async()=>{
    const {session,db,root}=setup();await install(session,delivery([product("A",100)]));
    const project=new ProjectDocumentService({workingDirectory:path.join(root,"working"),incomingDirectory:path.join(root,"incoming"),
      backupDirectory:path.join(root,"project-backups"),migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
      resolveCatalogueProduct:id=>getCatalogueProductSnapshot(db,id)});
    try {
      const filename=path.join(root,"preserved.lqp");
      await project.create({destinationPath:filename,title:"Preserved",description:"",notes:"",projectType:"civil",executor:"",date:"2026-01-01",companyName:"",companyDescription:""});
      const id=db.prepare("SELECT id FROM cat_product").pluck().get() as number;
      const line=project.addCatalogueProduct(id,2).lines[0]!;project.setLineDiscount(line.uuid,500);await project.save();
      const before=project.current(),bytes=readFileSync(filename),manager=session.brands();
      manager.remove(manager.previewRemoval(manager.list()[0]!.id).token);
      expect(project.current()).toEqual(before);expect(readFileSync(filename)).toEqual(bytes);
      project.close();await project.open(filename);
      expect(project.current()?.lines).toEqual(before?.lines);
      expect(()=>project.addCatalogueProduct(id,1)).toThrow();
    } finally {project.close();}
  });

  it("disables a brand across search/navigation/direct selection, preserves it on updates, and reactivates",async()=>{
    const {session,db}=setup();
    const inputs=delivery([product("ARTICLE-A"),product("ARTICLE-B",200,"BBB")]);
    await install(session,inputs);
    const manager=session.brands(),brand=manager.list().find(b=>b.code==="AAA")!;
    const id=db.prepare("SELECT id FROM cat_product WHERE brand_id=?").pluck().get(brand.id) as number;
    manager.setActive(brand.id,false);
    expect(getCatalogueOverview(db).productCount).toBe(1);
    expect(searchCatalogue(db,{query:"ARTICLE"}).products.map(p=>p.brandMarchio)).toEqual(["BBB"]);
    expect(browseManufacturerNodes(db).every(n=>n.brandMarchio!=="AAA")).toBe(true);
    expect(()=>getCatalogueProductSnapshot(db,id)).toThrow();
    await install(session,inputs);
    await install(session,delivery([product("ARTICLE-A",300),product("ARTICLE-B",200,"BBB")],"2026-02-01"));
    expect(manager.list().find(b=>b.id===brand.id)?.active).toBe(false);
    manager.setActive(brand.id,true);
    expect(getCatalogueOverview(db).productCount).toBe(2);
    expect(getCatalogueProductSnapshot(db,id).listPriceUnitE4).toBe(30000);
  });

  it("removes commercial data atomically and restores the same multi-brand files without touching another brand",async()=>{
    const {session,db,root}=setup();
    const inputs=delivery([product("KEEP-ID"),product("LEAVE-ALONE",200,"BBB")]);
    await install(session,inputs);
    const manager=session.brands(),brand=manager.list().find(b=>b.code==="AAA")!;
    const id=db.prepare("SELECT id FROM cat_product WHERE brand_id=?").pluck().get(brand.id) as number;
    const other=()=>db.prepare("SELECT p.* FROM cat_product p JOIN cat_brand b ON b.id=p.brand_id WHERE b.metel_marchio='BBB'").get();
    const before=other(),plan=manager.previewRemoval(brand.id);
    expect(plan.blockers).toEqual([]);expect(plan.prices).toBe(1);expect(plan.families).toBe(2);
    manager.remove(plan.token);
    expect(()=>manager.remove(plan.token)).toThrow("Anteprima");
    expect(manager.list().find(b=>b.id===brand.id)).toMatchObject({removed:true,active:false,products:0});
    expect(()=>manager.setActive(brand.id,true)).toThrow("Reimporta");
    expect(db.prepare("SELECT id,import_removed,short_description FROM cat_product WHERE id=?").get(id))
      .toEqual({id,import_removed:1,short_description:null});
    expect(other()).toEqual(before);
    expect(readdirSync(path.join(root,"backups")).some(name=>name.startsWith("brand-"))).toBe(true);
    expect(existsSync(path.join(root,"imports","metel","AAA"))).toBe(true);
    const preview=await session.preview(inputs);expect(preview.alreadyImported).toBe(false);
    session.apply(preview.token,false);
    expect(manager.list().find(b=>b.id===brand.id)).toMatchObject({removed:false,active:true,products:1});
    expect(getCatalogueProductSnapshot(db,id).manufacturerCode).toBe("KEEP-ID");
    expect(other()).toEqual(before);
    expect((await session.preview(inputs)).alreadyImported).toBe(true);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("restores removed listings separately for each issuer",async()=>{
    const {session,db}=setup();
    const first=delivery([product("A")]),second=delivery([product("A",200)],"2026-02-01","BBB");
    await install(session,first);await install(session,second);
    const manager=session.brands(),brand=manager.list().find(b=>b.code==="AAA")!;
    manager.remove(manager.previewRemoval(brand.id).token);
    await install(session,first);
    expect(db.prepare("SELECT COUNT(*) FROM app_removed_brand_listing").pluck().get()).toBe(1);
    await install(session,second);
    expect(db.prepare("SELECT COUNT(*) FROM app_removed_brand_listing").pluck().get()).toBe(0);
    expect(db.prepare("SELECT COUNT(*) FROM cat_product_listing WHERE is_listed=1").pluck().get()).toBe(2);
  });

  it("does not expose retained identity stubs absent from a newly installed delivery",async()=>{
    const {session,db}=setup();
    await install(session,delivery([product("A"),product("MISSING")]));
    const manager=session.brands(),brand=manager.list()[0]!;
    manager.remove(manager.previewRemoval(brand.id).token);
    await install(session,delivery([product("A")],"2026-02-01"));
    expect(getCatalogueOverview(db).productCount).toBe(1);
    expect(searchCatalogue(db,{query:"MISSING",listedOnly:false}).products).toEqual([]);
    expect(manager.list()[0]?.products).toBe(1);
  });

  it("refuses stale removal previews and rolls all removal writes back after a live failure",async()=>{
    const {session,db}=setup();await install(session,delivery([product("A")]));
    const manager=session.brands(),brand=manager.list()[0]!;
    const stale=manager.previewRemoval(brand.id);
    db.exec("INSERT INTO app_setting(key,value) VALUES('external-write','1')");
    expect(()=>manager.remove(stale.token)).toThrow("cambiato");
    db.exec("CREATE TRIGGER fail_brand_removal BEFORE UPDATE ON cat_brand WHEN NEW.import_removed=1 BEGIN SELECT RAISE(ABORT,'injected removal failure'); END");
    const before=snapshot(db),plan=manager.previewRemoval(brand.id);
    expect(()=>manager.remove(plan.token)).toThrow("injected removal failure");
    expect(snapshot(db)).toBe(before);
    expect(db.pragma("quick_check",{simple:true})).toBe("ok");
  });

  it("blocks engineering-dependent removal but still permits deactivation",async()=>{
    const {session,db}=setup();await install(session,delivery([product("A")]));
    const manager=session.brands(),brand=manager.list()[0]!;
    db.prepare(`INSERT INTO cat_config_model(brand_id,code,name,model_kind,definition_fingerprint,source)
      VALUES(?,'manual-model','Model','device','fingerprint','manual')`).run(brand.id);
    const plan=manager.previewRemoval(brand.id);expect(plan.blockers.join(" ")).toContain("modelli");
    expect(()=>manager.remove(plan.token)).toThrow("modelli");
    manager.setActive(brand.id,false);expect(manager.list()[0]?.active).toBe(false);
  });
});
