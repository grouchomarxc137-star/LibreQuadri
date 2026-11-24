// @vitest-environment jsdom
import type { CatalogueBrowseRequest, CatalogueBrowseResult } from "../../src/shared/catalogue.js";
import { act, useReducer, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectShell } from "../../src/renderer/app/ProjectShell.js";
import { initialShellState, shellReducer } from "../../src/renderer/app/shell-state.js";
import { DinConfigurationDialog } from "../../src/renderer/project/DinConfigurationDialog.js";
import { DistintaDialog } from "../../src/renderer/app/DistintaDialog.js";
import { ProjectActionQueue } from "../../src/renderer/catalogue/project-actions.js";
import { formatMoneyE4 } from "../../src/shared/money.js";
import type { ProjectConfiguredItem, ProjectDocumentView, ProjectPhysicalNode, StructuralNavigation } from "../../src/shared/project.js";
import type { ConfigModelDetail, ConfigurationResult } from "../../src/shared/configuration.js";
import { fakeLqApi, openProject } from "./fake-api.js";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
const button = (label: string, scope: ParentNode = host) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label)!;
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const line = { uuid: "line", lineType: "product", snapshotUuid: "snapshot", itemUuid: null, brandMarchio: "TEST", manufacturerCode: "A1",
  description: "Interruttore", quantity: 2, unitListPriceE4: 100_000, lineTotalE4: 200_000, currency: "EUR" } as ProjectDocumentView["lines"][number];
const base: ProjectDocumentView = { ...openProject, lines: [line] };

