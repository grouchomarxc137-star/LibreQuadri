// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ConfigurationAddAction } from "../../src/renderer/configuration/ConfigurationScreen.js";
import { isOutOfCatalogue } from "../../src/shared/out-of-catalogue.js";
import { parseConfigurationRequest } from "../../src/main/catalogue/configuration-ipc.js";
import type { ConfigurationResult } from "../../src/shared/configuration.js";

const result = { status: "bom_incomplete", fingerprint: "technical", physical: {kind:"enclosure"}, commercialContribution: "articles",
  model: { name: "Cabling LAN", kind: "enclosure", active: true, obsolete: false },
  issues: [{ severity: "warning", code: "unresolved_article" }],
  bom: [{ brandMarchio: "LEG", manufacturerCode: "646760", productId: null, quantity: 1, currency: null }],
} as ConfigurationResult;

it("asks before adding, cancels without writing, and sends explicit acknowledgement only on confirmation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const add=vi.fn(async()=>{});
  try {
    await act(async()=>root.render(<ConfigurationAddAction projectOpen result={result} adding={false} error={null}
      request={{modelId:1,selectedOptionIds:[]}} onAdd={add} onAddingChange={()=>{}} onErrorChange={()=>{}}/>));
    const button=host.querySelector("button")!;
    expect(button.disabled).toBe(false);
    await act(async()=>button.click());
    expect(add).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Fuori catalogo"));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("LEG/646760"));
    confirm.mockReturnValue(true);
    await act(async()=>button.click());
    expect(add).toHaveBeenCalledExactlyOnceWith({modelId:1,selectedOptionIds:[],acceptOutOfCatalogue:true});
  } finally {await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});

it("does not relax engineering validity or accept malformed acknowledgement",()=>{
  expect(isOutOfCatalogue(result)).toBe(true);
  for(const changed of [{status:"invalid"},{status:"incomplete"},{physical:null},{fingerprint:null},
    {model:{...result.model,active:false}},{issues:[{code:"no_profile",severity:"warning"}]}]) {
    expect(isOutOfCatalogue({...result,...changed} as ConfigurationResult)).toBe(false);
  }
  expect(parseConfigurationRequest({modelId:1,selectedOptionIds:[],acceptOutOfCatalogue:true})).toEqual({modelId:1,selectedOptionIds:[],acceptOutOfCatalogue:true});
  expect(()=>parseConfigurationRequest({modelId:1,selectedOptionIds:[],acceptOutOfCatalogue:"yes"})).toThrow();
});
