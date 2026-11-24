import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CatalogueBrowseProduct } from "../../src/shared/catalogue.js";
import type { ConfigModelDetail, ConfigurationResult } from "../../src/shared/configuration.js";
import type { ProjectConfiguredItem, ProjectQuotationLine } from "../../src/shared/project.js";
import { ArticleInspector, CatalogueScreen, ConfiguredItemIdentity } from "../../src/renderer/catalogue/CatalogueScreen.js";
import { ArticleConfiguration, ArticleConfigurationView, configurationApplicable }
  from "../../src/renderer/catalogue/ArticleConfiguration.js";
import { QuantityStepper, SchedaFooter, quantityAccepted, type SchedaQuantity } from "../../src/renderer/catalogue/Scheda.js";
import { ConfigurationAxes, configurationStatus, demandShortText, physicalRows, visibleIssues }
  from "../../src/renderer/catalogue/SchedaConfiguration.js";
import { emptyModelConfiguration, ModelConfigurationSession, restoredOptionIds, type ModelConfigurationState } from "../../src/renderer/configuration/model-configuration.js";
import { fakeCatalogueApi, fakeConfigurationApi, fakeProjectApi, openProject } from "./fake-api.js";

const product: CatalogueBrowseProduct = { id: 8, brandMarchio: "BTI", brandName: "BTicino", manufacturerCode: "FN82C16",
  description: "Magnetotermico 1P+N C16 4,5 kA 1 modulo", unitOfMeasure: "PCE", isListed: true, configurable: false,
  category: { code: "mcb", name: "Magnetotermici" },
  price: { unitPriceE4: 123400, listPriceE4: 123400, priceMultiplier: 1, currency: "EUR", issuerSigla: "BTI" },
  attributes: [
    { code: "poles", name: "Poli", dataType: "enum", unit: null, value: "1pn", label: "1P+N" },
    { code: "rated_current", name: "Corrente nominale", dataType: "number", unit: "A", value: 16, label: null },
    { code: "trip_curve", name: "Curva di intervento", dataType: "enum", unit: null, value: "c", label: "C" },
    { code: "declared_breaking_capacity", name: "Potere di interruzione (dichiarato)", dataType: "number", unit: "kA",
      value: 4.5, label: null },
  ] };
const option = (id: number, axisId: number, label: string, isDefault = false, parentOptionId: number | null = null) =>
  ({ id, axisId, valueId: id, valueCode: `v${id}`, label, parentOptionId, isDefault, visible: true, active: true, sortOrder: id });
const model: ConfigModelDetail = {
  id: 40, code: "tq.pack.4395", name: "BTDIN60 magnetotermico", kind: "device", brandMarchio: "BTI", active: true,
  obsolete: false, commercialContribution:"articles", definitionFingerprint: "f", sourceRef: null, baseProfileId: 3, maxInsertQty: null, budgets: [],
  relations: [], axes: [
    { id: 1, dimensionCode: "rating", label: "Corrente nominale", sortOrder: 1, visibility: "visible", requirement: "required",
      binding: "none", editableWhenPlaced: true, selectsPrimary: true,
      options: [option(10, 1, "16 A", true), option(11, 1, "20 A")] },
    { id: 2, dimensionCode: "aux", label: "Contatto ausiliario", sortOrder: 2, visibility: "visible", requirement: "optional",
      binding: "none", editableWhenPlaced: true, selectsPrimary: false, options: [option(20, 2, "F80RC")] },
    { id: 3, dimensionCode: "internal", label: "Interno", sortOrder: 3, visibility: "hidden", requirement: "optional",
      binding: "none", editableWhenPlaced: false, selectsPrimary: false, options: [option(30, 3, "Segreto", true)] },
  ],
};
const bomRow = (code: string, roles: string[], productId: number | null = 1) => ({ brandMarchio: "BTI",
  manufacturerCode: code, productId, linkedBrandMarchio: productId === null ? null : "BTI",
  linkedManufacturerCode: productId === null ? null : code, quantity: 1, roles, description: `Articolo ${code}`,
  unitPriceE4: 123400, rowTotalE4: 123400, currency: "EUR", priceIssuerSigla: "BTI", priceListinoNumber: "21",
  priceValidFrom: "2026-07-01", priceMultiplierOriginal: 1 });
