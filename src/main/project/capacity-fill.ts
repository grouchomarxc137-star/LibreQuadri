import type Database from "better-sqlite3";

import { readPhysicalNodes, type ProjectPhysicalNode } from "./physical-placement.js";

/**
 * Automatic capacity fill, catalogue-free part: where the free capacity of placed Pannelli is and how
 * to close each free run exactly with the filler widths the catalogue offers. Everything here works
 * on the project snapshot and on plain numbers; no product is named.
 */

export interface FreeRun { readonly start: number; readonly length: number; }
export interface FillPiece { readonly start: number; readonly amount: number; }

/** The unoccupied stretches of [0, capacity), in order. Occupied ranges may touch or overlap. */
export function freeRuns(capacity: number, occupied: readonly { start: number; end: number }[]): FreeRun[] {
  const runs: FreeRun[] = [];
  let cursor = 0;
  for (const range of [...occupied].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const start = Math.max(0, Math.min(range.start, capacity));
    if (start > cursor) runs.push({ start: cursor, length: start - cursor });
    cursor = Math.max(cursor, Math.min(range.end, capacity));
  }
  if (cursor < capacity) runs.push({ start: cursor, length: capacity - cursor });
  return runs;
}

/**
 * Splits `length` into the fewest pieces of the given widths that add up to it exactly, largest piece
 * first; null when no exact combination exists. Deterministic for the same input.
 */
export function decompose(length: number, widths: readonly number[]): number[] | null {
  const sizes = [...new Set(widths.filter(width => Number.isSafeInteger(width) && width > 0))].sort((a, b) => b - a);
  if (!Number.isSafeInteger(length) || length <= 0 || !sizes.length) return length === 0 ? [] : null;
  const best = new Array<number>(length + 1).fill(Infinity);
  best[0] = 0;
  for (let total = 1; total <= length; total++)
    for (const size of sizes) if (size <= total && best[total - size]! + 1 < best[total]!) best[total] = best[total - size]! + 1;
  if (!Number.isFinite(best[length]!)) return null;
  const pieces: number[] = [];
  for (let remaining = length; remaining > 0;) {
    const size = sizes.find(candidate => candidate <= remaining && best[remaining - candidate] === best[remaining]! - 1)!;
    pieces.push(size);
    remaining -= size;
  }
  return pieces;
}

/** Consecutive pieces closing one free run, left to right; null when the run cannot be closed exactly. */
export function planRun(run: FreeRun, widths: readonly number[]): FillPiece[] | null {
  const sizes = decompose(run.length, widths);
  if (!sizes) return null;
  let start = run.start;
  return sizes.map(amount => { const piece = { start, amount }; start += amount; return piece; });
}

/** One linear zone of a placed Pannello with capacity of the requested kind, and what occupies it. */
export interface FillZone {
  readonly supportUuid: string;
  readonly supportItemId: number;
  readonly rootItemId: number | null;
  readonly zoneNo: number;
  readonly capacity: number;
  readonly requiredViewCode: string | null;
  readonly occupied: readonly { start: number; end: number }[];
  /** Why the zone cannot be filled from the snapshot alone; null when it can. */
  readonly issue: { code: string; message: string } | null;
}

/** Every linear zone of the capacity kind on a placed Pannello (a support with a parent), in tree order. */
export function surveyFillZones(db: Database.Database, capacityKind: string): FillZone[] {
  const flat: { node: ProjectPhysicalNode; root: ProjectPhysicalNode }[] = [];
  const walk = (node: ProjectPhysicalNode, root: ProjectPhysicalNode) => {
    flat.push({ node, root });
    for (const child of node.children) walk(child, root);
  };
  for (const root of readPhysicalNodes(db)) walk(root, root);
  const nodeRow = db.prepare("SELECT id,item_id AS itemId FROM prj_node WHERE uuid=?");
  const zonesOf = db.prepare(`SELECT zone_no AS zoneNo,layout,capacity_amount AS capacity,
    required_view_code AS requiredViewCode FROM prj_item_zone WHERE item_id=? AND capacity_kind_code=? ORDER BY zone_no`);
  const children = db.prepare(`SELECT n.start_units AS start,d.amount FROM prj_node n
    LEFT JOIN prj_item_demand d ON d.item_id=n.item_id AND d.capacity_kind_code=?
    WHERE n.parent_id=? AND n.zone_no=?`);
  const zones: FillZone[] = [];
  for (const { node, root } of flat) {
    if (node.nodeKind !== "support" || node.parentUuid === null) continue;
    const support = nodeRow.get(node.uuid) as { id: number; itemId: number };
    const rootItemId = root.uuid === node.uuid ? null : (nodeRow.get(root.uuid) as { itemId: number } | undefined)?.itemId ?? null;
    for (const zone of zonesOf.all(support.itemId, capacityKind) as
      { zoneNo: number; layout: string; capacity: number | null; requiredViewCode: string | null }[]) {
      const base = { supportUuid: node.uuid, supportItemId: support.itemId, rootItemId, zoneNo: zone.zoneNo,
        capacity: zone.capacity ?? 0, requiredViewCode: zone.requiredViewCode };
      const occupants = children.all(capacityKind, support.id, zone.zoneNo) as { start: number | null; amount: number | null }[];
      let issue: FillZone["issue"] = null;
      if (zone.layout !== "linear" || !Number.isSafeInteger(zone.capacity) || (zone.capacity ?? 0) <= 0)
        issue = { code: "invalid_zone", message: "La zona non ha una capacità lineare verificabile." };
      else if (node.positionIssue)
        issue = { code: "support_position_unavailable", message: `La posizione del pannello non è calcolabile: ${node.positionIssue}` };
      else if (occupants.some(row => !Number.isSafeInteger(row.start) || !Number.isSafeInteger(row.amount) || (row.amount ?? 0) <= 0))
        issue = { code: "sibling_position_unknown", message: "L'ingombro di un articolo nella zona non è verificabile." };
      zones.push({ ...base, issue,
        occupied: issue ? [] : occupants.map(row => ({ start: row.start!, end: row.start! + row.amount! })) });
    }
  }
  return zones;
}
