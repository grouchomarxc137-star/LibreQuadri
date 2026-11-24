import type { LqApi } from "../shared/catalogue.js";

declare global {
  interface Window {
    /** Exposed by the sandboxed preload script through contextBridge. */
    readonly lq: LqApi;
  }
}
