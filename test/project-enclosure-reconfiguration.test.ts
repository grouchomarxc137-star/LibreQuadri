import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { capacityFillFixture, type CapacityFillFixture } from "./helpers/capacity-fill-fixture.js";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { calculateCommercial } from "../src/shared/commercial.js";
import { documentTables } from "../src/main/project/document-history.js";
import { TIQUADRI_ENGINEERING_ADAPTER } from "../src/main/sources/tiquadri/adapter.js";

let fx: CapacityFillFixture | undefined;
afterEach(()=>{fx?.close();fx=undefined;});

async function fixture(quantity=1,physicalOnly=false,configure?:(db:Database.Database)=>void) {
  fx=await capacityFillFixture();
  const {db,service}=fx;
  if(!physicalOnly) db.exec(`UPDATE cat_config_model SET commercial_contribution='articles' WHERE id=1;
    INSERT INTO cat_config_model_article(model_id,seq,product_id,ref_brand_marchio,ref_manufacturer_code,quantity,role)
      SELECT 1,0,id,'GEN','PART',1,'primary' FROM cat_product WHERE manufacturer_code='PART';`);
  db.exec(`INSERT INTO cat_config_dimension(id,brand_id,code,name,source) VALUES(2,1,'door','Door','manual'),(3,1,'plinth','Plinth','manual');
    INSERT INTO cat_config_dimension_value(id,dimension_id,code,label,source) VALUES
      (20,2,'open','Open','manual'),(21,2,'closed','Closed','manual'),(30,3,'none','None','manual'),(31,3,'high','High','manual');
    INSERT INTO cat_config_axis(id,model_id,dimension_id,label,sort_order,visibility,requirement,binding,editable_when_placed,selects_primary)
      VALUES(2,1,2,'Door',0,'visible','required','none',1,0),(3,1,3,'Plinth',1,'visible','required','none',1,0);
    INSERT INTO cat_config_option(id,axis_id,value_id,is_default,visible,active,sort_order) VALUES
      (20,2,20,1,1,1,0),(21,2,21,0,1,1,1),(30,3,30,1,1,1,0),(31,3,31,0,1,1,1);
    INSERT INTO cat_config_rule(id,model_id,seq) VALUES(100,1,1);
    INSERT INTO cat_config_rule_condition(rule_id,option_id) VALUES(100,21);`);
  if(!physicalOnly) db.exec(`INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,product_id,ref_brand_marchio,ref_manufacturer_code,quantity,article_role)
    SELECT 100,0,'article',id,'GEN','BLANK',2,'accessory' FROM cat_product WHERE manufacturer_code='BLANK';`);
  configure?.(db);
  const enclosure=fx.add(1,quantity),panel=fx.add(2,2),device=fx.add(3,2);
  const selected=service.placeRoot({itemUuid:enclosure,viewCode:'front',rootXMm:57,rootYMm:89}).physicalNodes[0]!.uuid;
  service.placeChild({itemUuid:panel,parentUuid:selected,zoneNo:0,startUnits:120,viewCode:'front'});
  const panelNode=service.current()!.physicalNodes[0]!.children[0]!.uuid;
  service.placeChild({itemUuid:device,parentUuid:panelNode,zoneNo:0,startUnits:4,viewCode:'front'});
  if(quantity>1) service.placeRoot({itemUuid:enclosure,viewCode:'front',rootXMm:700,rootYMm:89});
  // Existing customers' discounts/costs/locks on the retained primary must survive.
  const working=new Database(fx.workingFile());
  if(!physicalOnly) working.prepare(`UPDATE prj_item_bom SET line_discount_bp=1250,purchase_discount_chain='10+5',
    purchase_discount_bp=1450,net_cost_unit_e4=85500,markup_bp=2000,price_locked=1 WHERE item_id=(SELECT id FROM prj_item WHERE uuid=?)`).run(enclosure);
  working.prepare("UPDATE prj_line SET description_override='Enclosure A',price_locked=1 WHERE item_id=(SELECT id FROM prj_item WHERE uuid=?)").run(enclosure);
  working.close();
  service.setGlobalDiscount(1000);service.setLabourTotal(10000);await service.save();
  return {enclosure,selected,panelNode,request:{modelId:1,selectedOptionIds:[21,31]}};
}
const raw=()=>new Database(fx!.workingFile());
const tables=(db:Database.Database)=>Object.fromEntries(documentTables(db).map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));

