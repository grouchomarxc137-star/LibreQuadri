import {projectMountingCapabilities} from "./mounting-compatibility.js";
import {checkMountingFit} from "../../shared/mounting.js";
import { isOutOfCatalogue } from "../../shared/out-of-catalogue.js";
import { enclosureReferenceScopeIds } from "./enclosure-reference-scope.js";
import { projectEngineeringChainStale } from "./engineering-status.js";
import type Database from "better-sqlite3";
import type { ConfigurationRequest, PhysicalResult } from "../../shared/configuration.js";
import { getPhysicalProfile } from "../catalogue/configuration-queries.js";
import { resolveConfiguration } from "../catalogue/configuration-resolver.js";
import { checkPhysicalClasses } from "./physical-class-compatibility.js";
import { readEngineeringReadiness } from "../catalogue/engineering-readiness.js";

type Kind = "enclosure" | "support" | "device";
type Mode = { mode: "reference" } | { mode: "offer" } | { mode: "add"; configuration: ConfigurationRequest };
export interface DesignGuardRequest {
  parentUuid?: string;
  modelId: number;
  kind: Kind;
  factoryPreset?: true;
}
export type DesignGuardResult = {ok:true;code:"compatible"} |
  {ok:false;code:string;staleImportIds?:number[]};
export interface DesignDiscoveryResult {
  status:"ready"|"engineering_data_stale"|"project_engineering_stale"|"container_unavailable";
  candidates:number[];
  staleImportIds:number[];
  contextDataUnavailable:number;
}
export interface DesignRangeNode {
  id:number;parentId:number|null;code:string;name:string;kind:string;sortOrder:number;
  /** Eligible models attached directly to this node, in the node's own membership order. */
  modelIds:number[];
}
/** Identity of a configured item as snapshotted in the project. */
export interface ConfiguredStructuralItem {
  brandMarchio:string;modelCode:string;definitionFingerprint:string;kind:Kind;
}
export interface ConfiguredItemGuardRequest {
  parentUuid?:string;
  itemUuid?:string;
  item:ConfiguredStructuralItem;
}
export interface DesignRangeDiscoveryResult extends DesignDiscoveryResult {
  nodes:DesignRangeNode[];
}

/** Resolve the unique Gamma from the enclosure's design navigation ancestry. */
export function enclosureGamma(catalogue:Database.Database,brandMarchio:string,modelCode:string):
  {code:string;name:string}|undefined {
  const rows=catalogue.prepare(`WITH RECURSIVE ancestry(id,parent_id,code,name,level_code) AS (
    SELECT n.id,n.parent_id,n.code,n.name,n.level_code FROM cat_config_model m
    JOIN cat_brand b ON b.id=m.brand_id
    JOIN cat_range_node_model nm ON nm.model_id=m.id
    JOIN cat_range_node n ON n.id=nm.node_id AND n.brand_id=b.id
    WHERE b.metel_marchio=? AND m.code=? AND m.model_kind='enclosure'
      AND n.active=1 AND n.design_navigable=1
    UNION
    SELECT p.id,p.parent_id,p.code,p.name,p.level_code FROM ancestry a
    JOIN cat_range_node p ON p.id=a.parent_id
    WHERE a.level_code IS NOT 'gamma' AND p.active=1 AND p.design_navigable=1
  ) SELECT DISTINCT code,name FROM ancestry WHERE level_code='gamma' LIMIT 2`)
    .all(brandMarchio,modelCode) as {code:string;name:string}[];
  return rows.length===1?rows[0]:undefined;
}
type Model = {id:number;brandMarchio:string;code:string;kind:string;active:number;
  obsolete:number;source:string;sourceImportId:number|null;contextPolicy:string;
  commercialContribution:"articles"|"none";hasArticleContribution:number;
  baseProfileId:number|null;definitionFingerprint:string};
type Node = {uuid:string;parentId:number|null;itemId:number;kind:string;
  classCode:string|null;brandMarchio:string;modelCode:string;fingerprint:string};
type RootState = {code:string;model?:Model;staleImportIds?:number[]};
type Readiness = ReturnType<typeof readEngineeringReadiness>;

function staleResult(readiness:Readiness,entry:Model):DesignGuardResult|undefined {
  const stale=readiness.staleModel(entry);
  return stale?{ok:false,code:"engineering_data_stale",staleImportIds:stale.importIds}:undefined;
}

