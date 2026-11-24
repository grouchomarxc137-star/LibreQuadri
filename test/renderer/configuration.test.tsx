import { renderToStaticMarkup } from "react-dom/server";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ConfigModelDetail, ConfigurationApi, ConfigurationResult, RangeNode } from "../../src/shared/configuration.js";
import { ConfigurationAddAction, ConfigurationControls, ConfigurationResultPanel, ConfigurationScreen } from "../../src/renderer/configuration/ConfigurationScreen.js";
import { ModelConfigurationSession } from "../../src/renderer/configuration/model-configuration.js";
import { changeChoice, configurationRequest, demandText, rangeChildren, rangePath, selectableOptions } from "../../src/renderer/configuration/presentation.js";

const model: ConfigModelDetail = {
  id: 40, code: "demo.model", name: "Modello di prova", kind: "device", brandMarchio: "TEST",
  active: true, obsolete: false, commercialContribution:"articles", definitionFingerprint: "fingerprint", sourceRef: null, baseProfileId: null, maxInsertQty: null,
  budgets: [], relations: [], axes: [
    {id: 1, dimensionCode: "poles", label: "Poli", sortOrder: 1, visibility: "visible", requirement: "required",
      binding: "none", editableWhenPlaced: true, selectsPrimary: true, options: [
        {id: 10, axisId: 1, valueId: 1, valueCode: "one", label: "1P", parentOptionId: null, isDefault: true, visible: true, active: true, sortOrder: 1},
        {id: 11, axisId: 1, valueId: 2, valueCode: "two", label: "2P", parentOptionId: null, isDefault: false, visible: true, active: true, sortOrder: 2},
      ]},
    {id: 2, dimensionCode: "accessory", label: "Accessorio", sortOrder: 2, visibility: "visible", requirement: "optional",
      binding: "none", editableWhenPlaced: true, selectsPrimary: false, options: [
        {id: 20, axisId: 2, valueId: 3, valueCode: "a", label: "Modulo A", parentOptionId: 10, isDefault: false, visible: true, active: true, sortOrder: 1},
        {id: 21, axisId: 2, valueId: 4, valueCode: "b", label: "Modulo B", parentOptionId: 11, isDefault: false, visible: true, active: true, sortOrder: 2},
        {id: 22, axisId: 2, valueId: 5, valueCode: "old", label: "Vecchio", parentOptionId: 11, isDefault: false, visible: true, active: false, sortOrder: 3},
      ]},
    {id: 3, dimensionCode: "internal", label: "Interno", sortOrder: 3, visibility: "hidden", requirement: "optional",
      binding: "none", editableWhenPlaced: false, selectsPrimary: false, options: [
        {id: 30, axisId: 3, valueId: 6, valueCode: "hidden", label: "Segreto", parentOptionId: null, isDefault: true, visible: false, active: true, sortOrder: 1},
      ]},
  ],
};
const result: ConfigurationResult = {
  model, selectedOptionIds: [10, 30], defaultedOptionIds: [10, 30], commercialContribution:"articles",matchingRuleIds: [], fingerprint: "hash",
  status: "complete", issues: [], bom: [
    {brandMarchio: "TEST", manufacturerCode: "ABC", productId: 1, linkedBrandMarchio:"TEST",
      linkedManufacturerCode:"ABC",priceListinoNumber:"1",priceValidFrom:"2026-09-24",priceMultiplierOriginal:1,
      quantity: 2, roles: ["primary"],
      description: "Interruttore", unitPriceE4: 123456, rowTotalE4: 246912, currency: "EUR", priceIssuerSigla: "TEST"},
  ], totalE4: 246912, pricedSubtotalE4: 246912, budgets: [], physical: {
    id: 5, code: "profile", name: "Profilo", kind: "device", profileKey: 1,
    fitClass: {id: 1, code: "device", name: "Dispositivo"}, depthMm: 70, outerDepthMm: null, usableDepthMm: null,
    demands: [{capacityKindCode: "din_rail", amount: 6, unitLabel: "moduli", displayDivisor: 2, nominalPitchMm: 9}],
    views: [{code: "front", widthMm: 54, heightMm: 80, insertDxMm: null, insertDyMm: null, symbolKind: "none", assetKey: null}],
    zones: [], slots: [], constraints: [],
  }, exclusions: [],
};

