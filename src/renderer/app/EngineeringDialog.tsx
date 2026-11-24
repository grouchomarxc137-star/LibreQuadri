import { useEffect, useState } from "react";
import type { ProjectApi, ProjectDocumentView } from "../../shared/project.js";
import type { ProjectEngineeringPlan, ProjectEngineeringStatus } from "../../shared/project-engineering.js";
import { ShellDialog } from "./ShellDialogs.js";
import { useStatusActions } from "./status.js";

const messages:Record<string,string>={
  save_first:"Salva prima il progetto.",catalogue_unavailable:"Catalogo non disponibile.",catalogue_stale:"Catalogo di ingegneria da aggiornare.",
  context_data_unavailable:"Contesti di ingegneria non verificabili.",
  unknown_source:"Sorgente di ingegneria non riconosciuta.",newer_adapter:"Dati più recenti di questa versione dell’applicazione.",
  model_unavailable:"Modello non trovato nel catalogo.",model_ambiguous:"Identità del modello ambigua.",model_inactive:"Modello non più attivo.",
  model_kind_changed:"Tipo del modello cambiato.",selection_unavailable:"Opzione non disponibile.",selection_ambiguous:"Opzione ambigua.",
  configuration_changed:"La configurazione selezionata è cambiata.",commercial_contribution_changed:"Contributo commerciale cambiato.",
  bom_changed:"Composizione della distinta cambiata.",bom_unverifiable:"Identità degli articoli non verificabile.",
  new_physical_or_context_failure:"Un posizionamento o contesto non è più valido.",
  identity:"Definizione e profilo",selections:"Vincoli delle opzioni",demands:"Ingombri",views:"Geometria e disegno",
  zones:"Zone di inserimento",slots:"Slot",constraints:"Compatibilità fisica",exclusions:"Esclusioni",context:"Contesti",
  labels:"Etichette",provenance:"Provenienza verificata",model_source_ref:"Riferimento della definizione",
  identity_fingerprints:"Identificativi della definizione",
};
const describe=(code:string)=>messages[code]??(code.startsWith("resolution_")?"Configurazione di ingegneria non risolvibile.":"Verifica di ingegneria non superata.");
const errorText=(error:unknown)=>error instanceof Error?error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,""):String(error);

/** Shows differences left for review after the main process checks the opened project. */
export function EngineeringNotice({api,project,onVerify}:{api:ProjectApi;project:ProjectDocumentView;onVerify:()=>void}) {
  const [status,setStatus]=useState<ProjectEngineeringStatus|null>(null),[dismissed,setDismissed]=useState(false);
  useEffect(()=>{let active=true;setStatus(null);setDismissed(false);
    void api.engineeringStatus().then(value=>{if(active)setStatus(value);},()=>{});
    return ()=>{active=false;};
  },[api,project.metadata.uuid,project.revision,project.configuredItems]);
  if(dismissed)return null;
  const counts=status?.counts;
  const review=project.openReconciliation?.engineeringReview;
  const message=project.openReconciliation?.engineeringFailed?"Verifica automatica non riuscita. Sono in uso i dati di ingegneria salvati.":
    counts?.newer_adapter?"Questo progetto contiene dati di ingegneria più recenti di questa versione di LibreQuadri.":
    (counts?.older_adapter||counts?.unknown||counts?.other_generation)&&review?`Modifica da verificare: ${review}`:
    counts?.older_adapter?"Questo progetto contiene dati di ingegneria meno recenti del catalogo installato.":
    counts?.unknown?"Non è noto con quali dati di ingegneria sono stati creati alcuni elementi.":
    counts?.other_generation?"Questo progetto contiene dati di un’altra generazione del catalogo.":null;
  if(!message)return null;
  return <div className="engineering-notice" role="status"><span>{message}</span>
    <button type="button" onClick={onVerify}>Verifica…</button>
    <button type="button" onClick={()=>setDismissed(true)}>Continua con dati salvati</button></div>;
}

