import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openCurrentProjectDatabase } from "../src/main/database/project-migrations.js";
import { deletePhysicalRoot, unplaceSubtree } from "../src/main/project/physical-placement.js";
import { ProjectDocumentService, removePhysicalRoot } from "../src/main/project/project-document-service.js";
import { devicePool, structuralPool, submitSelectionUnplacement, submitUnplacement } from "../src/renderer/project/placement-workflow.js";
import { combinedFrontGeometry } from "../src/renderer/project/front-geometry.js";
import { loadPlacementTargets, pickCombinedTarget, type DragSubject } from "../src/renderer/project/placement-drag.js";
import { describeSelection, designKeyCommand, designSelectionReducer, selectableUuids,
  unplaceBlockReason } from "../src/renderer/project/design-selection.js";
import type { ConfigurationResult } from "../src/shared/configuration.js";
import type { CatalogueProductSnapshotSource, ProjectDocumentView, ProjectPhysicalNode } from "../src/shared/project.js";

/*
 * R-17c physical actions over the real document service. Rimuovi posizione / Delete unplaces a
 * selected Apparecchio, or a Pannello with everything placed in it, and keeps configured items and Q. Removing a whole Carpenteria is
 * one backend transaction. `keep-contents` returns its
 * Pannelli and Apparecchi to the unplaced pool; `remove-contents` also takes those placed units
 * out of the project. The Carpenteria's own unit leaves the project either way.
 */
const article:CatalogueProductSnapshotSource={brandMarchio:"TEST",brandName:"Test",
  manufacturerCode:"ARTICLE",ean:null,shortDescription:"Article",description:"Article",
  unitOfMeasure:"PCE",categoryCode:null,categoryPathLabel:null,familyCode:null,familyName:null,
  priceIssuerSigla:"TEST",priceListinoNumber:"1",priceValidFrom:"2026-09-29",
  listPriceUnitE4:10_000,priceMultiplierOriginal:1,attributes:[]};

// 1 and 5: enclosures (FRAME); 2: Pannello (PANEL); 4: Apparecchio (needs a PANEL parent).
const kindOf=(id:number)=>id===1||id===5?"enclosure":id===4?"device":"support";
function configured(id:number):ConfigurationResult {
  const kind=kindOf(id);
  const physical={id,code:`profile-${id}`,name:`Profile ${id}`,kind,profileKey:null,
    fitClass:{id,code:kind==="enclosure"?"FRAME":kind==="support"?"PANEL":"DEV",name:kind},depthMm:null,outerDepthMm:null,usableDepthMm:null,
    demands:kind==="device"?[{capacityKindCode:"din",amount:2,unitLabel:"moduli",displayDivisor:2,nominalPitchMm:9}]:[],
    views:[{code:"front",widthMm:kind==="device"?18:500,heightMm:kind==="enclosure"?1000:kind==="support"?100:80,
      insertDxMm:0,insertDyMm:0,symbolKind:"rectangle",assetKey:null}],
    zones:kind==="enclosure"?[{zoneNo:0,layout:"stack",capacityKindCode:null,capacityAmount:600,
      originXMm:0,originYMm:0,lengthMm:600,breadthMm:500,direction:"vertical",pitchMm:1,requiredViewCode:"front"}]
      :kind==="support"?[{zoneNo:0,layout:"linear",capacityKindCode:"din",capacityKindLabel:"moduli",
        displayDivisor:2,nominalPitchMm:9,capacityAmount:20,originXMm:10,originYMm:10,lengthMm:null,
        breadthMm:null,direction:"horizontal",pitchMm:null,requiredViewCode:null}]:[],
    slots:[],
    constraints:kind==="support"?[{relation:"ancestor",acceptSetCode:"frame",classCodes:["FRAME"]}]
      :kind==="device"?[{relation:"parent",acceptSetCode:"panel",classCodes:["PANEL"]}]:[]};
  return {model:{id,code:`model-${id}`,name:`Model ${id}`,kind,brandMarchio:"TEST",active:true,
    obsolete:false,commercialContribution:"articles",definitionFingerprint:`definition-${id}`,sourceRef:null,baseProfileId:id,
    maxInsertQty:null,axes:[],budgets:[],relations:[]},selectedOptionIds:[],defaultedOptionIds:[],
    commercialContribution:"articles",matchingRuleIds:[],fingerprint:`config-${id}`,status:"complete",issues:[],bom:[{
      brandMarchio:"TEST",manufacturerCode:"ARTICLE",productId:1,linkedBrandMarchio:"TEST",
      linkedManufacturerCode:"ARTICLE",quantity:1,roles:["primary"],description:"Article",
      unitPriceE4:10_000,rowTotalE4:10_000,currency:"EUR",priceIssuerSigla:"TEST",
      priceListinoNumber:"1",priceValidFrom:"2026-09-29",priceMultiplierOriginal:1}],
    totalE4:10_000,pricedSubtotalE4:10_000,budgets:[],physical,exclusions:[]} as ConfigurationResult;
}

