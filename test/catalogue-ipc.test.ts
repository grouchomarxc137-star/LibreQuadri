import { describe, expect, it, vi } from "vitest";

import {
  InvalidCataloguePayloadError,
  parseCatalogueBrowseRequest,
  parseAttributeFilterRequest,
  parseCatalogueSearchRequest,
  parseUnclassifiedRequest,
  registerCatalogueIpc,
  type CatalogueInvokeEvent,
  type CatalogueService,
  type IpcHandlerRegistry,
} from "../src/main/catalogue/catalogue-ipc.js";
import {
  isTrustedRendererFrame,
  rendererLocation,
} from "../src/main/renderer-location.js";
import {
  CATALOGUE_ATTRIBUTE_FILTER_VALUES_MAX,
  CATALOGUE_ATTRIBUTE_FILTERS_MAX,
  CATALOGUE_CHANNELS,
  CATALOGUE_CODE_MAX_LENGTH,
  CATALOGUE_QUERY_MAX_LENGTH,
  CATALOGUE_SEARCH_MAX_LIMIT,
} from "../src/shared/catalogue.js";

describe("catalogue search payload validation", () => {
  it("accepts a well-formed request and keeps only what was given", () => {
    expect(parseCatalogueSearchRequest({ query: "LC1D09" })).toEqual({
      query: "LC1D09",
    });
    expect(
      parseCatalogueSearchRequest({ query: "", limit: 50, offset: 100 }),
    ).toEqual({ query: "", limit: 50, offset: 100 });
  });

  it.each([
    ["null", null],
    ["a string", "LC1D09"],
    ["an array", ["LC1D09"]],
    ["a number", 7],
    ["missing query", {}],
    ["numeric query", { query: 5 }],
    ["unexpected field", { query: "a", sql: "1=1" }],
    ["fractional limit", { query: "a", limit: 1.5 }],
    ["zero limit", { query: "a", limit: 0 }],
    ["string limit", { query: "a", limit: "10" }],
    ["limit above maximum", { query: "a", limit: CATALOGUE_SEARCH_MAX_LIMIT + 1 }],
    ["negative offset", { query: "a", offset: -1 }],
    ["NaN offset", { query: "a", offset: Number.NaN }],
    ["Infinity offset", { query: "a", offset: Number.POSITIVE_INFINITY }],
    ["null limit", { query: "a", limit: null }],
    ["oversized query", { query: "x".repeat(CATALOGUE_QUERY_MAX_LENGTH + 1) }],
  ])("rejects %s", (_label, payload) => {
    expect(() => parseCatalogueSearchRequest(payload)).toThrow(
      InvalidCataloguePayloadError,
    );
  });

  it("accepts a category with OR/AND attribute filters and keeps them as given", () => {
    const request = { query: "", categoryCode: "protezione.differenziali_puri", listedOnly: true,
      attributeFilters: [{ attributeCode: "poles", values: ["4p"] }, { attributeCode: "rated_residual_current", values: [30, 300] }] };
    expect(parseCatalogueSearchRequest(request)).toEqual(request);
    expect(parseCatalogueSearchRequest({ query: "x", categoryCode: "c" })).toEqual({ query: "x", categoryCode: "c" });
  });

  const values = (count: number) => Array.from({ length: count }, (_, index) => index + 1);
  it.each([
    ["filters without category", { query: "", attributeFilters: [{ attributeCode: "poles", values: ["2p"] }] }],
    ["category with review group", { query: "", categoryCode: "c", reviewGroup: { issuerId: null, brandId: 1, statisticalFamilyId: null } }],
    ["empty category", { query: "", categoryCode: "" }],
    ["numeric category", { query: "", categoryCode: 7 }],
    ["oversized category", { query: "", categoryCode: "c".repeat(CATALOGUE_CODE_MAX_LENGTH + 1) }],
    ["filters not an array", { query: "", categoryCode: "c", attributeFilters: { poles: ["2p"] } }],
    ["too many filters", { query: "", categoryCode: "c", attributeFilters: values(CATALOGUE_ATTRIBUTE_FILTERS_MAX + 1)
      .map(i => ({ attributeCode: `a${i}`, values: [1] })) }],
    ["duplicate attribute", { query: "", categoryCode: "c", attributeFilters: [{ attributeCode: "p", values: [1] }, { attributeCode: "p", values: [2] }] }],
    ["unexpected filter field", { query: "", categoryCode: "c", attributeFilters: [{ attributeCode: "p", values: [1], op: "gt" }] }],
    ["missing values", { query: "", categoryCode: "c", attributeFilters: [{ attributeCode: "p" }] }],
    ["empty values", { query: "", categoryCode: "c", attributeFilters: [{ attributeCode: "p", values: [] }] }],
    ["too many values", { query: "", categoryCode: "c", attributeFilters: [{ attributeCode: "p", values: values(CATALOGUE_ATTRIBUTE_FILTER_VALUES_MAX + 1) }] }],
    ["duplicate values", { query: "", categoryCode: "c", attributeFilters: [{ attributeCode: "p", values: [16, 16] }] }],
    ["non-finite value", { query: "", categoryCode: "c", attributeFilters: [{ attributeCode: "p", values: [Number.NaN] }] }],
    ["boolean value", { query: "", categoryCode: "c", attributeFilters: [{ attributeCode: "p", values: [true] }] }],
    ["empty option", { query: "", categoryCode: "c", attributeFilters: [{ attributeCode: "p", values: [""] }] }],
    ["range object", { query: "", categoryCode: "c", attributeFilters: [{ attributeCode: "p", values: [{ min: 1 }] }] }],
  ])("rejects %s", (_label, payload) => {
    expect(() => parseCatalogueSearchRequest(payload)).toThrow(InvalidCataloguePayloadError);
  });

  it("validates attribute filter option requests strictly", () => {
    expect(parseAttributeFilterRequest({ categoryCode: "c", listedOnly: false })).toEqual({ categoryCode: "c", listedOnly: false });
    const full = { categoryCode: "c", listedOnly: true, query: "magnetot",
      attributeFilters: [{ attributeCode: "poles", values: ["2p", "4p"] }, { attributeCode: "rated_current", values: [16] }] };
    expect(parseAttributeFilterRequest(full)).toEqual(full);
    for (const payload of [
      { categoryCode: "c", query: 5 },
      { categoryCode: "c", query: "x".repeat(CATALOGUE_QUERY_MAX_LENGTH + 1) },
      { categoryCode: "c", attributeFilters: [{ attributeCode: "poles", values: [] }] },
      { categoryCode: "c", attributeFilters: [{ attributeCode: "poles", values: ["2p", "2p"] }] },
      { categoryCode: "c", attributeFilters: [{ attributeCode: "p", values: [1] }, { attributeCode: "p", values: [2] }] },
      { categoryCode: "c", attributeFilters: [{ attributeCode: "p", values: [{ min: 1 }] }] },
      { categoryCode: "c", attributeFilters: Array.from({ length: CATALOGUE_ATTRIBUTE_FILTERS_MAX + 1 }, (_, i) => ({ attributeCode: `a${i}`, values: [1] })) },
    ]) {
      expect(() => parseAttributeFilterRequest(payload), JSON.stringify(payload).slice(0, 80)).toThrow(InvalidCataloguePayloadError);
    }
    for (const payload of [null, {}, { categoryCode: "" }, { categoryCode: "c", listedOnly: "yes" }, { categoryCode: "c", extra: 1 }]) {
      expect(() => parseAttributeFilterRequest(payload)).toThrow(InvalidCataloguePayloadError);
    }
  });

  it("accepts a query of exactly the maximum length", () => {
    const query = "x".repeat(CATALOGUE_QUERY_MAX_LENGTH);
    expect(parseCatalogueSearchRequest({ query })).toEqual({ query });
  });
});

