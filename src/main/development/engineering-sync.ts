import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync,
  readSync, realpathSync, rmSync, statSync, statfsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import Database from "better-sqlite3";
import MDBReader from "mdb-reader";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { applicationPaths, resolveApplicationDataPath } from "../data-paths.js";
import { assertCompatibleMigrationHistory } from "../database/lq-migrations.js";
import { assertQuickCheck } from "../database/sqlite-connection.js";
import { readEngineeringReadiness, type EngineeringSourceReadiness } from "../catalogue/engineering-readiness.js";
import { TIQUADRI_ENGINEERING_ADAPTER as adapter } from "../sources/tiquadri/adapter.js";
import { importTiQuadri, readTiQuadriMasterSource, tiQuadriImportIdentity } from "../sources/tiquadri/import.js";
import { TIQUADRI_DRAWING_ADAPTER_VERSION, importTiQuadriDrawingAssets, tiQuadriDrawingFingerprint, tiQuadriDrawingsCurrent } from "../sources/tiquadri/drawing-assets.js";
import { openExclusiveCatalogue } from "./catalogue-exclusion.js";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
type SourceFile = { role: string; file_sha256: string; byte_size: number; original_file_name: string };
type Imported = { id: number; adapter_version: string; fingerprint: string };
export interface EngineeringSyncOptions {
  dataRoot: string;
  applicationRoot: string;
  check?: boolean;
  log?: (message: string) => void;
  /** Interruption is observed only after an importer/backup has settled. */
  signal?: AbortSignal;
}

/** Startup only upgrades a known older catalogue. Fresh profiles and downgrades use normal readiness checks. */
export function needsDevelopmentEngineeringUpgrade(sources: readonly EngineeringSourceReadiness[]): boolean {
  const source = sources.find(entry => entry.adapterCode === adapter.code);
  const installed = source?.installedVersion;
  return typeof installed === "string" && /^[1-9]\d*$/.test(installed) &&
    BigInt(installed) < BigInt(adapter.version);
}

async function interruptionCheckpoint(signal?: AbortSignal): Promise<void> {
  // Promise continuations alone do not dispatch OS signals queued during a
  // synchronous importer. Keep exclusion and frozen inputs until the loop runs.
  // Import phases currently resume in the check phase (better-sqlite3's backup
  // setImmediate or a preceding checkpoint), so this yield allows a poll phase.
  // Revisit if backup scheduling or phase entry changes; setImmediate alone
  // is not a full-loop barrier when entered from the poll phase.
  await setImmediate();
  signal?.throwIfAborted();
}

/** Bounded-memory hashing; never use raw target DB reads in the SQLite lock holder. */
function fileHash(filename: string): string {
  const handle = openSync(filename, "r");
  try {
    const digest = createHash("sha256");
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let length: number;
    while ((length = readSync(handle, chunk)) > 0) digest.update(chunk.subarray(0, length));
    return digest.digest("hex");
  } finally { closeSync(handle); }
}

export interface SyncProfileDirectories {
  readonly appDataRoots: readonly string[];
  readonly developmentRoots: readonly string[];
}

/** Standard profile locations are protected independently of product or directory names. */
export function syncProfileDirectories(options: {
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
  readonly homeDirectory?: string;
} = {}): SyncProfileDirectories {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const home = options.homeDirectory ?? homedir();
  const api = platform === "win32" ? path.win32 : path;
  const standard = platform === "darwin" ? api.join(home, "Library", "Application Support")
    : platform === "win32" ? api.join(home, "AppData", "Roaming") : api.join(home, ".config");
  const appData = platform === "win32" ? environment.APPDATA ?? standard
    : platform === "linux" ? environment.XDG_CONFIG_HOME ?? standard : standard;
  const localAppData = environment.LOCALAPPDATA ?? api.join(home, "AppData", "Local");
  const appDataRoots = platform === "darwin" ? [standard, "/Library/Application Support"]
    : platform === "win32" ? [standard, appData, localAppData, api.join(home, "AppData", "Local")]
      : [standard, appData];
  // A custom data-dir override must never turn an arbitrary production profile into an allowed root.
  const environmentWithoutOverride = { LOCALAPPDATA: localAppData };
  return {
    appDataRoots: [...new Set(appDataRoots.map(root => api.resolve(root)))],
    developmentRoots: (["development", "test"] as const).map(mode => resolveApplicationDataPath({
      platform, mode, electronAppDataPath: appData, electronDefaultUserDataPath: appData,
      environment: environmentWithoutOverride,
    })),
  };
}

