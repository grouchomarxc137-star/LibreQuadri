// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogueApi, CatalogueBrowseProduct, CatalogueBrowseRequest, CatalogueBrowseResult,
  CatalogueBrowseFilterAttribute, ManufacturerNode } from "../../src/shared/catalogue.js";
import { attributeColumns, BrowseFacets, CatalogueScreen } from "../../src/renderer/catalogue/CatalogueScreen.js";
import { BrowseSession } from "../../src/renderer/catalogue/browse-state.js";
import { fakeCatalogueApi, fakeConfigurationApi, fakeProjectApi, openProject } from "./fake-api.js";

type Facets = CatalogueBrowseResult["facets"];
const poles = (values: Array<[number, number, boolean]>, applicable = true): CatalogueBrowseFilterAttribute => ({
  code: "poles", name: "Poli", dataType: "number", unit: null, applicable,
  values: values.map(([value, count, selected]) => ({ value, label: null, count, selected })),
});
const noop = () => undefined;
const facetBar = (facets: Facets, selected: { brands?: string[]; configurability?: boolean[]; attributes?: Record<string, (string | number)[]> } = {},
  callbacks: { onBrand?: (value: string) => void; onAttribute?: (code: string, value: string | number) => void } = {}) =>
  <BrowseFacets facets={facets} brands={selected.brands ?? []} configurability={selected.configurability ?? []}
    attributes={selected.attributes ?? {}} onBrand={callbacks.onBrand ?? noop} onConfigurable={noop}
    onAttribute={callbacks.onAttribute ?? noop} />;

