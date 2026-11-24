import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapDataRoot, bootstrapDevelopmentCatalogue, assertBootstrapTargetEmpty } from "../src/main/development/catalogue-bootstrap.js";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { importTiQuadri } from "../src/main/sources/tiquadri/import.js";
import { TIQUADRI_ENGINEERING_ADAPTER } from "../src/main/sources/tiquadri/adapter.js";
import { loadCategorySeed, synchronizeCategorySeed } from "../src/main/catalogue/category-seed.js";
import { importMetelDeliveryFromFiles } from "../src/main/metel/dev-import.js";
import { metelLspFile, metelFamilyFile } from "./helpers/metel-files.js";

// Synthetic MDB reader boundary. METEL parsing/normalization, migrations, seeds,
// SQLite and the drawing importer all run for real; no proprietary fixtures needed.
vi.mock("mdb-reader", () => ({ default: class {
  tables: Record<string, Record<string, unknown>[]>;
  constructor(bytes: Buffer) { this.tables = JSON.parse(bytes.toString()) as typeof this.tables; }
  getTableNames() { return Object.keys(this.tables); }
  getTable(name: string) {
    const rows = this.tables[name];
    if (!rows) throw new Error(`Missing table ${name}`);
    return { getColumnNames: () => Object.keys(rows[0] ?? {}), getData: () => rows };
  }
} }));

vi.mock("../src/main/sources/tiquadri/import.js", async importOriginal => {
  const original = await importOriginal<typeof import("../src/main/sources/tiquadri/import.js")>();
  return { ...original, importTiQuadri: vi.fn(async ({ database }: {database: Database.Database}) => {
    const issuers = database.prepare("SELECT metel_sigla FROM cat_metel_issuer ORDER BY metel_sigla").pluck().all();
    expect(issuers).toEqual(["BTI", "SIE", "SNR"]);
    database.exec(`INSERT INTO cat_phys_class(code,name,source) VALUES('test','Test','manual');
      INSERT INTO cat_phys_profile_set(code,name,source) VALUES('test','Test','manual');
      INSERT INTO cat_phys_profile(code,profile_set_id,profile_key,profile_kind,name,fit_class_id,source)
        VALUES('test',1,1,'device','Test',1,'manual');
      INSERT INTO cat_phys_view(profile_id,view_code,width_mm,height_mm,symbol_kind,asset_key)
        VALUES(1,'front',10,10,'test','Devices\\TEST');`);
    return { importId: 1, fingerprint: "test", alreadyImported: false,
      summary: { counts: {activeModels: 1}, capacityFillers: {designated: 1, rejected: 0},
        moduleComparison: {singleArticleCompared: 1}, discrepancies: [], secondaryDiscrepancies: [],
        conflicts: {}, errors: [] } };
  }) };
});

const folders: string[] = [];
const applicationRoot = path.resolve(".");
const temporaryRoot = () => {
  const folder = mkdtempSync(path.join(tmpdir(), "librequadri-bootstrap-test-"));
  folders.push(folder);
  return folder;
};

function sources() {
  const root = temporaryRoot();
  mkdirSync(path.join(root, "metel"));
  mkdirSync(path.join(root, "tiquadri"));
  for (const issuer of ["BTI", "SIE", "SNR"]) {
    writeFileSync(path.join(root, "metel", `${issuer}-arbitrary-name.TxT`), metelLspFile({
      issuer, validFrom: "2026-07-01", products: [{marchio: issuer, code: "TEST", description: "Fixture",
        priceCents: 100, discountFamily: "DSC", statisticalFamily: "STAT"}],
    }));
    for (const type of ["FSC", "FST"] as const) {
      writeFileSync(path.join(root, "metel", `${issuer}-${type}.txt`), metelFamilyFile({
        type, issuer, families: [{marchio: issuer, code: type === "FSC" ? "DSC" : "STAT", description: "Fixture"}],
      }));
    }
  }
  writeFileSync(path.join(root, "tiquadri", "BTQUADRI.mdb"), JSON.stringify({
    ANA_DB: [{ KEY: "TIPRE", IsQuadri: true }], ANA_PACK: [{ID_Pack: 1}],
  }));
  writeFileSync(path.join(root, "tiquadri", "ListinoBT.mdb"), JSON.stringify({
    ANA_ART_MONTAGGIO: [{ ART_COD: "TEST", POLI_DIN: 1 }],
  }));
  writeFileSync(path.join(root, "tiquadri", "BTQuadriDXF.mdb"), JSON.stringify({
    DXF_BLOCK: [{ NOME: "TEST", CONTENUTO: "0\nBLOCK\n2\nTEST\n0\nLINE\n10\n0\n20\n0\n11\n1\n21\n1\n0\nENDBLK\n" }],
  }));
  return root;
}

