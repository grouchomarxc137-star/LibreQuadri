import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import MDBReader from "mdb-reader";
import { convertDxfBlock } from "./dxf-svg.js";

const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
export const TIQUADRI_DRAWING_ADAPTER_VERSION = "2";
const normalize = (key: string) => key.replace(/\\/g,"/").split("/").at(-1)!.replace(/\.wmf$/i,"").toLocaleLowerCase("en-US");

export const FRONT_DRAWING_KEYS_SQL = `
  SELECT v.asset_key FROM cat_phys_view v JOIN cat_phys_profile p ON p.id=v.profile_id
    LEFT JOIN app_source_import i ON i.id=p.source_import_id
    WHERE v.asset_key IS NOT NULL AND trim(v.asset_key) != '' AND (p.source='manual' OR i.adapter_code='tiquadri')
  UNION SELECT l.asset_key FROM cat_config_rule_front_label l JOIN cat_config_rule r ON r.id=l.rule_id
    JOIN cat_config_model m ON m.id=r.model_id LEFT JOIN app_source_import i ON i.id=m.source_import_id
    WHERE m.active=1 AND m.obsolete=0 AND (m.source='manual' OR i.adapter_code='tiquadri')`;

export interface DrawingImportResult {
  readonly referenced: number;
  readonly resolved: number;
  readonly missing: readonly string[];
  readonly invalid: readonly string[];
  readonly unsupported: Readonly<Record<string,number>>;
  readonly alreadyImported: boolean;
}

/** Same inventory/version identity for importing and read-only sync planning. */
export function tiQuadriDrawingFingerprint(database: Database.Database, sourceSha: string): string {
  const keys = database.prepare(FRONT_DRAWING_KEYS_SQL).pluck().all() as string[];
  return sha(`tiquadri-dxf:${TIQUADRI_DRAWING_ADAPTER_VERSION}:${sourceSha}:${sha(keys.sort().join("\n"))}`);
}

export function tiQuadriDrawingsCurrent(database: Database.Database, fingerprint: string): boolean {
  const current = database.prepare(`SELECT fingerprint, adapter_version FROM app_source_import
    WHERE adapter_code='assets' AND source_label LIKE 'DXF_BLOCK:%' AND became_current=1`).all() as
    {fingerprint: string; adapter_version: string}[];
  return current.length === 1 && current[0]!.fingerprint === fingerprint && current[0]!.adapter_version === TIQUADRI_DRAWING_ADAPTER_VERSION;
}

/** Local per-installation import. The source MDB and SVG files live under assetsRoot, outside Git. */
export function importTiQuadriDrawingAssets(options: {
  database: Database.Database; sourcePath: string; assetsRoot: string; importedAt?: Date;
}): DrawingImportResult {
  const source = readFileSync(options.sourcePath);
  const reader = new MDBReader(source);
  if (!reader.getTableNames().includes("DXF_BLOCK")) throw new Error("DXF_BLOCK table is missing");
  return importDrawingBlocks({database:options.database,assetsRoot:options.assetsRoot,source,
    sourceName:path.basename(options.sourcePath),importedAt:options.importedAt,
    blocks:reader.getTable("DXF_BLOCK").getData() as {NOME:string;CONTENUTO:string}[]});
}

