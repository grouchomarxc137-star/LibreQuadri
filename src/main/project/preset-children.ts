import type Database from "better-sqlite3";
import type { ConfigurationRequest, ConfigurationResult } from "../../shared/configuration.js";
import type { CatalogueProductSnapshotSource, PresetDiagnostic } from "../../shared/project.js";
import { insertConfiguredItem } from "./configured-items.js";
import { insertPackedChild, placeChild, PlacementError } from "./physical-placement.js";

type Relation = ConfigurationResult["model"]["relations"][number];
type Planned = { relation:Relation; diagnostic:PresetDiagnostic; child:ConfigurationResult;
  zoneNo:number; viewCode:string; fixed:boolean };

const BLOCKED_PRESETS = {
  blocked_overlap: "Le posizioni di fabbrica si sovrappongono.",
  blocked_alignment: "La posizione di fabbrica non coincide con l’apertura del disegno.",
  blocked_device_compatibility: "Il catalogo non conferma apparecchi compatibili con questa carpenteria.",
} as const;

/**
 * Applies a new parent's preset children inside the parent's creation transaction.
 *
 * A preset set is all or nothing: every occurrence is checked first (supported semantics, a complete
 * default configuration, the ordinary design guard, matching geometry and view), and the children are
 * created only when every occurrence passes. If any occurrence is withheld, or an expected placement
 * refusal occurs while creating them, no child is kept and the parent stays addable on its own, so a
 * structure is never left half-created. Unexpected failures escape and roll back the whole operation.
 */
export function instantiatePresetChildren(db:Database.Database,parent:ConfigurationResult,parentUuid:string,
  resolve:(request:ConfigurationRequest)=>ConfigurationResult,
  product:(id:number)=>CatalogueProductSnapshotSource,takenAt:string,
  guard:(modelId:number,factoryPreset:boolean)=>{ok:boolean;code:string}):PresetDiagnostic[] {
  const relations=parent.model.relations.filter(row=>row.relation==="preset_child").sort((a,b)=>a.seq-b.seq);
  const planned:Planned[]=[];
  const diagnostics:PresetDiagnostic[]=[];
  for(const relation of relations) {
    const diagnostic:PresetDiagnostic={seq:relation.seq,modelCode:relation.toModelCode,
      status:"withheld",code:"unsupported_preset",message:"Preimpostazione non supportata."};
    diagnostics.push(diagnostic);
    const withhold=(code:string,message:string)=>{Object.assign(diagnostic,{code,message});};
    const mode=relation.placementMode;
    if(mode&&mode in BLOCKED_PRESETS){
      withhold(mode,BLOCKED_PRESETS[mode as keyof typeof BLOCKED_PRESETS]);continue;
    }
    const fixed=mode==="fixed"||mode==="factory_fixed";
    if(parent.model.kind!=="enclosure"||relation.quantity!==1||
      (!fixed&&mode!=="packed")) {
      withhold("unsupported_preset_semantics","Quantità, contenitore o modalità della preimpostazione non supportati.");continue;
    }
    const child=resolve({modelId:relation.toModelId,selectedOptionIds:[]});
    diagnostic.modelName=child.model.name;
    if(child.status!=="complete"||!child.fingerprint||!child.model.active||child.model.obsolete||
      child.model.kind!=="support"||!child.physical||child.issues.some(issue=>issue.severity==="error")) {
      withhold("preset_configuration_unresolved",`Configurazione non risolta: ${child.status}.`);
      diagnostic.issues=child.issues;continue;
    }
    if(child.model.relations.some(row=>row.relation==="preset_child")) {
      withhold("nested_presets_unsupported","La preimpostazione richiede supporti annidati non ancora supportati.");continue;
    }
    const verdict=guard(child.model.id,mode==="factory_fixed");
    if(!verdict.ok){withhold(verdict.code,"Il pannello preimpostato non è compatibile con il contenitore.");continue;}
    const zones=parent.physical?.zones.filter(zone=>fixed
      ?zone.layout==="slots"&&parent.physical?.slots.some(slot=>slot.zoneNo===zone.zoneNo&&
        slot.slotNo===relation.seq&&slot.xMm===relation.positionXMm&&slot.yMm===relation.positionYMm)
      :zone.layout==="stack")??[];
    if(zones.length!==1){withhold("preset_geometry_unresolved","Zona della preimpostazione non determinabile.");continue;}
    const zone=zones[0]!;
    const view=child.physical.views.find(view=>view.code===(zone.requiredViewCode??"front"));
    if(!view){withhold("preset_view_unavailable","Vista del pannello preimpostato non disponibile.");continue;}
    planned.push({relation,diagnostic,child,zoneNo:zone.zoneNo,viewCode:view.code,fixed});
  }
  // Valid occurrences of an incomplete set keep their own diagnostic code distinct from the cause.
  const markIncomplete=(cause:string)=>{
    for(const row of planned)Object.assign(row.diagnostic,{status:"withheld",code:"preset_set_incomplete",
      message:`Pannello non aggiunto: insieme preimpostato incompleto (${cause}).`});
  };
  if(planned.length!==relations.length){
    const failed=diagnostics.filter(entry=>!planned.some(row=>row.diagnostic===entry)).map(entry=>entry.seq);
    markIncomplete(`posizioni non risolte: ${failed.join(", ")}`);
    return diagnostics;
  }
  try {
    // One savepoint for the whole set: an expected refusal discards every child, quantity and snapshot.
    const created=db.transaction(()=>planned.map(({relation,child,zoneNo,viewCode,fixed})=>{
      const itemUuid=insertConfiguredItem(db,child,product,takenAt);
      const input={itemUuid,parentUuid,zoneNo,viewCode};
      return fixed?placeChild(db,{...input,slotNo:relation.seq})
        :insertPackedChild(db,input);
    }))();
    planned.forEach((row,index)=>Object.assign(row.diagnostic,{status:"instantiated",code:"created",
      message:"Pannello preimpostato creato.",nodeUuid:created[index]}));
  }catch(error){
    if(!(error instanceof PlacementError))throw error;
    markIncomplete(`${error.code}: ${error.message}`);
  }
  return diagnostics;
}
