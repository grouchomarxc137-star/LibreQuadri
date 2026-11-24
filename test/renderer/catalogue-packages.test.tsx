import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CatalogueBrowsePackage, CatalogueBrowseRequest, CatalogueBrowseResult } from "../../src/shared/catalogue.js";
import type { ConfigModelDetail, ConfigurationRequest, ConfigurationResult } from "../../src/shared/configuration.js";
import { BrowseProductList, packageGroups } from "../../src/renderer/catalogue/CatalogueScreen.js";
import { packageAddable, PackageInspectorView } from "../../src/renderer/catalogue/PackageInspector.js";
import { BrowseSession, emptyBrowseState } from "../../src/renderer/catalogue/browse-state.js";
import { emptyModelConfiguration, ModelConfigurationSession, type ModelConfigurationState }
  from "../../src/renderer/configuration/model-configuration.js";

const option = (id: number, axisId: number, label: string, isDefault = false) => ({ id, axisId, valueId: id,
  valueCode: `v${id}`, label, parentOptionId: null, isDefault, visible: true, active: true, sortOrder: id });
const model: ConfigModelDetail = {
  id: 7, code: "pack.7", name: "Pacchetto a due scelte", kind: "device", brandMarchio: "MFR", active: true,
  obsolete: false, commercialContribution:"articles", definitionFingerprint: "f", sourceRef: null, baseProfileId: 3, maxInsertQty: null,
  budgets: [], relations: [], axes: [
    { id: 1, dimensionCode: "rating", label: "Taratura", sortOrder: 1, visibility: "visible", requirement: "required",
      binding: "none", editableWhenPlaced: true, selectsPrimary: false,
      options: [option(10, 1, "25 A", true), option(11, 1, "16 A")] },
    { id: 2, dimensionCode: "mounting", label: "Esecuzione", sortOrder: 2, visibility: "visible", requirement: "required",
      binding: "none", editableWhenPlaced: true, selectsPrimary: false, options: [option(20, 2, "Cablaggio in cavo", true)] },
  ],
};
const row = (code: string, unitPriceE4: number) => ({ brandMarchio: "MFR", manufacturerCode: code, productId: 1,
  linkedBrandMarchio: "MFR", linkedManufacturerCode: code, quantity: 1, roles: ["accessory"], description: `Articolo ${code}`,
  unitPriceE4, rowTotalE4: unitPriceE4, currency: "EUR", priceIssuerSigla: "ISS", priceListinoNumber: "1",
  priceValidFrom: "2026-04-01", priceMultiplierOriginal: 1 });
const resolved = (selected: readonly number[]): ConfigurationResult => {
  const rating = selected.includes(11) ? row("FUSE16", 213_000) : row("FUSE25", 246_000);
  const bom = [rating, row("HOLDER", 2_277_000)];
  return { model, commercialContribution:"articles", selectedOptionIds: [selected.includes(11) ? 11 : 10, 20], defaultedOptionIds: [20],
    matchingRuleIds: [1], fingerprint: "fp", status: "complete", issues: [], bom,
    totalE4: bom.reduce((sum, item) => sum + item.rowTotalE4, 0), pricedSubtotalE4: 0, budgets: [],
    physical: null, exclusions: [] };
};
const item: CatalogueBrowsePackage = { modelId: 7, name: "Pacchetto a due scelte", kind: "device",
  brandMarchio: "MFR", groupName: "Famiglia di prova", groupId: 70, groupPath: ["Gamma di prova", "Famiglia di prova"] };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const ready = (overrides: Partial<ModelConfigurationState> = {}): ModelConfigurationState =>
  ({ ...emptyModelConfiguration, modelId: 7, model, result: resolved([]), ...overrides });
const inspector = (state: ModelConfigurationState, projectOpen = true, quantity = "2") => renderToStaticMarkup(
  <PackageInspectorView item={item} state={state} projectOpen={projectOpen} busy={false} quantity={quantity}
    onQuantity={() => undefined} onChoice={() => undefined} onAdd={() => undefined} />);

