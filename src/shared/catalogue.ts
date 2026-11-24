/**
 * Catalogue contract shared by the main process, the preload script and the
 * renderer. It contains types and constants only, so it can be imported from
 * any of the three environments.
 */

export const CATALOGUE_CHANNELS = {
  search: "catalogue:search",
  overview: "catalogue:overview",
  unclassified: "catalogue:unclassified",
  categories: "catalogue:categories",
  attributeFilters: "catalogue:attribute-filters",
  manufacturerNodes: "catalogue:manufacturer-nodes",
  manufacturerModels: "catalogue:manufacturer-models",
  manufacturerArticles: "catalogue:manufacturer-articles",
  manufacturerPositions: "catalogue:manufacturer-positions",
  browse: "catalogue:browse",
} as const;

export interface ManufacturerNode {
  readonly id:number;readonly parentId:number|null;readonly name:string;readonly code:string;
  readonly kind:string;readonly levelCode:string|null;readonly levelLabel:string|null;
  readonly brandMarchio:string;readonly source:"import"|"metel"|"manual";
  readonly sortOrder:number;readonly articleCount:number;
  /** Selectable configuration models without a primary article linked directly to this node. */
  readonly packageCount:number;
}
export interface ManufacturerModel {
  readonly id:number;readonly name:string;readonly code:string;readonly kind:string;
  readonly brandMarchio:string;
}
export interface ManufacturerArticle {
  readonly id:number;readonly brandMarchio:string;readonly manufacturerCode:string;
  readonly description:string|null;readonly configurable:boolean;
}
export interface ManufacturerPosition {
  readonly nodeId:number;readonly modelId:number|null;readonly source:"import"|"metel";
}
export interface ManufacturerArticleRequest {
  readonly nodeId?:number;readonly modelId?:number;readonly offset?:number;readonly limit?:number;
}

export const CATALOGUE_QUERY_MAX_LENGTH = 200;
export const CATALOGUE_SEARCH_DEFAULT_LIMIT = 50;
export const CATALOGUE_SEARCH_MAX_LIMIT = 200;
/** Maximum length of a category, attribute or option code in a request. */
export const CATALOGUE_CODE_MAX_LENGTH = 100;
export const CATALOGUE_ATTRIBUTE_FILTERS_MAX = 20;
export const CATALOGUE_ATTRIBUTE_FILTER_VALUES_MAX = 50;

/**
 * Selected values of one attribute: option values for enum attributes, exact
 * numbers (in the attribute's unit) for number attributes. Values of the same
 * attribute are ORed; different attributes are ANDed.
 */
export interface CatalogueAttributeFilter {
  readonly attributeCode: string;
  readonly values: readonly (string | number)[];
}

export interface CatalogueSearchRequest {
  readonly query: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly reviewGroup?: CatalogueReviewGroup;
  readonly listedOnly?: boolean;
  /** Restricts results to this category and its active subcategories. The query may then be empty. */
  readonly categoryCode?: string;
  /** Requires `categoryCode`. Each attribute must apply to the selected category (subtree). */
  readonly attributeFilters?: readonly CatalogueAttributeFilter[];
}

export interface CatalogueReviewGroup {
  readonly issuerId: number | null;
  readonly brandId: number;
  readonly statisticalFamilyId: number | null;
}

export interface UnclassifiedRequest {
  readonly limit?: number;
  readonly offset?: number;
  readonly listedOnly?: boolean;
}

export interface UnclassifiedFamily extends CatalogueReviewGroup {
  readonly issuerSigla: string | null;
  readonly brandMarchio: string;
  readonly familyCode: string | null;
  readonly familyDescription: string | null;
  /** Unclassified count in the requested listed/all scope. */
  readonly unclassifiedCount: number;
  /** All products in this governing group, including classified/delisted. */
  readonly totalCount: number;
  readonly listedCount: number;
  readonly examples: readonly string[];
}

export interface UnclassifiedResult {
  readonly groups: readonly UnclassifiedFamily[];
  readonly offset: number;
  readonly hasMore: boolean;
}

/**
 * Governing issuer's current price. All amounts are integers in 1/10,000 EUR
 * (the `_e4` representation used throughout lq.db).
 */
export interface CataloguePrice {
  /** Price of one unit of measure. Primary price. */
  readonly unitPriceE4: number;
  /** Price for `priceMultiplier` units, exactly as METEL states it. */
  readonly listPriceE4: number;
  readonly priceMultiplier: number;
  readonly currency: string;
  readonly issuerSigla: string;
}

