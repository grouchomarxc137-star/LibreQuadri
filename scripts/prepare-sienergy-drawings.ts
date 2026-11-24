import {execFileSync} from "node:child_process";
import {mkdirSync,readdirSync,readFileSync,writeFileSync,existsSync} from "node:fs";
import path from "node:path";
import {readSienergySource} from "../src/main/sources/sienergy/reader.js";
import {createTextOutliner} from "../src/main/sources/sienergy/text-paths.js";
import {readSienergySelectors} from "../src/main/sources/sienergy/selectors.js";
import {structuralRoutes} from "../src/main/sources/sienergy/structural-routes.js";
import {mountingEvidence,isModularProfile} from "../src/main/sources/sienergy/evidence.js";
import {convertDwgJson,frameDrawingViewport} from "../src/main/sources/sienergy/dwg-svg.js";
import {digest,SIENERGY_DRAWING_VERSION,type PreparedDrawings} from "../src/main/sources/sienergy/drawings.js";
const [root,output,fontFile,...extra]=process.argv.slice(2);
if(!root||!output||extra.length)throw new Error("Usage: prepare-sienergy-drawings <Sienergy root> <output folder> [outline font file]");
const outlineText=fontFile?createTextOutliner(fontFile):undefined;
const source=await readSienergySource(path.join(root,"lib/bd/Siemens.bd"));
const directory=path.join(root,"lib/quadrisi"),names=new Map(readdirSync(directory).map(name=>[name.toLowerCase(),name]));
const profiles=new Map<string,{drawing:string;widthMm:number|null;frameSize?:[number,number]}>();
for(const r of source.records.values())if(r.manufacturerCode){
 const evidence=mountingEvidence(source,r.id);if(evidence.length!==1)continue;
 const e=evidence[0]!;if(isModularProfile(source,e.profileId)&&e.drawing&&Number.isSafeInteger(e.widthMm/9))profiles.set(e.profileId,{drawing:e.drawing,widthMm:e.widthMm});
}
const selectors=await readSienergySelectors(path.join(root,"lib/bd/Siemens.bd"));
if(selectors.sha256!==source.sha256)throw new Error("Sienergy source changed during drawing preparation");
console.error("Resolving structural selector routes");
const structures=structuralRoutes(source,selectors);
for(const route of structures.routes)if(route.geometry.drawing)profiles.set(route.graphic.id,{drawing:route.geometry.drawing,widthMm:null,
 ...(route.kind==="enclosure"?{frameSize:route.geometry.dimensionsMm.slice(0,2) as [number,number]}:{})});
const converted=new Map<string,{result:ReturnType<typeof convertDwgJson>;originMm:[number,number]}>();
const converter=execFileSync("dwgread",["--version"],{encoding:"utf8"}).trim();
const manifest:PreparedDrawings={version:SIENERGY_DRAWING_VERSION,masterSha256:source.sha256,converter:fontFile?`${converter}; font ${digest(readFileSync(fontFile))}`:converter,drawings:[],rejected:{}};
mkdirSync(output,{recursive:true});
let processed=0;
for(const [profileId,e]of profiles){
 try{
  const name=names.get(`${e.drawing}.dwg`.toLowerCase());if(!name)throw new Error("DWG missing");
  const filename=path.join(directory,name),raw=readFileSync(filename),sourceSha256=digest(raw),cache=path.join(output,`${sourceSha256}.${digest(converter).slice(0,12)}.json`);
  const json=existsSync(cache)?readFileSync(cache,"utf8"):execFileSync("dwgread",["-O","JSON",filename],{encoding:"utf8",maxBuffer:30_000_000,timeout:30000,stdio:["ignore","pipe","pipe"]});
  if(!existsSync(cache))writeFileSync(cache,json);
  let ready=converted.get(sourceSha256);
  if(!ready){const decoded=JSON.parse(json),origin=decoded.HEADER?.INSBASE??[0,0];ready={result:convertDwgJson(decoded,outlineText),originMm:[Number(origin[0]),Number(origin[1])]};converted.set(sourceSha256,ready);}
  const originMm=ready.originMm,result=e.frameSize?frameDrawingViewport(ready.result,originMm,e.frameSize):ready.result;
  if(result.unsupported.length)throw new Error(`Unsupported entities: ${result.unsupported.join(", ")}`);
  if(e.widthMm!==null&&Math.abs(result.bounds[2]-e.widthMm)>0.5)throw new Error(`Drawing width ${result.bounds[2]} differs from mounting span ${e.widthMm}`);
  const svgSha256=digest(result.svg);
  writeFileSync(path.join(output,`${sourceSha256}.dwg`),raw);writeFileSync(path.join(output,`${svgSha256}.svg`),result.svg);
  manifest.drawings.push({profileId,drawing:e.drawing,sourceSha256,svgSha256,originMm,fontSubstitutions:result.fontSubstitutions});
 }catch(error){manifest.rejected[profileId]=error instanceof Error?error.message:String(error);}
 processed++;if(processed%25===0)console.error(`${processed}/${profiles.size} drawings processed`);
}
writeFileSync(path.join(output,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");
console.log(JSON.stringify({prepared:manifest.drawings.length,rejected:Object.keys(manifest.rejected).length,output:path.resolve(output)},null,2));
