import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  escapeLike,
  getCatalogueOverview,
  parseSearchTerms,
  searchCatalogue,
} from "../src/main/catalogue/catalogue-queries.js";
import type { CatalogueSearchRequest } from "../src/shared/catalogue.js";
import {
  createCatalogueFixture,
  type CatalogueFixture,
  type FixtureProduct,
} from "./helpers/catalogue-fixtures.js";

let fixture: CatalogueFixture;

beforeEach(() => {
  fixture = createCatalogueFixture();
});

afterEach(() => {
  fixture.close();
});

function search(query: string, paging: Omit<CatalogueSearchRequest, "query"> = {}) {
  return searchCatalogue(fixture.lq, { query, ...paging });
}

function codes(query: string, paging: Omit<CatalogueSearchRequest, "query"> = {}) {
  return search(query, paging).products.map((product) => product.manufacturerCode);
}

function importBti(
  products: readonly FixtureProduct[],
  validFrom = "2026-01-01",
  listino = "001",
) {
  return fixture.importDelivery({ issuer: "BTI", listino, validFrom, products });
}

describe("search term parsing", () => {
  it("splits on whitespace and drops tokens without letters or digits", () => {
    const parsed = parseSearchTerms("  btdin60  -  magnetot / 16A ");
    expect(parsed?.terms.map((term) => term.text)).toEqual([
      "btdin60",
      "magnetot",
      "16A",
    ]);
  });

  it("reduces each token to its normalized code form", () => {
    expect(parseSearchTerms("3RV2011-1AA10")?.terms[0]?.codeNorm).toBe(
      "3RV20111AA10",
    );
  });

  it("returns null when nothing searchable remains", () => {
    expect(parseSearchTerms("")).toBeNull();
    expect(parseSearchTerms("   ")).toBeNull();
    expect(parseSearchTerms(" - / % ")).toBeNull();
  });

  it("escapes LIKE wildcards and the escape character", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
  });
});

