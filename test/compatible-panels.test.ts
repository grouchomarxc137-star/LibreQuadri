import { TIQUADRI_ENGINEERING_ADAPTER } from "../src/main/sources/tiquadri/adapter.js";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { openCurrentProjectDatabase } from "../src/main/database/project-migrations.js";
import { discoverReferenceDevices, discoverCompatiblePanels, checkConfiguredPanelReference,
  discoverCompatibleEnclosures, discoverEnclosureReferenceDevices, discoverDesignCandidates, guardDesignCandidate } from "../src/main/project/design-compatibility.js";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";
import type { CompatiblePanelsRequest } from "../src/shared/project.js";
function fixture() {
  const folder=mkdtempSync(path.join(tmpdir(),"librequadri-design-"));
  const catalogue=openMigratedLqDatabase({databaseFilename:path.join(folder,"lq.db"),
    backupDirectory:path.join(folder,"backups"),migrationsFolder:path.resolve("db/migrations/lq")});
  const project=openCurrentProjectDatabase(path.join(folder,"project.lqp"),path.resolve("db/migrations/project"));
  catalogue.exec(`INSERT INTO cat_brand(id,metel_marchio,name,source) VALUES(1,'ACME','Acme','manual');
    INSERT INTO app_source_import(id,adapter_code,adapter_version,source_label,fingerprint,imported_at,became_current,summary_json)
      VALUES(1,'listino_bt','1','Example','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-09-25',1,'{}');
    INSERT INTO cat_phys_class(id,code,name,source) VALUES
      (1,'FRAME','Frame','manual'),(2,'SUPPORT','Support','manual'),(3,'PANEL','Panel','manual');
    INSERT INTO cat_phys_profile_set(id,code,name,source) VALUES(1,'set','Set','manual');
    INSERT INTO cat_phys_profile(id,code,profile_set_id,profile_kind,name,fit_class_id,source)
      VALUES(1,'root',1,'enclosure','Root',1,'manual'),
      (2,'panel',1,'support','Panel',3,'manual'),
      (3,'other',1,'support','Other',3,'manual');
    INSERT INTO cat_phys_accept_set(id,code,source) VALUES(1,'frame','manual');
    INSERT INTO cat_phys_accept_set_member(set_id,class_id) VALUES(1,1);
    INSERT INTO cat_phys_constraint(profile_id,relation,accept_set_id) VALUES(2,'ancestor',1),(3,'ancestor',1);
    INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,base_profile_id,definition_fingerprint,source,context_policy,source_import_id)
      VALUES(1,1,'box','Box','enclosure',1,'fingerprint','import','unrestricted',1),
      (2,1,'good','Good','support',2,'fingerprint','import','restricted',1),
      (3,1,'wrong','Wrong','support',3,'fingerprint','import','restricted',1);
    INSERT INTO cat_config_context(id,brand_id,code,name,source,source_import_id)
      VALUES(1,1,'family.50','Family 50','import',1),(2,1,'family.40','Family 40','import',1);
    INSERT INTO cat_config_model_context(model_id,role,context_id)
      VALUES(1,'provides',1),(2,'accepts',1),(3,'accepts',2);
    INSERT INTO cat_range_node(id,brand_id,code,name,node_kind,source,design_navigable)
      VALUES(1,1,'structural','Structural','section','import',1);
    INSERT INTO cat_range_node_model(node_id,model_id) VALUES(1,1),(1,2),(1,3);`);
  project.exec(`INSERT INTO prj_group(id,uuid,name,sort_order) VALUES(1,'${randomUUID()}','Quote',0);
    INSERT INTO prj_item(id,uuid,model_brand_marchio,model_code,model_name,model_kind,
      model_definition_fingerprint,config_fingerprint,config_label,config_status,phys_status,
      profile_code,profile_name,fit_class_code,fit_class_label,snapshot_taken_at)
      VALUES(1,'root-item','ACME','box','Box','enclosure','fingerprint','config','Box','complete',
        'resolved','root','Root','FRAME','Frame','2026-09-25');
    INSERT INTO prj_line(uuid,group_id,sort_order,line_type,item_id,quantity)
      VALUES('root-line',1,0,'item',1,1);
    INSERT INTO prj_node(id,uuid,item_id,node_kind,root_x_mm,root_y_mm,view_code,sort_order)
      VALUES(1,'root-node',1,'enclosure',0,0,'front',0);`);
  return {catalogue,project,close(){project.close();catalogue.close();rmSync(folder,{recursive:true,force:true});}};
}