export interface CatalogueProduct {
  readonly id: number;
  /** METEL marchio sigla (display name until brands are enriched). */
  readonly brandMarchio: string;
  readonly brandName: string;
  readonly manufacturerCode: string;
  readonly description: string | null;
  readonly unitOfMeasure: string | null;
  readonly isListed: boolean;
  readonly category: { readonly code: string; readonly name: string } | null;
  /** Stored technical attribute values, in the product category's attribute order. */
  readonly attributes: readonly CatalogueProductAttribute[];
  /** `null` when delisted or when the governing issuer's current list has no price. */
  readonly price: CataloguePrice | null;
}

export type CatalogueAttributeDataType = "number" | "enum" | "boolean" | "text";

export interface CatalogueProductAttribute {
  readonly code: string;
  readonly name: string;
  readonly dataType: CatalogueAttributeDataType;
  /** Unit of number values, e.g. "A", "kA", "mA". */
  readonly unit: string | null;
  /** Number in `unit`, enum option value, boolean or text. */
  readonly value: number | string | boolean;
  /** Display label of an enum option; null for other types. */
  readonly label: string | null;
}

export interface CatalogueCategory {
  readonly code: string;
  readonly name: string;
  readonly parentCode: string | null;
  /** 0 for top-level categories. Rows are in depth-first display order. */
  readonly depth: number;
  /** Products in this category and its subcategories. */
  readonly productCount: number;
  readonly listedProductCount: number;
}

/**
 * Current catalogue state for facet counts. Interpreted exactly like the same
 * fields of a search request.
 */
export interface CatalogueAttributeFilterRequest {
  readonly categoryCode: string;
  readonly listedOnly?: boolean;
  /** Current search text; counts only products matching it. */
  readonly query?: string;
  /** Currently selected values. */
  readonly attributeFilters?: readonly CatalogueAttributeFilter[];
}

export interface CatalogueFilterValue {
  readonly value: string | number;
  /** Option label for enum attributes; null for numbers. */
  readonly label: string | null;
  /**
   * Products that would match if this value were selected in its attribute:
   * category, listed scope, query and every OTHER attribute's filters apply,
   * this attribute's own selection does not (disjunctive count).
   */
  readonly count: number;
  readonly selected: boolean;
}

export interface CatalogueFilterAttribute {
  readonly code: string;
  readonly name: string;
  readonly dataType: "number" | "enum";
  readonly unit: string | null;
  readonly values: readonly CatalogueFilterValue[];
}

export interface CatalogueAttributeFilterOptions {
  readonly categoryCode: string;
  /** Products matching the whole request: the result count of the equivalent search. */
  readonly totalCount: number;
  /**
   * Applicable filterable attributes with at least one value in the category
   * and listed scope, or with a selected value. Values are those present in
   * that scope plus any selected value, in display order; zero counts included.
   */
  readonly attributes: readonly CatalogueFilterAttribute[];
}

export interface CatalogueSearchResult {
  readonly products: readonly CatalogueProduct[];
  readonly offset: number;
  /** True when at least one more result exists beyond this page. */
  readonly hasMore: boolean;
}

