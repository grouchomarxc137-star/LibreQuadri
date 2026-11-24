import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {copyFile,mkdir,stat} from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";
import {loadCapacityKindSeed,loadSourceBrandMapSeed} from "../../catalogue/engineering-seed.js";
import {EngineeringDataWriter} from "../engineering-writer.js";
import {ENGINEERING_LINK_POLICY_VERSION} from "../engineering-links.js";
import {readEngineeringReadiness} from "../../catalogue/engineering-readiness.js";
import {SIENERGY_ENGINEERING_ADAPTER as adapter} from "./adapter.js";
import {readPreparedDrawings,stageDrawings,registerDrawings} from "./drawings.js";
import {readSienergySelectors} from "./selectors.js";
import {structuralRoutes} from "./structural-routes.js";
import {compileStructuralDefinitions} from "./structural-definitions.js";
import {importStructuralDefinitions} from "./structural-import.js";
import {sienergyArticleCode} from "./identity.js";
import {createSienergyAssemblyExpander} from "./assemblies.js";
import {mountingEvidence,isModularProfile} from "./evidence.js";
import {readSienergySource,type SienergyRecord} from "./reader.js";

const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
async function fileHash(filename:string){
  const hash=createHash("sha256");for await(const bytes of createReadStream(filename))hash.update(bytes);
  return hash.digest("hex");
}
export interface SienergyImportOptions {
  database:Database.Database;sourcePath:string;archiveDirectory:string;backupDirectory:string;
  seedFolder?:string;importedAt?:Date;preparedDrawings?:string;assetsRoot?:string;
}
export interface SienergyImportResult {
  importId:number;fingerprint:string;alreadyImported:boolean;summary:Record<string,unknown>;
}
/**
 * Import source-qualified DIN equipment, declared component bills and evaluated structural executions.
 * METEL remains the price authority; unsupported geometry and mounting facts stay unavailable.
 */
