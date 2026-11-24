import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFrontVectorAssets } from "../src/main/catalogue/vector-assets.js";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { guardConfiguredStructuralItem } from "../src/main/project/design-compatibility.js";
import { ProjectDocumentService, type ProjectDocumentServiceOptions } from "../src/main/project/project-document-service.js";
import { importDrawingBlocks } from "../src/main/sources/tiquadri/drawing-assets.js";
import { structuralPool } from "../src/renderer/project/placement-workflow.js";
import type { ConfigurationResult } from "../src/shared/configuration.js";
import type { CatalogueProductSnapshotSource, ProjectDocumentView } from "../src/shared/project.js";

const article:CatalogueProductSnapshotSource={brandMarchio:"TEST",brandName:"Test",
  manufacturerCode:"ARTICLE",ean:null,shortDescription:"Article",description:"Article",
  unitOfMeasure:"PCE",categoryCode:null,categoryPathLabel:null,familyCode:null,familyName:null,
  priceIssuerSigla:"TEST",priceListinoNumber:"1",priceValidFrom:"2026-09-26",
  listPriceUnitE4:10_000,priceMultiplierOriginal:1,attributes:[]};

// Model ids: 1 and 5 are enclosures, 2 and 3 are supports, 6 is an accessory.
const ENCLOSURES=[1,5];
const kindOf=(id:number)=>ENCLOSURES.includes(id)?"enclosure":id===6?"accessory":"support";

