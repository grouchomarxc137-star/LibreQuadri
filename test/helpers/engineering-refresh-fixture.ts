import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createCatalogueFixture } from "./catalogue-fixtures.js";
import { EngineeringDataWriter } from "../../src/main/sources/engineering-writer.js";
import { ENGINEERING_ADAPTERS } from "../../src/main/sources/engineering-adapters.js";
import { ProjectDocumentService } from "../../src/main/project/project-document-service.js";
import { resolveConfiguration } from "../../src/main/catalogue/configuration-resolver.js";
import { getCatalogueProductSnapshot } from "../../src/main/catalogue/catalogue-queries.js";
import { guardDesignCandidate, guardConfiguredStructuralItem, discoverDesignCandidates, discoverDesignRangeNodes } from "../../src/main/project/design-compatibility.js";
export const adapter=ENGINEERING_ADAPTERS[0]!;
export async function engineeringRefreshFixture() {
  const f=createCatalogueFixture(),db=f.lq;
  const writer=new EngineeringDataWriter(db);
  db.exec(`INSERT INTO cat_brand(id,metel_marchio,name,source) VALUES(1,'GEN','Generic','manual');
    INSERT INTO cat_phys_class(id,code,name,source) VALUES(1,'frame','Frame','manual'),(2,'panel','Panel','manual');
    INSERT INTO cat_phys_profile_set(id,code,name,source) VALUES(1,'set','Set','manual');
    INSERT INTO cat_phys_profile(id,code,profile_set_id,profile_kind,name,fit_class_id,source) VALUES
      (1,'frame',1,'enclosure','Frame',1,'manual'),(2,'panel',1,'support','Panel',2,'manual'),
      (3,'device',1,'device','Device',2,'manual');
    INSERT INTO cat_phys_view(profile_id,view_code,width_mm,height_mm,insert_dx_mm,insert_dy_mm,symbol_kind) VALUES
      (1,'front',500,1000,0,0,'rectangle'),(2,'front',500,100,0,0,'rectangle'),(3,'front',18,80,0,0,'rectangle');
    INSERT INTO cat_phys_zone(profile_id,zone_no,layout,capacity_amount,origin_x_mm,origin_y_mm,
      length_mm,breadth_mm,direction,pitch_mm,required_view_code)
      VALUES(1,0,'stack',1000,0,0,1000,500,'vertical',1,'front');
    INSERT INTO cat_capacity_kind(code,name,unit_label,display_divisor,nominal_pitch_mm,source)
      VALUES('rail','Rail','modules',1,18,'manual');
    INSERT INTO cat_phys_zone(profile_id,zone_no,layout,capacity_kind_code,capacity_amount,
      origin_x_mm,origin_y_mm,direction,required_view_code)
      VALUES(2,0,'linear','rail',20,0,0,'horizontal','front');
    INSERT INTO cat_phys_profile_demand(profile_id,capacity_kind_code,amount) VALUES(3,'rail',1);
    INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,base_profile_id,definition_fingerprint,
      source,context_policy,commercial_contribution) VALUES
      (1,1,'frame','Frame','enclosure',1,'definition','import','unrestricted','none'),
      (2,1,'panel','Panel','support',2,'definition','import','unrestricted','none'),
      (3,1,'device','Device','device',3,'definition','import','unrestricted','none');
    INSERT INTO cat_range_node(id,brand_id,code,name,node_kind,source,design_navigable)
      VALUES(1,1,'models','Models','section','manual',1);
    INSERT INTO cat_range_node_model(node_id,model_id) VALUES(1,1),(1,2),(1,3);`);

  const importVersion=(version=adapter.version,fingerprint="a".repeat(64))=>writer.transaction(()=>{
    const id=writer.beginImport({adapterCode:adapter.code,adapterVersion:version,sourceLabel:"Generic",fingerprint,
      importedAt:"2026-10-06",files:[]});
    db.prepare("UPDATE cat_config_model SET source_import_id=? WHERE source='import'").run(id);writer.finishImport(id,{});return id;
  });
  importVersion();
  db.exec(`INSERT INTO cat_config_dimension(id,brand_id,code,name,source) VALUES(1,1,'mount','Mount','manual');
    INSERT INTO cat_config_dimension_value(id,dimension_id,code,label,source) VALUES(1,1,'A','Mount A','manual');
    INSERT INTO cat_config_axis(id,model_id,dimension_id,label,sort_order,visibility,requirement,binding,editable_when_placed,selects_primary)
      VALUES(1,2,1,'Mount',0,'visible','required','none',0,0);
    INSERT INTO cat_config_option(id,axis_id,value_id,is_default,visible,active,sort_order) VALUES(1,1,1,1,1,1,0);`);
  f.importDelivery({issuer:"GEN",listino:"1",validFrom:"2026-09-01",products:[{marchio:"GEN",code:"PART",priceCents:1000,description:"Part"}]});
  const productId=db.prepare("SELECT id FROM cat_product WHERE manufacturer_code='PART'").pluck().get() as number;
  db.prepare("UPDATE cat_config_model SET commercial_contribution='articles' WHERE id=3").run();
  db.prepare(`INSERT INTO cat_config_model_article(model_id,seq,product_id,ref_brand_marchio,ref_manufacturer_code,quantity,role)
    VALUES(3,0,?,'GEN','PART',1,'primary')`).run(productId);
  const root=mkdtempSync(path.join(tmpdir(),"librequadri-refresh-test-")),file=path.join(root,"case.lqp");
  let catalogueAvailable=true;
  const options={workingDirectory:path.join(root,"working"),incomingDirectory:path.join(root,"incoming"),backupDirectory:path.join(root,"backups"),
    migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",engineeringCatalogue:()=>catalogueAvailable?db:null,
    resolveConfiguration:(request:Parameters<typeof resolveConfiguration>[1])=>resolveConfiguration(db,request),
    resolveCatalogueProduct:(id:number)=>getCatalogueProductSnapshot(db,id),
    designGuard:(project:Database.Database,request:Parameters<typeof guardDesignCandidate>[2],configuration:Parameters<typeof resolveConfiguration>[1])=>guardDesignCandidate(db,project,request,{mode:"add",configuration}),
    designItemGuard:(project:Database.Database,request:Parameters<typeof guardConfiguredStructuralItem>[2])=>guardConfiguredStructuralItem(db,project,request),
    designDiscover:(project:Database.Database,request:Parameters<typeof discoverDesignCandidates>[2])=>({...discoverDesignCandidates(db,project,request),candidates:[]}),
    designNavigation:(project:Database.Database,request:Parameters<typeof discoverDesignRangeNodes>[2])=>({...discoverDesignRangeNodes(db,project,request),candidates:[]})};
  const service=new ProjectDocumentService(options);
  await service.create({destinationPath:file,title:"Refresh",description:"",notes:"",projectType:"civil",executor:"",date:"2026-10-06",companyName:"",companyDescription:""});
  const frame=service.addConfiguredItem({modelId:1,selectedOptionIds:[]}).configuredItems.find(item=>item.modelCode==="frame")!.uuid;
  const panel=service.addConfiguredItem({modelId:2,selectedOptionIds:[1]},2).configuredItems.find(item=>item.modelCode==="panel")!.uuid;
  const device=service.addConfiguredItem({modelId:3,selectedOptionIds:[]},2).configuredItems.find(item=>item.modelCode==="device")!.uuid;
  const frameNode=service.placeRoot({itemUuid:frame,viewCode:"front",rootXMm:50,rootYMm:40}).physicalNodes[0]!.uuid;
  const panelNode=service.placeChild({itemUuid:panel,parentUuid:frameNode,zoneNo:0,startUnits:0,viewCode:"front"}).physicalNodes[0]!.children[0]!.uuid;
  const deviceLine=service.current()!.lines.find(line=>line.itemUuid===device)!.uuid;
  service.setComponentDiscount(device,0,1250);service.setGlobalDiscount(1500);service.setLabourTotal(230_000);
  await service.save();
  const working=new Database(path.join(root,"working",readdirSync(path.join(root,"working")).find(name=>name.endsWith(".lqp"))!));
  working.pragma("foreign_keys = ON");
  const stale=async(legacy=false)=>{
    working.prepare("UPDATE prj_item_selection SET binding='match_container' WHERE item_id=(SELECT id FROM prj_item WHERE uuid=?)").run(panel);
    if(legacy)working.exec("UPDATE prj_item SET engineering_provenance=NULL,source_adapter_code=NULL,source_adapter_version=NULL,source_import_fingerprint=NULL");
    else working.prepare("UPDATE prj_item SET source_adapter_version=? WHERE uuid=?").run(String(BigInt(adapter.version)-1n),panel);
    service.setQuantity(deviceLine,2);await service.save();
  };
  const input={itemUuid:device,parentUuid:panelNode,zoneNo:0,startUnits:0,viewCode:"front"};
  const commerce=()=>["prj_item_bom","prj_product_snapshot","prj_product_snapshot_attribute","prj_line","prj_project","prj_group","prj_node","prj_annotation","prj_asset","lqp_meta"].map(table=>working.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  return {f,db,root,file,working,service,options,frame,panel,device,frameNode,panelNode,deviceLine,input,stale,commerce,importVersion,
    unavailable:()=>{catalogueAvailable=false;},close:()=>{working.close();service.close();f.close();rmSync(root,{recursive:true,force:true});}};
}
