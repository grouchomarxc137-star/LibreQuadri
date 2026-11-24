import type { ProjectConfiguredItem, ProjectFillReport, ProjectPhysicalNode, ProjectPlacementTarget } from "../../shared/project.js";
import type { StatusSegment } from "../app/status.js";
import { previewView } from "./FrontShape.js";
import type { PoolEntry } from "./placement-workflow.js";

/*
 * Text shown by the Progettazione panels and status bar (docs/R17_VISUAL_DESIGN.md §4.3–4.4).
 * Everything here only formats snapshot data already in the project view: it decides nothing
 * about where an item may go.
 */
const decimal = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

/** The primary article code of a configured item. */
export function articleCode(item: ProjectConfiguredItem): string {
  return (item.bom.find(row => row.role === "primary") ?? item.bom[0])?.manufacturerCode ?? "Codice non disponibile";
}

export { frontLabel } from "../../drawing/FrontContent.js";

/** Front occupancy in the capacity's own display unit, e.g. "3 moduli" for six half-modules. */
export function occupancyText(item: ProjectConfiguredItem): string | null {
  const demand = (item.demands ?? []).find(entry => entry.amount > 0 && entry.displayDivisor > 0 && entry.capacityKindLabel);
  return demand ? `${decimal.format(demand.amount / demand.displayDivisor)} ${demand.capacityKindLabel}` : null;
}

/** Snapshotted size of one view, e.g. "600 × 300 mm". */
export function viewSizeText(view: Pick<ProjectConfiguredItem["views"][number], "widthMm" | "heightMm"> | undefined): string | null {
  return view && view.widthMm > 0 && view.heightMm > 0 ? `${decimal.format(view.widthMm)} × ${decimal.format(view.heightMm)} mm` : null;
}

/** Snapshotted front size, e.g. "600 × 300 mm". */
export function frontSizeText(item: ProjectConfiguredItem): string | null {
  return viewSizeText(previewView(item));
}

export function availabilityText(available: number, quantity?: number): string {
  const count = `${available} ${available === 1 ? "disponibile" : "disponibili"}`;
  return quantity === undefined ? count : `${count} su ${quantity}`;
}

/** Status line after "Falsi poli DIN": what was inserted and what was left alone, in plain words. */
export function fillReportMessage(report: ProjectFillReport | undefined): string {
  if (!report) return "Falsi poli non inseriti.";
  const skipped = new Set(report.skipped.filter(row => row.code !== "gap_not_representable").map(row => row.supportUuid)).size;
  const gaps = report.skipped.filter(row => row.code === "gap_not_representable").length;
  const parts = [report.inserted
    ? `Inseriti ${countText(report.inserted, "falso polo", "falsi poli")} DIN in ${countText(report.supports, "pannello", "pannelli")}.`
    : report.examined ? "Nessuno spazio DIN libero da riempire." : "Nessun pannello DIN posizionato."];
  if (skipped) parts.push(`${countText(skipped, "pannello non compatibile", "pannelli non compatibili")} con i falsi poli.`);
  if (gaps) parts.push(`${countText(gaps, "spazio non riempibile", "spazi non riempibili")} esattamente.`);
  return parts.join(" ");
}

export function countText(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Units still to place: the sum of Q − P over the pool entries. */
export function unitsToPlace(entries: readonly PoolEntry[]): number {
  return entries.reduce((total, entry) => total + entry.available, 0);
}

/**
 * Where a target starts inside its container, in the zone's display unit ("inizio 3 moduli").
 * Only targets that carry an explicit start have one; ordered (packed) targets do not.
 */
export function targetStartText(target: ProjectPlacementTarget, container: ProjectConfiguredItem | undefined): string | null {
  const input: { zoneNo?: number; startUnits?: number } = target.input;
  if (input.startUnits === undefined || input.zoneNo === undefined) return null;
  const zone = container?.zones.find(entry => entry.zoneNo === input.zoneNo);
  if (!zone?.capacityKindLabel || !zone.displayDivisor || zone.displayDivisor <= 0) return null;
  return `inizio ${decimal.format(input.startUnits / zone.displayDivisor)} ${zone.capacityKindLabel}`;
}

/**
 * Where a placed node starts inside its container, from its snapshotted position: the zone's
 * display unit on a linear zone ("3 moduli"), millimetres on a stack zone, the slot number on
 * a slot zone. Null for a root.
 */
export function nodeStartText(node: Pick<ProjectPhysicalNode, "zoneNo" | "startUnits" | "slotNo">,
  container: ProjectConfiguredItem | undefined): string | null {
  if (node.slotNo !== null) return `slot ${node.slotNo}`;
  if (node.startUnits === null) return null;
  const zone = container?.zones.find(entry => entry.zoneNo === node.zoneNo);
  if (zone?.layout === "linear" && zone.capacityKindLabel && zone.displayDivisor && zone.displayDivisor > 0)
    return `${decimal.format(node.startUnits / zone.displayDivisor)} ${zone.capacityKindLabel}`;
  if (zone?.layout === "stack") return `${decimal.format(node.startUnits)} mm`;
  return decimal.format(node.startUnits);
}

/** A node's drawing position, e.g. "120 · 40 mm"; null when the snapshot cannot establish it. */
export function positionText(node: Pick<ProjectPhysicalNode, "xMm" | "yMm">): string | null {
  return node.xMm === null || node.yMm === null ? null : `${decimal.format(node.xMm)} · ${decimal.format(node.yMm)} mm`;
}

/** Placed nodes of one kind below the given roots. */
export function countPlaced(nodes: readonly ProjectPhysicalNode[], kind: ProjectPhysicalNode["nodeKind"]): number {
  return nodes.reduce((total, node) => total + (node.nodeKind === kind ? 1 : 0) + countPlaced(node.children, kind), 0);
}

export interface DesignStatus {
  supportsToPlace: number;
  devicesToPlace: number;
  zoom: number;
  /** The item being dragged: article code and occupancy. */
  dragging?: { code: string; occupancy: string | null } | null;
  /** The container under the pointer and, when known, where the item would start. */
  destination?: { name: string; start: string | null } | null;
  /** The persistently selected object: article code and where it is. Hidden while dragging. */
  selection?: { code: string; detail: string | null } | null;
}

/** Progettazione context for the status bar: selection, or drag subject and destination while dragging; pool counts, zoom. */
export function designStatusSegments(status: DesignStatus): StatusSegment[] {
  const segments: StatusSegment[] = [];
  if (status.selection && !status.dragging) segments.push({ id: "selection", label: "Selezione:", value: status.selection.code,
    ...(status.selection.detail ? { unit: `· ${status.selection.detail}` } : {}) });
  if (status.dragging) segments.push({ id: "drag", label: "Trascinamento:", value: status.dragging.code,
    ...(status.dragging.occupancy ? { unit: `· ${status.dragging.occupancy}` } : {}) });
  if (status.destination) segments.push({ id: "destination", label: "Destinazione:", value: status.destination.name,
    ...(status.destination.start ? { unit: `· ${status.destination.start}` } : {}) });
  segments.push(
    { id: "pool-supports", label: "Da posizionare:", value: String(status.supportsToPlace),
      unit: status.supportsToPlace === 1 ? "pannello" : "pannelli" },
    { id: "pool-devices", value: String(status.devicesToPlace), unit: status.devicesToPlace === 1 ? "apparecchio" : "apparecchi" },
    { id: "zoom", label: "Zoom", value: `${Math.round(status.zoom * 100)}%` });
  return segments;
}
