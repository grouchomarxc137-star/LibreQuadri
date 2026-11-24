import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { synchronizePackageOffers, offerSelection, PACKAGE_OFFER_FINGERPRINT_KEY } from "../src/main/catalogue/package-offers.js";
import { browseCatalogue } from "../src/main/catalogue/browse-queries.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";
import { configuredItemAddable } from "../src/main/catalogue/configuration-addability.js";
import { TIQUADRI_ENGINEERING_ADAPTER } from "../src/main/sources/tiquadri/adapter.js";

// The running adapter version, so getConfigurationModel's own readiness gate agrees with the fixture.
const RUNNING = TIQUADRI_ENGINEERING_ADAPTER.version;
const UPGRADED = String(Number(RUNNING) + 1);

const roots: string[] = [];
function fixture(): Database.Database {
  const root = mkdtempSync(path.join(tmpdir(), "librequadri-package-offers-")); roots.push(root);
  const db = openMigratedLqDatabase({ databaseFilename: path.join(root, "lq.db"),
    backupDirectory: path.join(root, "backup"), migrationsFolder: path.resolve("db/migrations/lq") });
  db.exec(`
    INSERT INTO cat_metel_issuer(id,metel_sigla) VALUES(1,'EXA');
    INSERT INTO cat_brand(id,metel_marchio,name,source) VALUES(1,'EXA','Example','manual');
    INSERT INTO app_source_import(id,adapter_code,adapter_version,source_label,fingerprint,imported_at,became_current,summary_json)
      VALUES(1,'assets','1','fixture','${"a".repeat(64)}','2026-01-01',1,'{}');
    INSERT INTO app_import_delivery(id,issuer_id,fingerprint,listino_number,valid_from,became_current,normalized_at,summary_json)
      VALUES(1,1,'${"b".repeat(64)}','1','2026-01-01',1,'2026-01-01','{}');
    INSERT INTO com_price_list(id,issuer_id,delivery_id,listino_number,valid_from,is_current)
      VALUES(1,1,1,'1','2026-01-01',1);
    INSERT INTO cat_category(id,code,name,source) VALUES(1,'synthetic.devices','Devices','manual');
    INSERT INTO cat_attribute(id,code,name,data_type,source) VALUES
      (1,'rated_current','In','number','manual'),(2,'feature','Feature','enum','manual');
    INSERT INTO cat_attribute_option(id,attribute_id,value,label,source) VALUES(1,2,'present','Present','manual');
    INSERT INTO cat_category_attribute(category_id,attribute_id,source) VALUES(1,1,'manual'),(1,2,'manual');
    INSERT INTO cat_product(id,brand_id,manufacturer_code,code_norm,governing_issuer_id,is_listed,updated_at)
      VALUES(1,1,'A','A',1,1,'2026-01-01'),(2,1,'B','B',1,1,'2026-01-01');
    INSERT INTO cat_product_listing(product_id,issuer_id,lifecycle_status_code,lead_time_code,
      short_description,unit_of_measure,pack_qty,min_order_qty,order_multiple,max_order_qty,is_kit,is_listed,
      first_seen_delivery_id,last_seen_delivery_id) VALUES
      (1,1,'','','A','PZ',1,1,1,1,0,1,1,1),(2,1,'','','B','PZ',1,1,1,1,0,1,1,1);
    INSERT INTO com_product_price(product_id,price_list_id,list_price_e4,price_multiplier,currency,list_price_unit_e4)
      VALUES(1,1,10000,1,'EUR',10000);
    INSERT INTO cat_phys_class(id,code,name,source) VALUES(1,'fit','Fit','manual');
    INSERT INTO cat_phys_profile_set(id,code,name,source) VALUES(1,'set','Set','manual');
    INSERT INTO cat_phys_profile(id,code,profile_set_id,profile_key,profile_kind,name,fit_class_id,source)
      VALUES(1,'profile',1,1,'device','Profile',1,'manual');
    INSERT INTO cat_config_dimension(id,brand_id,code,name,source) VALUES
      (1,1,'rating','Rating','manual'),(2,1,'mode','Mode','manual'),(3,1,'hidden','Hidden','manual');
    INSERT INTO cat_config_dimension_value(id,dimension_id,code,label,source) VALUES
      (1,1,'r1','1','manual'),(2,1,'r2','2','manual'),(3,1,'r3','3','manual'),
      (4,1,'r4','4','manual'),(5,1,'r5','5','manual'),
      (6,2,'bad','Bad','manual'),(7,2,'good','Good','manual'),(8,3,'present','Present','manual');
    INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,commercial_contribution,
      base_profile_id,definition_fingerprint,source,category_id,category_source)
      VALUES(1,1,'synthetic.package','Synthetic package','device','articles',1,'definition','manual',1,'manual');
    INSERT INTO cat_config_axis(id,model_id,dimension_id,sort_order,label,visibility,requirement,binding) VALUES
      (1,1,1,1,'Rating','visible','required','none'),
      (2,1,2,2,'Mode','visible','required','none'),
      (3,1,3,3,'Hidden','hidden','required','none');
    INSERT INTO cat_config_option(id,axis_id,value_id,is_default,sort_order) VALUES
      (1,1,1,1,1),(2,1,2,0,2),(3,1,3,0,3),(4,1,4,0,4),(5,1,5,0,5),
      (6,2,6,1,1),(7,2,7,0,2),(8,3,8,1,1);
    INSERT INTO cat_config_model_article(model_id,seq,product_id,ref_brand_marchio,ref_manufacturer_code,quantity,role)
      VALUES(1,1,1,'EXA','A',1,'primary');
    INSERT INTO cat_config_budget(model_id,code,label,max_amount) VALUES(1,'limit','Limit',1);
    INSERT INTO cat_config_rule(id,model_id,seq) VALUES(1,1,1),(2,1,2),(3,1,3),(4,1,4);
    INSERT INTO cat_config_rule_condition(rule_id,option_id) VALUES(1,6),(2,3),(3,4),(4,5);
    INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,product_id,ref_brand_marchio,
      ref_manufacturer_code,quantity,article_role) VALUES
      (1,1,'article',2,'EXA','B',1,'accessory'),(4,1,'article',2,'EXA','B',1,'accessory');
    INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,int_value,budget_code)
      VALUES(2,1,'budget_use',2,'limit');
    INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,int_value)
      VALUES(3,1,'profile_key_delta',99);
    INSERT INTO cat_config_value_attribute(value_id,attribute_id,value_num,source) VALUES
      (1,1,1,'manual'),(2,1,2,'manual'),(3,1,3,'manual'),(4,1,4,'manual'),(5,1,5,'manual');
    INSERT INTO cat_config_value_attribute(value_id,attribute_id,option_id,source) VALUES(8,2,1,'manual');
    INSERT INTO cat_range_node(id,brand_id,code,name,node_kind,source,navigable)
      VALUES(1,1,'root','Root','group','manual',1);
    INSERT INTO cat_range_node_model(node_id,model_id) VALUES(1,1);
  `);
  return db;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("generic package offers with synthetic category", () => {
  it("searches to an addable witness, stores hidden defaults, excludes impossible candidates and filters one offer at a time", () => {
    const db = fixture();
    try {
      const stats = synchronizePackageOffers(db);
      expect(stats).toMatchObject({ recomputed: true, models: 1, candidates: 5, feasible: 2, infeasible: 3, undecided: 0 });
      expect(synchronizePackageOffers(db).recomputed).toBe(false);
      const stored = db.prepare("SELECT offer_no AS offerNo FROM cat_config_model_offer WHERE status='feasible' ORDER BY offer_no")
        .all() as Array<{ offerNo: number }>;
      expect(stored.map(row => row.offerNo)).toEqual([0, 1]);
      for (const row of stored) {
        const witness = offerSelection(db, 1, row.offerNo);
        expect(witness.status).toBe("ready");
        if (witness.status !== "ready") continue;
        const result = resolveConfiguration(db, { modelId: 1, selectedOptionIds: witness.selectedOptionIds });
        expect(configuredItemAddable(result)).toBe(true);
        expect(witness.selectedOptionIds).toContain(8); // hidden default
        expect(witness.selectedOptionIds).toContain(7); // searched alternative
      }
      const yes = browseCatalogue(db, { nodeId: 1, attributeFilters: [
        { attributeCode: "rated_current", values: [2] }, { attributeCode: "feature", values: ["present"] }] });
      expect(yes).toMatchObject({ packageCount: 1, packages: [{ modelId: 1, offerNo: 1 }] });
      const no = browseCatalogue(db, { nodeId: 1, attributeFilters: [{ attributeCode: "rated_current", values: [3] }] });
      expect(no.packageCount).toBe(0);
      expect(no.undecidedPackages).toEqual([]);
      expect(no.facets.attributes.find(attribute => attribute.code === "rated_current")?.values
        .map(row => [row.value, row.count])).toEqual([[1, 1], [2, 1], [3, 0]]);
      db.prepare("UPDATE cat_config_model SET definition_fingerprint='changed' WHERE id=1").run();
      expect(offerSelection(db, 1, 0)).toEqual({ status: "offer_stale" });
    } finally { db.close(); }
  });

  it("stores undecided candidates outside matches and counts with one diagnostic each", () => {
    const db = fixture();
    try {
      const stats = synchronizePackageOffers(db, { bound: 1 });
      expect(stats.undecided).toBeGreaterThan(0);
      expect(db.prepare("SELECT COUNT(*) FROM cat_source_conflict WHERE topic='derived.offer_undecided'")
        .pluck().get()).toBe(stats.undecided);
      const result = browseCatalogue(db, { nodeId: 1, attributeFilters: [{ attributeCode: "rated_current", values: [1] }] });
      expect(result.packageCount).toBe(0);
      expect(result.packages).toEqual([]);
      expect(result.undecidedPackages).toMatchObject([{ modelId: 1 }]);
    } finally { db.close(); }
  });

  it("requires a dependent option's parent and reconstructs witnesses after option IDs change", () => {
    const db = fixture();
    try {
      db.exec(`INSERT INTO cat_attribute(id,code,name,data_type,source) VALUES(3,'dependent','Dependent','enum','manual');
        INSERT INTO cat_attribute_option(id,attribute_id,value,label,source) VALUES(2,3,'yes','Yes','manual');
        INSERT INTO cat_category_attribute(category_id,attribute_id,source) VALUES(1,3,'manual');
        INSERT INTO cat_config_dimension(id,brand_id,code,name,source) VALUES(4,1,'child','Child','manual');
        INSERT INTO cat_config_dimension_value(id,dimension_id,code,label,source) VALUES(9,4,'yes','Yes','manual');
        INSERT INTO cat_config_axis(id,model_id,dimension_id,sort_order,label,visibility,requirement,binding)
          VALUES(4,1,4,4,'Child','visible','optional','none');
        INSERT INTO cat_config_option(id,axis_id,value_id,parent_option_id,is_default,sort_order)
          VALUES(9,4,9,2,0,1);
        INSERT INTO cat_config_value_attribute(value_id,attribute_id,option_id,source) VALUES(9,3,2,'manual');`);
      expect(resolveConfiguration(db, { modelId: 1, selectedOptionIds: [9] }).status).toBe("invalid");
      synchronizePackageOffers(db);
      const result = browseCatalogue(db, { nodeId: 1, attributeFilters: [{ attributeCode: "dependent", values: ["yes"] }] });
      expect(result.packageCount).toBe(1);
      const offerNo = result.packages[0]?.offerNo;
      expect(offerNo).toBeDefined();
      const witness = offerSelection(db, 1, offerNo!);
      expect(witness.status).toBe("ready");
      if (witness.status === "ready") expect(witness.selectedOptionIds).toEqual(expect.arrayContaining([2, 9]));
      db.exec(`BEGIN; PRAGMA defer_foreign_keys=ON;
        UPDATE cat_config_option SET id=id+100, parent_option_id=CASE WHEN parent_option_id IS NULL THEN NULL ELSE parent_option_id+100 END;
        UPDATE cat_config_rule_condition SET option_id=option_id+100;
        COMMIT;`);
      const rebuilt = offerSelection(db, 1, offerNo!);
      expect(rebuilt.status).toBe("ready");
      if (rebuilt.status === "ready") expect(rebuilt.selectedOptionIds).toEqual(expect.arrayContaining([102, 109]));
    } finally { db.close(); }
  });

  it("fails closed on stale engineering: removes untrusted offers, still completes, and browsing works", () => {
    const db = fixture();
    const adapters = [{ code: "tiquadri", version: RUNNING }];
    const offers = () => db.prepare("SELECT COUNT(*) FROM cat_config_model_offer").pluck().get();
    const unavailable = () => db.prepare(`SELECT subject_key AS model,value_a AS reason,source_b AS adapter,value_b AS required
      FROM cat_source_conflict WHERE topic='derived.offers_unavailable'`).all();
    const filtered = () => browseCatalogue(db, { nodeId: 1, attributeFilters: [{ attributeCode: "rated_current", values: [1] }] });
    try {
      db.exec(`UPDATE app_source_import SET adapter_code='tiquadri',adapter_version='${RUNNING}' WHERE id=1;
        UPDATE cat_config_model SET source='import',source_import_id=1 WHERE id=1;`);
      expect(synchronizePackageOffers(db, { adapters })).toMatchObject({ recomputed: true, unavailable: 0 });
      expect(offers()).toBeGreaterThan(0);
      expect(filtered().packages.map(row => row.modelId)).toEqual([1]);
      // The installed import no longer matches the running adapter.
      db.exec(`UPDATE app_source_import SET adapter_version='${UPGRADED}' WHERE id=1`);
      expect(synchronizePackageOffers(db, { adapters })).toMatchObject({ recomputed: true, unavailable: 1, feasible: 0 });
      expect(offers()).toBe(0);
      expect(db.prepare("SELECT COUNT(*) FROM cat_config_model_offer_state").pluck().get()).toBe(0);
      expect(unavailable()).toEqual([{ model: "synthetic.package", reason: "version_mismatch", adapter: "tiquadri", required: RUNNING }]);
      // Technical filters never match stale packages and say why; plain browsing is unaffected.
      expect(filtered()).toMatchObject({ packages: [], packageCount: 0, undecidedPackages: [], packageOffersStale: true });
      expect(browseCatalogue(db, { nodeId: 1 })).toMatchObject({ packageCount: 1, packageOffersStale: false });
      expect(offerSelection(db, 1, 0)).toEqual({ status: "offer_stale" });
      expect(synchronizePackageOffers(db, { adapters })).toMatchObject({ recomputed: false });
      // A reimport that makes the source current again restores offers and clears the diagnostic.
      db.exec(`UPDATE app_source_import SET adapter_version='${RUNNING}' WHERE id=1`);
      expect(synchronizePackageOffers(db, { adapters })).toMatchObject({ recomputed: true, unavailable: 0 });
      expect(offers()).toBeGreaterThan(0);
      expect(unavailable()).toEqual([]);
      expect(filtered()).toMatchObject({ packageCount: 1, packageOffersStale: false });
    } finally { db.close(); }
  });

  it("invalidates offers when the running adapter is upgraded, even with unchanged catalogue rows", () => {
    const db = fixture();
    try {
      db.exec(`UPDATE app_source_import SET adapter_code='tiquadri',adapter_version='${RUNNING}' WHERE id=1;
        UPDATE cat_config_model SET source='import',source_import_id=1 WHERE id=1;`);
      expect(synchronizePackageOffers(db, { adapters: [{ code: "tiquadri", version: RUNNING }] }))
        .toMatchObject({ recomputed: true, unavailable: 0 });
      const before = db.prepare("SELECT value FROM app_setting WHERE key=?").pluck().get(PACKAGE_OFFER_FINGERPRINT_KEY);
      const catalogue = db.prepare("SELECT * FROM cat_config_model ORDER BY id").all();
      // Same database, newer application: the required adapter version alone changes the fingerprint.
      expect(synchronizePackageOffers(db, { adapters: [{ code: "tiquadri", version: UPGRADED }] }))
        .toMatchObject({ recomputed: true, unavailable: 1, feasible: 0 });
      expect(db.prepare("SELECT value FROM app_setting WHERE key=?").pluck().get(PACKAGE_OFFER_FINGERPRINT_KEY)).not.toBe(before);
      expect(db.prepare("SELECT * FROM cat_config_model ORDER BY id").all()).toEqual(catalogue);
      expect(db.prepare("SELECT COUNT(*) FROM cat_config_model_offer").pluck().get()).toBe(0);
    } finally { db.close(); }
  });

  it("rolls back every offer change when offer derivation fails for a reason other than staleness", () => {
    const db = fixture();
    try {
      synchronizePackageOffers(db);
      const snapshot = () => ({
        offers: db.prepare("SELECT * FROM cat_config_model_offer ORDER BY model_id,offer_no").all(),
        values: db.prepare("SELECT * FROM cat_config_model_offer_value ORDER BY model_id,offer_no,attribute_id").all(),
        fingerprint: db.prepare("SELECT value FROM app_setting WHERE key=?").pluck().get(PACKAGE_OFFER_FINGERPRINT_KEY),
      });
      const before = snapshot();
      // Force recomputation, then fail after the old offers were deleted inside the transaction.
      db.exec(`UPDATE cat_config_value_attribute SET value_num=9 WHERE value_id=5;
        CREATE TEMP TRIGGER fail_offer BEFORE INSERT ON cat_config_model_offer
        BEGIN SELECT RAISE(ABORT,'injected offer failure'); END;`);
      expect(() => synchronizePackageOffers(db)).toThrow("injected offer failure");
      expect(snapshot()).toEqual(before);
    } finally { db.close(); }
  });

  it("deduplicates equal feasible value sets and records value conflicts as undecided", () => {
    const db = fixture();
    try {
      db.exec(`INSERT INTO cat_config_dimension_value(id,dimension_id,code,label,source)
        VALUES(10,1,'r1_alias','1 alias','manual');
        INSERT INTO cat_config_option(id,axis_id,value_id,is_default,sort_order)
        VALUES(10,1,10,0,6);
        INSERT INTO cat_config_value_attribute(value_id,attribute_id,value_num,source)
        VALUES(10,1,1,'manual');`);
      expect(synchronizePackageOffers(db)).toMatchObject({ candidates: 6, feasible: 3 });
      expect(db.prepare("SELECT COUNT(*) FROM cat_config_model_offer WHERE status='feasible'").pluck().get()).toBe(2);
      db.exec(`INSERT INTO cat_attribute_option(id,attribute_id,value,label,source)
        VALUES(3,2,'absent','Absent','manual');
        INSERT INTO cat_config_model_attribute(model_id,attribute_id,option_id,source)
        VALUES(1,2,3,'manual');`);
      const result = synchronizePackageOffers(db);
      expect(result.undecided).toBeGreaterThan(0);
      expect(db.prepare("SELECT COUNT(*) FROM cat_source_conflict WHERE topic='derived.offer_value_conflict'")
        .pluck().get()).toBe(result.undecided);
      const filtered = browseCatalogue(db, { nodeId: 1,
        attributeFilters: [{ attributeCode: "rated_current", values: [1] }] });
      expect(filtered.packageCount).toBe(0);
      expect(filtered.undecidedPackages).toMatchObject([{ modelId: 1 }]);
    } finally { db.close(); }
  });

  it("keeps a fact-only package's valid empty witness", () => {
    const db = fixture();
    try {
      db.exec(`DELETE FROM cat_config_rule_effect;
        DELETE FROM cat_config_rule_condition;
        DELETE FROM cat_config_rule;
        DELETE FROM cat_config_option;
        DELETE FROM cat_config_axis;
        INSERT INTO cat_config_model_attribute(model_id,attribute_id,value_num,source)
          VALUES(1,1,1,'manual');`);
      expect(synchronizePackageOffers(db)).toMatchObject({ candidates: 1, feasible: 1 });
      expect(offerSelection(db, 1, 0)).toEqual({ status: "ready", selectedOptionIds: [] });
    } finally { db.close(); }
  });

  it("decides eligibility from the package's own values and facts, never from unrelated mappings", () => {
    const db = fixture();
    try {
      // Package 2: applicable category, but its only axis value is unmapped; rated_current is mapped on
      // package 1's values elsewhere. Package 3: its own value maps rated_current, but its category links none.
      db.exec(`INSERT INTO cat_category(id,code,name,source) VALUES(2,'synthetic.plain','Plain','manual');
        INSERT INTO cat_config_dimension(id,brand_id,code,name,source) VALUES(5,1,'variant','Variant','manual');
        INSERT INTO cat_config_dimension_value(id,dimension_id,code,label,source) VALUES(10,5,'v','V','manual');
        INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,commercial_contribution,
          base_profile_id,definition_fingerprint,source,category_id,category_source) VALUES
          (2,1,'synthetic.unmapped','Unmapped package','device','articles',1,'definition','manual',1,'manual'),
          (3,1,'synthetic.plain','Plain package','device','articles',1,'definition','manual',2,'manual');
        INSERT INTO cat_config_axis(id,model_id,dimension_id,sort_order,label,visibility,requirement,binding) VALUES
          (5,2,5,1,'Variant','visible','required','none'),(6,3,1,1,'Rating','visible','required','none');
        INSERT INTO cat_config_option(id,axis_id,value_id,is_default,sort_order) VALUES(20,5,10,1,1),(21,6,1,1,1);
        INSERT INTO cat_config_model_article(model_id,seq,product_id,ref_brand_marchio,ref_manufacturer_code,quantity,role)
          VALUES(2,1,1,'EXA','A',1,'primary'),(3,1,1,'EXA','A',1,'primary');
        INSERT INTO cat_range_node_model(node_id,model_id) VALUES(1,2),(1,3);`);
      for (const id of [2, 3]) expect(configuredItemAddable(resolveConfiguration(db, { modelId: id, selectedOptionIds: [] }))).toBe(true);
      expect(synchronizePackageOffers(db)).toMatchObject({ models: 1, candidates: 5, feasible: 2 });
      expect(db.prepare("SELECT DISTINCT model_id FROM cat_config_model_offer_state UNION SELECT DISTINCT model_id FROM cat_config_model_offer")
        .pluck().all()).toEqual([1]);
      expect(browseCatalogue(db, { nodeId: 1 }).packages.map(row => row.modelId).sort()).toEqual([1, 2, 3]);
      const filtered = browseCatalogue(db, { nodeId: 1, attributeFilters: [{ attributeCode: "rated_current", values: [1] }] });
      expect(filtered).toMatchObject({ packageCount: 1, packages: [{ modelId: 1 }], undecidedPackages: [] });
      // Mapping package 2's own value makes it eligible; the fact path stays eligible on its own.
      db.exec("INSERT INTO cat_config_value_attribute(value_id,attribute_id,value_num,source) VALUES(10,1,7,'manual')");
      expect(synchronizePackageOffers(db)).toMatchObject({ models: 2, candidates: 6, feasible: 3 });
      expect(browseCatalogue(db, { nodeId: 1, attributeFilters: [{ attributeCode: "rated_current", values: [7] }] }))
        .toMatchObject({ packageCount: 1, packages: [{ modelId: 2, offerNo: 0 }] });
    } finally { db.close(); }
  });
});
