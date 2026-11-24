import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { combinedFrontGeometry, scrollThumb, sectorAt, toDisplayPoint, type CombinedFrontGeometry } from "../src/renderer/project/front-geometry.js";
import { clientToViewBox, dropOnTarget, loadPlacementTargets, pickCombinedTarget, type DragSubject, type TargetEntry,
} from "../src/renderer/project/placement-drag.js";
import { devicePool, structuralPool } from "../src/renderer/project/placement-workflow.js";
import type { ConfigurationResult } from "../src/shared/configuration.js";
import type { CatalogueProductSnapshotSource, ProjectDocumentView, ProjectPhysicalNode } from "../src/shared/project.js";

const article:CatalogueProductSnapshotSource={brandMarchio:"TEST",brandName:"Test",
  manufacturerCode:"ARTICLE",ean:null,shortDescription:"Article",description:"Article",
  unitOfMeasure:"PCE",categoryCode:null,categoryPathLabel:null,familyCode:null,familyName:null,
  priceIssuerSigla:"TEST",priceListinoNumber:"1",priceValidFrom:"2026-09-29",
  listPriceUnitE4:10_000,priceMultiplierOriginal:1,attributes:[]};

// Enclosures: 1 and 5 (class FRAME), 8 (class FRAME_B). Supports: 2 (PANEL, needs a FRAME), 9 (PANEL_B, needs FRAME_B).
// Model 10 is a 800 mm high FRAME; model 11 is a FRAME_C, which Pannello 2 accepts but Apparecchio 4 does not.
// Device 4 needs a PANEL parent, so it is compatible with the panels of 1 and 5 and not with 8's.
const ENCLOSURES=new Set([1,5,8,10,11]);
const kindOf=(id:number)=>ENCLOSURES.has(id)?"enclosure":id===4?"device":"support";
// Selecting option 99 on model 1 resolves an option variant of the same model with another fit class (FRAME_C).
function configured(id:number,selected:readonly number[]=[]):ConfigurationResult {
  const kind=kindOf(id);
  const classCode=id===8?"FRAME_B":id===11||(id===1&&selected.includes(99))?"FRAME_C":id===9?"PANEL_B":kind==="enclosure"?"FRAME":kind==="support"?"PANEL":"DEV";
  const physical={id,code:`profile-${id}`,name:`Profile ${id}`,kind,profileKey:null,
    fitClass:{id,code:classCode,name:kind},depthMm:null,outerDepthMm:null,usableDepthMm:null,
    demands:kind==="device"?[{capacityKindCode:"din",amount:2,unitLabel:"moduli",displayDivisor:2,nominalPitchMm:9}]:[],
    views:[{code:"front",widthMm:kind==="enclosure"?500:kind==="support"?500:18,
      heightMm:kind==="enclosure"?(id===10?800:1000):kind==="support"?100:80,insertDxMm:0,insertDyMm:0,
      symbolKind:"rectangle",assetKey:null}],
    zones:kind==="enclosure"?[{zoneNo:0,layout:"stack",capacityKindCode:null,capacityAmount:600,
      originXMm:0,originYMm:0,lengthMm:600,breadthMm:500,direction:"vertical",pitchMm:1,requiredViewCode:"front"}]
      :kind==="support"?[{zoneNo:0,layout:"linear",capacityKindCode:"din",capacityKindLabel:"moduli",
        displayDivisor:2,nominalPitchMm:9,capacityAmount:20,originXMm:10,originYMm:10,lengthMm:null,
        breadthMm:null,direction:"horizontal",pitchMm:null,requiredViewCode:null}]:[],
    slots:[],
    constraints:kind==="support"?[{relation:"ancestor",acceptSetCode:"frame",classCodes:id===9?["FRAME_B"]:["FRAME","FRAME_C"]}]
      :kind==="device"?[{relation:"parent",acceptSetCode:"panel",classCodes:["PANEL"]},
        {relation:"ancestor",acceptSetCode:"frame",classCodes:["FRAME"]}]:[]};
  return {model:{id,code:`model-${id}`,name:`Model ${id}`,kind,brandMarchio:"TEST",active:true,
    obsolete:false,commercialContribution:"articles",definitionFingerprint:`definition-${id}`,sourceRef:null,baseProfileId:id,
    maxInsertQty:null,axes:[],budgets:[],relations:[]},selectedOptionIds:[...selected],defaultedOptionIds:[],
    commercialContribution:"articles",matchingRuleIds:[],fingerprint:`config-${id}-${selected.join("+")}`,status:"complete",issues:[],bom:[{
      brandMarchio:"TEST",manufacturerCode:"ARTICLE",productId:1,linkedBrandMarchio:"TEST",
      linkedManufacturerCode:"ARTICLE",quantity:1,roles:["primary"],description:"Article",
      unitPriceE4:10_000,rowTotalE4:10_000,currency:"EUR",priceIssuerSigla:"TEST",
      priceListinoNumber:"1",priceValidFrom:"2026-09-29",priceMultiplierOriginal:1}],
    totalE4:10_000,pricedSubtotalE4:10_000,budgets:[],physical,exclusions:[]} as ConfigurationResult;
}

const folders:string[]=[];
afterEach(()=>{for(const folder of folders.splice(0))rmSync(folder,{recursive:true,force:true});});
const request=(modelId:number,selectedOptionIds:number[]=[])=>({modelId,selectedOptionIds});