const MODEL_SELECT=`SELECT m.id,b.metel_marchio AS brandMarchio,m.code,m.model_kind AS kind,
  m.active,m.obsolete,m.source,m.source_import_id AS sourceImportId,
  m.context_policy AS contextPolicy,m.commercial_contribution AS commercialContribution,
  (EXISTS(SELECT 1 FROM cat_config_model_article a WHERE a.model_id=m.id) OR
   EXISTS(SELECT 1 FROM cat_config_rule r JOIN cat_config_rule_effect e ON e.rule_id=r.id
     WHERE r.model_id=m.id AND e.effect_kind='article')) AS hasArticleContribution,
  m.base_profile_id AS baseProfileId,
  m.definition_fingerprint AS definitionFingerprint
  FROM cat_config_model m JOIN cat_brand b ON b.id=m.brand_id AND b.active=1`;

// Starting at valid roots and following only valid children makes every reached
// node's complete path active and design-navigable. Membership is read in one pass.
const DESIGN_PATH_CTE=`WITH RECURSIVE design_path(id) AS (
  SELECT id FROM cat_range_node WHERE parent_id IS NULL AND active=1 AND design_navigable=1
  UNION ALL
  SELECT child.id FROM cat_range_node child JOIN design_path parent ON child.parent_id=parent.id
  WHERE child.active=1 AND child.design_navigable=1
)`;

