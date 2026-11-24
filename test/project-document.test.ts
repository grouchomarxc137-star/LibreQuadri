import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { generateProjectManifest } from "../scripts/project-manifest.js";
import { LQP_APPLICATION_ID, migrateProjectDatabaseToCurrent, openCurrentProjectDatabase,
  openProjectDatabaseAtVersion, projectFormatVersion } from "../src/main/database/project-migrations.js";
import {
  ProjectDocumentService,
  fsyncFileOpenFlag,
  validateProjectCreation,
  type CreateProjectDocumentRequest,
  type ProjectDocumentServiceOptions,
} from "../src/main/project/project-document-service.js";
import { saveProjectWithDialogs, type ProjectFileDialogs } from "../src/main/project/project-ipc.js";
import type { CatalogueProductSnapshotSource } from "../src/shared/project.js";
import { calculateCommercial } from "../src/shared/commercial.js";

const migrationFolder = path.resolve("db/migrations/project");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("migrates format-4 configured items to articles without catalogue access",()=>{
  const root=mkdtempSync(path.join(tmpdir(),"lqp-r19a-migration-"));roots.push(root);
  const db=openProjectDatabaseAtVersion(path.join(root,"old.lqp"),migrationFolder,4);
  try{
    db.exec(`INSERT INTO prj_item(uuid,model_brand_marchio,model_code,model_name,model_kind,
      model_definition_fingerprint,config_fingerprint,config_label,config_status,phys_status,snapshot_taken_at)
      VALUES('old-item','BTI','old-model','Old model','device','old-definition','old-config',
        'Old model','complete','resolved','2026-09-30T00:00:00.000Z')`);
    migrateProjectDatabaseToCurrent(db,migrationFolder);
    expect(db.prepare("SELECT commercial_contribution FROM prj_item").pluck().get()).toBe("articles");
    expect(db.pragma("foreign_key_check")).toEqual([]);
  }finally{db.close()}
});

it("migrates format-7 commercial fields to zero without catalogue access",()=>{
  const root=mkdtempSync(path.join(tmpdir(),"lqp-commercial-migration-"));roots.push(root);
  const db=openProjectDatabaseAtVersion(path.join(root,"old.lqp"),migrationFolder,7);
  try {
    db.exec(`INSERT INTO prj_project(id,uuid,title,project_type,norm_code,project_date)
      VALUES(1,'project','Old','civil','CEI EN 60898','2026-10-02');
      UPDATE prj_project SET global_discount_bp=500;
      INSERT INTO prj_group(id,uuid,name,sort_order) VALUES(1,'group','Main',0);
      INSERT INTO prj_product_snapshot(id,uuid,brand_marchio,brand_name,manufacturer_code,snapshot_taken_at)
      VALUES(1,'snapshot','TEST','Test','A','2026-10-02T00:00:00.000Z');
      INSERT INTO prj_item(id,uuid,model_brand_marchio,model_code,model_name,model_kind,
        model_definition_fingerprint,config_fingerprint,config_label,config_status,phys_status,snapshot_taken_at)
      VALUES(1,'item','TEST','model','Model','device','def','cfg','Model','complete','not_physical','2026-10-02T00:00:00.000Z');
      INSERT INTO prj_item_bom(item_id,seq,snapshot_id,quantity_per_item,role) VALUES(1,0,1,1,'primary');
      INSERT INTO prj_line(uuid,group_id,sort_order,line_type,item_id,quantity)
      VALUES('line',1,0,'item',1,1);
      UPDATE prj_line SET line_discount_bp=500;`);
    migrateProjectDatabaseToCurrent(db,migrationFolder);
    expect(db.prepare("SELECT global_discount_bp,labour_total_e4 FROM prj_project").get())
      .toEqual({global_discount_bp:0,labour_total_e4:0});
    expect(db.prepare("SELECT line_discount_bp FROM prj_line").pluck().get()).toBe(0);
    expect(db.prepare("SELECT line_discount_bp FROM prj_item_bom").pluck().get()).toBe(0);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  }finally{db.close();}
});

const product: CatalogueProductSnapshotSource = {
  brandMarchio: "BTI", brandName: "BTicino", manufacturerCode: "FN81B16",
  ean: "8005543534684", shortDescription: "btdin60 - magnetot 1P curva B 16A",
  description: "Interruttore magnetotermico", unitOfMeasure: "PCE",
  categoryCode: "protezione.interruttori_automatici", categoryPathLabel: "Interruttori automatici",
  familyCode: "btdin60", familyName: "BTDIN60", priceIssuerSigla: "BTI",
  priceListinoNumber: "021", priceValidFrom: "2026-07-01", listPriceUnitE4: 508_001,
  priceMultiplierOriginal: 1,
  attributes: [{ code: "rated_current", name: "Corrente nominale", dataType: "number", unit: "A", value: 16, label: null }],
};

const request = (destinationPath: string, projectType: "civil" | "industrial" = "civil"): CreateProjectDocumentRequest => ({
  title: "Quadro uffici", destinationPath, description: "Piano terra", notes: "Consegna prioritaria",
  projectType, executor: "Tecnico di esempio", date: "2026-09-22", companyName: "Cliente di esempio",
  companyDescription: "Sede di esempio",
});

function setup(
  resolve = vi.fn(() => product),
  migrations = migrationFolder,
  overrides: Partial<Pick<ProjectDocumentServiceOptions,
    "backupDatabase" | "replaceFile" | "waitForRenameRetry" | "removeFile">> = {},
) {
  const root = mkdtempSync(path.join(tmpdir(), "lqp-project-test-")); roots.push(root);
  const service = serviceForRoot(root, resolve, migrations, overrides);
  return { root, service, resolve };
}

function serviceForRoot(
  root: string,
  resolve = vi.fn(() => product),
  migrations = migrationFolder,
  overrides: Partial<Pick<ProjectDocumentServiceOptions,
    "backupDatabase" | "replaceFile" | "waitForRenameRetry" | "removeFile">> = {},
): ProjectDocumentService {
  return new ProjectDocumentService({
    workingDirectory: path.join(root, "working"), incomingDirectory: path.join(root, "incoming"),
    backupDirectory: path.join(root, "backups"), migrationsFolder: migrations,
    appVersion: "0.1.0-test", resolveCatalogueProduct: resolve,
    now: () => new Date("2026-09-22T10:00:00.000Z"),
    ...overrides,
  });
}

