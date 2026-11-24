import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adapter, engineeringRefreshFixture } from "./helpers/engineering-refresh-fixture.js";
import * as presets from "../src/main/project/preset-children.js";
import * as snapshots from "../src/main/project/configured-items.js";
import { assessProjectPhysical } from "../src/main/project/physical-placement.js";
import { resolveEngineeringRefresh } from "../src/main/catalogue/engineering-refresh-resolver.js";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { openProjectDatabaseAtVersion } from "../src/main/database/project-migrations.js";
import { buildFrontDocument } from "../src/main/documents/front-document.js";
const cleanup:Array<()=>void>=[];
afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();});
const fixture=async()=>{const f=await engineeringRefreshFixture();cleanup.push(f.close);return f;};

describe("project engineering refresh",()=>{
  it.each(["physical_panel","mounting_guide"])("adopts %s only on explicit refresh and reopens offline",async role=>{
    const f=await fixture();
    f.working.prepare("UPDATE prj_item SET source_adapter_version=?").run("9");
    f.service.setQuantity(f.deviceLine,2);await f.service.save();
    const before=f.service.current()!,commerce=f.commerce(),saved=readFileSync(f.file);
    const snapshotFacts=()=>["prj_item_zone","prj_item_zone_slot","prj_item_demand","prj_item_constraint"]
      .map(table=>f.working.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const facts=snapshotFacts();
    f.db.prepare("UPDATE cat_phys_view SET symbol_kind=? WHERE profile_id=2").run(role);
    f.importVersion(adapter.version,"b".repeat(64));
    expect(f.service.current()!.configuredItems.find(item=>item.uuid===f.panel)!.views[0]!.symbolKind).toBe("rectangle");
    const plan=f.service.planEngineeringRefresh();
    expect(plan.canApply).toBe(true);
    expect(plan.items.find(item=>item.itemUuid===f.panel)).toMatchObject({action:"refresh",changes:expect.arrayContaining(["views"])});
    expect(f.commerce()).toEqual(commerce);expect(snapshotFacts()).toEqual(facts);
    const after=f.service.applyEngineeringRefresh(plan.token);
    expect(after.physicalNodes).toEqual(before.physicalNodes);expect(f.commerce()).toEqual(commerce);
    expect(snapshotFacts()).toEqual(facts);expect(readFileSync(f.file)).toEqual(saved);
    expect(after.configuredItems.find(item=>item.uuid===f.panel)!.views[0]!.symbolKind).toBe(role);
    const svg=buildFrontDocument(after,{}, {labels:true,dimensions:true}).html.split('<svg class="front-drawing"')[1]!;
    expect(svg.includes('class="front-support')).toBe(role==="physical_panel");
    expect(svg).not.toContain("front-opening");
    await f.service.save();f.service.closeCurrent();
    const offline=new ProjectDocumentService({...f.options,workingDirectory:path.join(f.root,"roles-offline"),
      engineeringCatalogue:()=>{throw new Error("No catalogue access on open");},
      resolveCatalogueProduct:()=>{throw new Error("offline");}});
    cleanup.push(()=>offline.close());
    const reopened=offline.open(f.file);
    expect(reopened.physicalNodes).toEqual(after.physicalNodes);
    expect(reopened.configuredItems.find(item=>item.uuid===f.panel)!.views[0]!.symbolKind).toBe(role);
    expect(buildFrontDocument(reopened,{}, {labels:true,dimensions:true}).html)
      .toBe(buildFrontDocument(after,{}, {labels:true,dimensions:true}).html);
  });
  it("refreshes an obsolete container binding atomically, preserves commerce/nodes, and saves/reopens offline",async()=>{
    const f=await fixture();await f.stale();
    expect(f.service.engineeringStatus().items.find(item=>item.itemUuid===f.panel)?.state).toBe("older_adapter");
    expect(f.service.checkPlacement(f.input)).toMatchObject({ok:false,code:"context_unknown"});
    const before=f.commerce(),saved=readFileSync(f.file),snapshot=f.working.serialize();
    const plan=f.service.planEngineeringRefresh();
    expect(f.working.serialize()).toEqual(snapshot);expect(f.commerce()).toEqual(before);
    expect(plan).toMatchObject({canApply:true,counts:{refresh:1,unchanged:2},newIssues:[]});
    expect(plan.items.find(item=>item.itemUuid===f.panel)).toMatchObject({action:"refresh",changes:expect.arrayContaining(["selections"])});
    const after=f.service.applyEngineeringRefresh(plan.token);
    expect(after.dirty).toBe(true);expect(readFileSync(f.file)).toEqual(saved);expect(f.commerce()).toEqual(before);
    expect(after.configuredItems.find(item=>item.uuid===f.panel)?.selections[0]?.binding).toBe("none");
    expect(assessProjectPhysical(f.working)).toEqual([]);
    expect(f.service.checkPlacement(f.input)).toEqual({ok:true});
    expect(f.service.engineeringStatus().counts.current_generation).toBe(3);
    await f.service.save();f.service.closeCurrent();
    const offline=new ProjectDocumentService({...f.options,workingDirectory:path.join(f.root,"offline"),
      engineeringCatalogue:()=>{throw new Error("catalogue must not be read on open");},
      resolveCatalogueProduct:()=>{throw new Error("offline");}});
    cleanup.push(()=>offline.close());
    const reopened=offline.open(f.file);
    expect(reopened.configuredItems.find(item=>item.uuid===f.panel)).toMatchObject({selections:[{binding:"none"}],sourceAdapterVersion:adapter.version});
    expect(reopened.physicalNodes).toEqual(after.physicalNodes);
    expect(offline.checkPlacement(f.input)).toEqual({ok:true});
    expect(reopened.globalDiscountBp).toBe(1500);expect(reopened.labourTotalE4).toBe(230_000);
  });

  it("verifies an identical legacy snapshot, fills provenance, and never calls it current without evidence",async()=>{
    const f=await fixture();f.working.exec("UPDATE prj_item SET engineering_provenance=NULL,source_adapter_code=NULL,source_adapter_version=NULL,source_import_fingerprint=NULL");
    f.service.setQuantity(f.deviceLine,2);await f.service.save();
    expect(f.service.engineeringStatus().counts.unknown).toBe(3);
    const before=f.commerce(),plan=f.service.planEngineeringRefresh();expect(plan.counts.verify).toBe(3);
    f.service.applyEngineeringRefresh(plan.token);expect(f.commerce()).toEqual(before);
    expect(f.service.engineeringStatus().counts.current_generation).toBe(3);
  });

  it("migrates format 9 without catalogue access, keeps provenance unknown, then explicitly corrects stale facts",async()=>{
    const f=await fixture();await f.stale(true);
    const legacy=path.join(f.root,"format9.lqp");
    const db=openProjectDatabaseAtVersion(legacy,path.resolve("db/migrations/project"),9);
    db.pragma("foreign_keys = OFF");db.prepare("ATTACH DATABASE ? AS saved").run(f.file);
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'prj_%' OR name='lqp_meta')").pluck().all() as string[];
    for(const table of tables){const columns=(db.pragma(`table_info(${table})`) as {name:string}[]).map(row=>`"${row.name}"`).join(",");
      db.exec(`DELETE FROM ${table}; INSERT INTO ${table}(${columns}) SELECT ${columns} FROM saved.${table}`);}
    db.exec("UPDATE lqp_meta SET value='9' WHERE key='format_version'");db.close();
    const saved=readFileSync(legacy);
    let catalogueCalls=0;
    const service=new ProjectDocumentService({...f.options,workingDirectory:path.join(f.root,"legacy-working"),
      engineeringCatalogue:()=>{catalogueCalls++;return f.db;}});cleanup.push(()=>service.close());
    const opened=service.open(legacy);expect(catalogueCalls).toBe(0);
    expect(opened.configuredItems.every(item=>item.engineeringProvenance===null)).toBe(true);
    expect(service.engineeringStatus().counts.unknown).toBe(3);
    expect(readFileSync(legacy)).toEqual(saved);
    if(service.current()!.dirty)await service.save();
    const plan=service.planEngineeringRefresh();expect(plan.canApply).toBe(true);
    expect(plan.items.find(item=>item.itemUuid===f.panel)?.action).toBe("refresh");
    const after=service.applyEngineeringRefresh(plan.token);
    expect(after.lines).toEqual(opened.lines);expect(after.physicalNodes).toEqual(opened.physicalNodes);
    expect(after.configuredItems.find(item=>item.uuid===f.panel)?.selections[0]?.binding).toBe("none");
  });

  it.each(["model_missing","model_inactive","option_missing","bom_changed","commercial_changed","capacity","ancestor","context","new_required_axis","stale_source","newer_project"])("blocks the entire project for %s and leaves dirty/file/working snapshot unchanged",async failure=>{
    const f=await fixture();await f.stale();
    if(["capacity","ancestor","context"].includes(failure)){
      // Place before synthesizing the historical binding, then restore that legacy issue for comparison.
      f.working.exec("UPDATE prj_item_selection SET binding='none'");f.service.placeChild(f.input);
      await f.stale();
    }
    if(failure==="model_missing")f.db.exec("UPDATE cat_config_model SET code='gone' WHERE id=2");
    if(failure==="model_inactive")f.db.exec("UPDATE cat_config_model SET obsolete=1 WHERE id=2");
    if(failure==="option_missing")f.db.exec("UPDATE cat_config_option SET active=0 WHERE id=1");
    if(failure==="bom_changed")f.db.exec("UPDATE cat_config_model_article SET quantity=2 WHERE model_id=3");
    if(failure==="commercial_changed")f.db.exec("UPDATE cat_config_model SET commercial_contribution='articles' WHERE id=2");
    if(failure==="capacity")f.db.exec("UPDATE cat_phys_profile_demand SET amount=30 WHERE profile_id=3");
    if(failure==="ancestor")f.db.exec(`INSERT INTO cat_phys_class(id,code,name,source) VALUES(3,'other','Other','manual'); INSERT INTO cat_phys_accept_set(id,code,source) VALUES(1,'bad','manual');
      INSERT INTO cat_phys_accept_set_member(set_id,class_id) VALUES(1,3);
      INSERT INTO cat_phys_constraint(profile_id,relation,accept_set_id) VALUES(3,'ancestor',1)`);
    if(failure==="context")f.db.exec("UPDATE cat_config_model SET context_policy='restricted' WHERE id=2");
    if(failure==="new_required_axis")f.db.exec(`INSERT INTO cat_config_axis(id,model_id,dimension_id,label,sort_order,visibility,requirement,binding,editable_when_placed,selects_primary)
      VALUES(2,3,1,'New',0,'visible','required','none',0,0);
      INSERT INTO cat_config_option(id,axis_id,value_id,is_default,visible,active,sort_order) VALUES(2,2,1,1,1,1,0)`);
    if(failure==="stale_source")f.db.prepare("UPDATE app_source_import SET adapter_version=?").run(String(BigInt(adapter.version)-1n));
    if(failure==="newer_project"){f.working.prepare("UPDATE prj_item SET source_adapter_version=? WHERE uuid=?").run(String(BigInt(adapter.version)+1n),f.panel);f.service.setQuantity(f.deviceLine,2);await f.service.save();}
    const before=f.working.serialize(),commercial=f.commerce(),saved=readFileSync(f.file);
    const plan=f.service.planEngineeringRefresh();expect(plan.canApply).toBe(false);
    expect(()=>f.service.applyEngineeringRefresh(plan.token)).toThrow();
    expect(f.working.serialize()).toEqual(before);expect(f.commerce()).toEqual(commercial);
    expect(readFileSync(f.file)).toEqual(saved);expect(f.service.current()!.dirty).toBe(false);
  });

  it("refuses outdated plans after project edits or a catalogue generation change",async()=>{
    const f=await fixture();await f.stale();let plan=f.service.planEngineeringRefresh();
    f.importVersion(adapter.version,"b".repeat(64));expect(()=>f.service.applyEngineeringRefresh(plan.token)).toThrow(/piano è cambiato/);
    plan=f.service.planEngineeringRefresh();f.service.setLabourTotal(300_000);
    expect(()=>f.service.applyEngineeringRefresh(plan.token)).toThrow(/piano è cambiato/);
    expect(f.service.current()!.dirty).toBe(true);
  });

  it("refuses dirty/recovered and unavailable catalogues without autosaving",async()=>{
    const f=await fixture();await f.stale();const saved=readFileSync(f.file);
    f.service.setQuantity(f.deviceLine,3);expect(f.service.planEngineeringRefresh()).toMatchObject({canApply:false,blockers:["save_first"]});
    expect(readFileSync(f.file)).toEqual(saved);
    await f.service.save();f.unavailable();expect(f.service.planEngineeringRefresh().canApply).toBe(false);
  });

  it("rolls back all writes when a late SQL failure occurs",async()=>{
    const f=await fixture();await f.stale(true);const plan=f.service.planEngineeringRefresh();
    const before=f.working.serialize(),saved=readFileSync(f.file),commerce=f.commerce();
    const original=snapshots.writeEngineeringSnapshot;
    const spy=vi.spyOn(snapshots,"writeEngineeringSnapshot").mockImplementation((db,id,result,takenAt)=>{
      original(db,id,result,takenAt);
      if(!db.memory&&result.model.code==="device")throw new Error("late failure");
    });
    try{expect(()=>f.service.applyEngineeringRefresh(plan.token)).toThrow("late failure");}
    finally{spy.mockRestore();}
    expect(f.working.serialize()).toEqual(before);expect(f.commerce()).toEqual(commerce);
    expect(readFileSync(f.file)).toEqual(saved);expect(f.service.current()!.dirty).toBe(false);
  });

  it("copies provenance on Duplica and fills only NULL provenance on semantically equal Q22 merge",async()=>{
    const f=await fixture();
    f.service.duplicateConfiguredItem(f.deviceLine);
    expect(f.service.current()!.configuredItems.filter(item=>item.modelCode==="device").every(item=>item.sourceImportFingerprint==="a".repeat(64))).toBe(true);
    f.working.exec("UPDATE prj_item SET engineering_provenance=NULL,source_adapter_code=NULL,source_adapter_version=NULL,source_import_fingerprint=NULL WHERE model_code='panel'");
    f.service.addConfiguredItem({modelId:2,selectedOptionIds:[1]});
    expect(f.service.current()!.configuredItems.find(item=>item.uuid===f.panel)?.engineeringProvenance).toBe("import");
    f.working.prepare("UPDATE prj_item SET source_adapter_version=? WHERE uuid=?").run(String(BigInt(adapter.version)-1n),f.panel);
    expect(()=>f.service.addConfiguredItem({modelId:2,selectedOptionIds:[1]}))
      .toThrow("Aggiorna i dati di ingegneria del progetto.");
    expect(f.service.current()!.configuredItems.find(item=>item.uuid===f.panel)?.sourceAdapterVersion).toBe(String(BigInt(adapter.version)-1n));
  });

  it.each(["10",String(Number(adapter.version)+1)])("Q22 diagnoses adapter %s before comparing editability and adopts it only through explicit refresh",async version=>{
    const f=await fixture();
    f.working.prepare("UPDATE prj_item SET source_adapter_version=? WHERE uuid=?").run(version,f.panel);
    f.service.setQuantity(f.deviceLine,2);await f.service.save();
    f.db.exec("UPDATE cat_config_axis SET editable_when_placed=1 WHERE id=1");
    f.importVersion(adapter.version,"b".repeat(64));
    const before=f.service.current()!,saved=readFileSync(f.file),image=f.working.serialize(),commerce=f.commerce();
    const old=before.configuredItems.find(item=>item.uuid===f.panel)!;
    const resolved=f.options.resolveConfiguration({modelId:2,selectedOptionIds:[1]});
    expect(snapshots.engineeringSnapshotDiff(resolved,old)).toEqual(["selections"]);
    expect(old.selections[0]!.editableWhenPlaced).toBe(false);
    expect(()=>f.service.addConfiguredItem({modelId:2,selectedOptionIds:[1]}))
      .toThrow(expect.objectContaining({code:"project_engineering_stale",message:"Aggiorna i dati di ingegneria del progetto."}));
    expect(f.working.serialize()).toEqual(image);expect(f.commerce()).toEqual(commerce);
    expect(f.service.current()).toEqual(before);expect(readFileSync(f.file)).toEqual(saved);
    const plan=f.service.planEngineeringRefresh();
    if(Number(version)>Number(adapter.version)) { expect(plan.canApply).toBe(false);return; }
    expect(plan.canApply).toBe(true);
    expect(plan.items.find(item=>item.itemUuid===f.panel))
      .toMatchObject({action:"refresh",changes:["selections","provenance"]});
    const refreshed=f.service.applyEngineeringRefresh(plan.token);
    expect(refreshed.configuredItems.find(item=>item.uuid===f.panel)!.selections[0]!.editableWhenPlaced).toBe(true);
    expect(refreshed.physicalNodes).toEqual(before.physicalNodes);expect(f.commerce()).toEqual(commerce);
    expect(readFileSync(f.file)).toEqual(saved);expect(refreshed.dirty).toBe(true);
    const merged=f.service.addConfiguredItem({modelId:2,selectedOptionIds:[1]});
    expect(merged.configuredItems.filter(item=>item.modelCode==="panel").map(item=>item.uuid)).toEqual([f.panel]);
    expect(merged.lines.find(line=>line.itemUuid===f.panel)!.quantity)
      .toBe(before.lines.find(line=>line.itemUuid===f.panel)!.quantity+1);
  });

  it("protects catalogue-backed chains but leaves unknown provenance and snapshot-only operations usable",async()=>{
    const f=await fixture();await f.stale();
    expect(f.service.designDiscover("device",f.panelNode).status).toBe("project_engineering_stale");
    expect(f.service.designNavigation("device",f.panelNode).status).toBe("project_engineering_stale");
    expect(()=>f.service.addStructural({kind:"device",place:false,parentUuid:f.panelNode,configuration:{modelId:3,selectedOptionIds:[]}})).toThrow("Aggiorna i dati di ingegneria del progetto.");
    expect(f.service.placementTargets({parentUuid:f.frameNode,itemUuid:f.panel})).toMatchObject({targets:[],diagnostics:[{code:"project_engineering_stale"}]});
    const moved=f.service.moveNode(f.panelNode,{itemUuid:f.panel,parentUuid:f.frameNode,zoneNo:0,startUnits:100,viewCode:"front"});
    expect(moved.physicalNodes[0]!.children[0]!.uuid).toBe(f.panelNode);
    f.working.exec("UPDATE prj_item SET engineering_provenance=NULL,source_adapter_code=NULL,source_adapter_version=NULL,source_import_fingerprint=NULL");
    expect(f.service.designDiscover("device",f.panelNode).status).toBe("ready");
  });

  it.each(["08","0","8.0","-1","","1e3"])("rejects malformed format-10 versions %j on open even with disabled SQL checks",async version=>{
    const f=await fixture();const bad=path.join(f.root,"bad.lqp");copyFileSync(f.file,bad);const db=new Database(bad);
    db.pragma("ignore_check_constraints = ON");db.prepare("UPDATE prj_item SET source_adapter_version=?").run(version);db.close();
    expect(()=>f.service.open(bad)).toThrow(/Provenienza/);
  });
});

