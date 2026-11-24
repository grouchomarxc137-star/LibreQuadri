import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClassifier, type CategoryRule, type ClassificationInput } from "../src/main/catalogue/category-classifier.js";
import { loadCategorySeed, synchronizeCategorySeed, CLASSIFICATION_FINGERPRINT_KEY, type CategorySeed } from "../src/main/catalogue/category-seed.js";
import { createCatalogueFixture, type CatalogueFixture } from "./helpers/catalogue-fixtures.js";

const input: ClassificationInput = { brandId: 1, issuerId: 2, statisticalCode: "FAM-123", discountCode: "DISC", manufacturerCode: "P123", description: "magnetotermico" };
const rule = (changes: Partial<CategoryRule> = {}): CategoryRule => ({ id: 1, code: "rule.one", brandId: 1, issuerId: 2,
  sourceType: "STATISTICA", matchMode: "exact", matchValue: "FAM-123", categoryId: 1, priority: 0, ...changes });

describe("generic classifier precedence", () => {
  it("orders exact statistical, prefix statistical, code/description, discount", () => {
    const rules = [rule(), rule({ id: 2, sourceType: "STATISTICA", matchMode: "prefix", matchValue: "FAM", priority: 999 }),
      rule({ id: 3, sourceType: "DESCRIPTION", matchMode: "regex", matchValue: "magnet.*", priority: 9999 }),
      rule({ id: 4, sourceType: "SCONTO", matchValue: "DISC", priority: 99999 })];
    for (let i = 0; i < rules.length; i++) expect(createClassifier(rules.slice(i).reverse())(input)?.id).toBe(i + 1);
    expect(createClassifier([rule({ sourceType: "CODE_PREFIX", matchMode: "prefix", matchValue: "P" })])(input)?.id).toBe(1);
    expect(createClassifier([rule({ sourceType: "CODE_PREFIX", matchMode: "regex", matchValue: "^P[0-9]+$" })])(input)?.id).toBe(1);
  });

  it("requires both issuer and brand scope, including equal family codes elsewhere", () => {
    const classify = createClassifier([rule()]);
    expect(classify(input)?.id).toBe(1);
    expect(classify({ ...input, brandId: 3 })).toBeNull();
    expect(classify({ ...input, issuerId: 3 })).toBeNull();
    expect(classify({ ...input, issuerId: null })).toBeNull();
    expect(createClassifier([rule({ brandId: null, issuerId: null })])({ ...input, brandId: 3, issuerId: 4 })?.id).toBe(1);
  });

  it("uses scope specificity, prefix length, then priority deterministically", () => {
    expect(createClassifier([rule({ id: 2, issuerId: null, priority: 100 }), rule()])(input)?.id).toBe(1);
    expect(createClassifier([rule({ id: 2, matchMode: "prefix", matchValue: "F", priority: 100 }),
      rule({ matchMode: "prefix", matchValue: "FAM" })])(input)?.id).toBe(1);
    expect(createClassifier([rule({ id: 2, priority: 1, categoryId: 2 }), rule()])(input)?.id).toBe(2);
  });

  it("leaves equal-precedence disagreement unmapped, including overlapping regexes", () => {
    expect(createClassifier([rule(), rule({ id: 2, categoryId: 2, code: "rule.two" })])(input)).toBeNull();
    expect(createClassifier([rule({ brandId: null }), rule({ issuerId: null, categoryId: 2 })])(input)).toBeNull();
    expect(createClassifier([rule({ sourceType: "DESCRIPTION", matchMode: "regex", matchValue: "magnet.*" }),
      rule({ sourceType: "DESCRIPTION", matchMode: "regex", matchValue: ".*termico", categoryId: 2 })])(input)).toBeNull();
  });

  it("chooses stable-code provenance for agreeing rules, independent of row order", () => {
    const a = rule({ id: 20, code: "rule.a" }), b = rule({ id: 10, code: "rule.b" });
    expect(createClassifier([b, a])(input)?.id).toBe(20);
    expect(createClassifier([a, b])(input)?.id).toBe(20);
  });

  it("does not treat SQL wildcards or case variants as an exact match and ignores Electrocod", () => {
    for (const matchValue of ["fam-123", "FAM-%", "FAM-12_"]) expect(createClassifier([rule({ matchValue })])(input)).toBeNull();
    expect(createClassifier([rule({ sourceType: "ELECTROCOD", matchValue: "FAM-123" })])(input)).toBeNull();
  });
});