function withinDirectory(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function protectedProfileDirectory(declared: string, canonical: string, directories: SyncProfileDirectories): boolean {
  const roots = directories.appDataRoots.map(root => ({ declared: path.resolve(root),
    canonical: existsSync(root) ? realpathSync(root) : path.resolve(root) }));
  const developmentRoots = directories.developmentRoots.map(root => {
    const parent = [...roots].sort((a, b) => b.declared.length - a.declared.length)
      .find(parent => withinDirectory(parent.declared, path.resolve(root)));
    // Resolve the app-data parent, not a possibly symlinked development profile pointing at production.
    return parent ? path.join(parent.canonical, path.relative(parent.declared, path.resolve(root))) : path.resolve(root);
  });
  if (roots.some(root => withinDirectory(root.declared, declared)) &&
    (!directories.developmentRoots.some(root => withinDirectory(path.resolve(root), declared)) ||
      !developmentRoots.some(root => withinDirectory(root, canonical)))) return true;
  return roots.some(root => withinDirectory(root.canonical, canonical)) &&
    !developmentRoots.some(root => withinDirectory(root, canonical));
}

function insideSeedDirectory(root: string): boolean {
  for (let directory = root; ; directory = path.dirname(directory)) {
    if (existsSync(path.join(directory, "manifest.json"))) return true;
    if (path.dirname(directory) === directory) return false;
  }
}

/** Accept local development directories; refuse installed profiles, bundles and seed trees. */
export function assertDevelopmentSyncRoot(root: string, directories = syncProfileDirectories()): string {
  const canonical = realpathSync(root);
  if (!lstatSync(canonical).isDirectory()) throw new Error("Engineering sync requires a development directory");
  const declared = path.resolve(root);
  const components = [...declared.split(/[\\/]/), ...canonical.split(/[\\/]/)];
  if (process.env.NODE_ENV === "production" ||
    components.some(part => /\.app$/i.test(part)) || insideSeedDirectory(declared) || insideSeedDirectory(canonical) ||
    protectedProfileDirectory(declared, canonical, directories)) {
    throw new Error("Engineering sync is development-only; production profiles, packaged directories and seed trees are refused");
  }
  const filename = applicationPaths(canonical).lqDatabase;
  if (realpathSync(filename) !== filename || !lstatSync(filename).isFile() || statSync(filename).nlink !== 1) {
    throw new Error("Catalogue must be a regular, unaliased file inside the development root");
  }
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const sidecar = `${filename}${suffix}`;
    if (existsSync(sidecar) && (realpathSync(sidecar) !== sidecar ||
      !lstatSync(sidecar).isFile() || statSync(sidecar).nlink !== 1)) {
      throw new Error("Catalogue sidecars must be regular, unaliased files");
    }
  }
  // Fail closed on network/unknown filesystems. WAL exclusion is local-host only.
  // Darwin's numeric VFS indices are not portable; inspect the most specific
  // mount, including network mounts nested inside a local filesystem.
  const mounts = process.platform === "darwin"
    ? execFileSync("/sbin/mount", [], {encoding: "utf8"}).split("\n")
      .map(line => /^.+ on (.+) \(([^)]+)\)$/.exec(line))
      .filter((row): row is RegExpExecArray => !!row)
      .filter(row => filename === row[1] || filename.startsWith(row[1] === "/" ? "/" : `${row[1]}/`))
      .sort((a, b) => b[1]!.length - a[1]!.length)
    : [];
  const mountFlags = mounts[0]?.[2]?.split(", ") ?? [];
  const drive = process.platform === "win32" ? /^([A-Za-z]):\\/.exec(filename)?.[1] : undefined;
  // Only a validated drive letter enters PowerShell; UNC/mapped network drives
  // and unknown filesystems fail closed. No source/user path is interpolated.
  const volume = drive ? JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}:'" | Select-Object DriveType,FileSystem | ConvertTo-Json -Compress`],
    {encoding: "utf8"})) as {DriveType?: number; FileSystem?: string} | null : null;
  const local = process.platform === "win32" ? volume?.DriveType === 3 && volume.FileSystem === "NTFS"
    : process.platform === "darwin"
    ? ["apfs", "hfs"].includes(mountFlags[0] ?? "") && mountFlags.includes("local")
    : process.platform === "linux" && new Set([0xef53, 0x01021994, 0x58465342, 0x9123683e]).has(statfsSync(filename).type);
  if (!local) {
    throw new Error("Cannot establish local-filesystem catalogue exclusion on this filesystem");
  }
  return canonical;
}

