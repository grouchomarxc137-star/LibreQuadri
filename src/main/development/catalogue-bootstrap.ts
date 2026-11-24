import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import Database from "better-sqlite3";
import MDBReader from "mdb-reader";

import { applicationPaths, resolveApplicationDataPath } from "../data-paths.js";
import { openMigratedLqDatabase } from "../database/lq-migrations.js";
import { closeConfiguredDatabase } from "../database/sqlite-connection.js";
import { assertUniqueMetelDeliveryRows } from "../metel/delivery.js";
import { importMetelDeliveryFromFiles, type DevImportResult } from "../metel/dev-import.js";
import { parseMetelSource, type MetelFileType } from "../metel/parser.js";
import { TIQUADRI_ENGINEERING_ADAPTER } from "../sources/tiquadri/adapter.js";
import { importTiQuadri, readTiQuadriMasterSource } from "../sources/tiquadri/import.js";
import { importTiQuadriDrawingAssets } from "../sources/tiquadri/drawing-assets.js";

// This is the current developer catalogue profile, not a runtime brand restriction.
const REQUIRED_ISSUERS = ["BTI", "SIE", "SNR"] as const;
const FILE_TYPES = ["LSP", "FSC", "FST"] as const;

interface DeliveryInput {
  readonly issuer: string;
  readonly listino: string;
  readonly validFrom: string;
  readonly files: readonly string[];
}

export interface BootstrapOptions {
  readonly sourceRoot: string;
  readonly dataRoot: string;
  readonly applicationRoot: string;
  readonly log?: (message: string) => void;
}

/** Same development root as the existing CLIs; a one-command override wins over the environment. */
export function bootstrapDataRoot(dataDir?: string, environment: NodeJS.ProcessEnv = process.env): string {
  if (dataDir !== undefined) {
    if (!dataDir.trim()) throw new Error("--data-dir must be a nonempty application data root");
    return path.resolve(dataDir);
  }
  const platform = process.platform;
  const appData = platform === "darwin" ? path.join(homedir(), "Library", "Application Support")
    : platform === "win32" ? (environment["APPDATA"] ?? path.join(homedir(), "AppData", "Roaming"))
      : (environment["XDG_CONFIG_HOME"] ?? path.join(homedir(), ".config"));
  return resolveApplicationDataPath({ platform, mode: "development", electronAppDataPath: appData,
    electronDefaultUserDataPath: path.join(appData, "LibreQuadri"), environment });
}

function numericCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] =>
    typeof entry[1] === "number"));
}