describe("configuration browser", () => {
  const nodes: RangeNode[] = [
    {id: 1, parentId: null, name: "Gamma", code: "a", brandMarchio: "TEST", kind: "range", sortOrder: 1, active: true},
    {id: 2, parentId: 1, name: "Serie", code: "b", brandMarchio: "TEST", kind: "series", sortOrder: 1, active: true},
    {id: 3, parentId: 2, name: "Storica", code: "c", brandMarchio: "TEST", kind: "series", sortOrder: 1, active: false},
    {id: 4, parentId: 999, name: "Senza padre", code: "d", brandMarchio: "TEST", kind: "range", sortOrder: 1, active: true},
  ];
  it("browses every level and keeps source nodes whose parent is absent", () => {
    expect(rangeChildren(nodes, null).map(node => node.id)).toEqual([1, 4]);
    expect(rangeChildren(nodes, 1).map(node => node.id)).toEqual([2]);
    expect(rangePath(nodes, 3).map(node => node.name)).toEqual(["Gamma", "Serie", "Storica"]);
  });
  it("shows loading and empty states", () => {
    const api: ConfigurationApi = {ranges: async () => [], nodeModels: async () => [], productModels: async () => [],
      modelByCode: async () => null,
      model: async () => model, resolve: async () => result};
    const html = renderToStaticMarkup(<ConfigurationScreen api={api} projectOpen={false} onAdd={async () => undefined} />);
    expect(html).toContain("Caricamento della struttura tecnica");
    expect(html).toContain("Configura un modello");
  });
});

describe("configuration choices and resolution contract", () => {
  it("reopens a saved item's attribute and accessory selections through the shared resolver", async () => {
    const resolve = vi.fn(async (request: ReturnType<typeof configurationRequest>) =>
      ({ ...result, selectedOptionIds: request.selectedOptionIds }));
    const session = new ModelConfigurationSession({ model: async () => model, resolve }, () => undefined);
    session.select(40, undefined, [{ dimensionCode: "poles", valueCode: "two" },
      { dimensionCode: "accessory", valueCode: "b" }]);
    await new Promise(resolveTick => setTimeout(resolveTick, 0));
    expect(resolve).toHaveBeenCalledWith({ modelId: 40, selectedOptionIds: [11, 21] });
    expect(session.request()).toEqual({ modelId: 40, selectedOptionIds: [11, 21] });
  });
  it("renders visible active options, required state and defaults", () => {
    const html = renderToStaticMarkup(<ConfigurationControls model={model} result={result} busy={false} onChoice={() => undefined} />);
    expect(html).toContain("Poli"); expect(html).toContain("Obbligatorio");
    expect(html).toContain("1P (predefinito)"); expect(html).toContain("2P");
    expect(html).toContain("Modulo A"); expect(html).not.toContain("Modulo B");
    expect(html).not.toContain("Vecchio"); expect(html).not.toContain("Segreto");
    expect(html).not.toContain("Interno");
    expect(selectableOptions(model.axes[1]!.options, [11])).toEqual([model.axes[1]!.options[1]]);
  });
  it("prunes a selected child when its parent changes, then calls the backend with the new choice", async () => {
    const chosen = changeChoice(model, [10, 20], [10, 20, 30], 1, 11);
    expect(chosen).toEqual([11]);
    const api = {resolve: vi.fn(async (_request: ReturnType<typeof configurationRequest>) => result)};
    await api.resolve(configurationRequest(model.id, chosen, 7));
    expect(api.resolve).toHaveBeenCalledWith({modelId: 40, selectedOptionIds: [11], productId: 7});
    expect(changeChoice(model, chosen, [11, 30], 2, 21)).toEqual([11, 21]);
  });
});

