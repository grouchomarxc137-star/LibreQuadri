import type { CatalogueProductAttribute } from "./catalogue.js";
import type { ConfigurationRequest } from "./configuration.js";
import type { ConfigModelSummary } from "./configuration.js";

export const PROJECT_CHANNELS = {
  chooseDestination: "project:choose-destination",
  create: "project:create",
  open: "project:open",
  save: "project:save",
  saveAs: "project:save-as",
  close: "project:close",
  current: "project:current",
  engineeringStatus: "project:engineering-status",
  planEngineeringRefresh: "project:engineering-plan",
  applyEngineeringRefresh: "project:engineering-apply",
  addCatalogueProduct: "project:add-catalogue-product",
  addConfiguredItem: "project:add-configured-item",
  duplicateConfiguredItem: "project:duplicate-configured-item",
  replaceConfiguredItem: "project:replace-configured-item",
  reconfigureEnclosure: "project:reconfigure-enclosure",
  setQuantity: "project:set-quantity",
  setLineDiscount: "project:set-line-discount",
  setComponentDiscount: "project:set-component-discount",
  setGlobalDiscount: "project:set-global-discount",
  setLabourTotal: "project:set-labour-total",
  removeLine: "project:remove-line",
  removeLines: "project:remove-lines",
  checkPlacement: "project:check-placement",
  checkPackedChild: "project:check-packed-child",
  placementTargets: "project:placement-targets",
  autoPlaceItem: "project:auto-place-item",
  canDuplicatePlacedItem: "project:can-duplicate-placed-item",
  duplicatePlacedItem: "project:duplicate-placed-item",
  placeRoot: "project:place-root",
  placeChild: "project:place-child",
  moveNode: "project:move-node",
  unplaceNode: "project:unplace-node",
  unplaceSubtree: "project:unplace-subtree",
  insertPackedChild: "project:insert-packed-child",
  reorderPackedNode: "project:reorder-packed-node",
  movePackedNode: "project:move-packed-node",
  removePackedNode: "project:remove-packed-node",
  removePhysicalRoot: "project:remove-physical-root",
  frontAssets: "project:front-assets",
  designDiscover: "project:design-discover",
  addStructural: "project:add-structural",
  designNavigation: "project:design-navigation",
  referenceDevices: "project:reference-devices",
  compatiblePanels: "project:compatible-panels",
  compatibleEnclosures: "project:compatible-enclosures",
  enclosureReferenceDevices: "project:enclosure-reference-devices",
  checkPanelReference: "project:check-panel-reference",
  placeStructuralItem: "project:place-structural-item",
  undo: "project:undo",
  redo: "project:redo",
  fillCapacity: "project:fill-capacity",
  addAnnotation: "project:add-annotation",
  updateAnnotation: "project:update-annotation",
  removeAnnotation: "project:remove-annotation",
  previewFrontPdf: "project:preview-front-pdf",
  previewPdf: "project:preview-pdf",
  savePdf: "project:save-pdf",
  saveDocumentPdf: "project:save-document-pdf",
  saveFrontPdf: "project:save-front-pdf",
} as const;

export type StructuralDesignKind = "enclosure" | "support" | "device";