it("maps dependent choices by stable parent codes after local option IDs change; refuses ambiguous options",async()=>{
  const f=await fixture(),stored=f.service.current()!.configuredItems.find(item=>item.uuid===f.panel)!;
  f.db.exec(`INSERT INTO cat_config_dimension(id,brand_id,code,name,source) VALUES(2,1,'child','Child','manual');
    INSERT INTO cat_config_dimension_value(id,dimension_id,code,label,source) VALUES(2,2,'X','Child X','manual'),(3,1,'B','Mount B','manual');
    INSERT INTO cat_config_axis(id,model_id,dimension_id,label,sort_order,visibility,requirement,binding,editable_when_placed,selects_primary)
      VALUES(2,2,2,'Child',1,'visible','required','none',0,0);
    INSERT INTO cat_config_option(id,axis_id,value_id,parent_option_id,is_default,visible,active,sort_order) VALUES
      (10,1,3,NULL,0,1,1,1),(2,2,2,1,0,1,1,0),(11,2,2,10,0,1,1,1)`);
  const item={...stored,selections:[...stored.selections,{dimensionCode:"child",dimensionLabel:"Child",valueCode:"X",valueLabel:"X",
    selectionSource:"user",binding:"none",editableWhenPlaced:false,visible:true}]};
  expect(resolveEngineeringRefresh(f.db,item)).toMatchObject({ok:true,result:{selectedOptionIds:[1,2]}});
  f.db.pragma("foreign_keys = OFF");f.db.exec("UPDATE cat_config_option SET parent_option_id=parent_option_id+1000 WHERE parent_option_id IS NOT NULL; UPDATE cat_config_option SET id=id+1000");f.db.pragma("foreign_keys = ON");
  f.importVersion(adapter.version,"b".repeat(64));
  expect(resolveEngineeringRefresh(f.db,item)).toMatchObject({ok:true,result:{selectedOptionIds:[1001,1002]}});
  f.db.exec("INSERT INTO cat_config_option(id,axis_id,value_id,parent_option_id,is_default,visible,active,sort_order) VALUES(99,2,2,1001,0,1,1,2)");
  expect(resolveEngineeringRefresh(f.db,item)).toEqual({ok:false,code:"selection_ambiguous"});
});