const folders:string[]=[];
afterEach(()=>{for(const folder of folders.splice(0))rmSync(folder,{recursive:true,force:true});});
const request=(modelId:number)=>({modelId,selectedOptionIds:[]});
const flat=(nodes:readonly ProjectPhysicalNode[]):ProjectPhysicalNode[]=>nodes.flatMap(node=>[node,...flat(node.children)]);
const rootsOf=(view:ProjectDocumentView)=>view.physicalNodes.filter(node=>node.nodeKind==="enclosure");
const quantityOf=(view:ProjectDocumentView,itemUuid:string)=>view.lines.find(line=>line.itemUuid===itemUuid)?.quantity;
const itemOf=(view:ProjectDocumentView,modelCode:string)=>view.configuredItems.find(item=>item.modelCode===modelCode);
/** Stable description of a tree: uuid, item and position of every node. */
const shape=(nodes:readonly ProjectPhysicalNode[])=>flat(nodes).map(node=>[node.uuid,node.itemUuid,node.parentUuid,node.xMm,node.yMm]);

/**
 * Carpenteria A (model 1) with two Pannelli (model 2) and three Apparecchi (model 4); Carpenteria B
 * (model 5) with one Pannello and one Apparecchio. Q: Pannello 4 (3 placed), Apparecchio 6 (4 placed).
 */
async function twoCarpenterie() {
  const folder=mkdtempSync(path.join(tmpdir(),"librequadri-remove-carpenteria-"));folders.push(folder);
  const destination=path.join(folder,"case.lqp");
  const service=new ProjectDocumentService({workingDirectory:path.join(folder,"working"),
    incomingDirectory:path.join(folder,"incoming"),backupDirectory:path.join(folder,"backup"),
    migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
    resolveCatalogueProduct:()=>article,resolveConfiguration:input=>configured(input.modelId),
    designGuard:()=>({ok:true,code:"compatible"}),designItemGuard:()=>({ok:true,code:"compatible"})});
  await service.create({destinationPath:destination,title:"Case",description:"",notes:"",
    projectType:"civil",executor:"",date:"2026-09-29",companyName:"Client",companyDescription:""});
  service.addStructural({kind:"enclosure",configuration:request(1)});
  const withB=service.addStructural({kind:"enclosure",configuration:request(5)});
  const [rootA,rootB]=rootsOf(withB) as [ProjectPhysicalNode,ProjectPhysicalNode];
  service.addStructural({kind:"support",parentUuid:rootA.uuid,configuration:request(2)});
  service.addStructural({kind:"support",parentUuid:rootA.uuid,configuration:request(2)});
  service.addStructural({kind:"support",parentUuid:rootB.uuid,configuration:request(2)});
  // One more Pannello stays unplaced: Q 4, P 3.
  service.addStructural({kind:"support",parentUuid:rootA.uuid,configuration:request(2),place:false});
  let view=service.addConfiguredItem(request(4),6);
  const device=itemOf(view,"model-4")!;
  const panels=(uuid:string)=>flat(view.physicalNodes).filter(node=>node.nodeKind==="support"&&
    flat(rootsOf(view).filter(root=>root.uuid===uuid)).includes(node));
  const [panelA1,panelA2]=panels(rootA.uuid) as [ProjectPhysicalNode,ProjectPhysicalNode];
  const [panelB]=panels(rootB.uuid) as [ProjectPhysicalNode];
  const place=(parentUuid:string,startUnits:number)=>{view=service.placeChild({itemUuid:device.uuid,parentUuid,zoneNo:0,startUnits,viewCode:"front"});};
  place(panelA1.uuid,0);place(panelA1.uuid,4);place(panelA2.uuid,2);place(panelB.uuid,0);
  return {service,view,rootA,rootB,destination,device};
}