function soleCurrent(database: Database.Database, drawings: boolean): Imported {
  const rows = database.prepare(`SELECT id,adapter_version,fingerprint FROM app_source_import
    WHERE ${drawings ? "adapter_code='assets' AND source_label LIKE 'DXF_BLOCK:%'" : "adapter_code='tiquadri'"}
    AND became_current=1`).all() as Imported[];
  if (rows.length !== 1) throw new Error(`Expected one current ${drawings ? "drawings" : "engineering"} import; repair provenance explicitly`);
  return rows[0]!;
}

function archive(database: Database.Database, importId: number, role: string, directory: string) {
  const rows = database.prepare(`SELECT role,file_sha256,byte_size,original_file_name FROM app_source_import_file
    WHERE import_id=? AND role=?`).all(importId, role) as SourceFile[];
  const file = rows[0];
  if (rows.length !== 1 || !file || !/^[0-9a-f]{64}$/.test(file.file_sha256)) {
    throw new Error(`Missing/invalid ${role} archive provenance`);
  }
  const originalName = file.original_file_name;
  if (typeof originalName !== "string" || !originalName.trim() || originalName === "." || originalName === ".." ||
    /[\\/\x00-\x1f:]/.test(originalName)) throw new Error(`Unsafe original ${role} archive filename`);
  const filename = path.join(directory, `${file.file_sha256}.mdb`);
  if (realpathSync(filename) !== filename || !lstatSync(filename).isFile()) throw new Error(`Unsafe ${role} archive: ${filename}`);
  const bytes = readFileSync(filename);
  if (!bytes.length || bytes.length !== file.byte_size || sha(bytes) !== file.file_sha256) {
    throw new Error(`Corrupt ${role} archive (size/SHA-256): ${filename}`);
  }
  try {
    const reader = role === "master" ? readTiQuadriMasterSource(bytes).reader : new MDBReader(bytes);
    const tableName = role === "master" ? "ANA_PACK" : role === "listino" ? "ANA_ART_MONTAGGIO" : "DXF_BLOCK";
    const columns = role === "master" ? ["ID_Pack"] : role === "listino" ? ["ART_COD", "POLI_DIN"] : ["NOME", "CONTENUTO"];
    const table = reader.getTable(tableName);
    // Hash/size still cover every byte. Validate schema and one readable identity
    // row without decoding every drawing's large CONTENUTO memo field.
    if (columns.some(column => !table.getColumnNames().includes(column)) || table.rowCount <= 0 ||
      !table.getData({columns: [columns[0]!], rowLimit: 1}).length) {
      throw new Error(`Invalid/empty ${tableName}`);
    }
  } catch (cause) { throw new Error(`Invalid ${role} MDB archive: ${filename}`, {cause}); }
  // Do not retain the large MDB buffers during the rest of an advisory/no-op.
  return { filename, originalName, sha256: file.file_sha256, byteSize: file.byte_size };
}