it("derives drawing labels for the matching cabinet choices through reconfigure, undo and redo", async()=>{
  const {selected,request}=await fixture(2,false,db=>db.exec(`
    INSERT INTO cat_config_rule_condition(rule_id,option_id) VALUES(100,31);
    INSERT INTO cat_config_rule_front_label VALUES(100,'99_Testi/door_label',18,225,200,20);
  `));
  const {service,db}=fx!;
  const labels=(view:NonNullable<ReturnType<typeof service.current>>)=>view.physicalNodes.map(node=>
    view.configuredItems.find(item=>item.uuid===node.itemUuid)?.frontOptionLabels);
  const expected=[{assetKey:"99_Testi/door_label",xMm:18,yMm:225,widthMm:200,heightMm:20}];
  expect(labels(service.current()!)).toEqual([undefined,undefined]);
  expect(labels(service.reconfigureEnclosure(selected,{...request,selectedOptionIds:[21]}))).toEqual([undefined,undefined]);
  expect(labels(service.reconfigureEnclosure(selected,request))).toEqual([expected,undefined]);
  expect(labels(service.undo())).toEqual([undefined,undefined]);
  expect(labels(service.redo())).toEqual([expected,undefined]);
  db.exec("UPDATE cat_config_model SET definition_fingerprint='different' WHERE id=1");
  expect(labels(service.current()!)).toEqual([undefined,undefined]);
});

it.each([1,2,4])("Q=%i changes only the selected unit, retains subtree/commerce, undo/redo and offline save/reopen",async q=>{
  const {selected,enclosure,request}=await fixture(q);
  const {service}=fx!;
  const before=service.current()!,dump=fx!.dump(),bytes=readFileSync(fx!.file);
  const db=raw(),beforeRows=tables(db);
  // Simulate a new commercial listino; engineering provenance stays current.
  fx!.db.exec("UPDATE com_product_price SET list_price_unit_e4=list_price_unit_e4*2");
  const changed=service.reconfigureEnclosure(selected,request);
  const result=changed.configuredItems.find(item=>item.uuid===changed.physicalNodes[0]!.itemUuid)!;
  expect(result.selections.map(row=>row.valueCode)).toEqual(['closed','high']);
  expect(result.bom.map(row=>[row.manufacturerCode,row.salePriceUnitE4,row.quantityPerItem,row.lineDiscountBp]))
    .toEqual([['PART',100000,1,1250],['BLANK',120400,2,0]]);
  expect(changed.physicalNodes[0]!.children).toEqual(before.physicalNodes[0]!.children);
  expect(changed.physicalNodes[0]!).toMatchObject({uuid:selected,xMm:57,yMm:89});
  expect(changed.lines.find(line=>line.itemUuid===result.uuid)).toMatchObject({quantity:1,unitListPriceE4:340800,lineTotalE4:340800,description:'Enclosure A'});
  expect(changed.dirty).toBe(true);expect(changed.history!.undoLabel).toBe('Modifica carpenteria');
  expect(readFileSync(fx!.file)).toEqual(bytes);
  const retained=db.prepare(`SELECT b.* FROM prj_item_bom b JOIN prj_item i ON i.id=b.item_id WHERE i.uuid=? AND b.seq=0`).get(result.uuid) as Record<string,unknown>;
  expect(retained).toMatchObject({line_discount_bp:1250,purchase_discount_chain:'10+5',purchase_discount_bp:1450,net_cost_unit_e4:85500,markup_bp:2000,price_locked:1});
  expect(db.prepare('SELECT * FROM prj_product_snapshot WHERE manufacturer_code=\'PART\'').get()).toEqual((beforeRows['prj_product_snapshot'] as {manufacturer_code:string}[]).find(row=>row.manufacturer_code==='PART'));
  if(q===1){expect(result.uuid).toBe(enclosure);expect(changed.lines[0]!.uuid).toBe(before.lines[0]!.uuid);}
  else {
    expect(result.uuid).not.toBe(enclosure);
    expect(changed.configuredItems.find(item=>item.uuid===enclosure)).toEqual(before.configuredItems.find(item=>item.uuid===enclosure));
    expect(changed.lines[0]).toMatchObject({uuid:before.lines[0]!.uuid,quantity:q-1,lineTotalE4:100000*(q-1)});
    expect(changed.physicalNodes[1]).toEqual(before.physicalNodes[1]);
  }
  expect(calculateCommercial(changed).finalTotalE4).toBe(10000+Math.round(((q-1)*87500+87500+240800+200000)*0.9));
  const changedDump=fx!.dump();
  expect(service.undo().dirty).toBe(false);expect(fx!.dump()).toEqual(dump);
  fx!.unavailable(); // History never calls the catalogue, even after a successful reconfiguration.
  service.redo();expect(fx!.dump()).toEqual(changedDump);
  await service.save();expect(service.undo().dirty).toBe(true);expect(service.redo().dirty).toBe(false);
  const saved=service.current()!;db.close();service.close();
  const offline=new ProjectDocumentService({...fx!.serviceOptions,workingDirectory:path.join(fx!.root,'offline'),
    engineeringCatalogue:()=>null,resolveConfiguration:()=>{throw new Error('offline');},resolveCatalogueProduct:()=>{throw new Error('offline');}});
  try{
    const reopened=offline.open(fx!.file);
    expect(reopened).toMatchObject({configuredItems:saved.configuredItems,physicalNodes:saved.physicalNodes,lines:saved.lines,distinta:saved.distinta,dirty:false});
    expect(reopened.history).toEqual({undoLabel:null,redoLabel:null});
  }finally{offline.close();}
});