describe("catalogue search matching", () => {
  it("returns nothing for a blank or punctuation-only query", () => {
    importBti([{ marchio: "BTI", code: "F81" }]);
    expect(search("").products).toEqual([]);
    expect(search("  -  ").products).toEqual([]);
    expect(search("").hasMore).toBe(false);
  });

  it("ranks exact code, then prefix, then contains, then description matches", () => {
    importBti([
      { marchio: "BTI", code: "ABC", description: "adattatore per LC1D09" },
      { marchio: "BTI", code: "XLC1D09", description: "supporto" },
      { marchio: "BTI", code: "LC1D09E", description: "contattore" },
      { marchio: "BTI", code: "LC1D09BD", description: "contattore" },
      { marchio: "BTI", code: "LC1D09", description: "contattore" },
      { marchio: "BTI", code: "LC1-D09", description: "contattore" },
    ]);

    expect(codes("LC1D09")).toEqual([
      "LC1-D09", // same normalized code as LC1D09: both exact, ordered by code
      "LC1D09",
      "LC1D09BD",
      "LC1D09E",
      "XLC1D09",
      "ABC",
    ]);
  });

  it("ranks every code token independently of token order", () => {
    importBti([
      {
        marchio: "BTI",
        code: "LC1D09",
        description: "contattore 3P 400V 9A",
      },
      ...Array.from({ length: 60 }, (_, index) => ({
        marchio: "BTI",
        code: `AAA${String(index).padStart(3, "0")}`,
        description: "contattore compatibile con LC1D09",
      })),
    ]);

    const descriptionFirst = codes("contattore LC1D09", { limit: 50 });
    const codeFirst = codes("LC1D09 contattore", { limit: 50 });

    expect(descriptionFirst[0]).toBe("LC1D09");
    expect(codeFirst[0]).toBe("LC1D09");
    expect(descriptionFirst).toEqual(codeFirst);
  });

  it("ranks an exact EAN with exact identifiers", () => {
    importBti([
      { marchio: "BTI", code: "EAN-TARGET", ean: "8014496006615" },
      { marchio: "BTI", code: "8014496006615X" },
      { marchio: "BTI", code: "X8014496006615" },
      {
        marchio: "BTI",
        code: "DESC-MATCH",
        description: "compatibile con 8014496006615",
      },
    ]);

    expect(codes("8014496006615")).toEqual([
      "EAN-TARGET",
      "8014496006615X",
      "X8014496006615",
      "DESC-MATCH",
    ]);
  });

  it("accepts only complete non-placeholder EAN values", () => {
    importBti([
      { marchio: "BTI", code: "EAN1", ean: "8014496006615" },
      { marchio: "BTI", code: "ZERO1", ean: "0000000000000" },
      { marchio: "BTI", code: "ZERO2", ean: "0000000000000" },
    ]);

    expect(codes("8014496006615")).toEqual(["EAN1"]);
    expect(codes("801449600661")).toEqual([]);
    expect(codes("0000000000000")).toEqual([]);
  });

  it("ignores case and code separators in the query", () => {
    importBti([{ marchio: "SIE", code: "3RV20111AA10" }]);
    expect(codes("3RV2011-1AA10")).toEqual(["3RV20111AA10"]);
    expect(codes("3rv2011 1aa10")).toEqual(["3RV20111AA10"]);
    expect(search("3RV2011-1AA10").products[0]?.manufacturerCode).toBe(
      "3RV20111AA10",
    );
  });

  it("requires every token to match the code or the description", () => {
    importBti([
      { marchio: "BTI", code: "FN81C16", description: "btdin60 - magnetot 1P curva C 16A 6kA" },
      { marchio: "BTI", code: "FN81C10", description: "btdin60 - magnetot 1P curva C 10A 6kA" },
      { marchio: "BTI", code: "LC1D09", description: "contattore 3P 400V 9A" },
      { marchio: "BTI", code: "LC1D12", description: "contattore 3P 24V 12A" },
    ]);

    expect(codes("magnetot 16A")).toEqual(["FN81C16"]);
    expect(codes("MAGNETOT")).toEqual(["FN81C10", "FN81C16"]);
    expect(codes("contattore 400V")).toEqual(["LC1D09"]);
    expect(codes("contattore 400V 12A")).toEqual([]);
    // One token found in the code, one in the description.
    expect(codes("FN81 16A")).toEqual(["FN81C16"]);
    // A code fragment in the middle of a code.
    expect(codes("81C16")).toEqual(["FN81C16"]);
  });

  it("matches wildcard characters literally", () => {
    importBti([
      { marchio: "BTI", code: "Z1", description: "sconto 100% garantito" },
      { marchio: "BTI", code: "Z2", description: "sconto 1000 garantito" },
      { marchio: "BTI", code: "Z3", description: "curva 16_A" },
      { marchio: "BTI", code: "Z4", description: "curva 16XA" },
    ]);

    expect(codes("100%")).toEqual(["Z1"]);
    expect(codes("16_A")).toEqual(["Z3"]);
    // A bare wildcard is not a search token; it must not match everything.
    expect(codes("%")).toEqual([]);
    expect(codes("_")).toEqual([]);
  });

  it("orders ties deterministically, listed products first", () => {
    importBti([
      { marchio: "BTI", code: "AAA100" },
      { marchio: "BTI", code: "AAA200" },
      { marchio: "BTI", code: "AAA300" },
    ]);
    importBti([{ marchio: "BTI", code: "AAA200" }, { marchio: "BTI", code: "AAA300" }], "2026-02-01", "002");

    const first = search("AAA").products.map((product) => product.manufacturerCode);
    expect(first).toEqual(["AAA200", "AAA300", "AAA100"]);
    expect(search("AAA").products.map((product) => product.manufacturerCode)).toEqual(first);
  });
});