it("refuses multiple model matches rather than trusting the first local row",async()=>{
  const f=await fixture(),db=new Database(":memory:");
  try{
    db.exec(`CREATE TABLE cat_brand(id INTEGER,metel_marchio TEXT); INSERT INTO cat_brand VALUES(1,'GEN');
      CREATE TABLE cat_config_model(id INTEGER,brand_id INTEGER,code TEXT,model_kind TEXT,active INTEGER,obsolete INTEGER);
      INSERT INTO cat_config_model VALUES(1,1,'panel','support',1,0),(2,1,'panel','support',1,0)`);
    expect(resolveEngineeringRefresh(db,f.service.current()!.configuredItems.find(item=>item.uuid===f.panel)!))
      .toEqual({ok:false,code:"model_ambiguous"});
  }finally{db.close();}
});

it("keeps price snapshots and config_status when catalogue pricing is incomplete or changed",async()=>{
  const f=await fixture();await f.stale();const before=f.commerce();
  f.db.exec("UPDATE com_product_price SET list_price_unit_e4=990000");
  let plan=f.service.planEngineeringRefresh();expect(plan.canApply).toBe(true);
  f.db.exec("DELETE FROM com_product_price");
  plan=f.service.planEngineeringRefresh();expect(plan.canApply).toBe(true);
  f.service.applyEngineeringRefresh(plan.token);expect(f.commerce()).toEqual(before);
  expect(f.service.current()!.configuredItems.find(item=>item.uuid===f.device)?.configStatus).toBe("complete");
});

