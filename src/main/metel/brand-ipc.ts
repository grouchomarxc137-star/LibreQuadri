import { BRAND_CHANNELS, type BrandApi } from "../../shared/brands.js";
import type { CatalogueInvokeEvent, IpcHandlerRegistry } from "../catalogue/catalogue-ipc.js";

export function registerBrandIpc(registry: IpcHandlerRegistry, api: BrandApi,
  trusted: (event: CatalogueInvokeEvent) => boolean): void {
  const check=(event: CatalogueInvokeEvent)=>{if(!trusted(event))throw new Error("Untrusted IPC sender");};
  const id=(value:unknown)=>{if(typeof value!=="number"||!Number.isSafeInteger(value)||value<1)throw new Error("Marchio non valido.");return value;};
  registry.handle(BRAND_CHANNELS.list,event=>{check(event);return api.list();});
  registry.handle(BRAND_CHANNELS.setActive,(event,value,active)=>{
    check(event);if(typeof active!=="boolean")throw new Error("Stato marchio non valido.");
    return api.setActive(id(value),active);
  });
  registry.handle(BRAND_CHANNELS.previewRemoval,(event,value)=>{check(event);return api.previewRemoval(id(value));});
  registry.handle(BRAND_CHANNELS.remove,(event,token)=>{
    check(event);if(typeof token!=="string"||!/^[a-f0-9-]{36}$/.test(token))throw new Error("Conferma rimozione non valida.");
    return api.remove(token);
  });
}