function setup(){
  const f=fixture();
  f.catalogue.exec(`UPDATE cat_config_model SET commercial_contribution='none' WHERE model_kind='support';
    INSERT INTO cat_phys_profile(id,code,profile_set_id,profile_kind,name,fit_class_id,source) VALUES
      (4,'device-base',1,'device','Base',2,'manual'),
      (5,'device-option',1,'device','Option',2,'manual'),
      (6,'panel-option',1,'support','Changed panel',2,'manual');
    INSERT INTO cat_phys_accept_set(id,code,source) VALUES(2,'other-panels','manual'),(3,'panels','manual');
    INSERT INTO cat_phys_accept_set_member(set_id,class_id) VALUES(2,2),(3,3);
    INSERT INTO cat_phys_constraint(profile_id,relation,accept_set_id) VALUES
      (4,'parent',2),(4,'ancestor',2),(5,'parent',3),(5,'ancestor',1),(6,'ancestor',1);
    INSERT INTO cat_phys_view(profile_id,view_code,width_mm,height_mm,symbol_kind)
      VALUES(2,'front',500,100,'rectangle'),(3,'front',500,100,'rectangle'),(6,'front',500,100,'rectangle');
    INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,base_profile_id,definition_fingerprint,
      source,context_policy,commercial_contribution) VALUES
      (4,1,'device','Device','device',4,'device-definition','manual','unrestricted','none'),
      (5,1,'empty-articles','Empty articles','device',4,'device-definition','manual','unrestricted','articles'),
      (6,1,'package','Package','device',4,'device-definition','manual','unrestricted','articles');
    INSERT INTO cat_config_model_article(model_id,seq,ref_brand_marchio,ref_manufacturer_code,quantity,role)
      VALUES(6,1,'ACME','MISSING',1,'primary');
    INSERT INTO cat_range_node_model(node_id,model_id) VALUES(1,4),(1,5),(1,6);
    INSERT INTO cat_config_dimension(id,brand_id,code,name,source) VALUES(1,1,'execution','Execution','manual');
    INSERT INTO cat_config_dimension_value(id,dimension_id,code,label,source)
      VALUES(1,1,'changed','Changed','manual');
    INSERT INTO cat_config_axis(id,model_id,dimension_id,sort_order,label,visibility,requirement,binding)
      VALUES(1,4,1,0,'Execution','visible','optional','none'),(2,2,1,0,'Wiring','visible','optional','none');
    INSERT INTO cat_config_option(id,axis_id,value_id,is_default,sort_order) VALUES(1,1,1,0,0),(2,2,1,0,0);
    INSERT INTO cat_config_rule(id,model_id,seq) VALUES(1,4,0),(2,2,0);
    INSERT INTO cat_config_rule_condition(rule_id,option_id) VALUES(1,1),(2,2);
    INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,profile_id)
      VALUES(1,0,'profile_override',5),(2,0,'profile_override',6);`);
  return f;
}
const request=(options=[1]):CompatiblePanelsRequest=>({parentUuid:'root-node',device:{
  configuration:{modelId:4,selectedOptionIds:options},definitionFingerprint:'device-definition'}});

