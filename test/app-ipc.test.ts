import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";

import { ApplicationController, type ApplicationControllerOptions } from "../src/main/app/application-controller.js";
import { registerAppIpc } from "../src/main/app/app-ipc.js";
import { RecentProjectHandles, type RecentProjectEntry, type RecentProjectStore } from "../src/main/app/recent-projects.js";
import type { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import {
  openProjectInteractive,
  prepareProjectReplacement,
  ProjectLifecycleBusyError,
  ProjectLifecycleOperationGuard,
  type ProjectFileDialogs,
  type ProjectInvokeEvent,
  type ProjectIpcRegistry,
} from "../src/main/project/project-ipc.js";
import { APP_CHANNELS, type RecentProjectView } from "../src/shared/app.js";
import type { ProjectDocumentView } from "../src/shared/project.js";

const roots: string[] = [];
const menu = vi.hoisted(() => ({ buildFromTemplate: (template: MenuItemConstructorOptions[]) => template,
  setApplicationMenu: vi.fn<(template: MenuItemConstructorOptions[]) => void>() }));
vi.mock("electron", () => ({ Menu: menu, dialog: {}, nativeTheme: {} }));
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const view = (documentName: string, dirty = false): ProjectDocumentView => ({
  documentName, revision: 1, dirty, lines: [], configuredItems: [], distinta: [], physicalNodes: [], annotations: [],
  metadata: { uuid: "10000000-0000-4000-8000-000000000001", title: "Cliente", description: "", notes: "",
    projectType: "civil", normCode: "CEI EN 60898", executor: "", date: "2026-09-24", companyName: "", companyDescription: "" },
});

/** A document service double with one optional open document. */
function documents(initial: { readonly dirty: boolean; readonly path: string } | null) {
  let current = initial;
  const service = {
    current: vi.fn(() => current ? view(path.basename(current.path), current.dirty) : null),
    currentTargetPath: vi.fn(() => current?.path ?? null),
    open: vi.fn((filename: string) => { current = { dirty: false, path: filename }; return view(path.basename(filename)); }),
    closeCurrent: vi.fn(() => { if (current?.dirty) throw new Error("dirty"); current = null; }),
    discardCurrent: vi.fn(() => { current = null; }),
    save: vi.fn(async () => { current = current ? { ...current, dirty: false } : null; return view("saved.lqp"); }),
    cancelPendingSave: vi.fn(),
  };
  return service as typeof service & ProjectDocumentService;
}

function dialogs(choice: "save" | "discard" | "cancel", picked: string | null = "/projects/next.lqp"): ProjectFileDialogs {
  return {
    chooseDestination: vi.fn(async () => null), chooseSaveAsDestination: vi.fn(async () => null),
    chooseProjectToOpen: vi.fn(async () => picked), confirmDirtyClose: vi.fn(async () => choice),
    resolveSaveConflict: vi.fn(async () => "cancel" as const), resolveSaveFailure: vi.fn(async () => "cancel" as const),
  };
}

describe("menu lifecycle routing", () => {
  it.each(["discard", "save", "cancel"] as const)("sends the new-project intent with a confirmed %s close", async choice => {
    const service = documents({ dirty: true, path: "/projects/current.lqp" });
    const send = vi.fn();
    const controller = new ApplicationController({
      applicationName: "LibreQuadri", development: false,
      service: { ...service, currentSummary: () => null }, dialogs: dialogs(choice),
      lifecycle: new ProjectLifecycleOperationGuard(), recent: { list: () => [] },
      settings: { themePreference: () => "light" },
      window: () => ({ isDestroyed: () => false, webContents: { send },
        setTitle: vi.fn(), setRepresentedFilename: vi.fn(), setDocumentEdited: vi.fn() }),
    } as unknown as ApplicationControllerOptions);
    controller.refresh();
    const action = menu.setApplicationMenu.mock.lastCall![0].flatMap(item =>
      Array.isArray(item.submenu) ? item.submenu : []).find(item => item.id === "file.new")!;
    (action.click as () => void)();
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(APP_CHANNELS.stateChanged, { reason: "recent" }));
    if (choice === "cancel") {
      expect(send.mock.calls).toEqual([[APP_CHANNELS.stateChanged, { reason: "recent" }]]);
      expect(service.current()).not.toBeNull();
    } else {
      expect(send.mock.calls).toEqual([
        [APP_CHANNELS.stateChanged, { reason: "closed", openNewProject: true }],
        [APP_CHANNELS.stateChanged, { reason: "recent" }],
      ]);
      expect(service.current()).toBeNull();
      expect(choice === "save" ? service.save : service.discardCurrent).toHaveBeenCalledOnce();
    }
  });
  it("chooses the file before touching the current project, so cancelling the picker changes nothing", async () => {
    const service = documents({ dirty: true, path: "/projects/current.lqp" });
    const ui = dialogs("discard", null);
    expect(await openProjectInteractive(service, ui)).toBeNull();
    expect(ui.confirmDirtyClose).not.toHaveBeenCalled();
    expect(service.discardCurrent).not.toHaveBeenCalled();
    expect(service.open).not.toHaveBeenCalled();
  });

  it("asks Salva / Non salvare / Annulla for a modified project and keeps it on Annulla", async () => {
    const service = documents({ dirty: true, path: "/projects/current.lqp" });
    const ui = dialogs("cancel");
    expect(await openProjectInteractive(service, ui)).toBeNull();
    expect(ui.confirmDirtyClose).toHaveBeenCalledWith("current.lqp");
    expect(service.open).not.toHaveBeenCalled();
    expect(service.current()).not.toBeNull();
  });

  it("discards or saves through the existing close flow before opening", async () => {
    const discarded = documents({ dirty: true, path: "/projects/current.lqp" });
    expect(await openProjectInteractive(discarded, dialogs("discard"))).toMatchObject({ documentName: "next.lqp" });
    expect(discarded.discardCurrent).toHaveBeenCalledOnce();
    const saved = documents({ dirty: true, path: "/projects/current.lqp" });
    expect(await openProjectInteractive(saved, dialogs("save"))).toMatchObject({ documentName: "next.lqp" });
    expect(saved.save).toHaveBeenCalledOnce();
    expect(saved.closeCurrent).toHaveBeenCalledOnce();
  });

  it("opens over an unmodified project without a prompt and keeps an already open file", async () => {
    const service = documents({ dirty: false, path: "/projects/current.lqp" });
    const ui = dialogs("cancel");
    expect(await openProjectInteractive(service, ui, "/projects/current.lqp")).toMatchObject({ documentName: "current.lqp" });
    expect(service.open).not.toHaveBeenCalled();
    await openProjectInteractive(service, ui, "/projects/other.lqp");
    expect(service.open).toHaveBeenCalledWith("/projects/other.lqp");
    expect(ui.confirmDirtyClose).not.toHaveBeenCalled();
  });

  it("prepares Nuovo progetto only after the modified project is saved or discarded", async () => {
    expect(await prepareProjectReplacement(documents(null), dialogs("cancel"))).toBe(true);
    expect(await prepareProjectReplacement(documents({ dirty: false, path: "/p.lqp" }), dialogs("cancel"))).toBe(true);
    const kept = documents({ dirty: true, path: "/p.lqp" });
    expect(await prepareProjectReplacement(kept, dialogs("cancel"))).toBe(false);
    expect(kept.current()).not.toBeNull();
    const discarded = documents({ dirty: true, path: "/p.lqp" });
    expect(await prepareProjectReplacement(discarded, dialogs("discard"))).toBe(true);
    expect(discarded.current()).toBeNull();
  });
});

