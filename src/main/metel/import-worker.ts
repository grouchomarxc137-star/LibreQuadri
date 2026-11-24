import { parentPort, workerData } from "node:worker_threads";
import { MetelImportSession, type MetelSessionOptions } from "./import-session.js";
import type { MetelInput } from "../../shared/metel-import.js";

const session = new MetelImportSession(workerData as MetelSessionOptions, message => parentPort!.postMessage({progress:message}));
parentPort!.on("message", async (request: {id:number;action:"preview"|"apply"|"discard"|"close"|"brands"|"brand-active"|"brand-preview"|"brand-remove";inputs?:MetelInput[];token?:string;acceptOlder?:boolean;brandId?:number;active?:boolean}) => {
  try {
    if(request.action==="close"){session.close();parentPort!.close();return;}
    const result = request.action === "preview" ? await session.preview(request.inputs!)
      : request.action === "apply" ? session.apply(request.token!,request.acceptOlder!)
      : request.action === "brands" ? session.brands().list()
      : request.action === "brand-active" ? session.brands().setActive(request.brandId!,request.active!)
      : request.action === "brand-preview" ? session.brands().previewRemoval(request.brandId!)
      : request.action === "brand-remove" ? session.brands().remove(request.token!) : session.discard();
    parentPort!.postMessage({id:request.id,result});
  } catch (error) {
    parentPort!.postMessage({id:request.id,error:error instanceof Error ? error.message : String(error)});
  }
});
parentPort!.on("close",()=>session.close());