describe("catalogue search pagination", () => {
  const products = ["PG001", "PG002", "PG003", "PG004", "PG005"].map((code) => ({
    marchio: "BTI",
    code,
  }));

  beforeEach(() => {
    importBti(products);
  });

  it("pages with limit and offset and reports hasMore without a total", () => {
    const first = search("PG", { limit: 2 });
    expect(first.products.map((p) => p.manufacturerCode)).toEqual(["PG001", "PG002"]);
    expect(first.hasMore).toBe(true);
    expect(first.offset).toBe(0);

    const second = search("PG", { limit: 2, offset: 2 });
    expect(second.products.map((p) => p.manufacturerCode)).toEqual(["PG003", "PG004"]);
    expect(second.hasMore).toBe(true);

    const last = search("PG", { limit: 2, offset: 4 });
    expect(last.products.map((p) => p.manufacturerCode)).toEqual(["PG005"]);
    expect(last.hasMore).toBe(false);
  });

  it("does not report more results when the page is exactly full", () => {
    const page = search("PG", { limit: 5 });
    expect(page.products).toHaveLength(5);
    expect(page.hasMore).toBe(false);
  });

  it("returns an empty page beyond the last result", () => {
    const page = search("PG", { limit: 2, offset: 10 });
    expect(page.products).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it("rejects invalid paging", () => {
    expect(() => search("PG", { limit: 0 })).toThrow(RangeError);
    expect(() => search("PG", { limit: 201 })).toThrow(RangeError);
    expect(() => search("PG", { limit: 1.5 })).toThrow(RangeError);
    expect(() => search("PG", { offset: -1 })).toThrow(RangeError);
  });
});

describe("catalogue search product fields", () => {
  it("returns brand, manufacturer code, description and the current price", () => {
    importBti([
      {
        marchio: "BTI",
        code: "FN81B16",
        description: "btdin60 - magnetot 1P curva B 16A",
        priceCents: 1234,
      },
    ]);

    const [product] = search("FN81B16").products;
    expect(product).toMatchObject({
      brandMarchio: "BTI",
      brandName: "BTI",
      manufacturerCode: "FN81B16",
      description: "btdin60 - magnetot 1P curva B 16A",
      unitOfMeasure: "PCE",
      isListed: true,
      price: {
        unitPriceE4: 123400,
        listPriceE4: 123400,
        priceMultiplier: 1,
        currency: "EUR",
        issuerSigla: "BTI",
      },
    });
  });

  it("keeps multiplier prices exact and exposes both unit and pack price", () => {
    importBti([
      { marchio: "BTI", code: "PACK100", priceCents: 12345, multiplier: 100 },
      { marchio: "BTI", code: "PACK1000", priceCents: 12345, multiplier: 1000, um: "LM" },
    ]);

    expect(search("PACK100").products[0]?.price).toMatchObject({
      listPriceE4: 1234500,
      priceMultiplier: 100,
      unitPriceE4: 12345,
    });
    // 123,45 EUR for 1000 -> 0,12345 per unit, rounded half-up to 4 decimals.
    const thousand = search("PACK1000").products[0];
    expect(thousand?.price).toMatchObject({
      listPriceE4: 1234500,
      priceMultiplier: 1000,
      unitPriceE4: 1235,
    });
    expect(thousand?.unitOfMeasure).toBe("LM");
  });
});

describe("governing-issuer pricing", () => {
  const sharedProduct = { marchio: "LEG", code: "SHARED1", description: "prodotto condiviso" };

  function importSie(priceCents: number, validFrom: string, listino: string) {
    return fixture.importDelivery({
      issuer: "SIE",
      listino,
      validFrom,
      products: [{ ...sharedProduct, priceCents }],
    });
  }

  it("uses the governing issuer's current price and never another issuer's", () => {
    importBti([{ ...sharedProduct, priceCents: 1000 }], "2026-01-01");
    importSie(2000, "2026-03-01", "S01");

    // The most recent listed listing governs: SIE.
    expect(search("SHARED1").products[0]?.price).toMatchObject({
      issuerSigla: "SIE",
      unitPriceE4: 200000,
    });

    // A preferred issuer wins once the governing listing is recomputed.
    fixture.lq
      .prepare(
        "UPDATE cat_brand SET preferred_issuer_id = (SELECT id FROM cat_metel_issuer WHERE metel_sigla = 'BTI') WHERE metel_marchio = 'LEG'",
      )
      .run();
    importBti([{ ...sharedProduct, priceCents: 1100 }], "2026-04-01", "002");
    expect(search("SHARED1").products[0]?.price).toMatchObject({
      issuerSigla: "BTI",
      unitPriceE4: 110000,
    });
  });

  it("shows no price rather than falling back to another issuer", () => {
    importBti([{ ...sharedProduct, priceCents: 1000 }], "2026-01-01");
    importSie(2000, "2026-03-01", "S01");
    // Governing issuer is SIE. Remove its price for the product: BTI still has one.
    fixture.lq
      .prepare(
        `DELETE FROM com_product_price
         WHERE price_list_id = (
           SELECT pl.id FROM com_price_list pl
           JOIN cat_metel_issuer i ON i.id = pl.issuer_id
           WHERE i.metel_sigla = 'SIE' AND pl.is_current = 1)`,
      )
      .run();

    const [product] = search("SHARED1").products;
    expect(product?.isListed).toBe(true);
    expect(product?.price).toBeNull();
  });

  it("switches to the remaining listing issuer when the governing one delists", () => {
    importBti([{ ...sharedProduct, priceCents: 1000 }], "2026-01-01");
    importSie(2000, "2026-03-01", "S01");
    fixture.importDelivery({
      issuer: "SIE",
      listino: "S02",
      validFrom: "2026-06-01",
      products: [{ marchio: "LEG", code: "OTHER" }],
    });

    const [product] = search("SHARED1").products;
    expect(product?.isListed).toBe(true);
    expect(product?.price).toMatchObject({
      issuerSigla: "BTI",
      unitPriceE4: 100000,
    });
  });
});

describe("deliveries over time", () => {
  it("shows the newer delivery's price after an update", () => {
    importBti([{ marchio: "BTI", code: "TIME1", priceCents: 1000 }], "2026-01-01");
    importBti([{ marchio: "BTI", code: "TIME1", priceCents: 1500 }], "2026-06-01", "002");

    expect(search("TIME1").products[0]?.price?.unitPriceE4).toBe(150000);
  });

  it("keeps the current price when an older delivery is imported afterwards", () => {
    importBti([{ marchio: "BTI", code: "TIME2", priceCents: 2000 }], "2026-03-01", "002");
    fixture.importDelivery({
      issuer: "BTI",
      listino: "001",
      validFrom: "2026-01-01",
      products: [
        { marchio: "BTI", code: "TIME2", priceCents: 1000 },
        { marchio: "BTI", code: "OLDONLY", priceCents: 500, description: "solo vecchio" },
      ],
      acceptOlderDelivery: true,
    });

    expect(search("TIME2").products[0]?.price?.unitPriceE4).toBe(200000);

    // A product that only ever appeared in the older delivery is not listed and has no price.
    const [oldOnly] = search("OLDONLY").products;
    expect(oldOnly?.isListed).toBe(false);
    expect(oldOnly?.price).toBeNull();
  });
});

describe("delisted products", () => {
  it("stay searchable, are marked, and never show a stale price", () => {
    importBti([
      { marchio: "BTI", code: "KEEP1", priceCents: 1000 },
      { marchio: "BTI", code: "GONE1", priceCents: 2000, description: "prodotto ritirato" },
    ]);
    importBti([{ marchio: "BTI", code: "KEEP1", priceCents: 1000 }], "2026-06-01", "002");

    const [gone] = search("GONE1").products;
    expect(gone).toMatchObject({
      manufacturerCode: "GONE1",
      description: "prodotto ritirato",
      isListed: false,
      price: null,
    });

    // The old price still exists in the (non-current) price history but is not surfaced.
    const historic = fixture.lq
      .prepare(
        `SELECT COUNT(*) AS n FROM com_product_price pp
         JOIN cat_product p ON p.id = pp.product_id
         WHERE p.manufacturer_code = 'GONE1'`,
      )
      .get() as { n: number };
    expect(historic.n).toBe(1);

    expect(search("KEEP1").products[0]?.isListed).toBe(true);
  });

  it("can be re-listed by a later delivery and gets the new price", () => {
    importBti([{ marchio: "BTI", code: "BACK1", priceCents: 1000 }]);
    importBti([{ marchio: "BTI", code: "OTHER1" }], "2026-03-01", "002");
    expect(search("BACK1").products[0]).toMatchObject({ isListed: false, price: null });

    importBti([{ marchio: "BTI", code: "BACK1", priceCents: 1200 }], "2026-06-01", "003");
    expect(search("BACK1").products[0]).toMatchObject({
      isListed: true,
      price: { unitPriceE4: 120000 },
    });
  });
});

describe("catalogue overview", () => {
  it("is empty for a catalogue without deliveries", () => {
    expect(getCatalogueOverview(fixture.lq)).toEqual({
      classifiedProductCount: 0, unclassifiedProductCount: 0,
      listedClassifiedProductCount: 0, listedUnclassifiedProductCount: 0,
      productCount: 0,
      listedProductCount: 0,
      delistedProductCount: 0,
      brands: [],
      currentPriceLists: [],
    });
  });

  it("reports totals, brands and each issuer's current price list", () => {
    importBti([
      { marchio: "BTI", code: "A1" },
      { marchio: "BTI", code: "A2" },
      { marchio: "LEG", code: "L1" },
    ]);
    importBti([{ marchio: "BTI", code: "A1" }, { marchio: "LEG", code: "L1" }], "2026-06-01", "002");
    fixture.importDelivery({
      issuer: "SIE",
      listino: "S01",
      validFrom: "2026-03-01",
      products: [{ marchio: "SIE", code: "S1" }],
    });

    const overview = getCatalogueOverview(fixture.lq);
    expect(overview).toMatchObject({
      productCount: 4,
      listedProductCount: 3,
      delistedProductCount: 1,
    });
    expect(overview.brands).toEqual([
      { marchio: "BTI", name: "BTI", productCount: 2, listedProductCount: 1 },
      { marchio: "LEG", name: "LEG", productCount: 1, listedProductCount: 1 },
      { marchio: "SIE", name: "SIE", productCount: 1, listedProductCount: 1 },
    ]);
    expect(overview.currentPriceLists).toEqual([
      expect.objectContaining({
        issuerSigla: "BTI",
        listinoNumber: "002",
        validFrom: "2026-06-01",
        listedProductCount: 2,
      }),
      expect.objectContaining({
        issuerSigla: "SIE",
        listinoNumber: "S01",
        validFrom: "2026-03-01",
        listedProductCount: 1,
      }),
    ]);
  });
});