it('option-only and unchanged requests do not split/reprice unnecessarily',async()=>{
  const {selected}=await fixture(3,true),before=fx!.dump(),view=fx!.service.current();
  fx!.service.reconfigureEnclosure(selected,{modelId:1,selectedOptionIds:[]});
  expect(fx!.dump()).toEqual(before);expect(fx!.service.current()).toEqual(view);
  const after=fx!.service.reconfigureEnclosure(selected,{modelId:1,selectedOptionIds:[31]});
  expect(after.lines.at(-1)).toMatchObject({quantity:1,unitListPriceE4:null,lineTotalE4:null});
  expect(after.physicalNodes[0]!.children).toEqual(view!.physicalNodes[0]!.children);
});

it.each(['axis','model','depth','capacity','class','binding','exclusion','context','geometry','old-root','new-child','generation','definition','price-conflict','missing-new-price','price-overflow','incomplete','bookkeeping','write','view'])
  ('rolls back %s rejection with actionable diagnostics and unchanged document/history/file',async failure=>{
  const {selected,panelNode,request}=await fixture(3);
  const db=raw(),{service}=fx!;
  const originalResolve=fx!.serviceOptions.resolveConfiguration!;
  let custom=request;
  if(failure==='axis') {db.exec("UPDATE prj_item_selection SET editable_when_placed=0 WHERE dimension_code='door'");fx!.db.exec("UPDATE cat_config_axis SET editable_when_placed=0 WHERE id=2");}
  if(failure==='model') custom={modelId:6,selectedOptionIds:[]};
  if(failure==='old-root') db.prepare("UPDATE prj_item SET source_adapter_version='10' WHERE id=(SELECT item_id FROM prj_node WHERE uuid=?)").run(selected);
  if(failure==='new-child') db.prepare("UPDATE prj_item SET source_adapter_version=? WHERE id=(SELECT item_id FROM prj_node WHERE uuid=?)")
    .run(String(Number(TIQUADRI_ENGINEERING_ADAPTER.version)+1),panelNode);
  if(failure==='generation') db.exec("UPDATE prj_item SET source_import_fingerprint='"+'c'.repeat(64)+"'");
  if(failure==='definition') fx!.db.exec("UPDATE cat_config_model SET definition_fingerprint='changed' WHERE id=1");
  if(failure==='price-conflict') {service.addCatalogueProduct(fx!.db.prepare("SELECT id FROM cat_product WHERE manufacturer_code='BLANK'").pluck().get() as number);fx!.db.exec("UPDATE com_product_price SET list_price_unit_e4=list_price_unit_e4*2");}
  if(failure==='missing-new-price') fx!.db.exec("DELETE FROM com_product_price WHERE product_id=(SELECT id FROM cat_product WHERE manufacturer_code='BLANK')");
  if(failure==='price-overflow')db.prepare('UPDATE prj_item_bom SET sale_price_unit_e4=? WHERE item_id=1').run(Number.MAX_SAFE_INTEGER-100000);
  if(failure==='view') {
    fx!.db.exec("UPDATE com_product_price SET list_price_unit_e4="+Math.floor(Number.MAX_SAFE_INTEGER/3)+" WHERE product_id=(SELECT id FROM cat_product WHERE manufacturer_code='BLANK')");
    service.addCatalogueProduct(fx!.db.prepare("SELECT id FROM cat_product WHERE manufacturer_code='BLANK'").pluck().get() as number,2);
  }
  if(failure==='bookkeeping') mkdirSync(fx!.workingFile()+'.recovery.json');
  if(failure==='write') db.exec("CREATE TRIGGER refuse_selection BEFORE INSERT ON prj_item_selection BEGIN SELECT RAISE(ABORT,'injected write failure'); END;");
  const altered=new ProjectDocumentService({...fx!.serviceOptions,workingDirectory:path.join(fx!.root,'altered'),
    resolveConfiguration:r=>{
      const result=originalResolve(r);
      if(failure==='depth')result.physical!.usableDepthMm=500;
      if(failure==='capacity')result.physical!.zones[0]!.lengthMm=100;
      if(failure==='class')result.physical!.fitClass.code='other';
      if(failure==='binding')result.model.axes[0]!.binding='match_container';
      if(failure==='exclusion')result.exclusions=[{ownDimensionCode:'door',ownValueCode:'closed',ancestorDimensionCode:'door',ancestorValueCode:'closed'}];
      if(failure==='context')result.context={policy:'restricted',role:'provides',codes:[]};
      if(failure==='geometry')result.physical!.zones[0]!.originXMm=1;
      if(failure==='incomplete')result.status='incomplete';
      return result;
    }});
  // Use a second service only for resolver perturbations; others exercise the original session/history.
  const resolverFailures=['depth','capacity','class','binding','exclusion','context','geometry','incomplete','view'];
  let active=service;
  if(resolverFailures.includes(failure)){
    await service.save();altered.open(fx!.file);active=altered;
    if(failure==='binding'){
      // Descendant must match a changed root selection, rather than mutate saved root semantics.
      const alteredDb=new Database(path.join(fx!.root,'altered', readdirSync(path.join(fx!.root,'altered')).find(name=>name.endsWith('.lqp'))!));
      alteredDb.exec(`INSERT INTO prj_item_selection(item_id,sort_order,dimension_code,dimension_label,value_code,value_label,selection_source,binding,editable_when_placed,visible)
        SELECT item_id,0,'door','Door','open','Open','user','match_container',0,1 FROM prj_node WHERE uuid='${panelNode}'`);alteredDb.close();
    }
    if(failure==='exclusion'){
      // Device exclusion must inspect the changed root, two levels above it.
      const alteredDb=new Database(path.join(fx!.root,'altered', readdirSync(path.join(fx!.root,'altered')).find(name=>name.endsWith('.lqp'))!));
      alteredDb.exec(`INSERT INTO prj_item_exclusion SELECT item_id,'width','w1','door','closed' FROM prj_node WHERE node_kind='device';
        INSERT INTO prj_item_selection(item_id,sort_order,dimension_code,dimension_label,value_code,value_label,selection_source,binding,editable_when_placed,visible)
        SELECT item_id,0,'width','Width','w1','W1','user','none',0,1 FROM prj_node WHERE node_kind='device'`);alteredDb.close();
    }
    if(failure==='context'){
      const alteredDb=new Database(path.join(fx!.root,'altered', readdirSync(path.join(fx!.root,'altered')).find(name=>name.endsWith('.lqp'))!));
      alteredDb.prepare("UPDATE prj_item SET context_policy='restricted' WHERE id=(SELECT item_id FROM prj_node WHERE uuid=?)").run(panelNode);
      alteredDb.prepare("INSERT INTO prj_item_context SELECT item_id,'accepts','C1' FROM prj_node WHERE uuid=?").run(panelNode);alteredDb.close();
    }
  }
  const activeDb=active===service?db:new Database(path.join(fx!.root,'altered',readdirSync(path.join(fx!.root,'altered')).find(name=>name.endsWith('.lqp'))!));
  const before=active.current()!,saved=readFileSync(fx!.file),image=tables(activeDb);
  const codes:Record<string,string>={axis:'axis_not_editable',model:'model_replacement_unsupported',depth:'depth_replacement_unsupported',
    capacity:'incompatible_subtree',class:'incompatible_subtree',binding:'incompatible_subtree',exclusion:'incompatible_subtree',context:'incompatible_subtree',
    geometry:'position_changed','old-root':'project_engineering_stale','new-child':'project_engineering_stale',generation:'project_engineering_stale',
    definition:'project_engineering_stale','price-conflict':'price_snapshot_conflict','missing-new-price':'catalogue_changed','price-overflow':'price_overflow',incomplete:'configuration_unavailable',
    view:''};
  try {
    let error:unknown;
    try{active.reconfigureEnclosure(selected,custom);}catch(caught){error=caught;}
    expect(error).toBeInstanceOf(Error);
    if(failure==='view')expect((error as Error).message).toContain("intervallo numerico");
    if(codes[failure]) expect(error).toMatchObject({code:codes[failure]});
    if(failure==='missing-new-price')expect((error as Error).message).toContain('importa un listino con il prezzo');
    if(failure==='geometry')expect((error as Error).message).toContain('scegli opzioni che mantengano le posizioni');
    if(codes[failure]==='incompatible_subtree')expect(error).toMatchObject({diagnostics:expect.arrayContaining([expect.objectContaining({nodeUuid:expect.any(String),message:expect.any(String)})])});
    if(failure==='binding')expect(error).toMatchObject({diagnostics:expect.arrayContaining([
      expect.objectContaining({nodeUuid:panelNode,code:'context_mismatch'})])});
    if(failure==='exclusion')expect(error).toMatchObject({diagnostics:expect.arrayContaining([
      expect.objectContaining({nodeUuid:before.physicalNodes[0]!.children[0]!.children[0]!.uuid,code:'excluded_combination'})])});
    expect(active.current()).toEqual(before);expect(tables(activeDb)).toEqual(image);expect(readFileSync(fx!.file)).toEqual(saved);
  }finally{if(activeDb!==db)activeDb.close();altered.close();db.close();if(failure==='bookkeeping')rmSync(fx!.workingFile()+'.recovery.json',{recursive:true});}
});

