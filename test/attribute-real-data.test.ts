import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { enrichProductAttributes } from "../src/main/catalogue/attribute-enrichment.js";
import { synchronizeAttributeSeed } from "../src/main/catalogue/attribute-seed.js";
import { getAttributeFilterOptions, searchCatalogue } from "../src/main/catalogue/catalogue-queries.js";
import { btiDescriptionParser } from "../src/main/catalogue/parsers/bti-description.js";
import { loadCategorySeed } from "../src/main/catalogue/category-seed.js";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { openMigratedRawDatabase } from "../src/main/database/raw-migrations.js";
import { closeConfiguredDatabase } from "../src/main/database/sqlite-connection.js";
import { normalizeMetelDelivery } from "../src/main/metel/catalogue-normalization.js";
import { ingestMetelFileFromPath } from "../src/main/metel/raw-ingestion.js";
import type { CatalogueAttributeFilter } from "../src/shared/catalogue.js";

// Keep the original BTI acceptance inventory isolated; Siemens has its own full-delivery suite.
const BTI_PARSERS = new Map([["BTI", btiDescriptionParser]]);
const categorySeed = { ...loadCategorySeed(), mappings: loadCategorySeed().mappings.filter(m => m.brandMarchio === "BTI") };

const sampleRoot = process.env["LIBREQUADRI_METEL_DIR"] ?? "";
const file = (name: string) => path.join(sampleRoot, name, name);
const sets = [
  { LSP: file("BTILSP021.txt"), FSC: file("BTIFSC.txt"), FST: file("BTIFST.txt") },
  { LSP: file("SIELSP_20260701.txt"), FSC: file("SIEFSC.TXT"), FST: file("SIEFST.TXT") },
  { LSP: file("SNRLSP021.txt"), FSC: file("SNRFSC.txt"), FST: file("SNRFST.txt") },
];
const available = sets.every(set => Object.values(set).every(existsSync));

const IA = "protezione.interruttori_automatici";
const MTD = "protezione.magnetotermici_differenziali";
const DP = "protezione.differenziali_puri";
const BD = "protezione.blocchi_differenziali";
const ARC = "protezione.rilevatori_arco";

