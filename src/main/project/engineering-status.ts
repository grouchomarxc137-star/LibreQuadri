import type Database from "better-sqlite3";
import type { ProjectConfiguredItem } from "../../shared/project.js";
import type { ProjectEngineeringState, ProjectEngineeringStatus } from "../../shared/project-engineering.js";
import { readEngineeringReadiness } from "../catalogue/engineering-readiness.js";
import { ENGINEERING_ADAPTERS } from "../sources/engineering-adapters.js";
import { readConfiguredItems } from "./configured-items.js";

export function validateEngineeringProvenance(db:Database.Database):void {
  const rows=db.prepare(`SELECT engineering_provenance AS kind,source_adapter_code AS code,
    source_adapter_version AS version,source_import_fingerprint AS fingerprint FROM prj_item`).all() as
    {kind:unknown;code:unknown;version:unknown;fingerprint:unknown}[];
  for(const row of rows){
    const valid=row.kind===null||row.kind==="manual"
      ?row.code===null&&row.version===null&&row.fingerprint===null
      :row.kind==="import"&&typeof row.code==="string"&&row.code.trim().length>0&&
        typeof row.version==="string"&&/^[1-9]\d*$/.test(row.version)&&
        typeof row.fingerprint==="string"&&/^[0-9a-f]{64}$/.test(row.fingerprint);
    if(!valid)throw new Error("Provenienza di ingegneria del progetto non valida.");
  }
}

export function itemEngineeringState(item:ProjectConfiguredItem,catalogue:Database.Database|null,
  readiness=catalogue?readEngineeringReadiness(catalogue):null):ProjectEngineeringState {
  if(item.engineeringProvenance==null)return "unknown";
  if(item.engineeringProvenance==="manual")return "manual";
  const adapter=ENGINEERING_ADAPTERS.find(entry=>entry.code===item.sourceAdapterCode);
  if(!adapter)return "unknown_source";
  const version=BigInt(item.sourceAdapterVersion!);
  if(version>BigInt(adapter.version))return "newer_adapter";
  if(version<BigInt(adapter.version))return "older_adapter";
  if(!catalogue)return "catalogue_unavailable";
  const source=readiness?.sources.find(entry=>entry.adapterCode===adapter.code);
  if(!source||source.status==="missing")return "catalogue_unavailable";
  if(source.status!=="ready")return "catalogue_stale";
  return item.sourceImportFingerprint===source.importFingerprint?"current_generation":"other_generation";
}
export function projectEngineeringStatus(project:Database.Database,catalogue:Database.Database|null):ProjectEngineeringStatus {
  const counts:ProjectEngineeringStatus["counts"]={current_generation:0,other_generation:0,older_adapter:0,
    newer_adapter:0,catalogue_unavailable:0,catalogue_stale:0,unknown_source:0,manual:0,unknown:0};
  const readiness=catalogue?readEngineeringReadiness(catalogue):null;
  const items=readConfiguredItems(project).map(item=>{
    const state=itemEngineeringState(item,catalogue,readiness);counts[state]++;
    return {itemUuid:item.uuid,modelCode:item.modelCode,state};
  });
  return {items,counts};
}

/** Catalogue-backed operations only: inspect the relevant physical lineage and optional pooled item. */
export function projectEngineeringChainStale(project:Database.Database,parentUuid?:string,itemUuid?:string):boolean {
  // Legacy-only consumers of the pure design guard may use a pre-format-10 project schema.
  if(!(project.pragma("table_info(prj_item)") as {name:string}[]).some(row=>row.name==="engineering_provenance"))return false;
  const rows=project.prepare(`WITH RECURSIVE chain(id,item_id,parent_id) AS (
    SELECT id,item_id,parent_id FROM prj_node WHERE uuid=?
    UNION
    SELECT n.id,n.item_id,n.parent_id FROM prj_node n JOIN chain c ON n.id=c.parent_id
  ) SELECT i.engineering_provenance AS kind,i.source_adapter_code AS code,i.source_adapter_version AS version
    FROM prj_item i WHERE i.id IN (SELECT item_id FROM chain) OR i.uuid=?`)
    .all(parentUuid??null,itemUuid??null) as {kind:string|null;code:string|null;version:string|null}[];
  return rows.some(row=>{
    if(row.kind!=="import")return false;
    const adapter=ENGINEERING_ADAPTERS.find(entry=>entry.code===row.code);
    return !!adapter&&row.version!==adapter.version;
  });
}
