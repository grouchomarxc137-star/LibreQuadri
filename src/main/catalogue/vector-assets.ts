import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { FrontVectorAsset } from "../../shared/project.js";

const numeric = "-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
const svgPattern = new RegExp(`^<svg xmlns="http://www\\.w3\\.org/2000/svg" viewBox="(${numeric}) (${numeric}) (${numeric}) (${numeric})"><path fill="none" stroke="currentColor" stroke-width="(${numeric})" d="([^"]*)"/><path fill="currentColor" d="([^"]*)"/></svg>$`);
const pathPattern = /^[0-9eE+.,\-\sMLAZHVm lazvh]*$/;

/** Accept only our normalized, inert path-only SVG vocabulary. */
export function parseFrontVectorSvg(svg: string): FrontVectorAsset | null {
  const match=svg.match(svgPattern);
  if (!match || !pathPattern.test(match[6]!) || !pathPattern.test(match[7]!)) return null;
  const viewBox=[1,2,3,4].map(i=>Number(match[i])) as [number,number,number,number];
  const strokeWidth=Number(match[5]);
  if (viewBox.some(n=>!Number.isFinite(n)) || viewBox[2]<=0 || viewBox[3]<=0 ||
      !Number.isFinite(strokeWidth) || strokeWidth<=0 || (!match[6] && !match[7])) return null;
  return {viewBox,strokeWidth,strokes:match[6]!,fills:match[7]!};
}

export function readFrontVectorAssets(database: Database.Database, assetsRoot: string,
  keys: readonly string[]): Record<string,FrontVectorAsset> {
  const result:Record<string,FrontVectorAsset>={};
  const query=database.prepare(`SELECT a.sha256 AS sha,a.byte_size AS size,a.rel_path AS rel
    FROM cat_asset_variant v JOIN cat_asset a ON a.id=v.asset_id
    JOIN cat_asset_license l ON l.code=a.license_code
    WHERE v.asset_key=? AND v.variant IN ('front_light','front_dark')
      AND a.media_type='image/svg+xml' AND l.may_display=1
    ORDER BY CASE v.variant WHEN 'front_light' THEN 0 ELSE 1 END LIMIT 1`);
  for (const key of new Set(keys.slice(0,500))) {
    if (typeof key!=="string" || !key || key.length>300) continue;
    const row=query.get(key) as {sha:string;size:number;rel:string}|undefined;
    if (!row || row.size<1 || row.size>5_000_000) continue;
    const filename=path.resolve(assetsRoot,row.rel);
    if (!filename.startsWith(path.resolve(assetsRoot)+path.sep)) continue;
    try {
      const bytes=readFileSync(filename);
      if (bytes.length!==row.size || createHash("sha256").update(bytes).digest("hex")!==row.sha) continue;
      const asset=parseFrontVectorSvg(bytes.toString("utf8"));
      if (asset) result[key]=asset;
    } catch { /* Local assets may be removed independently of the catalogue. */ }
  }
  return result;
}