function setup() {
  const sourceRoot = sources();
  const dataRoot = path.join(temporaryRoot(), "new data root");
  return { sourceRoot, dataRoot, applicationRoot };
}

function emptyCatalogue(dataRoot: string) {
  mkdirSync(path.join(dataRoot, "data"), { recursive: true });
  return openMigratedLqDatabase({ databaseFilename: path.join(dataRoot, "data/lq.db"),
    backupDirectory: path.join(dataRoot, "backups"), migrationsFolder: path.resolve("db/migrations/lq") });
}

beforeEach(() => { vi.mocked(importTiQuadri).mockClear(); });
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

describe("developer catalogue bootstrap", () => {
  it("preserves the normal development root without writing to it", () => {
    const environment = {LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local"};
    const expected = process.platform === "darwin"
      ? path.join(homedir(), "Library/Application Support/LibreQuadri Development")
      : process.platform === "win32"
        ? path.win32.join(environment.LOCALAPPDATA, "LibreQuadri Development")
        : path.join(homedir(), ".config/LibreQuadri Development");
    expect(bootstrapDataRoot(undefined, environment)).toBe(expected);
  });

  it("uses the environment root and gives --data-dir precedence, rejecting empty overrides", () => {
    const environment = {LIBREQUADRI_DATA_DIR: path.join(temporaryRoot(), "environment-root")};
    expect(bootstrapDataRoot(undefined, environment)).toBe(environment.LIBREQUADRI_DATA_DIR);
    expect(bootstrapDataRoot("explicit-root", environment)).toBe(path.resolve("explicit-root"));
    expect(() => bootstrapDataRoot(" ", environment)).toThrow(/nonempty/);
  });

  it("builds a fresh catalogue through METEL, engineering with ListinoBT, then actual drawing import", async () => {
    const options = setup();
    const result = await bootstrapDevelopmentCatalogue(options);
    expect(result.metel.map(row => [row.issuer, row.productCount, row.becameCurrent])).toEqual([
      ["BTI", 1, true], ["SIE", 1, true], ["SNR", 1, true],
    ]);
    expect(result.engineering).toMatchObject({ importId: 1, adapterVersion: TIQUADRI_ENGINEERING_ADAPTER.version,
      capacityFillers: {designated: 1, rejected: 0}, errors: [] });
    expect(result.drawings).toEqual({ referenced: 1, resolved: 1, missing: 0, invalid: 0, unsupported: {} });
    expect(importTiQuadri).toHaveBeenCalledOnce();
    expect(importTiQuadri).toHaveBeenCalledWith(expect.objectContaining({
      sourcePath: path.join(options.sourceRoot, "tiquadri/BTQUADRI.mdb"),
      listinoPath: path.join(options.sourceRoot, "tiquadri/ListinoBT.mdb"),
      archiveDirectory: path.join(options.dataRoot, "imports/tiquadri"), seedFolder: path.resolve("db/seed"),
    }));
    const db = new Database(path.join(options.dataRoot, "data/lq.db"), {readonly: true});
    try {
      expect(db.prepare("SELECT COUNT(*) FROM cat_product").pluck().get()).toBe(3);
      expect(db.prepare("SELECT COUNT(*) FROM cat_asset_variant").pluck().get()).toBe(1);
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); }
    expect(existsSync(path.join(options.dataRoot, ".catalogue-bootstrap.lock"))).toBe(false);
  });

  it("accepts a migrated, seed-only catalogue and preserves application settings", async () => {
    const options = setup();
    const db = emptyCatalogue(options.dataRoot);
    synchronizeCategorySeed(db, loadCategorySeed());
    db.prepare("INSERT INTO app_setting(key,value) VALUES('test.setting','keep')").run();
    db.close();
    await bootstrapDevelopmentCatalogue(options);
    const after = new Database(path.join(options.dataRoot, "data/lq.db"), {readonly: true});
    try { expect(after.prepare("SELECT value FROM app_setting WHERE key='test.setting'").pluck().get()).toBe("keep"); }
    finally { after.close(); }
  });

  it.each(["issuer", "family", "duplicate", "malformed", "duplicate-product", "multiplier"])(
    "rejects invalid METEL input (%s) before creating target output", async problem => {
      const options = setup();
      const metel = path.join(options.sourceRoot, "metel");
      if (problem === "issuer") {
        for (const name of readdirSync(metel).filter(name => name.startsWith("SNR"))) unlinkSync(path.join(metel, name));
      } else if (problem === "family") unlinkSync(path.join(metel, "SIE-FST.txt"));
      else if (problem === "duplicate") writeFileSync(path.join(metel, "duplicate.txt"), readFileSync(path.join(metel, "BTI-arbitrary-name.TxT")));
      else if (problem === "malformed") writeFileSync(path.join(metel, "SNR-arbitrary-name.TxT"), "broken");
      else {
        const product = {marchio: "SNR", code: "TEST", description: "Fixture", priceCents: 100,
          multiplier: problem === "multiplier" ? 0 : 1};
        writeFileSync(path.join(metel, "SNR-arbitrary-name.TxT"), metelLspFile({issuer: "SNR",
          validFrom: "2026-07-01", products: problem === "duplicate-product" ? [product, product] : [product]}));
      }
      await expect(bootstrapDevelopmentCatalogue(options)).rejects.toThrow(/METEL/);
      expect(existsSync(options.dataRoot)).toBe(false);
      expect(importTiQuadri).not.toHaveBeenCalled();
    },
  );

  it.each(["BTQUADRI.mdb", "ListinoBT.mdb", "BTQuadriDXF.mdb"])(
    "rejects a missing required MDB (%s) before any catalogue write", async name => {
      const options = setup();
      unlinkSync(path.join(options.sourceRoot, "tiquadri", name));
      await expect(bootstrapDevelopmentCatalogue(options)).rejects.toThrow(name);
      expect(existsSync(options.dataRoot)).toBe(false);
    },
  );

  it.each([
    ["BTQUADRI.mdb", {ANA_DB: [{KEY: "WRONG", IsQuadri: true}]}],
    ["ListinoBT.mdb", {ANA_ART_MONTAGGIO: [{ART_COD: "TEST"}]}],
    ["BTQuadriDXF.mdb", {OTHER: [{NOME: "TEST"}]}],
  ])("rejects an invalid MDB role/schema (%s) before any catalogue write", async (name, tables) => {
    const options = setup();
    writeFileSync(path.join(options.sourceRoot, "tiquadri", name), JSON.stringify(tables));
    await expect(bootstrapDevelopmentCatalogue(options)).rejects.toThrow(/Invalid .* MDB/);
    expect(existsSync(options.dataRoot)).toBe(false);
  });

  it("refuses a populated catalogue without changing its bytes or making another backup", async () => {
    const options = setup();
    const db = emptyCatalogue(options.dataRoot);
    db.exec("INSERT INTO cat_brand(metel_marchio,name,source) VALUES('ABC','Manual brand','manual')");
    db.close();
    const filename = path.join(options.dataRoot, "data/lq.db");
    const before = readFileSync(filename);
    const backups = readdirSync(path.join(options.dataRoot, "backups"));
    await expect(bootstrapDevelopmentCatalogue(options)).rejects.toThrow(/refuses existing.*new --data-dir/);
    expect(readFileSync(filename)).toEqual(before);
    expect(readdirSync(path.join(options.dataRoot, "backups"))).toEqual(backups);
    expect(importTiQuadri).not.toHaveBeenCalled();
  });

  it("refuses existing raw import state even if lq.db is absent", () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, "data"));
    const db = new Database(path.join(root, "data/metel_raw.db"));
    db.exec("CREATE TABLE raw_file(id INTEGER); INSERT INTO raw_file VALUES(1)");
    db.close();
    expect(() => assertBootstrapTargetEmpty(root)).toThrow(/Populated raw_file/);
    expect(existsSync(path.join(root, "data/lq.db"))).toBe(false);
  });

  it.each(["corrupt", "unrelated"])("fails closed on an existing %s database", kind => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, "data"));
    const filename = path.join(root, "data/lq.db");
    if (kind === "corrupt") writeFileSync(filename, "broken DB");
    else { const db = new Database(filename); db.exec("CREATE TABLE unrelated(id INTEGER)"); db.close(); }
    const before = readFileSync(filename);
    expect(() => assertBootstrapTargetEmpty(root)).toThrow(/refuses existing/);
    expect(readFileSync(filename)).toEqual(before);
  });

  it("does not import when another bootstrap holds the target lock", async () => {
    const options = setup();
    mkdirSync(path.join(options.dataRoot, ".catalogue-bootstrap.lock"), {recursive: true});
    await expect(bootstrapDevelopmentCatalogue(options)).rejects.toThrow(/Cannot acquire bootstrap lock/);
    expect(existsSync(path.join(options.dataRoot, "data"))).toBe(false);
    expect(existsSync(path.join(options.dataRoot, ".catalogue-bootstrap.lock"))).toBe(true);
  });

  it("preserves partial state and releases the lock on failure; a repeat cannot silently reset it", async () => {
    const options = setup();
    vi.mocked(importTiQuadri).mockRejectedValueOnce(new Error("synthetic engineering failure"));
    await expect(bootstrapDevelopmentCatalogue(options)).rejects.toThrow(/failed during TiQuadri engineering.*Partial output is preserved/);
    const db = new Database(path.join(options.dataRoot, "data/lq.db"), {readonly: true});
    try { expect(db.prepare("SELECT COUNT(*) FROM app_import_delivery").pluck().get()).toBe(3); }
    finally { db.close(); }
    expect(existsSync(path.join(options.dataRoot, ".catalogue-bootstrap.lock"))).toBe(false);
    await expect(bootstrapDevelopmentCatalogue(options)).rejects.toThrow(/refuses existing/);
  });

  it("loads the full explicit seed folder instead of falling back to the working directory for families", () => {
    const options = setup();
    const seedFolder = path.join(temporaryRoot(), "missing-seeds");
    // The normalization would otherwise use cwd's product-families.json silently.
    mkdirSync(seedFolder);
    for (const name of ["categories.json", "attributes.json", "category-attributes.json"])
      writeFileSync(path.join(seedFolder, name), readFileSync(path.join(applicationRoot, "db/seed", name)));
    mkdirSync(path.join(seedFolder, "category-mappings"));
    expect(() => importMetelDeliveryFromFiles({dataRoot: options.dataRoot,
      lqMigrationsFolder: path.resolve("db/migrations/lq"), rawMigrationsFolder: path.resolve("db/migrations/raw"),
      seedFolder, files: [path.join(options.sourceRoot, "metel/BTI-arbitrary-name.TxT")],
    })).toThrow(/product-families.json/);
  });
});
