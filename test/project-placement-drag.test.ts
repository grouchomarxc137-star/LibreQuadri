import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { openCurrentProjectDatabase } from "../src/main/database/project-migrations.js";
import { insertConfiguredItem } from "../src/main/project/configured-items.js";
import { placeRoot } from "../src/main/project/physical-placement.js";
import { frontGeometry } from "../src/renderer/project/front-geometry.js";
import { clientToViewBox, dragGuidance, dropOnTarget, loadPlacementTargets, pickTarget,
  placementFailureMessage, type DragSubject, type TargetEntry } from "../src/renderer/project/placement-drag.js";
import { devicePool, structuralPool, submitUnplacement } from "../src/renderer/project/placement-workflow.js";
import type { ConfigurationResult } from "../src/shared/configuration.js";
import type { CatalogueProductSnapshotSource, ProjectDocumentView, ProjectPhysicalNode } from "../src/shared/project.js";

const article:CatalogueProductSnapshotSource={brandMarchio:"TEST",brandName:"Test",
  manufacturerCode:"ARTICLE",ean:null,shortDescription:"Article",description:"Article",
  unitOfMeasure:"PCE",categoryCode:null,categoryPathLabel:null,familyCode:null,familyName:null,
  priceIssuerSigla:"TEST",priceListinoNumber:"1",priceValidFrom:"2026-09-26",
  listPriceUnitE4:10_000,priceMultiplierOriginal:1,attributes:[]};

// Models 6 and 7 are wider/taller versions of the device and support.
const kindOf=(id:number)=>id===1||id===5||id===9?"enclosure":id===4||id===6?"device":"support";
function configured(id:number):ConfigurationResult {
  const kind=kindOf(id);
  const physical={id,code:`profile-${id}`,name:`Profile ${id}`,kind,profileKey:null,
    fitClass:{id,code:kind==="enclosure"?"FRAME":kind==="support"?(id===8?"PANEL-B":"PANEL"):"DEV",name:kind},
    depthMm:null,outerDepthMm:null,usableDepthMm:null,
    demands:kind==="device"?[{capacityKindCode:"din",amount:id===6?4:2,unitLabel:"moduli",displayDivisor:2,nominalPitchMm:9}]:[],
    views:[{code:"front",widthMm:kind==="device"?(id===6?36:18):500,
      heightMm:kind==="enclosure"?1000:kind==="support"?(id===7?200:100):80,insertDxMm:0,insertDyMm:0,
      symbolKind:"rectangle",assetKey:null}],
    zones:kind==="enclosure"?[{zoneNo:0,layout:"stack",capacityKindCode:null,capacityAmount:600,
      originXMm:0,originYMm:0,lengthMm:600,breadthMm:500,direction:"vertical",pitchMm:1,requiredViewCode:"front"}]
      :kind==="support"?[{zoneNo:0,layout:"linear",capacityKindCode:"din",capacityKindLabel:"moduli",
        displayDivisor:2,nominalPitchMm:9,capacityAmount:20,originXMm:10,originYMm:10,lengthMm:null,
        breadthMm:null,direction:"horizontal",pitchMm:null,requiredViewCode:null}]:[],
    slots:[],
    constraints:kind==="support"?[{relation:"ancestor",acceptSetCode:"frame",classCodes:["FRAME"]}]
      :kind==="device"?[{relation:"parent",acceptSetCode:"panel",classCodes:id===6?["PANEL","PANEL-B"]:["PANEL"]}]:[]};
  return {model:{id,code:`model-${id}`,name:`Model ${id}`,kind,brandMarchio:"TEST",active:true,
    obsolete:false,commercialContribution:"articles",definitionFingerprint:`definition-${id}`,sourceRef:null,baseProfileId:id,
    maxInsertQty:null,axes:[],budgets:[],relations:[]},selectedOptionIds:[],defaultedOptionIds:[],
    commercialContribution:"articles",matchingRuleIds:[],fingerprint:`config-${id}`,status:"complete",issues:[],bom:[{
      brandMarchio:"TEST",manufacturerCode:"ARTICLE",productId:1,linkedBrandMarchio:"TEST",
      linkedManufacturerCode:"ARTICLE",quantity:1,roles:["primary"],description:"Article",
      unitPriceE4:10_000,rowTotalE4:10_000,currency:"EUR",priceIssuerSigla:"TEST",
      priceListinoNumber:"1",priceValidFrom:"2026-09-26",priceMultiplierOriginal:1}],
    totalE4:10_000,pricedSubtotalE4:10_000,budgets:[],physical,exclusions:[]} as ConfigurationResult;
}

