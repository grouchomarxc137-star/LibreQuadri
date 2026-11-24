import type { CatalogueApi, CatalogueAttributeFilter, CatalogueBrowsePackage, CatalogueBrowseProduct,
  CatalogueBrowseRequest, CatalogueBrowseResult } from "../../shared/catalogue.js";
import type { ProjectApi, ProjectDocumentView } from "../../shared/project.js";

export const BROWSE_PAGE_SIZE = 50;
export type BrowseCriteria = Omit<CatalogueBrowseRequest, "limit" | "offset">;
export interface BrowseState {
  readonly products: readonly CatalogueBrowseProduct[];
  /** Selectable configuration packages; they arrive with the first article page. */
  readonly packages: readonly CatalogueBrowsePackage[];
  readonly undecidedPackages?: readonly CatalogueBrowsePackage[];
  /** Technical filters are active and some packages in scope have untrusted (stale) offers. */
  readonly packageOffersStale?: boolean;
  readonly packageCount: number;
  readonly facets: CatalogueBrowseResult["facets"] | null;
  readonly totalCount: number;
  readonly hasMore: boolean;
  readonly status: "idle" | "loading" | "ready" | "loading-more" | "error";
}
export const emptyBrowseState: BrowseState = {
  products: [], packages: [], undecidedPackages: [], packageCount: 0, facets: null, totalCount: 0, hasMore: false, status: "idle",
};

/** One session owns paging and invalidates every older response when criteria change. */
export class BrowseSession {
  state: BrowseState = emptyBrowseState;
  private criteria: BrowseCriteria | null = null;
  private generation = 0;
  private running = false;
  private disposed = false;
  private pending: { criteria: BrowseCriteria; generation: number; offset: number; append: boolean } | null = null;
  constructor(private readonly api: Pick<CatalogueApi, "browse">,
    private readonly changed: (state: BrowseState) => void) {}

  private publish(state: BrowseState) { this.state = state; this.changed(state); }

  select(criteria: BrowseCriteria | null) {
    // React StrictMode replays effects with the same session; an explicit selection can reopen it.
    this.disposed = false;
    const generation = ++this.generation;
    this.pending = null;
    this.criteria = criteria;
    if (!criteria) { this.publish(emptyBrowseState); return; }
    // The filter bar keeps its last facets while the next page of criteria loads: it never blinks away.
    this.publish({ ...emptyBrowseState, facets: this.state.facets, status: "loading" });
    this.enqueue({ criteria, generation, offset: 0, append: false });
  }

  more() {
    if (this.disposed || !this.criteria || !this.state.hasMore || this.state.status !== "ready") return;
    const generation = this.generation;
    const offset = this.state.products.length;
    this.publish({ ...this.state, status: "loading-more" });
    this.enqueue({ criteria: this.criteria, generation, offset, append: true });
  }

  private enqueue(request: NonNullable<BrowseSession["pending"]>) {
    this.pending = request;
    this.drain();
  }

  private drain() {
    if (this.running || this.disposed || !this.pending) return;
    const request = this.pending;
    this.pending = null;
    this.running = true;
    // One IPC request at a time; intermediate clicks never build a main-process query backlog.
    let response: Promise<CatalogueBrowseResult>;
    try { response = this.api.browse({ ...request.criteria, limit: BROWSE_PAGE_SIZE, offset: request.offset }); }
    catch (error) { response = Promise.reject(error); }
    void response.then(
      result => this.accept(request.generation, result, request.append),
      () => { if (request.generation === this.generation && !this.disposed) this.publish({ ...this.state, status: "error" }); },
    ).finally(() => { this.running = false; this.drain(); });
  }

  private accept(generation: number, result: CatalogueBrowseResult, append: boolean) {
    if (this.disposed || generation !== this.generation) return;
    this.publish({ products: append ? [...this.state.products, ...result.products] : result.products,
      packages: append ? this.state.packages : result.packages,
      undecidedPackages: append ? this.state.undecidedPackages : result.undecidedPackages ?? [],
      packageOffersStale: append ? this.state.packageOffersStale : result.packageOffersStale ?? false,
      packageCount: append ? this.state.packageCount : result.packageCount,
      facets: result.facets, totalCount: result.totalCount, hasMore: result.hasMore, status: "ready" });
  }

  dispose() { this.disposed = true; this.generation++; this.pending = null; }
}

export function toggleValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter(entry => entry !== value) : [...values, value];
}

export function attributeRequest(selected: Readonly<Record<string, readonly (string | number)[]>>):
  readonly CatalogueAttributeFilter[] {
  return Object.entries(selected).filter(([, values]) => values.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([attributeCode, values]) => ({ attributeCode, values }));
}

export function validQuantity(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity <= 9_999 ? quantity : null;
}

/** The ordinary Add is one project command, with its quantity applied in main. */
export function addOrdinaryQuantity(api: Pick<ProjectApi, "addCatalogueProduct">,
  product: CatalogueBrowseProduct, quantity: number): Promise<ProjectDocumentView> {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 9_999) throw new Error("Quantità non valida.");
  return api.addCatalogueProduct(product.id, quantity);
}