function model(db:Database.Database,id:number):Model|undefined {
  return db.prepare(`${MODEL_SELECT} WHERE m.id=?`)
    .get(id) as Model|undefined;
}
function modelByCode(db:Database.Database,brandMarchio:string,code:string):Model|undefined {
  const found=db.prepare(`SELECT m.id FROM cat_config_model m JOIN cat_brand b ON b.id=m.brand_id AND b.active=1
    WHERE b.metel_marchio=? AND m.code=?`).get(brandMarchio,code) as {id:number}|undefined;
  return found?model(db,found.id):undefined;
}
function lineage(project:Database.Database,parentUuid:string):Node[]|null {
  const nodes=project.prepare(`SELECT n.id,n.uuid,n.parent_id AS parentId,n.item_id AS itemId,
    n.node_kind AS kind,i.fit_class_code AS classCode,
    i.model_brand_marchio AS brandMarchio,i.model_code AS modelCode,
    i.model_definition_fingerprint AS fingerprint
    FROM prj_node n JOIN prj_item i ON i.id=n.item_id`).all() as Array<Node&{id:number}>;
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const parent=nodes.find(node=>node.uuid===parentUuid);
  if(!parent)return null;
  const result:Node[]=[];
  const seen=new Set<number>();
  for(let current:typeof parent|undefined=parent;current;
    current=current.parentId===null?undefined:byId.get(current.parentId)){
    if(seen.has(current.id))return null;
    seen.add(current.id);result.push(current);
  }
  return result;
}
function rootState(catalogue:Database.Database,chain:Node[]|null,readiness:Readiness):RootState {
  if(!chain||!chain.length||chain.at(-1)?.kind!=="enclosure")return {code:"container_unavailable"};
  const root=chain.at(-1)!;
  const entry=modelByCode(catalogue,root.brandMarchio,root.modelCode);
  if(!entry)return {code:"container_unavailable"};
  const stale=staleResult(readiness,entry);
  if(stale)return stale;
  if(entry.kind!=="enclosure"||entry.active!==1||entry.obsolete===1||
    entry.definitionFingerprint!==root.fingerprint)return {code:"container_unavailable"};
  if(entry.contextPolicy==="unknown")return entry.source==="import"
    ?{code:"engineering_data_stale",staleImportIds:entry.sourceImportId===null?[]:[entry.sourceImportId]}
    :{code:"container_unavailable"};
  return {code:"compatible",model:entry};
}
function navigable(db:Database.Database,modelId:number):boolean {
  return !!db.prepare(`${DESIGN_PATH_CTE}
    SELECT 1 FROM design_path path JOIN cat_range_node_model nm ON nm.node_id=path.id
    WHERE nm.model_id=? LIMIT 1`).get(modelId);
}
function navigableModelIds(db:Database.Database,kind:Kind):ReadonlySet<number> {
  const ids=db.prepare(`${DESIGN_PATH_CTE}
    SELECT DISTINCT nm.model_id FROM design_path path
    JOIN cat_range_node_model nm ON nm.node_id=path.id
    JOIN cat_config_model m ON m.id=nm.model_id
    WHERE m.model_kind=? AND m.active=1 AND m.obsolete=0`).pluck().all(kind) as number[];
  return new Set(ids);
}
function contextMatches(db:Database.Database,rootId:number,candidateId:number):boolean {
  return !!db.prepare(`SELECT 1 FROM cat_config_model_context accepted
    JOIN cat_config_context c ON c.id=accepted.context_id AND c.active=1
    JOIN cat_config_model_context provided ON provided.context_id=c.id
      AND provided.role='provides' AND provided.model_id=?
    WHERE accepted.model_id=? AND accepted.role='accepts' LIMIT 1`)
    .get(rootId,candidateId);
}
function physicalResult(db:Database.Database,entry:Model,mode:Mode):PhysicalResult|null {
  if(mode.mode==="offer")return entry.baseProfileId===null?null:getPhysicalProfile(db,entry.baseProfileId);
  if(mode.mode!=="add"||mode.configuration.modelId!==entry.id)return null;
  const resolved=resolveConfiguration(db,mode.configuration);
  return resolved.status==="complete"||isOutOfCatalogue(resolved)?resolved.physical:null;
}
interface PreparedInspection {
  readiness:Readiness;
  mountingCapabilities?:ReturnType<typeof projectMountingCapabilities>;
  candidate:Model;
  chain:Node[];
  root:RootState|null;
  navigableIds:ReadonlySet<number>;
  profiles:Map<number,PhysicalResult|null>;
}
function inspect(catalogue:Database.Database,project:Database.Database,
  request:DesignGuardRequest,mode:Mode,prepared?:PreparedInspection):DesignGuardResult {
  if(!prepared&&projectEngineeringChainStale(project,request.parentUuid))return {ok:false,code:"project_engineering_stale"};
  const candidate=prepared?.candidate??model(catalogue,request.modelId);
  if(!candidate||candidate.kind!==request.kind||candidate.active!==1||candidate.obsolete===1)
    return {ok:false,code:"model_unavailable"};
  const readiness=prepared?.readiness??readEngineeringReadiness(catalogue);
  const stale=staleResult(readiness,candidate);
  if(stale)return stale;
  if(candidate.kind==="device"&&candidate.commercialContribution==="articles"&&
    !candidate.hasArticleContribution)return {ok:false,code:"commercial_contribution_unavailable"};
  const chain=prepared?prepared.chain:
    request.parentUuid===undefined?[]:lineage(project,request.parentUuid);
  if(chain===null||request.kind==="enclosure"&&chain.length>0||
    request.kind!=="enclosure"&&chain.length===0)
    return {ok:false,code:"container_unavailable"};
  const root=prepared?prepared.root:chain.length?rootState(catalogue,chain,readiness):null;
  if(root&&root.code!=="compatible")return {ok:false,code:root.code,
    ...(root.staleImportIds?{staleImportIds:root.staleImportIds}:{})};
  // Reference selection applies only invariant rules: option profiles may change every class constraint.
  if(mode.mode==="reference")return eligibility(catalogue,candidate,chain,root,prepared?.navigableIds);
  let physical:PhysicalResult|null;
  if(prepared&&mode.mode==="offer"&&candidate.baseProfileId!==null){
    if(!prepared.profiles.has(candidate.baseProfileId))
      prepared.profiles.set(candidate.baseProfileId,getPhysicalProfile(catalogue,candidate.baseProfileId));
    physical=prepared.profiles.get(candidate.baseProfileId)!;
  }else physical=physicalResult(catalogue,candidate,mode);
  if(!physical||physical.kind!==request.kind||!physical.views.length)return {ok:false,code:"physical_data_unavailable"};
  if(chain.length){
    const mixed=candidate.brandMarchio!==chain[0]!.brandMarchio;
    const capabilities=prepared?.mountingCapabilities??projectMountingCapabilities(project,chain[0]!.itemId);
    const mounting=capabilities.map(facts=>checkMountingFit(physical.mounting,facts,mixed));
    const qualified=mixed&&mounting.some(check=>check.ok&&check.qualified);
    if((mixed&&(physical.mounting||capabilities.some(Boolean))||mounting.length>0)&&!mounting.some(check=>check.ok))return {ok:false,code:mounting.find(check=>!check.ok)?.code??"mounting_data_unavailable"};
    const checked=checkPhysicalClasses(physical.constraints.filter(row=>!qualified||row.relation!=="parent").map(row=>({
      relation:row.relation,classCodes:row.classCodes})),chain[0]!.classCode,
      chain.map(node=>node.classCode));
    if(!checked.ok)return {ok:false,code:checked.code};
  }
  const factoryPreset=request.factoryPreset===true&&mode.mode==="add"&&request.kind==="support"&&chain.length===1&&
    root?.model!==undefined&&!!catalogue.prepare(`SELECT 1 FROM cat_config_model_relation
      WHERE from_model_id=? AND to_model_id=? AND relation='preset_child' AND placement_mode='factory_fixed'`)
      .get(root.model.id,candidate.id);
  return eligibility(catalogue,candidate,chain,root,prepared?.navigableIds,factoryPreset);
}
/** Context, navigation and root-context checks shared by candidate and configured-item guards. */
function eligibility(catalogue:Database.Database,candidate:Model,chain:Node[],root:RootState|null,
  navigableIds?:ReadonlySet<number>,factoryPreset=false):DesignGuardResult {
  if(candidate.contextPolicy==="unknown")return candidate.source==="import"
    ?{ok:false,code:"engineering_data_stale",staleImportIds:
      candidate.sourceImportId===null?[]:[candidate.sourceImportId]}
    :{ok:false,code:"context_data_unavailable"};
  if(!factoryPreset&&!(navigableIds?navigableIds.has(candidate.id):navigable(catalogue,candidate.id)))
    return {ok:false,code:"design_not_navigable"};
  if(chain.length&&candidate.contextPolicy==="restricted"&&
    !contextMatches(catalogue,root!.model!.id,candidate.id))
    return {ok:false,code:"required_context_not_provided"};
  return {ok:true,code:"compatible"};
}

