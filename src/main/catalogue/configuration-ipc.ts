import type {
  ConfigurationRequest, ConfigurationResult, ConfigModelDetail, ConfigModelSummary,
  ProductModelEntry, RangeNode,
} from "../../shared/configuration.js";
import { CONFIGURATION_CHANNELS } from "../../shared/configuration.js";
import type { CatalogueInvokeEvent, IpcHandlerRegistry } from "./catalogue-ipc.js";

export interface ConfigurationService {
  browseRanges(brandMarchio?:string):RangeNode[];
  nodeModels(nodeId:number):ConfigModelSummary[];
  productModels(productId:number):ProductModelEntry[];
  modelByCode(brandMarchio:string,modelCode:string):ConfigModelSummary|null;
  configurationModel(modelId:number):ConfigModelDetail;
  resolveConfiguration(request:ConfigurationRequest):ConfigurationResult;
  offerSelection(modelId:number,offerNo:number):{status:"ready";selectedOptionIds:number[]}|{status:"offer_stale"};
}
function object(value:unknown,allowed:string[]):Record<string,unknown> {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid configuration request");
  const row=value as Record<string,unknown>;
  if(Object.keys(row).some(key=>!allowed.includes(key)))throw new Error("Unexpected configuration field");
  return row;
}
function id(value:unknown):number {
  if(typeof value!=="number"||!Number.isSafeInteger(value)||value<=0)
    throw new Error("Invalid configuration ID");
  return value;
}
export function parseConfigurationRequest(value:unknown):ConfigurationRequest {
  const row=object(value,["modelId","selectedOptionIds","productId","acceptOutOfCatalogue"]);
  if(row.acceptOutOfCatalogue!==undefined&&typeof row.acceptOutOfCatalogue!=="boolean")throw new Error("Invalid catalogue acknowledgement");
  const selected=row.selectedOptionIds;
  if(!Array.isArray(selected)||selected.length>100||selected.some(item=>
    typeof item!=="number"||!Number.isSafeInteger(item)||item<=0))
    throw new Error("Invalid configuration selections");
  return {modelId:id(row.modelId),selectedOptionIds:selected as number[],
    ...(row.acceptOutOfCatalogue===true?{acceptOutOfCatalogue:true}:{}),
    ...(row.productId===undefined?{}:{productId:id(row.productId)})};
}
export function registerConfigurationIpc(registry:IpcHandlerRegistry,service:ConfigurationService,
  trusted:(event:CatalogueInvokeEvent)=>boolean):()=>void {
  const guard=(event:CatalogueInvokeEvent)=>{if(!trusted(event))throw new Error("Untrusted IPC sender");};
  registry.handle(CONFIGURATION_CHANNELS.ranges,(event,value)=>{
    guard(event);
    if(value!==undefined&&(typeof value!=="string"||value.length<1||value.length>20))
      throw new Error("Invalid brand code");
    return service.browseRanges(value as string|undefined);
  });
  registry.handle(CONFIGURATION_CHANNELS.nodeModels,(event,value)=>{
    guard(event);return service.nodeModels(id(value));
  });
  registry.handle(CONFIGURATION_CHANNELS.productModels,(event,value)=>{
    guard(event);return service.productModels(id(value));
  });
  registry.handle(CONFIGURATION_CHANNELS.modelByCode,(event,brand,code)=>{
    guard(event);
    if(typeof brand!=="string"||!brand||brand.length>20||typeof code!=="string"||!code||code.length>100)
      throw new Error("Invalid model identity");
    return service.modelByCode(brand,code);
  });
  registry.handle(CONFIGURATION_CHANNELS.model,(event,value)=>{
    guard(event);return service.configurationModel(id(value));
  });
  registry.handle(CONFIGURATION_CHANNELS.resolve,(event,value)=>{
    guard(event);return service.resolveConfiguration(parseConfigurationRequest(value));
  });
  registry.handle(CONFIGURATION_CHANNELS.offerSelection,(event,modelId,offerNo)=>{
    guard(event);
    if(typeof offerNo!=="number"||!Number.isSafeInteger(offerNo)||offerNo<0)
      throw new Error("Invalid offer number");
    return service.offerSelection(id(modelId),offerNo);
  });
  return ()=>{for(const channel of Object.values(CONFIGURATION_CHANNELS))registry.removeHandler(channel);};
}
