import {checkMountingFit,parseMountingFacts,type MountingFacts} from "../../shared/mounting.js";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ProjectPackedMoveInput, ProjectPlacementAffectedNode, ProjectPlacementRect,
  ProjectPlacementTarget, ProjectPlacementTargetRequest, ProjectPlacementTargets } from "../../shared/project.js";
import { checkPhysicalClasses } from "./physical-class-compatibility.js";
import { marinaOverlappingWindowSlot } from "../sources/tiquadri/factory-presets.js";

export interface PlacementInput {
  itemUuid: string;
  parentUuid?: string;
  zoneNo?: number;
  startUnits?: number;
  slotNo?: number;
  rootXMm?: number;
  rootYMm?: number;
  viewCode: string;
}
export type PackedChildInput = Pick<PlacementInput,"itemUuid"|"parentUuid"|"zoneNo"|"viewCode"> &
  Required<Pick<PlacementInput,"parentUuid"|"zoneNo">>;
export interface ProjectPhysicalNode {
  uuid: string; itemUuid: string | null; parentUuid: string | null;
  nodeKind: "enclosure" | "support" | "device" | "group";
  zoneNo: number | null; startUnits: number | null; slotNo: number | null;
  rootXMm: number | null; rootYMm: number | null; viewCode: string | null;
  sortOrder: number; xMm: number | null; yMm: number | null; positionIssue: string | null;
  children: ProjectPhysicalNode[];
}
/**
 * Outcome of an external, authoritative check of a support's transfer to a destination root, for
 * the case the project snapshot cannot decide. The engine stays catalogue-free: it only honours it.
 */
export type RootTransferVerdict = {ok:true} | {ok:false;code:string;message:string};
export interface PlacementOptions {
  /** Verdicts by destination root uuid for the moving node; consulted only when snapshot context facts are insufficient. */
  rootTransfer?: ReadonlyMap<string,RootTransferVerdict>;
  /** Enumerate free starts and slots for supports without repacking the existing children. */
  preserveExistingPositions?: boolean;
  /** Preview a copy of the configured item using one hypothetical extra unit. */
  additionalUnit?: boolean;
}
export type PlacementCheck = {ok:true} | {ok:false;code:string;message:string};
export class PlacementError extends Error {
  constructor(readonly code:string, message:string) { super(message); this.name="PlacementError"; }
}
function fail(code:string,message:string):never { throw new PlacementError(code,message); }
interface Item { mounting:MountingFacts|null;id:number;uuid:string;modelKind:string;physStatus:string;fitClassCode:string|null;quantity:number;
  brandMarchio:string;modelCode:string;fingerprint:string;
  /** null: context facts were never snapshotted (legacy project). */
  contextPolicy:"unknown"|"unrestricted"|"restricted"|null; }
interface ItemContext {itemId:number;role:"provides"|"accepts";contextCode:string;}
interface Node {id:number;uuid:string;parentId:number|null;itemId:number;nodeKind:string;zoneNo:number|null;
  startUnits:number|null;slotNo:number|null;rootXMm:number|null;rootYMm:number|null;viewCode:string|null;
  sortOrder:number;}
interface Zone {mounting:MountingFacts|null;itemId:number;zoneNo:number;layout:string;capacityKindCode:string|null;
  capacityKindLabel:string|null;displayDivisor:number|null;nominalPitchMm:number|null;
  capacityAmount:number|null;originXMm:number|null;originYMm:number|null;lengthMm:number|null;
  breadthMm:number|null;direction:string|null;pitchMm:number|null;requiredViewCode:string|null;}
interface View {itemId:number;viewCode:string;widthMm:number;heightMm:number;insertDxMm:number|null;insertDyMm:number|null;}
interface Demand {itemId:number;capacityKindCode:string;amount:number;}
interface Slot {itemId:number;zoneNo:number;slotNo:number;xMm:number;yMm:number;}
interface Constraint {itemId:number;relation:string;setNo:number;classCode:string;}
interface Selection {itemId:number;dimensionCode:string;valueCode:string;binding:string;}
interface Exclusion {itemId:number;ownDimensionCode:string;ownValueCode:string;ancestorDimensionCode:string;ancestorValueCode:string;}
interface Data {items:Item[];contexts:ItemContext[];nodes:Node[];zones:Zone[];views:View[];demands:Demand[];slots:Slot[];
  constraints:Constraint[];selections:Selection[];exclusions:Exclusion[];}

function explicitlyAcceptsEnclosure(data: Data, deviceItemId: number, enclosure: Item | undefined): boolean {
  return !!enclosure?.fitClassCode && enclosure.modelKind === "enclosure" && data.constraints.some(row =>
    row.itemId === deviceItemId && row.relation === "parent" && row.classCode === enclosure.fitClassCode);
}

