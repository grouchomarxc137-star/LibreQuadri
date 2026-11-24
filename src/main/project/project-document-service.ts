import {parseMountingFacts} from "../../shared/mounting.js";
import { isOutOfCatalogue } from "../../shared/out-of-catalogue.js";
import { discoverCompatibleEnclosures, discoverEnclosureReferenceDevices, enclosureGamma } from "./design-compatibility.js";
import { configurationModelSummaries } from "../catalogue/configuration-queries.js";
import { readEngineeringReadiness } from "../catalogue/engineering-readiness.js";
import { planEngineeringRefresh, applyEngineeringWrites, canAutoRefreshEngineering, ProjectEngineeringRefreshError } from "./engineering-refresh.js";
import { repriceProject } from "./project-repricing.js";
import { calculateCommercial } from "../../shared/commercial.js";
import { suspectSavedArticleLinks } from "../../shared/reviewed-article-links.js";
import { reconfigureEnclosure, EnclosureReconfigurationError } from "./enclosure-reconfiguration.js";
import type { ProjectEngineeringPlan, ProjectEngineeringStatus } from "../../shared/project-engineering.js";
import { projectEngineeringChainStale, projectEngineeringStatus, validateEngineeringProvenance } from "./engineering-status.js";
import { instantiatePresetChildren } from "./preset-children.js";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  lstatSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";

import type {
  CompatiblePanelsRequest, CompatiblePanelNavigation, PanelReferenceCheckRequest, ReferenceCompatibility,
  CatalogueProductSnapshotSource,
  ProjectConfiguredItem,
  ProjectDocumentView,
  ProjectMetadataInput,
  ProjectQuotationLine,
  ProjectPlacementInput,
  ProjectPlacementCheck,
  ProjectPackedChildInput,
  ProjectAnnotationInput, ProjectAnnotationPatch, ProjectPackedMoveInput, ProjectPlacementTargetRequest, ProjectPlacementTargets,
  ProjectPlacementSubject,
  FrontOptionLabel, FrontVectorAsset,
  StructuralDesignKind, StructuralDiscovery, StructuralNavigation, AddStructuralRequest, ProjectStructuralPlacement, ProjectRootRemoval,
  ProjectFillRequest, ProjectFillReport, ProjectFillSkip,
} from "../../shared/project.js";
import type { ConfigurationRequest, ConfigurationResult } from "../../shared/configuration.js";
import { PROJECT_TYPES, STRUCTURAL_ADD_QUANTITY_MAX, STRUCTURAL_ADD_QUANTITY_MIN } from "../../shared/project.js";
import { validateDiscountBp, validateLabourE4 } from "../../shared/commercial.js";
import {
  LQP_APPLICATION_ID,
  migrateProjectDatabaseToCurrent,
  openCurrentProjectDatabase,
  openProjectDatabaseAtVersion,
  projectFormatVersion,
} from "../database/project-migrations.js";
import { assertIntegrityCheck, closeConfiguredDatabase } from "../database/sqlite-connection.js";
import type { CapacityFillerConfiguration } from "../catalogue/capacity-fillers.js";
import { freeRuns, planRun, surveyFillZones, type FillPiece } from "./capacity-fill.js";
import { captureDocument, DocumentHistory, restoreDocument, type HistoryEntry } from "./document-history.js";
import { addAnnotation, readAnnotations, removeAnnotation, updateAnnotation, validateAnnotationRows } from "./annotations.js";
import { findPhysicalNode, firstPlacement, frontOrder, panelsInPlacementOrder } from "./auto-placement.js";
import { configuredItemCanBeDuplicated, duplicateConfiguredItem, insertConfiguredItem, readConfiguredItems, readDistinta, removeUnusedProductSnapshots } from "./configured-items.js";
import { checkPlacement, checkPackedChild, placementTargets, placeRoot, placeChild, moveNode, unplaceNode,
  insertPackedChild, reorderPackedNode, movePackedNode, removePackedNode, readPhysicalNodes, deletePhysicalRoot, unplaceSubtree,
  directDeviceParents, PlacementError, type PlacementOptions, type RootTransferVerdict } from "./physical-placement.js";

const MAX_PROJECT_BYTES = 200 * 1024 * 1024;
/** Names of the undoable Progettazione actions, shown as "Annulla …" / "Ripeti …". */
const HISTORY_LABELS = {
  place: "Posiziona", move: "Sposta", unplace: "Rimuovi posizione", removeRoot: "Rimuovi carpenteria", duplicate: "Duplica",
  add: { enclosure: "Aggiungi carpenteria", support: "Aggiungi pannello", device: "Aggiungi apparecchio" },
  addText: "Aggiungi testo", editText: "Modifica testo", removeText: "Elimina testo",
  fillers: "Inserisci falsi poli DIN",
} as const;
const RENAME_RETRY_DELAYS_MS = [100, 250, 500, 1_000] as const;
const TRANSIENT_RENAME_ERROR_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const REQUIRED_META_KEYS = [
  "format_version", "app_version_saved", "project_uuid", "revision", "created_at",
  "created_by_name", "created_by_installation_uuid", "saved_at", "saved_by_name",
  "saved_by_installation_uuid", "contains_costs",
] as const;
type ManifestColumn = readonly [name: string, type: string, notnull: number, pk: number];
type ManifestIndex = readonly [table: string, unique: number, columns: readonly string[]];
interface ProjectSchemaManifest {
  readonly versions: Record<string, {
    readonly tables: Record<string, readonly ManifestColumn[]>;
    readonly indexes: Record<string, ManifestIndex>;
  }>;
}

interface Baseline { readonly size: number; readonly mtimeMs: number; readonly sha256: string; }
interface Session {
  openReconciliation?: ProjectDocumentView["openReconciliation"];
  automaticPricingVersion?: number;
  readonly workingPath: string;
  readonly database: Database.Database;
  targetPath: string | null;
  documentName: string;
  baseline: Baseline | null;
  dirty: boolean;
  changeVersion: number;
  pendingSave: PreparedSave | null;
  /**
   * Content identity of the working copy. Every committed change gets a fresh id; undo/redo return to
   * the id of the state they restore. The document is dirty exactly when it differs from the id last
   * written to its file (null: no saved file holds this content, e.g. a recovered working copy).
   */
  stateId: number;
  savedStateId: number | null;
  nextStateId: number;
  readonly history: DocumentHistory;
  readonly undoScope: string;
}

interface PreparedSave {
  readonly tempPath: string;
  readonly targetPath: string;
  readonly targetShaBeforeSave: string | null;
  readonly revision: number;
  readonly savedAt: string;
  readonly changeVersion: number;
  readonly stateId: number;
}

export type ProjectSaveFailureKind = "save-as-required" | "conflict" | "replace-failed" | "failed";

export class ProjectSaveError extends Error {
  readonly kind: ProjectSaveFailureKind;
  readonly cause: unknown;

  constructor(kind: ProjectSaveFailureKind, message: string, cause?: unknown) {
    super(message);
    this.name = "ProjectSaveError";
    this.kind = kind;
    this.cause = cause;
  }
}

export interface ProjectRecoveryView {
  /** One-use-process opaque identifier. Never a native path. */
  readonly id: string;
  readonly documentName: string;
  readonly preservedAt: string;
}

interface RecoveryEntry extends ProjectRecoveryView {
  readonly workingPath: string;
  readonly metadataPath: string;
}

interface ValidatedIncoming {
  readonly formatVersion: number;
  readonly manifest: ProjectSchemaManifest["versions"][string];
  readonly projectUuid: string;
}

interface IncomingValidationOptions {
  readonly allowUnsavedWorkingCopy?: boolean;
}

export interface CreateProjectDocumentRequest extends ProjectMetadataInput {
  readonly destinationPath: string;
}

export interface ProjectDocumentServiceOptions {
  readonly workingDirectory: string;
  readonly incomingDirectory: string;
  readonly backupDirectory: string;
  readonly migrationsFolder: string;
  readonly appVersion: string;
  readonly resolveCatalogueProduct: (id: number) => CatalogueProductSnapshotSource;
  /** Catalogue snapshot used by engineering operations and optional open reconciliation. */
  readonly engineeringCatalogue?: () => Database.Database | null;
  readonly reconcileOnOpen?: boolean;
  readonly resolveConfiguration?: (request: ConfigurationRequest) => ConfigurationResult;
  readonly designDiscover?: (project:Database.Database,request:{kind:StructuralDesignKind;parentUuid?:string}) => StructuralDiscovery;
  readonly referenceDevices?: (project:Database.Database,parentUuid:string)=>StructuralNavigation;
  readonly compatiblePanels?: (project:Database.Database,request:CompatiblePanelsRequest)=>CompatiblePanelNavigation;
  readonly checkPanelReference?: (project:Database.Database,request:PanelReferenceCheckRequest)=>ReferenceCompatibility;
  readonly designNavigation?: (project:Database.Database,request:{kind:StructuralDesignKind;parentUuid?:string}) => StructuralNavigation;
  /** Verifies an already configured project item against the current catalogue and root context. */
  readonly designItemGuard?: (project:Database.Database,request:{parentUuid?:string;itemUuid?:string;
    item:{brandMarchio:string;modelCode:string;definitionFingerprint:string;kind:"enclosure"|"support"}}) => {ok:boolean;code:string};
  readonly designGuard?: (project:Database.Database,request:{kind:StructuralDesignKind;modelId:number;parentUuid?:string},
    configuration:ConfigurationRequest) => {ok:boolean;code:string};
  readonly resolveFrontAssets?: (keys: readonly string[]) => Record<string,FrontVectorAsset>;
  readonly resolveFrontOptionLabels?: (items: readonly ProjectConfiguredItem[], placed: ReadonlySet<string>) =>
    ReadonlyMap<string, readonly FrontOptionLabel[]>;
  /** Complete filler configurations the catalogue designates for a capacity kind, one per closed amount. */
  readonly capacityFillers?: (capacityKind: string) => readonly CapacityFillerConfiguration[];
  readonly now?: () => Date;
  readonly backupDatabase?: (database: Database.Database, destination: string) => Promise<unknown>;
  readonly replaceFile?: (source: string, destination: string) => void;
  readonly waitForRenameRetry?: (milliseconds: number) => Promise<void>;
  readonly removeFile?: (filename: string) => void;
  /**
   * Called after a document is opened from, or saved to, a real target path
   * (create, open, save, Save As, retried save). Used for the "Recenti" list;
   * a failure here never affects the document operation.
   */
  readonly onDocumentStored?: (document: StoredProjectDocument) => void;
}

export interface ProjectDocumentSummary {
  readonly title: string;
  readonly documentName: string;
  readonly dirty: boolean;
  readonly targetPath: string | null;
  /** Label of the action Annulla / Ripeti would revert or reapply; null when there is none. */
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
}

export interface StoredProjectDocument {
  readonly path: string;
  readonly projectUuid: string;
  readonly title: string;
}

function sha256File(filename: string): string {
  return createHash("sha256").update(readFileSync(filename)).digest("hex");
}

function fileBaseline(filename: string): Baseline {
  const stat = statSync(filename);
  return { size: stat.size, mtimeMs: stat.mtimeMs, sha256: sha256File(filename) };
}

function removeDatabaseFiles(filename: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const candidate = `${filename}${suffix}`;
    if (existsSync(candidate)) unlinkSync(candidate);
  }
}

export function fsyncFileOpenFlag(platform: NodeJS.Platform): "r" | "r+" {
  return platform === "win32" ? "r+" : "r";
}