describe("catalogue IPC registration", () => {
  const rendererUrl = rendererLocation("/app").indexUrl;
  const trustedEvent: CatalogueInvokeEvent = {
    senderFrame: { url: rendererUrl, parent: null },
  };

  function setup() {
    const handlers = new Map<
      string,
      (event: CatalogueInvokeEvent, ...args: unknown[]) => unknown
    >();
    const registry: IpcHandlerRegistry = {
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
      removeHandler: (channel) => {
        handlers.delete(channel);
      },
    };
    const service: CatalogueService = {
      browse: vi.fn(() => ({ products: [], offset: 0, hasMore: false, totalCount: 0, packages: [], packageCount: 0,
        facets: { brand: null, configurability: null, attributes: [] } })),
      manufacturerNodes: vi.fn(() => []),
      manufacturerModels: vi.fn(() => []),
      manufacturerArticles: vi.fn(() => []),
      manufacturerPositions: vi.fn(() => []),
      unclassifiedFamilies: vi.fn(() => ({ groups: [], offset: 0, hasMore: false })),
      catalogueCategories: vi.fn(() => []),
      attributeFilterOptions: vi.fn(() => ({ categoryCode: "c", totalCount: 0, attributes: [] })),
      searchCatalogue: vi.fn(() => ({ products: [], offset: 0, hasMore: false })),
      catalogueOverview: vi.fn(() => ({
        productCount: 0,
        listedProductCount: 0,
        delistedProductCount: 0,
        classifiedProductCount: 0, unclassifiedProductCount: 0,
        listedClassifiedProductCount: 0, listedUnclassifiedProductCount: 0,
        brands: [],
        currentPriceLists: [],
      })),
    };
    const dispose = registerCatalogueIpc(registry, service, (event) =>
      isTrustedRendererFrame(event.senderFrame, rendererUrl),
    );
    return { handlers, service, dispose };
  }

  it("registers exactly the catalogue channels", () => {
    const { handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual(
      Object.values(CATALOGUE_CHANNELS).sort(),
    );
  });

  it("forwards a validated request to the service", () => {
    const { handlers, service } = setup();
    handlers.get(CATALOGUE_CHANNELS.search)!(trustedEvent, {
      query: "LC1D09",
      limit: 20,
    });
    expect(service.searchCatalogue).toHaveBeenCalledWith({
      query: "LC1D09",
      limit: 20,
    });
  });

  it("never reaches the service with an invalid payload", () => {
    const { handlers, service } = setup();
    expect(() =>
      handlers.get(CATALOGUE_CHANNELS.search)!(trustedEvent, { query: 1 }),
    ).toThrow(InvalidCataloguePayloadError);
    expect(service.searchCatalogue).not.toHaveBeenCalled();
  });

  it("serves categories and validated attribute filter options", () => {
    const { handlers, service } = setup();
    handlers.get(CATALOGUE_CHANNELS.categories)!(trustedEvent);
    expect(service.catalogueCategories).toHaveBeenCalledOnce();
    handlers.get(CATALOGUE_CHANNELS.attributeFilters)!(trustedEvent, { categoryCode: "c", listedOnly: true });
    expect(service.attributeFilterOptions).toHaveBeenCalledWith({ categoryCode: "c", listedOnly: true });
    expect(() => handlers.get(CATALOGUE_CHANNELS.attributeFilters)!(trustedEvent, { categoryCode: 1 })).toThrow(InvalidCataloguePayloadError);
    expect(service.attributeFilterOptions).toHaveBeenCalledOnce();
  });

  it("serves the overview without needing any payload", () => {
    const { handlers, service } = setup();
    handlers.get(CATALOGUE_CHANNELS.overview)!(trustedEvent);
    expect(service.catalogueOverview).toHaveBeenCalledOnce();
  });

  it("validates generic manufacturer navigation requests",()=>{
    const {handlers,service}=setup();
    handlers.get(CATALOGUE_CHANNELS.manufacturerNodes)!(trustedEvent,"BTI");
    handlers.get(CATALOGUE_CHANNELS.manufacturerModels)!(trustedEvent,7);
    handlers.get(CATALOGUE_CHANNELS.manufacturerArticles)!(trustedEvent,{modelId:9,offset:10,limit:50});
    handlers.get(CATALOGUE_CHANNELS.manufacturerPositions)!(trustedEvent,12);
    expect(service.manufacturerNodes).toHaveBeenCalledWith("BTI");
    expect(service.manufacturerModels).toHaveBeenCalledWith(7);
    expect(service.manufacturerArticles).toHaveBeenCalledWith({modelId:9,offset:10,limit:50});
    expect(service.manufacturerPositions).toHaveBeenCalledWith(12);
    for(const payload of [{},{nodeId:1,modelId:2},{nodeId:-1},{modelId:1,limit:201}])
      expect(()=>handlers.get(CATALOGUE_CHANNELS.manufacturerArticles)!(trustedEvent,payload))
        .toThrow(InvalidCataloguePayloadError);
  });

  it("validates and forwards a bounded browse request", () => {
    const { handlers, service } = setup();
    const request = { nodeId: 7, query: "switch", listedOnly: true, brandMarchio: ["LEG"],
      configurable: [true], attributeFilters: [{ attributeCode: "poles", values: ["2p"] }],
      limit: 20, offset: 40 };
    expect(parseCatalogueBrowseRequest(request)).toEqual(request);
    handlers.get(CATALOGUE_CHANNELS.browse)!(trustedEvent, request);
    expect(service.browse).toHaveBeenCalledWith(request);
    for (const invalid of [null, {}, { nodeId: 0 }, { nodeId: 7, limit: 201 },
      { nodeId: 7, brandMarchio: ["A", "A"] }, { nodeId: 7, configurable: [1] },
      { nodeId: 7, query: "x".repeat(CATALOGUE_QUERY_MAX_LENGTH + 1) },
      { nodeId: 7, attributeFilters: [{ attributeCode: "x", values: [] }] }])
      expect(() => handlers.get(CATALOGUE_CHANNELS.browse)!(trustedEvent, invalid))
        .toThrow(InvalidCataloguePayloadError);
    expect(service.browse).toHaveBeenCalledOnce();
  });

  it("validates and forwards queue pages and group inspection", () => {
    const { handlers, service } = setup();
    handlers.get(CATALOGUE_CHANNELS.unclassified)!(trustedEvent, { listedOnly: false, limit: 20, offset: 40 });
    expect(service.unclassifiedFamilies).toHaveBeenCalledWith({ listedOnly: false, limit: 20, offset: 40 });
    const reviewGroup = { issuerId: null, brandId: 1, statisticalFamilyId: null };
    handlers.get(CATALOGUE_CHANNELS.search)!(trustedEvent, { query: "", reviewGroup });
    expect(service.searchCatalogue).toHaveBeenCalledWith({ query: "", reviewGroup });
  });

  it.each([null, [], { limit: 0 }, { offset: -1 }, { listedOnly: 1 }, { issuerId: 1 }, { limit: 201 }])("rejects invalid queue payload %j", payload => {
    const { handlers, service } = setup();
    expect(() => handlers.get(CATALOGUE_CHANNELS.unclassified)!(trustedEvent, payload)).toThrow(InvalidCataloguePayloadError);
    expect(service.unclassifiedFamilies).not.toHaveBeenCalled();
  });

  it.each([null, {}, { issuerId: 1, brandId: null, statisticalFamilyId: 1 },
    { issuerId: "1", brandId: 1, statisticalFamilyId: null }, { issuerId: 1, brandId: 1, statisticalFamilyId: -1 },
    { issuerId: 1, brandId: 1, statisticalFamilyId: 1, sql: "bad" }])("rejects invalid group %j", reviewGroup => {
    expect(() => parseCatalogueSearchRequest({ query: "", reviewGroup })).toThrow(InvalidCataloguePayloadError);
  });

  it("defaults queue scope without coercion", () => {
    expect(parseUnclassifiedRequest({})).toEqual({});
    expect(() => parseCatalogueSearchRequest({ query: "x", listedOnly: "true" })).toThrow(InvalidCataloguePayloadError);
  });

  it("refuses untrusted senders on every channel", () => {
    const { handlers, service } = setup();
    const untrusted: CatalogueInvokeEvent[] = [
      { senderFrame: null },
      { senderFrame: { url: "https://example.com/", parent: null } },
      { senderFrame: { url: rendererUrl, parent: {} } },
    ];
    for (const event of untrusted) {
      expect(() =>
        handlers.get(CATALOGUE_CHANNELS.search)!(event, { query: "a" }),
      ).toThrow("Untrusted IPC sender");
      expect(() => handlers.get(CATALOGUE_CHANNELS.overview)!(event)).toThrow(
        "Untrusted IPC sender",
      );
      expect(() => handlers.get(CATALOGUE_CHANNELS.unclassified)!(event, {})).toThrow("Untrusted IPC sender");
      expect(() => handlers.get(CATALOGUE_CHANNELS.categories)!(event)).toThrow("Untrusted IPC sender");
      expect(() => handlers.get(CATALOGUE_CHANNELS.attributeFilters)!(event, { categoryCode: "c" })).toThrow("Untrusted IPC sender");
    }
    expect(service.catalogueCategories).not.toHaveBeenCalled();
    expect(service.attributeFilterOptions).not.toHaveBeenCalled();
    expect(service.searchCatalogue).not.toHaveBeenCalled();
    expect(service.catalogueOverview).not.toHaveBeenCalled();
    expect(service.unclassifiedFamilies).not.toHaveBeenCalled();
  });

  it("removes its handlers on dispose", () => {
    const { handlers, dispose } = setup();
    dispose();
    expect(handlers.size).toBe(0);
  });
});

describe("trusted renderer frame", () => {
  const { indexUrl } = rendererLocation("/Users/some one/LibreQuadri");

  it("locates the built renderer and preload relative to the app root", () => {
    const location = rendererLocation("/app");
    expect(location.indexPath).toMatch(/dist[\\/]renderer[\\/]index\.html$/);
    expect(location.preloadPath).toMatch(/dist[\\/]src[\\/]preload[\\/]index\.cjs$/);
    expect(indexUrl.startsWith("file:///")).toBe(true);
    expect(indexUrl).toContain("some%20one");
  });

  it("accepts the top-level renderer page, ignoring query and hash", () => {
    expect(isTrustedRendererFrame({ url: indexUrl, parent: null }, indexUrl)).toBe(true);
    expect(
      isTrustedRendererFrame({ url: `${indexUrl}?x=1#top`, parent: null }, indexUrl),
    ).toBe(true);
  });

  it("rejects other pages, subframes, and unparsable URLs", () => {
    expect(isTrustedRendererFrame(null, indexUrl)).toBe(false);
    expect(
      isTrustedRendererFrame({ url: "file:///etc/passwd", parent: null }, indexUrl),
    ).toBe(false);
    expect(
      isTrustedRendererFrame({ url: "https://example.com/", parent: null }, indexUrl),
    ).toBe(false);
    expect(isTrustedRendererFrame({ url: indexUrl, parent: {} }, indexUrl)).toBe(false);
    expect(isTrustedRendererFrame({ url: "not a url", parent: null }, indexUrl)).toBe(false);
  });
});
