import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertDevelopmentSyncRoot, syncDevelopmentEngineering } from "../src/main/development/engineering-sync.js";
import { describeEngineeringSyncError, openExclusiveCatalogue } from "../src/main/development/catalogue-exclusion.js";
import { importTiQuadri } from "../src/main/sources/tiquadri/import.js";
import { importTiQuadriDrawingAssets } from "../src/main/sources/tiquadri/drawing-assets.js";
import { TIQUADRI_ENGINEERING_ADAPTER as adapter } from "../src/main/sources/tiquadri/adapter.js";
import { readEngineeringReadiness } from "../src/main/catalogue/engineering-readiness.js";
import { createCatalogueFixture } from "./helpers/catalogue-fixtures.js";

const adapterState = vi.hoisted(() => ({version: "11"}));
const tableReads = vi.hoisted(() => [] as {name: string; options?: {columns?: string[]; rowLimit?: number}}[]);
vi.mock("../src/main/sources/tiquadri/adapter.js", () => ({TIQUADRI_ENGINEERING_ADAPTER: {
  code: "tiquadri", get version() { return adapterState.version; },
}}));
// Only the proprietary binary parser is doubled; importers, fingerprints,
// transactions, backups, drawings and OS SQLite locks run for real.
vi.mock("mdb-reader", () => ({default: class {
  tables: Record<string, Record<string, unknown>[]>;
  constructor(bytes: Buffer) { this.tables = JSON.parse(bytes.toString()); }
  getTableNames() { return Object.keys(this.tables); }
  getTable(name: string) {
    const rows = this.tables[name] ?? [];
    return {rowCount: rows.length, getData: (options?: {columns?: string[]; rowLimit?: number}) => {
      tableReads.push({name, options});
      return rows.slice(0, options?.rowLimit).map(row => options?.columns
        ? Object.fromEntries(options.columns.map(column => [column, row[column]])) : row);
    }, getColumnNames: () => Object.keys(rows[0] ?? {})};
  }
}}));
const roots: string[] = [];
afterEach(() => {
  adapterState.version = "11";
  vi.restoreAllMocks();
  tableReads.length = 0;
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
function files(root: string): Record<string, string> {
  return Object.fromEntries(readdirSync(root, {recursive: true, withFileTypes: true})
    .filter(entry => entry.isFile()).map(entry => {
      const filename = path.join(entry.parentPath, entry.name);
      return [path.relative(root, filename), hash(readFileSync(filename))];
    }));
}
async function setup(version = "11", names = {master: "master.mdb", listino: "listino.mdb", dxf: "dxf.mdb"}) {
  const root = mkdtempSync(path.join(tmpdir(), "librequadri-sync-test-")); roots.push(root);
  const dataRoot = path.join(root, "development");
  const applicationRoot = path.join(root, "application");
  mkdirSync(path.join(dataRoot, "data"), {recursive: true});
  cpSync(path.resolve("db"), path.join(applicationRoot, "db"), {recursive: true});
  const f = createCatalogueFixture();
  f.importDelivery({issuer: "BTI", listino: "1", validFrom: "2026-01-01", products: [
    {marchio: "BTI", code: "TEST", priceCents: 12345, discountFamily: "DSC", statisticalFamily: "STAT"},
  ]});
  for (const role of ["master", "listino", "dxf"]) mkdirSync(path.join(root, role));
  const master = path.join(root, "master", names.master), listino = path.join(root, "listino", names.listino), dxf = path.join(root, "dxf", names.dxf);
  writeFileSync(master, JSON.stringify({ANA_DB: [{KEY: "TIPRE", IsQuadri: true, Descri: "Fixture"}],
    ANA_PACK: [{ID_Pack: 1, Descri_Pack: "Test", Famiglia_Apparecchi: 1}],
    ANA_ART_PACK: [{Id_Pack: 1, Marchio_Articolo: "BT-", Cod_Art: "TEST"}],
    ASS_PANNELLI_QUADRI_APPARECCHI: [{Famiglia_Apparecchi: 1, Descrizione_Apparecchi: "Test", Poli_Din: 1,
      Dimensione_Vert_X_Ruotato_0: 18, Dimensione_Vert_Y_Ruotato_0: 80, File_blocco: "TEST"}],
  }));
  writeFileSync(listino, JSON.stringify({ANA_ART_MONTAGGIO: [{ART_COD: "TEST", POLI_DIN: 1}]}));
  writeFileSync(dxf, JSON.stringify({DXF_BLOCK: [{NOME: "TEST", CONTENUTO: "0\nBLOCK\n2\nTEST\n0\nLINE\n10\n0\n20\n0\n11\n1\n21\n1\n0\nENDBLK\n"}]}));
  adapterState.version = version;
  await importTiQuadri({database: f.lq, sourcePath: master, listinoPath: listino,
    archiveDirectory: path.join(dataRoot, "imports/tiquadri"), backupDirectory: path.join(dataRoot, "backups"),
    seedFolder: path.join(applicationRoot, "db/seed")});
  f.lq.exec(`INSERT INTO cat_config_model(brand_id,code,name,model_kind,source,context_policy,definition_fingerprint)
    SELECT id,'manual.model','Manual','device','manual','unrestricted','manual-definition' FROM cat_brand WHERE metel_marchio='BTI';
    INSERT INTO app_setting(key,value) VALUES('manual.setting','keep');`);
  // Stable manual geometry also makes inventory-only synchronization testable.
  f.lq.exec(`INSERT INTO cat_phys_class(code,name,source) VALUES('manual','Manual','manual');
    INSERT INTO cat_phys_profile_set(code,name,source) VALUES('manual','Manual','manual');
    INSERT INTO cat_phys_profile(code,name,profile_kind,profile_set_id,fit_class_id,source)
      SELECT 'manual','Manual','device',s.id,c.id,'manual' FROM cat_phys_profile_set s,cat_phys_class c WHERE s.code='manual' AND c.code='manual';
    INSERT INTO cat_phys_view(profile_id,view_code,width_mm,height_mm,symbol_kind,asset_key)
      SELECT id,'front',10,10,'physical_panel','TEST' FROM cat_phys_profile WHERE code='manual';`);
  importTiQuadriDrawingAssets({database: f.lq, sourcePath: dxf, assetsRoot: path.join(dataRoot, "assets")});
  const filename = path.join(dataRoot, "data/lq.db");
  await f.lq.backup(filename);
  await f.raw.backup(path.join(dataRoot, "data/metel_raw.db")); f.close();
  const db = new Database(filename); db.pragma("journal_mode=WAL"); db.close();
  adapterState.version = "11";
  const mutate = (sql: string) => { const d = new Database(filename); try {d.exec(sql);} finally {d.close();} };
  mkdirSync(path.join(dataRoot, "working"));
  cpSync(path.resolve("test/fixtures/quotation-format1.lqp"), path.join(dataRoot, "working/project.lqp"));
  const options = {dataRoot, applicationRoot};
  return {root, filename, options, mutate};
}
function inspect(filename: string, fn: (db: Database.Database) => unknown) {
  const db = new Database(filename); try { return fn(db); } finally { db.close(); }
}
function unrelated(filename: string) {
  return inspect(filename, db => Object.fromEntries([
    ...db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND (name LIKE 'com_%' OR name LIKE 'cat_product%' OR name LIKE 'cat_metel%' OR name LIKE 'app_import%')").pluck().all() as string[],
    "app_setting",
  ].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]).concat([
    ["manual-models", db.prepare("SELECT * FROM cat_config_model WHERE source='manual'").all()],
  ])));
}

