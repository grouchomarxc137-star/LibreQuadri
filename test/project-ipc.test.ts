import { describe, expect, it, vi } from "vitest";

import { ProjectLifecycleOperationGuard, registerProjectIpc, type ProjectFileDialogs, type ProjectIpcRegistry, type ProjectInvokeEvent } from "../src/main/project/project-ipc.js";
import { ProjectSaveError, type ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { PROJECT_CHANNELS, type ProjectDocumentView } from "../src/shared/project.js";

const view: ProjectDocumentView = {
  documentName: "Client.lqp", revision: 1, dirty: false, lines: [], configuredItems: [], distinta: [], physicalNodes: [], annotations: [],
  metadata: { uuid: "10000000-0000-4000-8000-000000000001", title: "Client", description: "", notes: "",
    projectType: "civil", normCode: "CEI EN 60898", executor: "", date: "2026-09-22",
    companyName: "Cliente", companyDescription: "" },
};

function setup(options: { readonly dirty?: boolean;readonly trusted?:boolean } = {}) {
  const handlers = new Map<string, (event: ProjectInvokeEvent, ...args: unknown[]) => unknown>();
  const registry: ProjectIpcRegistry = {
    handle: (channel, listener) => { handlers.set(channel, listener); },
    removeHandler: (channel) => { handlers.delete(channel); },
  };
  const currentView = options.dirty ? { ...view, dirty: true } : view;
  const service = {
    assertReplacementAllowed: vi.fn(() => { if (options.dirty) throw new Error("dirty"); }),
    create: vi.fn(async () => view), open: vi.fn(() => view), save: vi.fn(async () => view),
    saveAs: vi.fn(async () => view), retryPendingSave: vi.fn(async () => view), cancelPendingSave: vi.fn(),
    closeCurrent: vi.fn(),
    engineeringStatus:vi.fn(()=>({items:[],counts:{}})), planEngineeringRefresh:vi.fn(()=>({token:"a".repeat(64)})),
    applyEngineeringRefresh:vi.fn(()=>view),
    current: vi.fn(() => currentView), addCatalogueProduct: vi.fn(() => view),
    addConfiguredItem: vi.fn(() => view), duplicateConfiguredItem: vi.fn(() => view),
    replaceConfiguredItem: vi.fn(() => view), reconfigureEnclosure: vi.fn(() => view),
    setQuantity: vi.fn(() => view),
    referenceDevices:vi.fn(()=>({status:"ready",candidates:[],nodes:[],staleImportIds:[],contextDataUnavailable:0})),
    compatiblePanels:vi.fn(()=>({reference:{ok:true,code:"compatible"},navigation:{status:"ready",candidates:[],nodes:[]}})),
    checkPanelReference:vi.fn(()=>({ok:true,code:"compatible"})),
    designDiscover: vi.fn(() => ({status:"ready",candidates:[],staleImportIds:[],contextDataUnavailable:0})),
    addStructural: vi.fn(() => view),
    designNavigation: vi.fn(() => ({status:"ready",candidates:[],staleImportIds:[],contextDataUnavailable:0,nodes:[]})),
    placeStructuralItem: vi.fn(() => view),
    removeLine: vi.fn(() => view), removeLines: vi.fn(() => view), discardCurrent: vi.fn(),
    checkPackedChild: vi.fn(() => ({ok:true})),
    placementTargets: vi.fn(() => ({targets:[],diagnostics:[]})),
    autoPlaceItem: vi.fn(() => view),
    canDuplicatePlacedItem: vi.fn(() => true), duplicatePlacedItem: vi.fn(() => view),
    insertPackedChild: vi.fn(() => view), reorderPackedNode: vi.fn(() => view),
    movePackedNode: vi.fn(() => view),
    removePackedNode: vi.fn(() => view),
    removePhysicalRoot: vi.fn(() => view),
    unplaceSubtree: vi.fn(() => view),
  } as unknown as ProjectDocumentService;
  const dialogs: ProjectFileDialogs = {
    chooseDestination: vi.fn(async () => "/private/customer/Client.lqp"),
    chooseSaveAsDestination: vi.fn(async () => "/private/customer/Client copy.lqp"),
    chooseProjectToOpen: vi.fn(async () => "/private/customer/Client.lqp"),
    confirmDirtyClose: vi.fn(async () => "cancel" as const),
    resolveSaveConflict: vi.fn(async () => "cancel" as const),
    resolveSaveFailure: vi.fn(async () => "cancel" as const),
  };
  const lifecycle = new ProjectLifecycleOperationGuard();
  registerProjectIpc(registry, service, dialogs, () => options.trusted!==false, lifecycle);
  return { handlers, service, dialogs, lifecycle };
}

const event: ProjectInvokeEvent = { senderFrame: {} };
const metadata = { title: "Client", description: "", notes: "", projectType: "civil", executor: "",
  date: "2026-09-22", companyName: "Cliente", companyDescription: "" } as const;

describe("project IPC path boundary", () => {
  it("rejects untrusted reference reads before dispatch",()=>{
    const {handlers,service}=setup({trusted:false});
    for(const channel of [PROJECT_CHANNELS.referenceDevices,PROJECT_CHANNELS.compatiblePanels,PROJECT_CHANNELS.checkPanelReference])
      expect(()=>handlers.get(channel)!(event,{})).toThrow("Untrusted IPC sender");
    expect(service.referenceDevices).not.toHaveBeenCalled();expect(service.compatiblePanels).not.toHaveBeenCalled();
    expect(service.checkPanelReference).not.toHaveBeenCalled();
  });

  it("validates every reference read and add field, rejecting forged results and out-of-scope adds",()=>{
    const {handlers,service}=setup();
    const parentUuid="10000000-0000-4000-8000-000000000002";
    const configuration={modelId:4,selectedOptionIds:[2]};
    const device={configuration,definitionFingerprint:"definition"};
    const input={parentUuid,device};
    expect(handlers.get(PROJECT_CHANNELS.referenceDevices)!(event,parentUuid)).toMatchObject({status:"ready"});
    expect(service.referenceDevices).toHaveBeenCalledWith(parentUuid);
    expect(()=>handlers.get(PROJECT_CHANNELS.referenceDevices)!(event,"bad")).toThrow();
    const discover=handlers.get(PROJECT_CHANNELS.compatiblePanels)!;
    expect(discover(event,input)).toMatchObject({reference:{ok:true}});
    expect(service.compatiblePanels).toHaveBeenCalledWith(input);
    for(const bad of [null,[],{}, {...input,parentUuid:"bad"}, {...input,compatible:true},
      {...input,device:{...device,definitionFingerprint:""}}, {...input,device:{...device,physical:{}}},
      {...input,device:{...device,configuration:{...configuration,modelId:-1}}},
      {...input,device:{...device,configuration:{...configuration,selectedOptionIds:["2"]}}}])
      expect(()=>discover(event,bad)).toThrow();
    const check=handlers.get(PROJECT_CHANNELS.checkPanelReference)!;
    expect(check(event,{...input,panel:configuration})).toEqual({ok:true,code:"compatible"});
    expect(service.checkPanelReference).toHaveBeenCalledWith({...input,panel:configuration});
    for(const bad of [input,{...input,panel:{...configuration,price:0}}, {...input,panel:configuration,ok:true}])
      expect(()=>check(event,bad)).toThrow();
    const add=handlers.get(PROJECT_CHANNELS.addStructural)!;
    const valid={kind:"support",parentUuid,configuration,place:false,quantity:3,referenceDevice:device};
    expect(add(event,valid)).toEqual(view);expect(service.addStructural).toHaveBeenCalledWith(valid);
    for(const bad of [{...valid,kind:"device"},{...valid,place:true},{...valid,parentUuid:undefined},
      {...valid,referenceDevice:{...device,physical:{}}}])expect(()=>add(event,bad)).toThrow();
  });

  it("validates enclosure reconfiguration and serializes it with lifecycle operations",async()=>{
    const {handlers,service,lifecycle}=setup();
    const handler=handlers.get(PROJECT_CHANNELS.reconfigureEnclosure)!;
    const uuid="10000000-0000-4000-8000-000000000002",request={modelId:1,selectedOptionIds:[2]};
    expect(()=>handler(event,"bad",request)).toThrow();
    expect(()=>handler(event,uuid,{...request,price:0})).toThrow();
    expect(await handler(event,uuid,request)).toEqual(view);
    expect(service.reconfigureEnclosure).toHaveBeenCalledWith(uuid,request);
    let finish!:()=>void;
    const pending=lifecycle.run(()=>new Promise<void>(resolve=>{finish=resolve;}));
    await Promise.resolve();
    await expect(handler(event,uuid,request)).rejects.toThrow("già in corso");
    finish();await pending;
  });
  it("validates structural discovery and add requests before service dispatch",()=>{
    const {handlers,service}=setup();
    const root="10000000-0000-4000-8000-000000000002";
    const discover=handlers.get(PROJECT_CHANNELS.designDiscover)!;
    expect(discover(event,"support",root)).toMatchObject({status:"ready"});
    expect(service.designDiscover).toHaveBeenCalledWith("support",root);
    expect(()=>discover(event,"support","bad")).toThrow();
    expect(()=>discover(event,"accessory")).toThrow();
    expect(discover(event,"device",root)).toMatchObject({status:"ready"});
    expect(service.designDiscover).toHaveBeenLastCalledWith("device",root);
    const add=handlers.get(PROJECT_CHANNELS.addStructural)!;
    expect(add(event,{kind:"support",parentUuid:root,configuration:{modelId:2,
      selectedOptionIds:[3]}})).toEqual(view);
    expect(service.addStructural).toHaveBeenCalledWith({kind:"support",parentUuid:root,
      configuration:{modelId:2,selectedOptionIds:[3]}});
    expect(()=>add(event,{kind:"support",configuration:{modelId:2,selectedOptionIds:[]},
      price:0})).toThrow();
    expect(()=>add(event,{kind:"support",configuration:{modelId:2,selectedOptionIds:[]},
      zoneNo:-1})).toThrow();
  });
  it("validates and dispatches design navigation, unplaced structural add and guarded structural placement",()=>{
    const {handlers,service}=setup();
    const root="10000000-0000-4000-8000-000000000002";
    const itemUuid="10000000-0000-4000-8000-000000000003";
    const navigate=handlers.get(PROJECT_CHANNELS.designNavigation)!;
    expect(navigate(event,"support",root)).toMatchObject({status:"ready",nodes:[]});
    expect(service.designNavigation).toHaveBeenLastCalledWith("support",root);
    expect(navigate(event,"enclosure")).toMatchObject({status:"ready"});
    expect(service.designNavigation).toHaveBeenLastCalledWith("enclosure",undefined);
    expect(navigate(event,"device",root)).toMatchObject({status:"ready"});
    expect(service.designNavigation).toHaveBeenLastCalledWith("device",root);
    for(const bad of [["accessory"],["support","bad"],["accessory",root],[undefined]])
      expect(()=>navigate(event,...bad)).toThrow();
    const add=handlers.get(PROJECT_CHANNELS.addStructural)!;
    const configuration={modelId:2,selectedOptionIds:[]};
    expect(add(event,{kind:"support",parentUuid:root,configuration,place:false})).toEqual(view);
    expect(service.addStructural).toHaveBeenLastCalledWith({kind:"support",parentUuid:root,configuration,place:false});
    expect(add(event,{kind:"device",parentUuid:root,configuration,place:false})).toEqual(view);
    expect(service.addStructural).toHaveBeenLastCalledWith({kind:"device",parentUuid:root,configuration,place:false});
    expect(()=>add(event,{kind:"accessory",parentUuid:root,configuration,place:false})).toThrow();
    for(const bad of ["no",0,null])
      expect(()=>add(event,{kind:"support",parentUuid:root,configuration,place:bad})).toThrow();
    // A Pannello add may carry a whole quantity from 1 to 99; anything else never reaches the service.
    for(const good of [1,2,99]){
      expect(add(event,{kind:"support",parentUuid:root,configuration,place:false,quantity:good})).toEqual(view);
      expect(service.addStructural).toHaveBeenLastCalledWith({kind:"support",parentUuid:root,configuration,place:false,quantity:good});
    }
    expect(add(event,{kind:"support",parentUuid:root,configuration,place:false,autoPlace:true})).toEqual(view);
    expect(service.addStructural).toHaveBeenLastCalledWith({kind:"support",parentUuid:root,configuration,place:false,autoPlace:true});
    const addCalls=vi.mocked(service.addStructural).mock.calls.length;
    for(const bad of [0,-3,100,2.5,Number.NaN,Number.POSITIVE_INFINITY,"2",null,{}])
      expect(()=>add(event,{kind:"support",parentUuid:root,configuration,place:false,quantity:bad}),String(bad)).toThrow();
    expect(vi.mocked(service.addStructural).mock.calls.length).toBe(addCalls);
    const place=handlers.get(PROJECT_CHANNELS.placeStructuralItem)!;
    const packed={itemUuid,parentUuid:root,zoneNo:0,viewCode:"front"};
    expect(place(event,{action:"insertPackedChild",input:packed})).toEqual(view);
    expect(service.placeStructuralItem).toHaveBeenLastCalledWith({action:"insertPackedChild",input:packed});
    expect(place(event,{action:"insertPackedChild",input:packed,index:1})).toEqual(view);
    expect(service.placeStructuralItem).toHaveBeenLastCalledWith({action:"insertPackedChild",input:packed,index:1});
    const child={itemUuid,parentUuid:root,zoneNo:0,viewCode:"front",startUnits:50};
    expect(place(event,{action:"placeChild",input:child})).toEqual(view);
    expect(service.placeStructuralItem).toHaveBeenLastCalledWith({action:"placeChild",input:child});
    const calls=(service.placeStructuralItem as unknown as {mock:{calls:unknown[]}}).mock.calls.length;
    for(const bad of [null,{action:"moveNode",input:child},{action:"insertPackedChild",input:packed,index:-1},
      {action:"insertPackedChild",input:{...packed,startUnits:0}},{action:"placeChild",input:child,index:0},
      {action:"placeChild",input:{itemUuid,viewCode:"front",rootXMm:0,rootYMm:0}},
      {action:"insertPackedChild",input:packed,extra:true},{action:"insertPackedChild",input:{...packed,parentUuid:"bad"}}])
      expect(()=>place(event,bad)).toThrow();
    expect((service.placeStructuralItem as unknown as {mock:{calls:unknown[]}}).mock.calls).toHaveLength(calls);
  });
  it("validates and dispatches zone-local ordered packing",()=>{
    const {handlers,service}=setup();
    const parentUuid="10000000-0000-4000-8000-000000000002";
    const itemUuid="10000000-0000-4000-8000-000000000003";
    const nodeUuid="10000000-0000-4000-8000-000000000004";
    const input={itemUuid,parentUuid,zoneNo:0,viewCode:"front"};
    const preview=handlers.get(PROJECT_CHANNELS.checkPackedChild)!;
    expect(preview(event,input)).toEqual({ok:true});
    expect(service.checkPackedChild).toHaveBeenCalledWith(input);
    expect(()=>preview(event,{...input,startUnits:0})).toThrow();
    const insert=handlers.get(PROJECT_CHANNELS.insertPackedChild)!;
    expect(insert(event,input)).toEqual(view);
    expect(service.insertPackedChild).toHaveBeenCalledWith(input,undefined);
    expect(insert(event,input,0)).toEqual(view);
    expect(service.insertPackedChild).toHaveBeenLastCalledWith(input,0);
    for(const bad of [-1,0.5,"1",null])expect(()=>insert(event,input,bad)).toThrow();
    expect(()=>insert(event,{...input,startUnits:0})).toThrow();
    expect(handlers.get(PROJECT_CHANNELS.reorderPackedNode)!(event,nodeUuid,1)).toEqual(view);
    expect(service.reorderPackedNode).toHaveBeenCalledWith(nodeUuid,1);
    expect(()=>handlers.get(PROJECT_CHANNELS.reorderPackedNode)!(event,nodeUuid,-1)).toThrow();
    expect(handlers.get(PROJECT_CHANNELS.removePackedNode)!(event,nodeUuid)).toEqual(view);
    expect(service.removePackedNode).toHaveBeenCalledWith(nodeUuid);
  });
  it("accepts exactly one item or node identity for automatic placement",()=>{
    const {handlers,service}=setup();
    const place=handlers.get(PROJECT_CHANNELS.autoPlaceItem)!;
    const uuid="10000000-0000-4000-8000-000000000003";
    for(const subject of [{itemUuid:uuid},{nodeUuid:uuid}]){
      expect(place(event,subject)).toEqual(view);
      expect(service.autoPlaceItem).toHaveBeenLastCalledWith(subject);
    }
    for(const subject of [null,{},["itemUuid"],{itemUuid:"bad"},{itemUuid:uuid,nodeUuid:uuid},{parentUuid:uuid}])
      expect(()=>place(event,subject)).toThrow();
    expect(service.autoPlaceItem).toHaveBeenCalledTimes(2);
  });
  it("validates the placed node UUID for duplication and its availability check",()=>{
    const {handlers,service}=setup();
    const uuid="10000000-0000-4000-8000-000000000003";
    const preview=handlers.get(PROJECT_CHANNELS.canDuplicatePlacedItem)!;
    const duplicate=handlers.get(PROJECT_CHANNELS.duplicatePlacedItem)!;
    expect(preview(event,uuid)).toBe(true);
    expect(duplicate(event,uuid)).toEqual(view);
    expect(service.canDuplicatePlacedItem).toHaveBeenCalledWith(uuid);
    expect(service.duplicatePlacedItem).toHaveBeenCalledWith(uuid);
    expect(()=>preview(event,"bad")).toThrow();
    expect(()=>duplicate(event,null)).toThrow();
    expect(service.canDuplicatePlacedItem).toHaveBeenCalledOnce();
    expect(service.duplicatePlacedItem).toHaveBeenCalledOnce();
  });
  it("validates and dispatches Pannello subtree unplacement",()=>{
    const {handlers,service}=setup();
    const nodeUuid="10000000-0000-4000-8000-000000000004";
    const unplace=handlers.get(PROJECT_CHANNELS.unplaceSubtree)!;
    expect(unplace(event,nodeUuid)).toEqual(view);
    expect(service.unplaceSubtree).toHaveBeenCalledWith(nodeUuid);
    for(const bad of [undefined,null,"","not-a-uuid",1])expect(()=>unplace(event,bad)).toThrow();
    expect(service.unplaceSubtree).toHaveBeenCalledTimes(1);
  });
  it("validates and dispatches whole-Carpenteria removal with an explicit contents choice",()=>{
    const {handlers,service}=setup();
    const nodeUuid="10000000-0000-4000-8000-000000000004";
    const remove=handlers.get(PROJECT_CHANNELS.removePhysicalRoot)!;
    expect(remove(event,nodeUuid,"keep-contents")).toEqual(view);
    expect(service.removePhysicalRoot).toHaveBeenCalledWith(nodeUuid,"keep-contents");
    expect(remove(event,nodeUuid,"remove-contents")).toEqual(view);
    expect(service.removePhysicalRoot).toHaveBeenLastCalledWith(nodeUuid,"remove-contents");
    for(const bad of [undefined,null,"","keep","REMOVE-CONTENTS",1])expect(()=>remove(event,nodeUuid,bad)).toThrow();
    expect(()=>remove(event,"not-a-uuid","keep-contents")).toThrow();
    expect(service.removePhysicalRoot).toHaveBeenCalledTimes(2);
  });
  it("strictly validates placement target requests and packed moves",()=>{
    const {handlers,service}=setup();
    const parentUuid="10000000-0000-4000-8000-000000000002";
    const itemUuid="10000000-0000-4000-8000-000000000003";
    const nodeUuid="10000000-0000-4000-8000-000000000004";
    const targets=handlers.get(PROJECT_CHANNELS.placementTargets)!;
    expect(targets(event,{parentUuid,itemUuid})).toEqual({targets:[],diagnostics:[]});
    expect(targets(event,{parentUuid,nodeUuid})).toEqual({targets:[],diagnostics:[]});
    expect(service.placementTargets).toHaveBeenLastCalledWith({parentUuid,nodeUuid});
    for(const invalid of [{parentUuid,itemUuid,nodeUuid},{parentUuid},{parentUuid,itemUuid,extra:true},
      {parentUuid:"bad",itemUuid},{parentUuid,nodeUuid:4},null])expect(()=>targets(event,invalid)).toThrow();
    expect(service.placementTargets).toHaveBeenCalledTimes(2);
    const move=handlers.get(PROJECT_CHANNELS.movePackedNode)!;
    const input={parentUuid,zoneNo:1,viewCode:"front",index:0};
    expect(move(event,nodeUuid,input)).toEqual(view);
    expect(service.movePackedNode).toHaveBeenCalledWith(nodeUuid,input);
    expect(move(event,nodeUuid,{parentUuid,zoneNo:1,viewCode:"front",startUnits:20})).toEqual(view);
    for(const invalid of [{...input,index:-1},{...input,index:1.5},{...input,zoneNo:-1},
      {...input,viewCode:"back"},{...input,startUnits:0},{...input,parentUuid:"bad"},
      {parentUuid,zoneNo:1,viewCode:"front",startUnits:0.5},null])
      expect(()=>move(event,nodeUuid,invalid)).toThrow();
    expect(()=>move(event,"bad",input)).toThrow();
    expect(service.movePackedNode).toHaveBeenCalledTimes(2);
  });
  it("validates optional ordinary quantity in main and keeps the one-unit default", () => {
    const { handlers, service } = setup();
    const add = handlers.get(PROJECT_CHANNELS.addCatalogueProduct)!;
    expect(add(event, 8)).toEqual(view);
    expect(service.addCatalogueProduct).toHaveBeenCalledWith(8, 1);
    expect(add(event, 8, 3)).toEqual(view);
    expect(service.addCatalogueProduct).toHaveBeenLastCalledWith(8, 3);
    for (const invalid of [0, 1.5, 10_000, "3", null]) {
      expect(() => add(event, 8, invalid)).toThrow("Quantità non valida");
    }
    expect(service.addCatalogueProduct).toHaveBeenCalledTimes(2);
    expect(add(event, 8, 1, true)).toEqual(view);
    expect(service.addCatalogueProduct).toHaveBeenLastCalledWith(8, 1, true);
  });
  it("validates and dispatches the configured-item request without accepting renderer snapshots",() => {
    const {handlers,service}=setup();
    const add=handlers.get(PROJECT_CHANNELS.addConfiguredItem)!;
    expect(() => add(event,{modelId:0,selectedOptionIds:[]})).toThrow("Invalid configuration ID");
    expect(() => add(event,{modelId:1,selectedOptionIds:[],bom:[{price:0}]}))
      .toThrow("Unexpected configuration field");
    expect(service.addConfiguredItem).not.toHaveBeenCalled();
    const request={modelId:4,selectedOptionIds:[10,11],productId:5};
    expect(add(event,request)).toEqual(view);
    expect(service.addConfiguredItem).toHaveBeenCalledWith(request,1);
    expect(add(event,request,3)).toEqual(view);
    expect(service.addConfiguredItem).toHaveBeenLastCalledWith(request,3);
    expect(add(event,request,1,true)).toEqual(view);
    expect(service.addConfiguredItem).toHaveBeenLastCalledWith(request,1,true);
    expect(add(event,request,1,true,true)).toEqual(view);
    expect(service.addConfiguredItem).toHaveBeenLastCalledWith(request,1,true,true);
    expect(() => add(event,request,1,true,"auto")).toThrow("Modalità di posizionamento non valida");
    expect(() => add(event,request,10_000)).toThrow("Quantità non valida");
    expect(() => add(event,request,1.5)).toThrow("Quantità non valida");
    const replace = handlers.get(PROJECT_CHANNELS.replaceConfiguredItem)!;
    const lineUuid = "10000000-0000-4000-8000-000000000099";
    expect(replace(event,lineUuid,request)).toEqual(view);
    expect(service.replaceConfiguredItem).toHaveBeenCalledWith(lineUuid,request);
    expect(() => replace(event,"bad",request)).toThrow();
    expect(() => replace(event,lineUuid,{...request,bom:[]})).toThrow("Unexpected configuration field");
    const duplicate = handlers.get(PROJECT_CHANNELS.duplicateConfiguredItem)!;
    expect(duplicate(event,lineUuid)).toEqual(view);
    expect(service.duplicateConfiguredItem).toHaveBeenCalledWith(lineUuid);
    expect(() => duplicate(event,"bad")).toThrow();
  });
  it("validates the checked-line batch before dispatch", () => {
    const {handlers,service}=setup();
    const remove=handlers.get(PROJECT_CHANNELS.removeLines)!;
    const uuids=["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"];
    expect(remove(event,uuids)).toEqual(view);
    expect(service.removeLines).toHaveBeenCalledWith(uuids);
    for(const invalid of [[],[uuids[0],uuids[0]],["bad"],"bad"]) expect(()=>remove(event,invalid)).toThrow();
  });
  it("returns an opaque one-use destination token and never exposes the native path", async () => {
    const { handlers, service } = setup();
    const selection = await handlers.get(PROJECT_CHANNELS.chooseDestination)!(event, "Client") as { token: string; displayName: string };
    expect(selection.displayName).toBe("Client.lqp");
    expect(JSON.stringify(selection)).not.toContain("/private/customer");
    await handlers.get(PROJECT_CHANNELS.create)!(event, { ...metadata, destinationToken: selection.token });
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ destinationPath: "/private/customer/Client.lqp" }));
    await expect(handlers.get(PROJECT_CHANNELS.create)!(event, {
      ...metadata,
      destinationToken: selection.token,
    })).rejects.toThrow("non è più valida");
  });

  it("checks dirty state before opening a native picker", async () => {
    const { handlers, dialogs } = setup({ dirty: true });
    await expect(handlers.get(PROJECT_CHANNELS.chooseDestination)!(event, "Client")).rejects.toThrow("dirty");
    await expect(handlers.get(PROJECT_CHANNELS.open)!(event)).rejects.toThrow("dirty");
    expect(dialogs.chooseDestination).not.toHaveBeenCalled();
    expect(dialogs.chooseProjectToOpen).not.toHaveBeenCalled();
  });

  it("cancels Save As without changing the current target", async () => {
    const { handlers, service, dialogs } = setup();
    vi.mocked(dialogs.chooseSaveAsDestination).mockResolvedValue(null);
    const result = await handlers.get(PROJECT_CHANNELS.saveAs)!(event);
    expect(result).toEqual(view);
    expect(service.saveAs).not.toHaveBeenCalled();
  });

  it("keeps the Save As native path inside main while returning only the safe document view", async () => {
    const { handlers, service } = setup({ dirty: true });
    const result = await handlers.get(PROJECT_CHANNELS.saveAs)!(event);
    expect(service.saveAs).toHaveBeenCalledWith("/private/customer/Client copy.lqp", false);
    expect(JSON.stringify(result)).not.toContain("/private/customer");
  });

  it.each([
    ["save", "closeCurrent"],
    ["discard", "discardCurrent"],
    ["cancel", null],
  ] as const)("handles the dirty-close %s path", async (choice, expectedMethod) => {
    const { handlers, service, dialogs } = setup({ dirty: true });
    vi.mocked(dialogs.confirmDirtyClose).mockResolvedValue(choice);
    const result = await handlers.get(PROJECT_CHANNELS.close)!(event);
    if (expectedMethod) expect(service[expectedMethod]).toHaveBeenCalledOnce();
    else {
      expect(service.closeCurrent).not.toHaveBeenCalled();
      expect(service.discardCurrent).not.toHaveBeenCalled();
    }
    expect(result).toEqual(choice === "cancel" ? expect.objectContaining({ dirty: true }) : null);
  });

  it("does not close or discard after a failed or cancelled save", async () => {
    const { handlers, service, dialogs } = setup({ dirty: true });
    vi.mocked(dialogs.confirmDirtyClose).mockResolvedValue("save");
    vi.mocked(service.save).mockRejectedValue(new Error("disk full"));
    vi.mocked(dialogs.resolveSaveFailure).mockResolvedValue("cancel");
    const result = await handlers.get(PROJECT_CHANNELS.close)!(event);
    expect(result).toEqual(expect.objectContaining({ dirty: true }));
    expect(service.closeCurrent).not.toHaveBeenCalled();
    expect(service.discardCurrent).not.toHaveBeenCalled();
  });

  it("does not close when a save succeeds but a newer edit keeps the document dirty", async () => {
    const { handlers, service, dialogs } = setup({ dirty: true });
    const stillDirty = { ...view, dirty: true };
    vi.mocked(dialogs.confirmDirtyClose).mockResolvedValue("save");
    vi.mocked(service.save).mockResolvedValue(stillDirty);

    const result = await handlers.get(PROJECT_CHANNELS.close)!(event);

    expect(result).toEqual(stillDirty);
    expect(service.closeCurrent).not.toHaveBeenCalled();
    expect(service.discardCurrent).not.toHaveBeenCalled();
  });

  it("handles a save conflict through main-owned choices without exposing a path", async () => {
    const { handlers, service, dialogs } = setup({ dirty: true });
    vi.mocked(service.save)
      .mockRejectedValueOnce(new ProjectSaveError("conflict", "changed elsewhere"))
      .mockResolvedValueOnce(view);
    vi.mocked(dialogs.resolveSaveConflict).mockResolvedValue("overwrite");
    const result = await handlers.get(PROJECT_CHANNELS.save)!(event);
    expect(service.save).toHaveBeenNthCalledWith(1, false);
    expect(service.save).toHaveBeenNthCalledWith(2, true);
    expect(JSON.stringify(result)).not.toContain("/private/customer");
  });

  it("retries a retained atomic replacement after the user chooses Riprova", async () => {
    const { handlers, service, dialogs } = setup({ dirty: true });
    vi.mocked(service.save).mockRejectedValueOnce(new ProjectSaveError("replace-failed", "busy"));
    vi.mocked(dialogs.resolveSaveFailure).mockResolvedValue("retry");
    await handlers.get(PROJECT_CHANNELS.save)!(event);
    expect(service.retryPendingSave).toHaveBeenCalledOnce();
  });

  it("overwrites the selected Save As destination rather than redirecting to the original", async () => {
    const { handlers, service, dialogs } = setup({ dirty: true });
    vi.mocked(service.saveAs)
      .mockRejectedValueOnce(new ProjectSaveError("conflict", "changed elsewhere"))
      .mockResolvedValueOnce(view);
    vi.mocked(dialogs.resolveSaveConflict).mockResolvedValue("overwrite");

    await handlers.get(PROJECT_CHANNELS.saveAs)!(event);

    expect(service.saveAs).toHaveBeenNthCalledWith(1, "/private/customer/Client copy.lqp", false);
    expect(service.saveAs).toHaveBeenNthCalledWith(2, "/private/customer/Client copy.lqp", true);
    expect(service.save).not.toHaveBeenCalled();
  });

  it("does not carry overwrite approval into a later unrelated retry", async () => {
    const { handlers, service, dialogs } = setup({ dirty: true });
    vi.mocked(service.save)
      .mockRejectedValueOnce(new ProjectSaveError("conflict", "changed elsewhere"))
      .mockRejectedValueOnce(new ProjectSaveError("failed", "disk full"))
      .mockResolvedValueOnce(view);
    vi.mocked(dialogs.resolveSaveConflict).mockResolvedValue("overwrite");
    vi.mocked(dialogs.resolveSaveFailure).mockResolvedValue("retry");

    await handlers.get(PROJECT_CHANNELS.save)!(event);

    expect(vi.mocked(service.save).mock.calls).toEqual([[false], [true], [false]]);
  });

  it("serializes lifecycle IPC and rejects re-entry while a save is active", async () => {
    const { handlers, service } = setup({ dirty: true });
    let reportStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { reportStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(service.save).mockImplementation(async () => {
      reportStarted();
      await gate;
      return view;
    });
    const first = handlers.get(PROJECT_CHANNELS.save)!(event) as Promise<unknown>;
    await started;

    await expect(handlers.get(PROJECT_CHANNELS.close)!(event)).rejects.toThrow("già in corso");
    expect(service.discardCurrent).not.toHaveBeenCalled();
    release();
    await first;
    expect(service.save).toHaveBeenCalledOnce();
  });

  it("serializes create and open with the same lifecycle guard", async () => {
    const { handlers, service, dialogs } = setup();
    const selection = await handlers.get(PROJECT_CHANNELS.chooseDestination)!(event, "Client") as { token: string };
    let reportStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { reportStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(service.save).mockImplementation(async () => {
      reportStarted();
      await gate;
      return view;
    });
    const saving = handlers.get(PROJECT_CHANNELS.save)!(event) as Promise<unknown>;
    await started;

    await expect(handlers.get(PROJECT_CHANNELS.create)!(event, {
      ...metadata,
      destinationToken: selection.token,
    })).rejects.toThrow("già in corso");
    await expect(handlers.get(PROJECT_CHANNELS.open)!(event)).rejects.toThrow("già in corso");
    expect(service.create).not.toHaveBeenCalled();
    expect(service.open).not.toHaveBeenCalled();
    expect(dialogs.chooseProjectToOpen).not.toHaveBeenCalled();

    release();
    await saving;
    await handlers.get(PROJECT_CHANNELS.create)!(event, { ...metadata, destinationToken: selection.token });
    expect(service.create).toHaveBeenCalledOnce();
  });
});