export interface StructuralDiscovery {
  status:"ready"|"engineering_data_stale"|"project_engineering_stale"|"container_unavailable";
  candidates:ConfigModelSummary[];
  staleImportIds:number[];
  contextDataUnavailable:number;
}
/** Eligible design hierarchy. Ids are local catalogue ids; no manufacturer source ids are exposed. */
export interface StructuralNavigationNode {
  id:number;parentId:number|null;name:string;kind:string;sortOrder:number;
  /** Eligible `candidates` attached directly to this node. */
  modelIds:number[];
}
export interface StructuralNavigation extends StructuralDiscovery {
  nodes:StructuralNavigationNode[];
}
/** Transient command data only; never stored in the project. */
export interface ReferenceDevice {
  configuration:ConfigurationRequest;
  definitionFingerprint:string;
}
export interface CompatibleEnclosuresRequest { device:ReferenceDevice;enclosure?:ConfigurationRequest; }
export interface CompatiblePanelsRequest { parentUuid:string;device:ReferenceDevice; }
export interface PanelReferenceCheckRequest extends CompatiblePanelsRequest { panel:ConfigurationRequest; }
export interface ReferenceCompatibility { ok:boolean;code:string;staleImportIds?:number[]; }
export interface CompatiblePanelNavigation { navigation:StructuralNavigation;reference:ReferenceCompatibility; }
export interface AddStructuralRequest {
  referenceDevice?:ReferenceDevice;
  configuration:ConfigurationRequest;
  kind:StructuralDesignKind;
  parentUuid?:string;
  zoneNo?:number;
  /**
   * Defaults to true. False (supports and devices only) verifies the selected parent, adds or
   * merges the configured item and creates no physical node; the units stay unplaced (Q−P).
   * A device uses its selected Pannello for the catalogue eligibility check.
   */
  place?:boolean;
  /** Find a position for the added unit after checking catalogue eligibility. */
  autoPlace?:boolean;
  /**
   * Units of the configured item to add (1–99, default 1); only for a support added with `place:false`.
   * It is the ordinary configured-item quantity (Q22): one item whose quantity is N, or an existing
   * identical item raised by N. No physical node is created for any of the units.
   */
  quantity?:number;
}
/** Smallest and largest quantity one structural add may carry. */
export const STRUCTURAL_ADD_QUANTITY_MIN = 1;
export const STRUCTURAL_ADD_QUANTITY_MAX = 99;
/** Placement of an existing unplaced support; the shape matches the placement target actions. */
export type ProjectStructuralPlacement =
  | {readonly action:"placeChild";readonly input:ProjectPlacementInput}
  | {readonly action:"insertPackedChild";readonly input:ProjectPackedChildInput;readonly index?:number};

export interface FrontVectorAsset {
  readonly viewBox: readonly [number,number,number,number];
  readonly strokeWidth: number;
  readonly strokes: string;
  readonly fills: string;
}

export interface FrontOptionLabel {
  readonly assetKey: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
}

export const PROJECT_TYPES = {
  civil: { label: "Norma civile", normCode: "CEI EN 60898" },
  industrial: { label: "Norma industriale", normCode: "CEI EN 60947-2" },
} as const;
export type ProjectType = keyof typeof PROJECT_TYPES;

