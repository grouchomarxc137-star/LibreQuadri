import { buildDocumentModel } from "../src/main/documents/document-model.js";
import { calculateCommercial } from "../src/shared/commercial.js";
import { isOutOfCatalogue } from "../src/shared/out-of-catalogue.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { openCurrentProjectDatabase } from "../src/main/database/project-migrations.js";
import { insertConfiguredItem } from "../src/main/project/configured-items.js";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import type { ConfigurationResult } from "../src/shared/configuration.js";
import type { CatalogueProductSnapshotSource } from "../src/shared/project.js";

const article:CatalogueProductSnapshotSource={brandMarchio:"TEST",brandName:"Test",
  manufacturerCode:"ARTICLE",ean:null,shortDescription:"Article",description:"Article",
  unitOfMeasure:"PCE",categoryCode:null,categoryPathLabel:null,familyCode:null,familyName:null,
  priceIssuerSigla:"TEST",priceListinoNumber:"1",priceValidFrom:"2026-09-26",
  listPriceUnitE4:10_000,priceMultiplierOriginal:1,attributes:[]};

function configured(id:number,kind:"enclosure"|"support"):ConfigurationResult {
  return {model:{id,code:`model-${id}`,name:`Model ${id}`,kind,brandMarchio:"TEST",active:true,
    obsolete:false,commercialContribution:"articles",definitionFingerprint:`definition-${id}`,sourceRef:null,baseProfileId:id,
    maxInsertQty:null,axes:[],budgets:[],relations:[]},selectedOptionIds:[],defaultedOptionIds:[],
    commercialContribution:"articles",matchingRuleIds:[],fingerprint:`config-${id}`,status:"complete",issues:[],bom:[{
      brandMarchio:"TEST",manufacturerCode:"ARTICLE",productId:1,linkedBrandMarchio:"TEST",
      linkedManufacturerCode:"ARTICLE",quantity:1,roles:["primary"],description:"Article",
      unitPriceE4:10_000,rowTotalE4:10_000,currency:"EUR",priceIssuerSigla:"TEST",
      priceListinoNumber:"1",priceValidFrom:"2026-09-26",priceMultiplierOriginal:1}],
    totalE4:10_000,pricedSubtotalE4:10_000,budgets:[],physical:{id,code:`profile-${id}`,
      name:`Profile ${id}`,kind,profileKey:null,fitClass:{id,code:kind==="enclosure"?"FRAME":"PANEL",name:kind},
      depthMm:null,outerDepthMm:null,usableDepthMm:null,demands:[],views:[{code:"front",widthMm:id===4?600:500,
        heightMm:kind==="enclosure"?1000:100,insertDxMm:0,insertDyMm:0,symbolKind:"rectangle",assetKey:null}],
      zones:kind==="enclosure"?[{zoneNo:0,layout:"stack",capacityKindCode:null,
        capacityAmount:200,originXMm:0,originYMm:0,lengthMm:200,breadthMm:500,
        direction:"vertical",pitchMm:1,requiredViewCode:"front"}]:[],slots:[],
      constraints:kind==="support"?[{relation:"ancestor",acceptSetCode:"frame",classCodes:["FRAME"]}]:[]},
    exclusions:[]};
}

