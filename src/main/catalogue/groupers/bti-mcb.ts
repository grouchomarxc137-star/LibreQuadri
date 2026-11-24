import type { ProductFamilyGrouper } from "../family-grouping.js";

const TARGET_CATEGORY = "protezione.interruttori_automatici";

interface Rule {
  readonly familyCode: string;
  readonly productCode: RegExp;
  readonly statisticalFamily: string;
  readonly breakingCapacity: number;
  readonly descriptionSeries: "45" | "60" | "100" | "160" | "250" | "500" | "rs";
}

// End-anchored structures only. The current suffix expresses poles, curve and
// current; magnetic-only SM and DC FV suffixes therefore cannot match.
const RULES: readonly Rule[] = [
  { familyCode: "btdin45_1pn_881", productCode: /^FA881[BCD]\d{1,3}$/, statisticalFamily: "IND.-112-5-11", breakingCapacity: 4.5, descriptionSeries: "45" },
  { familyCode: "btdin45", productCode: /^FA(?:81N?|8[234])[BCD]\d{1,3}$/, statisticalFamily: "IND.-112-5-11", breakingCapacity: 4.5, descriptionSeries: "45" },
  { familyCode: "btdin60_1pn_881", productCode: /^FN881[BCD]\d{1,3}$/, statisticalFamily: "IND.-112-5-15", breakingCapacity: 6, descriptionSeries: "60" },
  { familyCode: "btdin60", productCode: /^FN(?:81N?|8[234])[BCD]\d{1,3}$/, statisticalFamily: "IND.-112-5-15", breakingCapacity: 6, descriptionSeries: "60" },
  { familyCode: "btdin100", productCode: /^FH(?:81N|8[1-4])[BCDKZ]\d{1,3}$/, statisticalFamily: "IND.-112-5-19", breakingCapacity: 10, descriptionSeries: "100" },
  { familyCode: "btdin160", productCode: /^FT(?:81N|8[1-4])[CD]\d{1,3}$/, statisticalFamily: "IND.-112-5-22", breakingCapacity: 16, descriptionSeries: "160" },
  { familyCode: "btdin250", productCode: /^FV8[1-4][CD]\d{1,3}$/, statisticalFamily: "IND.-112-5-22", breakingCapacity: 25, descriptionSeries: "250" },
  { familyCode: "btdin500", productCode: /^FX8[1-4]C\d{1,3}$/, statisticalFamily: "IND.-112-5-22", breakingCapacity: 50, descriptionSeries: "500" },
  { familyCode: "btdin_rs_1pn_881", productCode: /^FC881C\d{1,3}$/, statisticalFamily: "IND.-110-2-71", breakingCapacity: 4.5, descriptionSeries: "rs" },
  { familyCode: "btdin_rs", productCode: /^FC(?:810N|820)C\d{1,3}$/, statisticalFamily: "IND.-110-2-71", breakingCapacity: 4.5, descriptionSeries: "rs" },
];

/** Returns a specific declared series, or null for generic/absent BTDIN text. */
function declaredDescriptionSeries(description: string | null): Rule["descriptionSeries"] | null {
  if (description === null) return null;
  const match = /\bbtdin[- ]?(45|60|100|160|250|500|rs)\b/i.exec(description);
  return match ? match[1]!.toLowerCase() as Rule["descriptionSeries"] : null;
}

export const btiMcbFamilyGrouper: ProductFamilyGrouper = {
  code: "bti.mcb",
  version: "2",
  propose(input) {
    if (input.brandMarchio !== "BTI" || input.categoryCode !== TARGET_CATEGORY) return null;
    const rule = RULES.find(candidate => candidate.productCode.test(input.manufacturerCode));
    if (!rule || input.statisticalFamilyIssuerSigla !== "BTI"
      || input.statisticalFamilyCode !== rule.statisticalFamily) return null;
    if (input.attributes.get("declared_breaking_capacity") !== rule.breakingCapacity) return null;
    const declaredSeries = declaredDescriptionSeries(input.description);
    if (declaredSeries !== null && declaredSeries !== rule.descriptionSeries) return null;
    return rule.familyCode;
  },
};