export interface ProjectMetadataInput {
  readonly title: string;
  readonly description: string;
  readonly notes: string;
  readonly projectType: ProjectType;
  readonly executor: string;
  readonly date: string;
  readonly companyName: string;
  readonly companyDescription: string;
}
export interface ProjectDestinationSelection {
  /** One-time opaque handle. The renderer never receives the filesystem path. */
  readonly token: string;
  readonly displayName: string;
}
export interface CreateProjectRequest extends ProjectMetadataInput { readonly destinationToken: string; }
export interface ProjectMetadata extends ProjectMetadataInput {
  readonly uuid: string;
  readonly normCode: string;
}
export interface ProjectQuotationLine {
  readonly commercialContribution?: "articles" | "none";
  readonly lineType: "product" | "item";
  readonly uuid: string;
  readonly snapshotUuid: string | null;
  readonly itemUuid: string | null;
  readonly brandMarchio: string;
  readonly manufacturerCode: string;
  readonly description: string | null;
  readonly unitOfMeasure: string | null;
  readonly quantity: number;
  readonly unitListPriceE4: number | null;
  readonly lineTotalE4: number | null;
  readonly lineDiscountBp?: number;
  readonly currency: string;
}
export interface ProjectConfiguredItem {
  readonly mounting?:import("./mounting.js").MountingFacts|null;
  readonly engineeringProvenance?: "import" | "manual" | null;
  readonly sourceAdapterCode?: string | null;
  readonly sourceAdapterVersion?: string | null;
  readonly sourceImportFingerprint?: string | null;
  readonly uuid: string;
  readonly commercialContribution: "articles" | "none";
  readonly modelBrandMarchio: string;
  readonly modelCode: string;
  readonly modelName: string;
  readonly modelKind: string;
  readonly modelDefinitionFingerprint: string;
  readonly modelSourceRef: string | null;
  readonly configFingerprint: string;
  readonly configLabel: string;
  readonly configStatus: string;
  readonly physStatus: string;
  readonly profileCode: string | null;
  readonly profileName: string | null;
  readonly fitClassCode: string | null;
  readonly fitClassLabel: string | null;
  readonly depthMm: number | null;
  readonly outerDepthMm: number | null;
  readonly usableDepthMm: number | null;
  readonly selections: readonly { dimensionCode: string; dimensionLabel: string; valueCode: string; valueLabel: string; selectionSource: string; binding: string; editableWhenPlaced: boolean; visible: boolean }[];
  readonly bom: readonly { seq: number; snapshotUuid: string; brandMarchio: string; manufacturerCode: string; description: string | null; quantityPerItem: number; role: string; listPriceUnitE4: number | null; salePriceUnitE4: number | null; lineDiscountBp?: number }[];
  readonly demands: readonly { capacityKindCode: string; capacityKindLabel: string; amount: number; displayDivisor: number; nominalPitchMm: number | null }[];
  readonly views: readonly { viewCode: string; widthMm: number; heightMm: number; insertDxMm: number | null; insertDyMm: number | null; symbolKind: string; assetKey: string | null; assetSha256: string | null }[];
  /** Local drawing data derived from the saved choices, never stored in the project file. */
  readonly frontOptionLabels?: readonly FrontOptionLabel[];
  readonly zones: readonly { mounting?:import("./mounting.js").MountingFacts|null;zoneNo:number;layout:string;capacityKindCode:string|null;
    capacityKindLabel:string|null;displayDivisor:number|null;nominalPitchMm:number|null;
    capacityAmount:number|null;originXMm:number|null;originYMm:number|null;
    lengthMm:number|null;breadthMm:number|null;direction:string|null;
    pitchMm:number|null;requiredViewCode:string|null }[];
  readonly slots: readonly { zoneNo: number; slotNo: number; xMm: number; yMm: number }[];
  readonly constraints: readonly { relation: string; setNo: number; classCode: string }[];
  readonly exclusions: readonly { ownDimensionCode: string; ownValueCode: string; ancestorDimensionCode: string; ancestorValueCode: string }[];
}
export interface ProjectDistintaRow {
  readonly snapshotUuid: string;
  readonly brandMarchio: string;
  readonly manufacturerCode: string;
  readonly description: string | null;
  readonly unitOfMeasure: string | null;
  readonly quantity: number;
  readonly listPriceUnitE4: number | null;
  readonly listTotalE4: number | null;
}
export interface PresetDiagnostic {
  seq:number; modelCode:string; modelName?:string; status:"instantiated"|"withheld"; code:string; message:string;
  nodeUuid?:string; issues?:import("./configuration.js").ConfigurationIssue[];
}
export interface ProjectDocumentView {
  readonly openReconciliation?: {
    readonly engineeringReview?: string;
    readonly engineeringFailed?: boolean;
    readonly pricingFailed?: boolean;
    readonly pricing?: { readonly beforeE4: number | null; readonly afterE4: number | null; readonly snapshots: number };
  };
  /** Creation response only; opening a document never regenerates presets. */
  readonly presetDiagnostics?:readonly PresetDiagnostic[];
  readonly documentName: string;
  readonly revision: number;
  readonly dirty: boolean;
  /** Document undo/redo: the action Annulla would revert and Ripeti would reapply (null: none). */
  readonly history?: ProjectHistoryState;
  /** Identifies the current undo step in this open session. */
  readonly undoToken?: string;
  /** Result of the automatic placement attempted by this command. */
  readonly autoPlacement?: "placed" | "unchanged" | "unplaced";
  /** Set only by fillCapacity: what the automatic fill did. */
  readonly fillReport?: ProjectFillReport;
  readonly metadata: ProjectMetadata;
  readonly globalDiscountBp?: number;
  readonly labourTotalE4?: number;
  readonly lines: readonly ProjectQuotationLine[];
  readonly configuredItems: readonly ProjectConfiguredItem[];
  readonly distinta: readonly ProjectDistintaRow[];
  readonly physicalNodes: readonly ProjectPhysicalNode[];
  /** Free-text notes on the Fronte Quadro (format 6); presentation only, never part of the quotation or physical tree. */
  readonly annotations: readonly ProjectAnnotation[];
}
/**
 * A plain-text box on the combined Fronte Quadro drawing. Position (its top-left corner) and size
 * are drawing millimetres.
 */
