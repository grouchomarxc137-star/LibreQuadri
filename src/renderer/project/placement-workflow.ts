import type { ProjectApi, ProjectConfiguredItem, ProjectDocumentView, ProjectPhysicalNode, ProjectPlacementInput } from "../../shared/project.js";

type Zone = ProjectConfiguredItem["zones"][number];
type View = ProjectConfiguredItem["views"][number];

export interface PoolEntry {
  item: ProjectConfiguredItem; quantity: number; placed: number; available: number;
}
export type DevicePoolEntry = PoolEntry;
export type StructuralPoolEntry = PoolEntry;

/** Configured items of one physical model kind with quotation quantity Q, placed nodes P and available Q−P. */
function physicalPool(project:ProjectDocumentView,modelKind:string):PoolEntry[] {
  const counts=new Map<string,number>();
  const visit=(nodes:readonly ProjectPhysicalNode[]):void=>{
    for(const node of nodes){
      if(node.itemUuid)counts.set(node.itemUuid,(counts.get(node.itemUuid)??0)+1);
      visit(node.children);
    }
  };
  visit(project.physicalNodes);
  return project.configuredItems.filter(item=>item.modelKind===modelKind).map(item=>{
    const quantity=project.lines.find(line=>line.itemUuid===item.uuid)?.quantity??0;
    const placed=counts.get(item.uuid)??0;
    return {item,quantity,placed,available:Math.max(0,quantity-placed)};
  });
}

export function devicePool(project:ProjectDocumentView):DevicePoolEntry[] {
  return physicalPool(project,"device");
}

/** Supports (panels) configured in the project, placed or not; the pool of units still to place is `available`. */
export function structuralPool(project:ProjectDocumentView):StructuralPoolEntry[] {
  return physicalPool(project,"support");
}

export function supportsInRoot(root:ProjectPhysicalNode|undefined):ProjectPhysicalNode[] {
  if(!root)return [];
  const supports:ProjectPhysicalNode[]=[];
  const visit=(node:ProjectPhysicalNode):void=>{
    if(node.nodeKind==="support")supports.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return supports;
}

/** A node below the given roots together with the Carpenteria that holds it. */
export function locateNode(roots:readonly ProjectPhysicalNode[],uuid:string):{node:ProjectPhysicalNode;root:ProjectPhysicalNode}|undefined {
  const find=(node:ProjectPhysicalNode):ProjectPhysicalNode|undefined=>
    node.uuid===uuid?node:node.children.map(find).find(Boolean);
  for(const root of roots){const node=find(root);if(node)return {node,root};}
  return undefined;
}

export function defaultPlacementView(views: readonly View[], zone: Zone | undefined, selected: string): string {
  if (views.some(view => view.viewCode === selected)) return selected;
  return views.find(view => view.viewCode === zone?.requiredViewCode)?.viewCode ?? views[0]?.viewCode ?? "";
}

export function positionStep(zone: Zone): number | "any" {
  if (zone.layout === "linear") return zone.displayDivisor !== null && zone.displayDivisor > 0
    ? 1 / zone.displayDivisor : "any";
  if (zone.layout === "stack") return zone.pitchMm !== null && zone.pitchMm > 0 ? zone.pitchMm : "any";
  return "any";
}

export function availableSlotNumbers(item: ProjectConfiguredItem, zoneNo: number,
  parent: ProjectPhysicalNode): number[] {
  const occupied = new Set(parent.children.filter(node => node.zoneNo === zoneNo).map(node => node.slotNo));
  return item.slots.filter(slot => slot.zoneNo === zoneNo && !occupied.has(slot.slotNo))
    .map(slot => slot.slotNo);
}

export function placementInputForSelection(selection: {
  itemUuid: string; modelKind: string; viewCode: string;
  rootXMm?: number; rootYMm?: number; parentUuid?: string; zone?: Zone;
  position?: number; slotNo?: number;
}): ProjectPlacementInput | null {
  const { itemUuid, modelKind, viewCode, rootXMm, rootYMm, parentUuid, zone, position, slotNo } = selection;
  if (!itemUuid || !viewCode) return null;
  if (modelKind === "enclosure") return { itemUuid, viewCode, rootXMm, rootYMm };
  if (!parentUuid || !zone) return null;
  const base = { itemUuid, parentUuid, zoneNo: zone.zoneNo, viewCode };
  if (zone.layout === "slots") return slotNo === undefined ? null : { ...base, slotNo };
  if (position === undefined) return null;
  return { ...base, startUnits: zone.layout === "linear" && zone.displayDivisor !== null
    ? position * zone.displayDivisor : position };
}

/** The document service remains the only placement validator and writer. */
export async function submitPlacement(api: Pick<ProjectApi, "checkPlacement" | "placeRoot" | "placeChild">,
  input: ProjectPlacementInput): Promise<{ project?: ProjectDocumentView; message: string }> {
  const check = await api.checkPlacement(input);
  if (!check.ok) return { message: check.message };
  const project = input.parentUuid === undefined ? await api.placeRoot(input) : await api.placeChild(input);
  return { project, message: "Articolo posizionato. Salva il progetto per conservare le modifiche." };
}

export function submitUnplacement(api: Pick<ProjectApi, "unplaceNode">, nodeUuid: string): Promise<ProjectDocumentView> {
  return api.unplaceNode(nodeUuid);
}

/**
 * "Rimuovi posizione" for a selected object: an Apparecchio by the existing leaf unplacement, a
 * Pannello by the backend's one-transaction subtree unplacement (its Apparecchi return to the
 * pool with it). The renderer never dismantles a subtree itself.
 */
export function submitSelectionUnplacement(api: Pick<ProjectApi, "unplaceNode" | "unplaceSubtree">,
  kind: "support" | "device", nodeUuid: string): Promise<ProjectDocumentView> {
  return kind === "support" ? api.unplaceSubtree(nodeUuid) : submitUnplacement(api, nodeUuid);
}
