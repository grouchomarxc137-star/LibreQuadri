import { getConfigurationModel } from "../src/main/catalogue/configuration-queries.js";
import { guardDesignCandidate } from "../src/main/project/design-compatibility.js";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";
import { configuredItemAddable } from "../src/main/catalogue/configuration-addability.js";
import { resolveEngineeringRefresh } from "../src/main/catalogue/engineering-refresh-resolver.js";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { REVIEWED_EMPTY_BOM_PANELS, reviewedEmptyBomPanel } from "../src/main/sources/tiquadri/empty-bom-panels.js";
import { TIQUADRI_ENGINEERING_ADAPTER } from "../src/main/sources/tiquadri/adapter.js";

function fixture(){
  const folder=mkdtempSync(path.join(tmpdir(),'librequadri-mixed-panel-'));
  const db=openMigratedLqDatabase({databaseFilename:path.join(folder,'catalogue.db'),backupDirectory:path.join(folder,'backup'),migrationsFolder:path.resolve('db/migrations/lq')});
  db.exec(`INSERT INTO cat_brand(id,metel_marchio,name,source) VALUES(1,'ABC','Example','manual');
    INSERT INTO cat_metel_issuer(id,metel_sigla) VALUES(1,'ABC');
    INSERT INTO app_import_delivery(id,issuer_id,fingerprint,listino_number,valid_from,became_current,normalized_at,summary_json)
      VALUES(1,1,'${'a'.repeat(64)}','1','2026-01-01',1,'2026-01-01','{}');
    INSERT INTO com_price_list(id,issuer_id,delivery_id,listino_number,valid_from,is_current) VALUES(1,1,1,'1','2026-01-01',1);
    INSERT INTO cat_product(id,brand_id,manufacturer_code,code_norm,governing_issuer_id,is_listed,updated_at)
      VALUES(1,1,'BUS','BUS',1,1,'2026-01-01'),(2,1,'GUIDE','GUIDE',1,1,'2026-01-01');
    INSERT INTO cat_product_listing(product_id,issuer_id,lifecycle_status_code,lead_time_code,short_description,unit_of_measure,
      pack_qty,min_order_qty,order_multiple,max_order_qty,is_kit,is_listed,first_seen_delivery_id,last_seen_delivery_id)
      VALUES(1,1,'','','Bus','PZ',1,1,1,1,0,1,1,1),(2,1,'','','Guide','PZ',1,1,1,1,0,1,1,1);
    INSERT INTO com_product_price(product_id,price_list_id,list_price_e4,price_multiplier,currency,list_price_unit_e4)
      VALUES(1,1,10000,1,'EUR',10000),(2,1,5000,1,'EUR',5000);
    INSERT INTO cat_phys_class(id,code,name,source) VALUES(1,'PANEL','Panel','manual');
    INSERT INTO cat_phys_profile_set(id,code,name,source) VALUES(1,'set','Set','manual');
    INSERT INTO cat_phys_profile(id,code,profile_set_id,profile_kind,name,fit_class_id,source) VALUES(1,'panel',1,'support','Panel',1,'manual'),(2,'root',1,'enclosure','Root',1,'manual');
    INSERT INTO cat_phys_view(profile_id,view_code,width_mm,height_mm,symbol_kind,insert_dx_mm,insert_dy_mm) VALUES(1,'front',515,150,'rectangle',0,0),(2,'front',600,1400,'rectangle',0,0);
    INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,base_profile_id,definition_fingerprint,source,context_policy)
      VALUES(1,1,'panel','Panel','support',1,'definition','manual','unrestricted');
    INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,base_profile_id,definition_fingerprint,source,context_policy,commercial_contribution)
      VALUES(2,1,'root','Root','enclosure',2,'root-definition','manual','unrestricted','none');
    INSERT INTO cat_range_node(id,brand_id,code,name,node_kind,source,design_navigable) VALUES(1,1,'design','Design','section','manual',1);
    INSERT INTO cat_range_node_model(node_id,model_id) VALUES(1,1),(1,2);
    INSERT INTO cat_config_dimension(id,brand_id,code,name,source) VALUES(1,1,'execution','Execution','manual'),(2,1,'guide','Guide','manual');
    INSERT INTO cat_config_dimension_value(id,dimension_id,code,label,source) VALUES(1,1,'cable','Cable','manual'),(2,1,'bus','Bus','manual'),(3,2,'no','No','manual'),(4,2,'yes','Yes','manual');
    INSERT INTO cat_config_axis(id,model_id,dimension_id,sort_order,label,visibility,requirement,binding)
      VALUES(1,1,1,0,'Execution','visible','required','none'),(2,1,2,1,'Guide','visible','required','none');
    INSERT INTO cat_config_option(id,axis_id,value_id,is_default,sort_order) VALUES(1,1,1,1,0),(2,1,2,0,1),(3,2,3,1,0),(4,2,4,0,1);
    INSERT INTO cat_config_rule(id,model_id,seq,empty_bom_allowed) VALUES(1,1,1,1),(2,1,2,0),(3,1,3,0);
    INSERT INTO cat_config_rule_condition(rule_id,option_id) VALUES(1,1),(2,2),(3,4);
    INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,product_id,ref_brand_marchio,ref_manufacturer_code,quantity,article_role)
      VALUES(2,0,'article',1,'ABC','BUS',1,'accessory'),(3,0,'article',2,'ABC','GUIDE',1,'accessory');`);
  return {folder,db,close(){db.close();rmSync(folder,{recursive:true,force:true});}};
}
const request=(selectedOptionIds:number[]=[])=>({modelId:1,selectedOptionIds});