describe("removing a whole Carpenteria (R-17c)",()=>{
  it("keep-contents returns every contained Pannello and Apparecchio to the pool and removes only the Carpenteria's unit",async()=>{
    const {service,view,rootA,rootB,device}=await twoCarpenterie();
    const panel=itemOf(view,"model-2")!;
    expect(structuralPool(view).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[4,3,1]]);
    expect(devicePool(view).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[6,4,2]]);
    const untouchedB=shape(rootsOf(view).filter(root=>root.uuid===rootB.uuid));

    const after=service.removePhysicalRoot(rootA.uuid,"keep-contents");
    expect(after.dirty).toBe(true);
    // The Carpenteria's only unit is gone with its line; its model no longer appears.
    expect(itemOf(after,"model-1")).toBeUndefined();
    expect(after.lines.some(line=>line.manufacturerCode==="model-1")).toBe(false);
    // Configured contents keep their quantity; only their placements went back to the pool.
    expect(quantityOf(after,panel.uuid)).toBe(4);
    expect(quantityOf(after,device.uuid)).toBe(6);
    expect(structuralPool(after).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[4,1,3]]);
    expect(devicePool(after).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[6,1,5]]);
    // The other Carpenteria is untouched: same nodes, same UUIDs, same positions.
    expect(shape(after.physicalNodes)).toEqual(untouchedB);
  });

  it("remove-contents also removes the placed contained units from the project, keeping units placed elsewhere or unplaced",async()=>{
    const {service,view,rootA,rootB,device}=await twoCarpenterie();
    const panel=itemOf(view,"model-2")!;
    const untouchedB=shape(rootsOf(view).filter(root=>root.uuid===rootB.uuid));
    const after=service.removePhysicalRoot(rootA.uuid,"remove-contents");
    expect(itemOf(after,"model-1")).toBeUndefined();
    // Pannello: Q 4 − 2 placed in A = 2 (one in B, one unplaced). Apparecchio: Q 6 − 3 in A = 3.
    expect(quantityOf(after,panel.uuid)).toBe(2);
    expect(quantityOf(after,device.uuid)).toBe(3);
    expect(structuralPool(after).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[2,1,1]]);
    expect(devicePool(after).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[3,1,2]]);
    // Line totals follow the new quantities; the Distinta is derived from them.
    expect(after.lines.find(line=>line.itemUuid===device.uuid)!.lineTotalE4).toBe(3*10_000);
    expect(shape(after.physicalNodes)).toEqual(untouchedB);
  });

  it("remove-contents drops a configured item entirely when all of its units were inside the Carpenteria",async()=>{
    const {service,view,rootB}=await twoCarpenterie();
    // Carpenteria B holds one Pannello and one Apparecchio; other units of both exist, so only
    // the Carpenteria's own line (model 5, Q 1) disappears.
    const after=service.removePhysicalRoot(rootB.uuid,"remove-contents");
    expect(itemOf(after,"model-5")).toBeUndefined();
    expect(quantityOf(after,itemOf(view,"model-2")!.uuid)).toBe(3);
    // Now remove A too with its contents: every placed unit goes; unplaced units stay.
    const last=service.removePhysicalRoot(rootsOf(after)[0]!.uuid,"remove-contents");
    expect(last.physicalNodes).toEqual([]);
    expect(itemOf(last,"model-1")).toBeUndefined();
    expect(structuralPool(last).map(entry=>[entry.quantity,entry.placed])).toEqual([[1,0]]);
    expect(devicePool(last).map(entry=>[entry.quantity,entry.placed])).toEqual([[2,0]]);
  });

  it("removes one unit of a Carpenteria item shared by two identical Carpenterie",async()=>{
    const {service,view}=await twoCarpenterie();
    const withTwin=service.addStructural({kind:"enclosure",configuration:request(1)});
    const box=itemOf(withTwin,"model-1")!;
    expect(quantityOf(withTwin,box.uuid)).toBe(2);
    const twin=rootsOf(withTwin).find(root=>!rootsOf(view).some(existing=>existing.uuid===root.uuid))!;
    const after=service.removePhysicalRoot(twin.uuid,"keep-contents");
    expect(quantityOf(after,box.uuid)).toBe(1);
    expect(shape(after.physicalNodes)).toEqual(shape(view.physicalNodes));
  });

  it("refuses anything that is not a root, and an unknown node, without changing the project",async()=>{
    const {service,view,rootA}=await twoCarpenterie();
    const panel=rootsOf(view).find(root=>root.uuid===rootA.uuid)!.children[0]!;
    expect(()=>service.removePhysicalRoot(panel.uuid,"keep-contents")).toThrow("Solo una radice fisica");
    expect(()=>service.removePhysicalRoot(randomUUID(),"remove-contents")).toThrow("Nodo fisico non trovato");
    const current=service.current()!;
    expect(shape(current.physicalNodes)).toEqual(shape(view.physicalNodes));
    expect(current.lines).toEqual(view.lines);
  });

  it("persists across save and reopen",async()=>{
    const {service,rootA,destination}=await twoCarpenterie();
    const after=service.removePhysicalRoot(rootA.uuid,"keep-contents");
    await service.save();
    service.closeCurrent();
    const reopened=service.open(destination);
    expect(shape(reopened.physicalNodes)).toEqual(shape(after.physicalNodes));
    expect(reopened.lines.map(line=>[line.itemUuid,line.quantity])).toEqual(after.lines.map(line=>[line.itemUuid,line.quantity]));
  });
});

