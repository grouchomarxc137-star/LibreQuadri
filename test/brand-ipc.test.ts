import { expect, it, vi } from "vitest";
import { BRAND_CHANNELS } from "../src/shared/brands.js";
import { registerBrandIpc } from "../src/main/metel/brand-ipc.js";
function setup(trusted=true) {
  const handlers=new Map<string,(event:never,...args:unknown[])=>unknown>();
  const api={list:vi.fn(),setActive:vi.fn(),previewRemoval:vi.fn(),remove:vi.fn()};
  registerBrandIpc({handle:(channel,fn)=>handlers.set(channel,fn),removeHandler:()=>{}},api,()=>trusted);
  return {api,call:(channel:string,...args:unknown[])=>handlers.get(channel)!({} as never,...args)};
}
it("rejects every untrusted brand-management entry point",()=>{
  const {api,call}=setup(false);
  for(const channel of Object.values(BRAND_CHANNELS)) expect(()=>call(channel)).toThrow("Untrusted");
  for(const fn of Object.values(api))expect(fn).not.toHaveBeenCalled();
});
it("validates IDs, activation booleans and removal tokens before service calls",()=>{
  const {api,call}=setup();
  for(const value of [0,-1,1.5,NaN,"1",{},Number.MAX_SAFE_INTEGER+1]) {
    expect(()=>call(BRAND_CHANNELS.setActive,value,true)).toThrow();
    expect(()=>call(BRAND_CHANNELS.previewRemoval,value)).toThrow();
  }
  expect(()=>call(BRAND_CHANNELS.setActive,1,"false")).toThrow();
  expect(()=>call(BRAND_CHANNELS.remove,"../file")).toThrow();
  for(const fn of Object.values(api))expect(fn).not.toHaveBeenCalled();
  call(BRAND_CHANNELS.setActive,1,false);expect(api.setActive).toHaveBeenCalledWith(1,false);
});
