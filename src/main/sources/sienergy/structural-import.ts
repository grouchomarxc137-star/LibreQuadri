import type Database from "better-sqlite3";
import type {EngineeringDataWriter} from "../engineering-writer.js";
import type {DrawingBundle} from "./drawings.js";
import type {StructuralDefinition,StructuralVariant} from "./structural-definitions.js";
import {digest} from "./drawings.js";
import {SIENERGY_ENGINEERING_ADAPTER as adapter} from "./adapter.js";
const railFacts=(evidence:string)=>({system:"din35",basis:"source_rule"as const,evidence,installationDepthMm:null,apertureMm:null,aboveRailMm:null,belowRailMm:null});
/** Fixed source executions become ordinary profile/BOM options; source context sets bound their use. */
export function importStructuralDefinitions(options:{database:Database.Database;writer:EngineeringDataWriter;brandId:number;importId:number;definitions:StructuralDefinition[];drawings:DrawingBundle|null}){
 const {database:db,writer,brandId,importId,definitions,drawings}=options;
 const setId=writer.upsertProfileSet("sie.structural","Siemens strutture e pannelli"),frameClass=writer.upsertClass("sie.s4.frame","SIVACON S4","Sienergy current S4 selector routes"),
  dinClass=writer.upsertClass("sie.s4.din","SIVACON S4 pannello DIN","Sienergy mounting array"),panelClass=writer.upsertClass("sie.s4.panel","SIVACON S4 pannello","Sienergy panel footprint"),
  frameSet=writer.upsertAcceptSet("sie.s4.frames",[frameClass]);
 const contexts=new Map<string,number>(),profiles=new Map<string,number>(),skipped:Record<string,number>={};
 const skip=(code:string)=>skipped[code]=(skipped[code]??0)+1;
 const nodeRoot=writer.upsertRangeNode(brandId,null,"sie.structural","Carpenterie e pannelli Siemens","section",0,importId,"Sienergy","system",null,false,true);
 const roots=new Map<string,number>();
 db.prepare("INSERT OR IGNORE INTO cat_range_level(code,label,sort_order,source) VALUES('gamma','Gamma',10,'seed')").run();
 const drawingById=new Map(drawings?.rows.map(row=>[row.profileId,row])??[]);
 const profile=(variant:StructuralVariant,kind:"enclosure"|"support"):number|undefined=>{
  const key=`${kind}.${variant.profileId}`,known=profiles.get(key);if(known!==undefined)return known;
  const g=variant.geometry,p=g.payload??[],drawing=drawingById.get(variant.profileId),dimensions=g.dimensionsMm;
  if(!drawing){skip(kind==="support"?"panel_front_unavailable":"frame_front_unavailable");return undefined;}
  if(drawing&&drawing.drawing!==g.drawing)throw new Error("Structural drawing/profile mismatch");
  if(kind==="support"&&Math.abs(drawing!.viewBox[3]-dimensions[1]!)>0.5){skip("panel_height_mismatch");return undefined;}
  const din=kind==="support"&&g.representation===3;
  const id=writer.upsertProfile({code:`sie.structure.${variant.profileId}`,setId,key:parseInt(variant.profileId,16),kind,name:g.drawing??variant.profileId,
   classId:kind==="enclosure"?frameClass:din?dinClass:panelClass,depth:dimensions[2]||null,outerDepth:dimensions[2]||null,usableDepth:kind==="enclosure"?p[6]??null:null,
   importId,ref:`Sienergy ${variant.profileId}:${g.sourceLine}`});
  profiles.set(key,Math.abs(id));if(id<0)return -id;
  const origin=drawing?.originMm??[0,0],box=drawing?.viewBox??[0,-dimensions[1]!,dimensions[0]!,dimensions[1]!];
  writer.addView({profileId:id,code:"front",width:box[2],height:box[3],dx:origin[0]-box[0],dy:kind==="support"?-(origin[1]+dimensions[1]!)-box[1]:-origin[1]-box[1],symbol:kind==="enclosure"?"enclosure":din?"din_panel":"panel",asset:drawing?`sienergy/${variant.profileId}`:null});
  if(kind==="enclosure")writer.addZone({profileId:id,layout:"stack",capacityKind:null,capacity:p[5]!,x:origin[0]-box[0]+p[16]!,y:-origin[1]-box[1]-p[17]!-p[5]!,length:p[5]!,breadth:p[4]!,direction:"vertical",pitch:25,requiredView:"front"});
  else{
   writer.addConstraint(id,"parent",frameSet);
   if(din)for(let row=0;row<p[0]!;row++)writer.addZone({profileId:id,zoneNo:row,layout:"linear",capacityKind:"din_rail",capacity:p[1]!/9,
    x:origin[0]-box[0]+p[3]!,y:-origin[1]-box[1]-p[4]!+row*p[2]!,length:p[1]!,breadth:p[2]!,direction:"horizontal",pitch:9,requiredView:"front",mounting:railFacts(`Sienergy ${variant.profileId}:${g.sourceLine}, row ${row}`)});
  }
  return id;
 };
 let models=0,variants=0;
 for(const definition of definitions){
  const available=definition.variants.flatMap(variant=>{const id=profile(variant,definition.kind);return id===undefined?[]:[{variant,id}];});if(!available.length)continue;
  const code=`sie.structural.${digest(definition.key).slice(0,24)}`;
  const model=writer.upsertModel({brandId,code,name:definition.name,kind:definition.kind,profile:available[0]!.id,maxQty:null,
   fingerprint:digest(JSON.stringify([adapter.version,definition,available.map(v=>v.variant.profileId)])),active:1,obsolete:0,importId,ref:`Sienergy selectors ${definition.key}`});
  if(model===undefined)continue;writer.replaceModelChildren(model);writer.setModelContextPolicy(model,"restricted");
  const ids=definition.contexts.map(code=>{if(!contexts.has(code))contexts.set(code,writer.upsertContext(brandId,code,code.replace("sie.context.","SIVACON S4 · "),importId,"Sienergy evaluated selector context"));return contexts.get(code)!;});
  writer.replaceModelContexts(model,definition.kind==="enclosure"?"provides":"accepts",ids);
  const dim=writer.upsertDimension(brandId,`${code}.execution`,"Esecuzione",importId,definition.key);if(dim.id===undefined||dim.manual)throw new Error("Protected Siemens execution dimension requires review");
  const axis=writer.addAxis(model,dim.id,0,"Esecuzione",true,"none",true,definition.kind==="enclosure");
  available.forEach(({variant,id},index)=>{
   const value=writer.upsertValue(dim.id!,variant.key,variant.label,index,`Sienergy selector line ${variant.sourceLine}`);if(value.id===undefined||value.manual)throw new Error("Protected Siemens execution option requires review");
   const option=writer.addOption(axis,value.id,null,available.length===1,true,index),rule=writer.addRule(model,index);
   writer.addCondition(rule,option);writer.addProfileOverride(rule,0,id);
   variant.bom.forEach((part,i)=>writer.addArticleEffect(rule,i+1,"SIE",part.code,part.quantity,i===0?"primary":"component"));variants++;
  });
  const group=definition.kind==="enclosure"?"Carpenterie":"Pannelli";
  if(!roots.has(group)){const id=writer.upsertRangeNode(brandId,nodeRoot??null,`sie.structural.${definition.kind}`,group,"group",definition.kind==="enclosure"?0:1,importId,"Sienergy","group",null,false,true);if(id!==undefined)roots.set(group,id);}
  const parent=roots.get(group);
  const family=parent===undefined?undefined:writer.upsertRangeNode(brandId,parent,`sie.structural.${definition.kind}.s4`,"SIVACON S4","level",0,importId,"Sienergy SIVACON S4","gamma","gamma",false,true);
  if(family!==undefined)writer.addRangeModel(family,model,models);
  models++;
 }
 const receivers=writer.upsertAcceptSet("sie.din.receivers",[dinClass]);
 if(models>0){
 db.prepare(`DELETE FROM cat_phys_constraint WHERE profile_id IN (SELECT id FROM cat_phys_profile WHERE source_import_id=? AND profile_kind='device' AND code LIKE 'sie.%') AND relation='parent'`).run(importId);
 db.prepare(`INSERT INTO cat_phys_constraint(profile_id,relation,accept_set_id) SELECT id,'parent',? FROM cat_phys_profile WHERE source_import_id=? AND profile_kind='device' AND code LIKE 'sie.%'`).run(receivers,importId);
 }
 writer.deactivateAbsentContexts(importId,brandId,"sie.context.");
 return {models,variants,profiles:profiles.size,skipped};
}
