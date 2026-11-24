import {expect,it} from "vitest";
import {convertDwgJson,frameDrawingViewport} from "../src/main/sources/sienergy/dwg-svg.js";
import {parseFrontVectorSvg} from "../src/main/catalogue/vector-assets.js";
import {satRegionPaths} from "../src/main/sources/sienergy/sat-region.js";
it("expands owned blocks with scale, rotation and base points, excluding unused model extents",()=>{
 const result=convertDwgJson({HEADER:{EXTMAX:[900,900]},OBJECTS:[
  {object:"BLOCK_HEADER",handle:[0,1,1],base_pt:[1,1]},
  {entity:"LINE",ownerhandle:[5,1,1,1],start:[1,1],end:[2,1]},
  {entity:"LINE",ownerhandle:[5,1,1,1],start:[2,1],end:[2,2]},
  {entity:"INSERT",entmode:2,ins_pt:[10,20],scale:[2,3],rotation:Math.PI/2,block_header:[5,1,1,1]},
  {entity:"TEXT",ownerhandle:[5,1,99,99],text_value:"unused"}]});
 expect(result.unsupported).toEqual([]);expect(result.bounds).toEqual([7,-22,3,2]);
 expect(parseFrontVectorSvg(result.svg)?.strokes).toContain("M 10 -20 L 10 -22");
});
it("uses source frame dimensions for physical fronts while clipping CAD construction marks",()=>{
 const drawing=convertDwgJson({OBJECTS:[{entity:"LINE",entmode:2,start:[-35,-18],end:[600,2000]}]});
 const frame=frameDrawingViewport(drawing,[0,0],[600,2000]);
 expect(parseFrontVectorSvg(frame.svg)?.viewBox).toEqual([0,-2000,600,2000]);
 expect(()=>frameDrawingViewport(drawing,[0,0],[800,2000])).toThrow("does not cover");
});
it("reports visible unsupported entities instead of silently dropping them",()=>{
 const result=convertDwgJson({OBJECTS:[{entity:"LINE",entmode:2,start:[0,0],end:[18,53]},
  {entity:"TEXT",entmode:2,text_value:"<script>not markup</script>"}]});
 expect(result.unsupported).toEqual(["TEXT"]);expect(result.svg).not.toContain("script");
});
it("handles bulged polylines and rejects cycles and invalid coordinates",()=>{
 const result=convertDwgJson({OBJECTS:[{entity:"LWPOLYLINE",entmode:2,points:[[0,0],[2,0]],bulges:[1],flag:0}]});
 expect(result.bounds[2]).toBeCloseTo(2);expect(result.bounds[3]).toBeCloseTo(1,2);
 const block={object:"BLOCK_HEADER",handle:[0,1,1],base_pt:[0,0]};
 expect(()=>convertDwgJson({OBJECTS:[block,{entity:"INSERT",ownerhandle:[5,1,1,1],ins_pt:[0,0],block_header:[5,1,1,1]},
  {entity:"INSERT",entmode:2,ins_pt:[0,0],block_header:[5,1,1,1]}]})).toThrow("cyclic");
 expect(()=>convertDwgJson({OBJECTS:[{entity:"LINE",entmode:2,start:[NaN,0],end:[1,1]}]})).toThrow("coordinate");
});
it("renders visible point markers without treating their text as executable content",()=>{
 const result=convertDwgJson({OBJECTS:[{entity:"POINT",entmode:2,x:0,y:0},
  {entity:"LINE",entmode:2,start:[0,0],end:[18,53]}]});
 expect(result.unsupported).toEqual([]);expect(parseFrontVectorSvg(result.svg)?.fills).toContain(" Z");
});
it("honours layer visibility and explicit model-space ownership in newer DWGs",()=>{
 const result=convertDwgJson({OBJECTS:[
  {object:"BLOCK_HEADER",name:"*Model_Space",handle:[0,1,1]},
  {object:"LAYER",handle:[0,1,2],off:1},
  {entity:"LINE",ownerhandle:[5,1,1,1],start:[0,0],end:[18,53]},
  {entity:"TEXT",ownerhandle:[5,1,1,1],layer:[5,1,2,2],text_value:"hidden"}]});
 expect(result.unsupported).toEqual([]);expect(result.bounds).toEqual([0,-53,18,53]);
});
it("clips hatch lines to concave boundaries and holes",()=>{
 const loop=(ps:number[][])=>({closed:1,polyline_paths:ps.map(point=>({point}))});
 const result=convertDwgJson({OBJECTS:[{entity:"HATCH",entmode:2,style:0,is_solid_fill:0,angle:0,scale_spacing:1,
  paths:[loop([[0,0],[4,0],[4,4],[0,4]]),loop([[1,1],[3,1],[3,3],[1,3]])],
  deflines:[{angle:0,pt0:[0,0.5],offset:[0,1],dashes:[]}]}]});
 expect(result.unsupported).toEqual([]);expect(parseFrontVectorSvg(result.svg)?.strokes).toContain("M 0 -1.5 L 1 -1.5 M 3 -1.5 L 4 -1.5");
});
it("outlines aligned and rotated CAD text into inert paths and rejects unsupported text formatting",()=>{
 const outline=()=>({paths:[[[0,0],[2,0],[2,4],[0,4]] as [number,number][]],advance:2,bounds:[0,0,2,4] as [number,number,number,number]});
 const result=convertDwgJson({OBJECTS:[{entity:"TEXT",entmode:2,text_value:"label",height:4,
  horiz_alignment:1,vert_alignment:2,alignment_pt:[10,20],rotation:Math.PI/2}]},outline);
 expect(result.unsupported).toEqual([]);expect(result.bounds).toEqual([8,-21,4,2]);
 expect(parseFrontVectorSvg(result.svg)).not.toBeNull();expect(result.svg).not.toContain("label");
 expect(convertDwgJson({OBJECTS:[{entity:"LINE",entmode:2,start:[0,0],end:[1,1]},{entity:"TEXT",entmode:2,text_value:"%%d",height:4}]},outline).unsupported).toEqual(["TEXT_FORMAT"]);
});
it("projects planar SAT edges and rejects nonplanar or unknown curves",()=>{
 const sat=["400 0 0 0","header","header",
  "vertex $-1 $-1 $1 # point $-1 0 0 0 # vertex $-1 $-1 $3 # point $-1 5 0 0 #",
  "straight-curve $-1 0 0 0 1 0 0 # edge $-1 $0 $2 $-1 $4 forward #"];
 expect(satRegionPaths(sat)).toEqual([[[0,0],[5,0]]]);
 expect(()=>satRegionPaths(sat.map(s=>s.replace("5 0 0 #","5 0 1 #")))).toThrow("Nonplanar");
 expect(()=>satRegionPaths(sat.map(s=>s.replace("straight-curve","spline-curve")))).toThrow("Unsupported SAT curve");
});
