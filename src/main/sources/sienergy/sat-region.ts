type Point=[number,number];
const n=(raw:string|undefined)=>{const value=Number(raw);if(raw===undefined||!Number.isFinite(value)||Math.abs(value)>1e7)throw new Error("Invalid SAT coordinate");return value;};
/** Project planar SAT boundary edges; unknown curves or record layouts fail the entire region. */
export function satRegionPaths(lines:unknown):Point[][]{
 if(!Array.isArray(lines)||lines.some(l=>typeof l!=="string")||!/^\s*(400|700)\s/.test(lines[0]??""))throw new Error("Unsupported SAT version");
 const records=(lines as string[]).slice(3).join(" ").split("#").map(r=>r.trim()).filter(Boolean);
 if(records.length>50000)throw new Error("SAT record budget exceeded");
 const result:Point[][]=[];let plane:number|undefined;
 const vertex=(id:number):[number,number,number]=>{
  const v=/^vertex\s+\$-?\d+\s+\$-?\d+\s+\$(\d+)(?:\s|$)/.exec(records[id]??"");if(!v)throw new Error("Unsupported SAT vertex");
  const tokens=(records[Number(v[1])]??"").split(/\s+/);if(tokens[0]!=="point")throw new Error("Missing SAT point");
  const p:[number,number,number]=[n(tokens[2]),n(tokens[3]),n(tokens[4])];
  if(plane===undefined)plane=p[2];if(Math.abs(p[2]-plane)>1e-6)throw new Error("Nonplanar SAT region");return p;
 };
 for(const record of records){
  if(!record.startsWith("edge "))continue;
  const edge=/^edge\s+\$-?\d+\s+\$(\d+)\s+\$(\d+)\s+\$-?\d+\s+\$(\d+)\s+(forward|reversed)(?:\s|$)/.exec(record);
  if(!edge)throw new Error("Unsupported SAT edge");
  const a=vertex(Number(edge[1])),b=vertex(Number(edge[2])),curve=(records[Number(edge[3])]??"").split(/\s+/);
  if(curve[0]==="straight-curve"){
   const origin=[n(curve[2]),n(curve[3]),n(curve[4])],dir=[n(curve[5]),n(curve[6]),n(curve[7])],length=Math.hypot(...dir);
   if(!length||Math.abs(dir[2]!)>1e-7)throw new Error("Unsupported SAT straight curve");
   for(const p of [a,b])if(Math.abs((p[0]-origin[0]!)*dir[1]!-(p[1]-origin[1]!)*dir[0]!)/length>1e-4)throw new Error("SAT vertex/curve mismatch");
   result.push([[a[0],a[1]],[b[0],b[1]]]);
  }else if(curve[0]==="ellipse-curve"){
   const c:[number,number]=[n(curve[2]),n(curve[3])],normal=[n(curve[5]),n(curve[6]),n(curve[7])],axis:[number,number]=[n(curve[8]),n(curve[9])],ratio=n(curve[11]);
   if(Math.abs(normal[0]!)>1e-7||Math.abs(normal[1]!)>1e-7||Math.abs(Math.abs(normal[2]!)-1)>1e-7||Math.abs(n(curve[10]))>1e-7||ratio<=0)throw new Error("Unsupported SAT ellipse plane");
   const rx=Math.hypot(...axis),ry=rx*ratio,rotation=Math.atan2(axis[1],axis[0]);if(rx<=0)throw new Error("Invalid SAT ellipse");
   const angle=(p:number[])=>Math.atan2((-(p[0]!-c[0])*Math.sin(rotation)+(p[1]!-c[1])*Math.cos(rotation))/ry,((p[0]!-c[0])*Math.cos(rotation)+(p[1]!-c[1])*Math.sin(rotation))/rx);
   const start=angle(a),end=angle(b),direction=(edge[4]==="forward"?1:-1)*Math.sign(normal[2]!);
   let span=((end-start)*direction+Math.PI*4)%(Math.PI*2);if(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-7)span=Math.PI*2;
   const steps=Math.max(2,Math.ceil(span/Math.max(0.002,2*Math.acos(Math.max(-1,1-0.01/Math.max(rx,ry))))));if(steps>20000)throw new Error("SAT curve budget exceeded");
   result.push(Array.from({length:steps+1},(_,i)=>{const t=start+direction*span*i/steps,x=rx*Math.cos(t),y=ry*Math.sin(t);return[c[0]+x*Math.cos(rotation)-y*Math.sin(rotation),c[1]+x*Math.sin(rotation)+y*Math.cos(rotation)]as Point;}));
  }else throw new Error(`Unsupported SAT curve ${curve[0]}`);
 }
 if(!result.length)throw new Error("SAT region has no boundary edges");return result;
}
