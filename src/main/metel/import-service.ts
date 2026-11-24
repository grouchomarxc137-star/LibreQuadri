import { Worker } from "node:worker_threads";
import type { MetelImportPreview, MetelImportResult, MetelInput } from "../../shared/metel-import.js";
import type { MetelSessionOptions } from "./import-session.js";
import type { ManagedBrand, BrandRemovalPreview } from "../../shared/brands.js";

/** One pending operation and one retained preview per application process. */
export class MetelImportService {
  private worker: Worker | undefined;
  private pending: {id:number;resolve:(result:unknown)=>void;reject:(error:Error)=>void} | undefined;
  private nextId = 0;
  applying = false;
  get busy(): boolean { return !!this.pending; }
  brandList(): Promise<readonly ManagedBrand[]> { return this.request("brands",{}) as Promise<ManagedBrand[]>; }
  previewBrandRemoval(brandId:number): Promise<BrandRemovalPreview> { return this.request("brand-preview",{brandId}) as Promise<BrandRemovalPreview>; }
  async mutateBrand(action:"brand-active"|"brand-remove",payload:object): Promise<void> {
    if(this.busy)throw new Error("Operazione catalogo in corso. Attendi il completamento.");
    this.applying=true;
    try { await this.request(action,payload); } finally {this.applying=false;}
  }
  constructor(private readonly options: MetelSessionOptions, private readonly progress: (message:string)=>void) {}
  preview(inputs: readonly MetelInput[]): Promise<MetelImportPreview> { return this.request("preview",{inputs}) as Promise<MetelImportPreview>; }
  async apply(token:string,acceptOlder:boolean): Promise<MetelImportResult> {
    if (this.busy) throw new Error("Importazione in corso. Attendi il completamento.");
    this.applying = true;
    try { return await this.request("apply",{token,acceptOlder}) as MetelImportResult; }
    finally { this.applying = false; }
  }
  async discard(): Promise<void> { if (this.worker) await this.request("discard",{}); }
  private request(action:string,payload:object): Promise<unknown> {
    if (this.busy) return Promise.reject(new Error("Importazione in corso. Attendi il completamento."));
    if (!this.worker) {
      const worker = new Worker(new URL("./import-worker.js",import.meta.url),{workerData:this.options});
      this.worker = worker;
      worker.unref();
      worker.on("message",message=>{
        if (typeof message.progress === "string") { this.progress(message.progress); return; }
        if (!this.pending || this.pending.id !== message.id) return;
        const pending = this.pending; this.pending=undefined;
        if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result);
      });
      const failed = (error:Error) => {
        if (this.worker !== worker) return;
        const pending=this.pending;this.pending=undefined;this.worker=undefined;
        pending?.reject(error);
      };
      worker.once("error",failed);
      worker.once("exit",code=>failed(new Error(`Il processo di importazione si è chiuso (${code}). Ripeti la verifica; un aggiornamento non concluso viene annullato da SQLite.`)));
    }
    return new Promise((resolve,reject)=>{
      const id=++this.nextId;this.pending={id,resolve,reject};
      try { this.worker!.postMessage({id,action,...payload}); }
      catch (error) {this.pending=undefined;reject(error);}
    });
  }
  close(): void {
    if (this.busy) throw new Error("Non è possibile chiudere un’importazione in corso.");
    const worker=this.worker;this.worker=undefined;
    worker?.postMessage({id:++this.nextId,action:"close"});
  }
}
