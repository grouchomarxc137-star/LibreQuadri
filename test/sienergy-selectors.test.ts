import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {expect,it} from "vitest";
import {readSienergySelectors,selectorPath} from "../src/main/sources/sienergy/selectors.js";
import {selectorCondition,selectorConditionMatches} from "../src/main/sources/sienergy/conditions.js";
import {structuralRoutes} from "../src/main/sources/sienergy/structural-routes.js";
import {expandSienergyAssembly} from "../src/main/sources/sienergy/assemblies.js";
import type {SienergyRecord,SienergySource} from "../src/main/sources/sienergy/reader.js";

const record=(id:string,extra:Partial<SienergyRecord>={}):SienergyRecord=>({id,kind:7,parentId:null,sourceLine:1,localCode:id,manufacturerCode:id,identifier:id,title:id,graphics:[],references:[],...extra});
const source=(records:SienergyRecord[]):SienergySource=>({header:"test",sha256:"test",lineCount:1,diagnostics:[],records:new Map(records.map(r=>[r.id,r]))});

it("evaluates alternatives, inclusive intervals and conjunctive exclusions without accepting unknown encodings",()=>{
 const groups=selectorCondition("0 0 0 7 0 4 4 1 100 102 200 0 0 0 -300 0");
 expect(selectorConditionMatches(groups,new Set([101]))).toBe(true);
 expect(selectorConditionMatches(groups,new Set([200]))).toBe(true);
 expect(selectorConditionMatches(groups,new Set([101,300]))).toBe(false);
 expect(selectorConditionMatches(groups,new Set([103]))).toBe(false);
 expect(()=>selectorCondition("0 0 0 7 0 4 2 1 100 0")).toThrow("Malformed");
 expect(()=>selectorCondition("0 0 0 7 0 5 1 1 100 0")).toThrow("Unsupported");
});

it("keeps overlapping selector namespaces separate and follows only productive structural aliases",async()=>{
 const root=mkdtempSync(path.join(tmpdir(),"librequadri-selectors-"));
 try{
  const filename=path.join(root,"master.bd");
  writeFileSync(filename,["0 10 f 0 ;","0 3001 a 0 -1 0 0 0 0 ;","0 'SIVACON S4' ;",
   "1 3105 b 0 0:c[0](0) 0 0 0 0 ;","0 'B600' ;",
   "0 0 c 0 -1 0 0 0 0 ;","0 'Alias target' ;","1 1 0101 1 0:f[0](0) '' ;",
   "1 0 d 0 0:c[0](0) 0 0 0 0 ;",
   "0 11 f 0 ;","0 3001 a 0 -1 0 0 0 0 ;","0 'Accessory namespace' ;"].join("\n"));
  const selectors=await readSienergySelectors(filename);
  expect(selectors.nodes.get("10:a")?.label).toBe("SIVACON S4");
  expect(selectors.nodes.get("11:a")?.label).toBe("Accessory namespace");
  expect(selectorPath(selectors,"b").map(n=>n.id)).toEqual(["a","b"]);
  const material=source([record("f",{graphics:[{representation:1,reference:null,drawing:"S4_A06",widthMm:null,dimensionsMm:[600,2000,400],sourceLine:1,sizeCode:390}]})]);
  const routes=structuralRoutes(material,selectors);
  expect(routes.routes).toHaveLength(1);expect(routes.routes[0]?.codes).toEqual([3001,3105]);
  expect(routes.skipped.alias_cycle).toBe(1);
 }finally{rmSync(root,{recursive:true,force:true});}
});

it("expands only declared fixed compositions and rejects cycles, undeclared and empty aggregates",()=>{
 const rows=[record("a",{articleFlags:16384}),record("b"),record("c"),
  record("d",{kind:9,parentId:"a",component:{targetId:"b",quantity:2}}),
  record("e",{kind:9,parentId:"a",component:{targetId:"c",quantity:0.5}})];
 expect(expandSienergyAssembly(source(rows),"a").map(p=>[p.record.id,p.quantity])).toEqual([["b",2],["c",0.5]]);
 expect(()=>expandSienergyAssembly(source([record("a",{articleFlags:16384})]),"a")).toThrow("Empty");
 expect(()=>expandSienergyAssembly(source(rows.map(r=>r.id==="a"?{...r,articleFlags:1}:r)),"a")).toThrow("Undeclared");
 rows[1]=record("b",{articleFlags:16384});rows.push(record("f",{kind:9,parentId:"b",component:{targetId:"a",quantity:1}}));
 expect(()=>expandSienergyAssembly(source(rows),"a")).toThrow("Cyclic");
});
