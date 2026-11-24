import { useEffect, useState } from "react";
import type { BrandApi, ManagedBrand, BrandRemovalPreview } from "../../shared/brands.js";
import type { MetelImportApi } from "../../shared/metel-import.js";
import { formatCount } from "../catalogue/formatting.js";
import { ShellDialog } from "./ShellDialogs.js";

export function BrandManagementDialog({api,metel,onClose,onUpdate}:{readonly api:BrandApi;readonly metel:MetelImportApi;
  readonly onClose:()=>void;readonly onUpdate:()=>void}) {
  const [brands,setBrands]=useState<readonly ManagedBrand[]>([]);
  const [busy,setBusy]=useState(true),[progress,setProgress]=useState("Caricamento marchi…");
  const [error,setError]=useState<string|null>(null),[filter,setFilter]=useState("");
  const [preview,setPreview]=useState<BrandRemovalPreview|null>(null),[confirmed,setConfirmed]=useState(false);
  useEffect(()=>metel.onProgress(setProgress),[metel]);
  useEffect(()=>{let alive=true;void api.list().then(rows=>{if(alive)setBrands(rows);})
    .catch(error=>{if(alive)setError(String(error));}).finally(()=>{if(alive)setBusy(false);});return()=>{alive=false;};},[api]);
  const run=async(message:string,operation:()=>Promise<void>)=>{
    setBusy(true);setProgress(message);setError(null);
    try {await operation();setBrands(await api.list());}
    catch(error){setPreview(null);setConfirmed(false);setError(error instanceof Error?error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,""):String(error));}
    finally{setBusy(false);setProgress("");}
  };
  const reset=()=>{setPreview(null);setConfirmed(false);};
  const rows=brands.filter(b=>`${b.code} ${b.name} ${b.issuers}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <ShellDialog id="brand-management" title="Gestisci marchi" wide onClose={()=>{if(!busy)onClose();}}
    actions={<><div className="metel-operation" role="status" aria-live="polite">{busy?<><span className="metel-operation-spinner" aria-hidden="true"/><span>{progress}</span></>:null}</div>
      <button type="button" disabled={busy} onClick={onClose}>Chiudi</button></>}>
    <p>Disattiva un marchio per escluderlo dalle nuove selezioni. I progetti esistenti conservano i dati e i prezzi salvati.</p>
    <div className="brand-management-tools"><label>Cerca marchio <input type="search" value={filter} disabled={busy} onChange={event=>setFilter(event.target.value)}/></label>
      <button type="button" disabled={busy} onClick={onUpdate}>Aggiorna listino…</button></div>
    {error?<p role="alert" className="metel-error">{error}</p>:null}
    <table className="listino-table"><caption>Marchi installati, disattivati e rimossi</caption>
      <thead><tr><th>Marchio</th><th>Stato</th><th>Articoli</th><th>A listino</th><th>Emittenti · listini · validità</th><th>Azioni</th></tr></thead>
      <tbody>{rows.map(b=><tr key={b.id}><td><strong>{b.code}</strong>{b.name!==b.code?<><br/>{b.name}</>:null}</td>
        <td>{b.removed?"Dati rimossi":b.active?"Attivo":"Disattivato"}</td><td>{formatCount(b.products)}</td><td>{formatCount(b.listed)}</td><td>{b.issuers||"—"}</td>
        <td><div className="metel-actions"><button type="button" disabled={busy||b.removed} onClick={()=>{reset();void run("Aggiornamento stato marchio…",()=>api.setActive(b.id,!b.active));}}>{b.active?"Disattiva":"Riattiva"} {b.code}</button>
          <button type="button" disabled={busy||b.removed} onClick={()=>{reset();void run("Analisi dipendenze…",async()=>setPreview(await api.previewRemoval(b.id)));}}>Rimuovi dati {b.code}…</button></div></td></tr>)}</tbody>
    </table>
    {!busy&&!rows.length?<p>Nessun marchio corrispondente.</p>:null}
    {preview?<section className="metel-preview" aria-label="Anteprima rimozione">
      <h3>Rimuovi dati importati di {preview.brand.code}</h3>
      <p>{formatCount(preview.brand.products)} articoli, {formatCount(preview.prices)} prezzi storici e correnti, {formatCount(preview.families)} famiglie.</p>
      <p>Viene creato un backup verificato. Sono rimossi i dati commerciali del marchio presso tutti gli emittenti. Restano le identità minime per i progetti e la reimportazione, gli archivi originali e i backup. Gli altri marchi sono conservati.</p>
      {preview.blockers.length?<ul role="alert">{preview.blockers.map(reason=><li key={reason}>{reason}</li>)}</ul>:<>
        <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/> Confermo la rimozione dei dati di {preview.brand.code} dal catalogo locale.</label>
        <div className="metel-actions"><button type="button" disabled={busy||!confirmed} onClick={()=>void run("Rimozione dati…",async()=>{await api.remove(preview.token);reset();})}>Conferma rimozione {preview.brand.code}</button></div>
      </>}
      <button type="button" disabled={busy} onClick={reset}>Annulla rimozione</button>
    </section>:null}
    <p className="hint">Per reinstallare un marchio rimosso, importa nuovamente LSP, FSC e FST della fornitura corrente dell’emittente, oppure una nuova fornitura completa.</p>
  </ShellDialog>;
}