export function EngineeringDialog({api,onClose,onProjectChange}:{api:ProjectApi;onClose:()=>void;onProjectChange:(project:ProjectDocumentView)=>void}) {
  const [plan,setPlan]=useState<ProjectEngineeringPlan|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState("");
  const {announce}=useStatusActions();
  useEffect(()=>{let active=true;
    void api.planEngineeringRefresh().then(value=>{if(active){setPlan(value);setBusy(false);}},error=>{if(active){setError(errorText(error));setBusy(false);}});
    return ()=>{active=false;};
  },[api]);
  const verify=async()=>{setBusy(true);setError("");setPlan(null);
    try{setPlan(await api.planEngineeringRefresh());}catch(error){setError(errorText(error));}finally{setBusy(false);}};
  const apply=async()=>{if(!plan?.canApply||busy)return;setBusy(true);setError("");
    try{const updated=await api.applyEngineeringRefresh(plan.token);onProjectChange(updated);
      announce("Dati di ingegneria aggiornati: salva il progetto per confermare.","ok");onClose();
    }catch(error){setError(errorText(error));setPlan(null);}finally{setBusy(false);}};
  return <ShellDialog id="project-engineering" title="Verifica dati di ingegneria" onClose={busy?()=>{}:onClose} actions={<>
    <button type="button" disabled={busy} onClick={onClose}>Annulla</button>
    <button type="button" disabled={busy} onClick={()=>void verify()}>Verifica di nuovo</button>
    <button type="button" disabled={busy||!plan?.canApply} onClick={()=>void apply()}>Aggiorna dati di ingegneria</button>
  </>}>
    {busy?<p role="status">Verifica in corso…</p>:null}
    {error?<p role="alert">{error}</p>:null}
    {plan?<EngineeringPlanReport plan={plan}/>:null}
  </ShellDialog>;
}

/** Pure report presentation, shared by the dialog and renderer regression checks. */
export function EngineeringPlanReport({plan}:{plan:ProjectEngineeringPlan}) {
  const catalogueStale = plan.blockers.includes("catalogue_stale") ||
    plan.items.some(item=>item.blockers.includes("catalogue_stale"));
  return <>
      <p>{plan.counts.unchanged} invariati · {plan.counts.verify} verificati · {plan.counts.refresh} aggiornabili · {plan.counts.blocked} bloccati</p>
      <p>Si aggiornano profili, vincoli e contesti di ingegneria. Prezzi, quantità, sconti, manodopera, testi personali e posizioni salvate non cambiano.</p>
      {!plan.canApply?<p role="status">{plan.blockers.length||plan.counts.blocked?"Aggiornamento non possibile. Il progetto non è stato modificato.":"I dati sono già verificati e attuali."}</p>:null}
      {catalogueStale?<p role="alert">Il catalogo di ingegneria deve essere aggiornato. Riavvia LibreQuadri dopo aver verificato la disponibilità degli archivi di origine.</p>:null}
      {plan.blockers.filter(code=>code!=="catalogue_stale").map(code=><p key={code}>{describe(code)}</p>)}
      <div className="engineering-report">{plan.items.filter(item=>item.changes.length||
        item.blockers.some(code=>code!=="catalogue_stale")).map(item=><div key={item.itemUuid}>
        <strong>{item.modelName}</strong><p>{item.blockers.filter(code=>code!=="catalogue_stale").map(describe).join(" ")||item.changes.map(describe).join(", ")}</p>
        {item.labelChanges.map((label,index)=><p key={index}>{label.field}: {label.before??"—"} → {label.after??"—"}</p>)}
      </div>)}</div>
      {plan.geometryChanges.length?<p>{plan.geometryChanges.length} nodi con posizione calcolata del disegno cambiata; le posizioni salvate restano identiche.</p>:null}
      {plan.resolvedIssues.length?<p>{plan.resolvedIssues.length} problemi preesistenti risolti.</p>:null}
      {plan.remainingIssues.length?<p>{plan.remainingIssues.length} problemi preesistenti rimangono.</p>:null}
      {plan.newIssues.map(issue=><p key={`${issue.nodeUuid}:${issue.code}`} role="alert">{issue.message}</p>)}
    </>;
}