describe("structural project workflow",()=>{
  it("returns the exact new or merged item identity from configured insertion",()=>{
    const folder=mkdtempSync(path.join(tmpdir(),"librequadri-structural-item-"));
    const db=openCurrentProjectDatabase(path.join(folder,"project.lqp"),path.resolve("db/migrations/project"));
    try {
      db.prepare("INSERT INTO prj_group(id,uuid,name,sort_order) VALUES(1,?,?,0)")
        .run("10000000-0000-4000-8000-000000000001","Quote");
      const result=configured(2,"support");
      const first=db.transaction(()=>insertConfiguredItem(db,result,()=>article,"2026-09-26"))();
      const merged=db.transaction(()=>insertConfiguredItem(db,result,()=>article,"2026-09-26"))();
      expect(merged).toBe(first);
      expect(db.prepare("SELECT uuid FROM prj_item").pluck().all()).toEqual([first]);
      expect(db.prepare("SELECT quantity FROM prj_line WHERE line_type='item'").pluck().all()).toEqual([2]);
    }finally{db.close();rmSync(folder,{recursive:true,force:true});}
  });
  it("adds and packs configured items atomically, selects a root, and reopens portable snapshots",async()=>{
    const folder=mkdtempSync(path.join(tmpdir(),"librequadri-structural-"));
    const destination=path.join(folder,"case.lqp");
    const guard=vi.fn((_project:unknown,request:{modelId:number;parentUuid?:string})=>
      request.modelId===3?{ok:false,code:"required_context_not_provided"}:{ok:true,code:"compatible"});
    const service=new ProjectDocumentService({workingDirectory:path.join(folder,"working"),
      incomingDirectory:path.join(folder,"incoming"),backupDirectory:path.join(folder,"backup"),
      migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
      resolveCatalogueProduct:()=>article,resolveConfiguration:request=>configured(request.modelId,
        request.modelId===1?"enclosure":"support"),designGuard:guard,
      designDiscover:(_db,request)=>({status:request.kind==="support"&&!request.parentUuid
        ?"container_unavailable":"ready",candidates:[],staleImportIds:[],contextDataUnavailable:0})});
    try {
      await service.create({destinationPath:destination,title:"Case",description:"",notes:"",
        projectType:"civil",executor:"",date:"2026-09-26",companyName:"Client",companyDescription:""});
      expect(service.designDiscover("support").status).toBe("container_unavailable");
      expect(()=>service.addStructural({kind:"support",configuration:{modelId:2,selectedOptionIds:[]}}))
        .toThrow("Seleziona un involucro");
      const first=service.addStructural({kind:"enclosure",configuration:{modelId:1,selectedOptionIds:[]}});
      const firstRoot=first.physicalNodes[0]!;
      expect(firstRoot.nodeKind).toBe("enclosure");
      const second=service.addStructural({kind:"enclosure",configuration:{modelId:1,selectedOptionIds:[]}});
      const secondRoot=second.physicalNodes[1]!;
      expect(secondRoot.uuid).not.toBe(firstRoot.uuid);
      expect(secondRoot.xMm).toBeGreaterThan(firstRoot.xMm!);
      expect(()=>service.addStructural({kind:"support",parentUuid:secondRoot.uuid,
        configuration:{modelId:3,selectedOptionIds:[]}})).toThrow("required_context_not_provided");
      expect(service.current()!.configuredItems).toHaveLength(1);
      const beforeFailedNew=service.current();
      expect(()=>service.addStructural({kind:"support",parentUuid:secondRoot.uuid,zoneNo:0,
        configuration:{modelId:4,selectedOptionIds:[]}})).toThrow("larghezza disponibile");
      expect(service.current()).toEqual(beforeFailedNew);
      const placed=service.addStructural({kind:"support",parentUuid:secondRoot.uuid,
        configuration:{modelId:2,selectedOptionIds:[]}});
      expect(guard).toHaveBeenLastCalledWith(expect.anything(),
        {kind:"support",modelId:2,parentUuid:secondRoot.uuid},{modelId:2,selectedOptionIds:[]});
      expect(placed.physicalNodes[0]!.children).toHaveLength(0);
      expect(placed.physicalNodes[1]!.children).toHaveLength(1);
      expect(placed.physicalNodes[1]!.children[0]).toMatchObject({nodeKind:"support",zoneNo:0});
      const supportUuid=placed.configuredItems.find(item=>item.modelCode==="model-2")!.uuid;
      expect(placed.physicalNodes[1]!.children[0]!.itemUuid).toBe(supportUuid);
      const appended=service.addStructural({kind:"support",parentUuid:secondRoot.uuid,
        configuration:{modelId:2,selectedOptionIds:[]}});
      expect(appended.physicalNodes[1]!.children.map(node=>node.startUnits)).toEqual([0,100]);
      expect(appended.physicalNodes[1]!.children.map(node=>node.itemUuid)).toEqual([supportUuid,supportUuid]);
      expect(appended.configuredItems.filter(item=>item.uuid===supportUuid)).toHaveLength(1);
      expect(appended.lines.find(line=>line.itemUuid===supportUuid)?.quantity).toBe(2);
      const beforeFailedMerge=service.current();
      expect(()=>service.addStructural({kind:"support",parentUuid:secondRoot.uuid,zoneNo:0,
        configuration:{modelId:2,selectedOptionIds:[]}})).toThrow("supera la lunghezza");
      expect(service.current()).toEqual(beforeFailedMerge);
      await service.save();service.closeCurrent();
      const reopened=service.open(destination);
      expect(reopened.configuredItems.map(item=>[item.modelCode,item.physStatus]))
        .toEqual([["model-1","resolved"],["model-2","resolved"]]);
      expect(reopened.physicalNodes[1]!.children).toHaveLength(2);
    }finally{service.close();rmSync(folder,{recursive:true,force:true});}
  });
});

