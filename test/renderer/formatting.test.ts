import { describe, expect, it } from "vitest";

import {
  formatIsoDate,
  priceDisplay,
} from "../../src/renderer/catalogue/formatting.js";

const price = {
  unitPriceE4: 123400,
  listPriceE4: 123400,
  priceMultiplier: 1,
  currency: "EUR",
  issuerSigla: "BTI",
};

describe("price display", () => {
  it("shows only the unit price when the multiplier is one", () => {
    expect(priceDisplay(price, "PCE")).toEqual({
      primary: "12,34 €",
      unitLabel: "PCE",
      secondary: null,
    });
  });

  it("shows the unit price first and the pack price second", () => {
    expect(
      priceDisplay(
        { ...price, unitPriceE4: 12345, listPriceE4: 1234500, priceMultiplier: 100 },
        "PCE",
      ),
    ).toEqual({
      primary: "1,2345 €",
      unitLabel: "PCE",
      secondary: "123,45 € per 100 PCE",
    });
  });

  it("copes with a missing unit of measure", () => {
    expect(
      priceDisplay({ ...price, listPriceE4: 1234000, priceMultiplier: 10 }, null),
    ).toMatchObject({ unitLabel: null, secondary: "123,40 € per 10" });
  });
});

describe("date formatting", () => {
  it("formats ISO dates without time zone conversion", () => {
    expect(formatIsoDate("2026-07-01")).toBe("01/07/2026");
    expect(formatIsoDate("2026-07-01T23:59:00Z")).toBe("01/07/2026");
    expect(formatIsoDate("not a date")).toBe("not a date");
  });
});