function fsyncFile(filename: string): void {
  // FlushFileBuffers requires a handle opened for writing on Windows.
  const descriptor = openSync(filename, fsyncFileOpenFlag(process.platform));
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function fillRefusalMessage(code:string|null):string {
  switch(code){
    case "required_context_not_provided":return "La carpenteria non fornisce un contesto compatibile con i falsi poli.";
    case "incompatible_parent":return "Il pannello non accetta i falsi poli.";
    case "incompatible_ancestor":return "La carpenteria non accetta i falsi poli.";
    case "project_engineering_stale":return "Aggiorna i dati di ingegneria del progetto.";
    case "engineering_data_stale":return "I dati di ingegneria sono obsoleti: reimporta il catalogo.";
    case "no_view_for_orientation":return "I falsi poli non hanno la vista richiesta dalla zona.";
    default:return `Il pannello non accetta i falsi poli${code?` (${code})`:""}.`;
  }
}

/** History bookkeeping of a newly opened session; `savedStateId` is null when no file holds its content. */
function freshHistory(savedStateId: 0 | null): Pick<Session, "stateId" | "savedStateId" | "nextStateId" | "history" | "undoScope"> {
  return { stateId: 0, savedStateId, nextStateId: 1, history: new DocumentHistory(), undoScope: randomUUID() };
}

function currentUndoToken(session: Session): string | undefined {
  return session.history.peekUndo() ? `${session.undoScope}:${session.changeVersion}` : undefined;
}

function recoveryMetadataPath(workingPath: string): string {
  return `${workingPath}.recovery.json`;
}

function fsyncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(directory, "r");
    fsyncSync(descriptor);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function meta(database: Database.Database, key: string): string {
  const row = database.prepare("SELECT value FROM lqp_meta WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) throw new Error(`Il progetto non contiene il metadato obbligatorio ${key}.`);
  return row.value;
}

function setMeta(database: Database.Database, key: string, value: string): void {
  database.prepare("INSERT INTO lqp_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeIntegerPriceTimesQuantity(price: number | null, quantity: number): number | null {
  if (price === null) return null;
  const total = price * quantity;
  if (!Number.isSafeInteger(total)) throw new Error("Il totale della riga supera l'intervallo numerico supportato.");
  return total;
}

function migrationRowMatches(
  applied: { readonly hash: unknown; readonly created_at: unknown },
  bundled: MigrationMeta,
): boolean {
  return typeof applied.hash === "string" && applied.hash === bundled.hash &&
    Number(applied.created_at) === bundled.folderMillis;
}

function isIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function dependencyOrderedTables(
  database: Database.Database,
  tables: readonly string[],
): readonly string[] {
  const remaining = new Set(tables);
  const ordered: string[] = [];
  while (remaining.size > 0) {
    let progressed = false;
    for (const table of remaining) {
      const parents = (database.pragma(`foreign_key_list('${table}')`) as { table: string }[])
        .map((foreignKey) => foreignKey.table)
        .filter((parent) => parent !== table);
      if (parents.some((parent) => remaining.has(parent))) continue;
      remaining.delete(table);
      ordered.push(table);
      progressed = true;
    }
    if (!progressed) throw new Error("Il formato progetto contiene dipendenze cicliche tra tabelle.");
  }
  return ordered;
}

/** Format 4: context facts sit only on enclosures (provides) and supports (accepts) that carry a policy. */
function validateContextData(database: Database.Database): void {
  const count = (query: string): number => (database.prepare(query).get() as { count: number }).count;
  if (count(`SELECT COUNT(*) AS count FROM prj_item_context c JOIN prj_item i ON i.id=c.item_id
      WHERE i.context_policy IS NULL
        OR NOT ((i.model_kind='enclosure' AND c.role='provides') OR (i.model_kind='support' AND c.role='accepts'))
        OR length(trim(c.context_code))=0`) > 0) {
    throw new Error("Il progetto contiene dati di contesto ingegneristico non validi.");
  }
  if (count(`SELECT COUNT(*) AS count FROM prj_item WHERE context_policy IS NOT NULL
      AND (model_kind NOT IN ('enclosure','support') OR context_policy NOT IN ('unknown','unrestricted','restricted'))`) > 0) {
    throw new Error("Il progetto contiene una politica di contesto non valida.");
  }
}

function validateFormat2Data(database: Database.Database, formatVersion:number): void {
  const count = (query: string): number => (database.prepare(query).get() as { count: number }).count;
  if (count(`SELECT COUNT(*) AS count FROM prj_item i LEFT JOIN prj_line l
      ON l.item_id = i.id AND l.line_type = 'item' WHERE l.id IS NULL`) > 0) {
    throw new Error("Un articolo configurato non ha esattamente una riga preventivo.");
  }
  if (count(`SELECT COUNT(*) AS count FROM prj_line l
      JOIN prj_item i ON i.id=l.item_id WHERE l.line_type = 'item'
      ${formatVersion>=5?"AND i.commercial_contribution='articles'":""}
      AND NOT EXISTS (SELECT 1 FROM prj_item_bom b WHERE b.item_id = l.item_id)`) > 0) {
    throw new Error("Una riga configurata non ha articoli nella distinta.");
  }
  if (formatVersion>=5 && count(`SELECT COUNT(*) AS count FROM prj_item i JOIN prj_line l ON l.item_id=i.id
      WHERE i.commercial_contribution NOT IN ('articles','none') OR
        (i.commercial_contribution='none' AND (i.primary_snapshot_id IS NOT NULL OR
          l.sale_price_unit_e4 IS NOT NULL OR l.line_total_e4 IS NOT NULL OR
          EXISTS (SELECT 1 FROM prj_item_bom b WHERE b.item_id=i.id)))`) > 0) {
    throw new Error("Contributo commerciale della configurazione non valido.");
  }
  if (count(`SELECT COUNT(*) AS count FROM prj_item i JOIN prj_line l ON l.item_id = i.id
      WHERE (SELECT COUNT(*) FROM prj_node n WHERE n.item_id = i.id) > l.quantity`) > 0) {
    throw new Error("Le unità posizionate superano la quantità della riga configurata.");
  }
  const nodes = count("SELECT COUNT(*) AS count FROM prj_node");
  const reachable = database.prepare(`WITH RECURSIVE tree(id, depth) AS (
      SELECT id, 0 FROM prj_node WHERE parent_id IS NULL
      UNION ALL
      SELECT child.id, tree.depth + 1 FROM prj_node child JOIN tree ON child.parent_id = tree.id
      WHERE tree.depth < 64
    ) SELECT COUNT(*) AS count, MAX(depth) AS depth FROM tree`).get() as { count: number; depth: number | null };
  if (reachable.count !== nodes || (reachable.depth ?? 0) >= 64) {
    throw new Error("La gerarchia fisica contiene un ciclo o supera la profondità massima.");
  }
  if (count("SELECT COUNT(*) AS count FROM prj_node WHERE parent_id IS NULL AND node_kind NOT IN ('enclosure','group')") > 0) {
    throw new Error("La radice della gerarchia fisica non è un contenitore valido.");
  }
  if (count(`SELECT COUNT(*) AS count FROM prj_node child
      JOIN prj_node parent ON parent.id = child.parent_id
      LEFT JOIN prj_item_zone zone ON zone.item_id = parent.item_id AND zone.zone_no = child.zone_no
      LEFT JOIN prj_item_zone_slot slot ON slot.item_id = zone.item_id AND slot.zone_no = zone.zone_no AND slot.slot_no = child.slot_no
      WHERE zone.item_id IS NULL
         OR (zone.layout = 'slots' AND (child.slot_no IS NULL OR slot.item_id IS NULL))
         OR (zone.layout IN ('linear','stack') AND child.start_units IS NULL)`) > 0) {
    throw new Error("La posizione di un nodo non corrisponde alla zona del contenitore.");
  }
  const assets = database.prepare("SELECT sha256, byte_size AS byteSize, data, license_code AS licenseCode FROM prj_asset").all() as
    { sha256: string; byteSize: number; data: Buffer; licenseCode: string }[];
  for (const asset of assets) {
    if (asset.byteSize > 20 * 1024 * 1024 || asset.data.length !== asset.byteSize ||
        createHash("sha256").update(asset.data).digest("hex") !== asset.sha256 ||
        !["lq_own", "manufacturer_licensed"].includes(asset.licenseCode)) {
      throw new Error("Il progetto contiene una risorsa incorporata non valida.");
    }
  }
}

function enclosureNode(db:Database.Database,uuid:string):{id:number;itemId:number}|undefined {
  return db.prepare(`SELECT n.id,i.id AS itemId FROM prj_node n
    JOIN prj_item i ON i.id=n.item_id WHERE n.uuid=? AND n.node_kind='enclosure'`)
    .get(uuid) as {id:number;itemId:number}|undefined;
}

/** Guard refusals that say the catalogue cannot judge this item, rather than that the destination is incompatible. */
const CATALOGUE_CANNOT_JUDGE=new Set(["catalogue_unavailable","model_unavailable","container_unavailable",
  "engineering_data_stale","context_data_unavailable","design_not_navigable","physical_data_unavailable"]);

function deleteQuotationLine(db: Database.Database, lineUuid: string): void {
  const line = db.prepare("SELECT id,item_id AS itemId FROM prj_line WHERE uuid=?")
    .get(lineUuid) as {id:number;itemId:number|null}|undefined;
  if (!line) throw new Error("Riga del preventivo non trovata.");
  if (line.itemId !== null && db.prepare("SELECT 1 FROM prj_node WHERE item_id=? LIMIT 1")
    .get(line.itemId)) throw new Error("L'articolo configurato è posizionato nel progetto e non può essere rimosso.");
  const candidates = new Set<number>();
  const lineSnapshot = db.prepare("SELECT snapshot_id AS snapshotId FROM prj_line WHERE id=?")
    .get(line.id) as {snapshotId:number|null};
  if (lineSnapshot.snapshotId !== null) candidates.add(lineSnapshot.snapshotId);
  if (line.itemId !== null) {
    const primary = db.prepare("SELECT primary_snapshot_id AS snapshotId FROM prj_item WHERE id=?")
      .get(line.itemId) as {snapshotId:number|null};
    if (primary.snapshotId !== null) candidates.add(primary.snapshotId);
    const bom = db.prepare("SELECT snapshot_id AS snapshotId FROM prj_item_bom WHERE item_id=?")
      .all(line.itemId) as {snapshotId:number}[];
    for (const row of bom) candidates.add(row.snapshotId);
  }
  db.prepare("DELETE FROM prj_line WHERE id=?").run(line.id);
  if (line.itemId !== null) db.prepare("DELETE FROM prj_item WHERE id=?").run(line.itemId);
  removeUnusedProductSnapshots(db,candidates);
}

/**
 * Takes `count` units of a configured item out of the project: the line quantity drops by
 * `count`, and at zero the line and item go exactly as removeLine removes them. Units still
 * placed elsewhere are never touched, so this refuses to go below the placed count.
 */
function removeItemUnits(db: Database.Database, itemId: number, count: number): void {
  const line = db.prepare(`SELECT uuid,quantity,sale_price_unit_e4 AS salePrice FROM prj_line
    WHERE item_id=? AND line_type='item'`).get(itemId) as {uuid:string;quantity:number;salePrice:number|null}|undefined;
  if (!line) throw new Error("Riga del preventivo non trovata.");
  const remaining = line.quantity - count;
  const placed = db.prepare("SELECT COUNT(*) FROM prj_node WHERE item_id=?").pluck().get(itemId) as number;
  if (remaining < placed) throw new Error("La quantità non può essere inferiore alle unità posizionate.");
  if (remaining <= 0) { deleteQuotationLine(db, line.uuid); return; }
  db.prepare("UPDATE prj_line SET quantity=?,line_total_e4=? WHERE uuid=?")
    .run(remaining, safeIntegerPriceTimesQuantity(line.salePrice, remaining), line.uuid);
}

/** The one transaction behind ProjectDocumentService.removePhysicalRoot; any failure leaves the project unchanged. */
export function removePhysicalRoot(db: Database.Database, nodeUuid: string, contents: ProjectRootRemoval): void {
  db.transaction(() => {
    const removed = deletePhysicalRoot(db, nodeUuid);
    const units = new Map(contents === "remove-contents" ? removed.contents : []);
    if (removed.rootItemId !== null) units.set(removed.rootItemId, (units.get(removed.rootItemId) ?? 0) + 1);
    for (const [itemId, count] of units) removeItemUnits(db, itemId, count);
  })();
}

export class ProjectDocumentService {
  readonly #options: ProjectDocumentServiceOptions;
  #session: Session | null = null;
  readonly #recoveries = new Map<string, RecoveryEntry>();

  constructor(options: ProjectDocumentServiceOptions) {
    this.#options = options;
    mkdirSync(options.workingDirectory, { recursive: true });
    mkdirSync(options.incomingDirectory, { recursive: true });
    mkdirSync(options.backupDirectory, { recursive: true });
    this.cleanupIncomingFiles();
    this.discoverRecoveryEntries();
  }

  async create(request: CreateProjectDocumentRequest): Promise<ProjectDocumentView> {
    const expectedCurrent = this.#session;
    this.assertReplacementAllowed();
    const metadata = validateProjectCreation(request);
    const workingPath = path.join(this.#options.workingDirectory, `${randomUUID()}.lqp`);
    let database: Database.Database;
    try {
      database = openCurrentProjectDatabase(workingPath, this.#options.migrationsFolder);
    } catch (error) {
      removeDatabaseFiles(workingPath);
      throw error;
    }
    const projectUuid = randomUUID();
    const createdAt = this.now().toISOString();
    const formatVersion = projectFormatVersion(this.#options.migrationsFolder);
    const transaction = database.transaction(() => {
      const metadataRows: readonly [string, string][] = [
        ["format_version", String(formatVersion)], ["app_version_saved", this.#options.appVersion],
        ["project_uuid", projectUuid], ["revision", "0"], ["created_at", createdAt],
        ["created_by_name", ""], ["created_by_installation_uuid", ""], ["saved_at", ""],
        ["saved_by_name", ""], ["saved_by_installation_uuid", ""], ["contains_costs", "0"],
      ];
      const insertMeta = database.prepare("INSERT INTO lqp_meta(key, value) VALUES (?, ?)");
      for (const row of metadataRows) insertMeta.run(...row);
      database.prepare(`INSERT INTO prj_project(
        id, uuid, title, description, notes, project_type, norm_code, executor,
        project_date, customer_name, customer_description
      ) VALUES (1, @uuid, @title, @description, @notes, @projectType, @normCode,
        @executor, @date, @companyName, @companyDescription)`).run({
          ...metadata,
          uuid: projectUuid,
          normCode: PROJECT_TYPES[metadata.projectType].normCode,
        });
      database.prepare("INSERT INTO prj_group(id, uuid, name, sort_order) VALUES (1, ?, 'Preventivo', 0)").run(randomUUID());
    });
    const targetPath = path.resolve(request.destinationPath);
    const candidate: Session = {
      workingPath, database, targetPath, documentName: path.basename(targetPath), baseline: null,
      dirty: true, changeVersion: 0, pendingSave: null, ...freshHistory(null),
    };
    try {
      transaction();
      this.writeRecoveryMetadata(candidate);
      await this.saveSession(candidate, targetPath, null, true);
      this.replaceCurrentSession(candidate, expectedCurrent);
      return this.viewForSession(candidate);
    } catch (error) {
      this.disposeSession(candidate, true);
      throw error;
    }
  }

  open(filename: string): ProjectDocumentView {
    const expectedCurrent = this.#session;
    const targetPath = path.resolve(filename);
    if (expectedCurrent?.targetPath === targetPath) return this.viewForSession(expectedCurrent);
    this.assertReplacementAllowed();
    if (["-wal", "-shm", "-journal"].some((suffix) => existsSync(`${targetPath}${suffix}`))) {
      throw new Error("Il progetto ha file SQLite laterali e potrebbe non essere stato chiuso correttamente.");
    }
    const stat = statSync(targetPath);
    if (stat.size > MAX_PROJECT_BYTES) throw new Error("Il file progetto supera il limite di 200 MB.");
    const incomingPath = path.join(this.#options.incomingDirectory, `${randomUUID()}.lqp`);
    const workingPath = path.join(this.#options.workingDirectory, `${randomUUID()}.lqp`);
    let candidate: Session | undefined;
    try {
      copyFileSync(targetPath, incomingPath);
      const baseline = { size: statSync(incomingPath).size, mtimeMs: stat.mtimeMs, sha256: sha256File(incomingPath) };
      const incoming = this.validateIncoming(incomingPath);
      const database = openProjectDatabaseAtVersion(workingPath, this.#options.migrationsFolder, incoming.formatVersion);
      try {
        this.copyDocumentRows(database, incomingPath, incoming.manifest);
        migrateProjectDatabaseToCurrent(database, this.#options.migrationsFolder);
        setMeta(database, "format_version", String(projectFormatVersion(this.#options.migrationsFolder)));
        candidate = {
          workingPath, database, targetPath, documentName: path.basename(targetPath), baseline,
          dirty: false, changeVersion: 0, pendingSave: null, ...freshHistory(0),
        };
      } catch (error) {
        database.close();
        removeDatabaseFiles(workingPath);
        throw error;
      }
      this.replaceCurrentSession(candidate, expectedCurrent);
      this.notifyDocumentStored(candidate);
      if (this.#options.reconcileOnOpen) this.reconcileOpenedProject(candidate);
      return this.viewForSession(candidate);
    } catch (error) {
      if (!candidate) removeDatabaseFiles(workingPath);
      throw error;
    } finally {
      if (existsSync(incomingPath)) unlinkSync(incomingPath);
    }
  }

  current(): ProjectDocumentView | null {
    const session = this.#session;
    if (!session) return null;
    return this.viewForSession(session);
  }

  /** Main-process only: the saved location of the current document, or null for an unsaved recovery. */
  currentTargetPath(): string | null {
    return this.#session?.targetPath ?? null;
  }

  /** Main-process only: window and menu state without building the whole document view. */
  currentSummary(): ProjectDocumentSummary | null {
    const session = this.#session;
    if (!session) return null;
    const row = session.database.prepare("SELECT title FROM prj_project WHERE id = 1").get() as { title: string } | undefined;
    return { title: row?.title ?? session.documentName, documentName: session.documentName,
      dirty: session.dirty, targetPath: session.targetPath, ...session.history.state() };
  }

  /**
   * Keys for placed node views plus every view of a resolved physical item that still has
   * unplaced units, so a drag preview can resolve before placement. Placed keys sort first.
   */
  frontAssets(): Record<string,FrontVectorAsset> {
    const session=this.requireSession();
    const keys=session.database.prepare(`SELECT v.asset_key AS key FROM prj_item_view v
      JOIN prj_item i ON i.id=v.item_id
      WHERE v.asset_key IS NOT NULL AND trim(v.asset_key) != '' AND (
        EXISTS (SELECT 1 FROM prj_node n WHERE n.item_id=v.item_id AND n.view_code=v.view_code)
        OR (i.phys_status='resolved' AND i.model_kind IN ('enclosure','support','device') AND
          (SELECT l.quantity FROM prj_line l WHERE l.item_id=i.id AND l.line_type='item') >
          (SELECT COUNT(*) FROM prj_node n WHERE n.item_id=i.id)))
      GROUP BY v.asset_key
      ORDER BY MAX(EXISTS (SELECT 1 FROM prj_node n WHERE n.item_id=v.item_id AND n.view_code=v.view_code)) DESC,
        v.asset_key`).all() as {key:string}[];
    const resolve=this.#options.resolveFrontAssets;
    if(!resolve)return {};
    const assets={...resolve(keys.map(row=>row.key))};
    const resolveLabels=this.#options.resolveFrontOptionLabels;
    if(resolveLabels){
      const placed=new Set((session.database.prepare(`SELECT DISTINCT i.uuid FROM prj_node n
        JOIN prj_item i ON i.id=n.item_id WHERE n.node_kind='enclosure' AND n.view_code='front'`)
        .pluck().all()) as string[]);
      if(placed.size){
        const labels=resolveLabels(readConfiguredItems(session.database),placed);
        const labelKeys=[...new Set([...labels.values()].flat().map(label=>label.assetKey))];
        for(let start=0;start<labelKeys.length;start+=500)
          Object.assign(assets,resolve(labelKeys.slice(start,start+500)));
      }
    }
    return assets;
  }

  designDiscover(kind:StructuralDesignKind,parentUuid?:string):StructuralDiscovery {
    const session=this.requireSession();
    if(!this.#options.designDiscover)throw new Error("Ricerca strutturale non disponibile.");
    return this.#options.designDiscover(session.database,{kind,...(parentUuid?{parentUuid}:{})});
  }

  designNavigation(kind:StructuralDesignKind,parentUuid?:string):StructuralNavigation {
    const session=this.requireSession();
    if(!this.#options.designNavigation)throw new Error("Navigazione strutturale non disponibile.");
    return this.#options.designNavigation(session.database,{kind,...(parentUuid?{parentUuid}:{})});
  }

  referenceDevices(parentUuid:string):StructuralNavigation {
    if(!this.#options.referenceDevices)throw new Error("Catalogo apparecchi non disponibile.");
    return this.#options.referenceDevices(this.requireSession().database,parentUuid);
  }
  enclosureReferenceDevices():StructuralNavigation {
    this.requireSession();
    const catalogue=this.#options.engineeringCatalogue?.();
    if(!catalogue)throw new Error("Catalogo di ingegneria non disponibile.");
    const navigation=discoverEnclosureReferenceDevices(catalogue);
    return {...navigation,candidates:configurationModelSummaries(catalogue,navigation.candidates)};
  }
  compatibleEnclosures(request:import("../../shared/project.js").CompatibleEnclosuresRequest):CompatiblePanelNavigation {
    const project=this.requireSession().database,catalogue=this.#options.engineeringCatalogue?.();
    if(!catalogue)throw new Error("Catalogo di ingegneria non disponibile.");
    const result=discoverCompatibleEnclosures(catalogue,project,request);
    return {...result,navigation:{...result.navigation,candidates:configurationModelSummaries(catalogue,result.navigation.candidates)}};
  }
  compatiblePanels(request:CompatiblePanelsRequest):CompatiblePanelNavigation {
    if(!this.#options.compatiblePanels)throw new Error("Ricerca pannelli non disponibile.");
    return this.#options.compatiblePanels(this.requireSession().database,request);
  }
  checkPanelReference(request:PanelReferenceCheckRequest):ReferenceCompatibility {
    if(!this.#options.checkPanelReference)throw new Error("Verifica pannello non disponibile.");
    return this.#options.checkPanelReference(this.requireSession().database,request);
  }

  addStructural(request:AddStructuralRequest):ProjectDocumentView {
    const session=this.requireSession();
    const place=request.place!==false;
    if(request.autoPlace&&(place||request.quantity!==undefined&&request.quantity!==1))
      throw new Error("Il posizionamento automatico aggiunge una sola unità senza zona preassegnata.");
    if(request.quantity!==undefined){
      if(!Number.isSafeInteger(request.quantity)||request.quantity<STRUCTURAL_ADD_QUANTITY_MIN||
        request.quantity>STRUCTURAL_ADD_QUANTITY_MAX)throw new Error("Quantità non valida (da 1 a 99).");
      if(request.kind!=="support"||place)
        throw new Error("La quantità si indica solo per un pannello aggiunto senza posizionamento.");
    }
    if(request.kind==="device"&&place)
      throw new Error("Un apparecchio si aggiunge senza posizionamento e si posiziona da Da posizionare.");
    if(!place&&(request.kind==="enclosure"||request.zoneNo!==undefined))
      throw new Error("L'aggiunta senza posizionamento è valida solo per un pannello o un apparecchio, senza zona.");
    if(!this.#options.resolveConfiguration||!this.#options.designGuard)
      throw new Error("Configurazione strutturale non disponibile.");
    if(request.kind==="enclosure" ? request.parentUuid!==undefined : !request.parentUuid)
      throw new Error("Seleziona un involucro valido.");
    if(projectEngineeringChainStale(session.database,request.parentUuid))
      throw new PlacementError("project_engineering_stale","Aggiorna i dati di ingegneria del progetto.");
    if(request.referenceDevice){
      const checked=request.kind==="enclosure"
        ?this.compatibleEnclosures({device:request.referenceDevice,enclosure:request.configuration}).reference
        :request.kind==="support"&&!place&&request.parentUuid
          ?this.checkPanelReference({parentUuid:request.parentUuid,device:request.referenceDevice,panel:request.configuration})
          :{ok:false,code:"reference_scope_unavailable"};
      if(!checked.ok)throw new PlacementError(checked.code,`Struttura non compatibile con l’apparecchio: ${checked.code}.`);
    }
    const result=this.#options.resolveConfiguration(request.configuration);
    if(result.model.kind!==request.kind||(result.status!=="complete"&&!(request.configuration.acceptOutOfCatalogue&&isOutOfCatalogue(result)))||!result.physical)
      throw new Error("Configurazione strutturale incompleta.");
    const guarded=this.#options.designGuard(session.database,
      {kind:request.kind,modelId:request.configuration.modelId,
        ...(request.parentUuid?{parentUuid:request.parentUuid}:{})},request.configuration);
    if(!guarded.ok)throw new PlacementError(guarded.code,guarded.code==="project_engineering_stale"?"Aggiorna i dati di ingegneria del progetto.":`Modello strutturale non compatibile: ${guarded.code}.`);
    const view=result.physical.views.find(row=>row.code==="front")??result.physical.views[0];
    if(!view)throw new Error("Vista fisica non disponibile.");
    if(request.kind==="support"&&!place&&!enclosureNode(session.database,request.parentUuid!))
      throw new Error("Involucro selezionato non disponibile.");
    let presetDiagnostics:import("../../shared/project.js").PresetDiagnostic[]=[];
    let autoPlacement:ProjectDocumentView["autoPlacement"];
    const transaction=()=>{
      if(request.kind==="enclosure")this.checkEnclosureRow(session.database,result.model.brandMarchio,result.model.code);
      const itemUuid=insertConfiguredItem(session.database,result,
        this.#options.resolveCatalogueProduct,this.now().toISOString(),request.quantity??1,true,request.configuration.acceptOutOfCatalogue);
      if(request.autoPlace){
        autoPlacement=this.applyFirstPlacement(session,{itemUuid},parentUuid=>!request.referenceDevice||parentUuid===request.parentUuid||
          this.checkPanelReference({parentUuid,device:request.referenceDevice,panel:request.configuration}).ok);
      }
      if(!place)return;
      if(request.kind==="enclosure"){
        const roots=readPhysicalNodes(session.database).filter(node=>node.nodeKind==="enclosure");
        const configured=readConfiguredItems(session.database);
        const byId=new Map(configured.map(row=>[row.uuid,row]));
        const right=Math.max(0,...roots.map(root=>{
          const width=byId.get(root.itemUuid??"")?.views.find(row=>row.viewCode===root.viewCode)?.widthMm??0;
          return (root.xMm??root.rootXMm??0)+width;
        }));
        const parentUuid=placeRoot(session.database,{itemUuid,viewCode:view.code,
          rootXMm:roots.length?right+50:0,rootYMm:0});
        presetDiagnostics=instantiatePresetChildren(session.database,result,parentUuid,
          this.#options.resolveConfiguration!,this.#options.resolveCatalogueProduct,this.now().toISOString(),
          (modelId,factoryPreset)=>this.#options.designGuard!(session.database,
            {kind:"support",modelId,parentUuid,...(factoryPreset?{factoryPreset:true}:{})},
            {modelId,selectedOptionIds:[]}));
      }else{
        const parent=enclosureNode(session.database,request.parentUuid!);
        if(!parent)throw new Error("Involucro selezionato non disponibile.");
        const zones=session.database.prepare(`SELECT zone_no AS zoneNo FROM prj_item_zone WHERE item_id=?
          ORDER BY zone_no`).all(parent.itemId) as {zoneNo:number}[];
        let zoneNo=request.zoneNo;
        if(zoneNo===undefined){
          const valid:number[]=[];
          const probe=Symbol("packed-probe");
          for(const zone of zones){
            try {
              session.database.transaction(()=>{
                insertPackedChild(session.database,{itemUuid,parentUuid:request.parentUuid!,
                  zoneNo:zone.zoneNo,viewCode:view.code});
                throw probe;
              })();
            }catch(error){if(error===probe)valid.push(zone.zoneNo);
              else if(!(error instanceof PlacementError))throw error;}
          }
          if(valid.length===1)zoneNo=valid[0];
        }
        if(zoneNo===undefined||!zones.some(row=>row.zoneNo===zoneNo))
          throw new Error("Seleziona una zona compatibile dell'involucro.");
        insertPackedChild(session.database,{itemUuid,parentUuid:request.parentUuid!,
          zoneNo,viewCode:view.code});
      }
    };
    this.recordAction(session,HISTORY_LABELS.add[request.kind],transaction);
    if(request.kind!=="enclosure")presetDiagnostics=result.model.relations
      .filter(row=>row.relation==="preset_child").map(row=>({seq:row.seq,modelCode:row.toModelCode,
        status:"withheld",code:"nested_presets_unsupported",
        message:"La creazione di preimpostazioni su supporti annidati non è ancora supportata."}));
    return {...this.viewForSession(session),
      ...(presetDiagnostics.length?{presetDiagnostics}:{}),...(autoPlacement?{autoPlacement}:{})};
  }

  /**
   * Pool → physical placement of an existing support. Context is snapshotted, but first
   * placement still requires the current catalogue to confirm eligibility, fingerprint and root
   * context inside the write transaction; without that confirmation nothing is written.
   * Moving an already placed support uses the ordinary physical-placement operations.
   */
  /**
   * The one catalogue-backed check for placing a configured support (Pannello) on an enclosure.
   * placeStructuralItem enforces it on write and placementTargets applies it to every pooled
   * support candidate, so a listed target cannot be refused by the write.
   */
  private structuralPlacementGuard(session:Session,itemUuid:string,parentUuid:string|undefined):
    {ok:true}|{ok:false;code:string;message:string} {
    const refuse=(code:string,message:string)=>({ok:false as const,code,message});
    const item=session.database.prepare(`SELECT model_brand_marchio AS brandMarchio,
      model_code AS modelCode,model_definition_fingerprint AS definitionFingerprint,
      model_kind AS kind,phys_status AS physStatus FROM prj_item WHERE uuid=?`)
      .get(itemUuid) as {brandMarchio:string;modelCode:string;definitionFingerprint:string;
        kind:string;physStatus:string}|undefined;
    if(!item)return refuse("invalid_item","Articolo configurato non trovato.");
    if(item.kind!=="support"||item.physStatus!=="resolved")
      return refuse("invalid_item","Solo un pannello con profilo fisico risolto può essere posizionato in una struttura.");
    if(parentUuid===undefined||!enclosureNode(session.database,parentUuid))
      return refuse("invalid_parent","Involucro selezionato non disponibile.");
    const guard=this.#options.designItemGuard;
    if(!guard)return refuse("catalogue_unavailable","Verifica del catalogo non disponibile.");
    let guarded:ReturnType<NonNullable<typeof guard>>;
    try {
      guarded=guard(session.database,{parentUuid,itemUuid,item:{brandMarchio:item.brandMarchio,
        modelCode:item.modelCode,definitionFingerprint:item.definitionFingerprint,kind:"support"}});
    }catch{return refuse("catalogue_unavailable","Verifica del catalogo non disponibile.");}
    return guarded.ok?{ok:true}:refuse(guarded.code,guarded.code==="project_engineering_stale"?"Aggiorna i dati di ingegneria del progetto.":`Modello strutturale non compatibile: ${guarded.code}.`);
  }

  /**
   * Movement of an existing support to another enclosure root is decided by the project snapshot
   * whenever its context facts suffice (no catalogue involved). Only when they do not (missing or
   * `unknown` facts on the support or the destination root) and a catalogue guard can judge, the same
   * guard used for first placement supplies the verdict; the engine then still runs the physical and
   * complete-subtree validation. Nothing is written back to the snapshot. When the catalogue cannot
   * judge, no verdict is supplied and the engine's conservative snapshot behaviour applies.
   * placementTargets, checkPlacement, moveNode and movePackedNode all call this, so they agree.
   */
  private rootTransferOptions(session:Session,nodeUuid:string|undefined,destinationParentUuid:string|undefined):PlacementOptions|undefined {
    if(nodeUuid===undefined||destinationParentUuid===undefined||!this.#options.designItemGuard)return undefined;
    const rows=session.database.prepare(`SELECT n.id,n.uuid,n.parent_id AS parentId,n.node_kind AS kind,
      i.uuid AS itemUuid,i.context_policy AS policy FROM prj_node n JOIN prj_item i ON i.id=n.item_id`)
      .all() as Array<{id:number;uuid:string;parentId:number|null;kind:string;itemUuid:string;policy:string|null}>;
    const byId=new Map(rows.map(row=>[row.id,row]));
    const rootOf=(start:typeof rows[number]|undefined)=>{
      let cursor=start;
      for(let depth=0;cursor&&depth<=64;depth++){
        if(cursor.parentId===null)return cursor;
        cursor=byId.get(cursor.parentId);
      }
      return undefined;
    };
    const moving=rows.find(row=>row.uuid===nodeUuid);
    if(!moving||moving.kind!=="support")return undefined;
    const destinationRoot=rootOf(rows.find(row=>row.uuid===destinationParentUuid));
    const sourceRoot=rootOf(moving);
    if(!destinationRoot||!sourceRoot||destinationRoot.id===sourceRoot.id)return undefined;
    const sufficient=moving.policy!==null&&destinationRoot.policy!==null&&
      moving.policy!=="unknown"&&destinationRoot.policy!=="unknown";
    if(sufficient)return undefined;
    if(projectEngineeringChainStale(session.database,moving.uuid)||projectEngineeringChainStale(session.database,destinationParentUuid))
      return {rootTransfer:new Map<string,RootTransferVerdict>([[destinationRoot.uuid,
        {ok:false,code:"project_engineering_stale",message:"Aggiorna i dati di ingegneria del progetto."}]])};
    const guarded=this.structuralPlacementGuard(session,moving.itemUuid,destinationParentUuid);
    if(guarded.ok)return {rootTransfer:new Map<string,RootTransferVerdict>([[destinationRoot.uuid,{ok:true}]])};
    if(CATALOGUE_CANNOT_JUDGE.has(guarded.code))return undefined;
    return {rootTransfer:new Map<string,RootTransferVerdict>([[destinationRoot.uuid,
      {ok:false,code:guarded.code,message:guarded.message}]])};
  }

  placeStructuralItem(request:ProjectStructuralPlacement):ProjectDocumentView {
    const session=this.requireSession();
    const {input}=request;
    this.recordAction(session,HISTORY_LABELS.place,()=>{
      const guarded=this.structuralPlacementGuard(session,input.itemUuid,input.parentUuid);
      if(!guarded.ok)throw new Error(guarded.message);
      if(request.action==="placeChild")placeChild(session.database,request.input);
      else insertPackedChild(session.database,request.input,request.index);
    });
    return this.viewForSession(session);
  }

  private viewForSession(session: Session): ProjectDocumentView {
    const row = session.database.prepare(`SELECT uuid, title, description, notes, project_type AS projectType,
      norm_code AS normCode, executor, project_date AS date, customer_name AS companyName,
      customer_description AS companyDescription, currency,
      global_discount_bp AS globalDiscountBp,labour_total_e4 AS labourTotalE4 FROM prj_project WHERE id = 1`).get() as {
        uuid: string; title: string; description: string | null; notes: string | null;
        projectType: "civil" | "industrial"; normCode: string; executor: string | null;
        date: string; companyName: string | null; companyDescription: string | null; currency: string;
        globalDiscountBp:number;labourTotalE4:number;
      } | undefined;
    if (!row) throw new Error("Il progetto non contiene il record principale.");
    const lines = session.database.prepare(`SELECT l.line_type AS lineType,l.uuid,
      s.uuid AS snapshotUuid,i.uuid AS itemUuid,
      COALESCE(s.brand_marchio,i.model_brand_marchio) AS brandMarchio,
      s.manufacturer_code AS productCode,i.model_code AS modelCode,
      COALESCE(l.description_override,s.description,s.short_description,i.config_label) AS description,
      s.unit_of_measure AS unitOfMeasure,l.quantity,
      COALESCE(i.commercial_contribution,'articles') AS commercialContribution,
      COALESCE(s.list_price_unit_e4,l.sale_price_unit_e4) AS unitListPriceE4,
      l.line_total_e4 AS lineTotalE4,l.line_discount_bp AS lineDiscountBp
      FROM prj_line l LEFT JOIN prj_product_snapshot s ON s.id=l.snapshot_id
      LEFT JOIN prj_item i ON i.id=l.item_id
      WHERE l.line_type IN ('product','item') ORDER BY l.group_id,l.sort_order,l.id`).all() as Array<
        Omit<ProjectQuotationLine,"currency"|"manufacturerCode"> & {productCode:string|null;modelCode:string|null}>;
    const physicalNodes=readPhysicalNodes(session.database);
    const items=readConfiguredItems(session.database);
    const placed=new Set(physicalNodes.flatMap(node=>node.nodeKind==="enclosure"&&node.viewCode==="front"&&node.itemUuid ? [node.itemUuid] : []));
    const frontLabels=placed.size ? this.#options.resolveFrontOptionLabels?.(items,placed) : undefined;
    const undoToken = currentUndoToken(session);
    return {
      ...(session.openReconciliation ? { openReconciliation: session.openReconciliation } : {}),
      documentName: session.documentName,
      revision: Number(meta(session.database, "revision")),
      dirty: session.dirty,
      history: session.history.state(),
      ...(undoToken ? { undoToken } : {}),
      globalDiscountBp:row.globalDiscountBp,
      labourTotalE4:row.labourTotalE4,
      metadata: {
        uuid: row.uuid, title: row.title, description: row.description ?? "", notes: row.notes ?? "",
        projectType: row.projectType, normCode: row.normCode, executor: row.executor ?? "", date: row.date,
        companyName: row.companyName ?? "", companyDescription: row.companyDescription ?? "",
      },
      lines: lines.map(({productCode,modelCode,...line}) => ({...line,
        manufacturerCode:productCode ?? modelCode ?? "",currency:row.currency})),
      configuredItems: items.map(item=>{
        const labels=frontLabels?.get(item.uuid);
        return labels ? {...item,frontOptionLabels:labels} : item;
      }),
      distinta: readDistinta(session.database),
      physicalNodes,
      annotations: readAnnotations(session.database),
    };
  }

  addCatalogueProduct(productId: number, requestedQuantity = 1, undoable = false): ProjectDocumentView {
    if (!Number.isSafeInteger(productId) || productId < 1) throw new Error("Identificativo prodotto non valido.");
    if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > 9_999) {
      throw new Error("Quantità non valida.");
    }
    const session = this.requireSession();
    const source = this.#options.resolveCatalogueProduct(productId);
    const add = () => {
      let snapshot = session.database.prepare("SELECT id, list_price_unit_e4 AS listPriceUnitE4 FROM prj_product_snapshot WHERE brand_marchio = ? AND manufacturer_code = ?")
        .get(source.brandMarchio, source.manufacturerCode) as { id: number; listPriceUnitE4: number | null } | undefined;
      if (!snapshot) {
        const result = session.database.prepare(`INSERT INTO prj_product_snapshot(
          uuid, brand_marchio, brand_name, manufacturer_code, ean, short_description, description,
          unit_of_measure, category_code, category_path_label, family_code, family_name,
          price_issuer_sigla, price_listino_number, price_valid_from, list_price_unit_e4,
          price_multiplier_original, snapshot_taken_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          randomUUID(), source.brandMarchio, source.brandName, source.manufacturerCode, source.ean,
          source.shortDescription, source.description, source.unitOfMeasure, source.categoryCode,
          source.categoryPathLabel, source.familyCode, source.familyName, source.priceIssuerSigla,
          source.priceListinoNumber, source.priceValidFrom, source.listPriceUnitE4,
          source.priceMultiplierOriginal, this.now().toISOString(),
        );
        snapshot = { id: Number(result.lastInsertRowid), listPriceUnitE4: source.listPriceUnitE4 };
        const attributeInsert = session.database.prepare(`INSERT INTO prj_product_snapshot_attribute(
          snapshot_id, attribute_code, attribute_name, data_type, unit, value_num,
          option_value, option_label, value_bool, value_text
        ) VALUES (@snapshotId, @code, @name, @dataType, @unit, @valueNum, @optionValue, @optionLabel, @valueBool, @valueText)`);
        for (const attribute of source.attributes) {
          attributeInsert.run({ snapshotId: snapshot.id, code: attribute.code, name: attribute.name,
            dataType: attribute.dataType, unit: attribute.unit,
            valueNum: attribute.dataType === "number" ? attribute.value : null,
            optionValue: attribute.dataType === "enum" ? attribute.value : null,
            optionLabel: attribute.dataType === "enum" ? attribute.label : null,
            valueBool: attribute.dataType === "boolean" ? Number(attribute.value) : null,
            valueText: attribute.dataType === "text" ? attribute.value : null });
        }
      }
      const existing = session.database.prepare("SELECT id, quantity FROM prj_line WHERE line_type = 'product' AND snapshot_id = ?").get(snapshot.id) as { id: number; quantity: number } | undefined;
      if (existing) {
        if (existing.quantity + requestedQuantity > 9_999) throw new Error("La quantità massima per riga è 9.999.");
        const quantity = existing.quantity + requestedQuantity;
        session.database.prepare("UPDATE prj_line SET quantity = ?, line_total_e4 = ? WHERE id = ?")
          .run(quantity, safeIntegerPriceTimesQuantity(snapshot.listPriceUnitE4, quantity), existing.id);
      } else {
        const next = session.database.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM prj_line WHERE group_id = 1").get() as { value: number };
        session.database.prepare(`INSERT INTO prj_line(uuid, group_id, sort_order, line_type, snapshot_id,
          quantity, sale_price_unit_e4, line_total_e4) VALUES (?, 1, ?, 'product', ?, ?, ?, ?)`)
          .run(randomUUID(), next.value, snapshot.id, requestedQuantity, snapshot.listPriceUnitE4,
            safeIntegerPriceTimesQuantity(snapshot.listPriceUnitE4, requestedQuantity));
      }
    };
    if (undoable) this.recordAction(session, HISTORY_LABELS.add.device, add);
    else {
      session.database.transaction(add)();
      this.markDirty(session);
    }
    return this.current()!;
  }

  addConfiguredItem(request: ConfigurationRequest, quantity = 1, undoable = false, autoPlace = false): ProjectDocumentView {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 9_999) {
      throw new Error("Quantità non valida.");
    }
    const session = this.requireSession();
    if (!this.#options.resolveConfiguration) throw new Error("Risolutore di configurazione non disponibile.");
    const result = this.#options.resolveConfiguration(request);
    if(result.model.factoryPresetOnly)
      throw new Error("Questo pannello viene aggiunto automaticamente con la sua carpenteria.");
    if (autoPlace && (quantity !== 1 || (result.model.kind !== "device" && result.model.kind !== "support")))
      throw new Error("Il posizionamento automatico richiede un singolo pannello o apparecchio.");
    let autoPlacement: ProjectDocumentView["autoPlacement"];
    const add = () => {
      const itemUuid = insertConfiguredItem(session.database,result,
        this.#options.resolveCatalogueProduct,this.now().toISOString(),quantity,true,request.acceptOutOfCatalogue);
      if (autoPlace) autoPlacement = this.applyFirstPlacement(session, { itemUuid });
    };
    if (undoable || autoPlace) this.recordAction(session, result.model.kind === "support" ? HISTORY_LABELS.add.support : HISTORY_LABELS.add.device, add);
    else {
      session.database.transaction(add)();
      this.markDirty(session);
    }
    return { ...this.viewForSession(session), ...(autoPlacement ? { autoPlacement } : {}) };
  }

  engineeringStatus():ProjectEngineeringStatus {
    return projectEngineeringStatus(this.requireSession().database,this.#options.engineeringCatalogue?.()??null);
  }

  private reconcileOpenedProject(session: Session): void {
    let catalogue: Database.Database | null | undefined;
    try {
      catalogue = this.#options.engineeringCatalogue?.();
    } catch (error) {
      session.openReconciliation = { engineeringFailed: true, pricingFailed: true };
      console.warn("Could not open catalogue for project reconciliation", error);
      return;
    }
    if (!catalogue) return;
    const database = session.database;
    const restoreEngineering = this.checkpoint(session);
    try {
      const counts = projectEngineeringStatus(database, catalogue).counts;
      if (counts.older_adapter || counts.other_generation || counts.unknown) {
        catalogue.transaction(() => database.transaction(() => {
          const prepared = planEngineeringRefresh(database, catalogue, this.engineeringPlanningState(session));
          if (canAutoRefreshEngineering(prepared.plan)) {
            applyEngineeringWrites(database, prepared, this.now().toISOString());
            this.viewForSession(session);
            this.markDirty(session);
          } else if (prepared.plan.counts.blocked || prepared.writes.length) {
            const item = prepared.plan.items.find(entry => entry.action === "blocked") ??
              prepared.plan.items.find(entry => entry.changes.some(change => change !== "labels" && change !== "provenance"));
            if (item) {
              const detail = item.labelChanges.find(change => /^(Ingombro|Disegno|Profondità)/.test(change.field));
              session.openReconciliation = { engineeringReview: detail
                ? `${item.modelName} · ${detail.field}: ${detail.before ?? "—"} → ${detail.after ?? "—"}`
                : item.modelName };
            }
          }
        })())();
      }
    } catch (error) {
      restoreEngineering();
      session.openReconciliation = { engineeringFailed: true };
      console.warn("Project engineering reconciliation failed", error);
    }
    const restorePricing = this.checkpoint(session);
    try {
      if (database.prepare("SELECT currency FROM prj_project WHERE id=1").pluck().get() !== "EUR") return;
      catalogue.transaction(() => database.transaction(() => {
        const before = this.viewForSession(session);
        const beforeE4 = calculateCommercial(before).finalTotalE4;
        const suspectSnapshots = new Set(suspectSavedArticleLinks(before.configuredItems).map(row => row.snapshotUuid));
        const snapshots = repriceProject(database, catalogue, suspectSnapshots);
        if (!snapshots) return;
        const afterE4 = calculateCommercial(this.viewForSession(session)).finalTotalE4;
        this.markDirty(session);
        session.automaticPricingVersion = session.changeVersion;
        session.openReconciliation = { ...session.openReconciliation, pricing: { beforeE4, afterE4, snapshots } };
      })())();
    } catch (error) {
      restorePricing();
      session.openReconciliation = { ...session.openReconciliation, pricingFailed: true };
      console.warn("Project repricing failed", error);
    }
  }

  private engineeringPlanningState(session:Session) {
    return {changeVersion:session.changeVersion,revision:Number(meta(session.database,"revision")),
      projectUuid:meta(session.database,"project_uuid"),
      preconditions:!session.targetPath||(session.dirty && session.changeVersion !== session.automaticPricingVersion)?["save_first"]:[]};
  }

  planEngineeringRefresh():ProjectEngineeringPlan {
    const session=this.requireSession();
    return planEngineeringRefresh(session.database,this.#options.engineeringCatalogue?.()??null,
      this.engineeringPlanningState(session)).plan;
  }

  applyEngineeringRefresh(token:string):ProjectDocumentView {
    const session=this.requireSession(),catalogue=this.#options.engineeringCatalogue?.()??null;
    const restoreBookkeeping=this.checkpoint(session);
    try{return session.database.transaction(()=>{
      const prepared=planEngineeringRefresh(session.database,catalogue,this.engineeringPlanningState(session));
      if(prepared.plan.token!==token)throw new ProjectEngineeringRefreshError("plan_outdated","Il piano è cambiato: verifica nuovamente i dati di ingegneria.");
      if(!prepared.plan.canApply)throw new ProjectEngineeringRefreshError("refresh_blocked","Aggiornamento non possibile. Salva prima il progetto se contiene modifiche.");
      applyEngineeringWrites(session.database,prepared,this.now().toISOString());
      if(prepared.sourceState!==JSON.stringify(catalogue?readEngineeringReadiness(catalogue).sources:[]))
        throw new ProjectEngineeringRefreshError("plan_outdated","Il catalogo è cambiato: verifica nuovamente i dati di ingegneria.");
      // Recovery bookkeeping and view construction must succeed before SQLite commits too.
      this.markDirty(session);
      return this.viewForSession(session);
    })();}catch(error){restoreBookkeeping();throw error;}
  }

  duplicateConfiguredItem(lineUuid: string): ProjectDocumentView {
    if (!isUuid(lineUuid)) throw new Error("Riga del preventivo non valida.");
    const session = this.requireSession();
    session.database.transaction(() => duplicateConfiguredItem(session.database,lineUuid))();
    this.markDirty(session);
    return this.viewForSession(session);
  }

  replaceConfiguredItem(lineUuid: string, request: ConfigurationRequest): ProjectDocumentView {
    if (!isUuid(lineUuid)) throw new Error("Riga del preventivo non valida.");
    const session = this.requireSession();
    if (!this.#options.resolveConfiguration) throw new Error("Risolutore di configurazione non disponibile.");
    const result = this.#options.resolveConfiguration(request);
    session.database.transaction(() => {
      const line = session.database.prepare(`SELECT l.quantity,l.line_type AS lineType,
        s.brand_marchio AS productBrand,s.manufacturer_code AS productCode,
        i.model_brand_marchio AS modelBrand,i.model_code AS modelCode
        FROM prj_line l LEFT JOIN prj_product_snapshot s ON s.id=l.snapshot_id
        LEFT JOIN prj_item i ON i.id=l.item_id WHERE l.uuid=?`).get(lineUuid) as {
          quantity:number;lineType:string;productBrand:string|null;productCode:string|null;
          modelBrand:string|null;modelCode:string|null;
        } | undefined;
      if (!line) throw new Error("Riga del preventivo non trovata.");
      if (line.lineType === "item") {
        if (line.modelBrand !== result.model.brandMarchio || line.modelCode !== result.model.code)
          throw new Error("Il modello non corrisponde all'articolo selezionato.");
      } else if (line.lineType === "product" && request.productId !== undefined) {
        const source = this.#options.resolveCatalogueProduct(request.productId);
        if (source.brandMarchio !== line.productBrand || source.manufacturerCode !== line.productCode)
          throw new Error("L'articolo non corrisponde alla riga selezionata.");
      } else throw new Error("Questa riga non può essere configurata.");
      const oldComponents = line.lineType === "item" ? session.database.prepare(`SELECT
        s.brand_marchio AS brand,s.manufacturer_code AS code,b.role,b.line_discount_bp AS bp
        FROM prj_item_bom b JOIN prj_item i ON i.id=b.item_id
        JOIN prj_line l ON l.item_id=i.id JOIN prj_product_snapshot s ON s.id=b.snapshot_id
        WHERE l.uuid=? ORDER BY b.seq`).all(lineUuid) as
        {brand:string;code:string;role:string;bp:number}[] : [];
      deleteQuotationLine(session.database, lineUuid);
      // Reconfiguring a project item keeps its row independent, even if another item has the same fingerprint.
      const newItemUuid=insertConfiguredItem(session.database, result, this.#options.resolveCatalogueProduct,
        this.now().toISOString(), line.quantity, line.lineType !== "item");
      // Keep an existing customer's discount only when its article/role identifies one component
      // on both sides. Repeated identical components have no unambiguous cross-configuration match.
      if(oldComponents.length){
        const newComponents=session.database.prepare(`SELECT b.seq,s.brand_marchio AS brand,
          s.manufacturer_code AS code,b.role FROM prj_item_bom b
          JOIN prj_item i ON i.id=b.item_id JOIN prj_product_snapshot s ON s.id=b.snapshot_id
          WHERE i.uuid=? ORDER BY b.seq`).all(newItemUuid) as
          {seq:number;brand:string;code:string;role:string}[];
        const key=(component:{brand:string;code:string;role:string})=>
          `${component.brand}\u0000${component.code}\u0000${component.role}`;
        for(const component of newComponents){
          const matchesOld=oldComponents.filter(old=>key(old)===key(component));
          if(matchesOld.length!==1||newComponents.filter(next=>key(next)===key(component)).length!==1)continue;
          session.database.prepare(`UPDATE prj_item_bom SET line_discount_bp=? WHERE seq=?
            AND item_id=(SELECT id FROM prj_item WHERE uuid=?)`)
            .run(matchesOld[0]!.bp,component.seq,newItemUuid);
        }
      }
    })();
    this.markDirty(session);
    return this.viewForSession(session);
  }

  reconfigureEnclosure(nodeUuid: string, request: ConfigurationRequest): ProjectDocumentView {
    if (!isUuid(nodeUuid)) throw new EnclosureReconfigurationError("invalid_enclosure","UUID carpenteria non valido.");
    const session = this.requireSession();
    const catalogue = this.#options.engineeringCatalogue?.();
    const resolve = this.#options.resolveConfiguration;
    if (!catalogue || !resolve) throw new EnclosureReconfigurationError("catalogue_unavailable","Catalogo di ingegneria non disponibile.");
    const run = () => {
      this.recordAction(session,"Modifica carpenteria",() => {
        const changed = reconfigureEnclosure(session.database,catalogue,nodeUuid,request,resolve,
          this.#options.resolveCatalogueProduct,this.now().toISOString());
        // Construct derived commerce/physical data before commit so failures roll back too.
        this.viewForSession(session);
        return changed;
      });
      return this.viewForSession(session);
    };
    return catalogue.inTransaction ? run() : catalogue.transaction(run)();
  }

  checkPlacement(input:ProjectPlacementInput,movingNodeUuid?:string):ProjectPlacementCheck {
    const session=this.requireSession();
    return checkPlacement(session.database,input,movingNodeUuid,
      this.rootTransferOptions(session,movingNodeUuid,input.parentUuid));
  }

  checkPackedChild(input:ProjectPackedChildInput):ProjectPlacementCheck {
    return checkPackedChild(this.requireSession().database,input);
  }

  placementTargets(request:ProjectPlacementTargetRequest,
    options?:Pick<PlacementOptions,"preserveExistingPositions"|"additionalUnit">):ProjectPlacementTargets {
    const session=this.requireSession();
    // A pooled support (Pannello) is offered only where the catalogue guard would accept the write.
    if(request.itemUuid!==undefined&&request.nodeUuid===undefined){
      const kind=session.database.prepare("SELECT model_kind AS kind FROM prj_item WHERE uuid=?")
        .get(request.itemUuid) as {kind:string}|undefined;
      if(kind?.kind==="support"){
        const guarded=this.structuralPlacementGuard(session,request.itemUuid,request.parentUuid);
        if(!guarded.ok)return {targets:[],diagnostics:[{code:guarded.code,message:guarded.message}]};
      }
    }
    const transfer=this.rootTransferOptions(session,request.nodeUuid,request.parentUuid);
    return placementTargets(session.database,request,options?{...transfer,...options}:transfer);
  }

  private applyFirstPlacement(session:Session,subject:ProjectPlacementSubject,
    acceptsParent?:(uuid:string)=>boolean):NonNullable<ProjectDocumentView["autoPlacement"]> {
    const nodes=readPhysicalNodes(session.database);
    const moving=subject.nodeUuid?findPhysicalNode(nodes,subject.nodeUuid):undefined;
    const itemUuid=subject.itemUuid??moving?.itemUuid;
    const kind=moving?.nodeKind??(session.database.prepare("SELECT model_kind AS kind FROM prj_item WHERE uuid=?")
      .get(itemUuid??null) as {kind:string}|undefined)?.kind;
    if(!itemUuid||(kind!=="support"&&kind!=="device"))return "unplaced";
    const roots=frontOrder(nodes);
    const targets=(parentUuid:string)=>acceptsParent&&!acceptsParent(parentUuid)?[]:
      this.placementTargets({...subject,parentUuid},{preserveExistingPositions:true}).targets;
    let target=firstPlacement(kind==="support"?roots:panelsInPlacementOrder(roots),kind,targets,moving);
    if(!target&&kind==="device"){
      const direct=directDeviceParents(session.database,itemUuid);
      target=firstPlacement(roots.filter(root=>direct.has(root.uuid)),kind,targets,moving);
    }
    if(!target)return "unplaced";
    const {input}=target;
    if(target.action==="placeChild")placeChild(session.database,target.input);
    else if(target.action==="moveNode"&&moving){
      const {startUnits,slotNo}=target.input;
      if(input.parentUuid===moving.parentUuid&&input.zoneNo===moving.zoneNo&&input.viewCode===moving.viewCode&&
        (startUnits??null)===moving.startUnits&&(slotNo??null)===moving.slotNo)return "unchanged";
      moveNode(session.database,target.nodeUuid,target.input,this.rootTransferOptions(session,target.nodeUuid,input.parentUuid));
    }else return "unplaced";
    return "placed";
  }

  autoPlaceItem(subject:ProjectPlacementSubject):ProjectDocumentView {
    const session=this.requireSession();
    let autoPlacement:ProjectDocumentView["autoPlacement"];
    this.recordAction(session,subject.nodeUuid?HISTORY_LABELS.move:HISTORY_LABELS.place,()=>{
      autoPlacement=this.applyFirstPlacement(session,subject);
      return autoPlacement==="placed";
    });
    return {...this.viewForSession(session),autoPlacement};
  }

  private duplicatePlacement(session:Session,nodeUuid:string):{lineUuid:string;quantity:number;input:ProjectPlacementInput}|undefined {
    const nodes=readPhysicalNodes(session.database);
    const source=findPhysicalNode(nodes,nodeUuid);
    if(!source?.itemUuid||!source.parentUuid||source.yMm===null||source.zoneNo===null||
      (source.nodeKind!=="support"&&source.nodeKind!=="device"))return;
    const parent=findPhysicalNode(nodes,source.parentUuid);
    if(!parent||parent.yMm===null)return;
    const root=parent.nodeKind==="enclosure"?parent:nodes.find(node=>node.uuid===parent.parentUuid);
    if(root?.nodeKind!=="enclosure")return;
    const line=session.database.prepare(`SELECT l.uuid,l.quantity,i.config_status AS status
      FROM prj_line l JOIN prj_item i ON i.id=l.item_id WHERE i.uuid=? AND l.line_type='item'`)
      .get(source.itemUuid) as {uuid:string;quantity:number;status:string}|undefined;
    if(!line||line.quantity>=9_999||!configuredItemCanBeDuplicated(line.status))return;
    const itemUuid=source.itemUuid;
    const sourceY=source.yMm, sourceZone=source.zoneNo;
    const sourcePosition=source.startUnits??source.slotNo??0;
    const kind=source.nodeKind;
    if(kind==="device"&&parent.nodeKind==="enclosure"&&!directDeviceParents(session.database,itemUuid).has(parent.uuid))return;
    const parents=kind==="device"&&parent.nodeKind==="support"
      ? [parent,...panelsInPlacementOrder([root]).filter(panel=>panel.yMm!>parent.yMm!)]
      : [parent];
    const target=firstPlacement(parents,kind,parentUuid=>this.placementTargets({itemUuid,parentUuid},
      {preserveExistingPositions:true,additionalUnit:true}).targets.filter(target=>{
      if(target.action!=="placeChild")return false;
      if(kind==="support")return target.subject.yMm>sourceY;
      if(parentUuid!==parent.uuid)return true;
      const {zoneNo,startUnits,slotNo}=target.input;
      return zoneNo!==undefined&&(zoneNo>sourceZone||
        zoneNo===sourceZone&&(startUnits??slotNo??0)>sourcePosition);
    }));
    return target?.action==="placeChild"?{lineUuid:line.uuid,quantity:line.quantity+1,input:target.input}:undefined;
  }

  canDuplicatePlacedItem(nodeUuid:string):boolean {
    return this.duplicatePlacement(this.requireSession(),nodeUuid)!==undefined;
  }

  duplicatePlacedItem(nodeUuid:string):ProjectDocumentView {
    return this.action(HISTORY_LABELS.duplicate,session=>{
      const placement=this.duplicatePlacement(session,nodeUuid);
      if(!placement)throw new Error("Nessuna posizione compatibile disponibile per la copia.");
      this.writeLineQuantity(session,placement.lineUuid,placement.quantity);
      placeChild(session.database,placement.input);
    });
  }

  private checkEnclosureRow(db:Database.Database,brand:string,modelCode:string):void {
    // Standalone document services can omit catalogue-backed placement rules.
    if(!this.#options.engineeringCatalogue)return;
    const others=db.prepare(`SELECT DISTINCT i.model_brand_marchio AS brand,i.model_code AS code,i.model_name AS name
      FROM prj_node n JOIN prj_item i ON i.id=n.item_id
      WHERE n.parent_id IS NULL AND n.node_kind='enclosure'
        AND (i.model_brand_marchio<>? OR i.model_code<>?)`)
      .all(brand,modelCode) as {brand:string;code:string;name:string}[];
    if(!others.length)return;
    const catalogue=this.#options.engineeringCatalogue();
    const gamma=catalogue?enclosureGamma(catalogue,brand,modelCode):undefined;
    for(const other of others){
      const existing=catalogue?enclosureGamma(catalogue,other.brand,other.code):undefined;
      if(brand===other.brand&&gamma&&existing?.code===gamma.code)continue;
      const message=gamma&&existing
        ?`Puoi affiancare solo carpenterie della stessa gamma. ${gamma.name} non può essere affiancata a ${existing.name}.`
        :`Puoi affiancare solo carpenterie della stessa gamma. Impossibile verificare la gamma comune con ${other.name}.`;
      throw new PlacementError("enclosure_gamma_mismatch",message);
    }
  }

  placeRoot(input:ProjectPlacementInput):ProjectDocumentView {
    return this.action(HISTORY_LABELS.place,session=>{
      const item=session.database.prepare(`SELECT model_brand_marchio AS brand,model_code AS code FROM prj_item
        WHERE uuid=? AND model_kind='enclosure'`).get(input.itemUuid) as {brand:string;code:string}|undefined;
      if(item)this.checkEnclosureRow(session.database,item.brand,item.code);
      placeRoot(session.database,input);
    });
  }

  placeChild(input:ProjectPlacementInput):ProjectDocumentView {
    return this.action(HISTORY_LABELS.place,session=>{placeChild(session.database,input);});
  }

  moveNode(nodeUuid:string,input:ProjectPlacementInput):ProjectDocumentView {
    return this.action(HISTORY_LABELS.move,session=>{
      moveNode(session.database,nodeUuid,input,this.rootTransferOptions(session,nodeUuid,input.parentUuid));});
  }

  unplaceNode(nodeUuid:string):ProjectDocumentView {
    return this.action(HISTORY_LABELS.unplace,session=>{unplaceNode(session.database,nodeUuid);});
  }

  /**
   * Removes a whole Carpenteria (physical root) in one transaction. Its own unit leaves the
   * project (one unit off its line; the line goes at zero). `keep-contents` returns every
   * Pannello and Apparecchio below it to the unplaced pool (Q unchanged, P lower);
   * `remove-contents` also takes those placed units out of the project, leaving units of the
   * same items that are placed elsewhere or unplaced untouched.
   */
  removePhysicalRoot(nodeUuid:string,contents:ProjectRootRemoval):ProjectDocumentView {
    return this.action(HISTORY_LABELS.removeRoot,session=>{removePhysicalRoot(session.database,nodeUuid,contents);});
  }

  /** Unplaces a Pannello (any non-root node) with everything placed in it; quantities are unchanged. */
  unplaceSubtree(nodeUuid:string):ProjectDocumentView {
    return this.action(HISTORY_LABELS.unplace,session=>{unplaceSubtree(session.database,nodeUuid);});
  }

  insertPackedChild(input:ProjectPackedChildInput,index?:number):ProjectDocumentView {
    return this.action(HISTORY_LABELS.place,session=>{insertPackedChild(session.database,input,index);});
  }

  reorderPackedNode(nodeUuid:string,index:number):ProjectDocumentView {
    return this.action(HISTORY_LABELS.move,session=>{reorderPackedNode(session.database,nodeUuid,index);});
  }

  movePackedNode(nodeUuid:string,input:ProjectPackedMoveInput):ProjectDocumentView {
    return this.action(HISTORY_LABELS.move,session=>{
      movePackedNode(session.database,nodeUuid,input,this.rootTransferOptions(session,nodeUuid,input.parentUuid));});
  }

  addAnnotation(input:ProjectAnnotationInput):ProjectDocumentView {
    return this.action(HISTORY_LABELS.addText,session=>{addAnnotation(session.database,input);});
  }

  updateAnnotation(uuid:string,patch:ProjectAnnotationPatch):ProjectDocumentView {
    return this.action(HISTORY_LABELS.editText,session=>{updateAnnotation(session.database,uuid,patch);});
  }

  removeAnnotation(uuid:string):ProjectDocumentView {
    return this.action(HISTORY_LABELS.removeText,session=>{removeAnnotation(session.database,uuid);});
  }

  removePackedNode(nodeUuid:string):ProjectDocumentView {
    return this.action(HISTORY_LABELS.unplace,session=>{removePackedNode(session.database,nodeUuid);});
  }

  /**
   * Inserisci falsi poli DIN (generic capacity fill). Every free run of the capacity kind on every placed
   * Pannello is closed exactly with the fewest filler pieces the catalogue designates for that kind,
   * largest first. Existing occupants (fillers included) are never moved or merged, so a second run
   * finds nothing to do. Each Pannello is checked with the same catalogue design guard as an added
   * Apparecchio; refused or unverifiable zones are skipped and reported. Pieces of one width join one
   * configured item (identical snapshots merge), raised by the number of placed pieces. The whole fill is
   * one transaction and one undoable action; a fill with nothing to place changes nothing.
   */
  fillCapacity(request:ProjectFillRequest):ProjectDocumentView {
    const session=this.requireSession();
    const guard=this.#options.designGuard,fillers=this.#options.capacityFillers;
    if(!guard||!fillers)throw new Error("Catalogo non disponibile: impossibile inserire i falsi poli.");
    const configurations=fillers(request.capacityKind);
    if(!configurations.length)throw new Error("Il catalogo non contiene falsi poli per questo tipo di guida.");
    const skipped:ProjectFillSkip[]=[];
    const accepted=new Map<string,{amounts:number[];refusal:string|null}>();
    const placements:Array<{supportUuid:string;zoneNo:number;viewCode:string;piece:FillPiece}>=[];
    const zones=surveyFillZones(session.database,request.capacityKind);
    for(const zone of zones){
      const skip=(code:string,message:string)=>skipped.push({supportUuid:zone.supportUuid,zoneNo:zone.zoneNo,code,message});
      if(zone.issue){skip(zone.issue.code,zone.issue.message);continue;}
      const viewCode=zone.requiredViewCode??"front";
      const key=`${zone.supportItemId}:${zone.rootItemId}:${viewCode}`;
      let eligible=accepted.get(key);
      if(!eligible){
        const amounts:number[]=[];let refusal:string|null=null;
        for(const {amount,result} of configurations){
          if(!result.physical?.views.some(view=>view.code===viewCode)){refusal??="no_view_for_orientation";continue;}
          const verdict=guard(session.database,{kind:"device",modelId:result.model.id,parentUuid:zone.supportUuid},
            {modelId:result.model.id,selectedOptionIds:[...result.selectedOptionIds]});
          if(verdict.ok)amounts.push(amount);else refusal??=verdict.code;
        }
        eligible={amounts,refusal};accepted.set(key,eligible);
      }
      if(!eligible.amounts.length){skip(eligible.refusal??"filler_not_compatible",fillRefusalMessage(eligible.refusal));continue;}
      for(const run of freeRuns(zone.capacity,zone.occupied)){
        const pieces=planRun(run,eligible.amounts);
        if(!pieces){skip("gap_not_representable",`Uno spazio libero di ${run.length} unità non è riempibile esattamente.`);continue;}
        for(const piece of pieces)placements.push({supportUuid:zone.supportUuid,zoneNo:zone.zoneNo,viewCode,piece});
      }
    }
    const report:ProjectFillReport={inserted:placements.length,
      supports:new Set(placements.map(row=>row.supportUuid)).size,
      examined:new Set(zones.map(zone=>zone.supportUuid)).size,skipped};
    if(!placements.length)return {...this.viewForSession(session),fillReport:report};
    const byAmount=new Map(configurations.map(row=>[row.amount,row.result]));
    const takenAt=this.now().toISOString();
    this.recordAction(session,HISTORY_LABELS.fillers,()=>{
      const itemUuids=new Map<number,string>();
      for(const amount of new Set(placements.map(row=>row.piece.amount)))
        itemUuids.set(amount,insertConfiguredItem(session.database,byAmount.get(amount)!,this.#options.resolveCatalogueProduct,
          takenAt,placements.filter(row=>row.piece.amount===amount).length));
      for(const row of placements)placeChild(session.database,{itemUuid:itemUuids.get(row.piece.amount)!,
        parentUuid:row.supportUuid,zoneNo:row.zoneNo,startUnits:row.piece.start,viewCode:row.viewCode});
    });
    return {...this.viewForSession(session),fillReport:report};
  }

  /** Annulla: restores the document as it was before the most recent undoable action. */
  undo(expectedToken?:string):ProjectDocumentView {
    const session=this.requireSession();
    if(expectedToken!==undefined&&expectedToken!==currentUndoToken(session))
      throw new Error("L’aggiunta non è più disponibile per l’annullamento.");
    const entry=session.history.peekUndo();
    if(!entry)throw new Error("Nessuna operazione da annullare.");
    const current={label:entry.label,image:captureDocument(session.database),stateId:session.stateId};
    this.applyHistoryEntry(session,entry,()=>session.history.undone(current));
    return this.viewForSession(session);
  }

  /** Ripeti: reapplies the most recently undone action, exactly as it was. */
  redo():ProjectDocumentView {
    const session=this.requireSession();
    const entry=session.history.peekRedo();
    if(!entry)throw new Error("Nessuna operazione da ripetere.");
    const current={label:entry.label,image:captureDocument(session.database),stateId:session.stateId};
    this.applyHistoryEntry(session,entry,()=>session.history.redone(current));
    return this.viewForSession(session);
  }

  private action(label:string,run:(session:Session)=>boolean|void):ProjectDocumentView {
    const session=this.requireSession();
    this.recordAction(session,label,()=>run(session));
    return this.viewForSession(session);
  }

  private writeLineQuantity(session:Session,lineUuid:string,quantity:number):void {
    const line = session.database.prepare(`SELECT l.id,l.item_id AS itemId,l.line_type AS lineType,
      s.list_price_unit_e4 AS price,l.sale_price_unit_e4 AS salePrice FROM prj_line l
      LEFT JOIN prj_product_snapshot s ON s.id = l.snapshot_id WHERE l.uuid = ?`)
      .get(lineUuid) as { id: number; itemId: number | null; lineType: string;
        price: number | null; salePrice: number | null } | undefined;
    if (!line) throw new Error("Riga del preventivo non trovata.");
    if (line.lineType === "item") {
      const placed = session.database.prepare("SELECT COUNT(*) FROM prj_node WHERE item_id=?")
        .pluck().get(line.itemId) as number;
      if (quantity < placed) throw new Error(`La quantità non può essere inferiore alle ${placed} unità posizionate.`);
    } else if (line.lineType !== "product") throw new Error("La quantità di questa riga non è modificabile.");
    session.database.prepare("UPDATE prj_line SET quantity = ?, line_total_e4 = ? WHERE id = ?")
      .run(quantity, safeIntegerPriceTimesQuantity(line.lineType === "item" ? line.salePrice : line.price, quantity), line.id);
  }

  setQuantity(lineUuid: string, quantity: number): ProjectDocumentView {
    if (!isUuid(lineUuid) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 9_999) {
      throw new Error("Quantità non valida.");
    }
    const session = this.requireSession();
    this.writeLineQuantity(session,lineUuid,quantity);
    this.markDirty(session);
    return this.current()!;
  }

  setLineDiscount(lineUuid:string,discountBp:number):ProjectDocumentView {
    if (!isUuid(lineUuid)) throw new Error("Riga del preventivo non valida.");
    validateDiscountBp(discountBp);
    const session=this.requireSession();
    const result=session.database.prepare("UPDATE prj_line SET line_discount_bp=? WHERE uuid=? AND line_type='product'")
      .run(discountBp,lineUuid);
    if (!result.changes) throw new Error("Riga commerciale non trovata.");
    this.markDirty(session);return this.viewForSession(session);
  }

  setComponentDiscount(itemUuid:string,seq:number,discountBp:number):ProjectDocumentView {
    if (!isUuid(itemUuid) || !Number.isSafeInteger(seq) || seq<0) throw new Error("Componente non valido.");
    validateDiscountBp(discountBp);
    const session=this.requireSession();
    const result=session.database.prepare(`UPDATE prj_item_bom SET line_discount_bp=?
      WHERE seq=? AND item_id=(SELECT id FROM prj_item WHERE uuid=? AND commercial_contribution='articles')`)
      .run(discountBp,seq,itemUuid);
    if (!result.changes) throw new Error("Componente commerciale non trovato.");
    this.markDirty(session);return this.viewForSession(session);
  }

  setGlobalDiscount(discountBp:number):ProjectDocumentView {
    validateDiscountBp(discountBp);
    const session=this.requireSession();
    session.database.prepare("UPDATE prj_project SET global_discount_bp=? WHERE id=1").run(discountBp);
    this.markDirty(session);return this.viewForSession(session);
  }

  setLabourTotal(amountE4:number):ProjectDocumentView {
    validateLabourE4(amountE4);
    const session=this.requireSession();
    session.database.prepare("UPDATE prj_project SET labour_total_e4=? WHERE id=1").run(amountE4);
    this.markDirty(session);return this.viewForSession(session);
  }

  removeLine(lineUuid: string): ProjectDocumentView {
    if (!isUuid(lineUuid)) throw new Error("Riga del preventivo non valida.");
    const session = this.requireSession();
    session.database.transaction(() => deleteQuotationLine(session.database, lineUuid))();
    this.markDirty(session);
    return this.current()!;
  }

  removeLines(lineUuids: readonly string[]): ProjectDocumentView {
    if (lineUuids.length === 0 || lineUuids.length > 10_000 || lineUuids.some(uuid => !isUuid(uuid)) ||
        new Set(lineUuids).size !== lineUuids.length) throw new Error("Righe del preventivo non valide.");
    const session = this.requireSession();
    session.database.transaction(() => {
      for (const uuid of lineUuids) deleteQuotationLine(session.database, uuid);
    })();
    this.markDirty(session);
    return this.current()!;
  }

  async save(overwriteConflict = false): Promise<ProjectDocumentView> {
    const session = this.requireSession();
    if (!session.targetPath) {
      throw new ProjectSaveError("save-as-required", "Il progetto recuperato deve essere salvato con un nuovo nome.");
    }
    await this.saveSession(session, session.targetPath, session.baseline, overwriteConflict);
    return this.viewForSession(session);
  }

  async saveAs(destinationPath: string, overwriteConflict = false): Promise<ProjectDocumentView> {
    const session = this.requireSession();
    const resolved = path.resolve(destinationPath);
    if (path.extname(resolved).toLowerCase() !== ".lqp") throw new Error("Il progetto deve essere salvato con estensione .lqp.");
    this.cancelPendingSave();
    const baseline = session.targetPath === resolved ? session.baseline : null;
    await this.saveSession(session, resolved, baseline, overwriteConflict);
    return this.viewForSession(session);
  }

  async retryPendingSave(): Promise<ProjectDocumentView> {
    const session = this.requireSession();
    const pending = session.pendingSave;
    if (!pending) return this.save();
    fsyncFile(pending.tempPath);
    if (this.validateIncoming(pending.tempPath).projectUuid !== meta(session.database, "project_uuid")) {
      throw new ProjectSaveError("failed", "La versione temporanea non appartiene al progetto corrente.");
    }
    try {
      await this.replaceTargetWithRetry(pending);
    } catch (error) {
      if (error instanceof ProjectSaveError) throw error;
      throw new ProjectSaveError("replace-failed", "Non è stato possibile sostituire il file di destinazione in modo atomico.", error);
    }
    this.commitSuccessfulSave(session, pending);
    return this.viewForSession(session);
  }

  cancelPendingSave(): void {
    const session = this.#session;
    if (!session?.pendingSave) return;
    removeDatabaseFiles(session.pendingSave.tempPath);
    session.pendingSave = null;
  }

  private async saveSession(
    session: Session,
    targetPath: string,
    baseline: Baseline | null,
    overwriteConflict = false,
  ): Promise<void> {
    this.cancelPendingSave();
    let targetShaBeforeSave: string | null = null;
    if (existsSync(targetPath)) {
      const current = fileBaseline(targetPath);
      if (baseline && current.sha256 !== baseline.sha256 && !overwriteConflict) {
        throw new ProjectSaveError("conflict", "Il file è stato modificato da un altro programma o utente.");
      }
      targetShaBeforeSave = current.sha256;
    }
    if (["-wal", "-shm", "-journal"].some((suffix) => existsSync(`${targetPath}${suffix}`))) {
      throw new ProjectSaveError("failed", "La destinazione contiene file SQLite laterali e non può essere sostituita in sicurezza.");
    }
    mkdirSync(path.dirname(targetPath), { recursive: true });
    this.cleanupStaleSaveTemps(targetPath);
    const tempPath = path.join(path.dirname(targetPath), `.~${path.basename(targetPath)}.${randomUUID()}.lqp.tmp`);
    const revision = Number(meta(session.database, "revision")) + 1;
    const savedAt = this.now().toISOString();
    const changeVersion = session.changeVersion;
    const stateId = session.stateId;
    let keepTemp = false;
    try {
      if (this.#options.backupDatabase) {
        await this.#options.backupDatabase(session.database, tempPath);
      } else {
        await session.database.backup(tempPath);
      }
      const saved = new Database(tempPath);
      try {
        setMeta(saved, "revision", String(revision));
        setMeta(saved, "saved_at", savedAt);
        setMeta(saved, "app_version_saved", this.#options.appVersion);
        saved.pragma("journal_mode = DELETE");
        saved.exec("VACUUM");
        assertIntegrityCheck(saved);
      } finally { saved.close(); }
      fsyncFile(tempPath);
      if (this.validateIncoming(tempPath).projectUuid !== meta(session.database, "project_uuid")) {
        throw new Error("La versione temporanea non appartiene al progetto corrente.");
      }
      this.assertTargetUnchanged(targetPath, targetShaBeforeSave);
      if (targetShaBeforeSave !== null) {
        this.preservePreviousVersion(targetPath, meta(session.database, "project_uuid"), targetShaBeforeSave);
      }
      const prepared = { tempPath, targetPath, targetShaBeforeSave, revision, savedAt, changeVersion, stateId };
      try {
        await this.replaceTargetWithRetry(prepared);
      } catch (error) {
        if (error instanceof ProjectSaveError) throw error;
        keepTemp = true;
        session.pendingSave = prepared;
        throw new ProjectSaveError("replace-failed", "Non è stato possibile sostituire il file di destinazione in modo atomico.", error);
      }
      this.commitSuccessfulSave(session, prepared);
    } catch (error) {
      if (error instanceof ProjectSaveError) throw error;
      throw new ProjectSaveError("failed", error instanceof Error ? error.message : "Salvataggio non riuscito.", error);
    } finally {
      if (!keepTemp) removeDatabaseFiles(tempPath);
    }
  }

  private assertTargetUnchanged(targetPath: string, expectedSha256: string | null): void {
    const exists = existsSync(targetPath);
    if (exists !== (expectedSha256 !== null) || (exists && sha256File(targetPath) !== expectedSha256)) {
      throw new ProjectSaveError("conflict", "Il file è stato modificato da un altro programma o utente.");
    }
  }

  private commitSuccessfulSave(session: Session, prepared: PreparedSave): void {
    fsyncDirectory(path.dirname(prepared.targetPath));
    setMeta(session.database, "revision", String(prepared.revision));
    setMeta(session.database, "saved_at", prepared.savedAt);
    setMeta(session.database, "app_version_saved", this.#options.appVersion);
    session.database.pragma("wal_checkpoint(TRUNCATE)");
    session.targetPath = prepared.targetPath;
    session.documentName = path.basename(prepared.targetPath);
    session.baseline = fileBaseline(prepared.targetPath);
    session.pendingSave = null;
    // The file now holds the content the save captured; later edits (or an undo/redo back to it) decide dirty.
    session.savedStateId = prepared.stateId;
    session.dirty = session.stateId !== session.savedStateId;
    const recoveryPath = recoveryMetadataPath(session.workingPath);
    if (session.dirty) this.writeRecoveryMetadata(session);
    else if (existsSync(recoveryPath)) this.tryRemoveFile(recoveryPath);
    this.notifyDocumentStored(session);
  }

  private notifyDocumentStored(session: Session): void {
    const listener = this.#options.onDocumentStored;
    if (!listener || !session.targetPath) return;
    try {
      const row = session.database.prepare("SELECT title FROM prj_project WHERE id = 1").get() as { title: string } | undefined;
      listener({ path: session.targetPath, projectUuid: meta(session.database, "project_uuid"), title: row?.title ?? session.documentName });
    } catch (error) {
      console.error("Failed to record the recent project", error);
    }
  }

  private async replaceTargetWithRetry({ tempPath, targetPath, targetShaBeforeSave }: PreparedSave): Promise<void> {
    const replaceFile = this.#options.replaceFile ?? renameSync;
    const wait = this.#options.waitForRenameRetry ??
      ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    for (let attempt = 0; ; attempt += 1) {
      this.assertTargetUnchanged(targetPath, targetShaBeforeSave);
      if (["-wal", "-shm", "-journal"].some(suffix => existsSync(targetPath + suffix))) {
        throw new ProjectSaveError("conflict", "Il file progetto è in uso da un altro programma.");
      }
      try {
        replaceFile(tempPath, targetPath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const delay = RENAME_RETRY_DELAYS_MS[attempt];
        if (typeof code !== "string" || !TRANSIENT_RENAME_ERROR_CODES.has(code) || delay === undefined) {
          throw error;
        }
        await wait(delay);
      }
    }
  }

  close(): void {
    if (!this.#session) return;
    this.disposeSession(this.#session, false);
    this.#session = null;
  }

  closeCurrent(): void {
    if (!this.#session) return;
    if (this.#session.dirty) throw new Error("Il progetto contiene modifiche non salvate.");
    this.disposeSession(this.#session, false);
    this.#session = null;
  }

  discardCurrent(): void {
    if (!this.#session) return;
    this.disposeSession(this.#session, true);
    this.#session = null;
  }

  assertReplacementAllowed(): void {
    if (this.#session?.dirty) throw new Error("Salva o scarta le modifiche del progetto corrente prima di continuare.");
  }

  recoveries(): readonly ProjectRecoveryView[] {
    return [...this.#recoveries.values()].map(({ id, documentName, preservedAt }) => ({ id, documentName, preservedAt }));
  }

  openRecovery(id: string): ProjectDocumentView {
    const recovery = this.#recoveries.get(id);
    if (!recovery) throw new Error("Il recupero selezionato non è più disponibile.");
    const expectedCurrent = this.#session;
    this.assertReplacementAllowed();
    if (!existsSync(recovery.workingPath)) throw new Error("La copia di recupero non è più disponibile.");
    let database: Database.Database | undefined;
    let adopted = false;
    try {
      if (!this.isRegularFile(recovery.workingPath)) throw new Error("La copia di recupero non è un file regolare.");
      this.validateIncoming(recovery.workingPath, { allowUnsavedWorkingCopy: true });
      if (!this.isRegularFile(recovery.workingPath)) throw new Error("La copia di recupero non è un file regolare.");
      database = openCurrentProjectDatabase(recovery.workingPath, this.#options.migrationsFolder);
      if (database.pragma("application_id", { simple: true }) !== LQP_APPLICATION_ID) {
        throw new Error("La copia di recupero non è un progetto LibreQuadri.");
      }
      setMeta(database, "format_version", String(projectFormatVersion(this.#options.migrationsFolder)));
      database.pragma("wal_checkpoint(TRUNCATE)");
      assertIntegrityCheck(database);
      this.validateIncoming(recovery.workingPath, { allowUnsavedWorkingCopy: true });
      const candidate: Session = {
        workingPath: recovery.workingPath,
        database,
        targetPath: null,
        documentName: recovery.documentName,
        baseline: null,
        dirty: true,
        changeVersion: 0,
        pendingSave: null,
        ...freshHistory(null),
      };
      this.writeRecoveryMetadata(candidate);
      this.replaceCurrentSession(candidate, expectedCurrent);
      adopted = true;
      this.#recoveries.delete(id);
      return this.viewForSession(candidate);
    } catch (error) {
      if (!adopted) database?.close();
      throw error;
    }
  }

  discardRecovery(id: string): void {
    const recovery = this.#recoveries.get(id);
    if (!recovery) return;
    removeDatabaseFiles(recovery.workingPath);
    if (existsSync(recovery.metadataPath)) unlinkSync(recovery.metadataPath);
    this.#recoveries.delete(id);
  }

  private validateIncoming(filename: string, options: IncomingValidationOptions = {}): ValidatedIncoming {
    if (statSync(filename).size > MAX_PROJECT_BYTES) throw new Error("Il file progetto supera il limite di 200 MB.");
    const header = readFileSync(filename).subarray(0, 16).toString("binary");
    if (header !== "SQLite format 3\u0000") throw new Error("Il file selezionato non è un database SQLite valido.");
    const database = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      if (database.pragma("application_id", { simple: true }) !== LQP_APPLICATION_ID) throw new Error("Il file non è un progetto LibreQuadri.");
      assertIntegrityCheck(database);

      // Classify schema objects before querying any application-controlled table/view.
      const objects = database.prepare("SELECT type, name, tbl_name AS tableName, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_autoindex_%'").all() as { type: string; name: string; tableName: string; sql: string | null }[];
      for (const object of objects) {
        if (object.type === "view" || object.type === "trigger" || object.sql?.toUpperCase().startsWith("CREATE VIRTUAL TABLE")) throw new Error("Il progetto contiene oggetti SQLite non consentiti.");
        if (!["table", "index"].includes(object.type)) throw new Error(`Oggetto SQLite non consentito: ${object.name}.`);
      }

      const drizzleObject = objects.find((object) => object.name.toLowerCase() === "__drizzle_migrations");
      if (!drizzleObject || drizzleObject.type !== "table") throw new Error("La cronologia migrazioni del progetto non è una tabella valida.");
      const drizzleColumns = database.pragma("table_xinfo('__drizzle_migrations')") as { name: string }[];
      if (drizzleColumns.map((column) => column.name.toLowerCase()).join("\0") !== "id\0hash\0created_at") {
        throw new Error("La tabella __drizzle_migrations non ha le colonne previste.");
      }

      const bundled = readMigrationFiles({ migrationsFolder: this.#options.migrationsFolder });
      const applied = database.prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY id ASC").all() as { hash: unknown; created_at: unknown }[];
      const comparableCount = Math.min(applied.length, bundled.length);
      for (let index = 0; index < comparableCount; index += 1) {
        if (!migrationRowMatches(applied[index]!, bundled[index]!)) throw new Error(`Cronologia migrazioni incompatibile alla posizione ${index + 1}.`);
      }
      if (applied.length > bundled.length) throw new Error("Questo progetto è stato creato con una versione più recente di LibreQuadri.");

      const formatVersion = applied.length;
      const manifest = this.schemaManifest().versions[String(formatVersion)];
      if (!manifest) throw new Error(`Manifest dello schema progetto ${formatVersion} non disponibile.`);
      const allowed = new Set([...Object.keys(manifest.tables), "__drizzle_migrations"]);
      for (const object of objects) {
        if (object.type === "table" && !allowed.has(object.name) && !["sqlite_stat1", "sqlite_stat4"].includes(object.name)) throw new Error(`Tabella progetto sconosciuta: ${object.name}.`);
        if (object.type === "index" && !Object.hasOwn(manifest.indexes, object.name)) throw new Error(`Indice progetto sconosciuto: ${object.name}.`);
      }
      for (const [table, expected] of Object.entries(manifest.tables)) {
        const object = objects.find((candidate) => candidate.name.toLowerCase() === table.toLowerCase());
        if (!object || object.type !== "table") throw new Error(`Tabella progetto mancante o incompatibile: ${table}.`);
        const columns = database.pragma(`table_xinfo('${table}')`) as { name: string; type: string; notnull: number; pk: number }[];
        const actual = columns.map((column) => [column.name, column.type.toUpperCase(), column.notnull, column.pk]);
        if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Schema incompatibile per ${table}.`);
      }
      for (const [name, expected] of Object.entries(manifest.indexes)) {
        const row = objects.find((object) => object.type === "index" && object.name === name);
        if (!row || row.tableName !== expected[0]) throw new Error(`Indice progetto mancante o incompatibile: ${name}.`);
        const listed = (database.pragma(`index_list('${expected[0]}')`) as { name: string; unique: number }[]).find((index) => index.name === name);
        const columns = (database.pragma(`index_xinfo('${name}')`) as { name: string | null; key: number }[])
          .filter((column) => column.key === 1).map((column) => column.name);
        if (!listed || listed.unique !== expected[1] || columns.join("\0") !== expected[2].join("\0")) throw new Error(`Indice progetto incompatibile: ${name}.`);
      }

      // Application data is queried only after its objects match manifest(k).
      for (const key of REQUIRED_META_KEYS) meta(database, key);
      const declaredFormat = meta(database, "format_version");
      if (!/^\d+$/.test(declaredFormat) || Number(declaredFormat) !== formatVersion) throw new Error("La versione dichiarata del progetto non corrisponde allo schema.");
      const revision = meta(database, "revision");
      if (!/^\d+$/.test(revision) || !Number.isSafeInteger(Number(revision))) throw new Error("Revisione progetto non valida.");
      if (!/^[01]$/.test(meta(database, "contains_costs"))) throw new Error("Valore contains_costs non valido.");
      if (!isIsoTimestamp(meta(database, "created_at"))) throw new Error("Timestamp created_at non valido.");
      const savedAt = meta(database, "saved_at");
      const unsavedWorkingCopy = options.allowUnsavedWorkingCopy && revision === "0" && savedAt === "";
      if (!unsavedWorkingCopy && !isIsoTimestamp(savedAt)) throw new Error("Timestamp saved_at non valido.");
      const projectUuid = meta(database, "project_uuid");
      if (!isUuid(projectUuid)) throw new Error("UUID tecnico del progetto non valido.");
      const singleton = database.prepare("SELECT COUNT(*) AS count, MIN(uuid) AS uuid, MIN(project_date) AS projectDate FROM prj_project").get() as { count: number; uuid: string | null; projectDate: string | null };
      if (singleton.count !== 1) throw new Error("Il progetto deve contenere un solo record principale.");
      if (singleton.uuid !== projectUuid) throw new Error("L'UUID del progetto non corrisponde ai metadati del documento.");
      if (singleton.projectDate === null || !isIsoDate(singleton.projectDate)) throw new Error("Data progetto non valida.");
      if (formatVersion >= 8) {
        const commercial = database.prepare(`SELECT global_discount_bp AS globalDiscountBp,
          labour_total_e4 AS labourTotalE4 FROM prj_project WHERE id=1`).get() as
          {globalDiscountBp:number;labourTotalE4:number};
        validateDiscountBp(commercial.globalDiscountBp);
        validateLabourE4(commercial.labourTotalE4);
        const badLines=database.prepare(`SELECT COUNT(*) FROM prj_line WHERE typeof(line_discount_bp)!='integer'
          OR line_discount_bp<0 OR line_discount_bp>10000`).pluck().get() as number;
        const badComponents=database.prepare(`SELECT COUNT(*) FROM prj_item_bom WHERE
          typeof(line_discount_bp)!='integer' OR line_discount_bp<0 OR line_discount_bp>10000`).pluck().get() as number;
        if (badLines || badComponents) throw new Error("Sconto di riga non valido nel progetto.");
      }
      const violations = database.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) throw new Error("Il progetto contiene riferimenti interni non validi.");
      for (const [table, maximum] of [["prj_product_snapshot", 100_000], ["prj_product_snapshot_attribute", 1_000_000], ["prj_group", 10_000], ["prj_line", 500_000]] as const) {
        const count = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
        if (count.count > maximum) throw new Error(`Il progetto supera il limite di righe per ${table}.`);
      }
      if (formatVersion >= 2) {
        for (const [table, maximum] of [["prj_item", 100_000], ["prj_item_selection", 1_000_000],
          ["prj_item_bom", 1_000_000], ["prj_item_demand", 500_000], ["prj_item_view", 500_000],
          ["prj_item_zone", 500_000], ["prj_item_zone_slot", 1_000_000],
          ["prj_item_constraint", 1_000_000], ["prj_item_exclusion", 1_000_000],
          ["prj_node", 500_000], ["prj_asset", 10_000]] as const) {
          const rowCount = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
          if (rowCount.count > maximum) throw new Error(`Il progetto supera il limite di righe per ${table}.`);
        }
        validateFormat2Data(database,formatVersion);
      }
      if (formatVersion >= 4) {
        const contextRows = database.prepare("SELECT COUNT(*) AS count FROM prj_item_context").get() as { count: number };
        if (contextRows.count > 1_000_000) throw new Error("Il progetto supera il limite di righe per prj_item_context.");
        validateContextData(database);
      }
      if (formatVersion >= 6) validateAnnotationRows(database, formatVersion);
      if (formatVersion >= 10) validateEngineeringProvenance(database);
      if(formatVersion>=11)for(const table of ["prj_item","prj_item_zone"])for(const row of database.prepare(`SELECT mounting_json AS facts FROM ${table} WHERE mounting_json IS NOT NULL`).iterate() as Iterable<{facts:string}>)parseMountingFacts(row.facts);
      return { formatVersion, manifest, projectUuid };
    } finally { database.close(); }
  }

  private copyDocumentRows(
    database: Database.Database,
    incomingPath: string,
    manifest: ProjectSchemaManifest["versions"][string],
  ): void {
    database.prepare("ATTACH DATABASE ? AS src").run(incomingPath);
    try {
      const transaction = database.transaction(() => {
        for (const table of dependencyOrderedTables(database, Object.keys(manifest.tables))) {
          const names = manifest.tables[table]!.map((column) => `"${column[0]}"`).join(", ");
          database.exec(`INSERT INTO main."${table}" (${names}) SELECT ${names} FROM src."${table}"`);
        }
      });
      transaction();
      const violations = database.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) throw new Error("Il progetto contiene riferimenti interni non validi.");
    } finally { database.exec("DETACH DATABASE src"); }
  }

  private preservePreviousVersion(targetPath: string, expectedProjectUuid: string, expectedSha256: string): void {
    const targetIdentity = (() => {
      try {
        const database = new Database(targetPath, { readonly: true, fileMustExist: true });
        try {
          const targetUuid = meta(database, "project_uuid");
          const revision = meta(database, "revision");
          return targetUuid === expectedProjectUuid && /^\d+$/.test(revision)
            ? { directory: targetUuid, filename: `rev${revision}.lqp` }
            : { directory: "_overwritten", filename: path.basename(targetPath) };
        } finally { database.close(); }
      } catch { return { directory: "_overwritten", filename: path.basename(targetPath) }; }
    })();
    const destinationDirectory = path.join(this.#options.backupDirectory, targetIdentity.directory);
    mkdirSync(destinationDirectory, { recursive: true });
    const stamp = this.now().toISOString().replaceAll(":", "-");
    const stem = path.join(destinationDirectory, `${stamp}_${targetIdentity.filename}`);
    let destination = stem;
    for (let suffix = 1; existsSync(destination); suffix += 1) destination = `${stem}.${suffix}`;
    const part = `${destination}.part`;
    try {
      copyFileSync(targetPath, part);
      fsyncFile(part);
      if (sha256File(part) !== expectedSha256 || sha256File(targetPath) !== expectedSha256) {
        throw new Error("Il file è stato modificato da un altro programma o utente.");
      }
      renameSync(part, destination);
      fsyncDirectory(destinationDirectory);
    } finally {
      if (existsSync(part)) unlinkSync(part);
    }
  }

  private cleanupIncomingFiles(): void {
    try {
      for (const entry of readdirSync(this.#options.incomingDirectory, { withFileTypes: true })) {
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        this.tryRemoveFile(path.join(this.#options.incomingDirectory, entry.name));
      }
    } catch {
      // Startup cleanup is best-effort; recovery discovery must still run.
    }
  }

  private discoverRecoveryEntries(): void {
    const suffix = ".recovery.json";
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(this.#options.workingDirectory, { withFileTypes: true });
    } catch {
      return;
    }
    const discoveredWorkingPaths = new Set<string>();
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(suffix)) continue;
      const metadataPath = path.join(this.#options.workingDirectory, entry.name);
      const workingName = entry.name.slice(0, -suffix.length);
      const workingPath = path.join(this.#options.workingDirectory, workingName);
      if (!workingName.endsWith(".lqp")) {
        this.tryRemoveFile(metadataPath);
        continue;
      }
      if (!existsSync(workingPath)) {
        this.tryRemoveFile(metadataPath);
        continue;
      }
      if (!this.isRegularFile(workingPath)) {
        continue;
      }

      let documentName = "Progetto recuperato.lqp";
      let preservedAt: string;
      try { preservedAt = statSync(workingPath).mtime.toISOString(); }
      catch { continue; }
      try {
        const parsed = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<string, unknown>;
        if (parsed.workingFile === workingName && typeof parsed.originalDocumentName === "string") {
          const candidate = path.basename(parsed.originalDocumentName);
          if (candidate === parsed.originalDocumentName && candidate.toLowerCase().endsWith(".lqp")) documentName = candidate;
        }
        if (typeof parsed.preservedAt === "string" && isIsoTimestamp(parsed.preservedAt)) preservedAt = parsed.preservedAt;
      } catch {
        // A malformed sidecar must not cause a potentially recoverable working database to be deleted.
      }
      const id = randomUUID();
      this.#recoveries.set(id, { id, documentName, preservedAt, workingPath, metadataPath });
      discoveredWorkingPaths.add(workingPath);
    }

    // A crash can occur after a SQLite edit commits but before its sidecar is refreshed.
    // Offer orphan working databases with a safe generic name instead of deleting them.
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".lqp")) continue;
      const workingPath = path.join(this.#options.workingDirectory, entry.name);
      if (discoveredWorkingPaths.has(workingPath)) continue;
      let preservedAt: string;
      try { preservedAt = statSync(workingPath).mtime.toISOString(); }
      catch { continue; }
      const id = randomUUID();
      this.#recoveries.set(id, {
        id,
        documentName: "Progetto recuperato.lqp",
        preservedAt,
        workingPath,
        metadataPath: recoveryMetadataPath(workingPath),
      });
    }
  }

  private cleanupStaleSaveTemps(targetPath: string): void {
    const directory = path.dirname(targetPath);
    const prefix = `.~${path.basename(targetPath)}.`;
    const maximumAgeMs = 24 * 60 * 60 * 1_000;
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith(".lqp.tmp")) continue;
        const candidate = path.join(directory, entry.name);
        try {
          if (this.now().valueOf() - statSync(candidate).mtimeMs > maximumAgeMs) this.tryRemoveFile(candidate);
        } catch {
          // Cleanup is best-effort and must never make the actual save fail.
        }
      }
    } catch {
      // Cleanup is best-effort and must never make the actual save fail.
    }
  }

  private isRegularFile(filename: string): boolean {
    try { return lstatSync(filename).isFile(); }
    catch { return false; }
  }

  private tryRemoveFile(filename: string): void {
    try { (this.#options.removeFile ?? unlinkSync)(filename); }
    catch { /* Best-effort cleanup must not prevent startup or saving. */ }
  }

  private now(): Date { return this.#options.now?.() ?? new Date(); }
  private schemaManifest(): ProjectSchemaManifest {
    return JSON.parse(readFileSync(path.join(this.#options.migrationsFolder, "manifest.json"), "utf8")) as ProjectSchemaManifest;
  }
  /**
   * A committed change that is not an undoable action. It clears the undo/redo history: restoring an
   * older image afterwards would silently revert this change too.
   */
  private markDirty(session: Session): void {
    session.history.clear();
    this.advanceState(session);
    this.writeRecoveryMetadata(session);
  }
  private advanceState(session: Session): void {
    session.stateId = session.nextStateId++;
    session.changeVersion += 1;
    session.dirty = session.stateId !== session.savedStateId;
  }
  /** Session bookkeeping as it is now; the returned function puts it back after a failed operation. */
  private checkpoint(session: Session): () => void {
    const { dirty, changeVersion, stateId, nextStateId } = session;
    const restoreHistory = session.history.checkpoint();
    return () => {
      Object.assign(session, { dirty, changeVersion, stateId, nextStateId });
      restoreHistory();
    };
  }
  /**
   * Runs one undoable action. The document image before it is captured first; the action, the history
   * entry and the dirty/recovery bookkeeping commit in one transaction or not at all. An action that
   * reports no change (returns false) writes nothing, records nothing and leaves the document clean.
   */
  private recordAction(session: Session, label: string, action: () => boolean | void): void {
    const before = captureDocument(session.database);
    const restoreBookkeeping = this.checkpoint(session);
    try {
      session.database.transaction(() => {
        if (action() === false) return;
        const beforeStateId = session.stateId;
        this.advanceState(session);
        session.history.record({ label, image: before, stateId: beforeStateId });
        this.writeRecoveryMetadata(session);
      })();
    } catch (error) { restoreBookkeeping(); throw error; }
  }
  /** Restores a history image and its content identity in one transaction; failure changes nothing. */
  private applyHistoryEntry(session: Session, entry: HistoryEntry, move: () => void): void {
    const restoreBookkeeping = this.checkpoint(session);
    try {
      restoreDocument(session.database, entry.image, () => {
        session.stateId = entry.stateId;
        session.changeVersion += 1;
        session.dirty = session.stateId !== session.savedStateId;
        move();
        if (session.dirty) this.writeRecoveryMetadata(session);
      });
    } catch (error) { restoreBookkeeping(); throw error; }
    if (!session.dirty) this.tryRemoveFile(recoveryMetadataPath(session.workingPath));
  }
  private writeRecoveryMetadata(session: Session): void {
    writeFileSync(recoveryMetadataPath(session.workingPath), `${JSON.stringify({
      workingFile: path.basename(session.workingPath),
      originalDocumentName: session.documentName,
      preservedAt: this.now().toISOString(),
    })}\n`, { encoding: "utf8", mode: 0o600 });
  }
  private replaceCurrentSession(replacement: Session, expectedCurrent: Session | null): void {
    if (this.#session !== expectedCurrent || expectedCurrent?.dirty) {
      throw new Error("Il progetto corrente è stato modificato durante la preparazione del nuovo documento. La sostituzione è stata annullata.");
    }
    if (expectedCurrent) this.disposeSession(expectedCurrent, true);
    this.#session = replacement;
  }
  private disposeSession(session: Session, discard: boolean): void {
    if (session.dirty && !discard) this.writeRecoveryMetadata(session);
    closeConfiguredDatabase(session.database);
    if (!session.dirty || discard) {
      if (session.pendingSave) removeDatabaseFiles(session.pendingSave.tempPath);
      removeDatabaseFiles(session.workingPath);
      const recoveryPath = recoveryMetadataPath(session.workingPath);
      if (existsSync(recoveryPath)) unlinkSync(recoveryPath);
    }
  }
  private requireSession(): Session {
    if (!this.#session) throw new Error("Nessun progetto aperto.");
    return this.#session;
  }
}

export function validateProjectMetadata<T extends ProjectMetadataInput>(request: T): T {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Dati progetto non validi.");
  for (const field of ["title", "description", "notes", "executor", "date", "companyName", "companyDescription"] as const) {
    if (typeof request[field] !== "string" || request[field].length > 10_000) throw new Error(`Campo ${field} non valido.`);
  }
  if (request.title.trim() === "") throw new Error("Nome progetto obbligatorio.");
  if (typeof request.projectType !== "string" || !Object.hasOwn(PROJECT_TYPES, request.projectType)) throw new Error("Tipologia progetto non supportata.");
  if (!isIsoDate(request.date)) throw new Error("Data progetto non valida.");
  return { ...request, title: request.title.trim() };
}

export function validateProjectCreation(request: CreateProjectDocumentRequest): CreateProjectDocumentRequest {
  const metadata = validateProjectMetadata(request);
  if (typeof request.destinationPath !== "string" || request.destinationPath.trim() === "") throw new Error("Percorso salvataggio obbligatorio.");
  if (path.extname(request.destinationPath.trim()).toLowerCase() !== ".lqp") throw new Error("Il progetto deve essere salvato con estensione .lqp.");
  return { ...metadata, destinationPath: request.destinationPath.trim() };
}
