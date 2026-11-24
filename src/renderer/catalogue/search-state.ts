import type {
  CatalogueProduct,
  CatalogueSearchResult,
} from "../../shared/catalogue.js";

export type SearchStatus = "idle" | "loading" | "loading-more" | "ready" | "error";

export interface SearchState {
  /** The query the products below belong to. */
  readonly query: string;
  readonly products: readonly CatalogueProduct[];
  readonly hasMore: boolean;
  readonly status: SearchStatus;
  /** Identifies the newest request; answers to older ones are discarded. */
  readonly requestId: number;
}

export type SearchAction =
  | { readonly type: "reset"; readonly requestId: number }
  | {
      readonly type: "search-started";
      readonly query: string;
      readonly requestId: number;
    }
  | { readonly type: "more-started"; readonly requestId: number }
  | {
      readonly type: "succeeded";
      readonly requestId: number;
      readonly result: CatalogueSearchResult;
    }
  | { readonly type: "failed"; readonly requestId: number };

export const initialSearchState: SearchState = {
  query: "",
  products: [],
  hasMore: false,
  status: "idle",
  requestId: 0,
};

export function searchReducer(
  state: SearchState,
  action: SearchAction,
): SearchState {
  switch (action.type) {
    case "reset":
      return { ...initialSearchState, requestId: action.requestId };
    case "search-started":
      return {
        query: action.query,
        products: [],
        hasMore: false,
        status: "loading",
        requestId: action.requestId,
      };
    case "more-started":
      return { ...state, status: "loading-more", requestId: action.requestId };
    case "succeeded": {
      if (action.requestId !== state.requestId) {
        return state;
      }
      // A page that starts at the current end is a continuation; anything
      // else is the first page of the query.
      const continuation =
        state.status === "loading-more" &&
        action.result.offset === state.products.length;
      return {
        ...state,
        products: continuation
          ? [...state.products, ...action.result.products]
          : action.result.products,
        hasMore: action.result.hasMore,
        status: "ready",
      };
    }
    case "failed":
      return action.requestId === state.requestId
        ? { ...state, status: "error" }
        : state;
  }
}
