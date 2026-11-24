import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import MDBReader from "mdb-reader";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { closeConfiguredDatabase } from "../src/main/database/sqlite-connection.js";
import { readEngineeringReadiness } from "../src/main/catalogue/engineering-readiness.js";
import { getConfigurationModel } from "../src/main/catalogue/configuration-queries.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";
import { readFrontVectorAssets } from "../src/main/catalogue/vector-assets.js";
import { TIQUADRI_ENGINEERING_ADAPTER } from "../src/main/sources/tiquadri/adapter.js";
import { importTiQuadri, type TiQuadriImportResult } from "../src/main/sources/tiquadri/import.js";
import { importTiQuadriDrawingAssets } from "../src/main/sources/tiquadri/drawing-assets.js";

// Supply an adapter-10 catalogue and licensed v32 sources. Every mutation is on a private copy.
const baseline = process.env["LIBREQUADRI_CARPENTERIA_REAL_DB"];
const master = process.env["LIBREQUADRI_TIQUADRI_MDB"];
const listino = process.env["LIBREQUADRI_LISTINOBT_MDB"];
const dxf = process.env["LIBREQUADRI_TIQUADRI_DXF_MDB"];
const available = [baseline, master, listino, dxf].every(file => file && existsSync(file));
const HDX = [[15,11],[16,21],[17,31],[18,41],[20,61],[21,71],[22,81],[23,91],
  [46,111],[47,121],[48,131],[49,141],[51,161],[52,171],[53,181],[54,191],
  [77,211],[78,221],[79,231],[80,241],[82,261],[83,271],[84,281],[85,291],
  [108,311],[109,321],[110,331],[111,341],[113,361],[114,371],[115,381],[116,391],
  [135,411],[136,421],[137,431],[138,441],[140,461],[141,471],[142,481],[143,491],
  [162,511],[163,521],[164,531],[165,541],[167,561],[168,571],[169,581],[170,591]] as const;