/** Offer checks the base physical profile; add checks the resolved option profile. */
export function guardDesignCandidate(catalogue:Database.Database,project:Database.Database,
  request:DesignGuardRequest,mode:Exclude<Mode,{mode:"reference"}>={mode:"offer"}):DesignGuardResult {
  return inspect(catalogue,project,request,mode);
}

/**
 * Guards an already configured project item against the current catalogue. The item is
 * identified by its snapshotted brand, model code and definition fingerprint; its physical
 * fit is enforced from the project snapshot by the placement engine, so the option-resolved
 * profile is not re-derived here. Refuses when the model is missing, changed or ineligible.
 */
export function guardConfiguredStructuralItem(catalogue:Database.Database,project:Database.Database,
  request:ConfiguredItemGuardRequest):DesignGuardResult {
  if(projectEngineeringChainStale(project,request.parentUuid,request.itemUuid))return {ok:false,code:"project_engineering_stale"};
  const {item}=request;
  const candidate=modelByCode(catalogue,item.brandMarchio,item.modelCode);
  const readiness=readEngineeringReadiness(catalogue);
  if(candidate){
    const stale=staleResult(readiness,candidate);
    if(stale)return stale;
  }
  if(!candidate||candidate.kind!==item.kind||candidate.active!==1||candidate.obsolete===1||
    candidate.definitionFingerprint!==item.definitionFingerprint)
    return {ok:false,code:"model_unavailable"};
  if(candidate.kind==="device"&&candidate.commercialContribution==="articles"&&
    !candidate.hasArticleContribution)return {ok:false,code:"commercial_contribution_unavailable"};
  const chain=request.parentUuid===undefined?[]:lineage(project,request.parentUuid);
  if(chain===null||item.kind==="enclosure"&&chain.length>0||
    item.kind!=="enclosure"&&chain.length===0)
    return {ok:false,code:"container_unavailable"};
  const root=chain.length?rootState(catalogue,chain,readiness):null;
  if(root&&root.code!=="compatible")return {ok:false,code:root.code,
    ...(root.staleImportIds?{staleImportIds:root.staleImportIds}:{})};
  return eligibility(catalogue,candidate,chain,root);
}