describe('snapshot price retention',()=>{
  it('retains a price even when its current catalogue price is missing',async()=>{
    const {selected,request}=await fixture();
    fx!.db.exec("DELETE FROM com_product_price WHERE product_id=(SELECT id FROM cat_product WHERE manufacturer_code='PART')");
    expect(fx!.service.reconfigureEnclosure(selected,request).configuredItems[0]!.bom[0]!.salePriceUnitE4).toBe(100000);
  });

  it('A→B→A uses a fresh price after removal, listino change and offline Save/Reopen',async()=>{
    const {selected,request}=await fixture(),{service}=fx!;
    // A contains the optional article; B removes it.
    service.reconfigureEnclosure(selected,request);
    const db=raw(),original=db.prepare("SELECT * FROM prj_product_snapshot WHERE manufacturer_code='BLANK'").get() as {uuid:string};
    service.reconfigureEnclosure(selected,{modelId:1,selectedOptionIds:[]});
    expect(db.prepare("SELECT * FROM prj_product_snapshot WHERE manufacturer_code='BLANK'").get()).toBeUndefined();
    const removed=tables(db);
    service.undo();expect(db.prepare("SELECT * FROM prj_product_snapshot WHERE manufacturer_code='BLANK'").get()).toEqual(original);
    service.redo();expect(tables(db)).toEqual(removed);
    await service.save();db.close();service.close();
    fx!.db.exec("UPDATE com_product_price SET list_price_unit_e4=list_price_unit_e4*2");
    const offline=new ProjectDocumentService({...fx!.serviceOptions,workingDirectory:path.join(fx!.root,'offline-cycle'),
      engineeringCatalogue:()=>null,resolveConfiguration:()=>{throw new Error('offline');},resolveCatalogueProduct:()=>{throw new Error('offline');}});
    try{
      const view=offline.open(fx!.file);
      expect(view.configuredItems[0]!.bom.map(row=>row.manufacturerCode)).toEqual(['PART']);
      await offline.save();
    }finally{offline.close();}
    service.open(fx!.file);
    const after=service.reconfigureEnclosure(selected,request),current=raw();
    expect(after.configuredItems[0]!.bom.map(row=>[row.manufacturerCode,row.salePriceUnitE4]))
      .toEqual([['PART',100000],['BLANK',120400]]);
    expect((current.prepare("SELECT uuid FROM prj_product_snapshot WHERE manufacturer_code='BLANK'").get() as {uuid:string}).uuid).not.toBe(original.uuid);
    expect(current.pragma('foreign_key_check')).toEqual([]);current.close();
  });

  it('a subsequent Catalogo addition uses the current price once the optional snapshot is unused',async()=>{
    const {selected,request}=await fixture(),{service}=fx!;
    service.reconfigureEnclosure(selected,request);
    service.reconfigureEnclosure(selected,{modelId:1,selectedOptionIds:[]});
    fx!.db.exec("UPDATE com_product_price SET list_price_unit_e4=list_price_unit_e4*2");
    const product=fx!.db.prepare("SELECT id FROM cat_product WHERE manufacturer_code='BLANK'").pluck().get() as number;
    const view=service.addCatalogueProduct(product),db=raw();
    expect(view.lines.at(-1)).toMatchObject({manufacturerCode:'BLANK',unitListPriceE4:120400,lineTotalE4:120400});
    expect(db.prepare("SELECT list_price_unit_e4 FROM prj_product_snapshot WHERE manufacturer_code='BLANK'").pluck().get()).toBe(120400);
    db.close();
  });

  it.each(['line','bom','primary','split'])('retains a removed snapshot still referenced by %s',async reference=>{
    const {selected,request}=await fixture(reference==='split'?3:1),{service}=fx!;
    service.reconfigureEnclosure(selected,request);
    const db=raw();
    const snapshot=db.prepare("SELECT * FROM prj_product_snapshot WHERE manufacturer_code='BLANK'").get() as {id:number};
    let originalItem:unknown;
    if(reference==='line')service.addCatalogueProduct(fx!.db.prepare("SELECT id FROM cat_product WHERE manufacturer_code='BLANK'").pluck().get() as number);
    if(reference==='bom')service.addConfiguredItem({modelId:5,selectedOptionIds:[1]});
    if(reference==='primary'){
      // A primary-only reference on another physical-only item must protect the snapshot too.
      db.prepare("UPDATE prj_item SET primary_snapshot_id=? WHERE model_code='rail-panel'").run(snapshot.id);
    }
    if(reference==='split'){
      // The configured A item now has a placed and a pooled unit; only the placed unit leaves A.
      service.setQuantity(service.current()!.lines.find(line=>line.itemUuid===service.current()!.physicalNodes[0]!.itemUuid)!.uuid,2);
      originalItem=service.current()!.configuredItems.find(item=>item.uuid===service.current()!.physicalNodes[0]!.itemUuid);
    }
    const before=service.current()!,otherRoot=before.physicalNodes[1];
    const after=service.reconfigureEnclosure(selected,{modelId:1,selectedOptionIds:[]});
    expect(db.prepare('SELECT * FROM prj_product_snapshot WHERE id=?').get(snapshot.id)).toEqual(snapshot);
    if(reference==='split'){
      expect(after.configuredItems.find(item=>item.uuid===(originalItem as {uuid:string}).uuid)).toEqual(originalItem);
      expect(after.physicalNodes[1]).toEqual(otherRoot);
    }
    fx!.db.exec("UPDATE com_product_price SET list_price_unit_e4=list_price_unit_e4*2");
    const image=tables(db),view=service.current();
    expect(()=>service.reconfigureEnclosure(selected,request)).toThrow(expect.objectContaining({code:'price_snapshot_conflict'}));
    expect(tables(db)).toEqual(image);expect(service.current()).toEqual(view);db.close();
  });

  it('includes a replaced primary snapshot even when it is absent from the old BOM',async()=>{
    const {selected,request}=await fixture(),{service}=fx!;
    service.addCatalogueProduct(fx!.db.prepare("SELECT id FROM cat_product WHERE manufacturer_code='BLANK'").pluck().get() as number);
    const db=raw(),snapshot=db.prepare("SELECT id FROM prj_product_snapshot WHERE manufacturer_code='BLANK'").pluck().get() as number;
    // Portable legacy state: primary reference disagrees with the otherwise verified BOM.
    db.prepare('UPDATE prj_item SET primary_snapshot_id=? WHERE model_code=\'frame\'').run(snapshot);
    db.exec("DELETE FROM prj_line WHERE line_type='product'");
    service.reconfigureEnclosure(selected,{...request,selectedOptionIds:[31]});
    expect(db.prepare('SELECT * FROM prj_product_snapshot WHERE id=?').get(snapshot)).toBeUndefined();
    expect(db.prepare("SELECT primary_snapshot_id FROM prj_item WHERE model_code='frame'").pluck().get())
      .toBe(db.prepare("SELECT id FROM prj_product_snapshot WHERE manufacturer_code='PART'").pluck().get());
    db.close();
  });

  it.each(['physical','cleanup-write','bookkeeping'])('restores deleted snapshots when %s fails after BOM changes',async failure=>{
    const {selected,request}=await fixture(),{service}=fx!;
    service.reconfigureEnclosure(selected,request);await service.save();
    const originalResolve=fx!.serviceOptions.resolveConfiguration!;
    const active=new ProjectDocumentService({...fx!.serviceOptions,workingDirectory:path.join(fx!.root,'cleanup-rollback'),
      resolveConfiguration:r=>{const result=originalResolve(r);if(failure==='physical'&&!r.selectedOptionIds.length)result.physical!.zones[0]!.lengthMm=100;return result;}});
    try{
      active.open(fx!.file);
      const working=path.join(fx!.root,'cleanup-rollback',readdirSync(path.join(fx!.root,'cleanup-rollback')).find(name=>name.endsWith('.lqp'))!),db=new Database(working);
      if(failure==='cleanup-write')db.exec("CREATE TRIGGER refuse_cleanup BEFORE DELETE ON prj_product_snapshot WHEN OLD.manufacturer_code='BLANK' BEGIN SELECT RAISE(ABORT,'injected cleanup failure'); END;");
      if(failure==='bookkeeping')mkdirSync(working+'.recovery.json');
      const image=tables(db),view=active.current(),bytes=readFileSync(fx!.file);
      expect(()=>active.reconfigureEnclosure(selected,{modelId:1,selectedOptionIds:[]})).toThrow();
      expect(tables(db)).toEqual(image);expect(active.current()).toEqual(view);expect(readFileSync(fx!.file)).toEqual(bytes);
      expect(db.prepare("SELECT * FROM prj_product_snapshot WHERE manufacturer_code='BLANK'").get()).toBeDefined();
      db.close();if(failure==='bookkeeping')rmSync(working+'.recovery.json',{recursive:true});
    }finally{active.close();}
  });

  it('a changed BOM role keeps the article price and resets all role-specific commercial fields',async()=>{
    const {selected,request}=await fixture(1,false,db=>{
      db.exec(`UPDATE cat_config_model_article SET role='component' WHERE model_id=1;
        INSERT INTO cat_config_rule(id,model_id,seq) VALUES(101,1,2);
        INSERT INTO cat_config_rule_condition(rule_id,option_id) VALUES(101,20);
        INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,product_id,ref_brand_marchio,ref_manufacturer_code,quantity,article_role)
          SELECT 101,0,'article',id,'GEN','PART',1,'primary' FROM cat_product WHERE manufacturer_code='PART';`);
    });
    const db=raw(),before=db.prepare("SELECT b.* FROM prj_item_bom b JOIN prj_item i ON i.id=b.item_id WHERE i.model_code='frame'").get() as {id:number;snapshot_id:number};
    fx!.db.exec("UPDATE com_product_price SET list_price_unit_e4=list_price_unit_e4*2");
    fx!.service.reconfigureEnclosure(selected,request);
    const row=db.prepare("SELECT b.* FROM prj_item_bom b JOIN prj_item i ON i.id=b.item_id WHERE i.model_code='frame' AND b.snapshot_id=?").get(before.snapshot_id) as {id:number};
    expect(row).toMatchObject({snapshot_id:before.snapshot_id,role:'component',quantity_per_item:1,sale_price_unit_e4:100000,
      line_discount_bp:0,purchase_discount_chain:null,purchase_discount_bp:null,net_cost_unit_e4:null,markup_bp:null,price_locked:0});
    expect(row.id).not.toBe(before.id);
    expect(db.prepare("SELECT primary_snapshot_id FROM prj_item WHERE model_code='frame'").pluck().get()).toBeNull();
    expect(db.prepare('SELECT id FROM prj_product_snapshot WHERE id=?').pluck().get(before.snapshot_id)).toBe(before.snapshot_id);
    db.close();
  });

  it.each(['duplicate','missing-price'])('rejects %s historical article data atomically',async mode=>{
    const {selected,request}=await fixture(3),db=raw();
    if(mode==='duplicate')db.exec(`INSERT INTO prj_item_bom(item_id,seq,snapshot_id,quantity_per_item,role,sale_price_unit_e4)
      SELECT item_id,99,snapshot_id,quantity_per_item,role,sale_price_unit_e4 FROM prj_item_bom WHERE item_id=1;`);
    else db.exec('UPDATE prj_item_bom SET sale_price_unit_e4=NULL WHERE item_id=1');
    const image=tables(db),view=fx!.service.current(),bytes=readFileSync(fx!.file);
    expect(()=>fx!.service.reconfigureEnclosure(selected,request)).toThrow(expect.objectContaining({code:mode==='duplicate'?'project_engineering_stale':'price_snapshot_conflict'}));
    expect(tables(db)).toEqual(image);expect(fx!.service.current()).toEqual(view);expect(readFileSync(fx!.file)).toEqual(bytes);db.close();
  });

  it.each(['brandMarchio','manufacturerCode','listPriceUnitE4','priceIssuerSigla','priceListinoNumber','priceValidFrom','priceMultiplierOriginal'] as const)
    ('rejects a new article whose %s changed between resolution and source lookup',async field=>{
    const {selected,request}=await fixture(3),{service}=fx!;await service.save();
    const lookup=fx!.serviceOptions.resolveCatalogueProduct!;
    const active=new ProjectDocumentService({...fx!.serviceOptions,workingDirectory:path.join(fx!.root,'commerce-source'),
      resolveCatalogueProduct:id=>{const source=lookup(id);return {...source,[field]:typeof source[field]==='number'?Number(source[field])+1:'changed'};}});
    try{
      active.open(fx!.file);
      const db=new Database(path.join(fx!.root,'commerce-source',readdirSync(path.join(fx!.root,'commerce-source')).find(name=>name.endsWith('.lqp'))!));
      const image=tables(db),view=active.current(),bytes=readFileSync(fx!.file);
      expect(()=>active.reconfigureEnclosure(selected,request)).toThrow(expect.objectContaining({code:'catalogue_changed'}));
      expect(tables(db)).toEqual(image);expect(active.current()).toEqual(view);expect(readFileSync(fx!.file)).toEqual(bytes);db.close();
    }finally{active.close();}
  });
});

