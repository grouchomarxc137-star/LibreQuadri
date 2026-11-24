import type Database from "better-sqlite3";
import { ENGINEERING_ADAPTERS, type EngineeringAdapter } from "../sources/engineering-adapters.js";

type Import = {id:number;adapterCode:string;installedVersion:string|null;current:number;fingerprint:string};
export interface EngineeringSourceReadiness {
  importFingerprint?:string|null;
  adapterCode:string|null;
  installedVersion:string|null;
  requiredVersion:string|null;
  status:"missing"|"ready"|"engineering_data_stale";
  reason:"not_imported"|"current"|"version_mismatch"|"invalid_version"|"invalid_fingerprint"|
    "missing_current_import"|"ambiguous_current_import"|"missing_provenance"|"noncurrent_import";
  importIds:number[];
}
type ModelProvenance = {source:string;sourceImportId:number|null};
const validVersion=(value:unknown):value is string=>typeof value==="string"&&/^[1-9]\d*$/.test(value);

/** Read afresh at each operation: reimports (including commits on another connection) are visible. */
export function readEngineeringReadiness(db:Database.Database,
  adapters:readonly EngineeringAdapter[]=ENGINEERING_ADAPTERS) {
  const imports=db.prepare(`SELECT id,adapter_code AS adapterCode,adapter_version AS installedVersion,
    became_current AS current,fingerprint FROM app_source_import`).all() as Import[];
  const byId=new Map(imports.map(row=>[row.id,row]));
  const sources:EngineeringSourceReadiness[]=adapters.filter(adapter=>!adapter.optional||imports.some(row=>row.adapterCode===adapter.code)).map(adapter=>{
    const rows=imports.filter(row=>row.adapterCode===adapter.code);
    const current=rows.filter(row=>row.current===1);
    const base={adapterCode:adapter.code,importFingerprint:current.length===1?current[0]!.fingerprint:null,requiredVersion:adapter.version,
      installedVersion:current.length===1?current[0]!.installedVersion:null,
      importIds:(current.length?current:rows).map(row=>row.id).sort((a,b)=>a-b)};
    if(!rows.length)return {...base,status:"missing",reason:"not_imported"};
    if(current.length!==1)return {...base,status:"engineering_data_stale",
      reason:current.length?"ambiguous_current_import":"missing_current_import"};
    if(!validVersion(base.installedVersion))return {...base,status:"engineering_data_stale",reason:"invalid_version"};
    if(!/^[0-9a-f]{64}$/.test(base.importFingerprint!))return {...base,status:"engineering_data_stale",reason:"invalid_fingerprint"};
    return base.installedVersion===adapter.version
      ?{...base,status:"ready",reason:"current"}
      :{...base,status:"engineering_data_stale",reason:"version_mismatch"};
  });
  const byAdapter=new Map(sources.map(row=>[row.adapterCode,row]));
  const staleModel=(model:ModelProvenance):EngineeringSourceReadiness|undefined=>{
    if(model.source!=="import")return undefined;
    const imported=model.sourceImportId===null?undefined:byId.get(model.sourceImportId);
    if(!imported)return {adapterCode:null,installedVersion:null,requiredVersion:null,
      status:"engineering_data_stale",reason:"missing_provenance",
      importIds:model.sourceImportId===null?[]:[model.sourceImportId]};
    const state=byAdapter.get(imported.adapterCode);
    // Sources without a declared adapter retain their existing readiness rules.
    if(!state)return undefined;
    if(state.status!=="ready")return state;
    if(imported.current!==1)return {...state,installedVersion:imported.installedVersion,
      status:"engineering_data_stale",reason:"noncurrent_import",importIds:[imported.id]};
    return undefined;
  };
  return {sources,staleModel};
}

export class EngineeringDataStaleError extends Error {
  readonly code="engineering_data_stale";
  constructor(readonly source:EngineeringSourceReadiness) {
    super("I dati di ingegneria sono obsoleti: reimporta il catalogo.");
    this.name="EngineeringDataStaleError";
  }
}

/** Shared boundary for model configuration reads and resolution, including project add/reconfigure. */
export function assertEngineeringModelCurrent(db:Database.Database,modelId:number):void {
  assertEngineeringModelsCurrent(db,[modelId]);
}

export function assertEngineeringModelsCurrent(db:Database.Database,modelIds:readonly number[]):void {
  if(!modelIds.length)return;
  const models=db.prepare(`SELECT source,source_import_id AS sourceImportId
    FROM cat_config_model WHERE id IN (SELECT value FROM json_each(?)) AND source='import'`)
    .all(JSON.stringify(modelIds)) as ModelProvenance[];
  if(!models.length)return;
  const readiness=readEngineeringReadiness(db);
  for(const model of models){
    const stale=readiness.staleModel(model);
    if(stale)throw new EngineeringDataStaleError(stale);
  }
}

/** The same readiness/import authority supplies provenance; local import IDs never leave the catalogue. */
export function modelEngineeringProvenance(db:Database.Database,modelId:number):import("../../shared/configuration.js").EngineeringProvenance {
  const model=db.prepare("SELECT source,source_import_id AS sourceImportId FROM cat_config_model WHERE id=?")
    .get(modelId) as ModelProvenance;
  if(model.source==="manual")return {kind:"manual"};
  assertEngineeringModelCurrent(db,modelId);
  const row=db.prepare(`SELECT adapter_code AS adapterCode,adapter_version AS adapterVersion,
    fingerprint AS importFingerprint,became_current AS current FROM app_source_import WHERE id=?`)
    .get(model.sourceImportId) as {adapterCode:string;adapterVersion:string;importFingerprint:string;current:number}|undefined;
  if(!row||row.current!==1||!validVersion(row.adapterVersion)||!row.adapterCode.trim()||
      !/^[0-9a-f]{64}$/.test(row.importFingerprint))throw new Error("Provenienza di ingegneria non valida.");
  return {kind:"import",adapterCode:row.adapterCode,adapterVersion:row.adapterVersion,importFingerprint:row.importFingerprint};
}
