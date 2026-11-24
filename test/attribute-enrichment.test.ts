import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AttributeParser, AttributeParserRegistry, ParsedAttributeValue } from "../src/main/catalogue/attribute-enrichment.js";
import {
  InvalidCatalogueFilterError,
  listCategories,
} from "../src/main/catalogue/attribute-queries.js";
import {
  ATTRIBUTE_ENRICHMENT_FINGERPRINT_KEY,
  loadAttributeSeed,
  synchronizeAttributeSeed,
  type AttributeSeed,
} from "../src/main/catalogue/attribute-seed.js";
import { getAttributeFilterOptions, searchCatalogue } from "../src/main/catalogue/catalogue-queries.js";
import { loadCategorySeed, synchronizeCategorySeed, type CategorySeed } from "../src/main/catalogue/category-seed.js";
import { btiDescriptionParser } from "../src/main/catalogue/parsers/bti-description.js";
import { ATTRIBUTE_PARSERS } from "../src/main/catalogue/parsers/index.js";
import type { CatalogueAttributeFilter } from "../src/shared/catalogue.js";
import { createCatalogueFixture, type CatalogueFixture, type FixtureProduct } from "./helpers/catalogue-fixtures.js";

/** Test-only brand parser: "poles=2p rated_current=16"; "x=?" marks x ambiguous. */
function fakeParser(version = "1"): AttributeParser {
  return {
    code: "tst.fake", version,
    parse: ({ description }) => {
      const values = new Map<string, ParsedAttributeValue>();
      const ambiguous: string[] = [];
      for (const token of description.split(" ")) {
        const [code, value] = token.split("=");
        if (value === undefined) continue;
        if (value === "?") ambiguous.push(code);
        else values.set(code, /^[\d.-]+$/.test(value) ? { kind: "number", value: Number(value) } : { kind: "option", value });
      }
      return { values, ambiguous };
    },
  };
}
const parsers = (version = "1"): AttributeParserRegistry => new Map([["TST", fakeParser(version)]]);

function categorySeed(): CategorySeed {
  return {
    categories: [
      { code: "root", parentCode: null, name: "Root", sortOrder: 0, active: true },
      { code: "root.breakers", parentCode: "root", name: "Breakers", sortOrder: 1, active: true },
      { code: "root.rcd", parentCode: "root", name: "RCD", sortOrder: 2, active: true },
      { code: "root.other", parentCode: "root", name: "Other", sortOrder: 3, active: true },
    ],
    mappings: [
      { code: "any.brk", issuerSigla: null, brandMarchio: null, sourceType: "STATISTICA", matchMode: "exact", matchValue: "BRK",
        categoryCode: "root.breakers", priority: 0, notes: null },
      { code: "any.rcd", issuerSigla: null, brandMarchio: null, sourceType: "STATISTICA", matchMode: "exact", matchValue: "RCD",
        categoryCode: "root.rcd", priority: 0, notes: null },
      { code: "any.oth", issuerSigla: null, brandMarchio: null, sourceType: "STATISTICA", matchMode: "exact", matchValue: "OTH",
        categoryCode: "root.other", priority: 0, notes: null },
    ],
  };
}

function attributeSeed(): AttributeSeed {
  const option = (value: string, sortOrder: number) => ({ value, label: value.toUpperCase(), sortOrder, active: true });
  const link = (categoryCode: string, attributeCode: string, sortOrder: number) =>
    ({ categoryCode, attributeCode, sortOrder, isFilterable: true, isRequired: false, filterWidget: "checkbox" as const });
  return {
    attributes: [
      { code: "poles", name: "Poli", dataType: "enum", unit: null, active: true, options: [option("1p", 1), option("2p", 2), option("4p", 4)] },
      { code: "rated_current", name: "In", dataType: "number", unit: "A", active: true, options: [] },
      { code: "rcd_type", name: "Tipo", dataType: "enum", unit: null, active: true, options: [option("ac", 1), option("a", 2)] },
    ],
    categoryAttributes: [
      link("root.breakers", "poles", 1), link("root.breakers", "rated_current", 2),
      link("root.rcd", "poles", 1), link("root.rcd", "rcd_type", 3),
    ],
  };
}

let fixture: CatalogueFixture;
beforeEach(() => { fixture = createCatalogueFixture(); });
afterEach(() => fixture.close());

let listino = 0;
function deliver(products: FixtureProduct[], options: { seed?: AttributeSeed; parsers?: AttributeParserRegistry; issuer?: string } = {}) {
  listino++;
  return fixture.importDelivery({ issuer: options.issuer ?? "ONE", listino: String(listino), validFrom: `20${10 + listino}-01-01`, products },
    categorySeed(), { seed: options.seed ?? attributeSeed(), parsers: options.parsers ?? parsers() });
}
const standard: FixtureProduct[] = [
  { marchio: "TST", code: "B1", statisticalFamily: "BRK", description: "poles=2p rated_current=16 rcd_type=a" },
  { marchio: "TST", code: "R1", statisticalFamily: "RCD", description: "poles=4p rated_current=40 rcd_type=ac" },
  { marchio: "TST", code: "O1", statisticalFamily: "OTH", description: "poles=2p rated_current=16" },
  { marchio: "TST", code: "U1", description: "poles=2p rated_current=16" },
  { marchio: "OTH", code: "B2", statisticalFamily: "BRK", description: "poles=2p rated_current=16" },
];