it('selects the second physical unit by UUID and keeps an identical configured item independent',async()=>{
  const {enclosure,selected,request}=await fixture(3);
  const {service}=fx!,before=service.current()!,second=before.physicalNodes[1]!.uuid;
  const panel=before.configuredItems.find(item=>item.modelKind==='support')!.uuid;
  const device=before.configuredItems.find(item=>item.modelKind==='device')!.uuid;
  service.placeChild({itemUuid:panel,parentUuid:second,zoneNo:0,startUnits:270,viewCode:'front'});
  const panelNode=service.current()!.physicalNodes[1]!.children[0]!.uuid;
  service.placeChild({itemUuid:device,parentUuid:panelNode,zoneNo:0,startUnits:11,viewCode:'front'});
  const identical=service.addConfiguredItem(request).configuredItems.at(-1)!.uuid;
  service.placeRoot({itemUuid:identical,viewCode:'front',rootXMm:1500,rootYMm:500});
  const original=service.current()!,db=raw();
  const rows=db.prepare('SELECT * FROM prj_node ORDER BY id').all() as Record<string,unknown>[];
  const after=service.reconfigureEnclosure(second,request),changed=after.physicalNodes[1]!.itemUuid!;
  expect(after.physicalNodes[0]).toEqual(original.physicalNodes[0]);
  expect(after.physicalNodes[0]!.uuid).toBe(selected);
  expect(after.physicalNodes[1]!.children).toEqual(original.physicalNodes[1]!.children);
  expect(after.physicalNodes[2]).toEqual(original.physicalNodes[2]);
  expect(changed).not.toBe(enclosure);expect(changed).not.toBe(identical);
  expect(after.lines.find(line=>line.itemUuid===enclosure)!.quantity).toBe(2);
  expect(after.lines.find(line=>line.itemUuid===identical)!.quantity).toBe(1);
  expect(after.lines.find(line=>line.itemUuid===changed)!.quantity).toBe(1);
  const resultRows=db.prepare('SELECT * FROM prj_node ORDER BY id').all() as Record<string,unknown>[];
  expect(resultRows.map(row=>({...row,item_id:row.uuid===second?'changed':row.item_id})))
    .toEqual(rows.map(row=>({...row,item_id:row.uuid===second?'changed':row.item_id})));
  db.close();
});

