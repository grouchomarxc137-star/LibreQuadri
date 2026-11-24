import { describe, expect, it, vi } from "vitest";
import { registerMetelImportIpc } from "../src/main/metel/import-ipc.js";
import { METEL_IMPORT_CHANNELS } from "../src/shared/metel-import.js";

function setup(trusted=true){
  const listeners=new Map<string,(event:never,...args:unknown[])=>unknown>();
  const service={preview:vi.fn(),apply:vi.fn(),discard:vi.fn()};
  registerMetelImportIpc({handle:(channel,listener)=>listeners.set(channel,listener),removeHandler:()=>undefined},service,()=>trusted);
  const call=(channel:string,...args:unknown[])=>listeners.get(channel)!({} as never,...args);
  return {service,call};
}
describe("METEL IPC boundary",()=>{
  it("rejects every untrusted entry point before invoking a service",()=>{
    const {service,call}=setup(false);
    for(const channel of [METEL_IMPORT_CHANNELS.preview,METEL_IMPORT_CHANNELS.apply,METEL_IMPORT_CHANNELS.discard])expect(()=>call(channel)).toThrow("Untrusted");
    expect(service.preview).not.toHaveBeenCalled();expect(service.apply).not.toHaveBeenCalled();expect(service.discard).not.toHaveBeenCalled();
  });
  it("rejects malformed payloads and requires a token plus an explicit boolean",()=>{
    const {service,call}=setup();
    expect(()=>call(METEL_IMPORT_CHANNELS.preview,[{name:"secret",path:"/private/file"}])).toThrow();
    expect(()=>call(METEL_IMPORT_CHANNELS.apply,"../path",true)).toThrow();
    expect(()=>call(METEL_IMPORT_CHANNELS.apply,"12345678-1234-1234-1234-123456789012","yes")).toThrow();
    expect(service.preview).not.toHaveBeenCalled();expect(service.apply).not.toHaveBeenCalled();
  });
});
