import type { ConfigurationRequest } from "../../shared/configuration.js";
import { STRUCTURAL_ADD_QUANTITY_MAX, STRUCTURAL_ADD_QUANTITY_MIN } from "../../shared/project.js";
import type { AddStructuralRequest, ProjectApi, ProjectDocumentView, ProjectPhysicalNode, StructuralDesignKind, StructuralNavigation } from "../../shared/project.js";
import type { HierarchyBranch } from "./HierarchyTree.js";
import { supportsInRoot } from "./placement-workflow.js";

export type StructuralKind = StructuralDesignKind;

/**
 * The placed Pannello whose compatible Apparecchi are offered: the selected Pannello, the Pannello
 * holding the selected Apparecchio, else the first Pannello of the focused Carpenteria. Which
 * Apparecchi fit it is decided by the backend, never here.
 */
export function structuralDevicePanel(selection: { kind: string; node: ProjectPhysicalNode; parent?: ProjectPhysicalNode } | null,
  root: ProjectPhysicalNode | undefined): ProjectPhysicalNode | undefined {
  if (selection?.kind === "support") return selection.node;
  if (selection?.kind === "device" && selection.parent?.nodeKind === "support") return selection.parent;
  return supportsInRoot(root)[0];
}

/** What the navigation currently shows. `loaded` remembers which request produced it. */
export type StructuralNavigationState =
  | { phase: "no_root" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "loaded"; kind: StructuralKind; parentUuid: string | undefined; navigation: StructuralNavigation };

/**
 * Loads the backend hierarchy for one request. Only the newest request may publish, so a
 * slow answer for a previous kind or enclosure never replaces the current one. Supports
 * are never requested without an enclosure: there is no unfiltered fallback.
 */
export class StructuralNavigationSession {
  private generation = 0;
  constructor(private readonly api: Pick<ProjectApi, "designNavigation">,
    private readonly changed: (state: StructuralNavigationState) => void) {}

  load(kind: StructuralKind, parentUuid: string | undefined): void {
    const generation = ++this.generation;
    if (kind !== "enclosure" && !parentUuid) { this.changed({ phase: "no_root" }); return; }
    this.changed({ phase: "loading" });
    this.api.designNavigation(kind, parentUuid).then(navigation => {
      if (generation === this.generation) this.changed({ phase: "loaded", kind, parentUuid, navigation });
    }, (caught: unknown) => {
      if (generation === this.generation)
        this.changed({ phase: "error", message: caught instanceof Error ? caught.message : String(caught) });
    });
  }

  dispose(): void { this.generation++; }
}

/** The state that is valid for the request on screen; anything older is treated as still loading. */
export function currentNavigation(state: StructuralNavigationState, kind: StructuralKind,
  parentUuid: string | undefined): StructuralNavigationState {
  if (kind !== "enclosure" && !parentUuid) return { phase: "no_root" };
  if (state.phase === "loaded" && (state.kind !== kind || state.parentUuid !== parentUuid))
    return { phase: "loading" };
  return state.phase === "no_root" ? { phase: "loading" } : state;
}

/** Adapts the backend hierarchy to the generic tree, keeping the backend's node and model order. */
export function buildNavigationTree(navigation: StructuralNavigation): HierarchyBranch[] {
  const models = new Map(navigation.candidates.map(model => [model.id, model]));
  const branches = new Map<number, HierarchyBranch>();
  const roots: HierarchyBranch[] = [];
  for (const node of navigation.nodes) {
    const branch: HierarchyBranch = { key: node.id, label: node.name, children: [],
      leaves: node.modelIds.flatMap(id => {
        const model = models.get(id);
        return model ? [{ key: model.id, label: model.name, detail: `${model.brandMarchio} / ${model.code}` }] : [];
      }) };
    branches.set(node.id, branch);
    if (node.parentId === null) roots.push(branch);
    else branches.get(node.parentId)?.children.push(branch);
  }
  return roots;
}

/** A selection survives only while the loaded hierarchy for the current request still offers it. */
export function eligibleModelId(state: StructuralNavigationState, kind: StructuralKind,
  parentUuid: string | undefined, modelId: number | null): number | null {
  const current = currentNavigation(state, kind, parentUuid);
  if (modelId === null || current.phase !== "loaded" || current.navigation.status !== "ready") return null;
  return current.navigation.nodes.some(node => node.modelIds.includes(modelId)) &&
    current.navigation.candidates.some(model => model.id === modelId) ? modelId : null;
}

export interface NavigationNotice { tone: "status" | "alert"; text: string; retry?: boolean; }

