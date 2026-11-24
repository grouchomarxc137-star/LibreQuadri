import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { findConfigurationModel, getConfigurationModel, listNodeModels, listProductModels } from "../src/main/catalogue/configuration-queries.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";
import { EngineeringDataStaleError, readEngineeringReadiness } from "../src/main/catalogue/engineering-readiness.js";
import { getCatalogueProductSnapshot, searchCatalogue } from "../src/main/catalogue/catalogue-queries.js";
import { discoverDesignCandidates, discoverDesignRangeNodes, guardConfiguredStructuralItem,
  guardDesignCandidate } from "../src/main/project/design-compatibility.js";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { EngineeringDataWriter } from "../src/main/sources/engineering-writer.js";
import { TIQUADRI_ENGINEERING_ADAPTER as adapter } from "../src/main/sources/tiquadri/adapter.js";
import { createCatalogueFixture } from "./helpers/catalogue-fixtures.js";

const cleanup:Array<()=>void>=[];
afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();});
const older=String(BigInt(adapter.version)-1n);
const newer=String(BigInt(adapter.version)+1n);

function fixture() {
  const f=createCatalogueFixture();cleanup.push(()=>f.close());
  const db=f.lq;
  const writer=new EngineeringDataWriter(db);
  const importVersion=(version:string,fingerprint=version.padStart(64,"0"))=>writer.transaction(()=>{
    const id=writer.beginImport({adapterCode:adapter.code,adapterVersion:version,
      sourceLabel:"Generic fixture",fingerprint,importedAt:"2026-10-06",
      files:[{role:"master",sha256:"a".repeat(64),name:"fixture.mdb",byteSize:1}]});
    db.prepare("UPDATE cat_config_model SET source_import_id=? WHERE source='import'").run(id);
    writer.finishImport(id,{});
    return id;
  });
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
  const id=importVersion(adapter.version);
  return {...f,db,writer,importVersion,id};
}
const state=(db:Database.Database)=>readEngineeringReadiness(db).sources[0]!;

async function project(f:ReturnType<typeof fixture>) {
  const folder=mkdtempSync(path.join(tmpdir(),"librequadri-adapter-project-"));
  cleanup.push(()=>rmSync(folder,{recursive:true,force:true}));
  const service=new ProjectDocumentService({workingDirectory:path.join(folder,"working"),
    incomingDirectory:path.join(folder,"incoming"),backupDirectory:path.join(folder,"backups"),
    migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
    resolveCatalogueProduct:id=>getCatalogueProductSnapshot(f.db,id),
    resolveConfiguration:request=>resolveConfiguration(f.db,request),
    designDiscover:(db,request)=>({...discoverDesignCandidates(f.db,db,request),candidates:[]}),
    designNavigation:(db,request)=>({...discoverDesignRangeNodes(f.db,db,request),candidates:[]}),
    designGuard:(db,request,configuration)=>guardDesignCandidate(f.db,db,request,{mode:"add",configuration}),
    designItemGuard:(db,request)=>guardConfiguredStructuralItem(f.db,db,request)});
  cleanup.push(()=>service.close());
  await service.create({destinationPath:path.join(folder,"case.lqp"),title:"Lifecycle",description:"",notes:"",
    projectType:"civil",executor:"",date:"2026-10-06",companyName:"",companyDescription:""});
  return service;
}
const configuration=(modelId:number)=>({modelId,selectedOptionIds:[]});