describe("shared model configuration session", () => {
  it("loads the model, resolves its defaults, then resolves each option change", async () => {
    const api = { model: vi.fn(async () => model),
      resolve: vi.fn(async (request: ConfigurationRequest) => resolved(request.selectedOptionIds)) };
    const session = new ModelConfigurationSession(api, () => undefined);
    session.select(7);
    await tick();
    expect(api.model).toHaveBeenCalledWith(7);
    expect(api.resolve).toHaveBeenLastCalledWith({ modelId: 7, selectedOptionIds: [] });
    expect(session.state.result?.bom.map(entry => entry.manufacturerCode)).toEqual(["FUSE25", "HOLDER"]);
    session.choose(1, 11);
    expect(session.state).toMatchObject({ resolving: true, result: null, explicit: [11] });
    await tick();
    expect(api.resolve).toHaveBeenLastCalledWith({ modelId: 7, selectedOptionIds: [11] });
    expect(session.state.result?.bom.map(entry => entry.manufacturerCode)).toEqual(["FUSE16", "HOLDER"]);
    expect(session.request()).toEqual({ modelId: 7, selectedOptionIds: [11] });
  });

  it("never lets an older resolution overwrite a newer choice", async () => {
    const pending: ReturnType<typeof deferred<ConfigurationResult>>[] = [];
    const api = { model: async () => model, resolve: (request: ConfigurationRequest) => {
      const next = deferred<ConfigurationResult>(); pending.push(next);
      void request; return next.promise; } };
    const session = new ModelConfigurationSession(api, () => undefined);
    session.select(7); await tick();
    pending[0]!.resolve(resolved([])); await tick();
    session.choose(1, 11); session.choose(1, 10);
    pending[2]!.resolve(resolved([10])); await tick();
    pending[1]!.resolve(resolved([11])); await tick();
    expect(session.state.result?.selectedOptionIds).toEqual([10, 20]);
    expect(session.request()).toEqual({ modelId: 7, selectedOptionIds: [10] });
  });
});

