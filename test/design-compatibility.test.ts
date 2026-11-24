import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { MainDatabaseService } from "../src/main/database/database-service.js";
import { applicationPaths } from "../src/main/data-paths.js";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { openCurrentProjectDatabase } from "../src/main/database/project-migrations.js";
import { checkPhysicalClasses } from "../src/main/project/physical-class-compatibility.js";
import { discoverDesignCandidates, discoverDesignRangeNodes, guardConfiguredStructuralItem,
  guardDesignCandidate } from "../src/main/project/design-compatibility.js";
import { EngineeringDataWriter } from "../src/main/sources/engineering-writer.js";

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
    INSERT INTO cat_phys_view(profile_id,view_code,width_mm,height_mm,symbol_kind)
      VALUES(1,'front',600,1800,'frame'),(2,'front',600,200,'panel'),(3,'front',600,200,'panel');
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

describe("generic design context and physical compatibility",()=>{
  it("discovers an approved physical-only device while withholding article-free commercial devices",()=>{
    const f=fixture();try {
      f.catalogue.exec(`INSERT INTO cat_phys_profile(id,code,profile_set_id,profile_kind,name,fit_class_id,source)
        VALUES(4,'space',1,'device','Space',2,'manual');
        INSERT INTO cat_phys_view(profile_id,view_code,width_mm,height_mm,symbol_kind) VALUES(4,'front',18,90,'device');
        INSERT INTO cat_phys_accept_set(id,code,source) VALUES(2,'panels','manual');
        INSERT INTO cat_phys_accept_set_member(set_id,class_id) VALUES(2,3);
        INSERT INTO cat_phys_constraint(profile_id,relation,accept_set_id) VALUES(4,'parent',2);
        INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,base_profile_id,
          definition_fingerprint,source,context_policy,commercial_contribution)
          VALUES(5,1,'space-model','Space','device',4,'fingerprint','manual','unrestricted','none'),
            (6,1,'unreviewed','Unreviewed','device',4,'fingerprint','manual','unrestricted','articles');
        INSERT INTO cat_range_node_model(node_id,model_id) VALUES(1,5),(1,6);`);
      f.project.exec(`INSERT INTO prj_item(id,uuid,model_brand_marchio,model_code,model_name,model_kind,
          model_definition_fingerprint,config_fingerprint,config_label,config_status,phys_status,
          profile_code,profile_name,fit_class_code,fit_class_label,snapshot_taken_at)
          VALUES(2,'support-item','ACME','good','Good','support','fingerprint','config','Good','complete',
            'resolved','panel','Panel','PANEL','Panel','2026-09-25');
        INSERT INTO prj_node(id,uuid,parent_id,item_id,node_kind,zone_no,start_units,view_code,sort_order)
          VALUES(2,'support-node',1,2,'support',0,0,'front',0);`);
      const result=discoverDesignCandidates(f.catalogue,f.project,{parentUuid:'support-node',kind:'device'});
      expect(result.status).toBe('ready');
      expect(result.candidates).toContain(5);
      expect(result.candidates).not.toContain(6);
      expect(guardDesignCandidate(f.catalogue,f.project,
        {parentUuid:'support-node',kind:'device',modelId:6})).toMatchObject({ok:false,
          code:'commercial_contribution_unavailable'});
    }finally{f.close();}
  });
  it("expresses MDX800 343 → 851, excludes 848 despite shared physical class, and uses each selected root",()=>{
    const f=fixture();try {
      f.catalogue.exec(`UPDATE cat_config_model SET code='tq.pack.343' WHERE id=1;
        UPDATE cat_config_model SET code='tq.pack.851' WHERE id=2;
        UPDATE cat_config_model SET code='tq.pack.848',base_profile_id=2 WHERE id=3;
        INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,base_profile_id,
          definition_fingerprint,source,context_policy,source_import_id)
          VALUES(4,1,'second-root','Second root','enclosure',1,'fingerprint','import','unrestricted',1);
        INSERT INTO cat_config_model_context(model_id,role,context_id) VALUES(4,'provides',2);
        INSERT INTO cat_range_node_model(node_id,model_id) VALUES(1,4);`);
      f.project.exec(`UPDATE prj_item SET model_code='tq.pack.343' WHERE id=1;
        INSERT INTO prj_item(id,uuid,model_brand_marchio,model_code,model_name,model_kind,
          model_definition_fingerprint,config_fingerprint,config_label,config_status,phys_status,
          profile_code,profile_name,fit_class_code,fit_class_label,snapshot_taken_at)
          VALUES(2,'second-item','ACME','second-root','Second','enclosure','fingerprint','config',
            'Second','complete','resolved','root','Root','FRAME','Frame','2026-09-25');
        INSERT INTO prj_line(uuid,group_id,sort_order,line_type,item_id,quantity)
          VALUES('second-line',1,1,'item',2,1);
        INSERT INTO prj_node(id,uuid,item_id,node_kind,root_x_mm,root_y_mm,view_code,sort_order)
          VALUES(2,'second-node',2,'enclosure',500,0,'front',1);`);
      const codes=(root:string)=>discoverDesignCandidates(f.catalogue,f.project,
        {parentUuid:root,kind:"support"}).candidates.map(id=>f.catalogue.prepare(
          "SELECT code FROM cat_config_model WHERE id=?").pluck().get(id));
      expect(f.catalogue.prepare("SELECT base_profile_id FROM cat_config_model WHERE id IN (2,3)")
        .pluck().all()).toEqual([2,2]);
      expect(codes("root-node")).toEqual(["tq.pack.851"]);
      expect(codes("second-node")).toEqual(["tq.pack.848"]);
      expect(guardDesignCandidate(f.catalogue,f.project,
        {parentUuid:"root-node",kind:"support",modelId:3}))
        .toMatchObject({ok:false,code:"required_context_not_provided"});
      expect(guardDesignCandidate(f.catalogue,f.project,
        {parentUuid:"second-node",kind:"support",modelId:2}))
        .toMatchObject({ok:false,code:"required_context_not_provided"});
    }finally{f.close();}
  });
  it("keeps manufacturer terminology out of generic runtime modules",()=>{
    for(const file of ["src/main/project/design-compatibility.ts",
      "src/main/project/physical-class-compatibility.ts","src/main/project/physical-placement.ts",
      "src/main/project/project-document-service.ts","src/renderer/project/placement-workflow.ts"]){
      const source=readFileSync(path.resolve(file),"utf8");
      expect(source).not.toMatch(/BTicino|TiQuadri|Famiglia_Armadi|tq\.[A-Za-z]/i);
    }
  });
  it("uses only the structural root provider and rejects a physically compatible wrong variant",()=>{
    const f=fixture();try {
      expect(guardDesignCandidate(f.catalogue,f.project,{parentUuid:"root-node",modelId:2,kind:"support"}))
        .toEqual({ok:true,code:"compatible"});
      expect(guardDesignCandidate(f.catalogue,f.project,{parentUuid:"root-node",modelId:3,kind:"support"}))
        .toMatchObject({ok:false,code:"required_context_not_provided"});
      expect(discoverDesignCandidates(f.catalogue,f.project,{parentUuid:"root-node",kind:"support"}))
        .toMatchObject({status:"ready",candidates:[2]});
      expect(discoverDesignRangeNodes(f.catalogue,f.project,{parentUuid:"root-node",kind:"support"})
        .nodes.map(node=>node.code)).toEqual(["structural"]);
      f.catalogue.exec(`INSERT INTO cat_config_model_context(model_id,role,context_id)
        VALUES(2,'provides',2)`);
      f.project.exec(`INSERT INTO prj_item(id,uuid,model_brand_marchio,model_code,model_name,model_kind,
        model_definition_fingerprint,config_fingerprint,config_label,config_status,phys_status,
        profile_code,profile_name,fit_class_code,fit_class_label,snapshot_taken_at)
        VALUES(2,'middle-item','ACME','missing-local','Missing','support','x','x','x','complete',
          'resolved','x','x','SUPPORT','Support','2026-09-25');
        INSERT INTO prj_line(uuid,group_id,sort_order,line_type,item_id,quantity)
        VALUES('middle-line',1,1,'item',2,1);
        INSERT INTO prj_node(id,uuid,parent_id,item_id,node_kind,zone_no,start_units,view_code,sort_order)
        VALUES(2,'middle-node',1,2,'support',0,0,'front',0);`);
      expect(guardDesignCandidate(f.catalogue,f.project,{parentUuid:"middle-node",modelId:3,kind:"support"}))
        .toMatchObject({ok:false,code:"required_context_not_provided"});
      expect(guardDesignCandidate(f.catalogue,f.project,{parentUuid:"middle-node",modelId:2,kind:"support"}))
        .toEqual({ok:true,code:"compatible"});
    }finally{f.close();}
  });
  it("distinguishes stale imports, manual unknown context, and design navigation",()=>{
    const f=fixture();try {
      f.catalogue.exec(`UPDATE cat_config_model SET context_policy='unknown' WHERE id=3`);
      expect(discoverDesignCandidates(f.catalogue,f.project,{parentUuid:"root-node",kind:"support"}))
        .toMatchObject({status:"engineering_data_stale",candidates:[],staleImportIds:[1]});
      f.catalogue.exec(`UPDATE cat_config_model SET source='manual' WHERE id=3`);
      expect(discoverDesignCandidates(f.catalogue,f.project,{parentUuid:"root-node",kind:"support"}))
        .toMatchObject({status:"ready",candidates:[2],contextDataUnavailable:1});
      f.catalogue.exec(`UPDATE cat_config_model SET context_policy='unrestricted' WHERE id=3;
        DELETE FROM cat_range_node_model WHERE model_id=3;
        INSERT INTO cat_range_node(id,brand_id,parent_id,code,name,node_kind,source,design_navigable)
          VALUES(2,1,1,'orphan','Orphan','group','import',0);
        INSERT INTO cat_range_node_model(node_id,model_id) VALUES(2,3);`);
      expect(guardDesignCandidate(f.catalogue,f.project,{parentUuid:"root-node",modelId:3,kind:"support"}))
        .toMatchObject({ok:false,code:"design_not_navigable"});
      expect(discoverDesignRangeNodes(f.catalogue,f.project,{parentUuid:"root-node",kind:"support"})
        .nodes.map(node=>node.code)).toEqual(["structural"]);
      f.catalogue.exec(`UPDATE cat_config_model SET context_policy='unknown' WHERE id=1`);
      expect(discoverDesignCandidates(f.catalogue,f.project,{parentUuid:"root-node",kind:"support"}))
        .toMatchObject({status:"engineering_data_stale",candidates:[]});
      f.catalogue.exec(`UPDATE cat_config_model SET source='manual' WHERE id=1`);
      expect(discoverDesignCandidates(f.catalogue,f.project,{parentUuid:"root-node",kind:"support"}))
        .toMatchObject({status:"container_unavailable",candidates:[]});
    }finally{f.close();}
  });
  it("keeps discovery and guard in parity across invalid ancestors and valid alternate paths",()=>{
    const f=fixture();try {
      f.catalogue.exec(`UPDATE cat_config_model SET context_policy='unrestricted' WHERE id=3;
        DELETE FROM cat_range_node_model WHERE model_id=3;
        INSERT INTO cat_range_node(id,brand_id,parent_id,code,name,node_kind,source,design_navigable)
          VALUES(2,1,1,'hidden-parent','Hidden','level','import',0),
                (3,1,2,'child','Child','group','import',1),
                (4,1,1,'valid-path','Valid','group','import',1);
        INSERT INTO cat_range_node_model(node_id,model_id) VALUES(3,3);`);
      const checkParity=()=>{
        const discovery=discoverDesignCandidates(f.catalogue,f.project,
          {parentUuid:"root-node",kind:"support"});
        expect(discovery.status).toBe("ready");
        for(const modelId of [2,3]){
          const guard=guardDesignCandidate(f.catalogue,f.project,
            {parentUuid:"root-node",modelId,kind:"support"});
          expect(discovery.candidates.includes(modelId)).toBe(guard.ok);
        }
        return discovery.candidates;
      };
      const prepare=vi.spyOn(f.catalogue,"prepare");
      expect(discoverDesignCandidates(f.catalogue,f.project,
        {parentUuid:"root-node",kind:"support"}).candidates).toEqual([2]);
      expect(prepare.mock.calls.filter(([sql])=>String(sql).includes("cat_range_node"))).toHaveLength(1);
      prepare.mockRestore();
      expect(checkParity()).toEqual([2]);
      f.catalogue.exec(`UPDATE cat_range_node SET design_navigable=1,active=0 WHERE id=2`);
      expect(checkParity()).toEqual([2]);
      f.catalogue.exec(`UPDATE cat_range_node SET active=1 WHERE id=2`);
      expect(checkParity()).toEqual([2,3]);
      f.catalogue.exec(`UPDATE cat_range_node SET active=0 WHERE id=2;
        INSERT INTO cat_range_node_model(node_id,model_id) VALUES(4,3);`);
      expect(checkParity()).toEqual([2,3]);
      expect(discoverDesignRangeNodes(f.catalogue,f.project,
        {parentUuid:"root-node",kind:"support"}).nodes.map(node=>node.code))
        .toEqual(["structural","valid-path"]);
      f.catalogue.exec(`UPDATE cat_range_node SET design_navigable=0 WHERE id=1`);
      expect(checkParity()).toEqual([]);
    }finally{f.close();}
  });
  it("applies unrestricted and empty restricted policies without physical fallback",()=>{
    const f=fixture();try {
      f.catalogue.exec(`DELETE FROM cat_config_model_context WHERE model_id=3 AND role='accepts'`);
      expect(guardDesignCandidate(f.catalogue,f.project,{parentUuid:"root-node",modelId:3,kind:"support"}))
        .toMatchObject({ok:false,code:"required_context_not_provided"});
      f.catalogue.exec(`UPDATE cat_config_model SET context_policy='unrestricted' WHERE id=3`);
      expect(guardDesignCandidate(f.catalogue,f.project,{parentUuid:"root-node",modelId:3,kind:"support"}))
        .toEqual({ok:true,code:"compatible"});
      f.catalogue.exec(`INSERT INTO cat_phys_accept_set(id,code,source) VALUES(2,'wrong-class','manual');
        INSERT INTO cat_phys_accept_set_member(set_id,class_id) VALUES(2,2);
        INSERT INTO cat_phys_constraint(profile_id,relation,accept_set_id) VALUES(3,'parent',2);`);
      expect(guardDesignCandidate(f.catalogue,f.project,{parentUuid:"root-node",modelId:3,kind:"support"}))
        .toMatchObject({ok:false,code:"incompatible_parent"});
      expect(discoverDesignCandidates(f.catalogue,f.project,{parentUuid:"root-node",kind:"support"}))
        .toMatchObject({status:"ready",candidates:[2]});
    }finally{f.close();}
  });
  it("blocks missing or mismatched local roots before returning candidates",()=>{
    const f=fixture();try {
      f.catalogue.exec(`UPDATE cat_config_model SET definition_fingerprint='new' WHERE id=1`);
      expect(discoverDesignCandidates(f.catalogue,f.project,{parentUuid:"root-node",kind:"support"}))
        .toMatchObject({status:"container_unavailable",candidates:[]});
      expect(guardDesignCandidate(f.catalogue,f.project,{parentUuid:"root-node",modelId:2,kind:"support"}))
        .toMatchObject({ok:false,code:"container_unavailable"});
      f.catalogue.exec(`DELETE FROM cat_config_model_context WHERE model_id=1;
        DELETE FROM cat_range_node_model WHERE model_id=1;
        DELETE FROM cat_config_model WHERE id=1;`);
      expect(discoverDesignCandidates(f.catalogue,f.project,{parentUuid:"root-node",kind:"support"}))
        .toMatchObject({status:"container_unavailable",candidates:[]});
    }finally{f.close();}
  });
  it("shares the pure class predicate with placement",()=>{
    expect(checkPhysicalClasses([{relation:"parent",classCodes:["FRAME"]}],"FRAME",["FRAME"]))
      .toEqual({ok:true});
    expect(checkPhysicalClasses([{relation:"parent",classCodes:["FRAME"]}],"SUPPORT",["SUPPORT","FRAME"]))
      .toEqual({ok:false,code:"incompatible_parent"});
    expect(checkPhysicalClasses([{relation:"ancestor",classCodes:["FRAME"]}],"SUPPORT",["SUPPORT","FRAME"]))
      .toEqual({ok:true});
    expect(checkPhysicalClasses([{relation:"ancestor",classCodes:[]}],"FRAME",["FRAME"]))
      .toEqual({ok:false,code:"incompatible_ancestor"});
  });
  it("uses the resolved option profile for add mode",()=>{
    const f=fixture();try {
      f.catalogue.exec(`INSERT INTO cat_phys_profile(id,code,profile_set_id,profile_kind,name,fit_class_id,source)
          VALUES(4,'option-panel',1,'support','Option panel',3,'manual');
        INSERT INTO cat_phys_view(profile_id,view_code,width_mm,height_mm,symbol_kind) VALUES(4,'front',600,200,'panel');
        INSERT INTO cat_phys_accept_set(id,code,source) VALUES(2,'support-only','manual');
        INSERT INTO cat_phys_accept_set_member(set_id,class_id) VALUES(2,2);
        INSERT INTO cat_phys_constraint(profile_id,relation,accept_set_id)
          VALUES(4,'parent',2);
        INSERT INTO cat_metel_issuer(id,metel_sigla) VALUES(1,'ACME');
        INSERT INTO app_import_delivery(id,issuer_id,fingerprint,listino_number,valid_from,became_current,normalized_at,summary_json)
          VALUES(1,1,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','1','2026-01-01',1,'2026-01-01','{}');
        INSERT INTO com_price_list(id,issuer_id,delivery_id,listino_number,valid_from,is_current)
          VALUES(1,1,1,'1','2026-01-01',1);
        INSERT INTO cat_product(id,brand_id,manufacturer_code,code_norm,governing_issuer_id,is_listed,updated_at)
          VALUES(1,1,'ARTICLE','ARTICLE',1,1,'2026-01-01');
        INSERT INTO cat_product_listing(product_id,issuer_id,lifecycle_status_code,lead_time_code,short_description,
          unit_of_measure,pack_qty,min_order_qty,order_multiple,max_order_qty,is_kit,is_listed,
          first_seen_delivery_id,last_seen_delivery_id)
          VALUES(1,1,'','','Article','PZ',1,1,1,1,0,1,1,1);
        INSERT INTO com_product_price(product_id,price_list_id,list_price_e4,price_multiplier,currency,list_price_unit_e4)
          VALUES(1,1,10000,1,'EUR',10000);
        INSERT INTO cat_config_model_article(model_id,seq,product_id,ref_brand_marchio,ref_manufacturer_code,quantity,role)
          VALUES(2,1,1,'ACME','ARTICLE',1,'primary');
        INSERT INTO cat_config_dimension(id,brand_id,code,name,source)
          VALUES(1,1,'mount','Mount','manual');
        INSERT INTO cat_config_dimension_value(id,dimension_id,code,label,source)
          VALUES(1,1,'different','Different','manual');
        INSERT INTO cat_config_axis(id,model_id,dimension_id,sort_order,label,visibility,requirement,binding)
          VALUES(1,2,1,1,'Mount','visible','optional','none');
        INSERT INTO cat_config_option(id,axis_id,value_id,is_default,sort_order)
          VALUES(1,1,1,0,1);
        INSERT INTO cat_config_rule(id,model_id,seq) VALUES(1,2,1);
        INSERT INTO cat_config_rule_condition(rule_id,option_id) VALUES(1,1);
        INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,profile_id)
          VALUES(1,1,'profile_override',4);`);
      const request={parentUuid:"root-node",modelId:2,kind:"support" as const};
      expect(guardDesignCandidate(f.catalogue,f.project,request)).toEqual({ok:true,code:"compatible"});
      expect(guardDesignCandidate(f.catalogue,f.project,request,{mode:"add",
        configuration:{modelId:2,selectedOptionIds:[1]}}))
        .toMatchObject({ok:false,code:"incompatible_parent"});
      expect(guardDesignCandidate(f.catalogue,f.project,request,{mode:"add",
        configuration:{modelId:2,selectedOptionIds:[]}}))
        .toEqual({ok:true,code:"compatible"});
    }finally{f.close();}
  });
  it("requires every upserted import model to declare its context policy",()=>{
    const f=fixture();try {
      const writer=new EngineeringDataWriter(f.catalogue);
      const input={brandId:1,code:"new",name:"New",kind:"support",profile:2,maxQty:null,
        fingerprint:"new",active:1,obsolete:0,importId:1,ref:"example"};
      const id=writer.upsertModel(input)!;
      expect(()=>writer.finishImport(1,{})).toThrow(/unknown context policy/);
      writer.setModelContextPolicy(id,"unrestricted");
      expect(()=>writer.finishImport(1,{})).not.toThrow();
    }finally{f.close();}
  });
  it("retains manual context vocabulary while replacing and deactivating imported data",()=>{
    const f=fixture();try {
      const writer=new EngineeringDataWriter(f.catalogue);
      f.catalogue.exec(`UPDATE cat_config_context SET source='manual',name='Manual family' WHERE id=2`);
      const manual=writer.upsertContext(1,"family.40","Changed",1,"source");
      expect(manual).toBe(2);
      expect(f.catalogue.prepare("SELECT name FROM cat_config_context WHERE id=2").pluck().get())
        .toBe("Manual family");
      const imported=writer.upsertContext(1,"family.60","Imported",1,"source");
      writer.replaceModelContexts(2,"accepts",[manual,imported]);
      expect(f.catalogue.prepare(`SELECT COUNT(*) FROM cat_config_model_context
        WHERE model_id=2 AND role='accepts'`).pluck().get()).toBe(2);
      writer.replaceModelContexts(2,"accepts",[manual]);
      expect(f.catalogue.prepare(`SELECT context_id FROM cat_config_model_context
        WHERE model_id=2 AND role='accepts'`).pluck().all()).toEqual([manual]);
      writer.deactivateAbsentContexts(99,1,"family.");
      expect(f.catalogue.prepare("SELECT active FROM cat_config_context WHERE id=2").pluck().get())
        .toBe(1);
      expect(f.catalogue.prepare("SELECT active FROM cat_config_context WHERE id=?")
        .pluck().get(imported)).toBe(0);
      expect(()=>writer.replaceModelContexts(3,"accepts",[manual])).not.toThrow();
      f.catalogue.exec("UPDATE cat_config_model SET source='manual' WHERE id=3");
      expect(()=>writer.replaceModelContexts(3,"accepts",[manual])).toThrow(/manual model/);
    }finally{f.close();}
  });
  function hierarchy(f:ReturnType<typeof fixture>) {
    f.catalogue.exec(`DELETE FROM cat_range_node_model;DELETE FROM cat_range_node;
      INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,base_profile_id,definition_fingerprint,source,context_policy,source_import_id)
        VALUES(4,1,'second-root','Second','enclosure',1,'fingerprint','import','unrestricted',1),
        (5,1,'accessory','Accessory','accessory',NULL,'fingerprint','import','unrestricted',1),
        (6,1,'hidden','Hidden','support',2,'fingerprint','import','restricted',1);
      INSERT INTO cat_config_model_context(model_id,role,context_id) VALUES(4,'provides',2),(6,'accepts',1);
      INSERT INTO cat_range_node(id,brand_id,parent_id,code,name,node_kind,source,design_navigable,sort_order) VALUES
        (10,1,NULL,'s.enclosures','Carpenterie','section','import',1,0),
        (11,1,10,'s.zeta','Zeta','level','import',1,2),
        (13,1,10,'s.alpha','Alpha','level','import',1,1),
        (12,1,11,'s.zeta.family','Zeta family','level','import',1,0),
        (14,1,13,'s.alpha.family','Alpha family','level','import',1,0),
        (20,1,NULL,'s.panels','Pannelli','section','import',1,1),
        (21,1,20,'s.panels.gamma','Gamma','level','import',1,0),
        (22,1,21,'s.panels.group','Group','group','import',1,2),
        (23,1,22,'s.panels.family.a','Family A','level','import',1,0),
        (24,1,21,'s.panels.family.b','Family B','level','import',1,1),
        (30,1,20,'s.hidden','Hidden branch','level','import',0,3),
        (31,1,30,'s.hidden.family','Hidden family','level','import',1,0);
      INSERT INTO cat_range_node_model(node_id,model_id,sort_order) VALUES
        (12,1,0),(14,4,0),(23,2,0),(24,3,0),(24,5,1),(31,6,0);`);
    f.project.exec(`INSERT INTO prj_item(id,uuid,model_brand_marchio,model_code,model_name,model_kind,
        model_definition_fingerprint,config_fingerprint,config_label,config_status,phys_status,
        profile_code,profile_name,fit_class_code,fit_class_label,snapshot_taken_at)
        VALUES(2,'second-item','ACME','second-root','Second','enclosure','fingerprint','config',
          'Second','complete','resolved','root','Root','FRAME','Frame','2026-09-25');
      INSERT INTO prj_line(uuid,group_id,sort_order,line_type,item_id,quantity)
        VALUES('second-line',1,1,'item',2,1);
      INSERT INTO prj_node(id,uuid,item_id,node_kind,root_x_mm,root_y_mm,view_code,sort_order)
        VALUES(2,'second-node',2,'enclosure',500,0,'front',1);`);
  }
  it("returns a deterministic eligible hierarchy for Carpenterie and per-root Pannelli",()=>{
    const f=fixture();try {
      hierarchy(f);
      const outline=(result:ReturnType<typeof discoverDesignRangeNodes>)=>
        result.nodes.map(node=>[node.name,node.parentId,node.modelIds]);
      const enclosures=discoverDesignRangeNodes(f.catalogue,f.project,{kind:"enclosure"});
      expect(enclosures).toMatchObject({status:"ready",candidates:[1,4]});
      expect(outline(enclosures)).toEqual([["Carpenterie",null,[]],["Alpha",10,[]],
        ["Alpha family",13,[4]],["Zeta",10,[]],["Zeta family",11,[1]]]);
      expect(discoverDesignRangeNodes(f.catalogue,f.project,{kind:"enclosure"})).toEqual(enclosures);
      const first=discoverDesignRangeNodes(f.catalogue,f.project,{parentUuid:"root-node",kind:"support"});
      expect(first.candidates).toEqual([2]);
      expect(outline(first)).toEqual([["Pannelli",null,[]],["Gamma",20,[]],["Group",21,[]],["Family A",22,[2]]]);
      const second=discoverDesignRangeNodes(f.catalogue,f.project,{parentUuid:"second-node",kind:"support"});
      expect(second.candidates).toEqual([3]);
      expect(outline(second)).toEqual([["Pannelli",null,[]],["Gamma",20,[]],["Family B",21,[3]]]);
      for(const result of [enclosures,first,second]){
        const ids=new Set(result.nodes.map(node=>node.id));
        expect(result.nodes.every(node=>node.parentId===null||ids.has(node.parentId))).toBe(true);
        const listed=result.nodes.flatMap(node=>node.modelIds).sort();
        expect(listed).toEqual([...result.candidates].sort());
      }
      expect(first.nodes.flatMap(node=>node.modelIds)).not.toContain(6);
      expect(first.nodes.flatMap(node=>node.modelIds)).not.toContain(5);
    }finally{f.close();}
  });
  it("withholds hierarchy while engineering data is stale and for unusable roots",()=>{
    const f=fixture();try {
      hierarchy(f);
      f.catalogue.exec("UPDATE cat_config_model SET context_policy='unknown' WHERE id=3");
      expect(discoverDesignRangeNodes(f.catalogue,f.project,{parentUuid:"root-node",kind:"support"}))
        .toMatchObject({status:"engineering_data_stale",nodes:[],candidates:[],staleImportIds:[1]});
      expect(discoverDesignRangeNodes(f.catalogue,f.project,{kind:"support"}))
        .toMatchObject({status:"container_unavailable",nodes:[]});
      expect(discoverDesignRangeNodes(f.catalogue,f.project,{parentUuid:"missing",kind:"support"}))
        .toMatchObject({status:"container_unavailable",nodes:[]});
    }finally{f.close();}
  });
  it("guards a configured item from its snapshotted identity against the current catalogue",()=>{
    const f=fixture();try {
      const item:{brandMarchio:string;modelCode:string;definitionFingerprint:string;
        kind:"enclosure"|"support"|"device"}={brandMarchio:"ACME",modelCode:"good",
        definitionFingerprint:"fingerprint",kind:"support"};
      const guard=(overrides:Partial<typeof item>={},parentUuid:string|null="root-node")=>
        guardConfiguredStructuralItem(f.catalogue,f.project,
          {...(parentUuid===null?{}:{parentUuid}),item:{...item,...overrides}});
      expect(guard()).toEqual({ok:true,code:"compatible"});
      expect(guard({modelCode:"wrong"})).toMatchObject({ok:false,code:"required_context_not_provided"});
      expect(guard({definitionFingerprint:"other"})).toMatchObject({ok:false,code:"model_unavailable"});
      expect(guard({modelCode:"missing"})).toMatchObject({ok:false,code:"model_unavailable"});
      expect(guard({brandMarchio:"OTHER"})).toMatchObject({ok:false,code:"model_unavailable"});
      expect(guard({kind:"device"})).toMatchObject({ok:false,code:"model_unavailable"});
      expect(guard({},null)).toMatchObject({ok:false,code:"container_unavailable"});
      expect(guard({},"missing")).toMatchObject({ok:false,code:"container_unavailable"});
      f.catalogue.exec("UPDATE cat_config_model SET obsolete=1 WHERE id=2");
      expect(guard()).toMatchObject({ok:false,code:"model_unavailable"});
      f.catalogue.exec("UPDATE cat_config_model SET obsolete=0 WHERE id=2");
      f.catalogue.exec("UPDATE cat_range_node SET design_navigable=0 WHERE id=1");
      expect(guard()).toMatchObject({ok:false,code:"design_not_navigable"});
      f.catalogue.exec("UPDATE cat_range_node SET design_navigable=1 WHERE id=1;UPDATE cat_config_model SET context_policy='unknown' WHERE id=2");
      expect(guard()).toMatchObject({ok:false,code:"engineering_data_stale",staleImportIds:[1]});
      f.catalogue.exec("UPDATE cat_config_model SET context_policy='restricted' WHERE id=2;UPDATE cat_config_model SET definition_fingerprint='new' WHERE id=1");
      expect(guard()).toMatchObject({ok:false,code:"container_unavailable"});
    }finally{f.close();}
  });
  it("exposes the hierarchy to the renderer with local ids and names only, never source codes",()=>{
    const f=fixture();const userData=mkdtempSync(path.join(tmpdir(),"librequadri-design-service-"));
    try {
      hierarchy(f);
      f.catalogue.exec("UPDATE cat_range_node SET source_ref='SOURCE-ID-99'");
      const paths=applicationPaths(userData);
      mkdirSync(paths.data,{recursive:true});
      f.catalogue.exec(`VACUUM INTO '${paths.lqDatabase.replaceAll("'","''")}'`);
      const service=MainDatabaseService.initialize(userData,{migrationsFolder:path.resolve("db/migrations/lq")});
      try {
        const navigation=service.designNavigation(f.project,{parentUuid:"root-node",kind:"support"});
        expect(navigation).toMatchObject({status:"ready",staleImportIds:[],contextDataUnavailable:0});
        expect(navigation.candidates.map(model=>[model.code,model.kind])).toEqual([["good","support"]]);
        expect(navigation.nodes.map(node=>[node.name,node.modelIds])).toEqual(
          [["Pannelli",[]],["Gamma",[]],["Group",[]],["Family A",[2]]]);
        expect(Object.keys(navigation.nodes[0]!).sort())
          .toEqual(["id","kind","modelIds","name","parentId","sortOrder"]);
        expect(JSON.stringify(navigation)).not.toMatch(/SOURCE-ID-99|s\.panels/);
        expect(service.designNavigation(f.project,{kind:"enclosure"}).candidates.map(model=>model.id))
          .toEqual([1,4]);
        expect(service.designDiscover(f.project,{parentUuid:"root-node",kind:"support"}).candidates.map(model=>model.id))
          .toEqual(navigation.candidates.map(model=>model.id));
        expect(service.designItemGuard(f.project,{parentUuid:"root-node",item:{brandMarchio:"ACME",
          modelCode:"good",definitionFingerprint:"fingerprint",kind:"support"}}))
          .toEqual({ok:true,code:"compatible"});
      }finally{service.close();}
    }finally{f.close();rmSync(userData,{recursive:true,force:true});}
  });
});
