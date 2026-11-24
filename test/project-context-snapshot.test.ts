import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { openProjectDatabaseAtVersion } from "../src/main/database/project-migrations.js";
import { getModelEngineeringContext } from "../src/main/catalogue/configuration-queries.js";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import type { ConfigurationResult, ModelEngineeringContext } from "../src/shared/configuration.js";
import type { CatalogueProductSnapshotSource, ProjectDocumentView, ProjectPhysicalNode } from "../src/shared/project.js";

/*
 * Format 4 context snapshots: enclosures snapshot the contexts they provide and supports the contexts
 * they accept (with a policy), so an existing Pannello can move to another Carpenteria model with no
 * catalogue. Legacy items (policy NULL) keep the conservative same-model fallback.
 */
const article:CatalogueProductSnapshotSource={brandMarchio:"TEST",brandName:"Test",
  manufacturerCode:"ARTICLE",ean:null,shortDescription:"Article",description:"Article",
  unitOfMeasure:"PCE",categoryCode:null,categoryPathLabel:null,familyCode:null,familyName:null,
  priceIssuerSigla:"TEST",priceListinoNumber:"1",priceValidFrom:"2026-09-29",
  listPriceUnitE4:10_000,priceMultiplierOriginal:1,attributes:[]};

// Enclosures 1 (provides ctxA), 5 (ctxB), 6 (ctxA+ctxB), 7 (policy unknown), 12 (class FRAME_X, ctxA).
// Supports 2 (restricted, accepts ctxA), 3 (unrestricted), 13 (policy unknown). Device 4 needs ancestor FRAME.
const CONTEXT:Record<number,ModelEngineeringContext>={
  1:{policy:"restricted",role:"provides",codes:["ctxA"]},
  5:{policy:"restricted",role:"provides",codes:["ctxB"]},
  6:{policy:"restricted",role:"provides",codes:["ctxA","ctxB"]},
  7:{policy:"unknown",role:"provides",codes:[]},
  12:{policy:"restricted",role:"provides",codes:["ctxA"]},
  2:{policy:"restricted",role:"accepts",codes:["ctxA"]},
  3:{policy:"unrestricted",role:"accepts",codes:[]},
  13:{policy:"unknown",role:"accepts",codes:[]},
};
const ENCLOSURES=new Set([1,5,6,7,12]);
const kindOf=(id:number)=>ENCLOSURES.has(id)?"enclosure":id===4?"device":"support";
const state={legacy:false,overrides:{} as Record<number,ModelEngineeringContext>};
function configured(id:number):ConfigurationResult {
  const kind=kindOf(id);
  const classCode=id===12?"FRAME_X":kind==="enclosure"?"FRAME":kind==="support"?"PANEL":"DEV";
  const physical={id,code:`profile-${id}`,name:`Profile ${id}`,kind,profileKey:null,
    fitClass:{id,code:classCode,name:kind},depthMm:null,outerDepthMm:null,usableDepthMm:null,
    demands:kind==="device"?[{capacityKindCode:"din",amount:2,unitLabel:"moduli",displayDivisor:2,nominalPitchMm:9}]:[],
    views:[{code:"front",widthMm:kind==="enclosure"?500:kind==="support"?500:18,
      heightMm:kind==="enclosure"?1000:kind==="support"?100:80,insertDxMm:0,insertDyMm:0,
      symbolKind:"rectangle",assetKey:null}],
    zones:kind==="enclosure"?[{zoneNo:0,layout:"stack",capacityKindCode:null,capacityAmount:600,
      originXMm:0,originYMm:0,lengthMm:600,breadthMm:500,direction:"vertical",pitchMm:1,requiredViewCode:"front"}]
      :kind==="support"?[{zoneNo:0,layout:"linear",capacityKindCode:"din",capacityKindLabel:"moduli",
        displayDivisor:2,nominalPitchMm:9,capacityAmount:20,originXMm:10,originYMm:10,lengthMm:null,
        breadthMm:null,direction:"horizontal",pitchMm:null,requiredViewCode:null}]:[],
    slots:[],
    constraints:kind==="support"?[{relation:"ancestor",acceptSetCode:"frame",classCodes:["FRAME","FRAME_X"]}]
      :kind==="device"?[{relation:"parent",acceptSetCode:"panel",classCodes:["PANEL"]},
        {relation:"ancestor",acceptSetCode:"frame",classCodes:["FRAME"]}]:[]};
  return {model:{id,code:`model-${id}`,name:`Model ${id}`,kind,brandMarchio:"TEST",active:true,
    obsolete:false,commercialContribution:"articles",definitionFingerprint:`definition-${id}`,sourceRef:null,baseProfileId:id,
    maxInsertQty:null,axes:[],budgets:[],relations:[]},selectedOptionIds:[],defaultedOptionIds:[],
    commercialContribution:"articles",matchingRuleIds:[],fingerprint:`config-${id}`,status:"complete",issues:[],bom:[{
      brandMarchio:"TEST",manufacturerCode:"ARTICLE",productId:1,linkedBrandMarchio:"TEST",
      linkedManufacturerCode:"ARTICLE",quantity:1,roles:["primary"],description:"Article",
      unitPriceE4:10_000,rowTotalE4:10_000,currency:"EUR",priceIssuerSigla:"TEST",
      priceListinoNumber:"1",priceValidFrom:"2026-09-29",priceMultiplierOriginal:1}],
    totalE4:10_000,pricedSubtotalE4:10_000,budgets:[],physical,exclusions:[],
    ...(state.legacy||kind==="device"?{}:{context:state.overrides[id]??CONTEXT[id]??null})} as ConfigurationResult;
}