function projectDialogs(overrides: Partial<ProjectFileDialogs> = {}): ProjectFileDialogs {
  return {
    chooseDestination: vi.fn(async () => null),
    chooseSaveAsDestination: vi.fn(async () => null),
    chooseProjectToOpen: vi.fn(async () => null),
    confirmDirtyClose: vi.fn(async () => "cancel" as const),
    resolveSaveConflict: vi.fn(async () => "cancel" as const),
    resolveSaveFailure: vi.fn(async () => "cancel" as const),
    ...overrides,
  };
}

function mutate(filename: string, sql: string): void {
  const database = new Database(filename);
  try { database.exec(sql); } finally { database.close(); }
}

function filesystemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`filesystem ${code}`), { code });
}

async function savedProject(): Promise<{ root: string; filename: string }> {
  const { root, service } = setup();
  const filename = path.join(root, "saved.lqp");
  await service.create(request(filename));
  service.close();
  return { root, filename };
}

describe(".lqp project vertical slice", () => {
  it("persists line/global discounts and labour through save, offline reopen and Save As",async()=>{
    const {root,service}=setup();
    const filename=path.join(root,"commercial.lqp");
    await service.create(request(filename));
    const added=service.addCatalogueProduct(1,2);
    const uuid=added.lines[0]!.uuid;
    expect(() => service.setLineDiscount(uuid,-1)).toThrow("Sconto");
    expect(() => service.setLineDiscount(uuid,10_001)).toThrow("Sconto");
    expect(() => service.setLabourTotal(-1)).toThrow("Mano d'opera");
    service.setLineDiscount(uuid,2500);
    service.setGlobalDiscount(1000);
    const edited=service.setLabourTotal(2_000_000);
    expect(edited.dirty).toBe(true);
    expect(calculateCommercial(edited)).toMatchObject({materialsSubtotalE4:762_001,
      globalDiscountE4:76_200,materialsAfterGlobalE4:685_801,finalTotalE4:2_685_801});
    expect((await service.save()).dirty).toBe(false);
    service.close();
    const unavailable=vi.fn(():CatalogueProductSnapshotSource=>{throw new Error("catalogue unavailable")});
    const offline=serviceForRoot(path.join(root,"offline"),unavailable);
    try {
      const reopened=offline.open(filename);
      expect(reopened).toMatchObject({dirty:false,globalDiscountBp:1000,labourTotalE4:2_000_000,
        lines:[{lineDiscountBp:2500}]});
      const copy=await offline.saveAs(path.join(root,"commercial-copy.lqp"));
      expect(copy).toMatchObject({dirty:false,globalDiscountBp:1000,labourTotalE4:2_000_000,
        lines:[{lineDiscountBp:2500}]});
      expect(unavailable).not.toHaveBeenCalled();
    }finally{offline.close();}
  });
  it.each([["civil", "CEI EN 60898"], ["industrial", "CEI EN 60947-2"]] as const)(
    "creates %s projects with their derived norm", async (type, normCode) => {
      const { root, service } = setup();
      const created = await service.create(request(path.join(root, `${type}.lqp`), type));
      expect(created.metadata).toMatchObject({ title: "Quadro uffici", description: "Piano terra", notes: "Consegna prioritaria",
        projectType: type, normCode, executor: "Tecnico di esempio", date: "2026-09-22",
        companyName: "Cliente di esempio", companyDescription: "Sede di esempio" });
      expect(created).not.toHaveProperty("path");
      expect(created.documentName).toBe(`${type}.lqp`);
      expect(created.revision).toBe(1);
      service.close();
    },
  );

  it("snapshots products, merges duplicates, and restores exact quantity and _e4 prices without catalogue IDs", async () => {
    const { root, service, resolve } = setup();
    const filename = path.join(root, "portable.lqp");
    const created = await service.create(request(filename));
    let view = service.addCatalogueProduct(991);
    view = service.addCatalogueProduct(991);
    view = service.setQuantity(view.lines[0]!.uuid, 7);
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]).toMatchObject({ manufacturerCode: "FN81B16", quantity: 7,
      unitListPriceE4: 508_001, lineTotalE4: 3_556_007 });
    expect(view.distinta).toMatchObject([{manufacturerCode:"FN81B16",quantity:7,
      listPriceUnitE4:508_001,listTotalE4:3_556_007}]);
    expect(resolve).toHaveBeenCalledTimes(2);
    await service.save();
    service.close();

    const unavailableCatalogue = vi.fn(() => { throw new Error("catalogue unavailable"); });
    const reopenedService = setup(unavailableCatalogue).service;
    const reopened = reopenedService.open(filename);
    expect(reopened.metadata).toEqual(created.metadata);
    expect(reopened.lines[0]).toMatchObject({ brandMarchio: "BTI", manufacturerCode: "FN81B16",
      quantity: 7, unitListPriceE4: 508_001, lineTotalE4: 3_556_007 });
    expect(reopened.distinta).toEqual(view.distinta);
    expect(unavailableCatalogue).not.toHaveBeenCalled();

    const database = new Database(filename, { readonly: true });
    try {
      const columns = database.pragma("table_xinfo('prj_product_snapshot')") as { name: string }[];
      expect(columns.map((column) => column.name)).not.toContain("cat_product_id");
      expect(database.pragma("application_id", { simple: true })).toBe(LQP_APPLICATION_ID);
      expect(database.prepare("SELECT COUNT(*) AS count FROM prj_product_snapshot").get()).toEqual({ count: 1 });
    } finally { database.close(); reopenedService.close(); }
  });

  it("enforces the type/norm pair with the valid singleton id", () => {
    const { root } = setup();
    const database = openCurrentProjectDatabase(path.join(root, "constraints.lqp"), migrationFolder);
    try {
      expect(() => database.prepare(`INSERT INTO prj_project(id, uuid, title, project_type, norm_code, project_date)
        VALUES (1, '10000000-0000-4000-8000-000000000001', 'Bad', 'civil', 'CEI EN 60947-2', '2026-09-22')`).run()).toThrow();
      expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    } finally { database.close(); }
  });

  it("caps duplicate additions at 9,999", async () => {
    const { root, service } = setup();
    await service.create(request(path.join(root, "quantity.lqp")));
    let view = service.addCatalogueProduct(1);
    view = service.setQuantity(view.lines[0]!.uuid, 9_999);
    expect(() => service.addCatalogueProduct(1)).toThrow("quantità massima");
    expect(service.current()!.lines[0]!.quantity).toBe(9_999);
    service.discardCurrent();
  });

  it("adds a new ordinary line with the requested quantity in one mutation", async () => {
    const { root, service } = setup();
    await service.create(request(path.join(root, "new-quantity.lqp")));
    const before = service.current()!;
    const added = service.addCatalogueProduct(1, 4);
    expect(added.lines).toMatchObject([{ quantity: 4, lineTotalE4: 2_032_004 }]);
    expect(added.revision).toBe(before.revision);
    expect(added.lines).toHaveLength(1);
    service.discardCurrent();
  });

  it("increments an existing ordinary line by the requested quantity", async () => {
    const { root, service } = setup();
    await service.create(request(path.join(root, "increment-quantity.lqp")));
    const first = service.addCatalogueProduct(1, 3);
    const added = service.addCatalogueProduct(1, 5);
    expect(added.lines).toHaveLength(1);
    expect(added.lines[0]).toMatchObject({ uuid: first.lines[0]!.uuid, quantity: 8,
      lineTotalE4: 4_064_008 });
    service.discardCurrent();
  });

  it("rejects an overflowing ordinary total without changing the document", async () => {
    const { root, service } = setup();
    await service.create(request(path.join(root, "overflow-quantity.lqp")));
    const before = service.addCatalogueProduct(1, 9_998);
    expect(() => service.addCatalogueProduct(1, 2)).toThrow("quantità massima");
    expect(service.current()).toEqual(before);
    expect(() => service.addCatalogueProduct(1, 0)).toThrow("Quantità non valida");
    expect(() => service.addCatalogueProduct(1, 10_000)).toThrow("Quantità non valida");
    expect(service.current()).toEqual(before);
    service.discardCurrent();
  });

  it("defaults an omitted ordinary quantity to one", async () => {
    const { root, service } = setup();
    await service.create(request(path.join(root, "default-quantity.lqp")));
    expect(service.addCatalogueProduct(1).lines[0]?.quantity).toBe(1);
    expect(service.addCatalogueProduct(1).lines[0]?.quantity).toBe(2);
    service.discardCurrent();
  });

  it("preserves dirty working copies on close and supports explicit discard", async () => {
    const first = setup();
    await first.service.create(request(path.join(first.root, "dirty.lqp")));
    first.service.addCatalogueProduct(1);
    first.service.close();
    expect(readdirSync(path.join(first.root, "working")).some((name) => name.endsWith(".lqp"))).toBe(true);
    expect(readdirSync(path.join(first.root, "working")).some((name) => name.endsWith(".recovery.json"))).toBe(true);

    const second = setup();
    await second.service.create(request(path.join(second.root, "discard.lqp")));
    second.service.addCatalogueProduct(1);
    second.service.discardCurrent();
    expect(readdirSync(path.join(second.root, "working"))).toEqual([]);
  });

  it("keeps a dirty document recoverable after a save conflict and allows discard", async () => {
    const { root, service } = setup();
    const filename = path.join(root, "conflict.lqp");
    await service.create(request(filename));
    service.addCatalogueProduct(1);
    mutate(filename, "UPDATE lqp_meta SET value = 'external' WHERE key = 'saved_by_name'");
    await expect(service.save()).rejects.toThrow("modificato da un altro");
    expect(service.current()!.dirty).toBe(true);
    expect(readdirSync(path.join(root, "working")).some((name) => name.endsWith(".recovery.json"))).toBe(true);
    service.discardCurrent();
    expect(service.current()).toBeNull();
  });

  it("Save As preserves project_uuid and makes the new file the current target", async () => {
    const { root, service } = setup();
    const original = path.join(root, "original.lqp");
    const copy = path.join(root, "renamed.lqp");
    const created = await service.create(request(original));
    const originalBytes = readFileSync(original);
    service.addCatalogueProduct(1);

    const savedAs = await service.saveAs(copy);

    expect(savedAs).toMatchObject({ documentName: "renamed.lqp", dirty: false });
    expect(savedAs.metadata.uuid).toBe(created.metadata.uuid);
    expect(readFileSync(original)).toEqual(originalBytes);
    const copied = new Database(copy, { readonly: true });
    try {
      expect(copied.prepare("SELECT value FROM lqp_meta WHERE key = 'project_uuid'").pluck().get()).toBe(created.metadata.uuid);
    } finally { copied.close(); }
    service.addCatalogueProduct(1);
    await service.save();
    expect(service.current()!.documentName).toBe("renamed.lqp");
    service.close();
  });

  it("keeps newer edits dirty when they occur after a save snapshot is prepared", async () => {
    let intercept = false;
    let reportSnapshot!: () => void;
    let releaseSave!: () => void;
    const snapshotReady = new Promise<void>((resolve) => { reportSnapshot = resolve; });
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const { root, service } = setup(vi.fn(() => product), migrationFolder, {
      backupDatabase: async (database, destination) => {
        await database.backup(destination);
        if (intercept) {
          reportSnapshot();
          await saveGate;
        }
      },
    });
    const filename = path.join(root, "edit-during-save.lqp");
    await service.create(request(filename));
    const dirty = service.addCatalogueProduct(1);
    intercept = true;

    const saving = service.save();
    await snapshotReady;
    service.setQuantity(dirty.lines[0]!.uuid, 2);
    releaseSave();
    const afterSave = await saving;

    expect(afterSave).toMatchObject({ dirty: true, lines: [{ quantity: 2 }] });
    const saved = new Database(filename, { readonly: true });
    try { expect(saved.prepare("SELECT quantity FROM prj_line").pluck().get()).toBe(1); }
    finally { saved.close(); }
    service.close();
    expect(readdirSync(path.join(root, "working")).some((name) => name.endsWith(".recovery.json"))).toBe(true);
  });

  it("keeps Save As aimed at its selected destination when overwrite resolves a conflict", async () => {
    let mutateDestination = false;
    const { root, service } = setup(vi.fn(() => product), migrationFolder, {
      backupDatabase: async (database, temporary) => {
        await database.backup(temporary);
        if (mutateDestination) {
          mutateDestination = false;
          mutate(path.join(root, "selected.lqp"), "UPDATE lqp_meta SET value = 'external' WHERE key = 'saved_by_name'");
        }
      },
    });
    const original = path.join(root, "original.lqp");
    const selected = path.join(root, "selected.lqp");
    await service.create(request(original));
    copyFileSync(original, selected);
    const originalBytes = readFileSync(original);
    service.addCatalogueProduct(1);
    mutateDestination = true;
    const dialogs = projectDialogs({
      chooseSaveAsDestination: vi.fn(async () => selected),
      resolveSaveConflict: vi.fn(async () => "overwrite" as const),
    });

    const result = await saveProjectWithDialogs(service, dialogs, true);

    expect(result.view).toMatchObject({ documentName: "selected.lqp", dirty: false });
    expect(readFileSync(original)).toEqual(originalBytes);
    const destination = new Database(selected, { readonly: true });
    try { expect(destination.prepare("SELECT COUNT(*) FROM prj_line").pluck().get()).toBe(1); }
    finally { destination.close(); service.close(); }
  });

  it("uses the current baseline when Save As selects the current document path", async () => {
    const { root, service } = setup();
    const filename = path.join(root, "same-target.lqp");
    await service.create(request(filename));
    service.addCatalogueProduct(1);
    mutate(filename, "UPDATE lqp_meta SET value = 'external' WHERE key = 'saved_by_name'");
    await expect(service.saveAs(filename)).rejects.toMatchObject({ kind: "conflict" });
    expect(service.current()).toMatchObject({ documentName: "same-target.lqp", dirty: true });
    service.discardCurrent();
  });

  it("backs up and verifies the previous revision before replacement", async () => {
    const { root, service } = setup();
    const filename = path.join(root, "backup.lqp");
    const created = await service.create(request(filename));
    service.addCatalogueProduct(1);
    const saved = await service.save();
    const backupDirectory = path.join(root, "backups", created.metadata.uuid);
    const backups = readdirSync(backupDirectory);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/_rev1\.lqp$/);
    expect(backups.some((name) => name.endsWith(".part"))).toBe(false);
    expect(["-wal", "-shm", "-journal"].some((suffix) => existsSync(`${filename}${suffix}`))).toBe(false);
    const backup = new Database(path.join(backupDirectory, backups[0]!), { readonly: true });
    const target = new Database(filename, { readonly: true });
    try {
      expect(backup.prepare("SELECT value FROM lqp_meta WHERE key = 'revision'").pluck().get()).toBe("1");
      expect(target.prepare("SELECT value FROM lqp_meta WHERE key = 'revision'").pluck().get()).toBe(String(saved.revision));
    } finally { backup.close(); target.close(); service.close(); }
  });

  it("failed open and failed create leave the current clean project usable", async () => {
    const current = setup();
    const currentView = await current.service.create(request(path.join(current.root, "current.lqp")));
    const hostile = await savedProject();
    mutate(hostile.filename, "CREATE TABLE injected(payload TEXT)");
    expect(() => current.service.open(hostile.filename)).toThrow("Tabella progetto sconosciuta");
    expect(current.service.current()!.metadata.uuid).toBe(currentView.metadata.uuid);

    const blockedTarget = path.join(current.root, "blocked.lqp");
    writeFileSync(`${blockedTarget}-wal`, "stale");
    await expect(current.service.create(request(blockedTarget))).rejects.toThrow("file SQLite laterali");
    expect(current.service.current()!.metadata.uuid).toBe(currentView.metadata.uuid);
    current.service.close();
  });

  it("refuses a replacement when the current project becomes dirty while create awaits", async () => {
    let backupCount = 0;
    let releaseCandidate!: () => void;
    let reportCandidateStarted!: () => void;
    const candidateGate = new Promise<void>((resolve) => { releaseCandidate = resolve; });
    const candidateStarted = new Promise<void>((resolve) => { reportCandidateStarted = resolve; });
    const { root, service } = setup(vi.fn(() => product), migrationFolder, {
      backupDatabase: async (database, destination) => {
        backupCount += 1;
        if (backupCount === 2) {
          reportCandidateStarted();
          await candidateGate;
        }
        return database.backup(destination);
      },
    });
    const original = await service.create(request(path.join(root, "original.lqp")));
    const replacement = service.create(request(path.join(root, "replacement.lqp")));
    await candidateStarted;

    const dirty = service.addCatalogueProduct(1);
    expect(dirty.dirty).toBe(true);
    releaseCandidate();

    await expect(replacement).rejects.toThrow("modificato durante la preparazione");
    const current = service.current()!;
    expect(current.metadata.uuid).toBe(original.metadata.uuid);
    expect(current.dirty).toBe(true);
    expect(current.lines).toHaveLength(1);
    const workingFiles = readdirSync(path.join(root, "working"));
    expect(workingFiles.filter((name) => name.endsWith(".lqp"))).toHaveLength(1);
    expect(workingFiles.filter((name) => name.endsWith(".recovery.json"))).toHaveLength(1);
    service.discardCurrent();
  });

  it("retries transient final-rename failures and then completes the save", async () => {
    let failuresRemaining = 0;
    const replaceFile = vi.fn((source: string, destination: string) => {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw filesystemError("EPERM");
      }
      renameSync(source, destination);
    });
    const waitForRenameRetry = vi.fn(async () => undefined);
    const { root, service } = setup(vi.fn(() => product), migrationFolder, { replaceFile, waitForRenameRetry });
    await service.create(request(path.join(root, "retry-success.lqp")));
    service.addCatalogueProduct(1);
    replaceFile.mockClear();
    waitForRenameRetry.mockClear();
    failuresRemaining = 2;

    const saved = await service.save();

    expect(saved.dirty).toBe(false);
    expect(replaceFile).toHaveBeenCalledTimes(3);
    expect(waitForRenameRetry.mock.calls).toEqual([[100], [250]]);
    service.close();
  });

  it("does not retry a non-transient final-rename failure", async () => {
    let failureCode: string | null = null;
    const replaceFile = vi.fn((source: string, destination: string) => {
      if (failureCode) throw filesystemError(failureCode);
      renameSync(source, destination);
    });
    const waitForRenameRetry = vi.fn(async () => undefined);
    const { root, service } = setup(vi.fn(() => product), migrationFolder, { replaceFile, waitForRenameRetry });
    const filename = path.join(root, "no-retry.lqp");
    await service.create(request(filename));
    service.addCatalogueProduct(1);
    const baseline = readFileSync(filename);
    replaceFile.mockClear();
    failureCode = "EXDEV";

    await expect(service.save()).rejects.toMatchObject({ kind: "replace-failed", cause: { code: "EXDEV" } });

    expect(replaceFile).toHaveBeenCalledTimes(1);
    expect(waitForRenameRetry).not.toHaveBeenCalled();
    expect(readFileSync(filename)).toEqual(baseline);
    expect(service.current()).toMatchObject({ dirty: true, lines: [{ manufacturerCode: "FN81B16" }] });
    service.discardCurrent();
  });

  it.each(["changed file", "new WAL"])("reports a conflict when a retry encounters a %s", async change => {
    let failRename = false;
    const replaceFile = vi.fn((source: string, destination: string) => {
      if (failRename) {
        failRename = false;
        throw filesystemError("EBUSY");
      }
      renameSync(source, destination);
    });
    const { root, service } = setup(vi.fn(() => product), migrationFolder, {
      replaceFile,
      waitForRenameRetry: async () => {
        if (change === "new WAL") writeFileSync(filename + "-wal", "external writer");
        else mutate(filename, "UPDATE lqp_meta SET value = 'external edit' WHERE key = 'saved_by_name'");
        externalBytes = readFileSync(filename);
      },
    });
    const filename = path.join(root, "retry-conflict.lqp");
    let externalBytes: Buffer | undefined;
    await service.create(request(filename));
    service.addCatalogueProduct(1);
    replaceFile.mockClear();
    failRename = true;

    await expect(service.save()).rejects.toMatchObject({ kind: "conflict" });

    expect(replaceFile).toHaveBeenCalledOnce();
    expect(externalBytes).toBeDefined();
    expect(readFileSync(filename)).toEqual(externalBytes);
    if (change === "new WAL") expect(readFileSync(filename + "-wal", "utf8")).toBe("external writer");
    expect(service.current()).toMatchObject({ dirty: true, lines: [{ manufacturerCode: "FN81B16" }] });
    expect(readdirSync(root).some(name => name.endsWith(".lqp.tmp"))).toBe(false);
    service.discardCurrent();
  });

  it("fails safely after exhausting transient final-rename retries", async () => {
    let failRename = false;
    const replaceFile = vi.fn((source: string, destination: string) => {
      if (failRename) throw filesystemError("EBUSY");
      renameSync(source, destination);
    });
    const waitForRenameRetry = vi.fn(async () => undefined);
    const { root, service } = setup(vi.fn(() => product), migrationFolder, { replaceFile, waitForRenameRetry });
    const filename = path.join(root, "retry-exhausted.lqp");
    await service.create(request(filename));
    service.addCatalogueProduct(1);
    const baseline = readFileSync(filename);
    replaceFile.mockClear();
    failRename = true;

    await expect(service.save()).rejects.toMatchObject({ kind: "replace-failed", cause: { code: "EBUSY" } });

    expect(replaceFile).toHaveBeenCalledTimes(5);
    expect(waitForRenameRetry.mock.calls).toEqual([[100], [250], [500], [1_000]]);
    expect(readFileSync(filename)).toEqual(baseline);
    expect(service.current()).toMatchObject({ dirty: true, lines: [{ manufacturerCode: "FN81B16" }] });
    expect(readdirSync(root).filter((name) => name.startsWith(".~") && name.endsWith(".lqp.tmp"))).toHaveLength(1);
    expect(readdirSync(path.join(root, "working")).some((name) => name.endsWith(".recovery.json"))).toBe(true);
    service.discardCurrent();
    expect(readdirSync(root).some((name) => name.startsWith(".~") && name.endsWith(".lqp.tmp"))).toBe(false);
  });

  it("retries the retained prepared save after replacement becomes available", async () => {
    let failRename = false;
    const replaceFile = vi.fn((source: string, destination: string) => {
      if (failRename) throw filesystemError("EBUSY");
      renameSync(source, destination);
    });
    const { root, service } = setup(vi.fn(() => product), migrationFolder, {
      replaceFile,
      waitForRenameRetry: async () => undefined,
    });
    const filename = path.join(root, "pending-retry.lqp");
    await service.create(request(filename));
    service.addCatalogueProduct(1);
    failRename = true;
    await expect(service.save()).rejects.toMatchObject({ kind: "replace-failed" });
    expect(readdirSync(root).some((name) => name.startsWith(".~") && name.endsWith(".lqp.tmp"))).toBe(true);

    failRename = false;
    const saved = await service.retryPendingSave();

    expect(saved.dirty).toBe(false);
    expect(readdirSync(root).some((name) => name.startsWith(".~") && name.endsWith(".lqp.tmp"))).toBe(false);
    service.close();
  });

  it("refuses a pending retry when the target changed after replacement failed", async () => {
    let failRename = false;
    const replaceFile = vi.fn((source: string, destination: string) => {
      if (failRename) throw filesystemError("EBUSY");
      renameSync(source, destination);
    });
    const { root, service } = setup(vi.fn(() => product), migrationFolder, {
      replaceFile,
      waitForRenameRetry: async () => undefined,
    });
    const filename = path.join(root, "pending-conflict.lqp");
    await service.create(request(filename));
    service.addCatalogueProduct(1);
    failRename = true;
    await expect(service.save()).rejects.toMatchObject({ kind: "replace-failed" });
    mutate(filename, "UPDATE lqp_meta SET value = 'newer external version' WHERE key = 'saved_by_name'");
    const externalBytes = readFileSync(filename);

    await expect(service.retryPendingSave()).rejects.toMatchObject({ kind: "conflict" });

    expect(readFileSync(filename)).toEqual(externalBytes);
    expect(service.current()).toMatchObject({ dirty: true, lines: [{ manufacturerCode: "FN81B16" }] });
    service.discardCurrent();
  });

  it("keeps target and working copy intact when a save conflict is cancelled", async () => {
    const { root, service } = setup();
    const filename = path.join(root, "cancel-conflict.lqp");
    await service.create(request(filename));
    service.addCatalogueProduct(1);
    mutate(filename, "UPDATE lqp_meta SET value = 'external winner' WHERE key = 'saved_by_name'");
    const externalBytes = readFileSync(filename);
    const dialogs = projectDialogs({ resolveSaveConflict: vi.fn(async () => "cancel" as const) });

    const result = await saveProjectWithDialogs(service, dialogs);

    expect(result).toMatchObject({ completed: false, view: { dirty: true, lines: [{ manufacturerCode: "FN81B16" }] } });
    expect(readFileSync(filename)).toEqual(externalBytes);
    service.discardCurrent();
  });

  it("discovers and opens crash recovery without targeting the original document", async () => {
    const { root, service } = setup();
    const original = path.join(root, "recovery-source.lqp");
    const created = await service.create(request(original));
    const originalBytes = readFileSync(original);
    service.addCatalogueProduct(1);
    service.close();

    const restarted = serviceForRoot(root);
    const recoveries = restarted.recoveries();
    expect(recoveries).toHaveLength(1);
    expect(recoveries[0]).toMatchObject({ documentName: "recovery-source.lqp" });
    expect(JSON.stringify(recoveries)).not.toContain(root);
    const recovered = restarted.openRecovery(recoveries[0]!.id);
    expect(recovered).toMatchObject({ dirty: true, metadata: { uuid: created.metadata.uuid }, lines: [{ manufacturerCode: "FN81B16" }] });
    await expect(restarted.save()).rejects.toMatchObject({ kind: "save-as-required" });
    expect(readFileSync(original)).toEqual(originalBytes);
    const recoveredTarget = path.join(root, "recovered.lqp");
    await restarted.saveAs(recoveredTarget);
    expect(restarted.current()).toMatchObject({ documentName: "recovered.lqp", dirty: false });
    expect(readFileSync(original)).toEqual(originalBytes);
    restarted.close();
  });

  it("discards a discovered recovery explicitly", async () => {
    const { root, service } = setup();
    await service.create(request(path.join(root, "discard-recovery.lqp")));
    service.addCatalogueProduct(1);
    service.close();
    const restarted = serviceForRoot(root);
    const recovery = restarted.recoveries()[0]!;
    restarted.discardRecovery(recovery.id);
    expect(restarted.recoveries()).toEqual([]);
    expect(readdirSync(path.join(root, "working"))).toEqual([]);
  });

  it("recovers with safe fallback metadata and removes stale incoming and sidecar files", async () => {
    const { root, service } = setup();
    await service.create(request(path.join(root, "malformed.lqp")));
    service.addCatalogueProduct(1);
    service.close();
    const working = path.join(root, "working");
    const metadataName = readdirSync(working).find((name) => name.endsWith(".recovery.json"))!;
    writeFileSync(path.join(working, metadataName), "{not-json");
    writeFileSync(path.join(root, "incoming", "stale.lqp"), "stale");
    writeFileSync(path.join(working, "missing.lqp.recovery.json"), "{}\n");

    const restarted = serviceForRoot(root);
    expect(readdirSync(path.join(root, "incoming"))).toEqual([]);
    expect(existsSync(path.join(working, "missing.lqp.recovery.json"))).toBe(false);
    expect(restarted.recoveries()).toHaveLength(1);
    expect(restarted.recoveries()[0]!.documentName).toBe("Progetto recuperato.lqp");
    expect(restarted.openRecovery(restarted.recoveries()[0]!.id).lines).toHaveLength(1);
    restarted.discardCurrent();
  });

  it("does not silently delete an orphan working copy when recovery metadata is missing", async () => {
    const { root, service } = setup();
    await service.create(request(path.join(root, "orphan.lqp")));
    service.addCatalogueProduct(1);
    service.close();
    const working = path.join(root, "working");
    const metadataName = readdirSync(working).find((name) => name.endsWith(".recovery.json"))!;
    unlinkSync(path.join(working, metadataName));

    const restarted = serviceForRoot(root);
    expect(restarted.recoveries()).toHaveLength(1);
    expect(restarted.recoveries()[0]!.documentName).toBe("Progetto recuperato.lqp");
    restarted.discardRecovery(restarted.recoveries()[0]!.id);
    expect(readdirSync(working)).toEqual([]);
  });

  it.each(["foreign", "corrupt"] as const)("rejects a %s recovery before opening it read-write", (kind) => {
    const { root } = setup();
    const working = path.join(root, "working");
    const workingName = `${kind}.lqp`;
    const filename = path.join(working, workingName);
    if (kind === "foreign") new Database(filename).close();
    else writeFileSync(filename, "not a sqlite database");
    writeFileSync(`${filename}.recovery.json`, `${JSON.stringify({
      workingFile: workingName,
      originalDocumentName: "Unsafe.lqp",
      preservedAt: "2026-09-22T10:00:00.000Z",
    })}\n`);
    const before = readFileSync(filename);
    const restarted = serviceForRoot(root);
    const recovery = restarted.recoveries()[0]!;

    expect(() => restarted.openRecovery(recovery.id)).toThrow();
    expect(readFileSync(filename)).toEqual(before);
  });

  it("recovers a valid project that crashed before its first successful save", async () => {
    const { root } = setup();
    const working = path.join(root, "working");
    const workingName = "never-saved.lqp";
    const filename = path.join(working, workingName);
    const database = openCurrentProjectDatabase(filename, migrationFolder);
    const projectUuid = "10000000-0000-4000-8000-000000000099";
    try {
      const rows: readonly [string, string][] = [
        ["format_version", String(projectFormatVersion(migrationFolder))], ["app_version_saved", "0.1.0-test"],
        ["project_uuid", projectUuid], ["revision", "0"], ["created_at", "2026-09-22T10:00:00.000Z"],
        ["created_by_name", ""], ["created_by_installation_uuid", ""], ["saved_at", ""],
        ["saved_by_name", ""], ["saved_by_installation_uuid", ""], ["contains_costs", "0"],
      ];
      const insert = database.prepare("INSERT INTO lqp_meta(key, value) VALUES (?, ?)");
      for (const row of rows) insert.run(...row);
      database.prepare(`INSERT INTO prj_project(id, uuid, title, project_type, norm_code, project_date)
        VALUES (1, ?, 'Mai salvato', 'civil', 'CEI EN 60898', '2026-09-22')`).run(projectUuid);
      database.prepare("INSERT INTO prj_group(id, uuid, name, sort_order) VALUES (1, '20000000-0000-4000-8000-000000000099', 'Preventivo', 0)").run();
    } finally { database.close(); }
    writeFileSync(`${filename}.recovery.json`, `${JSON.stringify({
      workingFile: workingName,
      originalDocumentName: "Mai salvato.lqp",
      preservedAt: "2026-09-22T10:00:00.000Z",
    })}\n`);

    const restarted = serviceForRoot(root);
    const recovered = restarted.openRecovery(restarted.recoveries()[0]!.id);
    expect(recovered).toMatchObject({ dirty: true, revision: 0, metadata: { uuid: projectUuid, title: "Mai salvato" } });
    await restarted.saveAs(path.join(root, "first-save.lqp"));
    expect(restarted.current()).toMatchObject({ dirty: false, revision: 1, documentName: "first-save.lqp" });
    restarted.close();
  });

  it("recovers an uncheckpointed WAL edit and keeps the recovered project dirty", () => {
    const { root } = setup();
    const working = path.join(root, "working");
    const source = path.join(root, "hot-wal-source.lqp");
    const workingName = "hot-wal.lqp";
    const filename = path.join(working, workingName);
    const database = openCurrentProjectDatabase(source, migrationFolder);
    const projectUuid = "10000000-0000-4000-8000-000000000098";
    try {
      const rows: readonly [string, string][] = [
        ["format_version", String(projectFormatVersion(migrationFolder))], ["app_version_saved", "0.1.0-test"],
        ["project_uuid", projectUuid], ["revision", "0"], ["created_at", "2026-09-22T10:00:00.000Z"],
        ["created_by_name", ""], ["created_by_installation_uuid", ""], ["saved_at", ""],
        ["saved_by_name", ""], ["saved_by_installation_uuid", ""], ["contains_costs", "0"],
      ];
      const insert = database.prepare("INSERT INTO lqp_meta(key, value) VALUES (?, ?)");
      for (const row of rows) insert.run(...row);
      database.prepare(`INSERT INTO prj_project(id, uuid, title, project_type, norm_code, project_date)
        VALUES (1, ?, 'Titolo iniziale', 'civil', 'CEI EN 60898', '2026-09-22')`).run(projectUuid);
      database.prepare("INSERT INTO prj_group(id, uuid, name, sort_order) VALUES (1, '20000000-0000-4000-8000-000000000098', 'Preventivo', 0)").run();
      database.pragma("wal_checkpoint(TRUNCATE)");
      database.prepare("UPDATE prj_project SET title = 'Titolo dal WAL' WHERE id = 1").run();

      expect(existsSync(`${source}-wal`)).toBe(true);
      copyFileSync(source, filename);
      copyFileSync(`${source}-wal`, `${filename}-wal`);
    } finally { database.close(); }
    writeFileSync(`${filename}.recovery.json`, `${JSON.stringify({
      workingFile: workingName,
      originalDocumentName: "Hot WAL.lqp",
      preservedAt: "2026-09-22T10:00:00.000Z",
    })}\n`);

    const restarted = serviceForRoot(root);
    const recovered = restarted.openRecovery(restarted.recoveries()[0]!.id);
    expect(recovered).toMatchObject({ dirty: true, revision: 0, metadata: { uuid: projectUuid, title: "Titolo dal WAL" } });
    restarted.discardCurrent();
  });

  it.skipIf(process.platform === "win32")("does not accept a symlinked recovery working entry", async () => {
    const { root, service } = setup();
    const real = path.join(root, "real.lqp");
    await service.create(request(real));
    service.close();
    const working = path.join(root, "working");
    const linked = path.join(working, "linked.lqp");
    const sidecar = `${linked}.recovery.json`;
    symlinkSync(real, linked);
    writeFileSync(sidecar, `${JSON.stringify({
      workingFile: "linked.lqp",
      originalDocumentName: "Linked.lqp",
      preservedAt: "2026-09-22T10:00:00.000Z",
    })}\n`);

    const restarted = serviceForRoot(root);
    expect(restarted.recoveries()).toEqual([]);
    expect(existsSync(real)).toBe(true);
    expect(lstatSync(linked).isSymbolicLink()).toBe(true);
    expect(existsSync(sidecar)).toBe(true);
  });

  it("continues recovery discovery when startup cleanup cannot unlink a stale file", async () => {
    const { root, service } = setup();
    await service.create(request(path.join(root, "cleanup-failure.lqp")));
    service.addCatalogueProduct(1);
    service.close();
    const staleIncoming = path.join(root, "incoming", "stale.lqp");
    writeFileSync(staleIncoming, "stale");

    const restarted = serviceForRoot(root, vi.fn(() => product), migrationFolder, {
      removeFile: () => { throw filesystemError("EACCES"); },
    });

    expect(existsSync(staleIncoming)).toBe(true);
    expect(restarted.recoveries()).toHaveLength(1);
    restarted.discardRecovery(restarted.recoveries()[0]!.id);
  });
});