describe("engineering adapter lifecycle",()=>{
  it("keeps a missing source distinct from a stale import",async()=>{
    const f=fixture();
    f.db.exec("DELETE FROM cat_range_node_model; DELETE FROM cat_config_model; DELETE FROM app_source_import_file; DELETE FROM app_source_import");
    expect(state(f.db)).toMatchObject({status:"missing",reason:"not_imported",installedVersion:null,importIds:[]});
    const service=await project(f);
    expect(service.designDiscover("enclosure")).toMatchObject({status:"ready",candidates:[],staleImportIds:[]});
    expect(service.designDiscover("support")).toMatchObject({status:"container_unavailable"});
  });

  it("makes equal versions ready and automatically becomes stale when the declared version increments",()=>{
    const f=fixture();
    expect(state(f.db)).toEqual({adapterCode:adapter.code,installedVersion:adapter.version,
      requiredVersion:adapter.version,importFingerprint:adapter.version.padStart(64,"0"),status:"ready",reason:"current",importIds:[f.id]});
    expect(resolveConfiguration(f.db,configuration(1)).status).toBe("complete");
    const bumped=readEngineeringReadiness(f.db,[{...adapter,version:newer}]);
    expect(bumped.sources[0]).toMatchObject({status:"engineering_data_stale",installedVersion:adapter.version,
      requiredVersion:newer,reason:"version_mismatch"});
    expect(bumped.staleModel({source:"import",sourceImportId:f.id})?.status).toBe("engineering_data_stale");
  });

  it.each([older,newer])("fails closed for a mismatching installed version %s",version=>{
    const f=fixture();f.db.prepare("UPDATE app_source_import SET adapter_version=?").run(version);
    expect(state(f.db)).toMatchObject({status:"engineering_data_stale",installedVersion:version,
      requiredVersion:adapter.version,reason:"version_mismatch"});
    expect(()=>getConfigurationModel(f.db,1)).toThrow(EngineeringDataStaleError);
    expect(()=>listNodeModels(f.db,1)).toThrow(EngineeringDataStaleError);
    expect(()=>findConfigurationModel(f.db,"GEN","frame")).toThrow(EngineeringDataStaleError);
    try{resolveConfiguration(f.db,configuration(1));throw Error("Unexpected resolution");}
    catch(error){expect(error).toMatchObject({code:"engineering_data_stale",source:state(f.db)});}
  });

  it.each([""," ","garbage","8.0","08","-1","0"])("rejects malformed version metadata %j",version=>{
    const f=fixture();f.db.prepare("UPDATE app_source_import SET adapter_version=?").run(version);
    expect(state(f.db)).toMatchObject({status:"engineering_data_stale",reason:"invalid_version"});
    expect(()=>resolveConfiguration(f.db,configuration(2))).toThrow("I dati di ingegneria sono obsoleti: reimporta il catalogo.");
  });

  it("rejects null version metadata and missing provenance without inferring a version from summaries",()=>{
    const broken=new Database(":memory:");cleanup.push(()=>broken.close());
    broken.exec(`CREATE TABLE app_source_import(id INTEGER,adapter_code TEXT,adapter_version TEXT,became_current INTEGER,fingerprint TEXT);
      INSERT INTO app_source_import VALUES(1,'tiquadri',NULL,1,NULL)`);
    expect(state(broken)).toMatchObject({status:"engineering_data_stale",installedVersion:null,reason:"invalid_version"});
    const f=fixture();
    f.db.exec("UPDATE cat_config_model SET source_import_id=NULL WHERE id=2");
    expect(()=>resolveConfiguration(f.db,configuration(2))).toThrow(EngineeringDataStaleError);
    expect(readEngineeringReadiness(f.db).staleModel({source:"import",sourceImportId:999}))
      .toMatchObject({status:"engineering_data_stale",reason:"missing_provenance",importIds:[999]});
  });

  it.each(["A".repeat(64),"z".repeat(64),"short"])("refuses malformed portable import fingerprints %s",fingerprint=>{
    const f=fixture();f.db.pragma("ignore_check_constraints = ON");
    f.db.prepare("UPDATE app_source_import SET fingerprint=?").run(fingerprint);
    expect(state(f.db)).toMatchObject({status:"engineering_data_stale",reason:"invalid_fingerprint"});
    expect(()=>resolveConfiguration(f.db,configuration(1))).toThrow(EngineeringDataStaleError);
  });

  it("rejects absent or ambiguous current markers and models referencing an old generation",()=>{
    const f=fixture();
    f.db.exec("UPDATE app_source_import SET became_current=0");
    expect(state(f.db)).toMatchObject({status:"engineering_data_stale",reason:"missing_current_import"});
    const current=f.importVersion(adapter.version,"b".repeat(64));
    f.db.prepare("UPDATE cat_config_model SET source_import_id=? WHERE id=2").run(f.id);
    expect(()=>resolveConfiguration(f.db,configuration(2))).toThrow(EngineeringDataStaleError);
    expect(readEngineeringReadiness(f.db).staleModel({source:"import",sourceImportId:f.id}))
      .toMatchObject({reason:"noncurrent_import",importIds:[f.id]});
    f.db.exec("UPDATE app_source_import SET became_current=1");
    expect(state(f.db)).toMatchObject({status:"engineering_data_stale",reason:"ambiguous_current_import",importIds:[f.id,current]});
  });

  it("blocks structural discovery, configuration, add/reconfigure and catalogue-backed pool placement atomically",async()=>{
    const f=fixture(),service=await project(f);
    const root=service.addStructural({kind:"enclosure",configuration:configuration(1)}).physicalNodes[0]!;
    const ready=service.addStructural({kind:"support",parentUuid:root.uuid,place:false,configuration:configuration(2)});
    const panel=ready.configuredItems.find(item=>item.modelCode==="panel")!;
    const line=ready.lines.find(item=>item.itemUuid===panel.uuid)!;
    // One placed support supplies a real Pannello context for Apparecchio discovery;
    // a second unit remains pooled for the catalogue-backed first-placement guard.
    const placed=service.addStructural({kind:"support",parentUuid:root.uuid,configuration:configuration(2)});
    const panelNode=placed.physicalNodes[0]!.children[0]!;
    expect(service.designDiscover("device",panelNode.uuid).status).toBe("ready");
    expect(service.designDiscover("support",root.uuid).status).toBe("ready");
    expect(service.placementTargets({itemUuid:panel.uuid,parentUuid:root.uuid}).targets.length).toBeGreaterThan(0);
    f.db.prepare("UPDATE app_source_import SET adapter_version=?").run(older);
    const before=service.current();
    for(const [kind,parent] of [["enclosure",undefined],["support",root.uuid],["device",panelNode.uuid]] as const){
      expect(service.designDiscover(kind,parent)).toMatchObject({status:"engineering_data_stale",candidates:[],staleImportIds:[f.id]});
      expect(service.designNavigation(kind,parent)).toMatchObject({status:"engineering_data_stale",nodes:[],candidates:[]});
    }
    expect(()=>service.addStructural({kind:"enclosure",configuration:configuration(1)})).toThrow(EngineeringDataStaleError);
    expect(()=>service.addConfiguredItem(configuration(2))).toThrow(EngineeringDataStaleError);
    expect(()=>service.addStructural({kind:"device",parentUuid:panelNode.uuid,place:false,
      configuration:configuration(3)})).toThrow(EngineeringDataStaleError);
    expect(()=>service.replaceConfiguredItem(line.uuid,configuration(2))).toThrow(EngineeringDataStaleError);
    expect(service.placementTargets({itemUuid:panel.uuid,parentUuid:root.uuid}))
      .toMatchObject({targets:[],diagnostics:[{code:"engineering_data_stale"}]});
    expect(()=>service.placeStructuralItem({action:"insertPackedChild",input:{itemUuid:panel.uuid,
      parentUuid:root.uuid,zoneNo:0,viewCode:"front"}})).toThrow("engineering_data_stale");
    expect(service.current()).toEqual(before);
    // A committed current interpretation clears the guard without restarting the service.
    f.importVersion(adapter.version,"c".repeat(64));
    expect(state(f.db).status).toBe("ready");
    expect(service.designDiscover("support",root.uuid).status).toBe("ready");
    expect(service.placeStructuralItem({action:"insertPackedChild",input:{itemUuid:panel.uuid,
      parentUuid:root.uuid,zoneNo:0,viewCode:"front"}}).physicalNodes[0]!.children).toHaveLength(2);
  });

  it("preserves context staleness, container failures, manual models and failed-import rollback",async()=>{
    const f=fixture(),service=await project(f);
    f.db.exec("UPDATE cat_config_model SET context_policy='unknown' WHERE id=1");
    expect(service.designDiscover("enclosure")).toMatchObject({status:"engineering_data_stale",staleImportIds:[f.id]});
    f.db.exec("UPDATE cat_config_model SET source='manual' WHERE id=1");
    expect(service.designDiscover("enclosure")).toMatchObject({status:"ready",candidates:[],contextDataUnavailable:1});
    expect(service.designDiscover("support","missing").status).toBe("container_unavailable");
    const before=state(f.db);
    expect(()=>f.writer.transaction(()=>{
      const id=f.writer.beginImport({adapterCode:adapter.code,adapterVersion:newer,sourceLabel:"Failed",
        fingerprint:"d".repeat(64),importedAt:"2026-10-06",files:[]});
      f.db.prepare("UPDATE cat_config_model SET source_import_id=?,context_policy='unknown' WHERE id=2").run(id);
      f.writer.finishImport(id,{});
    })).toThrow("unknown context policy");
    expect(state(f.db)).toEqual(before);
  });

  it("keeps commercial METEL search, price snapshots and ordinary article insertion usable while engineering is stale",async()=>{
    const f=fixture(),service=await project(f);
    f.importDelivery({issuer:"GEN",listino:"1",validFrom:"2026-10-06",products:[{marchio:"GEN",code:"COMMERCIAL"}]});
    f.db.prepare("UPDATE app_source_import SET adapter_version=?").run(older);
    const result=searchCatalogue(f.db,{query:"COMMERCIAL"});
    expect(result.products).toHaveLength(1);
    const product=result.products[0]!;
    f.db.prepare("INSERT INTO cat_config_model_entry(product_id,model_id) VALUES(?,3)").run(product.id);
    expect(()=>listProductModels(f.db,product.id)).toThrow(EngineeringDataStaleError);
    expect(getCatalogueProductSnapshot(f.db,product.id).manufacturerCode).toBe("COMMERCIAL");
    expect(service.addCatalogueProduct(product.id).lines).toHaveLength(1);
    f.db.exec("UPDATE cat_config_model SET source='manual' WHERE id=1");
    expect(resolveConfiguration(f.db,configuration(1)).status).toBe("complete");
  });
});