function configured(id:number):ConfigurationResult {
  const kind=kindOf(id);
  const key=(view:string)=>`${kind}-${id}-${view}`;
  const physical=kind==="accessory"?null:{id,code:`profile-${id}`,name:`Profile ${id}`,kind,profileKey:null,
    fitClass:{id,code:kind==="enclosure"?"FRAME":"PANEL",name:kind},depthMm:null,outerDepthMm:null,
    usableDepthMm:null,demands:[],views:[
      {code:"front",widthMm:500,heightMm:kind==="enclosure"?1000:100,insertDxMm:0,insertDyMm:0,
        symbolKind:"rectangle",assetKey:key("front")},
      ...(kind==="support"?[{code:"front_alt1",widthMm:500,heightMm:100,insertDxMm:0,insertDyMm:0,
        symbolKind:"rectangle",assetKey:key("alt")}]:[])],
    zones:kind==="enclosure"?[{zoneNo:0,layout:"stack",capacityKindCode:null,capacityAmount:200,
      originXMm:0,originYMm:0,lengthMm:200,breadthMm:500,direction:"vertical",pitchMm:1,
      requiredViewCode:"front"}]:[],slots:[],
    constraints:kind==="support"?[{relation:"ancestor",acceptSetCode:"frame",classCodes:["FRAME"]}]:[]};
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

/** Brand-neutral catalogue: two enclosure variants provide different contexts; each support accepts one. */
function catalogue(folder:string) {
  const db=openMigratedLqDatabase({databaseFilename:path.join(folder,"lq.db"),
    backupDirectory:path.join(folder,"librequadri-backups"),migrationsFolder:path.resolve("db/migrations/lq")});
  db.exec(`INSERT INTO cat_brand(id,metel_marchio,name,source) VALUES(1,'TEST','Test','manual');
    INSERT INTO cat_config_model(id,brand_id,code,name,model_kind,definition_fingerprint,source,context_policy) VALUES
      (1,1,'model-1','Enclosure A','enclosure','definition-1','manual','unrestricted'),
      (5,1,'model-5','Enclosure B','enclosure','definition-5','manual','unrestricted'),
      (2,1,'model-2','Panel A','support','definition-2','manual','restricted'),
      (3,1,'model-3','Panel B','support','definition-3','manual','restricted');
    INSERT INTO cat_config_context(id,brand_id,code,name,source) VALUES(1,1,'ctx.a','A','manual'),(2,1,'ctx.b','B','manual');
    INSERT INTO cat_config_model_context(model_id,role,context_id)
      VALUES(1,'provides',1),(5,'provides',2),(2,'accepts',1),(3,'accepts',2);
    INSERT INTO cat_range_node(id,brand_id,code,name,node_kind,source,design_navigable)
      VALUES(1,1,'section','Section','section','manual',1);
    INSERT INTO cat_range_node_model(node_id,model_id) VALUES(1,1),(1,2),(1,3),(1,5);`);
  return db;
}

function options(folder:string,extra:Partial<ProjectDocumentServiceOptions>={}):ProjectDocumentServiceOptions {
  return {workingDirectory:path.join(folder,"working"),incomingDirectory:path.join(folder,"incoming"),
    backupDirectory:path.join(folder,"backup"),migrationsFolder:path.resolve("db/migrations/project"),
    appVersion:"test",resolveCatalogueProduct:()=>article,
    resolveConfiguration:request=>configured(request.modelId),...extra};
}
const metadata={title:"Case",description:"",notes:"",projectType:"civil",executor:"",
  date:"2026-09-28",companyName:"Client",companyDescription:""} as const;
const request=(modelId:number)=>({modelId,selectedOptionIds:[]});
const front="front";

async function setup(extra:Partial<ProjectDocumentServiceOptions>={}) {
  const folder=mkdtempSync(path.join(tmpdir(),"librequadri-structural-pool-"));folders.push(folder);
  const db=catalogue(folder);
  const guard=vi.fn((_project:unknown,input:{modelId:number})=>input.modelId===3?
    {ok:false,code:"required_context_not_provided"}:{ok:true,code:"compatible"});
  const service=new ProjectDocumentService(options(folder,{designGuard:guard,
    designItemGuard:(project,input)=>guardConfiguredStructuralItem(db,project,input),...extra}));
  const destination=path.join(folder,"case.lqp");
  await service.create({destinationPath:destination,...metadata});
  return {folder,db,service,guard,destination};
}
const quantity=(view:ProjectDocumentView,modelCode:string)=>{
  const item=view.configuredItems.find(row=>row.modelCode===modelCode)!;
  return view.lines.find(line=>line.itemUuid===item.uuid)!.quantity;
};
const nodes=(view:ProjectDocumentView)=>view.physicalNodes.flatMap(function flat(node):typeof view.physicalNodes{
  return [node,...node.children.flatMap(flat)];
});

describe("structural pool and guarded structural placement",()=>{
  it("adds a support without a node: Q=1, P=0, available=1; merges keep Q semantics",async()=>{
    const {service,guard}=await setup();
    const root=service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    const before=service.current()!;
    for(const invalid of [
      {kind:"enclosure" as const,configuration:request(5),place:false},
      {kind:"support" as const,parentUuid:root.uuid,zoneNo:0,configuration:request(2),place:false},
      {kind:"support" as const,configuration:request(2),place:false},
    ])expect(()=>service.addStructural(invalid)).toThrow();
    expect(service.current()).toEqual(before);
    const first=service.addStructural({kind:"support",parentUuid:root.uuid,place:false,configuration:request(2)});
    expect(guard).toHaveBeenLastCalledWith(expect.anything(),
      {kind:"support",modelId:2,parentUuid:root.uuid},request(2));
    expect(nodes(first).filter(node=>node.nodeKind==="support")).toHaveLength(0);
    expect(structuralPool(first).map(entry=>[entry.item.modelCode,entry.quantity,entry.placed,entry.available]))
      .toEqual([["model-2",1,0,1]]);
    const merged=service.addStructural({kind:"support",parentUuid:root.uuid,place:false,configuration:request(2)});
    expect(merged.configuredItems.filter(item=>item.modelCode==="model-2")).toHaveLength(1);
    expect(structuralPool(merged).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[2,0,2]]);
    // An ordinary placing add still merges into the same configured item and consumes one unit.
    const placing=service.addStructural({kind:"support",parentUuid:root.uuid,configuration:request(2)});
    expect(structuralPool(placing).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[3,1,2]]);
    expect(placing.configuredItems.filter(item=>item.modelCode==="model-2")).toHaveLength(1);
  });

  it("adds N units of a Pannello as one configured item with quantity N, never as N physical nodes",async()=>{
    const {service,folder,destination}=await setup();
    const root=service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    const added=service.addStructural({kind:"support",parentUuid:root.uuid,place:false,quantity:5,configuration:request(2)});
    expect(nodes(added).filter(node=>node.nodeKind==="support")).toHaveLength(0);
    expect(added.configuredItems.filter(item=>item.modelCode==="model-2")).toHaveLength(1);
    expect(quantity(added,"model-2")).toBe(5);
    // Da posizionare shows Q−P, and the Preventivo is still one configured line with the resulting quantity.
    expect(structuralPool(added).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[5,0,5]]);
    expect(added.lines.filter(line=>line.itemUuid!==undefined&&line.lineType==="item"&&
      added.configuredItems.find(item=>item.uuid===line.itemUuid)?.modelCode==="model-2")).toHaveLength(1);
    const line=added.lines.find(row=>row.itemUuid===added.configuredItems.find(item=>item.modelCode==="model-2")!.uuid)!;
    expect(line.lineTotalE4).toBe(5*10_000);
    // The existing Q22 merge: an identical add raises the same item; quantity defaults to 1 when omitted.
    const merged=service.addStructural({kind:"support",parentUuid:root.uuid,place:false,quantity:3,configuration:request(2)});
    expect(merged.configuredItems.filter(item=>item.modelCode==="model-2")).toHaveLength(1);
    expect(structuralPool(merged).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[8,0,8]]);
    const plain=service.addStructural({kind:"support",parentUuid:root.uuid,place:false,configuration:request(2)});
    expect(structuralPool(plain).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[9,0,9]]);
    // Placing individual Pannelli consumes units normally.
    const pooled=structuralPool(plain)[0]!;
    const placed=service.placeStructuralItem({action:"insertPackedChild",
      input:{itemUuid:pooled.item.uuid,parentUuid:root.uuid,zoneNo:0,viewCode:front}});
    expect(structuralPool(placed).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[9,1,8]]);
    expect(nodes(placed).filter(node=>node.nodeKind==="support")).toHaveLength(1);
    // The largest single add is 99 and merges the same way.
    const largest=service.addStructural({kind:"support",parentUuid:root.uuid,place:false,quantity:99,configuration:request(2)});
    expect(quantity(largest,"model-2")).toBe(108);
    // Save and reopen preserve the quantity.
    await service.save();service.close();
    const reader=new ProjectDocumentService(options(folder,{designGuard:()=>({ok:true,code:"compatible"})}));
    try{
      const reopened=reader.open(destination);
      expect(quantity(reopened,"model-2")).toBe(108);
      expect(structuralPool(reopened).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[108,1,107]]);
    }finally{reader.close();}
  });

  it("refuses an invalid or misplaced quantity without any mutation, and leaves Carpenteria and devices alone",async()=>{
    const {service}=await setup();
    const root=service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    const before=service.current()!;
    for(const bad of [0,-1,100,1000,1.5,Number.NaN,Number.POSITIVE_INFINITY,"3" as unknown as number,null as unknown as number])
      expect(()=>service.addStructural({kind:"support",parentUuid:root.uuid,place:false,quantity:bad,configuration:request(2)}),String(bad))
        .toThrow("Quantità non valida");
    // A quantity belongs only to an unplaced Pannello: the placing add and the Carpenteria stay one unit.
    expect(()=>service.addStructural({kind:"support",parentUuid:root.uuid,quantity:2,configuration:request(2)})).toThrow("senza posizionamento");
    expect(()=>service.addStructural({kind:"enclosure",quantity:2,configuration:request(5)})).toThrow("senza posizionamento");
    expect(()=>service.addStructural({kind:"device",parentUuid:root.uuid,place:false,quantity:2,configuration:request(2)})).toThrow("senza posizionamento");
    expect(service.current()).toEqual(before);
    // The Carpenteria immediate placement is unchanged: one unit, placed.
    const second=service.addStructural({kind:"enclosure",configuration:request(5)});
    expect(second.physicalNodes.filter(node=>node.nodeKind==="enclosure")).toHaveLength(2);
    expect(quantity(second,"model-5")).toBe(1);
  });

  it("rejects an incompatible or failing add-time guard without mutation",async()=>{
    const {service}=await setup();
    const root=service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    const before=service.current()!;
    expect(()=>service.addStructural({kind:"support",parentUuid:root.uuid,place:false,configuration:request(3)}))
      .toThrow("required_context_not_provided");
    expect(service.current()).toEqual(before);
  });

  it("places a pool support through the catalogue guard: P=1 then exhausted; Q>P keeps units available",async()=>{
    const {service}=await setup();
    const root=service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    service.addStructural({kind:"support",parentUuid:root.uuid,place:false,configuration:request(2)});
    const pooled=structuralPool(service.current()!)[0]!;
    const input={itemUuid:pooled.item.uuid,parentUuid:root.uuid,zoneNo:0,viewCode:front};
    const placed=service.placeStructuralItem({action:"insertPackedChild",input});
    expect(structuralPool(placed).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[1,1,0]]);
    expect(nodes(placed).filter(node=>node.nodeKind==="support")).toHaveLength(1);
    const exhausted=service.current()!;
    expect(()=>service.placeStructuralItem({action:"insertPackedChild",input})).toThrow(/quantità/);
    expect(service.current()).toEqual(exhausted);
    service.addStructural({kind:"support",parentUuid:root.uuid,place:false,configuration:request(2)});
    service.addStructural({kind:"support",parentUuid:root.uuid,place:false,configuration:request(2)});
    expect(structuralPool(service.current()!).map(entry=>[entry.quantity,entry.placed,entry.available]))
      .toEqual([[3,1,2]]);
    const second=service.placeStructuralItem({action:"insertPackedChild",input});
    expect(structuralPool(second).map(entry=>[entry.quantity,entry.placed,entry.available])).toEqual([[3,2,1]]);
  });

  it("supports an explicit placeChild target for a pooled support",async()=>{
    const {service}=await setup();
    const root=service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    service.addStructural({kind:"support",parentUuid:root.uuid,place:false,configuration:request(2)});
    const itemUuid=structuralPool(service.current()!)[0]!.item.uuid;
    const view=service.placeStructuralItem({action:"placeChild",input:{itemUuid,parentUuid:root.uuid,
      zoneNo:0,viewCode:front,startUnits:100}});
    expect(nodes(view).find(node=>node.nodeKind==="support")).toMatchObject({startUnits:100,yMm:100});
    expect(()=>service.placeStructuralItem({action:"placeChild",input:{itemUuid,
      zoneNo:0,viewCode:front,startUnits:0}})).toThrow("Involucro");
  });

  it("refuses without mutation for another root's context, a changed fingerprint and wrong items",async()=>{
    const {service,db}=await setup();
    service.addStructural({kind:"enclosure",configuration:request(1)});
    const [rootA,rootB]=service.addStructural({kind:"enclosure",configuration:request(5)}).physicalNodes;
    service.addStructural({kind:"support",parentUuid:rootA!.uuid,place:false,configuration:request(2)});
    const itemUuid=structuralPool(service.current()!)[0]!.item.uuid;
    const enclosureUuid=service.current()!.configuredItems.find(item=>item.modelKind==="enclosure")!.uuid;
    const input=(parentUuid:string)=>({itemUuid,parentUuid,zoneNo:0,viewCode:front});
    const before=service.current()!;
    expect(()=>service.placeStructuralItem({action:"insertPackedChild",input:input(rootB!.uuid)}))
      .toThrow("required_context_not_provided");
    expect(()=>service.placeStructuralItem({action:"insertPackedChild",
      input:{...input(rootA!.uuid),itemUuid:enclosureUuid}})).toThrow("pannello");
    expect(()=>service.placeStructuralItem({action:"insertPackedChild",
      input:{...input(rootA!.uuid),itemUuid:"10000000-0000-4000-8000-000000000001"}})).toThrow("non trovato");
    expect(service.current()).toEqual(before);
    db.exec("UPDATE cat_config_model SET definition_fingerprint='changed' WHERE code='model-2'");
    expect(()=>service.placeStructuralItem({action:"insertPackedChild",input:input(rootA!.uuid)}))
      .toThrow("model_unavailable");
    expect(service.current()).toEqual(before);
    db.exec("UPDATE cat_config_model SET definition_fingerprint='definition-2' WHERE code='model-2';"+
      "UPDATE cat_config_model SET definition_fingerprint='changed' WHERE code='model-1'");
    expect(()=>service.placeStructuralItem({action:"insertPackedChild",input:input(rootA!.uuid)}))
      .toThrow("container_unavailable");
    expect(service.current()).toEqual(before);
    db.exec("UPDATE cat_config_model SET definition_fingerprint='definition-1' WHERE code='model-1'");
    expect(nodes(service.placeStructuralItem({action:"insertPackedChild",input:input(rootA!.uuid)}))
      .filter(node=>node.nodeKind==="support")).toHaveLength(1);
  });

  it("refuses pool placement without mutation when catalogue verification is unavailable",async()=>{
    const unavailable=await setup({designItemGuard:undefined});
    const root=unavailable.service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    unavailable.service.addStructural({kind:"support",parentUuid:root.uuid,place:false,configuration:request(2)});
    const itemUuid=structuralPool(unavailable.service.current()!)[0]!.item.uuid;
    const before=unavailable.service.current()!;
    const input={itemUuid,parentUuid:root.uuid,zoneNo:0,viewCode:front};
    expect(()=>unavailable.service.placeStructuralItem({action:"insertPackedChild",input}))
      .toThrow("Verifica del catalogo non disponibile");
    expect(unavailable.service.current()).toEqual(before);

    const {service,db}=await setup();
    const liveRoot=service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    service.addStructural({kind:"support",parentUuid:liveRoot.uuid,place:false,configuration:request(2)});
    const liveInput={itemUuid:structuralPool(service.current()!)[0]!.item.uuid,parentUuid:liveRoot.uuid,
      zoneNo:0,viewCode:front};
    const liveBefore=service.current()!;
    db.close();
    expect(()=>service.placeStructuralItem({action:"insertPackedChild",input:liveInput})).toThrow();
    expect(service.current()).toEqual(liveBefore);
  });

  it("moves an already placed support within its enclosure from the portable snapshot alone",async()=>{
    const {service,destination,folder}=await setup();
    const root=service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    service.addStructural({kind:"support",parentUuid:root.uuid,place:false,configuration:request(2)});
    const itemUuid=structuralPool(service.current()!)[0]!.item.uuid;
    service.placeStructuralItem({action:"insertPackedChild",
      input:{itemUuid,parentUuid:root.uuid,zoneNo:0,viewCode:front}});
    await service.save();service.closeCurrent();service.close();
    const offline=new ProjectDocumentService(options(path.join(folder,"offline")));
    try {
      const reopened=offline.open(destination);
      const support=nodes(reopened).find(node=>node.nodeKind==="support")!;
      const targets=offline.placementTargets({parentUuid:root.uuid,nodeUuid:support.uuid});
      // A stack zone keeps explicit positions, so the accepted mutation is a plain node move.
      const target=targets.targets.find(candidate=>candidate.action==="moveNode"&&
        candidate.input.startUnits===100)!;
      expect(target).toBeDefined();
      const moved=offline.moveNode(support.uuid,target.input as never);
      expect(nodes(moved).find(node=>node.nodeKind==="support")).toMatchObject({startUnits:100});
      const back=offline.movePackedNode(support.uuid,{parentUuid:root.uuid,zoneNo:0,viewCode:front,startUnits:0});
      expect(nodes(back).find(node=>node.nodeKind==="support")).toMatchObject({startUnits:0});
      offline.movePackedNode(support.uuid,{parentUuid:root.uuid,zoneNo:0,viewCode:front,startUnits:100});
      expect(structuralPool(offline.current()!).map(entry=>[entry.quantity,entry.placed,entry.available]))
        .toEqual([[1,1,0]]);
      // Pool placement, unlike a same-enclosure move, needs the catalogue.
      expect(()=>offline.placeStructuralItem({action:"insertPackedChild",
        input:{itemUuid,parentUuid:root.uuid,zoneNo:0,viewCode:front}})).toThrow("Verifica del catalogo");
    }finally{offline.close();}
  });
});

