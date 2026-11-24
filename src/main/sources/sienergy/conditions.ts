import {sienergyTokens} from "./reader.js";
export interface SelectorLiteral {first:number;last:number;exclude:boolean;}
/** Source condition vectors: alternatives within a group, zero-pair conjunctions between groups. */
export function selectorCondition(headerTail:string):SelectorLiteral[][]{
 const tokens=sienergyTokens(headerTail),start=tokens[0]==="1"?2:1;
 if(tokens[start]!=="0"||tokens[start+1]!=="0")throw new Error("Unsupported selector header flags");
 const tail=tokens.slice(start+2);
 if(tail.length===1&&tail[0]==="0")return [];
 if(tail[1]!=="0"||tail[2]!=="4"||tail[4]!=="1")throw new Error("Unsupported selector predicate encoding");
 const count=Number(tail[3]),data=tail.slice(5).map(Number);
 if(!Number.isSafeInteger(count)||count<1||data.length!==count*2||data.some(n=>!Number.isSafeInteger(n)))throw new Error("Malformed selector predicate vector");
 const groups:SelectorLiteral[][]=[[]];
 for(let i=0;i<data.length;i+=2){const a=data[i]!,b=data[i+1]!;
  if(a===0&&b===0){if(!groups.at(-1)!.length)throw new Error("Empty selector condition group");groups.push([]);continue;}
  if(!a||b<0||(b&&b<a))throw new Error("Unsupported selector condition interval");
  groups.at(-1)!.push({first:Math.abs(a),last:b||Math.abs(a),exclude:a<0});
 }
 if(!groups.at(-1)!.length)throw new Error("Empty selector condition group");return groups;
}
export function selectorConditionMatches(groups:SelectorLiteral[][],selected:ReadonlySet<number>):boolean{
 return groups.every(group=>group.some(literal=>{
  const found=[...selected].some(code=>code>=literal.first&&code<=literal.last);return literal.exclude?!found:found;
 }));
}