const folders:string[]=[];
afterEach(()=>{for(const folder of folders.splice(0))rmSync(folder,{recursive:true,force:true});});

const request=(modelId:number)=>({modelId,selectedOptionIds:[]});
async function setup(withGamma=false) {
  const folder=mkdtempSync(path.join(tmpdir(),"librequadri-placement-drag-"));folders.push(folder);
  const catalogue=withGamma?openMigratedLqDatabase({databaseFilename:path.join(folder,"lq.db"),
    backupDirectory:path.join(folder,"backup"),migrationsFolder:path.resolve("db/migrations/lq")}):null;
  catalogue?.exec(`INSERT INTO cat_brand(id,metel_marchio,name,source) VALUES(1,'TEST','Test','manual');
    INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,definition_fingerprint,source) VALUES
      (1,1,'model-1','MDX 800 A','enclosure','definition-1','manual'),
      (5,1,'model-5','MDX 800 B','enclosure','definition-5','manual'),
      (9,1,'model-9','LDX 800 A','enclosure','definition-9','manual');
    INSERT INTO cat_range_node(id,brand_id,parent_id,code,name,node_kind,level_code,source,design_navigable) VALUES
      (1,1,NULL,'mdx800','MDX 800','level','gamma','manual',1),
      (2,1,NULL,'ldx800','LDX 800','level','gamma','manual',1),
      (3,1,1,'mdx-group','Struttura','group',NULL,'manual',1),
      (4,1,2,'ldx-group','Struttura','group',NULL,'manual',1);
    INSERT INTO cat_range_node_model(node_id,model_id) VALUES(3,1),(3,5),(4,9);`);
  const service=new ProjectDocumentService({workingDirectory:path.join(folder,"working"),
    incomingDirectory:path.join(folder,"incoming"),backupDirectory:path.join(folder,"backup"),
    migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
    resolveCatalogueProduct:()=>article,resolveConfiguration:input=>configured(input.modelId),
    designGuard:()=>({ok:true,code:"compatible"}),designItemGuard:()=>({ok:true,code:"compatible"}),
    engineeringCatalogue:()=>catalogue});
  await service.create({destinationPath:path.join(folder,"case.lqp"),title:"Case",description:"",notes:"",
    projectType:"civil",executor:"",date:"2026-09-28",companyName:"Client",companyDescription:""});
  // The renderer talks to the project through this surface; every call is recorded.
  const api={
    placementTargets:vi.fn(async(input:Parameters<typeof service.placementTargets>[0])=>service.placementTargets(input)),
    placeStructuralItem:vi.fn(async(input:Parameters<typeof service.placeStructuralItem>[0])=>service.placeStructuralItem(input)),
    placeChild:vi.fn(async(input:Parameters<typeof service.placeChild>[0])=>service.placeChild(input)),
    insertPackedChild:vi.fn(async(input:Parameters<typeof service.insertPackedChild>[0],index?:number)=>
      service.insertPackedChild(input,index)),
    moveNode:vi.fn(async(uuid:string,input:Parameters<typeof service.moveNode>[1])=>service.moveNode(uuid,input)),
    movePackedNode:vi.fn(async(uuid:string,input:Parameters<typeof service.movePackedNode>[1])=>
      service.movePackedNode(uuid,input)),
    unplaceNode:vi.fn(async(uuid:string)=>service.unplaceNode(uuid)),
    removePackedNode:vi.fn(async(uuid:string)=>service.removePackedNode(uuid)),
  };
  return {service,api,catalogue,filename:path.join(folder,"case.lqp")};
}
const flat=(nodes:readonly ProjectPhysicalNode[]):ProjectPhysicalNode[]=>nodes.flatMap(node=>[node,...flat(node.children)]);
const supportsOf=(view:ProjectDocumentView)=>flat(view.physicalNodes).filter(node=>node.nodeKind==="support");
const devicesOf=(view:ProjectDocumentView)=>flat(view.physicalNodes).filter(node=>node.nodeKind==="device");
const poolSubject=(view:ProjectDocumentView,kind:"support"|"device"):DragSubject=>
  ({origin:"pool",kind,item:(kind==="support"?structuralPool(view):devicePool(view))[0]!.item});
