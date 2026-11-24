import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";
import { getCatalogueProductSnapshot } from "../src/main/catalogue/catalogue-queries.js";
import { guardConfiguredStructuralItem, guardDesignCandidate } from "../src/main/project/design-compatibility.js";
import { assessProjectPhysical } from "../src/main/project/physical-placement.js";
import { ENGINEERING_ADAPTERS } from "../src/main/sources/engineering-adapters.js";
import { buildFrontDocument } from "../src/main/documents/front-document.js";
import { engineeringSnapshotDiff } from "../src/main/project/configured-items.js";

const filename=process.env["LIBREQUADRI_ENGINEERING_REFRESH_REAL_DB"];
describe.runIf(!!filename&&existsSync(filename))("real engineering refresh (always scratch)",()=>{
  it("HDX 108: Q22 refuses the adapter-10 editability snapshot until explicit adapter-11 refresh",async()=>{
    const root=mkdtempSync(path.join(tmpdir(),"librequadri-q22-hdx-real-")),catalogue=new Database(filename!,{readonly:true});
    const modelId=catalogue.prepare("SELECT id FROM cat_config_model WHERE code='tq.pack.108'").pluck().get() as number;
    const request={modelId,selectedOptionIds:[]};
    const service=new ProjectDocumentService({workingDirectory:path.join(root,"w"),incomingDirectory:path.join(root,"i"),
      backupDirectory:path.join(root,"b"),migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",
      engineeringCatalogue:()=>catalogue,resolveConfiguration:request=>resolveConfiguration(catalogue,request),
      resolveCatalogueProduct:id=>getCatalogueProductSnapshot(catalogue,id)});
    let working:Database.Database|undefined;
    try {
      const file=path.join(root,"hdx.lqp");
      await service.create({destinationPath:file,title:"HDX Q22",description:"",notes:"",projectType:"civil",executor:"",
        date:"2026-10-08",companyName:"",companyDescription:""});
      const added=service.addConfiguredItem(request),item=added.configuredItems[0]!,line=added.lines[0]!;
      service.placeRoot({itemUuid:item.uuid,viewCode:"front",rootXMm:0,rootYMm:0});
      working=new Database(path.join(root,"w",readdirSync(path.join(root,"w")).find(name=>name.endsWith(".lqp"))!));
      working.exec("UPDATE prj_item_selection SET editable_when_placed=0; UPDATE prj_item SET source_adapter_version='10'");
      service.setQuantity(line.uuid,1);await service.save();
      const before=service.current()!,saved=readFileSync(file),image=working.serialize();
      const commerce=()=>["prj_item_bom","prj_line","prj_product_snapshot","prj_node"]
        .map(table=>working!.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
      const frozen=commerce();
      expect(engineeringSnapshotDiff(resolveConfiguration(catalogue,request),before.configuredItems[0]!)).toEqual(["selections"]);
      expect(()=>service.addConfiguredItem(request))
        .toThrow(expect.objectContaining({code:"project_engineering_stale",message:"Aggiorna i dati di ingegneria del progetto."}));
      expect(working.serialize()).toEqual(image);expect(service.current()).toEqual(before);expect(readFileSync(file)).toEqual(saved);
      const plan=service.planEngineeringRefresh();expect(plan.canApply).toBe(true);
      expect(plan.items[0]).toMatchObject({action:"refresh",changes:["selections","provenance"]});
      const refreshed=service.applyEngineeringRefresh(plan.token);
      expect(refreshed.configuredItems[0]!.selections.every(selection=>selection.editableWhenPlaced)).toBe(true);
      expect(refreshed.physicalNodes).toEqual(before.physicalNodes);expect(commerce()).toEqual(frozen);
      expect(readFileSync(file)).toEqual(saved);expect(refreshed.dirty).toBe(true);
      const merged=service.addConfiguredItem(request);
      expect(merged.configuredItems.map(item=>item.uuid)).toEqual([item.uuid]);expect(merged.lines[0]!.quantity).toBe(2);
    } finally { working?.close();service.close();catalogue.close();rmSync(root,{recursive:true,force:true}); }
  },120_000);
  it.each([2882,2889,2890,2891,12890])("Idroboard %s: explicit view-role refresh preserves presets and commerce offline",async model=>{
    const folder=mkdtempSync(path.join(tmpdir(),"librequadri-guide-refresh-real-")),catalogue=new Database(filename!,{readonly:true});
    const id=(code:string)=>catalogue.prepare("SELECT id FROM cat_config_model WHERE code=?").pluck().get(code) as number;
    const options={workingDirectory:path.join(folder,"w"),incomingDirectory:path.join(folder,"i"),backupDirectory:path.join(folder,"b"),
      migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",engineeringCatalogue:()=>catalogue,
      resolveCatalogueProduct:(id:number)=>getCatalogueProductSnapshot(catalogue,id),
      resolveConfiguration:(request:Parameters<typeof resolveConfiguration>[1])=>resolveConfiguration(catalogue,request),
      designGuard:(project:Database.Database,request:Parameters<typeof guardDesignCandidate>[2],configuration:Parameters<typeof resolveConfiguration>[1])=>guardDesignCandidate(catalogue,project,request,{mode:"add",configuration}),
      designItemGuard:(project:Database.Database,request:Parameters<typeof guardConfiguredStructuralItem>[2])=>guardConfiguredStructuralItem(catalogue,project,request)};
    const service=new ProjectDocumentService(options);let working:Database.Database|undefined;
    try {
      const file=path.join(folder,"guides.lqp");
      await service.create({destinationPath:file,title:"Idroboard refresh",description:"",notes:"",projectType:"civil",executor:"",date:"2026-10-08",companyName:"",companyDescription:""});
      const added=service.addStructural({kind:"enclosure",configuration:{modelId:id(`tq.pack.${model}`),selectedOptionIds:[]}});
      expect(added.physicalNodes[0]!.children.length).toBeGreaterThan(0);
      const guide=added.configuredItems.find(item=>item.modelKind==="support")!;
      expect(guide.views[0]!.symbolKind).toBe("mounting_guide");
      await service.save();
      working=new Database(path.join(folder,"w",readdirSync(path.join(folder,"w")).find(name=>name.endsWith(".lqp"))!));
      working.exec("UPDATE prj_item_view SET symbol_kind='din_panel' WHERE item_id IN (SELECT id FROM prj_item WHERE model_kind='support'); UPDATE prj_item SET source_adapter_version='9'");
      const line=service.current()!.lines.find(row=>row.itemUuid===guide.uuid)!;
      service.setQuantity(line.uuid,line.quantity);await service.save();
      const before=service.current()!,saved=readFileSync(file);
      const commerce=()=>["prj_item_bom","prj_product_snapshot","prj_line","prj_project","prj_node","prj_item_zone","prj_item_zone_slot","prj_item_demand"]
        .map(table=>working!.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
      const facts=commerce();
      const svg=(view:typeof before)=>buildFrontDocument(view,{}, {labels:true,dimensions:true}).html.split('<svg class="front-drawing"')[1]!;
      expect(svg(before)).toContain('class="front-support front-opening"');
      const plan=service.planEngineeringRefresh();
      expect(plan.canApply,JSON.stringify(plan.items)).toBe(true);
      expect(plan.items.find(item=>item.itemUuid===guide.uuid)).toMatchObject({action:"refresh",changes:expect.arrayContaining(["views"])});
      const after=service.applyEngineeringRefresh(plan.token);
      expect(after.physicalNodes).toEqual(before.physicalNodes);expect(commerce()).toEqual(facts);
      expect(readFileSync(file)).toEqual(saved);expect(assessProjectPhysical(working)).toEqual([]);
      expect(svg(after)).not.toContain('class="front-support');
      expect(buildFrontDocument(after,{}, {labels:true,dimensions:true}).viewBox)
        .toEqual(buildFrontDocument(before,{}, {labels:true,dimensions:true}).viewBox);
      await service.save();
      const offline=new ProjectDocumentService({...options,workingDirectory:path.join(folder,"offline"),
        engineeringCatalogue:()=>{throw new Error("No catalogue read on open");},resolveCatalogueProduct:()=>{throw new Error("offline");}});
      try { const reopened=offline.open(file);expect(reopened.physicalNodes).toEqual(after.physicalNodes);
        expect(reopened.configuredItems.find(item=>item.uuid===guide.uuid)!.views[0]!.symbolKind).toBe("mounting_guide");
        expect(svg(reopened)).toBe(svg(after));
      } finally { offline.close(); }
    } finally { working?.close();service.close();catalogue.close();rmSync(folder,{recursive:true,force:true}); }
  },120_000);
  it.each([
    ["MW250","tq.pack.1240","tq.pack.1556"],
    ["DIN Spia LED","tq.pack.1234","tq.pack.8530"],
    ["DIN Falsi polo","tq.pack.1234","tq.pack.1777"],
    ["DIN Centrale di misura","tq.pack.1234","tq.pack.8848"],
  ])("%s: historical binding correction preserves saved positions/commerce and enables device placement",async(_name,panelCode,deviceCode)=>{
    const folder=mkdtempSync(path.join(tmpdir(),"librequadri-refresh-real-")),source=new Database(filename!,{readonly:true});
    const scratch=path.join(folder,"catalogue.db");source.prepare("VACUUM INTO ?").run(scratch);source.close();
    const catalogue=new Database(scratch,{readonly:true});
    const id=(code:string)=>catalogue.prepare("SELECT id FROM cat_config_model WHERE code=?").pluck().get(code) as number;
    const options={workingDirectory:path.join(folder,"w"),incomingDirectory:path.join(folder,"i"),backupDirectory:path.join(folder,"b"),
      migrationsFolder:path.resolve("db/migrations/project"),appVersion:"test",engineeringCatalogue:()=>catalogue,
      resolveCatalogueProduct:(id:number)=>getCatalogueProductSnapshot(catalogue,id),
      resolveConfiguration:(request:Parameters<typeof resolveConfiguration>[1])=>resolveConfiguration(catalogue,request),
      designItemGuard:(project:Database.Database,request:Parameters<typeof guardConfiguredStructuralItem>[2])=>guardConfiguredStructuralItem(catalogue,project,request)};
    const service=new ProjectDocumentService(options);let working:Database.Database|undefined;
    try{
      const file=path.join(folder,"case.lqp");
      await service.create({destinationPath:file,title:"Real refresh",description:"",notes:"",projectType:"civil",executor:"",date:"2026-10-06",companyName:"",companyDescription:""});
      const add=(code:string)=>{
        const result=resolveConfiguration(catalogue,{modelId:id(code),selectedOptionIds:[]});
        expect(result.status,code).toBe("complete");
        const view=service.addConfiguredItem({modelId:id(code),selectedOptionIds:[]});
        return view.configuredItems.find(item=>item.modelCode===code)!.uuid;
      };
      const rootItem=add("tq.pack.343");
      const rootNode=service.placeRoot({itemUuid:rootItem,viewCode:"front",rootXMm:10,rootYMm:20}).physicalNodes[0]!.uuid;
      const panel=add(panelCode),device=add(deviceCode);
      const target=service.placementTargets({parentUuid:rootNode,itemUuid:panel}).targets[0];
      expect(target,`panel ${panelCode}`).toBeDefined();
      service.placeStructuralItem(target as never);
      const panelNode=service.current()!.physicalNodes[0]!.children[0]!.uuid;
      service.setGlobalDiscount(1200);service.setLabourTotal(450_000);
      await service.save();
      working=new Database(path.join(folder,"w",readdirSync(path.join(folder,"w")).find(name=>name.endsWith(".lqp"))!));
      working.prepare("UPDATE prj_item_selection SET binding='match_container' WHERE dimension_code='tq.label.54' AND item_id=(SELECT id FROM prj_item WHERE uuid=?)").run(panel);
      working.prepare("UPDATE prj_item SET source_adapter_version=? WHERE uuid=?").run(String(BigInt(ENGINEERING_ADAPTERS[0]!.version)-1n),panel);
      const line=service.current()!.lines.find(row=>row.itemUuid===device)!;service.setQuantity(line.uuid,1);await service.save();
      const before=service.current()!,saved=readFileSync(file);
      const commerce=()=>["prj_item_bom","prj_product_snapshot","prj_line","prj_project","prj_node"].map(table=>working!.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
      const commercialBefore=commerce();
      expect(service.engineeringStatus().items.find(item=>item.itemUuid===panel)?.state).toBe("older_adapter");
      expect(service.placementTargets({parentUuid:panelNode,itemUuid:device}).targets).toHaveLength(0);
      const plan=service.planEngineeringRefresh();
      expect(plan.canApply,JSON.stringify(plan.items.filter(item=>item.blockers.length))).toBe(true);
      expect(plan.items.find(item=>item.itemUuid===panel)?.action).toBe("refresh");
      const after=service.applyEngineeringRefresh(plan.token);
      expect(commerce()).toEqual(commercialBefore);expect(readFileSync(file)).toEqual(saved);
      expect(after.physicalNodes).toEqual(before.physicalNodes);expect(assessProjectPhysical(working)).toEqual([]);
      const allowed=service.placementTargets({parentUuid:panelNode,itemUuid:device});
      expect(allowed.targets.length,JSON.stringify(allowed.diagnostics)).toBeGreaterThan(0);
      await service.save();
      const offline=new ProjectDocumentService({...options,workingDirectory:path.join(folder,"offline"),engineeringCatalogue:()=>null,
        resolveCatalogueProduct:()=>{throw new Error("offline");}});
      try{const reopened=offline.open(file);expect(reopened.physicalNodes).toEqual(after.physicalNodes);
        expect(reopened.configuredItems.find(item=>item.uuid===panel)?.sourceAdapterVersion).toBe(ENGINEERING_ADAPTERS[0]!.version);
        expect(offline.placementTargets({parentUuid:panelNode,itemUuid:device}).targets.length).toBeGreaterThan(0);
      }finally{offline.close();}
    }finally{working?.close();service.close();catalogue.close();rmSync(folder,{recursive:true,force:true});}
  },120_000);
});