it("returns structured preset creation diagnostics through the existing add IPC",async()=>{
  const {handlers,service}=setup();
  const result={...view,presetDiagnostics:[{seq:1,modelCode:"support",status:"withheld" as const,
    code:"preset_configuration_unresolved",message:"Required option"}]};
  vi.mocked(service.addStructural).mockReturnValue(result);
  const added=await handlers.get(PROJECT_CHANNELS.addStructural)!({senderFrame:{} as never},
    {kind:"enclosure",configuration:{modelId:1,selectedOptionIds:[]}});
  expect(added).toEqual(result);
});

it("protects engineering plan/apply with trusted IPC validation and the shared lifecycle guard",async()=>{
  const {handlers,service,lifecycle}=setup();
  expect(handlers.get(PROJECT_CHANNELS.engineeringStatus)!(event)).toEqual({items:[],counts:{}});
  expect(await handlers.get(PROJECT_CHANNELS.planEngineeringRefresh)!(event)).toEqual({token:"a".repeat(64)});
  const apply=handlers.get(PROJECT_CHANNELS.applyEngineeringRefresh)!;
  for(const token of [undefined,null,{},"../bad","A".repeat(64),"a".repeat(63)])expect(()=>apply(event,token)).toThrow("Token del piano non valido");
  expect(await apply(event,"a".repeat(64))).toEqual(view);
  expect(service.applyEngineeringRefresh).toHaveBeenCalledWith("a".repeat(64));
  let release!:()=>void;
  const held=lifecycle.run(()=>new Promise<void>(resolve=>{release=resolve;}));await Promise.resolve();
  await expect(apply(event,"a".repeat(64))).rejects.toThrow("Un'altra operazione sul progetto è già in corso.");
  release();await held;
});

it("validates the BTicino enclosure search IPC and accepts enclosure references at add",()=>{
  const {handlers,service}=setup();
  const search=vi.fn(()=>({navigation:{candidates:[]},reference:{ok:true}}));
  Object.assign(service,{compatibleEnclosures:search,enclosureReferenceDevices:vi.fn(()=>({candidates:[]}))});
  const device={configuration:{modelId:4,selectedOptionIds:[41]},definitionFingerprint:'definition'};
  const handler=handlers.get(PROJECT_CHANNELS.compatibleEnclosures)!;
  handler(event,{device});expect(search).toHaveBeenCalledWith({device});
  for(const payload of [{},{device:{...device,extra:1}},{device,extra:1},{device,enclosure:{modelId:'bad',selectedOptionIds:[]}}])
    expect(()=>handler(event,payload)).toThrow();
  handlers.get(PROJECT_CHANNELS.addStructural)!(event,{kind:'enclosure',configuration:{modelId:1,selectedOptionIds:[]},referenceDevice:device});
  expect(service.addStructural).toHaveBeenCalledWith(expect.objectContaining({kind:'enclosure',referenceDevice:device}));
});