function values(code: string, marchio = "TST") {
  return Object.fromEntries((fixture.lq.prepare(`
    SELECT a.code, COALESCE(o.value, pa.value_num) AS value, pa.source FROM cat_product_attribute pa
    JOIN cat_attribute a ON a.id = pa.attribute_id LEFT JOIN cat_attribute_option o ON o.id = pa.option_id
    JOIN cat_product p ON p.id = pa.product_id JOIN cat_brand b ON b.id = p.brand_id
    WHERE b.metel_marchio = ? AND p.manufacturer_code = ? ORDER BY a.code
  `).all(marchio, code) as Array<{ code: string; value: string | number; source: string }>)
    .map(row => [row.code, row.source === "parser" ? row.value : `${row.source}:${row.value}`]));
}
const dump = () => fixture.lq.prepare("SELECT * FROM cat_product_attribute ORDER BY product_id, attribute_id").all();
const productId = (code: string, marchio = "TST") => fixture.lq.prepare(`SELECT p.id FROM cat_product p JOIN cat_brand b ON b.id = p.brand_id
  WHERE b.metel_marchio = ? AND p.manufacturer_code = ?`).pluck().get(marchio, code) as number;
const attributeId = (code: string) => fixture.lq.prepare("SELECT id FROM cat_attribute WHERE code = ?").pluck().get(code) as number;
function setOwned(code: string, attribute: string, source: string, value: number) {
  fixture.lq.prepare("UPDATE cat_product_attribute SET source = ?, value_num = ? WHERE product_id = ? AND attribute_id = ?")
    .run(source, value, productId(code), attributeId(attribute));
}

