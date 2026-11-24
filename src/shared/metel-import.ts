export const METEL_IMPORT_CHANNELS = {
  preview: "metel:preview", apply: "metel:apply", discard: "metel:discard", progress: "metel:progress",
} as const;
export const METEL_MAX_SOURCE_BYTES = 64 * 1024 * 1024;
export type MetelInput = { readonly name: string } & (
  { readonly kind: "file"; readonly bytes: Uint8Array } |
  { readonly kind: "text"; readonly text: string }
);
export interface MetelImportPreview {
  readonly token: string;
  readonly issuer: string;
  readonly listino: string;
  readonly validFrom: string;
  readonly older: boolean;
  readonly alreadyImported: boolean;
  readonly files: readonly { readonly name: string; readonly type: "LSP" | "FSC" | "FST"; readonly rows: number; readonly version: string }[];
  readonly brands: readonly string[];
  readonly addedProducts: number;
  readonly updatedProducts: number;
  readonly changedPrices: number;
  readonly delistedListings: number;
  readonly newlyUnlistedProducts: number;
  readonly reactivatedListings: number;
  readonly newBrands: number;
  readonly changedFamilies: number;
  readonly unknownFamilies: number;
  readonly delistedExamples: readonly string[];
  readonly warnings: readonly string[];
}
export interface MetelImportResult {
  readonly deliveryId: number;
  readonly alreadyImported: boolean;
  readonly becameCurrent: boolean;
  readonly productCount: number;
  readonly warnings: readonly string[];
}
export interface MetelImportApi {
  preview(inputs: readonly MetelInput[]): Promise<MetelImportPreview>;
  apply(token: string, acceptOlder: boolean): Promise<MetelImportResult>;
  discard(): Promise<void>;
  onProgress(listener: (message: string) => void): () => void;
}