function seed(): CategorySeed {
  return {
    categories: [{ code: "root", parentCode: null, name: "Root", sortOrder: 0, active: true },
      { code: "root.one", parentCode: "root", name: "One", sortOrder: 1, active: true },
      { code: "root.two", parentCode: "root", name: "Two", sortOrder: 2, active: true }],
    mappings: [{ code: "test.one", issuerSigla: "ONE", brandMarchio: "AAA", sourceType: "STATISTICA",
      matchMode: "exact", matchValue: "FAM-123", categoryCode: "root.one", priority: 0, notes: null }],
  };
}

let fixture: CatalogueFixture;
beforeEach(() => { fixture = createCatalogueFixture(); });
afterEach(() => fixture.close());
function importProducts(s = seed()) {
  fixture.importDelivery({ issuer: "ONE", listino: "1", validFrom: "2026-01-01", products: [
    { marchio: "AAA", code: "P1", statisticalFamily: "FAM-123" },
    { marchio: "BBB", code: "P1", statisticalFamily: "FAM-123" },
  ] }, s);
}
function products() {
  return fixture.lq.prepare(`SELECT b.metel_marchio AS brand, p.category_source AS source, c.code AS category,
    m.code AS rule FROM cat_product p JOIN cat_brand b ON b.id = p.brand_id
    LEFT JOIN cat_category c ON c.id = p.category_id LEFT JOIN cat_category_mapping m ON m.id = p.category_mapping_id ORDER BY b.metel_marchio`).all();
}

describe("category seed validation", () => {
  it("rejects conflicting rules with intersecting equal-specificity scopes", () => {
    const s = seed();
    s.mappings[0].brandMarchio = null;
    s.mappings.push({ ...s.mappings[0], code: "test.two", issuerSigla: null, brandMarchio: "AAA", categoryCode: "root.two" });
    expect(() => synchronizeCategorySeed(fixture.lq, s)).toThrow("conflicting scoped rules");
  });
  it("accepts the production seed and only its approved scoped exact statistical rules", () => {
    const production = loadCategorySeed();
    // The product-owner-approved stable code tree (DATABASE_DESIGN Rev 8.4 §A.7): codes and
    // parents are a .lqp compatibility contract; display names stay provisional (Q30).
    expect(production.categories.filter(c => !c.code.includes(".industrial_")).map(c => `${c.parentCode ?? "-"}>${c.code}`)).toEqual([
      "->protezione", ...["interruttori_automatici", "magnetotermici_differenziali", "differenziali_puri",
        "blocchi_differenziali", "rilevatori_arco", "interruttori_scatolati", "interruttori_scatolati_differenziali",
        "interruttori_aperti", "salvamotori", "limitatori_sovratensione", "portafusibili", "fusibili",
        "rele_differenziali"].map(c => `protezione>protezione.${c}`),
      "->manovra", ...["sezionatori", "sezionatori_differenziali", "sezionatori_fusibili"].map(c => `manovra>manovra.${c}`),
      "->comando", ...["contattori_rele", "interruttori_orari_temporizzatori", "apparecchi_di_comando", "segnalazione"]
        .map(c => `comando>comando.${c}`),
      "->misura", "misura>misura.contatori_energia", "misura>misura.strumenti_di_misura",
      "->alimentazione", "alimentazione>alimentazione.alimentatori_trasformatori",
      "->accessori", "accessori>accessori.accessori_quadro",
      "->supervisione", "supervisione>supervisione.supervisione_impianto",
      "->automazione", "automazione>automazione.sistemi_edificio",
      "->prese", "prese>prese.prese_industriali",
    ]);
    expect(production.categories.filter(c => c.code.includes(".industrial_"))).toHaveLength(21);
    expect(production.mappings).toHaveLength(227);
    expect(production.mappings.filter(m => m.brandMarchio === "SIE")).toHaveLength(212);
    expect(production.mappings.filter(m => m.brandMarchio === "BTI")).toHaveLength(15);
    for (const mapping of production.mappings) expect(mapping).toMatchObject({ issuerSigla: mapping.brandMarchio, sourceType: "STATISTICA", matchMode: "exact" });
  });

  it.each(["duplicate category", "duplicate mapping", "invalid code", "missing parent", "cycle", "target", "conflict", "missing scope", "empty scope", "regex"])("rejects %s atomically", kind => {
    const s = seed();
    switch (kind) {
      case "duplicate category": s.categories.push(s.categories[0]); break;
      case "duplicate mapping": s.mappings.push(s.mappings[0]); break;
      case "invalid code": s.categories[0].code = "Not stable!"; break;
      case "missing parent": s.categories[1].parentCode = "absent"; break;
      case "cycle": s.categories[0].parentCode = "root.one"; break;
      case "target": s.mappings[0].categoryCode = "absent"; break;
      case "conflict": s.mappings.push({ ...s.mappings[0], code: "test.two", categoryCode: "root.two" }); break;
      case "missing scope": delete (s.mappings[0] as Partial<typeof s.mappings[0]>).issuerSigla; break;
      case "empty scope": s.mappings[0].brandMarchio = ""; break;
      case "regex": s.mappings[0] = { ...s.mappings[0], sourceType: "DESCRIPTION", matchMode: "regex", matchValue: "[" }; break;
    }
    expect(() => synchronizeCategorySeed(fixture.lq, s)).toThrow();
    expect(fixture.lq.prepare("SELECT COUNT(*) FROM cat_category").pluck().get()).toBe(0);
  });
});

