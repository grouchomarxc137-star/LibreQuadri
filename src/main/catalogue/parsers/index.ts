import type { AttributeParserRegistry } from "../attribute-enrichment.js";
import { btiDescriptionParser } from "./bti-description.js";
import { sieDescriptionParser } from "./sie-description.js";

/** Production description parsers, keyed by METEL marchio. Brands without an entry get no parser values. */
export const ATTRIBUTE_PARSERS: AttributeParserRegistry = new Map([
  ["BTI", btiDescriptionParser],
  ["SIE", sieDescriptionParser],
]);