function readSource(filename: string): Buffer {
  try {
    if (!statSync(filename).isFile()) throw new Error("not a regular file");
    const bytes = readFileSync(filename);
    if (bytes.length === 0) throw new Error("empty file");
    return bytes;
  } catch (cause) {
    throw new Error(`Cannot read required source ${filename}: ${errorMessage(cause)}`, { cause });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Discover delivery roles from the authoritative METEL parser, never from filenames. */
function discoverDeliveries(sourceRoot: string): DeliveryInput[] {
  const directory = path.join(sourceRoot, "metel");
  let names: string[];
  try {
    names = readdirSync(directory).filter(name => /\.txt$/i.test(name)).sort();
  } catch (cause) {
    throw new Error(`Cannot read METEL directory ${directory}: ${errorMessage(cause)}`, { cause });
  }
  const deliveries = new Map<string, Partial<Record<MetelFileType, string>>>();
  const priceLists = new Map<string, {listino: string; validFrom: string}>();
  for (const name of names) {
    const filename = path.join(directory, name);
    try {
      const parsed = parseMetelSource(readSource(filename));
      assertUniqueMetelDeliveryRows(parsed.priceListRows, parsed.familyRows);
      const { issuerSigla: issuer, fileType: type } = parsed.metadata;
      const files = deliveries.get(issuer) ?? {};
      if (files[type]) throw new Error(`Duplicate ${type} for issuer ${issuer}; keep one delivery per issuer`);
      files[type] = filename;
      deliveries.set(issuer, files);
      if (parsed.metadata.fileType === "LSP") {
        if (!parsed.priceListRows.length) throw new Error(`Empty LSP for issuer ${issuer}`);
        priceLists.set(issuer, {
          listino: parsed.metadata.listinoNumber!, validFrom: parsed.metadata.validFrom!,
        });
      }
    } catch (cause) {
      throw new Error(`Invalid METEL source ${filename}: ${errorMessage(cause)}`, { cause });
    }
  }
  for (const issuer of REQUIRED_ISSUERS) {
    if (!deliveries.has(issuer)) throw new Error(`Missing required METEL issuer ${issuer} in ${directory}; supply LSP, FSC and FST`);
  }
  return [...deliveries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([issuer, files]) => {
    for (const type of FILE_TYPES) {
      if (!files[type]) throw new Error(`Missing ${type} for METEL issuer ${issuer} in ${directory}`);
    }
    return { issuer, ...priceLists.get(issuer)!, files: FILE_TYPES.map(type => files[type]!) };
  });
}

/** Read the required MDB roles before any migration, backup or catalogue write. */
function validateMdb(filename: string, role: "master" | "listino" | "drawings"): void {
  try {
    const bytes = readSource(filename);
    const reader = role === "master" ? readTiQuadriMasterSource(bytes).reader : new MDBReader(bytes);
    const [tableName, columns] = role === "master"
      ? ["ANA_PACK", ["ID_Pack"]] as const
      : role === "listino"
        ? ["ANA_ART_MONTAGGIO", ["ART_COD", "POLI_DIN"]] as const
        : ["DXF_BLOCK", ["NOME", "CONTENUTO"]] as const;
    const table = reader.getTable(tableName);
    for (const column of columns) {
      if (!table.getColumnNames().includes(column)) throw new Error(`Missing ${tableName}.${column}`);
    }
    if (!table.getData({ columns: [...columns] }).length) throw new Error(`Empty ${tableName} table`);
  } catch (cause) {
    throw new Error(`Invalid ${role} MDB ${filename}: ${errorMessage(cause)}`, { cause });
  }
}

/** Only read existing databases: refusal must precede even migration backups. */
export function assertBootstrapTargetEmpty(dataRoot: string): void {
  const paths = applicationPaths(dataRoot);
  for (const [filename, tables] of [
    [paths.lqDatabase, ["cat_brand", "cat_product", "cat_metel_issuer", "cat_config_model",
      "cat_manufacturer", "cat_metel_family", "cat_phys_profile", "cat_phys_profile_set", "cat_phys_class",
      "cat_config_dimension", "cat_config_context", "cat_range_node", "cat_asset",
      "app_import_delivery", "app_source_import"]],
    [paths.rawDatabase, ["raw_file"]],
  ] as const) {
    if (!existsSync(filename)) continue;
    let database: Database.Database | undefined;
    try {
      database = new Database(filename, { readonly: true, fileMustExist: true });
      const tableNames = new Set((database.prepare("SELECT name FROM sqlite_schema WHERE type='table'")
        .all() as {name: string}[]).map(row => row.name));
      // Refuse an unrelated database instead of migrating an unknown file in place.
      if (tableNames.size && !tableNames.has(tables[0])) throw new Error("Unrecognized database schema");
      for (const table of tables) {
        if (tableNames.has(table) && database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) {
          throw new Error(`Populated ${table} table`);
        }
      }
    } catch (cause) {
      throw new Error(`Bootstrap refuses existing catalogue/raw state at ${filename}: ${errorMessage(cause)}. ` +
        "Use a new --data-dir root, or the individual import commands for intentional updates; no reset is performed.", { cause });
    } finally {
      database?.close();
    }
  }
}

/** Developer orchestration only; each authoritative importer keeps its own transactions/backups. */
export async function bootstrapDevelopmentCatalogue(options: BootstrapOptions) {
  const sourceRoot = path.resolve(options.sourceRoot);
  const dataRoot = path.resolve(options.dataRoot);
  const log = options.log ?? (() => {});
  assertBootstrapTargetEmpty(dataRoot);
  const deliveries = discoverDeliveries(sourceRoot);
  const master = path.join(sourceRoot, "tiquadri", "BTQUADRI.mdb");
  const listino = path.join(sourceRoot, "tiquadri", "ListinoBT.mdb");
  const drawings = path.join(sourceRoot, "tiquadri", "BTQuadriDXF.mdb");
  validateMdb(master, "master");
  validateMdb(listino, "listino");
  validateMdb(drawings, "drawings");

  mkdirSync(dataRoot, { recursive: true });
  const lock = path.join(dataRoot, ".catalogue-bootstrap.lock");
  try { mkdirSync(lock); } catch (cause) {
    throw new Error(`Cannot acquire bootstrap lock ${lock}. Close other bootstrap processes; ` +
      "if a previous process crashed, inspect its partial output before removing the lock.", { cause });
  }
  let stage = "target check";
  try {
    assertBootstrapTargetEmpty(dataRoot);
    const paths = applicationPaths(dataRoot);
    const migrations = path.join(options.applicationRoot, "db", "migrations");
    const seedFolder = path.join(options.applicationRoot, "db", "seed");
    const metel: (DeliveryInput & {result: DevImportResult})[] = [];
    for (const delivery of deliveries) {
      stage = `METEL ${delivery.issuer}`;
      log(`Importing ${stage} (${delivery.listino}, ${delivery.validFrom})…`);
      const result = importMetelDeliveryFromFiles({
        dataRoot, lqMigrationsFolder: path.join(migrations, "lq"),
        rawMigrationsFolder: path.join(migrations, "raw"), seedFolder, files: delivery.files,
      });
      metel.push({ ...delivery, result });
    }
    const database = openMigratedLqDatabase({ databaseFilename: paths.lqDatabase,
      backupDirectory: paths.backups, migrationsFolder: path.join(migrations, "lq") });
    try {
      stage = "TiQuadri engineering with ListinoBT evidence";
      log(`Importing ${stage} (adapter ${TIQUADRI_ENGINEERING_ADAPTER.version})…`);
      const engineering = await importTiQuadri({ database, sourcePath: master, listinoPath: listino,
        archiveDirectory: path.join(paths.imports, "tiquadri"), backupDirectory: paths.backups, seedFolder });
      stage = "TiQuadri drawings";
      log(`Importing ${stage}…`);
      await database.backup(path.join(paths.backups, `librequadri-pre-drawings-${Date.now()}.db`));
      const drawingResult = importTiQuadriDrawingAssets({ database, sourcePath: drawings, assetsRoot: paths.assets });
      return {
        dataRoot,
        metel: metel.map(({ issuer, listino: listinoNumber, validFrom, result }) => ({
          issuer, listinoNumber, validFrom, deliveryId: result.delivery.deliveryId,
          becameCurrent: result.delivery.becameCurrent, ...result.delivery.summary,
        })),
        engineering: {
          importId: engineering.importId, adapterVersion: TIQUADRI_ENGINEERING_ADAPTER.version,
          counts: engineering.summary.counts, capacityFillers: engineering.summary.capacityFillers,
          moduleComparison: numericCounts(engineering.summary.moduleComparison),
          discrepancies: engineering.summary.discrepancies,
          secondaryDiscrepancies: engineering.summary.secondaryDiscrepancies,
          conflicts: engineering.summary.conflicts, errors: engineering.summary.errors,
        },
        drawings: { referenced: drawingResult.referenced, resolved: drawingResult.resolved,
          missing: drawingResult.missing.length, invalid: drawingResult.invalid.length,
          unsupported: drawingResult.unsupported },
      };
    } finally { closeConfiguredDatabase(database); }
  } catch (cause) {
    throw new Error(`Bootstrap failed during ${stage}: ${errorMessage(cause)}. ` +
      `Partial output is preserved at ${dataRoot}; no automatic rollback/reset. ` +
      "After fixing the cause, use a new --data-dir root or resume with individual import commands.", { cause });
  } finally { rmdirSync(lock); }
}