function plan(database: Database.Database, root: string, applicationRoot: string) {
  const migrations = readMigrationFiles({migrationsFolder: path.join(applicationRoot, "db/migrations/lq")});
  assertCompatibleMigrationHistory(database, migrations);
  const applied = database.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get();
  if (applied !== migrations.length) throw new Error("Catalogue needs migrations; sync does not migrate databases");
  assertQuickCheck(database);
  const engineering = soleCurrent(database, false);
  const drawings = soleCurrent(database, true);
  for (const [version, required] of [[engineering.adapter_version, adapter.version], [drawings.adapter_version, TIQUADRI_DRAWING_ADAPTER_VERSION]]) {
    if (!/^[1-9]\d*$/.test(version!)) throw new Error("Invalid installed adapter version; repair provenance explicitly");
    if (BigInt(version!) > BigInt(required!)) throw new Error("Newer installed adapter; engineering sync refuses adapter downgrades");
  }
  const paths = applicationPaths(root);
  const master = archive(database, engineering.id, "master", path.join(paths.imports, "tiquadri"));
  const listino = archive(database, engineering.id, "listino", path.join(paths.imports, "tiquadri"));
  const dxf = archive(database, drawings.id, "dxf", path.join(paths.assets, "tiquadri-dxf"));
  const expected = tiQuadriImportIdentity(master.sha256, listino.sha256, path.join(applicationRoot, "db/seed")).fingerprint;
  const readiness = readEngineeringReadiness(database);
  const source = readiness.sources.find(row => row.adapterCode === adapter.code)!;
  const badModels = (database.prepare(`SELECT m.source, m.source_import_id AS sourceImportId,
      i.adapter_code AS adapterCode, i.became_current AS current
    FROM cat_config_model m LEFT JOIN app_source_import i ON i.id=m.source_import_id
    WHERE m.source='import' AND m.active=1`).all() as
    {source:string;sourceImportId:number|null;adapterCode:string|null;current:number|null}[])
    .some(model => {
      const stale = readiness.staleModel(model);
      return (model.adapterCode === adapter.code && model.current !== 1) ||
        (stale && (source.status === "ready" || stale.reason === "missing_provenance" || stale.reason === "noncurrent_import"));
    });
  if (badModels) throw new Error("Invalid active model provenance; repair explicitly before sync");
  const engineeringNeeded = source.status !== "ready" || engineering.fingerprint !== expected;
  const drawingsNeeded = !tiQuadriDrawingsCurrent(database, tiQuadriDrawingFingerprint(database, dxf.sha256));
  return {master, listino, dxf, summary: {
    dataRoot: root, installedAdapter: engineering.adapter_version, requiredAdapter: adapter.version,
    installedFingerprint: engineering.fingerprint, expectedFingerprint: expected,
    engineeringNeeded, drawingsNeeded, drawingsRecheckAfterEngineering: engineeringNeeded,
  }};
}

/**
 * No SQLite connection is opened on the target for --check. Copy DB + WAL only,
 * verify both remained byte-identical during capture, then let SQLite recover
 * its private WAL index. A hot rollback journal or changing capture is refused.
 * Run only in the standalone CLI, never in a process already holding a target
 * SQLite handle: raw FD close there could cancel that process's POSIX locks.
 * This is an advisory observation, never an apply plan reused without exclusion.
 */
function inspectCopy(filename: string, directory: string): string {
  if (existsSync(`${filename}-journal`)) throw new Error("Catalogue has a rollback journal; close/recover it before checking");
  const target = path.join(directory, "lq.db");
  copyFileSync(filename, target);
  const hasWal = existsSync(`${filename}-wal`);
  if (hasWal) copyFileSync(`${filename}-wal`, `${target}-wal`);
  if (fileHash(target) !== fileHash(filename) || hasWal !== existsSync(`${filename}-wal`) ||
    (hasWal && fileHash(`${target}-wal`) !== fileHash(`${filename}-wal`))) {
    throw new Error("Catalogue changed during advisory check; retry after closing other processes");
  }
  return target;
}