describe("persistent facet presentation", () => {
  const facets: Facets = {
    brand: { values: [{ value: "ALP", count: 4, selected: false }, { value: "BET", count: 0, selected: false }] },
    configurability: { values: [{ value: false, count: 0, selected: false }, { value: true, count: 4, selected: false }] },
    attributes: [poles([[1, 0, false], [2, 4, false]])],
  };
  const markup = (element: React.ReactElement) => { const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(element); return host; };

  const liveRoots: Array<{ root: Root; host: HTMLDivElement }> = [];
  beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
  afterEach(() => { for (const { root, host } of liveRoots.splice(0)) { act(() => root.unmount()); host.remove(); } vi.unstubAllGlobals(); });
  const live = (element: React.ReactElement) => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    liveRoots.push({ root, host }); act(() => root.render(element));
    const open = (name: string) => act(() => [...host.querySelectorAll<HTMLElement>("summary")].find(s => s.textContent!.startsWith(name))!.click());
    const box = (label: string) => [...document.querySelectorAll<HTMLLabelElement>(".catalogue-facet-options label")]
      .find(entry => entry.textContent!.startsWith(label))?.querySelector("input");
    return { host, root, open, box };
  };

  it("mounts only the open checklist and hides zero-count unselected options in every filter", () => {
    const { host, open, box } = live(facetBar(facets));
    expect(host.querySelector("input")).toBeNull();
    expect(document.querySelector(".catalogue-facet-options")).toBeNull();
    open("Marchio"); expect(box("BET")).toBeUndefined(); expect(box("ALP")!.disabled).toBe(false);
    open("Configurabilità"); expect(box("ALP")).toBeUndefined(); expect(box("Ordinario")).toBeUndefined(); expect(box("Configurabile")!.disabled).toBe(false);
    open("Poli"); expect(box("1")).toBeUndefined(); expect(box("2")!.disabled).toBe(false);
    expect(document.querySelectorAll(".catalogue-facet-options")).toHaveLength(1);
    open("Poli"); expect(document.querySelector(".catalogue-facet-options")).toBeNull();
  });

  it("keeps selected zero-count options removable and removes them after deselection", () => {
    const data: Facets = { ...facets, attributes: [poles([[1, 0, true], [2, 4, false]])] };
    const onBrand = vi.fn(), onAttribute = vi.fn();
    const { root, open, box } = live(facetBar(data, { brands: ["BET"], attributes: { poles: [1] } }, { onBrand, onAttribute }));
    open("Marchio"); expect(box("BET")!.checked).toBe(true);
    act(() => box("BET")!.click()); expect(onBrand).toHaveBeenCalledWith("BET");
    open("Poli"); expect(box("1")!.disabled).toBe(false);
    act(() => box("1")!.click()); expect(onAttribute).toHaveBeenCalledWith("poles", 1);
    act(() => root.render(facetBar(data)));
    expect(box("1")).toBeUndefined();
    open("Marchio"); expect(box("BET")).toBeUndefined();
  });

  it("retains unavailable facets and shows their explanation only when opened", () => {
    const inapplicable: Facets = { brand: null, configurability: null, attributes: [poles([[1, 0, false], [2, 0, false]], false)] };
    const { host, root, open } = live(facetBar(inapplicable));
    expect(host.querySelector("details")!.getAttribute("data-unavailable")).toBe("true");
    expect(document.querySelector(".catalogue-facet-note")).toBeNull();
    open("Poli"); expect(document.querySelector(".catalogue-facet-note")!.textContent).toBe("Non applicabile agli articoli di questo ramo.");
    act(() => root.render(facetBar({ ...inapplicable, attributes: [poles([[1, 0, false], [2, 0, false]], true)] })));
    expect(document.querySelector(".catalogue-facet-note")!.textContent).toContain("Nessun articolo di questo ramo");
    expect(document.querySelector(".catalogue-facet-options input")).toBeNull();
  });

  it("keeps an active but unmatched facet highlighted and counted", () => {
    const host = markup(facetBar({ brand: null, configurability: null, attributes: [poles([[1, 0, false], [2, 0, true]], false)] }, { attributes: { poles: [2] } }));
    expect(host.querySelector("details")!.getAttribute("data-active")).toBe("true");
    expect(host.querySelector("summary")!.textContent).toBe("Poli (1)");
  });

  it("offers a single-value facet as a normal checklist", () => {
    const { open, box } = live(facetBar({ brand: null, configurability: null, attributes: [poles([[2, 3, false]])] }));
    open("Poli"); expect(box("2")!.disabled).toBe(false);
  });

  it("orders long numeric lists and renders checkboxes only while open", () => {
    const { host, open } = live(facetBar({ brand: null, configurability: null,
      attributes: [poles([[20, 1, false], [1, 0, false], [5, 2, true], ...Array.from({ length: 11 }, (_, i): [number, number, boolean] => [30 + i, 1, false])])] }, { attributes: { poles: [5] } }));
    expect(host.querySelectorAll("input")).toHaveLength(0);
    open("Poli");
    const popup = document.querySelector(".catalogue-facet-options")!;
    expect([...popup.querySelectorAll("label")].map(label => label.textContent?.trim()).slice(0, 3)).toEqual(["5 2", "20 1", "30 1"]);
    expect(popup.querySelectorAll('input[type="checkbox"]')).toHaveLength(13);
    expect(popup.querySelector('input:not([type="checkbox"])')).toBeNull();
  });

  it("builds result columns only from applicable attributes", () => {
    const columns = attributeColumns({ brand: null, configurability: null, attributes: [
      poles([[2, 3, false]]), { ...poles([[1, 0, false]], false), code: "color", name: "Colore" }] });
    expect(columns.map(column => column.code)).toEqual(["poles"]);
  });
});

describe("unavailable facet styling", () => {
  const css = readFileSync("src/renderer/styles.css", "utf8");
  const rule = (selector: string) => css.split("\n").find(line => line.startsWith(`${selector} {`)) ?? "";
  it("greys unavailable options and facets with the disabled ink and keeps an active facet accented", () => {
    expect(rule('.catalogue-facet-options label[data-unavailable="true"]')).toMatch(/color:\s*var\(--librequadri-ink-disabled\)/);
    expect(rule('.catalogue-facets details[data-unavailable="true"] > summary')).toMatch(/color:\s*var\(--librequadri-ink-disabled\)/);
    expect(rule('.catalogue-facets details[data-unavailable="true"][data-active="true"] > summary')).toMatch(/color:\s*var\(--librequadri-accent-ink\)/);
  });
});

