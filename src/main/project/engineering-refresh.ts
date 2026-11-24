import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import type { ConfigurationResult } from "../../shared/configuration.js";
import type { ProjectEngineeringPlan, EngineeringItemPlan } from "../../shared/project-engineering.js";
import { readEngineeringReadiness } from "../catalogue/engineering-readiness.js";
import { resolveEngineeringRefresh } from "../catalogue/engineering-refresh-resolver.js";
import { engineeringSnapshotDiff, readConfiguredItems, writeEngineeringSnapshot } from "./configured-items.js";
import { projectEngineeringStatus, validateEngineeringProvenance } from "./engineering-status.js";
import { assessProjectPhysical, readPhysicalNodes } from "./physical-placement.js";

export class ProjectEngineeringRefreshError extends Error {
  constructor(readonly code:string,message:string){super(message);this.name="ProjectEngineeringRefreshError";}
}
interface PlanningState {changeVersion:number;revision:number;projectUuid:string;preconditions:string[]}
export interface PreparedEngineeringPlan {plan:ProjectEngineeringPlan;sourceState:string;writes:{itemId:number;result:ConfigurationResult}[]}
const automaticChanges = new Set(["labels", "provenance"]);
export function canAutoRefreshEngineering(plan: ProjectEngineeringPlan): boolean {
  return plan.canApply && !plan.geometryChanges.length && !plan.resolvedIssues.length &&
    plan.items.every(item => item.changes.every(change => automaticChanges.has(change) ||
      (change === "identity_fingerprints" && (item.changes.includes("labels") || item.changes.includes("provenance")))));
}
const issueKey=(issue:{nodeUuid:string|null;code:string})=>JSON.stringify([issue.nodeUuid,issue.code]);
const geometry=(db:Database.Database)=>{
  const result=new Map<string,{xMm:number|null;yMm:number|null}>();
  const visit=(nodes:ReturnType<typeof readPhysicalNodes>)=>{for(const node of nodes){result.set(node.uuid,{xMm:node.xMm,yMm:node.yMm});visit(node.children);}};
  visit(readPhysicalNodes(db));return result;
};