export async function syncDevelopmentEngineering(options: EngineeringSyncOptions) {
  options.signal?.throwIfAborted();
  const root = assertDevelopmentSyncRoot(options.dataRoot);
  const filename = applicationPaths(root).lqDatabase;
  const temporary = mkdtempSync(path.join(tmpdir(), "librequadri-engineering-sync-"));
  let database: Database.Database | undefined;
  try {
    database = options.check
      ? new Database(inspectCopy(filename, temporary), {fileMustExist: true})
      : openExclusiveCatalogue(filename);
    options.log?.(options.check ? "Inspecting a private catalogue copy (read-only advisory)…" : "Catalogue exclusion acquired; verifying archives and fingerprints…");
    const initial = plan(database, root, options.applicationRoot);
    await interruptionCheckpoint(options.signal);
    if (options.check) return {...initial.summary, check: true, engineeringImported: false, drawingsImported: false};
    if (!initial.summary.engineeringNeeded && !initial.summary.drawingsNeeded) {
      return {...initial.summary, check: false, engineeringImported: false, drawingsImported: false};
    }
    // Freeze verified bytes and seeds across the importer's asynchronous backup.
    const application = path.join(temporary, "application");
    cpSync(path.join(options.applicationRoot, "db/seed"), path.join(application, "db/seed"), {recursive: true});
    const frozen: Record<string, string> = {};
    for (const [name, input] of [["master", initial.master], ["listino", initial.listino], ["dxf", initial.dxf]] as const) {
      const roleDirectory = path.join(temporary, name);
      mkdirSync(roleDirectory);
      const destination = path.join(roleDirectory, input.originalName);
      copyFileSync(input.filename, destination);
      if (statSync(destination).size !== input.byteSize || fileHash(destination) !== input.sha256) {
        throw new Error(`Archived ${name} source changed while freezing inputs`);
      }
      frozen[name] = destination;
    }
    if (tiQuadriImportIdentity(initial.master.sha256, initial.listino.sha256,
      path.join(application, "db/seed")).fingerprint !== initial.summary.expectedFingerprint) {
      throw new Error("Seed inputs changed during planning; retry sync");
    }
    const paths = applicationPaths(root);
    await interruptionCheckpoint(options.signal);
    if (initial.summary.engineeringNeeded) options.log?.(`Reimporting engineering with adapter ${adapter.version}…`);
    const engineering = initial.summary.engineeringNeeded ? await importTiQuadri({database,
      sourcePath: frozen.master!, listinoPath: frozen.listino!,
      archiveDirectory: path.join(paths.imports, "tiquadri"), backupDirectory: paths.backups,
      seedFolder: path.join(application, "db/seed")}) : undefined;
    if (engineering && engineering.fingerprint !== initial.summary.expectedFingerprint) throw new Error("Seed inputs changed during planning; retry sync");
    await interruptionCheckpoint(options.signal);
    const drawingsNeeded = !tiQuadriDrawingsCurrent(database, tiQuadriDrawingFingerprint(database, initial.dxf.sha256));
    if (drawingsNeeded) {
      options.log?.("Synchronizing drawings for the resulting engineering inventory…");
      // The engineering backup already covers both phases when it ran.
      if (!engineering || engineering.alreadyImported) {
        mkdirSync(paths.backups, {recursive: true});
        await database.backup(path.join(paths.backups, `librequadri-pre-engineering-sync-${Date.now()}.db`));
      }
      await interruptionCheckpoint(options.signal);
      importTiQuadriDrawingAssets({database, sourcePath: frozen.dxf!, assetsRoot: paths.assets});
      await interruptionCheckpoint(options.signal);
    }
    return {...initial.summary, check: false, engineeringImported: !!engineering && !engineering.alreadyImported,
      drawingsImported: drawingsNeeded};
  } finally {
    // Never close during an unsettled backup/import. Cleanup still runs if close fails.
    try { database?.close(); } // Do not run optimize or release EXCLUSIVE between phases.
    finally { rmSync(temporary, {recursive: true, force: true}); }
  }
}