function historicalModel(f: Awaited<ReturnType<typeof setup>>, active: number) {
  f.mutate(`INSERT INTO app_source_import(adapter_code,adapter_version,source_label,fingerprint,imported_at,became_current,summary_json)
    VALUES('tiquadri','10','Historical','${"d".repeat(64)}','2026-01-01',0,'{}');
    INSERT INTO cat_config_model(brand_id,code,name,model_kind,active,source,source_import_id,context_policy,definition_fingerprint)
      SELECT id,'tq.pack.retired','Retired model','device',${active},'import',
        (SELECT id FROM app_source_import WHERE fingerprint='${"d".repeat(64)}'),'unrestricted','historical'
      FROM cat_brand WHERE metel_marchio='BTI'`);
}

const temporarySyncFolders = () => readdirSync(tmpdir()).filter(name => name.startsWith("librequadri-engineering-sync-"));

// Keep the holder in another process. Reading/hashing its DB in the holder's
// own process would close a raw FD and cancel POSIX SQLite locks (SQLite §2.2).
async function holdCatalogue(filename: string, sql: string) {
  const child = spawn(process.execPath, ["-e",
    "const D=require('better-sqlite3');const d=new D(process.argv[1]);d.exec(process.argv[2]);process.stdout.write('ready');process.stdin.resume();process.stdin.on('end',()=>{d.close()})",
    filename, sql], {stdio: ["pipe", "pipe", "pipe"]});
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {child.kill(); reject(new Error("Catalogue holder startup timed out"));}, 5000);
    child.stdout.once("data", () => {clearTimeout(timer); resolve();});
    child.once("error", reject);
    child.once("exit", code => {if (code) reject(new Error(`Holder exited ${code}`));});
  });
  return async () => {
    const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
    child.stdin.end(); await exited;
  };
}

