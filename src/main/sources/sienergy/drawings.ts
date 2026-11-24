import {createHash} from "node:crypto";
import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {parseFrontVectorSvg} from "../../catalogue/vector-assets.js";

export const SIENERGY_DRAWING_VERSION="3";
export const digest=(bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
export interface PreparedDrawing {profileId:string;drawing:string;sourceSha256:string;svgSha256:string;originMm?:[number,number];fontSubstitutions?:string[];}
export interface PreparedDrawings {version:string;masterSha256:string;converter:string;drawings:PreparedDrawing[];rejected:Record<string,string>;}
export function readPreparedDrawings(folder:string,masterSha256:string){
 const bytes=readFileSync(path.join(folder,"manifest.json")),manifest=JSON.parse(bytes.toString("utf8")) as PreparedDrawings;
 if(manifest.version!==SIENERGY_DRAWING_VERSION||manifest.masterSha256!==masterSha256||!Array.isArray(manifest.drawings)||!manifest.converter)
  throw new Error("Sienergy drawing manifest does not match master/converter version");
 const seen=new Set<string>();
 const rows=manifest.drawings.map(row=>{
  if(!/^[a-f0-9]+$/.test(row.profileId)||seen.has(row.profileId)||!row.drawing||
   !/^[a-f0-9]{64}$/.test(row.sourceSha256)||!/^[a-f0-9]{64}$/.test(row.svgSha256))throw new Error("Invalid Sienergy drawing manifest entry");
  seen.add(row.profileId);
  if(row.originMm&&(!Array.isArray(row.originMm)||row.originMm.length!==2||row.originMm.some(n=>!Number.isFinite(n)||Math.abs(n)>1e7)))throw new Error("Invalid DWG insertion origin");
  const source=readFileSync(path.join(folder,`${row.sourceSha256}.dwg`)),svg=readFileSync(path.join(folder,`${row.svgSha256}.svg`));
  if(svg.length>5_000_000)throw new Error("Prepared drawing is too large");
  const parsed=parseFrontVectorSvg(svg.toString("utf8"));
  if(digest(source)!==row.sourceSha256||digest(svg)!==row.svgSha256||!parsed)throw new Error("Prepared Sienergy drawing integrity check failed");
  return {...row,source,svg,viewBox:parsed.viewBox};
 });
 return {manifest,bytes,sha256:digest(bytes),rows};
}
export type DrawingBundle=ReturnType<typeof readPreparedDrawings>;
/** Stage content-addressed files before the catalogue transaction; a failed activation leaves no partial DB changes. */
export function stageDrawings(bundle:DrawingBundle,assetsRoot:string){
 const dir=path.join(assetsRoot,"sienergy");mkdirSync(dir,{recursive:true});
 for(const row of bundle.rows)for(const [sha,ext,bytes]of [[row.sourceSha256,"dwg",row.source],[row.svgSha256,"svg",row.svg]]as const){
  const target=path.join(dir,`${sha}.${ext}`);
  if(existsSync(target)){if(digest(readFileSync(target))!==sha)throw new Error("Installed Sienergy drawing integrity check failed");}
  else writeFileSync(target,bytes,{flag:"wx"});
 }
}
export function registerDrawings(db:Database.Database,bundle:DrawingBundle,importId:number){
 db.prepare(`INSERT INTO cat_asset_license(code,name,may_display,may_embed_in_project,notes)
  VALUES('manufacturer_unverified','Local manufacturer drawing',1,0,'Local display only; no project embedding') ON CONFLICT(code) DO NOTHING`).run();
 const insert=db.prepare(`INSERT INTO cat_asset(sha256,media_type,byte_size,rel_path,origin,derived_from_asset_id,
  license_code,source_import_id,source_ref) VALUES(?,?,?,?,?,?,'manufacturer_unverified',?,?) ON CONFLICT(sha256) DO NOTHING`);
 const id=db.prepare("SELECT id FROM cat_asset WHERE sha256=?").pluck();
 for(const row of bundle.rows){
  insert.run(row.sourceSha256,"image/vnd.dwg",row.source.length,`sienergy/${row.sourceSha256}.dwg`,"manufacturer",null,importId,row.drawing);
  insert.run(row.svgSha256,"image/svg+xml",row.svg.length,`sienergy/${row.svgSha256}.svg`,"derived",id.get(row.sourceSha256),importId,row.drawing);
  db.prepare(`INSERT INTO cat_asset_variant(asset_key,variant,asset_id) VALUES(?,'front_light',?)
    ON CONFLICT(asset_key,variant) DO UPDATE SET asset_id=excluded.asset_id
    WHERE (SELECT origin FROM cat_asset WHERE id=cat_asset_variant.asset_id)!='lq_authored'`)
   .run(`sienergy/${row.profileId}`,id.get(row.svgSha256));
 }
}
