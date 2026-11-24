import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { ALPHA1_NAME, ALPHA1_VERSION, ALPHA11_NAME, ALPHA11_VERSION, BETA1_VERSION,
  isAlpha0Build, isAlpha1Build, isAlpha11Build, isBeta1Build } from "../src/main/alpha/identity.js";
import { ALPHA1_PROFILE, ALPHA11_PROFILE, BETA1_PROFILE, ALPHA_COUNTS, createAlphaSnapshot, provisionAlphaSeed, validateAlphaSeed } from "../src/main/alpha/seed.js";
import { readEngineeringReadiness } from "../src/main/catalogue/engineering-readiness.js";

const migrations = path.resolve("db/migrations/lq");
const dataRoot = process.env.LIBREQUADRI_ALPHA1_DATA_ROOT;

describe("Alpha 1 release boundary", () => {
  it("selects Alpha 1 only for the matching packaged version", () => {
    expect(ALPHA1_NAME).toBe("LibreQuadri Alpha 1");
    expect(isAlpha1Build(true, ALPHA1_VERSION)).toBe(true);
    expect(isAlpha1Build(false, ALPHA1_VERSION)).toBe(false);
    expect(isAlpha1Build(true, "0.1.0-alpha.0")).toBe(false);
    expect(isAlpha0Build(true, ALPHA1_VERSION)).toBe(false);
    expect(ALPHA_COUNTS.drawingKeys).toBe(4096);
    expect(ALPHA1_PROFILE.counts.drawingKeys).toBe(4120);
  });

  it("isolates Alpha 1.1 from previous releases and development", () => {
    expect(ALPHA11_NAME).toBe("LibreQuadri Alpha 1.1");
    expect(isAlpha11Build(true, ALPHA11_VERSION)).toBe(true);
    expect(isAlpha11Build(false, ALPHA11_VERSION)).toBe(false);
    expect(isAlpha11Build(true, ALPHA1_VERSION)).toBe(false);
    expect(isAlpha1Build(true, ALPHA11_VERSION)).toBe(false);
    expect(isAlpha0Build(true, ALPHA11_VERSION)).toBe(false);
    expect(ALPHA11_PROFILE.version).toBe(ALPHA11_VERSION);
    expect(ALPHA11_PROFILE.counts).toEqual(ALPHA1_PROFILE.counts);
  });

  it("selects Beta 1.0 only for its matching packaged version", () => {
    expect(isBeta1Build(true, BETA1_VERSION)).toBe(true);
    expect(isBeta1Build(false, BETA1_VERSION)).toBe(false);
    expect(isBeta1Build(true, ALPHA11_VERSION)).toBe(false);
    expect(isAlpha11Build(true, BETA1_VERSION)).toBe(false);
  });

  for (const profile of [ALPHA1_PROFILE, ALPHA11_PROFILE, BETA1_PROFILE]) {
  const source = profile.version === BETA1_VERSION ? process.env.LIBREQUADRI_BETA1_DATA_ROOT : dataRoot;
  it.runIf(!!source)(`validates and provisions ${profile.version}, rejects tampering, and preserves relaunch data`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), "librequadri-alpha1-acceptance-"));
    try {
      const seed = path.join(root,"seed");
      const installed = path.join(root,"installed");
      const manifest = await createAlphaSnapshot(source!,seed,migrations,profile);
      expect(manifest.version).toBe(profile.version);
      expect(manifest.counts).toEqual(profile.counts);
      expect(() => validateAlphaSeed(seed,migrations)).toThrow("Not a 0.1.0-alpha.0 seed");
      const extra = path.join(seed,"unexpected.txt");
      writeFileSync(extra,"unexpected");
      expect(() => validateAlphaSeed(seed,migrations,profile)).toThrow("Unexpected Alpha seed file");
      rmSync(extra);
      const filename = path.join(seed,"data/lq.db");
      const bytes = readFileSync(filename);
      writeFileSync(filename,Buffer.concat([bytes,Buffer.from("tampered")]));
      expect(() => validateAlphaSeed(seed,migrations,profile)).toThrow("SHA-256 mismatch");
      writeFileSync(filename,bytes);
      expect(provisionAlphaSeed(seed,installed,migrations,profile)).toBe("installed");
      const db = new Database(path.join(installed,"data/lq.db"));
      try {
        expect(db.pragma("quick_check",{simple:true})).toBe("ok");
        expect(readEngineeringReadiness(db).sources.every(source => source.status === "ready")).toBe(true);
        if (profile.version === BETA1_VERSION) {
          expect(db.prepare("SELECT count(*) FROM app_recent_file").pluck().get()).toBe(0);
          const original = new Database(path.join(source!, "data/lq.db"), { readonly: true });
          try {
            expect(db.prepare("SELECT key,value FROM app_setting WHERE key LIKE 'ui.%' ORDER BY key").all())
              .toEqual(original.prepare("SELECT key,value FROM app_setting WHERE key LIKE 'ui.%' ORDER BY key").all());
          } finally { original.close(); }
          db.prepare("INSERT OR REPLACE INTO app_setting(key,value) VALUES ('ui.zoom_level','1'),('ui.theme','dark')").run();
        }
        db.prepare("INSERT OR REPLACE INTO app_setting (key,value) VALUES ('alpha1-test','retained')").run();
      } finally { db.close(); }
      expect(provisionAlphaSeed("/missing-seed",installed,migrations,profile)).toBe("existing");
      const reopened = new Database(path.join(installed,"data/lq.db"),{readonly:true});
      try {
        expect(reopened.prepare("SELECT value FROM app_setting WHERE key='alpha1-test'").pluck().get()).toBe("retained");
        if (profile.version === BETA1_VERSION) {
          expect(reopened.prepare("SELECT value FROM app_setting WHERE key='ui.zoom_level'").pluck().get()).toBe("1");
          expect(reopened.prepare("SELECT value FROM app_setting WHERE key='ui.theme'").pluck().get()).toBe("dark");
        }
      }
      finally { reopened.close(); }
      const partial = path.join(root,"partial");
      mkdirSync(path.join(partial,"assets"),{recursive:true});
      expect(() => provisionAlphaSeed(seed,partial,migrations,profile)).toThrow("partial installation");
      expect(existsSync(path.join(partial,"data/lq.db"))).toBe(false);
    } finally { rmSync(root,{recursive:true,force:true}); }
  },120000);
  }
});
