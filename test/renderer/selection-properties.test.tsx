/// <reference types="node" />
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FronteQuadro, ProgettazioneScreen } from "../../src/renderer/project/ProgettazioneScreen.js";
import { PhysicalTree } from "../../src/renderer/project/PhysicalTree.js";
import { DesignProperties, RemoveCarpenteriaDialog, removeRootDialogKey } from "../../src/renderer/project/DesignProperties.js";
import { ancestorUuids, describeSelection, designKeyCommand, designSelectionReducer, hoverHighlights, initialDesignPointer,
  isTextEntryTarget, pressOutcome, selectableUuids, unplaceBlockReason, type DesignPointerState,
  type SelectableKind } from "../../src/renderer/project/design-selection.js";
import { designStatusSegments, nodeStartText, positionText } from "../../src/renderer/project/design-presentation.js";
import { combinedFrontGeometry, drawingScale, sectorAt, selectionFrame, SELECTION_GAP_MM, SELECTION_TAG_PX,
  toDisplayPoint, toPersistedPoint } from "../../src/renderer/project/front-geometry.js";
import { clientToViewBox } from "../../src/renderer/project/placement-drag.js";
import type { ProjectApi, ProjectConfiguredItem, ProjectDocumentView, ProjectPhysicalNode } from "../../src/shared/project.js";

/*
 * R-17c: one persistent selection shared by the Fronte Quadro, Albero fisico and Proprietà, a
 * transient neutral hover that never replaces it, and the physical actions (Rimuovi posizione,
 * Delete, whole-Carpenteria removal) moved to Proprietà and the keyboard.
 */
const item = (uuid: string, kind: "enclosure" | "support" | "device", code: string, width: number, height: number,
  extra: Partial<ProjectConfiguredItem> = {}): ProjectConfiguredItem => ({
  uuid, modelKind: kind, modelName: `${code} modello`, modelCode: code, modelBrandMarchio: "TEST", configLabel: code,
  physStatus: "resolved", bom: [{ role: "primary", manufacturerCode: `${code}-ART` }], selections: [], demands: [],
  views: [{ viewCode: "front", widthMm: width, heightMm: height, assetKey: null }], zones: [], ...extra,
} as unknown as ProjectConfiguredItem);
const node = (uuid: string, itemUuid: string, kind: "enclosure" | "support" | "device", x: number, y: number,
  children: ProjectPhysicalNode[] = [], parentUuid: string | null = null,
  position: Partial<ProjectPhysicalNode> = {}): ProjectPhysicalNode => ({
  uuid, itemUuid, nodeKind: kind, xMm: x, yMm: y, viewCode: "front", children, parentUuid,
  zoneNo: null, startUnits: null, slotNo: null, rootXMm: parentUuid ? null : x, rootYMm: parentUuid ? null : y,
  sortOrder: 0, positionIssue: null, ...position,
});

const box = item("box", "enclosure", "BOX", 400, 600, { zones: [{ zoneNo: 0, layout: "stack" }] as never });
const tray = item("tray", "support", "TRAY", 200, 100, {
  zones: [{ zoneNo: 1, layout: "linear", capacityKindLabel: "moduli", displayDivisor: 2 }] as never });
const breaker = item("breaker", "device", "C16", 18, 80, {
  demands: [{ capacityKindCode: "din", capacityKindLabel: "moduli", amount: 2, displayDivisor: 2, nominalPitchMm: 9 }],
  selections: [{ dimensionCode: "curve", dimensionLabel: "Curva", valueCode: "C", valueLabel: "C", visible: true },
    { dimensionCode: "hidden", dimensionLabel: "Interna", valueCode: "x", valueLabel: "nascosta", visible: false }] as never });
const items = [box, tray, breaker];

// Carpenteria A holds a Pannello with one Apparecchio at 3 moduli; Carpenteria B an empty Pannello.
// B overlaps A in persisted coordinates (an older project), so it is drawn with a display offset.
const device = node("dev", "breaker", "device", 64, 290, [], "panel-a", { zoneNo: 1, startUnits: 6 });
const panelA = node("panel-a", "tray", "support", 10, 280, [device], "root-a", { zoneNo: 0, startUnits: 280 });
const panelB = node("panel-b", "tray", "support", 110, 280, [], "root-b", { zoneNo: 0, startUnits: 280 });
const rootA = node("root-a", "box", "enclosure", 0, 0, [panelA]);
const rootB = node("root-b", "box", "enclosure", 100, 0, [panelB]);
const roots = [rootA, rootB];
const project = {
  configuredItems: items, physicalNodes: roots,
  lines: [{ itemUuid: "box", quantity: 2 }, { itemUuid: "tray", quantity: 3 }, { itemUuid: "breaker", quantity: 2 }],
} as unknown as ProjectDocumentView;
const byId = new Map(items.map(entry => [entry.uuid, entry]));

const reduce = (state: DesignPointerState, ...actions: Parameters<typeof designSelectionReducer>[1][]) =>
  actions.reduce(designSelectionReducer, state);
