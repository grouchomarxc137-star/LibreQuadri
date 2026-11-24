import type { ProjectConfiguredItem, ProjectDocumentView, ProjectPhysicalNode } from "../../shared/project.js";
import { flatten } from "./front-geometry.js";

/*
 * Progettazione selection (docs/R17_VISUAL_DESIGN.md §3.5, §4.5). Renderer state only: one
 * persistent selection shared by the Fronte Quadro, Albero fisico and Proprietà, and one
 * transient hover. Neither is the Carpenteria focus (R-17b.1), which only decides structural
 * discovery, Pannello placement context and zoom centring. Nothing here reaches the backend.
 */
export type SelectableKind = "enclosure" | "support" | "device";

export interface DesignPointerState {
  /** Persistent selection: the node UUID shown orange everywhere. */
  readonly selectedUuid: string | null;
  /** Transient neutral pre-highlight; never replaces the selection. */
  readonly hoverUuid: string | null;
  /** Where the pointer is: the other view is the one that shows the pre-highlight. */
  readonly hoverSource: HoverSource | null;
}
export type HoverSource = "tree" | "canvas";

export type DesignSelectionAction =
  | { readonly type: "select"; readonly uuid: string }
  | { readonly type: "clear" }
  | { readonly type: "hover"; readonly uuid: string | null; readonly source: HoverSource }
  /** Forget UUIDs that are no longer in the project (unplaced, removed, another project). */
  | { readonly type: "prune"; readonly present: ReadonlySet<string> };

export const initialDesignPointer: DesignPointerState = { selectedUuid: null, hoverUuid: null, hoverSource: null };

/** Unchanged input returns the same state. Hover and selection change independently. */
export function designSelectionReducer(state: DesignPointerState, action: DesignSelectionAction): DesignPointerState {
  switch (action.type) {
    case "select": return state.selectedUuid === action.uuid ? state : { ...state, selectedUuid: action.uuid };
    case "clear": return state.selectedUuid === null ? state : { ...state, selectedUuid: null };
    case "hover": {
      const hoverSource = action.uuid === null ? null : action.source;
      return state.hoverUuid === action.uuid && state.hoverSource === hoverSource ? state
        : { ...state, hoverUuid: action.uuid, hoverSource };
    }
    case "prune": {
      const selectedUuid = state.selectedUuid !== null && action.present.has(state.selectedUuid) ? state.selectedUuid : null;
      const hoverUuid = state.hoverUuid !== null && action.present.has(state.hoverUuid) ? state.hoverUuid : null;
      return selectedUuid === state.selectedUuid && hoverUuid === state.hoverUuid ? state
        : { selectedUuid, hoverUuid, hoverSource: hoverUuid === null ? null : state.hoverSource };
    }
  }
}

/**
 * Which view shows the transient pre-highlight. Hover only identifies an object across the two
 * views: a hovered Albero fisico row is outlined in the drawing, and an object under the pointer in
 * the drawing lights up its row. Nothing is pre-highlighted where the pointer already is, and
 * nothing while a press or drag is in progress (only the selection and the green drag feedback show).
 */
export function hoverHighlights(state: DesignPointerState, pressActive: boolean): { canvas: string | null; tree: string | null } {
  if (pressActive || state.hoverUuid === null) return { canvas: null, tree: null };
  return { canvas: state.hoverSource === "tree" ? state.hoverUuid : null,
    tree: state.hoverSource === "canvas" ? state.hoverUuid : null };
}

export function isSelectable(node: Pick<ProjectPhysicalNode, "nodeKind">): node is { nodeKind: SelectableKind } {
  return node.nodeKind === "enclosure" || node.nodeKind === "support" || node.nodeKind === "device";
}

/** UUIDs of every selectable node below the roots. */
export function selectableUuids(roots: readonly ProjectPhysicalNode[]): Set<string> {
  return new Set(flatten(roots).filter(isSelectable).map(node => node.uuid));
}

/** Nodes above `uuid` (nearest first), so an outliner can open the rows that hide it. */
export function ancestorUuids(roots: readonly ProjectPhysicalNode[], uuid: string): string[] {
  const path: string[] = [];
  const walk = (node: ProjectPhysicalNode): boolean => {
    if (node.uuid === uuid) return true;
    for (const child of node.children) if (walk(child)) { path.push(node.uuid); return true; }
    return false;
  };
  for (const root of roots) if (walk(root)) break;
  return path;
}