/** Direct mounting requires an explicit immediate-parent match. An ancestor match also allows devices that need a Pannello. */
export function directDeviceParents(db: Database.Database, itemUuid: string): ReadonlySet<string> {
  const data = read(db);
  const device = data.items.find(item => item.uuid === itemUuid && item.modelKind === "device");
  if (!device) return new Set();
  const enclosures = new Map(data.items.filter(item => item.modelKind === "enclosure").map(item => [item.id, item]));
  return new Set(data.nodes.filter(node => node.nodeKind === "enclosure" &&
    explicitlyAcceptsEnclosure(data, device.id, enclosures.get(node.itemId))).map(node => node.uuid));
}
function read(db:Database.Database):Data {
  return {
    items:(db.prepare(`SELECT i.mounting_json AS mountingJson,i.id,i.uuid,i.model_kind AS modelKind,i.phys_status AS physStatus,
      i.fit_class_code AS fitClassCode,l.quantity,i.model_brand_marchio AS brandMarchio,
      i.model_code AS modelCode,i.model_definition_fingerprint AS fingerprint,
      i.context_policy AS contextPolicy FROM prj_item i JOIN prj_line l ON l.item_id=i.id
      WHERE l.line_type='item'`).all() as Array<Omit<Item,"mounting">&{mountingJson:string|null}>).map(({mountingJson,...item})=>({...item,mounting:parseMountingFacts(mountingJson)})),
    contexts:db.prepare("SELECT item_id AS itemId,role,context_code AS contextCode FROM prj_item_context").all() as ItemContext[],
    nodes:db.prepare(`SELECT id,uuid,parent_id AS parentId,item_id AS itemId,node_kind AS nodeKind,
      zone_no AS zoneNo,start_units AS startUnits,slot_no AS slotNo,root_x_mm AS rootXMm,
      root_y_mm AS rootYMm,view_code AS viewCode,sort_order AS sortOrder FROM prj_node`).all() as Node[],
    zones:(db.prepare(`SELECT mounting_json AS mountingJson,item_id AS itemId,zone_no AS zoneNo,layout,
      capacity_kind_code AS capacityKindCode,capacity_kind_label AS capacityKindLabel,
      display_divisor AS displayDivisor,nominal_pitch_mm AS nominalPitchMm,
      capacity_amount AS capacityAmount,origin_x_mm AS originXMm,origin_y_mm AS originYMm,
      length_mm AS lengthMm,breadth_mm AS breadthMm,direction,pitch_mm AS pitchMm,
      required_view_code AS requiredViewCode FROM prj_item_zone`).all() as Array<Omit<Zone,"mounting">&{mountingJson:string|null}>).map(({mountingJson,...zone})=>({...zone,mounting:parseMountingFacts(mountingJson)})),
    views:db.prepare(`SELECT item_id AS itemId,view_code AS viewCode,width_mm AS widthMm,
      height_mm AS heightMm,insert_dx_mm AS insertDxMm,insert_dy_mm AS insertDyMm
      FROM prj_item_view`).all() as View[],
    demands:db.prepare(`SELECT item_id AS itemId,capacity_kind_code AS capacityKindCode,amount
      FROM prj_item_demand`).all() as Demand[],
    slots:db.prepare(`SELECT item_id AS itemId,zone_no AS zoneNo,slot_no AS slotNo,x_mm AS xMm,y_mm AS yMm
      FROM prj_item_zone_slot`).all() as Slot[],
    constraints:db.prepare(`SELECT item_id AS itemId,relation,set_no AS setNo,class_code AS classCode
      FROM prj_item_constraint`).all() as Constraint[],
    selections:db.prepare(`SELECT item_id AS itemId,dimension_code AS dimensionCode,value_code AS valueCode,binding
      FROM prj_item_selection`).all() as Selection[],
    exclusions:db.prepare(`SELECT item_id AS itemId,own_dimension_code AS ownDimensionCode,
      own_value_code AS ownValueCode,ancestor_dimension_code AS ancestorDimensionCode,
      ancestor_value_code AS ancestorValueCode FROM prj_item_exclusion`).all() as Exclusion[],
  };
}
function finite(value:number|null|undefined):value is number { return value!==null && value!==undefined && Number.isFinite(value); }
function nonnegativeInteger(value:number|null|undefined):value is number { return finite(value) && Number.isSafeInteger(value) && value>=0; }
function matching<T>(rows:T[], predicate:(row:T)=>boolean):T[] { return rows.filter(predicate); }
interface PositionResult { xy:{xMm:number;yMm:number}|null; issue:PlacementError|null; }
function assertGlobalInvariants(data:Data):void {
  const itemById=new Map(data.items.map(item=>[item.id,item]));
  const nodeById=new Map(data.nodes.map(node=>[node.id,node]));
  const counts=new Map<number,number>();
  for(const node of data.nodes) if(node.nodeKind!=="group")
    counts.set(node.itemId,(counts.get(node.itemId)??0)+1);
  for(const [id,count] of counts) {
    const item=itemById.get(id);
    if(!item || !Number.isSafeInteger(item.quantity) || count>item.quantity)
      fail("quantity_exhausted","La quantità configurata non consente altre unità posizionate.");
  }
  const depths=new Map<number,number>();
  const visiting=new Set<number>();
  function visit(node:Node):number {
    if(visiting.has(node.id))fail("cycle","La gerarchia fisica contiene un ciclo.");
    const known=depths.get(node.id);if(known!==undefined)return known;
    visiting.add(node.id);
    const parent=node.parentId===null?null:nodeById.get(node.parentId);
    if(node.parentId!==null&&!parent)fail("invalid_parent","Contenitore fisico non trovato.");
    const depth=parent?visit(parent)+1:0;
    if(depth>=64)fail("invalid_depth","La gerarchia fisica supera la profondità massima.");
    visiting.delete(node.id);depths.set(node.id,depth);return depth;
  }
  for(const node of data.nodes)visit(node);
}
function assessPositions(data:Data, independent=false):Map<number,PositionResult> {
  const itemById=new Map(data.items.map(item=>[item.id,item]));
  const nodeById=new Map(data.nodes.map(node=>[node.id,node]));
  const counts=new Map<number,number>();
  for(const node of data.nodes) if(node.nodeKind!=="group")
    counts.set(node.itemId,(counts.get(node.itemId)??0)+1);
  const results=new Map<number,PositionResult>();
  const visiting=new Set<number>();
  function position(node:Node):PositionResult {
    const cached=results.get(node.id);if(cached)return cached;
    if(visiting.has(node.id))return {xy:null,issue:new PlacementError("cycle","La gerarchia fisica contiene un ciclo.")};
    visiting.add(node.id);
    let result:PositionResult;
    try { result={xy:calculate(node),issue:null}; }
    catch(error) {
      if(!(error instanceof PlacementError))throw error;
      result={xy:null,issue:error};
    } finally { visiting.delete(node.id); }
    results.set(node.id,result);return result;
  }
  function calculate(node:Node):{xMm:number;yMm:number} {
    if(node.nodeKind==="group")fail("unsupported_group","La posizione di un gruppo fisico non è definita.");
    const item=itemById.get(node.itemId);
    if(!item || item.physStatus!=="resolved" || !item.fitClassCode ||
      !["enclosure","support","device"].includes(item.modelKind) || item.modelKind!==node.nodeKind)
      fail("invalid_item","L'articolo non ha un profilo fisico risolto o un tipo di nodo coerente.");
    if(!Number.isSafeInteger(item.quantity) || (counts.get(item.id)??0)>item.quantity)
      fail("quantity_exhausted","La quantità configurata non consente altre unità posizionate.");
    const parent=node.parentId===null?null:nodeById.get(node.parentId);
    if(node.parentId!==null&&!parent)fail("invalid_parent","Contenitore fisico non trovato.");
    // Whole-project safety assessment also checks each node's own rules independently of a
    // pre-existing unrenderable ancestor, so that ancestor errors cannot hide new capacity/class failures.
    const parentResult=parent?(independent?{xy:{xMm:0,yMm:0},issue:null}:position(parent)):null;
    if(parentResult&&!parentResult.xy)
      fail("ancestor_position_unavailable",`La posizione del contenitore non è calcolabile: ${parentResult.issue?.message??"dati non disponibili"}`);
    const storedView=data.views.find(row=>row.itemId===item.id && row.viewCode===node.viewCode);
    const view=independent&&storedView?{...storedView,insertDxMm:storedView.insertDxMm??0,insertDyMm:storedView.insertDyMm??0}:storedView;
    if(!view)fail("no_view_for_orientation","La vista fisica richiesta non è disponibile.");
    if(!finite(view.insertDxMm)||!finite(view.insertDyMm))
      fail("missing_position_metadata","Mancano gli offset di inserimento della vista fisica.");
    let xy:{xMm:number;yMm:number};
    if(node.parentId===null) {
      if(node.nodeKind!=="enclosure" || !finite(node.rootXMm)||!finite(node.rootYMm) ||
        node.zoneNo!==null || node.startUnits!==null || node.slotNo!==null)
        fail("invalid_root","La radice fisica deve essere un involucro con coordinate valide.");
      xy={xMm:node.rootXMm,yMm:node.rootYMm};
    } else {
      if(!parent || !parentResult?.xy)fail("invalid_parent","Contenitore fisico non trovato.");
      if(node.nodeKind==="enclosure")fail("invalid_kind","Un involucro deve essere una radice fisica.");
      const parentItem=itemById.get(parent.itemId);
      if(!parentItem)fail("invalid_parent","Contenitore fisico non valido.");
      const ancestors:Node[]=[];
      for(let cursor:Node|undefined=parent;cursor;cursor=cursor.parentId===null?undefined:nodeById.get(cursor.parentId)) {
        if(ancestors.some(entry=>entry.id===cursor!.id))fail("cycle","La gerarchia fisica contiene un ciclo.");
        ancestors.push(cursor);
      }
      const sets=new Map<string,Set<string>>();
      for(const constraint of data.constraints.filter(row=>row.itemId===item.id)) {
        const key=`${constraint.relation}:${constraint.setNo}`;
        if(!sets.has(key))sets.set(key,new Set());
        sets.get(key)!.add(constraint.classCode);
      }
      const mountingZone=data.zones.find(row=>row.itemId===parentItem.id&&row.zoneNo===node.zoneNo);
      const mixedBrands=item.brandMarchio!==parentItem.brandMarchio;
      const mountingCheck=mountingZone?checkMountingFit(item.mounting,mountingZone.mounting,mixedBrands):{ok:true as const,qualified:false};
      if(!mountingCheck.ok)fail(mountingCheck.code,"I dati di montaggio non confermano la compatibilità o gli spazi disponibili.");
      const physicalCheck=checkPhysicalClasses([...sets].map(([key,classes])=>({
        relation:key.split(":")[0]!,classCodes:[...classes]})).filter(row=>!mixedBrands||!mountingCheck.qualified||row.relation!=="parent"),
        parentItem.fitClassCode,ancestors.map(candidate=>
          itemById.get(candidate.itemId)?.fitClassCode??null));
      if(!physicalCheck.ok)fail(physicalCheck.code,
        "La classe fisica del contenitore non è compatibile.");
      const selections=matching(data.selections,row=>row.itemId===item.id);
      const parentSelections=matching(data.selections,row=>row.itemId===parentItem.id);
      for(const selection of parentSelections) {
        if(selection.binding==="inherit_container")
          fail("unsupported_binding","inherit_container non è ancora supportato.");
        if(selection.binding!=="match_container")continue;
        const counterpart=selections.find(row=>row.dimensionCode===selection.dimensionCode);
        if(!counterpart)fail("context_unknown",`Manca nell'articolo la dimensione ${selection.dimensionCode} richiesta dal contenitore.`);
        if(counterpart.valueCode!==selection.valueCode)
          fail("context_mismatch",`La dimensione ${selection.dimensionCode} non corrisponde al contenitore.`);
      }
      for(const exclusion of data.exclusions.filter(row=>row.itemId===item.id)) {
        if(!selections.some(row=>row.dimensionCode===exclusion.ownDimensionCode && row.valueCode===exclusion.ownValueCode))continue;
        if(ancestors.some(candidate=>data.selections.some(row=>row.itemId===candidate.itemId &&
          row.dimensionCode===exclusion.ancestorDimensionCode && row.valueCode===exclusion.ancestorValueCode)))
          fail("excluded_combination","La configurazione è esclusa da un'opzione di un contenitore.");
      }
      const zone=data.zones.find(row=>row.itemId===parentItem.id && row.zoneNo===node.zoneNo);
      if(!zone)fail("no_zone","La zona del contenitore non esiste.");
      if(zone.requiredViewCode && node.viewCode!==zone.requiredViewCode)
        fail("no_view_for_orientation","La zona richiede una vista fisica diversa.");
      const siblings=data.nodes.filter(row=>row.parentId===parent.id && row.zoneNo===zone.zoneNo && row.id!==node.id);
      const parentXY=parentResult.xy;
      if(zone.layout==="linear") {
        if(!nonnegativeInteger(node.startUnits)||node.slotNo!==null)
          fail("invalid_position","La zona lineare richiede un inizio intero non negativo.");
        if(!zone.capacityKindCode || !nonnegativeInteger(zone.capacityAmount) ||
          !zone.capacityKindLabel || !finite(zone.displayDivisor) || zone.displayDivisor<=0 ||
          !finite(zone.nominalPitchMm) || zone.nominalPitchMm<=0 ||
          !finite(zone.originXMm) || !finite(zone.originYMm) ||
          !["horizontal","vertical"].includes(zone.direction??""))
          fail("missing_position_metadata","La zona lineare non contiene capacità, origine, direzione o passo nominale affidabili.");
        const demand=data.demands.find(row=>row.itemId===item.id && row.capacityKindCode===zone.capacityKindCode);
        if(!demand || !Number.isSafeInteger(demand.amount) || demand.amount<=0)
          fail("capacity_kind_mismatch","L'articolo non ha una domanda positiva nel tipo di capacità della zona.");
        if(node.startUnits+demand.amount>zone.capacityAmount)
          fail("over_capacity","L'articolo supera la capacità della zona.");
        for(const sibling of siblings) {
          const other=data.demands.find(row=>row.itemId===sibling.itemId && row.capacityKindCode===zone.capacityKindCode);
          if(!other || !Number.isSafeInteger(other.amount) || other.amount<=0 ||
            !nonnegativeInteger(sibling.startUnits))
            fail("sibling_position_unknown","L'ingombro di un articolo nella stessa zona non è verificabile.");
          if(node.startUnits<sibling.startUnits+other.amount &&
            sibling.startUnits<node.startUnits+demand.amount)fail("overlap","La posizione si sovrappone a un altro articolo.");
        }
        xy=zone.direction==="vertical"
          ? {xMm:parentXY.xMm+zone.originXMm-view.insertDxMm,
              yMm:parentXY.yMm+zone.originYMm+node.startUnits*zone.nominalPitchMm-view.insertDyMm}
          : {xMm:parentXY.xMm+zone.originXMm+node.startUnits*zone.nominalPitchMm-view.insertDxMm,
              yMm:parentXY.yMm+zone.originYMm-view.insertDyMm};
      } else if(zone.layout==="stack") {
        if(!nonnegativeInteger(node.startUnits)||node.slotNo!==null)
          fail("invalid_position","La zona a pila richiede un inizio intero non negativo.");
        if(!finite(zone.originXMm)||!finite(zone.originYMm)||!finite(zone.lengthMm)||zone.lengthMm<0||
          !finite(zone.breadthMm)||zone.breadthMm<0||!finite(zone.pitchMm)||zone.pitchMm<=0)
          fail("missing_position_metadata","La zona a pila non contiene origine, misure o passo affidabili.");
        if(view.widthMm>zone.breadthMm)fail("too_wide","L'articolo supera la larghezza disponibile.");
        const ratio=node.startUnits/zone.pitchMm;
        if(Math.abs(ratio-Math.round(ratio))>1e-9)fail("misaligned","La posizione non rispetta il passo della zona.");
        if(node.startUnits+view.heightMm>zone.lengthMm)fail("over_capacity","L'articolo supera la lunghezza della zona.");
        for(const sibling of siblings) {
          const other=data.views.find(row=>row.itemId===sibling.itemId && row.viewCode===sibling.viewCode);
          if(!other || !nonnegativeInteger(sibling.startUnits))
            fail("sibling_position_unknown","L'ingombro di un articolo nella stessa zona non è verificabile.");
          if(node.startUnits<sibling.startUnits+other.heightMm &&
            sibling.startUnits<node.startUnits+view.heightMm)fail("overlap","La posizione si sovrappone a un altro articolo.");
        }
        xy={xMm:parentXY.xMm+zone.originXMm-view.insertDxMm,
          yMm:parentXY.yMm+zone.originYMm+node.startUnits-view.insertDyMm};
      } else if(zone.layout==="slots") {
        if(!nonnegativeInteger(node.slotNo)||node.startUnits!==null)
          fail("invalid_position","La zona a slot richiede un numero di slot valido.");
        const factorySlot=node.nodeKind==="support"&&item.brandMarchio==="BTI"&&parentItem.brandMarchio==="BTI"
          ?marinaOverlappingWindowSlot(parentItem.modelCode,item.modelCode):undefined;
        if(factorySlot!==undefined&&node.slotNo!==factorySlot)
          fail("invalid_position","La finestra di fabbrica deve restare nella sua posizione originale.");
        const slot=data.slots.find(row=>row.itemId===parentItem.id && row.zoneNo===zone.zoneNo && row.slotNo===node.slotNo);
        if(!slot || siblings.some(row=>row.slotNo===node.slotNo))
          fail("slot_unavailable","Lo slot non esiste oppure è già occupato.");
        xy={xMm:parentXY.xMm+slot.xMm-view.insertDxMm,yMm:parentXY.yMm+slot.yMm-view.insertDyMm};
      } else fail("invalid_layout","Layout della zona non supportato.");
    }
    if(!finite(xy.xMm)||!finite(xy.yMm))fail("missing_position_metadata","La posizione assoluta non è calcolabile.");
    return xy;
  }
  for(const node of data.nodes)position(node);
  if(!independent)checkMarinaDeviceOverlap();
  return results;

  function checkMarinaDeviceOverlap():void {
    const windows=new Map<number,{cabinetId:number;slot:number}>();
    for(const node of data.nodes){
      if(node.nodeKind!=="support"||node.parentId===null)continue;
      const cabinet=nodeById.get(node.parentId);
      const panel=itemById.get(node.itemId);
      const enclosure=cabinet&&itemById.get(cabinet.itemId);
      if(panel?.brandMarchio!=="BTI"||enclosure?.brandMarchio!=="BTI")continue;
      const slot=marinaOverlappingWindowSlot(enclosure.modelCode,panel.modelCode);
      if(slot!==undefined)windows.set(node.id,{cabinetId:node.parentId,slot});
    }
    if(!windows.size)return;

    const mounted=new Map<number,{node:Node;slot:number;rect:ProjectPlacementRect}[]>();
    for(const node of data.nodes){
      if(node.nodeKind!=="device"||node.parentId===null)continue;
      const window=windows.get(node.parentId);
      const xy=results.get(node.id)?.xy;
      if(!window||!xy)continue;
      const view=data.views.find(row=>row.itemId===node.itemId&&row.viewCode===node.viewCode);
      if(!view||!finite(view.widthMm)||view.widthMm<=0||!finite(view.heightMm)||view.heightMm<=0){
        results.set(node.id,{xy:null,issue:new PlacementError("missing_position_metadata",
          "L’ingombro dell’apparecchio nella finestra di fabbrica non è verificabile.")});
        continue;
      }
      const rect={...xy,widthMm:view.widthMm,heightMm:view.heightMm};
      const peers=mounted.get(window.cabinetId)??[];
      for(const peer of peers){
        const other=peer.rect;
        if(peer.slot===window.slot||rect.xMm>=other.xMm+other.widthMm||other.xMm>=rect.xMm+rect.widthMm||
          rect.yMm>=other.yMm+other.heightMm||other.yMm>=rect.yMm+rect.heightMm)continue;
        const issue=new PlacementError("overlap","L’apparecchio si sovrappone a quello nell’altra finestra di fabbrica.");
        results.set(node.id,{xy:null,issue});
        results.set(peer.node.id,{xy:null,issue});
      }
      peers.push({node,slot:window.slot,rect});
      mounted.set(window.cabinetId,peers);
    }
  }
}
/** The root (parentless) node above `node`, or null when the chain is broken or cyclic. */
function rootOf(data:Data,node:Node):Node|null {
  let cursor:Node|undefined=node;
  for(let depth=0;cursor&&depth<=64;depth++){
    if(cursor.parentId===null)return cursor;
    const parentId:number=cursor.parentId;
    cursor=data.nodes.find(row=>row.id===parentId);
  }
  return null;
}
/**
 * A support may change container root only when the project itself proves the destination
 * compatible. With context facts snapshotted for both the support and the destination root, the
 * decision is made from them alone: an unknown policy on either side cannot be decided; an
 * unrestricted support passes; a restricted support needs a context it accepts that the
 * destination provides. Without facts (a legacy project) only a destination root of the very same
 * snapshotted model as the current root is provable, because acceptance was already established
 * for it. The catalogue is never consulted; anything unprovable is refused, for targets and writes.
 */
