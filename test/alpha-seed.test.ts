import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { ALPHA_COUNTS, createAlphaSnapshot, provisionAlphaSeed, validateAlphaSeed } from "../src/main/alpha/seed.js";
import { readEngineeringReadiness } from "../src/main/catalogue/engineering-readiness.js";
import { TIQUADRI_ENGINEERING_ADAPTER } from "../src/main/sources/tiquadri/adapter.js";

// Positive Alpha preparation/provisioning tests belong to frozen revision dbc7243. Current code
// must reject that historical catalogue under the current adapter, without a test mock.
const historical = process.env.LIBREQUADRI_ALPHA_FROZEN_DB;
const current = process.env.LIBREQUADRI_REV83_REAL_DB;
const migrations = path.resolve("db/migrations/lq");
const roots: string[] = [];
const temporary = () => { const root = mkdtempSync(path.join(tmpdir(), "librequadri-alpha-boundary-")); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("frozen Alpha 0 build boundary under current code", () => {
  it("keeps the historical inventory and current adapter authority separate", () => {
    expect(TIQUADRI_ENGINEERING_ADAPTER.version).toBe("14");
    expect(ALPHA_COUNTS).toEqual({ products: 122535, brands: 9, models: 10800,
      activeModels: 7823, obsoleteModels: 2977, drawingKeys: 4096, resolvedDrawings: 4074 });
  });

  it.runIf(!!historical && existsSync(historical))("refuses historical adapter 10 in current preparation without publishing a seed", async () => {
    const db = new Database(historical!, { readonly: true });
    try { expect(readEngineeringReadiness(db).sources.find(source => source.adapterCode === "tiquadri"))
      .toMatchObject({ installedVersion: "10", requiredVersion: TIQUADRI_ENGINEERING_ADAPTER.version, status: "engineering_data_stale" }); }
    finally { db.close(); }
    const seed = path.join(temporary(), "seed");
    await expect(createAlphaSnapshot(path.dirname(path.dirname(historical!)), seed, migrations))
      .rejects.toThrow("Alpha engineering source is missing or stale");
    expect(existsSync(seed)).toBe(false);
  });

  it.runIf(!!current && existsSync(current))("refuses the current inventory instead of expanding frozen Alpha counts", async () => {
    const db = new Database(current!, { readonly: true });
    try { expect(readEngineeringReadiness(db).sources.find(source => source.adapterCode === "tiquadri"))
      .toMatchObject({ installedVersion: TIQUADRI_ENGINEERING_ADAPTER.version, status: "ready" }); }
    finally { db.close(); }
    const seed = path.join(temporary(), "seed");
    await expect(createAlphaSnapshot(path.dirname(path.dirname(current!)), seed, migrations))
      .rejects.toThrow("Alpha models: expected 10800, got ");
    expect(existsSync(seed)).toBe(false);
  });

  it("retains fail-closed seed validation and leaves an existing installation alone", () => {
    const root = temporary();
    expect(() => validateAlphaSeed(path.join(root, "missing"), migrations)).toThrow();
    const installed = path.join(root, "existing"); mkdirSync(path.join(installed, "data"), { recursive: true });
    const filename = path.join(installed, "data/lq.db"); writeFileSync(filename, "retained");
    expect(provisionAlphaSeed(path.join(root, "missing"), installed, migrations)).toBe("existing");
  });
});