describe('reviewed configuration-level physical panels',()=>{
  it('permits the approved empty variant while preserving every accessory and its price',()=>{
    const f=fixture();try{
      const free=resolveConfiguration(f.db,request());
      expect(free).toMatchObject({status:'complete',commercialContribution:'none',bom:[],totalE4:null,model:{commercialContribution:'articles'}});
      expect(configuredItemAddable(free)).toBe(true);
      const bus=resolveConfiguration(f.db,request([2]));
      expect(bus).toMatchObject({status:'complete',commercialContribution:'articles',totalE4:10000,bom:[{manufacturerCode:'BUS'}]});
      const guide=resolveConfiguration(f.db,request([4]));
      expect(guide).toMatchObject({status:'complete',commercialContribution:'articles',totalE4:5000,bom:[{manufacturerCode:'GUIDE'}]});
      expect(configuredItemAddable({...bus,commercialContribution:'none',bom:[],totalE4:null})).toBe(false);
      f.db.exec('UPDATE cat_config_rule SET empty_bom_allowed=0');
      expect(resolveConfiguration(f.db,request()).issues.some(issue=>issue.code==='bom_empty')).toBe(true);
      expect(()=>f.db.exec('UPDATE cat_config_rule SET empty_bom_allowed=2')).toThrow();
    }finally{f.close();}
  });
  it('does not turn missing accessory links, missing profiles or invalid choices into addable panels',()=>{
    const f=fixture();try{
      f.db.exec("UPDATE cat_config_rule_effect SET product_id=NULL WHERE rule_id=3");
      const missing=resolveConfiguration(f.db,request([4]));expect(missing.status).toBe('bom_incomplete');expect(missing.commercialContribution).toBe('articles');
      expect(configuredItemAddable(resolveConfiguration(f.db,request([999])))).toBe(false);
      f.db.exec('UPDATE cat_config_model SET base_profile_id=NULL');
      expect(configuredItemAddable(resolveConfiguration(f.db,request()))).toBe(false);
    }finally{f.close();}
  });
  it('snapshots, undoes/redoes, refresh-verifies and reopens the empty variant offline without phantom prices',async()=>{
    const f=fixture();const filename=path.join(f.folder,'project.lqp');
    const make=(live:boolean)=>new ProjectDocumentService({workingDirectory:path.join(f.folder,live?'work':'offline'),incomingDirectory:path.join(f.folder,'in'),
      backupDirectory:path.join(f.folder,'backups'),migrationsFolder:path.resolve('db/migrations/project'),appVersion:'test',
      resolveCatalogueProduct:()=>{throw new Error('No product should be requested');},
      ...(live?{resolveConfiguration:(input:ReturnType<typeof request>)=>resolveConfiguration(f.db,input),engineeringCatalogue:()=>f.db,designGuard:(project:Parameters<typeof guardDesignCandidate>[1],input:Parameters<typeof guardDesignCandidate>[2],configuration:ReturnType<typeof request>)=>guardDesignCandidate(f.db,project,input,{mode:"add",configuration})}:{})});
    const service=make(true);try{
      await service.create({destinationPath:filename,title:'Panel',description:'',notes:'',projectType:'civil',executor:'',date:'2026-10-28',companyName:'',companyDescription:''});
      const rooted=service.addStructural({kind:'enclosure',configuration:{modelId:2,selectedOptionIds:[]}});
      const added=service.addStructural({kind:'support',parentUuid:rooted.physicalNodes[0]!.uuid,configuration:request(),place:false,quantity:3});
      const panel=added.configuredItems.find(item=>item.modelKind==='support')!;
      expect(added.lines.find(line=>line.itemUuid===panel.uuid)).toMatchObject({quantity:3,commercialContribution:'none',unitListPriceE4:null,lineTotalE4:null});
      expect(added.distinta).toEqual([]);expect(resolveEngineeringRefresh(f.db,panel).ok).toBe(true);
      expect(service.undo().configuredItems).toHaveLength(1);expect(service.redo().configuredItems).toHaveLength(2);
      await service.save();service.close();
      const offline=make(false);try{const reopened=offline.open(filename);expect(reopened.configuredItems.find(item=>item.modelKind==='support')).toMatchObject({commercialContribution:'none',bom:[],physStatus:'resolved'});
        expect(reopened.distinta).toEqual([]);await offline.save();}finally{offline.close();}
    }finally{service.close();f.close();}
  });
  it('binds importer permission to the full reviewed definition and precise source row',()=>{
    for(const row of REVIEWED_EMPTY_BOM_PANELS){
      expect(reviewedEmptyBomPanel(row.packId,row.name,row.fingerprint,row.rowId,0,0)).toBe(true);
      for(const [fingerprint,id,base,articles] of [['changed',row.rowId,0,0],[row.fingerprint,row.rowId+1,0,0],[row.fingerprint,row.rowId,1,0],[row.fingerprint,row.rowId,0,1]] as const)
        expect(reviewedEmptyBomPanel(row.packId,row.name,fingerprint,id,base,articles)).toBe(false);
    }
  });
});

