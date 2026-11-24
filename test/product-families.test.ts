import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { synchronizeAttributeSeed } from "../src/main/catalogue/attribute-seed.js";
import { InvalidCatalogueFilterError } from "../src/main/catalogue/attribute-queries.js";
import { synchronizeCategorySeed } from "../src/main/catalogue/category-seed.js";
import {
  getConditionallyAvailableFamilyValues,
  getFamilyAxes,
  resolveFamilySelection,
  validateFamily,
} from "../src/main/catalogue/family-queries.js";
import {
  groupProductFamilies,
  setManualFamilyAssignment,
  setManualFamilyExclusion,
} from "../src/main/catalogue/family-grouping.js";
import { loadProductFamilySeed, synchronizeProductFamilySeed } from "../src/main/catalogue/family-seed.js";
import { btiMcbFamilyGrouper } from "../src/main/catalogue/groupers/bti-mcb.js";
import { FAMILY_GROUPERS } from "../src/main/catalogue/groupers/index.js";
import { createCatalogueFixture, type CatalogueFixture } from "./helpers/catalogue-fixtures.js";

const familyProducts = [
  { marchio: "BTI", code: "FA81C10", description: "btdin45 - magnetot 1P curva C 10A 4,5kA", statisticalFamily: "IND.-112-5-11" },
  { marchio: "BTI", code: "FA81C16", description: "btdin45 - magnetot 1P curva C 16A 4,5kA", statisticalFamily: "IND.-112-5-11" },
  { marchio: "BTI", code: "FA881C10", description: "btdin45 - magnetot 1P+N curva C 10A 4,5kA", statisticalFamily: "IND.-112-5-11" },
  { marchio: "BTI", code: "FV82SM125", description: "btdin250 - solo magn 2P 125A 25kA", statisticalFamily: "IND.-112-5-22" },
  { marchio: "BTI", code: "F82N06FV1", description: "interruttore DC 2P 6A", statisticalFamily: "IND.-115-20-124" },
  { marchio: "LEG", code: "FA81C10", description: "btdin45 - magnetot 1P curva C 10A 4,5kA", statisticalFamily: "IND.-112-5-11" },
] as const;

const productId = (fixture: CatalogueFixture, code: string, marchio = "BTI") => fixture.lq.prepare(`
  SELECT p.id FROM cat_product p JOIN cat_brand b ON b.id = p.brand_id
  WHERE b.metel_marchio = ? AND p.manufacturer_code = ?
`).pluck().get(marchio, code) as number;