describe("resolved result", () => {
  it("shows nonzero budget usage with the model's label and current limit", () => {
    const withBudget: ConfigurationResult = {...result,
      model: {...model, budgets: [{code: "slots", label: "Posizioni disponibili", maxAmount: 3}]},
      budgets: [{code: "slots", used: 1, maxAmount: 3}]};
    const html = renderToStaticMarkup(<ConfigurationResultPanel result={withBudget} />);
    expect(html).toContain("Limiti di configurazione");
    expect(html).toContain("<dt>Posizioni disponibili</dt><dd>1 / 3</dd>");
    expect(html).not.toContain("<dt>slots</dt>");
  });
  it("omits the budget section when the model has no budgets", () => {
    const html = renderToStaticMarkup(<ConfigurationResultPanel result={result} />);
    expect(html).not.toContain("Limiti di configurazione");
  });
  it("renders BOM identity, description, quantity and physical details without commercial prices", () => {
    const html = renderToStaticMarkup(<ConfigurationResultPanel result={result} />);
    expect(html).toContain("ABC"); expect(html).toContain("Interruttore");
    expect(html).toContain('<th class="numeric">Qtà</th>');
    expect(html).toContain('<td class="numeric">2</td>');
    expect(html).not.toContain("Prezzo METEL unitario");
    expect(html).not.toContain("Totale riga");
    expect(html).not.toContain("Totale METEL");
    expect(html).not.toContain("€");
    expect(html).toContain("6 mezzi moduli da 9 mm = 3 moduli DIN da 18 mm");
    expect(html).toContain("70 mm"); expect(html).toContain("54 × 80 mm");
    expect(demandText({capacityKindCode: "mccb_slot", amount: 2, unitLabel: "sedi", displayDivisor: 1})).toBe("2 sedi");
  });
  it("keeps BOM rows but hides prices and pricing warnings when a price is missing", () => {
    const incomplete: ConfigurationResult = {...result, status: "price_incomplete", totalE4: null,
      bom: [...result.bom, {...result.bom[0]!, manufacturerCode: "MISSING", unitPriceE4: null, rowTotalE4: null}],
      issues: [{code:"missing_price",severity:"warning",message:"missing price"}]};
    const html = renderToStaticMarkup(<ConfigurationResultPanel result={incomplete} />);
    expect(html).toContain("MISSING");
    expect(html).not.toContain("Prezzo");
    expect(html).not.toContain("Subtotale prezzato");
    expect(html).not.toContain("€");
  });
  it("translates backend warnings and errors into useful text", () => {
    const withIssues: ConfigurationResult = {...result, status: "incomplete", issues: [
      {code: "missing_required", severity: "error", message: "technical", axisId: 1},
      {code: "unresolved_article", severity: "warning", message: "technical"},
      {code: "ambiguous_default", severity: "error", message: "technical", axisId: 2},
    ]};
    const html = renderToStaticMarkup(<ConfigurationResultPanel result={withIssues} />);
    expect(html).toContain("Scegli un valore per Poli");
    expect(html).toContain("Un articolo della distinta non è collegato al catalogo");
    expect(html).toContain("i dati di origine hanno più valori predefiniti");
    expect(html).not.toContain("technical");
  });
});

describe("add configured item action", () => {
  const request = configurationRequest(model.id,[11],7);
  const props = {projectOpen:true,result,adding:false,error:null,request,
    onAdd:vi.fn(async () => undefined),onAddingChange:vi.fn(),onErrorChange:vi.fn()};
  const button = (value:typeof props) => {
    const element = ConfigurationAddAction(value) as ReactElement<{children:ReactNode}>;
    return Children.toArray(element.props.children).find((child):child is ReactElement<{
      onClick:()=>Promise<void>}> => isValidElement(child) && child.type === "button")!;
  };
  it("enables only a complete resolution with an open project",() => {
    expect(renderToStaticMarkup(<ConfigurationAddAction {...props} />)).toContain("AGGIUNGI AL PROGETTO");
    expect(renderToStaticMarkup(<ConfigurationAddAction {...props} result={{...result,status:"price_incomplete"}} />))
      .toContain("disabled");
    expect(renderToStaticMarkup(<ConfigurationAddAction {...props}
      result={{...result,model:{...model,obsolete:true}}} />)).toContain("disabled");
    expect(renderToStaticMarkup(<ConfigurationAddAction {...props} projectOpen={false} />))
      .toContain("Crea o apri un progetto");
    expect(renderToStaticMarkup(<ConfigurationAddAction {...props} projectOpen={false} />))
      .not.toContain("AGGIUNGI AL PROGETTO");
  });
  it("dispatches the clicked request and clears busy state on success",async () => {
    const onAdd=vi.fn(async () => undefined),onAddingChange=vi.fn(),onErrorChange=vi.fn();
    await button({...props,onAdd,onAddingChange,onErrorChange}).props.onClick();
    expect(onAdd).toHaveBeenCalledWith(request);
    expect(onAddingChange.mock.calls.map(call => call[0])).toEqual([true,false]);
    expect(onErrorChange).toHaveBeenCalledWith(null);
  });
  it("surfaces a failed click without leaving the action busy",async () => {
    const onAdd=vi.fn(async () => {throw new Error("Impossibile aggiungere");});
    const onAddingChange=vi.fn(),onErrorChange=vi.fn();
    await button({...props,onAdd,onAddingChange,onErrorChange}).props.onClick();
    expect(onErrorChange).toHaveBeenLastCalledWith("Impossibile aggiungere");
    expect(onAddingChange).toHaveBeenLastCalledWith(false);
    expect(renderToStaticMarkup(<ConfigurationAddAction {...props} error="Impossibile aggiungere" />))
      .toContain('role="alert"');
  });
});