const folders:string[]=[];
afterEach(()=>{state.legacy=false;state.overrides={};for(const folder of folders.splice(0))rmSync(folder,{recursive:true,force:true});});
const request=(modelId:number)=>({modelId,selectedOptionIds:[]});
const folderOf=()=>{const folder=mkdtempSync(path.join(tmpdir(),"librequadri-context-"));folders.push(folder);return folder;};
const migrations=path.resolve("db/migrations/project");

/** Catalogue-free service: nothing here can reach a catalogue. */
function offlineService(folder:string) {
  const catalogue=vi.fn(()=>{throw new Error("catalogue must not be used");});
  const service=new ProjectDocumentService({workingDirectory:path.join(folder,"off-working"),
    incomingDirectory:path.join(folder,"off-incoming"),backupDirectory:path.join(folder,"off-backup"),
    migrationsFolder:migrations,appVersion:"test",resolveCatalogueProduct:catalogue,
    resolveConfiguration:catalogue as never,designGuard:catalogue as never,designItemGuard:catalogue as never});
  return {service,catalogue};
}
type Guard=(request:{parentUuid?:string;item:{modelCode:string}})=>{ok:true;code:"compatible"}|{ok:false;code:string};
const OK:Guard=()=>({ok:true,code:"compatible"});
async function setup(guard:Guard=OK) {
  const folder=folderOf();
  const destination=path.join(folder,"case.lqp");
  const service=new ProjectDocumentService({workingDirectory:path.join(folder,"working"),
    incomingDirectory:path.join(folder,"incoming"),backupDirectory:path.join(folder,"backup"),
    migrationsFolder:migrations,appVersion:"test",
    resolveCatalogueProduct:()=>article,resolveConfiguration:input=>configured(input.modelId),
    designGuard:()=>({ok:true,code:"compatible"}),designItemGuard:(_project,request)=>guard(request as never)});
  await service.create({destinationPath:destination,title:"Case",description:"",notes:"",
    projectType:"civil",executor:"",date:"2026-09-29",companyName:"Client",companyDescription:""});
  return {folder,service,destination};
}
const flat=(nodes:readonly ProjectPhysicalNode[]):ProjectPhysicalNode[]=>nodes.flatMap(node=>[node,...flat(node.children)]);
const rootsOf=(view:ProjectDocumentView)=>view.physicalNodes.filter(node=>node.nodeKind==="enclosure");
const supportsOf=(view:ProjectDocumentView)=>flat(view.physicalNodes).filter(node=>node.nodeKind==="support");
const devicesOf=(view:ProjectDocumentView)=>flat(view.physicalNodes).filter(node=>node.nodeKind==="device");
const snapshot=(service:ProjectDocumentService)=>JSON.stringify(service.current());
const move=(service:ProjectDocumentService,panel:ProjectPhysicalNode,parentUuid:string,startUnits=0)=>
  service.moveNode(panel.uuid,{itemUuid:panel.itemUuid!,parentUuid,zoneNo:0,startUnits,viewCode:"front"});
/** Persisted context rows of a saved document. */
function contextRows(file:string) {
  const db=new Database(file,{readonly:true});
  try {
    return {items:db.prepare("SELECT model_code AS code,model_kind AS kind,context_policy AS policy FROM prj_item ORDER BY id").all() as
      Array<{code:string;kind:string;policy:string|null}>,
      rows:db.prepare(`SELECT i.model_code AS code,c.role,c.context_code AS context FROM prj_item_context c
        JOIN prj_item i ON i.id=c.item_id ORDER BY i.id,c.role,c.context_code`).all() as Array<{code:string;role:string;context:string}>,
      format:db.prepare("SELECT value FROM lqp_meta WHERE key='format_version'").pluck().get()};
  } finally { db.close(); }
}