const complete: ConfigurationResult = {
  model, commercialContribution:"articles", selectedOptionIds: [10, 20, 30], defaultedOptionIds: [10, 30], matchingRuleIds: [1], fingerprint: "fp",
  status: "complete", issues: [], bom: [bomRow("FN82C16", ["primary"]), bomRow("F80RC", ["accessory"])],
  totalE4: 246800, pricedSubtotalE4: 246800, budgets: [], exclusions: [],
  physical: { id: 5, code: "tq.app.16402", name: "Btdin Mgt", kind: "device", profileKey: 1,
    fitClass: { id: 1, code: "tq.app.10", name: "Apparatus 10" }, depthMm: 70, outerDepthMm: null, usableDepthMm: null,
    demands: [{ capacityKindCode: "din_rail", amount: 6, unitLabel: "moduli", displayDivisor: 2, nominalPitchMm: 9 }],
    views: [{ code: "front", widthMm: 54, heightMm: 80, insertDxMm: 0, insertDyMm: 0, symbolKind: "modular_device", assetKey: null },
      { code: "front_alt1", widthMm: 0, heightMm: 0, insertDxMm: 0, insertDyMm: 0, symbolKind: "none", assetKey: null }],
    zones: [], slots: [], constraints: [] },
};
const state = (overrides: Partial<ModelConfigurationState> = {}): ModelConfigurationState =>
  ({ ...emptyModelConfiguration, modelId: 40, model, result: complete, ...overrides });
const newQuantity = (value = "2"): SchedaQuantity => ({ kind: "new", value, onChange: () => undefined });
const item: ProjectConfiguredItem = {
  uuid: "item-1", commercialContribution:"articles", modelBrandMarchio: "BTI", modelCode: "tq.pack.4395", modelName: "BTDIN60 magnetotermico",
  modelKind: "device", modelDefinitionFingerprint: "f", modelSourceRef: null, configFingerprint: "fp",
  configLabel: "tq.pack.4395", configStatus: "complete", physStatus: "resolved", profileCode: "tq.app.16402",
  profileName: null, fitClassCode: null, fitClassLabel: null, depthMm: 70, outerDepthMm: null, usableDepthMm: null,
  selections: [{ dimensionCode: "rating", dimensionLabel: "Corrente nominale", valueCode: "v10", valueLabel: "16 A",
    selectionSource: "user", binding: "none", editableWhenPlaced: true, visible: true }],
  bom: [{ seq: 0, snapshotUuid: "s1", brandMarchio: "BTI", manufacturerCode: "FN82C16", description: "Magnetotermico",
    quantityPerItem: 1, role: "primary", listPriceUnitE4: 123400, salePriceUnitE4: null }],
  demands: [], views: [], zones: [], slots: [], constraints: [], exclusions: [],
};
const view = (overrides: Partial<Parameters<typeof ArticleConfigurationView>[0]> = {}) =>
  renderToStaticMarkup(<ArticleConfigurationView state={state()} replacing={false} busy={false} canApply
    lead={<p>Identità</p>} quantity={newQuantity()} onChoice={() => undefined} onApply={() => undefined} {...overrides} />);
const inspector = (props: Partial<Parameters<typeof ArticleInspector>[0]> = {}) => renderToStaticMarkup(
  <ArticleInspector product={product} quantity="1" busy={false} onQuantity={() => undefined} onAdd={() => undefined}
    onConfigure={() => undefined} {...props} />);

