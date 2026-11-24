import {createHash}from"node:crypto";
import type{SienergySource,SienergyGraphic}from"./reader.js";
import type{StructuralRoute}from"./structural-routes.js";
import{createSienergyAssemblyExpander}from"./assemblies.js";
import{sienergyArticleCode}from"./identity.js";
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export interface StructuralBom {code:string;quantity:number;}
export interface StructuralVariant {key:string;label:string;profileId:string;geometry:SienergyGraphic;bom:StructuralBom[];sourceLine:number;}
export interface StructuralDefinition {key:string;kind:"enclosure"|"support";name:string;contexts:string[];variants:StructuralVariant[];}
export function compileStructuralDefinitions(source:SienergySource,routes:readonly StructuralRoute[]){
 const expand=createSienergyAssemblyExpander(source),universe=new Set(routes.filter(r=>r.kind==="enclosure").flatMap(r=>r.codes));
 const frames=new Map<string,StructuralDefinition>(),supports=new Map<string,{variant:StructuralVariant;contexts:Set<string>;width:number;din:boolean}>(),skipped:Record<string,number>={};
 const context=(r:StructuralRoute)=>`sie.context.${r.codes.filter(c=>universe.has(c)).join(".")}`;
 const baseWidths=new Map<string,number>();
 for(const r of source.records.values()){
  const fronts=r.graphics.filter(g=>g.sizeCode===390&&g.representation===1&&g.drawing);
  if(fronts.length===1){const g=fronts[0]!;baseWidths.set(g.drawing!,Math.min(baseWidths.get(g.drawing!)??Infinity,g.dimensionsMm[0]??Infinity));}
 }
 const skip=(code:string)=>skipped[code]=(skipped[code]??0)+1;
 const variant=(route:StructuralRoute):StructuralVariant=>{
  const amounts=new Map<string,number>();
  for(const out of route.node.outputs)if(out.role==="article")for(const part of expand(out.targetId)){
   const code=sienergyArticleCode(part.record);if(!code)throw new Error("Noncommercial selector bill");
   const quantity=out.quantity*part.quantity;if(!Number.isFinite(quantity)||quantity<=0||quantity>1000000)throw new Error("Invalid selector quantity");
   amounts.set(code,(amounts.get(code)??0)+quantity);
  }
  if(!amounts.size)throw new Error("Empty selector bill");
  const bom=[...amounts].map(([code,quantity])=>({code,quantity})),key=hash([route.graphic.id,bom]);
  return {key,label:route.path.slice(3).join(" · ")||route.graphic.title,profileId:route.graphic.id,geometry:route.geometry,bom,sourceLine:route.node.sourceLine};
 };
 for(const route of routes){
  if(route.kind!=="enclosure")continue;
  const g=route.geometry,p=g.payload??[];
  if(!route.graphic.identifier.startsWith("S4_")||route.graphic.graphics.filter(g=>g.sizeCode===390&&g.representation===1).length!==1||g.dimensionsMm[0]!==baseWidths.get(g.drawing!)){
   skip("compound_or_unsupported_frame");continue;
  }
  if(p.length<18||p[0]!==4||[p[4],p[5],p[6],p[7],p[8],p[9]].some(v=>!Number.isFinite(v)||v!<=0)||p[4]!>p[7]!||p[5]!>p[8]!||g.dimensionsMm.some((v,i)=>v!==p[7+i])){skip("unsupported_frame_geometry");continue;}
  let v:StructuralVariant;try{v=variant(route);}catch{skip("unresolved_frame_bill");continue;}
  const ctx=context(route),existing=frames.get(ctx)??{key:ctx,kind:"enclosure" as const,name:route.path.slice(0,3).join(" · "),contexts:[ctx],variants:[]};
  if(!existing.variants.some(old=>old.key===v.key))existing.variants.push(v);frames.set(ctx,existing);
 }
 for(const route of routes){
  if(route.kind!=="support"||!frames.has(context(route)))continue;
  const g=route.geometry,p=g.payload??[];
  if(!route.graphic.identifier.startsWith("S4_")||g.dimensionsMm[0]!<=0||g.dimensionsMm[1]!<=0){skip("unsupported_panel_geometry");continue;}
  if(g.representation===3&&(!Number.isInteger(p[0])||p[0]!<1||p[0]!>20||p.length!==6||p[1]!<=0||!Number.isSafeInteger(p[1]!/9)||p[2]!<=0)){skip("unsupported_mounting_kit");continue;}
  let v:StructuralVariant;try{v=variant(route);}catch{skip("unresolved_panel_bill");continue;}
  const current=supports.get(v.key)??{variant:v,contexts:new Set<string>(),width:g.dimensionsMm[0]!,din:g.representation===3};
  current.contexts.add(context(route));supports.set(v.key,current);
 }
 const groups=new Map<string,StructuralDefinition>();
 for(const {variant,contexts,width,din}of supports.values()){
  const accepted=[...contexts].sort(),key=hash([width,din,accepted]);
  const group=groups.get(key)??{key:`sie.support.${key}`,kind:"support" as const,name:`SIVACON S4 · ${din?"Pannelli modulari DIN":"Pannelli e piastre"} · B${width}`,contexts:accepted,variants:[]};
  group.variants.push(variant);groups.set(key,group);
 }
 return {definitions:[...frames.values(),...groups.values()],skipped};
}