describe("format 4 schema and migration",()=>{
  it("declares format 4 with the context columns in the manifest, and a new document stores it",async()=>{
    const {service,destination}=await setup();
    service.addStructural({kind:"enclosure",configuration:request(1)});
    await service.save();
    expect(contextRows(destination).format).toBe("11");
    const db=new Database(destination,{readonly:true});
    try {
      expect((db.pragma("table_info('prj_item')") as Array<{name:string;notnull:number}>).find(column=>column.name==="context_policy"))
        .toMatchObject({notnull:0});
      expect((db.pragma("table_info('prj_item_context')") as Array<{name:string;pk:number}>).map(column=>[column.name,column.pk]))
        .toEqual([["item_id",1],["role",2],["context_code",3]]);
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); }
  });

  it("migrates a format-3 document to format 4 with NULL policies and no context rows, without touching a catalogue",async()=>{
    const folder=folderOf();
    const file=path.join(folder,"legacy.lqp");
    copyFileSync(path.resolve("test/fixtures/quotation-format1.lqp"),file);
    // Bring the format-1 fixture to format 3 and add configured structural items as a format-3 app would.
    const db=openProjectDatabaseAtVersion(file,migrations,3);
    try {
      db.pragma("journal_mode = DELETE");
      db.prepare("UPDATE lqp_meta SET value='3' WHERE key='format_version'").run();
      expect((db.pragma("table_info('prj_item')") as Array<{name:string}>).map(column=>column.name)).not.toContain("context_policy");
      let line=1;
      const add=(id:number,code:string,kind:string,fit:string,width:number,height:number,fingerprint:string)=>{
        db.prepare(`INSERT INTO prj_item(id,uuid,model_brand_marchio,model_code,model_name,model_kind,
          model_definition_fingerprint,config_fingerprint,config_label,config_status,primary_snapshot_id,
          phys_status,profile_code,profile_name,fit_class_code,snapshot_taken_at)
          VALUES (?,?,'ACME',?,?,?, 'definition',?,?,'complete',1,'resolved','p','p',?,'2026-09-29T00:00:00.000Z')`)
          .run(id,`10000000-0000-4000-8000-00000000000${id}`,code,code,kind,fingerprint,code,fit);
        db.prepare("INSERT INTO prj_item_bom(item_id,seq,snapshot_id,quantity_per_item,role,sale_price_unit_e4) VALUES (?,0,1,1,'primary',1)").run(id);
        db.prepare("INSERT INTO prj_item_view(item_id,view_code,width_mm,height_mm,insert_dx_mm,insert_dy_mm,symbol_kind) VALUES (?,'front',?,?,0,0,'rect')").run(id,width,height);
        if(kind==="enclosure")db.prepare(`INSERT INTO prj_item_zone(item_id,zone_no,layout,capacity_kind_code,capacity_amount,origin_x_mm,
          origin_y_mm,length_mm,breadth_mm,direction,pitch_mm,required_view_code) VALUES (?,0,'stack',NULL,600,0,0,600,500,'vertical',1,'front')`).run(id);
        if(kind==="support")db.prepare("INSERT INTO prj_item_constraint(item_id,relation,set_no,class_code) VALUES (?,'ancestor',0,'FRAME')").run(id);
        db.prepare(`INSERT INTO prj_line(uuid,group_id,sort_order,line_type,item_id,quantity,sale_price_unit_e4,line_total_e4)
          VALUES (?,1,?,'item',?,1,1,1)`).run(`20000000-0000-4000-8000-00000000000${id}`,100+line++,id);
      };
      // Two roots of one model, one root of another model, and a support in the first.
      add(1,"box-a","enclosure","FRAME",500,1000,"c1");add(2,"box-a","enclosure","FRAME",500,1000,"c2");
      add(3,"box-b","enclosure","FRAME",500,1000,"c3");add(4,"tray","support","PANEL",500,100,"c4");
      const node=db.prepare(`INSERT INTO prj_node(uuid,item_id,node_kind,root_x_mm,root_y_mm,view_code,sort_order) VALUES (?,?,'enclosure',?,0,'front',?)`);
      node.run("30000000-0000-4000-8000-000000000001",1,0,0);node.run("30000000-0000-4000-8000-000000000002",2,700,1);
      node.run("30000000-0000-4000-8000-000000000003",3,1400,2);
      db.prepare(`INSERT INTO prj_node(uuid,parent_id,item_id,node_kind,zone_no,start_units,view_code,sort_order)
        VALUES ('30000000-0000-4000-8000-000000000004',1,4,'support',0,0,'front',0)`).run();
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); }
    // A support with an ancestor-class constraint is placed under FRAME roots, which the raw rows above satisfy.
    const {service,catalogue}=offlineService(folder);
    const opened=service.open(file);
    expect(opened.dirty).toBe(false);
    // Opening and migrating never touch a catalogue.
    expect(catalogue).not.toHaveBeenCalled();
    const tray=supportsOf(opened)[0]!;
    const [twin,,stranger]=rootsOf(opened) as ProjectPhysicalNode[];
    // Legacy fallback: the same snapshotted model is provable from the project, another model is not.
    const toTwin=service.placementTargets({parentUuid:rootsOf(opened)[1]!.uuid,nodeUuid:tray.uuid});
    expect(toTwin.targets.some(target=>target.action==="moveNode")).toBe(true);
    expect(service.placementTargets({parentUuid:stranger!.uuid,nodeUuid:tray.uuid})).toMatchObject({targets:[],diagnostics:[{code:"root_context_unverified"}]});
    const before=snapshot(service);
    expect(()=>service.moveNode(tray.uuid,{itemUuid:tray.itemUuid!,parentUuid:stranger!.uuid,zoneNo:0,startUnits:0,viewCode:"front"})).toThrow(/modello diverso/);
    expect(snapshot(service)).toBe(before);
    const moved=service.moveNode(tray.uuid,toTwin.targets.find(target=>target.action==="moveNode")!.input as never);
    expect(supportsOf(moved)[0]!.parentUuid).toBe(rootsOf(moved)[1]!.uuid);
    // Saving and reopening changes nothing about the facts: still NULL, still no rows, still format 4.
    await service.save();
    const saved=contextRows(file);
    expect(saved.format).toBe("11");
    expect(saved.items.map(item=>item.policy)).toEqual([null,null,null,null]);
    expect(saved.rows).toEqual([]);
    const migrated=new Database(file,{readonly:true});
    try { expect(migrated.prepare("SELECT DISTINCT commercial_contribution FROM prj_item").pluck().all())
      .toEqual(["articles"]); } finally { migrated.close(); }
    // Only the legacy move decisions consulted the (here unavailable) guard; nothing was enriched.
    expect(twin).toBeDefined();
    service.close();
  });
});