describe("R-17d2 Scheda articolo: ordinary article", () => {
  it("leads with a compact identity: mono brand · code, listing, 15/20 description and a secondary line", () => {
    const html = inspector();
    expect(html).toContain('<section class="catalogue-pane catalogue-inspector scheda" aria-label="Scheda articolo">');
    expect(html).toContain('<span class="scheda-code" title="BTI · FN82C16">BTI · FN82C16</span>');
    expect(html).toContain('<span class="scheda-listing">A listino</span>');
    expect(html).toContain('<h3 class="scheda-title" title="Magnetotermico 1P+N C16 4,5 kA 1 modulo">');
    expect(html).toContain('<p class="scheda-meta" title="BTicino · Magnetotermici · UM PCE">');
    expect(html.indexOf("scheda-identity")).toBeLessThan(html.indexOf("Attributi tecnici"));
  });

  it("lists technical attributes as a dense, collapsible property grid with formatted values", () => {
    const html = inspector();
    expect(html).toContain('<details class="scheda-section" open="">');
    expect(html).toMatch(/Attributi tecnici<\/span><small>4<\/small>/);
    expect(html).toContain('<dt title="Corrente nominale">Corrente nominale</dt><dd title="16 A">16 A</dd>');
    expect(html).toContain('<dd title="1P+N">1P+N</dd>');
    expect(html).toContain('<dt title="Potere di interruzione (dichiarato)">');
    expect(html).toContain('<dd title="4,5 kA">4,5 kA</dd>');
    expect(inspector({ product: { ...product, attributes: [] } })).not.toContain("Attributi tecnici");
  });

  it("keeps Catalogo prices hidden (R-02) and shows no configuration for an ordinary article", () => {
    const html = inspector();
    expect(html).not.toContain("€"); expect(html).not.toContain("12,34");
    expect(html).not.toContain(">Configura</button>"); expect(html).not.toContain("Distinta articoli");
  });

  it("puts quantity and the one primary Add action in the fixed footer", () => {
    const html = inspector({ quantity: "3" });
    const footer = html.slice(html.indexOf('<footer class="scheda-footer">'));
    expect(footer).toContain('aria-label="Riduci quantità"'); expect(footer).toContain('aria-label="Aumenta quantità"');
    expect(footer).toContain('value="3"');
    expect(footer).toContain('<button type="button" class="primary">Aggiungi al progetto</button>');
    expect(html.match(/class="primary"/g)).toHaveLength(1);
    expect(html.indexOf('class="scheda-body"')).toBeLessThan(html.indexOf('class="scheda-footer"'));
  });

  it("shows the neutral Fuori listino state for a delisted article and still offers Add", () => {
    const html = inspector({ product: { ...product, isListed: false, price: null } });
    expect(html).toContain('<span class="scheda-tag" data-tone="neutral">Fuori listino</span>');
    expect(html).not.toContain("A listino");
    expect(html).not.toMatch(/data-tone="(warn|error)"/);
    expect(html).toContain('<button type="button" class="primary">Aggiungi al progetto</button>');
  });

  it("omits an unenriched brand name and missing category from the secondary line", () => {
    const html = inspector({ product: { ...product, brandName: "BTI", category: null, unitOfMeasure: null } });
    expect(html).not.toContain("scheda-meta");
  });

  it("shows an ordinary project line read only, with its project quantity and no Add", () => {
    const line: ProjectQuotationLine = { lineType: "product", uuid: "l1", snapshotUuid: "s1", itemUuid: null,
      brandMarchio: "BTI", manufacturerCode: "FN82C16", description: "Magnetotermico", unitOfMeasure: "PCE",
      quantity: 4, unitListPriceE4: 1, lineTotalE4: 4, currency: "EUR" };
    const html = inspector({ line });
    expect(html).toContain('<span>Quantità nel progetto</span><strong>4</strong>');
    expect(html).not.toContain("Aggiungi al progetto"); expect(html).not.toContain('type="number"');
    const missing = inspector({ line, product: null });
    expect(missing).toContain("Articolo non disponibile nel catalogo corrente.");
    expect(missing).toContain('data-tone="warn"');
    expect(inspector({ line, product: null, lookupPending: true })).toContain("Ricerca dell’articolo nel catalogo corrente…");
  });

  it("refuses Add without an open project and says why", () => {
    const html = inspector({ projectOpen: false });
    expect(html).toContain('disabled="">Aggiungi al progetto');
    expect(html).toContain("Crea o apri un progetto per aggiungere l’articolo.");
  });

  it("shows an empty Scheda without a footer until something is selected", () => {
    const html = inspector({ product: null });
    expect(html).toContain("Seleziona un articolo dall’elenco per vedere la scheda.");
    expect(html).not.toContain("scheda-footer");
  });
});