it('updates quantities of retained components, removes old options, and keeps historical prices/discounts/row identity',async()=>{
  const {selected,request}=await fixture();
  fx!.db.exec(`INSERT INTO cat_config_rule(id,model_id,seq) VALUES(101,1,2);
    INSERT INTO cat_config_rule_condition(rule_id,option_id) VALUES(101,31);
    INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,product_id,ref_brand_marchio,ref_manufacturer_code,quantity,article_role)
      SELECT 101,0,'article',id,'GEN','PART',0.5,'component' FROM cat_product WHERE manufacturer_code='PART';`);
  const db=raw(),old=db.prepare('SELECT id FROM prj_item_bom WHERE item_id=1 AND seq=0').pluck().get();
  const after=fx!.service.reconfigureEnclosure(selected,request);
  expect(after.configuredItems[0]!.bom[0]).toMatchObject({quantityPerItem:1.5,salePriceUnitE4:100000,lineDiscountBp:1250});
  expect(db.prepare('SELECT id FROM prj_item_bom WHERE item_id=1 AND seq=0').pluck().get()).toBe(old);
  const removed=fx!.service.reconfigureEnclosure(selected,{modelId:1,selectedOptionIds:[]});
  expect(removed.configuredItems[0]!.bom).toHaveLength(1);
  expect(removed.configuredItems[0]!.bom[0]).toMatchObject({quantityPerItem:1,salePriceUnitE4:100000,lineDiscountBp:1250});
  expect(removed.distinta.map(row=>row.manufacturerCode)).toEqual(['PART']);
  expect(fx!.service.undo().configuredItems[0]!.bom).toEqual(after.configuredItems[0]!.bom);
  db.close();
});