describe('panel discovery for a configured reference device',()=>{
  it('selects a base-incompatible device without a panel, keeping legitimate packages and physical-only models',()=>{
    const f=setup();try{
      expect(guardDesignCandidate(f.catalogue,f.project,{kind:'device',modelId:4,parentUuid:'root-node'}).ok).toBe(false);
      expect(discoverReferenceDevices(f.catalogue,f.project,'root-node')).toMatchObject({status:'ready',candidates:[4,6]});
      expect(discoverDesignCandidates(f.catalogue,f.project,{kind:'support',parentUuid:'root-node'}).candidates).toEqual([2]);
      f.catalogue.exec('UPDATE cat_config_model SET base_profile_id=NULL WHERE id=4');
      expect(discoverReferenceDevices(f.catalogue,f.project,'root-node').candidates).toContain(4);
    }finally{f.close();}
  });
  it('uses resolved device constraints and independently rechecks the resolved panel class',()=>{
    const f=setup();try{
      expect(resolveConfiguration(f.catalogue,request().device.configuration).status).toBe('complete');
      expect(discoverCompatiblePanels(f.catalogue,f.project,request([])).navigation.candidates).toEqual([]);
      expect(discoverCompatiblePanels(f.catalogue,f.project,request()).navigation.candidates).toEqual([2]);
      expect(checkConfiguredPanelReference(f.catalogue,f.project,{...request(),panel:{modelId:2,selectedOptionIds:[]}}))
        .toEqual({ok:true,code:'compatible'});
      expect(checkConfiguredPanelReference(f.catalogue,f.project,{...request(),panel:{modelId:2,selectedOptionIds:[2]}}))
        .toEqual({ok:false,code:'incompatible_parent'});
      // Removing the transient reference preserves ordinary add eligibility for this exact panel configuration.
      expect(guardDesignCandidate(f.catalogue,f.project,{parentUuid:'root-node',kind:'support',modelId:2},
        {mode:'add',configuration:{modelId:2,selectedOptionIds:[2]}}).ok).toBe(true);
    }finally{f.close();}
  });
  it.each([
    ['missing device',"UPDATE cat_config_model SET active=0 WHERE id=4",'model_unavailable'],
    ['changed definition',"UPDATE cat_config_model SET definition_fingerprint='changed' WHERE id=4",'model_definition_changed'],
    ['unknown context',"UPDATE cat_config_model SET context_policy='unknown' WHERE id=4",'context_data_unavailable'],
    ['wrong context',"UPDATE cat_config_model SET context_policy='restricted' WHERE id=4",'required_context_not_provided'],
    ['hidden model',"DELETE FROM cat_range_node_model WHERE model_id=4",'design_not_navigable'],
    ['changed root',"UPDATE cat_config_model SET definition_fingerprint='changed' WHERE id=1",'container_unavailable'],
    ['stale root',"UPDATE cat_config_model SET source_import_id=NULL WHERE id=1",'engineering_data_stale'],
  ])('withholds results for %s',(_name,sql,code)=>{
    const f=setup();try{
      f.catalogue.exec(sql);
      const result=discoverCompatiblePanels(f.catalogue,f.project,request());
      expect(result.reference).toMatchObject({ok:false,code});expect(result.navigation.candidates).toEqual([]);
      expect(checkConfiguredPanelReference(f.catalogue,f.project,{...request(),panel:{modelId:2,selectedOptionIds:[]}}))
        .toMatchObject({ok:false,code});
    }finally{f.close();}
  });
  it('refuses invalid, foreign and incomplete selections and non-root containers, while checking out-of-catalogue engineering',()=>{
    const f=setup();try{
      for(const selectedOptionIds of [[999],[2]])expect(discoverCompatiblePanels(f.catalogue,f.project,request(selectedOptionIds)))
        .toMatchObject({reference:{ok:false},navigation:{candidates:[]}});
      f.catalogue.exec("UPDATE cat_config_axis SET requirement='required' WHERE id=1");
      expect(discoverCompatiblePanels(f.catalogue,f.project,request([])).reference.ok).toBe(false);
      const packageRequest=request();packageRequest.device.configuration={modelId:6,selectedOptionIds:[]};
      expect(discoverCompatiblePanels(f.catalogue,f.project,packageRequest).reference.ok).toBe(true);
      expect(discoverCompatiblePanels(f.catalogue,f.project,{...request(),parentUuid:'missing'}).reference.ok).toBe(false);
      f.project.exec("UPDATE prj_node SET node_kind='support' WHERE uuid='root-node'");
      expect(discoverReferenceDevices(f.catalogue,f.project,'root-node').status).toBe('container_unavailable');
    }finally{f.close();}
  });
  it('keeps all reads write-free and caches shared profiles for one discovery, without per-panel discovery loops',()=>{
    const f=setup();try{
      f.catalogue.exec("UPDATE cat_config_model SET context_policy='unrestricted',base_profile_id=2 WHERE id=3");
      const before=[f.catalogue.serialize(),f.project.serialize()];
      f.catalogue.pragma('query_only=ON');f.project.pragma('query_only=ON');
      const prepare=vi.spyOn(f.catalogue,'prepare');
      const found=discoverCompatiblePanels(f.catalogue,f.project,request());
      expect(found.navigation.candidates).toEqual([2,3]);
      expect(prepare.mock.calls.filter(([sql])=>String(sql).includes('SELECT DISTINCT nm.model_id'))).toHaveLength(1);
      // One device resolution and one shared support profile; the final list filter bulk-reads classes only.
      expect(prepare.mock.calls.filter(([sql])=>String(sql).includes('FROM cat_phys_profile p'))).toHaveLength(2);
      checkConfiguredPanelReference(f.catalogue,f.project,{...request(),panel:{modelId:2,selectedOptionIds:[]}});
      discoverReferenceDevices(f.catalogue,f.project,'root-node');
      expect(f.catalogue.serialize()).toEqual(before[0]);expect(f.project.serialize()).toEqual(before[1]);
    }finally{f.close();}
  });
  it('rechecks at the add boundary before writes, preserves quantity/unplaced behavior and offline snapshots',async()=>{
    const f=setup();const folder=mkdtempSync(path.join(tmpdir(),'librequadri-reference-service-'));
    f.catalogue.exec(`UPDATE cat_config_model SET commercial_contribution='none' WHERE id=1;
      INSERT INTO cat_phys_view(profile_id,view_code,width_mm,height_mm,symbol_kind,insert_dx_mm,insert_dy_mm) VALUES(1,'front',500,1200,'rectangle',0,0);`);
    const service=new ProjectDocumentService({workingDirectory:path.join(folder,'work'),incomingDirectory:path.join(folder,'incoming'),
      backupDirectory:path.join(folder,'backup'),migrationsFolder:path.resolve('db/migrations/project'),appVersion:'test',
      resolveCatalogueProduct:()=>{throw new Error('No commercial product should be requested');},
      resolveConfiguration:configuration=>resolveConfiguration(f.catalogue,configuration),
      designGuard:(project,request,configuration)=>guardDesignCandidate(f.catalogue,project,request,{mode:'add',configuration}),
      checkPanelReference:(project,request)=>checkConfiguredPanelReference(f.catalogue,project,request)});
    try{
      await service.create({destinationPath:path.join(folder,'case.lqp'),title:'Case',description:'',notes:'',projectType:'civil',
        executor:'',date:'2026-10-15',companyName:'',companyDescription:''});
      const rooted=service.addStructural({kind:'enclosure',configuration:{modelId:1,selectedOptionIds:[]}});
      const parentUuid=rooted.physicalNodes[0]!.uuid;
      const reference=request().device;
      const add={kind:'support' as const,parentUuid,place:false,quantity:3,configuration:{modelId:2,selectedOptionIds:[2]},referenceDevice:reference};
      const before=service.current();
      expect(()=>service.addStructural(add)).toThrow('incompatible_parent');expect(service.current()).toEqual(before);
      const good={...add,configuration:{modelId:2,selectedOptionIds:[]}};
      expect(service.checkPanelReference({parentUuid,device:reference,panel:good.configuration}).ok).toBe(true);
      expect(service.current()).toEqual(before);
      // Catalogue changes after the read-only check must still refuse at add time.
      f.catalogue.exec("UPDATE cat_config_model SET definition_fingerprint='new' WHERE id=4");
      expect(()=>service.addStructural(good)).toThrow('model_definition_changed');expect(service.current()).toEqual(before);
      f.catalogue.exec("UPDATE cat_config_model SET definition_fingerprint='device-definition' WHERE id=4");
      const added=service.addStructural(good);
      expect(added.physicalNodes[0]!.children).toEqual([]);
      expect(added.configuredItems.map(item=>item.modelCode)).toEqual(['box','good']);
      expect(added.lines.find(line=>line.itemUuid===added.configuredItems.find(item=>item.modelCode==='good')!.uuid)?.quantity).toBe(3);
      // Same changed panel is still allowed in the ordinary unfiltered add path.
      service.addStructural({...add,referenceDevice:undefined});
      await service.save();service.close();
      const offline=new ProjectDocumentService({workingDirectory:path.join(folder,'offline'),incomingDirectory:path.join(folder,'offline-in'),
        backupDirectory:path.join(folder,'offline-backup'),migrationsFolder:path.resolve('db/migrations/project'),appVersion:'test',
        resolveCatalogueProduct:()=>{throw new Error('offline');}});
      try{const reopened=offline.open(path.join(folder,'case.lqp'));expect(reopened.configuredItems).toHaveLength(3);
        expect(reopened.physicalNodes[0]!.children).toEqual([]);await offline.save();}
      finally{offline.close();}
    }finally{service.close();f.close();rmSync(folder,{recursive:true,force:true});}
  });

});