describe.runIf(available)("Carpenteria Stage 1 real-source upgrade acceptance", () => {
  let root: string, db: Database.Database, result: TiQuadriImportResult;
  let oldProfiles: Record<string, unknown>[], oldDefinitions: unknown[], oldKeys: Set<string>;
  let sourcePath: string, listinoPath: string, drawingPath: string;
  const profiles = () => db.prepare("SELECT * FROM cat_phys_profile ORDER BY code").all()
    .map(row => { const { source_import_id: _provenance, ...identity } = row as Record<string, unknown>; return identity; });
  const definitions = () => db.prepare("SELECT id,code,definition_fingerprint,base_profile_id FROM cat_config_model ORDER BY code").all();
  const assetKeys = () => db.prepare("SELECT DISTINCT asset_key FROM cat_phys_view WHERE asset_key IS NOT NULL").pluck().all() as string[];
  const options = () => ({ database: db, sourcePath, listinoPath,
    archiveDirectory: path.join(root, "imports"), backupDirectory: path.join(root, "backups"), seedFolder: path.resolve("db/seed") });
  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "librequadri-carpenteria-acceptance-"));
    sourcePath = path.join(root, "BTQUADRI.mdb"); listinoPath = path.join(root, "ListinoBT.mdb");
    drawingPath = path.join(root, "BTQuadriDXF.mdb");
    copyFileSync(master!, sourcePath); copyFileSync(listino!, listinoPath); copyFileSync(dxf!, drawingPath);
    const original = new Database(baseline!, { readonly: true });
    try { await original.backup(path.join(root, "lq.db")); } finally { original.close(); }
    db = openMigratedLqDatabase({ databaseFilename: path.join(root, "lq.db"),
      backupDirectory: path.join(root, "backups"), migrationsFolder: path.resolve("db/migrations/lq") });
    expect(readEngineeringReadiness(db).sources.find(source => source.adapterCode === "tiquadri"))
      .toMatchObject({ installedVersion: "10", requiredVersion: TIQUADRI_ENGINEERING_ADAPTER.version, status: "engineering_data_stale" });
    oldProfiles = profiles(); oldDefinitions = definitions(); oldKeys = new Set(assetKeys());
    result = await importTiQuadri(options());
  }, 240_000);
  afterAll(() => { if (db) closeConfiguredDatabase(db); if (root) rmSync(root, { recursive: true, force: true }); });

  it("resolves HDX 108 Frontale × Zoccolo to every block 311–318", () => {
    const modelId = db.prepare("SELECT id FROM cat_config_model WHERE code='tq.pack.108'").pluck().get() as number;
    const model = getConfigurationModel(db, modelId);
    const front = model.axes.find(axis => axis.dimensionCode === "tq.label.1")!;
    const plinth = model.axes.find(axis => axis.dimensionCode === "tq.label.3")!;
    for (const [index, value] of [2,4,6,8].entries()) for (const [delta, value2] of [[0,22],[4,24]]) {
      const resolved = resolveConfiguration(db, { modelId, selectedOptionIds: [
        front.options.find(option => option.valueCode === `tq.value.${value}`)!.id,
        plinth.options.find(option => option.valueCode === `tq.value.${value2}`)!.id] });
      expect(resolved.status).toBe("complete");
      expect(resolved.physical?.code).toBe(`tq.armadi.pack.108.block.${311 + index + delta!}`);
    }
  });

  it("imports all 144 reported combinations, without losing or changing any existing profile identity", () => {
    const before = new Map(oldProfiles.map(row => [row.code, row]));
    const after = new Map(profiles().map(row => [row.code, row]));
    for (const [code, identity] of before) expect(after.get(code), String(code)).toEqual(identity);
    const additions = [...after.keys()].filter(code => !before.has(code)).sort();
    const expected = HDX.flatMap(([pack, block]) => [5,6,7].map(delta => `tq.armadi.pack.${pack}.block.${block + delta}`)).sort();
    expect(expected).toHaveLength(144); expect(additions).toEqual(expected);
    expect(definitions()).toEqual(oldDefinitions);
    for (const [pack, block] of HDX) {
      expect(db.prepare(`SELECT profile_key FROM cat_phys_profile
        WHERE code LIKE ? ORDER BY profile_key`).pluck().all(`tq.armadi.pack.${pack}.block.%`))
        .toEqual(Array.from({ length: 8 }, (_, i) => block + i));
      const modelId = db.prepare("SELECT id FROM cat_config_model WHERE code=?").pluck().get(`tq.pack.${pack}`) as number;
      const model = getConfigurationModel(db, modelId);
      for (const [delta, value] of [[5,4],[6,6],[7,8]]) {
        const resolved = resolveConfiguration(db, { modelId, selectedOptionIds: [
          model.axes.find(axis => axis.dimensionCode === "tq.label.1")!.options
            .find(option => option.valueCode === `tq.value.${value}`)!.id,
          model.axes.find(axis => axis.dimensionCode === "tq.label.3")!.options
            .find(option => option.valueCode === "tq.value.24")!.id] });
        expect(resolved.status, `tq.pack.${pack}:delta ${delta}`).toBe("complete");
        expect(resolved.physical?.code).toBe(`tq.armadi.pack.${pack}.block.${block + delta!}`);
      }
    }
    expect(result.summary.counts).toMatchObject({ combinedEnclosureVariants: 144 });
  });

  it("imports enclosure permissions and keeps locked and mixed device axes locked from all source contributions", () => {
    const reader = new MDBReader(readFileSync(sourcePath));
    const packs = reader.getTable("ANA_PACK").getData() as Record<string, unknown>[];
    const rows = reader.getTable("ANA_MODALITA").getData() as Record<string, unknown>[];
    const definitions = new Map<number, Record<string, unknown>[]>();
    for (const row of rows) { const id = Number(row.Id_Modalita), list = definitions.get(id) ?? []; list.push(row); definitions.set(id, list); }
    const imported = db.prepare(`SELECT m.code,m.model_kind,d.code AS dimension,a.editable_when_placed AS editable
      FROM cat_config_axis a JOIN cat_config_model m ON m.id=a.model_id JOIN cat_config_dimension d ON d.id=a.dimension_id`).all() as
      { code: string; model_kind: string; dimension: string; editable: number }[];
    let enclosures = 0, lockedDevices = 0, mixedDevices = 0, mixed = 0;
    const packMap = new Map(packs.map(pack => [`tq.pack.${pack.ID_Pack}`, pack]));
    for (const axis of imported) {
      const pack = packMap.get(axis.code)!;
      const label = Number(axis.dimension.split(".").at(-1));
      const flags = (definitions.get(Number(pack.Id_Modalita)) ?? []).flatMap(row => [1,2].flatMap(slot =>
        Number(row[`ID_Label_Modalita_${slot}`]) === label && Number(row[`ID_Valore_Modalita_${slot}`])
          ? [row[`Modalita_${slot}_Modificabile_Nel_Pannello`] === true] : []));
      expect(flags.length).toBeGreaterThan(0);
      expect(axis.editable, `${axis.code}:${axis.dimension}`).toBe(flags.every(Boolean) ? 1 : 0);
      if (axis.model_kind === "enclosure" && axis.editable) enclosures++;
      if (axis.model_kind === "device" && !axis.editable) lockedDevices++;
      if (flags.some(Boolean) && !flags.every(Boolean)) { mixed++; if (axis.model_kind === "device") mixedDevices++; }
    }
    expect(enclosures).toBeGreaterThan(0); expect(lockedDevices).toBeGreaterThan(0); expect(mixedDevices).toBeGreaterThan(0);
    expect((result.summary.conflicts as Record<string, number>).axis_editability).toBe(mixed);
    expect(db.prepare(`SELECT COUNT(*) FROM cat_source_conflict WHERE import_id=? AND topic='axis_editability'`)
      .pluck().get(result.importId)).toBe(mixed);
    expect(getConfigurationModel(db, db.prepare("SELECT id FROM cat_config_model WHERE code='tq.pack.108'").pluck().get() as number)
      .axes.every(axis => axis.editableWhenPlaced)).toBe(true);
  });

  it("restores readiness, preserves primary source counts and skips an identical reimport", async () => {
    expect(readEngineeringReadiness(db).sources.find(source => source.adapterCode === "tiquadri"))
      .toMatchObject({ status: "ready", installedVersion: TIQUADRI_ENGINEERING_ADAPTER.version, importFingerprint: result.fingerprint });
    expect(result.summary.errors).toEqual([]); expect(result.summary.discrepancies).toEqual([]);
    const before = profiles(), imported = await importTiQuadri(options());
    expect(imported).toMatchObject({ alreadyImported: true, importId: result.importId, fingerprint: result.fingerprint });
    expect(profiles()).toEqual(before); expect(db.pragma("quick_check")).toEqual([{ quick_check: "ok" }]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("reimports drawings and resolves every newly referenced key through the runtime asset reader", () => {
    const keys = assetKeys().filter(key => !oldKeys.has(key));
    // The 144 pack/block profiles share 24 distinct manufacturer drawing keys.
    expect(keys).toHaveLength(24);
    const assetsRoot = path.join(root, "assets");
    const imported = importTiQuadriDrawingAssets({ database: db, sourcePath: drawingPath, assetsRoot });
    expect(imported.alreadyImported).toBe(false);
    expect(imported).toMatchObject({ referenced: 4120, resolved: 4098 });
    expect(imported.missing).toHaveLength(21); expect(imported.invalid).toHaveLength(1);
    expect(keys.filter(key => imported.missing.includes(key) || imported.invalid.includes(key))).toEqual([]);
    expect(Object.keys(readFrontVectorAssets(db, assetsRoot, keys)).sort()).toEqual(keys.sort());
    expect(importTiQuadriDrawingAssets({ database: db, sourcePath: drawingPath, assetsRoot }))
      .toMatchObject({ alreadyImported: true, referenced: 4120, resolved: 4098 });
  }, 120_000);
});
