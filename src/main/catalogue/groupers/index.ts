import type { ProductFamilyGrouperRegistry } from "../family-grouping.js";
import { btiMcbFamilyGrouper } from "./bti-mcb.js";

/** Production family groupers, keyed by METEL marchio. */
export const FAMILY_GROUPERS: ProductFamilyGrouperRegistry = new Map([
  ["BTI", btiMcbFamilyGrouper],
]);