describe("inline package configuration in the Catalogo inspector", () => {
  it("shows compact configuration choices and the resolved articles without prices, with an enabled Add", () => {
    const html = inspector(ready());
    expect(html).toContain('aria-label="Configurazione pacchetto"');
    expect(html).toContain("Pacchetto a due scelte");
    expect(html).toContain('<p class="scheda-meta" title="Gamma di prova › Famiglia di prova">');
    expect(html).toContain('<span class="scheda-tag" data-tone="neutral">Pacchetto</span>');
    expect(html).toContain("Taratura"); expect(html).toContain("Esecuzione");
    expect(html).toContain("25 A (predefinito)"); expect(html).toContain(">16 A<");
    expect(html).toContain("Cablaggio in cavo (predefinito)");
    expect(html).toContain('<td class="scheda-bom-code" title="MFR · FUSE25">MFR · FUSE25</td>');
    expect(html).toContain("MFR · HOLDER");
    expect(html).toContain("Configurazione completa");
    expect(html).not.toContain('<th class="numeric">Qtà</th>');
    expect(html).not.toContain("Prezzo METEL unitario");
    expect(html).not.toContain("Totale METEL");
    expect(html).not.toContain("€");
    expect(html).toContain('<button type="button" class="primary">Aggiungi al progetto</button>');
    expect(packageAddable(ready(), true, false, "2")).toBe(true);
  });

  it("refuses Add for incomplete or invalid resolutions, a closed project, a busy state or a bad quantity", () => {
    for (const status of ["incomplete", "invalid", "bom_incomplete", "price_incomplete", "no_profile"] as const) {
      const state = ready({ result: { ...resolved([]), status } });
      expect(packageAddable(state, true, false, "1")).toBe(false);
      expect(inspector(state)).toContain('disabled="">Aggiungi al progetto');
    }
    expect(packageAddable(ready({ result: { ...resolved([]), model: { ...model, obsolete: true } } }), true, false, "1")).toBe(false);
    expect(packageAddable(ready({ resolving: true, result: null }), true, false, "1")).toBe(false);
    expect(packageAddable(ready(), true, true, "1")).toBe(false);
    expect(packageAddable(ready(), true, false, "0")).toBe(false);
    expect(inspector(ready(), false)).toContain("Crea o apri un progetto");
    expect(inspector(ready(), false)).toContain('disabled="">Aggiungi al progetto');
    expect(inspector(ready(), true, "10000")).toContain("Inserisci un intero da 1 a 9.999.");
  });

  it("shows loading and error states without offering Add", () => {
    expect(inspector({ ...emptyModelConfiguration, modelId: 7 })).toContain("Caricamento del pacchetto");
    expect(inspector({ ...emptyModelConfiguration, modelId: 7, modelError: true })).toContain("Impossibile leggere");
    expect(inspector({ ...emptyModelConfiguration, modelId: 7 })).not.toContain("Aggiungi al progetto");
  });

  it("shows a stale witness notice and explains undecided packages", () => {
    const stale = renderToStaticMarkup(<PackageInspectorView item={item} state={ready()} projectOpen busy={false}
      quantity="1" onQuantity={() => undefined} onChoice={() => undefined} onAdd={() => undefined} offerStale />);
    expect(stale).toContain("La configurazione filtrata non è più disponibile");
    const undecided = renderToStaticMarkup(<BrowseProductList nodeId={1} browse={{ ...emptyBrowseState,
      status: "ready", undecidedPackages: [item] }} selectedId={null} onSelect={() => undefined}
      onMore={() => undefined} onRetry={() => undefined} />);
    expect(undecided).toContain("Non valutabili con questi filtri (1)");
    expect(undecided).toContain("Non valutabile");
    expect(undecided).not.toContain("Pacchetti <small>");
  });

  it("explains that stale engineering data excludes packages from technical filters", () => {
    const list = (packageOffersStale: boolean) => renderToStaticMarkup(<BrowseProductList nodeId={1}
      browse={{ ...emptyBrowseState, status: "ready", packageOffersStale }} selectedId={null}
      onSelect={() => undefined} onMore={() => undefined} onRetry={() => undefined} />);
    expect(list(true)).toContain("I dati di ingegneria sono obsoleti");
    expect(list(true)).toContain("I pacchetti non possono essere filtrati per caratteristiche tecniche.");
    expect(list(false)).not.toContain("I dati di ingegneria sono obsoleti");
  });
});

