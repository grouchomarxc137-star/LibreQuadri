/// <reference types="node" />
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ConfigModelDetail, ConfigurationResult } from "../../src/shared/configuration.js";
import type { ProjectApi, ProjectConfiguredItem, ProjectDocumentView, ProjectPhysicalNode, StructuralNavigation } from "../../src/shared/project.js";
import { ConfigurationControls, ConfigurationResultPanel } from "../../src/renderer/configuration/ConfigurationScreen.js";
import { demoQuotationTotals } from "../../src/renderer/quotation/demo-quotation.js";
import { PhysicalPool } from "../../src/renderer/project/PhysicalPool.js";
import { devicePool } from "../../src/renderer/project/placement-workflow.js";
import { StructuralNavigationSession, currentNavigation, navigationNotice, structuralAddLabel,
  structuralAddRequest, structuralDevicePanel, submitStructuralAdd,
  type StructuralNavigationState } from "../../src/renderer/project/structural-navigation.js";
import { StructuralNavigator } from "../../src/renderer/project/StructuralWorkflow.js";

// Generic fixtures: a physical-only device is described only by `commercialContribution: "none"`.
const spaceModel = { id: 7, code: "space.model", name: "Solo spazio", kind: "device", brandMarchio: "TEST",
  active: true, obsolete: false, commercialContribution: "none" as const };
const widthModel: ConfigModelDetail = { ...spaceModel, definitionFingerprint: "fp", sourceRef: null,
  baseProfileId: null, maxInsertQty: null, budgets: [], relations: [], axes: [
    { id: 1, dimensionCode: "width", label: "Moduli DIN", sortOrder: 1, visibility: "visible", requirement: "required",
      binding: "profile", editableWhenPlaced: false, selectsPrimary: false, options: [1, 2, 3].map(n => (
        { id: 10 + n, axisId: 1, valueId: n, valueCode: `w${n}`, label: `${n} moduli`, parentOptionId: null,
          isDefault: n === 1, visible: true, active: true, sortOrder: n })) }] };
const resolved = (modules: number): ConfigurationResult => ({ model: widthModel, selectedOptionIds: [10 + modules],
  defaultedOptionIds: [], commercialContribution: "none", matchingRuleIds: [], fingerprint: `fp-${modules}`,
  status: "complete", issues: [], bom: [], totalE4: null, pricedSubtotalE4: 0, budgets: [], exclusions: [],
  physical: { code: "space", name: "Spazio", kind: "device", fitClass: { code: "DEV", name: "Apparecchio" },
    depthMm: null, outerDepthMm: null, usableDepthMm: null, views: [], zones: [], slots: [], constraints: [],
    demands: [{ capacityKindCode: "din_rail", amount: modules * 2, unitLabel: "moduli", displayDivisor: 2,
      nominalPitchMm: 9 }] },
  context: { policy: "unrestricted", provides: [], accepts: [] } } as unknown as ConfigurationResult);

const navigation = (): StructuralNavigation => ({ status: "ready", staleImportIds: [], contextDataUnavailable: 0,
  candidates: [spaceModel, { ...spaceModel, id: 8, name: "Interruttore", commercialContribution: "articles" as const }],
  nodes: [{ id: 1, parentId: null, name: "Apparecchi", kind: "section", sortOrder: 0, modelIds: [7, 8] }] });
const loaded = (): StructuralNavigationState => ({ phase: "loaded", kind: "device", parentUuid: "panel-1", navigation: navigation() });

const node = (uuid: string, nodeKind: ProjectPhysicalNode["nodeKind"], children: ProjectPhysicalNode[] = [],
  parentUuid: string | null = null): ProjectPhysicalNode => ({ uuid, itemUuid: `item-${uuid}`, parentUuid, nodeKind,
  zoneNo: null, startUnits: null, slotNo: null, rootXMm: null, rootYMm: null, viewCode: "front", sortOrder: 0,
  xMm: null, yMm: null, positionIssue: null, children });

