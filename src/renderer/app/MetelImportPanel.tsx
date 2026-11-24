import { useEffect, useRef, useState } from "react";
import { METEL_MAX_SOURCE_BYTES, type MetelInput, type MetelImportApi, type MetelImportPreview, type MetelImportResult } from "../../shared/metel-import.js";
import { formatCount, formatIsoDate } from "../catalogue/formatting.js";
import { Icon } from "../ui/icons.js";

function message(error:unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,"") : String(error);
}
export function MetelImportPanel({api,onBusy,onProgress}:{readonly api:MetelImportApi;readonly onBusy:(busy:boolean)=>void;readonly onProgress?:(message:string)=>void}) {
  const [inputs,setInputs] = useState<(Extract<MetelInput,{kind:"file"}>|null)[]>([null,null,null]);
  const filePicker=useRef<HTMLInputElement>(null);
  const sourcePickers=useRef<(HTMLInputElement|null)[]>([]);
  const [preview,setPreview] = useState<MetelImportPreview|null>(null);
  const [result,setResult] = useState<MetelImportResult|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [confirmed,setConfirmed] = useState(false);
  const mounted=useRef(true);
  const reading=useRef(false);
  useEffect(()=>{
    mounted.current=true;
    const unsubscribe=api.onProgress(message=>{if(mounted.current)onProgress?.(message);});
    return ()=>{mounted.current=false;unsubscribe();void api.discard().catch(()=>undefined);};
  },[api,onProgress]);
  const startOperation=(message:string)=>{setBusy(true);onBusy(true);onProgress?.(message);};
  const finishOperation=()=>{setBusy(false);onBusy(false);onProgress?.("");};
  const resetPreview=()=>{setPreview(null);setResult(null);setConfirmed(false);setError(null);};
  const remove=(index:number)=>{
    resetPreview();setInputs(old=>old.map((value,i)=>i===index?null:value));
    void api.discard().catch(()=>undefined);
  };
  const loadFiles=async(files:FileList|File[],targetIndex?:number)=>{
    if(busy||reading.current)return;
    const selected=Array.from(files);
    if(!selected.length)return;
    if(targetIndex!==undefined && selected.length!==1){setError("Seleziona un solo file per questa sorgente.");return;}
    if(targetIndex===undefined && selected.length>inputs.filter(i=>!i).length){setError("Rimuovi prima le sorgenti da sostituire. Sono ammessi tre file in totale.");return;}
    if(selected.some(file=>file.size===0||file.size>METEL_MAX_SOURCE_BYTES)){setError("File vuoto o troppo grande (massimo 64 MiB per file).");return;}
    reading.current=true;startOperation("Lettura dei file selezionati…");resetPreview();
    try {
      const loaded=await Promise.all(selected.map(async file=>({kind:"file" as const,name:file.name,bytes:new Uint8Array(await file.arrayBuffer())})));
      if(mounted.current)setInputs(old=>{
        if(targetIndex!==undefined)return old.map((value,index)=>index===targetIndex?loaded[0]!:value);
        const queue=[...loaded];return old.map(value=>value??queue.shift()??null);
      });
      await api.discard();
    } catch(error){if(mounted.current)setError(message(error));}
    finally{reading.current=false;if(mounted.current)finishOperation();}
  };
  const verify=async()=>{
    if(inputs.some(i=>!i)||busy)return;
    resetPreview();startOperation("Verifica fornitura…");
    try{const next=await api.preview(inputs as MetelInput[]);if(mounted.current)setPreview(next);}
    catch(error){if(mounted.current)setError(message(error));}
    finally{if(mounted.current)finishOperation();}
  };
  const apply=async()=>{
    if(!preview||!confirmed||busy||preview.alreadyImported)return;
    startOperation("Importazione in corso…");setError(null);
    try{const next=await api.apply(preview.token,preview.older);if(mounted.current){setResult(next);setPreview(null);setConfirmed(false);}}
    catch(error){if(mounted.current){setError(message(error));setPreview(null);setConfirmed(false);}}
    finally{if(mounted.current)finishOperation();}
  };
  const labels=["Sorgente 1","Sorgente 2","Sorgente 3"];
  return <div className="metel-import" role="group" aria-label="File della fornitura METEL" aria-busy={busy} tabIndex={0} onDragOver={event=>{event.preventDefault();}}
    onDrop={event=>{event.preventDefault();void loadFiles(event.dataTransfer.files);}}
    onPaste={event=>{event.preventDefault();if(event.clipboardData.files.length)void loadFiles(event.clipboardData.files);}}>
    <p>Seleziona, trascina o incolla i tre file della stessa fornitura: listino <strong>LSP</strong>, famiglie di sconto <strong>FSC</strong> e famiglie statistiche <strong>FST</strong>. Il tipo viene riconosciuto dal contenuto.</p>
    <p className="hint">Clicca su una sorgente per scegliere o sostituire il suo file, oppure seleziona più file insieme. Il contenuto dei file non è modificabile. Sono supportati i tracciati 020 e 021, in Windows-1252, con prezzi EUR.</p>
    <div className="metel-file-picker">
      <input ref={filePicker} type="file" multiple hidden disabled={busy} onChange={event=>{if(event.target.files)void loadFiles(event.target.files);event.target.value="";}} />
      <button type="button" disabled={busy} onClick={()=>filePicker.current?.click()}><Icon name="folderOpen" />Seleziona file…</button>
      <span className="hint">{inputs.filter(Boolean).length} di 3 file selezionati</span>
    </div>
    <div className="metel-sources">{inputs.map((input,index)=><section className="metel-source" data-loaded={!!input} aria-label={labels[index]} key={index}>
      <input ref={element=>{sourcePickers.current[index]=element;}} type="file" hidden disabled={busy}
        aria-label={`File per ${labels[index]}`} onChange={event=>{if(event.target.files)void loadFiles(event.target.files,index);event.target.value="";}} />
      <button type="button" className="metel-source-select" disabled={busy} aria-label={`${input?"Sostituisci":"Seleziona"} file per ${labels[index]}`}
        onClick={()=>sourcePickers.current[index]?.click()}>
        <span className="metel-source-label">{labels[index]}</span>
        <span className="metel-source-file"><Icon name="file" /><span>
          <span className="metel-source-name" title={input?.name}>{input?.name??"Nessun file selezionato"}</span>
          <span className="hint">{input?`${formatCount(Math.max(1,Math.ceil(input.bytes.byteLength/1024)))} KB · Clicca per sostituire`:"Clicca per scegliere un file"}</span>
        </span></span>
      </button>
      <div className="metel-source-footer"><button type="button" disabled={busy||!input} onClick={()=>remove(index)} aria-label={`Rimuovi ${labels[index]}`}>Rimuovi</button></div>
    </section>)}</div>
    <div className="metel-actions"><button type="button" disabled={busy||inputs.some(i=>!i)} onClick={()=>void verify()}>Verifica fornitura</button></div>
    {error?<p role="alert" className="metel-error">{error} Ripeti la verifica per controllare lo stato della fornitura.</p>:null}
    {preview?<MetelPreview preview={preview} confirmed={confirmed} onConfirm={setConfirmed} busy={busy} onApply={()=>void apply()} />:null}
    {result?<div role="status"><div className="metel-success">
      <p>{result.alreadyImported?"Fornitura già importata. Nessuna modifica.":result.becameCurrent?`Catalogo aggiornato: ${formatCount(result.productCount)} ${result.productCount===1?"articolo":"articoli"}. Fornitura n. ${result.deliveryId}.`:`Storico prezzi importato. Fornitura n. ${result.deliveryId}. Il listino corrente è stato conservato.`}</p>
      <p>I dati e i prezzi già salvati nei progetti sono stati conservati.</p>
      </div>{result.warnings.map(warning=><p className="metel-warning" key={warning}>{warning}</p>)}
    </div>:null}
  </div>;
}