/** Everything Proprietà shows for the selected node, read from the loaded project view only. */
export interface SelectedObject {
  readonly node: ProjectPhysicalNode;
  readonly kind: SelectableKind;
  readonly item: ProjectConfiguredItem | undefined;
  readonly view: ProjectConfiguredItem["views"][number] | undefined;
  /** The Carpenteria holding the node (the node itself for a Carpenteria). */
  readonly root: ProjectPhysicalNode;
  readonly rootItem: ProjectConfiguredItem | undefined;
  /** The direct container, absent for a Carpenteria. */
  readonly parent: ProjectPhysicalNode | undefined;
  readonly parentItem: ProjectConfiguredItem | undefined;
  /** Quotation quantity Q and placed units P of the node's configured item. */
  readonly quantity: number;
  readonly placed: number;
  /** Pannelli and Apparecchi below the node. */
  readonly supports: number;
  readonly devices: number;
}

export function describeSelection(project: ProjectDocumentView | null, uuid: string | null): SelectedObject | null {
  if (!project || uuid === null) return null;
  const byUuid = new Map<string, { node: ProjectPhysicalNode; root: ProjectPhysicalNode }>();
  for (const root of project.physicalNodes) for (const node of flatten([root])) byUuid.set(node.uuid, { node, root });
  const found = byUuid.get(uuid);
  if (!found || !isSelectable(found.node)) return null;
  const { node, root } = found;
  const items = new Map(project.configuredItems.map(item => [item.uuid, item]));
  const itemOf = (entry: ProjectPhysicalNode | undefined) => entry?.itemUuid ? items.get(entry.itemUuid) : undefined;
  const item = itemOf(node);
  const parent = node.parentUuid ? byUuid.get(node.parentUuid)?.node : undefined;
  const below = flatten(node.children);
  const placed = node.itemUuid ? flatten(project.physicalNodes).filter(entry => entry.itemUuid === node.itemUuid).length : 0;
  return {
    node, kind: node.nodeKind as SelectableKind, item,
    view: item?.views.find(entry => entry.viewCode === node.viewCode),
    root, rootItem: itemOf(root), parent, parentItem: itemOf(parent),
    quantity: project.lines.find(line => line.itemUuid === node.itemUuid)?.quantity ?? 0, placed,
    supports: below.filter(entry => entry.nodeKind === "support").length,
    devices: below.filter(entry => entry.nodeKind === "device").length,
  };
}

/**
 * Why "Rimuovi posizione" is not available for the selection, or null when it is. A Pannello is
 * unplaced with everything placed in it; a Carpenteria is removed as a whole with an explicit
 * choice instead.
 */
export function unplaceBlockReason(selection: Pick<SelectedObject, "kind">): string | null {
  return selection.kind === "enclosure" ? "Una carpenteria si rimuove con «Rimuovi carpenteria…»." : null;
}

const NON_TEXT_INPUTS = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);
const TEXT_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);

/** True for an element where Delete/Backspace edits text or a choice: never intercept keys there. */
export function isTextEntryTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown;
    getAttribute?: (name: string) => string | null };
  const tag = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has(String(element.type ?? "text").toLowerCase());
  if (element.isContentEditable === true) return true;
  const role = typeof element.getAttribute === "function" ? element.getAttribute("role") : null;
  return role !== null && TEXT_ROLES.has(role);
}

export type DesignKeyCommand = "clear" | "unplace" | "remove-root";

/**
 * The Progettazione keyboard command for a key press, or null to leave the key alone. Esc
 * clears the selection (never the project); Delete/Backspace unplaces a selected Pannello or
 * Apparecchio, or asks how to remove a selected Carpenteria. Nothing happens while dragging
 * (Esc then cancels the drag), in a dialog, in a text-entry control, or with a modifier.
 */
export function designKeyCommand(event: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
  context: { selectedKind: SelectableKind | null; textEntry: boolean; dragging: boolean; busy: boolean; dialogOpen: boolean }):
  DesignKeyCommand | null {
  if (context.dragging || context.dialogOpen || context.textEntry || context.selectedKind === null) return null;
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "Escape") return "clear";
  if (event.key !== "Delete" && event.key !== "Backspace") return null;
  if (context.busy) return null;
  return context.selectedKind === "enclosure" ? "remove-root" : "unplace";
}

/** A pointer press on the Fronte Quadro: on a node (its UUID) or on empty drawing space (null). */
export interface CanvasPress { readonly uuid: string | null; readonly x: number; readonly y: number; }

/**
 * What releasing a press does: a click (movement under the drag threshold) selects the pressed
 * node or, on empty space, clears the selection; anything longer was a drag and selects nothing.
 */
export function pressOutcome(press: CanvasPress | null, release: { x: number; y: number }, thresholdPx: number):
  DesignSelectionAction | null {
  if (!press || Math.hypot(release.x - press.x, release.y - press.y) >= thresholdPx) return null;
  return press.uuid === null ? { type: "clear" } : { type: "select", uuid: press.uuid };
}