export async function importSienergy(options:SienergyImportOptions):Promise<SienergyImportResult>{
  const {database:db}=options,writer=new EngineeringDataWriter(db);writer.assertOutsideTransaction();
  const sourcePath=path.resolve(options.sourcePath),source=await readSienergySource(sourcePath);
  if(options.preparedDrawings&&!options.assetsRoot)throw new Error("Sienergy drawings require an assets root");
  const drawings=options.preparedDrawings?readPreparedDrawings(options.preparedDrawings,source.sha256):null;
  const capacity=loadCapacityKindSeed(options.seedFolder),brands=loadSourceBrandMapSeed(options.seedFolder);
  const fingerprint=sha(JSON.stringify([adapter.code,adapter.version,source.sha256,drawings?.sha256??null,capacity,brands,ENGINEERING_LINK_POLICY_VERSION]));
  if(drawings)stageDrawings(drawings,options.assetsRoot!);
  const previous=writer.findImport(fingerprint);
  if(previous?.became_current===1&&previous.adapter_version===adapter.version&&
    readEngineeringReadiness(db).sources.find(row=>row.adapterCode===adapter.code)?.status==="ready")
    return {importId:previous.id,fingerprint,alreadyImported:true,summary:JSON.parse(previous.summary_json)};
  const skipped:Record<string,{count:number;samples:string[]}>={};
  const skip=(reason:string,key:string)=>{const b=skipped[reason]??={count:0,samples:[]};b.count++;if(b.samples.length<12)b.samples.push(key);};
  type Candidate={record:SienergyRecord;evidence:ReturnType<typeof mountingEvidence>[number];half:number};
  const identities=new Map<string,Candidate[]>();
  const assemblies=new Set([...source.records.values()].filter(r=>r.kind===9).map(r=>r.parentId));
  const obsoleteRoots=new Set([...source.records.values()].filter(r=>r.kind===3&&r.title==="NON PIU' IN COMMERCIO").map(r=>r.id));
  const retired=new Map<string,boolean>();
  const isRetired=(r:SienergyRecord):boolean=>{
    const old=retired.get(r.id);if(old!==undefined)return old;
    const value=obsoleteRoots.has(r.id)||(r.parentId!==null&&!!source.records.get(r.parentId)&&isRetired(source.records.get(r.parentId)!));
    retired.set(r.id,value);return value;
  };
  for(const r of source.records.values()){
    if(r.kind!==7||!r.manufacturerCode)continue;
    if(isRetired(r)){skip("retired_source_branch",r.id);continue;}
    if(assemblies.has(r.id)){skip("assembly",r.id);continue;}
    // Qualified supplier identities need an explicit brand mapping before stripping anything.
    if(r.identifier.includes(":")){skip("qualified_identity",r.id);continue;}
    let evidence:ReturnType<typeof mountingEvidence>;
    try{evidence=mountingEvidence(source,r.id);}catch{skip("unresolved_graphics",r.id);continue;}
    if(!evidence.length)continue;
    if(evidence.length!==1){skip("multiple_graphical_components",r.id);continue;}
    const e=evidence[0]!,half=e.widthMm/9;
    if(!isModularProfile(source,e.profileId)){skip("non_modular_profile",r.id);continue;}
    if(!Number.isSafeInteger(half)||half<=0){skip("non_integral_half_modules",r.id);continue;}
    const key=r.manufacturerCode.trim().toUpperCase(),list=identities.get(key)??[];
    list.push({record:r,evidence:e,half});identities.set(key,list);
  }
  const candidates:Candidate[]=[];
  for(const [code,rows] of identities){
    if(new Set(rows.map(r=>r.evidence.profileId)).size!==1){skip("ambiguous_article_profile",code);continue;}
    candidates.push(rows[0]!);
  }
  const selectors=await readSienergySelectors(sourcePath);
  if(selectors.sha256!==source.sha256)throw new Error("Sienergy source changed while decoding selectors");
  const routes=structuralRoutes(source,selectors),structures=compileStructuralDefinitions(source,routes.routes);
  const expand=createSienergyAssemblyExpander(source);
  const assemblyDefinitions:Array<{record:SienergyRecord;parts:{code:string;quantity:number}[]}>=[];
  for(const r of source.records.values())if(r.kind===7&&((r.articleFlags??0)&16384)!==0&&!isRetired(r)){
    try{const parts=expand(r.id).map(p=>({code:sienergyArticleCode(p.record),quantity:p.quantity}));
      if(parts.length<2||parts.some(p=>!p.code)){skip("unsupported_assembly_identity",r.id);continue;}
      assemblyDefinitions.push({record:r,parts:parts as {code:string;quantity:number}[]});
    }catch{skip("unsupported_composition",r.id);}
  }
  if(!candidates.length&&!assemblyDefinitions.length&&!structures.definitions.length)throw new Error("Sienergy source contains no supported engineering definitions");
  await mkdir(options.archiveDirectory,{recursive:true});
  const archive=path.join(options.archiveDirectory,`${source.sha256}.bd`);
  try{await copyFile(sourcePath,archive,1);}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}
  // Detect source replacement during parsing/copying, and validate a pre-existing archive too.
  if(await fileHash(archive)!==source.sha256)throw new Error("Archived Sienergy source hash mismatch");
  await mkdir(options.backupDirectory,{recursive:true});
  await db.backup(path.join(options.backupDirectory,`librequadri-pre-sienergy-${Date.now()}.db`));
  const byteSize=(await stat(archive)).size;
  return writer.transaction(()=>{
    const importId=writer.beginImport({adapterCode:adapter.code,adapterVersion:adapter.version,
      sourceLabel:path.basename(sourcePath),fingerprint,importedAt:(options.importedAt??new Date()).toISOString(),
      files:[{role:"master",sha256:source.sha256,name:path.basename(sourcePath),byteSize},...(drawings?[{role:"assets",sha256:drawings.sha256,name:"manifest.json",byteSize:drawings.bytes.length}]:[])]});
    writer.prepareSeeds(capacity,brands);
    if(drawings)registerDrawings(db,drawings,importId);
    const brandId=writer.ensureBrand("SIE","Siemens"),classId=writer.upsertClass("sie.din","Siemens DIN","Sienergy mounting span"),
      setId=writer.upsertProfileSet("sie.din","Siemens DIN"),blocked=writer.upsertAcceptSet("sie.unqualified_parent",[writer.upsertClass(
        "sie.unqualified_parent","Compatibilità Siemens da qualificare","No receiving profile is assigned this class")]);
    const profiles=new Map<string,number>(),nodes=new Map<string,number>();
    const root=writer.upsertRangeNode(brandId,null,"sie.design","Apparecchi Siemens","section",0,importId,
      "Sienergy declared equipment and compositions","system",null,false,true);
    const ensureNode=(record:SienergyRecord|undefined):number|undefined=>{
      if(!record)return root;
      const old=nodes.get(record.id);if(old!==undefined)return old;
      if(![3,5].includes(record.kind))return ensureNode(record.parentId?source.records.get(record.parentId):undefined);
      const parent=ensureNode(record.parentId?source.records.get(record.parentId):undefined);
      const id=writer.upsertRangeNode(brandId,parent??root??null,`sie.range.${record.id}`,record.title||record.id,
        "group",record.sourceLine,importId,`Sienergy ${record.id}:${record.sourceLine}`,"group",null,false,true);
      if(id!==undefined)nodes.set(record.id,id);return id;
    };
    writer.clearRangeMembership("sie.");
    let models=0,manualModels=0,manualProfiles=0;
    const modelsByArticle=new Map<string,number>();
    for(const c of candidates){
      const {record:r,evidence:e,half}=c,code=r.manufacturerCode!.trim().toUpperCase();
      let profile=profiles.get(e.profileId);
      if(profile===undefined){
        profile=writer.upsertProfile({code:`sie.profile.${e.profileId}`,setId,key:parseInt(e.profileId,16),kind:"device",
          name:e.drawing??e.profileId,classId,mounting:{system:"din35",basis:"source_rule",evidence:`Sienergy MODULARI ${e.profileId}`,installationDepthMm:null,apertureMm:null,aboveRailMm:null,belowRailMm:null},depth:null,outerDepth:null,usableDepth:null,importId,
          ref:`Sienergy ${e.profileId} mounting span ${e.widthMm} mm`});
        profiles.set(e.profileId,profile);
        if(profile>0){writer.addDemand(profile,"din_rail",half);
          const drawing=drawings?.rows.find(row=>row.profileId===e.profileId);
          if(drawing){if(drawing.drawing!==e.drawing||Math.abs(drawing.viewBox[2]-e.widthMm)>0.5)throw new Error("Prepared drawing/profile mismatch");
            writer.addView({profileId:profile,code:"front",width:drawing.viewBox[2],height:drawing.viewBox[3],dx:(drawing.originMm?.[0]??0)-drawing.viewBox[0],dy:-(drawing.originMm?.[1]??0)-drawing.viewBox[1],symbol:"modular_device",asset:`sienergy/${e.profileId}`});}
          // Occupancy alone cannot establish rail, aperture, clearance or accessory compatibility.
          writer.addConstraint(profile,"parent",blocked);
        }else manualProfiles++;
      }
      const definition=sha(JSON.stringify([adapter.version,code,e,half]));
      const id=writer.upsertModel({brandId,code:`sie.article.${code}`,name:`${code} · ${r.title}`,kind:"device",
        profile:Math.abs(profile),maxQty:null,fingerprint:definition,active:1,obsolete:0,importId,
        ref:`Sienergy ${r.id}:${r.sourceLine}`});
      if(id===undefined){manualModels++;continue;}
      writer.replaceModelChildren(id);writer.setModelContextPolicy(id,"unrestricted");modelsByArticle.set(code,id);
      writer.addBaseArticle(id,1,"SIE",code,1,"primary");
      const node=ensureNode(r.parentId?source.records.get(r.parentId):undefined);
      if(node!==undefined)writer.addRangeModel(node,id,r.sourceLine);
      models++;
    }
    let assemblyModels=0,modularAssemblies=0;
    const accessoryChoices=new Map<string,Array<{id:string;label:string;profile:number;parts:{code:string;quantity:number}[]}>>();
    const moduleByCode=new Map(candidates.map(c=>[c.record.manufacturerCode!.trim().toUpperCase(),c.half]));
    for(const {record:r,parts:normalized}of assemblyDefinitions){
      const modular=normalized.every(part=>moduleByCode.has(part.code)&&Number.isSafeInteger(part.quantity));
      const occupancy=modular?normalized.reduce((total,part)=>total+moduleByCode.get(part.code)!*part.quantity,0):0;
      let assemblyProfile:number|null=null;
      if(Number.isSafeInteger(occupancy)&&occupancy>0){
        const id=writer.upsertProfile({code:`sie.assembly.profile.${r.id}`,setId,key:parseInt(r.id,16),kind:"device",name:r.identifier||r.id,classId,depth:null,outerDepth:null,usableDepth:null,importId,
          mounting:{system:"din35",basis:"source_rule",evidence:`Sienergy declared component bill ${r.id}`,installationDepthMm:null,apertureMm:null,aboveRailMm:null,belowRailMm:null},ref:`Sienergy composition ${r.id}`});
        assemblyProfile=Math.abs(id);if(id>0){writer.addDemand(id,"din_rail",occupancy);writer.addConstraint(id,"parent",blocked);}modularAssemblies++;
      }
      const model=writer.upsertModel({brandId,code:`sie.assembly.${r.id}`,name:r.identifier||r.title||r.id,kind:assemblyProfile?"device":"kit",profile:assemblyProfile,maxQty:null,
        fingerprint:sha(JSON.stringify([adapter.version,r.id,normalized])),active:1,obsolete:0,importId,ref:`Sienergy composition ${r.id}:${r.sourceLine}`});
      if(model===undefined){manualModels++;continue;}
      writer.replaceModelChildren(model);writer.setModelContextPolicy(model,"unrestricted");
      normalized.forEach((p,i)=>writer.addBaseArticle(model,i+1,"SIE",p.code,p.quantity,"component"));
      const node=ensureNode(r.parentId?source.records.get(r.parentId):undefined);if(node!==undefined)writer.addRangeModel(node,model,r.sourceLine);
      if(assemblyProfile&&normalized[0]?.quantity===1&&modelsByArticle.has(normalized[0].code)&&normalized.slice(1).every(part=>part.code!==normalized[0]!.code)){
        const list=accessoryChoices.get(normalized[0].code)??[];
        list.push({id:r.id,label:r.identifier||r.title||r.id,profile:assemblyProfile,parts:normalized.slice(1)});accessoryChoices.set(normalized[0].code,list);
      }
      assemblyModels++;
    }
    for(const [code,choices]of accessoryChoices){
      const model=modelsByArticle.get(code)!,dim=writer.upsertDimension(brandId,`sie.article.${code}.composition`,"Composizione",importId,`Sienergy declared compositions for ${code}`);
      if(dim.id===undefined||dim.manual)throw new Error("Protected Siemens composition dimension requires review");
      const axis=writer.addAxis(model,dim.id,0,"Composizione",true,"none",false),base=writer.upsertValue(dim.id,"base","Solo apparecchio",0,code);
      if(base.id===undefined||base.manual)throw new Error("Protected Siemens composition option requires review");
      writer.addOption(axis,base.id,null,true,true,0);
      choices.forEach((choice,index)=>{
        const value=writer.upsertValue(dim.id!,choice.id,choice.label,index+1,`Sienergy composition ${choice.id}`);if(value.id===undefined||value.manual)throw new Error("Protected Siemens composition option requires review");
        const option=writer.addOption(axis,value.id,null,false,true,index+1),rule=writer.addRule(model,index);
        writer.addCondition(rule,option);writer.addProfileOverride(rule,0,choice.profile);
        choice.parts.forEach((part,i)=>writer.addArticleEffect(rule,i+1,"SIE",part.code,part.quantity,"accessory"));
      });
    }
    const structural=importStructuralDefinitions({database:db,writer,brandId,importId,definitions:structures.definitions,drawings});
    writer.deactivateAbsent(importId,brandId,"sie.","sie.","sie.","sie.");
    writer.refreshLinks();
    // Retain the existing commercial Apparecchi tree; attach models to its actual article nodes.
    db.prepare(`INSERT OR IGNORE INTO cat_range_node_model(node_id,model_id,sort_order)
      SELECT np.node_id,e.model_id,0 FROM cat_range_node_product np
      JOIN cat_config_model_entry e ON e.product_id=np.product_id
      JOIN cat_config_model m ON m.id=e.model_id JOIN cat_range_node n ON n.id=np.node_id
      WHERE m.source_import_id=? AND n.source='metel' AND n.brand_id=?`).run(importId,brandId);
    db.prepare(`UPDATE cat_config_model SET category_id=(SELECT p.category_id FROM cat_config_model_entry e
      JOIN cat_product p ON p.id=e.product_id WHERE e.model_id=cat_config_model.id LIMIT 1),category_source='seed'
      WHERE source_import_id=? AND category_source!='manual'`).run(importId);
    // Replace only this adapter's old occupancy evidence. Hand-entered dimensions always win.
    db.prepare(`DELETE FROM cat_product_physical WHERE source='import_file' AND source_import_id IN
      (SELECT id FROM app_source_import WHERE adapter_code='sienergy')`).run();
    db.prepare(`INSERT INTO cat_product_physical(product_id,din_half_modules,source,source_import_id)
      SELECT e.product_id,d.amount,'import_file',? FROM cat_config_model_entry e
      JOIN cat_config_model m ON m.id=e.model_id JOIN cat_phys_profile p ON p.id=m.base_profile_id
      JOIN cat_phys_profile_demand d ON d.profile_id=p.id
      WHERE m.code LIKE 'sie.article.%' AND p.source='import' AND p.source_import_id=m.source_import_id AND m.source_import_id=? AND m.active=1 AND d.capacity_kind_code='din_rail'
      ON CONFLICT(product_id) DO UPDATE SET din_half_modules=excluded.din_half_modules,
        source_import_id=excluded.source_import_id WHERE cat_product_physical.source='import_file'
        AND cat_product_physical.source_import_id IN (SELECT id FROM app_source_import WHERE adapter_code='sienergy')`)
      .run(importId,importId);
    const linked=db.prepare(`SELECT COUNT(*) FROM cat_config_model m WHERE m.source_import_id=? AND
      (EXISTS(SELECT 1 FROM cat_config_model_article a WHERE a.model_id=m.id AND a.product_id IS NOT NULL) OR
       EXISTS(SELECT 1 FROM cat_config_rule r JOIN cat_config_rule_effect e ON e.rule_id=r.id WHERE r.model_id=m.id AND e.effect_kind='article' AND e.product_id IS NOT NULL))`).pluck().get(importId) as number;
    const summary={models,assemblyModels,modularAssemblies,accessoryModels:accessoryChoices.size,accessoryExecutions:[...accessoryChoices.values()].reduce((total,rows)=>total+rows.length,0),structural,structuralSource:{roots:routes.roots,routes:routes.routes.length,skipped:structures.skipped},profiles:profiles.size,linkedModels:linked,unlinkedModels:models+assemblyModels+structural.models-linked,manualModels,manualProfiles,
      frontDrawings:drawings?.rows.filter(row=>(profiles.get(row.profileId)??0)>0).length??0,sourceObjects:source.records.size,sourceSha256:source.sha256,skipped,
      limitations:["Composition bills are available; assembly geometry remains source-dependent","No source prices imported","Cross-brand mounting requires complete clearance evidence",...(drawings?[]:["Front drawings not yet activated"])]};
    writer.finishImport(importId,summary);
    return {importId,fingerprint,alreadyImported:false,summary};
  });
}