it("reports geometry and label changes while preserving coordinates, selection source, annotations and asset identity",async()=>{
  const f=await fixture();await f.stale();
  f.working.exec("UPDATE prj_item_selection SET selection_source='inherited'");
  f.service.addAnnotation({text:"Testo personale",xMm:12,yMm:24,widthMm:100,heightMm:40});
  await f.service.save();const before=f.commerce();
  f.db.exec("UPDATE cat_config_model SET name='Updated panel' WHERE id=2; UPDATE cat_config_dimension_value SET label='Updated mount' WHERE id=1; UPDATE cat_phys_zone SET origin_y_mm=40 WHERE profile_id=1");
  const plan=f.service.planEngineeringRefresh();expect(plan.geometryChanges).toHaveLength(1);
  expect(plan.items.find(item=>item.itemUuid===f.panel)?.labelChanges).toEqual(expect.arrayContaining([{field:"modelName",before:"Panel",after:"Updated panel"}]));
  f.service.applyEngineeringRefresh(plan.token);expect(f.commerce()).toEqual(before);
  expect(f.service.current()!.configuredItems.find(item=>item.uuid===f.panel)?.selections[0]?.selectionSource).toBe("inherited");
});

it("reports resolved old physical issues, and permits an unrelated pre-existing issue to remain",async()=>{
  const f=await fixture();f.service.placeChild(f.input);await f.stale();
  let plan=f.service.planEngineeringRefresh();expect(plan.canApply).toBe(true);
  expect(plan.resolvedIssues.some(issue=>issue.code==="context_unknown")).toBe(true);
  // A pre-existing invalid root coordinate is retained without making unrelated unchanged geometry worse.
  f.working.exec("UPDATE prj_item_view SET insert_dx_mm=NULL WHERE item_id=(SELECT id FROM prj_item WHERE model_code='frame')");
  f.db.exec("UPDATE cat_phys_view SET insert_dx_mm=NULL WHERE profile_id=1");
  f.service.setQuantity(f.deviceLine,2);await f.service.save();
  plan=f.service.planEngineeringRefresh();expect(plan.canApply).toBe(true);expect(plan.remainingIssues.length).toBeGreaterThan(0);
  const before=f.commerce();f.service.applyEngineeringRefresh(plan.token);expect(f.commerce()).toEqual(before);
});

