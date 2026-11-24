// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { BrandManagementDialog } from "../../src/renderer/app/BrandManagementDialog.js";
import type { BrandApi, BrandRemovalPreview } from "../../src/shared/brands.js";
let host:HTMLDivElement,root:Root,api:BrandApi;
const close=vi.fn(),update=vi.fn();
const brand={id:1,code:"AAA",name:"Alpha",active:true,removed:false,products:2,listed:1,issuers:"AAA · 1 · 2026-01-01"};
const preview:BrandRemovalPreview={token:"12345678-1234-1234-1234-123456789012",brand,prices:3,families:2,blockers:[]};
const button=(text:string)=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent===text)!;
const click=async(text:string)=>act(async()=>button(text).click());
beforeEach(async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);close.mockClear();update.mockClear();
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  api={list:vi.fn(async()=>[brand]),setActive:vi.fn(async()=>{}),previewRemoval:vi.fn(async()=>preview),remove:vi.fn(async()=>{})};
  await act(async()=>root.render(<BrandManagementDialog api={api} metel={{preview:vi.fn(),apply:vi.fn(),discard:vi.fn(),onProgress:()=>()=>{}}} onClose={close} onUpdate={update}/>));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it("requires a removal preview and explicit confirmation",async()=>{
  await click("Rimuovi dati AAA…");expect(api.remove).not.toHaveBeenCalled();
  expect(button("Conferma rimozione AAA").disabled).toBe(true);
  await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Conferma rimozione AAA");expect(api.remove).toHaveBeenCalledWith(preview.token);
  expect(host.querySelector('[aria-label="Anteprima rimozione"]')).toBeNull();
});
it("shows engineering blockers without offering removal",async()=>{
  vi.mocked(api.previewRemoval).mockResolvedValueOnce({...preview,blockers:["Modelli dipendenti: usa Disattiva."]});
  await click("Rimuovi dati AAA…");expect(host.querySelector('[role="alert"]')?.textContent).toContain("Modelli dipendenti");
  expect(button("Conferma rimozione AAA")).toBeUndefined();
  await click("Disattiva AAA");expect(api.setActive).toHaveBeenCalledWith(1,false);
});
it("keeps progress visible and blocks close/editing during removal",async()=>{
  let finish!:()=>void;vi.mocked(api.remove).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await click("Rimuovi dati AAA…");await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Conferma rimozione AAA");expect(button("Chiudi").disabled).toBe(true);
  expect(button("Disattiva AAA").disabled).toBe(true);expect(host.querySelector('[role="status"]')?.textContent).toContain("Rimozione");
  await act(async()=>host.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
  expect(close).not.toHaveBeenCalled();await act(async()=>finish());expect(button("Chiudi").disabled).toBe(false);
});
it("clears an expired removal plan after failure and requires a fresh preview",async()=>{
  vi.mocked(api.remove).mockRejectedValueOnce(new Error("Il catalogo è cambiato"));
  await click("Rimuovi dati AAA…");await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Conferma rimozione AAA");expect(host.querySelector('[role="alert"]')?.textContent).toContain("cambiato");
  expect(host.querySelector('[aria-label="Anteprima rimozione"]')).toBeNull();
});
