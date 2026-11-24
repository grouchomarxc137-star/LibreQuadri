import { useEffect, useState } from "react";

/** Result identity is checked during render as well as after await, including before effect cleanup. */
export function useReadOnlyQuery<T>(query:(()=>Promise<T>)|null) {
  const [snapshot,setSnapshot]=useState<{query:typeof query;value?:T;error?:string}|null>(null);
  useEffect(()=>{
    let current=true;
    if(query)void Promise.resolve().then(query).then(value=>{
      if(current)setSnapshot({query,value});
    },(error:unknown)=>{if(current)setSnapshot({query,error:error instanceof Error?error.message:String(error)});});
    return ()=>{current=false;};
  },[query]);
  return query&&snapshot?.query===query?snapshot:null;
}

export function referenceCompatibilityMessage(code:string):string {
  switch(code){
    case "reference_scope_unavailable":return "Questo filtro richiede dati di ingegneria verificabili per l’apparecchio selezionato.";
    case "enclosure_reference_incompatible":return "La carpenteria configurata non offre un pannello compatibile con questo apparecchio.";
    case "compatible":return "Configurazione del pannello compatibile con l’apparecchio di riferimento.";
    case "mounting_data_unavailable":return "Mancano dati verificati sul sistema di montaggio o sugli spazi disponibili.";
    case "mounting_system_mismatch":return "Il sistema di montaggio del pannello è diverso da quello dell’apparecchio.";
    case "mounting_clearance":return "Lo spazio disponibile non soddisfa le dimensioni di montaggio dell’apparecchio.";
    case "incompatible_parent":return "La classe fisica del pannello non è compatibile con l’apparecchio configurato.";
    case "incompatible_ancestor":return "L’apparecchio o il pannello configurato non è compatibile con questa carpenteria.";
    case "engineering_data_stale":return "I dati di ingegneria locali sono obsoleti: la compatibilità non è verificabile.";
    case "project_engineering_stale":return "Aggiorna i dati di ingegneria del progetto per verificare la compatibilità.";
    case "container_unavailable":return "La carpenteria non è disponibile nel catalogo locale o è cambiata.";
    case "model_definition_changed":return "La definizione dell’apparecchio è cambiata. Verifica i dati di ingegneria del progetto prima di selezionarlo di nuovo.";
    case "model_unavailable":return "Il modello non è più disponibile nel catalogo locale.";
    case "reference_configuration_unavailable":return "La configurazione dell’apparecchio è incompleta, non valida o ha dati mancanti.";
    case "required_context_not_provided":return "Il contesto del modello non è compatibile con la carpenteria.";
    default:return `Compatibilità non verificabile (${code}).`;
  }
}
