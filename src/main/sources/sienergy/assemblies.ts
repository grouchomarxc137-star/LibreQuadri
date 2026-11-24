import type {SienergyRecord,SienergySource} from "./reader.js";
export interface AssemblyPart {record:SienergyRecord;quantity:number;}
/** A composition (source flag 16384) contributes its children, never its own aggregate price. */
export function createSienergyAssemblyExpander(source:SienergySource){
 const children=new Map<string,SienergyRecord[]>();
 for(const r of source.records.values())if(r.kind===9&&r.parentId){const list=children.get(r.parentId)??[];list.push(r);children.set(r.parentId,list);}
 return (id:string):AssemblyPart[]=>{
 const active=new Set<string>(),parts:AssemblyPart[]=[];let visits=0;
 const visit=(key:string,quantity:number)=>{
  if(++visits>10000||active.size>64)throw new Error("Sienergy composition budget exceeded");
  if(active.has(key))throw new Error(`Cyclic Sienergy composition ${key}`);
  const r=source.records.get(key);if(!r)throw new Error(`Unresolved Sienergy composition ${key}`);
  const refs=children.get(key)??[];
  if(refs.length){
   if(((r.articleFlags??0)&16384)===0)throw new Error(`Undeclared Sienergy composition ${key}`);
   active.add(key);for(const ref of refs){if(!ref.component||!Number.isFinite(ref.component.quantity)||ref.component.quantity<=0)throw new Error(`Unsupported Sienergy composition row ${ref.id}`);
    const amount=quantity*ref.component.quantity;if(!Number.isFinite(amount)||amount<=0||amount>1e9)throw new Error("Invalid composition quantity");visit(ref.component.targetId,amount);}
   active.delete(key);
  }else{
   if(((r.articleFlags??0)&16384)!==0)throw new Error(`Empty Sienergy composition ${key}`);
   parts.push({record:r,quantity});
  }
 };
 visit(id,1);return parts;
 };
}
export function expandSienergyAssembly(source:SienergySource,id:string){return createSienergyAssemblyExpander(source)(id);}