describe("context snapshot creation",()=>{
  it("stores policy and active context codes on enclosures and supports only",async()=>{
    const {service,destination}=await setup();
    service.addStructural({kind:"enclosure",configuration:request(6)});
    service.addStructural({kind:"support",parentUuid:rootsOf(service.current()!)[0]!.uuid,configuration:request(2)});
    service.addStructural({kind:"support",parentUuid:rootsOf(service.current()!)[0]!.uuid,configuration:request(3)});
    service.addConfiguredItem(request(4),1);
    await service.save();
    const stored=contextRows(destination);
    expect(stored.items).toEqual([{code:"model-6",kind:"enclosure",policy:"restricted"},{code:"model-2",kind:"support",policy:"restricted"},
      {code:"model-3",kind:"support",policy:"unrestricted"},{code:"model-4",kind:"device",policy:null}]);
    expect(stored.rows).toEqual([{code:"model-6",role:"provides",context:"ctxA"},{code:"model-6",role:"provides",context:"ctxB"},
      {code:"model-2",role:"accepts",context:"ctxA"}]);
  });

  it("reads only active contexts of the model from the catalogue, by role, and nothing for devices",()=>{
    const folder=folderOf();
    const db=openMigratedLqDatabase({databaseFilename:path.join(folder,"lq.db"),backupDirectory:path.join(folder,"b"),
      migrationsFolder:path.resolve("db/migrations/lq")});
    try {
      db.exec(`INSERT INTO cat_brand(id,metel_marchio,name,source) VALUES(1,'ACME','Acme','manual');
        INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,definition_fingerprint,source,context_policy)
          VALUES(1,1,'box','Box','enclosure','f','manual','restricted'),(2,1,'tray','Tray','support','f','manual','restricted'),
          (3,1,'dev','Dev','device','f','manual','unknown');
        INSERT INTO cat_config_context(id,brand_id,code,name,active,source) VALUES(1,1,'b.ctx','B',1,'manual'),
          (2,1,'a.ctx','A',1,'manual'),(3,1,'off.ctx','Off',0,'manual');
        INSERT INTO cat_config_model_context(model_id,role,context_id) VALUES(1,'provides',1),(1,'provides',2),(1,'provides',3),
          (1,'accepts',1),(2,'accepts',2),(2,'accepts',3);`);
      expect(getModelEngineeringContext(db,1,"enclosure")).toEqual({policy:"restricted",role:"provides",codes:["a.ctx","b.ctx"]});
      expect(getModelEngineeringContext(db,2,"support")).toEqual({policy:"restricted",role:"accepts",codes:["a.ctx"]});
      expect(getModelEngineeringContext(db,3,"device")).toBeNull();
      expect(getModelEngineeringContext(db,99,"enclosure")).toBeNull();
    } finally { db.close(); }
  });

  it("includes context facts in the semantic snapshot and lets the same configuration fill a legacy item",async()=>{
    const {service,destination}=await setup();
    state.legacy=true;
    service.addStructural({kind:"enclosure",configuration:request(1)});
    await service.save();
    expect(contextRows(destination)).toMatchObject({items:[{policy:null}],rows:[]});
    // Re-adding the same configuration completes the legacy snapshot while merging the quantity.
    state.legacy=false;
    service.addStructural({kind:"enclosure",configuration:request(1)});
    await service.save();
    expect(contextRows(destination)).toMatchObject({items:[{code:"model-1",policy:"restricted"}],
      rows:[{code:"model-1",role:"provides",context:"ctxA"}]});
    expect(service.current()!.lines.find(line=>line.lineType==="item")!.quantity).toBe(2);
    // An item that has facts must match them exactly; different facts are a different technical version.
    state.overrides[1]={policy:"restricted",role:"provides",codes:["ctxA","ctxZ"]};
    const before=snapshot(service);
    expect(()=>service.addStructural({kind:"enclosure",configuration:request(1)})).toThrow(/dati tecnici/);
    expect(snapshot(service)).toBe(before);
    state.overrides[1]={policy:"unrestricted",role:"provides",codes:["ctxA"]};
    expect(()=>service.addStructural({kind:"enclosure",configuration:request(1)})).toThrow(/dati tecnici/);
  });

  it("rejects malformed context data when a document is opened",async()=>{
    const {service,destination,folder}=await setup();
    service.addStructural({kind:"enclosure",configuration:request(1)});
    await service.save();
    service.close();
    const tamper=(sql:string)=>{const copy=path.join(folder,`t-${Math.random().toString(36).slice(2)}.lqp`);copyFileSync(destination,copy);
      const db=new Database(copy);try{db.pragma("journal_mode = DELETE");db.exec(sql);}finally{db.close();}return copy;};
    const reader=()=>offlineService(folder).service;
    expect(()=>reader().open(tamper("UPDATE prj_item SET context_policy='sometimes'"))).toThrow();
    expect(()=>reader().open(tamper("INSERT INTO prj_item_context(item_id,role,context_code) VALUES (1,'accepts','x')"))).toThrow(/contesto/);
    expect(()=>reader().open(tamper("INSERT INTO prj_item_context(item_id,role,context_code) VALUES (1,'owns','x')"))).toThrow();
    expect(()=>reader().open(tamper("INSERT INTO prj_item_context(item_id,role,context_code) VALUES (99,'provides','x')"))).toThrow();
    expect(()=>reader().open(tamper("UPDATE prj_item SET context_policy=NULL"))).toThrow(/contesto/);
    expect(()=>reader().open(tamper("INSERT INTO prj_item_context(item_id,role,context_code) VALUES (1,'provides','')"))).toThrow(/contesto/);
  });
});

