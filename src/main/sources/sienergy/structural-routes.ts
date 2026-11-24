import type {SienergyRecord,SienergySource,SienergyGraphic} from "./reader.js";
import type {SienergySelector,SienergySelectors} from "./selectors.js";
import {selectorCondition,selectorConditionMatches,type SelectorLiteral} from "./conditions.js";
export interface StructuralRoute {key:string;root:SienergySelector;node:SienergySelector;path:string[];codes:number[];graphic:SienergyRecord;geometry:SienergyGraphic;kind:"enclosure"|"support";}
export function structuralRoutes(source:SienergySource,selectors:SienergySelectors){
 const children=new Map<string,SienergySelector[]>(),conditions=new Map<string,SelectorLiteral[][]|null>(),routes:StructuralRoute[]=[];
 const skipped:Record<string,number>={};const skip=(key:string)=>skipped[key]=(skipped[key]??0)+1;
 for(const node of selectors.nodes.values())if(node.namespace==="10"){
  if(node.parentId){const list=children.get(node.parentId)??[];list.push(node);children.set(node.parentId,list);}
  try{conditions.set(node.id,selectorCondition(node.headerTail));}catch{conditions.set(node.id,null);}
 }
 const roots=[...selectors.nodes.values()].filter(n=>n.namespace==="10"&&n.parentId===null&&n.opcode>0&&n.label&&/SIVACON|ALPHA|SIKUS/i.test(n.label)&&!/NON PI[UÙ]'? (?:FORNIBILE|IN COMMERCIO)/i.test(n.label));
 const productive=new Map<string,boolean>(),checking=new Set<string>();
 const canProduce=(node:SienergySelector):boolean=>{
  const cached=productive.get(node.id);if(cached!==undefined)return cached;
  if(checking.has(node.id))return false;checking.add(node.id);
  const own=node.outputs.some(output=>{const record=source.records.get(output.targetId);return output.role==="graphic"&&!!record?.graphics.some(g=>g.drawing&&[390,164,184].includes(g.sizeCode??0)&&g.dimensionsMm[0]!>0&&g.dimensionsMm[1]!>0);});
  const alias=node.alias?selectors.nodes.get(`10:${node.alias}`):undefined;
  const value=own||(alias?canProduce(alias):false)||(children.get(node.id)??[]).some(canProduce);
  checking.delete(node.id);productive.set(node.id,value);return value;
 };
 for(const root of roots)canProduce(root);
 let visited=0;
 for(const root of roots){
  const active=new Set<string>(),seen=new Set<string>();
  const visit=(node:SienergySelector,codes:ReadonlySet<number>,path:string[],keys:string[],choices:ReadonlyMap<string,string>)=>{
   if(!canProduce(node))return;
   if(node.opcode&&node.parentId&&choices.has(node.parentId)&&choices.get(node.parentId)!==node.id)return;
   if(active.has(node.id)||active.size>48){skip("alias_cycle");return;}
   const stateKey=`${node.id}/${[...codes].sort((a,b)=>a-b).join(",")}`;if(seen.has(stateKey))return;seen.add(stateKey);
   if(++visited>30000000)throw new Error("Structural selector traversal budget exceeded");
   const condition=conditions.get(node.id);if(!condition){skip("unsupported_condition");return;}
   if(!selectorConditionMatches(condition,codes))return;
   if(/NON PI[UÙ]'? (?:FORNIBILE|IN COMMERCIO)/i.test(node.label))return;
   if(node.extra.length){skip("dynamic_selector");return;}
   const selected=new Set(codes),nextChoices=new Map(choices);if(node.opcode){selected.add(node.opcode);if(node.parentId)nextChoices.set(node.parentId,node.id);}
   const labels=node.label?[...path,node.label]:path,nextKeys=[...keys,node.id];
   const graphics=node.outputs.filter(o=>o.role==="graphic"&&o.quantity===1).map(o=>source.records.get(o.targetId)).filter((r):r is SienergyRecord=>!!r);
   for(const graphic of graphics){
    const geometry=graphic.graphics.find(g=>g.reference===null&&g.drawing&&g.dimensionsMm.length===3&&
      ((g.sizeCode===390&&g.representation===1)||([164,184].includes(g.sizeCode??0)&&[3,4].includes(g.representation))));
    if(!geometry||geometry.dimensionsMm[0]!<=0||geometry.dimensionsMm[1]!<=0)continue;
    routes.push({key:nextKeys.join("."),root,node,path:labels,codes:[...selected].sort((a,b)=>a-b),graphic,geometry,kind:geometry.sizeCode===390?"enclosure":"support"});
   }
   active.add(node.id);
   if(node.alias){const target=selectors.nodes.get(`10:${node.alias}`);if(target)visit(target,selected,labels,nextKeys,nextChoices);else skip("unresolved_alias");}
   for(const child of children.get(node.id)??[])visit(child,selected,labels,nextKeys,nextChoices);
   active.delete(node.id);
  };
  visit(root,new Set(),[],[],new Map());
 }
 return {routes,skipped,roots:roots.length,visited};
}