describe("explicit development engineering sync", () => {
  it("ready/no-op makes no backup, import, or content change", async () => {
    const f = await setup(); const before = files(f.options.dataRoot);
    expect(await syncDevelopmentEngineering(f.options)).toMatchObject({engineeringNeeded: false, drawingsNeeded: false,
      engineeringImported: false, drawingsImported: false});
    expect(files(f.options.dataRoot)).toEqual(before);
  });
  it("accepts inactive historical model provenance on check/no-op and a later reimport", async () => {
    const f = await setup(); historicalModel(f, 0);
    const historical = inspect(f.filename, db => db.prepare("SELECT * FROM cat_config_model WHERE code='tq.pack.retired'").get());
    const before = files(f.options.dataRoot);
    expect(await syncDevelopmentEngineering({...f.options, check: true})).toMatchObject({engineeringNeeded: false});
    expect(await syncDevelopmentEngineering(f.options)).toMatchObject({engineeringImported: false, drawingsImported: false});
    expect(files(f.options.dataRoot)).toEqual(before);
    const seed = path.join(f.options.applicationRoot, "db/seed/tiquadri-front-presentation.json");
    const rows = JSON.parse(readFileSync(seed, "utf8")); rows[0].evidence += "; review";
    writeFileSync(seed, JSON.stringify(rows));
    expect(await syncDevelopmentEngineering(f.options)).toMatchObject({engineeringImported: true});
    expect(inspect(f.filename, db => db.prepare("SELECT * FROM cat_config_model WHERE code='tq.pack.retired'").get())).toEqual(historical);
  });
  it.each(["historical", "missing", "dangling", "missing on stale source", "historical on stale source"])("refuses invalid active model provenance: %s", async kind => {
    const f = await setup(kind.endsWith("stale source") ? "10" : "11");
    if (kind.startsWith("historical")) historicalModel(f, 1);
    else f.mutate(`PRAGMA foreign_keys=OFF; UPDATE cat_config_model SET source_import_id=${kind === "dangling" ? "99999" : "NULL"} WHERE source='import' AND active=1`);
    const before = files(f.options.dataRoot);
    for (const check of [true, false]) await expect(syncDevelopmentEngineering({...f.options, check})).rejects.toThrow(/Invalid active model provenance/);
    expect(files(f.options.dataRoot)).toEqual(before);
  });
  it.each([false, true])("preserves original filenames and role isolation (identical basenames: %s)", async same => {
    const names = same ? {master: "Shared Source.MDB", listino: "Shared Source.MDB", dxf: "Shared Source.MDB"}
      : {master: "Original Master.MDB", listino: "Original Listino.mdb", dxf: "Original DXF.mdb"};
    const f = await setup("10", names);
    const metadata = (db: Database.Database) => db.prepare(`SELECT f.role,f.original_file_name,f.file_sha256,f.byte_size
      FROM app_source_import_file f JOIN app_source_import i ON i.id=f.import_id WHERE i.became_current=1 ORDER BY f.role`).all();
    const before = inspect(f.filename, metadata);
    f.mutate("UPDATE cat_phys_view SET asset_key='missing' WHERE asset_key='TEST'");
    expect(await syncDevelopmentEngineering(f.options)).toMatchObject({engineeringImported: true, drawingsImported: true});
    expect(inspect(f.filename, metadata)).toEqual(before);
    expect(inspect(f.filename, db => db.prepare("SELECT source_label FROM app_source_import WHERE adapter_code='assets' AND became_current=1").pluck().get()))
      .toBe(`DXF_BLOCK:${names.dxf}`);
  });
  it.each(["../escape.mdb", "..\\escape.mdb", "C:escape.mdb", "", ".."])("refuses unsafe original filename %j before backup", async name => {
    const f = await setup("10");
    inspect(f.filename, db => db.prepare("UPDATE app_source_import_file SET original_file_name=? WHERE role='master'").run(name));
    const before = files(f.options.dataRoot);
    await expect(syncDevelopmentEngineering(f.options)).rejects.toThrow(/Unsafe original master/);
    expect(files(f.options.dataRoot)).toEqual(before);
  });
  it("validates drawing schema/nonempty identity without reading drawing memo contents", async () => {
    const f = await setup(); tableReads.length = 0;
    await syncDevelopmentEngineering({...f.options, check: true});
    expect(tableReads.filter(read => read.name === "DXF_BLOCK")).toEqual([
      {name: "DXF_BLOCK", options: {columns: ["NOME"], rowLimit: 1}},
    ]);
  });
  it("actually imports 10 to 11, restores readiness and preserves unrelated data", async () => {
    const f = await setup("10"); const preserved = unrelated(f.filename) as Record<string, unknown>;
    const project = readFileSync(path.join(f.options.dataRoot, "working/project.lqp"));
    const raw = readFileSync(path.join(f.options.dataRoot, "data/metel_raw.db"));
    const backups = readdirSync(path.join(f.options.dataRoot, "backups")).length;
    expect(await syncDevelopmentEngineering(f.options)).toMatchObject({installedAdapter: "10", requiredAdapter: "11", engineeringImported: true});
    expect(inspect(f.filename, db => readEngineeringReadiness(db).sources[0])).toMatchObject({status: "ready", installedVersion: adapter.version});
    const after = unrelated(f.filename) as Record<string, unknown>;
    const derivedKeys = new Set(["catalogue.category_classifier_fingerprint", "catalogue.attribute_enrichment_fingerprint", "catalogue.family_grouping_fingerprint", "catalogue.package_offer_fingerprint"]);
    const withoutDerivedFingerprints = (snapshot: Record<string, unknown>) => ({...snapshot,
      app_setting: (snapshot["app_setting"] as Array<{key:string}>).filter(row => !derivedKeys.has(row.key))});
    expect(withoutDerivedFingerprints(after)).toEqual(withoutDerivedFingerprints(preserved));
    for (const key of derivedKeys) expect((after["app_setting"] as Array<{key:string;value:string}>).find(row => row.key === key)?.value)
      .not.toBe((preserved["app_setting"] as Array<{key:string;value:string}>).find(row => row.key === key)?.value);
    expect(readFileSync(path.join(f.options.dataRoot, "working/project.lqp"))).toEqual(project);
    expect(readFileSync(path.join(f.options.dataRoot, "data/metel_raw.db"))).toEqual(raw);
    expect(readdirSync(path.join(f.options.dataRoot, "backups"))).toHaveLength(backups + 1);
    expect(await syncDevelopmentEngineering(f.options)).toMatchObject({engineeringImported: false, drawingsImported: false});
  });
  it("detects seed-only drift and leaves unchanged drawings alone", async () => {
    const f = await setup();
    const seed = path.join(f.options.applicationRoot, "db/seed/tiquadri-front-presentation.json");
    const rows = JSON.parse(readFileSync(seed, "utf8")); rows[0].evidence += "; reviewed again";
    writeFileSync(seed, JSON.stringify(rows));
    expect(await syncDevelopmentEngineering({...f.options, check: true})).toMatchObject({engineeringNeeded: true, drawingsNeeded: false});
    expect(await syncDevelopmentEngineering(f.options)).toMatchObject({engineeringImported: true, drawingsImported: false});
  });
  it("synchronizes inventory drift and rebuilds a historical drawing fingerprint", async () => {
    const f = await setup();
    f.mutate("UPDATE cat_phys_view SET asset_key='missing' WHERE asset_key='TEST'");
    expect(await syncDevelopmentEngineering(f.options)).toMatchObject({engineeringImported: false, drawingsImported: true});
    f.mutate("UPDATE cat_phys_view SET asset_key='TEST' WHERE asset_key='missing'");
    expect(await syncDevelopmentEngineering(f.options)).toMatchObject({engineeringImported: false, drawingsImported: true});
    expect(await syncDevelopmentEngineering(f.options)).toMatchObject({engineeringImported: false, drawingsImported: false});
  });
  it.each(["master", "listino", "dxf"])("refuses missing/corrupt %s archives before backup/import", async role => {
    for (const missing of [true, false]) {
      const f = await setup("10");
      const digest = inspect(f.filename, db => db.prepare("SELECT file_sha256 FROM app_source_import_file WHERE role=?").pluck().get(role)) as string;
      const archive = path.join(f.options.dataRoot, role === "dxf" ? "assets/tiquadri-dxf" : "imports/tiquadri", `${digest}.mdb`);
      if (missing) unlinkSync(archive); else writeFileSync(archive, "corrupt");
      const before = files(f.options.dataRoot);
      await expect(syncDevelopmentEngineering(f.options)).rejects.toThrow();
      expect(files(f.options.dataRoot)).toEqual(before);
    }
  });
  it.each(["master", "listino", "dxf"])("still hashes the complete %s archive when validation only samples a row", async role => {
    const f = await setup("10");
    const digest = inspect(f.filename, db => db.prepare("SELECT file_sha256 FROM app_source_import_file WHERE role=?").pluck().get(role)) as string;
    const archive = path.join(f.options.dataRoot, role === "dxf" ? "assets/tiquadri-dxf" : "imports/tiquadri", `${digest}.mdb`);
    const bytes = readFileSync(archive); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    writeFileSync(archive, bytes);
    const before = files(f.options.dataRoot);
    await expect(syncDevelopmentEngineering(f.options)).rejects.toThrow(`Corrupt ${role} archive (size/SHA-256)`);
    expect(files(f.options.dataRoot)).toEqual(before);
  });
  it("refuses newer engineering and drawing adapters without backup/import", async () => {
    for (const sql of ["UPDATE app_source_import SET adapter_version='12' WHERE adapter_code='tiquadri'",
      "UPDATE app_source_import SET adapter_version='3' WHERE adapter_code='assets'"]) {
      const f = await setup(); f.mutate(sql); const before = files(f.options.dataRoot);
      await expect(syncDevelopmentEngineering(f.options)).rejects.toThrow(/downgrade/);
      expect(files(f.options.dataRoot)).toEqual(before);
    }
  });
  it("--check remains byte-for-byte read-only with and without existing WAL/SHM", async () => {
    const f = await setup("10");
    for (const active of [false, true]) {
      const release = active ? await holdCatalogue(f.filename,
        "INSERT INTO app_setting(key,value) VALUES('wal','uncheckpointed')") : undefined;
      const before = files(f.options.dataRoot);
      try {
        expect(await syncDevelopmentEngineering({...f.options, check: true})).toMatchObject({engineeringNeeded: true, engineeringImported: false, drawingsImported: false});
        expect(files(f.options.dataRoot)).toEqual(before);
      } finally { await release?.(); }
    }
  });
  it("refuses an idle WAL connection and active readers/writers, with no SingletonLock present", async () => {
    for (const sql of ["SELECT * FROM app_setting", "BEGIN; SELECT * FROM app_setting", "BEGIN IMMEDIATE"]) {
      const f = await setup("10"); const release = await holdCatalogue(f.filename, sql);
      const before = files(f.options.dataRoot);
      try {
        expect(existsSync(path.join(f.options.dataRoot, "SingletonLock"))).toBe(false);
        await expect(syncDevelopmentEngineering(f.options)).rejects.toThrow(/exclusively access/);
        expect(files(f.options.dataRoot)).toEqual(before);
      } finally { await release(); }
    }
  });
  it("retains exclusion across COMMIT, asynchronous backup and both import phases", async () => {
    const f = await setup("10");
    f.mutate("UPDATE cat_phys_view SET asset_key='missing' WHERE asset_key='TEST'");
    const original = Database.prototype.backup;
    let probes = 0;
    vi.spyOn(Database.prototype, "backup").mockImplementation(async function(this: Database.Database, ...args) {
      // Independent process bypasses every JS/app lock and attempts a real read.
      const script = "const D=require('better-sqlite3');const d=new D(process.argv[1],{timeout:0});try{d.prepare('SELECT * FROM app_setting').all();process.exitCode=4}catch(e){if(e.code!=='SQLITE_BUSY')throw e}finally{d.close()}";
      const child = spawnSync(process.execPath, ["-e", script, f.filename], {encoding: "utf8"});
      expect(child.status, child.stderr).toBe(0); probes++;
      return original.apply(this, args);
    });
    expect(await syncDevelopmentEngineering(f.options)).toMatchObject({engineeringImported: true, drawingsImported: true});
    expect(probes).toBe(1);
    const d = openExclusiveCatalogue(f.filename); d.exec("BEGIN EXCLUSIVE; COMMIT");
    try { expect(() => openExclusiveCatalogue(f.filename)).toThrow(/exclusively/); } finally {d.close();}
  });
  it("refuses rollback mode and releases exclusion after an import failure", async () => {
    const f = await setup("10");
    const original = Database.prototype.backup;
    vi.spyOn(Database.prototype, "backup").mockRejectedValueOnce(new Error("disk full"));
    await expect(syncDevelopmentEngineering(f.options)).rejects.toThrow("disk full");
    Database.prototype.backup = original;
    expect(await syncDevelopmentEngineering(f.options)).toMatchObject({engineeringImported: true});
    f.mutate("PRAGMA journal_mode=DELETE");
    const error = await syncDevelopmentEngineering(f.options).catch(error => error);
    expect(describeEngineeringSyncError(error)).toContain("Unsupported catalogue journal mode: delete");
    expect(describeEngineeringSyncError(error)).not.toContain("Close Electron");
  });
  it("reports corrupt databases with the driver cause instead of concurrent-access advice", async () => {
    const f = await setup(); writeFileSync(f.filename, "not a SQLite database");
    const before = files(f.options.dataRoot);
    const error = await syncDevelopmentEngineering(f.options).catch(error => error);
    expect(error).toMatchObject({cause: {code: "SQLITE_NOTADB"}});
    expect(describeEngineeringSyncError(error)).toContain("SQLITE_NOTADB");
    expect(describeEngineeringSyncError(error)).toContain("file is not a database");
    expect(describeEngineeringSyncError(error)).not.toContain("Close Electron");
    expect(files(f.options.dataRoot)).toEqual(before);
  });
  it.each(["SQLITE_BUSY", "SQLITE_LOCKED", "SQLITE_BUSY_SNAPSHOT", "SQLITE_LOCKED_SHAREDCACHE"])("classifies %s as contention and retains its cause", async code => {
    const f = await setup(); const cause = Object.assign(new Error("driver contention detail"), {code});
    vi.spyOn(Database.prototype, "pragma").mockImplementationOnce(() => {throw cause;});
    const error = await syncDevelopmentEngineering(f.options).catch(error => error);
    expect(error.cause).toBe(cause);
    expect(describeEngineeringSyncError(error)).toContain("Close Electron");
    expect(describeEngineeringSyncError(error)).toContain(`${code}: driver contention detail`);
  });
  it("defers interruption cleanup until backup/import settle and retains exclusion until then", async () => {
    const f = await setup("10");
    f.mutate("UPDATE cat_phys_view SET asset_key='missing' WHERE asset_key='TEST'");
    const before = new Set(temporarySyncFolders());
    const controller = new AbortController();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => {entered = resolve;});
    const gate = new Promise<void>(resolve => {release = resolve;});
    const original = Database.prototype.backup;
    vi.spyOn(Database.prototype, "backup").mockImplementationOnce(async function(this: Database.Database, ...args) {
      entered(); await gate; return original.apply(this, args);
    });
    const operation = syncDevelopmentEngineering({...f.options, signal: controller.signal});
    const rejected = expect(operation).rejects.toThrow("stop requested");
    await started;
    const created = temporarySyncFolders().filter(name => !before.has(name));
    expect(created).toHaveLength(1);
    controller.abort(new Error("stop requested"));
    try {
      expect(existsSync(path.join(tmpdir(), created[0]!, "master/master.mdb"))).toBe(true);
      const child = spawnSync(process.execPath, ["-e",
        "const D=require('better-sqlite3');const d=new D(process.argv[1],{timeout:0});try{d.prepare('SELECT * FROM app_setting').all();process.exitCode=4}catch(e){if(e.code!=='SQLITE_BUSY')throw e}finally{d.close()}", f.filename], {encoding: "utf8"});
      expect(child.status, child.stderr).toBe(0);
    } finally {release(); await rejected;}
    expect(created.every(name => !existsSync(path.join(tmpdir(), name)))).toBe(true);
    expect(await syncDevelopmentEngineering(f.options)).toMatchObject({engineeringImported: false, drawingsImported: true});
  });
  it("does not trust a valid hash for an invalid MDB role", async () => {
    const f = await setup("10");
    const bytes = Buffer.from(JSON.stringify({WRONG: [{NOME: "TEST"}]}));
    const digest = hash(bytes);
    writeFileSync(path.join(f.options.dataRoot, "assets/tiquadri-dxf", `${digest}.mdb`), bytes);
    f.mutate(`UPDATE app_source_import_file SET file_sha256='${digest}',byte_size=${bytes.length} WHERE role='dxf'`);
    const before = files(f.options.dataRoot);
    await expect(syncDevelopmentEngineering(f.options)).rejects.toThrow(/Invalid dxf MDB/);
    expect(files(f.options.dataRoot)).toEqual(before);
  });
  it("refuses missing/ambiguous import metadata rather than choosing an archive", async () => {
    const f = await setup();
    f.mutate("UPDATE app_source_import SET became_current=0 WHERE adapter_code='tiquadri'");
    const before = files(f.options.dataRoot);
    await expect(syncDevelopmentEngineering(f.options)).rejects.toThrow(/one current engineering/);
    expect(files(f.options.dataRoot)).toEqual(before);
  });
  it("does not rely on a stale SingletonLock file", async () => {
    const f = await setup();
    writeFileSync(path.join(f.options.dataRoot, "SingletonLock"), "stale");
    expect(await syncDevelopmentEngineering(f.options)).toMatchObject({engineeringImported: false, drawingsImported: false});
  });
  it("rejects packaged manifests, application bundles and database aliases", async () => {
    const f = await setup();
    writeFileSync(path.join(f.options.dataRoot, "manifest.json"), "{}");
    await expect(syncDevelopmentEngineering(f.options)).rejects.toThrow(/development-only/);
    unlinkSync(path.join(f.options.dataRoot, "manifest.json"));
    const releaseRoot = path.join(f.root, "Example.app", "profile"); mkdirSync(releaseRoot, { recursive: true });
    await expect(syncDevelopmentEngineering({...f.options, dataRoot: releaseRoot})).rejects.toThrow(/development-only/);
    const nestedDevelopment = path.join(f.root, "LibreQuadri", "development-profile");
    mkdirSync(path.join(nestedDevelopment, "data"), { recursive: true });
    cpSync(f.filename, path.join(nestedDevelopment, "data", "lq.db"));
    expect(() => assertDevelopmentSyncRoot(nestedDevelopment)).not.toThrow();
    const aliasRoot = path.join(f.root, "alias"); mkdirSync(aliasRoot); symlinkSync(path.dirname(f.filename), path.join(aliasRoot, "data"));
    await expect(syncDevelopmentEngineering({...f.options, dataRoot: aliasRoot})).rejects.toThrow(/unaliased/);
  });
});