describe("Pannello moves between Carpenteria models from the project snapshot alone",()=>{
  /** Roots: 1 (ctxA), 1 again (twin), 5 (ctxB), 6 (ctxA+ctxB), 7 (policy unknown), 12 (FRAME_X, ctxA). */
  async function layout(guard:Guard=OK) {
    const context=await setup(guard);
    const {service}=context;
    for(const id of [1,1,5,6,7,12])service.addStructural({kind:"enclosure",configuration:request(id)});
    const roots=rootsOf(service.current()!);
    const named=(index:number)=>roots[index]!;
    return {...context,home:named(0),twin:named(1),other:named(2),both:named(3),unknown:named(4),frameX:named(5)};
  }

  it("moves a restricted Pannello and its Apparecchi subtree to a different compatible model, offline, and back",async()=>{
    const {service,destination,folder,home,both,other}=await layout();
    service.addStructural({kind:"support",parentUuid:home.uuid,configuration:request(2)});
    let view=service.addConfiguredItem(request(4),2);
    const panel=supportsOf(view)[0]!;
    for(const startUnits of [0,6])view=service.placeChild({itemUuid:flat(view.physicalNodes).length?view.configuredItems.find(item=>item.modelKind==="device")!.uuid:"",
      parentUuid:panel.uuid,zoneNo:0,startUnits,viewCode:"front"});
    const childrenBefore=JSON.stringify(supportsOf(view)[0]!.children);
    await service.save();
    service.close();
    // Reopen with no catalogue: any catalogue call would throw.
    const {service:offline,catalogue}=offlineService(folder);
    const reopened=offline.open(destination);
    const model6=rootsOf(reopened)[3]!;
    expect(model6.uuid).toBe(both.uuid);
    // A different model that provides an accepted context: offered and accepted.
    const offered=offline.placementTargets({parentUuid:both.uuid,nodeUuid:panel.uuid});
    const target=offered.targets.find(entry=>entry.action==="moveNode"&&entry.input.startUnits===200)!;
    expect(target).toBeDefined();
    expect(offline.checkPlacement(target.input as never,panel.uuid)).toEqual({ok:true});
    const moved=offline.moveNode(panel.uuid,target.input as never);
    const now=supportsOf(moved).find(node=>node.uuid===panel.uuid)!;
    expect(now).toMatchObject({parentUuid:both.uuid,startUnits:200});
    expect(JSON.stringify(now.children.map(child=>[child.uuid,child.parentUuid,child.zoneNo,child.startUnits])))
      .toBe(JSON.stringify(JSON.parse(childrenBefore).map((child:ProjectPhysicalNode)=>[child.uuid,child.parentUuid,child.zoneNo,child.startUnits])));
    expect(devicesOf(moved)).toHaveLength(2);
    // Save, reopen, and move it back to the original model; the subtree is unchanged again.
    await offline.save();
    const again=offline.open(destination);
    const back=offline.placementTargets({parentUuid:home.uuid,nodeUuid:panel.uuid}).targets.find(entry=>entry.action==="moveNode")!;
    const home2=offline.moveNode(panel.uuid,back.input as never);
    expect(supportsOf(home2)[0]).toMatchObject({parentUuid:home.uuid});
    expect(supportsOf(home2)[0]!.children.map(child=>child.uuid)).toEqual(now.children.map(child=>child.uuid));
    expect(again.physicalNodes).toBeDefined();
    // The model that provides only ctxB is refused, both as a target and as a write.
    expect(offline.placementTargets({parentUuid:other.uuid,nodeUuid:panel.uuid}))
      .toMatchObject({targets:[],diagnostics:[{code:"required_context_not_provided"}]});
    expect(catalogue).not.toHaveBeenCalled();
  });

  it("decides every case from the snapshot, with the target and the write agreeing and refusals changing nothing",async()=>{
    // A guard that would accept everything: it must never be consulted while the snapshot suffices.
    const guard=vi.fn<Guard>(OK);
    const {service,home,twin,other,both,frameX}=await layout(guard);
    service.addStructural({kind:"support",parentUuid:home.uuid,configuration:request(2)});
    service.addStructural({kind:"support",parentUuid:home.uuid,configuration:request(3)});
    let view=service.addConfiguredItem(request(4),1);
    const [restricted,unrestricted]=supportsOf(view) as [ProjectPhysicalNode,ProjectPhysicalNode];
    guard.mockClear();
    view=service.placeChild({itemUuid:view.configuredItems.find(item=>item.modelKind==="device")!.uuid,parentUuid:restricted.uuid,zoneNo:0,startUnits:0,viewCode:"front"});
    const cases:Array<[string,ProjectPhysicalNode,ProjectPhysicalNode,string|null]>=[
      ["same model, compatible",restricted,twin,null],
      ["different model, shared context",restricted,both,null],
      ["different model, no shared context",restricted,other,"required_context_not_provided"],
      ["unrestricted support to any model",unrestricted,other,null],
      ["shared context but the Apparecchio does not fit the root class",restricted,frameX,"incompatible_ancestor"],
    ];
    for(const [label,panel,root,refusal] of cases){
      const before=snapshot(service);
      const targets=service.placementTargets({parentUuid:root.uuid,nodeUuid:panel.uuid});
      if(refusal===null){
        const target=targets.targets.find(entry=>entry.action==="moveNode")!;
        expect(target,label).toBeDefined();
        expect(service.checkPlacement(target.input as never,panel.uuid),label).toEqual({ok:true});
        expect(snapshot(service),label).toBe(before);
        continue;
      }
      // Not offered, refused with the same reason by a direct write (moveNode and movePackedNode), nothing changes.
      expect(targets.targets,label).toEqual([]);
      expect(targets.diagnostics.map(entry=>entry.code),label).toContain(refusal);
      expect(service.checkPlacement({itemUuid:panel.itemUuid!,parentUuid:root.uuid,zoneNo:0,startUnits:0,viewCode:"front"},panel.uuid),label)
        .toMatchObject({ok:false,code:refusal});
      expect(()=>move(service,panel,root.uuid),label).toThrow();
      expect(()=>service.movePackedNode(panel.uuid,{parentUuid:root.uuid,zoneNo:0,viewCode:"front",startUnits:0}),label).toThrow();
      expect(snapshot(service),label).toBe(before);
    }
    // Complete snapshot facts decided everything above: the catalogue guard was never consulted.
    expect(guard).not.toHaveBeenCalled();
    // The accepted ones really move: a restricted Pannello with its Apparecchio to the model providing ctxA, and an unrestricted one anywhere.
    const beforeIds=JSON.stringify(supportsOf(view)[0]!.children.map(child=>child.uuid));
    const target=service.placementTargets({parentUuid:both.uuid,nodeUuid:restricted.uuid}).targets.find(entry=>entry.action==="moveNode")!;
    const moved=service.moveNode(restricted.uuid,target.input as never);
    expect(supportsOf(moved).find(node=>node.uuid===restricted.uuid)).toMatchObject({parentUuid:both.uuid});
    expect(JSON.stringify(supportsOf(moved).find(node=>node.uuid===restricted.uuid)!.children.map(child=>child.uuid))).toBe(beforeIds);
    const free=service.placementTargets({parentUuid:other.uuid,nodeUuid:unrestricted.uuid}).targets.find(entry=>entry.action==="moveNode")!;
    expect(supportsOf(service.moveNode(unrestricted.uuid,free.input as never)).find(node=>node.uuid===unrestricted.uuid)).toMatchObject({parentUuid:other.uuid});
  });

  it("refuses a move atomically when a descendant becomes invalid, even though the context matches",async()=>{
    const {service,home,frameX}=await layout();
    service.addStructural({kind:"support",parentUuid:home.uuid,configuration:request(2)});
    let view=service.addConfiguredItem(request(4),2);
    const panel=supportsOf(view)[0]!;
    for(const startUnits of [0,6])view=service.placeChild({itemUuid:view.configuredItems.find(item=>item.modelKind==="device")!.uuid,
      parentUuid:panel.uuid,zoneNo:0,startUnits,viewCode:"front"});
    const before=snapshot(service);
    expect(()=>move(service,panel,frameX.uuid)).toThrow();
    expect(snapshot(service)).toBe(before);
    expect(supportsOf(service.current()!)[0]!.children).toHaveLength(2);
  });
});