describe("package rows in the article list", () => {
  it("shows the package name as primary identity under its source class, with no article code or invented price", () => {
    const html = renderToStaticMarkup(<BrowseProductList nodeId={1} browse={{ ...emptyBrowseState, status: "ready",
      packages: [item], packageCount: 1 }} selectedId={null} selectedPackageId={7} onSelect={() => undefined}
      onSelectPackage={() => undefined} onMore={() => undefined} onRetry={() => undefined} />);
    expect(html).toMatch(/Pacchetti <small>1<\/small><span class="catalogue-list-note">da configurare · generano più articoli<\/span>/);
    expect(html).not.toContain("Pacchetti configurabili");
    expect(html).toContain('<div class="catalogue-package-group" title="Gamma di prova › Famiglia di prova"><span>Gamma di prova › </span><strong>Famiglia di prova</strong></div>');
    expect(html).toContain('<strong class="article-description">Pacchetto a due scelte</strong>');
    expect(html).toContain('title="Pacchetto a due scelte — Gamma di prova — Famiglia di prova"');
    expect(html).toContain("MFR · Pacchetto</small>");
    expect(html).not.toContain("Prezzo dalla configurazione");
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain("article-code");
    expect(html).not.toContain("Nessun articolo corrisponde");
  });

  it("groups same-named packages under their distinct authoritative branches, never by internal codes", () => {
    const pack = (modelId: number, groupId: number, gamma: string, tipologia: string): CatalogueBrowsePackage => ({
      modelId, name: "M2 - Sezionatore 2P CC", kind: "device", brandMarchio: "BTI", groupName: "M2 - Sezionatore CC",
      groupId, groupPath: [gamma, tipologia, "M2 - Sezionatore CC"] });
    const packages = [pack(3745, 2231, "Megatiker M2 Corrente Continua", "Sezionatori"),
      pack(3746, 2232, "Megatiker M2 Corrente Continua", "Sezionatori per Avanquadro"),
      pack(3747, 2321, "Megatiker DIN M2 Corrente Continua", "Sezionatori")];
    expect(packageGroups(packages).map(group => [group.groupId, group.items.map(entry => entry.modelId)]))
      .toEqual([[2231, [3745]], [2232, [3746]], [2321, [3747]]]);
    expect(packageGroups([packages[0]!, { ...packages[0]!, modelId: 9 }])).toHaveLength(1);
    const html = renderToStaticMarkup(<BrowseProductList nodeId={1} browse={{ ...emptyBrowseState, status: "ready",
      packages, packageCount: 3 }} selectedId={null} onSelect={() => undefined}
      onSelectPackage={() => undefined} onMore={() => undefined} onRetry={() => undefined} />);
    const headers = [...html.matchAll(/<div class="catalogue-package-group" title="([^"]+)">/g)].map(match => match[1]);
    expect(headers).toEqual(["Megatiker M2 Corrente Continua › Sezionatori › M2 - Sezionatore CC",
      "Megatiker M2 Corrente Continua › Sezionatori per Avanquadro › M2 - Sezionatore CC",
      "Megatiker DIN M2 Corrente Continua › Sezionatori › M2 - Sezionatore CC"]);
    expect(new Set([...html.matchAll(/<button[^>]*catalogue-package[^>]*title="([^"]+)"/g)].map(match => match[1])).size).toBe(3);
    expect(html).not.toContain("tq.pack");
    const root = renderToStaticMarkup(<BrowseProductList nodeId={1} browse={{ ...emptyBrowseState, status: "ready",
      packages: [{ ...item, groupPath: [] }], packageCount: 1 }} selectedId={null} onSelect={() => undefined}
      onMore={() => undefined} onRetry={() => undefined} />);
    expect(root).not.toContain("catalogue-package-group");
  });

  it("keeps first-page packages when more articles are appended", async () => {
    const article: CatalogueBrowseResult["products"][number] = { id: 1, brandMarchio: "MFR", brandName: "Maker",
      manufacturerCode: "A1", description: "Articolo", unitOfMeasure: "PCE", isListed: true, configurable: false,
      category: null, price: null, attributes: [] };
    const pages: Array<Pick<CatalogueBrowseResult, "products" | "packages" | "packageCount" | "hasMore">> = [
      { products: [article], packages: [item], packageCount: 1, hasMore: true },
      { products: [{ ...article, id: 2 }], packages: [], packageCount: 0, hasMore: false }];
    const requests: CatalogueBrowseRequest[] = [];
    const session = new BrowseSession({ browse: async request => {
      requests.push(request);
      return { offset: request.offset ?? 0, totalCount: 2,
        facets: { brand: null, configurability: null, attributes: [] }, ...pages[requests.length - 1]! };
    } }, () => undefined);
    session.select({ nodeId: 1 }); await tick();
    session.more(); await tick();
    expect(requests.map(request => request.offset)).toEqual([0, 1]);
    expect(session.state).toMatchObject({ packages: [item], packageCount: 1, hasMore: false });
    expect(session.state.products.map(product => product.id)).toEqual([1, 2]);
  });
});
