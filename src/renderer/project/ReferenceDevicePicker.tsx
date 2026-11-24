import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ConfigurationApi } from "../../shared/configuration.js";
import type { ProjectApi, ProjectConfiguredItem, ProjectDocumentView, ReferenceDevice } from "../../shared/project.js";
import { restoredOptionIds } from "../configuration/model-configuration.js";
import { useDialogFocus } from "../ui/dialog-focus.js";
import { useReadOnlyQuery } from "./panel-reference-state.js";

/** Restore the saved configuration by stable codes; never substitute current defaults for missing choices. */
async function savedReference(api:ConfigurationApi,item:ProjectConfiguredItem):Promise<ReferenceDevice> {
  if(!["complete","bom_incomplete"].includes(item.configStatus)||item.physStatus!=="resolved")
    throw new Error("La configurazione salvata non è completa. Verifica i dati di ingegneria del progetto.");
  const summary=await api.modelByCode(item.modelBrandMarchio,item.modelCode);
  if(!summary)throw new Error("Il modello non è disponibile nel catalogo locale.");
  const model=await api.model(summary.id);
  if(!model.active||model.obsolete||model.kind!=="device")
    throw new Error("Il modello non è più disponibile per la progettazione.");
  if(model.definitionFingerprint!==item.modelDefinitionFingerprint)
    throw new Error("La definizione dell’apparecchio è cambiata. Verifica i dati di ingegneria del progetto.");
  const selectedOptionIds=restoredOptionIds(model,item.selections);
  if(selectedOptionIds.length!==item.selections.length)
    throw new Error("Alcune scelte salvate non sono disponibili o sono ambigue. Verifica i dati di ingegneria del progetto.");
  return {configuration:{modelId:model.id,selectedOptionIds},definitionFingerprint:item.modelDefinitionFingerprint};
}

export function ReferenceDevicePicker({project,api,enclosures=false,configurationApi,editing,onApply,onRemove,onEdit,onCancel}: {
  project:ProjectDocumentView;api:ProjectApi;enclosures?:boolean;configurationApi:ConfigurationApi;editing:boolean;
  onApply:(device:ReferenceDevice,item:ProjectConfiguredItem)=>void;
  onRemove:()=>void;onEdit:()=>void;onCancel:()=>void;
}) {
  const editButton=useRef<HTMLButtonElement>(null);
  const [selected,setSelected]=useState<string|null>(null);
  const [summary,setSummary]=useState("");
  useEffect(()=>{if(!editing)editButton.current?.focus();},[editing]);
  return <>
    {!editing?<div className="reference-summary" role="group" aria-label="Apparecchio di riferimento"
      onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();onRemove();}}}>
      <p title={summary} data-full-text={summary}><strong>{enclosures?"Carpenterie compatibili per":"Pannelli compatibili per"}</strong> {summary}</p>
      <button type="button" ref={editButton} aria-haspopup="dialog" onClick={onEdit}>Modifica</button>{" "}
      <button type="button" onClick={onRemove}>Rimuovi filtro</button>
    </div>:<ProjectDeviceDialog project={project} api={api} enclosures={enclosures} configurationApi={configurationApi} selected={selected}
      onSelect={setSelected} onCancel={onCancel} onApply={(device,item)=>{
        setSummary([item.modelName,item.configLabel].filter(Boolean).join(" · "));onApply(device,item);
      }}/>}
  </>;
}

