import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadCapacityKindSeed, loadSourceBrandMapSeed,
  synchronizeCapacityKindSeed, synchronizeSourceBrandMapSeed,
} from "../src/main/catalogue/engineering-seed.js";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { discoverDesignCandidates } from "../src/main/project/design-compatibility.js";

const roots: string[] = [];
function root(): string {
  const folder = mkdtempSync(path.join(tmpdir(), "librequadri-engineering-schema-"));
  roots.push(folder);
  return folder;
}
afterEach(() => { for (const folder of roots.splice(0)) rmSync(folder, { recursive: true, force: true }); });

function open(folder: string, migrationsFolder = path.resolve("db/migrations/lq")): Database.Database {
  return openMigratedLqDatabase({ databaseFilename: path.join(folder, "lq.db"), backupDirectory: path.join(folder, "backups"), migrationsFolder });
}

const newTables = [
  "app_source_import", "app_source_import_file", "cat_capacity_kind",
  "cat_phys_class", "cat_phys_profile_set", "cat_phys_profile", "cat_phys_profile_demand",
  "cat_phys_view", "cat_phys_zone", "cat_phys_zone_slot", "cat_phys_accept_set",
  "cat_phys_accept_set_member", "cat_phys_constraint", "cat_product_physical",
  "cat_config_dimension", "cat_config_dimension_value", "cat_config_model",
  "cat_config_model_article", "cat_config_capacity_filler", "cat_config_axis", "cat_config_option", "cat_config_rule",
  "cat_config_rule_condition", "cat_config_rule_effect", "cat_config_budget",
  "cat_config_model_entry", "cat_config_exclusion", "cat_config_model_relation",
  "cat_range_node", "cat_range_node_model", "cat_asset_license", "cat_asset",
  "cat_asset_variant", "cat_source_brand_map", "cat_source_conflict",
];