describe("generic preset transactions",()=>{
  type Mode="fixed"|"packed";
  const setup=(mode:Mode,contribution:"none"|"articles")=>{
    const folder=mkdtempSync(path.join(tmpdir(),"librequadri-presets-generic-"));
    const parent=configured(1,"enclosure");
    Object.assign(parent.physical!.zones[0]!,{capacityAmount:400,lengthMm:400});
    // Deliberately out of sequence order: binding follows seq, never array position.
    parent.model.relations=[3,1,2].map(seq=>({relation:"preset_child",seq,toModelId:seq===2?3:2,
      toModelCode:`model-${seq===2?3:2}`,placementMode:mode,quantity:1,positionXMm:17,positionYMm:seq*120}));
    if(mode==="fixed") {
      parent.physical!.zones[0]!.layout="slots";
      parent.physical!.slots=[1,2,3].map(slotNo=>({zoneNo:0,slotNo,xMm:17,yMm:slotNo*120}));
    }
    const child=configured(2,"support");
    if(contribution==="none") {
      child.commercialContribution=child.model.commercialContribution="none";
      child.bom=[];child.totalE4=null;child.pricedSubtotalE4=0;
    }
    const state={middle:"complete" as "complete"|"incomplete"|"throws"};
    const service=new ProjectDocumentService({workingDirectory:path.join(folder,"working"),
      incomingDirectory:path.join(folder,"incoming"),backupDirectory:path.join(folder,"backup"),
      migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",resolveCatalogueProduct:()=>article,
      resolveConfiguration:request=>{
        if(request.modelId===1)return structuredClone(parent);
        if(request.modelId===3){
          if(state.middle==="throws")throw Error("unexpected backend failure");
          const middle={...structuredClone(child),model:{...structuredClone(child.model),id:3,code:"model-3",
            definitionFingerprint:"definition-3"},fingerprint:"config-3"};
          return state.middle==="complete"?middle:{...middle,status:"incomplete",
            issues:[{severity:"error",code:"missing_required",message:"Choose a value"}]};
        }
        return structuredClone(child);
      },designGuard:()=>({ok:true,code:"compatible"})});
    const create=()=>service.create({destinationPath:path.join(folder,"test.lqp"),title:"Test",description:"",
      notes:"",projectType:"civil",executor:"",date:"2026-10-01",companyName:"Test",companyDescription:""});
    const add=()=>service.addStructural({kind:"enclosure",configuration:{modelId:1,selectedOptionIds:[]}});
    return {folder,parent,child,state,service,create,add};
  };

  it.each([
    {mode:"fixed",contribution:"none"},{mode:"packed",contribution:"none"},
    {mode:"fixed",contribution:"articles"},{mode:"packed",contribution:"articles"},
  ] as const)("creates a complete $mode set of $contribution supports as ordinary nodes",async({mode,contribution})=>{
    const {folder,service,create,add}=setup(mode,contribution);
    try {
      await create();
      const added=add();
      expect(added.presetDiagnostics?.map(row=>[row.seq,row.status,row.code])).toEqual([
        [1,"instantiated","created"],[2,"instantiated","created"],[3,"instantiated","created"]]);
      const nodes=added.physicalNodes[0]!.children;
      expect(nodes.map(node=>node.nodeKind)).toEqual(["support","support","support"]);
      expect(new Set(nodes.map(node=>node.uuid)).size).toBe(3);
      expect(added.presetDiagnostics?.map(row=>row.nodeUuid)).toEqual(nodes.map(node=>node.uuid));
      if(mode==="fixed")expect(nodes.map(node=>[node.slotNo,node.xMm,node.yMm,node.startUnits]))
        .toEqual([[1,17,120,null],[2,17,240,null],[3,17,360,null]]);
      else expect(nodes.map(node=>[node.startUnits,node.slotNo])).toEqual([[0,null],[100,null],[200,null]]);
      // Identical children share one configured item whose quantity counts the occurrences.
      const items=added.configuredItems.filter(item=>item.modelKind==="support");
      expect(items.map(item=>[item.modelCode,added.lines.find(line=>line.itemUuid===item.uuid)?.quantity]))
        .toEqual([["model-2",2],["model-3",1]]);
      // Physical-only supports contribute nothing; commercial ones keep their real article rows.
      expect(added.distinta.map(row=>row.quantity)).toEqual([contribution==="none"?1:4]);
      // Opening the saved document never regenerates or alters presets.
      await service.save();service.closeCurrent();
      const reopened=service.open(path.join(folder,"test.lqp"));
      expect(reopened.presetDiagnostics).toBeUndefined();
      expect(reopened.physicalNodes).toEqual(added.physicalNodes);
    }finally{service.close();rmSync(folder,{recursive:true,force:true});}
  });

  it.each(["fixed","packed"] as const)("never leaves a half-created %s set",async mode=>{
    const {folder,state,service,create,add}=setup(mode,"none");
    try {
      await create();
      state.middle="incomplete";
      const added=add();
      expect(added.physicalNodes).toHaveLength(1);
      expect(added.physicalNodes[0]!.children).toEqual([]);
      expect(added.configuredItems.map(item=>item.modelKind)).toEqual(["enclosure"]);
      expect(added.presetDiagnostics?.map(row=>[row.seq,row.status,row.code])).toEqual([
        [1,"withheld","preset_set_incomplete"],[2,"withheld","preset_configuration_unresolved"],
        [3,"withheld","preset_set_incomplete"]]);
      expect(added.presetDiagnostics?.[1]?.issues?.map(issue=>issue.code)).toEqual(["missing_required"]);
      // An unexpected failure rolls back the parent too.
      state.middle="throws";
      const before=service.current();
      expect(add).toThrow("unexpected backend failure");
      expect(service.current()).toEqual(before);
    }finally{service.close();rmSync(folder,{recursive:true,force:true});}
  });

  it("rolls back every child and quantity when a placement refusal occurs while writing",async()=>{
    const {folder,parent,child,service,create,add}=setup("fixed","none");
    try {
      await create();
      // Geometry is checked before anything is written.
      parent.physical!.slots=parent.physical!.slots.filter(slot=>slot.slotNo!==3);
      const missingSlot=add();
      expect(missingSlot.physicalNodes[0]!.children).toEqual([]);
      expect(missingSlot.presetDiagnostics?.find(row=>row.seq===3)?.code).toBe("preset_geometry_unresolved");
      expect(missingSlot.presetDiagnostics?.filter(row=>row.code==="preset_set_incomplete").map(row=>row.seq)).toEqual([1,2]);
      // The engine refuses the first occurrence after the second one was already written: nothing is kept.
      parent.physical!.slots=[1,2,3].map(slotNo=>({zoneNo:0,slotNo,xMm:17,yMm:slotNo*120}));
      parent.model.definitionFingerprint="definition-1b";parent.fingerprint="config-1b";
      child.fingerprint="config-2b";child.physical!.constraints[0]!.classCodes=["OTHER"];
      const refused=add();
      expect(refused.physicalNodes[1]!.children).toEqual([]);
      expect(refused.configuredItems.filter(item=>item.modelKind==="support")).toEqual([]);
      expect(refused.presetDiagnostics?.every(row=>row.status==="withheld"&&row.code==="preset_set_incomplete")).toBe(true);
      expect(refused.presetDiagnostics?.[0]?.message).toContain("incompatible_ancestor");
    }finally{service.close();rmSync(folder,{recursive:true,force:true});}
  });

  it("withholds unknown semantics and creates nothing for parents without presets",async()=>{
    const {folder,parent,service,create,add}=setup("fixed","none");
    try {
      await create();
      parent.model.relations.forEach(row=>{row.placementMode=null;});
      const unknown=add();
      expect(unknown.physicalNodes[0]!.children).toEqual([]);
      expect(unknown.presetDiagnostics?.filter(row=>row.code==="unsupported_preset_semantics").map(row=>row.seq))
        .toEqual([1,2,3]);
      parent.model.relations=[];
      const plain=add();
      expect(plain.presetDiagnostics).toBeUndefined();
      expect(plain.physicalNodes[1]!.children).toEqual([]);
    }finally{service.close();rmSync(folder,{recursive:true,force:true});}
  });
});