describe("browse session: facets across navigation", () => {
  const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
  const answer = (facets: Facets, products: CatalogueBrowseProduct[] = [], totalCount = products.length): CatalogueBrowseResult => ({
    products, offset: 0, hasMore: false, totalCount, packages: [], packageCount: 0, facets });
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const facetsA: Facets = { brand: null, configurability: null, attributes: [poles([[1, 2, false], [2, 2, false]])] };
  const facetsB: Facets = { brand: null, configurability: null, attributes: [poles([[1, 0, false], [2, 1, false]])] };

  function open() {
    const pending: Array<ReturnType<typeof deferred<CatalogueBrowseResult>>> = [];
    const requests: CatalogueBrowseRequest[] = [];
    const session = new BrowseSession({ browse: request => { requests.push(request);
      const next = deferred<CatalogueBrowseResult>(); pending.push(next); return next.promise; } }, noop);
    return { session, pending, requests };
  }

  it("keeps the previous facets while the next criteria load, so the bar does not disappear", async () => {
    const { session, pending } = open();
    session.select({ nodeId: 10 });
    expect(session.state.facets).toBeNull();
    pending[0]!.resolve(answer(facetsA)); await tick();
    expect(session.state.facets).toEqual(facetsA);
    session.select({ nodeId: 11 });
    expect(session.state.status).toBe("loading");
    expect(session.state.facets).toEqual(facetsA);
    expect(session.state.products).toEqual([]);
    pending[1]!.resolve(answer(facetsB)); await tick();
    expect(session.state.facets).toEqual(facetsB);
    session.select(null);
    expect(session.state.facets).toBeNull();
  });

  it("keeps the facets when a navigation request fails and recovers on retry", async () => {
    const { session, pending } = open();
    session.select({ nodeId: 10 });
    pending[0]!.resolve(answer(facetsA)); await tick();
    session.select({ nodeId: 11 });
    pending[1]!.reject(new Error("offline")); await tick();
    expect(session.state.status).toBe("error");
    expect(session.state.facets).toEqual(facetsA);
    session.select({ nodeId: 11 });
    pending[2]!.resolve(answer(facetsB)); await tick();
    expect(session.state).toMatchObject({ status: "ready", facets: facetsB });
  });

  it("ignores stale responses, including their facets and totals", async () => {
    const { session, pending } = open();
    session.select({ nodeId: 10 });
    session.select({ nodeId: 11, attributeFilters: [{ attributeCode: "poles", values: [2] }] });
    expect(pending).toHaveLength(1);
    pending[0]!.resolve(answer(facetsA, [], 9)); await tick();
    expect(session.state.status).toBe("loading");
    pending[1]!.resolve(answer(facetsB, [], 1)); await tick();
    expect(session.state).toMatchObject({ facets: facetsB, totalCount: 1, status: "ready" });
  });

  it("pages with the criteria in force and drops a page that arrives after the criteria changed", async () => {
    const { session, pending, requests } = open();
    const criteria = { nodeId: 11, query: "x", brandMarchio: ["ALP"], attributeFilters: [{ attributeCode: "poles", values: [2] }] };
    session.select(criteria);
    pending[0]!.resolve({ ...answer(facetsB), hasMore: true, products: [{ id: 1 } as CatalogueBrowseProduct], totalCount: 2 }); await tick();
    session.more();
    expect(requests[1]).toMatchObject({ ...criteria, offset: 1 });
    session.select({ nodeId: 12 });
    pending[1]!.resolve({ ...answer(facetsA), products: [{ id: 2 } as CatalogueBrowseProduct], totalCount: 2 }); await tick();
    expect(session.state.status).toBe("loading");
    expect(session.state.products).toEqual([]);
  });
});