describe("Rimuovi posizione / Delete on a selected Pannello or Apparecchio (R-17c)",()=>{
  const idle={textEntry:false,dragging:false,busy:false,dialogOpen:false};
  it("unplaces the selected Apparecchio through the existing backend call, keeping its configured item",async()=>{
    const {service,view,device}=await twoCarpenterie();
    const api={unplaceNode:async(uuid:string)=>service.unplaceNode(uuid)};
    const placed=flat(view.physicalNodes).find(node=>node.itemUuid===device.uuid)!;
    const selection=describeSelection(view,placed.uuid)!;
    expect([selection.kind,selection.placed,selection.quantity]).toEqual(["device",4,6]);
    expect(designKeyCommand({key:"Delete"},{...idle,selectedKind:selection.kind})).toBe("unplace");
    expect(unplaceBlockReason(selection)).toBeNull();
    const siblings=shape(view.physicalNodes).filter(entry=>entry[0]!==placed.uuid);
    const after=await submitUnplacement(api,selection.node.uuid);
    // The configured item and its quotation quantity stay; one more unit is available to place.
    expect(quantityOf(after,device.uuid)).toBe(6);
    expect(devicePool(after).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[6,3,3]]);
    // Siblings keep their positions (R-18: no repacking on unplacement).
    expect(shape(after.physicalNodes)).toEqual(siblings);
    // The selection disappears with the node: tree, drawing and Proprietà all lose it together.
    const pruned=designSelectionReducer({selectedUuid:placed.uuid,hoverUuid:placed.uuid,hoverSource:"canvas"},
      {type:"prune",present:selectableUuids(after.physicalNodes)});
    expect(pruned).toEqual({selectedUuid:null,hoverUuid:null,hoverSource:null});
    expect(describeSelection(after,placed.uuid)).toBeNull();
  });

  /** The api the renderer uses for "Rimuovi posizione", with every call recorded. */
  const selectionApi=(service:ProjectDocumentService)=>({
    unplaceNode:vi.fn(async(uuid:string)=>service.unplaceNode(uuid)),
    unplaceSubtree:vi.fn(async(uuid:string)=>service.unplaceSubtree(uuid))});
  const pools=(view:ProjectDocumentView)=>[...structuralPool(view),...devicePool(view)]
    .map(entry=>[entry.item.modelCode,entry.quantity,entry.placed,entry.available]);
  /** Carpenteria A's first Pannello holds two Apparecchi; the same items are also placed in A's second Pannello and in B. */
  const fullPanel=(view:ProjectDocumentView,rootUuid:string)=>rootsOf(view).find(root=>root.uuid===rootUuid)!.children[0]!;

  for(const via of ["Rimuovi posizione","Delete"] as const)
  it(`unplaces a Pannello with its Apparecchi in one backend call (${via}), keeping Q and every other placement`,async()=>{
    const {service,view,rootA}=await twoCarpenterie();
    const api=selectionApi(service);
    const panel=fullPanel(view,rootA.uuid);
    const contained=[panel.uuid,...flat(panel.children).map(node=>node.uuid)];
    expect(contained).toHaveLength(3);
    const selection=describeSelection(view,panel.uuid)!;
    expect([selection.kind,selection.devices]).toEqual(["support",2]);
    expect(unplaceBlockReason(selection)).toBeNull();
    if(via==="Delete")expect(designKeyCommand({key:"Delete"},{...idle,selectedKind:selection.kind})).toBe("unplace");
    expect(pools(view)).toEqual([["model-2",4,3,1],["model-4",6,4,2]]);
    const elsewhere=shape(view.physicalNodes).filter(entry=>!contained.includes(entry[0] as string));
    const lines=view.lines.map(line=>[line.uuid,line.itemUuid,line.quantity,line.lineTotalE4]);

    const after=await submitSelectionUnplacement(api,selection.kind as "support",panel.uuid);
    // One backend call, the subtree operation; the renderer never walks the subtree.
    expect(api.unplaceSubtree.mock.calls).toEqual([[panel.uuid]]);
    expect(api.unplaceNode).not.toHaveBeenCalled();
    // The Pannello and both of its Apparecchi are no longer placed ...
    expect(flat(after.physicalNodes).filter(node=>contained.includes(node.uuid))).toEqual([]);
    // ... every other physical instance of the same items is untouched (UUIDs, parents, positions) ...
    expect(shape(after.physicalNodes)).toEqual(elsewhere);
    // ... quantities, lines and configured items are unchanged, and the pools grow by what was removed.
    expect(after.lines.map(line=>[line.uuid,line.itemUuid,line.quantity,line.lineTotalE4])).toEqual(lines);
    expect(after.configuredItems.map(item=>item.uuid)).toEqual(view.configuredItems.map(item=>item.uuid));
    expect(pools(after)).toEqual([["model-2",4,2,2],["model-4",6,2,4]]);
    expect(after.dirty).toBe(true);
    expect(designSelectionReducer({selectedUuid:panel.uuid,hoverUuid:null,hoverSource:null},
      {type:"prune",present:selectableUuids(after.physicalNodes)}).selectedUuid).toBeNull();
  });

  it("still unplaces an empty Pannello, and an Apparecchio through the leaf call",async()=>{
    const {service,view,rootB}=await twoCarpenterie();
    const api=selectionApi(service);
    const panelB=fullPanel(view,rootB.uuid);
    const deviceB=panelB.children[0]!;
    const emptied=await submitSelectionUnplacement(api,"device",deviceB.uuid);
    expect(api.unplaceNode.mock.calls).toEqual([[deviceB.uuid]]);
    expect(describeSelection(emptied,panelB.uuid)!.devices).toBe(0);
    const after=await submitSelectionUnplacement(api,"support",panelB.uuid);
    expect(api.unplaceSubtree.mock.calls).toEqual([[panelB.uuid]]);
    expect(pools(after)).toEqual([["model-2",4,2,2],["model-4",6,3,3]]);
  });

  it("refuses a Carpenteria and an unknown node without changing anything",async()=>{
    const {service,view,rootA}=await twoCarpenterie();
    expect(()=>service.unplaceSubtree(rootA.uuid)).toThrow("carpenteria");
    expect(()=>service.unplaceSubtree(randomUUID())).toThrow("Nodo fisico non trovato");
    expect(shape(service.current()!.physicalNodes)).toEqual(shape(view.physicalNodes));
  });

  it("keeps the result after save and reopen",async()=>{
    const {service,view,rootA,destination}=await twoCarpenterie();
    const after=service.unplaceSubtree(fullPanel(view,rootA.uuid).uuid);
    await service.save();
    service.closeCurrent();
    const reopened=service.open(destination);
    expect(shape(reopened.physicalNodes)).toEqual(shape(after.physicalNodes));
    expect(pools(reopened)).toEqual(pools(after));
    expect(reopened.lines.map(line=>[line.itemUuid,line.quantity])).toEqual(view.lines.map(line=>[line.itemUuid,line.quantity]));
  });
});