it.each(["capacity-kinds", "source-brand-map"])("reimports once for a %s seed change and keeps manual overrides", async seedName => {
  const f = await setup();
  f.mutate(`UPDATE cat_capacity_kind SET source='manual',name='Manual DIN' WHERE code='din_rail';
    UPDATE cat_source_brand_map SET source='manual' WHERE adapter_code='tiquadri' AND source_brand_code='BT-'`);
  const seed = path.join(f.options.applicationRoot, `db/seed/${seedName}.json`);
  const rows = JSON.parse(readFileSync(seed, "utf8"));
  if (seedName === "capacity-kinds") rows[0].name = "Changed seed";
  else rows[0].brandMarchio = null;
  writeFileSync(seed, JSON.stringify(rows));
  expect(await syncDevelopmentEngineering({ ...f.options, check: true })).toMatchObject({ engineeringNeeded: true });
  expect(await syncDevelopmentEngineering(f.options)).toMatchObject({ engineeringImported: true });
  expect(await syncDevelopmentEngineering(f.options)).toMatchObject({ engineeringNeeded: false, engineeringImported: false });
  expect(inspect(f.filename, db => db.prepare("SELECT name,source FROM cat_capacity_kind WHERE code='din_rail'").get()))
    .toEqual({ name: "Manual DIN", source: "manual" });
  expect(inspect(f.filename, db => db.prepare(`SELECT b.metel_marchio AS marchio,m.source FROM cat_source_brand_map m
    JOIN cat_brand b ON b.id=m.brand_id WHERE m.adapter_code='tiquadri' AND m.source_brand_code='BT-'`).get()))
    .toEqual({ marchio: "BTI", source: "manual" });
});