describe("incoming project validation", () => {
  it("rejects invalid persisted commercial percentages and labour",async()=>{
    for(const sql of ["UPDATE prj_project SET global_discount_bp=10001",
      "UPDATE prj_project SET labour_total_e4=-1"]) {
      const {filename}=await savedProject();
      mutate(filename,sql);
      const reader=setup().service;
      expect(()=>reader.open(filename)).toThrow();
      reader.close();
    }
  });
  it.each([
    ["unknown table", "CREATE TABLE injected(payload TEXT)", "Tabella progetto sconosciuta"],
    ["expected table replaced by a view", "DROP TABLE prj_group; CREATE VIEW prj_group AS SELECT 1 id, 'x' uuid, 'x' name, 0 sort_order", "oggetti SQLite non consentiti"],
    ["application table replaced by a view", "DROP TABLE lqp_meta; CREATE VIEW lqp_meta AS SELECT 'project_uuid' key, 'x' value", "oggetti SQLite non consentiti"],
    ["prototype-named index", "CREATE INDEX toString ON prj_project(title)", "Indice progetto sconosciuto"],
  ])("rejects %s before loading application data", async (_label, sql, message) => {
    const { filename } = await savedProject();
    mutate(filename, sql);
    const reader = setup().service;
    expect(() => reader.open(filename)).toThrow(message);
    reader.close();
  });

  it("rejects malformed migration metadata before querying it", async () => {
    const { filename } = await savedProject();
    mutate(filename, "DROP TABLE __drizzle_migrations; CREATE TABLE __drizzle_migrations(id INTEGER, hash TEXT)");
    const reader = setup().service;
    expect(() => reader.open(filename)).toThrow("non ha le colonne previste");
    reader.close();
  });

  it("rejects a migration history from a newer application", async () => {
    const { filename } = await savedProject();
    mutate(filename, "INSERT INTO __drizzle_migrations(hash, created_at) VALUES ('future', 9999999999999)");
    const reader = setup().service;
    expect(() => reader.open(filename)).toThrow("versione più recente");
    reader.close();
  });

  it.each([
    ["revision", "-1", "Revisione progetto non valida"],
    ["contains_costs", "2", "contains_costs non valido"],
    ["created_at", "yesterday", "Timestamp created_at non valido"],
    ["saved_at", "", "Timestamp saved_at non valido"],
    ["project_uuid", "not-a-uuid", "UUID tecnico"],
  ])("rejects malformed %s metadata", async (key, value, message) => {
    const { filename } = await savedProject();
    const database = new Database(filename);
    try { database.prepare("UPDATE lqp_meta SET value = ? WHERE key = ?").run(value, key); } finally { database.close(); }
    const reader = setup().service;
    expect(() => reader.open(filename)).toThrow(message);
    reader.close();
  });

  it("opens format k, copies with manifest(k), then migrates k to current", async () => {
    const original = await savedProject();
    const syntheticRoot = mkdtempSync(path.join(tmpdir(), "lqp-migrations-test-")); roots.push(syntheticRoot);
    const synthetic = path.join(syntheticRoot, "project");
    mkdirSync(path.join(synthetic, "meta"), { recursive: true });
    copyFileSync(path.join(migrationFolder, "0000_omniscient_nextwave.sql"), path.join(synthetic, "0000_omniscient_nextwave.sql"));
    copyFileSync(path.join(migrationFolder, "0001_thick_leopardon.sql"), path.join(synthetic, "0001_thick_leopardon.sql"));
    copyFileSync(path.join(migrationFolder, "0002_portable_placement.sql"), path.join(synthetic, "0002_portable_placement.sql"));
    copyFileSync(path.join(migrationFolder, "0003_context_snapshot.sql"), path.join(synthetic, "0003_context_snapshot.sql"));
    copyFileSync(path.join(migrationFolder, "0004_silly_franklin_richards.sql"), path.join(synthetic, "0004_silly_franklin_richards.sql"));
    copyFileSync(path.join(migrationFolder, "0005_fronte_annotations.sql"), path.join(synthetic, "0005_fronte_annotations.sql"));
    copyFileSync(path.join(migrationFolder, "0006_fronte_text_boxes.sql"), path.join(synthetic, "0006_fronte_text_boxes.sql"));
    copyFileSync(path.join(migrationFolder, "0007_chief_reavers.sql"), path.join(synthetic, "0007_chief_reavers.sql"));
    copyFileSync(path.join(migrationFolder, "0008_fronte_text_font_size.sql"), path.join(synthetic, "0008_fronte_text_font_size.sql"));
    copyFileSync(path.join(migrationFolder, "0009_engineering_provenance.sql"), path.join(synthetic, "0009_engineering_provenance.sql"));
    copyFileSync(path.join(migrationFolder, "0010_mounting_facts.sql"), path.join(synthetic, "0010_mounting_facts.sql"));
    const journal = JSON.parse(readFileSync(path.join(migrationFolder, "meta/_journal.json"), "utf8")) as { entries: Array<{ when: number; idx?: number; version?: string; tag?: string; breakpoints?: boolean }> };
    journal.entries.push({ idx: 11, version: "6", when: journal.entries[10]!.when + 1, tag: "0011_future_test", breakpoints: true });
    writeFileSync(path.join(synthetic, "meta/_journal.json"), `${JSON.stringify(journal, null, 2)}\n`);
    writeFileSync(path.join(synthetic, "0011_future_test.sql"), "ALTER TABLE `prj_project` ADD `future_note` text;\n");
    writeFileSync(path.join(synthetic, "manifest.json"), generateProjectManifest(synthetic));

    const reader = setup(vi.fn(() => product), synthetic).service;
    expect(reader.open(original.filename).metadata.title).toBe("Quadro uffici");
    await reader.save();
    reader.close();
    const upgraded = new Database(original.filename, { readonly: true });
    try {
      expect((upgraded.pragma("table_xinfo('prj_project')") as { name: string }[]).map((column) => column.name)).toContain("future_note");
      expect(upgraded.prepare("SELECT value FROM lqp_meta WHERE key = 'format_version'").pluck().get()).toBe("12");
    } finally { upgraded.close(); }
  });
});

describe("project creation and platform validation", () => {
  it("rejects invalid inputs including prototype property names", () => {
    const valid = request("/tmp/valid.lqp");
    expect(() => validateProjectCreation({ ...valid, title: "" })).toThrow("Nome progetto obbligatorio");
    expect(() => validateProjectCreation({ ...valid, destinationPath: "" })).toThrow("Percorso salvataggio obbligatorio");
    expect(() => validateProjectCreation({ ...valid, destinationPath: "/tmp/no-extension" })).toThrow("estensione .lqp");
    expect(() => validateProjectCreation({ ...valid, projectType: "toString" as "civil" })).toThrow("Tipologia progetto non supportata");
    expect(() => validateProjectCreation({ ...valid, date: "2026-02-30" })).toThrow("Data progetto non valida");
  });

  it("uses a writable file handle for Windows FlushFileBuffers", () => {
    expect(fsyncFileOpenFlag("win32")).toBe("r+");
    expect(fsyncFileOpenFlag("darwin")).toBe("r");
    expect(fsyncFileOpenFlag("linux")).toBe("r");
  });
});