/** No candidate list is returned while relevant imported engineering data is stale. */
export function discoverDesignCandidates(catalogue:Database.Database,project:Database.Database,
  request:{parentUuid?:string;kind:Kind}):DesignDiscoveryResult {
  return discoverCandidates(catalogue,project,request);
}

function discoverCandidates(catalogue:Database.Database,project:Database.Database,
  request:{parentUuid?:string;kind:Kind}, referenceOnly=false, profiles=new Map<number,PhysicalResult|null>()):DesignDiscoveryResult {
  if(projectEngineeringChainStale(project,request.parentUuid))return {status:"project_engineering_stale",
    candidates:[],staleImportIds:[],contextDataUnavailable:0};
  const readiness=readEngineeringReadiness(catalogue);
  let chain:Node[]=[];
  let root:RootState|null=null;
  if(request.parentUuid!==undefined){
    const resolved=lineage(project,request.parentUuid);
    root=rootState(catalogue,resolved,readiness);
    if(root.code!=="compatible")return {status:root.code==="engineering_data_stale"
      ?"engineering_data_stale":"container_unavailable",candidates:[],
      staleImportIds:root.staleImportIds??[],contextDataUnavailable:0};
    chain=resolved!;
  }else if(request.kind!=="enclosure")return {status:"container_unavailable",
    candidates:[],staleImportIds:[],contextDataUnavailable:0};
  const models=catalogue.prepare(`${MODEL_SELECT} WHERE m.model_kind=? AND m.active=1
    AND m.obsolete=0 ORDER BY m.id`).all(request.kind) as Model[];
  const navigableIds=navigableModelIds(catalogue,request.kind);
  const candidates:number[]=[];
  const stale=new Set<number>();
  let hasStale=false;
  let unavailable=0;
  const mountingCapabilities=chain[0]?projectMountingCapabilities(project,chain[0].itemId):[];
  for(const candidate of models){
    const result=inspect(catalogue,project,{...request,modelId:candidate.id},{mode:referenceOnly?"reference":"offer"},
      {candidate,chain,root,navigableIds,readiness,profiles,mountingCapabilities});
    if(result.ok)candidates.push(candidate.id);
    else if(result.code==="engineering_data_stale"){
      hasStale=true;
      for(const id of result.staleImportIds??[])stale.add(id);
    }
    else if(result.code==="context_data_unavailable")unavailable++;
    else if(result.code==="container_unavailable")return {status:"container_unavailable",
      candidates:[],staleImportIds:[],contextDataUnavailable:0};
  }
  return hasStale?{status:"engineering_data_stale",candidates:[],
    staleImportIds:[...stale].sort((a,b)=>a-b),contextDataUnavailable:unavailable}
    :{status:"ready",candidates,staleImportIds:[],contextDataUnavailable:unavailable};
}

/** Structural navigation for the eligible result set; every returned path is design-navigable. */
export function discoverDesignRangeNodes(catalogue:Database.Database,project:Database.Database,
  request:{parentUuid?:string;kind:Kind}):DesignRangeDiscoveryResult {
  return designRangeNodes(catalogue,discoverDesignCandidates(catalogue,project,request));
}