describe("catalogue fallback when the snapshot cannot decide a support's transfer",()=>{
  /** Roots 1 (home), 5 (other model, provides ctxB) and 12 (FRAME_X); optionally legacy (no facts) or with unknown facts. */
  async function scene(guard:Guard,legacy:boolean,supportModel=2,rootModels=[1,5,12]) {
    const context=await setup(guard);
    const {service}=context;
    state.legacy=legacy;
    for(const id of rootModels)service.addStructural({kind:"enclosure",configuration:request(id)});
    const roots=rootsOf(service.current()!);
    service.addStructural({kind:"support",parentUuid:roots[0]!.uuid,configuration:request(supportModel)});
    let view=service.addConfiguredItem(request(4),2);
    const panel=supportsOf(view)[0]!;
    for(const startUnits of [0,6])view=service.placeChild({itemUuid:view.configuredItems.find(item=>item.modelKind==="device")!.uuid,
      parentUuid:panel.uuid,zoneNo:0,startUnits,viewCode:"front"});
    return {...context,roots,panel};
  }
  const target=(service:ProjectDocumentService,panel:ProjectPhysicalNode,root:ProjectPhysicalNode)=>
    service.placementTargets({parentUuid:root.uuid,nodeUuid:panel.uuid});
  const facts=(file:string)=>contextRows(file);

  it("legacy facts: an accepting guard offers the destination and both writes succeed, without enriching the snapshot",async()=>{
    const guard=vi.fn<Guard>(OK);
    const {service,destination,roots,panel}=await scene(guard,true);
    const other=roots[1]!;
    const offered=target(service,panel,other);
    expect(guard).toHaveBeenCalledWith(expect.objectContaining({parentUuid:other.uuid,item:expect.objectContaining({modelCode:"model-2"})}));
    const accepted=offered.targets.find(entry=>entry.action==="moveNode"&&entry.input.startUnits===200)!;
    expect(accepted).toBeDefined();
    expect(service.checkPlacement(accepted.input as never,panel.uuid)).toEqual({ok:true});
    const identity=(nodes:readonly ProjectPhysicalNode[])=>JSON.stringify(nodes.map(node=>[node.uuid,node.parentUuid,node.zoneNo,node.startUnits]));
    const childrenBefore=identity(supportsOf(service.current()!)[0]!.children);
    const moved=service.moveNode(panel.uuid,accepted.input as never);
    const now=supportsOf(moved).find(node=>node.uuid===panel.uuid)!;
    expect(now).toMatchObject({parentUuid:other.uuid,startUnits:200});
    expect(identity(now.children)).toBe(childrenBefore);
    // The packed write path consults the same authority and accepts too (back to the first root).
    const packed=service.movePackedNode(panel.uuid,{parentUuid:roots[0]!.uuid,zoneNo:0,viewCode:"front",startUnits:300});
    expect(supportsOf(packed).find(node=>node.uuid===panel.uuid)).toMatchObject({parentUuid:roots[0]!.uuid,startUnits:300});
    const again=service.movePackedNode(panel.uuid,{parentUuid:other.uuid,zoneNo:0,viewCode:"front",startUnits:100});
    expect(supportsOf(again).find(node=>node.uuid===panel.uuid)).toMatchObject({parentUuid:other.uuid});
    // No snapshot enrichment as a side effect of moving.
    await service.save();
    expect(facts(destination).items.map(item=>item.policy)).toEqual([null,null,null,null,null]);
    expect(facts(destination).rows).toEqual([]);
  });

  it("legacy facts: a refusing guard offers no target and refuses every write, leaving the project unchanged",async()=>{
    const refuse:Guard=()=>({ok:false,code:"required_context_not_provided"});
    const {service,roots,panel}=await scene(refuse,true);
    const other=roots[1]!;
    const before=snapshot(service);
    const offered=target(service,panel,other);
    expect(offered).toMatchObject({targets:[],diagnostics:[{code:"required_context_not_provided"}]});
    expect(service.checkPlacement({itemUuid:panel.itemUuid!,parentUuid:other.uuid,zoneNo:0,startUnits:0,viewCode:"front"},panel.uuid))
      .toMatchObject({ok:false,code:"required_context_not_provided"});
    expect(()=>move(service,panel,other.uuid)).toThrow(/contesto|required_context_not_provided/);
    expect(()=>service.movePackedNode(panel.uuid,{parentUuid:other.uuid,zoneNo:0,viewCode:"front",startUnits:0})).toThrow();
    expect(snapshot(service)).toBe(before);
    // A refusing guard also refuses a same-model destination (the guard is the authority when it can judge).
    const same=await scene(refuse,true,2,[1,1]);
    expect(target(same.service,same.panel,same.roots[1]!)).toMatchObject({targets:[],diagnostics:[{code:"required_context_not_provided"}]});
  });

  it("unknown snapshot facts: an accepting guard lets the move succeed, a refusing guard refuses it",async()=>{
    // Support 13 has policy unknown in its snapshot; root 5 has known facts.
    const yes=await scene(OK,false,13);
    const offered=target(yes.service,yes.panel,yes.roots[1]!);
    expect(offered.targets.some(entry=>entry.action==="moveNode")).toBe(true);
    expect(supportsOf(move(yes.service,yes.panel,yes.roots[1]!.uuid,200)).find(node=>node.uuid===yes.panel.uuid)).toMatchObject({parentUuid:yes.roots[1]!.uuid});
    const no=await scene(()=>({ok:false,code:"required_context_not_provided"}),false,13);
    const before=snapshot(no.service);
    expect(target(no.service,no.panel,no.roots[1]!)).toMatchObject({targets:[],diagnostics:[{code:"required_context_not_provided"}]});
    expect(()=>move(no.service,no.panel,no.roots[1]!.uuid)).toThrow();
    expect(snapshot(no.service)).toBe(before);
    // An unknown destination root policy is insufficient in the same way (root model 7).
    const rootUnknown=await scene(OK,false,2,[1,7]);
    expect(target(rootUnknown.service,rootUnknown.panel,rootUnknown.roots[1]!).targets.some(entry=>entry.action==="moveNode")).toBe(true);
    const rootUnknownRefused=await scene(()=>({ok:false,code:"required_context_not_provided"}),false,2,[1,7]);
    expect(target(rootUnknownRefused.service,rootUnknownRefused.panel,rootUnknownRefused.roots[1]!).targets).toEqual([]);
  });

  it("with no catalogue authority the conservative legacy behaviour remains",async()=>{
    for(const unavailable of [null,()=>({ok:false as const,code:"model_unavailable"}),()=>({ok:false as const,code:"engineering_data_stale"})]){
      const context=unavailable===null?await scene(OK,true,2,[1,1,5]):await scene(unavailable,true,2,[1,1,5]);
      const {service,roots,panel}=context;
      if(unavailable===null){
        // A service with no guard at all is the same as an unavailable catalogue.
        const bare=offlineService(context.folder);
        await service.save();
        bare.service.open(context.destination);
        const twin=bare.service.placementTargets({parentUuid:roots[1]!.uuid,nodeUuid:panel.uuid});
        expect(twin.targets.some(entry=>entry.action==="moveNode")).toBe(true);
        expect(bare.service.placementTargets({parentUuid:roots[2]!.uuid,nodeUuid:panel.uuid}))
          .toMatchObject({targets:[],diagnostics:[{code:"root_context_unverified"}]});
        continue;
      }
      expect(target(service,panel,roots[1]!).targets.some(entry=>entry.action==="moveNode")).toBe(true);
      expect(target(service,panel,roots[2]!)).toMatchObject({targets:[],diagnostics:[{code:"root_context_unverified"}]});
      const before=snapshot(service);
      expect(()=>move(service,panel,roots[2]!.uuid)).toThrow(/modello diverso/);
      expect(snapshot(service)).toBe(before);
    }
  });

  it("only consults the catalogue when the snapshot is insufficient, and not for repositioning inside one root",async()=>{
    const guard=vi.fn<Guard>(OK);
    const {service,roots,panel}=await scene(guard,false,2,[1,6]);
    guard.mockClear();
    target(service,panel,roots[1]!);target(service,panel,roots[0]!);
    move(service,panel,roots[1]!.uuid,200);
    expect(guard).not.toHaveBeenCalled();
    const legacy=vi.fn<Guard>(OK);
    const old=await scene(legacy,true);
    legacy.mockClear();
    target(old.service,old.panel,old.roots[0]!);
    expect(legacy).not.toHaveBeenCalled();
    target(old.service,old.panel,old.roots[1]!);
    expect(legacy).toHaveBeenCalledTimes(1);
  });

  it("still refuses the whole subtree atomically when a descendant is invalid after the context is verified",async()=>{
    const {service,roots,panel}=await scene(OK,true);
    const frameX=roots[2]!;
    const before=snapshot(service);
    expect(target(service,panel,frameX)).toMatchObject({targets:[]});
    expect(()=>move(service,panel,frameX.uuid)).toThrow();
    expect(()=>service.movePackedNode(panel.uuid,{parentUuid:frameX.uuid,zoneNo:0,viewCode:"front",startUnits:0})).toThrow();
    expect(snapshot(service)).toBe(before);
    expect(supportsOf(service.current()!)[0]!.children).toHaveLength(2);
  });
});