/*
 * Why a release under the 4 px drag threshold must be a click that never drops (R-17c): the
 * backend's free-positioning targets overlap the object's own area, so the target under a pointer
 * that has not moved is often a different position. The pre-R-17c rule dropped on whatever target
 * was under the release point, so a plain click would have moved the object (or written a no-op
 * move that marks the project modified).
 */
describe("a stationary click over a placed object sits on backend move targets",()=>{
  it("would have moved an Apparecchio by a half-module and a Pannello by 40 mm under the old release rule",async()=>{
    const {service,view,rootA}=await twoCarpenterie();
    const api={placementTargets:async(request:Parameters<typeof service.placementTargets>[0])=>service.placementTargets(request)};
    const roots=rootsOf(view);
    const geometry=combinedFrontGeometry(roots,view.configuredItems,{viewportPx:{width:800,height:600}});
    const targetAt=async(node:ProjectPhysicalNode,fx:number,fy:number)=>{
      const item=view.configuredItems.find(entry=>entry.uuid===node.itemUuid)!;
      const subject:DragSubject={origin:"node",kind:node.nodeKind as "support"|"device",item,nodeUuid:node.uuid,parentUuid:node.parentUuid!};
      const loaded=await loadPlacementTargets(api,subject,roots[0]!,roots);
      const sector=geometry.sectors.find(entry=>entry.parentRects.has(node.uuid))!;
      const view0=item.views[0]!;
      const hit=pickCombinedTarget(loaded.entries,geometry,{x:node.xMm!+view0.widthMm*fx+sector.offset.x,
        y:node.yMm!+view0.heightMm*fy+sector.offset.y},subject.kind);
      return hit!.entry.target as {action:string;input:{startUnits?:number}};
    };
    const panels=rootsOf(view).find(root=>root.uuid===rootA.uuid)!.children;
    const device=panels[0]!.children[1]!;
    expect(device.startUnits).toBe(4);
    // Centre: a move to its own position (a write that would mark the project modified).
    expect(await targetAt(device,.5,.5)).toMatchObject({action:"moveNode",input:{startUnits:4}});
    // Near its edges: the neighbouring half-module positions.
    expect((await targetAt(device,.1,.9)).input.startUnits).toBe(3);
    expect((await targetAt(device,.9,.1)).input.startUnits).toBe(5);
    const panel=panels[1]!;
    expect(panel.startUnits).toBe(100);
    expect(await targetAt(panel,.1,.9)).toMatchObject({action:"moveNode",input:{startUnits:140}});
  });
});

