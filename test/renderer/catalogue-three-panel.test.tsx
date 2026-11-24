import { PreventivoContent } from "../../src/renderer/quotation/PreventivoWorkspace.js";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CatalogueBrowseProduct, CatalogueBrowseRequest, CatalogueBrowseResult, ManufacturerNode } from "../../src/shared/catalogue.js";
import type { ProjectQuotationLine } from "../../src/shared/project.js";
import { ArticleInspector, BrowseFacets, BrowseNavigation, BrowsePath, BrowseProductList,
  CatalogueScreen, nextOpenFacet, projectCatalogueProduct } from "../../src/renderer/catalogue/CatalogueScreen.js";
import { ArticleConfiguration } from "../../src/renderer/catalogue/ArticleConfiguration.js";
import { addOrdinaryQuantity, attributeRequest, BrowseSession, emptyBrowseState,
  toggleValue, validQuantity } from "../../src/renderer/catalogue/browse-state.js";
import { fakeCatalogueApi, fakeConfigurationApi, fakeProjectApi, openProject } from "./fake-api.js";

const product: CatalogueBrowseProduct = { id: 8, brandMarchio: "ALP", brandName: "Alpha",
  manufacturerCode: "A16", description: "Interruttore 16 A", unitOfMeasure: "PCE", isListed: true,
  configurable: false, category: null, price: { unitPriceE4: 123400, listPriceE4: 123400,
    priceMultiplier: 1, currency: "EUR", issuerSigla: "ISS" }, attributes: [{ code: "poles", name: "Poli",
    dataType: "number", unit: null, value: 2, label: null }] };