/** Explicit wording for every state in which no hierarchy can be offered. */
export function navigationNotice(state: StructuralNavigationState, kind: StructuralKind): NavigationNotice | null {
  switch (state.phase) {
    case "no_root": return { tone: "status", text: kind === "device"
      ? "Posiziona prima un pannello: gli apparecchi si scelgono in base al pannello selezionato."
      : "Seleziona prima una carpenteria: i pannelli si scelgono in base alla carpenteria selezionata." };
    case "loading": return { tone: "status", text: "Caricamento della navigazione strutturale…" };
    case "error": return { tone: "alert", text: `Navigazione strutturale non disponibile: ${state.message}`, retry: true };
    case "loaded": {
      const { status, candidates } = state.navigation;
      if (status === "project_engineering_stale") return {tone:"alert",text:"Aggiorna i dati di ingegneria del progetto."};
      if (status === "engineering_data_stale")
        return { tone: "alert", text: "I dati di ingegneria sono obsoleti. Reimporta il catalogo prima di scegliere una struttura." };
      if (status === "container_unavailable") return { tone: "alert", text: kind === "device"
        ? "Il pannello o la carpenteria selezionati non sono disponibili nel catalogo locale o sono cambiati: gli apparecchi non possono essere verificati."
        : kind === "support"
        ? "Il modello locale della carpenteria selezionata non è disponibile o è cambiato: i pannelli non possono essere verificati."
        : "Le carpenterie non possono essere verificate con i dati locali." };
      return candidates.length === 0 ? { tone: "status", text: kind === "device"
        ? "Nessun apparecchio compatibile con il pannello selezionato."
        : kind === "support"
        ? "Nessun pannello compatibile con la carpenteria selezionata."
        : "Nessuna carpenteria disponibile." } : null;
    }
  }
}

/** Models whose context could not be verified are withheld; say so instead of hiding them silently. */
export function contextUnavailableCount(state: StructuralNavigationState): number {
  return state.phase === "loaded" && state.navigation.status === "ready" ? state.navigation.contextDataUnavailable : 0;
}

/**
 * Pannelli and Apparecchi are added to the project unplaced; only Carpenterie keep their immediate placement.
 * A Pannello may carry the quantity chosen next to Aggiungi: it travels as the ordinary configured-item
 * quantity of that one add, never as separate physical Pannelli.
 */
export function structuralAddRequest(kind: StructuralKind, configuration: ConfigurationRequest,
  parentUuid: string | undefined, quantity?: number): AddStructuralRequest {
  if (kind === "enclosure") return { configuration, kind };
  return { configuration, kind, parentUuid, place: false, ...(kind === "support" && quantity !== undefined ? { quantity } : {}) };
}

/** The quantity field of a Pannello add: a whole number from 1 to 99, nothing else; null while the text is not one. */
export function parsePannelloQuantity(text: string): number | null {
  if (!/^[0-9]{1,2}$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= STRUCTURAL_ADD_QUANTITY_MIN && value <= STRUCTURAL_ADD_QUANTITY_MAX ? value : null;
}

export function structuralAddLabel(kind: StructuralKind): string {
  return kind === "enclosure" ? "Aggiungi e posiziona carpenteria" : "Aggiungi";
}

export async function submitStructuralAdd(api: Pick<ProjectApi, "addStructural">, project: ProjectDocumentView,
  kind: StructuralKind, configuration: ConfigurationRequest, parentUuid: string | undefined, quantity?: number,
  referenceDevice?:import("../../shared/project.js").ReferenceDevice, autoPlace = false): Promise<{
    project: ProjectDocumentView; createdRootUuid?: string; message: string;
  }> {
  if (kind !== "enclosure" && !parentUuid)
    throw new Error(kind === "device" ? "Seleziona prima un pannello." : "Seleziona prima una carpenteria.");
  const updated = await api.addStructural({...structuralAddRequest(kind, configuration, parentUuid, quantity),
    ...(referenceDevice?{referenceDevice}:{}), ...(autoPlace&&kind!=="enclosure"?{autoPlace:true}:{})});
  if (kind === "device") return { project: updated,
    message: "Apparecchio aggiunto al progetto, non ancora posizionato: trascinalo da Da posizionare." };
  if (kind === "support") return { project: updated, message: quantity !== undefined && quantity > 1
    ? `${quantity} pannelli aggiunti al progetto, non ancora posizionati.` : "Pannello aggiunto al progetto, non ancora posizionato." };
  const created = updated.physicalNodes.find(node => !project.physicalNodes.some(old => old.uuid === node.uuid));
  return { project: updated, ...(created ? { createdRootUuid: created.uuid } : {}),
    message: "Carpenteria aggiunta e posizionata." };
}