describe("Revision 8 catalogue storage", () => {
  it("adds Revision 8.3 columns to populated 0007 data as unknown and non-navigable",()=>{
    const folder=root(),oldFolder=path.join(folder,"old-0007");
    mkdirSync(path.join(oldFolder,"meta"),{recursive:true});
    const journal=JSON.parse(readFileSync("db/migrations/lq/meta/_journal.json","utf8")) as
      {entries:Array<{tag:string}>};
    writeFileSync(path.join(oldFolder,"meta/_journal.json"),JSON.stringify({version:"7",dialect:"sqlite",
      entries:journal.entries.slice(0,8)}));
    for(const entry of journal.entries.slice(0,8))writeFileSync(
      path.join(oldFolder,`${entry.tag}.sql`),readFileSync(`db/migrations/lq/${entry.tag}.sql`));
    const old=open(folder,oldFolder);
    old.exec(`INSERT INTO cat_brand(id,metel_marchio,name,source) VALUES(1,'ACME','Acme','manual');
      INSERT INTO app_source_import(id,adapter_code,adapter_version,source_label,fingerprint,imported_at,became_current,summary_json)
        VALUES(1,'listino_bt','1','Old import','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-09-24',1,'{}');
      INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,definition_fingerprint,source,source_import_id)
        VALUES(1,1,'box','Box','enclosure','fingerprint','import',1);
      INSERT INTO cat_range_node(id,brand_id,code,name,node_kind,source,navigable)
        VALUES(1,1,'section','Section','section','manual',1);
      INSERT INTO cat_range_node_model(node_id,model_id) VALUES(1,1);`);
    old.close();
    const db=open(folder);
    try {
      expect(db.prepare("SELECT context_policy FROM cat_config_model WHERE id=1").pluck().get())
        .toBe("unknown");
      expect(db.prepare("SELECT navigable,design_navigable FROM cat_range_node WHERE id=1").get())
        .toEqual({navigable:1,design_navigable:0});
      expect(db.pragma("foreign_key_check")).toEqual([]);
      const project=new Database(":memory:");
      try {
        project.exec(`CREATE TABLE prj_item(id INTEGER PRIMARY KEY,model_brand_marchio TEXT,
          model_code TEXT,model_definition_fingerprint TEXT,fit_class_code TEXT);
          CREATE TABLE prj_node(id INTEGER PRIMARY KEY,uuid TEXT,parent_id INTEGER,item_id INTEGER,node_kind TEXT);
          INSERT INTO prj_item VALUES(1,'ACME','box','fingerprint','FRAME');
          INSERT INTO prj_node VALUES(1,'root',NULL,1,'enclosure');`);
        expect(discoverDesignCandidates(db,project,{parentUuid:"root",kind:"support"}))
          .toEqual({status:"engineering_data_stale",candidates:[],staleImportIds:[1],
            contextDataUnavailable:0});
      }finally{project.close();}
    }finally{db.close();}
  });
  it("migrates a clean lq.db with every Step 9.1 table and no raw-source tables", () => {
    const db = open(root());
    try {
      const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").pluck().all() as string[]);
      for (const table of newTables) expect(tables.has(table), table).toBe(true);
      expect(tables.has("raw_file")).toBe(false);
      expect(tables.has("prj_item")).toBe(false);
      expect(db.prepare("SELECT COUNT(*) FROM __drizzle_migrations").pluck().get()).toBe(21);
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); }
  });

  it("upgrades the exact 0000–0003 prefix while retaining existing products and family assignments", () => {
    const folder = root();
    const oldFolder = path.join(folder, "old");
    mkdirSync(path.join(oldFolder, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync("db/migrations/lq/meta/_journal.json", "utf8")) as {entries: Array<{tag: string}>};
    writeFileSync(path.join(oldFolder, "meta/_journal.json"), JSON.stringify({ version: "7", dialect: "sqlite", entries: journal.entries.slice(0, 4) }));
    for (const entry of journal.entries.slice(0, 4)) {
      writeFileSync(path.join(oldFolder, `${entry.tag}.sql`), readFileSync(`db/migrations/lq/${entry.tag}.sql`));
    }
    const old = open(folder, oldFolder);
    old.exec(`INSERT INTO cat_brand (id, metel_marchio, name, source) VALUES (1,'BTI','BTicino','import');
      INSERT INTO cat_category (id, code, name, source) VALUES (1,'protezione','Protezione','seed');
      INSERT INTO cat_product (id,brand_id,manufacturer_code,code_norm,is_listed,updated_at)
        VALUES (1,1,'FN82C16','FN82C16',1,'2026-09-23');
      INSERT INTO cat_product_family (id,brand_id,code,category_id,name,source)
        VALUES (1,1,'mcb',1,'MCB','seed');
      INSERT INTO cat_product_family_assignment (product_id,family_id,state)
        VALUES (1,1,'manual');`);
    old.close();
    const db = open(folder);
    try {
      expect(db.prepare("SELECT manufacturer_code FROM cat_product WHERE id=1").pluck().get()).toBe("FN82C16");
      expect(db.prepare("SELECT family_id FROM cat_product_family_assignment WHERE product_id=1").pluck().get()).toBe(1);
      expect(db.pragma("foreign_key_check")).toEqual([]);
      expect(readMigrationFiles({ migrationsFolder: path.resolve("db/migrations/lq") })).toHaveLength(21);
    } finally { db.close(); }
  });

  it("synchronizes capacity kinds and source brand mappings idempotently with protected manual overrides", () => {
    const db = open(root());
    try {
      db.exec(`INSERT INTO cat_brand (id,metel_marchio,name,source) VALUES
        (1,'BTI','BTicino','import'), (2,'LEG','Legrand','import'), (3,'IMS','IMS','import');`);
      const capacities = loadCapacityKindSeed();
      const mappings = loadSourceBrandMapSeed();
      synchronizeCapacityKindSeed(db, capacities);
      expect(synchronizeSourceBrandMapSeed(db, mappings)).toBe(0);
      const beforeKinds = db.prepare("SELECT * FROM cat_capacity_kind ORDER BY code").all();
      const beforeMaps = db.prepare("SELECT * FROM cat_source_brand_map ORDER BY adapter_code,source_brand_code").all();
      synchronizeCapacityKindSeed(db, capacities);
      expect(synchronizeSourceBrandMapSeed(db, mappings)).toBe(0);
      expect(db.prepare("SELECT * FROM cat_capacity_kind ORDER BY code").all()).toEqual(beforeKinds);
      expect(db.prepare("SELECT * FROM cat_source_brand_map ORDER BY adapter_code,source_brand_code").all()).toEqual(beforeMaps);
      expect(db.prepare("SELECT display_divisor,nominal_pitch_mm FROM cat_capacity_kind WHERE code='din_rail'").get())
        .toEqual({ display_divisor: 2, nominal_pitch_mm: 9 });
      expect(db.prepare("SELECT brand_id FROM cat_source_brand_map WHERE source_brand_code='IM-'").pluck().get()).toBe(3);
      expect(db.prepare("SELECT brand_id FROM cat_source_brand_map WHERE source_brand_code='CT-'").pluck().get()).toBeNull();
      db.exec(`UPDATE cat_capacity_kind SET name='Manual DIN', source='manual' WHERE code='din_rail';
        UPDATE cat_source_brand_map SET brand_id=NULL, source='manual' WHERE source_brand_code='BT-';`);
      synchronizeCapacityKindSeed(db, capacities);
      synchronizeSourceBrandMapSeed(db, mappings);
      expect(db.prepare("SELECT name FROM cat_capacity_kind WHERE code='din_rail'").pluck().get()).toBe("Manual DIN");
      expect(db.prepare("SELECT brand_id FROM cat_source_brand_map WHERE source_brand_code='BT-'").pluck().get()).toBeNull();
    } finally { db.close(); }
  });

  it("defers named mappings until the METEL brand exists, while keeping explicit unmapped rows", () => {
    const db = open(root());
    try {
      const seed = loadSourceBrandMapSeed();
      expect(synchronizeSourceBrandMapSeed(db, seed)).toBe(3);
      expect(db.prepare("SELECT COUNT(*) FROM cat_source_brand_map").pluck().get()).toBe(3);
      db.exec("INSERT INTO cat_brand (id,metel_marchio,name,source) VALUES (1,'IMS','IMS','import')");
      expect(synchronizeSourceBrandMapSeed(db, seed)).toBe(2);
      expect(db.prepare("SELECT brand_id FROM cat_source_brand_map WHERE source_brand_code='IM-'").pluck().get()).toBe(1);
    } finally { db.close(); }
  });

  it("enforces physical, configuration, asset, provenance and relation constraints", () => {
    const db = open(root());
    try {
      db.exec(`INSERT INTO cat_brand (id,metel_marchio,name,source) VALUES (1,'BTI','BTicino','import');
        INSERT INTO cat_product (id,brand_id,manufacturer_code,code_norm,is_listed,updated_at)
          VALUES (1,1,'FN82C16','FN82C16',1,'2026-09-23');`);
      synchronizeCapacityKindSeed(db);
      expect(() => db.exec("INSERT INTO cat_phys_profile_demand VALUES (999,'din_rail',4)")).toThrow(/FOREIGN KEY/);
      expect(() => db.exec("INSERT INTO cat_capacity_kind VALUES ('bad','Bad','x',0,NULL,'seed')")).toThrow(/CHECK/);
      db.exec(`INSERT INTO cat_phys_class (id,code,name,source) VALUES (1,'test.class','Class','manual');
        INSERT INTO cat_phys_profile_set (id,code,name,source) VALUES (1,'test.set','Set','manual');
        INSERT INTO cat_phys_profile (id,code,profile_set_id,profile_key,profile_kind,name,fit_class_id,source)
          VALUES (1,'test.profile',1,100,'device','Device',1,'manual');
        INSERT INTO cat_phys_profile_demand VALUES (1,'din_rail',4);
        INSERT INTO cat_phys_zone (profile_id,zone_no,layout,capacity_kind_code,capacity_amount)
          VALUES (1,1,'linear','din_rail',48);
        INSERT INTO cat_config_model (id,brand_id,code,name,model_kind,definition_fingerprint,source)
          VALUES (1,1,'test.model','Model','device','abc','manual');
        INSERT INTO cat_config_rule (id,model_id,seq) VALUES (1,1,1);
        INSERT INTO cat_config_rule_effect (rule_id,seq,effect_kind,ref_brand_marchio,ref_manufacturer_code,quantity,article_role)
          VALUES (1,1,'article','BTI','FN82C16',1,'primary');`);
      expect(db.prepare("SELECT amount, typeof(amount) AS storage FROM cat_phys_profile_demand").get())
        .toEqual({ amount: 4, storage: "integer" });
      expect(db.prepare("SELECT d.amount * 1.0 / k.display_divisor FROM cat_phys_profile_demand d JOIN cat_capacity_kind k ON k.code=d.capacity_kind_code").pluck().get()).toBe(2);
      expect(() => db.exec("INSERT INTO cat_phys_profile_demand VALUES (1,'din_rail',-1)")).toThrow();
      expect(() => db.exec("UPDATE cat_phys_profile_demand SET amount=1.5")).toThrow(/CHECK/);
      expect(() => db.exec("INSERT INTO cat_product_physical (product_id,din_half_modules,source) VALUES (1,1.5,'manual')")).toThrow(/CHECK/);
      expect(() => db.exec("INSERT INTO cat_phys_zone_slot VALUES (1,999,1,0,0)")).toThrow(/FOREIGN KEY/);
      expect(() => db.exec("INSERT INTO cat_phys_profile (code,profile_set_id,profile_key,profile_kind,name,fit_class_id,source) VALUES ('duplicate.key',1,100,'device','Duplicate',1,'manual')")).toThrow(/UNIQUE/);
      expect(() => db.exec("INSERT INTO cat_phys_profile (code,profile_set_id,profile_kind,name,fit_class_id,source) VALUES ('missing.class',1,'device','Missing',999,'manual')")).toThrow(/FOREIGN KEY/);
      expect(() => db.exec("INSERT INTO cat_config_rule_effect (rule_id,seq,effect_kind,quantity) VALUES (1,2,'article',1)")).toThrow(/CHECK/);
      expect(() => db.exec("INSERT INTO cat_config_rule_effect (rule_id,seq,effect_kind,ref_brand_marchio,ref_manufacturer_code,article_role) VALUES (1,2,'article','BTI','FN82C16','primary')")).toThrow(/CHECK/);
      expect(() => db.exec("INSERT INTO cat_config_rule_effect (rule_id,seq,effect_kind,int_value,capacity_kind_code) VALUES (1,2,'demand_delta',1,'unknown')")).toThrow(/FOREIGN KEY/);
      expect(() => db.exec("INSERT INTO cat_config_model_article VALUES (1,1,NULL,'BTI','FN82C16',0,'primary')")).toThrow(/CHECK/);
      expect(() => db.exec("INSERT INTO cat_config_model (id,brand_id,code,name,model_kind,definition_fingerprint,source) VALUES (2,1,'test.model','Duplicate','device','def','manual')")).toThrow(/UNIQUE/);
      expect(() => db.exec("INSERT INTO cat_range_node(brand_id,code,name,node_kind,source) VALUES(1,'invalid','Invalid','level1','manual')"))
        .toThrow(/CHECK/);
      expect(() => db.exec("INSERT INTO cat_range_source_level_map(adapter_code,system_id,source_level,catalogue_navigable,source) VALUES('test',1,'g1',2,'manual')"))
        .toThrow(/CHECK/);
      expect(() => db.exec("INSERT INTO cat_asset_license VALUES ('bad','Bad',2,0,NULL)")).toThrow(/CHECK/);
      expect(() => db.exec(`INSERT INTO app_source_import_file VALUES (999,'master','${"a".repeat(64)}','x',1)`)).toThrow(/FOREIGN KEY/);
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); }
  });

  it("enforces the context vocabulary, role links, policies and design flag",()=>{
    const db=open(root());try {
      db.exec(`INSERT INTO cat_brand(id,metel_marchio,name,source) VALUES(1,'ACME','Acme','manual');
        INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,definition_fingerprint,source)
          VALUES(1,1,'box','Box','enclosure','f','manual');
        INSERT INTO cat_config_context(id,brand_id,code,name,source)
          VALUES(1,1,'family','Family','manual');
        INSERT INTO cat_config_model_context(model_id,context_id,role) VALUES(1,1,'provides');
        INSERT INTO cat_range_node(id,brand_id,code,name,node_kind,source)
          VALUES(1,1,'section','Section','section','manual');`);
      expect(db.prepare("SELECT context_policy FROM cat_config_model WHERE id=1").pluck().get())
        .toBe("unknown");
      expect(db.prepare("SELECT design_navigable FROM cat_range_node WHERE id=1").pluck().get())
        .toBe(0);
      expect(() => db.exec("UPDATE cat_config_model SET context_policy='invalid' WHERE id=1"))
        .toThrow(/CHECK/);
      expect(() => db.exec("UPDATE cat_range_node SET design_navigable=2 WHERE id=1"))
        .toThrow(/CHECK/);
      expect(() => db.exec("INSERT INTO cat_config_context(brand_id,code,name,source) VALUES(1,'family','Duplicate','manual')"))
        .toThrow(/UNIQUE/);
      expect(() => db.exec("INSERT INTO cat_config_context(brand_id,code,name,source) VALUES(999,'other','Other','manual')"))
        .toThrow(/FOREIGN KEY/);
      expect(() => db.exec("INSERT INTO cat_config_model_context VALUES(1,999,'accepts')"))
        .toThrow(/FOREIGN KEY/);
      expect(() => db.exec("INSERT INTO cat_config_model_context VALUES(1,1,'other')"))
        .toThrow(/CHECK/);
      expect(db.prepare("PRAGMA index_info('cat_config_model_context_context_role_model_idx')")
        .all()).toMatchObject([{name:"context_id"},{name:"role"},{name:"model_id"}]);
      db.exec("DELETE FROM cat_config_model WHERE id=1");
      expect(db.prepare("SELECT COUNT(*) FROM cat_config_model_context").pluck().get()).toBe(0);
      expect(db.prepare("SELECT COUNT(*) FROM cat_config_context").pluck().get()).toBe(1);
    }finally{db.close();}
  });
});
