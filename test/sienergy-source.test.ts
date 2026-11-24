import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {describe,it,expect} from "vitest";
import {readSienergySource,sienergyTokens,type SienergyRecord} from "../src/main/sources/sienergy/reader.js";
import {mountingEvidence,projectReferenceEvidence} from "../src/main/sources/sienergy/evidence.js";

describe("Sienergy material source boundary",()=>{
  it("reads escaped apostrophes and empty strings without shifting positional fields",()=>{
    expect(sienergyTokens("1 '' 'rele\\' ausiliario' ;")).toEqual(["1","","rele' ausiliario",";"]);
    expect(()=>sienergyTokens("'unterminated")).toThrow("Unterminated");
  });
  it("resolves inherited commercial prefixes, separates graphics and preserves multiple widths",async()=>{
    const root=await mkdtemp(path.join(tmpdir(),"librequadri-sienergy-"));
    const header="EXEL S.R.L. integra5 5.5.14.14 30/10/2026 10:18:6 '' 1 98101";
    const graphic=(id:string,width:number)=>[
      `2 7 ${id} 70 00000000 ''`,"0 0 0 0 0",`2 0 -2 -2 '' 'DIN-${id}' '' 'DIN' 0 ;`,
      "0 168 3 1 -1 -1 -1 -1 -1 -1 -1 -1 1 'DIN-X' -1 '' 132 1 '03-COMPONENTI' 0 0 0",
      "0 0 0 0","0 0 0 0000","0 0 0 0",`0 ${width.toFixed(6)} `];
    const lines=[header,"1 5 a 52 00000000 ''","0 0 0 0 0","14 0 -2 '8PQ6' 'Kits' '' '' ;",
      "2 7 b 70 00000000 ''","0 0 0 0 0","1 0 113 351 '0003BA10' '8PQ60003BA10' '' 'Kit' 0 ;",
      "0 36 3 1 -1 -1 -1 -1 -1 -1 -1 -1 1 '' 0:c[2](0 1) '' 0 ;",
      "0 36 3 1 -1 -1 -1 -1 -1 -1 -1 -1 1 '' 0:d[2](0 2) '' 0 ;",
      ...graphic("c",18),...graphic("d",27),
      "1 5 e 52 00000000 ''","0 0 0 0 0","14 0 -2 'IT2' 'Commercial group' '' '' ;",
      "2 7 f 70 00000000 ''","0 0 0 0 0","1 0 113 351 '8GF5752' '8GF5752' '' 'Rail' 0 ;",
      "0 10 f 0 ;",
      "2 7 b 70 00000000 ''","selector namespace must not overwrite material b"];
    try {
      const p=path.join(root,"Siemens.bd");await writeFile(p,lines.join("\r\n"));
      const s=await readSienergySource(p);
      expect(s.records.get("b")?.manufacturerCode).toBe("8PQ60003BA10");
      expect(s.records.get("f")?.manufacturerCode).toBe("8GF5752");
      expect(mountingEvidence(s,"b").map(p=>p.widthMm)).toEqual([18,27]);
      const qe=header+"\n1:b[2](0 1) 2\n1:c[2](0 2) 1\n1:ff[2](0 3) 1";
      const result=projectReferenceEvidence(s,qe);
      expect(result.billable).toEqual([{code:"8PQ60003BA10",quantity:2}]);
      expect(result.graphical[0]?.sourceId).toBe("c");expect(result.unresolved).toEqual(["ff"]);
    } finally {await rm(root,{recursive:true,force:true});}
  });
  it("rejects the old binary converter database",async()=>{
    const root=await mkdtemp(path.join(tmpdir(),"librequadri-sienergy-"));
    try{const p=path.join(root,"old.bd");await writeFile(p,"EXEL/BiSoft integra4 binary");
      await expect(readSienergySource(p)).rejects.toThrow("Unsupported");
    }finally{await rm(root,{recursive:true,force:true});}
  });
});

const realRoot=process.env.LIBREQUADRI_SIENERGY_ROOT;
it.runIf(!!realRoot)("resolves real Siemens mounting records and both supplied SIVACON projects",async()=>{
  const source=await readSienergySource(path.join(realRoot!,"lib/bd/Siemens.bd"));
  expect(source.records.size).toBeGreaterThan(300000);
  for(const [code,width] of [["5ST3010",9],["5SL30257",18],["5ST3053",27]] as const){
    const record=[...source.records.values()].find(r=>r.manufacturerCode===code);
    expect(record).toBeDefined();
    expect(mountingEvidence(source,record!.id).map(p=>p.widthMm)).toEqual([width]);
  }
  for(const [name,count,bomCount] of [["Sivacon S4-Esempio1.qe",52,35],["Sivacon S4-Esempio2.qe",101,40]] as const){
    const result=projectReferenceEvidence(source,await readFile(path.join(realRoot!,"esempi",name),"latin1"));
    expect(result.referenceCount).toBe(count);expect(result.billable).toHaveLength(bomCount);
    expect(result.unresolved).toEqual([]);
    expect(result.billable.some(row=>row.code=== (count===52?"8PQ60003BA11":"8PQ60003BA10"))).toBe(true);
  }
},120000);
it("rejects cyclic graphical references and preserves repeated component occurrences",()=>{
 const r=(id:string,references:string[]):SienergyRecord=>({id,kind:7,parentId:null,sourceLine:1,localCode:"",manufacturerCode:null,identifier:"",title:"",references:[],graphics:references.map(reference=>({representation:1,reference,drawing:null,widthMm:null,dimensionsMm:[],sourceLine:1}))});
 const a=r("a",["b","b"]),b=r("b",[]);b.graphics.push({representation:1,reference:null,drawing:"DIN-X",widthMm:18,dimensionsMm:[],sourceLine:2});
 const source={header:"fixture",sha256:"a".repeat(64),lineCount:2,records:new Map([["a",a],["b",b]]),diagnostics:[]};
 expect(mountingEvidence(source,"a")).toHaveLength(2);
 b.graphics.push(...r("b",["a"]).graphics);expect(()=>mountingEvidence(source,"a")).toThrow("Cyclic");
});