type ItemGuard=(request:{parentUuid?:string})=>{ok:boolean;code:string};
/** `null` builds a service with no catalogue guard at all (a catalogue-free installation). */
async function setup(itemGuard?:ItemGuard|null) {
  const folder=mkdtempSync(path.join(tmpdir(),"librequadri-multi-carpenteria-"));folders.push(folder);
  const destination=path.join(folder,"case.lqp");
  const service=new ProjectDocumentService({workingDirectory:path.join(folder,"working"),
    incomingDirectory:path.join(folder,"incoming"),backupDirectory:path.join(folder,"backup"),
    migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
    resolveCatalogueProduct:()=>article,resolveConfiguration:input=>configured(input.modelId,input.selectedOptionIds),
    designGuard:()=>({ok:true,code:"compatible"}),...(itemGuard===null?{}:{designItemGuard:(_db,request)=>itemGuard?.(request as {parentUuid?:string})??{ok:true,code:"compatible"}})});
  await service.create({destinationPath:destination,title:"Case",description:"",notes:"",
    projectType:"civil",executor:"",date:"2026-09-29",companyName:"Client",companyDescription:""});
  const api={
    placementTargets:vi.fn(async(input:Parameters<typeof service.placementTargets>[0])=>service.placementTargets(input)),
    placeStructuralItem:vi.fn(async(input:Parameters<typeof service.placeStructuralItem>[0])=>service.placeStructuralItem(input)),
    placeChild:vi.fn(async(input:Parameters<typeof service.placeChild>[0])=>service.placeChild(input)),
    moveNode:vi.fn(async(uuid:string,input:Parameters<typeof service.moveNode>[1])=>service.moveNode(uuid,input)),
    movePackedNode:vi.fn(async(uuid:string,input:Parameters<typeof service.movePackedNode>[1])=>service.movePackedNode(uuid,input)),
  };
  return {service,api,destination};
}

const flat=(nodes:readonly ProjectPhysicalNode[]):ProjectPhysicalNode[]=>nodes.flatMap(node=>[node,...flat(node.children)]);
const rootsOf=(view:ProjectDocumentView)=>view.physicalNodes.filter(node=>node.nodeKind==="enclosure");
const supportsOf=(view:ProjectDocumentView)=>flat(view.physicalNodes).filter(node=>node.nodeKind==="support");
const devicesOf=(view:ProjectDocumentView)=>flat(view.physicalNodes).filter(node=>node.nodeKind==="device");
const poolSubject=(view:ProjectDocumentView,kind:"support"|"device"):DragSubject=>
  ({origin:"pool",kind,item:(kind==="support"?structuralPool(view):devicePool(view))[0]!.item});
const nodeSubject=(view:ProjectDocumentView,node:ProjectPhysicalNode):DragSubject=>({origin:"node",
  kind:node.nodeKind as "support"|"device",item:view.configuredItems.find(item=>item.uuid===node.itemUuid)!,
  nodeUuid:node.uuid,...(node.parentUuid?{parentUuid:node.parentUuid}:{})});
const centre=(entry:TargetEntry)=>({x:entry.target.subject.xMm+entry.target.subject.widthMm/2,
  y:entry.target.subject.yMm+entry.target.subject.heightMm/2});
const geometryFor=(view:ProjectDocumentView,focusUuid?:string,zoom=1,scrollX:number|null=null):CombinedFrontGeometry=>
  combinedFrontGeometry(rootsOf(view),view.configuredItems as never,{zoom,focusUuid,viewportPx:{width:640,height:480},scrollX});
const clientBox={left:120,top:40,width:640,height:480};
/** The pointer position that shows a display point, and what the renderer then reads back from it. */
function pointerAt(geometry:CombinedFrontGeometry,display:{x:number;y:number}) {
  const [x,y,w,h]=geometry.viewBox;
  const scale=Math.min(clientBox.width/w,clientBox.height/h);
  const client={x:clientBox.left+(clientBox.width-w*scale)/2+(display.x-x)*scale,
    y:clientBox.top+(clientBox.height-h*scale)/2+(display.y-y)*scale};
  return clientToViewBox(client,clientBox,geometry.viewBox);
}

/** Three Carpenterie side by side: two compatible (1, 5) and a different family (8), each with one Pannello. */
async function threeRoots() {
  const context=await setup();
  const {service}=context;
  service.addStructural({kind:"enclosure",configuration:request(1)});
  service.addStructural({kind:"enclosure",configuration:request(5)});
  const withThird=service.addStructural({kind:"enclosure",configuration:request(8)});
  const [rootA,rootB,rootC]=rootsOf(withThird) as [ProjectPhysicalNode,ProjectPhysicalNode,ProjectPhysicalNode];
  service.addStructural({kind:"support",parentUuid:rootA.uuid,configuration:request(2)});
  service.addStructural({kind:"support",parentUuid:rootB.uuid,configuration:request(2)});
  const view=service.addStructural({kind:"support",parentUuid:rootC.uuid,configuration:request(9)});
  return {...context,view,rootA,rootB,rootC};
}