describe("generic attribute enrichment", () => {
  it("stores only valid values of attributes applicable to the product's category", () => {
    deliver(standard);
    expect(values("B1")).toEqual({ poles: "2p", rated_current: 16 });
    expect(values("R1")).toEqual({ poles: "4p", rcd_type: "ac" });
    expect(values("O1")).toEqual({});
    expect(values("U1")).toEqual({});
  });

  it("gives brands without a parser no values but keeps them browsable", () => {
    deliver(standard);
    expect(values("B2", "OTH")).toEqual({});
    const products = searchCatalogue(fixture.lq, { query: "", categoryCode: "root.breakers" }).products;
    expect(products.map(p => [p.brandMarchio, p.manufacturerCode, p.attributes.length])).toEqual([["TST", "B1", 2], ["OTH", "B2", 0]]);
  });

  it("never applies the BTI parser to another brand", () => {
    const description = "btdin60 - magnetot 2P curva B 16A 6kA";
    deliver([{ marchio: "BTI", code: "FN82B16", statisticalFamily: "BRK", description },
      { marchio: "LEG", code: "FN82B16", statisticalFamily: "BRK", description }], { parsers: ATTRIBUTE_PARSERS });
    expect(values("FN82B16", "BTI")).toEqual({ poles: "2p", rated_current: 16 });
    expect(values("FN82B16", "LEG")).toEqual({});
  });

  it("never stores ambiguous or invalid proposals, and reports them", () => {
    deliver([
      { marchio: "TST", code: "B1", statisticalFamily: "BRK", description: "poles=? rated_current=16" },
      { marchio: "TST", code: "B3", statisticalFamily: "BRK", description: "poles=9p rated_current=0" },
      { marchio: "TST", code: "B4", statisticalFamily: "BRK", description: "poles=16 rated_current=2p unknown=1" },
    ]);
    expect([values("B1"), values("B3"), values("B4")]).toEqual([{ rated_current: 16 }, {}, {}]);
    fixture.lq.exec("DELETE FROM cat_product_attribute");
    expect(synchronizeAttributeSeed(fixture.lq, attributeSeed(), { parsers: parsers("2") }).enrichment)
      .toEqual({ inserted: 1, updated: 0, deleted: 0, ambiguous: { poles: 1 }, invalid: 4 });
  });

  it("protects manual, seed and import_file values from parser re-enrichment", () => {
    deliver(standard);
    setOwned("B1", "rated_current", "manual", 20);
    fixture.lq.prepare("UPDATE cat_product_attribute SET source = 'seed' WHERE product_id = ? AND attribute_id = ?").run(productId("R1"), attributeId("poles"));
    fixture.lq.prepare("UPDATE cat_product_attribute SET source = 'import_file' WHERE product_id = ? AND attribute_id = ?").run(productId("B1"), attributeId("poles"));
    // Full re-enrichment (parser version bump) with proposals that differ from the owned values.
    const result = synchronizeAttributeSeed(fixture.lq, attributeSeed(), { parsers: parsers("2") });
    expect(result).toMatchObject({ reenriched: true, enrichment: { inserted: 0, updated: 0, deleted: 0 } });
    expect(values("B1")).toEqual({ poles: "import_file:2p", rated_current: "manual:20" });
    expect(values("R1")).toEqual({ poles: "seed:4p", rcd_type: "ac" });
  });

  it("keeps manual values through seed changes and delivery re-normalization", () => {
    deliver(standard);
    setOwned("B1", "rated_current", "manual", 20);
    const seed = attributeSeed();
    seed.attributes[1].name = "Corrente nominale";
    seed.categoryAttributes = seed.categoryAttributes.filter(l => !(l.categoryCode === "root.breakers" && l.attributeCode === "rated_current"));
    expect(synchronizeAttributeSeed(fixture.lq, seed, { parsers: parsers() }).reenriched).toBe(true);
    expect(values("B1")).toEqual({ poles: "2p", rated_current: "manual:20" });
    deliver(standard.map(p => ({ ...p, description: "poles=1p rated_current=32" })));
    expect(values("B1")).toEqual({ poles: "1p", rated_current: "manual:20" });
  });

  it("updates parser values when the description changes and removes them when inapplicable", () => {
    deliver(standard);
    fixture.lq.prepare("INSERT INTO cat_product_attribute (product_id, attribute_id, value_num, source) VALUES (?, ?, 40, 'manual')")
      .run(productId("R1"), attributeId("rated_current"));
    deliver([{ marchio: "TST", code: "B1", statisticalFamily: "BRK", description: "poles=1p rated_current=10" },
      { marchio: "TST", code: "R1", statisticalFamily: "RCD", description: "poles=4p rcd_type=ac" }]);
    expect(values("B1")).toEqual({ poles: "1p", rated_current: 10 });
    // Becomes unclassified: parser rows go, the manual row stays.
    deliver([{ marchio: "TST", code: "B1", description: "poles=1p rated_current=10" },
      { marchio: "TST", code: "R1", description: "poles=4p rcd_type=ac" }]);
    expect(values("B1")).toEqual({});
    expect(values("R1")).toEqual({ rated_current: "manual:40" });
  });

  it("is idempotent and deterministic", () => {
    deliver(standard);
    const before = dump();
    const fingerprint = fixture.lq.prepare("SELECT value FROM app_setting WHERE key = ?").pluck().get(ATTRIBUTE_ENRICHMENT_FINGERPRINT_KEY);
    const reordered = attributeSeed();
    reordered.attributes.reverse();
    reordered.categoryAttributes.reverse();
    expect(synchronizeAttributeSeed(fixture.lq, reordered, { parsers: parsers() })).toEqual({ fingerprint, reenriched: false, enrichment: null });
    const all = new Set(fixture.lq.prepare("SELECT id FROM cat_product").pluck().all() as number[]);
    expect(synchronizeAttributeSeed(fixture.lq, attributeSeed(), { parsers: parsers(), affectedIds: all }).enrichment)
      .toEqual({ inserted: 0, updated: 0, deleted: 0, ambiguous: {}, invalid: 0 });
    expect(synchronizeAttributeSeed(fixture.lq, attributeSeed(), { parsers: parsers("2") }).reenriched).toBe(true);
    expect(dump()).toEqual(before);
    fixture.lq.exec("DELETE FROM cat_product_attribute");
    synchronizeAttributeSeed(fixture.lq, attributeSeed(), { parsers: parsers("3") });
    expect(dump()).toEqual(before);
  });

  it("re-enriches everything when classification changes", () => {
    deliver(standard);
    const cats = categorySeed();
    cats.mappings[0].categoryCode = "root.rcd";
    expect(synchronizeCategorySeed(fixture.lq, cats).reclassified).toBe(true);
    // No affected ids: only the changed classification fingerprint triggers re-enrichment.
    expect(synchronizeAttributeSeed(fixture.lq, attributeSeed(), { parsers: parsers() }).reenriched).toBe(true);
    expect(values("B1")).toEqual({ poles: "2p", rcd_type: "a" });
  });

  it("rolls back reference changes and the fingerprint if enrichment fails", () => {
    deliver(standard);
    const fingerprint = fixture.lq.prepare("SELECT value FROM app_setting WHERE key = ?").pluck().get(ATTRIBUTE_ENRICHMENT_FINGERPRINT_KEY);
    fixture.lq.exec("CREATE TRIGGER fail_attribute BEFORE INSERT ON cat_product_attribute BEGIN SELECT RAISE(ABORT, 'failure'); END");
    fixture.lq.exec("DELETE FROM cat_product_attribute");
    const seed = attributeSeed();
    seed.attributes[0].name = "Changed";
    expect(() => synchronizeAttributeSeed(fixture.lq, seed, { parsers: parsers() })).toThrow("failure");
    expect(fixture.lq.prepare("SELECT name FROM cat_attribute WHERE code = 'poles'").pluck().get()).toBe("Poli");
    expect(fixture.lq.prepare("SELECT value FROM app_setting WHERE key = ?").pluck().get(ATTRIBUTE_ENRICHMENT_FINGERPRINT_KEY)).toBe(fingerprint);
  });
});