describe("category seed loading", () => {
  const folders: string[] = [];
  afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
  function seedFolder(files: Record<string, unknown>): string {
    const folder = mkdtempSync(path.join(tmpdir(), "librequadri-seed-test-"));
    folders.push(folder);
    mkdirSync(path.join(folder, "category-mappings"));
    writeFileSync(path.join(folder, "categories.json"), JSON.stringify(seed().categories));
    for (const [name, rows] of Object.entries(files)) {
      writeFileSync(path.join(folder, "category-mappings", name), typeof rows === "string" ? rows : JSON.stringify(rows));
    }
    return folder;
  }
  const rule2 = { ...seed().mappings[0], code: "test.two", issuerSigla: "TWO", brandMarchio: "BBB", categoryCode: "root.two" };

  it("concatenates every mapping file in filename order, ignoring non-JSON files", () => {
    const loaded = loadCategorySeed(seedFolder({ "b.json": [rule2], "a.json": seed().mappings, "notes.txt": "ignored", ".DS_Store": "x" }));
    expect(loaded.mappings.map(m => m.code)).toEqual(["test.one", "test.two"]);
    expect(loadCategorySeed(seedFolder({})).mappings).toEqual([]);
  });

  it("fingerprints identically however rules are split across files", () => {
    const together = loadCategorySeed(seedFolder({ "all.json": [rule2, ...seed().mappings] }));
    const split = loadCategorySeed(seedFolder({ "one.json": seed().mappings, "two.json": [rule2] }));
    const fingerprint = synchronizeCategorySeed(fixture.lq, together).fingerprint;
    expect(synchronizeCategorySeed(fixture.lq, split)).toMatchObject({ fingerprint, reclassified: false });
  });

  it("rejects duplicate codes across files, non-array files and a missing mappings folder", () => {
    expect(() => loadCategorySeed(seedFolder({ "a.json": seed().mappings, "b.json": seed().mappings }))).toThrow("duplicate stable code");
    expect(() => loadCategorySeed(seedFolder({ "a.json": { code: "x" } }))).toThrow("must contain an array");
    const folder = seedFolder({});
    rmSync(path.join(folder, "category-mappings"), { recursive: true });
    expect(() => loadCategorySeed(folder)).toThrow(/ENOENT/);
  });
});

