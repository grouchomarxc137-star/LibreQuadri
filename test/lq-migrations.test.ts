import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { readMigrationFiles } from "drizzle-orm/migrator";

import { applicationPaths } from "../src/main/data-paths.js";
import { MainDatabaseService } from "../src/main/database/database-service.js";
import {
  ForeignKeyValidationError,
  IncompatibleMigrationHistoryError,
  LqMigrationFailure,
  openMigratedLqDatabase,
} from "../src/main/database/lq-migrations.js";
import {
  closeConfiguredDatabase,
  openConfiguredDatabase,
} from "../src/main/database/sqlite-connection.js";
import { browseRangeNodes } from "../src/main/catalogue/configuration-queries.js";
import { browseManufacturerNodes, listManufacturerArticles } from "../src/main/catalogue/manufacturer-navigation.js";

interface TestMigration {
  readonly tag: string;
  readonly when: number;
  readonly sql: string;
}

const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix = "lq-migrations-test-"): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function createMigrationFixture(
  root: string,
  migrations: readonly TestMigration[],
): string {
  const folder = path.join(root, "migrations");
  mkdirSync(path.join(folder, "meta"), { recursive: true });
  writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: migrations.map((migration, index) => ({
        idx: index,
        version: "6",
        when: migration.when,
        tag: migration.tag,
        breakpoints: true,
      })),
    }),
  );

  for (const migration of migrations) {
    writeFileSync(path.join(folder, `${migration.tag}.sql`), migration.sql);
  }

  return folder;
}