export function MetelPreview({preview,confirmed,onConfirm,busy,onApply}:{readonly preview:MetelImportPreview;readonly confirmed:boolean;readonly onConfirm:(checked:boolean)=>void;readonly busy:boolean;readonly onApply:()=>void}) {
  const rows:[string,number][]=[
    ["Nuovi articoli",preview.addedProducts],["Articoli con dati METEL aggiornati",preview.updatedProducts],["Prezzi modificati",preview.changedPrices],
    ["Articoli assenti dal listino dell’emittente",preview.delistedListings],["Articoli che diventano fuori catalogo",preview.newlyUnlistedProducts],
    ["Articoli riattivati nel listino",preview.reactivatedListings],["Nuovi marchi",preview.newBrands],["Famiglie nuove o aggiornate",preview.changedFamilies],
  ];
  return <section className="metel-preview" aria-label="Anteprima importazione">
    <h3>{preview.issuer} · listino {preview.listino} · dal {formatIsoDate(preview.validFrom)}</h3>
    <p>Marchi nel listino: {preview.brands.join(", ")}</p>
    <table className="listino-table"><caption>Tipi riconosciuti dal contenuto</caption><thead><tr><th>Sorgente</th><th>Tipo</th><th>Tracciato</th><th>Righe</th></tr></thead>
      <tbody>{preview.files.map(file=><tr key={file.type}><td>{file.name}</td><td>{file.type}</td><td>{file.version}</td><td className="numeric">{formatCount(file.rows)}</td></tr>)}</tbody></table>
    {preview.alreadyImported?<p role="status">Questa fornitura è già stata importata. Nessuna modifica.</p>:<>
      <dl className="properties-list">{rows.map(([label,count])=><div key={label}><dt>{label}</dt><dd>{formatCount(count)}</dd></div>)}</dl>
      {preview.warnings.map(warning=><p className="metel-warning" key={warning}>{warning}</p>)}
      {preview.delistedExamples.length?<details><summary>Esempi di articoli assenti dall’LSP</summary><ul>{preview.delistedExamples.map(code=><li key={code}>{code}</li>)}</ul></details>:null}
      <p className="hint">L’importazione aggiorna il catalogo locale. I progetti esistenti mantengono i propri dati e prezzi. Un articolo è fuori catalogo quando non risulta più a listino presso alcun emittente; non viene eliminato.</p>
      <label className="metel-confirm"><input type="checkbox" disabled={busy} checked={confirmed} onChange={event=>onConfirm(event.target.checked)} />
        {preview.older?"Confermo l’importazione del solo storico prezzi della fornitura più vecchia.":"Confermo che l’LSP è un listino completo e autorizzo le modifiche indicate, inclusi gli articoli fuori catalogo."}</label>
      <div className="metel-actions"><button type="button" className="primary" disabled={busy||!confirmed} onClick={onApply}>{preview.older?"Importa nello storico":"Importa fornitura"}</button></div>
    </>}
  </section>;
}