it("prevents refresh from changing physical-only commercial semantics or unsafe Q22 facts",async()=>{
  const f=await fixture();
  const before=f.working.serialize();
  f.working.exec("UPDATE prj_item SET engineering_provenance=NULL,source_adapter_code=NULL,source_adapter_version=NULL,source_import_fingerprint=NULL WHERE model_code='panel'");
  f.db.exec("UPDATE cat_config_axis SET binding='match_container'");
  expect(()=>f.service.addConfiguredItem({modelId:2,selectedOptionIds:[1]})).toThrow(/dati tecnici/);
  expect(f.service.current()!.configuredItems.find(item=>item.uuid===f.panel)?.engineeringProvenance).toBeNull();
  expect(f.service.current()!.configuredItems.find(item=>item.uuid===f.panel)?.bom).toHaveLength(0);
  expect(f.service.current()!.lines.find(line=>line.itemUuid===f.panel)?.lineTotalE4).toBeNull();
  expect(before.length).toBeGreaterThan(0);
});

it("has exact per-source states for current/other/missing/stale/manual/unknown sources and legacy without catalogue",async()=>{
  const f=await fixture();expect(f.service.engineeringStatus().counts.current_generation).toBe(3);
  f.working.prepare("UPDATE prj_item SET source_import_fingerprint=? WHERE uuid=?").run("b".repeat(64),f.panel);
  expect(f.service.engineeringStatus().items.find(item=>item.itemUuid===f.panel)?.state).toBe("other_generation");
  f.db.exec("UPDATE app_source_import SET became_current=0");expect(f.service.engineeringStatus().counts.catalogue_stale).toBe(3);
  f.db.exec("UPDATE cat_config_model SET source_import_id=NULL; DELETE FROM app_source_import");
  expect(f.service.engineeringStatus().counts.catalogue_unavailable).toBe(3);
  f.working.exec("UPDATE prj_item SET source_adapter_code='unregistered' WHERE model_code='panel'");
  expect(f.service.engineeringStatus().counts.unknown_source).toBe(1);
  f.working.exec("UPDATE prj_item SET engineering_provenance='manual',source_adapter_code=NULL,source_adapter_version=NULL,source_import_fingerprint=NULL WHERE model_code='device'");
  expect(f.service.engineeringStatus().counts.manual).toBe(1);
  f.working.exec("UPDATE prj_item SET engineering_provenance=NULL,source_adapter_code=NULL,source_adapter_version=NULL,source_import_fingerprint=NULL WHERE model_code='frame'");
  f.unavailable();expect(f.service.engineeringStatus().counts.unknown).toBe(1);
});

