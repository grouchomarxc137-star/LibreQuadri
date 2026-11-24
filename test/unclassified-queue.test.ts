import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCatalogueOverview, getUnclassifiedFamilies, searchCatalogue } from "../src/main/catalogue/catalogue-queries.js";
import { createCatalogueFixture, type CatalogueFixture } from "./helpers/catalogue-fixtures.js";

let fixture: CatalogueFixture;
beforeEach(() => { fixture = createCatalogueFixture(); });
afterEach(() => fixture.close());

describe("derived unclassified queue", () => {
  it("returns an empty page without materializing review records", () => {
    expect(getUnclassifiedFamilies(fixture.lq)).toEqual({ groups: [], offset: 0, hasMore: false });
    expect(fixture.lq.prepare("SELECT name FROM sqlite_schema WHERE name = 'cat_review_item'").get()).toBeUndefined();
  });

  it("groups by governing issuer, brand and family and keeps listed/total counts distinct", () => {
    fixture.importDelivery({ issuer: "BTI", listino: "1", validFrom: "2026-01-01", products: [
      { marchio: "BTI", code: "P1", statisticalFamily: "MIX" },
      { marchio: "BTI", code: "P2", statisticalFamily: "MIX" },
      { marchio: "BTI", code: "P3", statisticalFamily: "MIX" },
      { marchio: "LEG", code: "P4", statisticalFamily: "MIX" },
      { marchio: "BTI", code: "P5" },
    ] });
    fixture.importDelivery({ issuer: "BTI", listino: "2", validFrom: "2027-01-01", products: [
      { marchio: "BTI", code: "P1", statisticalFamily: "MIX" },
      { marchio: "BTI", code: "P3", statisticalFamily: "MIX" },
      { marchio: "LEG", code: "P4", statisticalFamily: "MIX" },
      { marchio: "BTI", code: "P5" },
    ] });
    fixture.importDelivery({ issuer: "DIST", listino: "1", validFrom: "2028-01-01", products: [{ marchio: "BTI", code: "P6", statisticalFamily: "MIX" }] });
    fixture.lq.exec(`UPDATE cat_product SET category_source = 'manual', category_id = (SELECT id FROM cat_category WHERE code = 'protezione') WHERE manufacturer_code = 'P3';
      UPDATE cat_metel_family SET description = 'Mixed family' WHERE code = 'MIX'`);
    const groups = getUnclassifiedFamilies(fixture.lq).groups;
    expect(groups.map(g => [g.issuerSigla, g.brandMarchio, g.familyCode])).toEqual([
      ["BTI", "BTI", null], ["BTI", "BTI", "MIX"], ["BTI", "LEG", "MIX"], ["DIST", "BTI", "MIX"],
    ]);
    const mixed = groups[1];
    expect(mixed).toMatchObject({ familyDescription: "Mixed family", unclassifiedCount: 1, listedCount: 2, totalCount: 3, examples: ["BTI P1"] });
    const reviewGroup = { issuerId: mixed.issuerId, brandId: mixed.brandId, statisticalFamilyId: mixed.statisticalFamilyId };
    expect(searchCatalogue(fixture.lq, { query: "", reviewGroup }).products.map(p => p.manufacturerCode)).toEqual(["P1"]);
    expect(searchCatalogue(fixture.lq, { query: "", reviewGroup, listedOnly: false }).products.map(p => p.manufacturerCode)).toEqual(["P1", "P2"]);
    expect(searchCatalogue(fixture.lq, { query: "P3", reviewGroup }).products).toEqual([]);
    expect(getUnclassifiedFamilies(fixture.lq, { listedOnly: false }).groups[1].unclassifiedCount).toBe(2);
    expect(getCatalogueOverview(fixture.lq)).toMatchObject({ classifiedProductCount: 1, unclassifiedProductCount: 5, listedClassifiedProductCount: 1, listedUnclassifiedProductCount: 4 });
    const page = getUnclassifiedFamilies(fixture.lq, { limit: 2, offset: 0 });
    expect(page.hasMore).toBe(true);
    expect(getUnclassifiedFamilies(fixture.lq, { limit: 2, offset: 2 })).toEqual({ groups: groups.slice(2), hasMore: false, offset: 2 });
    // Still works with only normalized data available.
    fixture.raw.exec("DROP TABLE family_row; DROP TABLE price_list_row; DROP TABLE raw_file;");
    expect(getUnclassifiedFamilies(fixture.lq).groups).toEqual(groups);
  });

  it("keeps examples deterministic and bounded and supports null governing issuer/family", () => {
    fixture.importDelivery({ issuer: "ONE", listino: "1", validFrom: "2026-01-01", products: Array.from({ length: 6 }, (_, i) => ({ marchio: "AAA", code: `P${5 - i}` })) });
    fixture.lq.exec("UPDATE cat_product SET governing_issuer_id = NULL");
    const group = getUnclassifiedFamilies(fixture.lq).groups[0];
    expect(group).toMatchObject({ issuerId: null, statisticalFamilyId: null, examples: ["AAA P0", "AAA P1", "AAA P2"], unclassifiedCount: 6 });
    const result = searchCatalogue(fixture.lq, { query: "", reviewGroup: { issuerId: null, brandId: group.brandId, statisticalFamilyId: null }, limit: 2 });
    expect(result.products.map(p => p.manufacturerCode)).toEqual(["P0", "P1"]);
    expect(result.hasMore).toBe(true);
  });
});