function designRangeNodes(catalogue:Database.Database,discovery:DesignDiscoveryResult):DesignRangeDiscoveryResult {
  if(discovery.status!=="ready")return {...discovery,nodes:[]};
  const rows=catalogue.prepare(`SELECT n.id,n.parent_id AS parentId,n.code,n.name,
    n.node_kind AS kind,n.sort_order AS sortOrder,n.design_navigable AS designNavigable
    FROM cat_range_node n WHERE n.active=1 AND n.brand_id IN (SELECT id FROM cat_brand WHERE active=1) AND n.source IN ('import','manual')`)
    .all() as Array<Omit<DesignRangeNode,"modelIds">&{designNavigable:number}>;
  const byId=new Map(rows.map(row=>[row.id,row]));
  const eligible=new Set(discovery.candidates);
  const memberships=catalogue.prepare(`SELECT node_id AS nodeId,model_id AS modelId
    FROM cat_range_node_model ORDER BY node_id,sort_order,model_id`).all() as {nodeId:number;modelId:number}[];
  const included=new Set<number>();
  const modelsByNode=new Map<number,number[]>();
  for(const member of memberships){
    if(!eligible.has(member.modelId))continue;
    const path:typeof rows=[];
    const visited=new Set<number>();
    let current=byId.get(member.nodeId);
    while(current){
      if(current.designNavigable!==1||visited.has(current.id)){path.length=0;break;}
      path.push(current);visited.add(current.id);
      current=current.parentId===null?undefined:byId.get(current.parentId);
    }
    if(path.length&&path.at(-1)?.parentId===null){
      for(const node of path)included.add(node.id);
      modelsByNode.set(member.nodeId,[...modelsByNode.get(member.nodeId)??[],member.modelId]);
    }
  }
  // Depth-first pre-order: a parent always precedes its children; siblings sort by
  // sort order, name, then id, so the result never depends on storage order.
  const bySort=(a:typeof rows[number],b:typeof rows[number])=>
    a.sortOrder-b.sortOrder||a.name.localeCompare(b.name)||a.id-b.id;
  const children=new Map<number|null,typeof rows>();
  for(const row of rows.filter(entry=>included.has(entry.id)))
    children.set(row.parentId,[...children.get(row.parentId)??[],row]);
  const nodes:DesignRangeNode[]=[];
  const visit=(parentId:number|null):void=>{
    for(const {designNavigable:_,...row} of (children.get(parentId)??[]).sort(bySort)){
      nodes.push({...row,modelIds:modelsByNode.get(row.id)??[]});
      visit(row.id);
    }
  };
  visit(null);
  return {...discovery,nodes};
}

/** Root-scoped model selection independent of a placed panel and of all base physical constraints. */
export function discoverReferenceDevices(catalogue:Database.Database,project:Database.Database,
  parentUuid:string):DesignRangeDiscoveryResult {
  const chain=lineage(project,parentUuid);
  if(!chain||chain.length!==1||chain[0]!.kind!=="enclosure")return designRangeNodes(catalogue,
    {status:"container_unavailable",candidates:[],staleImportIds:[],contextDataUnavailable:0});
  return designRangeNodes(catalogue,discoverCandidates(catalogue,project,
    {kind:"device",parentUuid},true));
}

type ReferenceRequest=import("../../shared/project.js").CompatiblePanelsRequest;
function resolvedReference(catalogue:Database.Database,project:Database.Database,request:ReferenceRequest):
  {check:DesignGuardResult;physical?:PhysicalResult;chain?:Node[]} {
  const chain=lineage(project,request.parentUuid);
  if(!chain||chain.length!==1||chain[0]!.kind!=="enclosure")
    return {check:{ok:false,code:"container_unavailable"}};
  const check=inspect(catalogue,project,{kind:"device",parentUuid:request.parentUuid,
    modelId:request.device.configuration.modelId},{mode:"reference"});
  if(!check.ok)return {check};
  const entry=model(catalogue,request.device.configuration.modelId)!;
  if(entry.definitionFingerprint!==request.device.definitionFingerprint)
    return {check:{ok:false,code:"model_definition_changed"}};
  try {
    const resolved=resolveConfiguration(catalogue,request.device.configuration);
    if((resolved.status!=="complete"&&!isOutOfCatalogue(resolved))||resolved.physical?.kind!=="device")
      return {check:{ok:false,code:"reference_configuration_unavailable"}};
    return {check,physical:resolved.physical,chain};
  }catch{return {check:{ok:false,code:"reference_configuration_unavailable"}};}
}

/** A class match promises no capacity, geometry, automatic placement or electrical sizing. */
function deviceFitsPanel(device:PhysicalResult,panel:PhysicalResult,chain:Node[],mixed=false):DesignGuardResult {
  const mounting=panel.zones.map(zone=>checkMountingFit(device.mounting,zone.mounting,mixed));
  const qualified=mixed&&mounting.some(check=>check.ok&&check.qualified);
  if(mixed&&(device.mounting||panel.zones.some(zone=>zone.mounting))&&!qualified)
    return {ok:false,code:mounting.find(check=>!check.ok)?.code??"mounting_data_unavailable"};
  if(mounting.length&&mounting.every(check=>!check.ok))return {ok:false,code:mounting.find(check=>!check.ok)!.code};
  const panelClass=panel.fitClass.code;
  const result=checkPhysicalClasses(device.constraints.filter(row=>!qualified||row.relation!=="parent"),panelClass,[panelClass,...chain.map(node=>node.classCode)]);
  return result.ok?{ok:true,code:"compatible"}:result;
}

