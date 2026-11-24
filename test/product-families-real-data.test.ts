import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getConditionallyAvailableFamilyValues,
  resolveFamilySelection,
  validateFamily,
} from "../src/main/catalogue/family-queries.js";
import { groupProductFamilies } from "../src/main/catalogue/family-grouping.js";
import { FAMILY_GROUPERS } from "../src/main/catalogue/groupers/index.js";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { openMigratedRawDatabase } from "../src/main/database/raw-migrations.js";
import { closeConfiguredDatabase } from "../src/main/database/sqlite-connection.js";
import { normalizeMetelDelivery } from "../src/main/metel/catalogue-normalization.js";
import { ingestMetelFileFromPath } from "../src/main/metel/raw-ingestion.js";

const sampleRoot = process.env["LIBREQUADRI_METEL_DIR"] ?? "";
const file = (name: string) => path.join(sampleRoot, name, name);
const dataSets = [
  { issuer: "BTI", LSP: file("BTILSP021.txt"), FSC: file("BTIFSC.txt"), FST: file("BTIFST.txt") },
  { issuer: "SIE", LSP: file("SIELSP_20260701.txt"), FSC: file("SIEFSC.TXT"), FST: file("SIEFST.TXT") },
  { issuer: "SNR", LSP: file("SNRLSP021.txt"), FSC: file("SNRFSC.txt"), FST: file("SNRFST.txt") },
];
const availableSets = dataSets.filter(set => [set.LSP, set.FSC, set.FST].every(existsSync));
const available = availableSets.some(set => set.issuer === "BTI");
const expectedCounts = {
  btdin45: 42,
  btdin45_1pn_881: 25,
  btdin60: 129,
  btdin60_1pn_881: 12,
  btdin100: 129,
  btdin160: 79,
  btdin250: 59,
  btdin500: 26,
  btdin_rs: 12,
  btdin_rs_1pn_881: 7,
};

