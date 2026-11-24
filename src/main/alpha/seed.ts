import { createHash } from "node:crypto";
import { constants, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { assertCompatibleMigrationHistory } from "../database/lq-migrations.js";
import { assertQuickCheck } from "../database/sqlite-connection.js";
import { readEngineeringReadiness } from "../catalogue/engineering-readiness.js";
import { parseFrontVectorSvg, readFrontVectorAssets } from "../catalogue/vector-assets.js";
import { applicationPaths } from "../data-paths.js";
import { ALPHA_VERSION, ALPHA1_VERSION, ALPHA11_VERSION, BETA1_VERSION } from "./identity.js";
import { ENGINEERING_LINK_POLICY_VERSION } from "../sources/engineering-links.js";
import { FRONT_DRAWING_KEYS_SQL } from "../sources/tiquadri/drawing-assets.js";

// Reviewed current bootstrap profile (STATUS, 2026-10-06). A different source
// generation needs deliberate review, not silently relaxed packaging checks.
export const ALPHA_COUNTS = {
  products: 122535, brands: 9, models: 10800, activeModels: 7823,
  obsoleteModels: 2977, drawingKeys: 4096, resolvedDrawings: 4074,
};
export const ALPHA1_PROFILE = {
  version: ALPHA1_VERSION,
  counts: { ...ALPHA_COUNTS, drawingKeys: 4120, resolvedDrawings: 4098 },
};
const ALPHA0_PROFILE = { version: ALPHA_VERSION, counts: ALPHA_COUNTS };
export const ALPHA11_PROFILE = { ...ALPHA1_PROFILE, version: ALPHA11_VERSION };
export const BETA1_PROFILE = {
  ...ALPHA1_PROFILE, version: BETA1_VERSION, cleanUserState: true, preservePreferences: true,
  // Adapter 13 restores 23 reviewed factory mounting-panel models.
  counts: { ...ALPHA1_PROFILE.counts, models: 10823, activeModels: 7846 },
};
export interface AlphaProfile {
  readonly version: string;
  readonly counts: typeof ALPHA_COUNTS;
  readonly cleanUserState?: boolean;
  readonly preservePreferences?: boolean;
}
interface AssetFile { rel: string; sha: string; size: number }
export interface AlphaManifest {
  version: string;
  databaseSha256: string;
  counts: typeof ALPHA_COUNTS;
  assets: AssetFile[];
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Reject traversal and symlinks at every component, including the asset root. */
function regularFile(root: string, relative: string): string {
  const parts = relative.split("/");
  if (path.isAbsolute(relative) || parts.some(p => !p || p === "." || p === ".." || p.includes("\\"))) {
    throw new Error(`Unsafe Alpha seed path: ${relative}`);
  }
  let filename = root;
  if (lstatSync(filename).isSymbolicLink()) throw new Error(`Symlink seed root: ${root}`);
  for (const part of parts) {
    filename = path.join(filename, part);
    if (lstatSync(filename).isSymbolicLink()) throw new Error(`Symlink seed path: ${relative}`);
  }
  if (!lstatSync(filename).isFile()) throw new Error(`Missing regular Alpha file: ${relative}`);
  return filename;
}

export function inspectAlphaCatalogue(database: Database.Database, assetsRoot: string, migrationsFolder: string, profile: AlphaProfile = ALPHA0_PROFILE) {
  assertQuickCheck(database);
  if ((database.pragma("foreign_key_check") as unknown[]).length) throw new Error("Alpha catalogue foreign-key check failed");
  const migrations = readMigrationFiles({ migrationsFolder });
  assertCompatibleMigrationHistory(database, migrations);
  const applied = database.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as {n: number};
  if (applied.n !== migrations.length) throw new Error("Alpha seed must contain every current migration");
  const count = (sql: string) => (database.prepare(sql).get() as {n: number}).n;
  const counts = {
    products: count("SELECT count(*) AS n FROM cat_product"),
    brands: count("SELECT count(*) AS n FROM cat_brand"),
    models: count("SELECT count(*) AS n FROM cat_config_model"),
    activeModels: count("SELECT count(*) AS n FROM cat_config_model WHERE active=1 AND obsolete=0"),
    obsoleteModels: count("SELECT count(*) AS n FROM cat_config_model WHERE obsolete=1"),
    drawingKeys: count("SELECT count(DISTINCT asset_key) AS n FROM cat_phys_view WHERE asset_key IS NOT NULL AND trim(asset_key)!=''"),
    resolvedDrawings: count(`SELECT count(DISTINCT v.asset_key) AS n FROM cat_asset_variant v
      JOIN cat_asset a ON a.id=v.asset_id JOIN cat_asset_license l ON l.code=a.license_code
      WHERE v.variant IN ('front_light','front_dark') AND a.media_type='image/svg+xml' AND l.may_display=1
      AND v.asset_key IN (SELECT asset_key FROM cat_phys_view)`),
  };
  for (const key of Object.keys(ALPHA_COUNTS) as (keyof typeof ALPHA_COUNTS)[]) {
    if (counts[key] !== profile.counts[key]) throw new Error(`Alpha ${key}: expected ${profile.counts[key]}, got ${counts[key]}`);
  }
  const deliveries = database.prepare(`SELECT i.metel_sigla AS issuer, d.summary_json AS summary
    FROM app_import_delivery d JOIN cat_metel_issuer i ON i.id=d.issuer_id WHERE d.became_current=1`).all() as {issuer:string;summary:string}[];
  for (const [issuer, products] of [["BTI",24676],["SIE",68117],["SNR",29742]] as const) {
    const rows = deliveries.filter(d => d.issuer === issuer);
    if (rows.length !== 1 || JSON.parse(rows[0]!.summary).productCount !== products) {
      throw new Error(`Alpha requires the reviewed complete ${issuer} delivery (${products} products)`);
    }
  }
  const readiness = readEngineeringReadiness(database);
  if (readiness.sources.some(source => source.status !== "ready")) throw new Error("Alpha engineering source is missing or stale");
  if (profile.cleanUserState && database.prepare(
    "SELECT value FROM app_setting WHERE key='catalogue.engineering_link_policy'",
  ).pluck().get() !== ENGINEERING_LINK_POLICY_VERSION) throw new Error("Beta seed requires the current engineering link policy");
  const models = database.prepare("SELECT source,source_import_id AS sourceImportId FROM cat_config_model").all() as {source:string;sourceImportId:number|null}[];
  if (models.some(model => readiness.staleModel(model))) throw new Error("Alpha model provenance is stale");
  const assets = database.prepare(`SELECT DISTINCT a.rel_path AS rel,a.sha256 AS sha,a.byte_size AS size
    FROM cat_asset_variant v JOIN cat_asset a ON a.id=v.asset_id
    JOIN cat_asset_license l ON l.code=a.license_code
    WHERE v.variant IN ('front_light','front_dark') AND a.media_type='image/svg+xml' AND l.may_display=1
    AND v.asset_key IN (${FRONT_DRAWING_KEYS_SQL}) ORDER BY a.rel_path`).all() as AssetFile[];
  for (const asset of assets) {
    if (!asset.rel.endsWith(".svg")) throw new Error(`Unexpected Alpha drawing: ${asset.rel}`);
    const bytes = readFileSync(regularFile(assetsRoot, asset.rel));
    if (bytes.length !== asset.size || hash(bytes) !== asset.sha || !parseFrontVectorSvg(bytes.toString("utf8"))) {
      throw new Error(`Invalid Alpha drawing: ${asset.rel}`);
    }
  }
  const keys = database.prepare(`SELECT DISTINCT asset_key AS key FROM cat_asset_variant
    WHERE variant IN ('front_light','front_dark') AND asset_key IN (${FRONT_DRAWING_KEYS_SQL})`).all() as {key:string}[];
  let resolved = 0;
  for (let start = 0; start < keys.length; start += 500) {
    resolved += Object.keys(readFrontVectorAssets(database, assetsRoot, keys.slice(start,start+500).map(k => k.key))).length;
  }
  if (resolved !== keys.length) throw new Error("Alpha runtime drawing resolution is incomplete");
  return { counts, assets };
}

/** Called only after the existing bootstrap, never from implicit Electron userData. */
export async function createAlphaSnapshot(dataRoot: string, seedRoot: string, migrationsFolder: string, profile: AlphaProfile = ALPHA0_PROFILE): Promise<AlphaManifest> {
  if (existsSync(seedRoot)) throw new Error(`Alpha seed already exists: ${seedRoot}; choose a new output or archive it deliberately`);
  const paths = applicationPaths(dataRoot);
  const database = new Database(paths.lqDatabase, { readonly: true, fileMustExist: true });
  try {
    const inventory = inspectAlphaCatalogue(database, paths.assets, migrationsFolder, profile);
    mkdirSync(path.join(seedRoot,"data"), {recursive:true});
    mkdirSync(path.join(seedRoot,"assets"), {recursive:true});
    await database.backup(path.join(seedRoot,"data","lq.db"));
    // A closed, single-file read-only seed; runtime opens its installed copy in WAL.
    const snapshot = new Database(path.join(seedRoot,"data","lq.db"));
    try {
      snapshot.pragma("journal_mode = DELETE");
      if (profile.cleanUserState) {
        snapshot.exec("DELETE FROM app_recent_file;");
        if (!profile.preservePreferences) snapshot.exec("DELETE FROM app_setting WHERE key LIKE 'ui.%';");
        snapshot.exec("VACUUM;");
      }
    } finally { snapshot.close(); }
    for (const asset of inventory.assets) {
      const destination = path.join(seedRoot,"assets",asset.rel);
      mkdirSync(path.dirname(destination),{recursive:true});
      copyFileSync(regularFile(paths.assets,asset.rel),destination,constants.COPYFILE_EXCL);
    }
    const manifest: AlphaManifest = {version: profile.version, databaseSha256: hash(readFileSync(path.join(seedRoot,"data","lq.db"))), ...inventory};
    writeFileSync(path.join(seedRoot,"manifest.json"),JSON.stringify(manifest,null,2)+"\n",{flag:"wx"});
    validateAlphaSeed(seedRoot,migrationsFolder,profile);
    return manifest;
  } finally { database.close(); }
}

export function validateAlphaSeed(seedRoot: string, migrationsFolder: string, profile: AlphaProfile = ALPHA0_PROFILE): AlphaManifest {
  const manifest = JSON.parse(readFileSync(regularFile(seedRoot,"manifest.json"),"utf8")) as AlphaManifest;
  if (manifest.version !== profile.version) throw new Error(`Not a ${profile.version} seed`);
  const filename = regularFile(seedRoot,"data/lq.db");
  if (hash(readFileSync(filename)) !== manifest.databaseSha256) throw new Error("Alpha database SHA-256 mismatch");
  const database = new Database(filename,{readonly:true,fileMustExist:true});
  try {
    const inventory = inspectAlphaCatalogue(database,path.join(seedRoot,"assets"),migrationsFolder,profile);
    if (profile.cleanUserState && (database.prepare("SELECT EXISTS (SELECT 1 FROM app_recent_file)").pluck().get() ||
      (!profile.preservePreferences && database.prepare("SELECT EXISTS (SELECT 1 FROM app_setting WHERE key LIKE 'ui.%')").pluck().get()))) {
      throw new Error("Beta seed contains local user state");
    }
    if (JSON.stringify(inventory.counts) !== JSON.stringify(manifest.counts) ||
        JSON.stringify(inventory.assets) !== JSON.stringify(manifest.assets)) throw new Error("Alpha manifest inventory mismatch");
    const allowed = new Set(["manifest.json","data/lq.db",...manifest.assets.map(a => `assets/${a.rel}`)]);
    const visit = (relative: string) => {
      for (const entry of readdirSync(path.join(seedRoot,relative),{withFileTypes:true})) {
        const rel = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) visit(rel);
        else if (!entry.isFile() || !allowed.has(rel)) throw new Error(`Unexpected Alpha seed file: ${rel}`);
      }
    };
    visit("");
    return manifest;
  } finally { database.close(); }
}

/** Only absence is provisioned. Existing databases retain normal migration/readiness rules. */
export function provisionAlphaSeed(seedRoot: string, dataRoot: string, migrationsFolder: string, profile: AlphaProfile = ALPHA0_PROFILE): "installed" | "existing" {
  const paths = applicationPaths(dataRoot);
  if (existsSync(paths.lqDatabase)) return "existing";
  mkdirSync(dataRoot,{recursive:true});
  const lock = path.join(dataRoot,".alpha-provision.lock");
  mkdirSync(lock); // Fail closed on concurrent/interrupted provisioning.
  let temporary: string | undefined;
  let publishedAssets = false;
  try {
    if (existsSync(paths.lqDatabase)) return "existing";
    if (existsSync(paths.assets) || (existsSync(paths.data) && readdirSync(paths.data).length)) {
      throw new Error("Alpha provisioning found data/assets without lq.db; inspect the partial installation. No data was replaced.");
    }
    const manifest = validateAlphaSeed(seedRoot,migrationsFolder,profile);
    temporary = mkdtempSync(path.join(dataRoot,".alpha-provision-"));
    mkdirSync(path.join(temporary,"data"));
    mkdirSync(path.join(temporary,"assets"));
    copyFileSync(regularFile(seedRoot,"data/lq.db"),path.join(temporary,"data","lq.db"),constants.COPYFILE_EXCL);
    for (const asset of manifest.assets) {
      const destination = path.join(temporary,"assets",asset.rel);
      mkdirSync(path.dirname(destination),{recursive:true});
      copyFileSync(regularFile(seedRoot,`assets/${asset.rel}`),destination,constants.COPYFILE_EXCL);
    }
    writeFileSync(path.join(temporary,"manifest.json"),JSON.stringify(manifest));
    validateAlphaSeed(temporary,migrationsFolder,profile);
    renameSync(path.join(temporary,"assets"),paths.assets);
    publishedAssets = true;
    mkdirSync(paths.data,{recursive:true});
    // Atomic, exclusive publication of a closed snapshot. Never replaces a DB.
    linkSync(path.join(temporary,"data","lq.db"),paths.lqDatabase);
    console.info("Alpha catalogue provisioned", {version:profile.version,dataRoot,counts:manifest.counts});
    return "installed";
  } catch (error) {
    if (publishedAssets) rmSync(paths.assets,{recursive:true,force:true});
    throw error;
  } finally {
    if (temporary) rmSync(temporary,{recursive:true,force:true});
    rmSync(lock,{recursive:true});
  }
}