function ProjectDeviceDialog({project,api,enclosures,configurationApi,selected,onSelect,onApply,onCancel}: {
  project:ProjectDocumentView;api:ProjectApi;enclosures:boolean;configurationApi:ConfigurationApi;selected:string|null;
  onSelect:(uuid:string)=>void;onApply:(device:ReferenceDevice,item:ProjectConfiguredItem)=>void;onCancel:()=>void;
}) {
  const dialog=useRef<HTMLElement>(null);
  const search=useRef<HTMLInputElement>(null);
  useDialogFocus(dialog,search);
  const [query,setQuery]=useState("");
  const [retry,setRetry]=useState(0);
  const scopeQuery=useMemo(()=>enclosures?()=>api.enclosureReferenceDevices():null,[api,enclosures,retry]);
  const scope=useReadOnlyQuery(scopeQuery);
  const devices=project.configuredItems.filter(item=>item.modelKind==="device"&&(!enclosures||
    !!scope?.value?.candidates.some(model=>model.brandMarchio===item.modelBrandMarchio&&model.code===item.modelCode)));
  const title=enclosures?"Carpenterie compatibili":"Pannelli compatibili";
  const terms=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const filtered=devices.filter(item=>{
    const text=[item.modelName,item.configLabel,item.modelBrandMarchio,item.modelCode,
      ...item.bom.flatMap(row=>[row.manufacturerCode,row.description??""])].join(" ").toLocaleLowerCase();
    return terms.every(term=>text.includes(term));
  });
  const item=filtered.find(device=>device.uuid===selected);
  const load=useMemo(()=>item?()=>savedReference(configurationApi,item):null,[configurationApi,item,retry]);
  const reference=useReadOnlyQuery(load);
  return createPortal(<div className="modal-backdrop" role="presentation" onKeyDown={event=>{
    if(event.key==="Escape"){event.preventDefault();event.stopPropagation();onCancel();}
  }}>
    <section ref={dialog} className="shell-dialog reference-device-dialog" role="dialog" aria-modal="true"
      aria-labelledby="reference-device-title" aria-describedby="reference-device-description" tabIndex={-1}>
      <header><h2 id="reference-device-title">{title}</h2></header>
      <div className="shell-dialog-body">
        <p id="reference-device-description">Scegli un apparecchio dalla lista del progetto. Verrà usata la sua configurazione salvata.</p>
        <label className="device-search">Cerca negli apparecchi del progetto
          <input ref={search} type="search" value={query} placeholder="Nome, configurazione o codice articolo"
            onChange={event=>setQuery(event.target.value)}/>
        </label>
        {enclosures&&!scope?<p role="status">Caricamento apparecchi…</p>:null}
        {scope?.error?<><p role="alert">{scope.error}</p><button type="button" onClick={()=>setRetry(value=>value+1)}>Riprova lista</button></>:null}
        {enclosures?<p className="hint">Apparecchi con dati di ingegneria verificabili.</p>:null}
        {(!enclosures||scope?.value)&&!devices.length?<p role="status" className="hint">{enclosures?"Nessun apparecchio idoneo nel progetto.":"Nessun apparecchio nel progetto. Aggiungine uno dalla sezione Apparecchi."}</p>:
          (!enclosures||scope?.value)&&!filtered.length?<p role="status" className="hint">Nessun apparecchio corrisponde alla ricerca.</p>:null}
        <div className="reference-device-list" role="group" aria-label="Apparecchi del progetto">
          {filtered.map(device=><button key={device.uuid} type="button" aria-pressed={selected===device.uuid}
            onClick={()=>onSelect(device.uuid)}>
            <strong className="reference-device-name">{device.modelName}</strong>
          </button>)}
        </div>
        {item&&!reference?<p role="status" className="hint">Verifica della configurazione salvata…</p>:null}
        {reference?.error?<p role="alert" className="error">{reference.error}</p>:null}
        {reference?.error?<button type="button" onClick={()=>setRetry(value=>value+1)}>Riprova apparecchio</button>:null}
      </div>
      <footer>
        <button type="button" onClick={onCancel}>Annulla</button>
        <button type="button" className="primary" disabled={!item||!reference?.value}
          onClick={()=>{if(item&&reference?.value)onApply(reference.value,item);}}>{enclosures?"Mostra carpenterie compatibili":"Mostra pannelli compatibili"}</button>
      </footer>
    </section>
  </div>,document.body);
}
