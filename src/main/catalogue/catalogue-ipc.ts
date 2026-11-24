import {
  CATALOGUE_ATTRIBUTE_FILTER_VALUES_MAX,
  CATALOGUE_ATTRIBUTE_FILTERS_MAX,
  CATALOGUE_CHANNELS,
  CATALOGUE_CODE_MAX_LENGTH,
  CATALOGUE_QUERY_MAX_LENGTH,
  CATALOGUE_SEARCH_MAX_LIMIT,
  type CatalogueAttributeFilter,
  type CatalogueAttributeFilterOptions,
  type CatalogueAttributeFilterRequest,
  type CatalogueCategory,
  type CatalogueOverview,
  type CatalogueSearchRequest,
  type CatalogueSearchResult,
  type UnclassifiedRequest,
  type UnclassifiedResult,
  type CatalogueReviewGroup,
  type ManufacturerNode,type ManufacturerModel,type ManufacturerArticle,
  type ManufacturerArticleRequest,type ManufacturerPosition,
  type CatalogueBrowseRequest,type CatalogueBrowseResult,
} from "../../shared/catalogue.js";
import type { FrameLike } from "../renderer-location.js";

/** Far beyond any real catalogue; only rejects absurd values. */
const MAX_OFFSET = 10_000_000;

export interface CatalogueService {
  browse(request: CatalogueBrowseRequest): CatalogueBrowseResult;
  searchCatalogue(request: CatalogueSearchRequest): CatalogueSearchResult;
  catalogueOverview(): CatalogueOverview;
  unclassifiedFamilies(request: UnclassifiedRequest): UnclassifiedResult;
  catalogueCategories(): readonly CatalogueCategory[];
  attributeFilterOptions(request: CatalogueAttributeFilterRequest): CatalogueAttributeFilterOptions;
  manufacturerNodes(brandMarchio?:string):readonly ManufacturerNode[];
  manufacturerModels(nodeId:number):readonly ManufacturerModel[];
  manufacturerArticles(request:ManufacturerArticleRequest):readonly ManufacturerArticle[];
  manufacturerPositions(productId:number):readonly ManufacturerPosition[];
}

export interface CatalogueInvokeEvent {
  readonly senderFrame: FrameLike | null;
}

export interface IpcHandlerRegistry {
  handle(
    channel: string,
    listener: (event: CatalogueInvokeEvent, ...args: unknown[]) => unknown,
  ): void;
  removeHandler(channel: string): void;
}

export class InvalidCataloguePayloadError extends Error {
  constructor(message: string) {
    super(`Invalid catalogue request: ${message}`);
    this.name = "InvalidCataloguePayloadError";
  }
}