it("does not let an old unrenderable ancestor mask a new capacity failure",async()=>{
  const f=await fixture();f.service.placeChild(f.input);await f.stale();
  f.working.exec("UPDATE prj_item_view SET insert_dx_mm=NULL WHERE item_id=(SELECT id FROM prj_item WHERE model_code='frame')");
  f.db.exec("UPDATE cat_phys_view SET insert_dx_mm=NULL WHERE profile_id=1; UPDATE cat_phys_profile_demand SET amount=30 WHERE profile_id=3");
  f.service.setQuantity(f.deviceLine,2);await f.service.save();
  const plan=f.service.planEngineeringRefresh();expect(plan.canApply).toBe(false);
  expect(plan.newIssues.some(issue=>issue.code==="over_capacity")).toBe(true);
});

it("retains an embedded view asset only for the same view code and asset key",async()=>{
  const f=await fixture();await f.stale();
  const data=Buffer.from("<svg/>"),hash=createHash("sha256").update(data).digest("hex");
  f.working.prepare("INSERT INTO prj_asset(sha256,byte_size,media_type,data,origin,license_code) VALUES(?,?,?,?,'lq_authored','lq_own')")
    .run(hash,data.length,"image/svg+xml",data);
  f.working.prepare("UPDATE prj_item_view SET asset_key='same',asset_sha256=? WHERE item_id=(SELECT id FROM prj_item WHERE uuid=?)").run(hash,f.panel);
  f.db.exec("UPDATE cat_phys_view SET asset_key='same' WHERE profile_id=2");
  f.service.setQuantity(f.deviceLine,2);await f.service.save();const before=f.commerce();
  let plan=f.service.planEngineeringRefresh();f.service.applyEngineeringRefresh(plan.token);
  expect(f.service.current()!.configuredItems.find(item=>item.uuid===f.panel)?.views[0]?.assetSha256).toBe(hash);
  expect(f.commerce()).toEqual(before);await f.service.save();const beforeSecond=f.commerce();
  f.db.exec("UPDATE cat_phys_view SET asset_key='different' WHERE profile_id=2");
  plan=f.service.planEngineeringRefresh();f.service.applyEngineeringRefresh(plan.token);
  expect(f.service.current()!.configuredItems.find(item=>item.uuid===f.panel)?.views[0]?.assetSha256).toBeNull();
  expect(f.commerce()).toEqual(beforeSecond);
});