describe("configurable product families", () => {
  let fixture: CatalogueFixture;

  beforeEach(() => {
    fixture = createCatalogueFixture();
    fixture.importDelivery({ issuer: "BTI", listino: "1", validFrom: "20260901", products: familyProducts });
  });

  afterEach(() => fixture.close());

  it("materializes the ten seed definitions with ordered axes and protects manual definitions", () => {
    expect(fixture.lq.prepare("SELECT COUNT(*) FROM cat_product_family").pluck().get()).toBe(10);
    expect(getFamilyAxes(fixture.lq, "BTI", "btdin45").axes.map(axis => axis.code))
      .toEqual(["poles", "trip_curve", "rated_current"]);
    fixture.lq.prepare("UPDATE cat_product_family SET name = 'Custom', source = 'manual' WHERE code = 'btdin45'").run();
    const changed = loadProductFamilySeed().map(row => row.code === "btdin45" ? { ...row, name: "Seed replacement" } : row);
    synchronizeProductFamilySeed(fixture.lq, changed);
    expect(fixture.lq.prepare("SELECT name FROM cat_product_family WHERE code = 'btdin45'").pluck().get()).toBe("Custom");
    expect(synchronizeProductFamilySeed(fixture.lq, changed)).toMatchObject({ deferred: 0, regrouped: false, grouping: null });
  });

  it("defers family definitions until brand, category and axes are available", () => {
    const empty = createCatalogueFixture();
    try {
      synchronizeCategorySeed(empty.lq);
      synchronizeAttributeSeed(empty.lq);
      expect(synchronizeProductFamilySeed(empty.lq)).toMatchObject({ deferred: 10 });
      expect(empty.lq.prepare("SELECT COUNT(*) FROM cat_product_family").pluck().get()).toBe(0);
      empty.importDelivery({ issuer: "BTI", listino: "1", validFrom: "20260901", products: [familyProducts[0]] });
      expect(empty.lq.prepare("SELECT COUNT(*) FROM cat_product_family").pluck().get()).toBe(10);
      expect(empty.lq.prepare("SELECT COUNT(*) FROM cat_product_family_assignment WHERE state = 'grouper'").pluck().get()).toBe(1);
    } finally {
      empty.close();
    }
  });

  it("groups only corroborated BTI products and preserves protected states and delisted membership", () => {
    const assignments = () => fixture.lq.prepare(`
      SELECT p.manufacturer_code AS code, f.code AS family, fa.state
      FROM cat_product_family_assignment fa JOIN cat_product p ON p.id = fa.product_id
      LEFT JOIN cat_product_family f ON f.id = fa.family_id ORDER BY p.manufacturer_code
    `).all();
    expect(assignments()).toEqual([
      { code: "FA81C10", family: "btdin45", state: "grouper" },
      { code: "FA81C16", family: "btdin45", state: "grouper" },
      { code: "FA881C10", family: "btdin45_1pn_881", state: "grouper" },
    ]);
    expect(groupProductFamilies(fixture.lq, FAMILY_GROUPERS)).toEqual({ inserted: 0, updated: 0, removed: 0, rejected: 0, protected: 0 });
    expect(groupProductFamilies(fixture.lq, FAMILY_GROUPERS)).toEqual({ inserted: 0, updated: 0, removed: 0, rejected: 0, protected: 0 });

    const btdin60 = fixture.lq.prepare("SELECT id FROM cat_product_family WHERE code = 'btdin60'").pluck().get() as number;
    setManualFamilyAssignment(fixture.lq, productId(fixture, "FA81C10"), btdin60);
    setManualFamilyExclusion(fixture.lq, productId(fixture, "FA81C16"));
    groupProductFamilies(fixture.lq, FAMILY_GROUPERS);
    fixture.importDelivery({ issuer: "BTI", listino: "2", validFrom: "20261001", products: [] });

    expect(fixture.lq.prepare(`SELECT state, family_id AS familyId FROM cat_product_family_assignment
      WHERE product_id = ?`).get(productId(fixture, "FA81C10"))).toEqual({ state: "manual", familyId: btdin60 });
    expect(fixture.lq.prepare(`SELECT state, family_id AS familyId FROM cat_product_family_assignment
      WHERE product_id = ?`).get(productId(fixture, "FA81C16"))).toEqual({ state: "manual_excluded", familyId: null });
    expect(fixture.lq.prepare(`SELECT fa.state, p.is_listed AS listed FROM cat_product_family_assignment fa
      JOIN cat_product p ON p.id = fa.product_id WHERE p.manufacturer_code = 'FA881C10'`).get())
      .toEqual({ state: "grouper", listed: 0 });
  });

  it("rejects contradictions and unknown family proposals without fuzzy matching", () => {
    const base = {
      productId: 1, manufacturerCode: "FN81B16", description: "btdin60 - magnetot 1P curva B 16A 6kA",
      brandMarchio: "BTI", categoryCode: "protezione.interruttori_automatici",
      statisticalFamilyCode: "IND.-112-5-15", statisticalFamilyIssuerSigla: "BTI",
      attributes: new Map([["declared_breaking_capacity", 6]]),
    } as const;
    expect(btiMcbFamilyGrouper.propose(base)).toBe("btdin60");
    expect(btiMcbFamilyGrouper.propose({ ...base, description: "BTDIN100 magnetot 1P curva B 16A 6kA" })).toBeNull();
    expect(btiMcbFamilyGrouper.propose({ ...base, statisticalFamilyCode: "IND.-112-5-19" })).toBeNull();
    expect(btiMcbFamilyGrouper.propose({ ...base, statisticalFamilyIssuerSigla: "SIE" })).toBeNull();
    expect(btiMcbFamilyGrouper.propose({ ...base, attributes: new Map([["declared_breaking_capacity", 10]]) })).toBeNull();
    expect(btiMcbFamilyGrouper.propose({ ...base, manufacturerCode: "FN81B16-extra" })).toBeNull();
    expect(btiMcbFamilyGrouper.propose({ ...base, description: "magnetot 1P curva B 16A 6kA" })).toBe("btdin60");

    const unknown = new Map([["BTI", { code: "test.unknown", version: "1", propose: () => "does_not_exist" }]]);
    expect(groupProductFamilies(fixture.lq, unknown)).toMatchObject({ removed: 3, rejected: 5 });
  });

  it("deactivates an existing seed family even while dependencies are deferred", () => {
    const familyId = fixture.lq.prepare("SELECT id FROM cat_product_family WHERE code = 'btdin45'").pluck().get() as number;
    setManualFamilyAssignment(fixture.lq, productId(fixture, "FA81C10"), familyId);
    fixture.lq.prepare(`DELETE FROM cat_category_attribute
      WHERE category_id = (SELECT id FROM cat_category WHERE code = 'protezione.interruttori_automatici')
        AND attribute_id = (SELECT id FROM cat_attribute WHERE code = 'trip_curve')`).run();
    const retired = loadProductFamilySeed().map(row => row.code === "btdin45" ? { ...row, active: false } : row);
    const result = synchronizeProductFamilySeed(fixture.lq, retired);
    expect(result.deferred).toBeGreaterThan(0);
    expect(fixture.lq.prepare("SELECT active FROM cat_product_family WHERE id = ?").pluck().get(familyId)).toBe(0);
    expect(fixture.lq.prepare(`SELECT state FROM cat_product_family_assignment WHERE product_id = ?`)
      .pluck().get(productId(fixture, "FA81C10"))).toBe("manual");
    expect(fixture.lq.prepare(`SELECT COUNT(*) FROM cat_product_family_assignment
      WHERE family_id = ? AND state = 'grouper'`).pluck().get(familyId)).toBe(0);
  });

  it("treats the materialized category as an immutable family contract", () => {
    const moved = loadProductFamilySeed().map(row => row.code === "btdin45"
      ? { ...row, categoryCode: "protezione.magnetotermici_differenziali" } : row);
    expect(() => synchronizeProductFamilySeed(fixture.lq, moved)).toThrow(/category contract cannot change/);
    const deferredMove = loadProductFamilySeed().map(row => row.code === "btdin45"
      ? { ...row, categoryCode: "protezione.non_esistente" } : row);
    expect(() => synchronizeProductFamilySeed(fixture.lq, deferredMove)).toThrow(/category contract cannot change/);
    expect(getFamilyAxes(fixture.lq, "BTI", "btdin45").categoryCode)
      .toBe("protezione.interruttori_automatici");
  });

  it("retires omitted families, protects manual membership and prevents code reuse", () => {
    const familyId = fixture.lq.prepare("SELECT id FROM cat_product_family WHERE code = 'btdin45'").pluck().get() as number;
    setManualFamilyAssignment(fixture.lq, productId(fixture, "FA81C10"), familyId);
    const omitted = loadProductFamilySeed().filter(row => row.code !== "btdin45");
    synchronizeProductFamilySeed(fixture.lq, omitted);
    expect(fixture.lq.prepare("SELECT active FROM cat_product_family WHERE id = ?").pluck().get(familyId)).toBe(0);
    expect(fixture.lq.prepare(`SELECT state FROM cat_product_family_assignment WHERE product_id = ?`)
      .pluck().get(productId(fixture, "FA81C10"))).toBe("manual");
    expect(fixture.lq.prepare(`SELECT COUNT(*) FROM cat_product_family_assignment
      WHERE family_id = ? AND state = 'grouper'`).pluck().get(familyId)).toBe(0);
    expect(() => synchronizeProductFamilySeed(fixture.lq, loadProductFamilySeed()))
      .toThrow(/retired family code cannot be reused/);
  });

  it("fully regroups after a grouper version change and no-ops when unchanged", () => {
    const bumped = new Map(FAMILY_GROUPERS);
    bumped.set("BTI", { ...btiMcbFamilyGrouper, version: "review-bump" });
    expect(synchronizeProductFamilySeed(fixture.lq, undefined, { groupers: bumped }))
      .toMatchObject({ regrouped: true, grouping: { updated: 3 } });
    expect(synchronizeProductFamilySeed(fixture.lq, undefined, { groupers: bumped }))
      .toMatchObject({ regrouped: false, grouping: null });
  });

  it("rejects mistyped, non-finite, unknown and inactive axis selections", () => {
    const resolve = (selection: Record<string, string | number>) =>
      resolveFamilySelection(fixture.lq, "BTI", "btdin45", selection);
    expect(() => resolve({ poles: "1p", trip_curve: "c", rated_current: "10" }))
      .toThrow(InvalidCatalogueFilterError);
    expect(() => resolve({ poles: "1p", trip_curve: "c", rated_current: Number.NaN }))
      .toThrow(InvalidCatalogueFilterError);
    expect(() => resolve({ poles: "1p", trip_curve: "q", rated_current: 10 }))
      .toThrow(InvalidCatalogueFilterError);
    expect(() => getConditionallyAvailableFamilyValues(fixture.lq, "BTI", "btdin45", "poles",
      { trip_curve: "c", rated_current: "10" })).toThrow(InvalidCatalogueFilterError);
    expect(() => resolve({ poles: "1p", trip_curve: "c", rated_current: 10, unknown: "x" }))
      .toThrow(InvalidCatalogueFilterError);
    fixture.lq.prepare(`UPDATE cat_attribute_option SET active = 0
      WHERE attribute_id = (SELECT id FROM cat_attribute WHERE code = 'trip_curve') AND value = 'c'`).run();
    expect(() => resolve({ poles: "1p", trip_curve: "c", rated_current: 10 }))
      .toThrow(InvalidCatalogueFilterError);
    expect(() => getConditionallyAvailableFamilyValues(fixture.lq, "BTI", "btdin45", "rated_current",
      { poles: "1p", trip_curve: "c" })).toThrow(InvalidCatalogueFilterError);
  });

  it("reports duplicate tuples as conflicts even when one member is delisted", () => {
    const second = productId(fixture, "FA81C16");
    fixture.lq.prepare(`UPDATE cat_product_attribute SET value_num = 10 WHERE product_id = ?
      AND attribute_id = (SELECT id FROM cat_attribute WHERE code = 'rated_current')`).run(second);
    fixture.lq.prepare("UPDATE cat_product SET is_listed = 0 WHERE id = ?").run(second);
    expect(validateFamily(fixture.lq, "BTI", "btdin45").filter(issue => issue.code === "duplicate_axis_tuple"))
      .toHaveLength(2);
    expect(resolveFamilySelection(fixture.lq, "BTI", "btdin45",
      { poles: "1p", trip_curve: "c", rated_current: 10 }).status).toBe("conflict");
  });

  it("rolls normalization back when family synchronization rejects a contract change", () => {
    const moved = loadProductFamilySeed().map(row => row.code === "btdin45"
      ? { ...row, categoryCode: "protezione.magnetotermici_differenziali" } : row);
    const deliveriesBefore = fixture.lq.prepare("SELECT COUNT(*) FROM app_import_delivery").pluck().get();
    expect(() => fixture.importDelivery({ issuer: "BTI", listino: "2", validFrom: "20261001", products: familyProducts },
      undefined, { familySeed: moved })).toThrow(/category contract cannot change/);
    expect(fixture.lq.prepare("SELECT COUNT(*) FROM app_import_delivery").pluck().get()).toBe(deliveriesBefore);
    expect(fixture.lq.prepare("SELECT COUNT(*) FROM com_price_list").pluck().get()).toBe(1);
  });

  it("derives conflicts and resolves actual sparse members with listing metadata", () => {
    expect(validateFamily(fixture.lq, "BTI", "btdin45")).toEqual([]);
    expect(resolveFamilySelection(fixture.lq, "BTI", "btdin45", { poles: "1p", trip_curve: "c" }))
      .toEqual({ status: "incomplete", missingAxisCodes: ["rated_current"] });
    expect(resolveFamilySelection(fixture.lq, "BTI", "btdin45", { poles: "1p", trip_curve: "c", rated_current: 10 }))
      .toMatchObject({ status: "resolved", manufacturerCode: "FA81C10", isListed: true, lifecycleStatusCode: "1" });
    expect(resolveFamilySelection(fixture.lq, "BTI", "btdin45", { poles: "2p", trip_curve: "c", rated_current: 10 }))
      .toEqual({ status: "not_offered" });
    expect(getConditionallyAvailableFamilyValues(fixture.lq, "BTI", "btdin45", "rated_current", { poles: "1p", trip_curve: "c" })
      .map(value => value.value)).toEqual([10, 16]);

    fixture.lq.prepare(`DELETE FROM cat_product_attribute WHERE product_id = ?
      AND attribute_id = (SELECT id FROM cat_attribute WHERE code = 'poles')`).run(productId(fixture, "FA881C10"));
    expect(validateFamily(fixture.lq, "BTI", "btdin45_1pn_881").map(issue => issue.code))
      .toContain("missing_axis_value");

    const first = productId(fixture, "FA81C10");
    const second = productId(fixture, "FA81C16");
    fixture.lq.prepare(`UPDATE cat_product_attribute SET value_num = 10 WHERE product_id = ?
      AND attribute_id = (SELECT id FROM cat_attribute WHERE code = 'rated_current')`).run(second);
    fixture.lq.prepare(`UPDATE cat_attribute_option SET active = 0 WHERE attribute_id =
      (SELECT id FROM cat_attribute WHERE code = 'trip_curve') AND value = 'c'`).run();
    fixture.lq.prepare("UPDATE cat_product SET category_id = NULL WHERE id = ?").run(first);
    fixture.lq.prepare("UPDATE cat_product SET brand_id = (SELECT id FROM cat_brand WHERE metel_marchio = 'LEG') WHERE id = ?").run(second);
    fixture.lq.prepare("UPDATE cat_product_family SET active = 0 WHERE code = 'btdin45'").run();
    const codes = new Set(validateFamily(fixture.lq, "BTI", "btdin45").map(issue => issue.code));
    expect(codes).toEqual(new Set(["duplicate_axis_tuple", "brand_mismatch", "category_mismatch", "inactive_family", "inactive_value"]));
    expect(() => resolveFamilySelection(fixture.lq, "BTI", "btdin45",
      { poles: "1p", trip_curve: "c", rated_current: 10 })).toThrow(InvalidCatalogueFilterError);
  });
});