function optionalInteger(
  source: Record<string, unknown>,
  field: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = source[field];
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new InvalidCataloguePayloadError(
      `${field} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

/** Validates an untrusted IPC payload. Nothing is coerced. */
export function parseCatalogueSearchRequest(
  payload: unknown,
): CatalogueSearchRequest {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new InvalidCataloguePayloadError("payload must be an object");
  }

  const source = payload as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!["query", "limit", "offset", "listedOnly", "reviewGroup", "categoryCode", "attributeFilters"].includes(key)) {
      throw new InvalidCataloguePayloadError(`unexpected field "${key}"`);
    }
  }

  const query = source["query"];
  if (typeof query !== "string") {
    throw new InvalidCataloguePayloadError("query must be a string");
  }
  if (query.length > CATALOGUE_QUERY_MAX_LENGTH) {
    throw new InvalidCataloguePayloadError(
      `query must be at most ${CATALOGUE_QUERY_MAX_LENGTH} characters`,
    );
  }

  const limit = optionalInteger(source, "limit", 1, CATALOGUE_SEARCH_MAX_LIMIT);
  const offset = optionalInteger(source, "offset", 0, MAX_OFFSET);
  const listedOnly = optionalListedOnly(source);
  const reviewGroup = source.reviewGroup === undefined ? undefined : parseReviewGroup(source.reviewGroup);
  const categoryCode = source.categoryCode === undefined ? undefined : parseCode(source.categoryCode, "categoryCode");
  const attributeFilters = source.attributeFilters === undefined ? undefined : parseAttributeFilters(source.attributeFilters);
  if (attributeFilters !== undefined && categoryCode === undefined) {
    throw new InvalidCataloguePayloadError("attributeFilters require categoryCode");
  }
  if (categoryCode !== undefined && reviewGroup !== undefined) {
    throw new InvalidCataloguePayloadError("categoryCode cannot be combined with reviewGroup");
  }
  return {
    query,
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
    ...(listedOnly === undefined ? {} : { listedOnly }),
    ...(reviewGroup === undefined ? {} : { reviewGroup }),
    ...(categoryCode === undefined ? {} : { categoryCode }),
    ...(attributeFilters === undefined ? {} : { attributeFilters }),
  };
}

function parseCode(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > CATALOGUE_CODE_MAX_LENGTH) {
    throw new InvalidCataloguePayloadError(`${field} must be a non-empty string of at most ${CATALOGUE_CODE_MAX_LENGTH} characters`);
  }
  return value;
}

function parseAttributeFilters(value: unknown): CatalogueAttributeFilter[] {
  if (!Array.isArray(value) || value.length > CATALOGUE_ATTRIBUTE_FILTERS_MAX) {
    throw new InvalidCataloguePayloadError(`attributeFilters must be an array of at most ${CATALOGUE_ATTRIBUTE_FILTERS_MAX} filters`);
  }
  const codes = new Set<string>();
  return value.map((filter: unknown) => {
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) throw new InvalidCataloguePayloadError("invalid attribute filter");
    const source = filter as Record<string, unknown>;
    if (Object.keys(source).some(k => !["attributeCode", "values"].includes(k))) {
      throw new InvalidCataloguePayloadError("unexpected attribute filter field");
    }
    const attributeCode = parseCode(source.attributeCode, "attributeCode");
    if (codes.has(attributeCode)) throw new InvalidCataloguePayloadError(`duplicate attribute filter "${attributeCode}"`);
    codes.add(attributeCode);
    const values = source.values;
    if (!Array.isArray(values) || values.length === 0 || values.length > CATALOGUE_ATTRIBUTE_FILTER_VALUES_MAX) {
      throw new InvalidCataloguePayloadError(`values must contain 1 to ${CATALOGUE_ATTRIBUTE_FILTER_VALUES_MAX} entries`);
    }
    const seen = new Set<string | number>();
    for (const item of values) {
      const valid = typeof item === "number" ? Number.isFinite(item)
        : typeof item === "string" && item.length > 0 && item.length <= CATALOGUE_CODE_MAX_LENGTH;
      if (!valid) throw new InvalidCataloguePayloadError("filter values must be finite numbers or option codes");
      if (seen.has(item as string | number)) throw new InvalidCataloguePayloadError("duplicate filter value");
      seen.add(item as string | number);
    }
    return { attributeCode, values: values as (string | number)[] };
  });
}

/** Same field rules as a search request: query, listedOnly and attributeFilters. */
export function parseAttributeFilterRequest(payload: unknown): CatalogueAttributeFilterRequest {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new InvalidCataloguePayloadError("payload must be an object");
  const source = payload as Record<string, unknown>;
  if (Object.keys(source).some(k => !["categoryCode", "listedOnly", "query", "attributeFilters"].includes(k))) {
    throw new InvalidCataloguePayloadError("unexpected attribute filter request field");
  }
  const listedOnly = optionalListedOnly(source);
  const query = source.query;
  if (query !== undefined && (typeof query !== "string" || query.length > CATALOGUE_QUERY_MAX_LENGTH)) {
    throw new InvalidCataloguePayloadError(`query must be a string of at most ${CATALOGUE_QUERY_MAX_LENGTH} characters`);
  }
  const attributeFilters = source.attributeFilters === undefined ? undefined : parseAttributeFilters(source.attributeFilters);
  return {
    categoryCode: parseCode(source.categoryCode, "categoryCode"),
    ...(listedOnly === undefined ? {} : { listedOnly }),
    ...(query === undefined ? {} : { query: query as string }),
    ...(attributeFilters === undefined ? {} : { attributeFilters }),
  };
}

function optionalListedOnly(source: Record<string, unknown>): boolean | undefined {
  if (source.listedOnly !== undefined && typeof source.listedOnly !== "boolean") {
    throw new InvalidCataloguePayloadError("listedOnly must be boolean");
  }
  return source.listedOnly as boolean | undefined;
}

function parseReviewGroup(value: unknown): CatalogueReviewGroup {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidCataloguePayloadError("invalid reviewGroup");
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some(k => !["issuerId", "brandId", "statisticalFamilyId"].includes(k))) {
    throw new InvalidCataloguePayloadError("unexpected reviewGroup field");
  }
  const id = (field: string, nullable: boolean): number | null => {
    if (source[field] === null && nullable) return null;
    const result = optionalInteger(source, field, 1, Number.MAX_SAFE_INTEGER);
    if (result === undefined) throw new InvalidCataloguePayloadError(`missing ${field}`);
    return result;
  };
  return { issuerId: id("issuerId", true), brandId: id("brandId", false)!, statisticalFamilyId: id("statisticalFamilyId", true) };
}

export function parseUnclassifiedRequest(payload: unknown): UnclassifiedRequest {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new InvalidCataloguePayloadError("payload must be an object");
  const source = payload as Record<string, unknown>;
  if (Object.keys(source).some(k => !["listedOnly", "limit", "offset"].includes(k))) throw new InvalidCataloguePayloadError("unexpected queue field");
  const limit = optionalInteger(source, "limit", 1, CATALOGUE_SEARCH_MAX_LIMIT);
  const offset = optionalInteger(source, "offset", 0, MAX_OFFSET);
  const listedOnly = optionalListedOnly(source);
  return { ...(limit === undefined ? {} : { limit }), ...(offset === undefined ? {} : { offset }),
    ...(listedOnly === undefined ? {} : { listedOnly }) };
}

export function parseCatalogueBrowseRequest(payload: unknown): CatalogueBrowseRequest {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new InvalidCataloguePayloadError("browse payload must be an object");
  const source = payload as Record<string, unknown>;
  if (Object.keys(source).some(key => !["nodeId", "query", "listedOnly", "brandMarchio",
    "configurable", "attributeFilters", "limit", "offset"].includes(key)))
    throw new InvalidCataloguePayloadError("unexpected browse field");
  const nodeId = parseManufacturerId(source.nodeId);
  const query = source.query;
  if (query !== undefined && (typeof query !== "string" || query.length > CATALOGUE_QUERY_MAX_LENGTH))
    throw new InvalidCataloguePayloadError("invalid browse query");
  const listedOnly = optionalListedOnly(source);
  const limit = optionalInteger(source, "limit", 1, CATALOGUE_SEARCH_MAX_LIMIT);
  const offset = optionalInteger(source, "offset", 0, MAX_OFFSET);
  const attributeFilters = source.attributeFilters === undefined ? undefined : parseAttributeFilters(source.attributeFilters);
  const brands = source.brandMarchio;
  if (brands !== undefined && (!Array.isArray(brands) || brands.length > 50 ||
    brands.some(value => typeof value !== "string" || value.length < 1 || value.length > 20) ||
    new Set(brands).size !== brands.length))
    throw new InvalidCataloguePayloadError("invalid brand selection");
  const configurable = source.configurable;
  if (configurable !== undefined && (!Array.isArray(configurable) || configurable.length > 2 ||
    configurable.some(value => typeof value !== "boolean") || new Set(configurable).size !== configurable.length))
    throw new InvalidCataloguePayloadError("invalid configurability selection");
  return { nodeId, ...(query === undefined ? {} : { query: query as string }),
    ...(listedOnly === undefined ? {} : { listedOnly }),
    ...(limit === undefined ? {} : { limit }), ...(offset === undefined ? {} : { offset }),
    ...(attributeFilters === undefined ? {} : { attributeFilters }),
    ...(brands === undefined ? {} : { brandMarchio: brands as string[] }),
    ...(configurable === undefined ? {} : { configurable: configurable as boolean[] }) };
}

/**
 * Registers the catalogue channels. Every call is refused unless it comes from
 * a trusted renderer frame, and payloads are validated before they reach the
 * service. Returns a function that removes the handlers again.
 */
export function registerCatalogueIpc(
  registry: IpcHandlerRegistry,
  service: CatalogueService,
  isTrustedSender: (event: CatalogueInvokeEvent) => boolean,
): () => void {
  const assertTrusted = (event: CatalogueInvokeEvent): void => {
    if (!isTrustedSender(event)) {
      throw new Error("Untrusted IPC sender");
    }
  };

  registry.handle(CATALOGUE_CHANNELS.search, (event, payload) => {
    assertTrusted(event);
    return service.searchCatalogue(parseCatalogueSearchRequest(payload));
  });
  registry.handle(CATALOGUE_CHANNELS.browse, (event, payload) => {
    assertTrusted(event);
    return service.browse(parseCatalogueBrowseRequest(payload));
  });
  registry.handle(CATALOGUE_CHANNELS.overview, (event) => {
    assertTrusted(event);
    return service.catalogueOverview();
  });
  registry.handle(CATALOGUE_CHANNELS.unclassified, (event, payload) => {
    assertTrusted(event);
    return service.unclassifiedFamilies(parseUnclassifiedRequest(payload));
  });

  registry.handle(CATALOGUE_CHANNELS.categories, (event) => {
    assertTrusted(event);
    return service.catalogueCategories();
  });
  registry.handle(CATALOGUE_CHANNELS.attributeFilters, (event, payload) => {
    assertTrusted(event);
    return service.attributeFilterOptions(parseAttributeFilterRequest(payload));
  });
  registry.handle(CATALOGUE_CHANNELS.manufacturerNodes,(event,payload)=>{
    assertTrusted(event);
    if(payload!==undefined&&(typeof payload!=="string"||payload.length<1||payload.length>20))
      throw new InvalidCataloguePayloadError("invalid brand code");
    return service.manufacturerNodes(payload as string|undefined);
  });
  registry.handle(CATALOGUE_CHANNELS.manufacturerModels,(event,payload)=>{
    assertTrusted(event);
    return service.manufacturerModels(parseManufacturerId(payload));
  });
  registry.handle(CATALOGUE_CHANNELS.manufacturerPositions,(event,payload)=>{
    assertTrusted(event);
    return service.manufacturerPositions(parseManufacturerId(payload));
  });
  registry.handle(CATALOGUE_CHANNELS.manufacturerArticles,(event,payload)=>{
    assertTrusted(event);
    if(!payload||typeof payload!=="object"||Array.isArray(payload))
      throw new InvalidCataloguePayloadError("invalid article request");
    const row=payload as Record<string,unknown>;
    if(Object.keys(row).some(key=>!["nodeId","modelId","offset","limit"].includes(key))||
      (row.nodeId===undefined)===(row.modelId===undefined))
      throw new InvalidCataloguePayloadError("select exactly one node or model");
    const target=row.nodeId===undefined?{modelId:parseManufacturerId(row.modelId)}:
      {nodeId:parseManufacturerId(row.nodeId)};
    const optional=(key:string,min:number,max:number)=>{
      const value=row[key];
      if(value===undefined)return undefined;
      if(typeof value!=="number"||!Number.isSafeInteger(value)||value<min||value>max)
        throw new InvalidCataloguePayloadError(`invalid ${key}`);
      return value;
    };
    return service.manufacturerArticles({...target,
      offset:optional("offset",0,10_000_000),limit:optional("limit",1,200)});
  });

  return () => {
    registry.removeHandler(CATALOGUE_CHANNELS.browse);
    registry.removeHandler(CATALOGUE_CHANNELS.categories);
    registry.removeHandler(CATALOGUE_CHANNELS.attributeFilters);
    registry.removeHandler(CATALOGUE_CHANNELS.search);
    registry.removeHandler(CATALOGUE_CHANNELS.overview);
    registry.removeHandler(CATALOGUE_CHANNELS.unclassified);
    registry.removeHandler(CATALOGUE_CHANNELS.manufacturerNodes);
    registry.removeHandler(CATALOGUE_CHANNELS.manufacturerModels);
    registry.removeHandler(CATALOGUE_CHANNELS.manufacturerArticles);
    registry.removeHandler(CATALOGUE_CHANNELS.manufacturerPositions);
  };
}

function parseManufacturerId(value:unknown):number {
  if(typeof value!=="number"||!Number.isSafeInteger(value)||value<=0)
    throw new InvalidCataloguePayloadError("invalid navigation ID");
  return value;
}