/* A tiny in-memory catalogue that answers browse like the main-process query: disjunctive counts, node scope, paging. */
interface Article { id: number; code: string; node: number; brand: string; poles: number | null }
const node = (id: number, parentId: number | null, name: string): ManufacturerNode => ({ id, parentId, name, code: `n${id}`,
  kind: "group", levelCode: null, levelLabel: null, brandMarchio: "ALP", source: "import", sortOrder: id, articleCount: 1, packageCount: 0 });
const tree = [node(10, null, "Apparecchi"), node(11, 10, "Magnetotermici"), node(12, 10, "Ausiliari")];
const articles: Article[] = [
  ...Array.from({ length: 120 }, (_, index) => ({ id: index + 1, code: `M${String(index + 1).padStart(3, "0")}`, node: 11,
    brand: index % 5 === 0 ? "BET" : "ALP", poles: index % 2 ? 2 : 1 })),
  { id: 100, code: "AUX1", node: 12, brand: "ALP", poles: null },
];
const scope = (nodeId: number) => articles.filter(article => nodeId === 10 || article.node === nodeId);
const asProduct = (article: Article): CatalogueBrowseProduct => ({ id: article.id, brandMarchio: article.brand, brandName: article.brand,
  manufacturerCode: article.code, description: `Articolo ${article.code}`, unitOfMeasure: "PCE", isListed: true, configurable: false,
  category: null, price: null, attributes: article.poles === null ? [] : [{ code: "poles", name: "Poli", dataType: "number",
    unit: null, value: article.poles, label: null }] });
function memoryBrowse(request: CatalogueBrowseRequest): CatalogueBrowseResult {
  const brands = request.brandMarchio ?? [];
  const wanted = (request.attributeFilters ?? []).find(filter => filter.attributeCode === "poles")?.values ?? [];
  const query = (request.query ?? "").toLowerCase();
  const matches = (article: Article, skip?: "brand" | "poles") =>
    (skip === "brand" || !brands.length || brands.includes(article.brand)) &&
    (skip === "poles" || !wanted.length || (article.poles !== null && wanted.includes(article.poles))) &&
    (!query || article.code.toLowerCase().includes(query));
  const inScope = scope(request.nodeId);
  const hits = inScope.filter(article => matches(article));
  const offset = request.offset ?? 0, limit = request.limit ?? 50;
  const brandValues = ["ALP", "BET"].map(value => ({ value, count: inScope.filter(article => article.brand === value && matches(article, "brand")).length,
    selected: brands.includes(value) }));
  const polesValues: Array<[number, number, boolean]> = [1, 2].map(value => [value,
    inScope.filter(article => article.poles === value && matches(article, "poles")).length, wanted.includes(value)]);
  return { products: hits.slice(offset, offset + limit).map(asProduct), offset, hasMore: offset + limit < hits.length,
    totalCount: hits.length, packages: [], packageCount: 0, facets: { brand: { values: brandValues }, configurability: null,
      attributes: [poles(polesValues, inScope.some(article => article.poles !== null))] } };
}