function enclosureFixture(){
  const f=setup();
  f.catalogue.prepare("UPDATE app_source_import SET adapter_code='tiquadri',adapter_version=? WHERE id=1").run(TIQUADRI_ENGINEERING_ADAPTER.version);
  f.catalogue.exec(`UPDATE cat_brand SET metel_marchio='BTI' WHERE id=1;
    UPDATE cat_config_model SET source='import',source_import_id=1,source_ref='TiQuadri ANA_PACK '||id;
    UPDATE cat_config_model SET commercial_contribution='none' WHERE id=1;
    INSERT INTO cat_phys_view(profile_id,view_code,width_mm,height_mm,symbol_kind) VALUES(1,'front',500,1200,'rectangle');
    UPDATE cat_phys_view SET insert_dx_mm=0,insert_dy_mm=0 WHERE profile_id=1;`);
  // Search must not depend on an already placed enclosure.
  f.project.exec('DELETE FROM prj_node; DELETE FROM prj_line; DELETE FROM prj_item');
  return f;
}
describe('BTicino Apparecchi inverse enclosure search',()=>{
  it('finds enclosures through a compatible panel, with no placed root and no project writes',()=>{
    const f=enclosureFixture();try{
      const before=f.project.serialize();f.project.pragma('query_only=ON');
      expect(discoverEnclosureReferenceDevices(f.catalogue).candidates).toContain(4);
      expect(discoverCompatibleEnclosures(f.catalogue,f.project,{device:request().device})).toMatchObject({reference:{ok:true},navigation:{candidates:[1]}});
      expect(discoverCompatibleEnclosures(f.catalogue,f.project,{device:request([]).device}).navigation.candidates).toEqual([]);
      expect(discoverCompatibleEnclosures(f.catalogue,f.project,{device:request().device,enclosure:{modelId:1,selectedOptionIds:[]}}).reference.ok).toBe(true);
      f.catalogue.exec("DELETE FROM cat_config_model_context WHERE model_id=2");
      expect(discoverCompatibleEnclosures(f.catalogue,f.project,{device:request().device,enclosure:{modelId:1,selectedOptionIds:[]}}).reference)
        .toEqual({ok:false,code:'enclosure_reference_incompatible'});
      expect(f.project.serialize()).toEqual(before);
    }finally{f.close();}
  });
  it.each(['brand','statistical','source'])('excludes unsupported %s references at the backend',kind=>{
    const f=enclosureFixture();try{
      if(kind==='brand')f.catalogue.exec("UPDATE cat_brand SET metel_marchio='SIE' WHERE id=1");
      if(kind==='statistical')f.catalogue.exec('UPDATE cat_range_node SET design_navigable=0');
      if(kind==='source')f.catalogue.exec("UPDATE cat_config_model SET source_ref='Famiglia statistica' WHERE id=4");
      expect(discoverEnclosureReferenceDevices(f.catalogue).candidates).not.toContain(4);
      expect(discoverCompatibleEnclosures(f.catalogue,f.project,{device:request().device}).reference)
        .toEqual({ok:false,code:'reference_scope_unavailable'});
    }finally{f.close();}
  });
  it('refuses changed and invalid saved choices and stale imports',()=>{
    const f=enclosureFixture();try{
      expect(discoverCompatibleEnclosures(f.catalogue,f.project,{device:{...request().device,definitionFingerprint:'old'}}).reference.code).toBe('model_definition_changed');
      expect(discoverCompatibleEnclosures(f.catalogue,f.project,{device:request([999]).device}).reference.ok).toBe(false);
      f.catalogue.exec("UPDATE app_source_import SET adapter_version='999' WHERE id=1");
      expect(discoverCompatibleEnclosures(f.catalogue,f.project,{device:request().device}).reference.code).toBe('engineering_data_stale');
    }finally{f.close();}
  });
});