export interface ProjectAnnotation {
  readonly uuid: string;
  readonly text: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  /** This box's text size in drawing millimetres (6–60); 12 for every box created before format 9. */
  readonly fontSizeMm: number;
}
/** Smallest box the drawing and the document accept; an accidental tiny box is raised to this. */
export const ANNOTATION_MIN_WIDTH_MM = 60;
export const ANNOTATION_MIN_HEIGHT_MM = 24;
export const ANNOTATION_MAX_SIZE_MM = 100_000;
/** Text size of a box, drawing millimetres: the default, and the range the document accepts. */
export const ANNOTATION_FONT_DEFAULT_MM = 12;
export const ANNOTATION_FONT_MIN_MM = 6;
export const ANNOTATION_FONT_MAX_MM = 60;
/** A box's text is padded on every side and set with this line height (factor of the text size). */
export const ANNOTATION_PADDING_MM = 3;
export const ANNOTATION_LINE_HEIGHT = 1.3;
/** The height of a box that holds one line of text of the given size: never less than the general minimum. */
export function annotationMinHeightMm(fontSizeMm: number): number {
  const oneLine = Math.ceil(Math.round((fontSizeMm * ANNOTATION_LINE_HEIGHT + 2 * ANNOTATION_PADDING_MM) * 1000) / 100) / 10;
  return Math.max(ANNOTATION_MIN_HEIGHT_MM, oneLine);
}
export interface ProjectAnnotationInput {
  readonly text: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  /** Omitted: the default size. */
  readonly fontSizeMm?: number;
}
export type ProjectAnnotationPatch = Partial<ProjectAnnotationInput>;
export interface ProjectPlacementInput {
  readonly itemUuid: string;
  readonly parentUuid?: string;
  readonly zoneNo?: number;
  readonly startUnits?: number;
  readonly slotNo?: number;
  readonly rootXMm?: number;
  readonly rootYMm?: number;
  readonly viewCode: string;
}
export interface ProjectPackedChildInput {
  readonly itemUuid:string;
  readonly parentUuid:string;
  readonly zoneNo:number;
  readonly viewCode:string;
}
export type ProjectPackedMoveInput = {readonly parentUuid:string;readonly zoneNo:number;
  readonly viewCode:string;} & (
  | {readonly index:number;readonly startUnits?:never;readonly anchorUuid?:never}
  | {readonly startUnits:number;readonly index?:never;readonly anchorUuid?:never}
  | {readonly anchorUuid:string;readonly direction:"forward"|"backward";readonly index?:never;readonly startUnits?:never}
);
export type ProjectPlacementSubject =
  | {readonly itemUuid:string;readonly nodeUuid?:never}
  | {readonly nodeUuid:string;readonly itemUuid?:never};
export type ProjectPlacementTargetRequest = ProjectPlacementSubject & {readonly parentUuid:string;readonly reflow?:true};
export interface ProjectPlacementRect {readonly xMm:number;readonly yMm:number;
  readonly widthMm:number;readonly heightMm:number;}
export interface ProjectPlacementAffectedNode {readonly nodeUuid:string;readonly rect:ProjectPlacementRect;}
export interface ProjectPlacementDiagnostic {readonly code:string;readonly message:string;
  readonly zoneNo?:number;readonly viewCode?:string;}
interface ProjectPlacementTargetBase {readonly subject:ProjectPlacementRect;
  readonly hitRect?:ProjectPlacementRect;
  readonly affected:readonly ProjectPlacementAffectedNode[];}
export type ProjectPlacementTarget = ProjectPlacementTargetBase & (
  | {readonly action:"placeChild";readonly input:ProjectPlacementInput}
  | {readonly action:"moveNode";readonly nodeUuid:string;readonly input:ProjectPlacementInput}
  | {readonly action:"insertPackedChild";readonly input:ProjectPackedChildInput;readonly index:number}
  | {readonly action:"movePackedNode";readonly nodeUuid:string;readonly input:ProjectPackedMoveInput}
);
export interface ProjectPlacementTargets {readonly targets:readonly ProjectPlacementTarget[];
  readonly diagnostics:readonly ProjectPlacementDiagnostic[];}
export interface ProjectPhysicalNode {
  uuid:string;itemUuid:string|null;parentUuid:string|null;
  nodeKind:"enclosure"|"support"|"device"|"group";
  zoneNo:number|null;startUnits:number|null;slotNo:number|null;
  rootXMm:number|null;rootYMm:number|null;viewCode:string|null;
  sortOrder:number;xMm:number|null;yMm:number|null;positionIssue:string|null;
  children:ProjectPhysicalNode[];
}
/**
 * What removing a Carpenteria (physical root) does with what it holds: `keep-contents` returns
 * the placed Pannelli and Apparecchi to the unplaced pool; `remove-contents` removes those units
 * from the project too. The Carpenteria's own unit leaves the project either way.
 */
