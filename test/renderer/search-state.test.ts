import { describe, expect, it } from "vitest";

import type { CatalogueProduct } from "../../src/shared/catalogue.js";
import {
  initialSearchState,
  searchReducer,
  type SearchState,
} from "../../src/renderer/catalogue/search-state.js";

function product(id: number): CatalogueProduct {
  return {
    id,
    brandMarchio: "BTI",
    brandName: "BTI",
    manufacturerCode: `P${id}`,
    description: null,
    unitOfMeasure: "PCE",
    isListed: true,
    category: null,
    attributes: [],
    price: null,
  };
}

const page = (ids: number[], offset: number, hasMore: boolean) => ({
  products: ids.map(product),
  offset,
  hasMore,
});

function ready(ids: number[], hasMore: boolean, requestId = 1): SearchState {
  return searchReducer(
    searchReducer(initialSearchState, {
      type: "search-started",
      query: "abc",
      requestId,
    }),
    { type: "succeeded", requestId, result: page(ids, 0, hasMore) },
  );
}

describe("catalogue search state", () => {
  it("starts a query by clearing previous results", () => {
    const state = searchReducer(ready([1, 2], true), {
      type: "search-started",
      query: "xyz",
      requestId: 2,
    });
    expect(state).toMatchObject({
      query: "xyz",
      products: [],
      hasMore: false,
      status: "loading",
      requestId: 2,
    });
  });

  it("stores the first page and whether more exist", () => {
    const state = ready([1, 2], true);
    expect(state.status).toBe("ready");
    expect(state.products.map((p) => p.id)).toEqual([1, 2]);
    expect(state.hasMore).toBe(true);
  });

  it("appends a continuation page after 'Mostra altri'", () => {
    const first = ready([1, 2], true);
    const loading = searchReducer(first, { type: "more-started", requestId: 2 });
    expect(loading.status).toBe("loading-more");
    expect(loading.products).toHaveLength(2);

    const next = searchReducer(loading, {
      type: "succeeded",
      requestId: 2,
      result: page([3], 2, false),
    });
    expect(next.products.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(next.hasMore).toBe(false);
    expect(next.status).toBe("ready");
  });

  it("discards answers to superseded requests", () => {
    const loading = searchReducer(initialSearchState, {
      type: "search-started",
      query: "old",
      requestId: 1,
    });
    const newer = searchReducer(loading, {
      type: "search-started",
      query: "new",
      requestId: 2,
    });

    expect(
      searchReducer(newer, {
        type: "succeeded",
        requestId: 1,
        result: page([9], 0, false),
      }),
    ).toBe(newer);
    expect(searchReducer(newer, { type: "failed", requestId: 1 })).toBe(newer);
  });

  it("ignores a late 'more' page once a new search has started", () => {
    const first = ready([1, 2], true);
    const more = searchReducer(first, { type: "more-started", requestId: 2 });
    const restarted = searchReducer(more, {
      type: "search-started",
      query: "other",
      requestId: 3,
    });
    const late = searchReducer(restarted, {
      type: "succeeded",
      requestId: 2,
      result: page([3], 2, false),
    });
    expect(late.products).toEqual([]);
    expect(late.status).toBe("loading");
  });

  it("keeps loaded rows visible when a request fails", () => {
    const loading = searchReducer(ready([1, 2], true), {
      type: "more-started",
      requestId: 2,
    });
    const failed = searchReducer(loading, { type: "failed", requestId: 2 });
    expect(failed.status).toBe("error");
    expect(failed.products).toHaveLength(2);
  });

  it("returns to idle when the query is cleared", () => {
    expect(
      searchReducer(ready([1], false), { type: "reset", requestId: 5 }),
    ).toEqual({ ...initialSearchState, requestId: 5 });
  });
});