/** Pure with respect to the real project: all writes and post-assessment run on an isolated in-memory copy. */
export function planEngineeringRefresh(project:Database.Database,catalogue:Database.Database|null,state:PlanningState):PreparedEngineeringPlan {
  const build=()=>buildEngineeringPlan(project,catalogue,state);
  // One consistent catalogue read snapshot, even if another connection imports concurrently.
  return catalogue&&!catalogue.inTransaction?catalogue.transaction(build)():build();
}
function buildEngineeringPlan(project:Database.Database,catalogue:Database.Database|null,state:PlanningState):PreparedEngineeringPlan {
  validateEngineeringProvenance(project);
  const status=projectEngineeringStatus(project,catalogue);
  const items:EngineeringItemPlan[]=[],writes:PreparedEngineeringPlan["writes"]=[];
  const blockers=[...state.preconditions];
  const sources=catalogue?readEngineeringReadiness(catalogue).sources:[];
  const image=project.serialize();
  // serialize includes committed WAL pages, but an in-memory database cannot open a WAL sidecar.
  // SQLite header bytes 18/19 declare rollback-journal read/write mode; no project facts change.
  image[18]=1;image[19]=1;
  const probe=new Database(image);probe.pragma("foreign_keys = ON");
  const before=assessProjectPhysical(project),beforeGeometry=geometry(project);
  let after=before,afterGeometry=beforeGeometry;
  try{
    for(const item of readConfiguredItems(project)){
      const entry:EngineeringItemPlan={itemUuid:item.uuid,modelCode:item.modelCode,modelName:item.modelName,
        state:status.items.find(row=>row.itemUuid===item.uuid)!.state,action:"unchanged",changes:[],blockers:[],labelChanges:[]};
      items.push(entry);
      const block=(code:string)=>{entry.action="blocked";entry.blockers.push(code);};
      if(entry.state==="newer_adapter"){block("newer_adapter");continue;}
      if(!catalogue){if(entry.state!=="manual")block("catalogue_unavailable");continue;}
      if(entry.state==="unknown_source"){block("unknown_source");continue;}
      const resolved=resolveEngineeringRefresh(catalogue,item);
      if(!resolved.ok){block(resolved.code);continue;}
      const result=resolved.result;
      if(result.provenance?.kind==="import"){
        // Every imported refresh needs an explicitly declared ready source, including legacy verification.
        const provenance=result.provenance;
        if(!sources.some(source=>source.adapterCode===provenance.adapterCode&&source.status==="ready"&&
          source.importFingerprint===provenance.importFingerprint)){block("catalogue_stale");continue;}
      }
      const itemId=project.prepare("SELECT id FROM prj_item WHERE uuid=?").pluck().get(item.uuid) as number;
      const bomCount=project.prepare("SELECT COUNT(*) FROM prj_item_bom WHERE item_id=?").pluck().get(itemId) as number;
      if(bomCount!==item.bom.length){block("bom_unverifiable");continue;}
      // config_status is commercially frozen even when today's prices are incomplete.
      entry.changes=engineeringSnapshotDiff({...result,status:item.configStatus as ConfigurationResult["status"]},item);
      writeEngineeringSnapshot(probe,itemId,result,"2000-01-01T00:00:00.000Z");
      const next=readConfiguredItems(probe,itemId)[0]!;
      const physicalIdentity = (value: typeof item) => [value.modelBrandMarchio, value.modelCode, value.modelKind,
        value.commercialContribution, value.physStatus, value.profileCode, value.fitClassCode,
        value.depthMm, value.outerDepthMm, value.usableDepthMm];
      if (entry.changes.includes("identity") && JSON.stringify(physicalIdentity(item)) === JSON.stringify(physicalIdentity(next)))
        entry.changes = entry.changes.map(change => change === "identity" ? "identity_fingerprints" : change);
      const labels=(value:typeof item)=>[value.modelName,value.configLabel,value.profileName,value.fitClassLabel,
        value.selections.map(row=>[row.dimensionCode,row.dimensionLabel,row.valueLabel]),
        value.demands.map(row=>[row.capacityKindCode,row.capacityKindLabel]),value.zones.map(row=>[row.zoneNo,row.capacityKindLabel])];
      if(JSON.stringify(labels(item))!==JSON.stringify(labels(next)))entry.changes.push("labels");
      for(const field of ["modelName","configLabel","profileName","fitClassLabel"] as const)
        if(item[field]!==next[field])entry.labelChanges.push({field,before:item[field],after:next[field]});
      for(const selection of item.selections){
        const updated=next.selections.find(row=>row.dimensionCode===selection.dimensionCode);
        if (!updated) continue;
        for(const field of ["dimensionLabel","valueLabel"] as const)
          if(selection[field]!==updated[field])entry.labelChanges.push({field:selection.dimensionCode+"."+field,before:selection[field],after:updated[field]});
      }
      const valueChange = (field: string, before: string | null, after: string | null) => {
        if (before !== after) entry.labelChanges.push({field,before,after});
      };
      const viewSize = (view: typeof item.views[number] | undefined) =>
        view ? `${view.widthMm} × ${view.heightMm} mm` : null;
      for (const code of new Set([...item.views, ...next.views].map(view => view.viewCode)))
        valueChange(`Disegno (${code})`, viewSize(item.views.find(view => view.viewCode === code)),
          viewSize(next.views.find(view => view.viewCode === code)));
      const demandSize = (demand: typeof item.demands[number] | undefined) => demand
        ? `${demand.amount / (demand.displayDivisor || 1)} ${demand.capacityKindLabel}` : null;
      for (const code of new Set([...item.demands, ...next.demands].map(demand => demand.capacityKindCode)))
        valueChange("Ingombro", demandSize(item.demands.find(demand => demand.capacityKindCode === code)),
          demandSize(next.demands.find(demand => demand.capacityKindCode === code)));
      for (const [field, label] of [["depthMm", "Profondità"], ["outerDepthMm", "Profondità esterna"],
        ["usableDepthMm", "Profondità utile"]] as const) {
        const mm = (value: number | null) => value === null ? null : `${value} mm`;
        valueChange(label, mm(item[field]), mm(next[field]));
      }
      if(item.modelSourceRef!==next.modelSourceRef)entry.changes.push("model_source_ref");
      const context=(db:Database.Database)=>[db.prepare("SELECT context_policy FROM prj_item WHERE id=?").pluck().get(itemId),
        db.prepare("SELECT role,context_code FROM prj_item_context WHERE item_id=? ORDER BY role,context_code").all(itemId)];
      if(JSON.stringify(context(project))!==JSON.stringify(context(probe)))entry.changes.push("context");
      const provenance=(value:typeof item)=>[value.engineeringProvenance??null,value.sourceAdapterCode??null,
        value.sourceAdapterVersion??null,value.sourceImportFingerprint??null];
      const provenanceChanged=JSON.stringify(provenance(item))!==JSON.stringify(provenance(next));
      if(provenanceChanged)entry.changes.push("provenance");
      // Provenance-only verification is separate from changed engineering/display facts.
      entry.action=entry.changes.some(change=>change!=="provenance")?"refresh":
        provenanceChanged?"verify":"unchanged";
      if(entry.action!=="unchanged")writes.push({itemId,result});
    }
    after=assessProjectPhysical(probe);afterGeometry=geometry(probe);
  }finally{probe.close();}
  const oldKeys=new Set(before.map(issueKey)),newKeys=new Set(after.map(issueKey));
  const newIssues=after.filter(issue=>!oldKeys.has(issueKey(issue)));
  const resolvedIssues=before.filter(issue=>!newKeys.has(issueKey(issue)));
  const remainingIssues=after.filter(issue=>oldKeys.has(issueKey(issue)));
  if(newIssues.length){
    blockers.push("new_physical_or_context_failure");
    for(const issue of newIssues){
      const itemUuid=issue.nodeUuid===null?null:project.prepare(`SELECT i.uuid FROM prj_node n
        JOIN prj_item i ON i.id=n.item_id WHERE n.uuid=?`).pluck().get(issue.nodeUuid) as string|null;
      const affected=items.filter(item=>itemUuid===null?item.action!=="unchanged":item.itemUuid===itemUuid);
      for(const item of affected){item.action="blocked";item.blockers.push("new_physical_or_context_failure");}
    }
  }
  const counts={unchanged:0,verify:0,refresh:0,blocked:0};for(const item of items)counts[item.action]++;
  const geometryChanges=[...afterGeometry].filter(([uuid,xy])=>JSON.stringify(xy)!==JSON.stringify(beforeGeometry.get(uuid)))
    .map(([nodeUuid,after])=>({nodeUuid,before:beforeGeometry.get(nodeUuid)!,after}));
  const token=createHash("sha256").update(project.serialize()).update(JSON.stringify({state,sources,items,
    writes,newIssues,resolvedIssues,remainingIssues,geometryChanges})).digest("hex");
  return {sourceState:JSON.stringify(sources),plan:{token,items,counts,blockers,newIssues,resolvedIssues,remainingIssues,geometryChanges,
    canApply:!blockers.length&&!counts.blocked&&writes.length>0},writes};
}

/** Same whole-tree assessment immediately before commit. Identity/positions and commerce are outside the writer boundary. */
export function applyEngineeringWrites(project:Database.Database,prepared:PreparedEngineeringPlan,takenAt:string):void {
  const before=new Set(assessProjectPhysical(project).map(issueKey));
  for(const write of prepared.writes)writeEngineeringSnapshot(project,write.itemId,write.result,takenAt);
  validateEngineeringProvenance(project);
  if(assessProjectPhysical(project).some(issue=>!before.has(issueKey(issue))))
    throw new ProjectEngineeringRefreshError("new_physical_or_context_failure","Il posizionamento non è più valido. Il progetto non è stato modificato.");
}
