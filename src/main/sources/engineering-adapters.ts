import { SIENERGY_ENGINEERING_ADAPTER } from "./sienergy/adapter.js";
import { TIQUADRI_ENGINEERING_ADAPTER } from "./tiquadri/adapter.js";

export interface EngineeringAdapter { readonly code:string; readonly version:string; readonly optional?:boolean }

/** Only adapters with a declared engineering interpretation participate in version readiness. */
export const ENGINEERING_ADAPTERS:readonly EngineeringAdapter[] = Object.freeze([
  TIQUADRI_ENGINEERING_ADAPTER, SIENERGY_ENGINEERING_ADAPTER,
]);
