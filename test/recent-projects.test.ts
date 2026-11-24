import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AppSettingsStore, nextZoomLevel, normalizeZoomLevel, ZOOM_MAX, ZOOM_MIN } from "../src/main/app/app-settings.js";
import { recentFolderLabel, RecentProjectHandles, RecentProjectStore } from "../src/main/app/recent-projects.js";
import { MainDatabaseService } from "../src/main/database/database-service.js";
import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { closeConfiguredDatabase } from "../src/main/database/sqlite-connection.js";
import { ProjectDocumentService, type StoredProjectDocument } from "../src/main/project/project-document-service.js";
import type { CatalogueProductSnapshotSource } from "../src/shared/project.js";

const roots: string[] = [];
const services: MainDatabaseService[] = [];
const connections: ReturnType<typeof openMigratedLqDatabase>[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.close();
  for (const connection of connections.splice(0)) if (connection.open) closeConfiguredDatabase(connection);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "librequadri-recent-test-"));
  roots.push(directory);
  return directory;
}

function catalogue(directory = root()): MainDatabaseService {
  const service = MainDatabaseService.initialize(directory, { migrationsFolder: path.resolve("db/migrations/lq") });
  services.push(service);
  return service;
}

function clock(start = Date.parse("2026-09-24T10:00:00.000Z")) {
  let current = start;
  return { now: () => new Date(current), advance: (milliseconds = 1_000) => { current += milliseconds; } };
}

/** A migrated lq.db connection; reopening the same folder checks persistence. */
function sqlite(directory = root()) {
  const connection = openMigratedLqDatabase({
    databaseFilename: path.join(directory, "lq.db"), backupDirectory: path.join(directory, "backups"),
    migrationsFolder: path.resolve("db/migrations/lq"),
  });
  connections.push(connection);
  return connection;
}

describe("recent projects (app_recent_file)", () => {
  it("lists the most recently used first and updates an entry on touch", () => {
    const time = clock();
    const directory = root();
    const files = ["a.lqp", "b.lqp", "c.lqp"].map((name) => path.join(directory, name));
    for (const file of files) writeFileSync(file, "x");
    const store = new RecentProjectStore(sqlite(), { now: time.now });
    for (const [index, file] of files.entries()) {
      store.touch({ path: file, projectUuid: `uuid-${index}`, title: `Progetto ${index}` });
      time.advance();
    }
    expect(store.list().map((entry) => path.basename(entry.path))).toEqual(["c.lqp", "b.lqp", "a.lqp"]);
    store.touch({ path: files[0]!, projectUuid: "uuid-0", title: "Rinominato" });
    expect(store.list()[0]).toMatchObject({ path: files[0], title: "Rinominato", available: true,
      lastOpenedAt: "2026-09-24T10:00:03.000Z" });
    expect(store.list()).toHaveLength(3);
  });

  it("keeps at most 15 entries, dropping the least recently used", () => {
    const time = clock();
    const store = new RecentProjectStore(sqlite(), { now: time.now, fileExists: () => true });
    for (let index = 0; index < 17; index++) {
      store.touch({ path: `/projects/p${index}.lqp`, projectUuid: `u${index}`, title: `P${index}` });
      time.advance();
    }
    const listed = store.list();
    expect(listed).toHaveLength(15);
    expect(listed[0]!.title).toBe("P16");
    expect(listed.at(-1)!.title).toBe("P2");
  });

  it("keeps a missing file listed and flagged, and forgetting never deletes the project file", () => {
    const directory = root();
    const kept = path.join(directory, "kept.lqp");
    const moved = path.join(directory, "moved.lqp");
    writeFileSync(kept, "project bytes");
    writeFileSync(moved, "project bytes");
    const store = new RecentProjectStore(sqlite());
    store.touch({ path: kept, projectUuid: "u1", title: "Tenuto" });
    store.touch({ path: moved, projectUuid: "u2", title: "Spostato" });
    unlinkSync(moved);
    expect(store.list().map((entry) => [entry.title, entry.available]))
      .toEqual(expect.arrayContaining([["Tenuto", true], ["Spostato", false]]));
    store.forget(kept);
    expect(store.list().map((entry) => entry.title)).toEqual(["Spostato"]);
    expect(existsSync(kept)).toBe(true);
    store.clear();
    expect(store.list()).toEqual([]);
    expect(existsSync(kept)).toBe(true);
  });

  it("gives the renderer opaque stable ids and display-only locations, never paths", () => {
    const handles = new RecentProjectHandles();
    const entry = { path: "/Users/tecnico/Documents/LibreQuadri/QG1.lqp", projectUuid: "u", title: "QG1",
      lastOpenedAt: "2026-09-24T10:00:00.000Z", available: true };
    const [view] = handles.views([entry], "/Users/tecnico");
    expect(view).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), title: "QG1", documentName: "QG1.lqp",
      folderLabel: "~/Documents/LibreQuadri", lastOpenedAt: entry.lastOpenedAt, available: true });
    expect(handles.views([entry], "/Users/tecnico")[0]!.id).toBe(view!.id);
    expect(handles.pathFor(view!.id)).toBe(entry.path);
    expect(handles.pathFor("00000000-0000-4000-8000-000000000000")).toBeUndefined();
    expect(recentFolderLabel("/Volumes/USB/Q.lqp", "/Users/tecnico")).toBe("/Volumes/USB");
  });
});