describe("Catalogo screen: filters persist while navigating", () => {
  let host: HTMLDivElement, root: Root;
  let requests: CatalogueBrowseRequest[];
  let hold: Array<ReturnType<typeof gate>> | null;
  const gate = (request: CatalogueBrowseRequest) => { let release!: () => void;
    const promise = new Promise<CatalogueBrowseResult>(resolve => { release = () => resolve(memoryBrowse(request)); });
    return { promise, release }; };
  const api = (): CatalogueApi => ({ ...fakeCatalogueApi(), manufacturerNodes: async () => tree,
    browse: request => { requests.push(request);
      if (!hold) return Promise.resolve(memoryBrowse(request));
      const next = gate(request); hold.push(next); return next.promise; } });
  const flush = async () => act(async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); });
  const mount = async () => { await act(async () => root.render(<CatalogueScreen api={api()} configurationApi={fakeConfigurationApi()}
    projectApi={fakeProjectApi()} project={openProject} onProjectChange={noop} view="manufacturer" onViewChange={noop} />)); await flush(); };
  const choose = async (id: number) => { await act(async () => host.querySelector<HTMLButtonElement>(`.tree-node-label[data-node-id="${id}"]`)!.click()); await flush(); };
  const facetSummary = (name: string) => [...host.querySelectorAll<HTMLElement>(".catalogue-facets summary")].find(entry => entry.textContent!.startsWith(name))!;
  const option = (facet: string, label: string) => { const details = document.querySelector(".catalogue-facet-options") ?? facetSummary(facet).closest("details")!;
    return [...details.querySelectorAll<HTMLLabelElement>("label")].find(entry => entry.textContent!.startsWith(label))?.querySelector("input"); };
  const openFacet = async (name: string) => { if (!facetSummary(name).closest("details")!.open) await act(async () => facetSummary(name).click()); };
  const toggle = async (facet: string, label: string) => { await openFacet(facet); await act(async () => option(facet, label)!.click()); await flush(); };
  const chips = () => [...host.querySelectorAll<HTMLButtonElement>(".catalogue-active-filters button")].map(button => button.textContent!.trim());
  const last = () => requests[requests.length - 1]!;
  const count = () => host.querySelector(".catalogue-results-count")!.textContent;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    requests = []; hold = null;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

  it("keeps the filter bar visible and every selection active from parent to child to leaf", async () => {
    await mount();
    await choose(10);
    expect(count()).toContain("121 articoli");
    expect([...host.querySelectorAll(".catalogue-facets summary")].map(entry => entry.textContent)).toEqual(["Marchio", "Poli"]);
    await toggle("Poli", "2");
    await toggle("Marchio", "BET");
    expect(chips()).toEqual(["Marchio: BET ×", "Poli: 2 ×", "Azzera filtri"]);
    await choose(11);
    expect(last()).toMatchObject({ nodeId: 11, brandMarchio: ["BET"], attributeFilters: [{ attributeCode: "poles", values: [2] }] });
    expect(chips()).toEqual(["Marchio: BET ×", "Poli: 2 ×", "Azzera filtri"]);
    expect(host.querySelector(".catalogue-facets")).not.toBeNull();
    const expected = memoryBrowse({ nodeId: 11, brandMarchio: ["BET"], attributeFilters: [{ attributeCode: "poles", values: [2] }] });
    expect(count()).toContain(`${expected.totalCount} articoli`);
    expect(expected.totalCount).toBeGreaterThan(0);
    expect(host.querySelectorAll(".catalogue-article")).toHaveLength(expected.products.length);
  });

  it("shows a selection that the new branch cannot satisfy as greyed, removable and never silently ignored", async () => {
    await mount();
    await choose(10);
    await toggle("Poli", "2");
    await choose(12);
    expect(last()).toMatchObject({ nodeId: 12, attributeFilters: [{ attributeCode: "poles", values: [2] }] });
    expect(host.textContent).toContain("Nessun articolo corrisponde ai filtri.");
    expect(count()).toContain("0 articoli");
    expect(facetSummary("Poli").closest("details")!.getAttribute("data-unavailable")).toBe("true");
    expect(facetSummary("Poli").closest("details")!.getAttribute("data-active")).toBe("true");
    await openFacet("Poli");
    expect(option("Poli", "2")!.checked).toBe(true);
    expect(option("Poli", "2")!.disabled).toBe(false);
    expect(option("Poli", "1")).toBeUndefined();
    expect(document.querySelector(".catalogue-facet-note")!.textContent)
      .toBe("Non applicabile agli articoli di questo ramo.");
    expect(chips()).toContain("Poli: 2 ×");
    // The user removes it from the chip; the branch's article returns.
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".catalogue-active-filters button")]
      .find(button => button.textContent!.startsWith("Poli"))!.click()); await flush();
    expect(last().attributeFilters).toEqual([]);
    expect(count()).toContain("1 articolo");
    expect(chips()).toEqual([]);
  });

  it("hides unavailable options for the current node and shows them again on the parent", async () => {
    await mount();
    await choose(10);
    await choose(12);
    await openFacet("Marchio");
    expect(option("Marchio", "BET")).toBeUndefined();
    expect(option("Marchio", "ALP")!.disabled).toBe(false);
    await choose(10);
    await openFacet("Marchio");
    expect(option("Marchio", "BET")!.disabled).toBe(false);
    expect(option("Marchio", "BET")!.parentElement!.textContent).toContain("24");
  });

  it("removes a single filter or resets all of them, and keeps the search with its chip across navigation", async () => {
    await mount();
    await choose(10);
    await toggle("Marchio", "BET");
    await toggle("Poli", "1");
    const search = host.querySelector<HTMLInputElement>('input[aria-label="Cerca articoli"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "M0");
      search.dispatchEvent(new Event("input", { bubbles: true })); });
    await flush();
    expect(chips()).toEqual(["Ricerca: M0 ×", "Marchio: BET ×", "Poli: 1 ×", "Azzera filtri"]);
    await choose(11);
    expect(last()).toMatchObject({ nodeId: 11, query: "M0", brandMarchio: ["BET"], attributeFilters: [{ attributeCode: "poles", values: [1] }] });
    expect(search.value).toBe("M0");
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".catalogue-active-filters button")]
      .find(button => button.textContent!.startsWith("Marchio"))!.click()); await flush();
    expect(last()).toMatchObject({ brandMarchio: [], attributeFilters: [{ attributeCode: "poles", values: [1] }] });
    await act(async () => host.querySelector<HTMLButtonElement>(".catalogue-clear-filters")!.click()); await flush();
    expect(last()).toMatchObject({ query: "", brandMarchio: [], configurable: [], attributeFilters: [] });
    expect(chips()).toEqual([]);
    expect(host.querySelector(".catalogue-facets")).not.toBeNull();
  });

  it("pages with the active filters across a navigation and totals stay consistent", async () => {
    await mount();
    await choose(10);
    await toggle("Marchio", "ALP");
    await choose(11);
    const expected = memoryBrowse({ nodeId: 11, brandMarchio: ["ALP"], limit: 1000 }).totalCount;
    expect(count()).toContain(`${expected} articoli`);
    expect(host.querySelectorAll(".catalogue-article")).toHaveLength(50);
    await act(async () => host.querySelector<HTMLButtonElement>("button.more")!.click()); await flush();
    expect(last()).toMatchObject({ nodeId: 11, brandMarchio: ["ALP"], offset: 50 });
    expect(host.querySelectorAll(".catalogue-article")).toHaveLength(expected);
    expect(host.textContent).toContain(`Mostrati ${expected} di ${expected} articoli`);
  });

  it("applies only the latest navigation when responses arrive out of order", async () => {
    await mount();
    await choose(10);
    hold = [];
    await choose(11);
    await choose(12);
    expect(hold).toHaveLength(1);
    hold[0]!.release(); await flush();
    expect(hold).toHaveLength(2);
    hold[1]!.release(); await flush();
    expect(count()).toContain("1 articolo");
    expect(host.querySelector(".catalogue-article .article-code")!.textContent).toContain("AUX1");
    expect(host.querySelector(".catalogue-facets")).not.toBeNull();
  });

  it("keeps the filter bar mounted while the next node loads", async () => {
    await mount();
    await choose(10);
    hold = [];
    await choose(11);
    expect(host.querySelector(".catalogue-facets")).not.toBeNull();
    expect(host.querySelector(".catalogue-facets")!.getAttribute("aria-busy")).toBe("true");
    hold[0]!.release(); await flush();
    expect(host.querySelector(".catalogue-facets")!.hasAttribute("aria-busy")).toBe(false);
  });
});