it("quick-adds across all three component lists and offers Undo for only the latest addition", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const api = fakeLqApi();
  api.catalogue.manufacturerNodes = async () => [{ id: 1, parentId: null, name: "Apparecchi", code: "test.root",
    brandMarchio: "TEST", source: "import", kind: "section", levelCode: null, levelLabel: null, sortOrder: 0,
    articleCount: 2, packageCount: 0 }];
  const products: CatalogueBrowseResult["products"] = ["Interruttore", "Sezionatore"].map((description, index) => ({
    id: index + 1, brandMarchio: "TEST", brandName: "Test", manufacturerCode: `A${index + 1}`, description, isListed: true,
    configurable: index === 1, attributes: [], category: null, price: null, unitOfMeasure: null,
  }));
  api.catalogue.browse = async () => ({ products, totalCount: 2, offset: 0, hasMore: false, packages: [], packageCount: 0,
    facets: { brand: null, configurability: null, attributes: [] } });
  const models: ConfigModelDetail[] = [
    { id: 7, kind: "enclosure", name: "Carpenteria Alpha" },
    { id: 8, kind: "support", name: "Pannello Beta" },
    { id: 9, kind: "device", name: "Sezionatore" },
  ].map(row => ({ ...row, active: true, obsolete: false, axes: [], budgets: [], relations: [],
    brandMarchio: "TEST", code: `model.${row.id}`, commercialContribution: "none", definitionFingerprint: "fixture",
    sourceRef: null, baseProfileId: null, maxInsertQty: null }));
  api.configuration.productModels = async () => models.filter(model => model.kind === "device")
    .map(model => ({ ...model, preselectedOptionId: null }));
  api.configuration.model = async id => models.find(model => model.id === id)!;
  api.configuration.resolve = async ({ modelId }) => ({ model: await api.configuration.model(modelId),
    selectedOptionIds: [], status: "complete", issues: [], bom: [], budgets: [],
    physical: modelId === 9 ? { views: [], zones: [], slots: [], constraints: [], demands: [], fitClass: { name: "Test" } } : null,
    exclusions: [], commercialContribution: "none" } as unknown as ConfigurationResult);
  api.project.designNavigation = async kind => {
    const candidates = models.filter(model => model.kind === kind);
    return { status: "ready", candidates, staleImportIds: [], contextDataUnavailable: 0,
      nodes: [{ id: 1, parentId: null, name: "Modelli", kind: "section", sortOrder: 0, modelIds: candidates.map(model => model.id) }] };
  };
  const frame: ProjectDocumentView["physicalNodes"][number] = {
    uuid: "frame", itemUuid: null, parentUuid: null, nodeKind: "enclosure", zoneNo: null,
    startUnits: null, slotNo: null, rootXMm: 0, rootYMm: 0, viewCode: "front", sortOrder: 0,
    xMm: 0, yMm: 0, positionIssue: null, children: [],
  };
  const factoryPanel: ProjectPhysicalNode = {
    ...frame, uuid: "factory-panel", parentUuid: frame.uuid, nodeKind: "support",
    rootXMm: null, rootYMm: null, xMm: 23, yMm: 65,
  };
  let sequence = 0;
  const added = (physicalNodes: ProjectDocumentView["physicalNodes"] = []) =>
    ({ ...openProject, physicalNodes, undoToken: String(++sequence) });
  api.project.addCatalogueProduct = vi.fn(async () => added());
  let finishConfigured!: () => void;
  const pendingConfigured = new Promise<void>(resolve => { finishConfigured = resolve; });
  api.project.addConfiguredItem = vi.fn(async (_request, _quantity, _undoable, autoPlace) => {
    await pendingConfigured;
    return { ...added(), ...(autoPlace ? { autoPlacement: "unplaced" as const } : {}) };
  });
  api.project.addStructural = vi.fn(async ({ kind, autoPlace }) => ({
    ...added(kind === "enclosure" ? [{ ...frame, children: [factoryPanel] }] : [frame]),
    ...(kind === "enclosure" ? { presetDiagnostics: [{ seq: 1, modelCode: "factory-din-window",
      status: "instantiated" as const, code: "created", message: "Created", nodeUuid: factoryPanel.uuid }] } : {}),
    ...(autoPlace ? { autoPlacement: "placed" as const } : {}),
  }));
  api.project.undo = vi.fn(async () => ({ ...openProject, physicalNodes: [frame] }));
  function Harness() {
    const [project, setProject] = useState(openProject);
    const [shell, dispatch] = useReducer(shellReducer, initialShellState);
    return <ProjectShell api={api} project={project} shell={shell} dispatch={dispatch} onProjectChange={setProject} statusBar={null} />;
  }
  const doubleClick = async (element: HTMLElement) => {
    await act(async () => { element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 })); });
  };
  const notice = () => host.querySelector(".quick-add-notice");
  const result = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".catalogue-article")]
    .find(node => node.querySelector(".article-description")?.textContent === label)!;
  const structuralRow = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".hierarchy-leaf")]
    .find(node => node.querySelector(".hierarchy-name")?.textContent === label)!;
  await act(async () => root.render(<Harness />));
  await click(button("Carpenterie"));
  expect(button("Auto").getAttribute("aria-pressed")).toBe("true");
  await click(button("Libera"));
  await click(button("Apparecchi"));
  await click(host.querySelector<HTMLButtonElement>('[data-node-id="1"]')!);
  await click(result("Interruttore"));
  expect(api.project.addCatalogueProduct).not.toHaveBeenCalled();
  await doubleClick(result("Interruttore"));
  expect(notice()?.textContent).toContain("Interruttore");
  await act(async () => vi.advanceTimersByTimeAsync(2500));
  await doubleClick(result("Interruttore"));
  expect(api.project.addCatalogueProduct).toHaveBeenCalledTimes(2);
  expect(api.project.addCatalogueProduct).toHaveBeenLastCalledWith(1, 1, true);
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(notice()?.textContent).toContain("Interruttore");

  await doubleClick(result("Sezionatore"));
  expect(notice()).toBeNull();
  await act(async () => finishConfigured());
  expect(notice()?.textContent).toContain("Sezionatore");
  expect(api.project.addConfiguredItem).toHaveBeenCalledWith({ modelId: 9, selectedOptionIds: [], productId: 2 }, 1, true);
  await act(async () => vi.advanceTimersByTimeAsync(2999));
  expect(notice()).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(notice()).toBeNull();

  await click(button("Carpenterie"));
  await doubleClick(structuralRow("Carpenteria Alpha"));
  expect(api.project.addStructural).toHaveBeenLastCalledWith({ kind: "enclosure", configuration: { modelId: 7, selectedOptionIds: [] } });
  expect(notice()?.textContent).toContain("Carpenteria Alpha");
  expect(button("Carpenterie").getAttribute("aria-pressed")).toBe("true");
  expect(host.querySelector('[data-tree-uuid="factory-panel"]')).not.toBeNull();
  await click(button("Pannelli"));
  await doubleClick(structuralRow("Pannello Beta"));
  expect(api.project.addStructural).toHaveBeenLastCalledWith({ kind: "support", place: false, parentUuid: "frame",
    configuration: { modelId: 8, selectedOptionIds: [] } });
  expect(notice()?.textContent).toContain("Pannello Beta");
  await click(button("Annulla", notice()!));
  expect(api.project.undo).toHaveBeenCalledWith("5");
  expect(notice()).toBeNull();

  await click(button("Auto"));
  await doubleClick(structuralRow("Pannello Beta"));
  expect(api.project.addStructural).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "support", autoPlace: true }));
  expect(notice()?.textContent).toContain("Aggiunto e posizionato");
  await click(button("Apparecchi"));
  await doubleClick(result("Sezionatore"));
  expect(api.project.addConfiguredItem).toHaveBeenLastCalledWith({ modelId: 9, selectedOptionIds: [], productId: 2 }, 1, true, true);
  expect(notice()?.textContent).toContain("Da posizionare");

  await click(button("Carpenterie"));
  for (const mode of ["Auto", "Libera"]) {
    await click(button(mode));
    await click(structuralRow("Carpenteria Alpha"));
    await click(button("Aggiungi e posiziona carpenteria"));
    expect(button("Carpenterie").getAttribute("aria-pressed"), mode).toBe("true");
    expect(host.querySelector('[data-tree-uuid="factory-panel"]')).not.toBeNull();
  }
});