describe("multi-Carpenteria Fronte Quadro over the real placement backend",()=>{
  it("shows backend-created roots as sectors at their persisted positions with no display offset",async()=>{
    const {view,rootA,rootB,rootC}=await threeRoots();
    expect(rootsOf(view).map(root=>[root.uuid,root.xMm,root.yMm])).toEqual([[rootA.uuid,0,0],[rootB.uuid,550,0],[rootC.uuid,1100,0]]);
    const geometry=geometryFor(view,rootB.uuid);
    expect(geometry.sectors.map(sector=>sector.root.uuid)).toEqual([rootA.uuid,rootB.uuid,rootC.uuid]);
    expect(geometry.sectors.every(sector=>sector.offset.x===0&&sector.offset.y===0)).toBe(true);
    expect(geometry.skipped).toEqual([]);
    // Every panel is in its own root's sector.
    expect(geometry.sectors.map(sector=>[...sector.parentRects.keys()].filter(uuid=>supportsOf(view).some(node=>node.uuid===uuid)).length))
      .toEqual([1,1,1]);
  });

  it("loads device targets from the Pannelli of every Carpenteria and offers only compatible ones",async()=>{
    const {service,api,view,rootA,rootB,rootC}=await threeRoots();
    const withDevice=service.addConfiguredItem(request(4),2);
    const [panelA,panelB,panelC]=supportsOf(withDevice) as [ProjectPhysicalNode,ProjectPhysicalNode,ProjectPhysicalNode];
    expect(panelC.parentUuid).toBe(rootC.uuid);
    const subject=poolSubject(withDevice,"device");
    const loaded=await loadPlacementTargets(api,subject,rootsOf(withDevice)[0]!,rootsOf(withDevice));
    // One request per Pannello of every root, in root order.
    expect(api.placementTargets.mock.calls.map(call=>call[0])).toEqual([
      {parentUuid:panelA.uuid,itemUuid:subject.item.uuid},{parentUuid:panelB.uuid,itemUuid:subject.item.uuid},
      {parentUuid:panelC.uuid,itemUuid:subject.item.uuid}]);
    expect(loaded.parents).toEqual([panelA.uuid,panelB.uuid,panelC.uuid]);
    // The backend, not the renderer, rejects the other family's Pannello: nothing is offered on it.
    expect(new Set(loaded.entries.map(entry=>entry.parentUuid))).toEqual(new Set([panelA.uuid,panelB.uuid]));
    expect(loaded.entries.some(entry=>entry.parentUuid===panelC.uuid)).toBe(false);
    expect(loaded.diagnostics.length).toBeGreaterThan(0);
    expect(view).not.toBe(withDevice);
    // Targets are still exact: hit-testing over the incompatible Pannello's sector finds nothing to snap to.
    const geometry=geometryFor(withDevice,rootA.uuid);
    const overC=toDisplayPoint(geometry.sectors[2]!,{x:panelC.xMm!+50,y:panelC.yMm!+40});
    expect(pickCombinedTarget(loaded.entries,geometry,overC,"device")).toBeNull();
    // ...and a hand-built drop on it is refused by the backend, leaving the project unchanged.
    const before=JSON.stringify(service.current());
    await expect(api.placeChild({itemUuid:subject.item.uuid,parentUuid:panelC.uuid,zoneNo:0,startUnits:0,viewCode:"front"})).rejects.toThrow();
    expect(JSON.stringify(service.current())).toBe(before);
    expect(rootB.uuid).not.toBe(rootA.uuid);
  });

  it("moves a placed device to another Carpenteria through a backend target, hit-tested in its own sector, without moving siblings",async()=>{
    const {service,api,rootA,rootB}=await threeRoots();
    let view=service.addConfiguredItem(request(4),3);
    const [panelA,panelB]=supportsOf(view) as [ProjectPhysicalNode,ProjectPhysicalNode,ProjectPhysicalNode];
    const device=devicePool(view)[0]!.item;
    for(const startUnits of [0,6])view=await api.placeChild({itemUuid:device.uuid,parentUuid:panelA.uuid,zoneNo:0,startUnits,viewCode:"front"});
    const [first,second]=supportsOf(view).find(node=>node.uuid===panelA.uuid)!.children as [ProjectPhysicalNode,ProjectPhysicalNode];
    const subject=nodeSubject(view,first);
    const loaded=await loadPlacementTargets(api,subject,rootsOf(view)[0]!,rootsOf(view));
    const wanted=loaded.entries.find(entry=>entry.parentUuid===panelB.uuid&&entry.target.action==="moveNode"&&
      entry.target.input.startUnits===4)!;
    expect(wanted).toBeDefined();
    // The pointer is over the second sector; the picked entry is the backend's target, unchanged.
    let checked=0;
    for(const zoom of [1,1.25,1.25**2,1.25**3]){
      const geometry=geometryFor(view,rootB.uuid,zoom);
      // There is no pan tool: at high zoom only the part around the focused Carpenteria's centre is on screen.
      const [vx,vy,vw,vh]=geometry.viewBox;
      const point=centre(wanted);
      if(!(point.x>vx&&point.x<vx+vw&&point.y>vy&&point.y<vy+vh))continue;
      checked++;
      const drawn=pointerAt(geometry,point)!;
      const picked=pickCombinedTarget(loaded.entries,geometry,drawn,"device")!;
      expect(picked.entry).toBe(wanted);
      expect(picked.sector.root.uuid).toBe(rootB.uuid);
      expect(sectorAt(geometry,drawn)).toBe(picked.sector);
    }
    expect(checked).toBeGreaterThanOrEqual(2);
    const geometry=geometryFor(view,rootA.uuid);
    const picked=pickCombinedTarget(loaded.entries,geometry,centre(wanted),"device")!;
    const siblingBefore=JSON.stringify(second);
    const updated=await dropOnTarget(api,subject,picked.entry.target);
    expect(api.moveNode).toHaveBeenCalledWith(first.uuid,wanted.target.input);
    expect(api.movePackedNode).not.toHaveBeenCalled();
    const moved=devicesOf(updated).find(node=>node.uuid===first.uuid)!;
    expect(moved).toMatchObject({parentUuid:panelB.uuid,startUnits:4});
    // The sibling on the old Pannello did not move or repack, and the pool is unchanged (a move, not a placement).
    expect(JSON.stringify(devicesOf(updated).find(node=>node.uuid===second.uuid))).toBe(siblingBefore);
    expect(supportsOf(updated).find(node=>node.uuid===panelA.uuid)!.children.map(node=>[node.uuid,node.startUnits])).toEqual([[second.uuid,6]]);
    expect(devicePool(updated).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[3,2,1]]);
    // Persisted coordinates are untouched by the move except for the device itself: roots keep their place.
    expect(rootsOf(updated).map(root=>[root.uuid,root.xMm,root.yMm])).toEqual([[rootA.uuid,0,0],[rootB.uuid,550,0],[rootsOf(updated)[2]!.uuid,1100,0]]);
  });

  it("never offers a device on the incompatible Carpenteria when moving, and the backend refuses it",async()=>{
    const {service,api}=await threeRoots();
    let view=service.addConfiguredItem(request(4),1);
    const [panelA,,panelC]=supportsOf(view) as [ProjectPhysicalNode,ProjectPhysicalNode,ProjectPhysicalNode];
    view=await api.placeChild({itemUuid:devicePool(view)[0]!.item.uuid,parentUuid:panelA.uuid,zoneNo:0,startUnits:0,viewCode:"front"});
    const placed=devicesOf(view)[0]!;
    const loaded=await loadPlacementTargets(api,nodeSubject(view,placed),rootsOf(view)[0]!,rootsOf(view));
    expect(loaded.entries.some(entry=>entry.parentUuid===panelC.uuid)).toBe(false);
    const before=JSON.stringify(service.current());
    await expect(api.moveNode(placed.uuid,{itemUuid:placed.itemUuid!,parentUuid:panelC.uuid,zoneNo:0,startUnits:0,viewCode:"front"})).rejects.toThrow();
    expect(JSON.stringify(service.current())).toBe(before);
  });

  it("keeps roots, panels and devices where they were after save and reopen",async()=>{
    const {service,api,destination,rootA,rootB}=await threeRoots();
    let view=service.addConfiguredItem(request(4),2);
    const panelB=supportsOf(view).find(node=>node.parentUuid===rootB.uuid)!;
    const device=devicePool(view)[0]!.item;
    view=await api.placeChild({itemUuid:device.uuid,parentUuid:panelB.uuid,zoneNo:0,startUnits:2,viewCode:"front"});
    const before=JSON.stringify(view.physicalNodes);
    await service.save();
    const reopened=service.open(destination);
    expect(JSON.stringify(reopened.physicalNodes)).toBe(before);
    expect(rootsOf(reopened).map(root=>[root.uuid,root.xMm,root.yMm])).toEqual(rootsOf(view).map(root=>[root.uuid,root.xMm,root.yMm]));
    expect(rootsOf(reopened)[1]!.uuid).toBe(rootB.uuid);
    expect(rootsOf(reopened)[0]!.uuid).toBe(rootA.uuid);
    // The layout is derived at draw time, so a reopened project shows the same sectors with the same (zero) offsets.
    const geometry=geometryFor(reopened);
    expect(geometry.sectors.map(sector=>[sector.root.uuid,sector.offset])).toEqual(rootsOf(reopened).map(root=>[root.uuid,{x:0,y:0}]));
  });

  it("keeps drops exact after scrolling horizontally to a Carpenteria that started off screen, without changing the project",async()=>{
    const {service,api,rootA,rootB}=await threeRoots();
    // Stack two more Pannelli so the one used sits mid-height (there is no vertical navigation).
    service.addStructural({kind:"support",parentUuid:rootB.uuid,configuration:request(2)});
    service.addStructural({kind:"support",parentUuid:rootB.uuid,configuration:request(2)});
    let view=service.addConfiguredItem(request(4),2);
    const panelB=supportsOf(view).filter(node=>node.parentUuid===rootB.uuid)[2]!;
    const zoom=1.25**3;
    // Focus is on the last Carpenteria: the second one's Pannello starts outside the window.
    const initial=geometryFor(view,rootsOf(view)[2]!.uuid,zoom);
    const subject=poolSubject(view,"device");
    const loaded=await loadPlacementTargets(api,subject,rootsOf(view)[0]!,rootsOf(view));
    const wanted=loaded.entries.find(entry=>entry.parentUuid===panelB.uuid&&entry.target.action==="placeChild"&&entry.target.input.startUnits===6)!;
    const point=centre(wanted);
    expect(scrollThumb(initial)).not.toBeNull();
    const [vx,,vw]=initial.viewBox;
    expect(point.x>vx&&point.x<vx+vw).toBe(false);
    const before=JSON.stringify(service.current());
    const roots=JSON.stringify(rootsOf(view).map(root=>[root.uuid,root.xMm,root.yMm]));
    // Scroll (display only) until that Pannello is centred; the project is untouched by it.
    const scrolled=geometryFor(view,rootsOf(view)[2]!.uuid,zoom,point.x-vw/2);
    expect(JSON.stringify(service.current())).toBe(before);
    expect(scrolled.sectors.map(sector=>sector.offset)).toEqual(initial.sectors.map(sector=>sector.offset));
    expect(point.x>scrolled.viewBox[0]&&point.x<scrolled.viewBox[0]+scrolled.viewBox[2]).toBe(true);
    // Hit-testing follows the scrolled window: the same pointer position now picks the exact backend target.
    const drawn=pointerAt(scrolled,point)!;
    const picked=pickCombinedTarget(loaded.entries,scrolled,drawn,"device")!;
    expect(picked.entry).toBe(wanted);
    expect(picked.sector.root.uuid).toBe(rootB.uuid);
    // The same pointer with the old window lands elsewhere and finds no such target.
    const [sx,sy,sw,sh]=scrolled.viewBox;
    const pixelScale=Math.min(clientBox.width/sw,clientBox.height/sh);
    const pixel={x:clientBox.left+(clientBox.width-sw*pixelScale)/2+(point.x-sx)*pixelScale,
      y:clientBox.top+(clientBox.height-sh*pixelScale)/2+(point.y-sy)*pixelScale};
    const staleDrawn=clientToViewBox(pixel,clientBox,initial.viewBox);
    const stale=staleDrawn?pickCombinedTarget(loaded.entries,initial,staleDrawn,"device"):null;
    expect(stale?.entry).not.toBe(wanted);
    // Just outside the returned rectangles nothing snaps, scrolled or not.
    const beside=pointerAt(scrolled,{x:point.x,y:wanted.target.subject.yMm-15})!;
    expect(pickCombinedTarget(loaded.entries,scrolled,beside,"device")).toBeNull();
    view=await dropOnTarget(api,subject,picked.entry.target);
    expect(api.placeChild).toHaveBeenCalledWith(wanted.target.input);
    expect(devicesOf(view)).toHaveLength(1);
    expect(devicesOf(view)[0]).toMatchObject({parentUuid:panelB.uuid,startUnits:6});
    expect(JSON.stringify(rootsOf(view).map(root=>[root.uuid,root.xMm,root.yMm]))).toBe(roots);
    // A move from a scrolled window works the same way (here to another position on that Pannello).
    const moving=nodeSubject(view,devicesOf(view)[0]!);
    const targets=await loadPlacementTargets(api,moving,rootsOf(view)[0]!,rootsOf(view));
    const next=targets.entries.find(entry=>entry.parentUuid===panelB.uuid&&entry.target.action==="moveNode"&&entry.target.input.startUnits===12)!;
    const home=geometryFor(view,rootsOf(view)[2]!.uuid,zoom,centre(next).x-vw/2);
    const pick=pickCombinedTarget(targets.entries,home,pointerAt(home,centre(next))!,"device")!;
    expect(pick.entry).toBe(next);
    const moved=await dropOnTarget(api,moving,pick.entry.target);
    expect(devicesOf(moved)[0]).toMatchObject({parentUuid:panelB.uuid,startUnits:12});
  });

  it("bottom-aligns different-height Carpenterie on screen only, and drops stay exact with X and Y offsets while scrolled",async()=>{
    const {service,api,destination}=await setup();
    service.addStructural({kind:"enclosure",configuration:request(1)});
    const two=service.addStructural({kind:"enclosure",configuration:request(10)});
    const [tall,short]=rootsOf(two) as [ProjectPhysicalNode,ProjectPhysicalNode];
    service.addStructural({kind:"support",parentUuid:tall.uuid,configuration:request(2)});
    service.addStructural({kind:"support",parentUuid:short.uuid,configuration:request(2)});
    service.addStructural({kind:"support",parentUuid:short.uuid,configuration:request(2)});
    let view=service.addConfiguredItem(request(4),2);
    const persisted=()=>JSON.stringify(flat(service.current()!.physicalNodes).map(node=>[node.uuid,node.xMm,node.yMm,node.rootXMm,node.rootYMm,node.parentUuid,node.startUnits]));
    const before=persisted();
    expect(rootsOf(view).map(root=>[root.xMm,root.yMm])).toEqual([[0,0],[550,0]]);
    const zoom=1.25**3;
    const geometryAt=(scrollX:number|null)=>geometryFor(view,tall.uuid,zoom,scrollX);
    const fitted=geometryFor(view,tall.uuid);
    // The 800 mm Carpenteria is drawn 200 mm lower: both floors at 1000. Nothing persisted changes.
    expect(fitted.sectors.map(sector=>sector.offset)).toEqual([{x:0,y:0},{x:0,y:200}]);
    expect(persisted()).toBe(before);
    const secondPanel=supportsOf(view).filter(node=>node.parentUuid===short.uuid)[1]!;
    const subject=poolSubject(view,"device");
    const loaded=await loadPlacementTargets(api,subject,tall,rootsOf(view));
    const wanted=loaded.entries.find(entry=>entry.parentUuid===secondPanel.uuid&&entry.target.action==="placeChild"&&entry.target.input.startUnits===8)!;
    const point=centre(wanted);
    // Scroll (display only) so the shifted Carpenteria fills the window; the pointer must be read in display space.
    const scrolled=geometryAt(point.x-geometryAt(null).viewBox[2]/2);
    const display=toDisplayPoint(scrolled.sectors[1]!,point);
    expect(display).toEqual({x:point.x,y:point.y+200});
    const drawn=pointerAt(scrolled,display)!;
    const picked=pickCombinedTarget(loaded.entries,scrolled,drawn,"device")!;
    expect(picked.entry).toBe(wanted);
    expect(picked.sector.root.uuid).toBe(short.uuid);
    // Reading the pointer without the Y offset (persisted y) would be wrong, and nothing snaps there.
    expect(pickCombinedTarget(loaded.entries,scrolled,point,"device")?.entry).not.toBe(wanted);
    view=await dropOnTarget(api,subject,picked.entry.target);
    expect(api.placeChild).toHaveBeenCalledWith(wanted.target.input);
    expect(devicesOf(view)[0]).toMatchObject({parentUuid:secondPanel.uuid,startUnits:8});
    // Save and reopen: only the device was persisted; the alignment offset is recomputed, never stored.
    const after=persisted();
    await service.save();
    const reopened=service.open(destination);
    expect(persisted()).toBe(after);
    expect(rootsOf(reopened).map(root=>[root.xMm,root.yMm,root.rootXMm,root.rootYMm])).toEqual([[0,0,0,0],[550,0,550,0]]);
    expect(geometryFor(reopened).sectors.map(sector=>sector.offset)).toEqual([{x:0,y:0},{x:0,y:200}]);
    expect(JSON.stringify(reopened)).not.toMatch(/"offset"/);
  });
});