export type ProjectRootRemoval = "keep-contents" | "remove-contents";
export type ProjectPlacementCheck = {ok:true}|{ok:false;code:string;message:string};
export interface CatalogueProductSnapshotSource {
  readonly priceCurrency?: string | null;
  readonly brandMarchio: string;
  readonly brandName: string;
  readonly manufacturerCode: string;
  readonly ean: string | null;
  readonly shortDescription: string | null;
  readonly description: string | null;
  readonly unitOfMeasure: string | null;
  readonly categoryCode: string | null;
  readonly categoryPathLabel: string | null;
  readonly familyCode: string | null;
  readonly familyName: string | null;
  readonly priceIssuerSigla: string | null;
  readonly priceListinoNumber: string | null;
  readonly priceValidFrom: string | null;
  readonly listPriceUnitE4: number | null;
  readonly priceMultiplierOriginal: number | null;
  readonly attributes: readonly CatalogueProductAttribute[];
}
export interface ProjectApi {
  engineeringStatus(): Promise<import("./project-engineering.js").ProjectEngineeringStatus>;
  planEngineeringRefresh(): Promise<import("./project-engineering.js").ProjectEngineeringPlan>;
  applyEngineeringRefresh(token:string): Promise<ProjectDocumentView>;
  previewFrontPdf(options: FrontPdfOptions): Promise<string>;
  previewPdf(kind: "distinta", options: DocumentPdfOptions): Promise<string>;
  savePdf(token: string): Promise<boolean>;
  saveDocumentPdf(kind: "distinta", options: DocumentPdfOptions): Promise<boolean>;
  saveFrontPdf(options: FrontPdfOptions): Promise<boolean>;
  designDiscover(kind:StructuralDesignKind,parentUuid?:string):Promise<StructuralDiscovery>;
  addStructural(request:AddStructuralRequest):Promise<ProjectDocumentView>;
  designNavigation(kind:StructuralDesignKind,parentUuid?:string):Promise<StructuralNavigation>;
  referenceDevices(parentUuid:string):Promise<StructuralNavigation>;
  enclosureReferenceDevices():Promise<StructuralNavigation>;
  compatibleEnclosures(request:CompatibleEnclosuresRequest):Promise<CompatiblePanelNavigation>;
  compatiblePanels(request:CompatiblePanelsRequest):Promise<CompatiblePanelNavigation>;
  checkPanelReference(request:PanelReferenceCheckRequest):Promise<ReferenceCompatibility>;
  placeStructuralItem(request:ProjectStructuralPlacement):Promise<ProjectDocumentView>;
  frontAssets():Promise<Record<string,FrontVectorAsset>>;
  chooseDestination(suggestedTitle?: string): Promise<ProjectDestinationSelection | null>;
  create(request: CreateProjectRequest): Promise<ProjectDocumentView>;
  open(): Promise<ProjectDocumentView | null>;
  save(): Promise<ProjectDocumentView>;
  saveAs(): Promise<ProjectDocumentView>;
  close(): Promise<ProjectDocumentView | null>;
  current(): Promise<ProjectDocumentView | null>;
  addCatalogueProduct(catalogueProductId: number, quantity?: number, undoable?: boolean): Promise<ProjectDocumentView>;
  addConfiguredItem(request: ConfigurationRequest, quantity?: number, undoable?: boolean, autoPlace?: boolean): Promise<ProjectDocumentView>;
  duplicateConfiguredItem(lineUuid: string): Promise<ProjectDocumentView>;
  replaceConfiguredItem(lineUuid: string, request: ConfigurationRequest): Promise<ProjectDocumentView>;
  reconfigureEnclosure(nodeUuid: string, request: ConfigurationRequest): Promise<ProjectDocumentView>;
  setQuantity(lineUuid: string, quantity: number): Promise<ProjectDocumentView>;
  setLineDiscount(lineUuid: string, discountBp: number): Promise<ProjectDocumentView>;
  setComponentDiscount(itemUuid: string, seq: number, discountBp: number): Promise<ProjectDocumentView>;
  setGlobalDiscount(discountBp: number): Promise<ProjectDocumentView>;
  setLabourTotal(amountE4: number): Promise<ProjectDocumentView>;
  removeLine(lineUuid: string): Promise<ProjectDocumentView>;
  removeLines(lineUuids: readonly string[]): Promise<ProjectDocumentView>;
  checkPlacement(input:ProjectPlacementInput,movingNodeUuid?:string):Promise<ProjectPlacementCheck>;
  checkPackedChild(input:ProjectPackedChildInput):Promise<ProjectPlacementCheck>;
  placementTargets(request:ProjectPlacementTargetRequest):Promise<ProjectPlacementTargets>;
  autoPlaceItem(subject:ProjectPlacementSubject):Promise<ProjectDocumentView>;
  canDuplicatePlacedItem(nodeUuid:string):Promise<boolean>;
  duplicatePlacedItem(nodeUuid:string):Promise<ProjectDocumentView>;
  placeRoot(input:ProjectPlacementInput):Promise<ProjectDocumentView>;
  placeChild(input:ProjectPlacementInput):Promise<ProjectDocumentView>;
  moveNode(nodeUuid:string,input:ProjectPlacementInput):Promise<ProjectDocumentView>;
  unplaceNode(nodeUuid:string):Promise<ProjectDocumentView>;
  /** Unplaces a contained node and everything placed in it (a Pannello with its Apparecchi); Q unchanged. */
  unplaceSubtree(nodeUuid:string):Promise<ProjectDocumentView>;
  insertPackedChild(input:ProjectPackedChildInput,index?:number):Promise<ProjectDocumentView>;
  reorderPackedNode(nodeUuid:string,index:number):Promise<ProjectDocumentView>;
  movePackedNode(nodeUuid:string,input:ProjectPackedMoveInput):Promise<ProjectDocumentView>;
  removePackedNode(nodeUuid:string):Promise<ProjectDocumentView>;
  removePhysicalRoot(nodeUuid:string,contents:ProjectRootRemoval):Promise<ProjectDocumentView>;
  addAnnotation(input:ProjectAnnotationInput):Promise<ProjectDocumentView>;
  updateAnnotation(uuid:string,patch:ProjectAnnotationPatch):Promise<ProjectDocumentView>;
  removeAnnotation(uuid:string):Promise<ProjectDocumentView>;
  /** Annulla / Ripeti the last undoable Progettazione action (backend document history). */
  undo(expectedToken?:string):Promise<ProjectDocumentView>;
  redo():Promise<ProjectDocumentView>;
  /** Fills every free run of the capacity kind on every placed Pannello with the catalogue's filler parts. */
  fillCapacity(request:ProjectFillRequest):Promise<ProjectDocumentView>;
}