it.each([
  ["manual","code","1","a".repeat(64)],[null,"code",null,null],["import",null,"8","a".repeat(64)],
  ["import"," ","8","a".repeat(64)],["import","code","8",null],["import","code","8","A".repeat(64)],
  ["invalid",null,null,null],["import","code",null,"a".repeat(64)],
])("rejects incoherent format-10 provenance %j even if SQL checks are bypassed",async(kind,code,version,fingerprint)=>{
  const f=await fixture(),bad=path.join(f.root,"bad.lqp");copyFileSync(f.file,bad);const db=new Database(bad);
  db.pragma("ignore_check_constraints = ON");db.prepare("UPDATE prj_item SET engineering_provenance=?,source_adapter_code=?,source_adapter_version=?,source_import_fingerprint=?").run(kind,code,version,fingerprint);db.close();
  expect(()=>f.service.open(bad)).toThrow(/Provenienza/);
});

it("rolls back the transaction and dirty state if recovery bookkeeping fails",async()=>{
  const f=await fixture();await f.stale();const plan=f.service.planEngineeringRefresh(),before=f.working.serialize(),saved=readFileSync(f.file);
  let calls=0;Object.assign(f.options,{now:()=>{if(++calls===2)throw new Error("recovery bookkeeping failed");return new Date("2026-10-06T09:00:00Z");}});
  expect(()=>f.service.applyEngineeringRefresh(plan.token)).toThrow("recovery bookkeeping failed");
  expect(f.service.current()!.dirty).toBe(false);expect(f.working.serialize()).toEqual(before);expect(readFileSync(f.file)).toEqual(saved);
  expect(f.service.planEngineeringRefresh().token).toBe(plan.token);
});