describe("Apparecchi in the Progettazione structure workflow", () => {
  it("shows a discovered physical-only device in the reachable hierarchy, next to ordinary devices", () => {
    const markup = renderToStaticMarkup(<StructuralNavigator kind="device" state={loaded()} expanded={new Set([1])}
      onToggle={() => undefined} modelId={null} onSelect={() => undefined} />);
    expect(markup).toContain("Apparecchi compatibili");
    expect(markup).toContain("Solo spazio");
    expect(markup).toContain("Interruttore");
  });

  it("never asks the backend for devices without a Pannello", async () => {
    const designNavigation = vi.fn(async () => navigation());
    const states: StructuralNavigationState[] = [];
    const session = new StructuralNavigationSession({ designNavigation }, state => states.push(state));
    session.load("device", undefined);
    expect(designNavigation).not.toHaveBeenCalled();
    expect(states).toEqual([{ phase: "no_root" }]);
    expect(navigationNotice({ phase: "no_root" }, "device")?.text).toContain("Posiziona prima un pannello");
    session.load("device", "panel-1");
    expect(designNavigation).toHaveBeenCalledWith("device", "panel-1");
    expect(currentNavigation(loaded(), "device", "panel-2")).toEqual({ phase: "loading" });
  });

  it("explains an empty or unverifiable device list", () => {
    expect(navigationNotice({ ...loaded(), navigation: { ...navigation(), candidates: [], nodes: [] } } as StructuralNavigationState,
      "device")?.text).toContain("Nessun apparecchio compatibile");
    expect(navigationNotice({ ...loaded(), navigation: { ...navigation(), status: "container_unavailable" } } as StructuralNavigationState,
      "device")?.text).toContain("gli apparecchi non possono essere verificati");
  });

  it("offers the selected Pannello, the Pannello of a selected Apparecchio, else the first Pannello of the root", () => {
    const device = node("dev", "device", [], "panel-b");
    const panelB = node("panel-b", "support", [device], "root");
    const panelA = node("panel-a", "support", [], "root");
    const root = node("root", "enclosure", [panelA, panelB]);
    expect(structuralDevicePanel(null, root)?.uuid).toBe("panel-a");
    expect(structuralDevicePanel({ kind: "support", node: panelB }, root)?.uuid).toBe("panel-b");
    expect(structuralDevicePanel({ kind: "device", node: device, parent: panelB }, root)?.uuid).toBe("panel-b");
    expect(structuralDevicePanel({ kind: "enclosure", node: root }, root)?.uuid).toBe("panel-a");
    expect(structuralDevicePanel(null, node("empty", "enclosure"))).toBeUndefined();
    expect(structuralDevicePanel(null, undefined)).toBeUndefined();
  });

  it("renders the generic width axis of the model and the physical result with no price or missing-price warning", () => {
    const controls = renderToStaticMarkup(<ConfigurationControls model={widthModel} result={resolved(2)} busy={false}
      onChoice={() => undefined} />);
    expect(controls).toContain("Moduli DIN");
    for (const label of ["1 moduli (predefinito)", "2 moduli", "3 moduli"]) expect(controls).toContain(label);
    const panel = renderToStaticMarkup(<ConfigurationResultPanel result={resolved(2)} />);
    expect(panel).toContain("Configurazione completa");
    expect(panel).toContain("Nessun articolo commerciale");
    expect(panel).not.toMatch(/prezzo|Prezzo|€|Avviso|Da correggere/);
    // A different width is a different resolved physical configuration, requested from the backend.
    expect(resolved(3).fingerprint).not.toBe(resolved(2).fingerprint);
    expect(renderToStaticMarkup(<ConfigurationResultPanel result={resolved(3)} />)).not.toBe(panel);
  });

  it("adds through the existing add path without placement, and never calls a placement API", async () => {
    const configuration = { modelId: 7, selectedOptionIds: [12] };
    expect(structuralAddRequest("device", configuration, "panel-1"))
      .toEqual({ configuration, kind: "device", parentUuid: "panel-1", place: false });
    expect(structuralAddLabel("device")).toBe("Aggiungi");
    const updated = { physicalNodes: [] } as unknown as ProjectDocumentView;
    const api = { addStructural: vi.fn(async () => updated) } as unknown as Pick<ProjectApi, "addStructural">;
    const result = await submitStructuralAdd(api, updated, "device", configuration, "panel-1");
    expect(api.addStructural).toHaveBeenCalledWith({ configuration, kind: "device", parentUuid: "panel-1", place: false });
    expect(result.message).toContain("non ancora posizionato");
    await expect(submitStructuralAdd(api, updated, "device", configuration, undefined)).rejects.toThrow("pannello");
    expect(api.addStructural).toHaveBeenCalledOnce();
  });

  it("lists the added physical-only device in Da posizionare and drags it through the ordinary device pool", () => {
    const item = { uuid: "item-space", modelName: "Solo spazio", modelBrandMarchio: "TEST", modelCode: "space.model",
      modelKind: "device", commercialContribution: "none", physStatus: "resolved", profileCode: "space",
      views: [], demands: [{ capacityKindCode: "din_rail", capacityKindLabel: "DIN", amount: 4, displayDivisor: 2,
        nominalPitchMm: 9 }], bom: [], selections: [] } as unknown as ProjectConfiguredItem;
    const project = { configuredItems: [item], physicalNodes: [],
      lines: [{ lineType: "item", uuid: "line", itemUuid: "item-space", quantity: 2, commercialContribution: "none",
        unitListPriceE4: null, lineTotalE4: null }], distinta: [] } as unknown as ProjectDocumentView;
    const devices = devicePool(project);
    expect(devices.map(entry => [entry.item.uuid, entry.available, entry.quantity])).toEqual([["item-space", 2, 2]]);
    const markup = renderToStaticMarkup(<PhysicalPool structural={[]} devices={devices} hasRoot
      onDragStart={() => undefined} />);
    expect(markup).toContain("Solo spazio");
    expect(markup).toContain('data-pool-kind="device"');
    expect(markup).toContain('data-draggable="true"');
    expect(project.distinta).toEqual([]);
    expect(demoQuotationTotals(project.lines)).toMatchObject({ unpricedLineCount: 0, totalQuantity: 2 });
  });

  it("keeps the renderer free of manufacturer, pack-id and name special cases, and out of Catalogo", () => {
    for (const file of ["StructuralWorkflow.tsx", "structural-navigation.ts", "PhysicalPool.tsx", "ProgettazioneScreen.tsx"]) {
      const source = readFileSync(`src/renderer/project/${file}`, "utf8");
      expect(source, file).not.toMatch(/1778|tq\.pack|BTicino|TiQuadri|Solo spazio/i);
      expect(source, file).not.toContain("commercialContribution");
    }
    const catalogue = readFileSync("src/renderer/catalogue/CatalogueScreen.tsx", "utf8");
    expect(catalogue).not.toMatch(/designNavigation|designDiscover|structuralDevicePanel|"device"/);
  });
});
