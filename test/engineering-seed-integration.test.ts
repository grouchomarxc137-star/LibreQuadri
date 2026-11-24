import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import Database from "better-sqlite3";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { closeConfiguredDatabase, openConfiguredDatabase } from "../src/main/database/sqlite-connection.js";

let initializeCategorySeed: typeof import("../src/main/catalogue/category-startup.js").initializeCategorySeed;
const roots: string[] = [];
const seedFolder = path.resolve("db/seed");

function migratedDatabase(): { filename: string; database: Database.Database } {
  const root = mkdtempSync(path.join(tmpdir(), "librequadri-engineering-worker-"));
  roots.push(root);
  const filename = path.join(root, "lq.db");
  const database = openMigratedLqDatabase({
    databaseFilename: filename,
    backupDirectory: path.join(root, "backups"),
    migrationsFolder: path.resolve("db/migrations/lq"),
  });
  return { filename, database };
}

function count(database: Database.Database, table: string): number {
  return database.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;
}

beforeAll(async () => {
  // The public startup entry starts a real .js worker. Compile the main-process
  // artifact so this test exercises the same worker URL and message/error path.
  execFileSync(process.execPath, [path.resolve("node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"], {
    cwd: path.resolve("."),
    stdio: "pipe",
  });
  const builtEntry = pathToFileURL(path.resolve("dist/src/main/catalogue/category-startup.js"));
  ({ initializeCategorySeed } = await import(builtEntry.href));
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("startup engineering seed worker", () => {
  it("reconciles Siemens article navigation after enrichment, including changed startup descriptions", async () => {
    const { filename, database } = migratedDatabase();
    database.exec(`INSERT INTO cat_metel_issuer(id,metel_sigla) VALUES(1,'SIE');
      INSERT INTO cat_brand(id,metel_marchio,name,source) VALUES(1,'SIE','Siemens','import');
      INSERT INTO cat_metel_family(id,issuer_id,brand_id,family_type,code,is_known)
        VALUES(1,1,1,'STATISTICA','P310 I22Y',1);
      INSERT INTO cat_product(id,brand_id,manufacturer_code,code_norm,short_description,governing_issuer_id,statistical_family_id,updated_at)
        VALUES(1,1,'5SY62167','5SY62167','INT MT 2P C16 ICN 6KA',1,1,'2026-01-01');`);
    closeConfiguredDatabase(database);
    await initializeCategorySeed(filename, seedFolder);
    const first = openConfiguredDatabase(filename, { kind: "lq" });
    const assignment = (db: Database.Database) => db.prepare(`SELECT n.code,np.rule_code FROM cat_range_node_product np
      JOIN cat_range_node n ON n.id=np.node_id WHERE np.product_id=1`).get();
    try {
      expect(assignment(first)).toEqual({ code: "classified.sie.dispositivi_modulari.magnetotermici", rule_code: "modular.mt" });
      expect(first.prepare("SELECT COUNT(*) FROM cat_product_attribute WHERE product_id=1").pluck().get()).toBeGreaterThan(0);
      first.exec("UPDATE cat_product SET short_description='CALOTTA PER INT MT 2P C16' WHERE id=1");
    } finally { closeConfiguredDatabase(first); }
    await initializeCategorySeed(filename, seedFolder);
    const updated = openConfiguredDatabase(filename, { kind: "lq" });
    try {
      expect(assignment(updated)).toEqual({ code: "classified.sie.dispositivi_modulari.accessori", rule_code: "modular.accessory" });
    } finally { closeConfiguredDatabase(updated); }
  });
  it("synchronizes Revision-8 seeds after migration alongside category, attribute and family definitions", async () => {
    const { filename, database } = migratedDatabase();
    database.exec(`INSERT INTO cat_metel_issuer (id,metel_sigla) VALUES (1,'BTI');
      INSERT INTO cat_brand (id,metel_marchio,name,source) VALUES (1,'BTI','BTicino','import');`);
    closeConfiguredDatabase(database);

    const warnings = await initializeCategorySeed(filename, seedFolder);
    expect(warnings?.deferred.count).toBeGreaterThanOrEqual(171);
    expect(warnings?.deferred.sampleKeys.length).toBe(8);
    expect(warnings?.stale.count).toBe(0);
    const result = openConfiguredDatabase(filename, { kind: "lq" });
    try {
      expect(count(result, "__drizzle_migrations")).toBe(21);
      expect(count(result, "cat_capacity_kind")).toBe(6);
      expect(result.prepare("SELECT display_divisor, nominal_pitch_mm FROM cat_capacity_kind WHERE code='din_rail'").get())
        .toEqual({ display_divisor: 2, nominal_pitch_mm: 9 });
      expect(result.prepare("SELECT brand_id FROM cat_source_brand_map WHERE adapter_code='tiquadri' AND source_brand_code='BT-'").pluck().get()).toBe(1);
      expect(count(result, "cat_source_brand_map")).toBe(4); // BTI plus three explicit unmapped codes
      expect(count(result, "cat_category")).toBeGreaterThan(0);
      expect(count(result, "cat_category_mapping")).toBeGreaterThan(0);
      expect(count(result, "cat_attribute")).toBeGreaterThan(0);
      expect(count(result, "cat_category_attribute")).toBeGreaterThan(0);
      expect(count(result, "cat_product_family")).toBe(10);
      expect(count(result, "cat_family_variant_axis")).toBeGreaterThan(0);
    } finally { closeConfiguredDatabase(result); }

    const staleFixture = openConfiguredDatabase(filename, { kind: "lq" });
    try {
      const dimension = staleFixture.prepare(`INSERT INTO cat_config_dimension(brand_id,code,name,source)
        VALUES(1,'tq.label.51','Taratura','manual')`).run();
      staleFixture.prepare(`INSERT INTO cat_config_dimension_value(dimension_id,code,label,source)
        VALUES(?,'tq.value.146','Changed','manual')`).run(Number(dimension.lastInsertRowid));
    } finally { closeConfiguredDatabase(staleFixture); }
    const repeatedWarnings = await initializeCategorySeed(filename, seedFolder);
    expect(repeatedWarnings?.stale).toEqual({count:1,sampleKeys:["tq.label.51/tq.value.146"]});
    expect(repeatedWarnings?.deferred.count).toBe(warnings!.deferred.count-1);
    const repeated = openConfiguredDatabase(filename, { kind: "lq" });
    try {
      expect(count(repeated, "cat_capacity_kind")).toBe(6);
      expect(count(repeated, "cat_source_brand_map")).toBe(4);
      expect(count(repeated, "cat_product_family")).toBe(10);
    } finally { closeConfiguredDatabase(repeated); }
  });

  it("reports worker failure and rolls back engineering seeds with the older seed work", async () => {
    const { filename, database } = migratedDatabase();
    database.exec(`INSERT INTO cat_brand (id,metel_marchio,name,source) VALUES (1,'BTI','BTicino','import');
      CREATE TRIGGER fail_category_seed BEFORE INSERT ON cat_category
      BEGIN SELECT RAISE(ABORT, 'forced startup seed failure'); END;`);
    closeConfiguredDatabase(database);

    await expect(initializeCategorySeed(filename, seedFolder)).rejects.toThrow("forced startup seed failure");
    const result = openConfiguredDatabase(filename, { kind: "lq" });
    try {
      expect(count(result, "cat_brand")).toBe(1);
      expect(count(result, "cat_capacity_kind")).toBe(0);
      expect(count(result, "cat_source_brand_map")).toBe(0);
      expect(count(result, "cat_category")).toBe(0);
      expect(count(result, "cat_attribute")).toBe(0);
      expect(count(result, "cat_product_family")).toBe(0);
      expect(result.pragma("foreign_key_check")).toEqual([]);
    } finally { closeConfiguredDatabase(result); }
  });
});