it.each(['legacy','stale-catalogue','invalid-node','support-node','unavailable-catalogue'])('handles %s through the existing lifecycle boundary',async mode=>{
  const {selected,panelNode,request}=await fixture();
  const db=raw();
  if(mode==='legacy')db.exec('UPDATE prj_item SET engineering_provenance=NULL,source_adapter_code=NULL,source_adapter_version=NULL,source_import_fingerprint=NULL');
  if(mode==='stale-catalogue')fx!.db.exec("UPDATE app_source_import SET adapter_version='10' WHERE became_current=1");
  if(mode==='unavailable-catalogue')fx!.unavailable();
  const before=fx!.dump(),view=fx!.service.current();
  if(mode==='legacy')expect(fx!.service.reconfigureEnclosure(selected,request).configuredItems[0]!.sourceAdapterVersion)
    .toBe(TIQUADRI_ENGINEERING_ADAPTER.version);
  else {
    const uuid=mode==='invalid-node'?'00000000-0000-4000-8000-000000000001':mode==='support-node'?panelNode:selected;
    const code=mode==='stale-catalogue'?'engineering_data_stale':mode==='unavailable-catalogue'?'catalogue_unavailable':'invalid_enclosure';
    expect(()=>fx!.service.reconfigureEnclosure(uuid,request)).toThrow(expect.objectContaining({code}));
    expect(fx!.dump()).toEqual(before);expect(fx!.service.current()).toEqual(view);
  }
  db.close();
});