const facets: CatalogueBrowseResult["facets"] = {
  brand: { values: [{ value: "ALP", count: 3, selected: false }] },
  configurability: { values: [{ value: false, count: 2, selected: true },
    { value: true, count: 1, selected: false }] },
  attributes: [{ code: "poles", name: "Poli", dataType: "number", unit: null, applicable: true,
    values: [{ value: 2, label: null, count: 2, selected: false }] }],
};
const result = (products: readonly CatalogueBrowseProduct[], hasMore = false): CatalogueBrowseResult => ({
  products, offset: 0, hasMore, totalCount: products.length, packages: [], packageCount: 0, facets,
});
const node: ManufacturerNode = { id: 10, parentId: null, name: "Apparecchi", code: "root", kind: "section",
  levelCode: null, levelLabel: null, brandMarchio: "ALP", source: "import", sortOrder: 0, articleCount: 2,
  packageCount: 0 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function session() {
  const requests: CatalogueBrowseRequest[] = [];
  const pending: ReturnType<typeof deferred<CatalogueBrowseResult>>[] = [];
  const browse = (request: CatalogueBrowseRequest) => {
    requests.push(request); const next = deferred<CatalogueBrowseResult>(); pending.push(next); return next.promise;
  };
  const changes: string[] = [];
  const active = new BrowseSession({ browse }, state => changes.push(state.status));
  return { active, requests, pending, changes };
}

describe("three-panel Catalogo renderer", () => {
  it("places navigation, article results and the full-height inspector in the project frame", () => {
    const html = renderToStaticMarkup(<CatalogueScreen api={fakeCatalogueApi()}
      configurationApi={fakeConfigurationApi()} projectApi={fakeProjectApi()} project={openProject}
      onProjectChange={() => undefined} view="manufacturer" onViewChange={() => undefined} />);
    expect(html).toContain('class="catalogue-three-panel"');
    expect(html).toContain('aria-label="Navigazione produttore"');
    expect(html).toContain('aria-label="Articoli catalogo"');
    expect(html).toContain('aria-label="Scheda articolo"');
    expect(html).not.toContain('aria-label="Righe del progetto"');
    expect(html).not.toContain("Nessun prodotto nel preventivo");
  });

  it("shows only API supplied navigation nodes and marks the current path", () => {
    const html = renderToStaticMarkup(<BrowseNavigation nodes={[node,
      { ...node, id: 11, parentId: 10, name: "Magnetotermici" }]} selectedId={10} onSelect={() => undefined} />);
    expect(html).toContain("Magnetotermici");
    expect(html).toContain('aria-selected="true"');
    expect(renderToStaticMarkup(<BrowsePath nodes={[node]} selectedId={10} onSelect={() => undefined} />)).toContain('aria-current="page"');
    expect(html).toContain('title="Magnetotermici"');
    expect(html).toContain('title="Nel ramo: 2 articoli"');
    expect(html).not.toContain("Carpenterie");
  });

  it("displays the API aggregate for a parent with only descendant articles", () => {
    const root = { ...node, articleCount: 4 };
    const html = renderToStaticMarkup(<BrowseNavigation nodes={[root,
      { ...node, id: 11, parentId: 10, name: "Leaf", articleCount: 4 }]}
      selectedId={null} onSelect={() => undefined} />);
    expect(html).toContain('title="Nel ramo: 4 articoli"');
    expect(html).toContain('title="Nel ramo: 4 articoli">4</small>');
  });

  it("renders hierarchy names directly, without Gamma, Tipologia or Famiglia prefixes", () => {
    const levels: ManufacturerNode[] = [
      { ...node, id: 1, code: "tq.system.3", name: "Apparecchi", brandMarchio: "BTI" },
      { ...node, id: 2, parentId: 1, name: "Interruttori scatolati", kind: "level", brandMarchio: "BTI" },
      { ...node, id: 3, parentId: 2, name: "Megatiker M3-250", kind: "level", levelCode: "gamma",
        levelLabel: "Gamma", brandMarchio: "BTI" },
      { ...node, id: 4, parentId: 3, name: "Magnetotermici", kind: "level", levelCode: "tipologia",
        levelLabel: "Tipologia", brandMarchio: "BTI" },
      { ...node, id: 5, parentId: 4, name: "M3 250 - 25kA", kind: "group", levelCode: "famiglia",
        levelLabel: "Famiglia", brandMarchio: "BTI" },
      { ...node, id: 6, parentId: 5, name: "Sottolivello", kind: "group", brandMarchio: "BTI" },
    ];
    const html = renderToStaticMarkup(<BrowseNavigation nodes={levels} selectedId={5} onSelect={() => undefined} />);
    for (const name of ["Apparecchi BTicino", "Interruttori scatolati", "Megatiker M3-250", "Magnetotermici",
      "M3 250 - 25kA", "Sottolivello"]) expect(html).toContain(`>${name}<`);
    expect(html).not.toMatch(/Gamma:|Tipologia:|Famiglia:/);
  });

  it("shows the article description as primary text and the code as secondary text", () => {
    const html = renderToStaticMarkup(<BrowseProductList nodeId={10} browse={{ ...emptyBrowseState,
      status: "ready", products: [product], totalCount: 1 }} selectedId={null} onSelect={() => undefined}
      onMore={() => undefined} onRetry={() => undefined} />);
    expect(html).toContain('<strong class="article-description" title="Interruttore 16 A">Interruttore 16 A</strong>');
    expect(html).toContain('<small class="article-code" title="ALP · A16">ALP · A16</small>');
    expect(html).toContain('class="catalogue-result-head"');
    expect(html).toContain("Mostrati 1 di 1 articoli");
    expect(html.indexOf("Interruttore 16 A")).toBeLessThan(html.indexOf("A16"));
    expect(html).not.toContain("<strong>ALP · A16</strong>");
    expect(html).not.toContain("12,34 €");
    expect(html).not.toContain("Prezzo non disponibile");
  });

  it("marks delisted browse rows without adding a listed marker", () => {
    const render = (item: CatalogueBrowseProduct) => renderToStaticMarkup(<BrowseProductList nodeId={10}
      browse={{ ...emptyBrowseState, status: "ready", products: [item], totalCount: 1 }}
      selectedId={null} onSelect={() => undefined} onMore={() => undefined} onRetry={() => undefined} />);
    expect(render({ ...product, isListed: false, price: null })).toContain('<span class="librequadri-tag" data-tone="muted">Fuori listino</span>');
    expect(render({ ...product, isListed: false, price: null })).toContain('class="catalogue-article is-delisted"');
    const listed = render(product);
    expect(listed).not.toContain("Fuori listino");
    expect(listed).not.toContain("A listino");
  });

  it("selecting a node calls catalogue:browse and renders returned article information", async () => {
    const { active, requests, pending } = session();
    active.select({ nodeId: 10 });
    expect(requests).toEqual([{ nodeId: 10, limit: 50, offset: 0 }]);
    pending[0]!.resolve(result([product])); await tick();
    const html = renderToStaticMarkup(<BrowseProductList nodeId={10} browse={active.state}
      selectedId={8} onSelect={() => undefined} onMore={() => undefined} onRetry={() => undefined} />);
    expect(html).toContain("ALP · A16");
    expect(html).toContain("Interruttore 16 A");
    expect(html).toContain("Poli: 2");
    expect(html).toContain('aria-pressed="true"');
  });

  it("passes text, listing and selected dynamic filters to browse", () => {
    const { active, requests } = session();
    active.select({ nodeId: 10, query: "16 A", listedOnly: true, brandMarchio: ["ALP"],
      configurable: [false], attributeFilters: attributeRequest({ poles: [2] }) });
    expect(requests[0]).toMatchObject({ nodeId: 10, query: "16 A", listedOnly: true,
      brandMarchio: ["ALP"], configurable: [false], attributeFilters: [{ attributeCode: "poles", values: [2] }] });
    expect(toggleValue(["ALP"], "ALP")).toEqual([]);
  });

  it("renders only facets returned by browse", () => {
    const render = (data: CatalogueBrowseResult["facets"]) => renderToStaticMarkup(<BrowseFacets facets={data}
      brands={[]} configurability={[]} attributes={{}} onBrand={() => undefined}
      onConfigurable={() => undefined} onAttribute={() => undefined} />);
    expect(render(facets)).toContain("Configurabilità");
    expect(render(facets)).toContain("Poli");
    expect(render(facets)).toContain("<details>");
    expect(render({ brand: null, configurability: null, attributes: [] })).not.toContain("<details");
    const selected = renderToStaticMarkup(<BrowseFacets facets={facets} brands={["ALP"]}
      configurability={[false]} attributes={{ poles: [2] }} onBrand={() => undefined}
      onConfigurable={() => undefined} onAttribute={() => undefined} />);
    expect(selected).toContain("Marchio (1)");
    expect(selected).toContain("Configurabilità (1)");
    expect(selected).toContain("Poli (1)");
    expect(nextOpenFacet(null, "brand")).toBe("brand");
    expect(nextOpenFacet("brand", "attribute:poles")).toBe("attribute:poles");
    expect(nextOpenFacet("attribute:poles", "attribute:poles")).toBeNull();
  });

  it("populates the inspector, with an explicit Add only for ordinary articles", () => {
    const html = renderToStaticMarkup(<ArticleInspector product={product} quantity="3" busy={false}
      onQuantity={() => undefined} onAdd={() => undefined} onConfigure={() => undefined} />);
    expect(html).toContain("ALP"); expect(html).toContain("A16");
    expect(html).toContain("Interruttore 16 A");
    expect(html).toContain("Attributi tecnici"); expect(html).toContain("<dt title=\"Poli\">Poli</dt>");
    expect(html).toContain("Aggiungi al progetto"); expect(html).not.toContain(">Configura</button>");
    expect(html).toContain('value="3"');
  });

  it("keeps explicit listing states in the article inspector", () => {
    const render = (item: CatalogueBrowseProduct) => renderToStaticMarkup(<ArticleInspector product={item}
      quantity="1" busy={false} onQuantity={() => undefined} onAdd={() => undefined}
      onConfigure={() => undefined} />);
    expect(render(product)).not.toContain("Fuori listino");
    expect(render({ ...product, isListed: false, price: null })).toContain("Fuori listino");
  });

  it("offers Configura only when browse says configurable", () => {
    const html = renderToStaticMarkup(<ArticleInspector product={{ ...product, configurable: true }}
      quantity="1" busy={false} onQuantity={() => undefined} onAdd={() => undefined}
      onConfigure={() => undefined} />);
    expect(html).toContain(">Configura</button>");
    expect(html).not.toContain("Aggiungi al progetto");
  });

  it("keeps a known article in Scheda articolo while loading its direct configuration", () => {
    const html = renderToStaticMarkup(<ArticleInspector product={{ ...product, configurable: true }}
      quantity="1" busy={false} onQuantity={() => undefined} onAdd={() => undefined}
      onConfigure={() => undefined} configuration={slots => <ArticleConfiguration api={fakeConfigurationApi()}
        product={{ ...product, configurable: true }} busy={false} canApply lead={slots.lead} quantity={slots.quantity}
        onApply={() => undefined} />} />);
    expect(html).toContain('aria-label="Scheda articolo"');
    expect(html).toContain("ALP");
    expect(html).toContain("Ricerca della configurazione");
    expect(html).not.toContain("Gamme e strutture");
    expect(html).not.toContain("Modelli del prodotto selezionato");
  });

  it("validates quantity as an integer from 1 to 9999", () => {
    for (const value of ["", "0", "-1", "1.5", "10000", "abc", "1e2"]) expect(validQuantity(value)).toBeNull();
    expect(validQuantity("1")).toBe(1); expect(validQuantity("9999")).toBe(9999);
    const html = renderToStaticMarkup(<ArticleInspector product={product} quantity="0" busy={false}
      onQuantity={() => undefined} onAdd={() => undefined} onConfigure={() => undefined} />);
    expect(html).toContain('disabled=""'); expect(html).toContain('aria-invalid="true"');
  });

  it("invokes only the atomic add command with the selected inspector quantity", async () => {
    const line: ProjectQuotationLine = { lineType: "product", uuid: "line-1", snapshotUuid: "snap-1", itemUuid: null,
      brandMarchio: "ALP", manufacturerCode: "A16", description: "Interruttore 16 A", unitOfMeasure: "PCE",
      quantity: 1, unitListPriceE4: 123400, lineTotalE4: 123400, currency: "EUR" };
    const add = vi.fn(async (_id: number, quantity?: number) => ({ ...openProject,
      lines: [{ ...line, quantity: quantity ?? 1 }] }));
    const set = vi.fn();
    const projectApi = { addCatalogueProduct: add, setQuantity: set };
    expect(add).not.toHaveBeenCalled();
    const updated = await addOrdinaryQuantity(projectApi, product, 3);
    expect(add).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith(8, 3);
    expect(set).not.toHaveBeenCalled();
    expect(updated.lines[0]?.quantity).toBe(3);
    expect(() => addOrdinaryQuantity({ addCatalogueProduct: add }, product, 10_000)).toThrow("Quantità non valida");
    expect(add).toHaveBeenCalledOnce();
  });

  it("keeps project lines out of Catalogo and available in Preventivo", () => {
    const line: ProjectQuotationLine = { lineType: "product", uuid: "line-1", snapshotUuid: "snap-1", itemUuid: null,
      brandMarchio: "ALP", manufacturerCode: "A16", description: "Interruttore 16 A", unitOfMeasure: "PCE",
      quantity: 2, unitListPriceE4: 123400, lineTotalE4: 246800, currency: "EUR" };
    const html = renderToStaticMarkup(<CatalogueScreen api={fakeCatalogueApi()}
      configurationApi={fakeConfigurationApi()} projectApi={fakeProjectApi()}
      project={{ ...openProject, lines: [line] }} onProjectChange={() => undefined}
      view="manufacturer" onViewChange={() => undefined} />);
    expect(html).not.toContain('aria-label="Righe del progetto"');
    const quotation = renderToStaticMarkup(<PreventivoContent project={{ ...openProject, lines: [line] }} onQuantityChange={() => undefined} onRemove={() => undefined} onOpenLine={() => undefined} />);
    expect(quotation).toContain("Interruttore 16 A"); expect(quotation).toContain('aria-label="Quantità Interruttore 16 A"');
    expect(quotation).toContain('aria-label="Rimuovi Interruttore 16 A dal progetto"');
    expect(quotation).toContain('aria-label="Seleziona Interruttore 16 A per la rimozione"');
    expect(quotation).toContain('aria-label="Apri Interruttore 16 A nella scheda articolo"');
    expect(html).not.toContain("Totale preventivo");
  });

  it("resolves a saved article by exact brand and code before opening its configuration", async () => {
    const line: ProjectQuotationLine = { lineType: "product", uuid: "line-1", snapshotUuid: "snap-1", itemUuid: null,
      brandMarchio: "ALP", manufacturerCode: "A16", description: "Interruttore 16 A", unitOfMeasure: "PCE",
      quantity: 2, unitListPriceE4: 123400, lineTotalE4: 246800, currency: "EUR" };
    const catalogue = { ...fakeCatalogueApi(), search: vi.fn(async () => ({ products: [
      { ...product, id: 9, brandMarchio: "OTHER" }, product], offset: 0, hasMore: false })) };
    const configuration = { ...fakeConfigurationApi(), productModels: vi.fn(async () => [{ id: 40,
      code: "model", name: "Modello", kind: "device", brandMarchio: "ALP", active: true,
      obsolete: false, commercialContribution:"articles" as const, preselectedOptionId: null }]) };
    expect(await projectCatalogueProduct(catalogue, configuration, line)).toMatchObject({ id: 8, configurable: true });
    expect(catalogue.search).toHaveBeenCalledWith({ query: "A16", limit: 200, offset: 0 });
    expect(configuration.productModels).toHaveBeenCalledWith(8);
  });

  it("continues an exact project-article lookup beyond the first search page", async () => {
    const line: ProjectQuotationLine = { lineType: "product", uuid: "line-2", snapshotUuid: "snap-2", itemUuid: null,
      brandMarchio: "ALP", manufacturerCode: "A16", description: "Interruttore", unitOfMeasure: "PCE",
      quantity: 1, unitListPriceE4: 123400, lineTotalE4: 123400, currency: "EUR" };
    const search = vi.fn(async ({ offset }: { offset?: number }) => ({
      products: offset ? [product] : [{ ...product, brandMarchio: "OTHER" }],
      offset: offset ?? 0, hasMore: !offset,
    }));
    expect(await projectCatalogueProduct({ ...fakeCatalogueApi(), search }, fakeConfigurationApi(), line))
      .toMatchObject({ id: 8 });
    expect(search.mock.calls.map(call => call[0].offset)).toEqual([0, 1]);
  });

  it("ignores stale responses and errors after another node or filter is selected", async () => {
    const { active, pending } = session();
    active.select({ nodeId: 10 });
    active.select({ nodeId: 11, query: "new" });
    expect(pending).toHaveLength(1);
    pending[0]!.resolve(result([product])); await tick();
    expect(active.state.status).toBe("loading");
    pending[1]!.resolve(result([{ ...product, id: 9, manufacturerCode: "NEW" }])); await tick();
    expect(active.state.products.map(row => row.manufacturerCode)).toEqual(["NEW"]);
    active.select({ nodeId: 11, query: "latest" });
    pending[2]!.resolve(result([])); await tick();
    expect(active.state.products).toEqual([]);
  });

  it("load-more preserves all filters and appends the next deterministic page", async () => {
    const { active, requests, pending } = session();
    active.select({ nodeId: 10, query: "switch", listedOnly: true, brandMarchio: ["ALP"],
      configurable: [false], attributeFilters: [{ attributeCode: "poles", values: [2] }] });
    pending[0]!.resolve(result([product], true)); await tick();
    active.more();
    expect(requests[1]).toMatchObject({ ...requests[0], offset: 1 });
    pending[1]!.resolve(result([{ ...product, id: 9, manufacturerCode: "A17" }])); await tick();
    expect(active.state.products.map(row => row.manufacturerCode)).toEqual(["A16", "A17"]);
  });

  it("changing node or filter resets paging and clears old results", async () => {
    const { active, requests, pending } = session();
    active.select({ nodeId: 10 }); pending[0]!.resolve(result([product], true)); await tick();
    active.select({ nodeId: 10, listedOnly: true });
    expect(active.state.products).toEqual([]); expect(requests[1]?.offset).toBe(0);
    pending[1]!.resolve(result([product], true)); await tick();
    active.select({ nodeId: 11 });
    expect(active.state.products).toEqual([]); expect(requests[2]?.offset).toBe(0);
    active.select(null); expect(active.state).toEqual(emptyBrowseState);
  });

  it("reports failed browse and permits a fresh retry", async () => {
    const { active, pending, requests } = session();
    active.select({ nodeId: 10 }); pending[0]!.reject(new Error("offline")); await tick();
    expect(active.state.status).toBe("error");
    active.select({ nodeId: 10 }); expect(requests).toHaveLength(2);
  });
});