describe("removing a Carpenteria closes its hole in Fronte Quadro, on screen only",()=>{
  /** Three Carpenterie A (1), B (8), C (5) at 0, 550, 1100; C holds a Pannello with a placed Apparecchio. */
  async function strip() {
    const context=await setup();
    const {service,api}=context;
    service.addStructural({kind:"enclosure",configuration:request(1)});
    service.addStructural({kind:"enclosure",configuration:request(8)});
    let view=service.addStructural({kind:"enclosure",configuration:request(5)});
    const [rootA,rootB,rootC]=rootsOf(view) as [ProjectPhysicalNode,ProjectPhysicalNode,ProjectPhysicalNode];
    service.addStructural({kind:"support",parentUuid:rootA.uuid,configuration:request(2)});
    service.addStructural({kind:"support",parentUuid:rootB.uuid,configuration:request(9)});
    service.addStructural({kind:"support",parentUuid:rootC.uuid,configuration:request(2)});
    view=service.addConfiguredItem(request(4),2);
    const panelC=supportsOf(view).find(node=>node.parentUuid===rootC.uuid)!;
    view=await api.placeChild({itemUuid:devicePool(view)[0]!.item.uuid,parentUuid:panelC.uuid,zoneNo:0,startUnits:4,viewCode:"front"});
    return {...context,view,rootA,rootB,rootC,panelC};
  }
  /** Every node's saved geometry: what the backend validates and stores, never touched by the layout. */
  const persisted=(view:ProjectDocumentView)=>flat(view.physicalNodes).map(node=>
    [node.uuid,node.xMm,node.yMm,node.rootXMm,node.rootYMm,node.parentUuid,node.zoneNo,node.startUnits,node.slotNo]);
  const lefts=(view:ProjectDocumentView)=>geometryFor(view).sectors.map(sector=>[sector.root.uuid,sector.displayBounds.left]);
  const subtree=(view:ProjectDocumentView,rootUuid:string)=>persisted(view).filter(row=>
    flat(view.physicalNodes.filter(root=>root.uuid===rootUuid)).some(node=>node.uuid===row[0]));

  it("packs the remaining Carpenterie in their order for a removed middle, first or last one",async()=>{
    for(const removed of ["B","A","C"] as const){
      const {service,view,rootA,rootB,rootC}=await strip();
      expect(lefts(view)).toEqual([[rootA.uuid,0],[rootB.uuid,550],[rootC.uuid,1100]]);
      const target={A:rootA,B:rootB,C:rootC}[removed];
      const kept=persisted(view).filter(row=>!subtree(view,target.uuid).some(other=>other[0]===row[0]));
      const after=service.removePhysicalRoot(target.uuid,"remove-contents");
      // Saved geometry of everything that remains is exactly as before: only the display offset changes.
      expect(persisted(after)).toEqual(kept);
      const expected={B:[[rootA.uuid,0],[rootC.uuid,550]],A:[[rootB.uuid,550],[rootC.uuid,1100]],
        C:[[rootA.uuid,0],[rootB.uuid,550]]}[removed];
      expect(lefts(after)).toEqual(expected);
      const sectors=geometryFor(after).sectors;
      expect(sectors[1]!.displayBounds.left-sectors[0]!.displayBounds.right).toBe(50);
    }
  });

  it("keeps packing after several removals and places a root added afterwards right after the others",async()=>{
    const {service,rootA,rootB,rootC}=await strip();
    service.removePhysicalRoot(rootB.uuid,"keep-contents");
    let view=service.removePhysicalRoot(rootA.uuid,"keep-contents");
    expect(lefts(view)).toEqual([[rootC.uuid,1100]]);
    expect(geometryFor(view).sectors[0]!.offset).toEqual({x:0,y:0});
    view=service.addStructural({kind:"enclosure",configuration:request(1)});
    const added=rootsOf(view).find(root=>root.uuid!==rootC.uuid)!;
    // The backend still places a new root one gap after the persisted ones; nothing is renumbered.
    expect([rootsOf(view).find(root=>root.uuid===rootC.uuid)!.rootXMm,added.rootXMm]).toEqual([1100,1650]);
    expect(lefts(view)).toEqual([[rootC.uuid,1100],[added.uuid,1650]]);
    service.removePhysicalRoot(rootC.uuid,"keep-contents");
    expect(lefts(service.current()!)).toEqual([[added.uuid,1650]]);
  });

  it("keeps the shifted Carpenteria's contents exact: drawn with it, drops land at the same engineering position, and save/reopen agrees",async()=>{
    const {service,api,destination,rootB,rootC,panelC}=await strip();
    const before=subtree(service.current()!,rootC.uuid);
    let view=service.removePhysicalRoot(rootB.uuid,"remove-contents");
    expect(subtree(view,rootC.uuid)).toEqual(before);
    const geometry=geometryFor(view,rootC.uuid);
    const sector=geometry.sectors.find(entry=>entry.root.uuid===rootC.uuid)!;
    expect(sector.offset).toEqual({x:-550,y:0});
    // Root, Pannello and Apparecchio move together on screen: their offsets inside the Carpenteria are unchanged.
    const placed=devicesOf(view)[0]!;
    const display=(node:ProjectPhysicalNode)=>toDisplayPoint(sector,{x:node.xMm!,y:node.yMm!});
    const rootShown=display(rootsOf(view).find(root=>root.uuid===rootC.uuid)!);
    expect([display(supportsOf(view).find(node=>node.uuid===panelC.uuid)!),display(placed)].map(point=>
      [point.x-rootShown.x,point.y-rootShown.y])).toEqual([[panelC.xMm!-1100,panelC.yMm!],[placed.xMm!-1100,placed.yMm!]]);
    // A drop at the compacted position of a free DIN start picks that exact backend target and stores it unchanged.
    const subject=poolSubject(view,"device");
    const loaded=await loadPlacementTargets(api,subject,rootsOf(view)[0]!,rootsOf(view));
    const wanted=loaded.entries.find(entry=>entry.parentUuid===panelC.uuid&&entry.target.action==="placeChild"&&entry.target.input.startUnits===10)!;
    const point=toDisplayPoint(sector,centre(wanted));
    expect(point.x).toBe(centre(wanted).x-550);
    const picked=pickCombinedTarget(loaded.entries,geometry,pointerAt(geometry,point)!,"device")!;
    expect(picked.entry).toBe(wanted);
    // Read at the old, uncompacted place the pointer finds nothing there.
    expect(pickCombinedTarget(loaded.entries,geometry,centre(wanted),"device")?.entry).not.toBe(wanted);
    view=await dropOnTarget(api,subject,picked.entry.target);
    expect(devicesOf(view).map(node=>[node.parentUuid,node.startUnits]).sort()).toEqual([[panelC.uuid,10],[panelC.uuid,4]].sort());
    const saved=persisted(view);
    await service.save();
    const reopened=service.open(destination);
    expect(persisted(reopened)).toEqual(saved);
    expect(rootsOf(reopened).map(root=>[root.uuid,root.rootXMm])).toContainEqual([rootC.uuid,1100]);
    expect(geometryFor(reopened).sectors.map(entry=>[entry.root.uuid,entry.offset])).toEqual(
      geometryFor(view).sectors.map(entry=>[entry.root.uuid,entry.offset]));
    expect(lefts(reopened).map(([,left])=>left)).toEqual([0,550]);
  });
});

