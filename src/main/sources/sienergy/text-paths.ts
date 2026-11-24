import {readFileSync}from"node:fs";
import opentype from"opentype.js";
type Point=[number,number];
export type TextOutliner=(text:string,height:number)=>{paths:Point[][];advance:number;bounds:[number,number,number,number]};
/** Preparation-only font outlining. Cubics/quadratics are flattened to the inert M/L/Z vocabulary. */
export function createTextOutliner(filename:string):TextOutliner{
 const bytes=readFileSync(filename),font=opentype.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 const cap=font.charToGlyph("H").getBoundingBox(),capHeight=cap.y2-cap.y1;
 if(capHeight<=0)throw new Error("Font has no usable cap height");
 return(text,height)=>{
  if(text.length>2000||!Number.isFinite(height)||height<=0||height>10000)throw new Error("Invalid CAD text dimensions");
  const size=height*font.unitsPerEm/capHeight,path=font.getPath(text,0,0,size),paths:Point[][]=[];let current:Point[]=[],last:Point=[0,0],start:Point=[0,0],count=0;
  const push=(p:Point)=>{if(++count>100000)throw new Error("Font outline budget exceeded");current.push(p);last=p;};
  const flat=(a:Point,b:Point,controls:Point[],evaluate:(t:number)=>Point)=>{
   const length=Math.hypot(b[0]-a[0],b[1]-a[1]),distance=(p:Point)=>length?Math.abs((b[0]-a[0])*(a[1]-p[1])-(a[0]-p[0])*(b[1]-a[1]))/length:Math.hypot(p[0]-a[0],p[1]-a[1]);
   const steps=Math.min(1000,Math.max(2,Math.ceil(Math.sqrt(Math.max(...controls.map(distance))/0.005)*2)));
   for(let i=1;i<=steps;i++)push(evaluate(i/steps));
  };
  for(const command of path.commands){
   if(command.type==="M"){if(current.length)paths.push(current);current=[];start=[command.x,-command.y];push(start);}
   else if(command.type==="L")push([command.x,-command.y]);
   else if(command.type==="C"){const a=last,b:Point=[command.x,-command.y],c:Point=[command.x1,-command.y1],d:Point=[command.x2,-command.y2];flat(a,b,[c,d],t=>{const u=1-t;return[u*u*u*a[0]+3*u*u*t*c[0]+3*u*t*t*d[0]+t*t*t*b[0],u*u*u*a[1]+3*u*u*t*c[1]+3*u*t*t*d[1]+t*t*t*b[1]];});}
   else if(command.type==="Q"){const a=last,b:Point=[command.x,-command.y],c:Point=[command.x1,-command.y1];flat(a,b,[c],t=>{const u=1-t;return[u*u*a[0]+2*u*t*c[0]+t*t*b[0],u*u*a[1]+2*u*t*c[1]+t*t*b[1]];});}
   else if(command.type==="Z"){push(start);if(current.length)paths.push(current);current=[];}
  }
  if(current.length)paths.push(current);
  const box=path.getBoundingBox();
  return {paths,advance:font.getAdvanceWidth(text,size),bounds:[box.x1,-box.y2,box.x2-box.x1,box.y2-box.y1]};
 };
}
