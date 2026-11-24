import type { ProjectApi, ProjectConfiguredItem, ProjectDocumentView, ProjectPhysicalNode,
  ProjectPlacementRect, ProjectPlacementTarget } from "../../shared/project.js";
import { sectorAt, toPersistedPoint, type CombinedFrontGeometry, type FrontSector, type Point } from "./front-geometry.js";
import { supportsInRoot } from "./placement-workflow.js";

/*
 * Drag-and-drop over the backend's exact placement targets. Nothing here decides whether a
 * position is engineering-valid: targets come from `placementTargets`, the mutation to run is
 * the one each target encodes, and the backend validates again when it is applied. The only
 * logic in this module is geometry (pointer to drawing coordinates, eligible target) and
 * routing a chosen target to its API call.
 */
export type DragKind = "support" | "device";
export type { Point };

export interface DragSubject {
  origin: "pool" | "node";
  kind: DragKind;
  item: ProjectConfiguredItem;
  /** Present when an already placed node is being moved. */
  nodeUuid?: string;
  /** The placed node's current container. */
  parentUuid?: string;
}
export interface TargetEntry { parentUuid: string; target: ProjectPlacementTarget; }
export interface LoadedTargets {
  entries: TargetEntry[];
  /** Backend reasons for missing positions, one per distinct message. */
  diagnostics: string[];
  parents: string[];
}

/**
 * Containers to ask the backend about: every visible Carpenteria for a support (pooled or placed)
 * and every Pannello of every Carpenteria for a device. Which of them accept the subject is decided
 * by the backend alone; the focused Carpenteria plays no part.
 */
export function targetParents(subject: DragSubject, focus: ProjectPhysicalNode,
  roots: readonly ProjectPhysicalNode[] = [focus]): string[] {
  if (subject.kind === "support") return roots.map(root => root.uuid);
  return roots.flatMap(root => supportsInRoot(root).map(node => node.uuid));
}

export async function loadPlacementTargets(api: Pick<ProjectApi, "placementTargets">, subject: DragSubject,
  focus: ProjectPhysicalNode, roots: readonly ProjectPhysicalNode[] = [focus]): Promise<LoadedTargets> {
  const parents = targetParents(subject, focus, roots);
  const results = await Promise.all(parents.map(parentUuid => api.placementTargets(
    subject.origin === "node" && subject.nodeUuid
      ? { parentUuid, nodeUuid: subject.nodeUuid, reflow: true } : { parentUuid, itemUuid: subject.item.uuid })));
  const diagnostics: string[] = [];
  for (const result of results) for (const diagnostic of result.diagnostics)
    if (!diagnostics.includes(diagnostic.message)) diagnostics.push(diagnostic.message);
  return { parents, diagnostics,
    entries: results.flatMap((result, index) => result.targets.map(target => ({ parentUuid: parents[index]!, target }))) };
}

function contains(rect: ProjectPlacementRect, point: Point): boolean {
  return point.x >= rect.xMm && point.x <= rect.xMm + rect.widthMm &&
    point.y >= rect.yMm && point.y <= rect.yMm + rect.heightMm;
}

/**
 * Devices require the pointer inside a returned subject rectangle; this prevents a gap or an
 * occupied area from snapping to a distant valid position. If rectangles overlap, use the nearest
 * centre. Supports keep their existing nearest-target behavior inside the parent.
 */
export function pickTarget(entries: readonly TargetEntry[], parentRects: ReadonlyMap<string, ProjectPlacementRect>,
  point: Point, kind: DragKind = "support"): TargetEntry | null {
  let best: TargetEntry | null = null;
  let bestDistance = Infinity;
  for (const entry of entries) {
    const parent = parentRects.get(entry.parentUuid);
    if (!parent || (kind === "support" && !contains(parent, point))) continue;
    const { subject, hitRect } = entry.target;
    const hit = hitRect ?? subject;
    if ((hitRect || kind === "device") && !contains(hit, point)) continue;
    const distance = Math.hypot(point.x - (hit.xMm + hit.widthMm / 2),
      point.y - (hit.yMm + hit.heightMm / 2));
    if (hitRect && !best?.target.hitRect ||
      Boolean(hitRect) === Boolean(best?.target.hitRect) && distance < bestDistance) {
      best = entry; bestDistance = distance;
    }
  }
  return best;
}

/**
 * `pickTarget` over the combined Fronte Quadro. `point` is in display coordinates; it selects the
 * sector under it (none in a gap), converts through that sector's renderer-only offset back to
 * persisted coordinates and picks among that sector's containers only, so a target can never
 * be chosen from another sector. The returned entry is the backend's target, unchanged.
 */
export function pickCombinedTarget(entries: readonly TargetEntry[], geometry: Pick<CombinedFrontGeometry, "sectors">,
  point: Point, kind: DragKind = "support", movingUuid?: string): { entry: TargetEntry; sector: FrontSector } | null {
  const sector = sectorAt(geometry, point);
  if (!sector) return null;
  const persisted = toPersistedPoint(sector, point);
  const occupied = movingUuid && sector.drawable.some(({node,view}) =>
    node.uuid !== movingUuid && node.nodeKind === kind && contains({
      xMm: node.xMm!, yMm: node.yMm!, widthMm: view.widthMm, heightMm: view.heightMm,
    }, persisted));
  const entry = pickTarget(occupied ? entries.filter(({target}) => target.hitRect) : entries,
    sector.parentRects, persisted, kind);
  return entry ? { entry, sector } : null;
}

