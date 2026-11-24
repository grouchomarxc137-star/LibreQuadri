import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { browseRangeNodes, getConfigurationModel, listNodeModels, listProductModels } from "../src/main/catalogue/configuration-queries.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";

describe("generic configuration resolution",()=>{
  let root:string,db:Database.Database;
  beforeAll(()=>{
    root=mkdtempSync(path.join(tmpdir(),"librequadri-config-"));
    db=openMigratedLqDatabase({databaseFilename:path.join(root,"lq.db"),
      backupDirectory:path.join(root,"backup"),migrationsFolder:path.resolve("db/migrations/lq")});
    db.exec(`
      INSERT INTO cat_metel_issuer(id,metel_sigla) VALUES (1,'ABC');
      INSERT INTO cat_brand(id,metel_marchio,name,source) VALUES (1,'ABC','Example','manual');
      INSERT INTO app_import_delivery(id,issuer_id,fingerprint,listino_number,valid_from,became_current,normalized_at,summary_json)
        VALUES (1,1,'${"a".repeat(64)}','1','2026-01-01',1,'2026-01-01','{}');
      INSERT INTO com_price_list(id,issuer_id,delivery_id,listino_number,valid_from,is_current)
        VALUES (1,1,1,'1','2026-01-01',1);
      INSERT INTO cat_product(id,brand_id,manufacturer_code,code_norm,governing_issuer_id,description,is_listed,updated_at)
        VALUES (1,1,'A','A',1,'Primary',1,'2026-01-01'),(2,1,'B','B',1,'Accessory',1,'2026-01-01');
      INSERT INTO cat_product_listing(product_id,issuer_id,lifecycle_status_code,lead_time_code,short_description,
        unit_of_measure,pack_qty,min_order_qty,order_multiple,max_order_qty,is_kit,is_listed,
        first_seen_delivery_id,last_seen_delivery_id)
        VALUES (1,1,'','','A','PZ',1,1,1,1,0,1,1,1),(2,1,'','','B','PZ',1,1,1,1,0,1,1,1);
      INSERT INTO com_product_price(product_id,price_list_id,list_price_e4,price_multiplier,currency,list_price_unit_e4)
        VALUES (1,1,10000,1,'EUR',10000),(2,1,5000,1,'EUR',5000);
      INSERT INTO cat_capacity_kind(code,name,unit_label,display_divisor,source) VALUES ('din_rail','DIN','half modules',2,'seed');
      INSERT INTO cat_phys_class(id,code,name,source) VALUES (1,'class','Class','manual');
      INSERT INTO cat_phys_profile_set(id,code,name,source) VALUES (1,'set','Set','manual');
      INSERT INTO cat_phys_profile(id,code,profile_set_id,profile_key,profile_kind,name,fit_class_id,source)
        VALUES (1,'p10',1,10,'device','Two modules',1,'manual'),
               (2,'p12',1,12,'device','Three modules',1,'manual');
      INSERT INTO cat_phys_profile_demand VALUES (1,'din_rail',4),(2,'din_rail',6);
      INSERT INTO cat_phys_view(profile_id,view_code,width_mm,height_mm,symbol_kind)
        VALUES (1,'front',36,80,'rectangle'),(2,'front',54,80,'rectangle');
      INSERT INTO cat_config_dimension(id,brand_id,code,name,source)
        VALUES (1,1,'primary','Primary','manual'),(2,1,'accessory','Accessory','manual');
      INSERT INTO cat_config_dimension_value(id,dimension_id,code,label,source)
        VALUES (1,1,'a','A','manual'),(2,1,'other','Other','manual'),
               (3,2,'b','B','manual'),(4,2,'expensive','Expensive','manual');
      INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,base_profile_id,definition_fingerprint,source)
        VALUES (1,1,'model','Model','device',1,'definition','manual');
      INSERT INTO cat_config_axis(id,model_id,dimension_id,sort_order,label,visibility,requirement,binding)
        VALUES (1,1,1,1,'Primary','visible','required','none'),
               (2,1,2,2,'Accessory','visible','optional','none');
      INSERT INTO cat_config_option(id,axis_id,value_id,parent_option_id,is_default,sort_order)
        VALUES (1,1,1,NULL,1,1),(2,1,2,NULL,0,2),(3,2,3,1,0,1),(4,2,4,1,0,2);
      INSERT INTO cat_config_model_article VALUES (1,1,1,'ABC','A',1,'primary');
      INSERT INTO cat_config_budget VALUES (1,'aux','Aux',1);
      INSERT INTO cat_config_rule(id,model_id,seq) VALUES (1,1,1),(2,1,2),(3,1,3);
      INSERT INTO cat_config_rule_condition VALUES (1,3),(2,4),(3,2);
      INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,product_id,ref_brand_marchio,ref_manufacturer_code,quantity,article_role)
        VALUES (1,1,'article',1,'ABC','A',1,'accessory'),(1,2,'article',2,'ABC','B',1,'accessory'),
               (1,3,'article',2,'ABC','B',1,'accessory'),(2,1,'article',NULL,'ABC','MISSING',1,'accessory');
      INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,int_value)
        VALUES (1,4,'profile_key_delta',2);
      INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,int_value,budget_code)
        VALUES (1,5,'budget_use',1,'aux'),(2,2,'budget_use',2,'aux');
      INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,profile_id)
        VALUES (3,1,'profile_override',2);
      INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,int_value,capacity_kind_code)
        VALUES (3,2,'demand_delta',1,'din_rail');
      INSERT INTO cat_config_model_entry VALUES (1,1,1);
      INSERT INTO cat_range_node(id,brand_id,code,name,node_kind,source) VALUES (1,1,'root','Root','group','manual');
      INSERT INTO cat_range_node_model VALUES (1,1,1);
    `);
  });
  afterAll(()=>{db?.close();if(root)rmSync(root,{recursive:true,force:true});});

  it("browses normalized models and exposes axis metadata",()=>{
    expect(browseRangeNodes(db)).toMatchObject([{code:"root",brandMarchio:"ABC"}]);
    expect(listNodeModels(db,1)).toMatchObject([{code:"model",kind:"device"}]);
    expect(listProductModels(db,1)).toMatchObject([{code:"model",preselectedOptionId:1}]);
    expect(getConfigurationModel(db,1).axes[1]).toMatchObject({requirement:"optional",
      options:[{parentOptionId:1},{parentOptionId:1}]});
  });
  it("defaults the primary, aggregates identical articles and uses current METEL unit prices",()=>{
    const result=resolveConfiguration(db,{modelId:1,selectedOptionIds:[3]});
    expect(result.status).toBe("complete");
    expect(result.defaultedOptionIds).toContain(1);
    expect(result.matchingRuleIds).toEqual([1]);
    expect(result.bom).toMatchObject([
      {manufacturerCode:"A",quantity:2,rowTotalE4:20000},
      {manufacturerCode:"B",quantity:2,rowTotalE4:10000},
    ]);
    expect(result.totalE4).toBe(30000);
    expect(result.physical).toMatchObject({code:"p12",demands:[{capacityKindCode:"din_rail",amount:6}]});
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
  it("leaves a required axis unresolved when no valid default exists",()=>{
    db.prepare("UPDATE cat_config_option SET is_default=0 WHERE id=1").run();
    try {
      const result=resolveConfiguration(db,{modelId:1,selectedOptionIds:[]});
      expect(result.status).toBe("incomplete");
      expect(result.selectedOptionIds).toEqual([]);
      expect(result.issues.map(issue=>issue.code)).toContain("missing_required");
    } finally {db.prepare("UPDATE cat_config_option SET is_default=1 WHERE id=1").run();}
  });
  it("reports invalid parent, foreign option, budget overflow and unresolved article",()=>{
    expect(resolveConfiguration(db,{modelId:1,selectedOptionIds:[2,3]}).issues.map(i=>i.code))
      .toContain("unavailable_option");
    expect(resolveConfiguration(db,{modelId:1,selectedOptionIds:[999]}).status).toBe("invalid");
    const overflow=resolveConfiguration(db,{modelId:1,selectedOptionIds:[4]});
    expect(overflow.status).toBe("budget_exceeded");
    expect(overflow.issues.map(i=>i.code)).toContain("unresolved_article");
    expect(overflow.totalE4).toBeNull();
    expect(overflow.bom.find(a=>a.manufacturerCode==="MISSING")).toMatchObject({productId:null,rowTotalE4:null});
  });
  it("applies explicit profile overrides and demand deltas, and reports missing keyed variants",()=>{
    const overridden=resolveConfiguration(db,{modelId:1,selectedOptionIds:[2]});
    expect(overridden.physical).toMatchObject({code:"p12",demands:[{amount:7}]});
    db.prepare(`UPDATE cat_config_rule_effect SET int_value=99 WHERE rule_id=1 AND seq=4`).run();
    try {
      const absent=resolveConfiguration(db,{modelId:1,selectedOptionIds:[3]});
      expect(absent.status).toBe("no_profile");
      expect(absent.physical).toBeNull();
      expect(absent.bom.length).toBeGreaterThan(0);
    } finally {
      db.prepare(`UPDATE cat_config_rule_effect SET int_value=2 WHERE rule_id=1 AND seq=4`).run();
    }
  });
  it("sums decimal quantities before exact integer _e4 pricing",()=>{
    db.prepare(`UPDATE cat_config_rule_effect SET quantity=0.1 WHERE rule_id=1 AND seq=2`).run();
    db.prepare(`UPDATE cat_config_rule_effect SET quantity=0.2 WHERE rule_id=1 AND seq=3`).run();
    try {
      const result=resolveConfiguration(db,{modelId:1,selectedOptionIds:[3]});
      expect(result.bom.find(a=>a.manufacturerCode==="B"))
        .toMatchObject({quantity:0.3,rowTotalE4:1500});
      expect(result.totalE4).toBe(21500);
    } finally {
      db.prepare(`UPDATE cat_config_rule_effect SET quantity=1 WHERE rule_id=1 AND seq IN (2,3)`).run();
    }
  });
});