describe.runIf(available)("Step 6A real BTI family acceptance", () => {
  let root: string;
  let lq: Database.Database;
  let raw: Database.Database;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "librequadri-families-real-"));
    raw = openMigratedRawDatabase({ databaseFilename: path.join(root, "raw.db"), migrationsFolder: path.resolve("db/migrations/raw") });
    lq = openMigratedLqDatabase({ databaseFilename: path.join(root, "lq.db"), backupDirectory: path.join(root, "backups"),
      migrationsFolder: path.resolve("db/migrations/lq") });
    const hash = (sourcePath: string) => ingestMetelFileFromPath({ database: raw, sourcePath }).fileSha256;
    for (const [index, set] of availableSets.entries()) {
      normalizeMetelDelivery({ lqDatabase: lq, rawDatabase: raw,
        sources: { LSP: hash(set.LSP), FSC: hash(set.FSC), FST: hash(set.FST) },
        normalizedAt: new Date(`2026-09-22T0${index}:00:00Z`) });
    }
  }, 180_000);

  afterAll(() => {
    closeConfiguredDatabase(lq);
    closeConfiguredDatabase(raw);
    rmSync(root, { recursive: true, force: true });
  });

  it("assigns exactly the verified 520 products to the ten families", () => {
    const counts = Object.fromEntries((lq.prepare(`
      SELECT f.code, COUNT(*) AS count FROM cat_product_family_assignment fa
      JOIN cat_product_family f ON f.id = fa.family_id
      WHERE fa.state = 'grouper' GROUP BY f.code ORDER BY f.code
    `).all() as Array<{ code: string; count: number }>).map(row => [row.code, row.count]));
    expect(counts).toEqual(expectedCounts);
    expect(Object.values(counts).reduce((sum, count) => sum + count, 0)).toBe(520);
    expect(lq.prepare(`SELECT COUNT(*) FROM cat_product_family_assignment fa JOIN cat_product p ON p.id = fa.product_id
      JOIN cat_brand b ON b.id = p.brand_id WHERE b.metel_marchio <> 'BTI'`).pluck().get()).toBe(0);
    expect(lq.prepare(`SELECT COUNT(*) FROM cat_product_family_assignment WHERE state = 'grouper' AND product_id IN (
      SELECT pa.product_id FROM cat_product_attribute pa JOIN cat_family_variant_axis va ON va.attribute_id = pa.attribute_id
      WHERE va.family_id = cat_product_family_assignment.family_id GROUP BY pa.product_id HAVING COUNT(*) = 3
    )`).pluck().get()).toBe(520);
  });

  it("leaves exactly the 20 magnetic-only and 14 DC category products unassigned", () => {
    const codes = lq.prepare(`
      SELECT p.manufacturer_code AS code FROM cat_product p
      JOIN cat_brand b ON b.id = p.brand_id JOIN cat_category c ON c.id = p.category_id
      LEFT JOIN cat_product_family_assignment fa ON fa.product_id = p.id
      WHERE b.metel_marchio = 'BTI' AND c.code = 'protezione.interruttori_automatici'
        AND fa.product_id IS NULL ORDER BY p.manufacturer_code
    `).pluck().all() as string[];
    expect(codes).toHaveLength(34);
    expect(codes.filter(code => /^FV8[23]SM/.test(code))).toHaveLength(20);
    expect(codes.filter(code => /^F82N\d+FV[12]$/.test(code))).toHaveLength(14);
  });

  it("has complete unique tuples and idempotent automatic regrouping", () => {
    for (const code of Object.keys(expectedCounts)) {
      expect(validateFamily(lq, "BTI", code), code).toEqual([]);
    }
    expect(groupProductFamilies(lq, FAMILY_GROUPERS)).toEqual({ inserted: 0, updated: 0, removed: 0, rejected: 0, protected: 0 });
    expect(groupProductFamilies(lq, FAMILY_GROUPERS)).toEqual({ inserted: 0, updated: 0, removed: 0, rejected: 0, protected: 0 });
  });

  it("matches every member against its approved code structure and breaking capacity", () => {
    const contracts: Record<string, { pattern: RegExp; capacity: number }> = {
      btdin45: { pattern: /^FA(?:81N?|8[234])[BCD]\d{1,3}$/, capacity: 4.5 },
      btdin45_1pn_881: { pattern: /^FA881[BCD]\d{1,3}$/, capacity: 4.5 },
      btdin60: { pattern: /^FN(?:81N?|8[234])[BCD]\d{1,3}$/, capacity: 6 },
      btdin60_1pn_881: { pattern: /^FN881[BCD]\d{1,3}$/, capacity: 6 },
      btdin100: { pattern: /^FH(?:81N|8[1-4])[BCDKZ]\d{1,3}$/, capacity: 10 },
      btdin160: { pattern: /^FT(?:81N|8[1-4])[CD]\d{1,3}$/, capacity: 16 },
      btdin250: { pattern: /^FV8[1-4][CD]\d{1,3}$/, capacity: 25 },
      btdin500: { pattern: /^FX8[1-4]C\d{1,3}$/, capacity: 50 },
      btdin_rs: { pattern: /^FC(?:810N|820)C\d{1,3}$/, capacity: 4.5 },
      btdin_rs_1pn_881: { pattern: /^FC881C\d{1,3}$/, capacity: 4.5 },
    };
    const rows = lq.prepare(`
      SELECT f.code AS familyCode, p.manufacturer_code AS productCode, pa.value_num AS capacity
      FROM cat_product_family_assignment fa
      JOIN cat_product_family f ON f.id = fa.family_id
      JOIN cat_product p ON p.id = fa.product_id
      JOIN cat_product_attribute pa ON pa.product_id = p.id
      JOIN cat_attribute a ON a.id = pa.attribute_id AND a.code = 'declared_breaking_capacity'
      WHERE fa.state = 'grouper'
    `).all() as Array<{ familyCode: string; productCode: string; capacity: number }>;
    expect(rows).toHaveLength(520);
    for (const row of rows) {
      expect(row.productCode, row.familyCode).toMatch(contracts[row.familyCode]!.pattern);
      expect(row.capacity, row.productCode).toBe(contracts[row.familyCode]!.capacity);
    }
  });

  it("leaves ARC and every available SIE/SNR product outside Step 6A", () => {
    expect(lq.prepare(`SELECT COUNT(*) FROM cat_product_family_assignment fa
      JOIN cat_product p ON p.id = fa.product_id JOIN cat_category c ON c.id = p.category_id
      WHERE c.code = 'protezione.rilevatori_arco'`).pluck().get()).toBe(0);
    for (const issuer of ["SIE", "SNR"]) {
      if (!availableSets.some(set => set.issuer === issuer)) continue;
      expect(lq.prepare(`SELECT COUNT(*) FROM cat_product_family_assignment fa
        JOIN cat_product p ON p.id = fa.product_id
        JOIN cat_metel_issuer i ON i.id = p.governing_issuer_id
        WHERE i.metel_sigla = ?`).pluck().get(issuer), issuer).toBe(0);
    }
  });

  it("resolves the confirmed tuples and preserves the sparse grid", () => {
    const resolved = (familyCode: string, poles: string, tripCurve: string, ratedCurrent: number) =>
      resolveFamilySelection(lq, "BTI", familyCode, { poles, trip_curve: tripCurve, rated_current: ratedCurrent });
    expect(resolved("btdin60", "1p", "b", 16)).toMatchObject({ status: "resolved", manufacturerCode: "FN81B16" });
    expect(resolved("btdin100", "2p", "k", 8)).toMatchObject({ status: "resolved", manufacturerCode: "FH82K8" });
    expect(resolved("btdin45", "1p_n", "c", 10)).toMatchObject({ status: "resolved", manufacturerCode: "FA81NC10" });
    expect(resolved("btdin45_1pn_881", "1p_n", "c", 10)).toMatchObject({ status: "resolved", manufacturerCode: "FA881C10" });
    expect(resolved("btdin500", "3p", "c", 10)).toEqual({ status: "not_offered" });
    const currents = getConditionallyAvailableFamilyValues(lq, "BTI", "btdin500", "rated_current", { poles: "3p", trip_curve: "c" });
    expect(currents.map(value => value.value)).not.toContain(10);
    expect(currents.length).toBeGreaterThan(0);
  });
});
