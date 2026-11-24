import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {sienergyTokens} from "./reader.js";
export interface SelectorOutput {role:"graphic"|"article";targetId:string;quantity:number;}
export interface SienergySelector {
 id:string;namespace:string;parentId:string|null;depth:number;opcode:number;alias:string|null;sourceLine:number;
 label:string;outputs:SelectorOutput[];headerTail:string;extra:string[];
}
export interface SienergySelectors {sha256:string;nodes:Map<string,SienergySelector>;diagnostics:{line:number;message:string}[];}
const reference="0:([a-f0-9]+)\\[\\d+\\]\\([^)]*\\)";
/** Material identities and selector aliases belong to different namespaces. */
export async function readSienergySelectors(filename:string):Promise<SienergySelectors>{
 const hash=createHash("sha256");
 const nodes=new Map<string,SienergySelector>(),diagnostics:SienergySelectors["diagnostics"]=[],stack:SienergySelector[]=[];
 const decoder=new TextDecoder("windows-1252");let pending="",active=false,namespace="10",line=0,current:SienergySelector|undefined;
 const accept=(text:string)=>{
  line++;const section=/^0 (10|11) [a-f0-9]+ 0\s*;/.exec(text);
  if(section){active=true;namespace=section[1]!;stack.length=0;current=undefined;return;}if(!active)return;
  const h=/^(\d+) (\d+) ([a-f0-9]+) ([a-f0-9]+) (-1|0:[a-f0-9]+\[\d+\]\([^)]*\))\s+(.+)\s*;$/.exec(text);
  if(h&&/^(?:0|1\s+'(?:\\.|[^'\\])*')\s+0\s+0\s+\d+(?:\s|$)/.test(h[6]!)){
   const depth=Number(h[1]);while(stack.length&&stack.at(-1)!.depth>=depth)stack.pop();
   if(nodes.has(`${namespace}:${h[3]}`))throw new Error(`Duplicate selector ${h[3]} at ${line}`);
   current={id:h[3]!,namespace,parentId:stack.at(-1)?.id??null,depth,opcode:Number(h[2]),alias:new RegExp(reference).exec(h[5]!)?.[1]??null,
    sourceLine:line,label:"",outputs:[],headerTail:h[6]!,extra:[]};nodes.set(`${namespace}:${current.id}`,current);stack.push(current);return;
  }
  if(/^\d+ -\d+ /.test(text))return;
  if(!current)return;
  if(/^0\s+'/.test(text)||/^0 1\s+'/.test(text)){
   try{current.label=sienergyTokens(text).find((_,i)=>i>0&&!(i===1&&text.startsWith("0 1 ")))??"";}catch{diagnostics.push({line,message:"Invalid selector label"});}return;
  }
  if(text.startsWith("1 ")&&text.includes("0:")){
   const prefix=/^1 (\d+)\s+/.exec(text);if(!prefix){current.extra.push(text);return;}
   const typed=[...text.matchAll(new RegExp(`(0100|0101)\\s+(\\d+(?:\\.\\d+)?)\\s+${reference}`,"g"))];
   const plain=new RegExp(`^1 1\\s+${reference}\\s+0\\s+0\\s*;`).exec(text);
   if(typed.length===Number(prefix[1])){
    current.outputs=typed.map(m=>({role:m[1]==="0101"?"graphic":"article",quantity:Number(m[2]),targetId:m[3]!}));
    const suffix=text.slice(typed.at(-1)!.index!+typed.at(-1)![0].length).trim();try{current.label=sienergyTokens(suffix)[0]??current.label;}catch{current.extra.push(text);}
   }else if(plain)current.outputs=[{role:"article",targetId:plain[1]!,quantity:1}];
   else current.extra.push(text);
   return;
  }
  if(text.trim()&&text.trim()!==";")current.extra.push(text);
 };
 for await(const bytes of createReadStream(filename)){hash.update(bytes);pending+=decoder.decode(bytes,{stream:true});let end:number;while((end=pending.indexOf("\n"))>=0){accept(pending.slice(0,end).replace(/\r$/,""));pending=pending.slice(end+1);}if(pending.length>2000000)throw new Error("Oversized selector line");}
 pending+=decoder.decode();if(pending)accept(pending);
 return {nodes,diagnostics,sha256:hash.digest("hex")};
}
export function selectorPath(selectors:SienergySelectors,id:string,namespace="10"):SienergySelector[]{
 const result:SienergySelector[]=[];let node=selectors.nodes.get(`${namespace}:${id}`);while(node){if(result.length>64||result.includes(node))throw new Error("Cyclic selector ancestry");result.unshift(node);node=node.parentId?selectors.nodes.get(`${namespace}:${node.parentId}`):undefined;}return result;
}