export interface ProjectHistoryState {
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
}

/** Only DIN rail is supported by the automatic fill. */
export const FILLABLE_CAPACITY_KINDS = ["din_rail"] as const;
export type FillableCapacityKind = (typeof FILLABLE_CAPACITY_KINDS)[number];
export interface ProjectFillRequest { readonly capacityKind: FillableCapacityKind; }

/** A Pannello zone the fill left (partly) empty, and why. */
export interface ProjectFillSkip {
  readonly supportUuid: string;
  readonly zoneNo: number | null;
  readonly code: string;
  readonly message: string;
}
export interface ProjectFillReport {
  /** Filler pieces placed. 0 means nothing changed (no history entry, document not dirtied). */
  readonly inserted: number;
  /** Pannelli that received at least one piece. */
  readonly supports: number;
  /** Pannelli examined (placed, with a zone of the requested capacity kind). */
  readonly examined: number;
  readonly skipped: readonly ProjectFillSkip[];
}

/** Per-export display choices, never stored in the project. */
export interface DocumentPdfOptions {
  readonly showPrices: boolean;
  readonly showDiscounts: boolean;
  readonly showLabour: boolean;
}
export const DEFAULT_DOCUMENT_PDF_OPTIONS: DocumentPdfOptions = {
  showPrices: true, showDiscounts: false, showLabour: false,
};
/** Dependent print options are cleared whenever prices are hidden. */
export function normalizeDocumentPdfOptions(options: DocumentPdfOptions): DocumentPdfOptions {
  return options.showPrices ? { ...options } : { showPrices: false, showDiscounts: false, showLabour: false };
}

export interface FrontPdfOptions { labels: boolean; dimensions: boolean; combinedWidths?: boolean; }