it("keeps the drawing, catalogue query and selected article mounted when switching sidebars and opening Distinta", async () => {
  const api = fakeLqApi();
  api.catalogue.manufacturerNodes = async () => [{ id: 1, parentId: null, name: "Apparecchi", code: "test.root", brandMarchio: "TEST",
    source: "import", kind: "section", levelCode: null, levelLabel: null, sortOrder: 0, articleCount: 1, packageCount: 0 }];
  const product = { id: 1, brandMarchio: "TEST", manufacturerCode: "A1", description: "Interruttore", isListed: true,
    configurable: false, attributes: [] } as never;
  api.catalogue.browse = vi.fn(async () => ({ products: [product], totalCount: 1, offset: 0, hasMore: false, packages: [], packageCount: 0,
    facets: { brand: null, configurability: null, attributes: [] } }));
  api.project.designNavigation = async () => ({ status: "ready", candidates: [], nodes: [], staleImportIds: [], contextDataUnavailable: 0 });
  function Harness() {
    const [shell, dispatch] = useReducer(shellReducer, initialShellState);
    return <ProjectShell api={api} project={base} shell={shell} dispatch={dispatch} onProjectChange={() => undefined} statusBar={null} />;
  }
  await act(async () => root.render(<Harness />));
  const drawing = host.querySelector<HTMLElement>(".design-front")!;
  expect(drawing.hidden).toBe(true);
  expect(host.querySelector(".design-catalogue-navigation .catalogue-results")).toBeNull();
  expect(host.querySelector(".design-catalogue-results .catalogue-results")).not.toBeNull();
  await click(host.querySelector<HTMLButtonElement>('[data-node-id="1"]')!);
  await type(host.querySelector<HTMLInputElement>('[aria-label="Cerca articoli"]')!, "A1");
  await click(host.querySelector<HTMLButtonElement>(".catalogue-article")!);
  const article = host.querySelector(".catalogue-scheda-slot");
  await click(button("Carpenterie"));
  expect(drawing.hidden).toBe(false);
  expect(host.querySelector<HTMLElement>(".design-catalogue-navigation")!.hidden).toBe(true);
  expect(host.querySelector<HTMLElement>(".design-structural-docks")!.hidden).toBe(false);
  await click(button("Pannelli")); await click(button("Apparecchi"));
  expect(host.querySelector(".design-front")).toBe(drawing);
  expect(drawing.hidden).toBe(true);
  expect(host.querySelector(".catalogue-scheda-slot")).toBe(article);
  expect(host.querySelector<HTMLInputElement>('[aria-label="Cerca articoli"]')!.value).toBe("A1");
  expect(host.querySelector('.catalogue-article[aria-pressed="true"]')).not.toBeNull();
  await click(button("Distinta"));
  expect(host.querySelector('[role="dialog"]')).not.toBeNull(); expect(host.querySelector(".design-front")).toBe(drawing);
  await click(button("Chiudi"));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('[aria-label="Cerca articoli"]')!.value).toBe("A1");
});