describe("recent project IPC", () => {
  function setup(options: { readonly trusted?: boolean; readonly current?: { dirty: boolean; path: string } | null } = {}) {
    const root = mkdtempSync(path.join(tmpdir(), "librequadri-app-ipc-test-")); roots.push(root);
    const present = path.join(root, "present.lqp");
    const missing = path.join(root, "missing.lqp");
    writeFileSync(present, "project bytes");
    let entries: RecentProjectEntry[] = [present, missing].map((filename, index) => ({
      path: filename, projectUuid: `u${index}`, title: `P${index}`, lastOpenedAt: "2026-09-24T10:00:00.000Z",
      available: existsSync(filename),
    }));
    const recent = {
      list: vi.fn(() => entries),
      forget: vi.fn((filename: string) => { entries = entries.filter((entry) => entry.path !== filename); }),
    } as unknown as RecentProjectStore;
    const handlers = new Map<string, (event: ProjectInvokeEvent, ...args: unknown[]) => unknown>();
    const registry: ProjectIpcRegistry = {
      handle: (channel, listener) => { handlers.set(channel, listener); },
      removeHandler: (channel) => { handlers.delete(channel); },
    };
    const service = documents(options.current ?? null);
    const ui = dialogs("cancel");
    const lifecycle = new ProjectLifecycleOperationGuard();
    const afterChange = vi.fn();
    registerAppIpc(registry, { service, dialogs: ui, lifecycle, recent, handles: new RecentProjectHandles(),
      isTrustedSender: () => options.trusted ?? true, afterChange });
    const event: ProjectInvokeEvent = { senderFrame: {} };
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(event, ...args);
    return { root, present, missing, service, ui, lifecycle, afterChange, call, recent };
  }

  it("lists entries with opaque ids and no native paths", async () => {
    const { root, call } = setup();
    const views = await call(APP_CHANNELS.recentProjects) as RecentProjectView[];
    expect(views.map((entry) => [entry.documentName, entry.available])).toEqual([["present.lqp", true], ["missing.lqp", false]]);
    // Only a display folder label reaches the renderer: never a file path it could send back.
    expect(JSON.stringify(views)).not.toContain(path.join(root, "present.lqp"));
    expect(views.every((entry) => /^[0-9a-f-]{36}$/.test(entry.id))).toBe(true);
  });

  it("opens an entry through the lifecycle and refuses unknown ids and missing files", async () => {
    const { present, service, afterChange, call } = setup();
    const [available, gone] = await call(APP_CHANNELS.recentProjects) as RecentProjectView[];
    expect(() => call(APP_CHANNELS.openRecent, "../../etc/passwd")).toThrow("Voce recente non valida");
    expect(() => call(APP_CHANNELS.openRecent, "00000000-0000-4000-8000-000000000000")).toThrow("non è più disponibile");
    expect(() => call(APP_CHANNELS.openRecent, gone!.id)).toThrow("Puoi rimuoverlo dall'elenco");
    expect(service.open).not.toHaveBeenCalled();
    expect(await call(APP_CHANNELS.openRecent, available!.id)).toMatchObject({ documentName: "present.lqp" });
    expect(service.open).toHaveBeenCalledWith(present);
    expect(afterChange).toHaveBeenCalled();
  });

  it("does not bypass the dirty-project confirmation when opening a recent entry", async () => {
    const { ui, service, call } = setup({ current: { dirty: true, path: "/projects/current.lqp" } });
    const [available] = await call(APP_CHANNELS.recentProjects) as RecentProjectView[];
    expect(await call(APP_CHANNELS.openRecent, available!.id)).toBeNull();
    expect(ui.confirmDirtyClose).toHaveBeenCalledOnce();
    expect(service.open).not.toHaveBeenCalled();
  });

  it("refuses to run while another project operation is in progress", async () => {
    const { lifecycle, call } = setup();
    const [available] = await call(APP_CHANNELS.recentProjects) as RecentProjectView[];
    let finish!: () => void;
    const running = lifecycle.run(() => new Promise<void>((resolve) => { finish = resolve; }));
    await expect(call(APP_CHANNELS.openRecent, available!.id)).rejects.toBeInstanceOf(ProjectLifecycleBusyError);
    finish();
    await running;
  });

  it("forgets an entry without touching the file", async () => {
    const { present, recent, call } = setup();
    const [available] = await call(APP_CHANNELS.recentProjects) as RecentProjectView[];
    const remaining = await call(APP_CHANNELS.forgetRecent, available!.id) as RecentProjectView[];
    expect(recent.forget).toHaveBeenCalledWith(present);
    expect(remaining.map((entry) => entry.documentName)).toEqual(["missing.lqp"]);
    expect(existsSync(present)).toBe(true);
  });

  it("rejects untrusted senders", () => {
    const { call } = setup({ trusted: false });
    expect(() => call(APP_CHANNELS.recentProjects)).toThrow("Untrusted IPC sender");
  });
});