describe("Fuori catalogo technical items",()=>{
  it.each(["enclosure","support","device"] as const)("requires acknowledgement and preserves missing articles, pricing and portable %s data",async(kind)=>{
    const folder=mkdtempSync(path.join(tmpdir(),"librequadri-outside-"));
    const destination=path.join(folder,"outside.lqp");
    const base=configured(2,kind==="device"?"support":kind);
    const missing=(code:string)=>({...base.bom[0]!,manufacturerCode:code,productId:null,
      linkedBrandMarchio:null,linkedManufacturerCode:null,unitPriceE4:null,rowTotalE4:null,
      currency:null,priceIssuerSigla:null,priceListinoNumber:null,priceValidFrom:null,priceMultiplierOriginal:null});
    const result:ConfigurationResult={...base,model:{...base.model,kind},physical:{...base.physical!,kind},
      status:"bom_incomplete",totalE4:null,issues:[{severity:"warning",code:"unresolved_article",message:"Missing METEL"}],
      bom:[missing("MISSING-ONE"),missing("MISSING-TWO"),{...base.bom[0]!,roles:["component"]}]};
    const service=new ProjectDocumentService({workingDirectory:path.join(folder,"working"),incomingDirectory:path.join(folder,"incoming"),
      backupDirectory:path.join(folder,"backups"),migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
      resolveCatalogueProduct:()=>article,resolveConfiguration:request=>request.modelId===1?configured(1,"enclosure"):result,
      designGuard:()=>({ok:true,code:"compatible"})});
    try{
      await service.create({destinationPath:destination,title:"Outside",description:"",notes:"",projectType:"civil",executor:"",
        date:"2026-11-10",companyName:"Test",companyDescription:""});
      const root=service.addStructural({kind:"enclosure",configuration:{modelId:1,selectedOptionIds:[]}}).physicalNodes[0]!;
      const request={modelId:2,selectedOptionIds:[]};
      expect(isOutOfCatalogue(result)).toBe(true);
      expect(()=>service.addConfiguredItem(request)).toThrow();
      expect(()=>service.addStructural({kind,configuration:request,...(kind!=="enclosure"?{parentUuid:root.uuid,place:false}:{})})).toThrow();
      const before=service.current()!.configuredItems.length;
      const added=service.addStructural({kind,configuration:{...request,acceptOutOfCatalogue:true},
        ...(kind!=="enclosure"?{parentUuid:root.uuid,place:false}:{})});
      expect(added.configuredItems).toHaveLength(before+1);
      const item=added.configuredItems.find(item=>item.modelCode===result.model.code)!;
      expect(item.configStatus).toBe("bom_incomplete");expect(item.modelName).toContain("Fuori catalogo");
      expect(item.bom.map(row=>row.manufacturerCode)).toEqual(["MISSING-ONE","MISSING-TWO","ARTICLE"]);
      expect(new Set(item.bom.map(row=>row.snapshotUuid)).size).toBe(3);
      expect(item.bom.map(row=>row.salePriceUnitE4)).toEqual([null,null,10000]);
      expect(item.views).toHaveLength(1);
      expect(calculateCommercial(added).finalTotalE4).toBeNull();
      for(const kind of ["preventivo","distinta"] as const){
        const doc=buildDocumentModel(added,kind);
        expect(doc.totalE4).toBeNull();
        expect(doc.rows.filter(row=>row.description.includes("Fuori catalogo"))).toHaveLength(2);
      }
      const merged=service.addConfiguredItem({...request,acceptOutOfCatalogue:true});
      expect(merged.configuredItems).toHaveLength(added.configuredItems.length);
      expect(merged.lines.find(line=>line.itemUuid===item.uuid)?.quantity).toBe(2);
      expect(merged.lines.find(line=>line.itemUuid===item.uuid)?.lineTotalE4).toBeNull();
      await service.save();service.discardCurrent();
      const reopened=service.open(destination);
      expect(reopened.configuredItems.find(row=>row.uuid===item.uuid)?.bom).toEqual(item.bom);
      expect(calculateCommercial(reopened).finalTotalE4).toBeNull();
      result.status="incomplete";
      expect(()=>service.addConfiguredItem({...request,acceptOutOfCatalogue:true})).toThrow();
    }finally{service.discardCurrent();rmSync(folder,{recursive:true,force:true});}
  });
});