describe("seed lifecycle and normalization", () => {
  it("detects parent cycles involving protected manual overrides and rolls back", () => {
    synchronizeCategorySeed(fixture.lq, seed());
    fixture.lq.exec("UPDATE cat_category SET parent_id = (SELECT id FROM cat_category WHERE code = 'root.one'), source = 'manual' WHERE code = 'root.two'");
    const s = seed(); s.categories[1].parentCode = "root.two";
    expect(() => synchronizeCategorySeed(fixture.lq, s)).toThrow("effective parent cycle");
    expect(fixture.lq.prepare("SELECT code FROM cat_category WHERE id = (SELECT parent_id FROM cat_category WHERE code = 'root.one')").pluck().get()).toBe("root");
  });

  it("reclassifies automatic products when their statistical family changes", () => {
    importProducts();
    fixture.importDelivery({ issuer: "ONE", listino: "2", validFrom: "2027-01-01", products: [{ marchio: "AAA", code: "P1", statisticalFamily: "OTHER" }] }, seed());
    expect(products()[0]).toMatchObject({ category: null, source: "unmapped", rule: null });
  });

  it("classifies new historical identities with an applicable unscoped code rule", () => {
    const s = seed(); s.mappings[0] = { ...s.mappings[0], issuerSigla: null, brandMarchio: null, sourceType: "CODE_PREFIX", matchMode: "prefix", matchValue: "P" };
    fixture.importDelivery({ issuer: "ONE", listino: "1", validFrom: "2027-01-01", products: [{ marchio: "AAA", code: "P1" }] }, s);
    fixture.importDelivery({ issuer: "ONE", listino: "2", validFrom: "2026-01-01", acceptOlderDelivery: true, products: [{ marchio: "AAA", code: "P2" }] }, s);
    expect(fixture.lq.prepare("SELECT category_source, is_listed, governing_issuer_id FROM cat_product WHERE manufacturer_code = 'P2'").get()).toEqual({ category_source: "mapping", is_listed: 0, governing_issuer_id: null });
  });
  it("defers missing scopes and materializes them after normalization creates issuer/brand", () => {
    synchronizeCategorySeed(fixture.lq, seed());
    expect(fixture.lq.prepare("SELECT COUNT(*) FROM cat_category_mapping").pluck().get()).toBe(0);
    fixture.lq.exec("INSERT INTO cat_metel_issuer (metel_sigla) VALUES ('ONE')");
    synchronizeCategorySeed(fixture.lq, seed());
    expect(fixture.lq.prepare("SELECT COUNT(*) FROM cat_category_mapping").pluck().get()).toBe(0);
    importProducts();
    expect(products()).toEqual([
      { brand: "AAA", source: "mapping", category: "root.one", rule: "test.one" },
      { brand: "BBB", source: "unmapped", category: null, rule: null },
    ]);
  });

  it("is idempotent, with stable ids/fingerprint even when seed arrays are reordered", () => {
    importProducts();
    const before = fixture.lq.prepare("SELECT * FROM cat_product").all();
    const fingerprint = synchronizeCategorySeed(fixture.lq, seed()).fingerprint;
    const s = seed(); s.categories.reverse();
    expect(synchronizeCategorySeed(fixture.lq, s)).toEqual({ fingerprint, reclassified: false, changedProducts: 0 });
    expect(fixture.lq.prepare("SELECT * FROM cat_product").all()).toEqual(before);
  });

  it("preserves manual categories, mapping rows, and product decisions including manual null", () => {
    importProducts();
    fixture.lq.exec(`UPDATE cat_category SET name = 'Manual name', source = 'manual' WHERE code = 'root.one';
      UPDATE cat_category_mapping SET category_id = (SELECT id FROM cat_category WHERE code = 'root.two'), source = 'manual';
      UPDATE cat_product SET category_id = NULL, category_source = 'manual', category_mapping_id = NULL WHERE brand_id = (SELECT id FROM cat_brand WHERE metel_marchio = 'AAA');`);
    const s = seed(); s.mappings = [];
    synchronizeCategorySeed(fixture.lq, s);
    expect(fixture.lq.prepare("SELECT name FROM cat_category WHERE code = 'root.one'").pluck().get()).toBe("Manual name");
    expect(fixture.lq.prepare("SELECT source FROM cat_category_mapping").pluck().get()).toBe("manual");
    expect(products()[0]).toMatchObject({ source: "manual", category: null, rule: null });
    fixture.lq.exec("UPDATE cat_product SET category_id = (SELECT id FROM cat_category WHERE code = 'root.one') WHERE category_source = 'manual'");
    synchronizeCategorySeed(fixture.lq, seed(), new Set([1, 2]));
    expect(products()[0]).toMatchObject({ source: "manual", category: "root.one" });
  });

  it("reclassifies after seed edits/removal and records the responsible mapping", () => {
    importProducts();
    const s = seed(); s.mappings[0].categoryCode = "root.two";
    expect(synchronizeCategorySeed(fixture.lq, s)).toMatchObject({ reclassified: true, changedProducts: 1 });
    expect(products()[0]).toMatchObject({ category: "root.two", rule: "test.one" });
    s.mappings = [];
    expect(synchronizeCategorySeed(fixture.lq, s)).toMatchObject({ changedProducts: 1 });
    expect(products()[0]).toMatchObject({ source: "unmapped", category: null, rule: null });
  });

  it("retires categories without deletion and refuses reusing retired codes", () => {
    importProducts();
    const id = fixture.lq.prepare("SELECT id FROM cat_category WHERE code = 'root.one'").pluck().get();
    const s = seed(); s.mappings = []; s.categories = s.categories.filter(c => c.code !== "root.one");
    synchronizeCategorySeed(fixture.lq, s);
    expect(fixture.lq.prepare("SELECT id, active FROM cat_category WHERE code = 'root.one'").get()).toEqual({ id, active: 0 });
    expect(() => synchronizeCategorySeed(fixture.lq, seed())).toThrow("retired code cannot be reused");
  });

  it("does not classify into inactive target categories, including protected manual ones", () => {
    importProducts();
    fixture.lq.exec("UPDATE cat_category SET active = 0, source = 'manual' WHERE code = 'root.one'");
    synchronizeCategorySeed(fixture.lq, seed());
    expect(products()[0]).toMatchObject({ source: "unmapped", category: null });
  });

  it("records unmapped state on conflicts introduced by protected manual rules", () => {
    importProducts();
    fixture.lq.exec(`INSERT INTO cat_category_mapping (code, brand_id, issuer_id, source_type, match_mode, match_value, category_id, priority, source)
      SELECT 'manual.conflict', brand_id, issuer_id, source_type, match_mode, match_value,
        (SELECT id FROM cat_category WHERE code = 'root.two'), priority, 'manual' FROM cat_category_mapping`);
    synchronizeCategorySeed(fixture.lq, seed());
    expect(products()[0]).toMatchObject({ source: "unmapped", category: null, rule: null });
  });

  it("reclassifies when a governing issuer or family changes and preserves manual decisions on import", () => {
    importProducts();
    fixture.importDelivery({ issuer: "TWO", listino: "2", validFrom: "2027-01-01", products: [{ marchio: "AAA", code: "P1", statisticalFamily: "FAM-123" }] }, seed());
    expect(products()[0]).toMatchObject({ category: null });
    fixture.importDelivery({ issuer: "ONE", listino: "3", validFrom: "2028-01-01", products: [{ marchio: "AAA", code: "P1", statisticalFamily: "FAM-123" }] }, seed());
    expect(products()[0]).toMatchObject({ category: "root.one" });
    fixture.lq.exec("UPDATE cat_product SET category_source = 'manual', category_mapping_id = NULL WHERE category_id IS NOT NULL");
    fixture.importDelivery({ issuer: "ONE", listino: "4", validFrom: "2029-01-01", products: [{ marchio: "AAA", code: "P1", statisticalFamily: "UNKNOWN" }] }, seed());
    expect(products()[0]).toMatchObject({ source: "manual", category: "root.one", rule: null });
  });

  it("rolls back seed changes and fingerprint if classification fails", () => {
    importProducts();
    const fingerprint = fixture.lq.prepare("SELECT value FROM app_setting WHERE key = ?").pluck().get(CLASSIFICATION_FINGERPRINT_KEY);
    fixture.lq.exec("CREATE TRIGGER fail_category BEFORE UPDATE OF category_id ON cat_product BEGIN SELECT RAISE(ABORT, 'failure'); END");
    const s = seed(); s.mappings[0].categoryCode = "root.two";
    expect(() => synchronizeCategorySeed(fixture.lq, s)).toThrow("failure");
    expect(products()[0]).toMatchObject({ category: "root.one" });
    expect(fixture.lq.prepare("SELECT value FROM app_setting WHERE key = ?").pluck().get(CLASSIFICATION_FINGERPRINT_KEY)).toBe(fingerprint);
  });

  it("nulls provenance on mapping deletion without deleting the product", () => {
    importProducts();
    fixture.lq.exec("DELETE FROM cat_category_mapping");
    expect(products()[0]).toMatchObject({ category: "root.one", rule: null });
    expect(fixture.lq.pragma("foreign_key_check")).toEqual([]);
  });
});