describe("Pannello destinations: any visible Carpenteria the backend accepts",()=>{
  const blockedGuard=(blocked:()=>string|null):ItemGuard=>request=>request.parentUuid&&request.parentUuid===blocked()
    ?{ok:false,code:"required_context_not_provided"}:{ok:true,code:"compatible"};

  /** Two roots of one model (1), a root of another model (5), a FRAME_B root (8), an option variant of model 1 (FRAME_C). */
  async function panels(guard?:ItemGuard|null) {
    const context=await setup(guard);
    const {service}=context;
    service.addStructural({kind:"enclosure",configuration:request(1)});
    service.addStructural({kind:"enclosure",configuration:request(1)});
    service.addStructural({kind:"enclosure",configuration:request(5)});
    service.addStructural({kind:"enclosure",configuration:request(8)});
    const all=service.addStructural({kind:"enclosure",configuration:request(1,[99])});
    const [twinA,twinB,other,frameB,variant]=rootsOf(all) as ProjectPhysicalNode[];
    return {...context,twinA:twinA!,twinB:twinB!,other:other!,frameB:frameB!,variant:variant!,roots:()=>rootsOf(service.current()!)};
  }

  it("offers a pooled Pannello every guard-approved Carpenteria, whatever is focused, and every target is accepted on write",async()=>{
    let blocked:string|null=null;
    const {service,api,twinA,twinB,other,frameB,variant,roots}=await panels(blockedGuard(()=>blocked));
    service.addStructural({kind:"support",parentUuid:twinA.uuid,place:false,configuration:request(2)});
    const pooled=poolSubject(service.current()!,"support");
    blocked=other.uuid;
    const seen=new Set<string>();
    for(const focus of [twinA,other,frameB]){
      const loaded=await loadPlacementTargets(api,pooled,focus,roots());
      const parents=new Set(loaded.entries.map(entry=>entry.parentUuid));
      // Physically fine and guard-approved: the two twins, the variant and (guard permitting) not `other`, not FRAME_B.
      expect(parents).toEqual(new Set([twinA.uuid,twinB.uuid,variant.uuid]));
      expect(loaded.diagnostics.join(" ")).toMatch(/Modello strutturale non compatibile: required_context_not_provided/);
      seen.add([...parents].sort().join());
    }
    expect(seen.size).toBe(1);
    // Every target that is offered is accepted by the write, in any Carpenteria.
    const loaded=await loadPlacementTargets(api,pooled,twinA,roots());
    const inTwinB=loaded.entries.find(entry=>entry.parentUuid===twinB.uuid)!;
    const view=await dropOnTarget(api,pooled,inTwinB.target);
    expect(supportsOf(view).find(node=>node.parentUuid===twinB.uuid)).toBeDefined();
    // A guard-refused Carpenteria has no target, keeps its diagnostic code, and the write refuses it too.
    const refused=service.placementTargets({parentUuid:other.uuid,itemUuid:pooled.item.uuid});
    expect(refused).toMatchObject({targets:[],diagnostics:[{code:"required_context_not_provided"}]});
    const before=JSON.stringify(service.current());
    await expect(api.placeStructuralItem({action:"placeChild",input:{...inTwinB.target.input,parentUuid:other.uuid} as never}))
      .rejects.toThrow(/required_context_not_provided/);
    expect(JSON.stringify(service.current())).toBe(before);
  });

  it("offers a pooled Pannello nothing without a catalogue guard, and the write is refused",async()=>{
    const online=await panels(undefined);
    online.service.addStructural({kind:"support",parentUuid:online.twinA.uuid,place:false,configuration:request(2)});
    const item=poolSubject(online.service.current()!,"support").item;
    expect(online.service.placementTargets({parentUuid:online.twinB.uuid,itemUuid:item.uuid}).targets.length).toBeGreaterThan(0);
    const offline=await panels(null);
    offline.service.addStructural({kind:"support",parentUuid:offline.twinA.uuid,place:false,configuration:request(2)});
    const pooled=poolSubject(offline.service.current()!,"support");
    const loaded=await loadPlacementTargets(offline.api,pooled,offline.twinA,offline.roots());
    expect(loaded.entries).toEqual([]);
    expect(loaded.diagnostics).toEqual(["Verifica del catalogo non disponibile."]);
    expect(offline.service.placementTargets({parentUuid:offline.twinB.uuid,itemUuid:pooled.item.uuid}))
      .toMatchObject({targets:[],diagnostics:[{code:"catalogue_unavailable"}]});
    const before=JSON.stringify(offline.service.current());
    await expect(offline.api.placeStructuralItem({action:"placeChild",input:{itemUuid:pooled.item.uuid,parentUuid:offline.twinB.uuid,zoneNo:0,startUnits:0,viewCode:"front"}}))
      .rejects.toThrow(/catalogo/);
    expect(JSON.stringify(offline.service.current())).toBe(before);
    // Devices are unaffected: their targets never depended on the structural guard.
    offline.service.addConfiguredItem(request(4),1);
  });

  it("moves a placed Pannello with its whole subtree to a same-model Carpenteria, catalogue-free, and never to another model",async()=>{
    // No catalogue guard at all: the move must rest on the project snapshot alone.
    const {service,api,destination,twinA,twinB,other,frameB,variant,roots}=await panels(null);
    service.addStructural({kind:"support",parentUuid:twinA.uuid,configuration:request(2)});
    let view=service.addConfiguredItem(request(4),3);
    const panel=supportsOf(view)[0]!;
    const device=devicePool(view)[0]!.item;
    for(const startUnits of [0,6])view=await api.placeChild({itemUuid:device.uuid,parentUuid:panel.uuid,zoneNo:0,startUnits,viewCode:"front"});
    const placedPanel=()=>supportsOf(service.current()!).find(node=>node.uuid===panel.uuid)!;
    const childrenBefore=JSON.stringify(placedPanel().children);
    const subject=nodeSubject(view,placedPanel());
    // The backend is asked about every Carpenteria; only the same model (twinB) offers targets.
    api.placementTargets.mockClear();
    const loaded=await loadPlacementTargets(api,subject,twinA,roots());
    expect(api.placementTargets.mock.calls.map(call=>call[0].parentUuid).sort()).toEqual(roots().map(root=>root.uuid).sort());
    const parents=new Set(loaded.entries.map(entry=>entry.parentUuid));
    expect(parents).toEqual(new Set([twinA.uuid,twinB.uuid]));
    for(const refused of [other,frameB,variant])
      expect(service.placementTargets({parentUuid:refused.uuid,nodeUuid:panel.uuid}).targets).toEqual([]);
    expect(service.placementTargets({parentUuid:other.uuid,nodeUuid:panel.uuid}).diagnostics[0]!.code).toBe("root_context_unverified");
    // A direct write to another model is refused too, leaving the project exactly unchanged.
    const unchanged=JSON.stringify(service.current());
    for(const refused of [other,frameB])
      await expect(api.moveNode(panel.uuid,{itemUuid:panel.itemUuid!,parentUuid:refused.uuid,zoneNo:0,startUnits:0,viewCode:"front"}))
        .rejects.toThrow();
    expect(JSON.stringify(service.current())).toBe(unchanged);
    // The variant is the same model but its FRAME_C makes an Apparecchio invalid: the whole move is refused atomically.
    expect(service.placementTargets({parentUuid:variant.uuid,nodeUuid:panel.uuid}).targets).toEqual([]);
    await expect(api.moveNode(panel.uuid,{itemUuid:panel.itemUuid!,parentUuid:variant.uuid,zoneNo:0,startUnits:0,viewCode:"front"})).rejects.toThrow();
    expect(JSON.stringify(service.current())).toBe(unchanged);
    // Same model: the node moves, its Apparecchi stay attached with unchanged UUIDs and internal positions.
    const target=loaded.entries.find(entry=>entry.parentUuid===twinB.uuid&&entry.target.action==="moveNode"&&entry.target.input.startUnits===300)!;
    expect(target).toBeDefined();
    const moved=await dropOnTarget(api,subject,target.target);
    expect(api.moveNode).toHaveBeenCalledWith(panel.uuid,target.target.input);
    const now=supportsOf(moved).find(node=>node.uuid===panel.uuid)!;
    expect(now).toMatchObject({parentUuid:twinB.uuid,startUnits:300});
    expect(JSON.stringify(now.children.map(child=>[child.uuid,child.parentUuid,child.zoneNo,child.startUnits,child.slotNo])))
      .toBe(JSON.stringify(JSON.parse(childrenBefore).map((child:ProjectPhysicalNode)=>[child.uuid,child.parentUuid,child.zoneNo,child.startUnits,child.slotNo])));
    expect(now.children.every(child=>child.positionIssue===null)).toBe(true);
    expect(devicesOf(moved)).toHaveLength(2);
    expect(devicePool(moved).map(entry=>[entry.quantity,entry.placed])).toEqual([[3,2]]);
    // Save, reopen without any catalogue, and move it back: still works from the snapshot alone.
    await service.save();
    const folder=mkdtempSync(path.join(tmpdir(),"librequadri-offline-"));folders.push(folder);
    const offline=new ProjectDocumentService({workingDirectory:path.join(folder,"working"),
      incomingDirectory:path.join(folder,"incoming"),backupDirectory:path.join(folder,"backup"),
      migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
      resolveCatalogueProduct:()=>{throw new Error("no catalogue");}});
    const reopened=offline.open(destination);
    expect(JSON.stringify(reopened.physicalNodes)).toBe(JSON.stringify(moved.physicalNodes));
    const back=offline.placementTargets({parentUuid:twinA.uuid,nodeUuid:panel.uuid}).targets.find(entry=>entry.action==="moveNode")!;
    expect(back).toBeDefined();
    expect(offline.placementTargets({parentUuid:other.uuid,nodeUuid:panel.uuid}).targets).toEqual([]);
    const returned=offline.moveNode(panel.uuid,back.input as never);
    const home=supportsOf(returned).find(node=>node.uuid===panel.uuid)!;
    expect(home.parentUuid).toBe(twinA.uuid);
    expect(home.children.map(child=>[child.uuid,child.startUnits])).toEqual(now.children.map(child=>[child.uuid,child.startUnits]));
    expect(()=>offline.placeStructuralItem({action:"placeChild",input:back.input as never})).toThrow(/catalogo/i);
  });
});