function assertRootTransferProvable(data:Data,moving:Node,sourceRoot:Node|null,options?:PlacementOptions):void {
  if(moving.nodeKind!=="support"||!sourceRoot)return;
  const destination=rootOf(data,moving);
  if(!destination||destination.id===sourceRoot.id)return;
  const support=data.items.find(row=>row.id===moving.itemId);
  const target=data.items.find(row=>row.id===destination.itemId);
  const known=!!support&&!!target&&support.contextPolicy!==null&&target.contextPolicy!==null;
  if(known&&support!.contextPolicy!=="unknown"&&target!.contextPolicy!=="unknown"){
    if(support!.contextPolicy==="unrestricted")return;
    const provided=new Set(data.contexts.filter(row=>row.itemId===target!.id&&row.role==="provides").map(row=>row.contextCode));
    if(!data.contexts.some(row=>row.itemId===support!.id&&row.role==="accepts"&&provided.has(row.contextCode)))
      fail("required_context_not_provided","La carpenteria di destinazione non fornisce un contesto accettato dal pannello.");
    return;
  }
  // The snapshot cannot decide: an external verdict for this destination, when supplied, is final.
  const verdict=options?.rootTransfer?.get(destination.uuid);
  if(verdict)return verdict.ok?undefined:fail(verdict.code,verdict.message);
  if(known)fail("context_data_unavailable","I dati di contesto ingegneristico non sono disponibili per verificare il trasferimento.");
  const from=data.items.find(row=>row.id===sourceRoot.itemId);
  if(!from||!target||from.brandMarchio!==target.brandMarchio||from.modelCode!==target.modelCode||
    from.fingerprint!==target.fingerprint)
    fail("root_context_unverified","Il trasferimento verso una carpenteria di modello diverso non è verificabile dal progetto.");
}
function candidate(data:Data,input:PlacementInput,id:number):Node {
  const item=data.items.find(row=>row.uuid===input.itemUuid);
  if(!item)fail("invalid_item","Articolo configurato non trovato.");
  const parent=input.parentUuid===undefined?undefined:data.nodes.find(row=>row.uuid===input.parentUuid);
  if(input.parentUuid!==undefined&&!parent)fail("invalid_parent","Contenitore fisico non trovato.");
  if(!input.viewCode || typeof input.viewCode!=="string")fail("no_view_for_orientation","Vista fisica non valida.");
  if(parent) {
    if(!nonnegativeInteger(input.zoneNo) || input.rootXMm!==undefined || input.rootYMm!==undefined)
      fail("invalid_position","Un figlio richiede una zona e non può avere coordinate di radice.");
    if((input.startUnits===undefined)===(input.slotNo===undefined))
      fail("invalid_position","Specificare esattamente una posizione lineare o uno slot.");
  } else if(input.zoneNo!==undefined || input.startUnits!==undefined || input.slotNo!==undefined ||
    !finite(input.rootXMm) || !finite(input.rootYMm))
    fail("invalid_root","Una radice richiede coordinate valide e nessuna zona del contenitore.");
  return {id,uuid:randomUUID(),parentId:parent?.id??null,itemId:item.id,nodeKind:item.modelKind,
    zoneNo:parent?input.zoneNo??null:null,startUnits:parent?input.startUnits??null:null,
    slotNo:parent?input.slotNo??null:null,rootXMm:parent?null:input.rootXMm??null,
    rootYMm:parent?null:input.rootYMm??null,viewCode:input.viewCode,
    sortOrder:Math.max(-1,...data.nodes.filter(row=>row.parentId===(parent?.id??null)).map(row=>row.sortOrder))+1};
}
export function checkPlacement(db:Database.Database,input:PlacementInput,movingNodeUuid?:string,options?:PlacementOptions):PlacementCheck {
  try {
    trialPlacement(read(db),input,movingNodeUuid,options);
    return {ok:true};
  } catch(error) {
    if(error instanceof PlacementError)return {ok:false,code:error.code,message:error.message};
    throw error;
  }
}
function cloneData(data:Data):Data { return {...data,nodes:data.nodes.map(node=>({...node}))}; }
function trialPlacement(data:Data,input:PlacementInput,movingNodeUuid?:string,options?:PlacementOptions):{subject:Node;positions:Map<number,PositionResult>} {
  let subject:Node;
  if(movingNodeUuid) {
    const moving=data.nodes.find(row=>row.uuid===movingNodeUuid);
    if(!moving)fail("invalid_node","Nodo fisico non trovato.");
    const proposed=candidate(data,input,moving.id);
    const sourceRoot=rootOf(data,moving);
    Object.assign(moving,{...proposed,id:moving.id,uuid:moving.uuid,sortOrder:moving.sortOrder});
    subject=moving;
    assertGlobalInvariants(data);
    assertRootTransferProvable(data,moving,sourceRoot,options);
  } else {subject=candidate(data,input,-1);data.nodes.push(subject);assertGlobalInvariants(data);}
  const positions=assessPositions(data);
  const affected=new Set([subject.id]);
  for(let index=0,queue=[subject.id];index<queue.length;index++) {
    for(const child of data.nodes.filter(node=>node.parentId===queue[index])) {
      if(!affected.has(child.id)){affected.add(child.id);queue.push(child.id);}
    }
  }
  for(const id of affected) {
    const issue=positions.get(id)?.issue;
    if(issue)throw issue;
  }
  return {subject,positions};
}
function requireValid(result:PlacementCheck):void { if(!result.ok)fail(result.code,result.message); }
function packedSiblings(data:Data,parentUuid:string,zoneNo:number):{parent:Node;zone:Zone;nodes:Node[]} {
  const parent=data.nodes.find(row=>row.uuid===parentUuid);
  if(!parent)fail("invalid_parent","Contenitore fisico non trovato.");
  const zone=data.zones.find(row=>row.itemId===parent.itemId && row.zoneNo===zoneNo);
  if(!zone)fail("no_zone","La zona del contenitore non esiste.");
  if(!["linear","stack","slots"].includes(zone.layout))fail("invalid_layout","Layout della zona non supportato.");
  return {parent,zone,nodes:data.nodes.filter(row=>row.parentId===parent.id && row.zoneNo===zoneNo)
    .sort((a,b)=>(zone.layout==="slots"?a.slotNo??Infinity:a.startUnits??Infinity)-
      (zone.layout==="slots"?b.slotNo??Infinity:b.startUnits??Infinity) ||
      a.sortOrder-b.sortOrder || a.id-b.id)};
}
function assignPackedPositions(data:Data,parent:Node,zone:Zone,nodes:Node[]):void {
  let start=0;
  const slots=data.slots.filter(row=>row.itemId===parent.itemId && row.zoneNo===zone.zoneNo)
    .sort((a,b)=>a.slotNo-b.slotNo);
  for(const [index,node] of nodes.entries()) {
    node.sortOrder=index;
    if(zone.layout==="slots") {
      const slot=slots[index];
      if(!slot)fail("slot_unavailable","Non ci sono slot disponibili nella zona.");
      node.startUnits=null;node.slotNo=slot.slotNo;
    } else {
      if(!nonnegativeInteger(start))fail("invalid_position","L'ingombro non produce un inizio intero valido.");
      node.startUnits=start;node.slotNo=null;
      if(zone.layout==="linear") {
        const demand=data.demands.find(row=>row.itemId===node.itemId && row.capacityKindCode===zone.capacityKindCode);
        if(!demand || !Number.isSafeInteger(demand.amount) || demand.amount<=0)
          fail("capacity_kind_mismatch","L'articolo non ha una domanda positiva nel tipo di capacità della zona.");
        start+=demand.amount;
      } else {
        const view=data.views.find(row=>row.itemId===node.itemId && row.viewCode===node.viewCode);
        if(!view || !finite(view.heightMm) || view.heightMm<=0)
          fail("missing_position_metadata","Manca l'altezza della vista fisica.");
        start+=view.heightMm;
      }
    }
  }
}
function repack(data:Data,parent:Node,zone:Zone,nodes:Node[]):void {
  assignPackedPositions(data,parent,zone,nodes);
  assertGlobalInvariants(data);
  const results=assessPositions(data);
  const affected=new Set(nodes.map(row=>row.id));
  for(const node of data.nodes) {
    let cursor=node;
    const seen=new Set<number>();
    while(cursor.parentId!==null && !seen.has(cursor.parentId)) {
      if(affected.has(cursor.parentId)){affected.add(node.id);break;}
      seen.add(cursor.parentId);
      const next=data.nodes.find(row=>row.id===cursor.parentId);
      if(!next)break;
      cursor=next;
    }
  }
  for(const id of affected) {
    const issue=results.get(id)?.issue;
    if(issue)throw issue;
  }
}
function writePacked(db:Database.Database,nodes:Node[]):void {
  const update=db.prepare("UPDATE prj_node SET start_units=?,slot_no=?,sort_order=? WHERE id=?");
  for(const node of nodes)update.run(node.startUnits,node.slotNo,node.sortOrder,node.id);
}
function packedInsertion(data:Data,input:PackedChildInput,index?:number):{nodes:Node[];node:Node} {
  if(!nonnegativeInteger(input.zoneNo))fail("invalid_position","Zona fisica non valida.");
  const {parent,zone,nodes}=packedSiblings(data,input.parentUuid,input.zoneNo);
  const at=index===undefined?nodes.length:index;
  if(!nonnegativeInteger(at) || at>nodes.length)fail("invalid_position","Indice della zona non valido.");
  const provisional=zone.layout==="slots"?{slotNo:0}:{startUnits:0};
  const node=candidate(data,{...input,...provisional},-1);
  nodes.splice(at,0,node);data.nodes.push(node);
  repack(data,parent,zone,nodes);
  return {nodes,node};
}
/** Read-only preview of the exact append path used by insertPackedChild. */
export function checkPackedChild(db:Database.Database,input:PackedChildInput):PlacementCheck {
  try {packedInsertion(read(db),input);return {ok:true};}
  catch(error) {
    if(error instanceof PlacementError)return {ok:false,code:error.code,message:error.message};
    throw error;
  }
}
/** Append when index is omitted; otherwise insert before the zero-based zone index. */
export function insertPackedChild(db:Database.Database,input:PackedChildInput,index?:number):string {
  return db.transaction(()=>{
    const {nodes,node}=packedInsertion(read(db),input,index);
    const inserted=db.prepare(`INSERT INTO prj_node(uuid,parent_id,item_id,node_kind,zone_no,start_units,slot_no,
      root_x_mm,root_y_mm,view_code,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(node.uuid,
        node.parentId,node.itemId,node.nodeKind,node.zoneNo,node.startUnits,node.slotNo,
        null,null,node.viewCode,node.sortOrder);
    node.id=Number(inserted.lastInsertRowid);
    writePacked(db,nodes);
    return node.uuid;
  })();
}
export function reorderPackedNode(db:Database.Database,nodeUuid:string,index:number):void {
  db.transaction(()=>{
    const data=read(db),node=data.nodes.find(row=>row.uuid===nodeUuid);
    if(!node || node.parentId===null || node.zoneNo===null)fail("invalid_node","Selezionare un figlio fisico.");
    const parent=data.nodes.find(row=>row.id===node.parentId)!;
    const {zone,nodes}=packedSiblings(data,parent.uuid,node.zoneNo);
    if(!nonnegativeInteger(index) || index>=nodes.length)fail("invalid_position","Indice della zona non valido.");
    nodes.splice(nodes.indexOf(node),1);nodes.splice(index,0,node);
    repack(data,parent,zone,nodes);writePacked(db,nodes);
  })();
}

type ReflowInput = Extract<ProjectPackedMoveInput,{direction:string}>;
type PackedZone = ReturnType<typeof packedSiblings>;

function reflowGeometry(data:Data,{parent,zone}:PackedZone) {
  const slots=data.slots.filter(row=>row.itemId===parent.itemId&&row.zoneNo===zone.zoneNo)
    .sort((a,b)=>a.slotNo-b.slotNo);
  const capacity=zone.layout==="slots"?slots.length:zone.layout==="linear"?zone.capacityAmount:zone.lengthMm;
  const pitch=zone.layout==="stack"?zone.pitchMm:1;
  if(!finite(capacity)||!finite(pitch)||pitch<=0)
    fail("missing_position_metadata","La zona non ha una capacità verificabile.");
  return {
    capacity,pitch,
    start:(node:Node)=>{
      const start=zone.layout==="slots"?slots.findIndex(slot=>slot.slotNo===node.slotNo):node.startUnits;
      if(!nonnegativeInteger(start))fail("invalid_position","La posizione occupata non è verificabile.");
      return start;
    },
    size:(node:Node)=>{
      const size=zone.layout==="slots"?1:zone.layout==="stack"
        ?data.views.find(view=>view.itemId===node.itemId&&view.viewCode===node.viewCode)?.heightMm
        :data.demands.find(row=>row.itemId===node.itemId&&row.capacityKindCode===zone.capacityKindCode)?.amount;
      if(!finite(size)||size<=0)fail("capacity_kind_mismatch","L'ingombro dell'articolo non è verificabile nella zona.");
      return size;
    },
    place:(node:Node,start:number)=>{
      node.parentId=parent.id;
      node.zoneNo=zone.zoneNo;
      node.startUnits=zone.layout==="slots"?null:start;
      node.slotNo=zone.layout==="slots"?slots[start]!.slotNo:null;
    },
  };
}

function validateReflow(data:Data,changed:readonly Node[]):void {
  assertGlobalInvariants(data);
  const positions=assessPositions(data);
  const affected=new Set(changed.map(node=>node.id));
  for(const node of data.nodes){
    let ancestor:Node|undefined=node;
    while(ancestor&&!affected.has(ancestor.id))
      ancestor=data.nodes.find(row=>row.id===ancestor!.parentId);
    if(!ancestor)continue;
    const issue=positions.get(node.id)?.issue;
    if(issue)throw issue;
  }
}

/** Push a sequence from an occupied position or the entry edge of a rail. */
function pushAlongRail(data:Data,destination:PackedZone,incoming:Node[],backward:boolean,anchor?:Node) {
  const geometry=reflowGeometry(data,destination);
  const along=(node:Node)=>backward
    ?geometry.capacity-geometry.start(node)-geometry.size(node):geometry.start(node);
  let cursor=anchor?along(anchor):0;
  const order=backward?[...destination.nodes].reverse():destination.nodes;
  const tail=anchor?order.slice(order.indexOf(anchor)):order;
  const originalStarts=new Map(tail.map(node=>[node.id,along(node)]));
  const sequence=[...incoming,...tail];
  const placed:Node[]=[];
  for(const node of sequence){
    if(node.nodeKind!=="device")fail("invalid_kind","La zona contiene un oggetto che non può essere spostato.");
    if(incoming.includes(node)&&destination.zone.requiredViewCode)
      node.viewCode=destination.zone.requiredViewCode;
    const size=geometry.size(node);
    const start=Math.max(cursor,originalStarts.get(node.id)??0);
    if(start+size>geometry.capacity)break;
    geometry.place(node,backward?geometry.capacity-start-size:start);
    placed.push(node);
    cursor=start+size;
  }
  return {placed,overflow:sequence.slice(placed.length)};
}

function reflowMove(data:Data,node:Node,destination:PackedZone,input:ReflowInput) {
  const finish=(moved:Node,placed:readonly Node[])=>{
    const changed=new Set<Node>();
    const zones=new Set<string>();
    for(const row of placed){
      const key=`${row.parentId}:${row.zoneNo}`;
      if(zones.has(key))continue;
      zones.add(key);
      const parent=data.nodes.find(candidate=>candidate.id===row.parentId)!;
      const {nodes}=packedSiblings(data,parent.uuid,row.zoneNo!);
      for(const [index,sibling] of nodes.entries()){
        sibling.sortOrder=index;
        changed.add(sibling);
      }
    }
    return {node:moved,changed:[...changed]};
  };
  const anchor=destination.nodes.find(row=>row.uuid===input.anchorUuid);
  if(!anchor||anchor===node||anchor.nodeKind!==node.nodeKind)
    fail("invalid_position","L'oggetto nella posizione scelta è cambiato.");
  const same=node.parentId===destination.parent.id&&node.zoneNo===destination.zone.zoneNo;
  if(same){
    const {nodes}=destination;
    const from=nodes.indexOf(node),to=nodes.indexOf(anchor);
    const first=Math.min(from,to),last=Math.max(from,to);
    const segment=nodes.slice(first,last+1);
    if(segment.some(row=>row.nodeKind!==node.nodeKind))
      fail("invalid_kind","La zona contiene oggetti di tipo diverso.");
    const geometry=reflowGeometry(data,destination);
    const starts=segment.map(geometry.start);
    const end=geometry.start(segment.at(-1)!)+geometry.size(segment.at(-1)!);
    const reordered=segment.filter(row=>row!==node);
    reordered.splice(to-first,0,node);
    node.viewCode=input.viewCode;
    let cursor=starts[0]!;
    for(const [index,row] of reordered.entries()){
      const start=destination.zone.layout==="slots"?starts[index]!:cursor;
      const next=start+geometry.size(row);
      if(next>end)fail("over_capacity","Gli oggetti non entrano nella posizione scelta.");
      geometry.place(row,start);
      cursor=Math.ceil(next/geometry.pitch)*geometry.pitch;
    }
    validateReflow(data,reordered);
    return finish(node,reordered);
  }
  if(node.nodeKind!=="device"||destination.parent.nodeKind!=="support"||
    !["linear","slots"].includes(destination.zone.layout))
    fail("invalid_position","Questa zona non consente lo spostamento con riordino.");

  const positions=assessPositions(data);
  const sourceY=positions.get(node.parentId!)?.xy?.yMm;
  const destinationY=positions.get(destination.parent.id)?.xy?.yMm;
  const root=rootOf(data,destination.parent);
  const backward=input.direction==="backward";
  node.viewCode=input.viewCode;
  const {placed,overflow}=pushAlongRail(data,destination,[node],backward,anchor);
  if(placed[0]!==node)fail("over_capacity","L'apparecchio non entra nella posizione scelta.");
  const overflowIds=new Set(overflow.map(row=>row.id));
  data.nodes=data.nodes.filter(row=>!overflowIds.has(row.id));
  validateReflow(data,placed);
  if(!overflow.length)return finish(node,placed);
  if(destinationY===undefined||!root)fail("over_capacity","Nessun pannello compatibile per gli apparecchi spostati.");

  const preferred=sourceY!==undefined&&sourceY>destinationY?-1:1;
  const panels=data.nodes.flatMap(panel=>{
    if(panel.nodeKind!=="support"||panel.id===destination.parent.id||rootOf(data,panel)?.id!==root.id)return [];
    const y=positions.get(panel.id)?.xy?.yMm;
    return y===undefined||y===destinationY?[]:[{panel,y}];
  });
  // Try the nearest rails in the preferred direction first. Retry from the same layout
  // with the other direction first if the initial cascade cannot place every device.
  for(const direction of [preferred,-preferred]){
    let trial=cloneData(data);
    let queue=overflow;
    const changed=new Set(placed.map(row=>row.id));
    const ordered=[...panels].sort((a,b)=>
      Number((a.y-destinationY)*direction<0)-Number((b.y-destinationY)*direction<0)||
      Math.abs(a.y-destinationY)-Math.abs(b.y-destinationY)||a.panel.id-b.panel.id);
    for(const {panel} of ordered){
      const zones=data.zones.filter(zone=>zone.itemId===panel.itemId&&["linear","slots"].includes(zone.layout))
        .sort((a,b)=>a.zoneNo-b.zoneNo);
      for(const zone of zones){
        const candidate=cloneData(trial);
        const incoming=queue.map(row=>({...row}));
        try{
          const rail=packedSiblings(candidate,panel.uuid,zone.zoneNo);
          const result=pushAlongRail(candidate,rail,incoming,backward);
          if(!result.placed.length)continue;
          const displaced=new Set(result.overflow.map(row=>row.id));
          candidate.nodes=candidate.nodes.filter(row=>!displaced.has(row.id));
          candidate.nodes.push(...result.placed.filter(row=>incoming.includes(row)));
          validateReflow(candidate,result.placed);
          for(const row of result.placed)changed.add(row.id);
          trial=candidate;
          queue=result.overflow;
        }catch(error){
          if(!(error instanceof PlacementError))throw error;
        }
        if(!queue.length){
          data.nodes=trial.nodes;
          return finish(data.nodes.find(row=>row.id===node.id)!,data.nodes.filter(row=>changed.has(row.id)));
        }
      }
    }
  }
  fail("over_capacity","Nessun pannello compatibile per gli apparecchi spostati.");
}

function packedMove(data:Data,nodeUuid:string,input:ProjectPackedMoveInput,options?:PlacementOptions):{node:Node;changed:Node[]} {
  const node=data.nodes.find(row=>row.uuid===nodeUuid);
  if(!node || node.parentId===null || node.zoneNo===null)
    fail("invalid_node","Selezionare un figlio fisico.");
  const sourceParent=data.nodes.find(row=>row.id===node.parentId);
  if(!sourceParent)fail("invalid_parent","Contenitore fisico non trovato.");
  const sourceRoot=rootOf(data,node);
  const source=packedSiblings(data,sourceParent.uuid,node.zoneNo);
  const destination=packedSiblings(data,input.parentUuid,input.zoneNo);
  if(input.anchorUuid!==undefined)return reflowMove(data,node,destination,input);
  const same=sourceParent.id===destination.parent.id && source.zone.zoneNo===destination.zone.zoneNo;
  const sourceNodes=source.nodes.filter(row=>row.id!==node.id);
  node.parentId=destination.parent.id;
  node.zoneNo=destination.zone.zoneNo;
  node.viewCode=input.viewCode;
  node.rootXMm=null;node.rootYMm=null;
  let changed:Node[];
  if("startUnits" in input){
    if(destination.zone.layout!=="stack"||!nonnegativeInteger(input.startUnits))
      fail("invalid_position","La posizione esplicita richiede una zona a pila e un inizio valido.");
    if(source.zone.layout!=="stack")assignPackedPositions(data,source.parent,source.zone,sourceNodes);
    node.startUnits=input.startUnits;node.slotNo=null;
    node.sortOrder=Math.max(-1,...destination.nodes.filter(row=>row.id!==node.id)
      .map(row=>row.sortOrder))+1;
    changed=[...sourceNodes,node];
  }else{
    if(destination.zone.layout==="stack")
      fail("invalid_position","Una zona a pila richiede una posizione esplicita.");
    const destinationNodes=same?sourceNodes:destination.nodes;
    if(!nonnegativeInteger(input.index)||input.index>destinationNodes.length)
      fail("invalid_position","Indice della zona non valido.");
    destinationNodes.splice(input.index,0,node);
    if(!same&&source.zone.layout!=="stack")assignPackedPositions(data,source.parent,source.zone,sourceNodes);
    assignPackedPositions(data,destination.parent,destination.zone,destinationNodes);
    changed=same?destinationNodes:[...sourceNodes,...destinationNodes];
  }
  assertGlobalInvariants(data);
  assertRootTransferProvable(data,node,sourceRoot,options);
  const positions=assessPositions(data);
  for(const current of data.nodes){
    const issue=positions.get(current.id)?.issue;
    if(issue)throw issue;
  }
  return {node,changed};
}
/** Repack both zones against one in-memory document, then write atomically. */
export function movePackedNode(db:Database.Database,nodeUuid:string,input:ProjectPackedMoveInput,options?:PlacementOptions):void {
  db.transaction(()=>{
    const {node,changed}=packedMove(read(db),nodeUuid,input,options);
    const update=db.prepare(`UPDATE prj_node SET parent_id=?,zone_no=?,view_code=?,root_x_mm=NULL,root_y_mm=NULL,
      start_units=?,slot_no=?,sort_order=? WHERE id=?`);
    const reflow=input.anchorUuid!==undefined;
    for(const row of reflow?changed:[node])update.run(row.parentId,row.zoneNo,row.viewCode,
      row.startUnits,row.slotNo,row.sortOrder,row.id);
    if(!reflow)writePacked(db,changed.filter(row=>row.id!==node.id));
  })();
}

function rectangle(data:Data,node:Node,positions:Map<number,PositionResult>):ProjectPlacementRect {
  const result=positions.get(node.id);
  if(result?.issue)throw result.issue;
  const view=data.views.find(row=>row.itemId===node.itemId&&row.viewCode===node.viewCode);
  if(!result?.xy||!view||!finite(view.widthMm)||view.widthMm<=0||
    !finite(view.heightMm)||view.heightMm<=0)
    fail("missing_position_metadata","La geometria della vista fisica non è disponibile.");
  return {...result.xy,widthMm:view.widthMm,heightMm:view.heightMm};
}
function affectedRectangles(before:Data,after:Data,subject:Node,
  beforePositions:Map<number,PositionResult>,afterPositions:Map<number,PositionResult>):ProjectPlacementAffectedNode[] {
  const oldById=new Map(before.nodes.map(node=>[node.id,node]));
  const changed:ProjectPlacementAffectedNode[]=[];
  for(const node of after.nodes) {
    if(node.id===subject.id||node.id<0)continue;
    const old=oldById.get(node.id);
    if(!old)continue;
    const current=afterPositions.get(node.id);
    if(!current?.xy)continue;
    const rect=rectangle(after,node,afterPositions);
    const previous=beforePositions.get(node.id)?.xy;
    if(!previous||previous.xMm!==rect.xMm||previous.yMm!==rect.yMm||old.viewCode!==node.viewCode)
      changed.push({nodeUuid:node.uuid,rect});
  }
  return changed.sort((a,b)=>a.nodeUuid.localeCompare(b.nodeUuid));
}

/** Enumerate accepted device placements and legacy packed structural targets. */
export function placementTargets(db:Database.Database,request:ProjectPlacementTargetRequest,options?:PlacementOptions):ProjectPlacementTargets {
  const data=read(db);
  const parent=data.nodes.find(node=>node.uuid===request.parentUuid);
  const moving=request.nodeUuid?data.nodes.find(node=>node.uuid===request.nodeUuid):undefined;
  const item=moving?data.items.find(row=>row.id===moving.itemId):
    data.items.find(row=>row.uuid===request.itemUuid);
  const diagnostic=(code:string,message:string):ProjectPlacementTargets=>({targets:[],diagnostics:[{code,message}]});
  if(!parent)return diagnostic("invalid_parent","Contenitore fisico non trovato.");
  if(request.nodeUuid&&!moving)return diagnostic("invalid_node","Nodo fisico non trovato.");
  if(!item)return diagnostic("invalid_item","Articolo configurato non trovato.");
  if(options?.additionalUnit&&!moving)item.quantity++;
  const zones=data.zones.filter(zone=>zone.itemId===parent.itemId).sort((a,b)=>a.zoneNo-b.zoneNo);
  if(!zones.length)return diagnostic("no_zone","Il contenitore non offre zone fisiche.");
  const beforePositions=assessPositions(data);
  const siblingsByZone=new Map<number,Node[]>();
  for(const node of data.nodes)if(node.parentId===parent.id&&node.id!==moving?.id){
    const siblings=siblingsByZone.get(node.zoneNo??-1)??[];
    siblings.push(node);siblingsByZone.set(node.zoneNo??-1,siblings);
  }
  const demandByKey=new Map(data.demands.map(row=>[`${row.itemId}:${row.capacityKindCode}`,row.amount]));
  const slotsByZone=new Map<number,Slot[]>();
  for(const slot of data.slots)if(slot.itemId===parent.itemId){
    const slots=slotsByZone.get(slot.zoneNo)??[];
    slots.push(slot);slotsByZone.set(slot.zoneNo,slots);
  }
  const targets:ProjectPlacementTarget[]=[];
  const diagnostics:ProjectPlacementTargets["diagnostics"][number][]=[];
  const seen=new Set<string>();
  const reject=(error:unknown,zoneNo:number,viewCode:string):void=>{
    if(!(error instanceof PlacementError))throw error;
    const key=`${zoneNo}:${viewCode}:${error.code}`;
    if(!seen.has(key)){seen.add(key);diagnostics.push({zoneNo,viewCode,code:error.code,message:error.message});}
  };
  let attempts=0;
  const trial=(zoneNo:number,viewCode:string,run:()=>ProjectPlacementTarget):void=>{
    if(++attempts>10_000)fail("target_limit","Le posizioni candidate superano il limite verificabile.");
    try{targets.push(run());}catch(error){reject(error,zoneNo,viewCode);}
  };
  try {
    for(const zone of zones){
      const views=data.views.filter(view=>view.itemId===item.id&&
        (!zone.requiredViewCode||view.viewCode===zone.requiredViewCode));
      if(!views.length){
        const key=`${zone.zoneNo}:no_view`;
        if(!seen.has(key)){seen.add(key);diagnostics.push({zoneNo:zone.zoneNo,code:"no_view_for_orientation",
          message:"La zona non dispone di una vista fisica utilizzabile."});}
      }
      for(const view of views){
        if(request.reflow&&moving){
          for(const anchor of siblingsByZone.get(zone.zoneNo)??[]){
            if(anchor.nodeKind!==moving.nodeKind||!beforePositions.get(anchor.id)?.xy)continue;
            const same=moving.parentId===parent.id&&moving.zoneNo===zone.zoneNo;
            if(!same&&(moving.nodeKind!=="device"||parent.nodeKind!=="support"||zone.layout==="stack"))continue;
            const directions=same?["forward"] as const:["forward","backward"] as const;
            const start=targets.length;
            for(const direction of directions)trial(zone.zoneNo,view.viewCode,()=>{
              const copy=cloneData(data);
              const input:ReflowInput={parentUuid:parent.uuid,zoneNo:zone.zoneNo,viewCode:view.viewCode,
                anchorUuid:anchor.uuid,direction};
              const {node:subject}=packedMove(copy,moving.uuid,input,options);
              const positions=assessPositions(copy);
              const hit=rectangle(data,anchor,beforePositions);
              const vertical=zone.direction==="vertical";
              const hitRect=same?hit:vertical?
                {...hit,yMm:hit.yMm+(direction==="backward"?hit.heightMm/2:0),heightMm:hit.heightMm/2}:
                {...hit,xMm:hit.xMm+(direction==="backward"?hit.widthMm/2:0),widthMm:hit.widthMm/2};
              return {action:"movePackedNode",nodeUuid:moving.uuid,input,hitRect,subject:rectangle(copy,subject,positions),
                affected:affectedRectangles(data,copy,subject,beforePositions,positions)};
            });
            // If only one push direction fits, use the whole occupied rectangle for it.
            if(!same&&targets.length===start+1)
              targets[start]={...targets[start]!,hitRect:rectangle(data,anchor,beforePositions)};
          }
        }
        if(zone.layout==="stack"){
          const maxStart=finite(zone.lengthMm)&&finite(view.heightMm)?zone.lengthMm-view.heightMm:-1;
          const count=finite(zone.pitchMm)&&zone.pitchMm>0&&maxStart>=0
            ?Math.floor(maxStart/zone.pitchMm)+1:1;
          if(count>10_000-attempts)fail("target_limit","Le posizioni candidate superano il limite verificabile.");
          for(let step=0;step<count;step++){
            const startUnits=finite(zone.pitchMm)&&zone.pitchMm>0?step*zone.pitchMm:0;
            if(!nonnegativeInteger(startUnits))continue;
            trial(zone.zoneNo,view.viewCode,()=>{
              const proposed:PlacementInput={itemUuid:item.uuid,parentUuid:parent.uuid,zoneNo:zone.zoneNo,
                viewCode:view.viewCode,startUnits};
              const copy=cloneData(data);
              const {subject,positions}=trialPlacement(copy,proposed,moving?.uuid,options);
              const geometry={subject:rectangle(copy,subject,positions),
                affected:affectedRectangles(data,copy,subject,beforePositions,positions)};
              return moving?{action:"moveNode",nodeUuid:moving.uuid,input:proposed,...geometry}:
                {action:"placeChild",input:proposed,...geometry};
            });
          }
        } else if(zone.layout==="linear"||zone.layout==="slots"){
          if(item.modelKind!=="device"&&!moving&&!options?.preserveExistingPositions){
            const siblings=siblingsByZone.get(zone.zoneNo)??[];
            if(siblings.length+1>10_000-attempts)fail("target_limit","Le posizioni candidate superano il limite verificabile.");
            for(let index=0;index<=siblings.length;index++)trial(zone.zoneNo,view.viewCode,()=>{
              const copy=cloneData(data);
              const subject=packedInsertion(copy,{itemUuid:item.uuid,parentUuid:parent.uuid,
                zoneNo:zone.zoneNo,viewCode:view.viewCode},index).node;
              const positions=assessPositions(copy);
              const geometry={subject:rectangle(copy,subject,positions),
                affected:affectedRectangles(data,copy,subject,beforePositions,positions)};
              return {action:"insertPackedChild",input:{itemUuid:item.uuid,parentUuid:parent.uuid,
                zoneNo:zone.zoneNo,viewCode:view.viewCode},index,...geometry};
            });
            continue;
          }
          const siblings=siblingsByZone.get(zone.zoneNo)??[];
          const starts:number[]=[];
          if(zone.layout==="slots"){
            const occupied=new Set(siblings.map(node=>node.slotNo));
            for(const slot of slotsByZone.get(zone.zoneNo)??[])
              if(!occupied.has(slot.slotNo))starts.push(slot.slotNo);
            starts.sort((a,b)=>a-b);
          }else{
            const demand=demandByKey.get(`${item.id}:${zone.capacityKindCode}`);
            const maxStart=nonnegativeInteger(zone.capacityAmount)&&demand!==undefined&&nonnegativeInteger(demand)&&demand>0
              ?zone.capacityAmount-demand:-1;
            // A single difference array marks all starts that overlap an occupied range.
            // Each candidate is then checked by the full placement validator below.
            if(maxStart>=0&&maxStart<10_000){
              const blocked=new Int32Array(maxStart+2);
              for(const sibling of siblings){
                const width=demandByKey.get(`${sibling.itemId}:${zone.capacityKindCode}`);
                if(!nonnegativeInteger(sibling.startUnits)||!nonnegativeInteger(width)||width<=0)continue;
                const first=Math.max(0,sibling.startUnits-(demand??0)+1);
                const last=Math.min(maxStart,sibling.startUnits+width-1);
                if(first<=last){blocked[first]!++;blocked[last+1]!--;}
              }
              let overlaps=0;
              for(let start=0;start<=maxStart;start++){
                overlaps+=blocked[start]!;
                if(overlaps===0)starts.push(start);
              }
              if(starts.length<maxStart+1)reject(new PlacementError("overlap",
                "La posizione si sovrappone a un altro articolo."),zone.zoneNo,view.viewCode);
            }else if(maxStart>=10_000)fail("target_limit","Le posizioni candidate superano il limite verificabile.");
            else starts.push(0); // Let the validator report missing demand/capacity metadata.
          }
          if(starts.length>10_000-attempts)fail("target_limit","Le posizioni candidate superano il limite verificabile.");
          for(const position of starts)trial(zone.zoneNo,view.viewCode,()=>{
            const proposed:PlacementInput={itemUuid:item.uuid,parentUuid:parent.uuid,zoneNo:zone.zoneNo,
              viewCode:view.viewCode,...(zone.layout==="slots"?{slotNo:position}:{startUnits:position})};
            const copy=cloneData(data);
            const {subject,positions}=trialPlacement(copy,proposed,moving?.uuid,options);
            const geometry={subject:rectangle(copy,subject,positions),
              affected:affectedRectangles(data,copy,subject,beforePositions,positions)};
            return moving?{action:"moveNode",nodeUuid:moving.uuid,input:proposed,...geometry}:
              {action:"placeChild",input:proposed,...geometry};
          });
        } else diagnostics.push({zoneNo:zone.zoneNo,viewCode:view.viewCode,code:"invalid_layout",
          message:"Layout della zona non supportato."});
      }
    }
  }catch(error){
    if(error instanceof PlacementError&&error.code==="target_limit")return diagnostic(error.code,error.message);
    throw error;
  }
  return {targets,diagnostics};
}
export function removePackedNode(db:Database.Database,nodeUuid:string):void {
  db.transaction(()=>{
    const data=read(db),node=data.nodes.find(row=>row.uuid===nodeUuid);
    if(!node || node.parentId===null || node.zoneNo===null)fail("invalid_node","Selezionare un figlio fisico.");
    if(data.nodes.some(row=>row.parentId===node.id))fail("not_leaf","Solo un nodo senza figli può essere rimosso.");
    const parent=data.nodes.find(row=>row.id===node.parentId)!;
    const {zone,nodes}=packedSiblings(data,parent.uuid,node.zoneNo);
    nodes.splice(nodes.indexOf(node),1);
    data.nodes.splice(data.nodes.indexOf(node),1);
    repack(data,parent,zone,nodes);
    db.prepare("DELETE FROM prj_node WHERE id=?").run(node.id);
    writePacked(db,nodes);
  })();
}
export function placeRoot(db:Database.Database,input:PlacementInput):string {
  if(input.parentUuid!==undefined)fail("invalid_root","Una radice non può avere un contenitore.");
  return place(db,input);
}
export function placeChild(db:Database.Database,input:PlacementInput):string {
  if(input.parentUuid===undefined)fail("invalid_parent","Selezionare un contenitore fisico.");
  return place(db,input);
}
function place(db:Database.Database,input:PlacementInput):string {
  return db.transaction(()=>{
    requireValid(checkPlacement(db,input));
    const data=read(db),node=candidate(data,input,-1);
    db.prepare(`INSERT INTO prj_node(uuid,parent_id,item_id,node_kind,zone_no,start_units,slot_no,
      root_x_mm,root_y_mm,view_code,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(node.uuid,
        node.parentId,node.itemId,node.nodeKind,node.zoneNo,node.startUnits,node.slotNo,
        node.rootXMm,node.rootYMm,node.viewCode,node.sortOrder);
    return node.uuid;
  })();
}
export function moveNode(db:Database.Database,nodeUuid:string,input:PlacementInput,options?:PlacementOptions):void {
  db.transaction(()=>{
    const existing=db.prepare("SELECT id,item_id AS itemId FROM prj_node WHERE uuid=?").get(nodeUuid) as {id:number;itemId:number}|undefined;
    if(!existing)fail("invalid_node","Nodo fisico non trovato.");
    const item=db.prepare("SELECT uuid FROM prj_item WHERE id=?").get(existing.itemId) as {uuid:string};
    if(input.itemUuid!==item.uuid)fail("invalid_item","Lo spostamento non può cambiare l'articolo configurato.");
    requireValid(checkPlacement(db,input,nodeUuid,options));
    const node=candidate(read(db),input,existing.id);
    db.prepare(`UPDATE prj_node SET parent_id=?,zone_no=?,start_units=?,slot_no=?,root_x_mm=?,
      root_y_mm=?,view_code=?,sort_order=? WHERE id=?`).run(node.parentId,node.zoneNo,node.startUnits,
        node.slotNo,node.rootXMm,node.rootYMm,node.viewCode,node.sortOrder,existing.id);
  })();
}
export function unplaceNode(db:Database.Database,nodeUuid:string):void {
  db.transaction(()=>{
    const node=db.prepare("SELECT id FROM prj_node WHERE uuid=?").get(nodeUuid) as {id:number}|undefined;
    if(!node)fail("invalid_node","Nodo fisico non trovato.");
    if(db.prepare("SELECT 1 FROM prj_node WHERE parent_id=? LIMIT 1").get(node.id))
      fail("not_leaf","Solo un nodo senza figli può essere rimosso.");
    db.prepare("DELETE FROM prj_node WHERE id=?").run(node.id);
  })();
}
/**
 * Deletes the node with id `topId` and its whole subtree, deepest nodes first, and reports how
 * many placed nodes of each configured item were below it (the top node itself excluded). Runs
 * inside the caller's transaction; it decides nothing about quantities.
 */
function deleteSubtree(db:Database.Database,topId:number):Map<number,number> {
  const rows=db.prepare("SELECT id,parent_id AS parentId,item_id AS itemId FROM prj_node")
    .all() as Array<{id:number;parentId:number|null;itemId:number|null}>;
  const children=new Map<number,typeof rows>();
  for(const row of rows)if(row.parentId!==null)
    children.set(row.parentId,[...(children.get(row.parentId)??[]),row]);
  const contents=new Map<number,number>();
  const order:number[]=[];
  const visit=(id:number,depth:number):void=>{
    if(depth>64)fail("invalid_tree","Albero fisico non valido.");
    for(const child of children.get(id)??[]){
      visit(child.id,depth+1);
      if(child.itemId!==null)contents.set(child.itemId,(contents.get(child.itemId)??0)+1);
    }
    order.push(id);
  };
  visit(topId,0);
  const remove=db.prepare("DELETE FROM prj_node WHERE id=?");
  for(const id of order)remove.run(id);
  return contents;
}
/**
 * Deletes a physical root (a Carpenteria) together with its whole subtree and reports the placed
 * units it held: the root's own item and, per configured item, how many nodes below it. Only a
 * root is accepted. What happens to the configured items is the caller's decision, inside the
 * same transaction.
 */
export function deletePhysicalRoot(db:Database.Database,nodeUuid:string):
  {rootItemId:number|null;contents:Map<number,number>} {
  return db.transaction(()=>{
    const root=db.prepare("SELECT id,parent_id AS parentId,item_id AS itemId FROM prj_node WHERE uuid=?")
      .get(nodeUuid) as {id:number;parentId:number|null;itemId:number|null}|undefined;
    if(!root)fail("invalid_node","Nodo fisico non trovato.");
    if(root.parentId!==null)fail("not_root","Solo una radice fisica può essere rimossa con il suo contenuto.");
    return {rootItemId:root.itemId,contents:deleteSubtree(db,root.id)};
  })();
}
/**
 * Unplaces a contained node together with everything placed in it (a Pannello with its
 * Apparecchi), in one transaction. Every removed node was one placed unit, so each configured
 * item simply has fewer placed units: quantities, items and quotation lines are not touched, and
 * nodes of the same items elsewhere stay as they are. Siblings keep their positions (no repack),
 * like leaf unplacement. A root is refused: a Carpenteria is removed with deletePhysicalRoot.
 */
export function unplaceSubtree(db:Database.Database,nodeUuid:string):void {
  db.transaction(()=>{
    const node=db.prepare("SELECT id,parent_id AS parentId FROM prj_node WHERE uuid=?")
      .get(nodeUuid) as {id:number;parentId:number|null}|undefined;
    if(!node)fail("invalid_node","Nodo fisico non trovato.");
    if(node.parentId===null)fail("not_child","Una carpenteria non si rimuove dalla posizione: va rimossa dal progetto.");
    deleteSubtree(db,node.id);
  })();
}
export function readPhysicalNodes(db:Database.Database):ProjectPhysicalNode[] {
  const data=read(db);
  const positions=assessPositions(data);
  const itemById=new Map(data.items.map(item=>[item.id,item]));
  const byId=new Map<number,ProjectPhysicalNode>();
  for(const node of data.nodes) {
    const result=positions.get(node.id);
    const xy=result?.xy;
    byId.set(node.id,{uuid:node.uuid,itemUuid:itemById.get(node.itemId)?.uuid??null,
      parentUuid:null,nodeKind:node.nodeKind as ProjectPhysicalNode["nodeKind"],zoneNo:node.zoneNo,
      startUnits:node.startUnits,slotNo:node.slotNo,rootXMm:node.rootXMm,rootYMm:node.rootYMm,
      viewCode:node.viewCode,sortOrder:node.sortOrder,xMm:xy?.xMm??null,yMm:xy?.yMm??null,
      positionIssue:result?.issue?`${result.issue.code}: ${result.issue.message}`:null,children:[]});
  }
  const roots:ProjectPhysicalNode[]=[];
  for(const node of data.nodes) {
    const view=byId.get(node.id)!;
    if(node.parentId===null)roots.push(view);
    else {view.parentUuid=byId.get(node.parentId)!.uuid;byId.get(node.parentId)!.children.push(view);}
  }
  const sort=(nodes:ProjectPhysicalNode[]):void=>{nodes.sort((a,b)=>a.sortOrder-b.sortOrder);for(const node of nodes)sort(node.children);};
  sort(roots);return roots;
}

/** Read-only whole-project assessment, shared with placement's position engine. No catalogue or node writes. */
export function assessProjectPhysical(db:Database.Database):import("../../shared/project-engineering.js").EngineeringIssue[] {
  const data=read(db);
  const issues:import("../../shared/project-engineering.js").EngineeringIssue[]=[];
  const add=(nodeUuid:string|null,code:string,message:string)=>{
    if(!issues.some(row=>row.nodeUuid===nodeUuid&&row.code===code))issues.push({nodeUuid,code,message});
  };
  try{assertGlobalInvariants(data);}catch(error){
    if(!(error instanceof PlacementError))throw error;
    add(null,error.code,error.message);
  }
  const positions=assessPositions(data);
  // Isolate existing compatibility rules from positioning and from each other. A legacy binding,
  // exclusion or class refusal must not hide a newly introduced failure in another rule family.
  const independent=[data,{...data,constraints:[],selections:[],exclusions:[]},
    {...data,selections:[],exclusions:[]},{...data,constraints:[],exclusions:[]},
    {...data,constraints:[],selections:[]}].map(probe=>assessPositions(probe,true));
  for(const node of data.nodes){
    const issue=positions.get(node.id)?.issue;if(issue)add(node.uuid,issue.code,issue.message);
    for(const assessment of independent){const localIssue=assessment.get(node.id)?.issue;if(localIssue)add(node.uuid,localIssue.code,localIssue.message);}
    const parent=data.nodes.find(row=>row.id===node.parentId);
    const directDevice=node.nodeKind==="device"&&parent?.nodeKind==="enclosure"&&
      explicitlyAcceptsEnclosure(data,node.itemId,data.items.find(row=>row.id===parent.itemId));
    if(node.nodeKind==="support"&&parent?.nodeKind!=="enclosure")
      add(node.uuid,"invalid_containment","Il pannello richiede una carpenteria.");
    if(node.nodeKind==="device"&&parent?.nodeKind!=="support"&&!directDevice)
      add(node.uuid,"invalid_containment","L’apparecchio richiede un pannello o una carpenteria compatibile con il montaggio diretto.");
    if(node.nodeKind!=="support")continue;
    const support=data.items.find(row=>row.id===node.itemId);
    const root=rootOf(data,node);
    const enclosure=data.items.find(row=>row.id===root?.itemId);
    // Unknown/legacy facts are not refutations. A newly established restricted context is assessed.
    if(support?.contextPolicy==="restricted"&&enclosure&&enclosure.contextPolicy!==null&&
       enclosure.contextPolicy!=="unknown"){
      const provided=new Set(data.contexts.filter(row=>row.itemId===enclosure.id&&row.role==="provides").map(row=>row.contextCode));
      if(!data.contexts.some(row=>row.itemId===support.id&&row.role==="accepts"&&provided.has(row.contextCode)))
        add(node.uuid,"required_context_not_provided","La carpenteria non fornisce il contesto richiesto dal pannello.");
    }
  }
  return issues.sort((a,b)=>(a.nodeUuid??"").localeCompare(b.nodeUuid??"")||a.code.localeCompare(b.code));
}
