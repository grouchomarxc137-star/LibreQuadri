import { METEL_IMPORT_CHANNELS, type MetelInput, type MetelImportPreview, type MetelImportResult } from "../../shared/metel-import.js";
import type { IpcHandlerRegistry, CatalogueInvokeEvent } from "../catalogue/catalogue-ipc.js";
import { validateMetelInputs } from "./import-input.js";

export interface MetelIpcService {
  preview(inputs: readonly MetelInput[]): Promise<MetelImportPreview>;
  apply(token:string,acceptOlder:boolean): Promise<MetelImportResult>;
  discard(): Promise<void>;
}
export function registerMetelImportIpc(registry:IpcHandlerRegistry,service:MetelIpcService,trusted:(event:CatalogueInvokeEvent)=>boolean): void {
  const check=(event:CatalogueInvokeEvent)=>{if(!trusted(event))throw new Error("Untrusted IPC sender");};
  registry.handle(METEL_IMPORT_CHANNELS.preview,(event,input)=>{check(event);return service.preview(validateMetelInputs(input));});
  registry.handle(METEL_IMPORT_CHANNELS.apply,(event,token,acceptOlder)=>{
    check(event);
    if(typeof token!=="string" || !/^[a-f0-9-]{36}$/.test(token) || typeof acceptOlder!=="boolean")throw new Error("Conferma importazione non valida.");
    return service.apply(token,acceptOlder);
  });
  registry.handle(METEL_IMPORT_CHANNELS.discard,event=>{check(event);return service.discard();});
}
