import type { ConfigurationResult } from "./configuration.js";

/** Missing METEL references may be acknowledged; incomplete engineering never may. */
export function isOutOfCatalogue(result: ConfigurationResult): boolean {
  return result.status === "bom_incomplete" && result.model.active && !result.model.obsolete &&
    !!result.fingerprint && !!result.physical && result.commercialContribution === "articles" &&
    result.bom.some(article => article.productId === null) &&
    result.issues.every(issue => ["unresolved_article", "missing_price", "inexact_price", "unsupported_currency"].includes(issue.code)) &&
    result.bom.every(article => Number.isFinite(article.quantity) && article.quantity > 0 &&
      (article.currency === null || article.currency === "EUR"));
}

export function configurationCanBeAdded(result: ConfigurationResult): boolean {
  return result.status === "complete" || isOutOfCatalogue(result);
}

export function outOfCatalogueWarning(result: ConfigurationResult): string {
  const articles = result.bom.filter(article => article.productId === null)
    .map(article => `${article.brandMarchio}/${article.manufacturerCode}`).join(", ");
  return `Fuori catalogo — ${result.model.name}\n\nArticoli non presenti nel catalogo METEL: ${articles}.\n` +
    "I dati tecnici saranno conservati. I prezzi mancanti e il totale resteranno non disponibili; non saranno considerati pari a zero.\n\nAggiungere comunque al progetto?";
}