it("keeps technical filtering and subcategory navigation working through four hierarchy levels", async () => {
  const api = fakeLqApi();
  api.catalogue.manufacturerNodes = async () => [1,2,3,4].map((id, index) => ({
    id, parentId: index ? id-1 : null, name: ["Apparecchi","Gamma","Tipologia","Sottocategoria"][index]!,
    code: `level.${id}`, brandMarchio: "TEST", source: "import", kind: "section", levelCode: null, levelLabel: null,
    sortOrder: 0, articleCount: 2, packageCount: 0,
  }));
  const products = [1,2].map(poles => ({ id: poles, brandMarchio: "TEST", manufacturerCode: `A${poles}`,
    description: `Interruttore ${poles} poli`, isListed: true, configurable: false, attributes: [] })) as never[];
  api.catalogue.browse = vi.fn(async (request: CatalogueBrowseRequest): Promise<CatalogueBrowseResult> => {
    const selected = request.attributeFilters?.find(filter => filter.attributeCode === "poles")?.values ?? [];
    const hits = products.filter((_, index) => !selected.length || selected.includes(index+1));
    return { products: hits, totalCount: hits.length, offset: 0, hasMore: false, packages: [], packageCount: 0,
      facets: { brand: null, configurability: null, attributes: [{ code: "poles", name: "Poli", dataType: "number",
        unit: null, applicable: true, values: [1,2].map(value => ({ value, label: null, count: 1, selected: selected.includes(value) })) }] } };
  });
  function Harness() {
    const [shell, dispatch] = useReducer(shellReducer, initialShellState);
    return <ProjectShell api={api} project={base} shell={shell} dispatch={dispatch} onProjectChange={() => undefined} statusBar={null} />;
  }
  await act(async () => root.render(<Harness />));
  const choose = async (id: number) => click(host.querySelector<HTMLButtonElement>(`[data-node-id="${id}"]`)!);
  await choose(1);
  await click([...host.querySelectorAll<HTMLElement>(".catalogue-facets summary")].find(node => node.textContent === "Poli")!);
  const option = [...document.querySelectorAll<HTMLLabelElement>(".catalogue-facet-options label")].find(label => label.textContent?.startsWith("2"))!.querySelector<HTMLInputElement>("input")!;
  await click(option);
  for (const id of [2,3,4]) {
    await choose(id);
    expect(api.catalogue.browse).toHaveBeenLastCalledWith(expect.objectContaining({ nodeId: id,
      attributeFilters: [{ attributeCode: "poles", values: [2] }] }));
    const rows = host.querySelectorAll(".design-catalogue-results .catalogue-article");
    expect(rows).toHaveLength(1); expect(rows[0]!.textContent).toContain("Interruttore 2 poli");
    expect(host.querySelector(".catalogue-facets summary")?.textContent).toBe("Poli (1)");
  }
  const last = host.querySelector<HTMLButtonElement>('[data-node-id="4"]')!;
  expect(last.closest('li[role="treeitem"]')?.getAttribute("aria-selected")).toBe("true");
  await click(host.querySelector<HTMLButtonElement>(".catalogue-clear-filters")!);
  expect(host.querySelectorAll(".design-catalogue-results .catalogue-article")).toHaveLength(2);
});

