import { describe, expect, it } from "vitest";

import {
  filterReducer,
  initialFilterState,
  pruneAttributeValues,
  toAttributeFilters,
  toggleAttributeValue,
} from "../../src/renderer/catalogue/attribute-filter-state.js";
import { formatAttributeValue } from "../../src/renderer/catalogue/formatting.js";

describe("attribute filter selection", () => {
  it("toggles values and drops attributes without values", () => {
    let selected = toggleAttributeValue({}, "poles", "2p");
    selected = toggleAttributeValue(selected, "poles", "1p_n");
    expect(selected).toEqual({ poles: ["2p", "1p_n"] });
    expect(toggleAttributeValue(toggleAttributeValue(selected, "poles", "2p"), "poles", "1p_n")).toEqual({});
  });

  it("builds a deterministic request regardless of selection order", () => {
    const a = toAttributeFilters({ rated_current: [16, 6], poles: ["2p", "1p_n"] });
    expect(a).toEqual([{ attributeCode: "poles", values: ["1p_n", "2p"] }, { attributeCode: "rated_current", values: [6, 16] }]);
    expect(toAttributeFilters({ poles: ["1p_n", "2p"], rated_current: [6, 16] })).toEqual(a);
  });

  it("prunes selections that are no longer offered and keeps identity otherwise", () => {
    const options = { categoryCode: "c", totalCount: 1, attributes: [
      { code: "poles", name: "Poli", dataType: "enum" as const, unit: null, values: [{ value: "2p", label: "2P", count: 1, selected: true }] },
    ] };
    const kept = { poles: ["2p"] };
    expect(pruneAttributeValues(kept, options)).toBe(kept);
    expect(pruneAttributeValues({ poles: ["2p", "4p"], trip_curve: ["b"] }, options)).toEqual({ poles: ["2p"] });
  });

  it("formats values in Italian with units", () => {
    expect(formatAttributeValue(0.5, "A", null)).toBe("0,5 A");
    expect(formatAttributeValue(1000, "mA", null)).toBe("1000 mA");
    expect(formatAttributeValue("a", null, "A")).toBe("A");
    expect(formatAttributeValue(true, null, null)).toBe("Sì");
  });
});

describe("catalogue filter state", () => {
  const withSelection = filterReducer(filterReducer(filterReducer(initialFilterState,
    { type: "category", categoryCode: "protezione.interruttori_automatici" }),
    { type: "toggle", attributeCode: "poles", value: "2p" }),
    { type: "toggle", attributeCode: "trip_curve", value: "c" });

  it("starts with listed products and no category", () => {
    expect(initialFilterState).toEqual({ categoryCode: "", listedOnly: true, selected: {} });
  });

  it("clears technical filters when the category changes, keeping the listed scope", () => {
    const listedAll = filterReducer(withSelection, { type: "listed-only", listedOnly: false });
    expect(filterReducer(listedAll, { type: "category", categoryCode: "protezione.differenziali_puri" }))
      .toEqual({ categoryCode: "protezione.differenziali_puri", listedOnly: false, selected: {} });
    expect(filterReducer(withSelection, { type: "category", categoryCode: "" }).selected).toEqual({});
    expect(filterReducer(withSelection, { type: "category", categoryCode: "protezione.interruttori_automatici" })).toBe(withSelection);
  });

  it("toggles several values of one attribute, removes single values and resets all", () => {
    const both = filterReducer(withSelection, { type: "toggle", attributeCode: "poles", value: "1p_n" });
    expect(both.selected).toEqual({ poles: ["2p", "1p_n"], trip_curve: ["c"] });
    expect(filterReducer(both, { type: "toggle", attributeCode: "trip_curve", value: "c" }).selected).toEqual({ poles: ["2p", "1p_n"] });
    expect(filterReducer(both, { type: "reset" })).toEqual({ ...both, selected: {} });
  });

  it("prunes only with facets of the current category", () => {
    const facets = (categoryCode: string) => ({ categoryCode, totalCount: 0, attributes: [{ code: "poles", name: "Poli",
      dataType: "enum" as const, unit: null, values: [{ value: "2p", label: "2P", count: 0, selected: true }] }] });
    expect(filterReducer(withSelection, { type: "prune", options: facets("other") })).toBe(withSelection);
    expect(filterReducer(withSelection, { type: "prune", options: facets("protezione.interruttori_automatici") }).selected)
      .toEqual({ poles: ["2p"] });
  });
});
