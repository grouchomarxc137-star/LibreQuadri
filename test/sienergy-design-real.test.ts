import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {expect,it} from "vitest";
import {ProjectDocumentService} from "../src/main/project/project-document-service.js";
import {getConfigurationModel,configurationModelSummaries} from "../src/main/catalogue/configuration-queries.js";
import {resolveConfiguration} from "../src/main/catalogue/configuration-resolver.js";
import {getCatalogueProductSnapshot} from "../src/main/catalogue/catalogue-queries.js";
import {readFrontVectorAssets} from "../src/main/catalogue/vector-assets.js";
import {guardDesignCandidate,guardConfiguredStructuralItem,discoverCompatiblePanels} from "../src/main/project/design-compatibility.js";
import {buildFrontDocument} from "../src/main/documents/front-document.js";
import {buildDocumentModel} from "../src/main/documents/document-model.js";
import {buildDocumentHtml} from "../src/main/documents/document-html.js";
import {DEFAULT_DOCUMENT_PDF_OPTIONS} from "../src/shared/project.js";

const profile=process.env.LIBREQUADRI_SIENERGY_REAL_PROFILE;
it.runIf(!!profile)("configures and prices real SIVACON executions, moves/duplicates/undoes, saves and exports offline",async()=>{
 const db=new Database(path.join(profile!,"data/lq.db"),{readonly:true});
 const output=process.env.LIBREQUADRI_SIENERGY_ACCEPTANCE_OUTPUT;
 const root=output?path.resolve(output):mkdtempSync(path.join(tmpdir(),"librequadri-sie-design-"));mkdirSync(root,{recursive:true});
 const filename=path.join(root,"verified-design.lqp");
 const make=(online:boolean)=>new ProjectDocumentService({workingDirectory:path.join(root,"work"),incomingDirectory:path.join(root,"in"),backupDirectory:path.join(root,"backups"),
  migrationsFolder:path.resolve("db/migrations/project"),appVersion:"Siemens acceptance",engineeringCatalogue:()=>online?db:null,
  resolveCatalogueProduct:id=>{if(!online)throw new Error("offline");return getCatalogueProductSnapshot(db,id);},
  resolveConfiguration:request=>{if(!online)throw new Error("offline");return resolveConfiguration(db,request);},
  resolveFrontAssets:keys=>readFrontVectorAssets(db,path.join(profile!,"assets"),keys),
  compatiblePanels:(project,request)=>{const result=discoverCompatiblePanels(db,project,request);return {...result,navigation:{...result.navigation,candidates:configurationModelSummaries(db,result.navigation.candidates)}};},
  designGuard:(project,request,configuration)=>guardDesignCandidate(db,project,request,{mode:"add",configuration}),
  designItemGuard:(project,request)=>guardConfiguredStructuralItem(db,project,request)});
 let service=make(true);
 try{
  await service.create({destinationPath:filename,title:"SIVACON S4 verification",description:"Source-qualified Siemens workflow",notes:"",projectType:"industrial",executor:"",date:"2026-11-24",companyName:"",companyDescription:""});
  const rootId=db.prepare("SELECT id FROM cat_config_model WHERE name=? AND active=1").pluck().get("SIVACON S4 R2 F1 · senza sb. superiori - per sb. verticali a gradino - IP41 - P400 · B600") as number;
  const deviceId=db.prepare("SELECT id FROM cat_config_model WHERE code='sie.article.5SL30257'").pluck().get() as number;
  const reference={configuration:{modelId:deviceId,selectedOptionIds:[]},definitionFingerprint:getConfigurationModel(db,deviceId)!.definitionFingerprint};
  expect(service.compatibleEnclosures({device:reference}).navigation.candidates.map(row=>row.id)).toContain(rootId);
  const options=getConfigurationModel(db,rootId)!.axes[0]!.options;
  const request={modelId:rootId,selectedOptionIds:[options[0]!.id]};
  let view=service.addStructural({kind:"enclosure",configuration:request});
  const first=view.physicalNodes[0]!;
  const wrongPanelId=db.prepare("SELECT id FROM cat_config_model WHERE name LIKE '%Pannelli modulari DIN · B800' AND active=1 LIMIT 1").pluck().get() as number;
  const wrongOption=getConfigurationModel(db,wrongPanelId)!.axes[0]!.options[0]!;
  expect(()=>service.addStructural({kind:"support",parentUuid:first.uuid,configuration:{modelId:wrongPanelId,selectedOptionIds:[wrongOption.id]}})).toThrow("required_context_not_provided");
  expect(service.current()!.configuredItems).toEqual(view.configuredItems);
  view=service.addStructural({kind:"enclosure",configuration:request});const second=view.physicalNodes[1]!;
  const panelId=db.prepare(`SELECT m.id FROM cat_config_model m JOIN cat_config_model_context mc ON mc.model_id=m.id
   JOIN cat_config_context c ON c.id=mc.context_id WHERE m.name LIKE '%Pannelli modulari DIN · B600'
   AND c.code='sie.context.3001.3105.3217' AND m.active=1 LIMIT 1`).pluck().get() as number;
  const panelOptions=getConfigurationModel(db,panelId)!.axes[0]!.options;
  expect(service.compatiblePanels({parentUuid:first.uuid,device:reference}).navigation.candidates.map(row=>row.id)).toContain(panelId);
  const panelOption=panelOptions.find(o=>resolveConfiguration(db,{modelId:panelId,selectedOptionIds:[o.id]}).physical?.zones.length===2)!;
  expect(panelOption).toBeDefined();
  view=service.addStructural({kind:"support",parentUuid:first.uuid,configuration:{modelId:panelId,selectedOptionIds:[panelOption.id]}});
  const panel=view.physicalNodes[0]!.children[0]!;
  view=service.addStructural({kind:"device",parentUuid:panel.uuid,configuration:{modelId:deviceId,selectedOptionIds:[]},place:false});
  const device=view.configuredItems.find(i=>i.modelCode==='sie.article.5SL30257')!;
  const placement={itemUuid:device.uuid,parentUuid:panel.uuid,zoneNo:1,startUnits:0,viewCode:"front"};
  view=service.placeChild(placement);const placed=view.physicalNodes[0]!.children[0]!.children[0]!;
  expect(placed.positionIssue).toBeNull();
  view=service.moveNode(placed.uuid,{...placement,startUnits:4});
  expect(view.physicalNodes[0]!.children[0]!.children[0]!.startUnits).toBe(4);
  expect(service.undo().physicalNodes[0]!.children[0]!.children[0]!.startUnits).toBe(0);
  expect(service.redo().physicalNodes[0]!.children[0]!.children[0]!.startUnits).toBe(4);
  const before=service.current();expect(()=>service.moveNode(placed.uuid,{...placement,startUnits:999})).toThrow();expect(service.current()).toEqual(before);
  view=service.duplicatePlacedItem(placed.uuid);expect(view.physicalNodes[0]!.children[0]!.children).toHaveLength(2);
  expect(view.distinta.find(row=>row.manufacturerCode==='5SL30257')?.quantity).toBe(2);
  view=service.moveNode(panel.uuid,{itemUuid:panel.itemUuid!,parentUuid:second.uuid,zoneNo:0,startUnits:0,viewCode:"front"});
  expect(view.physicalNodes[0]!.children).toHaveLength(0);expect(view.physicalNodes[1]!.children[0]!.children).toHaveLength(2);
  const changed=options.find(o=>o.id!==request.selectedOptionIds[0])!;
  expect(changed).toBeDefined();view=service.reconfigureEnclosure(second.uuid,{modelId:rootId,selectedOptionIds:[changed.id]});
  expect(view.physicalNodes[1]!.children[0]!.children.every(n=>n.positionIssue===null)).toBe(true);
  const keys=view.configuredItems.flatMap(i=>i.views.map(v=>v.assetKey).filter((k):k is string=>!!k));
  const assets=readFrontVectorAssets(db,path.join(profile!,"assets"),keys);expect(Object.keys(assets)).toHaveLength(new Set(keys).size);
  await service.save();const saved=service.current()!;service.close();service=make(false);
  const reopened=service.open(filename);expect(reopened.configuredItems).toEqual(saved.configuredItems);expect(reopened.distinta).toEqual(saved.distinta);expect(reopened.physicalNodes).toEqual(saved.physicalNodes);
  const front=buildFrontDocument(reopened,assets,{labels:true,dimensions:true});
  expect(front.html).toContain("front-vector");expect(front.html).not.toContain("carpenterie non mostrate");
  writeFileSync(path.join(root,"front.html"),front.html);
  writeFileSync(path.join(root,"distinta.html"),buildDocumentHtml(buildDocumentModel(reopened,"distinta",new Date("2026-11-24"),DEFAULT_DOCUMENT_PDF_OPTIONS),DEFAULT_DOCUMENT_PDF_OPTIONS));
  writeFileSync(path.join(root,"result.json"),JSON.stringify({items:reopened.configuredItems.length,rows:reopened.distinta.length,artwork:Object.keys(assets),nodes:reopened.physicalNodes},null,2));
 }finally{service.close();db.close();if(!output)rmSync(root,{recursive:true,force:true});}
},60000);