/** One support discovery, one reference resolution, bounded request-local profile caching. */
export function discoverCompatiblePanels(catalogue:Database.Database,project:Database.Database,
  request:ReferenceRequest):{navigation:DesignRangeDiscoveryResult;reference:DesignGuardResult} {
  const reference=resolvedReference(catalogue,project,request);
  const empty=(status:DesignDiscoveryResult["status"]="ready"):DesignRangeDiscoveryResult=>({status,
    candidates:[],nodes:[],staleImportIds:reference.check.ok?[]:reference.check.staleImportIds??[],contextDataUnavailable:0});
  if(!reference.check.ok){
    const code=reference.check.code;
    return {reference:reference.check,navigation:empty(code==="engineering_data_stale"||
      code==="project_engineering_stale"||code==="container_unavailable"?code:"ready")};
  }
  const profiles=new Map<number,PhysicalResult|null>();
  const discovery=discoverCandidates(catalogue,project,{kind:"support",parentUuid:request.parentUuid},false,profiles);
  // Reuse the profiles checked during discovery and read identities in one bounded query,
  // rather than loading geometry/constraints again or rediscovering devices for every panel.
  const classes=catalogue.prepare(`SELECT m.id,p.id AS profileId,b.metel_marchio AS brandMarchio FROM json_each(?) ids
    JOIN cat_config_model m ON m.id=ids.value JOIN cat_phys_profile p ON p.id=m.base_profile_id
    JOIN cat_brand b ON b.id=m.brand_id WHERE p.active=1`)
    .all(JSON.stringify(discovery.candidates)) as {id:number;profileId:number;brandMarchio:string}[];
  const byId=new Map(classes.map(row=>[row.id,row]));
  const deviceBrand=model(catalogue,request.device.configuration.modelId)?.brandMarchio;
  const candidates=discovery.candidates.filter(id=>{
    const row=byId.get(id),profile=row?profiles.get(row.profileId):null;
    return !!profile&&deviceFitsPanel(reference.physical!,profile,reference.chain!,deviceBrand!==row!.brandMarchio).ok;
  });
  return {reference:reference.check,navigation:designRangeNodes(catalogue,{...discovery,candidates})};
}

/** Read-only final check; called again by addStructural before any project write. */
export function checkConfiguredPanelReference(catalogue:Database.Database,project:Database.Database,
  request:import("../../shared/project.js").PanelReferenceCheckRequest):DesignGuardResult {
  const reference=resolvedReference(catalogue,project,request);
  if(!reference.check.ok)return reference.check;
  try {
    const guard=guardDesignCandidate(catalogue,project,{kind:"support",parentUuid:request.parentUuid,
      modelId:request.panel.modelId},{mode:"add",configuration:request.panel});
    if(!guard.ok)return guard;
    const resolved=resolveConfiguration(catalogue,request.panel);
    if((resolved.status!=="complete"&&!isOutOfCatalogue(resolved))||resolved.physical?.kind!=="support")
      return {ok:false,code:"panel_configuration_unavailable"};
    return deviceFitsPanel(reference.physical!,resolved.physical,reference.chain!,model(catalogue,request.device.configuration.modelId)?.brandMarchio!==resolved.model.brandMarchio);
  }catch{return {ok:false,code:"panel_configuration_unavailable"};}
}

/** Scope policy is kept separate from the generic compatibility rules. */
function enclosureScope(db:Database.Database):ReadonlySet<number> {
  return enclosureReferenceScopeIds(db,[...navigableModelIds(db,"device"),
    ...navigableModelIds(db,"support"),...navigableModelIds(db,"enclosure")]);
}
export function discoverEnclosureReferenceDevices(db:Database.Database):DesignRangeDiscoveryResult {
  const scope=enclosureScope(db);
  const ids=(db.prepare(`${MODEL_SELECT} WHERE m.model_kind='device' AND m.active=1 AND m.obsolete=0`).all() as Model[])
    .filter(entry=>scope.has(entry.id)).map(entry=>entry.id);
  return designRangeNodes(db,{status:"ready",candidates:ids,staleImportIds:[],contextDataUnavailable:0});
}

