import type { ConfigurationRequest, ConfigurationResult } from "../../shared/configuration.js";
import { isOutOfCatalogue, outOfCatalogueWarning } from "../../shared/out-of-catalogue.js";

/** Acknowledgement applies only to the configuration the user is currently adding. */
export function confirmCatalogueAddition(request: ConfigurationRequest, result: ConfigurationResult): ConfigurationRequest | null {
  if (!isOutOfCatalogue(result)) return request;
  return window.confirm(outOfCatalogueWarning(result)) ? { ...request, acceptOutOfCatalogue: true } : null;
}