describe("removePhysicalRoot and unplaceSubtree are atomic",()=>{
  function database() {
    const folder=mkdtempSync(path.join(tmpdir(),"lqp-remove-root-"));folders.push(folder);
    const db=openCurrentProjectDatabase(path.join(folder,"project.lqp"),path.resolve("db/migrations/project"));
    db.prepare("INSERT INTO prj_group(id,uuid,name,sort_order) VALUES (1,?,'Quote',0)").run(randomUUID());
    return db;
  }
  function item(db:Database.Database,kind:string,quantity:number):number {
    const id=Number(db.prepare(`INSERT INTO prj_item(uuid,model_brand_marchio,model_code,model_name,model_kind,
      model_definition_fingerprint,config_fingerprint,config_label,config_status,phys_status,snapshot_taken_at)
      VALUES (?,'ACME',?,?,?,'definition','config','label','complete','resolved','2026-09-29T00:00:00.000Z')`)
      .run(randomUUID(),kind,kind,kind).lastInsertRowid);
    const next=db.prepare("SELECT COALESCE(MAX(sort_order),-1)+1 FROM prj_line").pluck().get() as number;
    db.prepare("INSERT INTO prj_line(uuid,group_id,sort_order,line_type,item_id,quantity) VALUES (?,1,?,'item',?,?)")
      .run(randomUUID(),next,id,quantity);
    return id;
  }
  function tree(db:Database.Database) {
    const box=item(db,"enclosure",1),panel=item(db,"support",1),device=item(db,"device",2);
    const insert=(parent:number|null,itemId:number,kind:string)=>Number(db.prepare(`INSERT INTO prj_node(uuid,parent_id,
      item_id,node_kind,zone_no,start_units,root_x_mm,root_y_mm,view_code,sort_order) VALUES (?,?,?,?,?,?,?,?,'front',0)`)
      .run(randomUUID(),parent,itemId,kind,parent===null?null:0,parent===null?null:0,
        parent===null?0:null,parent===null?0:null).lastInsertRowid);
    const root=insert(null,box,"enclosure");
    const support=insert(root,panel,"support");
    insert(support,device,"device");insert(support,device,"device");
    const uuid=db.prepare("SELECT uuid FROM prj_node WHERE id=?").pluck().get(root) as string;
    return {uuid,box,panel,device};
  }
  const snapshot=(db:Database.Database)=>({nodes:db.prepare("SELECT * FROM prj_node ORDER BY id").all(),
    lines:db.prepare("SELECT * FROM prj_line ORDER BY id").all(),items:db.prepare("SELECT id FROM prj_item ORDER BY id").all()});

  it("deletes the subtree deepest first and reports the units it held",()=>{
    const db=database();const {uuid,box,panel,device}=tree(db);
    const removed=deletePhysicalRoot(db,uuid);
    expect(removed.rootItemId).toBe(box);
    expect([...removed.contents].sort()).toEqual([[device,2],[panel,1]].sort());
    expect(db.prepare("SELECT COUNT(*) FROM prj_node").pluck().get()).toBe(0);
    db.close();
  });

  it("rolls back a Pannello subtree unplacement when a deletion fails part-way",()=>{
    const db=database();tree(db);
    const panel=db.prepare("SELECT id,uuid FROM prj_node WHERE node_kind='support'").get() as {id:number;uuid:string};
    // The Pannello is deleted last, after its two Apparecchi: make exactly that deletion fail.
    db.exec(`CREATE TRIGGER fail_panel BEFORE DELETE ON prj_node WHEN OLD.id=${panel.id}
      BEGIN SELECT RAISE(ABORT,'injected failure'); END`);
    const before=snapshot(db);
    expect(()=>unplaceSubtree(db,panel.uuid)).toThrow("injected failure");
    expect(snapshot(db)).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) FROM prj_node WHERE node_kind='device'").pluck().get()).toBe(2);
    db.close();
  });

  it("rolls back every node deletion when a later item update fails",()=>{
    const db=database();const {uuid,device}=tree(db);
    // A configured item without its quotation line violates the Q22 invariant: the update fails
    // after the nodes were already deleted inside the transaction.
    db.prepare("DELETE FROM prj_line WHERE item_id=?").run(device);
    const before=snapshot(db);
    expect(()=>removePhysicalRoot(db,uuid,"remove-contents")).toThrow("Riga del preventivo non trovata");
    expect(snapshot(db)).toEqual(before);
    db.close();
  });
});