describe("recent projects from the document lifecycle", () => {
  const product: CatalogueProductSnapshotSource = {
    brandMarchio: "BTI", brandName: "BTicino", manufacturerCode: "FN81B16", ean: null, shortDescription: "magnetot",
    description: null, unitOfMeasure: "PCE", categoryCode: null, categoryPathLabel: null, familyCode: null,
    familyName: null, priceIssuerSigla: "BTI", priceListinoNumber: "021", priceValidFrom: "2026-07-01",
    listPriceUnitE4: 1_000, priceMultiplierOriginal: 1, attributes: [],
  };
  const request = (destinationPath: string) => ({
    title: "Quadro uffici", destinationPath, description: "", notes: "", projectType: "civil" as const,
    executor: "", date: "2026-09-24", companyName: "", companyDescription: "",
  });
  function documents(directory: string, onDocumentStored: (document: StoredProjectDocument) => void) {
    return new ProjectDocumentService({
      workingDirectory: path.join(directory, "working"), incomingDirectory: path.join(directory, "incoming"),
      backupDirectory: path.join(directory, "backups"), migrationsFolder: path.resolve("db/migrations/project"),
      appVersion: "0.1.0-test", resolveCatalogueProduct: () => product, onDocumentStored,
    });
  }

  it("records create, open, save and Save As, but not an unsaved recovery until Save As", async () => {
    const directory = root();
    const stored = vi.fn();
    const service = documents(directory, stored);
    const first = path.join(directory, "uffici.lqp");
    const created = await service.create(request(first));
    expect(stored).toHaveBeenLastCalledWith({ path: first, projectUuid: created.metadata.uuid, title: "Quadro uffici" });
    service.addCatalogueProduct(1);
    await service.save();
    expect(stored).toHaveBeenCalledTimes(2);
    const copy = path.join(directory, "uffici copia.lqp");
    await service.saveAs(copy);
    expect(stored).toHaveBeenLastCalledWith(expect.objectContaining({ path: copy }));
    service.close();
    const reopened = documents(directory, stored);
    reopened.open(first);
    expect(stored).toHaveBeenLastCalledWith(expect.objectContaining({ path: first, projectUuid: created.metadata.uuid }));
    reopened.addCatalogueProduct(1);
    reopened.close();

    stored.mockClear();
    const restarted = documents(directory, stored);
    restarted.openRecovery(restarted.recoveries()[0]!.id);
    expect(restarted.currentTargetPath()).toBeNull();
    expect(stored).not.toHaveBeenCalled();
    const recoveredTarget = path.join(directory, "recuperato.lqp");
    await restarted.saveAs(recoveredTarget);
    expect(stored).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: recoveredTarget }));
    expect(restarted.currentSummary()).toEqual({ title: "Quadro uffici", documentName: "recuperato.lqp",
      dirty: false, targetPath: recoveredTarget, undoLabel: null, redoLabel: null });
    restarted.close();
  });

  it("never lets a failing recents store break the document operation", async () => {
    const directory = root();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = documents(directory, () => { throw new Error("recents unavailable"); });
    const created = await service.create(request(path.join(directory, "q.lqp")));
    expect(created.dirty).toBe(false);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
    service.close();
  });

  it("feeds the lq.db store through the service hook", async () => {
    const directory = root();
    const lq = catalogue(path.join(directory, "user-data"));
    const service = documents(directory, (document) => lq.recentProjects.touch(document));
    const target = path.join(directory, "quadro.lqp");
    await service.create(request(target));
    expect(lq.recentProjects.list()).toEqual([expect.objectContaining({ path: target, title: "Quadro uffici", available: true })]);
    service.close();
  });
});

describe("theme and zoom preferences (app_setting)", () => {
  it("persists the theme and defaults to light", () => {
    const directory = root();
    const settings = catalogue(directory).settings;
    expect(settings.themePreference()).toBe("light");
    settings.setThemePreference("dark");
    expect(settings.themePreference()).toBe("dark");
    expect(() => settings.setThemePreference("sepia" as never)).toThrow("Tema non valido");
    services.pop()!.close();
    expect(catalogue(directory).settings.themePreference()).toBe("dark");
  });

  it("ignores a damaged theme value", () => {
    const connection = sqlite();
    connection.prepare("INSERT INTO app_setting(key, value) VALUES ('ui.theme', 'purple')").run();
    expect(new AppSettingsStore(connection).themePreference()).toBe("light");
  });

  it("steps zoom in half levels within bounds, resets to 0 and persists", () => {
    expect(nextZoomLevel(0, "in")).toBe(0.5);
    expect(nextZoomLevel(0, "out")).toBe(-0.5);
    expect(nextZoomLevel(2.5, "reset")).toBe(0);
    expect(nextZoomLevel(ZOOM_MAX, "in")).toBe(ZOOM_MAX);
    expect(nextZoomLevel(ZOOM_MIN, "out")).toBe(ZOOM_MIN);
    expect(normalizeZoomLevel(0.74)).toBe(0.5);
    expect(normalizeZoomLevel("nonsense")).toBe(0);
    expect(normalizeZoomLevel(99)).toBe(ZOOM_MAX);
    const directory = root();
    const settings = catalogue(directory).settings;
    expect(settings.zoomLevel()).toBe(0);
    expect(settings.setZoomLevel(nextZoomLevel(settings.zoomLevel(), "in"))).toBe(0.5);
    services.pop()!.close();
    expect(catalogue(directory).settings.zoomLevel()).toBe(0.5);
  });
});
