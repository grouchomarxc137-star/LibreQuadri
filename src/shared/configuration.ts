/** Main-process configuration contract. IDs are local catalogue IDs. */
export const CONFIGURATION_CHANNELS = {
  ranges: "configuration:ranges",
  nodeModels: "configuration:node-models",
  productModels: "configuration:product-models",
  modelByCode: "configuration:model-by-code",
  model: "configuration:model",
  resolve: "configuration:resolve",
  offerSelection: "configuration:offer-selection",
} as const;

export interface ConfigModelSummary {
  id: number; code: string; name: string; kind: string; brandMarchio: string;
  active: boolean; obsolete: boolean;
  commercialContribution: "articles" | "none";
}
export interface RangeNode {
  id: number; brandMarchio: string; parentId: number | null; code: string;
  name: string; kind: string; sortOrder: number; active: boolean;
}
export interface ConfigOption {
  id: number; axisId: number; valueId: number; valueCode: string; label: string;
  parentOptionId: number | null; isDefault: boolean; visible: boolean;
  active: boolean; sortOrder: number;
}
export interface ConfigAxis {
  id: number; dimensionCode: string; label: string; sortOrder: number;
  visibility: string; requirement: string; binding: string;
  editableWhenPlaced: boolean; selectsPrimary: boolean; options: ConfigOption[];
}
export type FactoryPresetBlock = "blocked_overlap" | "blocked_alignment" | "blocked_device_compatibility";
export type PresetPlacementMode = "fixed" | "factory_fixed" | "packed" | FactoryPresetBlock | null;
export interface ConfigModelDetail extends ConfigModelSummary {
  definitionFingerprint: string; sourceRef: string | null; baseProfileId: number | null; maxInsertQty: number | null;
  /** Explicit source-reviewed exceptions; never infer a valid empty BOM from missing articles. */
  emptyBomRuleIds?: number[];
  factoryPresetOnly?: boolean;
  axes: ConfigAxis[];
  budgets: Array<{code: string; label: string; maxAmount: number}>;
  relations: Array<{seq: number; placementMode: PresetPlacementMode; relation: string; toModelId: number; toModelCode: string;
    quantity: number; positionXMm: number | null; positionYMm: number | null}>;
}
export interface ProductModelEntry extends ConfigModelSummary { preselectedOptionId: number | null }
export interface ConfigurationRequest {
  /** Explicit acknowledgement of missing METEL articles for this addition. */
  acceptOutOfCatalogue?: boolean;
  modelId: number; selectedOptionIds: number[];
  /** Optional catalogue entry; its preselected primary option is applied first. */
  productId?: number;
}
export interface ConfigurationIssue { severity: "error" | "warning"; code: string;
  message: string; optionId?: number; axisId?: number }
export interface BomArticle {
  brandMarchio: string; manufacturerCode: string; productId: number | null;
  /** Identity of the linked METEL product; engineering references may differ. */
  linkedBrandMarchio: string | null; linkedManufacturerCode: string | null;
  quantity: number; roles: string[]; description: string | null;
  unitPriceE4: number | null; rowTotalE4: number | null;
  currency: string | null; priceIssuerSigla: string | null;
  priceListinoNumber: string | null; priceValidFrom: string | null;
  priceMultiplierOriginal: number | null;
}
export interface PhysicalResult {
  mounting?:import("./mounting.js").MountingFacts|null;
  id: number; code: string; name: string; kind: string; profileKey: number | null;
  fitClass: {id: number; code: string; name: string};
  depthMm: number | null; outerDepthMm: number | null; usableDepthMm: number | null;
  demands: Array<{capacityKindCode: string; amount: number; unitLabel: string; displayDivisor: number; nominalPitchMm:number|null}>;
  views: Array<{code: string; widthMm: number; heightMm: number; insertDxMm: number | null;
    insertDyMm: number | null; symbolKind: string; assetKey: string | null}>;
  zones: Array<{mounting?:import("./mounting.js").MountingFacts|null;zoneNo:number;layout:string;capacityKindCode:string|null;
    capacityKindLabel?:string|null;displayDivisor?:number|null;nominalPitchMm?:number|null;
    capacityAmount:number|null;originXMm:number|null;originYMm:number|null;
    lengthMm:number|null;breadthMm:number|null;direction:string|null;
    pitchMm:number|null;requiredViewCode:string|null}>;
  slots: Array<{zoneNo:number;slotNo:number;xMm:number;yMm:number}>;
  constraints: Array<{relation: string; acceptSetCode: string; classCodes: string[]}>;
}
export type EngineeringProvenance = { kind: "manual" } | {
  kind: "import"; adapterCode: string; adapterVersion: string; importFingerprint: string;
};
export interface ConfigurationResult {
  /** Present on catalogue resolutions; absent only on legacy/test snapshots. */
  provenance?: EngineeringProvenance;
  model: ConfigModelDetail; selectedOptionIds: number[]; defaultedOptionIds: number[];
  commercialContribution: "articles" | "none";
  matchingRuleIds: number[]; fingerprint: string | null;
  status: "complete" | "incomplete" | "invalid" | "budget_exceeded" | "bom_incomplete" | "price_incomplete" | "no_profile";
  issues: ConfigurationIssue[]; bom: BomArticle[];
  totalE4: number | null; pricedSubtotalE4: number;
  budgets: Array<{code: string; used: number; maxAmount: number}>;
  physical: PhysicalResult | null;
  exclusions: Array<{ownDimensionCode:string;ownValueCode:string;ancestorDimensionCode:string;ancestorValueCode:string}>;
  /**
   * Engineering-context facts of an enclosure (`provides`) or support (`accepts`), copied into the
   * project so later placement needs no catalogue. Absent for other kinds.
   */
  context?: ModelEngineeringContext | null;
}
export interface ModelEngineeringContext {
  policy: "unknown" | "unrestricted" | "restricted";
  role: "provides" | "accepts";
  /** Active context codes, sorted. */
  codes: string[];
}
export interface ConfigurationApi {
  ranges(brandMarchio?: string): Promise<RangeNode[]>;
  nodeModels(nodeId: number): Promise<ConfigModelSummary[]>;
  productModels(productId: number): Promise<ProductModelEntry[]>;
  modelByCode(brandMarchio: string, modelCode: string): Promise<ConfigModelSummary | null>;
  model(modelId: number): Promise<ConfigModelDetail>;
  resolve(request: ConfigurationRequest): Promise<ConfigurationResult>;
  offerSelection?(modelId: number, offerNo: number): Promise<{
    status: "ready"; selectedOptionIds: number[] } | { status: "offer_stale" }>;
}