it('checks a dependent axis changed by defaults and records its effective selection source',async()=>{
  const {selected}=await fixture(),db=raw();
  fx!.db.exec(`UPDATE cat_config_option SET parent_option_id=20 WHERE id=30;
    UPDATE cat_config_option SET parent_option_id=21,is_default=1 WHERE id=31;
    UPDATE cat_config_axis SET editable_when_placed=0 WHERE id=3;`);
  db.exec("UPDATE prj_item_selection SET editable_when_placed=0 WHERE dimension_code='plinth'");
  const before=fx!.dump();
  expect(()=>fx!.service.reconfigureEnclosure(selected,{modelId:1,selectedOptionIds:[21]}))
    .toThrow(expect.objectContaining({code:'axis_not_editable',message:expect.stringContaining('Plinth')}));
  expect(fx!.dump()).toEqual(before);
  fx!.db.exec('UPDATE cat_config_axis SET editable_when_placed=1 WHERE id=3');
  db.exec("UPDATE prj_item_selection SET editable_when_placed=1 WHERE dimension_code='plinth'");
  const after=fx!.service.reconfigureEnclosure(selected,{modelId:1,selectedOptionIds:[21]});
  expect(after.configuredItems[0]!.selections).toMatchObject([
    {dimensionCode:'door',valueCode:'closed',selectionSource:'user'},
    {dimensionCode:'plinth',valueCode:'high',selectionSource:'default'}]);
  db.close();
});