it('rechecks the enclosure reference at the add boundary before creating any project item or root',async()=>{
  const f=enclosureFixture(),folder=mkdtempSync(path.join(tmpdir(),'librequadri-enclosure-add-'));
  const service=new ProjectDocumentService({workingDirectory:path.join(folder,'work'),incomingDirectory:path.join(folder,'in'),
    backupDirectory:path.join(folder,'backup'),migrationsFolder:path.resolve('db/migrations/project'),appVersion:'test',
    engineeringCatalogue:()=>f.catalogue,resolveCatalogueProduct:()=>{throw new Error('unexpected product');},
    resolveConfiguration:configuration=>resolveConfiguration(f.catalogue,configuration),
    designGuard:(project,request,configuration)=>guardDesignCandidate(f.catalogue,project,request,{mode:'add',configuration})});
  try{
    await service.create({destinationPath:path.join(folder,'case.lqp'),title:'Case',description:'',notes:'',projectType:'civil',
      executor:'',date:'2026-10-28',companyName:'',companyDescription:''});
    const before=service.current(),add={kind:'enclosure' as const,configuration:{modelId:1,selectedOptionIds:[]},referenceDevice:request([]).device};
    expect(()=>service.addStructural(add)).toThrow('enclosure_reference_incompatible');expect(service.current()).toEqual(before);
    const good={...add,referenceDevice:request().device};
    expect(service.compatibleEnclosures({device:good.referenceDevice,enclosure:good.configuration}).reference.ok).toBe(true);
    f.catalogue.exec("UPDATE cat_config_model SET definition_fingerprint='changed' WHERE id=4");
    expect(()=>service.addStructural(good)).toThrow('model_definition_changed');expect(service.current()).toEqual(before);
    f.catalogue.exec("UPDATE cat_config_model SET definition_fingerprint='device-definition' WHERE id=4");
    expect(service.addStructural(good).physicalNodes).toHaveLength(1);
  }finally{service.close();f.close();rmSync(folder,{recursive:true,force:true});}
});