/** Pointer position in drawing millimetres for an svg drawn with `viewBox` (meet scaling, centred). */
export function clientToViewBox(client: Point, box: { left: number; top: number; width: number; height: number },
  viewBox: readonly [number, number, number, number]): Point | null {
  if (!(box.width > 0) || !(box.height > 0) || !(viewBox[2] > 0) || !(viewBox[3] > 0)) return null;
  const scale = Math.min(box.width / viewBox[2], box.height / viewBox[3]);
  const offsetX = (box.width - viewBox[2] * scale) / 2;
  const offsetY = (box.height - viewBox[3] * scale) / 2;
  if (client.x < box.left + offsetX || client.x > box.left + offsetX + viewBox[2] * scale ||
    client.y < box.top + offsetY || client.y > box.top + offsetY + viewBox[3] * scale) return null;
  return { x: viewBox[0] + (client.x - box.left - offsetX) / scale,
    y: viewBox[1] + (client.y - box.top - offsetY) / scale };
}

type PlacementApi = Pick<ProjectApi, "placeStructuralItem" | "placeChild" | "moveNode" | "movePackedNode">;

/** Runs exactly the mutation the chosen target encodes; the backend validates it again. */
export function dropOnTarget(api: PlacementApi, subject: DragSubject,
  target: ProjectPlacementTarget): Promise<ProjectDocumentView> {
  if (subject.origin === "pool") {
    if (target.action === "placeChild")
      return subject.kind === "support" ? api.placeStructuralItem({ action: "placeChild", input: target.input })
        : api.placeChild(target.input);
    if (target.action === "insertPackedChild" && subject.kind === "support")
      return api.placeStructuralItem({ action: "insertPackedChild", input: target.input, index: target.index });
  } else if (subject.nodeUuid && (target.action === "moveNode" || target.action === "movePackedNode") &&
    target.nodeUuid === subject.nodeUuid) {
    if (target.action === "moveNode") return api.moveNode(target.nodeUuid, target.input);
    if (subject.kind === "support" || target.input.anchorUuid !== undefined)
      return api.movePackedNode(target.nodeUuid, target.input);
  }
  return Promise.reject(new Error("La posizione scelta non è valida per questo oggetto."));
}

const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  required_context_not_provided: "Questo pannello non è compatibile con la carpenteria selezionata.",
  model_unavailable: "Il modello non è più disponibile nel catalogo locale.",
  container_unavailable: "La carpenteria non è più verificabile con il catalogo locale.",
  project_engineering_stale: "Aggiorna i dati di ingegneria del progetto.",
  engineering_data_stale: "I dati di ingegneria sono obsoleti: reimporta il catalogo.",
  design_not_navigable: "Questo modello non è più selezionabile per la progettazione.",
};

/** User-facing text for a refused or stale drop; never a raw backend code. */
export function placementFailureMessage(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']*': (Error: )?/, "");
  const code = raw.match(/: ([a-z]+(?:_[a-z]+)+)\.?$/)?.[1];
  if (code) return REFUSAL_TEXT[code] ?? "La posizione non è più valida: il progetto o il catalogo sono cambiati.";
  return raw || "La posizione non è più valida.";
}

export type DragPhase = "loading" | "ready" | "failed";
export const IDLE_GUIDANCE = "Trascina un pannello sulla carpenteria o un apparecchio su un pannello. " +
  "Trascina un oggetto già posizionato nel Fronte Quadro per spostarlo.";

/** One line of guidance for the drag in progress. */
export function dragGuidance(subject: DragSubject, phase: DragPhase, loaded: LoadedTargets | null,
  hover: TargetEntry | null, rootCount = 1): string {
  if (phase === "loading") return "Verifica delle posizioni disponibili…";
  if (phase === "failed" || !loaded) return "Le posizioni non sono state verificate. Riprova.";
  if (loaded.entries.length === 0) {
    const reason = loaded.diagnostics[0];
    if (loaded.parents.length === 0) return subject.kind === "device"
      ? rootCount > 1 ? "Nessun pannello nel quadro: trascina prima un pannello su una carpenteria."
        : "Nessun pannello in questa carpenteria: trascina prima un pannello sulla carpenteria."
      : "Nessuna carpenteria selezionata.";
    return `Nessuna posizione compatibile.${reason ? ` ${reason}` : ""}`;
  }
  if (hover) return subject.origin === "node" ? "Rilascia per spostare qui." : "Rilascia per posizionare qui.";
  return subject.kind === "support"
    ? "Trascina il pannello sulla carpenteria: le posizioni valide sono evidenziate."
    : "Trascina l'apparecchio su un pannello: le posizioni valide sono evidenziate.";
}

export function dropSuccessMessage(subject: DragSubject): string {
  const what = subject.kind === "support" ? "Pannello" : "Apparecchio";
  return `${what} ${subject.origin === "node" ? "spostato" : "posizionato"}. Salva il progetto per conservare le modifiche.`;
}