describe("R-17d2 Scheda articolo: quantity", () => {
  it("steps within 1–9,999 and flags an invalid entry beside the action", () => {
    expect(renderToStaticMarkup(<QuantityStepper value="1" onChange={() => undefined} />))
      .toMatch(/aria-label="Riduci quantità" disabled=""/);
    expect(renderToStaticMarkup(<QuantityStepper value="9999" onChange={() => undefined} />))
      .toMatch(/aria-label="Aumenta quantità" disabled=""/);
    const invalid = renderToStaticMarkup(<SchedaFooter quantity={newQuantity("0")} busy={false}
      action={<button type="button">Azione</button>} />);
    expect(invalid).toContain('aria-invalid="true"');
    expect(invalid).toContain('<p class="scheda-footer-note error" role="alert">Inserisci un intero da 1 a 9.999.</p>');
    expect(quantityAccepted(newQuantity("10000"))).toBe(false);
    expect(quantityAccepted({ kind: "project", quantity: 3 })).toBe(true);
    expect(inspector({ quantity: "abc" })).toContain('disabled="">Aggiungi al progetto');
  });
});

describe("R-17d2 Scheda articolo: configurable article", () => {
  it("restores a dependent default after navigating away and back without showing Scegli while resolving", async () => {
    const dependent = { ...model, axes: [
      { ...model.axes[0]!, visibility: "hidden", options: [option(10, 1, "Parent", true)] },
      { ...model.axes[1]!, label: "Fasi di cablaggio", requirement: "required",
        options: [option(20, 2, "L1 - N", true, 10)] },
    ] };
    const resolved = { ...complete, model: dependent, selectedOptionIds: [10,20], defaultedOptionIds: [10,20] };
    const session = new ModelConfigurationSession({ model: async () => dependent,
      resolve: async () => resolved }, () => undefined);
    session.select(dependent.id, product.id);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(session.state.result?.selectedOptionIds).toEqual([10,20]);
    session.choose(2,20);
    await new Promise(resolve => setTimeout(resolve, 0));
    session.select(null);
    session.select(dependent.id, product.id);
    expect(renderToStaticMarkup(<ConfigurationAxes model={dependent} result={null} busy
      onChoice={() => undefined} />)).not.toContain("Scegli…");
    await new Promise(resolve => setTimeout(resolve, 0));
    const html = renderToStaticMarkup(<ConfigurationAxes model={dependent} result={session.state.result}
      busy={false} onChoice={() => undefined} />);
    expect(html).toContain('value="20"');
    expect(html).toContain("L1 - N (predefinito)");
    expect(html).not.toContain("Scegli prima");
  });

  it("uses the saved hidden parent to disambiguate repeated child value codes", async () => {
    const dependent = { ...model, axes:[
      {...model.axes[0]!,visibility:"hidden",options:[option(10,1,"Cable",true),option(11,1,"Terminal")]},
      {...model.axes[1]!,label:"Fasi di cablaggio",requirement:"required",options:[
        option(20,2,"L1 - N",true,10),{...option(21,2,"L1 - N",true,11),valueCode:"v20"},
      ]},
    ] };
    const saved = [{dimensionCode:"rating",valueCode:"v10"},{dimensionCode:"aux",valueCode:"v20"}];
    expect(restoredOptionIds(dependent,saved)).toEqual([10,20]);
    const requests: number[][] = [];
    const session = new ModelConfigurationSession({model:async()=>dependent,resolve:async request=>{
      requests.push(request.selectedOptionIds);
      return {...complete,model:dependent,selectedOptionIds:[10,20],issues:[]};
    }},()=>undefined);
    session.select(dependent.id,undefined,saved);
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(requests).toEqual([[10,20]]);
    expect(session.state.result?.issues).toEqual([]);
  });

  it("offers direct Add for a complete resolver default and Configura for customization", () => {
    const html = view({ expanded:false, onConfigure:() => undefined });
    expect(html).toContain('<button type="button" class="primary">Aggiungi al progetto</button>');
    expect(html).toContain('>Configura</button>');
    expect(html).not.toContain("scheda-fields");
    const incomplete = view({ expanded:false, onConfigure:() => undefined, state:state({result:{
      ...complete,status:"incomplete",selectedOptionIds:[],issues:[{severity:"error",code:"missing_required",
        message:"Required",axisId:1}],
    }}) });
    expect(incomplete).toContain('disabled="">Aggiungi al progetto');
    expect(incomplete).toContain('>Configura</button>');
  });

  it("marks the article configurable and offers Configura as the only primary action", () => {
    const html = inspector({ product: { ...product, configurable: true } });
    expect(html).toContain('<span class="scheda-tag" data-tone="neutral">Configurabile</span>');
    expect(html).toContain('<button type="button" class="primary">Configura</button>');
    expect(html).not.toContain("Aggiungi al progetto");
    expect(html).toContain("Attributi tecnici");
  });

  it("keeps the article identity while its configuration loads, with Add not yet available", () => {
    const configurable = { ...product, configurable: true };
    const html = inspector({ product: configurable, configuration: slots => <ArticleConfiguration
      api={fakeConfigurationApi()} product={configurable} busy={false} canApply lead={slots.lead}
      quantity={slots.quantity} onApply={() => undefined} /> });
    expect(html).toContain("BTI · FN82C16"); expect(html).toContain("Attributi tecnici");
    expect(html).toContain("Ricerca della configurazione…");
    expect(html).toContain('disabled="">Aggiungi al progetto');
    expect(html).not.toContain(">Configura</button>");
  });

  it("presents visible choices label-left / select-right with requirement, never hidden axes", () => {
    const html = view();
    expect(html).toContain('<div class="scheda-field">');
    expect(html).toMatch(/<span>Corrente nominale<\/span><small>Obbligatorio<\/small>/);
    expect(html).toMatch(/<span>Contatto ausiliario<\/span><small>Facoltativo<\/small>/);
    expect(html).toContain("16 A (predefinito)"); expect(html).toContain(">F80RC</option>");
    expect(html).not.toContain("Interno"); expect(html).not.toContain("Segreto");
    expect(html).not.toContain("tq.pack.4395");
  });

  it("shows a complete configuration in green with its articles, physical facts and an enabled Add", () => {
    const html = view();
    expect(html).toContain('<p class="scheda-notice" data-tone="ok">');
    expect(html).toContain("Configurazione completa");
    expect(html).toMatch(/Distinta articoli<\/span><small>2<\/small>/);
    expect(html).toContain('<td class="scheda-bom-code" title="BTI · FN82C16">BTI · FN82C16</td>');
    expect(html).toMatch(/Articolo F80RC<\/span><span class="scheda-tag" data-tone="neutral">Accessorio<\/span>/);
    expect(html).toContain('<dt title="Occupazione">Occupazione</dt><dd title="6 mezzi moduli da 9 mm = 3 moduli DIN da 18 mm">3 moduli DIN</dd>');
    expect(html).toContain('<dd title="54 × 80 mm">54 × 80 mm</dd>');
    expect(html).toContain('<dd title="70 mm">70 mm</dd>');
    expect(html).not.toContain("Ingombro fronte alt. 1");
    expect(html).not.toContain("Apparatus 10"); expect(html).not.toContain("tq.app");
    expect(html).not.toContain("€");
    expect(html).toContain('<button type="button" class="primary">Aggiungi al progetto</button>');
  });

  it("explains an incomplete configuration and keeps Add disabled", () => {
    const incomplete = { ...complete, status: "incomplete" as const, selectedOptionIds: [30], bom: [], physical: null,
      issues: [{ severity: "error" as const, code: "missing_required", message: "", axisId: 1 }] };
    const html = view({ state: state({ result: incomplete }) });
    expect(html).toContain('data-tone="warn"'); expect(html).toContain("Completa le scelte obbligatorie");
    expect(html).toContain('<li data-tone="error">Scegli un valore per Corrente nominale.</li>');
    expect(html).toContain("Nessun articolo risolto per le scelte attuali.");
    expect(html).toContain("Profilo fisico non disponibile.");
    expect(html).toContain('disabled="">Aggiungi al progetto');
  });

  it("maps every resolution status to semantic tones and keeps price issues only while they block Add", () => {
    expect(configurationStatus(complete).tone).toBe("ok");
    expect(configurationStatus({ ...complete, status: "invalid" })).toEqual({ tone: "error", text: "Configurazione da correggere" });
    expect(configurationStatus({ ...complete, status: "budget_exceeded" }).tone).toBe("error");
    for (const status of ["bom_incomplete", "price_incomplete", "no_profile"] as const)
      expect(configurationStatus({ ...complete, status })).toEqual({ tone: "warn", text: "Configurazione con dati mancanti" });
    const priceIssue = { severity: "warning" as const, code: "missing_price", message: "" };
    expect(visibleIssues({ ...complete, issues: [priceIssue] })).toEqual([]);
    expect(visibleIssues({ ...complete, status: "price_incomplete", issues: [priceIssue] })[0]?.text)
      .toBe("Manca un prezzo METEL corrente per un articolo.");
    expect(visibleIssues({ ...complete, status:"price_incomplete", issues:[priceIssue,priceIssue] })).toHaveLength(1);
    const unavailable = {severity:"error" as const,code:"unavailable_option",message:"",optionId:20};
    expect(visibleIssues({...complete,status:"invalid",issues:[unavailable,unavailable]})).toHaveLength(1);
    const unresolved = view({ state: state({ result: { ...complete, status: "bom_incomplete",
      bom: [bomRow("X1", ["component"], null)] } }) });
    expect(unresolved).toContain('<span class="scheda-tag" data-tone="neutral">Non a catalogo</span>');
    expect(unresolved).toContain('disabled="">Aggiungi al progetto');
  });

  it("keeps sections mounted while resolving, so collapsed groups stay collapsed", () => {
    const html = view({ state: state({ resolving: true, result: null }) });
    expect(html).toContain("Distinta articoli"); expect(html).toContain("Dati fisici");
    expect(html.match(/Risoluzione in corso…/g)!.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('disabled="">Aggiungi al progetto');
    const failed = view({ state: state({ resolving: false, result: null, resolveError: true }) });
    expect(failed).toContain("Impossibile risolvere la configurazione.");
  });

  it("formats physical facts from the resolution only", () => {
    expect(demandShortText({ capacityKindCode: "mccb_slot", amount: 2, unitLabel: "sedi", displayDivisor: 1,
      nominalPitchMm: null })).toBe("2 sedi");
    expect(physicalRows({ ...complete.physical!, demands: [], views: [], depthMm: null })).toEqual([]);
    expect(physicalRows({ ...complete.physical!, demands: [], depthMm: null, usableDepthMm: 55,
      views: [{ ...complete.physical!.views[0]!, code: "front_alt2" }] }))
      .toEqual([["Ingombro fronte alt. 2", "54 × 80 mm"], ["Profondità utile", "55 mm"]]);
  });

  it("applies the insertion rule to Add", () => {
    const base = { canApply: true, busy: false, quantity: newQuantity() };
    expect(configurationApplicable(state(), base)).toBe(true);
    expect(configurationApplicable(state(), { ...base, quantity: newQuantity("0") })).toBe(false);
    expect(configurationApplicable(state(), { ...base, busy: true })).toBe(false);
    expect(configurationApplicable(state({ resolving: true }), base)).toBe(false);
    expect(configurationApplicable(state({ result: { ...complete, model: { ...model, obsolete: true } } }), base)).toBe(false);
    expect(configurationApplicable(state(), { ...base, canApply: false })).toBe(false);
  });
});

describe("R-17d2 Scheda articolo: existing configured project line", () => {
  it("identifies the item by model name and primary article, never by its internal model code", () => {
    const html = renderToStaticMarkup(<ConfiguredItemIdentity item={item} placed={false} />);
    expect(html).toContain("BTI · FN82C16"); expect(html).toContain("BTDIN60 magnetotermico");
    // Project context (configured, placed) uses the restrained accent family (Quiet Workbench X2).
    expect(html).toContain('<span class="scheda-tag" data-tone="project">Configurato</span>');
    expect(html).not.toContain("tq.pack"); expect(html).not.toContain("Posizionato");
    expect(renderToStaticMarkup(<ConfiguredItemIdentity item={{ ...item, bom: [] }} placed />))
      .toMatch(/<span class="scheda-code" title="BTI">BTI<\/span>.*Posizionato/);
  });

  it("offers Applica modifiche with the project quantity read only, once the choices have changed", () => {
    const unchanged = view({ replacing: true, item, quantity: { kind: "project", quantity: 3 },
      state: state({ baseline: [10, 20, 30] }) });
    expect(unchanged).toContain('disabled="">Applica modifiche');
    expect(unchanged).toContain("Modifica una scelta per applicare una nuova configurazione.");
    const html = view({ replacing: true, item, quantity: { kind: "project", quantity: 3 },
      state: state({ baseline: [10, 20, 31] }) });
    expect(html).toContain('<button type="button" class="primary">Applica modifiche</button>');
    expect(html).toContain('<span>Quantità nel progetto</span><strong>3</strong>');
    expect(html).not.toContain('type="number"'); expect(html).not.toContain("Aggiungi al progetto");
  });

  it("refuses to replace a placed item or one whose saved choices are no longer offered", () => {
    const reason = "Posizionato in Progettazione: rimuovi prima la posizione per cambiarne la configurazione.";
    const placed = view({ replacing: true, item, quantity: { kind: "project", quantity: 1 }, blockedReason: reason });
    expect(placed).toContain('disabled="">Applica modifiche'); expect(placed).toContain(reason);
    const stale = view({ replacing: true, quantity: { kind: "project", quantity: 1 },
      item: { ...item, selections: [{ ...item.selections[0]!, valueCode: "retired" }] } });
    expect(stale).toContain("Alcune scelte salvate non sono disponibili nel catalogo corrente.");
    expect(stale).toContain('disabled="">Applica modifiche');
  });
});

describe("R-17d2 Catalogo integration and responsive column", () => {
  const screen = () => renderToStaticMarkup(<CatalogueScreen api={fakeCatalogueApi()}
    configurationApi={fakeConfigurationApi()} projectApi={fakeProjectApi()} project={openProject}
    onProjectChange={() => undefined} view="manufacturer" onViewChange={() => undefined} />);

  it("gives the Scheda the whole right column: the project lines moved to Preventivo (X5), so no Scheda | Progetto tabs", () => {
    const html = screen();
    expect(html).toContain('<div class="catalogue-right"><div class="catalogue-scheda-slot" id="catalogue-scheda">');
    expect(html).not.toContain('role="tablist" aria-label="Scheda e progetto"');
    expect(html).not.toContain('id="catalogue-progetto"');
    expect(html).toContain('aria-label="Scheda articolo"');
  });

  it("keeps the Scheda compact in the stylesheet: full-height column, internal scrolling and a fixed footer", () => {
    const css = readFileSync("src/renderer/styles.css", "utf8");
    expect(css).toMatch(/\.catalogue-right \{[^}]*flex-direction: column;[^}]*overflow: hidden;/);
    expect(css).toMatch(/\.catalogue-scheda-slot \{[^}]*flex: 1\.25 1 0;/);
    expect(css).toMatch(/\.scheda-body \{[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.scheda-footer \{[^}]*flex: none/);
    expect(css).toMatch(/\.scheda-title \{[^}]*-webkit-line-clamp: 2/);
    expect(css).toMatch(/\.scheda-grid dt, \.scheda-grid dd \{[^}]*text-overflow: ellipsis/);
    // The column narrows with the window instead of switching to tabs or dropping below the results.
    expect(css).toContain("grid-template-columns: var(--panel-left, 236px) 5px minmax(320px, 1fr) 5px var(--panel-right, 340px)");
    expect(css).toContain("grid-template-columns: var(--panel-left, 200px) 5px minmax(320px, 1fr) 5px var(--panel-right, 300px)");
    expect(css).not.toContain(".catalogue-right-tabs");
    expect(css).not.toContain(".catalogue-project-lines");
    expect(css).not.toMatch(/@media \(max-width: 1120px\) \{ \.catalogue-three-panel/);
  });
});