/** Article browse state for a selected manufacturer or FST range node. */
export interface CatalogueBrowseRequest {
  readonly nodeId: number;
  readonly query?: string;
  readonly listedOnly?: boolean;
  readonly brandMarchio?: readonly string[];
  readonly configurable?: readonly boolean[];
  readonly attributeFilters?: readonly CatalogueAttributeFilter[];
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Browse facets are stable along a manufacturer branch: definitions and options come from the whole
 * tree the node belongs to, counts from the browsed node. An option or facet with no matching article
 * stays in the list with count 0 so the bar never changes shape while the user descends.
 */
export interface CatalogueBrowseFacet<T extends string | boolean> {
  readonly values: readonly { readonly value: T; readonly count: number; readonly selected: boolean }[];
}

/** A technical facet of a browse; `applicable` is false when no article of the browsed subtree carries a value. */
export interface CatalogueBrowseFilterAttribute extends CatalogueFilterAttribute {
  readonly applicable: boolean;
}

export interface CatalogueBrowseProduct extends CatalogueProduct {
  readonly configurable: boolean;
}

/**
 * A selectable configuration model with no primary catalogue article. It has no
 * article code or price of its own: its articles and prices come from resolution.
 */
export interface CatalogueBrowsePackage {
  readonly modelId: number;
  /** Lowest matching feasible offer; absent when no technical filter is active. */
  readonly offerNo?: number;
  readonly name: string;
  readonly kind: string;
  readonly brandMarchio: string;
  /** Name of the navigation node that holds the model within the browsed subtree. */
  readonly groupName: string;
  /** Navigation node that holds the model (the source's package class, e.g. a Famiglia). */
  readonly groupId: number;
  /**
   * Names of the navigation nodes below the browsed node, down to and including the holding
   * node (e.g. Gamma › Tipologia › Famiglia). Empty when the browsed node holds the model itself.
   * Models with the same name in different branches are told apart by this authoritative path.
   */
  readonly groupPath: readonly string[];
}

/** Packages are listed with the first article page only, up to this many. */
export const CATALOGUE_BROWSE_PACKAGE_LIMIT = 200;

export interface CatalogueBrowseResult extends CatalogueSearchResult {
  readonly products: readonly CatalogueBrowseProduct[];
  readonly totalCount: number;
  /**
   * Selectable packages in the same subtree, matching the text query and the brand and
   * configurability filters; none while a technical attribute filter is active.
   * Empty on later article pages.
   */
  readonly packages: readonly CatalogueBrowsePackage[];
  readonly packageCount: number;
  /** Candidates that could match but reached the resolver bound or have conflicting values. */
  readonly undecidedPackages?: readonly CatalogueBrowsePackage[];
  /**
   * Technical filters are active and some packages in scope have untrusted offers (stale engineering
   * data or a changed definition): they are excluded from matches and counts until the catalogue is reimported.
   */
  readonly packageOffersStale?: boolean;
  readonly facets: {
    readonly brand: CatalogueBrowseFacet<string> | null;
    readonly configurability: CatalogueBrowseFacet<boolean> | null;
    readonly attributes: readonly CatalogueBrowseFilterAttribute[];
  };
}

export interface CatalogueBrandOverview {
  readonly marchio: string;
  readonly name: string;
  readonly productCount: number;
  readonly listedProductCount: number;
}

export interface CataloguePriceListOverview {
  readonly issuerSigla: string;
  readonly listinoNumber: string;
  /** ISO date, YYYY-MM-DD. */
  readonly validFrom: string;
  /** ISO timestamp of the delivery normalization. */
  readonly importedAt: string;
  readonly listedProductCount: number;
}

export interface CatalogueOverview {
  readonly productCount: number;
  readonly listedProductCount: number;
  readonly delistedProductCount: number;
  readonly classifiedProductCount: number;
  readonly unclassifiedProductCount: number;
  readonly listedClassifiedProductCount: number;
  readonly listedUnclassifiedProductCount: number;
  readonly brands: readonly CatalogueBrandOverview[];
  readonly currentPriceLists: readonly CataloguePriceListOverview[];
}

export interface CatalogueApi {
  browse(request: CatalogueBrowseRequest): Promise<CatalogueBrowseResult>;
  search(request: CatalogueSearchRequest): Promise<CatalogueSearchResult>;
  overview(): Promise<CatalogueOverview>;
  unclassified(request: UnclassifiedRequest): Promise<UnclassifiedResult>;
  categories(): Promise<readonly CatalogueCategory[]>;
  attributeFilters(request: CatalogueAttributeFilterRequest): Promise<CatalogueAttributeFilterOptions>;
  manufacturerNodes(brandMarchio?:string):Promise<readonly ManufacturerNode[]>;
  manufacturerModels(nodeId:number):Promise<readonly ManufacturerModel[]>;
  manufacturerArticles(request:ManufacturerArticleRequest):Promise<readonly ManufacturerArticle[]>;
  manufacturerPositions(productId:number):Promise<readonly ManufacturerPosition[]>;
}

/** The only object the preload script exposes to the renderer. */
export interface LqApi {
  readonly brands: import("./brands.js").BrandApi;
  readonly metel: import("./metel-import.js").MetelImportApi;
  readonly catalogue: CatalogueApi;
  readonly configuration: import("./configuration.js").ConfigurationApi;
  readonly project: import("./project.js").ProjectApi;
  readonly app: import("./app.js").AppApi;
}