describe("native text undo IPC", () => {
  it("runs the sender's own undo/redo for a trusted sender and validates the command", () => {
    const handlers = new Map<string, (event: ProjectInvokeEvent, ...args: unknown[]) => unknown>();
    let trusted = true;
    registerAppIpc({ handle: (channel, listener) => { handlers.set(channel, listener); }, removeHandler: () => undefined },
      { service: documents(null), dialogs: dialogs("cancel"), lifecycle: new ProjectLifecycleOperationGuard(),
        recent: { list: () => [] } as unknown as RecentProjectStore, handles: new RecentProjectHandles(),
        isTrustedSender: () => trusted });
    const sender = { undo: vi.fn(), redo: vi.fn() };
    const call = (command: unknown) => handlers.get(APP_CHANNELS.nativeEdit)!({ senderFrame: {}, sender } as ProjectInvokeEvent, command);
    call("undo");
    call("redo");
    expect(sender.undo).toHaveBeenCalledTimes(1);
    expect(sender.redo).toHaveBeenCalledTimes(1);
    expect(() => call("selectAll")).toThrow("Comando di modifica non valido.");
    trusted = false;
    expect(() => call("undo")).toThrow("Untrusted IPC sender");
    expect(sender.undo).toHaveBeenCalledTimes(1);
  });
});
