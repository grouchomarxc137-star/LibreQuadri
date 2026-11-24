import type {TextOutliner} from "./text-paths.js";
import {satRegionPaths} from "./sat-region.js";
import {parseFrontVectorSvg} from "../../catalogue/vector-assets.js";

type Entity=Record<string,any>;
type Point=[number,number];
type Matrix=[number,number,number,number,number,number];
const identity:Matrix=[1,0,0,1,0,0],tau=Math.PI*2;
const number=(n:unknown):number=>{if(typeof n!=="number"||!Number.isFinite(n)||Math.abs(n)>1e7)throw new Error("Invalid DWG coordinate");return n;};
const point=(p:unknown):Point=>{if(!Array.isArray(p)||p.length<2)throw new Error("Missing DWG point");return [number(p[0]),number(p[1])];};
const handle=(ref:any):number=>Array.isArray(ref)?Number(ref.at(-1)):0;
const fmt=(n:number)=>Number(n.toFixed(5)).toString();
const transform=(m:Matrix,p:Point):Point=>[m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5]];
const multiply=(a:Matrix,b:Matrix):Matrix=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
export interface DwgSvg {svg:string;entities:number;bounds:[number,number,number,number];unsupported:string[];fontSubstitutions?:string[];}
/** Frame source dimensions bound the physical front; CAD construction marks may extend outside it. */
export function frameDrawingViewport(result:DwgSvg,origin:[number,number],size:[number,number]):DwgSvg{
 const box:[number,number,number,number]=[origin[0],-origin[1]-size[1],...size];
 if(box.some(n=>!Number.isFinite(n))||size.some(n=>n<=0)||box[0]<result.bounds[0]-0.5||box[1]<result.bounds[1]-0.5||
  box[0]+box[2]>result.bounds[0]+result.bounds[2]+0.5||box[1]+box[3]>result.bounds[1]+result.bounds[3]+0.5)
  throw new Error("Frame drawing does not cover source dimensions");
 return {...result,bounds:box,svg:result.svg.replace(/viewBox="[^"]+"/,`viewBox="${box.join(" ")}"`)};
}
/** Decode LibreDWG JSON into the app's inert path vocabulary; never execute source content. */
export function convertDwgJson(document:unknown,outlineText?:TextOutliner):DwgSvg{
 if(!document||typeof document!=="object"||!Array.isArray((document as Entity).OBJECTS))throw new Error("Invalid LibreDWG JSON");
 const objects=(document as Entity).OBJECTS as Entity[];
 if(objects.length>200000)throw new Error("DWG object budget exceeded");
 const byId=new Map(objects.map(e=>[handle(e.handle),e]));
 const children=new Map<number,Entity[]>();
 for(const e of objects){const owner=handle(e.ownerhandle);if(owner&&e.entity){const list=children.get(owner)??[];list.push(e);children.set(owner,list);}}
 const strokes:string[]=[],fills:string[]=[],bounds:Point[]=[],unsupported=new Set<string>(),fontSubstitutions=new Set<string>();let entities=0,points=0;
 const add=(ps:Point[],m:Matrix,closed=false,fill=false)=>{
  if(ps.length<2)return;
  points+=ps.length;if(points>300000)throw new Error("DWG point budget exceeded");
  const xy=ps.map(p=>transform(m,p)).map(([x,y])=>[number(x),-number(y)] as Point);bounds.push(...xy);
  (fill?fills:strokes).push(`M ${xy.map(p=>p.map(fmt).join(" ")).join(" L ")}${closed?" Z":""}`);entities++;
 };
 const arc=(c:Point,rx:number,ry:number,a:number,span:number,rotation=0):Point[]=>{
  if(rx<=0||ry<=0||Math.abs(span)>tau+1e-6)throw new Error("Invalid DWG arc");
  const steps=Math.max(2,Math.ceil(Math.abs(span)/Math.max(0.002,2*Math.acos(Math.max(-1,1-0.01/Math.max(rx,ry))))));
  if(steps>20000)throw new Error("DWG arc budget exceeded");
  return Array.from({length:steps+1},(_,i)=>{const t=a+span*i/steps,x=rx*Math.cos(t),y=ry*Math.sin(t);return [c[0]+x*Math.cos(rotation)-y*Math.sin(rotation),c[1]+x*Math.sin(rotation)+y*Math.cos(rotation)] as Point;});
 };
 const wideSegment=(a:Point,b:Point,width:number,m:Matrix)=>{
  const len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!len)return;
  const dx=(b[1]-a[1])*width/(2*len),dy=(b[0]-a[0])*width/(2*len);
  add([[a[0]+dx,a[1]-dy],[b[0]+dx,b[1]-dy],[b[0]-dx,b[1]+dy],[a[0]-dx,a[1]+dy]],m,true,true);
 };
 const active=new Set<number>();
 const visit=(e:Entity,m:Matrix,depth:number)=>{
  if(depth>32)throw new Error("DWG block nesting budget exceeded");
  const layer=byId.get(handle(e.layer));
  if(e.invisible===1||layer?.off===1||layer?.frozen===1)return;
  const ext=e.extrusion;if(ext&&(Math.abs(ext[0])>1e-9||Math.abs(ext[1])>1e-9||Math.abs(ext[2]-1)>1e-9)){unsupported.add("EXTRUSION");return;}
  switch(e.entity){
   case "BLOCK":case "ENDBLK":case "SEQEND":return;
   case "POINT":{const x=number(e.x),y=number(e.y);const size=bounds.length;add([[x-0.04,y-0.04],[x+0.04,y-0.04],[x+0.04,y+0.04],[x-0.04,y+0.04]],m,true,true);bounds.splice(size);const p=transform(m,[x,y]);bounds.push([p[0],-p[1]]);return;}
   case "LINE":add([point(e.start),point(e.end)],m);return;
   case "LWPOLYLINE":{
    if(!Array.isArray(e.points)){unsupported.add("LWPOLYLINE_POINTS");return;}
    const ps:Point[]=e.points.map(point),closed=(Number(e.flag)&512)!==0,flat:Point[]=[];
    const count=ps.length-(closed?0:1),width=number(e.const_width??0);
    if(e.widths?.some((v:any)=>Array.isArray(v)?v.some((n:number)=>n!==0):v!==0)){unsupported.add("VARIABLE_WIDTH");return;}
    for(let i=0;i<count;i++){
     const a=ps[i]!,b=ps[(i+1)%ps.length]!,bulge=number(e.bulges?.[i]??0);let segment:Point[]=[a,b];
     if(bulge){const chord=Math.hypot(b[0]-a[0],b[1]-a[1]),angle=4*Math.atan(bulge),radius=chord*(1+bulge*bulge)/(4*Math.abs(bulge));
      const offset=chord*(1-bulge*bulge)/(4*bulge),c:Point=[(a[0]+b[0])/2-(b[1]-a[1])*offset/chord,(a[1]+b[1])/2+(b[0]-a[0])*offset/chord];
      segment=arc(c,radius,radius,Math.atan2(a[1]-c[1],a[0]-c[0]),angle);}
     flat.push(...segment.slice(0,-1));
     if(width>0)for(let j=1;j<segment.length;j++)wideSegment(segment[j-1]!,segment[j]!,width,m);
    }
    if(width<=0){if(!closed&&ps.length)flat.push(ps.at(-1)!);add(flat,m,closed);}return;
   }
   case "CIRCLE":case "ARC":{
    const start=number(e.start_angle??0),end=number(e.end_angle??tau),span=e.entity==="CIRCLE"?tau:((end-start)%tau+tau)%tau;
    add(arc(point(e.center),number(e.radius),number(e.radius),start,span),m,e.entity==="CIRCLE");return;
   }
   case "ELLIPSE":{
    const major=point(e.sm_axis??e.major_axis),r=Math.hypot(...major),start=number(e.start_angle??0),end=number(e.end_angle??tau);
    add(arc(point(e.center),r,r*number(e.axis_ratio),start,end-start,Math.atan2(major[1],major[0])),m,Math.abs(end-start-tau)<1e-6);return;
   }
   case "TEXT":{
    if(!outlineText){unsupported.add("TEXT");return;}
    const text=String(e.text_value??"");if(!text)return;
    if(/%%|\\[A-Za-z]/.test(text)){unsupported.add("TEXT_FORMAT");return;}
    const h=Number(e.horiz_alignment??0),v=Number(e.vert_alignment??0);if(![0,1,2].includes(h)||![0,1,2,3].includes(v)){unsupported.add("TEXT_ALIGNMENT");return;}
    const result=outlineText(text,number(e.height)),at=point(h||v?e.alignment_pt??e.ins_pt:e.ins_pt),rotation=number(e.rotation??0),width=number(e.width_factor??1),oblique=number(e.oblique_angle??0);
    if(width<=0||Math.abs(oblique)>1.4)throw new Error("Invalid CAD text transform");
    const generation=Number(e.generation??0);if(generation&~6){unsupported.add("TEXT_GENERATION");return;}
    const dx=h===1?-result.advance/2:h===2?-result.advance:0;
    const dy=v===1?-result.bounds[1]:v===2?-result.bounds[1]-result.bounds[3]/2:v===3?-result.bounds[1]-result.bounds[3]:0;
    const sx=(generation&2)?-width:width,sy=(generation&4)?-1:1;
    const local:Matrix=[Math.cos(rotation),Math.sin(rotation),-Math.sin(rotation),Math.cos(rotation),at[0],at[1]];
    const normalized=result.paths.map(ps=>ps.map(([x,y])=>[sx*(x+dx)+Math.tan(oblique)*(y+dy),sy*(y+dy)]as Point));
    for(const ps of normalized)add(ps,multiply(m,local),true,true);
    const style=byId.get(handle(e.style));fontSubstitutions.add(String(style?.font_file??"unspecified"));return;
   }
   case "REGION":{if(e.acis_empty===1)return;try{for(const ps of satRegionPaths(e.acis_data))add(ps,m);}catch(error){unsupported.add(error instanceof Error?error.message:"REGION");}return;}
   case "HATCH":{
    if(!Array.isArray(e.paths)||Number(e.style)!==0||e.paths.some((p:any)=>!p.closed||!Array.isArray(p.polyline_paths)||p.polyline_paths.some((v:any)=>Number(v.bulge??0)!==0))){unsupported.add("HATCH_BOUNDARY");return;}
    const loops:Point[][]=e.paths.map((p:any)=>p.polyline_paths.map((v:any)=>point(v.point)));
    if(loops.some(ps=>ps.length<3)){unsupported.add("HATCH_BOUNDARY");return;}
    if(e.is_solid_fill){
     const inside=(p:Point,ps:Point[])=>{let yes=false;for(let i=0,j=ps.length-1;i<ps.length;j=i++){
      const a=ps[i]!,b=ps[j]!;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
     for(const ps of loops){const holes=loops.filter(other=>other!==ps&&inside(ps[0]!,other)).length;
      const area=ps.reduce((n,p,i)=>{const q=ps[(i+1)%ps.length]!;return n+p[0]*q[1]-q[0]*p[1];},0);
      add((area>0)===(holes%2===0)?ps:[...ps].reverse(),m,true,true);}
     return;
    }
    if(!Array.isArray(e.deflines)||e.double_flag||Math.abs(Number(e.angle??0))>1e-9||Math.abs(Number(e.scale_spacing??1)-1)>1e-9||e.deflines.some((d:any)=>d.dashes?.length)){
     unsupported.add("HATCH_PATTERN");return;}
    let lineCount=0;
    for(const def of e.deflines){const angle=number(def.angle),base=point(def.pt0),offset=point(def.offset),d:Point=[Math.cos(angle),Math.sin(angle)],n:Point=[-Math.sin(angle),Math.cos(angle)];
     const dot=(p:Point,q:Point)=>p[0]*q[0]+p[1]*q[1],step=dot(offset,n);if(Math.abs(step)<1e-9)throw new Error("Invalid hatch spacing");
     const projections=loops.flatMap(ps=>ps.map(p=>(dot(p,n)-dot(base,n))/step));
     const lo=Math.floor(Math.min(...projections))-1,hi=Math.ceil(Math.max(...projections))+1;
     if(hi-lo>10000)throw new Error("Hatch line budget exceeded");
     for(let k=lo;k<=hi;k++){if(++lineCount>10000)throw new Error("Hatch line budget exceeded");
      const origin:Point=[base[0]+k*offset[0],base[1]+k*offset[1]],cuts:number[]=[];
      for(const ps of loops)for(let i=0;i<ps.length;i++){const a=ps[i]!,b=ps[(i+1)%ps.length]!,da=dot(a,n)-dot(origin,n),db=dot(b,n)-dot(origin,n);
       if((da<=0&&db>0)||(db<=0&&da>0)){const t=-da/(db-da),p:Point=[a[0]+t*(b[0]-a[0])-origin[0],a[1]+t*(b[1]-a[1])-origin[1]];cuts.push(dot(p,d));}}
      cuts.sort((a,b)=>a-b);if(cuts.length%2)throw new Error("Unclosed hatch boundary");
      for(let i=0;i<cuts.length;i+=2)if(cuts[i+1]!-cuts[i]!>1e-8)add([cuts[i]!,cuts[i+1]!].map(t=>[origin[0]+t*d[0],origin[1]+t*d[1]]as Point),m);
     }
    }return;
   }
   case "SOLID":case "TRACE":{
    const ps=[e.corner1,e.corner2,e.corner4,e.corner3].map(point);add(ps,m,true,true);return;
   }
   case "INSERT":{
    const id=handle(e.block_header),block=byId.get(id);if(!block||active.has(id))throw new Error("Missing or cyclic DWG block");
    const ins=point(e.ins_pt),base=point(block.base_pt??[0,0]),scale=point(e.scale??[1,1]),r=number(e.rotation??0);
    const local:Matrix=[Math.cos(r)*scale[0],Math.sin(r)*scale[0],-Math.sin(r)*scale[1],Math.cos(r)*scale[1],ins[0],ins[1]];
    local[4]-=local[0]*base[0]+local[2]*base[1];local[5]-=local[1]*base[0]+local[3]*base[1];
    const members=children.get(id)??(Array.isArray(block.entities)?block.entities.map((ref:any)=>byId.get(handle(ref))).filter(Boolean):[]);
    if(!members.length)throw new Error("DWG block has no owned entities");
    if(e.has_attribs){unsupported.add("INSERT_ATTRIBUTES");return;}
    active.add(id);for(const child of members)if(child)visit(child,multiply(m,local),depth+1);active.delete(id);return;
   }
   // Never emit unresolved template labels or substitute a different font silently.
   case "ATTDEF":if((Number(e.flags)&1)===1)return;unsupported.add("VISIBLE_ATTRIBUTE_DEFINITION");return;
   default:unsupported.add(String(e.entity??"UNKNOWN"));
  }
 };
 const modelSpace=objects.find(e=>e.object==="BLOCK_HEADER"&&String(e.name).toUpperCase()==="*MODEL_SPACE");
 const modelHandle=modelSpace?handle(modelSpace.handle):0;
 const root=objects.filter(e=>e.entity&&(e.entmode===2||(modelHandle!==0&&handle(e.ownerhandle)===modelHandle)));
 if(!root.length)throw new Error("DWG model space is empty");
 for(const e of root)visit(e,identity,0);
 if(!bounds.length)throw new Error("DWG has no supported visible geometry");
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const [x,y]of bounds){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
 const box:[number,number,number,number]=[minX,minY,maxX-minX,maxY-minY];
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.map(fmt).join(" ")}"><path fill="none" stroke="currentColor" stroke-width="0.08" d="${strokes.join(" ")}"/><path fill="currentColor" d="${fills.join(" ")}"/></svg>`;
 if(!parseFrontVectorSvg(svg))throw new Error("Invalid normalized DWG geometry");
 return {svg,entities,bounds:box,unsupported:[...unsupported].sort(),fontSubstitutions:[...fontSubstitutions].sort()};
}
