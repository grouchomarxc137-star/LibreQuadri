import { describe, expect, it, vi } from "vitest";
import { parseConfigurationRequest, registerConfigurationIpc, type ConfigurationService } from "../src/main/catalogue/configuration-ipc.js";
import type { CatalogueInvokeEvent, IpcHandlerRegistry } from "../src/main/catalogue/catalogue-ipc.js";
import { CONFIGURATION_CHANNELS } from "../src/shared/configuration.js";

describe("configuration IPC",()=>{
  it("validates bounded local IDs and selections",()=>{
    expect(parseConfigurationRequest({modelId:1,selectedOptionIds:[2,3],productId:4}))
      .toEqual({modelId:1,selectedOptionIds:[2,3],productId:4});
    for(const value of [null,{}, {modelId:0,selectedOptionIds:[]},
      {modelId:1,selectedOptionIds:["2"]},{modelId:1,selectedOptionIds:Array(101).fill(2)},
      {modelId:1,selectedOptionIds:[],sql:"x"}])
      expect(()=>parseConfigurationRequest(value)).toThrow();
  });
  it("guards every channel before invoking the database service",()=>{
    const handlers=new Map<string,(event:CatalogueInvokeEvent,...args:unknown[])=>unknown>();
    const registry:IpcHandlerRegistry={handle:(channel,fn)=>{handlers.set(channel,fn);},
      removeHandler:(channel)=>{handlers.delete(channel);}};
    const service={browseRanges:vi.fn(()=>[]),nodeModels:vi.fn(()=>[]),productModels:vi.fn(()=>[]),
      modelByCode:vi.fn(()=>null),
      configurationModel:vi.fn(()=>({})),resolveConfiguration:vi.fn(()=>({})),
      offerSelection:vi.fn(()=>({status:"offer_stale"}))} as unknown as ConfigurationService;
    const cleanup=registerConfigurationIpc(registry,service,event=>event.senderFrame!==null);
    expect(handlers.size).toBe(7);
    for(const handler of handlers.values())expect(()=>handler({senderFrame:null},1)).toThrow("Untrusted IPC sender");
    expect(service.nodeModels).not.toHaveBeenCalled();
    expect(()=>handlers.get(CONFIGURATION_CHANNELS.nodeModels)!({senderFrame:{} as never},"1")).toThrow();
    handlers.get(CONFIGURATION_CHANNELS.nodeModels)!({senderFrame:{} as never},3);
    expect(service.nodeModels).toHaveBeenCalledWith(3);
    handlers.get(CONFIGURATION_CHANNELS.modelByCode)!({senderFrame:{} as never},"BTI","tq.pack.4395");
    expect(service.modelByCode).toHaveBeenCalledWith("BTI","tq.pack.4395");
    expect(() => handlers.get(CONFIGURATION_CHANNELS.modelByCode)!({senderFrame:{} as never},"", "model"))
      .toThrow("Invalid model identity");
    expect(() => handlers.get(CONFIGURATION_CHANNELS.offerSelection)!({senderFrame:{} as never},1,-1)).toThrow();
    handlers.get(CONFIGURATION_CHANNELS.offerSelection)!({senderFrame:{} as never},1,0);
    expect(service.offerSelection).toHaveBeenCalledWith(1,0);
    cleanup();expect(handlers.size).toBe(0);
  });
});