/** The MDB adapter supplies rows; this core also accepts small synthetic test fixtures. */
export function importDrawingBlocks(options: {
  database: Database.Database; assetsRoot:string; source:Buffer; sourceName:string;
  blocks:readonly {NOME:string;CONTENUTO:string}[]; importedAt?:Date;
}):DrawingImportResult {
  const {database,assetsRoot,source} = options;
  if (database.inTransaction) throw new Error("Drawing import requires its own transaction");
  const sourceSha = sha(source);
  const referenced = database.prepare(FRONT_DRAWING_KEYS_SQL).pluck().all() as string[];
  const fingerprint = tiQuadriDrawingFingerprint(database, sourceSha);
  const previous = database.prepare("SELECT summary_json FROM app_source_import WHERE fingerprint=?")
    .get(fingerprint) as {summary_json:string}|undefined;
  if (previous && tiQuadriDrawingsCurrent(database, fingerprint)) return {...JSON.parse(previous.summary_json) as Omit<DrawingImportResult,"alreadyImported">,
    alreadyImported:true};
  const blocks = new Map<string,string>();
  for (const row of options.blocks) {
    if (typeof row.NOME !== "string" || typeof row.CONTENUTO !== "string") continue;
    const key = normalize(row.NOME);
    if (!blocks.has(key)) blocks.set(key,row.CONTENUTO);
  }
  const converted = new Map<string,{svg:string;unsupported:readonly string[]}|Error>();
  const missing:string[] = [], invalid:string[] = [], unsupported:Record<string,number> = {};
  const resolved = new Map<string,string>();
  for (const key of referenced) {
    const blockKey = normalize(key), content = blocks.get(blockKey);
    if (!content) {missing.push(key);continue;}
    let result = converted.get(blockKey);
    if (!result) {
      try {result = convertDxfBlock(content);} catch (error) {
        result = error instanceof Error ? error : new Error(String(error));
      }
      converted.set(blockKey,result);
    }
    if (result instanceof Error) {invalid.push(key);continue;}
    resolved.set(key,result.svg);
  }
  for (const result of converted.values()) if (!(result instanceof Error)) {
    for (const kind of result.unsupported) unsupported[kind]=(unsupported[kind]??0)+1;
  }
  const summary:DrawingImportResult = {referenced:referenced.length,resolved:resolved.size,
    missing,invalid,unsupported,alreadyImported:false};
  mkdirSync(assetsRoot,{recursive:true});
  const sourceRel = path.join("tiquadri-dxf",`${sourceSha}.mdb`);
  const sourceFile = path.join(assetsRoot,sourceRel);
  mkdirSync(path.dirname(sourceFile),{recursive:true});
  if (existsSync(sourceFile)) {
    if (sha(readFileSync(sourceFile))!==sourceSha) throw new Error("Archived drawing source hash mismatch");
  } else writeFileSync(sourceFile,source,{flag:"wx"});
  const files = new Map<string,{rel:string;bytes:Buffer}>();
  for (const svg of new Set(resolved.values())) {
    const bytes=Buffer.from(svg,"utf8"), digest=sha(bytes);
    const rel=path.join("tiquadri-dxf",`${digest}.svg`);
    const filename=path.join(assetsRoot,rel);
    if (existsSync(filename)) {
      if (sha(readFileSync(filename))!==digest) throw new Error(`Drawing asset hash mismatch: ${filename}`);
    } else writeFileSync(filename,bytes,{flag:"wx"});
    files.set(svg,{rel,bytes});
  }
  database.transaction(() => {
    database.prepare("UPDATE app_source_import SET became_current=0 WHERE adapter_code='assets' AND source_label LIKE 'DXF_BLOCK:%'").run();
    const importId=(database.prepare(`INSERT INTO app_source_import
      (adapter_code,adapter_version,source_label,fingerprint,imported_at,became_current,summary_json)
      VALUES('assets',?,?,?,?,1,?) ON CONFLICT(fingerprint) DO UPDATE SET
        adapter_version=excluded.adapter_version,source_label=excluded.source_label,
        imported_at=excluded.imported_at,became_current=1,summary_json=excluded.summary_json
        RETURNING id`).get(TIQUADRI_DRAWING_ADAPTER_VERSION,`DXF_BLOCK:${options.sourceName}`,fingerprint,
        (options.importedAt??new Date()).toISOString(),JSON.stringify(summary)) as {id:number}).id;
    database.prepare(`INSERT INTO app_source_import_file(import_id,role,file_sha256,original_file_name,byte_size)
      VALUES(?,'dxf',?,?,?) ON CONFLICT(import_id,role) DO UPDATE SET
        file_sha256=excluded.file_sha256,original_file_name=excluded.original_file_name,
        byte_size=excluded.byte_size`).run(importId,sourceSha,options.sourceName,source.length);
    database.prepare(`INSERT INTO cat_asset_license(code,name,may_display,may_embed_in_project,notes)
      VALUES('manufacturer_unverified','Local manufacturer drawing',1,0,'Local display only; no project embedding')
      ON CONFLICT(code) DO NOTHING`).run();
    const insertAsset=database.prepare(`INSERT INTO cat_asset(sha256,media_type,byte_size,rel_path,origin,
      derived_from_asset_id,license_code,source_import_id,source_ref)
      VALUES(?,?,?,?,?,?, 'manufacturer_unverified',?,?) ON CONFLICT(sha256) DO NOTHING`);
    insertAsset.run(sourceSha,"application/vnd.ms-access",source.length,sourceRel,"manufacturer",null,
      importId,"DXF_BLOCK source");
    const sourceId=(database.prepare("SELECT id FROM cat_asset WHERE sha256=?").get(sourceSha) as {id:number}).id;
    const ids = new Map<string,number>();
    for (const [svg,{rel,bytes}] of files) {
      const digest=sha(bytes);
      insertAsset.run(digest,"image/svg+xml",bytes.length,rel,"derived",sourceId,importId,"DXF_BLOCK");
      ids.set(svg,(database.prepare("SELECT id FROM cat_asset WHERE sha256=?").get(digest) as {id:number}).id);
    }
    database.prepare(`DELETE FROM cat_asset_variant WHERE variant='front_light' AND asset_id IN
      (SELECT a.id FROM cat_asset a JOIN app_source_import i ON i.id=a.source_import_id
       WHERE i.adapter_code='assets' AND a.source_ref='DXF_BLOCK')`).run();
    const upsert=database.prepare(`INSERT INTO cat_asset_variant(asset_key,variant,asset_id)
      VALUES(?,'front_light',?) ON CONFLICT(asset_key,variant) DO UPDATE SET asset_id=excluded.asset_id
      WHERE (SELECT origin FROM cat_asset WHERE id=cat_asset_variant.asset_id)!='lq_authored'`);
    for (const [key,svg] of resolved) upsert.run(key,ids.get(svg));
  })();
  return summary;
}