describe.runIf(available)("real BTI attribute enrichment and filtering", () => {
  let root: string;
  let lq: Database.Database;
  let raw: Database.Database;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "librequadri-attributes-real-"));
    raw = openMigratedRawDatabase({ databaseFilename: path.join(root, "raw.db"), migrationsFolder: path.resolve("db/migrations/raw") });
    lq = openMigratedLqDatabase({ databaseFilename: path.join(root, "lq.db"), backupDirectory: path.join(root, "backups"),
      migrationsFolder: path.resolve("db/migrations/lq") });
    for (const [index, set] of sets.entries()) {
      const hash = (sourcePath: string) => ingestMetelFileFromPath({ database: raw, sourcePath }).fileSha256;
      normalizeMetelDelivery({ lqDatabase: lq, rawDatabase: raw, sources: { LSP: hash(set.LSP), FSC: hash(set.FSC), FST: hash(set.FST) },
        categorySeed, attributeParsers: BTI_PARSERS, normalizedAt: new Date(`2026-09-21T0${index}:00:00Z`) });
    }
  }, 180_000);
  afterAll(() => {
    closeConfiguredDatabase(lq);
    closeConfiguredDatabase(raw);
    rmSync(root, { recursive: true, force: true });
  });

  const counts = () => lq.prepare(`
    SELECT a.code AS attribute, c.code AS category, COUNT(*) AS count
    FROM cat_product_attribute pa JOIN cat_attribute a ON a.id = pa.attribute_id
    JOIN cat_product p ON p.id = pa.product_id JOIN cat_category c ON c.id = p.category_id
    WHERE pa.source = 'parser' GROUP BY a.code, c.code ORDER BY a.code, c.code
  `).all() as Array<{ attribute: string; category: string; count: number }>;
  const total = () => lq.prepare("SELECT COUNT(*) FROM cat_product_attribute").pluck().get();
  const dump = () => lq.prepare("SELECT * FROM cat_product_attribute ORDER BY product_id, attribute_id").all();
  const values = (code: string) => Object.fromEntries((lq.prepare(`
    SELECT a.code, COALESCE(o.value, pa.value_num) AS value FROM cat_product_attribute pa
    JOIN cat_attribute a ON a.id = pa.attribute_id LEFT JOIN cat_attribute_option o ON o.id = pa.option_id
    JOIN cat_product p ON p.id = pa.product_id JOIN cat_brand b ON b.id = p.brand_id
    WHERE b.metel_marchio = 'BTI' AND p.manufacturer_code = ?
  `).all(code) as Array<{ code: string; value: string | number }>).map(row => [row.code, row.value]));
  const filter = (categoryCode: string, attributeFilters: CatalogueAttributeFilter[]) => {
    const codes: string[] = [];
    for (let offset = 0; ; offset += 200) {
      const page = searchCatalogue(lq, { query: "", categoryCode, attributeFilters, listedOnly: true, limit: 200, offset });
      codes.push(...page.products.map(p => p.manufacturerCode));
      if (!page.hasMore) return codes;
    }
  };

  it("stores exactly the approved parser-owned values per attribute and category", () => {
    const short = (code: string) => ({ [IA]: "IA", [MTD]: "MTD", [DP]: "DP", [BD]: "BD", [ARC]: "ARC" })[code];
    expect(Object.fromEntries(counts().map(r => [`${r.attribute} ${short(r.category)}`, r.count]))).toEqual({
      "poles IA": 554, "poles MTD": 136, "poles DP": 107, "poles BD": 71, "poles ARC": 4,
      "rated_current IA": 534, "rated_current MTD": 128, "rated_current DP": 107, "rated_current BD": 71, "rated_current ARC": 4,
      "trip_curve IA": 520, "trip_curve ARC": 4,
      "declared_breaking_capacity IA": 540, "declared_breaking_capacity MTD": 136, "declared_breaking_capacity ARC": 4,
      "rated_residual_current MTD": 136, "rated_residual_current DP": 107, "rated_residual_current BD": 63, "rated_residual_current ARC": 2,
      "residual_current_type MTD": 127, "residual_current_type DP": 107, "residual_current_type BD": 67, "residual_current_type ARC": 2,
    });
    expect(total()).toBe(3531);
    expect(lq.prepare("SELECT COUNT(*) FROM cat_product_attribute WHERE source <> 'parser'").pluck().get()).toBe(0);
    expect(lq.prepare(`SELECT COUNT(*) FROM cat_product_attribute pa JOIN cat_product p ON p.id = pa.product_id
      JOIN cat_brand b ON b.id = p.brand_id WHERE b.metel_marchio <> 'BTI' OR p.category_id IS NULL`).pluck().get()).toBe(0);
    expect(lq.prepare(`SELECT o.value, COUNT(*) AS n FROM cat_product_attribute pa JOIN cat_attribute_option o ON o.id = pa.option_id
      JOIN cat_attribute a ON a.id = pa.attribute_id WHERE a.code = 'residual_current_type' GROUP BY o.value ORDER BY o.value`).all())
      .toEqual([{ value: "a", n: 135 }, { value: "ac", n: 117 }, { value: "b", n: 8 }, { value: "f", n: 43 }]);
    // Every persisted value is valid for its attribute and category.
    expect(lq.prepare(`SELECT COUNT(*) FROM cat_product_attribute pa JOIN cat_attribute a ON a.id = pa.attribute_id
      JOIN cat_product p ON p.id = pa.product_id
      LEFT JOIN cat_category_attribute ca ON ca.category_id = p.category_id AND ca.attribute_id = pa.attribute_id
      LEFT JOIN cat_attribute_option o ON o.id = pa.option_id
      WHERE ca.attribute_id IS NULL OR (a.data_type = 'enum') <> (o.attribute_id = pa.attribute_id AND o.active = 1)
        OR (a.data_type = 'number') <> (pa.value_num > 0)`).pluck().get()).toBe(0);
  });

  it("finds no ambiguous or invalid proposals on the classified BTI products", () => {
    const stats = lq.transaction(() => {
      lq.exec("DELETE FROM cat_product_attribute");
      return enrichProductAttributes(lq, BTI_PARSERS);
    })();
    expect(stats).toEqual({ inserted: 3531, updated: 0, deleted: 0, ambiguous: {}, invalid: 0 });
  });

  it("matches the investigated spot checks", () => {
    expect(values("FN81B16")).toEqual({ poles: "1p", trip_curve: "b", rated_current: 16, declared_breaking_capacity: 6 });
    expect(values("FA881B05")).toEqual({ poles: "1p_n", trip_curve: "b", rated_current: 0.5, declared_breaking_capacity: 4.5 });
    expect(values("FH84K1")).toEqual({ poles: "4p", trip_curve: "k", rated_current: 1, declared_breaking_capacity: 10 });
    expect(values("FV82SM125")).toEqual({ poles: "2p", declared_breaking_capacity: 25 });
    expect(values("F82N06FV1")).toEqual({ poles: "2p", rated_current: 6 });
    expect(values("GC8813AC10")).toEqual({ poles: "1p_n", rated_current: 10, declared_breaking_capacity: 4.5,
      rated_residual_current: 30, residual_current_type: "ac" });
    expect(values("GN8813F16")).toEqual({ poles: "1p_n", declared_breaking_capacity: 6, rated_residual_current: 30, residual_current_type: "f" });
    expect(values("GN823AC10")).toEqual({ poles: "2p", rated_current: 10, declared_breaking_capacity: 6, rated_residual_current: 30 });
    expect(values("G724AS25")).toEqual({ poles: "2p", rated_current: 25, rated_residual_current: 300, residual_current_type: "a" });
    expect(values("G744A25")).toMatchObject({ rated_residual_current: 300 });
    expect(values("GC723AC25")).toMatchObject({ rated_residual_current: 30 });
    expect(values("G24XAC63")).toMatchObject({ rated_current: 63 });
    expect(values("G27XF63")).toEqual({ poles: "2p", rated_current: 63, residual_current_type: "f" });
    expect(values("G47XCM63")).toEqual({ poles: "4p", rated_current: 63 });
    expect(values("FC881C10ARC")).toEqual({ poles: "1p_n", trip_curve: "c", rated_current: 10, declared_breaking_capacity: 4.5 });
    expect(values("GC8813AC10ARC")).toMatchObject({ rated_residual_current: 30, residual_current_type: "ac" });
    const curveB = lq.prepare(`SELECT p.id FROM cat_product p JOIN cat_category c ON c.id = p.category_id
      JOIN cat_product_attribute pa ON pa.product_id = p.id JOIN cat_attribute a ON a.id = pa.attribute_id
      JOIN cat_attribute_option o ON o.id = pa.option_id WHERE c.code = ? AND a.code = 'trip_curve' AND o.value = 'b'`).pluck().all(IA);
    expect(curveB).toHaveLength(50);
    expect(lq.prepare(`SELECT COUNT(*) FROM cat_product_attribute pa JOIN cat_attribute a ON a.id = pa.attribute_id
      WHERE a.code = 'residual_current_type' AND pa.product_id IN (SELECT value FROM json_each(?))`).pluck().get(JSON.stringify(curveB))).toBe(0);
  });

  it("filters with OR within an attribute and AND across attributes, deterministically", () => {
    expect(filter(IA, [{ attributeCode: "poles", values: ["2p"] }])).toHaveLength(158);
    expect(filter(IA, [{ attributeCode: "poles", values: ["1p_n", "2p"] }])).toHaveLength(249);
    expect(filter(IA, [{ attributeCode: "trip_curve", values: ["c"] }, { attributeCode: "rated_current", values: [16] }])).toHaveLength(31);
    expect(filter(IA, [{ attributeCode: "poles", values: ["2p"] }, { attributeCode: "trip_curve", values: ["c"] },
      { attributeCode: "rated_current", values: [16] }, { attributeCode: "declared_breaking_capacity", values: [6] }])).toEqual(["FN82C16"]);
    expect(filter(IA, [{ attributeCode: "poles", values: ["1p"] }, { attributeCode: "trip_curve", values: ["b"] },
      { attributeCode: "rated_current", values: [16] }, { attributeCode: "declared_breaking_capacity", values: [6] }])).toEqual(["FN81B16"]);
    expect(filter(IA, [{ attributeCode: "trip_curve", values: ["k", "z"] }])).toHaveLength(48);
    expect(filter(DP, [{ attributeCode: "poles", values: ["4p"] }, { attributeCode: "residual_current_type", values: ["a"] },
      { attributeCode: "rated_residual_current", values: [30] }])).toEqual(["G743A25", "G743A40", "G743A63"]);
    expect(filter(MTD, [{ attributeCode: "residual_current_type", values: ["f"] }])).toHaveLength(13);
    expect(filter(DP, [{ attributeCode: "residual_current_type", values: ["b"] }]).sort()).toEqual(
      ["G723B40", "G723B63", "G724B40", "G724B63", "G743B40", "G743B63", "G744B40", "G744B63"]);
    expect(filter(IA, [{ attributeCode: "declared_breaking_capacity", values: [16, 25] }])).toHaveLength(158);
    expect(filter(IA, [])).toHaveLength(554);
    expect(filter("protezione", [{ attributeCode: "poles", values: ["2p"] }])).toHaveLength(259);
    const once = filter(IA, [{ attributeCode: "poles", values: ["1p_n", "2p"] }]);
    expect(filter(IA, [{ attributeCode: "poles", values: ["2p", "1p_n"] }])).toEqual(once);
  });

  it("lists applicable attributes and their present values per category", () => {
    const mtd = getAttributeFilterOptions(lq, { categoryCode: MTD, listedOnly: true });
    expect(mtd.attributes.map(a => a.code)).toEqual(["poles", "rated_current", "declared_breaking_capacity",
      "rated_residual_current", "residual_current_type"]);
    expect(mtd.attributes.find(a => a.code === "residual_current_type")!.values).toEqual([
      { value: "ac", label: "AC", count: 60, selected: false }, { value: "a", label: "A", count: 54, selected: false },
      { value: "f", label: "F", count: 13, selected: false }]);
    const ia = getAttributeFilterOptions(lq, { categoryCode: IA, listedOnly: true });
    expect(ia.attributes.map(a => a.code)).toEqual(["poles", "rated_current", "trip_curve", "declared_breaking_capacity"]);
    expect(ia.attributes.find(a => a.code === "declared_breaking_capacity")!.values.map(v => v.value)).toEqual([4.5, 6, 10, 16, 25, 50]);
  });

  it("computes disjunctive facet counts consistent with search on the real catalogue", () => {
    const facets = (categoryCode: string, request: { query?: string; attributeFilters?: CatalogueAttributeFilter[] }) => {
      const options = getAttributeFilterOptions(lq, { categoryCode, listedOnly: true, ...request });
      // Every count equals the result count of the search with that value as its attribute's only selection.
      const others = (code: string) => (request.attributeFilters ?? []).filter(f => f.attributeCode !== code);
      const matching = (filters: CatalogueAttributeFilter[]) => {
        let count = 0;
        for (let offset = 0; ; offset += 200) {
          const page = searchCatalogue(lq, { query: request.query ?? "", categoryCode, attributeFilters: filters, listedOnly: true, limit: 200, offset });
          count += page.products.length;
          if (!page.hasMore) return count;
        }
      };
      expect(options.totalCount).toBe(matching(request.attributeFilters ?? []));
      for (const attribute of options.attributes) {
        for (const value of attribute.values) {
          expect(value.count, `${attribute.code}=${value.value}`)
            .toBe(matching([...others(attribute.code), { attributeCode: attribute.code, values: [value.value] }]));
        }
      }
      return { total: options.totalCount, ...Object.fromEntries(options.attributes.map(a =>
        [a.code, Object.fromEntries(a.values.map(v => [String(v.value), v.selected ? `${v.count}*` : v.count]))])) };
    };
    const f = (attributeCode: string, ...values: Array<string | number>) => ({ attributeCode, values });

    const none = facets(IA, {});
    expect(none).toMatchObject({ total: 554, poles: { "1p": 87, "1p_n": 91, "2p": 158, "3p": 94, "4p": 124 },
      trip_curve: { b: 50, c: 314, d: 108, k: 24, z: 24 } });
    const twoPoles = facets(IA, { attributeFilters: [f("poles", "2p")] });
    expect(twoPoles).toMatchObject({ total: 158, poles: { "1p": 87, "1p_n": 91, "2p": "158*", "3p": 94, "4p": 124 },
      trip_curve: { b: 9, c: 70, d: 31, k: 12, z: 12 } });
    expect(facets(IA, { attributeFilters: [f("poles", "2p"), f("trip_curve", "c")] })).toMatchObject({ total: 70,
      poles: { "1p": 60, "1p_n": 74, "2p": "70*", "3p": 54, "4p": 56 }, trip_curve: { b: 9, c: "70*", d: 31, k: 12, z: 12 } });
    const exact = facets(IA, { attributeFilters: [f("poles", "2p"), f("trip_curve", "c"), f("rated_current", 16), f("declared_breaking_capacity", 6)] });
    expect(exact).toMatchObject({ total: 1, poles: { "1p_n": 2, "2p": "1*" }, rated_current: { 16: "1*", 8: 0 },
      trip_curve: { c: "1*", k: 0 }, declared_breaking_capacity: { 4.5: 2, 6: "1*" } });
    expect(facets(IA, { attributeFilters: [f("poles", "1p_n", "2p")] })).toMatchObject({ total: 249,
      poles: { "1p_n": "91*", "2p": "158*" }, trip_curve: { b: 26, c: 144, d: 31, k: 12, z: 12 } });
    // Removing selections restores the earlier counts.
    expect(facets(IA, { attributeFilters: [f("trip_curve", "c"), f("rated_current", 16)] })).toMatchObject({ total: 31,
      poles: { "1p": 6, "1p_n": 8, "2p": 7, "3p": 5, "4p": 5 } });
    expect(facets(IA, {})).toEqual(none);
    expect(facets(IA, { query: "btdin60", attributeFilters: [f("poles", "2p")] })).toMatchObject({ total: 32,
      trip_curve: { b: 9, c: 14, d: 9, k: 0, z: 0 }, declared_breaking_capacity: { 4.5: 0, 6: 32, 10: 0 } });
    expect(facets(DP, { attributeFilters: [f("poles", "4p"), f("residual_current_type", "a"), f("rated_residual_current", 30)] }))
      .toMatchObject({ total: 3, poles: { "2p": 7, "4p": "3*" }, residual_current_type: { ac: 3, a: "3*", f: 3, b: 2 },
        rated_residual_current: { 10: 0, 30: "3*", 100: 6, 300: 8, 500: 8 } });
    expect(facets(MTD, { attributeFilters: [f("residual_current_type", "f")] })).toMatchObject({ total: 13,
      poles: { "1p_n": 9, "2p": 0, "4p": 4 }, residual_current_type: { ac: 60, a: 54, f: "13*" } });
    // The whole subtree: exactly the 872 classified BTI products, nothing from other brands.
    expect(facets("protezione", {})).toMatchObject({ total: 872, poles: { "1p": 87, "1p_n": 177, "2p": 259, "3p": 101, "4p": 248 },
      residual_current_type: { ac: 117, a: 135, f: 43, b: 8 } });
  });

  it("keeps manual values through full re-enrichment, seed changes and delivery re-normalization", () => {
    const before = dump();
    lq.exec(`UPDATE cat_product_attribute SET value_num = 20, source = 'manual'
      WHERE attribute_id = (SELECT id FROM cat_attribute WHERE code = 'rated_current')
        AND product_id = (SELECT id FROM cat_product WHERE manufacturer_code = 'FN81B16')`);
    const bumped = new Map([["BTI", { ...btiDescriptionParser, version: "test-bump" }]]);
    const full = synchronizeAttributeSeed(lq, undefined, { parsers: bumped });
    expect(full).toMatchObject({ reenriched: true, enrichment: { inserted: 0, updated: 0, deleted: 0, invalid: 0 } });
    expect(values("FN81B16").rated_current).toBe(20);
    expect(synchronizeAttributeSeed(lq, undefined, { parsers: bumped })).toMatchObject({ reenriched: false, enrichment: null });
    // Re-normalize BTI with a new delivery fingerprint (LSP only): every BTI product is affected.
    const lsp = ingestMetelFileFromPath({ database: raw, sourcePath: sets[0].LSP }).fileSha256;
    normalizeMetelDelivery({ lqDatabase: lq, rawDatabase: raw, sources: { LSP: lsp }, categorySeed, attributeParsers: BTI_PARSERS, normalizedAt: new Date("2026-09-21T05:00:00Z") });
    expect(values("FN81B16").rated_current).toBe(20);
    expect(total()).toBe(3531);
    // Back to automatic: the parser restores the original value on the next full run.
    lq.exec("UPDATE cat_product_attribute SET source = 'parser', value_num = 99 WHERE source = 'manual'");
    expect(synchronizeAttributeSeed(lq, undefined, { parsers: bumped })).toMatchObject({ reenriched: true,
      enrichment: { updated: 1, inserted: 0, deleted: 0 } });
    expect(dump()).toEqual(before);
  });
});