describe("front assets for unplaced physical items",()=>{
  it("requests placed views first, then every view of items with unplaced units",async()=>{
    const requested:string[][]=[];
    const {service}=await setup({resolveFrontAssets:keys=>{requested.push([...keys]);return {};}});
    const root=service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    service.addStructural({kind:"support",parentUuid:root.uuid,place:false,configuration:request(2)});
    service.frontAssets();
    expect(requested.at(-1)).toEqual(["enclosure-1-front","support-2-alt","support-2-front"]);
    const itemUuid=structuralPool(service.current()!)[0]!.item.uuid;
    service.placeStructuralItem({action:"insertPackedChild",
      input:{itemUuid,parentUuid:root.uuid,zoneNo:0,viewCode:front}});
    service.frontAssets();
    // Fully placed: only the placed view of each node remains requested.
    expect(requested.at(-1)).toEqual(["enclosure-1-front","support-2-front"]);
    service.addStructural({kind:"support",parentUuid:root.uuid,place:false,configuration:request(2)});
    service.frontAssets();
    expect(requested.at(-1)).toEqual(["enclosure-1-front","support-2-front","support-2-alt"]);
    service.addConfiguredItem(request(6));
    service.frontAssets();
    expect(requested.at(-1)).toEqual(["enclosure-1-front","support-2-front","support-2-alt"]);
  });

  it("does not expose views of non-physical or non-structural configured products",async()=>{
    const requested:string[][]=[];
    const {service,destination}=await setup({resolveFrontAssets:keys=>{requested.push([...keys]);return {};}});
    const root=service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    service.addStructural({kind:"support",parentUuid:root.uuid,place:false,configuration:request(2)});
    service.addConfiguredItem(request(6));
    await service.save();service.closeCurrent();
    const raw=new Database(destination);
    try {
      raw.exec(`INSERT INTO prj_item_view(item_id,view_code,width_mm,height_mm,insert_dx_mm,insert_dy_mm,symbol_kind,asset_key)
        SELECT id,'front',10,10,0,0,'rectangle','leak-accessory' FROM prj_item WHERE model_kind='accessory';
        UPDATE prj_item SET phys_status='not_physical' WHERE model_kind='support';`);
    }finally{raw.close();}
    service.open(destination);
    service.frontAssets();
    expect(requested.at(-1)).toEqual(["enclosure-1-front"]);
  });

  it("serves an unplaced item's vector through the validated local reader; tampering and licence are enforced",async()=>{
    const holder:{db?:Database.Database;root?:string}={};
    const {service,db,folder}=await setup({
      resolveFrontAssets:keys=>readFrontVectorAssets(holder.db!,holder.root!,keys)});
    holder.db=db;holder.root=path.join(folder,"assets");
    db.exec(`INSERT INTO cat_phys_class(code,name,source) VALUES('test','Test','manual');
      INSERT INTO cat_phys_profile_set(code,name,source) VALUES('test','Test','manual');
      INSERT INTO cat_phys_profile(code,profile_set_id,profile_key,profile_kind,name,fit_class_id,source)
        VALUES('test.panel',1,1,'support','Panel',1,'manual');
      INSERT INTO cat_phys_view(profile_id,view_code,width_mm,height_mm,symbol_kind,asset_key)
        VALUES(1,'front',500,100,'test','support-2-front');`);
    const dxf=["0","BLOCK","2","support-2-front","10","0","20","0","0","LINE","10","0","20","0","11","40","21","0",
      "0","LINE","10","40","20","0","11","40","21","5","0","ENDBLK"].join("\r\n")+"\r\n";
    expect(importDrawingBlocks({database:db,assetsRoot:holder.root,source:Buffer.from("synthetic"),
      sourceName:"x.mdb",blocks:[{NOME:"support-2-front",CONTENUTO:dxf}]})).toMatchObject({resolved:1});
    const root=service.addStructural({kind:"enclosure",configuration:request(1)}).physicalNodes[0]!;
    service.addStructural({kind:"support",parentUuid:root.uuid,place:false,configuration:request(2)});
    expect(Object.keys(service.frontAssets())).toEqual(["support-2-front"]);
    expect(service.frontAssets()["support-2-front"]!.strokes).toContain("L 40 0");
    const rel=db.prepare(`SELECT a.rel_path FROM cat_asset_variant v JOIN cat_asset a ON a.id=v.asset_id
      WHERE v.asset_key='support-2-front'`).pluck().get() as string;
    const filename=path.join(holder.root,rel);
    const original=readFileSync(filename,"utf8");
    writeFileSync(filename,original+"<script/>");
    expect(service.frontAssets()).toEqual({});
    writeFileSync(filename,original);
    expect(Object.keys(service.frontAssets())).toEqual(["support-2-front"]);
    db.exec("UPDATE cat_asset_license SET may_display=0 WHERE code='manufacturer_unverified'");
    expect(service.frontAssets()).toEqual({});
  });
});
