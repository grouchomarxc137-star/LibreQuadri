import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ConfigModelDetail, ConfigurationResult } from "../../src/shared/configuration.js";
import type { ProjectConfiguredItem } from "../../src/shared/project.js";
import { ConfigurationControls } from "../../src/renderer/configuration/ConfigurationScreen.js";
import { ModelConfigurationSession, emptyModelConfiguration, type ModelConfigurationState } from "../../src/renderer/configuration/model-configuration.js";
import { EnclosureConfigurationDialog, EnclosureConfigurationFields, enclosureConfigurationApplicable,
  enclosureFailureMessage, placedLockedAxes, EnclosureConfigurationFooter, enclosureConfigurationBlockedReason } from "../../src/renderer/project/EnclosureConfigurationDialog.js";
import { EnclosureReconfigurationError } from "../../src/main/project/enclosure-reconfiguration.js";
import { DesignProperties } from "../../src/renderer/project/DesignProperties.js";
import { describeSelection } from "../../src/renderer/project/design-selection.js";
import { fakeConfigurationApi, openProject } from "./fake-api.js";

const option = (id: number, axisId: number, parentOptionId: number | null = null, isDefault = false) =>
  ({ id, axisId, parentOptionId, isDefault, valueId: id, valueCode: `v${id}`, label: `Valore ${id}`, active: true, visible: true, sortOrder: id });
