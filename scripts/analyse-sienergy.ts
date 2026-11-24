import {readFile,readdir} from "node:fs/promises";
import path from "node:path";
import {readSienergySource} from "../src/main/sources/sienergy/reader.js";
import {mountingEvidence,projectReferenceEvidence} from "../src/main/sources/sienergy/evidence.js";

const [root,...extra]=process.argv.slice(2);
if (!root||extra.length) throw new Error("Usage: node dist/scripts/analyse-sienergy.js <Sienergy folder>");
const source=await readSienergySource(path.join(root,"lib/bd/Siemens.bd"));
const projects=[];
for(const name of await readdir(path.join(root,"esempi"))) {
  if(name.toLowerCase().endsWith(".qe")) projects.push({name,...projectReferenceEvidence(source,
    await readFile(path.join(root,"esempi",name),"latin1"))});
}
const samples=[];
for(const code of ["5ST3010","5SL30257","5ST3053"]) {
  const record=[...source.records.values()].find(r=>r.manufacturerCode===code);
  if(record)samples.push({code,sourceId:record.id,profiles:mountingEvidence(source,record.id)});
}
console.log(JSON.stringify({header:source.header,sha256:source.sha256,lineCount:source.lineCount,
  materialObjects:source.records.size,samples,projects,diagnostics:source.diagnostics},null,2));