describe("Distinta overlay editing", () => {
  it("shows remaining quantities for partially placed and unplaced devices, and clears the warning when all are placed", async () => {
    const item = (uuid: string, configLabel: string, modelKind = "device"): ProjectConfiguredItem => ({
      uuid, modelName: configLabel, configLabel, modelKind, commercialContribution: "none",
      modelBrandMarchio: "TEST", modelCode: uuid, modelDefinitionFingerprint: "definition", modelSourceRef: null,
      configFingerprint: uuid, configStatus: "complete", physStatus: "resolved", profileCode: null, profileName: null,
      fitClassCode: null, fitClassLabel: null, depthMm: null, outerDepthMm: null, usableDepthMm: null,
      selections: [], bom: [], demands: [], views: [], zones: [], slots: [], constraints: [], exclusions: [],
    });
    const partial = item("partial", "Interruttore 16 A");
    const pending = item("pending", "Contattore 24 V");
    const complete = item("complete", "Sezionatore");
    const panel = item("panel", "Pannello DIN", "support");
    const configuredItems = [partial, pending, complete, panel];
    const lines = [...configuredItems.map((entry, index) => ({
      ...line, lineType: "item" as const, uuid: `line-${entry.uuid}`, itemUuid: entry.uuid, snapshotUuid: null,
      commercialContribution: "none" as const, description: entry.configLabel, quantity: [6, 2, 1, 2][index]!,
    })), { ...line, description: "Articolo ordinario" }];
    const node = (uuid: string, nodeKind: ProjectPhysicalNode["nodeKind"], itemUuid: string | null,
      parentUuid: string | null, children: ProjectPhysicalNode[] = []): ProjectPhysicalNode => ({
      uuid, nodeKind, itemUuid, parentUuid, children, zoneNo: null, startUnits: null, slotNo: null, rootXMm: null,
      rootYMm: null, viewCode: "front", sortOrder: 0, xMm: 0, yMm: 0, positionIssue: null,
    });
    const deviceNodes = (entry: ProjectConfiguredItem, count: number) => Array.from({ length: count }, (_, index) =>
      node(`${entry.uuid}-${index}`, "device", entry.uuid, "rail"));
    const project = (partialCount: number, pendingCount: number): ProjectDocumentView => ({
      ...openProject, lines, configuredItems, physicalNodes: [node("frame", "enclosure", null, null, [
        node("rail", "support", panel.uuid, "frame", [
          ...deviceNodes(partial, partialCount), ...deviceNodes(pending, pendingCount), ...deviceNodes(complete, 1),
        ]),
      ])],
    });
    const api = fakeLqApi().project;
    const queue = new ProjectActionQueue();
    const show = async (view: ProjectDocumentView) => {
      await act(async () => root.render(<DistintaDialog api={api} project={view} actionQueue={queue}
        onProjectChange={() => undefined} onClose={() => undefined} onOpenLine={() => undefined} onBrowse={() => undefined} />));
    };
    await show(project(1, 0));
    const warning = host.querySelector<HTMLDetailsElement>(".quotation-unplaced")!;
    expect(warning.querySelector("strong")?.textContent).toBe("7 apparecchi da posizionare");
    expect(warning.open).toBe(false);
    await click(warning.querySelector("summary")!);
    expect(warning.open).toBe(true);
    expect([...warning.querySelectorAll("li")].map(row => [...row.children].map(cell => cell.textContent))).toEqual([
      ["Interruttore 16 A", "5 da posizionare su 6"], ["Contattore 24 V", "2 da posizionare su 2"],
    ]);
    await show(project(5, 2));
    expect(warning.open).toBe(true);
    expect(warning.querySelector("strong")?.textContent).toBe("1 apparecchio da posizionare");
    expect(warning.querySelector("li")?.textContent).toContain("1 da posizionare su 6");
    await show(project(6, 2));
    expect(host.querySelector(".quotation-unplaced")).toBeNull();
  });

  it("groups matching saved placements, preserves totals, and expands the original row controls", async () => {
    const makeItem = (uuid: string, price = 100_000, discount = 0, config = "same"): ProjectConfiguredItem => ({
      uuid, modelName: "Pannello DIN", modelCode: "rail", modelBrandMarchio: "TEST", modelKind: "support",
      modelDefinitionFingerprint: "definition", modelSourceRef: null, configFingerprint: config, configLabel: "Pannello DIN",
      configStatus: "complete", commercialContribution: "articles", physStatus: "resolved", profileCode: null, profileName: null,
      fitClassCode: null, fitClassLabel: null, depthMm: null, outerDepthMm: null, usableDepthMm: null,
      bom: [{ seq: 0, snapshotUuid: "rail-snapshot", brandMarchio: "TEST", manufacturerCode: "RAIL", description: "Guida DIN",
        quantityPerItem: 1, role: "primary", listPriceUnitE4: 100_000, salePriceUnitE4: price, lineDiscountBp: discount }],
      selections: [], views: [], demands: [], zones: [], slots: [], constraints: [], exclusions: [],
    });
    const items = [...Array.from({ length: 5 }, (_, index) => makeItem(`copy-${index}`)),
      makeItem("discount", 100_000, 1_000), makeItem("price", 120_000), makeItem("configuration", 100_000, 0, "different")];
    const placedLines = items.map(item => ({ ...line, uuid: `line-${item.uuid}`, lineType: "item" as const,
      itemUuid: item.uuid, snapshotUuid: null, quantity: 1, description: item.configLabel, lineTotalE4: 100_000 }));
    const placed = (item: ProjectConfiguredItem, index: number): ProjectPhysicalNode => ({
      uuid: `node-${item.uuid}`, itemUuid: item.uuid, parentUuid: "enclosure", nodeKind: "support", zoneNo: 0, startUnits: index * 100,
      slotNo: null, rootXMm: null, rootYMm: null, viewCode: "front", sortOrder: index, xMm: 0, yMm: index * 100,
      positionIssue: null, children: [],
    });
    const enclosure: ProjectPhysicalNode = { ...placed(items[0]!, 0), uuid: "enclosure", itemUuid: null, parentUuid: null,
      nodeKind: "enclosure", zoneNo: null, startUnits: null, children: items.map(placed) };
    const project = { ...openProject, lines: [placedLines[0]!, line, ...placedLines.slice(1)], configuredItems: items,
      physicalNodes: [enclosure] };
    const api = fakeLqApi().project;
    const openLine = vi.fn();
    const projectChange = vi.fn();
    await act(async () => root.render(<DistintaDialog api={api} project={project} actionQueue={new ProjectActionQueue()}
      onProjectChange={projectChange} onClose={() => undefined} onOpenLine={openLine} onBrowse={() => undefined} />));
    const group = host.querySelector(".quotation-line-group")!;
    const expand = group.querySelector("button")!;
    expect(group.querySelector(".quotation-quantity")?.textContent).toBe("5");
    expect(group.querySelector(".quotation-net")?.textContent).toBe(formatMoneyE4(500_000, "EUR"));
    expect(host.querySelectorAll(".quotation-line-group")).toHaveLength(1);
    expect(host.querySelectorAll(".quotation-line")).toHaveLength(5);
    const total = formatMoneyE4(1_010_000, "EUR");
    expect(host.querySelector(".quotation-total")?.textContent).toBe(total);
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    await click(expand);
    expect(expand.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelectorAll(".quotation-line")).toHaveLength(10);
    const first = group.nextElementSibling!;
    expect(first.querySelector<HTMLInputElement>('input[aria-label="Quantità Pannello DIN"]')?.value).toBe("1");
    await click(first.querySelector<HTMLButtonElement>(".quotation-row-select")!);
    expect(openLine).toHaveBeenCalledExactlyOnceWith("line-copy-0");
    expect(host.querySelector(".quotation-total")?.textContent).toBe(total);
    expect(projectChange).not.toHaveBeenCalled();
    await click(expand);
    expect(host.querySelectorAll(".quotation-line")).toHaveLength(5);
  });

  it("uses persisted quantity/discount/global/labour commands and waits for edits before exporting", async () => {
    const api = fakeLqApi().project; let current = base, release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    api.setQuantity = vi.fn(async (uuid, quantity) => { await pending; return { ...current, lines: [{ ...line, quantity }] }; });
    api.setLineDiscount = vi.fn(async (_, bp) => ({ ...current, lines: current.lines.map(line => ({ ...line, lineDiscountBp: bp })) }));
    api.setGlobalDiscount = vi.fn(async bp => ({ ...current, globalDiscountBp: bp }));
    api.setLabourTotal = vi.fn(async total => ({ ...current, labourTotalE4: total }));
    api.saveDocumentPdf = vi.fn(async () => true);
    const queue = new ProjectActionQueue();
    function Harness() {
      const [project, setProject] = useState(base); current = project;
      return <DistintaDialog api={api} project={project} actionQueue={queue} onProjectChange={setProject}
        onClose={() => undefined} onOpenLine={() => undefined} onBrowse={() => undefined} />;
    }
    await act(async () => root.render(<Harness />));
    const quantity = host.querySelector<HTMLInputElement>('input[aria-label="Quantità Interruttore"]')!;
    await type(quantity, "4");
    await act(async () => quantity.blur());
    await click(button("Salva PDF")); expect(api.saveDocumentPdf).not.toHaveBeenCalled();
    await act(async () => { release(); await pending; });
    expect(current.lines[0]!.quantity).toBe(4); expect(api.saveDocumentPdf).toHaveBeenCalledOnce();
    for (const [label, value] of [["Sconto Interruttore Interruttore", "10,00"], ["Sconto globale progetto", "5,00"], ["Mano d'opera totale in euro", "20,00"]]) {
      const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
      await type(input, value!); await act(async () => input.blur());
    }
    expect(api.setLineDiscount).toHaveBeenCalledWith("line", 1000);
    expect(current.globalDiscountBp).toBe(500); expect(current.labourTotalE4).toBe(200_000);
  });
  it("blocks export of invalid drafts and lets Escape reset a field before closing the overlay", async () => {
    const api = fakeLqApi().project; api.saveDocumentPdf = vi.fn(async () => true);
    const close = vi.fn();
    await act(async () => root.render(<DistintaDialog api={api} project={base} actionQueue={new ProjectActionQueue()}
      onProjectChange={() => undefined} onClose={close} onOpenLine={() => undefined} onBrowse={() => undefined} />));
    const discount = host.querySelector<HTMLInputElement>('[aria-label="Sconto Interruttore Interruttore"]')!;
    await type(discount, "101"); await act(async () => discount.blur()); await click(button("Salva PDF"));
    expect(api.saveDocumentPdf).not.toHaveBeenCalled(); expect(host.textContent).toContain("Correggi i valori");
    await act(async () => discount.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(close).not.toHaveBeenCalled(); expect(discount.value).toBe("0,00");
  });
});

it("opens compatible DIN options and inserts a physical-only item using the existing backend command", async () => {
  const api = fakeLqApi(), close = vi.fn(), adopt = vi.fn();
  const navigation = { status: "ready", staleImportIds: [], contextDataUnavailable: 0,
    nodes: [{ id: 1, parentId: null, name: "Accessori", modelIds: [7] }],
    candidates: [{ id: 7, name: "Solo ingombro", commercialContribution: "none" }] } as unknown as StructuralNavigation;
  api.project.designNavigation = vi.fn(async () => navigation);
  api.project.addStructural = vi.fn(async () => base);
  const model = { id: 7, name: "Solo ingombro", axes: [], active: true, obsolete: false, budgets: [], relations: [] } as unknown as ConfigModelDetail;
  api.configuration.model = async () => model;
  api.configuration.resolve = async () => ({ model, selectedOptionIds: [], defaultedOptionIds: [], status: "complete", issues: [], bom: [], budgets: [],
    totalE4: null, pricedSubtotalE4: 0, physical: { name: "Spazio", fitClass: { name: "DIN" }, depthMm: null, outerDepthMm: null, usableDepthMm: null, demands: [{ capacityKindCode: "din_rail", amount: 2, displayDivisor: 2 }], views: [], zones: [], slots: [], constraints: [] },
    exclusions: [] } as unknown as ConfigurationResult);
  const panel = { uuid: "panel" } as never;
  await act(async () => root.render(<DinConfigurationDialog api={api.project} project={base} configurationApi={api.configuration}
    panel={panel} onProjectChange={adopt} onClose={close} />));
  expect(api.project.designNavigation).toHaveBeenCalledWith("device", "panel");
  await click(button("Aggiungi"));
  expect(api.project.addStructural).toHaveBeenCalledWith(expect.objectContaining({ kind: "device", parentUuid: "panel", place: false }));
  expect(adopt).toHaveBeenCalledWith(base); expect(close).toHaveBeenCalledOnce();
});
