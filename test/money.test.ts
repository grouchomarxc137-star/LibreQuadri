import { describe, expect, it } from "vitest";

import {
  formatAmountE4,
  formatMoneyE4,
  multiplyAmountE4,
} from "../src/shared/money.js";

describe("exact _e4 amount formatting", () => {
  it.each([
    [0, "0,00"],
    [1, "0,0001"],
    [100, "0,01"],
    [1250, "0,125"],
    [10000, "1,00"],
    [508000, "50,80"],
    [123400, "12,34"],
    [12345678, "1.234,5678"],
    [1234500, "123,45"],
    [10000000, "1.000,00"],
    [999999999, "99.999,9999"],
    [123456780000, "12.345.678,00"],
    [-15000, "-1,50"],
    [Number.MAX_SAFE_INTEGER, "900.719.925.474,0991"],
  ])("formats %i as %s", (amountE4, expected) => {
    expect(formatAmountE4(amountE4)).toBe(expected);
  });

  it("rejects values that are not safe integers", () => {
    expect(() => formatAmountE4(1.5)).toThrow();
    expect(() => formatAmountE4(Number.NaN)).toThrow();
    expect(() => formatAmountE4(Number.MAX_SAFE_INTEGER + 2)).toThrow();
  });

  it("appends the currency", () => {
    expect(formatMoneyE4(508000, "EUR")).toBe("50,80 €");
    expect(formatMoneyE4(508000, "USD")).toBe("50,80 USD");
  });

  it("multiplies _e4 amounts by integer quantities exactly", () => {
    expect(multiplyAmountE4(508000, 3)).toBe(1_524_000);
    expect(multiplyAmountE4(1235, 7)).toBe(8_645);
    expect(multiplyAmountE4(1, 0)).toBe(0);
  });

  it("rejects invalid quantities and unsafe results", () => {
    expect(() => multiplyAmountE4(10000, 1.5)).toThrow();
    expect(() => multiplyAmountE4(10000, -1)).toThrow();
    expect(() => multiplyAmountE4(Number.MAX_SAFE_INTEGER, 2)).toThrow();
  });
});