const nodeSubject=(view:ProjectDocumentView,node:ProjectPhysicalNode):DragSubject=>({origin:"node",
  kind:node.nodeKind as "support"|"device",item:view.configuredItems.find(item=>item.uuid===node.itemUuid)!,
  nodeUuid:node.uuid,...(node.parentUuid?{parentUuid:node.parentUuid}:{})});
const centre=(entry:TargetEntry)=>({x:entry.target.subject.xMm+entry.target.subject.widthMm/2,
  y:entry.target.subject.yMm+entry.target.subject.heightMm/2});
const rects=(view:ProjectDocumentView,root:ProjectPhysicalNode)=>
  frontGeometry(root,view.configuredItems as never,1)!.parentRects;

describe("drag and drop over exact backend placement targets",()=>{
  it("places a pooled Pannello on its Carpenteria through the exact returned target",async()=>{
    const {service,api}=await setup();
    const rootView=service.addStructural({kind:"enclosure",configuration:request(1)});
    const root=rootView.physicalNodes[0]!;
    const added=service.addStructural({kind:"support",parentUuid:root.uuid,place:false,configuration:request(2)});
    expect(structuralPool(added).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[1,0,1]]);
    const subject=poolSubject(added,"support");
    const loaded=await loadPlacementTargets(api,subject,root);
    expect(api.placementTargets.mock.calls).toEqual([[{parentUuid:root.uuid,itemUuid:subject.item.uuid}]]);
    expect(loaded.entries.length).toBeGreaterThan(100);
    expect(loaded.entries.every(entry=>entry.parentUuid===root.uuid&&entry.target.action==="placeChild")).toBe(true);
    // Pointer just below the middle of the enclosure: the nearest returned rectangle is chosen, not computed.
    const wanted=loaded.entries.find(entry=>entry.target.subject.yMm===200)!;
    const picked=pickTarget(loaded.entries,rects(added,root),centre(wanted))!;
    expect(picked).toBe(wanted);
    const before=service.current()!;
    const updated=await dropOnTarget(api,subject,picked.target);
    expect(api.placeStructuralItem).toHaveBeenCalledOnce();
    expect(api.placeStructuralItem).toHaveBeenCalledWith({action:"placeChild",input:picked.target.input});
    expect(api.placeChild).not.toHaveBeenCalled();
    expect(structuralPool(updated).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[1,1,0]]);
    const placed=supportsOf(updated)[0]!;
    expect(placed).toMatchObject({parentUuid:root.uuid,startUnits:200,yMm:200});
    expect(updated).not.toEqual(before);
    // Exhausted: the backend offers no position and says why; the drop is refused without mutation.
    const exhausted=await loadPlacementTargets(api,poolSubject(updated,"support"),root);
    expect(exhausted.entries).toEqual([]);
    expect(exhausted.diagnostics[0]).toMatch(/quantità/);
    expect(dragGuidance(subject,"ready",exhausted,null)).toContain("Nessuna posizione compatibile. ");
    const beforeStale=service.current()!;
    await expect(dropOnTarget(api,subject,picked.target)).rejects.toThrow();
    expect(service.current()).toEqual(beforeStale);
  });

  it("moves a placed Pannello vertically inside its own Carpenteria only",async()=>{
    const {service,api,catalogue}=await setup(true);
    service.addStructural({kind:"enclosure",configuration:request(1)});
    const both=service.addStructural({kind:"enclosure",configuration:request(5)});
    catalogue!.close();
    const [rootA,rootB]=both.physicalNodes as [ProjectPhysicalNode,ProjectPhysicalNode];
    const placed=service.addStructural({kind:"support",parentUuid:rootA.uuid,configuration:request(2)});
    const panel=supportsOf(placed)[0]!;
    expect(panel.startUnits).toBe(0);
    const subject=nodeSubject(placed,panel);
    const loaded=await loadPlacementTargets(api,subject,placed.physicalNodes[0]!);
    // Only the current Carpenteria is ever asked; another root is never offered.
    expect(api.placementTargets.mock.calls).toEqual([[{parentUuid:rootA.uuid,nodeUuid:panel.uuid,reflow:true}]]);
    expect(JSON.stringify(api.placementTargets.mock.calls)).not.toContain(rootB.uuid);
    expect(loaded.entries.every(entry=>entry.parentUuid===rootA.uuid&&entry.target.action==="moveNode")).toBe(true);
    const target=loaded.entries.find(entry=>entry.target.subject.yMm===300)!;
    const picked=pickTarget(loaded.entries,rects(placed,placed.physicalNodes[0]!),centre(target))!;
    const before=service.current()!;
    expect(service.current()).toEqual(before);
    const updated=await dropOnTarget(api,subject,picked.target);
    expect(api.moveNode).toHaveBeenCalledWith(panel.uuid,picked.target.input);
    expect(api.movePackedNode).not.toHaveBeenCalled();
    expect(supportsOf(updated)[0]).toMatchObject({uuid:panel.uuid,parentUuid:rootA.uuid,startUnits:300,yMm:300});
    expect(structuralPool(updated).map(entry=>entry.available)).toEqual([0]);
    // A move target cannot be used for an unplaced unit, and a foreign node's target cannot be used for this node.
    await expect(dropOnTarget(api,poolSubject(updated,"support"),picked.target)).rejects.toThrow();
    await expect(dropOnTarget(api,{...subject,nodeUuid:"other"},picked.target)).rejects.toThrow();
  });

  it("allows different models of the same Gamma and preserves old mixed projects",async()=>{
    const {service,catalogue,filename}=await setup(true);
    try {
      service.addStructural({kind:"enclosure",configuration:request(1)});
      const same=service.addStructural({kind:"enclosure",configuration:request(5)});
      expect(same.physicalNodes).toHaveLength(2);
      expect(()=>service.addStructural({kind:"enclosure",configuration:request(9)}))
        .toThrow("LDX 800 non può essere affiancata a MDX 800");
      expect(service.current()).toEqual(same);
      await service.save();
      service.close();
      const db=openCurrentProjectDatabase(filename,path.resolve("db/migrations/project"));
      try {
        const itemUuid=insertConfiguredItem(db,configured(9),()=>article,"2026-11-12T00:00:00.000Z",2,true);
        placeRoot(db,{itemUuid,rootXMm:1100,rootYMm:0,viewCode:"front"});
      } finally {db.close();}
      const mixed=service.open(filename);
      expect(mixed.physicalNodes).toHaveLength(3);
      expect(()=>service.placeRoot({itemUuid:mixed.physicalNodes[2]!.itemUuid!,
        rootXMm:1700,rootYMm:0,viewCode:"front"})).toThrow("stessa gamma");
      expect(service.current()).toEqual(mixed);
    } finally {service.close();catalogue!.close();}
  });

  it("places and moves Apparecchi freely across Pannelli using backend actions",async()=>{
    const {service,api}=await setup();
    const root=service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    service.addStructural({kind:"support",parentUuid:root.uuid,configuration:request(2)});
    service.addStructural({kind:"support",parentUuid:root.uuid,configuration:request(2)});
    let view=service.addConfiguredItem(request(4),3);
    const [panelA,panelB]=supportsOf(view) as [ProjectPhysicalNode,ProjectPhysicalNode];
    const drop=async(subject:DragSubject,select:(entries:TargetEntry[])=>TargetEntry)=>{
      const rootNode=view.physicalNodes[0]!;
      const loaded=await loadPlacementTargets(api,subject,rootNode);
      const entry=select(loaded.entries);
      expect(pickTarget(loaded.entries,rects(view,rootNode),centre(entry),subject.kind)).toBe(entry);
      view=await dropOnTarget(api,subject,entry.target);
      return loaded;
    };
    // Pool device: one request per Pannello of the shown Carpenteria.
    const first=await drop(poolSubject(view,"device"),entries=>entries.find(entry=>entry.parentUuid===panelB.uuid)!);
    expect(api.placementTargets.mock.calls.map(call=>call[0])).toEqual([
      {parentUuid:panelA.uuid,itemUuid:poolSubject(view,"device").item.uuid},
      {parentUuid:panelB.uuid,itemUuid:poolSubject(view,"device").item.uuid}]);
    expect(new Set(first.entries.map(entry=>entry.parentUuid))).toEqual(new Set([panelA.uuid,panelB.uuid]));
    expect(first.entries.every(entry=>entry.target.action==="placeChild")).toBe(true);
    expect(api.placeChild).toHaveBeenCalledTimes(1);
    expect(api.insertPackedChild).not.toHaveBeenCalled();
    expect(devicesOf(view).map(node=>node.parentUuid)).toEqual([panelB.uuid]);
    expect(devicePool(view).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[3,1,2]]);
    await drop(poolSubject(view,"device"),entries=>entries.find(entry=>entry.parentUuid===panelB.uuid&&
      entry.target.action==="placeChild"&&entry.target.input.startUnits===6)!);
    expect(devicesOf(view)).toHaveLength(2);
    const [firstNow,second]=supportsOf(view).find(node=>node.uuid===panelB.uuid)!.children;
    expect(firstNow!.startUnits).toBe(0);
    expect(second!.startUnits).toBe(6);
    const fresh=await loadPlacementTargets(api,poolSubject(view,"device"),view.physicalNodes[0]!);
    const shown=frontGeometry(view.physicalNodes[0]!,view.configuredItems as never,1)!;
    const occupied={x:firstNow!.xMm!+9,y:firstNow!.yMm!+40};
    expect(pickTarget(fresh.entries,shown.parentRects,occupied,"device")).toBeNull();
    const free=fresh.entries.find(entry=>entry.parentUuid===panelB.uuid&&
      entry.target.action==="placeChild"&&entry.target.input.startUnits===2)!;
    expect(pickTarget(fresh.entries,shown.parentRects,centre(free),"device")).toBe(free);
    // An explicit move leaves the old position empty and does not shift the sibling.
    api.movePackedNode.mockClear();api.moveNode.mockClear();
    await drop(nodeSubject(view,second!),entries=>entries.find(entry=>entry.parentUuid===panelB.uuid&&
      entry.target.action==="moveNode"&&entry.target.input.startUnits===2)!);
    expect(api.moveNode).toHaveBeenCalledOnce();
    expect(api.movePackedNode).not.toHaveBeenCalled();
    const moved=supportsOf(view).find(node=>node.uuid===panelB.uuid)!.children;
    expect(moved.map(node=>[node.uuid,node.startUnits])).toEqual([[firstNow!.uuid,0],[second!.uuid,2]]);
    // Compatible cross-Pannello move offered by the backend.
    const moving=moved[0]!;
    const loaded=await drop(nodeSubject(view,moving),entries=>entries.find(entry=>entry.parentUuid===panelA.uuid&&
      entry.target.action==="moveNode"&&entry.target.input.startUnits===4)!);
    expect(loaded.entries.some(entry=>entry.parentUuid===panelA.uuid&&entry.target.action==="moveNode")).toBe(true);
    expect(supportsOf(view).find(node=>node.uuid===panelA.uuid)!.children.map(node=>node.uuid)).toEqual([moving.uuid]);
    expect(supportsOf(view).find(node=>node.uuid===panelB.uuid)!.children.map(node=>[node.uuid,node.startUnits]))
      .toEqual([[second!.uuid,2]]);
    expect(service.placementTargets({itemUuid:poolSubject(view,"device").item.uuid,parentUuid:panelB.uuid})
      .targets.some(target=>target.action==="placeChild"&&target.input.startUnits===0)).toBe(true);
    expect(devicePool(view).map(entry=>entry.available)).toEqual([1]);
  });

  it("unplaces a device without repacking its siblings",async()=>{
    const {service,api}=await setup();
    const root=service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    service.addStructural({kind:"support",parentUuid:root.uuid,configuration:request(2)});
    let view=service.addConfiguredItem(request(4),3);
    const panel=supportsOf(view)[0]!;
    const device=poolSubject(view,"device").item;
    for(const startUnits of [0,6,12])view=await api.placeChild({itemUuid:device.uuid,parentUuid:panel.uuid,
      zoneNo:0,startUnits,viewCode:"front"});
    const [first,middle,last]=supportsOf(view)[0]!.children;
    view=await submitUnplacement(api,middle!.uuid);
    expect(api.unplaceNode).toHaveBeenCalledWith(middle!.uuid);
    expect(api.removePackedNode).not.toHaveBeenCalled();
    expect(supportsOf(view)[0]!.children.map(node=>[node.uuid,node.startUnits]))
      .toEqual([[first!.uuid,0],[last!.uuid,12]]);
    const targets=service.placementTargets({itemUuid:device.uuid,parentUuid:panel.uuid}).targets;
    expect(targets.some(target=>target.action==="placeChild"&&target.input.startUnits===6)).toBe(true);
  });

  it("reorders mixed-height Pannelli in a full Carpenteria and carries every child",async()=>{
    const {service,api,filename}=await setup();
    const root=service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    for(const id of [7,2,2,2,2])service.addStructural({kind:"support",parentUuid:root.uuid,configuration:request(id)});
    let view=service.addConfiguredItem(request(4),2);
    const [first,second,third]=supportsOf(view);
    const device=poolSubject(view,"device").item;
    for(const startUnits of [0,2])view=service.placeChild({itemUuid:device.uuid,parentUuid:first!.uuid,
      zoneNo:0,startUnits,viewCode:"front"});
    const before=view.physicalNodes;
    const subject=nodeSubject(view,first!);
    const loaded=await loadPlacementTargets(api,subject,before[0]!);
    const point={x:250,y:third!.yMm!+50};
    const picked=pickTarget(loaded.entries,rects(view,before[0]!),point)!;
    expect(picked.target).toMatchObject({action:"movePackedNode",input:{anchorUuid:third!.uuid}});
    expect(picked.target.affected.map(row=>row.nodeUuid)).toEqual(expect.arrayContaining(
      [second!.uuid,third!.uuid,...devicesOf(view).map(row=>row.uuid)]));
    view=await dropOnTarget(api,subject,picked.target);
    const reordered=supportsOf(view);
    expect(reordered.slice(0,3).map(row=>[row.uuid,row.yMm])).toEqual(
      [[second!.uuid,0],[third!.uuid,100],[first!.uuid,200]]);
    expect(reordered[2]!.children.map(row=>[row.parentUuid,row.startUnits,row.yMm]))
      .toEqual([[first!.uuid,0,210],[first!.uuid,2,210]]);
    expect(service.undo().physicalNodes).toEqual(before);
    expect(service.redo().physicalNodes).toEqual(view.physicalNodes);
    await service.save();
    service.close();
    expect(service.open(filename).physicalNodes).toEqual(view.physicalNodes);
  });

  it.each(["forward","backward"] as const)("shifts a full rail %s and moves overflow to the next Pannello",async direction=>{
    const {service,api}=await setup();
    const root=service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    for(let index=0;index<3;index++)
      service.addStructural({kind:"support",parentUuid:root.uuid,configuration:request(2)});
    let view=service.addConfiguredItem(request(4),10);
    const small=poolSubject(view,"device").item;
    view=service.addConfiguredItem(request(6));
    const wide=view.configuredItems.find(row=>row.modelCode==="model-6")!;
    const panels=supportsOf(view);
    const [source,target,overflow]=direction==="forward"?panels:[...panels].reverse();
    view=service.placeChild({itemUuid:wide.uuid,parentUuid:source!.uuid,zoneNo:0,startUnits:0,viewCode:"front"});
    for(let startUnits=0;startUnits<20;startUnits+=2)
      view=service.placeChild({itemUuid:small.uuid,parentUuid:target!.uuid,zoneNo:0,startUnits,viewCode:"front"});
    const children=(snapshot:ProjectDocumentView,uuid:string)=>supportsOf(snapshot).find(row=>row.uuid===uuid)!.children;
    const moving=children(view,source!.uuid)[0]!;
    const original=children(view,target!.uuid);
    const anchor=original[4]!;
    const subject=nodeSubject(view,moving);
    const loaded=await loadPlacementTargets(api,subject,view.physicalNodes[0]!);
    const point={x:anchor.xMm!+(direction==="forward"?4:14),y:anchor.yMm!+40};
    const picked=pickTarget(loaded.entries,rects(view,view.physicalNodes[0]!),point,"device")!;
    expect(picked.target).toMatchObject({action:"movePackedNode",input:{direction,anchorUuid:anchor.uuid}});
    const displaced=direction==="forward"?original.slice(-2):original.slice(0,2);
    expect(picked.target.affected.map(row=>row.nodeUuid)).toEqual(expect.arrayContaining(displaced.map(row=>row.uuid)));
    const updated=await dropOnTarget(api,subject,picked.target);
    expect(children(updated,overflow!.uuid).map(row=>row.uuid)).toEqual(displaced.map(row=>row.uuid));
    expect(children(updated,target!.uuid).find(row=>row.uuid===moving.uuid)?.startUnits)
      .toBe(direction==="forward"?8:6);
    expect(service.undo().physicalNodes).toEqual(view.physicalNodes);

    const localSubject=nodeSubject(view,original[0]!);
    const local=await loadPlacementTargets(api,localSubject,view.physicalNodes[0]!);
    const localTarget=pickTarget(local.entries,rects(view,view.physicalNodes[0]!),
      {x:original[2]!.xMm!+9,y:anchor.yMm!+40},"device")!;
    const reordered=await dropOnTarget(api,localSubject,localTarget.target);
    expect(children(reordered,target!.uuid).slice(0,3).map(row=>row.uuid))
      .toEqual([original[1]!.uuid,original[2]!.uuid,original[0]!.uuid]);

    const afterRemoval=service.unplaceNode(anchor.uuid);
    await expect(dropOnTarget(api,subject,picked.target)).rejects.toThrow("posizione scelta è cambiato");
    expect(service.current()).toEqual(afterRemoval);
  });

  it("refuses a full-rail drop atomically when the displaced devices cannot use the source panel",async()=>{
    const {service}=await setup();
    const root=service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    for(const id of [8,2])service.addStructural({kind:"support",parentUuid:root.uuid,configuration:request(id)});
    const [source,target]=supportsOf(service.addConfiguredItem(request(4),10));
    const view=service.addConfiguredItem(request(6));
    const small=view.configuredItems.find(row=>row.modelCode==="model-4")!;
    const wide=view.configuredItems.find(row=>row.modelCode==="model-6")!;
    const placed=service.placeChild({itemUuid:wide.uuid,parentUuid:source!.uuid,zoneNo:0,startUnits:0,viewCode:"front"});
    const moving=devicesOf(placed)[0]!;
    for(let startUnits=0;startUnits<20;startUnits+=2)
      service.placeChild({itemUuid:small.uuid,parentUuid:target!.uuid,zoneNo:0,startUnits,viewCode:"front"});
    const before=service.current()!;
    const anchor=supportsOf(before)[1]!.children[4]!;
    const requestTarget={parentUuid:target!.uuid,nodeUuid:moving.uuid,reflow:true} as const;
    expect(service.placementTargets(requestTarget).targets).toEqual([]);
    expect(()=>service.movePackedNode(moving.uuid,{parentUuid:target!.uuid,zoneNo:0,viewCode:"front",
      direction:"forward",anchorUuid:anchor.uuid})).toThrow("Nessun pannello compatibile");
    expect(service.current()).toEqual(before);
  });

  it("changes nothing while targets load or when a drag is abandoned, and refuses stale drops without mutation",async()=>{
    const {service,api}=await setup();
    const firstRoot=service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    service.addStructural({kind:"support",parentUuid:firstRoot.uuid,configuration:request(2)});
    const view=service.addConfiguredItem(request(4),1);
    const root=view.physicalNodes[0]!;
    const snapshot=JSON.stringify(service.current());
    const subject=poolSubject(view,"device");
    const loaded=await loadPlacementTargets(api,subject,root);
    expect(loaded.entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(service.current())).toBe(snapshot);
    // Invalid/abandoned drags never reach a mutation call.
    expect(api.insertPackedChild).not.toHaveBeenCalled();
    expect(api.placeChild).not.toHaveBeenCalled();
    // Another client used the last unit after the targets were loaded: the backend refuses.
    const prior=loaded.entries[0]!.target;
    if(prior.action!=="placeChild")throw new Error("Expected explicit device placement");
    service.placeChild(prior.input);
    const afterOther=JSON.stringify(service.current());
    let failure:unknown;
    await dropOnTarget(api,subject,loaded.entries[0]!.target).catch(error=>{failure=error;});
    expect(failure).toBeInstanceOf(Error);
    expect(JSON.stringify(service.current())).toBe(afterOther);
    const text=placementFailureMessage(failure);
    expect(text).toMatch(/quantità/);
    expect(text).not.toMatch(/[a-z]+_[a-z_]+/);
  });

  it("keeps target geometry and hit-testing correct at every zoom level",async()=>{
    const {service,api}=await setup();
    const root=service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    const view=service.addStructural({kind:"support",parentUuid:root.uuid,place:false,configuration:request(2)});
    const rootNode=view.physicalNodes[0]!;
    const loaded=await loadPlacementTargets(api,poolSubject(view,"support"),rootNode);
    const wanted=loaded.entries.find(entry=>entry.target.subject.yMm===450)!;
    for(const zoom of [0.5,1,1.25,2,4]){
      const geometry=frontGeometry(rootNode,view.configuredItems as never,zoom)!;
      const box={left:120,top:40,width:640,height:480};
      const [x,y,w,h]=geometry.viewBox;
      const scale=Math.min(box.width/w,box.height/h);
      const client={x:box.left+(box.width-w*scale)/2+(centre(wanted).x-x)*scale,
        y:box.top+(box.height-h*scale)/2+(centre(wanted).y-y)*scale};
      const drawn=clientToViewBox(client,box,geometry.viewBox)!;
      expect(drawn.x).toBeCloseTo(centre(wanted).x,6);
      expect(drawn.y).toBeCloseTo(centre(wanted).y,6);
      expect(pickTarget(loaded.entries,geometry.parentRects,drawn)).toBe(wanted);
    }
    // Zooming changes the viewBox but never the backend rectangles.
    expect(frontGeometry(rootNode,view.configuredItems as never,2)!.viewBox[2])
      .toBeLessThan(frontGeometry(rootNode,view.configuredItems as never,1)!.viewBox[2]);
    expect(wanted.target.subject).toMatchObject({xMm:0,yMm:450,widthMm:500,heightMm:100});
  });
});