const drawing = (props: Partial<Parameters<typeof FronteQuadro>[0]> = {}) =>
  renderToStaticMarkup(<FronteQuadro roots={roots} items={items} {...props} />);
const tree = (selectedUuid: string | null, hoverUuid: string | null = null) => renderToStaticMarkup(
  <PhysicalTree roots={roots} items={byId} currentRootUuid="root-a" selectedUuid={selectedUuid} hoverUuid={hoverUuid}
    onSelect={() => undefined} onHover={() => undefined} />);
const properties = (uuid: string | null, busy = false) => renderToStaticMarkup(<DesignProperties
  selection={describeSelection(project, uuid)} assets={{}} busy={busy} onUnplace={() => undefined} onRemoveRoot={() => undefined} />);
/** The Albero fisico row of a node: its opening tag and the rest of its row. */
const treeRow = (html: string, uuid: string) => html.match(new RegExp(`<div class="design-tree-row"[^>]*data-tree-uuid="${uuid}"[^>]*>`))![0];
const selectedRows = (html: string) => [...html.matchAll(/data-tree-uuid="([^"]+)"[^>]*data-selected="true"/g)].map(match => match[1]);

describe("one persistent selection, one transient hover", () => {
  it("keeps hover and selection independent: hover never replaces the selection", () => {
    const selected = reduce(initialDesignPointer, { type: "select", uuid: "dev" });
    const hovered = reduce(selected, { type: "hover", uuid: "panel-b", source: "tree" }, { type: "hover", uuid: "root-a", source: "canvas" });
    expect(hovered).toEqual({ selectedUuid: "dev", hoverUuid: "root-a", hoverSource: "canvas" });
    expect(reduce(hovered, { type: "hover", uuid: null, source: "canvas" })).toEqual({ selectedUuid: "dev", hoverUuid: null, hoverSource: null });
    // Clearing the selection leaves the pointer's hover alone; unchanged input returns the same state.
    expect(reduce(hovered, { type: "clear" })).toEqual({ selectedUuid: null, hoverUuid: "root-a", hoverSource: "canvas" });
    expect(designSelectionReducer(hovered, { type: "select", uuid: "dev" })).toBe(hovered);
    expect(designSelectionReducer(hovered, { type: "hover", uuid: "root-a", source: "canvas" })).toBe(hovered);
  });

  it("forgets a selection or hover whose node left the project", () => {
    const state = { selectedUuid: "dev", hoverUuid: "panel-b", hoverSource: "tree" as const };
    expect(designSelectionReducer(state, { type: "prune", present: selectableUuids(roots) })).toBe(state);
    const unplaced = [{ ...rootA, children: [{ ...panelA, children: [] }] }];
    expect(designSelectionReducer(state, { type: "prune", present: selectableUuids(unplaced) }))
      .toEqual({ selectedUuid: null, hoverUuid: null, hoverSource: null });
    expect(describeSelection(project, "missing")).toBeNull();
  });

  it("canvas → Albero fisico → Proprietà: a click on a drawn object selects it everywhere", () => {
    // The press lands on the Apparecchio's hit area and is released within the drag threshold.
    const click = pressOutcome({ uuid: "dev", x: 300, y: 200 }, { x: 302, y: 201 }, 4);
    expect(click).toEqual({ type: "select", uuid: "dev" });
    const state = reduce(initialDesignPointer, click!);
    // Fronte Quadro: the orange selection is drawn on that object only.
    const html = drawing({ selectedUuid: state.selectedUuid });
    expect(html.match(/class="front-selection"/g)).toHaveLength(1);
    expect(html).toContain('data-selection-uuid="dev"');
    expect(html).toMatch(/<g data-node-uuid="dev" class="front-device" data-selected="true"/);
    // Albero fisico: the same row, and only it, has the selected-row treatment.
    const outline = tree(state.selectedUuid);
    expect(selectedRows(outline)).toEqual(["dev"]);
    expect(outline).toMatch(/<li role="treeitem" aria-selected="true"><div class="design-tree-row" data-kind="device" data-tree-uuid="dev"/);
    expect(outline.match(/aria-selected="true"/g)).toHaveLength(1);
    // Proprietà: the same object's facts from the snapshot.
    const panel = properties(state.selectedUuid);
    expect(panel).toContain("C16 modello");
    expect(panel).toContain("TEST · C16-ART");
    expect(panel).toContain("Posizionati 1 di 2");
    expect(panel).toMatch(/<dt>Pannello<\/dt><dd[^>]*>TRAY modello<\/dd>/);
    expect(panel).toMatch(/<dt>Carpenteria<\/dt><dd[^>]*>BOX modello<\/dd>/);
    expect(panel).toMatch(/<dt>Inizio<\/dt><dd[^>]*>3 moduli<\/dd>/);
    expect(panel).toMatch(/<dt>X · Y<\/dt><dd[^>]*>64 · 290 mm<\/dd>/);
    expect(panel).toMatch(/<dt>Curva<\/dt><dd[^>]*>C<\/dd>/);
    expect(panel).not.toContain("nascosta");
  });

  it("Albero fisico → canvas → Proprietà: a row selects the same object in the drawing", () => {
    // A row choice dispatches the same select action as a canvas click; there is one selection state.
    const state = reduce(initialDesignPointer, { type: "select", uuid: "panel-b" });
    expect(selectedRows(tree(state.selectedUuid))).toEqual(["panel-b"]);
    const html = drawing({ selectedUuid: state.selectedUuid, focusUuid: "root-a" });
    expect(html).toContain('data-selection-uuid="panel-b"');
    // Selection never changes which Carpenterie are drawn, nor the focus caption.
    expect([...html.matchAll(/data-root-uuid="([^"]+)"/g)].map(match => match[1])).toEqual(["root-a", "root-b"]);
    expect(html).toMatch(/data-root-uuid="root-a" data-focus="true"/);
    const panel = properties(state.selectedUuid);
    expect(panel).toContain("Pannello");
    expect(panel).toMatch(/<dt>Carpenteria<\/dt><dd[^>]*>BOX modello<\/dd>/);
    expect(panel).toMatch(/<dt>Contenuto<\/dt><dd[^>]*>0 apparecchi<\/dd>/);
    expect(panel).toMatch(/<dt>Inizio<\/dt><dd[^>]*>280 mm<\/dd>/);
  });

  it("opens the Albero fisico rows above a selection made in the drawing", () => {
    expect(ancestorUuids(roots, "dev")).toEqual(["panel-a", "root-a"]);
    expect(ancestorUuids(roots, "root-b")).toEqual([]);
    expect(ancestorUuids(roots, "missing")).toEqual([]);
  });

  it("pre-highlights only across views: a tree row in the drawing, a drawn object in the tree", () => {
    const selected = reduce(initialDesignPointer, { type: "select", uuid: "dev" });
    // Pointer over an Albero fisico row: the drawing identifies the object; the row itself needs nothing extra.
    const fromTree = hoverHighlights(reduce(selected, { type: "hover", uuid: "panel-b", source: "tree" }), false);
    expect(fromTree).toEqual({ canvas: "panel-b", tree: null });
    // Pointer over the drawing: the row is identified; nothing is outlined where the pointer already is.
    const fromCanvas = hoverHighlights(reduce(selected, { type: "hover", uuid: "root-a", source: "canvas" }), false);
    expect(fromCanvas).toEqual({ canvas: null, tree: "root-a" });
    // A press (possible drag) or a drag shows no pre-highlight at all.
    expect(hoverHighlights(reduce(selected, { type: "hover", uuid: "panel-b", source: "tree" }), true)).toEqual({ canvas: null, tree: null });
    expect(hoverHighlights(reduce(selected, { type: "hover", uuid: "dev", source: "canvas" }), true)).toEqual({ canvas: null, tree: null });
    // Neither ever touches the selection.
    expect(reduce(selected, { type: "hover", uuid: "panel-b", source: "tree" }).selectedUuid).toBe("dev");
  });

  it("draws the identification as a neutral outline that never replaces the orange selection", () => {
    const state = { selectedUuid: "dev", hoverUuid: "panel-b" };
    const html = drawing({ selectedUuid: state.selectedUuid, hoverUuid: state.hoverUuid });
    expect(html.match(/class="front-hover-outline"/g)).toHaveLength(1);
    // Drawn just outside the object (same gap as the selection) so it never hides under the object's own edge.
    expect(html).toMatch(/class="front-hover-outline" data-hover-uuid="panel-b" x="108.5" y="278.5" width="203" height="103"/);
    expect(html).toContain('data-selection-uuid="dev"');
    const outline = tree(state.selectedUuid, state.hoverUuid);
    expect(treeRow(outline, "panel-b")).toContain('data-hover="true"');
    expect(treeRow(outline, "panel-b")).not.toContain("data-selected");
    expect(selectedRows(outline)).toEqual(["dev"]);
    // Hovering the selected object adds nothing over its selection.
    expect(drawing({ selectedUuid: "dev", hoverUuid: "dev" })).not.toContain("front-hover-outline");
    // Hover is never drawn during a drag; the green targets are the only guidance then.
    const dragging = drawing({ selectedUuid: "dev", hoverUuid: "panel-b",
      overlay: { parents: ["panel-b"], hover: null, subject: { origin: "pool", kind: "device", item: breaker } } });
    expect(dragging).not.toContain("front-hover-outline");
    expect(dragging).toContain("front-target-parent");
    expect(dragging).toContain('data-selection-uuid="dev"');
  });

  it("hides the selection of the object being dragged, keeps it for another dragged object", () => {
    const moving = drawing({ selectedUuid: "dev", overlay: { parents: ["panel-a"], hover: null,
      subject: { origin: "node", kind: "device", item: breaker, nodeUuid: "dev", parentUuid: "panel-a" } } });
    expect(moving).not.toContain("front-selection");
    expect(moving).toMatch(/data-node-uuid="dev" class="front-device front-dragging"/);
  });

  it("clears the selection on a click in empty drawing space or Esc, never while dragging or typing", () => {
    expect(pressOutcome({ uuid: null, x: 10, y: 10 }, { x: 11, y: 12 }, 4)).toEqual({ type: "clear" });
    // Anything that moved at least the drag threshold was a drag: no selection change at all.
    expect(pressOutcome({ uuid: "dev", x: 10, y: 10 }, { x: 14, y: 10 }, 4)).toBeNull();
    expect(pressOutcome({ uuid: null, x: 10, y: 10 }, { x: 10, y: 30 }, 4)).toBeNull();
    // No press recorded (scrollbar, messages, toolbar): nothing happens.
    expect(pressOutcome(null, { x: 10, y: 10 }, 4)).toBeNull();
    const idle = { selectedKind: "device" as SelectableKind, textEntry: false, dragging: false, busy: false, dialogOpen: false };
    expect(designKeyCommand({ key: "Escape" }, idle)).toBe("clear");
    expect(designKeyCommand({ key: "Escape" }, { ...idle, selectedKind: null })).toBeNull();
    expect(designKeyCommand({ key: "Escape" }, { ...idle, dragging: true })).toBeNull();
    expect(designKeyCommand({ key: "Escape" }, { ...idle, textEntry: true })).toBeNull();
    expect(designKeyCommand({ key: "Escape" }, { ...idle, dialogOpen: true })).toBeNull();
    // Esc is renderer state only: "clear" never reaches the project API.
    expect(reduce({ selectedUuid: "dev", hoverUuid: null, hoverSource: null }, { type: "clear" })).toEqual(initialDesignPointer);
  });
});

describe("keyboard: Delete / Backspace", () => {
  const idle = { selectedKind: "device" as SelectableKind, textEntry: false, dragging: false, busy: false, dialogOpen: false };
  it("unplaces a selected Pannello or Apparecchio and asks before removing a Carpenteria", () => {
    for (const key of ["Delete", "Backspace"]) {
      expect(designKeyCommand({ key }, idle)).toBe("unplace");
      expect(designKeyCommand({ key }, { ...idle, selectedKind: "support" })).toBe("unplace");
      expect(designKeyCommand({ key }, { ...idle, selectedKind: "enclosure" })).toBe("remove-root");
    }
  });

  it("does nothing without a selection, while busy, dragging, in a dialog or with a modifier", () => {
    expect(designKeyCommand({ key: "Delete" }, { ...idle, selectedKind: null })).toBeNull();
    expect(designKeyCommand({ key: "Delete" }, { ...idle, busy: true })).toBeNull();
    expect(designKeyCommand({ key: "Delete" }, { ...idle, dragging: true })).toBeNull();
    expect(designKeyCommand({ key: "Delete" }, { ...idle, dialogOpen: true })).toBeNull();
    for (const modifier of ["altKey", "ctrlKey", "metaKey"])
      expect(designKeyCommand({ key: "Backspace", [modifier]: true }, idle)).toBeNull();
    expect(designKeyCommand({ key: "x" }, idle)).toBeNull();
  });

  it("never intercepts Delete/Backspace in a text-entry control", () => {
    const element = (tagName: string, extra: Record<string, unknown> = {}) =>
      ({ tagName, getAttribute: (name: string) => (extra[name] as string | undefined) ?? null, ...extra });
    for (const target of [element("INPUT"), element("input", { type: "search" }), element("INPUT", { type: "number" }),
      element("TEXTAREA"), element("SELECT"), element("DIV", { isContentEditable: true }), element("DIV", { role: "textbox" }),
      element("SPAN", { role: "combobox" })]) {
      expect(isTextEntryTarget(target)).toBe(true);
      for (const key of ["Delete", "Backspace"])
        expect(designKeyCommand({ key }, { ...idle, textEntry: isTextEntryTarget(target) })).toBeNull();
    }
    for (const target of [element("INPUT", { type: "checkbox" }), element("BUTTON"), element("svg"), element("BODY"), null, undefined, "text"])
      expect(isTextEntryTarget(target)).toBe(false);
  });

  it("never drops on a release under the drag threshold: that release is a click", () => {
    // Evidence for why (placement targets overlap the object itself) is in test/project-selection-actions.test.ts.
    const source = readFileSync("src/renderer/project/ProgettazioneScreen.tsx", "utf8");
    const finish = source.slice(source.indexOf("const finish=(event:PointerEvent)=>{"), source.indexOf("const escape=(event:KeyboardEvent)"));
    expect(finish.indexOf("if(!moved){announce(null);return;}")).toBeGreaterThan(0);
    expect(finish.indexOf("if(!moved){announce(null);return;}")).toBeLessThan(finish.indexOf("computeHover("));
    expect(finish.indexOf("computeHover(")).toBeLessThan(finish.indexOf("dropOnTarget("));
  });

  it("routes keys only from the visible Progettazione workspace or an unfocused page", () => {
    const source = readFileSync("src/renderer/project/ProgettazioneScreen.tsx", "utf8");
    expect(source).toMatch(/section\.closest\("\[hidden\]"\)/);
    expect(source).toMatch(/isTextEntryTarget\(target\)/);
    expect(source).toMatch(/dragging:dragRef\.current!==null/);
  });
});

describe("Proprietà", () => {
  it("shows a neutral empty state without a selection", () => {
    const html = properties(null);
    expect(html).toContain("Nessun oggetto selezionato.");
    expect(html).not.toContain("<button");
  });

  it("offers Rimuovi posizione for a placed Apparecchio and an empty Pannello", () => {
    for (const uuid of ["dev", "panel-b"]) {
      const html = properties(uuid);
      expect(html).toMatch(/<button type="button" title="[^"]*"><svg[^>]*>.*?<\/svg>Rimuovi posizione<\/button>/);
      expect(html).not.toContain("Rimuovi carpenteria");
      expect(html).toContain("<kbd>Canc</kbd> rimuove la posizione");
    }
    expect(properties("dev", true)).toMatch(/<button type="button" disabled=""[^>]*>.*?Rimuovi posizione/);
  });

  it("offers Rimuovi posizione for a Pannello holding Apparecchi and says they return to the pool too", () => {
    const selection = describeSelection(project, "panel-a")!;
    expect(unplaceBlockReason(selection)).toBeNull();
    const html = properties("panel-a");
    expect(html).toMatch(/<button type="button" title="Il pannello e i suoi 1 apparecchio tornano[^"]*"><svg[^>]*>.*?<\/svg>Rimuovi posizione<\/button>/);
    expect(html).toContain("Anche l&#x27;apparecchio del pannello torna tra gli elementi da posizionare. <kbd>Canc</kbd> fa lo stesso.");
    expect(html).toMatch(/<dt>Contenuto<\/dt><dd[^>]*>1 apparecchio<\/dd>/);
    expect(unplaceBlockReason(describeSelection(project, "root-a")!)).not.toBeNull();
  });

  it("offers whole-Carpenteria removal, never Rimuovi posizione, for a selected Carpenteria", () => {
    const html = properties("root-a");
    expect(html).toContain("Rimuovi carpenteria…");
    expect(html).not.toContain("Rimuovi posizione");
    expect(html).toMatch(/<dt>Contenuto<\/dt><dd[^>]*>1 pannello · 1 apparecchio<\/dd>/);
    expect(html).toContain("Posizionati 2 di 2");
    expect(html).not.toMatch(/<dt>(Pannello|Zona|Inizio)<\/dt>/);
  });

  it("formats the start of a node in its container's own unit", () => {
    expect(nodeStartText({ zoneNo: 1, startUnits: 6, slotNo: null }, tray)).toBe("3 moduli");
    expect(nodeStartText({ zoneNo: 0, startUnits: 280, slotNo: null }, box)).toBe("280 mm");
    expect(nodeStartText({ zoneNo: 0, startUnits: null, slotNo: 4 }, box)).toBe("slot 4");
    expect(nodeStartText({ zoneNo: null, startUnits: null, slotNo: null }, undefined)).toBeNull();
    expect(positionText({ xMm: 12.5, yMm: 0 })).toBe("12,5 · 0 mm");
    expect(positionText({ xMm: null, yMm: 3 })).toBeNull();
  });

  it("names the selection in the status bar, except while dragging", () => {
    const base = { supportsToPlace: 1, devicesToPlace: 0, zoom: 1 };
    const selected = designStatusSegments({ ...base, selection: { code: "C16-ART", detail: "Apparecchio · 3 moduli" } });
    expect(selected[0]).toEqual({ id: "selection", label: "Selezione:", value: "C16-ART", unit: "· Apparecchio · 3 moduli" });
    const dragging = designStatusSegments({ ...base, selection: { code: "C16-ART", detail: null },
      dragging: { code: "TRAY-ART", occupancy: null } });
    expect(dragging.map(segment => segment.id)).not.toContain("selection");
  });
});

describe("Rimuovi carpenteria confirmation", () => {
  const dialog = (supports: number, devices: number) => renderToStaticMarkup(<RemoveCarpenteriaDialog name="BOX modello"
    supports={supports} devices={devices} busy={false} error={null} onChoose={() => undefined} onCancel={() => undefined} />);
  it("offers exactly two explicit choices and Annulla", () => {
    const html = dialog(1, 1);
    expect(html).toContain('role="dialog" aria-modal="true"');
    expect(html).toContain("contiene 1 pannello e 1 apparecchio");
    const choices = [...html.matchAll(/<button type="button" class="remove-root-choice"[^>]*><strong>([^<]+)<\/strong>/g)].map(match => match[1]);
    expect(choices).toEqual(["Rimuovi la carpenteria, conserva il contenuto", "Rimuovi la carpenteria e il suo contenuto"]);
    expect(html).toContain("tornano tra gli elementi da posizionare");
    expect(html).toContain("sono tolti dal progetto e dal preventivo");
    expect(html).toMatch(/<footer><button type="button">Annulla<\/button><\/footer>/);
  });

  it("asks a single confirmation for an empty Carpenteria, where the two choices would be identical", () => {
    const html = dialog(0, 0);
    expect(html.match(/class="remove-root-choice"/g)).toHaveLength(1);
    expect(html).toContain("è vuota");
    expect(html).toContain("Annulla");
  });

  describe("keyboard", () => {
    const enter = { key: "Enter" };
    const idle = { empty: true, busy: false, onButton: false };

    it("Enter confirms the unambiguous empty-Carpenteria removal when no button has the focus", () => {
      expect(removeRootDialogKey(enter, idle)).toBe("confirm");
    });

    it("leaves Enter to a focused button, so Annulla still cancels and a choice acts only on its own button", () => {
      expect(removeRootDialogKey(enter, { ...idle, onButton: true })).toBeNull();
    });

    it("never lets Enter pick one of two different destructive choices", () => {
      for (const onButton of [false, true]) expect(removeRootDialogKey(enter, { empty: false, busy: false, onButton })).toBeNull();
    });

    it("ignores Enter while busy, with a modifier, and swallows auto-repeat (the key that opened the dialog)", () => {
      expect(removeRootDialogKey(enter, { ...idle, busy: true })).toBeNull();
      for (const modifier of ["ctrlKey", "metaKey", "altKey", "shiftKey"]) expect(removeRootDialogKey({ ...enter, [modifier]: true }, idle)).toBeNull();
      expect(removeRootDialogKey({ ...enter, repeat: true }, idle)).toBe("ignore-repeat");
      expect(removeRootDialogKey({ ...enter, repeat: true }, { empty: false, busy: false, onButton: true })).toBe("ignore-repeat");
    });

    it("Escape cancels in every state except while the removal is running; other keys do nothing", () => {
      for (const empty of [true, false]) {
        expect(removeRootDialogKey({ key: "Escape" }, { empty, busy: false, onButton: true })).toBe("cancel");
        expect(removeRootDialogKey({ key: "Escape" }, { empty, busy: true, onButton: false })).toBeNull();
      }
      for (const key of [" ", "Delete", "Backspace", "Tab", "y", "ArrowDown"]) expect(removeRootDialogKey({ key }, idle), key).toBeNull();
    });

    it("focuses the single confirmation of an empty Carpenteria and keeps Annulla focused when there are contents", () => {
      const source = readFileSync("src/renderer/project/DesignProperties.tsx", "utf8");
      expect(source).toContain("useDialogFocus(dialog, empty ? confirm : cancel)");
      expect(readFileSync("src/renderer/ui/dialog-focus.ts", "utf8"))
        .toContain("installDialogFocus(pane, initialFocus?.current)");
      expect(source).toMatch(/ref=\{confirm\} className="remove-root-choice"/);
      // The dialog-level handler is the only Enter handling, and it is attached to the dialog's own backdrop.
      expect(source.match(/= removeRootDialogKey\(event, /g)).toHaveLength(1);
      // The listener lives only while the dialog is mounted, and Enter is taken only on the dialog or the bare page.
      expect(source).toMatch(/window\.addEventListener\("keydown", keydown, true\);\s*return \(\) => window\.removeEventListener\("keydown", keydown, true\)/);
      expect(source).toMatch(/event\.key === "Enter" && !bare && !inside\) return;/);
      // Confirming still removes the Carpenteria with the unchanged keep-contents semantics of an empty one.
      expect(source).toMatch(/if \(action === "cancel"\) close\(\); else choose\("keep-contents"\);/);
    });

    it("is not a general deletion shortcut: Enter appears nowhere in the Carpenteria shortcut mapping", () => {
      for (const selectedKind of ["enclosure", "support", "device"] as const)
        expect(designKeyCommand({ key: "Enter" }, { selectedKind, textEntry: false, dragging: false, busy: false, dialogOpen: false })).toBeNull();
      const source = readFileSync("src/renderer/project/design-selection.ts", "utf8");
      expect(source).not.toMatch(/"Enter"/);
    });
  });

  it("leaves the dismantling to one backend call", () => {
    const source = readFileSync("src/renderer/project/ProgettazioneScreen.tsx", "utf8");
    expect(source).toMatch(/api\.removePhysicalRoot\(removal\.uuid,contents\)/);
    // The renderer never walks a tree issuing unplace calls: one call per user action.
    expect(source.match(/unplaceNode|unplaceSubtree|submitUnplacement\(|submitSelectionUnplacement\(/g)).toEqual(["submitSelectionUnplacement("]);
    const workflow = readFileSync("src/renderer/project/placement-workflow.ts", "utf8");
    expect(workflow).toMatch(/kind === "support" \? api\.unplaceSubtree\(nodeUuid\) : submitUnplacement\(api, nodeUuid\)/);
  });

  it("states the scope of removing the contents: only the units placed in this Carpenteria", () => {
    const html = dialog(1, 2);
    expect(html).toContain("Solo 1 pannello e 2 apparecchi posizionati in questa carpenteria sono tolti dal progetto e dal preventivo");
    expect(html).toContain("Le altre unità degli stessi articoli, posizionate altrove o ancora da");
    expect(html).toContain("posizionare, restano.");
  });
});

describe("selection overlay geometry under multi-Carpenteria offsets and zoom", () => {
  const viewportPx = { width: 900, height: 600 };
  const clientBox = { left: 40, top: 70, ...viewportPx };
  it("draws the outline 1.5 mm outside the object, in the object's own sector and offset", () => {
    const geometry = combinedFrontGeometry(roots, items, { zoom: 2, focusUuid: "root-b", viewportPx });
    const sectorB = geometry.sectors.find(sector => sector.root.uuid === "root-b")!;
    expect(sectorB.offset.x).toBeGreaterThan(0);
    const html = drawing({ selectedUuid: "panel-b", zoom: 2, focusUuid: "root-b", viewportPx });
    // The overlay is inside root-b's sector group, which carries the display offset transform.
    const sector = html.match(/<g class="front-sector" data-root-uuid="root-b"[^>]*>([\s\S]*?)<\/g><\/svg>/)![0];
    expect(sector).toContain(`transform="translate(${sectorB.offset.x} ${sectorB.offset.y})"`);
    expect(sector).toContain('data-selection-uuid="panel-b"');
    expect(sector).toMatch(new RegExp(`class="front-selection-outline" x="${110 - SELECTION_GAP_MM}" y="${280 - SELECTION_GAP_MM}" width="203" height="103"`));
    expect(html.match(/class="front-selection-handle"/g)).toHaveLength(4);
  });

  it("puts the overlay exactly where hit-testing finds the object, at 100, 150 and 200 %", () => {
    for (const zoom of [1, 1.5, 2]) {
      const geometry = combinedFrontGeometry(roots, items, { zoom, focusUuid: "root-b", viewportPx });
      const sector = geometry.sectors.find(entry => entry.root.uuid === "root-b")!;
      const frame = selectionFrame({ x: 110, y: 280, width: 200, height: 100 }, "TRAY-ART", drawingScale(viewportPx, geometry.viewBox));
      // Centre of the outline, in display coordinates, then on screen.
      const centre = toDisplayPoint(sector, { x: frame.outline.x + frame.outline.width / 2, y: frame.outline.y + frame.outline.height / 2 });
      const [x, y, w, h] = geometry.viewBox;
      const scale = Math.min(clientBox.width / w, clientBox.height / h);
      const client = { x: clientBox.left + (clientBox.width - w * scale) / 2 + (centre.x - x) * scale,
        y: clientBox.top + (clientBox.height - h * scale) / 2 + (centre.y - y) * scale };
      const back = clientToViewBox(client, clientBox, geometry.viewBox)!;
      expect(sectorAt(geometry, back)?.root.uuid).toBe("root-b");
      const persisted = toPersistedPoint(sector, back);
      expect(persisted.x).toBeCloseTo(210, 6);
      expect(persisted.y).toBeCloseTo(330, 6);
    }
  });

  it("keeps the code tag at constant on-screen size at every zoom", () => {
    for (const zoom of [1, 2, 4]) {
      const geometry = combinedFrontGeometry(roots, items, { zoom, viewportPx });
      const scale = drawingScale(viewportPx, geometry.viewBox)!;
      const frame = selectionFrame({ x: 0, y: 0, width: 18, height: 80 }, "C16-ART", scale);
      expect(frame.tag!.fontSize * scale).toBeCloseTo(SELECTION_TAG_PX, 9);
      expect(frame.tag!.y + frame.tag!.height).toBeLessThanOrEqual(frame.outline.y);
      const html = drawing({ selectedUuid: "dev", zoom, viewportPx });
      expect(html).toMatch(/<g class="front-selection-tag"><rect [^>]*><\/rect><text [^>]*font-size="([\d.]+)"[^>]*>C16-ART<\/text>/);
      expect(Number(html.match(/<g class="front-selection-tag">.*?font-size="([\d.]+)"/)![1]) * scale).toBeCloseTo(SELECTION_TAG_PX, 6);
    }
    // Before layout there is no scale: the outline and handles still draw, the tag waits.
    expect(selectionFrame({ x: 0, y: 0, width: 10, height: 10 }, "X", null).tag).toBeNull();
  });

  it("makes every Carpenteria, Pannello and Apparecchio a hover and click target, with pointer-transparent overlays", () => {
    const html = drawing({ onNodeHover: () => undefined, selectedUuid: "dev", hoverUuid: "root-b" });
    for (const uuid of ["root-a", "root-b", "panel-a", "panel-b", "dev"])
      expect(html).toMatch(new RegExp(`<g data-node-uuid="${uuid}"[^>]*>(?:(?!</g>).)*<rect class="front-hit"`));
    const css = readFileSync("src/renderer/styles.css", "utf8");
    expect(css).toMatch(/\.front-drawing \.front-selection \{ pointer-events: none; \}/);
    expect(css).toMatch(/\.front-drawing \.front-hover-outline \{[^}]*pointer-events: none;/);
    expect(css).toMatch(/\.front-selection-outline \{[^}]*stroke: var\(--librequadri-accent\)/);
    expect(css).toMatch(/\.front-hover-outline \{[^}]*stroke: var\(--fq-hover\)/);
    // Green stays the drag-target colour; orange is never used for targets.
    for (const target of ["front-target-parent", "front-target-affected", "front-target-subject"])
      expect(css.match(new RegExp(`\\.${target} \\{[^}]*\\}`))![0]).not.toMatch(/--librequadri-accent/);
  });
});

describe("live-acceptance corrections", () => {
  it("never frames the whole drawing when it has keyboard focus, but keeps it focusable and labelled", () => {
    const css = readFileSync("src/renderer/styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.front-drawing:focus,\s*\.front-drawing:focus-visible \{ outline: none; \}/);
    const focusRules = [...css.matchAll(/([^{}]*\.front-drawing:focus[^{}]*)\{([^{}]*)\}/g)];
    expect(focusRules.length).toBeGreaterThan(0);
    for (const [, , body] of focusRules) expect(body).not.toMatch(/--librequadri-accent|outline:\s*\d/);
    const html = drawing({ focusable: true });
    expect(html).toMatch(/<svg class="front-drawing" role="img" aria-label="Fronte Quadro: 2 carpenterie" id="front-drawing" tabindex="0" aria-keyshortcuts="ArrowLeft ArrowRight"/);
  });

  it("shows nothing of a drag until the pointer has moved past the threshold", () => {
    const source = readFileSync("src/renderer/project/ProgettazioneScreen.tsx", "utf8");
    // Pending-drop continuity is exercised by the mounted interaction regression.
    expect(source).toMatch(/moved:current\.moved\|\|Math\.hypot\(pointer\.x-current\.start\.x,pointer\.y-current\.start\.y\)>=DRAG_THRESHOLD_PX/);
    // Green targets, guidance chip, status guidance, drag-source row and ghost all follow `shown`.
    expect(source).toMatch(/const overlay:FrontOverlay\|null=shown&&shown\.phase==="ready"/);
    expect(source).toMatch(/\{shown \? <div className="front-chip"/);
    expect(source).toContain('shown?dragGuidance');
    expect(source).toMatch(/activeItemUuid=\{shown\?\.subject\.origin==="pool"/);
    expect(source).toMatch(/\{drag&&drag\.moved\?<div className="drag-ghost"/);
    // Target loading still starts at the press (unchanged drag latency).
    expect(source).toMatch(/setDrag\(\{id,subject,start,pointer:start,phase:"loading",loaded:null,hover:null,moved:false\}\);\s*setError\(null\);\s*loadPlacementTargets/);
  });

  it("has no Carpenteria selector in the Fronte Quadro toolbar; focus stays an internal state", () => {
    const html = renderToStaticMarkup(<ProgettazioneScreen project={project} api={{} as ProjectApi} onProjectChange={() => undefined} />);
    const toolbar = html.match(/<header class="front-toolbar">[\s\S]*?<\/header>/)![0];
    expect(toolbar).not.toMatch(/<select|Carpenteria|front-root/);
    expect(html).not.toContain("<select");
    // Both Carpenterie are still drawn, and the Albero fisico still marks the focused one.
    expect([...html.matchAll(/data-root-uuid="([^"]+)"/g)].map(match => match[1])).toEqual(["root-a", "root-b"]);
    expect(html).toMatch(/data-tree-uuid="root-a"[^>]*>(?:(?!<\/div>).)*aria-current="true"/);
    const source = readFileSync("src/renderer/project/ProgettazioneScreen.tsx", "utf8");
    // The focus is still set by the Albero fisico and by adding a Carpenteria, and still feeds Struttura and targets.
    // Drawing/tree focus and its filter context are covered by mounted interaction tests.
    expect(source).toMatch(/onRootCreated=\{uuid=>\{focusRoot\(uuid\);dispatchPointer\(\{type:"select",uuid\}\);\}\}/);
    expect(source).toContain("onFocusRoot={focusRoot}");
    expect(source).toMatch(/loadPlacementTargets\(api,subject,root,roots\)/);
  });
});

describe("Progettazione screen", () => {
  it("renders the empty Proprietà and no selection before the user chooses an object", () => {
    const html = renderToStaticMarkup(<ProgettazioneScreen project={project} api={{} as ProjectApi} onProjectChange={() => undefined} />);
    expect(html).toContain("Nessun oggetto selezionato.");
    expect(html).not.toContain("front-selection");
    expect(html).not.toMatch(/aria-selected="true"/);
    expect(html).not.toContain("remove-root-dialog");
  });
});