it('rechecks the option-resolved enclosure class rather than trusting its base class',()=>{
  const f=enclosureFixture();try{
    f.catalogue.exec(`INSERT INTO cat_phys_profile(id,code,profile_set_id,profile_kind,name,fit_class_id,source)
      VALUES(7,'changed-root',1,'enclosure','Changed root',2,'manual');
      INSERT INTO cat_config_axis(id,model_id,dimension_id,sort_order,label,visibility,requirement,binding)
        VALUES(3,1,1,0,'Execution','visible','optional','none');
      INSERT INTO cat_config_option(id,axis_id,value_id,is_default,sort_order) VALUES(3,3,1,0,0);
      INSERT INTO cat_config_rule(id,model_id,seq) VALUES(3,1,0);
      INSERT INTO cat_config_rule_condition(rule_id,option_id) VALUES(3,3);
      INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,profile_id) VALUES(3,0,'profile_override',7);`);
    expect(discoverCompatibleEnclosures(f.catalogue,f.project,{device:request().device}).navigation.candidates).toEqual([1]);
    expect(discoverCompatibleEnclosures(f.catalogue,f.project,{device:request().device,enclosure:{modelId:1,selectedOptionIds:[3]}}).reference.code)
      .toBe('enclosure_reference_incompatible');
  }finally{f.close();}
});