it('upgrades existing rules additively, backfills only verified cases, and preserves conditions and effects',()=>{
  const folder=mkdtempSync(path.join(tmpdir(),'librequadri-panel-migration-')),oldMigrations=path.join(folder,'old-migrations');
  mkdirSync(path.join(oldMigrations,'meta'),{recursive:true});
  const journal=JSON.parse(readFileSync('db/migrations/lq/meta/_journal.json','utf8'));
  journal.entries=journal.entries.filter((entry:{idx:number})=>entry.idx<17);
  writeFileSync(path.join(oldMigrations,'meta/_journal.json'),JSON.stringify(journal));
  for(const entry of journal.entries)copyFileSync(`db/migrations/lq/${entry.tag}.sql`,path.join(oldMigrations,`${entry.tag}.sql`));
  const options={databaseFilename:path.join(folder,'catalogue.db'),backupDirectory:path.join(folder,'backup')};
  let db=openMigratedLqDatabase({...options,migrationsFolder:oldMigrations});
  try{
    db.exec(`INSERT INTO cat_brand(id,metel_marchio,name,source) VALUES(1,'BTI','BTicino','manual');
      INSERT INTO app_source_import(id,adapter_code,adapter_version,source_label,fingerprint,imported_at,became_current,summary_json)
        VALUES(1,'tiquadri','11','Test','${'a'.repeat(64)}','2026-10-28',1,'{}');
      INSERT INTO cat_config_dimension(id,brand_id,code,name,source) VALUES(1,1,'tq.label.54','Execution','manual'),(2,1,'tq.label.53','Phases','manual');
      INSERT INTO cat_config_dimension_value(id,dimension_id,code,label,source) VALUES(1,1,'tq.value.231','Cable','manual'),(2,2,'tq.value.-1','All','manual');`);
    for(const [index,row] of REVIEWED_EMPTY_BOM_PANELS.entries()){
      const id=index+1;
      db.prepare(`INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,definition_fingerprint,source,source_import_id,source_ref)
        VALUES(?,1,?,?,'support',?,'import',1,?)`).run(id,`tq.pack.${row.packId}`,row.name,index===1?'changed':row.fingerprint,`TiQuadri ANA_PACK ${row.packId}`);
      db.prepare(`INSERT INTO cat_config_axis(id,model_id,dimension_id,sort_order,label,visibility,requirement,binding)
        VALUES(?,?,1,0,'Execution','visible','required','none'),(?,?,2,1,'Phases','visible','required','none')`).run(id*2-1,id,id*2,id);
      db.prepare(`INSERT INTO cat_config_option(id,axis_id,value_id,parent_option_id,is_default,sort_order)
        VALUES(?,?,1,NULL,1,0),(?,?,2,?,1,0)`).run(id*2-1,id*2-1,id*2,id*2,id*2-1);
      db.prepare('INSERT INTO cat_config_rule(id,model_id,seq) VALUES(?,?,0)').run(id,id);
      db.prepare('INSERT INTO cat_config_rule_condition(rule_id,option_id) VALUES(?,?),(?,?)').run(id,id*2-1,id,id*2);
    }
    // An article-bearing source rule must never receive the empty-BOM permission.
    db.exec(`INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,ref_brand_marchio,ref_manufacturer_code,quantity,article_role)
      VALUES(3,0,'article','BTI','MISSING',1,'accessory');`);
    expect((db.pragma("table_info(cat_config_rule)") as {name:string}[])
      .some(column=>column.name==="empty_bom_allowed")).toBe(false);
    const before=db.prepare('SELECT * FROM cat_config_rule_condition ORDER BY rule_id,option_id').all();
    db.close();db=openMigratedLqDatabase({...options,migrationsFolder:path.resolve('db/migrations/lq')});
    expect(db.prepare('SELECT id FROM cat_config_rule WHERE empty_bom_allowed=1').pluck().all()).toEqual([1]);
    db.prepare("UPDATE app_source_import SET adapter_version=? WHERE id=1").run(TIQUADRI_ENGINEERING_ADAPTER.version);
    expect(getConfigurationModel(db,1).emptyBomRuleIds).toEqual([1]);
    expect(db.prepare('SELECT * FROM cat_config_rule_condition ORDER BY rule_id,option_id').all()).toEqual(before);
    expect(db.prepare('SELECT count(*) FROM cat_config_rule_effect').pluck().get()).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  }finally{db.close();rmSync(folder,{recursive:true,force:true});}
});
