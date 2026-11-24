import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openCurrentProjectDatabase, openProjectDatabaseAtVersion,
  migrateProjectDatabaseToCurrent } from "../src/main/database/project-migrations.js";
import { getPhysicalProfile } from "../src/main/catalogue/configuration-queries.js";
import { getCatalogueProductSnapshot } from "../src/main/catalogue/catalogue-queries.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";
import { insertConfiguredItem } from "../src/main/project/configured-items.js";
import { readConfiguredItems } from "../src/main/project/configured-items.js";
import { checkPlacement, checkPackedChild, placeRoot, placeChild, moveNode, unplaceNode, insertPackedChild,
  reorderPackedNode, removePackedNode, readPhysicalNodes, placementTargets, movePackedNode, type PlacementInput } from "../src/main/project/physical-placement.js";
import { devicePool, placementInputForSelection } from "../src/renderer/project/placement-workflow.js";
import type { ProjectConfiguredItem, ProjectDocumentView } from "../src/shared/project.js";

const migration=path.resolve("db/migrations/project");
const cataloguePath=process.env["LIBREQUADRI_REV83_REAL_DB"] ?? "";
function project() {
  const root=mkdtempSync(path.join(tmpdir(),"lqp-placement-"));
  const filename=path.join(root,"project.lqp");
  const db=openCurrentProjectDatabase(filename,migration);
  db.prepare("INSERT INTO prj_group(id,uuid,name,sort_order) VALUES (1,?,'Quote',0)").run(randomUUID());
  return {db,filename,close:()=>{db.close();rmSync(root,{recursive:true,force:true});}};
}
function item(db:Database.Database,kind:"enclosure"|"support"|"device",code:string,fit:string,quantity=1) {
  const uuid=randomUUID();
  const id=Number(db.prepare(`INSERT INTO prj_item(uuid,model_brand_marchio,model_code,model_name,model_kind,
    model_definition_fingerprint,config_fingerprint,config_label,config_status,phys_status,
    profile_code,profile_name,fit_class_code,fit_class_label,snapshot_taken_at)
    VALUES (?,'ACME',?,?,?,'definition','config',?,'complete','resolved',?,?,?,?,'2026-09-24T00:00:00.000Z')`)
    .run(uuid,code,code,kind,code,code,code,fit,fit).lastInsertRowid);
  const next=(db.prepare("SELECT COALESCE(MAX(sort_order),-1)+1 FROM prj_line").pluck().get() as number);
  db.prepare(`INSERT INTO prj_line(uuid,group_id,sort_order,line_type,item_id,quantity)
    VALUES (?,1,?,'item',?,?)`).run(randomUUID(),next,id,quantity);
  return {uuid,id};
}
function view(db:Database.Database,id:number,width:number,height:number,code="front") {
  db.prepare(`INSERT INTO prj_item_view(item_id,view_code,width_mm,height_mm,insert_dx_mm,insert_dy_mm,symbol_kind)
    VALUES (?,?,?,?,0,0,'rect')`).run(id,code,width,height);
}
function zone(db:Database.Database,id:number,layout:"stack"|"linear"|"slots",kind:string|null,capacity:number|null,
  pitch:number|null) {
  db.prepare(`INSERT INTO prj_item_zone(item_id,zone_no,layout,capacity_kind_code,capacity_kind_label,
    display_divisor,nominal_pitch_mm,capacity_amount,origin_x_mm,origin_y_mm,length_mm,breadth_mm,
    direction,pitch_mm,required_view_code) VALUES (?,0,?,?,?,?,?, ?,10,20,500,300,'horizontal',?,'front')`)
    .run(id,layout,kind,kind,kind?1:null,kind?pitch:null,capacity,pitch);
}
function fixture() {
  const p=project(),{db}=p;
  const enclosure=item(db,"enclosure","BOX-A","FRAME-X");view(db,enclosure.id,400,600);zone(db,enclosure.id,"stack","height-unit",500,50);
  const support=item(db,"support","TRAY-B","TRAY-X");view(db,support.id,200,100);zone(db,support.id,"linear","rail-unit",12,10);
  const device=item(db,"device","SWITCH-C","DIN-X",2);view(db,device.id,20,40);
  db.prepare("INSERT INTO prj_item_demand(item_id,capacity_kind_code,capacity_kind_label,amount,display_divisor) VALUES (?,'rail-unit','unit',4,1)").run(device.id);
  db.prepare("INSERT INTO prj_item_constraint(item_id,relation,set_no,class_code) VALUES (?,'parent',0,?)")
    .run(support.id,"FRAME-X");
  db.prepare("INSERT INTO prj_item_constraint(item_id,relation,set_no,class_code) VALUES (?,'parent',0,?)")
    .run(device.id,"TRAY-X");
  return {...p,enclosure,support,device};
}
function independentTree(db:Database.Database) {
  const enclosure=item(db,"enclosure","BOX-B","FRAME-B");view(db,enclosure.id,400,600);
  zone(db,enclosure.id,"stack","height-unit",500,50);
  const support=item(db,"support","TRAY-B2","TRAY-B2");view(db,support.id,200,100);
  zone(db,support.id,"linear","rail-unit",12,10);
  db.prepare("INSERT INTO prj_item_constraint(item_id,relation,set_no,class_code) VALUES (?,'parent',0,'FRAME-B')")
    .run(support.id);
  const device=item(db,"device","SWITCH-B","DIN-B",2);view(db,device.id,20,40);
  db.prepare("INSERT INTO prj_item_demand(item_id,capacity_kind_code,capacity_kind_label,amount,display_divisor) VALUES (?,'rail-unit','unit',4,1)")
    .run(device.id);
  db.prepare("INSERT INTO prj_item_constraint(item_id,relation,set_no,class_code) VALUES (?,'parent',0,'TRAY-B2')")
    .run(device.id);
  return {enclosure,support,device};
}
function snapshotProfile(projectDb:Database.Database,catalogue:Database.Database,profileCode:string) {
  const profileId=catalogue.prepare("SELECT id FROM cat_phys_profile WHERE code=?").pluck().get(profileCode) as number;
  const profile=getPhysicalProfile(catalogue,profileId)!;
  const created=item(projectDb,profile.kind as "enclosure"|"support"|"device",profile.code,profile.fitClass.code);
  for(const shape of profile.views)projectDb.prepare(`INSERT INTO prj_item_view(item_id,view_code,width_mm,
    height_mm,insert_dx_mm,insert_dy_mm,symbol_kind) VALUES (?,?,?,?,?,?,?)`).run(created.id,
      shape.code,shape.widthMm,shape.heightMm,shape.insertDxMm,shape.insertDyMm,shape.symbolKind);
  for(const demand of profile.demands)projectDb.prepare(`INSERT INTO prj_item_demand(item_id,capacity_kind_code,
    capacity_kind_label,amount,display_divisor,nominal_pitch_mm) VALUES (?,?,?,?,?,?)`)
    .run(created.id,demand.capacityKindCode,demand.unitLabel,demand.amount,demand.displayDivisor,demand.nominalPitchMm);
  for(const z of profile.zones)projectDb.prepare(`INSERT INTO prj_item_zone(item_id,zone_no,layout,
    capacity_kind_code,capacity_kind_label,display_divisor,nominal_pitch_mm,capacity_amount,
    origin_x_mm,origin_y_mm,length_mm,breadth_mm,direction,pitch_mm,required_view_code)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(created.id,z.zoneNo,z.layout,z.capacityKindCode,
      z.capacityKindLabel??null,z.displayDivisor??null,z.nominalPitchMm??null,z.capacityAmount,
      z.originXMm,z.originYMm,z.lengthMm,z.breadthMm,z.direction,z.pitchMm,z.requiredViewCode);
  for(const slot of profile.slots)projectDb.prepare(`INSERT INTO prj_item_zone_slot(item_id,zone_no,slot_no,x_mm,y_mm)
    VALUES (?,?,?,?,?)`).run(created.id,slot.zoneNo,slot.slotNo,slot.xMm,slot.yMm);
  profile.constraints.forEach((constraint,index)=>{
    for(const classCode of constraint.classCodes)projectDb.prepare(`INSERT INTO prj_item_constraint
      (item_id,relation,set_no,class_code) VALUES (?,?,?,?)`).run(created.id,constraint.relation,index,classCode);
  });
  return created;
}

describe("generic project physical placement",()=>{
  it("allows either MARINA Avanquadro mounting position and rejects device collisions across its two windows",()=>{
    const {db,close}=project();
    try {
      const frame=item(db,"enclosure","tq.pack.13611","MARINA",2);
      const breakerWindow=item(db,"support","tq.pack.factory.3620","breaker-window",2);
      const relayWindow=item(db,"support","tq.pack.factory.3621","relay-window",2);
      const breaker=item(db,"device","breaker","breaker");
      const relay=item(db,"device","relay","relay");
      db.prepare("UPDATE prj_item SET model_brand_marchio='BTI' WHERE id IN (?,?,?)")
        .run(frame.id,breakerWindow.id,relayWindow.id);
      const slot=db.prepare("INSERT INTO prj_item_zone_slot(item_id,zone_no,slot_no,x_mm,y_mm) VALUES (?,0,?,?,?)");
      view(db,frame.id,510,720);zone(db,frame.id,"slots",null,2,null);
      slot.run(frame.id,1,110,85);slot.run(frame.id,2,110,285);
      for(const [window,width,height] of [[breakerWindow,290,550],[relayWindow,60,150]] as const){
        view(db,window.id,width,height);zone(db,window.id,"slots",null,1,null);
        slot.run(window.id,1,5,5);
      }
      view(db,breaker.id,280,540);view(db,relay.id,50,140);
      const constraint=db.prepare("INSERT INTO prj_item_constraint(item_id,relation,set_no,class_code) VALUES (?,'parent',0,?)");
      constraint.run(breaker.id,"breaker-window");constraint.run(relay.id,"relay-window");
      const input=(itemUuid:string,parentUuid:string,slotNo=1)=>({itemUuid,parentUuid,slotNo,zoneNo:0,viewCode:"front"});
      const cabinet=(rootXMm:number)=>{
        const root=placeRoot(db,{itemUuid:frame.uuid,rootXMm,rootYMm:0,viewCode:"front"});
        return {breaker:placeChild(db,input(breakerWindow.uuid,root)),relay:placeChild(db,input(relayWindow.uuid,root,2))};
      };
      const left=cabinet(0),right=cabinet(560);
      const first=placeChild(db,input(breaker.uuid,left.breaker));
      const second=placeChild(db,input(relay.uuid,right.relay));
      const moveRelay=input(relay.uuid,left.relay);
      const moveBreaker=input(breaker.uuid,right.breaker);
      const before=readPhysicalNodes(db);
      for(const [nodeUuid,destination] of [[second,moveRelay],[first,moveBreaker]] as const){
        expect(placementTargets(db,{nodeUuid,parentUuid:destination.parentUuid})).toMatchObject({targets:[],diagnostics:[{code:"overlap"}]});
        expect(()=>moveNode(db,nodeUuid,destination)).toThrow("altra finestra di fabbrica");
      }
      expect(readPhysicalNodes(db)).toEqual(before);
      unplaceNode(db,second);
      expect(placementTargets(db,{itemUuid:relay.uuid,parentUuid:left.relay})).toMatchObject({targets:[],diagnostics:[{code:"overlap"}]});
      expect(()=>placeChild(db,moveRelay)).toThrow("altra finestra di fabbrica");
      unplaceNode(db,first);
      expect(placeChild(db,moveRelay)).toBeTruthy();
    }finally{close();}
  });

  it("places only available device units on the selected support and reopens the portable tree",()=>{
    const f=fixture();try {
      f.db.prepare("UPDATE prj_line SET quantity=2 WHERE item_id=?").run(f.enclosure.id);
      f.db.prepare("UPDATE prj_line SET quantity=3 WHERE item_id=?").run(f.support.id);
      const rootA=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const rootB=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:700,rootYMm:0,viewCode:"front"});
      const panelA=insertPackedChild(f.db,{itemUuid:f.support.uuid,parentUuid:rootA,zoneNo:0,viewCode:"front"});
      const panelA2=insertPackedChild(f.db,{itemUuid:f.support.uuid,parentUuid:rootA,zoneNo:0,viewCode:"front"});
      const panelB=insertPackedChild(f.db,{itemUuid:f.support.uuid,parentUuid:rootB,zoneNo:0,viewCode:"front"});
      const input={itemUuid:f.device.uuid,parentUuid:panelB,zoneNo:0,viewCode:"front"};
      const availability=(db:Database.Database)=>{
        const nodes=readPhysicalNodes(db);
        const snapshot={configuredItems:[{uuid:f.device.uuid,modelKind:"device"} as ProjectConfiguredItem],
          lines:[{itemUuid:f.device.uuid,quantity:2}],physicalNodes:nodes} as unknown as ProjectDocumentView;
        return devicePool(snapshot)[0]!;
      };
      expect(availability(f.db)).toMatchObject({quantity:2,placed:0,available:2});
      expect(checkPackedChild(f.db,input)).toEqual({ok:true});
      const first=insertPackedChild(f.db,input);
      expect(availability(f.db)).toMatchObject({quantity:2,placed:1,available:1});
      const second=insertPackedChild(f.db,input);
      expect(availability(f.db)).toMatchObject({quantity:2,placed:2,available:0});
      expect(readPhysicalNodes(f.db)[0]!.children[0]!.uuid).toBe(panelA);
      expect(readPhysicalNodes(f.db)[0]!.children[0]!.children).toHaveLength(0);
      expect(readPhysicalNodes(f.db)[0]!.children[1]!.uuid).toBe(panelA2);
      expect(readPhysicalNodes(f.db)[0]!.children[1]!.children).toHaveLength(0);
      expect(readPhysicalNodes(f.db)[1]!.children[0]!.uuid).toBe(panelB);
      expect(readPhysicalNodes(f.db)[1]!.children[0]!.children.map(n=>n.startUnits)).toEqual([0,4]);
      const full=readPhysicalNodes(f.db);
      expect(checkPackedChild(f.db,input)).toMatchObject({ok:false,code:"quantity_exhausted"});
      expect(()=>insertPackedChild(f.db,input)).toThrow("quantità configurata");
      expect(readPhysicalNodes(f.db)).toEqual(full);
      reorderPackedNode(f.db,second,0);
      expect(readPhysicalNodes(f.db)[1]!.children[0]!.children.map(n=>n.uuid)).toEqual([second,first]);
      removePackedNode(f.db,second);
      expect(availability(f.db)).toMatchObject({quantity:2,placed:1,available:1});
      expect(f.db.prepare("SELECT quantity FROM prj_line WHERE item_id=?").pluck().get(f.device.id)).toBe(2);
      expect(f.db.prepare("SELECT uuid FROM prj_item WHERE id=?").pluck().get(f.device.id)).toBe(f.device.uuid);
      const before=readPhysicalNodes(f.db);
      f.db.close();const reopened=openCurrentProjectDatabase(f.filename,migration);
      try {
        expect(readPhysicalNodes(reopened)).toEqual(before);
        expect(availability(reopened)).toMatchObject({quantity:2,placed:1,available:1});
        expect(checkPackedChild(reopened,input)).toEqual({ok:true});
      }finally{reopened.close();}
    }finally{if(f.db.open)f.db.close();rmSync(path.dirname(f.filename),{recursive:true,force:true});}
  });

  it("previews incompatibility and full capacity without changing project state",()=>{
    const f=fixture();try {
      const root=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const panel=insertPackedChild(f.db,{itemUuid:f.support.uuid,parentUuid:root,zoneNo:0,viewCode:"front"});
      const wrong=item(f.db,"device","WRONG","OTHER");view(f.db,wrong.id,20,40);
      f.db.prepare("INSERT INTO prj_item_demand(item_id,capacity_kind_code,capacity_kind_label,amount,display_divisor) VALUES (?,'rail-unit','unit',4,1)")
        .run(wrong.id);
      f.db.prepare("INSERT INTO prj_item_constraint(item_id,relation,set_no,class_code) VALUES (?,'parent',0,'OTHER-PANEL')")
        .run(wrong.id);
      const incompatible={itemUuid:wrong.uuid,parentUuid:panel,zoneNo:0,viewCode:"front"};
      const before=readPhysicalNodes(f.db);
      expect(checkPackedChild(f.db,incompatible)).toMatchObject({ok:false,code:"incompatible_parent"});
      expect(()=>insertPackedChild(f.db,incompatible)).toThrow();
      expect(readPhysicalNodes(f.db)).toEqual(before);
      insertPackedChild(f.db,{itemUuid:f.device.uuid,parentUuid:panel,zoneNo:0,viewCode:"front"});
      insertPackedChild(f.db,{itemUuid:f.device.uuid,parentUuid:panel,zoneNo:0,viewCode:"front"});
      const large=item(f.db,"device","LARGE","DIN-X");view(f.db,large.id,30,40);
      f.db.prepare("INSERT INTO prj_item_demand(item_id,capacity_kind_code,capacity_kind_label,amount,display_divisor) VALUES (?,'rail-unit','unit',5,1)")
        .run(large.id);
      const overflow={itemUuid:large.uuid,parentUuid:panel,zoneNo:0,viewCode:"front"};
      const packed=readPhysicalNodes(f.db);
      expect(checkPackedChild(f.db,overflow)).toMatchObject({ok:false,code:"over_capacity"});
      expect(()=>insertPackedChild(f.db,overflow)).toThrow();
      expect(readPhysicalNodes(f.db)).toEqual(packed);
    }finally{f.close();}
  });
  it("rejects a packed slot insertion atomically when a shifted child has no slot",()=>{
    const p=project();try {
      const enclosure=item(p.db,"enclosure","PACKED-SLOTS","FRAME");
      view(p.db,enclosure.id,300,400);zone(p.db,enclosure.id,"slots",null,2,null);
      for(const [slot,x,y] of [[1,10,20],[3,70,30]])
        p.db.prepare("INSERT INTO prj_item_zone_slot(item_id,zone_no,slot_no,x_mm,y_mm) VALUES (?,0,?,?,?)")
          .run(enclosure.id,slot,x,y);
      const device=item(p.db,"device","SLOT-DEVICE","PLUG",3);view(p.db,device.id,20,20);
      p.db.prepare("UPDATE prj_item_view SET insert_dx_mm=2,insert_dy_mm=4 WHERE item_id=?")
        .run(device.id);
      const root=placeRoot(p.db,{itemUuid:enclosure.uuid,rootXMm:7,rootYMm:9,viewCode:"front"});
      const input={itemUuid:device.uuid,parentUuid:root,zoneNo:0,viewCode:"front"};
      const first=insertPackedChild(p.db,input);
      const second=insertPackedChild(p.db,input);
      const before=readPhysicalNodes(p.db);
      expect(before[0]!.children.map(n=>[n.uuid,n.sortOrder,n.slotNo,n.startUnits,n.xMm,n.yMm]))
        .toEqual([[first,0,1,null,15,25],[second,1,3,null,75,35]]);
      const stored=()=>p.db.prepare("SELECT uuid,parent_id,zone_no,sort_order,slot_no,start_units FROM prj_node ORDER BY id").all();
      const rowsBefore=stored();
      expect(()=>insertPackedChild(p.db,input,0)).toThrow("slot disponibili");
      expect(readPhysicalNodes(p.db)).toEqual(before);
      expect(stored()).toEqual(rowsBefore);
      p.db.close();const reopened=openCurrentProjectDatabase(p.filename,migration);
      try {expect(readPhysicalNodes(reopened)).toEqual(before);}
      finally {reopened.close();}
    } finally {if(p.db.open)p.close();else rmSync(path.dirname(p.filename),{recursive:true,force:true});}
  });
  it("rejects a stack reorder atomically when the shifted child misses the zone pitch",()=>{
    const p=project();try {
      const enclosure=item(p.db,"enclosure","PACKED-STACK","FRAME");
      view(p.db,enclosure.id,300,500);zone(p.db,enclosure.id,"stack","stack_mm",500,50);
      const short=item(p.db,"support","SHORT","SUPPORT");view(p.db,short.id,100,50);
      const tall=item(p.db,"support","TALL","SUPPORT");view(p.db,tall.id,100,75);
      const root=placeRoot(p.db,{itemUuid:enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const first=insertPackedChild(p.db,{itemUuid:short.uuid,parentUuid:root,zoneNo:0,viewCode:"front"});
      const second=insertPackedChild(p.db,{itemUuid:tall.uuid,parentUuid:root,zoneNo:0,viewCode:"front"});
      const before=readPhysicalNodes(p.db);
      expect(before[0]!.children.map(n=>[n.uuid,n.sortOrder,n.startUnits,n.yMm]))
        .toEqual([[first,0,0,20],[second,1,50,70]]);
      expect(()=>reorderPackedNode(p.db,second,0)).toThrow("passo della zona");
      expect(readPhysicalNodes(p.db)).toEqual(before);
    } finally {p.close();}
  });
  it("reopens the same project tree and absolute coordinates from the document",()=>{
    const p=project();
    try {
      const enclosure=item(p.db,"enclosure","BOX-PERSIST","FRAME-PERSIST");
      view(p.db,enclosure.id,400,600);
      zone(p.db,enclosure.id,"stack","height-unit",500,50);
      const support=item(p.db,"support","TRAY-PERSIST","TRAY-PERSIST");
      view(p.db,support.id,200,100);
      const root=placeRoot(p.db,{itemUuid:enclosure.uuid,rootXMm:120,rootYMm:80,viewCode:"front"});
      placeChild(p.db,{itemUuid:support.uuid,parentUuid:root,zoneNo:0,startUnits:50,viewCode:"front"});
      const before=readPhysicalNodes(p.db);
      p.db.close();
      const reopened=openCurrentProjectDatabase(p.filename,migration);
      try { expect(readPhysicalNodes(reopened)).toEqual(before); }
      finally { reopened.close(); }
    } finally { if(p.db.open)p.db.close();rmSync(path.dirname(p.filename),{recursive:true,force:true}); }
  });
  it("migrates format-2 snapshots without fabricating capacity or fit labels",()=>{
    const root=mkdtempSync(path.join(tmpdir(),"lqp-placement-old-"));
    const db=openProjectDatabaseAtVersion(path.join(root,"old.lqp"),migration,2);
    try {
      db.prepare(`INSERT INTO prj_item(id,uuid,model_brand_marchio,model_code,model_name,model_kind,
        model_definition_fingerprint,config_fingerprint,config_label,config_status,phys_status,
        fit_class_code,snapshot_taken_at) VALUES (1,?,'ACME','old','Old','support',
        'definition','config','Old','complete','resolved','FIT','2026-09-24T00:00:00.000Z')`).run(randomUUID());
      db.prepare(`INSERT INTO prj_item_zone(item_id,zone_no,layout,capacity_kind_code,capacity_amount,
        origin_x_mm,origin_y_mm,direction) VALUES (1,0,'linear','rail',8,0,0,'horizontal')`).run();
      migrateProjectDatabaseToCurrent(db,migration);
      expect(db.prepare("SELECT fit_class_label FROM prj_item").pluck().get()).toBeNull();
      expect(db.prepare(`SELECT capacity_kind_label,display_divisor,nominal_pitch_mm
        FROM prj_item_zone`).get()).toEqual({capacity_kind_label:null,display_divisor:null,
          nominal_pitch_mm:null});
    } finally {db.close();rmSync(root,{recursive:true,force:true});}
  });
  it("isolates a legacy tree's missing pitch from another enclosure's positions and placement",()=>{
    const f=fixture();try {
      const root=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const tray=placeChild(f.db,{itemUuid:f.support.uuid,parentUuid:root,zoneNo:0,startUnits:0,viewCode:"front"});
      placeChild(f.db,{itemUuid:f.device.uuid,parentUuid:tray,zoneNo:0,startUnits:0,viewCode:"front"});
      f.db.prepare("UPDATE prj_item_zone SET nominal_pitch_mm=NULL WHERE item_id=?").run(f.support.id);
      const other=independentTree(f.db);
      const otherRoot=placeRoot(f.db,{itemUuid:other.enclosure.uuid,rootXMm:1000,rootYMm:200,viewCode:"front"});
      const otherTray=placeChild(f.db,{itemUuid:other.support.uuid,parentUuid:otherRoot,
        zoneNo:0,startUnits:0,viewCode:"front"});
      const otherDevice=placeChild(f.db,{itemUuid:other.device.uuid,parentUuid:otherTray,
        zoneNo:0,startUnits:2,viewCode:"front"});
      const nodes=readPhysicalNodes(f.db);
      expect(nodes[0]).toMatchObject({xMm:0,yMm:0,positionIssue:null});
      expect(nodes[0]?.children[0]).toMatchObject({xMm:10,yMm:20,positionIssue:null});
      expect(nodes[0]?.children[0]?.children[0]).toMatchObject({
        xMm:null,yMm:null,positionIssue:expect.stringContaining("missing_position_metadata")});
      expect(nodes[1]?.children[0]?.children[0]).toMatchObject({uuid:otherDevice,
        xMm:1040,yMm:240,positionIssue:null});
      moveNode(f.db,otherDevice,{itemUuid:other.device.uuid,parentUuid:otherTray,
        zoneNo:0,startUnits:4,viewCode:"front"});
      expect(readPhysicalNodes(f.db)[1]?.children[0]?.children[0]?.xMm).toBe(1060);
      expect(checkPlacement(f.db,{itemUuid:f.device.uuid,parentUuid:tray,zoneNo:0,startUnits:4,
        viewCode:"front"})).toMatchObject({ok:false,code:"missing_position_metadata"});
    } finally {f.close();}
  });
  it("isolates a reserved group root from valid enclosure positioning and placement",()=>{
    const p=project();try {
      const uuid=randomUUID();
      p.db.prepare(`INSERT INTO prj_node(uuid,node_kind,root_x_mm,root_y_mm,sort_order)
        VALUES (?,'group',0,0,0)`).run(uuid);
      const other=independentTree(p.db);
      const root=placeRoot(p.db,{itemUuid:other.enclosure.uuid,rootXMm:300,rootYMm:400,viewCode:"front"});
      const tray=placeChild(p.db,{itemUuid:other.support.uuid,parentUuid:root,
        zoneNo:0,startUnits:0,viewCode:"front"});
      expect(readPhysicalNodes(p.db)).toMatchObject([
        {uuid,nodeKind:"group",itemUuid:null,xMm:null,yMm:null,
          positionIssue:expect.stringContaining("unsupported_group")},
        {uuid:root,xMm:300,yMm:400,positionIssue:null,
          children:[{uuid:tray,xMm:310,yMm:420,positionIssue:null}]},
      ]);
    } finally {p.close();}
  });
  it("reports an invalid ancestor separately from a descendant with unavailable position",()=>{
    const f=fixture();try {
      const root=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:5,rootYMm:7,viewCode:"front"});
      const tray=placeChild(f.db,{itemUuid:f.support.uuid,parentUuid:root,zoneNo:0,startUnits:0,viewCode:"front"});
      placeChild(f.db,{itemUuid:f.device.uuid,parentUuid:tray,zoneNo:0,startUnits:0,viewCode:"front"});
      f.db.prepare("UPDATE prj_item_view SET insert_dx_mm=NULL WHERE item_id=?").run(f.support.id);
      const nodes=readPhysicalNodes(f.db);
      expect(nodes[0]).toMatchObject({xMm:5,yMm:7,positionIssue:null});
      expect(nodes[0]?.children[0]).toMatchObject({xMm:null,yMm:null,
        positionIssue:expect.stringContaining("missing_position_metadata")});
      expect(nodes[0]?.children[0]?.children[0]).toMatchObject({xMm:null,yMm:null,
        positionIssue:expect.stringContaining("ancestor_position_unavailable")});
    } finally {f.close();}
  });
  it("enforces fit, capacity, and overlap despite an unrelated invalid tree",()=>{
    const f=fixture();try {
      const badRoot=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const badTray=placeChild(f.db,{itemUuid:f.support.uuid,parentUuid:badRoot,zoneNo:0,startUnits:0,viewCode:"front"});
      placeChild(f.db,{itemUuid:f.device.uuid,parentUuid:badTray,zoneNo:0,startUnits:0,viewCode:"front"});
      f.db.prepare("UPDATE prj_item_zone SET nominal_pitch_mm=NULL WHERE item_id=?").run(f.support.id);
      const other=independentTree(f.db);
      const root=placeRoot(f.db,{itemUuid:other.enclosure.uuid,rootXMm:500,rootYMm:0,viewCode:"front"});
      const tray=placeChild(f.db,{itemUuid:other.support.uuid,parentUuid:root,zoneNo:0,startUnits:0,viewCode:"front"});
      const candidate=(startUnits:number)=>({itemUuid:other.device.uuid,parentUuid:tray,zoneNo:0,
        startUnits,viewCode:"front"});
      expect(checkPlacement(f.db,candidate(9))).toMatchObject({ok:false,code:"over_capacity"});
      placeChild(f.db,candidate(0));
      expect(checkPlacement(f.db,candidate(2))).toMatchObject({ok:false,code:"overlap"});
      const wrong=item(f.db,"device","WRONG-FIT","OTHER");view(f.db,wrong.id,20,40);
      f.db.prepare("INSERT INTO prj_item_demand(item_id,capacity_kind_code,capacity_kind_label,amount,display_divisor) VALUES (?,'rail-unit','unit',2,1)")
        .run(wrong.id);
      f.db.prepare("INSERT INTO prj_item_constraint(item_id,relation,set_no,class_code) VALUES (?,'parent',0,'OTHER-TRAY')")
        .run(wrong.id);
      expect(checkPlacement(f.db,{itemUuid:wrong.uuid,parentUuid:tray,zoneNo:0,startUnits:4,
        viewCode:"front"})).toMatchObject({ok:false,code:"incompatible_parent"});
    } finally {f.close();}
  });
  it("places, positions, moves, and leaf-unplaces a brand-neutral tree",()=>{
    const f=fixture();try {
      const root=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:5,rootYMm:7,viewCode:"front"});
      expect(checkPlacement(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,
        zoneNo:0,viewCode:"front"})).toMatchObject({ok:false,code:"invalid_root"});
      const tray=placeChild(f.db,{itemUuid:f.support.uuid,parentUuid:root,zoneNo:0,startUnits:50,viewCode:"front"});
      expect(checkPlacement(f.db,{itemUuid:f.device.uuid,parentUuid:tray,zoneNo:0,startUnits:0,
        rootXMm:0,viewCode:"front"})).toMatchObject({ok:false,code:"invalid_position"});
      const part=placeChild(f.db,{itemUuid:f.device.uuid,parentUuid:tray,zoneNo:0,startUnits:4,viewCode:"front"});
      expect(readPhysicalNodes(f.db)[0]?.children[0]?.children[0]).toMatchObject({uuid:part,xMm:65,yMm:97});
      expect(checkPlacement(f.db,{itemUuid:f.support.uuid,parentUuid:part,zoneNo:0,
        startUnits:0,viewCode:"front"},tray)).toMatchObject({ok:false,code:"cycle"});
      expect(()=>unplaceNode(f.db,tray)).toThrow("senza figli");
      moveNode(f.db,part,{itemUuid:f.device.uuid,parentUuid:tray,zoneNo:0,startUnits:8,viewCode:"front"});
      expect(readPhysicalNodes(f.db)[0]?.children[0]?.children[0]?.xMm).toBe(105);
      unplaceNode(f.db,part);unplaceNode(f.db,tray);unplaceNode(f.db,root);
      expect(readPhysicalNodes(f.db)).toEqual([]);
    } finally {f.close();}
  });
  it("rejects incompatible fit, capacity, overlap, missing metadata, quantity, binding, and exclusions",()=>{
    const f=fixture();try {
      const root=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const tray=placeChild(f.db,{itemUuid:f.support.uuid,parentUuid:root,zoneNo:0,startUnits:0,viewCode:"front"});
      const candidate=(startUnits:number)=>({itemUuid:f.device.uuid,parentUuid:tray,zoneNo:0,startUnits,viewCode:"front"});
      expect(checkPlacement(f.db,candidate(9))).toMatchObject({ok:false,code:"over_capacity"});
      placeChild(f.db,candidate(0));
      expect(checkPlacement(f.db,candidate(2))).toMatchObject({ok:false,code:"overlap"});
      placeChild(f.db,candidate(4));
      expect(checkPlacement(f.db,candidate(8))).toMatchObject({ok:false,code:"quantity_exhausted"});
      f.db.prepare("UPDATE prj_item_constraint SET class_code='WRONG' WHERE item_id=?").run(f.device.id);
      expect(checkPlacement(f.db,candidate(8))).toMatchObject({ok:false,code:"quantity_exhausted"});
    } finally {f.close();}
    const g=fixture();try {
      const root=placeRoot(g.db,{itemUuid:g.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const tray=placeChild(g.db,{itemUuid:g.support.uuid,parentUuid:root,zoneNo:0,startUnits:0,viewCode:"front"});
      const candidate={itemUuid:g.device.uuid,parentUuid:tray,zoneNo:0,startUnits:0,viewCode:"front"};
      g.db.prepare("UPDATE prj_item_constraint SET class_code='WRONG' WHERE item_id=?").run(g.device.id);
      expect(checkPlacement(g.db,candidate)).toMatchObject({ok:false,code:"incompatible_parent"});
      g.db.prepare("UPDATE prj_item_constraint SET class_code='TRAY-X' WHERE item_id=?").run(g.device.id);
      g.db.prepare("UPDATE prj_item_zone SET nominal_pitch_mm=NULL WHERE item_id=?").run(g.support.id);
      expect(checkPlacement(g.db,candidate)).toMatchObject({ok:false,code:"missing_position_metadata"});
      g.db.prepare("UPDATE prj_item_zone SET nominal_pitch_mm=10 WHERE item_id=?").run(g.support.id);
      g.db.prepare(`INSERT INTO prj_item_selection(item_id,sort_order,dimension_code,dimension_label,
        value_code,value_label,selection_source,binding,editable_when_placed,visible)
        VALUES (?,0,'MODE','Mode','A','A','user','match_container',0,1)`).run(g.support.id);
      expect(checkPlacement(g.db,candidate)).toMatchObject({ok:false,code:"context_unknown"});
      g.db.prepare(`INSERT INTO prj_item_selection(item_id,sort_order,dimension_code,dimension_label,
        value_code,value_label,selection_source,binding,editable_when_placed,visible)
        VALUES (?,0,'MODE','Mode','B','B','user','none',0,1)`).run(g.device.id);
      expect(checkPlacement(g.db,candidate)).toMatchObject({ok:false,code:"context_mismatch"});
      g.db.prepare("UPDATE prj_item_selection SET value_code='A' WHERE item_id=?").run(g.device.id);
      g.db.prepare(`INSERT INTO prj_item_exclusion(item_id,own_dimension_code,own_value_code,
        ancestor_dimension_code,ancestor_value_code) VALUES (?,'MODE','A','MODE','A')`).run(g.device.id);
      expect(checkPlacement(g.db,candidate)).toMatchObject({ok:false,code:"excluded_combination"});
    } finally {g.close();}
  });
  it("revalidates descendants when moving a support under a different enclosure",()=>{
    const f=fixture();try {
      // Same snapshotted model as the first root (an option-resolved variant with another fit class).
      const other=item(f.db,"enclosure","BOX-A","FRAME-Y");view(f.db,other.id,400,600);
      zone(f.db,other.id,"stack","height-unit",500,50);
      f.db.prepare(`INSERT INTO prj_item_constraint(item_id,relation,set_no,class_code)
        VALUES (?,'parent',0,'FRAME-Y')`).run(f.support.id);
      f.db.prepare(`INSERT INTO prj_item_constraint(item_id,relation,set_no,class_code)
        VALUES (?,'ancestor',1,'FRAME-X')`).run(f.device.id);
      const first=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const second=placeRoot(f.db,{itemUuid:other.uuid,rootXMm:700,rootYMm:0,viewCode:"front"});
      const tray=placeChild(f.db,{itemUuid:f.support.uuid,parentUuid:first,zoneNo:0,startUnits:0,viewCode:"front"});
      placeChild(f.db,{itemUuid:f.device.uuid,parentUuid:tray,zoneNo:0,startUnits:0,viewCode:"front"});
      expect(checkPlacement(f.db,{itemUuid:f.support.uuid,parentUuid:second,zoneNo:0,startUnits:0,
        viewCode:"front"},tray)).toMatchObject({ok:false,code:"incompatible_ancestor"});
      expect(()=>moveNode(f.db,tray,{itemUuid:f.support.uuid,parentUuid:second,zoneNo:0,
        startUnits:0,viewCode:"front"})).toThrow();
      expect(readPhysicalNodes(f.db)[0]?.children[0]?.uuid).toBe(tray);
    } finally {f.close();}
  });
  it("moves a support between roots only when they are the same snapshotted model, with its whole subtree",()=>{
    const f=fixture();try {
      const twin=item(f.db,"enclosure","BOX-A","FRAME-X");view(f.db,twin.id,400,600);
      zone(f.db,twin.id,"stack","height-unit",500,50);
      const stranger=item(f.db,"enclosure","BOX-Q","FRAME-X");view(f.db,stranger.id,400,600);
      zone(f.db,stranger.id,"stack","height-unit",500,50);
      const first=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const second=placeRoot(f.db,{itemUuid:twin.uuid,rootXMm:700,rootYMm:0,viewCode:"front"});
      const third=placeRoot(f.db,{itemUuid:stranger.uuid,rootXMm:1400,rootYMm:0,viewCode:"front"});
      const tray=placeChild(f.db,{itemUuid:f.support.uuid,parentUuid:first,zoneNo:0,startUnits:0,viewCode:"front"});
      const child=placeChild(f.db,{itemUuid:f.device.uuid,parentUuid:tray,zoneNo:0,startUnits:2,viewCode:"front"});
      const move=(parentUuid:string)=>({itemUuid:f.support.uuid,parentUuid,zoneNo:0,startUnits:100,viewCode:"front"});
      const before=readPhysicalNodes(f.db);
      // A root of another model cannot be proved compatible from the project: no target, no write, nothing changes.
      expect(checkPlacement(f.db,move(third),tray)).toMatchObject({ok:false,code:"root_context_unverified"});
      expect(placementTargets(f.db,{nodeUuid:tray,parentUuid:third})).toMatchObject({targets:[],
        diagnostics:[{code:"root_context_unverified"}]});
      expect(()=>moveNode(f.db,tray,move(third))).toThrow(/modello diverso/);
      expect(()=>movePackedNode(f.db,tray,{parentUuid:third,zoneNo:0,viewCode:"front",startUnits:100})).toThrow(/modello diverso/);
      expect(readPhysicalNodes(f.db)).toEqual(before);
      // The same model is proved from the snapshot alone; target and write use the same check.
      const offered=placementTargets(f.db,{nodeUuid:tray,parentUuid:second}).targets;
      const target=offered.find(entry=>entry.action==="moveNode"&&entry.input.startUnits===100)!;
      expect(target).toBeDefined();
      expect(checkPlacement(f.db,target.input as PlacementInput,tray)).toEqual({ok:true});
      moveNode(f.db,tray,target.input as PlacementInput);
      const roots=readPhysicalNodes(f.db);
      const moved=roots[1]!.children[0]!;
      expect(moved).toMatchObject({uuid:tray,parentUuid:roots[1]!.uuid,startUnits:100});
      expect(moved.children.map(node=>[node.uuid,node.startUnits,node.positionIssue])).toEqual([[child,2,null]]);
      expect(roots[0]!.children).toEqual([]);
      // Unplaced within its own root stays unaffected by the rule.
      expect(checkPlacement(f.db,{...move(roots[1]!.uuid),startUnits:150},tray)).toEqual({ok:true});
    } finally {f.close();}
  });
  it("uses actual slot coordinates and refuses occupied or missing slots",()=>{
    const p=project();try {
      const enclosure=item(p.db,"enclosure","SLOT-BOX","FRAME");view(p.db,enclosure.id,300,400);
      zone(p.db,enclosure.id,"slots",null,2,null);
      p.db.prepare("INSERT INTO prj_item_zone_slot(item_id,zone_no,slot_no,x_mm,y_mm) VALUES (?,0,4,15,25)")
        .run(enclosure.id);
      const device=item(p.db,"device","SLOT-DEVICE","PLUG",2);view(p.db,device.id,20,20);
      const root=placeRoot(p.db,{itemUuid:enclosure.uuid,rootXMm:3,rootYMm:5,viewCode:"front"});
      const input={itemUuid:device.uuid,parentUuid:root,zoneNo:0,slotNo:4,viewCode:"front"};
      expect(checkPlacement(p.db,{...input,slotNo:5})).toMatchObject({ok:false,code:"slot_unavailable"});
      const placed=placeChild(p.db,input);
      expect(readPhysicalNodes(p.db)[0]?.children[0]).toMatchObject({uuid:placed,xMm:18,yMm:30});
      expect(checkPlacement(p.db,input)).toMatchObject({ok:false,code:"slot_unavailable"});
    } finally {p.close();}
  });
});

describe("source-backed ordered placement snapshots",()=>{
  it("subtracts insertion offsets from stack and linear anchors",()=>{
    const f=fixture();try {
      f.db.prepare("UPDATE prj_item_view SET insert_dx_mm=2,insert_dy_mm=3 WHERE item_id=?").run(f.support.id);
      f.db.prepare("UPDATE prj_item_view SET insert_dx_mm=3,insert_dy_mm=4 WHERE item_id=?").run(f.device.id);
      const root=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:5,rootYMm:7,viewCode:"front"});
      const tray=insertPackedChild(f.db,{itemUuid:f.support.uuid,parentUuid:root,zoneNo:0,viewCode:"front"});
      insertPackedChild(f.db,{itemUuid:f.device.uuid,parentUuid:tray,zoneNo:0,viewCode:"front"});
      expect(readPhysicalNodes(f.db)[0]!.children[0]).toMatchObject({xMm:13,yMm:24});
      expect(readPhysicalNodes(f.db)[0]!.children[0]!.children[0]).toMatchObject({xMm:20,yMm:40});
    } finally {f.close();}
  });
  it("packs MDX800 343 blind 6054 then panel 6351 by rendered height",()=>{
    const p=project();try {
      const box=item(p.db,"enclosure","tq.pack.343","BOX");view(p.db,box.id,705,1295);
      zone(p.db,box.id,"stack","stack_mm",1200,50);
      p.db.prepare("UPDATE prj_item_zone SET origin_x_mm=52.5,origin_y_mm=45,breadth_mm=600,length_mm=1200 WHERE item_id=?").run(box.id);
      const blind=item(p.db,"support","tq.pan.6054","BLIND");view(p.db,blind.id,600,200);
      const panel=item(p.db,"support","tq.pan.6351","DIN");view(p.db,panel.id,600,150);
      const root=placeRoot(p.db,{itemUuid:box.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      insertPackedChild(p.db,{itemUuid:blind.uuid,parentUuid:root,zoneNo:0,viewCode:"front"});
      insertPackedChild(p.db,{itemUuid:panel.uuid,parentUuid:root,zoneNo:0,viewCode:"front"});
      expect(readPhysicalNodes(p.db)[0]!.children.map(n=>[n.xMm,n.yMm,n.startUnits]))
        .toEqual([[52.5,45,0],[52.5,245,200]]);
    } finally {p.close();}
  });
  it("packs the seven KNX 2313 devices to 324 mm and refuses another pole",()=>{
    const p=project();try {
      const box=item(p.db,"enclosure","KNX-BOX","BOX");view(p.db,box.id,400,400);
      zone(p.db,box.id,"stack","stack_mm",400,1);
      p.db.prepare("UPDATE prj_item_zone SET origin_x_mm=0,origin_y_mm=0,breadth_mm=400 WHERE item_id=?").run(box.id);
      const panel=item(p.db,"support","tq.pan.2313","KNX");view(p.db,panel.id,334,55);
      zone(p.db,panel.id,"linear","din_rail",36,9);
      p.db.prepare("UPDATE prj_item_zone SET origin_x_mm=5,origin_y_mm=5 WHERE item_id=?").run(panel.id);
      const root=placeRoot(p.db,{itemUuid:box.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const mounted=insertPackedChild(p.db,{itemUuid:panel.uuid,parentUuid:root,zoneNo:0,viewCode:"front"});
      const demands=[4,8,4,8,4,6,2];
      for(const [index,amount] of demands.entries()) {
        const device=item(p.db,"device",`KNX-${index}`,"DIN");view(p.db,device.id,amount*9,45);
        p.db.prepare("INSERT INTO prj_item_demand(item_id,capacity_kind_code,capacity_kind_label,amount,display_divisor) VALUES (?,'din_rail','moduli',?,2)")
          .run(device.id,amount);
        insertPackedChild(p.db,{itemUuid:device.uuid,parentUuid:mounted,zoneNo:0,viewCode:"front"});
      }
      const nodes=readPhysicalNodes(p.db)[0]!.children[0]!.children;
      expect(nodes.map(n=>n.xMm!-5)).toEqual([0,36,108,144,216,252,306]);
      expect(nodes.reduce((sum,n)=>sum+demands[n.sortOrder]!*9,0)).toBe(324);
      const extra=item(p.db,"device","KNX-extra","DIN");view(p.db,extra.id,18,45);
      p.db.prepare("INSERT INTO prj_item_demand(item_id,capacity_kind_code,capacity_kind_label,amount,display_divisor) VALUES (?,'din_rail','moduli',2,2)")
        .run(extra.id);
      expect(()=>insertPackedChild(p.db,{itemUuid:extra.uuid,parentUuid:mounted,zoneNo:0,viewCode:"front"}))
        .toThrow();
      expect(readPhysicalNodes(p.db)[0]!.children[0]!.children).toHaveLength(7);
    } finally {p.close();}
  });
  it("subtracts insertion offsets for HDX 22 panel 10902 slots",()=>{
    const p=project();try {
      const box=item(p.db,"enclosure","tq.pack.22","HDX");view(p.db,box.id,975,2232);
      zone(p.db,box.id,"stack","stack_mm",2000,50);
      p.db.prepare("UPDATE prj_item_zone SET origin_x_mm=62.5,origin_y_mm=66,breadth_mm=600 WHERE item_id=?").run(box.id);
      const panel=item(p.db,"support","tq.pack.10902","PANEL");view(p.db,panel.id,600,400);
      zone(p.db,panel.id,"slots",null,3,null);
      for(const [slot,x] of [[1,100],[2,250],[3,400]])
        p.db.prepare("INSERT INTO prj_item_zone_slot(item_id,zone_no,slot_no,x_mm,y_mm) VALUES (?,0,?,?,150)")
          .run(panel.id,slot,x);
      const first=item(p.db,"device","tq.app.22704","MCCB");view(p.db,first.id,140,165);
      p.db.prepare("UPDATE prj_item_view SET insert_dx_mm=40,insert_dy_mm=40 WHERE item_id=?").run(first.id);
      const second=item(p.db,"device","tq.app.22701","MCCB");view(p.db,second.id,105,165);
      p.db.prepare("UPDATE prj_item_view SET insert_dx_mm=0,insert_dy_mm=40 WHERE item_id=?").run(second.id);
      const root=placeRoot(p.db,{itemUuid:box.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const mounted=insertPackedChild(p.db,{itemUuid:panel.uuid,parentUuid:root,zoneNo:0,viewCode:"front"});
      insertPackedChild(p.db,{itemUuid:first.uuid,parentUuid:mounted,zoneNo:0,viewCode:"front"});
      insertPackedChild(p.db,{itemUuid:second.uuid,parentUuid:mounted,zoneNo:0,viewCode:"front"});
      expect(readPhysicalNodes(p.db)[0]!.children[0]!.children.map(n=>[n.xMm,n.yMm,n.slotNo]))
        .toEqual([[122.5,176,1],[312.5,176,2]]);
    } finally {p.close();}
  });
  it("uses 1 mm internal rail pitch and repacks insert, reorder, and remove within one zone",()=>{
    const p=project();try {
      const box=item(p.db,"enclosure","BOX","FRAME");view(p.db,box.id,700,500);
      zone(p.db,box.id,"stack","stack_mm",500,1);
      p.db.prepare("UPDATE prj_item_zone SET origin_x_mm=0,origin_y_mm=0,breadth_mm=700 WHERE item_id=?").run(box.id);
      const panel=item(p.db,"support","tq.pan.6071","RAIL");view(p.db,panel.id,600,200);
      zone(p.db,panel.id,"linear","internal_rail_mm",500,1);
      p.db.prepare("UPDATE prj_item_zone SET origin_x_mm=50,origin_y_mm=30 WHERE item_id=?").run(panel.id);
      const a=item(p.db,"device","tq.app.444","RAIL");view(p.db,a.id,70,90);
      const b=item(p.db,"device","tq.app.445","RAIL");view(p.db,b.id,85,121);
      const c=item(p.db,"device","third","RAIL");view(p.db,c.id,20,20);
      for(const [part,amount] of [[a,70],[b,85],[c,20]] as const)
        p.db.prepare("INSERT INTO prj_item_demand(item_id,capacity_kind_code,capacity_kind_label,amount,display_divisor) VALUES (?,'internal_rail_mm','mm',?,1)")
          .run(part.id,amount);
      const root=placeRoot(p.db,{itemUuid:box.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const mounted=insertPackedChild(p.db,{itemUuid:panel.uuid,parentUuid:root,zoneNo:0,viewCode:"front"});
      const ia=insertPackedChild(p.db,{itemUuid:a.uuid,parentUuid:mounted,zoneNo:0,viewCode:"front"});
      const ib=insertPackedChild(p.db,{itemUuid:b.uuid,parentUuid:mounted,zoneNo:0,viewCode:"front"});
      const positions=()=>readPhysicalNodes(p.db)[0]!.children[0]!.children.map(n=>n.xMm!-50);
      expect(positions()).toEqual([0,70]);
      const ic=insertPackedChild(p.db,{itemUuid:c.uuid,parentUuid:mounted,zoneNo:0,viewCode:"front"},1);
      expect(positions()).toEqual([0,70,90]);
      reorderPackedNode(p.db,ib,0);
      expect(positions()).toEqual([0,85,155]);
      removePackedNode(p.db,ic);
      expect(positions()).toEqual([0,85]);
      expect(readPhysicalNodes(p.db)[0]!.children[0]!.children.map(n=>n.uuid)).toEqual([ib,ia]);
      const before=readPhysicalNodes(p.db);
      p.db.close();const reopened=openCurrentProjectDatabase(p.filename,migration);
      try {expect(readPhysicalNodes(reopened)).toEqual(before);} finally {reopened.close();}
    } finally {if(p.db.open)p.close();else rmSync(path.dirname(p.filename),{recursive:true,force:true});}
  });
});

describe("generic placement targets and packed movement",()=>{
  it("enumerates pitched stack rectangles, permits gaps, excludes overlap, and reopens offline",()=>{
    const f=fixture();try {
      f.db.prepare("UPDATE prj_line SET quantity=2 WHERE item_id=?").run(f.support.id);
      const root=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const initial=placementTargets(f.db,{itemUuid:f.support.uuid,parentUuid:root});
      expect(initial.targets.map(target=>target.action==="placeChild"?target.input.startUnits:null))
        .toEqual([0,50,100,150,200,250,300,350,400]);
      expect(initial.targets[4]).toMatchObject({action:"placeChild",
        subject:{xMm:10,yMm:220,widthMm:200,heightMm:100}});
      const panel=placeChild(f.db,{itemUuid:f.support.uuid,parentUuid:root,zoneNo:0,
        startUnits:200,viewCode:"front"});
      const remaining=placementTargets(f.db,{itemUuid:f.support.uuid,parentUuid:root});
      expect(remaining.targets.map(target=>target.action==="placeChild"?target.input.startUnits:null))
        .toEqual([0,50,100,300,350,400]);
      expect(remaining.diagnostics).toContainEqual(expect.objectContaining({code:"overlap"}));
      const moved=placementTargets(f.db,{nodeUuid:panel,parentUuid:root});
      expect(moved.targets.some(target=>target.action==="moveNode"&&target.input.startUnits===200)).toBe(true);
      const before=readPhysicalNodes(f.db);
      f.db.close();const reopened=openCurrentProjectDatabase(f.filename,migration);
      try {
        expect(readPhysicalNodes(reopened)).toEqual(before);
        expect(readPhysicalNodes(reopened)[0]!.children[0]).toMatchObject({startUnits:200,xMm:10,yMm:220});
        expect(placementTargets(reopened,{nodeUuid:panel,parentUuid:root}).targets.length).toBeGreaterThan(0);
      }finally{reopened.close();}
    }finally{if(f.db.open)f.db.close();rmSync(path.dirname(f.filename),{recursive:true,force:true});}
  });

  it("reports too-wide, capacity, and missing stack metadata without targets",()=>{
    const f=fixture();try {
      const root=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const wide=item(f.db,"support","WIDE","TRAY-X");view(f.db,wide.id,350,100);
      const tall=item(f.db,"support","TALL","TRAY-X");view(f.db,tall.id,200,600);
      for(const candidate of [wide,tall])f.db.prepare(`INSERT INTO prj_item_constraint
        (item_id,relation,set_no,class_code) VALUES (?,'parent',0,'FRAME-X')`).run(candidate.id);
      expect(placementTargets(f.db,{itemUuid:wide.uuid,parentUuid:root})).toMatchObject({targets:[],
        diagnostics:[{code:"too_wide"}]});
      expect(placementTargets(f.db,{itemUuid:tall.uuid,parentUuid:root})).toMatchObject({targets:[],
        diagnostics:[{code:"over_capacity"}]});
      f.db.prepare("UPDATE prj_item_zone SET pitch_mm=NULL WHERE item_id=?").run(f.enclosure.id);
      expect(placementTargets(f.db,{itemUuid:f.support.uuid,parentUuid:root})).toMatchObject({targets:[],
        diagnostics:[{code:"missing_position_metadata"}]});
    }finally{f.close();}
  });

  it("preserves explicit stack gaps when moving a child to another stack parent",()=>{
    const f=fixture();try {
      f.db.prepare("UPDATE prj_line SET quantity=2 WHERE item_id=?").run(f.enclosure.id);
      f.db.prepare("UPDATE prj_line SET quantity=2 WHERE item_id=?").run(f.support.id);
      const firstRoot=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const secondRoot=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:600,rootYMm:0,viewCode:"front"});
      const remaining=placeChild(f.db,{itemUuid:f.support.uuid,parentUuid:firstRoot,zoneNo:0,
        startUnits:200,viewCode:"front"});
      const moved=placeChild(f.db,{itemUuid:f.support.uuid,parentUuid:firstRoot,zoneNo:0,
        startUnits:0,viewCode:"front"});
      movePackedNode(f.db,moved,{parentUuid:secondRoot,zoneNo:0,viewCode:"front",startUnits:100});
      const roots=readPhysicalNodes(f.db);
      expect(roots[0]!.children.find(node=>node.uuid===remaining)).toMatchObject({startUnits:200,yMm:220});
      expect(roots[1]!.children.find(node=>node.uuid===moved)).toMatchObject({startUnits:100,yMm:120});
      expect(()=>movePackedNode(f.db,moved,{parentUuid:secondRoot,zoneNo:0,viewCode:"front",index:0}))
        .toThrow();
    }finally{f.close();}
  });

  it("rejects a support move when its device descendants are incompatible with the new root",()=>{
    const f=fixture();try {
      const other=item(f.db,"enclosure","BOX-A","FRAME-B");view(f.db,other.id,400,600);
      zone(f.db,other.id,"stack","height-unit",500,50);
      f.db.prepare(`INSERT INTO prj_item_constraint(item_id,relation,set_no,class_code)
        VALUES (?,'parent',0,'FRAME-B')`).run(f.support.id);
      f.db.prepare(`INSERT INTO prj_item_constraint(item_id,relation,set_no,class_code)
        VALUES (?,'ancestor',0,'FRAME-X')`).run(f.device.id);
      const rootA=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const rootB=placeRoot(f.db,{itemUuid:other.uuid,rootXMm:700,rootYMm:0,viewCode:"front"});
      const panel=placeChild(f.db,{itemUuid:f.support.uuid,parentUuid:rootA,zoneNo:0,
        startUnits:0,viewCode:"front"});
      const child=insertPackedChild(f.db,{itemUuid:f.device.uuid,parentUuid:panel,zoneNo:0,viewCode:"front"});
      const before=readPhysicalNodes(f.db);
      expect(placementTargets(f.db,{nodeUuid:panel,parentUuid:rootA}).targets)
        .toContainEqual(expect.objectContaining({action:"moveNode",
          input:expect.objectContaining({startUnits:100}),
          affected:[{nodeUuid:child,rect:{xMm:20,yMm:140,widthMm:20,heightMm:40}}]}));
      expect(placementTargets(f.db,{nodeUuid:panel,parentUuid:rootB})).toMatchObject({targets:[],
        diagnostics:[{code:"incompatible_ancestor"}]});
      expect(()=>movePackedNode(f.db,panel,{parentUuid:rootB,zoneNo:0,viewCode:"front",index:0}))
        .toThrow();
      expect(readPhysicalNodes(f.db)).toEqual(before);
    }finally{f.close();}
  });

  it("enumerates every free linear start without moving existing siblings",()=>{
    const f=fixture();try {
      const root=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const panel=insertPackedChild(f.db,{itemUuid:f.support.uuid,parentUuid:root,zoneNo:0,viewCode:"front"});
      const input={itemUuid:f.device.uuid,parentUuid:panel,zoneNo:0,viewCode:"front"};
      const first=insertPackedChild(f.db,input);
      const targets=placementTargets(f.db,{itemUuid:f.device.uuid,parentUuid:panel});
      expect(targets.targets.map(target=>target.action==="placeChild"?target.input.startUnits:null))
        .toEqual([4,5,6,7,8]);
      expect(targets.targets[0]).toMatchObject({action:"placeChild",
        subject:{xMm:60,yMm:40,widthMm:20,heightMm:40},affected:[]});
      expect(readPhysicalNodes(f.db)[0]!.children[0]!.children[0]).toMatchObject({uuid:first,startUnits:0});
    }finally{f.close();}
  });

  it("offers each free slot without shifting occupied slots",()=>{
    const p=project();try {
      const box=item(p.db,"enclosure","SLOT-BOX","FRAME");view(p.db,box.id,300,400);
      zone(p.db,box.id,"slots",null,2,null);
      for(const [slot,x,y] of [[1,10,20],[3,70,30]])p.db.prepare(`INSERT INTO prj_item_zone_slot
        (item_id,zone_no,slot_no,x_mm,y_mm) VALUES (?,0,?,?,?)`).run(box.id,slot,x,y);
      const device=item(p.db,"device","SLOT-DEVICE","PLUG",2);view(p.db,device.id,20,20);
      p.db.prepare("UPDATE prj_item_view SET insert_dx_mm=2,insert_dy_mm=4 WHERE item_id=?").run(device.id);
      const root=placeRoot(p.db,{itemUuid:box.uuid,rootXMm:7,rootYMm:9,viewCode:"front"});
      const first=insertPackedChild(p.db,{itemUuid:device.uuid,parentUuid:root,zoneNo:0,viewCode:"front"});
      const targets=placementTargets(p.db,{itemUuid:device.uuid,parentUuid:root});
      expect(targets.targets.map(target=>target.action==="placeChild"?target.input.slotNo:null)).toEqual([3]);
      expect(targets.targets[0]).toMatchObject({action:"placeChild",
        subject:{xMm:75,yMm:35,widthMm:20,heightMm:20},affected:[]});
      const second=insertPackedChild(p.db,{itemUuid:device.uuid,parentUuid:root,zoneNo:0,viewCode:"front"});
      const moves=placementTargets(p.db,{nodeUuid:second,parentUuid:root});
      expect(moves.targets[0]).toMatchObject({action:"moveNode",input:{slotNo:3},
        subject:{xMm:75,yMm:35,widthMm:20,heightMm:20},affected:[]});
      expect(moves.targets).toHaveLength(1);
      movePackedNode(p.db,second,{parentUuid:root,zoneNo:0,viewCode:"front",index:0});
      expect(readPhysicalNodes(p.db)[0]!.children.map(node=>[node.uuid,node.slotNo,node.xMm,node.yMm]))
        .toEqual([[second,1,15,25],[first,3,75,35]]);
    }finally{p.close();}
  });

  it("leaves a linear source gap when moving to an explicit stack target",()=>{
    const f=fixture();try {
      const panelZone=f.db.prepare(`INSERT INTO prj_item_zone(item_id,zone_no,layout,origin_x_mm,
        origin_y_mm,length_mm,breadth_mm,pitch_mm,required_view_code)
        VALUES (?,1,'stack',100,0,100,100,20,'front')`);
      panelZone.run(f.support.id);
      const root=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const panel=insertPackedChild(f.db,{itemUuid:f.support.uuid,parentUuid:root,zoneNo:0,viewCode:"front"});
      const first=insertPackedChild(f.db,{itemUuid:f.device.uuid,parentUuid:panel,zoneNo:0,viewCode:"front"});
      const second=insertPackedChild(f.db,{itemUuid:f.device.uuid,parentUuid:panel,zoneNo:0,viewCode:"front"});
      const targets=placementTargets(f.db,{nodeUuid:first,parentUuid:panel}).targets.filter(target=>
        target.action==="moveNode"&&target.input.zoneNo===1);
      expect(targets.map(target=>target.action==="moveNode"?target.input.startUnits:null))
        .toEqual([0,20,40,60]);
      expect(targets[2]).toMatchObject({subject:{xMm:110,yMm:60,widthMm:20,heightMm:40},
        affected:[]});
      moveNode(f.db,first,{itemUuid:f.device.uuid,parentUuid:panel,zoneNo:1,
        viewCode:"front",startUnits:40});
      const children=readPhysicalNodes(f.db)[0]!.children[0]!.children;
      expect(children.find(node=>node.uuid===first)).toMatchObject({zoneNo:1,startUnits:40,xMm:110,yMm:60});
      expect(children.find(node=>node.uuid===second)).toMatchObject({zoneNo:0,startUnits:4,xMm:60,yMm:40});
    }finally{f.close();}
  });

  it("moves packed nodes within, between zones, and between parents without changing Q/P",()=>{
    const f=fixture();try {
      f.db.prepare("UPDATE prj_line SET quantity=3 WHERE item_id=?").run(f.device.id);
      f.db.prepare("UPDATE prj_line SET quantity=2 WHERE item_id=?").run(f.support.id);
      f.db.prepare(`INSERT INTO prj_item_zone(item_id,zone_no,layout,capacity_kind_code,
        capacity_kind_label,display_divisor,nominal_pitch_mm,capacity_amount,origin_x_mm,origin_y_mm,
        length_mm,breadth_mm,direction,pitch_mm,required_view_code)
        SELECT item_id,1,layout,capacity_kind_code,capacity_kind_label,display_divisor,nominal_pitch_mm,
          capacity_amount,origin_x_mm,80,length_mm,breadth_mm,direction,pitch_mm,required_view_code
        FROM prj_item_zone WHERE item_id=? AND zone_no=0`).run(f.support.id);
      const root=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const panelA=insertPackedChild(f.db,{itemUuid:f.support.uuid,parentUuid:root,zoneNo:0,viewCode:"front"});
      const panelB=insertPackedChild(f.db,{itemUuid:f.support.uuid,parentUuid:root,zoneNo:0,viewCode:"front"});
      const a=insertPackedChild(f.db,{itemUuid:f.device.uuid,parentUuid:panelA,zoneNo:0,viewCode:"front"});
      const b=insertPackedChild(f.db,{itemUuid:f.device.uuid,parentUuid:panelA,zoneNo:0,viewCode:"front"});
      const c=insertPackedChild(f.db,{itemUuid:f.device.uuid,parentUuid:panelB,zoneNo:0,viewCode:"front"});
      const count=()=>f.db.prepare("SELECT COUNT(*) FROM prj_node WHERE item_id=?").pluck().get(f.device.id);
      movePackedNode(f.db,b,{parentUuid:panelA,zoneNo:0,viewCode:"front",index:0});
      expect(readPhysicalNodes(f.db)[0]!.children[0]!.children.map(node=>[node.uuid,node.startUnits]))
        .toEqual([[b,0],[a,4]]);
      const moveTargets=placementTargets(f.db,{nodeUuid:b,parentUuid:panelB});
      expect(moveTargets.targets[0]).toMatchObject({action:"moveNode",nodeUuid:b,
        input:{parentUuid:panelB,zoneNo:0,startUnits:4},subject:{xMm:60,yMm:140,widthMm:20,heightMm:40},
        affected:[]});
      movePackedNode(f.db,b,{parentUuid:panelB,zoneNo:0,viewCode:"front",index:0});
      expect(readPhysicalNodes(f.db)[0]!.children[0]!.children.map(node=>[node.uuid,node.startUnits]))
        .toEqual([[a,0]]);
      expect(readPhysicalNodes(f.db)[0]!.children[1]!.children.map(node=>[node.uuid,node.startUnits]))
        .toEqual([[b,0],[c,4]]);
      movePackedNode(f.db,b,{parentUuid:panelB,zoneNo:1,viewCode:"front",index:0});
      const after=readPhysicalNodes(f.db);
      expect(after[0]!.children[1]!.children.sort((left,right)=>left.zoneNo!-right.zoneNo!)
        .map(node=>[node.uuid,node.zoneNo,node.startUnits]))
        .toEqual([[c,0,0],[b,1,0]]);
      expect(count()).toBe(3);
      expect(f.db.prepare("SELECT quantity FROM prj_line WHERE item_id=?").pluck().get(f.device.id)).toBe(3);
    }finally{f.close();}
  });

  it("rejects an invalid packed move atomically, preserving all rows and positions",()=>{
    const f=fixture();try {
      f.db.prepare("UPDATE prj_line SET quantity=4 WHERE item_id=?").run(f.device.id);
      f.db.prepare("UPDATE prj_line SET quantity=2 WHERE item_id=?").run(f.support.id);
      const root=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const panelA=insertPackedChild(f.db,{itemUuid:f.support.uuid,parentUuid:root,zoneNo:0,viewCode:"front"});
      const panelB=insertPackedChild(f.db,{itemUuid:f.support.uuid,parentUuid:root,zoneNo:0,viewCode:"front"});
      const subject=insertPackedChild(f.db,{itemUuid:f.device.uuid,parentUuid:panelA,zoneNo:0,viewCode:"front"});
      for(let index=0;index<3;index++)insertPackedChild(f.db,{itemUuid:f.device.uuid,parentUuid:panelB,
        zoneNo:0,viewCode:"front"});
      const before=readPhysicalNodes(f.db);
      const rows=f.db.prepare("SELECT * FROM prj_node ORDER BY id").all();
      expect(placementTargets(f.db,{nodeUuid:subject,parentUuid:panelB})).toMatchObject({targets:[],
        diagnostics:[{code:"overlap"}]});
      expect(()=>movePackedNode(f.db,subject,{parentUuid:panelB,zoneNo:0,viewCode:"front",index:1}))
        .toThrow();
      expect(readPhysicalNodes(f.db)).toEqual(before);
      expect(f.db.prepare("SELECT * FROM prj_node ORDER BY id").all()).toEqual(rows);
    }finally{f.close();}
  });
});

describe("free device positioning",()=>{
  it("matches every validator-approved start on an empty rail and respects full demand",()=>{
    const f=fixture();try {
      const root=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const panel=placeChild(f.db,{itemUuid:f.support.uuid,parentUuid:root,zoneNo:0,
        startUnits:0,viewCode:"front"});
      const targets=placementTargets(f.db,{itemUuid:f.device.uuid,parentUuid:panel});
      const offered=targets.targets.map(target=>target.action==="placeChild"?target.input.startUnits:null);
      const accepted=Array.from({length:15},(_,startUnits)=>startUnits).filter(startUnits=>
        checkPlacement(f.db,{itemUuid:f.device.uuid,parentUuid:panel,zoneNo:0,
          startUnits,viewCode:"front"}).ok);
      expect(offered).toEqual([0,1,2,3,4,5,6,7,8]);
      expect(offered).toEqual(accepted);
      expect(targets.targets.every(target=>target.action==="placeChild"&&target.affected.length===0)).toBe(true);
    }finally{f.close();}
  });

  it("places into gaps, moves within and between panels, and reopens gaps offline",()=>{
    const f=fixture();try {
      f.db.prepare("UPDATE prj_line SET quantity=3 WHERE item_id=?").run(f.device.id);
      f.db.prepare("UPDATE prj_line SET quantity=2 WHERE item_id=?").run(f.support.id);
      const root=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const panelA=placeChild(f.db,{itemUuid:f.support.uuid,parentUuid:root,zoneNo:0,
        startUnits:0,viewCode:"front"});
      const panelB=placeChild(f.db,{itemUuid:f.support.uuid,parentUuid:root,zoneNo:0,
        startUnits:200,viewCode:"front"});
      const at0=placeChild(f.db,{itemUuid:f.device.uuid,parentUuid:panelA,zoneNo:0,
        startUnits:0,viewCode:"front"});
      const at8=placeChild(f.db,{itemUuid:f.device.uuid,parentUuid:panelA,zoneNo:0,
        startUnits:8,viewCode:"front"});
      const free=placementTargets(f.db,{itemUuid:f.device.uuid,parentUuid:panelA});
      expect(free.targets.map(target=>target.action==="placeChild"?target.input.startUnits:null)).toEqual([4]);
      const gap=free.targets[0]!;
      if(gap.action!=="placeChild")throw new Error("Expected an explicit placement");
      const at4=placeChild(f.db,gap.input);
      const before=f.db.prepare("SELECT uuid,start_units AS startUnits FROM prj_node WHERE uuid IN (?,?) ORDER BY uuid")
        .all(at0,at8);
      const unchanged=f.db.prepare("SELECT * FROM prj_node ORDER BY id").all();
      expect(()=>moveNode(f.db,at8,{...gap.input,startUnits:3})).toThrow();
      expect(f.db.prepare("SELECT * FROM prj_node ORDER BY id").all()).toEqual(unchanged);
      moveNode(f.db,at4,{...gap.input,parentUuid:panelB,startUnits:5});
      expect(f.db.prepare("SELECT uuid,start_units AS startUnits FROM prj_node WHERE uuid IN (?,?) ORDER BY uuid")
        .all(at0,at8)).toEqual(before);
      expect(placementTargets(f.db,{nodeUuid:at8,parentUuid:panelA}).targets.some(target=>
        target.action==="moveNode"&&target.input.startUnits===4)).toBe(true);
      moveNode(f.db,at8,{...gap.input,startUnits:4});
      expect(readPhysicalNodes(f.db)[0]!.children[0]!.children.map(node=>[node.uuid,node.startUnits]))
        .toEqual([[at0,0],[at8,4]]);
      f.db.close();
      const reopened=openCurrentProjectDatabase(f.filename,migration);
      try {
        const moves=placementTargets(reopened,{nodeUuid:at8,parentUuid:panelA});
        const to8=moves.targets.find(target=>target.action==="moveNode"&&target.input.startUnits===8);
        expect(to8).toBeDefined();
        if(to8?.action!=="moveNode")throw new Error("Expected an offline move");
        moveNode(reopened,at8,to8.input);
        expect(readPhysicalNodes(reopened)[0]!.children[0]!.children.map(node=>[node.uuid,node.startUnits]))
          .toEqual([[at0,0],[at8,8]]);
        unplaceNode(reopened,at8);
        expect(readPhysicalNodes(reopened)[0]!.children[0]!.children)
          .toMatchObject([{uuid:at0,startUnits:0}]);
        expect(placementTargets(reopened,{itemUuid:f.device.uuid,parentUuid:panelA}).targets.some(target=>
          target.action==="placeChild"&&target.input.startUnits===8)).toBe(true);
      }finally{reopened.close();}
    }finally{if(f.db.open)f.db.close();rmSync(path.dirname(f.filename),{recursive:true,force:true});}
  });

  it("offers all free slots and rejects stale or incompatible writes without mutation",()=>{
    const p=project();try {
      const box=item(p.db,"enclosure","SLOT-BOX","FRAME");view(p.db,box.id,300,400);
      zone(p.db,box.id,"slots",null,3,null);
      for(const slotNo of [1,3,7])p.db.prepare(`INSERT INTO prj_item_zone_slot
        (item_id,zone_no,slot_no,x_mm,y_mm) VALUES (?,0,?,?,0)`).run(box.id,slotNo,slotNo*10);
      const device=item(p.db,"device","SLOT-DEVICE","PLUG",3);view(p.db,device.id,20,20);
      const bad=item(p.db,"device","BAD","PLUG");view(p.db,bad.id,20,20);
      p.db.prepare("INSERT INTO prj_item_constraint(item_id,relation,set_no,class_code) VALUES (?,'parent',0,'OTHER')")
        .run(bad.id);
      const root=placeRoot(p.db,{itemUuid:box.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const offered=placementTargets(p.db,{itemUuid:device.uuid,parentUuid:root});
      expect(offered.targets.map(target=>target.action==="placeChild"?target.input.slotNo:null)).toEqual([1,3,7]);
      placeChild(p.db,{itemUuid:device.uuid,parentUuid:root,zoneNo:0,slotNo:3,viewCode:"front"});
      expect(placementTargets(p.db,{itemUuid:device.uuid,parentUuid:root}).targets.map(target=>
        target.action==="placeChild"?target.input.slotNo:null)).toEqual([1,7]);
      const rows=p.db.prepare("SELECT * FROM prj_node ORDER BY id").all();
      const stale=offered.targets[1]!;
      if(stale.action!=="placeChild")throw new Error("Expected an explicit placement");
      expect(()=>placeChild(p.db,stale.input)).toThrow();
      expect(()=>placeChild(p.db,{itemUuid:bad.uuid,parentUuid:root,zoneNo:0,
        slotNo:1,viewCode:"front"})).toThrow();
      expect(p.db.prepare("SELECT * FROM prj_node ORDER BY id").all()).toEqual(rows);
    }finally{p.close();}
  });

  it("sorts packed operations by physical position after explicit gaps",()=>{
    const f=fixture();try {
      f.db.prepare("UPDATE prj_line SET quantity=3 WHERE item_id=?").run(f.device.id);
      f.db.prepare("UPDATE prj_item_zone SET capacity_amount=16 WHERE item_id=?").run(f.support.id);
      const root=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const panel=placeChild(f.db,{itemUuid:f.support.uuid,parentUuid:root,zoneNo:0,
        startUnits:0,viewCode:"front"});
      const late=placeChild(f.db,{itemUuid:f.device.uuid,parentUuid:panel,zoneNo:0,
        startUnits:8,viewCode:"front"});
      const early=placeChild(f.db,{itemUuid:f.device.uuid,parentUuid:panel,zoneNo:0,
        startUnits:0,viewCode:"front"});
      const middle=insertPackedChild(f.db,{itemUuid:f.device.uuid,parentUuid:panel,
        zoneNo:0,viewCode:"front"},1);
      expect(readPhysicalNodes(f.db)[0]!.children[0]!.children.map(node=>[node.uuid,node.startUnits]))
        .toEqual([[early,0],[middle,4],[late,8]]);
    }finally{f.close();}
  });

  it("keeps dense rail target enumeration under the target limit",()=>{
    const f=fixture();try {
      f.db.prepare("UPDATE prj_item_zone SET capacity_amount=1200 WHERE item_id=?").run(f.support.id);
      const root=placeRoot(f.db,{itemUuid:f.enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const panel=placeChild(f.db,{itemUuid:f.support.uuid,parentUuid:root,zoneNo:0,
        startUnits:0,viewCode:"front"});
      const targets=placementTargets(f.db,{itemUuid:f.device.uuid,parentUuid:panel});
      expect(targets.targets).toHaveLength(1197);
      expect(targets.diagnostics.some(entry=>entry.code==="target_limit")).toBe(false);
    }finally{f.close();}
  });
});

describe.runIf(existsSync(cataloguePath))("real imported physical profiles",()=>{
  it("enumerates MDX800 / panel 851 / configured BTDIN60 rail targets",()=>{
    const catalogue=new Database(cataloguePath,{readonly:true}),p=project();
    try {
      const add=(code:string,selectedOptionIds:number[]=[],productId?:number)=>{
        const modelId=catalogue.prepare("SELECT id FROM cat_config_model WHERE code=?").pluck().get(code) as number;
        const resolved=resolveConfiguration(catalogue,{modelId,selectedOptionIds,...(productId?{productId}:{})});
        expect(resolved.status).toBe("complete");
        return insertConfiguredItem(p.db,resolved,id=>getCatalogueProductSnapshot(catalogue,id),
          "2026-09-28T00:00:00.000Z");
      };
      const enclosure=add("tq.pack.343");
      const support=add("tq.pack.851");
      const modelId=catalogue.prepare("SELECT id FROM cat_config_model WHERE code='tq.pack.4395'").pluck().get() as number;
      const productId=catalogue.prepare(`SELECT p.id FROM cat_product p JOIN cat_config_model_entry e
        ON e.product_id=p.id WHERE e.model_id=? AND p.manufacturer_code='FN82C16'`).pluck().get(modelId) as number;
      const ruleId=catalogue.prepare(`SELECT r.id FROM cat_config_rule r JOIN cat_config_rule_effect e
        ON e.rule_id=r.id WHERE r.model_id=? AND e.ref_manufacturer_code='F80RC' LIMIT 1`).pluck().get(modelId) as number;
      const options=catalogue.prepare("SELECT option_id FROM cat_config_rule_condition WHERE rule_id=?")
        .pluck().all(ruleId) as number[];
      const device=add("tq.pack.4395",options,productId);
      const root=placeRoot(p.db,{itemUuid:enclosure,rootXMm:0,rootYMm:0,viewCode:"front"});
      const panel=placeChild(p.db,{itemUuid:support,parentUuid:root,zoneNo:0,
        startUnits:0,viewCode:"front"});
      const targets=placementTargets(p.db,{itemUuid:device,parentUuid:panel});
      expect(targets.targets.length).toBeGreaterThan(1);
      expect(targets.targets.every(target=>target.action==="placeChild")).toBe(true);
    }finally{p.close();catalogue.close();}
  });
  it("places three actually configured MDX800, panel, and BTDIN60 items offline",()=>{
    const catalogue=new Database(cataloguePath,{readonly:true}),p=project();
    try {
      for(const code of ["tq.pack.343","tq.pack.851","tq.pack.4395"]) {
        const modelId=catalogue.prepare("SELECT id FROM cat_config_model WHERE code=?").pluck().get(code) as number;
        const result=resolveConfiguration(catalogue,{modelId,selectedOptionIds:[]});
        expect(result.status).toBe("complete");
        insertConfiguredItem(p.db,result,id=>getCatalogueProductSnapshot(catalogue,id),
          "2026-09-24T00:00:00.000Z");
      }
      catalogue.close();
      const uuids=p.db.prepare("SELECT model_code AS code,uuid FROM prj_item")
        .all() as {code:string;uuid:string}[];
      const byCode=new Map(uuids.map(row=>[row.code,row.uuid]));
      const root=placeRoot(p.db,{itemUuid:byCode.get("tq.pack.343")!,rootXMm:0,rootYMm:0,viewCode:"front"});
      const panel=placeChild(p.db,{itemUuid:byCode.get("tq.pack.851")!,parentUuid:root,
        zoneNo:0,startUnits:0,viewCode:"front"});
      const configured=readConfiguredItems(p.db);
      const panelItem=configured.find(item=>item.uuid===byCode.get("tq.pack.851"))!;
      const deviceItem=configured.find(item=>item.uuid===byCode.get("tq.pack.4395"))!;
      const linearZone=panelItem.zones.find(zone=>zone.layout==="linear")!;
      expect(linearZone.displayDivisor).toBeGreaterThan(1);
      const input=placementInputForSelection({itemUuid:deviceItem.uuid,modelKind:deviceItem.modelKind,
        viewCode:"front",parentUuid:panel,zone:linearZone,position:1})!;
      expect(input.startUnits).toBe(linearZone.displayDivisor);
      expect(input.startUnits).toBeGreaterThan(0);
      expect(checkPlacement(p.db,input)).toEqual({ok:true});
      const device=placeChild(p.db,input);
      expect(readPhysicalNodes(p.db)[0]?.children[0]?.children[0]).toMatchObject({uuid:device,startUnits:input.startUnits});
    } finally {if(catalogue.open)catalogue.close();p.close();}
  });
  it("places the MDX800 enclosure, compatible DIN panel, and BTDIN60 device from imported snapshots",()=>{
    const catalogue=new Database(cataloguePath,{readonly:true}),p=project();try {
      const enclosure=snapshotProfile(p.db,catalogue,"tq.armadi.pack.343.block.1751");
      const support=snapshotProfile(p.db,catalogue,"tq.pan.6311");
      const device=snapshotProfile(p.db,catalogue,"tq.app.16400");
      const root=placeRoot(p.db,{itemUuid:enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const panel=placeChild(p.db,{itemUuid:support.uuid,parentUuid:root,zoneNo:0,startUnits:0,viewCode:"front"});
      const mounted=placeChild(p.db,{itemUuid:device.uuid,parentUuid:panel,zoneNo:0,startUnits:0,viewCode:"front"});
      expect(readPhysicalNodes(p.db)[0]?.children[0]?.children[0]?.uuid).toBe(mounted);
    } finally {p.close();catalogue.close();}
  });
  it("places another imported enclosure, panel variant, and device combination",()=>{
    const catalogue=new Database(cataloguePath,{readonly:true}),p=project();try {
      const enclosure=snapshotProfile(p.db,catalogue,"tq.armadi.pack.189.block.911");
      const support=snapshotProfile(p.db,catalogue,"tq.pan.6291");
      const device=snapshotProfile(p.db,catalogue,"tq.app.10");
      const root=placeRoot(p.db,{itemUuid:enclosure.uuid,rootXMm:0,rootYMm:0,viewCode:"front"});
      const panel=placeChild(p.db,{itemUuid:support.uuid,parentUuid:root,zoneNo:0,startUnits:0,viewCode:"front"});
      expect(checkPlacement(p.db,{itemUuid:device.uuid,parentUuid:panel,zoneNo:0,startUnits:0,
        viewCode:"front"})).toEqual({ok:true});
      placeChild(p.db,{itemUuid:device.uuid,parentUuid:panel,zoneNo:0,startUnits:0,viewCode:"front"});
    } finally {p.close();catalogue.close();}
  });
  it("loads enclosure, support, and device profile families with portable zone metadata",()=>{
    const db=new Database(cataloguePath,{readonly:true});try {
      const rows=db.prepare(`SELECT p.id,p.profile_kind AS kind FROM cat_phys_profile p
        JOIN cat_phys_zone z ON z.profile_id=p.id WHERE p.active=1 AND p.profile_kind IN ('enclosure','support')
        GROUP BY p.id HAVING COUNT(*)>0`).all() as {id:number;kind:string}[];
      const enclosure=rows.find(row=>row.kind==="enclosure"),support=rows.find(row=>row.kind==="support");
      const device=db.prepare(`SELECT p.id FROM cat_phys_profile p JOIN cat_phys_profile_demand d ON d.profile_id=p.id
        WHERE p.active=1 AND p.profile_kind='device' LIMIT 1`).get() as {id:number};
      expect(enclosure).toBeDefined();expect(support).toBeDefined();expect(device).toBeDefined();
      for(const id of [enclosure!.id,support!.id,device.id]) {
        const profile=getPhysicalProfile(db,id)!;
        expect(profile.fitClass.code).toBeTruthy();expect(profile.fitClass.name).toBeTruthy();
        for(const zone of profile.zones.filter(row=>row.capacityKindCode)) {
          expect(zone.capacityKindLabel).toBeTruthy();expect(zone.displayDivisor).toBeGreaterThan(0);
        }
      }
    } finally {db.close();}
  });
});
