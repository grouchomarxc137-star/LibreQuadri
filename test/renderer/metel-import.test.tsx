// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ListinoDialog } from "../../src/renderer/app/ShellDialogs.js";
import type { MetelImportApi, MetelImportPreview, MetelImportResult } from "../../src/shared/metel-import.js";

const preview:MetelImportPreview={token:"12345678-1234-1234-1234-123456789012",issuer:"AAA",listino:"1",validFrom:"2026-02-01",older:false,alreadyImported:false,
  files:[{name:"a",type:"LSP",rows:2,version:"020"},{name:"b",type:"FSC",rows:1,version:"020"},{name:"c",type:"FST",rows:1,version:"020"}],
  brands:["AAA"],addedProducts:1,updatedProducts:1,changedPrices:1,delistedListings:2,newlyUnlistedProducts:2,reactivatedListings:0,newBrands:0,changedFamilies:0,unknownFamilies:0,
  delistedExamples:["AAA / OLD"],warnings:["Verifica che il listino sia completo."]};
let host:HTMLDivElement,root:Root,api:MetelImportApi,close:()=>void;
let reportProgress:(message:string)=>void;
const button=(text:string)=>Array.from(host.querySelectorAll("button")).find(button=>button.textContent===text)!;
async function click(text:string){await act(async()=>button(text).click());}
function files(count=3,start=0):File[]{
  return Array.from({length:count},(_,index)=>{
    const file=new File(["test"],`source-${start+index}.txt`,{type:"text/plain"});
    Object.defineProperty(file,"arrayBuffer",{value:async()=>Uint8Array.of(1,2,3,4).buffer});
    return file;
  });
}
async function fill(count=3,start=0){
  const picker=host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(picker,"files",{value:files(count,start),configurable:true});
  await act(async()=>{picker.dispatchEvent(new Event("change",{bubbles:true}));});
}
function sourcePicker(index:number){return host.querySelector<HTMLInputElement>(`input[aria-label="File per Sorgente ${index+1}"]`)!;}
async function chooseSource(index:number,selected=files(1,index)){
  const picker=sourcePicker(index);
  Object.defineProperty(picker,"files",{value:selected,configurable:true});
  await act(async()=>{picker.dispatchEvent(new Event("change",{bubbles:true}));});
}
const sourceNames=()=>Array.from(host.querySelectorAll(".metel-source-name"),element=>element.textContent);
beforeEach(async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  host=document.createElement("div");document.body.append(host);root=createRoot(host);close=vi.fn();
  api={preview:vi.fn(async()=>preview),apply:vi.fn(async()=>({deliveryId:4,alreadyImported:false,becameCurrent:true,productCount:2,warnings:[]})),discard:vi.fn(async()=>undefined),onProgress:listener=>{reportProgress=listener;return ()=>undefined;}};
  await act(async()=>root.render(<ListinoDialog api={api} overview={null} onClose={close}/>));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
describe("METEL importer dialog",()=>{
  it("requires three inputs, a successful preview and explicit complete-list confirmation before applying",async()=>{
    expect(button("Verifica fornitura").disabled).toBe(true);
    await fill(1);expect(button("Verifica fornitura").disabled).toBe(true);
    await fill(2,1);await click("Verifica fornitura");
    expect(api.preview).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({kind:"file",name:"source-0.txt",bytes:Uint8Array.of(1,2,3,4)})]));
    expect(host.textContent).toContain("AAA / OLD");expect(button("Importa fornitura").disabled).toBe(true);
    await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click("Importa fornitura");expect(api.apply).toHaveBeenCalledWith(preview.token,false);
    expect(host.textContent).toContain("Catalogo aggiornato: 2 articoli");
    expect(host.textContent).toContain("prezzi già salvati nei progetti sono stati conservati");
  });
  it("invalidates an existing preview when a file is removed",async()=>{
    await fill();await click("Verifica fornitura");expect(button("Importa fornitura")).toBeDefined();
    const open=vi.spyOn(sourcePicker(2),"click");
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Rimuovi Sorgente 3"]')!.click());
    expect(open).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Importa fornitura");expect(api.apply).not.toHaveBeenCalled();
    expect(button("Verifica fornitura").disabled).toBe(true);
  });
  it("shows validation failure without an import action",async()=>{
    vi.mocked(api.preview).mockRejectedValueOnce(new Error("FSC: invalid line 2"));
    await fill();await click("Verifica fornitura");expect(host.querySelector('[role="alert"]')?.textContent).toContain("FSC: invalid line 2");
    expect(api.apply).not.toHaveBeenCalled();expect(host.textContent).not.toContain("Importa fornitura");
  });
  it("prevents closing and editing during verification, then permits closing after it settles",async()=>{
    let resolve!:(value:MetelImportPreview)=>void;
    vi.mocked(api.preview).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
    await fill();await click("Verifica fornitura");expect(button("Chiudi").disabled).toBe(true);
    const status=host.querySelector<HTMLElement>('footer [role="status"]')!;
    expect(status.textContent).toContain("Verifica fornitura…");
    expect(status.querySelector(".metel-operation-spinner")).not.toBeNull();
    expect(status.closest(".shell-dialog-body")).toBeNull();
    expect(host.querySelector('[aria-label="File della fornitura METEL"]')!.getAttribute("aria-busy")).toBe("true");
    await act(async()=>reportProgress("Simulazione aggiornamento prezzi, articoli e famiglie…"));
    expect(status.textContent).toContain("Simulazione aggiornamento prezzi, articoli e famiglie…");
    expect(button("Seleziona file…").disabled).toBe(true);
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>(".metel-source-select")).every(button=>button.disabled)).toBe(true);
    expect([0,1,2].every(index=>sourcePicker(index).disabled)).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Rimuovi Sorgente 1"]')!.disabled).toBe(true);
    await act(async()=>host.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
    expect(close).not.toHaveBeenCalled();await act(async()=>resolve(preview));
    expect(button("Chiudi").disabled).toBe(false);
    expect(status.textContent).toBe("");expect(status.querySelector(".metel-operation-spinner")).toBeNull();
    expect(host.querySelector('[aria-label="File della fornitura METEL"]')!.getAttribute("aria-busy")).toBe("false");
  });
  it("clears a stale plan on apply failure and requires a new verification",async()=>{
    vi.mocked(api.apply).mockRejectedValueOnce(new Error("Il catalogo è cambiato"));
    await fill();await click("Verifica fornitura");
    await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());await click("Importa fornitura");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("catalogo è cambiato");
    expect(host.textContent).not.toContain("Importa fornitura");expect(button("Verifica fornitura").disabled).toBe(false);
  });
  it("offers non-editable file cards and a standard button that opens the hidden native picker",async()=>{
    expect(host.querySelector("textarea, [contenteditable=true], input[type=text]")).toBeNull();
    const picker=host.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(picker.hidden).toBe(true);
    const pickers=Array.from(host.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    expect(pickers).toHaveLength(4);
    expect(pickers.every(input=>!input.hasAttribute("accept"))).toBe(true);
    const open=vi.spyOn(picker,"click");
    await click("Seleziona file…");expect(open).toHaveBeenCalledOnce();
    const paste=new Event("paste",{bubbles:true,cancelable:true});
    Object.defineProperty(paste,"clipboardData",{value:{files:[],getData:()=>"arbitrary text"}});
    await act(async()=>{host.querySelector('[aria-label="File della fornitura METEL"]')!.dispatchEvent(paste);});
    expect(paste.defaultPrevented).toBe(true);
    expect(host.textContent).toContain("0 di 3 file selezionati");
    expect(button("Verifica fornitura").disabled).toBe(true);
  });
  it.each(["paste","drop"])("retains file %s support",async type=>{
    const event=new Event(type,{bubbles:true,cancelable:true});
    Object.defineProperty(event,type==="paste"?"clipboardData":"dataTransfer",{value:{files:files()}});
    await act(async()=>{host.querySelector('[aria-label="File della fornitura METEL"]')!.dispatchEvent(event);});
    expect(host.textContent).toContain("3 di 3 file selezionati");
    expect(button("Verifica fornitura").disabled).toBe(false);
    await click("Verifica fornitura");
    expect(api.preview).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({kind:"file"})]));
  });
  it.each([0,1,2])("opens the single-file picker for card %s and fills only that card",async index=>{
    const openings=[0,1,2].map(card=>vi.spyOn(sourcePicker(card),"click"));
    const select=host.querySelector<HTMLButtonElement>(`button[aria-label="Seleziona file per Sorgente ${index+1}"]`)!;
    expect(select.tagName).toBe("BUTTON");expect(select.type).toBe("button");expect(select.tabIndex).toBe(0);
    expect(sourcePicker(index).multiple).toBe(false);
    await act(async()=>select.click());
    for(let card=0;card<3;card++)expect(openings[card]).toHaveBeenCalledTimes(card===index?1:0);
    await chooseSource(index);
    expect(sourceNames()).toEqual([0,1,2].map(card=>card===index?`source-${index}.txt`:"Nessun file selezionato"));
    expect(button("Verifica fornitura").disabled).toBe(true);
  });
  it("replaces one populated card in place and invalidates the preview, preserving the other files",async()=>{
    await fill();await click("Verifica fornitura");
    expect(host.querySelector('button[aria-label="Sostituisci file per Sorgente 2"]')).not.toBeNull();
    await chooseSource(1,files(1,7));
    expect(sourceNames()).toEqual(["source-0.txt","source-7.txt","source-2.txt"]);
    expect(host.textContent).not.toContain("Importa fornitura");expect(api.apply).not.toHaveBeenCalled();
    await click("Verifica fornitura");
    expect(vi.mocked(api.preview).mock.lastCall![0].map(input=>input.name)).toEqual(["source-0.txt","source-7.txt","source-2.txt"]);
  });
  it("keeps the existing file and preview when a per-card picker is cancelled",async()=>{
    await fill();await click("Verifica fornitura");
    await chooseSource(1,[]);
    expect(sourceNames()).toEqual(["source-0.txt","source-1.txt","source-2.txt"]);
    expect(button("Importa fornitura")).toBeDefined();
    expect(host.textContent).toContain("3 di 3 file selezionati");
  });
  it("shows loading immediately while reading a file and clears it when reading fails",async()=>{
    let reject!:(reason:Error)=>void;
    const file=new File(["data"],"unreadable.txt");
    Object.defineProperty(file,"arrayBuffer",{value:()=>new Promise<ArrayBuffer>((_,failed)=>{reject=failed;})});
    await chooseSource(0,[file]);
    const status=host.querySelector<HTMLElement>('footer [role="status"]')!;
    expect(status.textContent).toContain("Lettura dei file selezionati…");
    expect(status.querySelector(".metel-operation-spinner")).not.toBeNull();expect(button("Chiudi").disabled).toBe(true);
    await act(async()=>reject(new Error("Lettura non riuscita")));
    expect(status.textContent).toBe("");expect(status.querySelector(".metel-operation-spinner")).toBeNull();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Lettura non riuscita");
    expect(button("Chiudi").disabled).toBe(false);
  });
  it("clears the loading indication after a failed verification",async()=>{
    let reject!:(reason:Error)=>void;
    vi.mocked(api.preview).mockImplementationOnce(()=>new Promise((_,failed)=>{reject=failed;}));
    await fill();await click("Verifica fornitura");
    const status=host.querySelector<HTMLElement>('footer [role="status"]')!;
    expect(status.querySelector(".metel-operation-spinner")).not.toBeNull();
    await act(async()=>reject(new Error("Fornitura non valida")));
    expect(status.textContent).toBe("");expect(status.querySelector(".metel-operation-spinner")).toBeNull();
    expect(button("Chiudi").disabled).toBe(false);
  });
  it.each(["success","failure"])("keeps import stages visible until apply settles with %s",async outcome=>{
    let resolve!:(result:MetelImportResult)=>void,reject!:(reason:Error)=>void;
    vi.mocked(api.apply).mockImplementationOnce(()=>new Promise((done,failed)=>{resolve=done;reject=failed;}));
    await fill();await click("Verifica fornitura");
    await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click("Importa fornitura");
    const status=host.querySelector<HTMLElement>('footer [role="status"]')!;
    expect(status.textContent).toContain("Importazione in corso…");
    await act(async()=>reportProgress("Creazione backup del catalogo…"));
    expect(status.textContent).toContain("Creazione backup del catalogo…");
    expect(status.querySelector(".metel-operation-spinner")).not.toBeNull();
    await act(async()=>{
      if(outcome==="success")resolve({deliveryId:4,alreadyImported:false,becameCurrent:true,productCount:2,warnings:[]});
      else reject(new Error("Importazione non riuscita"));
    });
    expect(status.textContent).toBe("");expect(status.querySelector(".metel-operation-spinner")).toBeNull();
    expect(button("Chiudi").disabled).toBe(false);
    expect(host.textContent).toContain(outcome==="success"?"Catalogo aggiornato: 2 articoli":"Importazione non riuscita");
  });
});
