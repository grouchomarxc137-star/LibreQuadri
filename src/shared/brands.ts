export const BRAND_CHANNELS = {
  list: "brands:list", setActive: "brands:set-active", previewRemoval: "brands:preview-removal", remove: "brands:remove",
} as const;
export interface ManagedBrand {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
  readonly removed: boolean;
  readonly products: number;
  readonly listed: number;
  readonly issuers: string;
}
export interface BrandRemovalPreview {
  readonly token: string;
  readonly brand: ManagedBrand;
  readonly prices: number;
  readonly families: number;
  readonly blockers: readonly string[];
}
export interface BrandApi {
  list(): Promise<readonly ManagedBrand[]>;
  setActive(id: number, active: boolean): Promise<void>;
  previewRemoval(id: number): Promise<BrandRemovalPreview>;
  remove(token: string): Promise<void>;
}