/** Read-only inverse search: enclosure → eligible mounting panel → configured device. */
export function discoverCompatibleEnclosures(db:Database.Database,project:Database.Database,
  request:import("../../shared/project.js").CompatibleEnclosuresRequest):{navigation:DesignRangeDiscoveryResult;reference:DesignGuardResult} {
  const empty=(reference:DesignGuardResult)=>({reference,navigation:{status:"ready" as const,candidates:[],nodes:[],staleImportIds:[],contextDataUnavailable:0}});
  const scope=enclosureScope(db);
  const entry=model(db,request.device.configuration.modelId);
  if(!entry||entry.kind!=="device"||!scope.has(entry.id))return empty({ok:false,code:"reference_scope_unavailable"});
  const readiness=readEngineeringReadiness(db);
  const stale=staleResult(readiness,entry);if(stale)return empty(stale);
  if(entry.active!==1||entry.obsolete===1)return empty({ok:false,code:"model_unavailable"});
  if(entry.definitionFingerprint!==request.device.definitionFingerprint)return empty({ok:false,code:"model_definition_changed"});
  let device:PhysicalResult;
  try{
    const resolved=resolveConfiguration(db,request.device.configuration);
    if((resolved.status!=="complete"&&!isOutOfCatalogue(resolved))||resolved.physical?.kind!=="device")return empty({ok:false,code:"reference_configuration_unavailable"});
    device=resolved.physical;
  }catch{return empty({ok:false,code:"reference_configuration_unavailable"});}
  const discovery=discoverDesignCandidates(db,project,{kind:"enclosure"});
  if(discovery.status!=="ready")return {reference:{ok:false,code:discovery.status},navigation:{...discovery,nodes:[]}};
  const panels=(db.prepare(`${MODEL_SELECT} WHERE m.model_kind='support' AND m.active=1 AND m.obsolete=0`).all() as Model[])
    .filter(panel=>scope.has(panel.id)&&panel.contextPolicy!=="unknown"&&!staleResult(readiness,panel));
  const contexts=new Map<string,Set<number>>();
  for(const row of db.prepare(`SELECT mc.model_id AS modelId,mc.role,mc.context_id AS contextId
    FROM cat_config_model_context mc JOIN cat_config_context c ON c.id=mc.context_id AND c.active=1`).all() as
    {modelId:number;role:string;contextId:number}[]){
    const key=`${row.role}:${row.modelId}`;
    if(!contexts.has(key))contexts.set(key,new Set());contexts.get(key)!.add(row.contextId);
  }
  const accepts=(root:number,target:Model)=>target.contextPolicy==="unrestricted"||
    [...contexts.get(`accepts:${target.id}`)??[]].some(id=>contexts.get(`provides:${root}`)?.has(id));
  const profiles=new Map<number,PhysicalResult|null>();
  const preparedPanels=panels.flatMap(panel=>{
    if(panel.baseProfileId===null)return [];
    if(!profiles.has(panel.baseProfileId))profiles.set(panel.baseProfileId,getPhysicalProfile(db,panel.baseProfileId));
    const profile=profiles.get(panel.baseProfileId);
    return profile?.kind==="support"?[{panel,profile}]:[];
  });
  const candidates=discovery.candidates.filter(id=>{
    if(request.enclosure&&request.enclosure.modelId!==id)return false;
    const enclosure=model(db,id)!;
    if(!scope.has(id)||!accepts(id,entry))return false;
    let physical:PhysicalResult|null;
    try{physical=request.enclosure?physicalResult(db,enclosure,{mode:"add",configuration:request.enclosure}):physicalResult(db,enclosure,{mode:"offer"});}
    catch{return false;}
    if(!physical||physical.kind!=="enclosure")return false;
    const chain:Node[]=[{uuid:"",parentId:null,itemId:0,kind:"enclosure",classCode:physical.fitClass.code,
      brandMarchio:enclosure.brandMarchio,modelCode:enclosure.code,fingerprint:enclosure.definitionFingerprint}];
    return preparedPanels.some(({panel,profile})=>accepts(id,panel)&&
      checkPhysicalClasses(profile.constraints,physical.fitClass.code,[physical.fitClass.code]).ok&&
      deviceFitsPanel(device,profile,chain,entry.brandMarchio!==panel.brandMarchio).ok);
  });
  if(request.enclosure&&!candidates.length)return empty({ok:false,code:"enclosure_reference_incompatible"});
  return {reference:{ok:true,code:"compatible"},navigation:designRangeNodes(db,{...discovery,candidates})};
}