function migrationFailure(
  initialize: () => MainDatabaseService,
): LqMigrationFailure {
  try {
    const service = initialize();
    service.close();
    throw new Error("Expected database initialization to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(LqMigrationFailure);
    return error as LqMigrationFailure;
  }
}

function tableExists(database: Database.Database, tableName: string): boolean {
  return Boolean(
    database
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ? LIMIT 1",
      )
      .get(tableName),
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("lq.db migration infrastructure", () => {
  it("preserves populated pre-0005 TiQuadri browsing and repairs duplicate leaves",()=>{
    const root=temporaryDirectory();
    const journal=JSON.parse(readFileSync("db/migrations/lq/meta/_journal.json","utf8")) as {
      entries:Array<{tag:string;when:number}>;
    };
    const oldFolder=createMigrationFixture(path.join(root,"pre-0005"),journal.entries.slice(0,5).map(row=>({
      tag:row.tag,when:row.when,
      sql:readFileSync(path.join("db/migrations/lq",`${row.tag}.sql`),"utf8"),
    })));
    const options={databaseFilename:path.join(root,"lq.db"),backupDirectory:path.join(root,"backups")};
    const old=openMigratedLqDatabase({...options,migrationsFolder:oldFolder});
    old.exec(`INSERT INTO cat_brand(id,metel_marchio,name,source) VALUES(1,'BTI','BTicino','import');
      INSERT INTO cat_product(id,brand_id,manufacturer_code,code_norm,updated_at)
        VALUES(1,1,'FN82C16','FN82C16','2026-09-23');
      INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,definition_fingerprint,source)
        VALUES(1,1,'tq.pack.4395','Btdin model','device','f1','import'),
          (2,1,'tq.pack.4396','No entry model','device','f2','import'),
          (3,1,'tq.pack.5000','Panel model','support','f3','import');
      INSERT INTO cat_config_model_entry(product_id,model_id) VALUES(1,1);
      INSERT INTO cat_range_node(id,brand_id,parent_id,code,name,node_kind,source) VALUES
        (1,1,NULL,'tq.system.3','Apparecchi','system','import'),
        (2,1,1,'tq.system.3.level1.599','Btdin 60','level1','import'),
        (3,1,2,'tq.system.3.level1.599.level2.5991','Magnetotermici','level2','import'),
        (4,1,3,'tq.system.3.level1.599.level2.5991.range.5991','Magnetotermici','range','import'),
        (5,1,4,'tq.range.5991.class.59911','Curva "C"','class','import'),
        (6,1,NULL,'tq.system.2','Pannelli','system','import'),
        (7,1,6,'tq.system.2.level1.850','Larghezza 850 mm','level1','import'),
        (8,1,7,'tq.system.2.level1.850.range.850','Larghezza 850 mm','range','import'),
        (9,1,8,'tq.range.850.class.8501','Pannello','class','import');
      INSERT INTO cat_range_node_model(node_id,model_id) VALUES(5,1),(5,2),(9,3);`);
    old.close();
    const db=openMigratedLqDatabase({...options,migrationsFolder:path.resolve("db/migrations/lq")});
    try{
      const config=browseRangeNodes(db);
      expect(config.filter(node=>node.parentId===null).map(node=>node.name))
        .toEqual(expect.arrayContaining(["Apparecchi","Pannelli"]));
      expect(db.prepare(`SELECT COUNT(DISTINCT m.id) AS n FROM cat_config_model m
        JOIN cat_range_node_model nm ON nm.model_id=m.id JOIN cat_range_node n ON n.id=nm.node_id
        WHERE m.active=1 AND n.active=1`).get()).toEqual({n:3});
      const catalogue=browseManufacturerNodes(db);
      expect(catalogue.filter(node=>node.parentId===null).map(node=>node.name)).toEqual(["Apparecchi"]);
      const family=catalogue.find(node=>node.name==='Curva "C"')!;
      expect(family).toBeDefined();
      expect(family.parentId).toBe(3);
      expect(listManufacturerArticles(db,{nodeId:family.id}).map(item=>item.manufacturerCode))
        .toEqual(["FN82C16"]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM cat_product").get()).toEqual({n:1});
      expect(db.pragma("foreign_key_check")).toEqual([]);
      expect(db.pragma("integrity_check",{simple:true})).toBe("ok");
    }finally{db.close();}
  });
  it("upgrades the shipped catalogue schema additively and preserves products, listings and prices", () => {
    const root = temporaryDirectory();
    const shipped = readMigrationFiles({ migrationsFolder: path.resolve("db/migrations/lq") })[0];
    const oldFolder = createMigrationFixture(path.join(root, "baseline"), [{
      tag: "0000_glamorous_ironclad", when: shipped.folderMillis,
      sql: readFileSync("db/migrations/lq/0000_glamorous_ironclad.sql", "utf8"),
    }]);
    const options = { databaseFilename: path.join(root, "lq.db"), backupDirectory: path.join(root, "backups") };
    const old = openMigratedLqDatabase({ ...options, migrationsFolder: oldFolder });
    old.exec(`
      INSERT INTO cat_metel_issuer (id, metel_sigla) VALUES (1, 'BTI');
      INSERT INTO cat_brand (id, metel_marchio, name, source) VALUES (1, 'BTI', 'BTI', 'import');
      INSERT INTO app_import_delivery (id, issuer_id, fingerprint, listino_number, valid_from, became_current, normalized_at, summary_json)
        VALUES (1, 1, '${"a".repeat(64)}', '1', '2026-01-01', 1, '2026-01-01', '{}');
      INSERT INTO cat_product (id, brand_id, manufacturer_code, code_norm, governing_issuer_id, description, is_listed, updated_at)
        VALUES (42, 1, 'FN81C63', 'FN81C63', 1, 'Manual enrichment', 1, '2026-01-01');
      INSERT INTO cat_product_listing (product_id, issuer_id, lifecycle_status_code, lead_time_code, short_description,
        unit_of_measure, pack_qty, min_order_qty, order_multiple, max_order_qty, is_kit, is_listed, first_seen_delivery_id, last_seen_delivery_id)
        VALUES (42, 1, '1', '1', 'btdin60', 'PCE', 1, 1, 1, 100, 0, 1, 1, 1);
      INSERT INTO com_price_list (id, issuer_id, delivery_id, listino_number, valid_from, is_current) VALUES (1, 1, 1, '1', '2026-01-01', 1);
      INSERT INTO com_product_price VALUES (42, 1, 100000, 1, 'EUR', 100000);
    `);
    const before = old.prepare("SELECT * FROM cat_product").get();
    const rootPage = old.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'cat_product'").pluck().get();
    const listing = old.prepare("SELECT * FROM cat_product_listing").all();
    const prices = old.prepare("SELECT * FROM com_product_price").all();
    old.close();
    const current = openMigratedLqDatabase({ ...options, migrationsFolder: path.resolve("db/migrations/lq") });
    try {
      expect(current.prepare("SELECT * FROM cat_product").get()).toEqual({ ...before as object, category_id: null, category_source: "unmapped", category_mapping_id: null, category_model_id: null, import_removed: 0 });
      expect(current.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'cat_product'").pluck().get()).toBe(rootPage);
      expect(current.prepare("SELECT * FROM cat_product_listing").all()).toEqual(listing);
      expect(current.prepare("SELECT * FROM com_product_price").all()).toEqual(prices);
      expect(() => current.exec("UPDATE cat_product SET category_source = 'bad'")).toThrow();
      expect(current.pragma("foreign_key_check")).toEqual([]);
      expect(current.pragma("foreign_key_list(cat_product)")).toEqual(expect.arrayContaining([
        expect.objectContaining({ from: "category_mapping_id", table: "cat_category_mapping", on_delete: "SET NULL" }),
      ]));
    } finally { current.close(); }
  });
  it("adds attribute tables additively over the step-4 schema, preserving products and categories", () => {
    const root = temporaryDirectory();
    const shipped = readMigrationFiles({ migrationsFolder: path.resolve("db/migrations/lq") });
    const oldFolder = createMigrationFixture(path.join(root, "step4"), ["0000_glamorous_ironclad", "0001_category_classification"]
      .map((tag, index) => ({ tag, when: shipped[index].folderMillis, sql: readFileSync(`db/migrations/lq/${tag}.sql`, "utf8") })));
    const options = { databaseFilename: path.join(root, "lq.db"), backupDirectory: path.join(root, "backups") };
    const old = openMigratedLqDatabase({ ...options, migrationsFolder: oldFolder });
    old.exec(`
      INSERT INTO cat_metel_issuer (id, metel_sigla) VALUES (1, 'BTI');
      INSERT INTO cat_brand (id, metel_marchio, name, source) VALUES (1, 'BTI', 'BTI', 'import');
      INSERT INTO cat_category (id, code, name, source) VALUES (7, 'protezione', 'Protezione', 'seed');
      INSERT INTO cat_product (id, brand_id, manufacturer_code, code_norm, short_description, category_id, category_source, is_listed, updated_at)
        VALUES (42, 1, 'FN81B16', 'FN81B16', 'btdin60 - magnetot 1P curva B 16A 6kA', 7, 'manual', 1, '2026-01-01');
      INSERT INTO app_setting VALUES ('catalogue.category_classifier_fingerprint', 'abc');
    `);
    const products = old.prepare("SELECT * FROM cat_product").all();
    const categories = old.prepare("SELECT * FROM cat_category").all();
    const settings = old.prepare("SELECT * FROM app_setting").all();
    const rootPage = old.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'cat_product'").pluck().get();
    old.close();
    const current = openMigratedLqDatabase({ ...options, migrationsFolder: path.resolve("db/migrations/lq") });
    try {
      expect(current.prepare("SELECT * FROM cat_product").all()).toEqual(products.map(product => ({ ...product as object, category_model_id: null, import_removed: 0 })));
      expect(current.prepare("SELECT * FROM cat_category").all()).toEqual(categories);
      expect(current.prepare("SELECT * FROM app_setting").all()).toEqual(settings);
      expect(current.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'cat_product'").pluck().get()).toBe(rootPage);
      for (const table of ["cat_attribute", "cat_attribute_option", "cat_category_attribute", "cat_product_attribute",
        "cat_product_family", "cat_family_variant_axis", "cat_product_family_assignment"]) {
        expect(tableExists(current, table), table).toBe(true);
      }
      current.exec(`INSERT INTO cat_attribute (id, code, name, data_type, unit, source) VALUES (1, 'rated_current', 'In', 'number', 'A', 'seed');
        INSERT INTO cat_product_attribute (product_id, attribute_id, value_num, source) VALUES (42, 1, 16, 'parser');`);
      expect(() => current.exec("INSERT INTO cat_attribute (code, name, data_type, unit, source) VALUES ('x', 'X', 'enum', 'A', 'seed')")).toThrow(/CHECK/);
      expect(() => current.exec("UPDATE cat_product_attribute SET value_text = '16'")).toThrow(/CHECK/);
      expect(() => current.exec("UPDATE cat_product_attribute SET source = 'guess'")).toThrow(/CHECK/);
      expect(() => current.exec("UPDATE cat_product_attribute SET value_num = NULL")).toThrow(/CHECK/);
      current.exec(`INSERT INTO cat_product_family (id, brand_id, code, category_id, name, source)
          VALUES (1, 1, 'test_family', 7, 'Test', 'seed');
        INSERT INTO cat_family_variant_axis VALUES (1, 1, 0);
        INSERT INTO cat_product_family_assignment VALUES (42, 1, 'grouper', 'test.grouper', '1');`);
      expect(() => current.exec("UPDATE cat_product_family_assignment SET grouper_code = NULL")).toThrow(/CHECK/);
      expect(() => current.exec("UPDATE cat_product_family_assignment SET grouper_version = NULL")).toThrow(/CHECK/);
      expect(() => current.exec("UPDATE cat_product_family_assignment SET state = 'manual_excluded'")).toThrow(/CHECK/);
      expect(() => current.exec("UPDATE cat_product_family_assignment SET state = 'manual'")).toThrow(/CHECK/);
      expect(() => current.exec("UPDATE cat_product_family_assignment SET state = 'manual', grouper_code = NULL")).toThrow(/CHECK/);
      expect(() => current.exec(`UPDATE cat_product_family_assignment SET family_id = NULL,
        state = 'manual_excluded', grouper_version = NULL`)).toThrow(/CHECK/);
      current.exec("DELETE FROM cat_product WHERE id = 42");
      expect(current.prepare("SELECT COUNT(*) FROM cat_product_attribute").pluck().get()).toBe(0);
      expect(current.prepare("SELECT COUNT(*) FROM cat_product_family_assignment").pluck().get()).toBe(0);
      expect(current.pragma("foreign_key_check")).toEqual([]);
      expect(current.prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'cat_product_attribute' AND sql IS NOT NULL ORDER BY name").pluck().all())
        .toEqual(["cat_product_attribute_number_idx", "cat_product_attribute_option_idx"]);
    } finally { current.close(); }
  });

  it("adds the recent-files table additively over the 0006 schema, preserving settings", () => {
    const root = temporaryDirectory();
    const shipped = readMigrationFiles({ migrationsFolder: path.resolve("db/migrations/lq") });
    const journal = JSON.parse(readFileSync("db/migrations/lq/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags.at(-1)).toBe("0020_mounting_facts");
    const oldFolder = createMigrationFixture(path.join(root, "0006"), tags.slice(0, 7)
      .map((tag, index) => ({ tag, when: shipped[index].folderMillis, sql: readFileSync(`db/migrations/lq/${tag}.sql`, "utf8") })));
    const options = { databaseFilename: path.join(root, "lq.db"), backupDirectory: path.join(root, "backups") };
    const old = openMigratedLqDatabase({ ...options, migrationsFolder: oldFolder });
    expect(tableExists(old, "app_recent_file")).toBe(false);
    old.exec("INSERT INTO app_setting VALUES ('catalogue.category_classifier_fingerprint', 'abc')");
    const settings = old.prepare("SELECT * FROM app_setting").all();
    old.close();
    const current = openMigratedLqDatabase({ ...options, migrationsFolder: path.resolve("db/migrations/lq") });
    try {
      expect(current.prepare("SELECT * FROM app_setting").all()).toEqual(settings);
      expect((current.prepare("PRAGMA table_info(app_recent_file)").all() as { name: string; notnull: number; pk: number }[])
        .map(({ name, notnull, pk }) => [name, notnull, pk])).toEqual([
        ["path", 1, 1], ["project_uuid", 1, 0], ["title", 1, 0], ["last_opened_at", 1, 0]]);
      expect(current.prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'app_recent_file' AND sql IS NOT NULL").pluck().all())
        .toEqual(["app_recent_file_last_opened_idx"]);
      expect(current.pragma("foreign_key_check")).toEqual([]);
    } finally { current.close(); }
  });

  it("initializes a clean database with the bundled migration journal", () => {
    const root = temporaryDirectory();
    const paths = applicationPaths(root);
    const service = MainDatabaseService.initialize(root);
    service.close();

    const database = new Database(paths.lqDatabase, { readonly: true });
    try {
      expect(tableExists(database, "__drizzle_migrations")).toBe(true);
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations").get(),
      ).toEqual({ count: 21 });
      expect(tableExists(database,"cat_config_rule_front_label")).toBe(true);
      expect(tableExists(database,"app_recent_file")).toBe(true);
      expect(tableExists(database,"cat_range_level")).toBe(true);
      expect(tableExists(database,"cat_range_node_metel_family")).toBe(true);
      const columns=database.prepare("PRAGMA table_info(cat_range_node)").all() as Array<{name:string}>;
      expect(columns.map(column=>column.name)).toEqual(expect.arrayContaining([
        "level_code","navigable","source_delivery_id"]));
      expect(database.prepare("SELECT label FROM cat_range_level WHERE code='tipologia'").get())
        .toEqual({label:"Tipologia"});
    } finally {
      database.close();
    }
  });

  it("rebuilds the leaf attribute table without changing existing parser or protected values", () => {
    const root = temporaryDirectory();
    const shipped = readMigrationFiles({ migrationsFolder: path.resolve("db/migrations/lq") });
    const journal = JSON.parse(readFileSync("db/migrations/lq/meta/_journal.json", "utf8")) as {entries:Array<{tag:string}>};
    const oldFolder = createMigrationFixture(path.join(root, "before-stage-b"), journal.entries.slice(0, -1)
      .map((entry, index) => ({ tag: entry.tag, when: shipped[index].folderMillis,
        sql: readFileSync(`db/migrations/lq/${entry.tag}.sql`, "utf8") })));
    const options = { databaseFilename: path.join(root, "lq.db"), backupDirectory: path.join(root, "backups") };
    const old = openMigratedLqDatabase({ ...options, migrationsFolder: oldFolder });
    old.exec(`INSERT INTO cat_brand(id,metel_marchio,name,source) VALUES(1,'BTI','BTicino','import');
      INSERT INTO cat_attribute(id,code,name,data_type,unit,source) VALUES(1,'rated_current','In','number','A','seed');
      INSERT INTO cat_product(id,brand_id,manufacturer_code,code_norm,updated_at) VALUES
        (1,1,'PARSER','PARSER','2026-10-19'),(2,1,'SEED','SEED','2026-10-19'),
        (3,1,'FILE','FILE','2026-10-19'),(4,1,'MANUAL','MANUAL','2026-10-19');
      INSERT INTO cat_product_attribute(product_id,attribute_id,value_num,source,confidence) VALUES
        (1,1,16,'parser',0.9),(2,1,20,'seed',NULL),(3,1,32,'import_file',NULL),(4,1,40,'manual',NULL);`);
    const prior = old.prepare("SELECT * FROM cat_product_attribute ORDER BY product_id").all();
    old.close();
    const db = openMigratedLqDatabase({ ...options, migrationsFolder: path.resolve("db/migrations/lq") });
    try {
      expect(db.prepare("SELECT * FROM cat_product_attribute ORDER BY product_id").all())
        .toEqual(prior.map(row => ({ ...row as object, source_import_id: null, derivation_ref: null })));
      expect(db.prepare("SELECT source,COUNT(*) n FROM cat_product_attribute GROUP BY source ORDER BY source").all())
        .toEqual([{source:"import_file",n:1},{source:"manual",n:1},{source:"parser",n:1},{source:"seed",n:1}]);
      expect(db.pragma("foreign_key_check")).toEqual([]);
      expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally { db.close(); }
  });

  it("migrates a database with an exact older journal prefix", () => {
    const root = temporaryDirectory();
    const fixtureRoot = temporaryDirectory("librequadri-migration-fixture-");
    const firstMigration: TestMigration = {
      tag: "0000_settings",
      when: 1_800_000_000_000,
      sql: "CREATE TABLE test_settings (id INTEGER PRIMARY KEY, value TEXT NOT NULL);\n",
    };
    const olderMigrations = createMigrationFixture(
      path.join(fixtureRoot, "older"),
      [firstMigration],
    );
    const currentMigrations = createMigrationFixture(
      path.join(fixtureRoot, "current"),
      [
        firstMigration,
        {
          tag: "0001_settings_note",
          when: 1_800_000_001_000,
          sql: "ALTER TABLE test_settings ADD COLUMN note TEXT;\n",
        },
      ],
    );

    MainDatabaseService.initialize(root, {
      migrationsFolder: olderMigrations,
    }).close();

    const paths = applicationPaths(root);
    const olderDatabase = new Database(paths.lqDatabase);
    olderDatabase
      .prepare("INSERT INTO test_settings (id, value) VALUES (?, ?)")
      .run(1, "preserved");
    olderDatabase.close();

    MainDatabaseService.initialize(root, {
      migrationsFolder: currentMigrations,
    }).close();

    const migratedDatabase = new Database(paths.lqDatabase, { readonly: true });
    try {
      expect(
        migratedDatabase.prepare("SELECT id, value, note FROM test_settings").all(),
      ).toEqual([{ id: 1, value: "preserved", note: null }]);
      expect(
        migratedDatabase
          .prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations")
          .get(),
      ).toEqual({ count: 2 });
    } finally {
      migratedDatabase.close();
    }
  });

  it("rejects a database whose applied history is newer than the bundle", () => {
    const root = temporaryDirectory();
    const fixtureRoot = temporaryDirectory("librequadri-migration-fixture-");
    const migrations: TestMigration[] = [
      {
        tag: "0000_one",
        when: 1_800_000_000_000,
        sql: "CREATE TABLE test_one (id INTEGER PRIMARY KEY);\n",
      },
      {
        tag: "0001_two",
        when: 1_800_000_001_000,
        sql: "CREATE TABLE test_two (id INTEGER PRIMARY KEY);\n",
      },
      {
        tag: "0002_three",
        when: 1_800_000_002_000,
        sql: "CREATE TABLE test_three (id INTEGER PRIMARY KEY);\n",
      },
    ];
    const newerMigrations = createMigrationFixture(
      path.join(fixtureRoot, "newer"),
      migrations,
    );
    const olderBundle = createMigrationFixture(
      path.join(fixtureRoot, "older"),
      migrations.slice(0, 2),
    );

    MainDatabaseService.initialize(root, {
      migrationsFolder: newerMigrations,
    }).close();

    const failure = migrationFailure(() =>
      MainDatabaseService.initialize(root, { migrationsFolder: olderBundle }),
    );
    expect(failure.cause).toBeInstanceOf(IncompatibleMigrationHistoryError);
    expect(failure.message).toContain("3 applied migrations");

    const database = new Database(applicationPaths(root).lqDatabase, {
      readonly: true,
    });
    try {
      expect(tableExists(database, "test_three")).toBe(true);
    } finally {
      database.close();
    }
  });

  it("rejects a rewritten migration with the same journal timestamp", () => {
    const root = temporaryDirectory();
    const fixtureRoot = temporaryDirectory("librequadri-migration-fixture-");
    const appliedMigrations = createMigrationFixture(
      path.join(fixtureRoot, "applied"),
      [
        {
          tag: "0000_original",
          when: 1_800_000_000_000,
          sql: "CREATE TABLE test_original (id INTEGER PRIMARY KEY);\n",
        },
      ],
    );
    const incompatibleBundle = createMigrationFixture(
      path.join(fixtureRoot, "incompatible"),
      [
        {
          tag: "0000_original",
          when: 1_800_000_000_000,
          sql: "CREATE TABLE test_rewritten (id INTEGER PRIMARY KEY);\n",
        },
      ],
    );

    MainDatabaseService.initialize(root, {
      migrationsFolder: appliedMigrations,
    }).close();

    const failure = migrationFailure(() =>
      MainDatabaseService.initialize(root, {
        migrationsFolder: incompatibleBundle,
      }),
    );
    expect(failure.cause).toBeInstanceOf(IncompatibleMigrationHistoryError);
    expect(failure.message).toContain("not the same migration");
  });

  it("rejects foreign-key violations and restores the pre-migration database", () => {
    const root = temporaryDirectory();
    const fixtureRoot = temporaryDirectory("librequadri-migration-fixture-");
    const invalidMigrations = createMigrationFixture(fixtureRoot, [
      {
        tag: "0000_invalid_foreign_key",
        when: 1_800_000_000_000,
        sql: [
          "CREATE TABLE test_parent (id INTEGER PRIMARY KEY);",
          "CREATE TABLE test_child (parent_id INTEGER NOT NULL REFERENCES test_parent(id));",
          "INSERT INTO test_child (parent_id) VALUES (999);",
        ].join("\n--> statement-breakpoint\n"),
      },
    ]);

    const failure = migrationFailure(() =>
      MainDatabaseService.initialize(root, {
        migrationsFolder: invalidMigrations,
      }),
    );
    expect(failure.cause).toBeInstanceOf(ForeignKeyValidationError);
    expect(failure.message).toContain("foreign_key_check");

    const database = openConfiguredDatabase(applicationPaths(root).lqDatabase, {
      kind: "lq",
    });
    try {
      expect(tableExists(database, "test_parent")).toBe(false);
      expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    } finally {
      closeConfiguredDatabase(database);
    }
  });

  it("creates a valid pre-migration SQLite backup containing committed WAL data", () => {
    const root = temporaryDirectory();
    const paths = applicationPaths(root);
    mkdirSync(paths.data, { recursive: true });
    const writer = openConfiguredDatabase(paths.lqDatabase, { kind: "lq" });
    writer.exec("CREATE TABLE existing_data (value TEXT NOT NULL)");
    writer.prepare("INSERT INTO existing_data (value) VALUES (?)").run("saved");

    let service: MainDatabaseService | undefined;
    try {
      service = MainDatabaseService.initialize(root);
    } finally {
      service?.close();
      closeConfiguredDatabase(writer);
    }

    const backupFiles = readdirSync(paths.backups).filter((filename) =>
      filename.endsWith(".db"),
    );
    expect(backupFiles).toHaveLength(1);
    const backupPath = path.join(paths.backups, backupFiles[0]!);
    expect(existsSync(backupPath)).toBe(true);

    const backup = new Database(backupPath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      expect(backup.pragma("quick_check", { simple: true })).toBe("ok");
      expect(backup.prepare("SELECT value FROM existing_data").all()).toEqual([
        { value: "saved" },
      ]);
      expect(tableExists(backup, "__drizzle_migrations")).toBe(false);
    } finally {
      backup.close();
    }
  });

  it("does not expose a partially migrated database after migration failure", () => {
    const root = temporaryDirectory();
    const paths = applicationPaths(root);
    mkdirSync(paths.data, { recursive: true });
    const original = new Database(paths.lqDatabase);
    original.exec("CREATE TABLE original_data (value TEXT NOT NULL)");
    original.prepare("INSERT INTO original_data (value) VALUES (?)").run("kept");
    original.close();

    const fixtureRoot = temporaryDirectory("librequadri-migration-fixture-");
    const failingMigrations = createMigrationFixture(fixtureRoot, [
      {
        tag: "0000_failure",
        when: 1_800_000_000_000,
        sql: [
          "CREATE TABLE partial_data (id INTEGER PRIMARY KEY);",
          "THIS IS NOT VALID SQL;",
        ].join("\n--> statement-breakpoint\n"),
      },
    ]);

    const failure = migrationFailure(() =>
      MainDatabaseService.initialize(root, {
        migrationsFolder: failingMigrations,
      }),
    );
    expect(failure.message).toContain("verified pre-migration backup was restored");
    expect(existsSync(failure.backupPath)).toBe(true);

    const restored = new Database(paths.lqDatabase, { readonly: true });
    try {
      expect(restored.pragma("quick_check", { simple: true })).toBe("ok");
      expect(restored.prepare("SELECT value FROM original_data").all()).toEqual([
        { value: "kept" },
      ]);
      expect(tableExists(restored, "partial_data")).toBe(false);
      expect(tableExists(restored, "__drizzle_migrations")).toBe(false);
    } finally {
      restored.close();
    }
  });
});
