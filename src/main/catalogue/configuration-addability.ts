import type { ConfigurationResult } from "../../shared/configuration.js";

/** The catalogue-side part of insertConfiguredItem's add predicate. */
export function configuredItemAddable(result: ConfigurationResult): boolean {
  const physicalOnly = result.commercialContribution === "none";
  const approvedEmptyBom=result.model.kind==="support"&&result.model.commercialContribution==="articles"&&
    result.model.emptyBomRuleIds?.some(id=>result.matchingRuleIds.includes(id))===true;
  return (result.commercialContribution === result.model.commercialContribution || physicalOnly&&approvedEmptyBom) &&
    result.status === "complete" && !!result.fingerprint &&
    (physicalOnly ? result.totalE4 === null && result.bom.length === 0 :
      result.totalE4 !== null && result.bom.length > 0) &&
    result.model.active && !result.model.obsolete &&
    !result.issues.some(issue => issue.severity === "error") &&
    (!["device", "support", "enclosure"].includes(result.model.kind) || !!result.physical);
}