it("blocks catalogue-backed root transfer through a known stale source chain, but allows snapshot-proven transfer",async()=>{
  const f=await fixture(),frameLine=f.service.current()!.lines.find(line=>line.itemUuid===f.frame)!.uuid;
  f.service.duplicateConfiguredItem(frameLine);
  const second=f.service.current()!.configuredItems.find(item=>item.modelCode==="frame"&&item.uuid!==f.frame)!.uuid;
  f.service.placeRoot({itemUuid:second,viewCode:"front",rootXMm:600,rootYMm:0});
  const destination=f.service.current()!.physicalNodes.find(node=>node.itemUuid===second)!.uuid;
  f.working.prepare("UPDATE prj_item SET source_adapter_version=? WHERE uuid=?").run(String(BigInt(adapter.version)-1n),f.frame);
  const input={itemUuid:f.panel,parentUuid:destination,zoneNo:0,startUnits:0,viewCode:"front"};
  // Known saved context: no catalogue operation, so transfer remains usable.
  expect(f.service.checkPlacement(input,f.panelNode)).toEqual({ok:true});
  f.working.prepare("UPDATE prj_item SET context_policy=NULL WHERE uuid=?").run(f.panel);
  expect(f.service.checkPlacement(input,f.panelNode)).toMatchObject({ok:false,code:"project_engineering_stale"});
  expect(()=>f.service.moveNode(f.panelNode,input)).toThrow("Aggiorna i dati di ingegneria del progetto.");
});

it("never reinstantiates newly catalogued presets during refresh",async()=>{
  const f=await fixture();await f.stale();const before=f.commerce();
  f.db.exec("INSERT INTO cat_config_model_relation(from_model_id,relation,seq,to_model_id,quantity,placement_mode,source) VALUES(1,'preset_child',0,2,1,'packed','manual'); UPDATE cat_config_model SET definition_fingerprint='new-definition' WHERE id=1");
  const plan=f.service.planEngineeringRefresh();expect(plan.canApply).toBe(true);
  const spy=vi.spyOn(presets,"instantiatePresetChildren");
  try{f.service.applyEngineeringRefresh(plan.token);expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
  expect(f.commerce()).toEqual(before);
});

it("records manual generation for new manual models and for explicit unplaced-item reconfiguration",async()=>{
  const f=await fixture();
  f.db.exec("INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,base_profile_id,definition_fingerprint,source,context_policy,commercial_contribution) VALUES(4,1,'manual','Manual','support',2,'manual-definition','manual','unrestricted','none')");
  const added=f.service.addConfiguredItem({modelId:4,selectedOptionIds:[]}).configuredItems.find(item=>item.modelCode==='manual')!;
  expect(added).toMatchObject({engineeringProvenance:"manual",sourceAdapterCode:null,sourceAdapterVersion:null,sourceImportFingerprint:null});
  f.db.exec("UPDATE cat_config_model SET source='manual' WHERE id=3");
  const replaced=f.service.replaceConfiguredItem(f.deviceLine,{modelId:3,selectedOptionIds:[]}).configuredItems.find(item=>item.modelCode==='device')!;
  expect(replaced.engineeringProvenance).toBe("manual");
});

it("requires Save As for an unresolved recovered working copy before engineering refresh",async()=>{
  const f=await fixture();await f.stale();f.service.setQuantity(f.deviceLine,3);f.service.close();
  const recovered=new ProjectDocumentService(f.options);cleanup.push(()=>recovered.close());
  const entry=recovered.recoveries()[0]!;expect(entry).toBeDefined();
  recovered.openRecovery(entry.id);
  expect(recovered.planEngineeringRefresh()).toMatchObject({canApply:false,blockers:["save_first"]});
  expect(recovered.currentTargetPath()).toBeNull();
});

it("rolls back if the installed generation changes during actual project writes",async()=>{
  const f=await fixture();await f.stale();const plan=f.service.planEngineeringRefresh(),before=f.working.serialize(),saved=readFileSync(f.file);
  const original=snapshots.writeEngineeringSnapshot;
  const spy=vi.spyOn(snapshots,"writeEngineeringSnapshot").mockImplementation((db,id,result,takenAt)=>{
    original(db,id,result,takenAt);if(!db.memory)f.importVersion(adapter.version,"b".repeat(64));
  });
  try{expect(()=>f.service.applyEngineeringRefresh(plan.token)).toThrow("Il catalogo è cambiato");}finally{spy.mockRestore();}
  expect(f.working.serialize()).toEqual(before);expect(readFileSync(f.file)).toEqual(saved);expect(f.service.current()!.dirty).toBe(false);
});