describe("attribute seed lifecycle", () => {
  it("retires omitted options and attributes without deleting them, and refuses reuse", () => {
    deliver(standard);
    fixture.lq.prepare(`UPDATE cat_product_attribute SET source = 'manual' WHERE product_id = ? AND attribute_id = ?`)
      .run(productId("R1"), attributeId("rcd_type"));
    const seed = attributeSeed();
    seed.attributes[2].options = seed.attributes[2].options.filter(o => o.value !== "ac");
    seed.attributes = seed.attributes.filter(a => a.code !== "rated_current");
    seed.categoryAttributes = seed.categoryAttributes.filter(l => l.attributeCode !== "rated_current");
    synchronizeAttributeSeed(fixture.lq, seed, { parsers: parsers() });
    expect(fixture.lq.prepare("SELECT code, active FROM cat_attribute ORDER BY code").all()).toEqual([
      { code: "poles", active: 1 }, { code: "rated_current", active: 0 }, { code: "rcd_type", active: 1 }]);
    expect(fixture.lq.prepare("SELECT active FROM cat_attribute_option WHERE value = 'ac'").pluck().get()).toBe(0);
    expect(values("R1")).toEqual({ poles: "4p", rcd_type: "manual:ac" });
    expect(values("B1")).toEqual({ poles: "2p" });
    // An inactive option cannot be selected, and an inactive attribute is not shown.
    expect(() => searchCatalogue(fixture.lq, { query: "", categoryCode: "root.rcd",
      attributeFilters: [{ attributeCode: "rcd_type", values: ["ac"] }] })).toThrow(InvalidCatalogueFilterError);
    expect(searchCatalogue(fixture.lq, { query: "R1", categoryCode: "root.rcd" }).products[0].attributes.map(a => a.code)).toEqual(["poles", "rcd_type"]);
    expect(() => synchronizeAttributeSeed(fixture.lq, attributeSeed(), { parsers: parsers() })).toThrow("retired");
    const reusedOption = { ...seed, attributes: seed.attributes.map(a => a.code === "rcd_type"
      ? { ...a, options: [...a.options, { value: "ac", label: "AC", sortOrder: 1, active: true }] } : a) };
    expect(() => synchronizeAttributeSeed(fixture.lq, reusedOption, { parsers: parsers() })).toThrow("retired option");
  });

  it("protects manual reference rows and refuses data type or unit changes", () => {
    deliver(standard);
    fixture.lq.exec(`UPDATE cat_attribute SET name = 'Manuale', source = 'manual' WHERE code = 'poles';
      UPDATE cat_category_attribute SET source = 'manual' WHERE attribute_id = (SELECT id FROM cat_attribute WHERE code = 'rated_current')`);
    const seed = attributeSeed();
    seed.categoryAttributes = seed.categoryAttributes.filter(l => l.attributeCode !== "rated_current");
    synchronizeAttributeSeed(fixture.lq, seed, { parsers: parsers() });
    expect(fixture.lq.prepare("SELECT name FROM cat_attribute WHERE code = 'poles'").pluck().get()).toBe("Manuale");
    expect(values("B1")).toEqual({ poles: "2p", rated_current: 16 });
    const changed = attributeSeed();
    changed.attributes[1].unit = "mA";
    expect(() => synchronizeAttributeSeed(fixture.lq, changed, { parsers: parsers() })).toThrow("cannot change");
  });

  it.each([
    ["duplicate attribute", (s: AttributeSeed) => { s.attributes.push(s.attributes[0]); }],
    ["invalid code", (s: AttributeSeed) => { s.attributes[0].code = "Poles!"; }],
    ["enum without options", (s: AttributeSeed) => { s.attributes[0].options = []; }],
    ["number with options", (s: AttributeSeed) => { s.attributes[1].options = [{ value: "x", label: "X", sortOrder: 1, active: true }]; }],
    ["unit on enum", (s: AttributeSeed) => { s.attributes[0].unit = "A"; }],
    ["bad data type", (s: AttributeSeed) => { (s.attributes[0] as { dataType: string }).dataType = "list"; }],
    ["bad option value", (s: AttributeSeed) => { s.attributes[0].options[0].value = "1P"; }],
    ["duplicate option", (s: AttributeSeed) => { s.attributes[0].options.push(s.attributes[0].options[0]); }],
    ["unknown link attribute", (s: AttributeSeed) => { s.categoryAttributes[0].attributeCode = "absent"; }],
    ["duplicate link", (s: AttributeSeed) => { s.categoryAttributes.push(s.categoryAttributes[0]); }],
    ["bad widget", (s: AttributeSeed) => { (s.categoryAttributes[0] as { filterWidget: string }).filterWidget = "slider"; }],
  ])("rejects %s atomically", (_label, mutate) => {
    const seed = attributeSeed();
    mutate(seed);
    expect(() => synchronizeAttributeSeed(fixture.lq, seed, { parsers: parsers() })).toThrow("Invalid attribute seed");
    expect(fixture.lq.prepare("SELECT COUNT(*) FROM cat_attribute").pluck().get()).toBe(0);
  });

  it("loads the production seed and checks links against the category seed", () => {
    const production = loadAttributeSeed();
    expect(production.attributes.slice(0, 8).map(a => [a.code, a.dataType, a.unit, a.options.map(o => `${o.value}=${o.label}`)])).toEqual([
      ["poles", "enum", null, ["1p=1P", "1p_n=1P+N", "2p=2P", "3p=3P", "3p_n=3P+N", "4p=4P"]],
      ["rated_current", "number", "A", []],
      ["trip_curve", "enum", null, ["b=B", "c=C", "d=D", "k=K", "z=Z", "a=A", "e=E"]],
      ["declared_breaking_capacity", "number", "kA", []],
      ["rated_ultimate_breaking_capacity", "number", "kA", []],
      ["rated_residual_current", "number", "mA", []],
      ["residual_current_type", "enum", null, ["ac=AC", "a=A", "f=F", "b=B"]],
      ["trip_unit_type", "enum", null, ["thermomagnetic=Magnetotermico", "magnetic_only=Solo magnetico",
        "electronic=Elettronico", "electronic_li=Elettronico LI", "electronic_lsi=Elettronico LSI",
        "electronic_lsig=Elettronico LSIG"]],
    ]);
    expect(production.attributes.find(a => a.code === "declared_breaking_capacity")!.name).toBe("Potere di interruzione (dichiarato)");
    const links = (category: string) => production.categoryAttributes.filter(l => l.categoryCode === `protezione.${category}`).map(l => l.attributeCode);
    const all = ["poles", "rated_current", "trip_curve", "declared_breaking_capacity", "rated_residual_current", "residual_current_type"];
    expect(links("interruttori_automatici")).toEqual(all.slice(0, 4));
    expect(links("magnetotermici_differenziali")).toEqual(all);
    expect(links("differenziali_puri")).toEqual(["poles", "rated_current", "rated_residual_current", "residual_current_type"]);
    expect(links("blocchi_differenziali")).toEqual(["poles", "rated_current", "rated_residual_current", "residual_current_type"]);
    expect(links("rilevatori_arco")).toEqual(all);
    // SPD discharge-current labels and adjustable relay settings are not any of
    // these article-true filter attributes; category applicability blocks the parser.
    expect(links("limitatori_sovratensione")).toEqual([]);
    expect(links("rele_differenziali")).toEqual([]);
    // A holder's own rating and a package's selected fuse-link rating are different
    // quantities, so fuse holders expose poles only; fuse-links carry In.
    expect(links("portafusibili")).toEqual(["poles"]);
    expect(links("fusibili")).toEqual(["rated_current"]);
    // Stage E: the trip-unit type applies to moulded-case and air circuit breakers only.
    for (const category of ["interruttori_scatolati", "interruttori_scatolati_differenziali", "interruttori_aperti"])
      expect(links(category)).toEqual(["poles", "rated_current", "rated_ultimate_breaking_capacity", "trip_unit_type"]);
    expect(production.categoryAttributes.filter(l => l.attributeCode === "trip_unit_type" && !l.categoryCode.includes(".industrial_"))).toHaveLength(3);
    // Stage D categories are low-data: classified, with no technical filter attribute.
    const stageD = loadCategorySeed().categories.filter(c => c.parentCode !== null && !c.code.includes(".industrial_") &&
      ["comando", "misura", "alimentazione", "accessori", "supervisione", "automazione", "prese"].includes(c.parentCode)).map(c => c.code);
    expect(stageD).toHaveLength(11);
    expect(new Set(production.categoryAttributes.map(l => l.categoryCode))).toEqual(
      new Set(loadCategorySeed().categories.filter(c => c.parentCode !== null &&
        !["protezione.limitatori_sovratensione","protezione.rele_differenziali",...stageD].includes(c.code)).map(c => c.code)));
    const folder = mkdtempSync(path.join(tmpdir(), "librequadri-attribute-seed-"));
    try {
      writeFileSync(path.join(folder, "categories.json"), JSON.stringify([{ code: "only", parentCode: null, name: "Only", sortOrder: 0, active: true }]));
      writeFileSync(path.join(folder, "attributes.json"), JSON.stringify(production.attributes));
      writeFileSync(path.join(folder, "category-attributes.json"), JSON.stringify(production.categoryAttributes));
      expect(() => loadAttributeSeed(folder)).toThrow("unknown category");
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });

  it("defers links to categories that do not exist yet", () => {
    synchronizeAttributeSeed(fixture.lq, attributeSeed(), { parsers: parsers() });
    expect(fixture.lq.prepare("SELECT COUNT(*) FROM cat_category_attribute").pluck().get()).toBe(0);
    deliver(standard);
    expect(fixture.lq.prepare("SELECT COUNT(*) FROM cat_category_attribute").pluck().get()).toBe(4);
    expect(values("B1")).toEqual({ poles: "2p", rated_current: 16 });
  });
});

describe("category browsing and basic attribute filters", () => {
  const find = (request: { categoryCode: string; attributeFilters?: CatalogueAttributeFilter[]; query?: string; listedOnly?: boolean }) =>
    searchCatalogue(fixture.lq, { query: "", ...request }).products.map(p => `${p.brandMarchio}:${p.manufacturerCode}`);
  beforeEach(() => deliver([...standard,
    { marchio: "TST", code: "B5", statisticalFamily: "BRK", description: "poles=1p rated_current=16" },
    { marchio: "TST", code: "B6", statisticalFamily: "BRK", description: "poles=4p rated_current=32" },
  ]));

  it("ORs values of one attribute and ANDs different attributes", () => {
    expect(find({ categoryCode: "root.breakers", attributeFilters: [{ attributeCode: "poles", values: ["1p", "2p"] }] })).toEqual(["TST:B1", "TST:B5"]);
    expect(find({ categoryCode: "root.breakers", attributeFilters: [{ attributeCode: "poles", values: ["1p", "2p", "4p"] },
      { attributeCode: "rated_current", values: [16] }] })).toEqual(["TST:B1", "TST:B5"]);
    expect(find({ categoryCode: "root.breakers", attributeFilters: [{ attributeCode: "poles", values: ["4p"] },
      { attributeCode: "rated_current", values: [16] }] })).toEqual([]);
    expect(find({ categoryCode: "root.breakers", query: "B5" })).toEqual(["TST:B5"]);
  });

  it("includes the subtree, applies listed-only and matches manual values", () => {
    expect(find({ categoryCode: "root" })).toEqual(["TST:B1", "OTH:B2", "TST:B5", "TST:B6", "TST:O1", "TST:R1"]);
    expect(find({ categoryCode: "root", attributeFilters: [{ attributeCode: "poles", values: ["4p"] }] })).toEqual(["TST:B6", "TST:R1"]);
    setOwned("B6", "rated_current", "manual", 16);
    expect(find({ categoryCode: "root.breakers", attributeFilters: [{ attributeCode: "rated_current", values: [16] }] }))
      .toEqual(["TST:B1", "TST:B5", "TST:B6"]);
    deliver([{ marchio: "TST", code: "B1", statisticalFamily: "BRK", description: "poles=2p rated_current=16" }]);
    expect(find({ categoryCode: "root.breakers", listedOnly: true })).toEqual(["TST:B1"]);
    expect(find({ categoryCode: "root.breakers" })[0]).toBe("TST:B1");
  });

  it.each([
    ["unknown category", { categoryCode: "absent" }],
    ["inapplicable attribute", { categoryCode: "root.breakers", attributeFilters: [{ attributeCode: "rcd_type", values: ["a"] }] }],
    ["unknown attribute", { categoryCode: "root.breakers", attributeFilters: [{ attributeCode: "absent", values: ["a"] }] }],
    ["unknown option", { categoryCode: "root.breakers", attributeFilters: [{ attributeCode: "poles", values: ["9p"] }] }],
    ["number for enum", { categoryCode: "root.breakers", attributeFilters: [{ attributeCode: "poles", values: [2] }] }],
    ["option for number", { categoryCode: "root.breakers", attributeFilters: [{ attributeCode: "rated_current", values: ["16"] }] }],
  ])("rejects %s", (_label, request) => {
    expect(() => find(request)).toThrow(InvalidCatalogueFilterError);
  });

  it("requires a category for attribute filters", () => {
    expect(() => searchCatalogue(fixture.lq, { query: "B1", attributeFilters: [{ attributeCode: "poles", values: ["2p"] }] }))
      .toThrow(InvalidCatalogueFilterError);
    expect(searchCatalogue(fixture.lq, { query: "" }).products).toEqual([]);
  });

  it("lists categories with subtree counts and the values present per applicable attribute", () => {
    expect(listCategories(fixture.lq).map(c => [c.code, c.depth, c.productCount])).toEqual([
      ["root", 0, 6], ["root.breakers", 1, 4], ["root.rcd", 1, 1], ["root.other", 1, 1]]);
    expect(getAttributeFilterOptions(fixture.lq, { categoryCode: "root.breakers" })).toEqual({ categoryCode: "root.breakers", totalCount: 4, attributes: [
      { code: "poles", name: "Poli", dataType: "enum", unit: null, values: [
        { value: "1p", label: "1P", count: 1, selected: false }, { value: "2p", label: "2P", count: 1, selected: false },
        { value: "4p", label: "4P", count: 1, selected: false }] },
      { code: "rated_current", name: "In", dataType: "number", unit: "A", values: [
        { value: 16, label: null, count: 2, selected: false }, { value: 32, label: null, count: 1, selected: false }] },
    ] });
    expect(getAttributeFilterOptions(fixture.lq, { categoryCode: "root.other" }).attributes).toEqual([]);
    expect(getAttributeFilterOptions(fixture.lq, { categoryCode: "root" }).attributes.map(a => a.code)).toEqual(["poles", "rated_current", "rcd_type"]);
    expect(() => getAttributeFilterOptions(fixture.lq, { categoryCode: "absent" })).toThrow(InvalidCatalogueFilterError);
  });
});

describe("BTI description parser rules", () => {
  const parse = (description: string) => {
    const result = btiDescriptionParser.parse({ description });
    return { values: Object.fromEntries([...result.values].map(([code, value]) => [code, value.value])), ambiguous: result.ambiguous };
  };
  it.each([
    ["btdin60 - magnetot 1P curva B 16A 6kA", { poles: "1p", trip_curve: "b", rated_current: 16, declared_breaking_capacity: 6 }],
    ["btdin45 - magnetot 1P+N curva B 0,5A 4,5kA", { poles: "1p_n", trip_curve: "b", rated_current: 0.5, declared_breaking_capacity: 4.5 }],
    ["BTDIN MCB 4P CURVA K 1A 10kA", { poles: "4p", trip_curve: "k", rated_current: 1, declared_breaking_capacity: 10 }],
    ["btdin 250 - solo magnet 125 Im 2P 10A 25kA", { poles: "2p", declared_breaking_capacity: 25 }],
    ["btdin - magnetot. 2P 600VDC 6A", { poles: "2p", rated_current: 6 }],
    ["btdin-RS - mag. diff  AC 1P+N 30mA 10A 4500", { poles: "1p_n", rated_current: 10, declared_breaking_capacity: 4.5,
      rated_residual_current: 30, residual_current_type: "ac" }],
    ["btdin60 - magn dif F 1PN 25 6000A 30mA", { poles: "1p_n", declared_breaking_capacity: 6, rated_residual_current: 30, residual_current_type: "f" }],
    ["btdin - differ puro AS 4P 25A 300mA", { residual_current_type: "a", poles: "4p", rated_current: 25, rated_residual_current: 300 }],
    ["BTDIN-BDA G2 32A 2P 300mA A-S", { rated_current: 32, poles: "2p", rated_residual_current: 300, residual_current_type: "a" }],
    ["btdin - differ puro A 4P 25A 300ma", { residual_current_type: "a", poles: "4p", rated_current: 25, rated_residual_current: 300 }],
    ["btdin-RS -  diff. puro AC 2P 25A 30mA?", { residual_current_type: "ac", poles: "2p", rated_current: 25, rated_residual_current: 30 }],
    ["btdin - RCD type B 30mA 2P 40A", { residual_current_type: "b", rated_residual_current: 30, poles: "2p", rated_current: 40 }],
    ["btdin - differenziale AC 2P fino 63A 300mA", { residual_current_type: "ac", poles: "2p", rated_current: 63, rated_residual_current: 300 }],
    ["BTDIN STOP ARC 1P+N C10 4500A", { poles: "1p_n", trip_curve: "c", rated_current: 10, declared_breaking_capacity: 4.5 }],
  ])("parses %s", (description, expected) => {
    expect(parse(description)).toEqual({ values: expected, ambiguous: [] });
  });

  it("never reads a trip curve letter as a residual-current type", () => {
    expect(parse("btdin60 - magnetot 2P curva B 16A 6kA").values).not.toHaveProperty("residual_current_type");
    expect(parse("magn diff curva A 1P+N 30mA").values).not.toHaveProperty("residual_current_type");
  });

  it("accepts a bare ampere breaking capacity only as the last token of a full 43-character field", () => {
    const full = "btdin-RS - mag. diff  AC 1P+N 30mA 10A 4500";
    expect(full).toHaveLength(43);
    expect(parse(full).values.declared_breaking_capacity).toBe(4.5);
    expect(parse("btdin - mag. diff AC 1P+N 30mA 10A 4500").values).not.toHaveProperty("declared_breaking_capacity");
    expect(parse("btdin-RS - mag. diff  AC 1P+N 4500 30mA 10A").values).not.toHaveProperty("declared_breaking_capacity");
  });

  it("marks conflicting candidates ambiguous instead of choosing one", () => {
    expect(parse("magnetot 1P 2P curva C 16A 20A 6kA 10kA 30mA 300mA A AC")).toEqual({ values: { trip_curve: "c" },
      ambiguous: ["declared_breaking_capacity", "poles", "rated_current", "rated_residual_current", "residual_current_type"] });
    expect(parse("magnetot 1P curva C C16 16A").values).toEqual({ poles: "1p", trip_curve: "c", rated_current: 16 });
  });

  it("does not read DIN modules, voltage or bare numbers", () => {
    expect(parse("btdin-RS-magnetot 1P+N 2m 230V 16 1000").values).toEqual({ poles: "1p_n" });
  });
});

describe("disjunctive facet counts", () => {
  type Request = { query?: string; listedOnly?: boolean; attributeFilters?: CatalogueAttributeFilter[] };
  // Breakers: B1 2p/16, B5 1p/16, B6 4p/32, B7 2p/32, and B2 (brand without parser).
  beforeEach(() => deliver([...standard,
    { marchio: "TST", code: "B5", statisticalFamily: "BRK", description: "poles=1p rated_current=16" },
    { marchio: "TST", code: "B6", statisticalFamily: "BRK", description: "poles=4p rated_current=32" },
    { marchio: "TST", code: "B7", statisticalFamily: "BRK", description: "poles=2p rated_current=32" },
  ]));
  const facets = (request: Request, categoryCode = "root.breakers") => {
    const options = getAttributeFilterOptions(fixture.lq, { categoryCode, ...request });
    return { total: options.totalCount, ...Object.fromEntries(options.attributes.map(a =>
      [a.code, Object.fromEntries(a.values.map(v => [String(v.value), v.selected ? `${v.count}*` : v.count]))])) };
  };
  /** Every count equals the result count of the search with that value as the attribute's only selection. */
  const assertMatchesSearch = (request: Request, categoryCode = "root.breakers") => {
    const count = (filters: CatalogueAttributeFilter[]) =>
      searchCatalogue(fixture.lq, { query: request.query ?? "", categoryCode, listedOnly: request.listedOnly, attributeFilters: filters, limit: 200 }).products.length;
    const options = getAttributeFilterOptions(fixture.lq, { categoryCode, ...request });
    const others = (code: string) => (request.attributeFilters ?? []).filter(f => f.attributeCode !== code);
    expect(options.totalCount).toBe(count(request.attributeFilters ?? []));
    for (const attribute of options.attributes) {
      for (const value of attribute.values) {
        expect(value.count, `${attribute.code}=${value.value}`).toBe(count([...others(attribute.code), { attributeCode: attribute.code, values: [value.value] }]));
      }
    }
  };

  it("A: keeps alternatives of a selected attribute with their counts", () => {
    const request = { attributeFilters: [{ attributeCode: "poles", values: ["2p"] }] };
    expect(facets(request)).toEqual({ total: 2, poles: { "1p": 1, "2p": "2*", "4p": 1 }, rated_current: { 16: 1, 32: 1 } });
    assertMatchesSearch(request);
  });

  it("B: counts each facet with the other attribute's filter but not its own", () => {
    const request = { attributeFilters: [{ attributeCode: "poles", values: ["2p"] }, { attributeCode: "rated_current", values: [32] }] };
    expect(facets(request)).toEqual({ total: 1, poles: { "1p": 0, "2p": "1*", "4p": 1 }, rated_current: { 16: 1, 32: "1*" } });
    assertMatchesSearch(request);
  });

  it("C: ORs two values of one attribute in results while its own counts stay disjunctive", () => {
    const request = { attributeFilters: [{ attributeCode: "poles", values: ["1p", "2p"] }] };
    expect(searchCatalogue(fixture.lq, { query: "", categoryCode: "root.breakers", ...request }).products.map(p => p.manufacturerCode))
      .toEqual(["B1", "B5", "B7"]);
    expect(facets(request)).toEqual({ total: 3, poles: { "1p": "1*", "2p": "2*", "4p": 1 }, rated_current: { 16: 2, 32: 1 } });
    assertMatchesSearch(request);
  });

  it("D and G: ANDs attributes and keeps selected values visible at zero", () => {
    const request = { attributeFilters: [{ attributeCode: "poles", values: ["4p"] }, { attributeCode: "rated_current", values: [16] }] };
    expect(searchCatalogue(fixture.lq, { query: "", categoryCode: "root.breakers", ...request }).products).toEqual([]);
    expect(facets(request)).toEqual({ total: 0, poles: { "1p": 1, "2p": 1, "4p": "0*" }, rated_current: { 16: "0*", 32: 1 } });
    assertMatchesSearch(request);
  });

  it("E: counts only products matching the current search text", () => {
    const request = { query: "rated_current=32" };
    expect(facets(request)).toEqual({ total: 2, poles: { "1p": 0, "2p": 1, "4p": 1 }, rated_current: { 16: 0, 32: 2 } });
    assertMatchesSearch(request);
    assertMatchesSearch({ query: "B", attributeFilters: [{ attributeCode: "poles", values: ["2p", "4p"] }] });
  });

  it("F and G: follows the listed scope, and still shows a selected value outside it", () => {
    deliver([{ marchio: "TST", code: "B1", statisticalFamily: "BRK", description: "poles=2p rated_current=16" },
      { marchio: "TST", code: "B5", statisticalFamily: "BRK", description: "poles=1p rated_current=16" }]);
    expect(facets({ listedOnly: true })).toEqual({ total: 2, poles: { "1p": 1, "2p": 1 }, rated_current: { 16: 2 } });
    expect(facets({})).toEqual({ total: 5, poles: { "1p": 1, "2p": 2, "4p": 1 }, rated_current: { 16: 2, 32: 2 } });
    const selected = { listedOnly: true, attributeFilters: [{ attributeCode: "poles", values: ["4p"] }] };
    expect(facets(selected)).toEqual({ total: 0, poles: { "1p": 1, "2p": 1, "4p": "0*" }, rated_current: { 16: 0 } });
    for (const request of [{ listedOnly: true }, {}, selected]) assertMatchesSearch(request);
  });

  it("covers the whole subtree without leaking other categories or brands", () => {
    expect(facets({}, "root")).toEqual({ total: 7, poles: { "1p": 1, "2p": 2, "4p": 2 }, rated_current: { 16: 2, 32: 2 }, rcd_type: { ac: 1 } });
    expect(facets({ attributeFilters: [{ attributeCode: "rcd_type", values: ["ac"] }] }, "root"))
      .toEqual({ total: 1, poles: { "1p": 0, "2p": 0, "4p": 1 }, rated_current: { 16: 0, 32: 0 }, rcd_type: { ac: "1*" } });
    assertMatchesSearch({ attributeFilters: [{ attributeCode: "poles", values: ["4p"] }] }, "root");
  });

  it.each([
    ["unknown category", "absent", [{ attributeCode: "poles", values: ["2p"] }]],
    ["inapplicable attribute", "root.breakers", [{ attributeCode: "rcd_type", values: ["a"] }]],
    ["unknown attribute", "root.breakers", [{ attributeCode: "absent", values: ["2p"] }]],
    ["unknown option", "root.breakers", [{ attributeCode: "poles", values: ["9p"] }]],
    ["number for enum", "root.breakers", [{ attributeCode: "poles", values: [2] }]],
    ["option for number", "root.breakers", [{ attributeCode: "rated_current", values: ["16"] }]],
  ])("H: rejects %s exactly like search", (_label, categoryCode, attributeFilters) => {
    expect(() => getAttributeFilterOptions(fixture.lq, { categoryCode, attributeFilters })).toThrow(InvalidCatalogueFilterError);
    expect(() => searchCatalogue(fixture.lq, { query: "", categoryCode, attributeFilters })).toThrow(InvalidCatalogueFilterError);
  });
});