const model: ConfigModelDetail = {
  id: 42, code: "enclosure", name: "Carpenteria di prova", kind: "enclosure", brandMarchio: "TEST",
  active: true, obsolete: false, commercialContribution: "none", definitionFingerprint: "definition", sourceRef: null,
  baseProfileId: null, maxInsertQty: null, budgets: [], relations: [], axes: [
    { id: 1, dimensionCode: "front", label: "Frontale", sortOrder: 0, visibility: "visible", requirement: "required",
      binding: "none", editableWhenPlaced: true, selectsPrimary: false, options: [option(10, 1, null, true), option(11, 1)] },
    { id: 2, dimensionCode: "dependent", label: "Dipendente", sortOrder: 1, visibility: "visible", requirement: "required",
      binding: "none", editableWhenPlaced: true, selectsPrimary: false, options: [option(20, 2, 10, true), option(21, 2, 11, true)] },
    { id: 3, dimensionCode: "fixed", label: "Fisso", sortOrder: 2, visibility: "visible", requirement: "required",
      binding: "none", editableWhenPlaced: false, selectsPrimary: false, options: [option(30, 3, null, true), option(31, 3)] },
  ],
};
const result: ConfigurationResult = {
  model, selectedOptionIds: [10, 20, 30], defaultedOptionIds: [], matchingRuleIds: [], fingerprint: "initial",
  commercialContribution: "none", status: "complete", issues: [], bom: [], totalE4: null, pricedSubtotalE4: 0,
  budgets: [], exclusions: [], physical: null,
};
const item: ProjectConfiguredItem = {
  uuid: "item", modelCode: model.code, modelName: model.name, modelBrandMarchio: model.brandMarchio, modelKind: "enclosure",
  selections: model.axes.map(axis => ({ dimensionCode: axis.dimensionCode, dimensionLabel: axis.label,
    valueCode: axis.options[0]!.valueCode, valueLabel: axis.options[0]!.label, selectionSource: "default", binding: "none",
    editableWhenPlaced: axis.editableWhenPlaced, visible: true })),
  views: [], zones: [], demands: [], bom: [],
} as unknown as ProjectConfiguredItem;
const state: ModelConfigurationState = { ...emptyModelConfiguration, modelId: model.id, model, result, explicit: [10, 20, 30] };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function findElement(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | undefined {
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (node.type === type) return node;
  for (const child of Children.toArray(node.props.children as ReactNode)) {
    const match = findElement(child, type); if (match) return match;
  }
}

const fields = (overrides: Partial<ModelConfigurationState> = {}) => renderToStaticMarkup(
  <EnclosureConfigurationFields state={{ ...state, ...overrides }} item={item} busy={false} onChoice={() => undefined} onRetry={() => undefined} />);

describe("placed Carpenteria configuration", () => {
  it.each([1, 3])("Q=%i: exposes Modifica carpenteria only for a selected physical enclosure", quantity => {
    const project = { ...openProject, configuredItems: [item], lines: [{ uuid: "line", lineType: "item" as const,
      snapshotUuid: null, itemUuid: item.uuid, quantity, brandMarchio: "TEST", manufacturerCode: "", description: null,
      unitOfMeasure: null, unitListPriceE4: null, lineTotalE4: null, currency: "EUR" }],
      physicalNodes: [{ uuid: "physical-unit", itemUuid: item.uuid, nodeKind: "enclosure" as const, children: [], parentUuid: null,
        zoneNo: null, startUnits: null, slotNo: null, rootXMm: 0, rootYMm: 0, xMm: 0, yMm: 0, viewCode: "front",
        sortOrder: 0, positionIssue: null }] };
    const selection = describeSelection(project, "physical-unit")!;
    const callback = vi.fn();
    const html = renderToStaticMarkup(<DesignProperties selection={selection} assets={{}} busy={false}
      onUnplace={() => undefined} onRemoveRoot={() => undefined} onReconfigure={callback} />);
    expect(html).toContain("Modifica carpenteria");
    expect(selection.node.uuid).toBe("physical-unit");
    expect(selection.quantity).toBe(quantity);
    const empty = renderToStaticMarkup(<DesignProperties selection={null} assets={{}} busy={false}
      onUnplace={() => undefined} onRemoveRoot={() => undefined} onReconfigure={callback} />);
    expect(empty).not.toContain("Modifica carpenteria");
  });

  it.each([1, 3])("Q=%i: describes selected-unit scope and the normal Save/history workflow", quantity => {
    const html = renderToStaticMarkup(<EnclosureConfigurationDialog api={fakeConfigurationApi()} item={item}
      quantity={quantity} busy={false} error={null} onApply={() => undefined} onCancel={() => undefined} />);
    expect(html).toContain('role="dialog" aria-modal="true"');
    expect(html).toContain('aria-labelledby="enclosure-configuration-title"');
    expect(html).toContain("Scelte salvate");
    expect(html).toContain("Annulla / Ripeti");
    expect(html).toContain("Salva il progetto");
    expect(html).toContain("Modello e profondità restano gli stessi");
    if (quantity > 1) {
      expect(html).toContain("cambia solo l&#x27;unità fisica selezionata");
      expect(html).toContain("quantità 1");
      expect(html).toContain("Le altre unità conservano le scelte salvate");
    } else expect(html).not.toContain("configurazione indipendente");
  });

  it("restores all saved choices and prunes a dependent choice through the existing session", async () => {
    const resolve = vi.fn(async (request: { selectedOptionIds: number[] }) => ({ ...result,
      selectedOptionIds: request.selectedOptionIds.includes(11) ? [11, 21, 30] : request.selectedOptionIds,
      defaultedOptionIds: request.selectedOptionIds.includes(11) ? [21] : [] }));
    const session = new ModelConfigurationSession({ model: async () => model, resolve }, () => undefined);
    session.select(model.id, undefined, item.selections); await tick();
    expect(resolve).toHaveBeenLastCalledWith({ modelId: 42, selectedOptionIds: [10, 20, 30] });
    expect(session.state.result?.selectedOptionIds).toEqual([10, 20, 30]);
    session.choose(1, 11); await tick();
    expect(resolve).toHaveBeenLastCalledWith({ modelId: 42, selectedOptionIds: [30, 11] });
    expect(session.state.result?.selectedOptionIds).toEqual([11, 21, 30]);
    const html = fields(session.state);
    expect(html).toContain("Frontale: Valore 10 → Valore 11");
    expect(html).toContain("Dipendente: Valore 20 → Valore 21 (predefinito)");
    expect(html).toMatch(/value="21" selected=""/);
    session.dispose();
  });

  it("locks axes denied by either current or saved metadata, and guards the callback", () => {
    const saved = { ...item, selections: item.selections.map(row => ({ ...row,
      editableWhenPlaced: row.dimensionCode === "front" ? false : row.editableWhenPlaced })) };
    expect(placedLockedAxes(state, saved)).toEqual([1, 3]);
    const onChoice = vi.fn();
    const element = EnclosureConfigurationFields({ state, item: saved, busy: false, onChoice, onRetry: vi.fn() });
    const controls = findElement(element, ConfigurationControls)!;
    const choose = controls.props.onChoice as (axis: number, option: number) => void;
    choose(1, 11); choose(3, 31); expect(onChoice).not.toHaveBeenCalled();
    choose(2, 21); expect(onChoice).toHaveBeenCalledWith(2, 21);
    const html = renderToStaticMarkup(element);
    expect(html.match(/Bloccato dopo il posizionamento/g)).toHaveLength(2);
    expect(html).toMatch(/<select[^>]*disabled=""[^>]*><option[^>]*>[\s\S]*?value="30" selected=""/);
  });

  it("reports an effective dependent change on a locked axis without hiding or overriding the resolver result", () => {
    const lockedModel = { ...model, axes: model.axes.map(axis => ({ ...axis, editableWhenPlaced: axis.id !== 2 })) };
    const html = fields({ model: lockedModel, result: { ...result, model: lockedModel, selectedOptionIds: [11, 21, 30], defaultedOptionIds: [21] } });
    expect(html).toContain("Dipendente: Valore 20 → Valore 21 (predefinito) — caratteristica bloccata");
    expect(html).toMatch(/value="21" selected=""/);
  });

  it("permits an unchanged request so the backend can return its no-write result", () => {
    expect(enclosureConfigurationApplicable(state, item, false)).toBe(true);
    expect(fields()).toContain("Nessuna modifica alle scelte salvate");
  });

  it("keeps price_incomplete eligible because retained historical prices are validated by the backend", () => {
    expect(enclosureConfigurationApplicable({ ...state, result: { ...result, status: "price_incomplete" } }, item, false)).toBe(true);
  });

  it("blocks apply during loading/resolution/write and for invalid or missing saved options", () => {
    for (const pending of [emptyModelConfiguration, { ...state, resolving: true }, { ...state, result: null },
      { ...state, result: { ...result, status: "invalid" as const } }]) expect(enclosureConfigurationApplicable(pending, item, false)).toBe(false);
    expect(enclosureConfigurationApplicable(state, item, true)).toBe(false);
    const missing = { ...state, model: { ...model, axes: model.axes.slice(0, 2) } };
    expect(enclosureConfigurationApplicable(missing, item, false)).toBe(false);
    expect(fields(missing)).toContain("Verifica dati di ingegneria");
    const ambiguous = { ...state, model: { ...model, axes: model.axes.map(axis => ({ ...axis, options: [...axis.options, { ...axis.options[0]!, id: axis.id + 100 }] })) } };
    expect(enclosureConfigurationApplicable(ambiguous, item, false)).toBe(false);
  });

  it.each([
    "Aggiorna i dati di ingegneria del progetto prima di modificare la carpenteria.",
    "Configurazione incompatibile: device-uuid: L'apparecchio non è compatibile con il contenitore.",
    "Importa un listino con il prezzo dell'articolo NEW.",
    "La caratteristica «Dipendente» non è modificabile dopo il posizionamento.",
  ])("preserves actionable backend diagnostics: %s", message => {
    const clean = enclosureFailureMessage(new Error(`Error invoking remote method 'project:reconfigure-enclosure': Error: ${message}`));
    expect(clean).toBe(message);
    const html = renderToStaticMarkup(<EnclosureConfigurationDialog api={fakeConfigurationApi()} item={item}
      quantity={3} busy={false} error={clean} onApply={() => undefined} onCancel={() => undefined} />);
    expect(html).toContain('role="alert" aria-atomic="true" tabindex="0">Modifica non eseguita.');
  });

  it("offers recovery for model/resolve failures and hides the old result during resolution", () => {
    expect(fields({ model: null, modelError: true })).toContain("Verifica il catalogo di ingegneria");
    expect(fields({ resolveError: true, result: null })).toContain("Riprova configurazione");
    const html = fields({ resolving: true, result: null });
    expect(html).toContain("Risoluzione in corso");
    expect(html).not.toContain("Modifiche alle scelte");
  });
});

describe("Stage 3 review: error text, visibility and disabled Apply", () => {
  const uuid = "c1234567-89ab-4000-8000-123456789abc";
  const diagnostic = `Configurazione incompatibile: ${uuid}: scegli opzioni compatibili. Error: dettaglio da conservare.`;

  it.each(["Error", "EnclosureReconfigurationError", "EngineeringDataStaleError", "ProjectLifecycleBusyError",
    "ConfiguredPriceSnapshotError", "PlacementError", "ProjectEngineeringRefreshError", "ProjectSaveError",
    "InvalidCatalogueFilterError", "InvalidCataloguePayloadError", "TypeError", "RangeError"])("strips named %s wrappers and preserves the whole diagnostic/UUID", name => {
    for (const raw of [`${name}: ${diagnostic}`,
      `Error invoking remote method 'project:reconfigure-enclosure': ${name}: ${diagnostic}`,
      `Error invoking remote method 'project:reconfigure-enclosure': Error: ${name}: ${diagnostic}`]) {
      expect(enclosureFailureMessage(raw)).toBe(diagnostic);
      expect(enclosureFailureMessage(new Error(raw))).toBe(diagnostic);
    }
  });

  it("handles the actual EnclosureReconfigurationError, including its serialized name", () => {
    const error = new EnclosureReconfigurationError("incompatible_subtree", diagnostic);
    expect(enclosureFailureMessage(error)).toBe(diagnostic);
    expect(enclosureFailureMessage(String(error))).toBe(diagnostic);
    expect(enclosureFailureMessage(new Error(`Error invoking remote method 'project:reconfigure-enclosure': ${error}`))).toBe(diagnostic);
  });

  it("handles repeated wrappers, double-quoted channels and empty diagnostics without stripping unknown diagnostic headings", () => {
    expect(enclosureFailureMessage(`Error: Error invoking remote method "project:reconfigure-enclosure": EnclosureReconfigurationError: ${diagnostic}`)).toBe(diagnostic);
    expect(enclosureFailureMessage(`ManufacturerNote: ${uuid}: verifica il contenuto.`)).toBe(`ManufacturerNote: ${uuid}: verifica il contenuto.`);
    expect(enclosureFailureMessage("Error: ")).toBe("Impossibile modificare la carpenteria. Riprova.");
  });

  it("renders the failed Apply alert in the fixed footer, outside the configuration scroll body", () => {
    const error = `Error invoking remote method 'project:reconfigure-enclosure': EnclosureReconfigurationError: ${diagnostic}`;
    const html = renderToStaticMarkup(<EnclosureConfigurationDialog api={fakeConfigurationApi()} item={item}
      quantity={3} busy={false} error={error} onApply={() => undefined} onCancel={() => undefined} />);
    const body = html.slice(html.indexOf('class="shell-dialog-body"'), html.indexOf("<footer>"));
    const footer = html.slice(html.indexOf("<footer>"), html.indexOf("</footer>"));
    expect(body).not.toContain("Modifica non eseguita");
    expect(footer).toContain('role="alert" aria-atomic="true"');
    expect(footer).toContain('tabindex="0">Modifica non eseguita.');
    expect(footer).toContain(uuid);
    expect(footer.indexOf("Modifica non eseguita")).toBeLessThan(footer.indexOf("Applica modifiche"));
    expect(html).not.toContain("EnclosureReconfigurationError");
    expect(html).not.toContain("Error invoking remote method");
    const css = readFileSync("src/renderer/styles.css", "utf8");
    expect(css).toContain(".enclosure-configuration-dialog > footer { display: grid;");
    expect(css).toMatch(/\.enclosure-apply-error \{[^}]*max-height:[^}]*overflow-y: auto;/);
  });

  it.each([
    [{ result: { ...result, status: "invalid" } }, "Configurazione non valida"],
    [{ result: { ...result, status: "budget_exceeded" } }, "Configurazione non valida"],
    [{ result: { ...result, status: "incomplete" } }, "Completa le scelte obbligatorie"],
    [{ result: { ...result, status: "bom_incomplete" } }, "Distinta incompleta"],
    [{ result: { ...result, status: "no_profile" } }, "Profilo fisico non disponibile"],
    [{ model: { ...model, active: false } }, "Il modello non è attivo"],
    [{ model: { ...model, obsolete: true } }, "Il modello è obsoleto"],
    [{ result: null }, "La configurazione non è ancora risolta"],
    [{ result: null, resolveError: true }, "Usa Riprova configurazione"],
    [{ result: null, resolving: true }, "Risoluzione in corso"],
    [{ model: null, result: null }, "Attendi il caricamento"],
    [{ model: null, result: null, modelError: true }, "Modello non disponibile"],
  ] as const)("explains disabled Apply next to the action: %s", (override, expected) => {
    const changed: ModelConfigurationState = { ...state, ...override };
    const apply = vi.fn();
    expect(enclosureConfigurationApplicable(changed, item, false)).toBe(false);
    expect(enclosureConfigurationBlockedReason(changed, item, false)).toContain(expected);
    const element = EnclosureConfigurationFooter({ state: changed, item, busy: false, error: null, onApply: apply, onCancel: vi.fn() });
    const html = renderToStaticMarkup(element);
    expect(html).toContain(expected);
    expect(html).toContain('id="enclosure-apply-reason"');
    expect(html).toContain('role="status"');
    expect(html).toContain('disabled="" aria-describedby="enclosure-apply-reason"');
    const actions = Children.toArray(findElement(element, "footer")!.props.children as ReactNode).at(-1)!;
    const button = Children.toArray((actions as ReactElement<{ children: ReactNode }>).props.children).at(-1) as ReactElement<{ onClick: () => void }>;
    button.props.onClick();
    expect(apply).not.toHaveBeenCalled();
  });

  it("explains submission and missing/ambiguous saved choices, while keeping complete and price-incomplete configurations eligible", () => {
    expect(enclosureConfigurationBlockedReason(state, item, true)).toContain("Modifica in corso");
    const missing = { ...state, model: { ...model, axes: model.axes.slice(0, 2) } };
    expect(enclosureConfigurationBlockedReason(missing, item, false)).toContain("Verifica dati di ingegneria");
    for (const status of ["complete", "price_incomplete"] as const) {
      const changed = { ...state, result: { ...result, status } };
      expect(enclosureConfigurationBlockedReason(changed, item, false)).toBeNull();
      const apply = vi.fn();
      const element = EnclosureConfigurationFooter({ state: changed, item, busy: false, error: null, onApply: apply, onCancel: vi.fn() });
      expect(renderToStaticMarkup(element)).not.toContain("enclosure-apply-reason");
      const actions = Children.toArray(findElement(element, "footer")!.props.children as ReactNode).at(-1) as ReactElement<{ children: ReactNode }>;
      const button = Children.toArray(actions.props.children).at(-1) as ReactElement<{ onClick: () => void }>;
      button.props.onClick(); expect(apply).toHaveBeenCalledOnce();
    }
  });
});
