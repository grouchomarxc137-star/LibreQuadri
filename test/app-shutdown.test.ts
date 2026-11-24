import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const appHandlers = new Map<string, ((...args: unknown[]) => void)[]>();
  let currentProject: object | null = null;
  let closeResult: Promise<object | null> = Promise.resolve(null);
  let databaseClosed = false;

  const databaseClose = vi.fn(() => { databaseClosed = true; });
  const documentClose = vi.fn();
  const refresh = vi.fn(() => {
    if (databaseClosed) throw new TypeError("The database connection is not open");
  });
  const requestProjectClose = vi.fn(() => closeResult);

  const app = {
    isPackaged: false,
    getVersion: vi.fn(() => "0.1.0-test"),
    getAppPath: vi.fn(() => "/app"),
    getPath: vi.fn(() => "/private/tmp/lq-shutdown-test"),
    requestSingleInstanceLock: vi.fn(() => true),
    whenReady: vi.fn(() => Promise.resolve()),
    setAboutPanelOptions: vi.fn(),
    exit: vi.fn(),
    on: vi.fn((name: string, listener: (...args: unknown[]) => void) => {
      const listeners = appHandlers.get(name) ?? [];
      listeners.push(listener);
      appHandlers.set(name, listeners);
    }),
    quit: vi.fn(() => {
      const event = { preventDefault: vi.fn() };
      for (const listener of appHandlers.get("before-quit") ?? []) listener(event);
      return event;
    }),
  };

  const documents = {
    current: vi.fn(() => currentProject),
    close: documentClose,
    recoveries: vi.fn(() => []),
  };
  const database = {
    close: databaseClose,
    settings: {},
    recentProjects: {},
  };
  const controller = { applyTheme: vi.fn(), attachWindow: vi.fn(), refresh };
  const window = {
    on: vi.fn(),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
  };

  return {
    app,
    controller,
    database,
    documents,
    requestProjectClose,
    window,
    setCurrentProject(project: object | null) { currentProject = project; },
    setCloseResult(result: Promise<object | null>) { closeResult = result; },
    databaseClosed: () => databaseClosed,
    reset() {
      appHandlers.clear();
      currentProject = null;
      closeResult = Promise.resolve(null);
      databaseClosed = false;
      for (const mock of [databaseClose, documentClose, refresh, requestProjectClose,
        app.getVersion, app.getAppPath, app.getPath, app.requestSingleInstanceLock, app.whenReady,
        app.setAboutPanelOptions, app.exit, app.on, app.quit, documents.current, documents.recoveries,
        controller.applyTheme, controller.attachWindow, window.on, window.isMinimized, window.restore, window.focus]) {
        mock.mockClear();
      }
    },
  };
});

vi.mock("electron", () => ({
  app: harness.app,
  BrowserWindow: class {},
  dialog: { showMessageBox: vi.fn(), showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showErrorBox: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  nativeTheme: { themeSource: "system" },
  session: { defaultSession: { setPermissionRequestHandler: vi.fn() } },
}));

vi.mock("../src/main/data-paths.js", () => ({
  APPLICATION_NAME: "LibreQuadri",
  applicationPaths: () => ({
    lqDatabase: "/private/tmp/lq-shutdown-test/lq.db",
    working: "/private/tmp/lq-shutdown-test/working",
    incoming: "/private/tmp/lq-shutdown-test/incoming",
    projectBackups: "/private/tmp/lq-shutdown-test/backups",
  }),
  configureApplicationDataPath: vi.fn(),
}));
vi.mock("../src/main/database/database-service.js", () => ({
  MainDatabaseService: { initialize: vi.fn(() => harness.database) },
}));
vi.mock("../src/main/catalogue/category-startup.js", () => ({ initializeCategorySeed: vi.fn(async () => undefined) }));
vi.mock("../src/main/project/project-document-service.js", () => ({
  ProjectDocumentService: class { constructor() { return harness.documents; } },
}));
vi.mock("../src/main/project/project-ipc.js", () => {
  class ProjectLifecycleBusyError extends Error {}
  class ProjectLifecycleOperationGuard {
    #pending = false;

    run<T>(task: () => Promise<T>): Promise<T> {
      if (this.#pending) return Promise.reject(new ProjectLifecycleBusyError());
      this.#pending = true;
      return Promise.resolve().then(task).finally(() => { this.#pending = false; });
    }
  }
  return {
    ProjectLifecycleBusyError,
    ProjectLifecycleOperationGuard,
    registerProjectIpc: vi.fn(),
    requestProjectClose: harness.requestProjectClose,
    sanitizeProjectFilename: (name: string) => `${name}.lqp`,
  };
});
vi.mock("../src/main/app/application-controller.js", () => ({
  ApplicationController: class { constructor() { return harness.controller; } },
}));
vi.mock("../src/main/window.js", () => ({ createMainWindow: vi.fn(() => harness.window) }));
vi.mock("../src/main/renderer-location.js", () => ({
  isTrustedRendererFrame: vi.fn(() => true),
  rendererLocation: vi.fn(() => ({ indexUrl: "file:///app/index.html" })),
}));
vi.mock("../src/main/catalogue/catalogue-ipc.js", () => ({ registerCatalogueIpc: vi.fn() }));
vi.mock("../src/main/catalogue/configuration-ipc.js", () => ({ registerConfigurationIpc: vi.fn() }));
vi.mock("../src/main/documents/pdf-ipc.js", () => ({ registerPdfIpc: vi.fn() }));
vi.mock("../src/main/documents/pdf-service.js", () => ({ ProjectPdfService: class {} }));
vi.mock("../src/main/app/app-ipc.js", () => ({ registerAppIpc: vi.fn() }));
vi.mock("../src/main/app/recent-projects.js", () => ({ RecentProjectHandles: class {} }));

async function startMain(): Promise<void> {
  await import("../src/main/index.js");
  await vi.waitFor(() => expect(harness.controller.refresh).toHaveBeenCalledOnce());
  harness.controller.refresh.mockClear();
}

beforeEach(() => {
  vi.resetModules();
  harness.reset();
});

describe("application shutdown", () => {
  it("closes resources directly without refreshing when no project is open", async () => {
    await startMain();

    harness.app.quit();
    harness.app.quit();

    expect(harness.requestProjectClose).not.toHaveBeenCalled();
    expect(harness.documents.close).toHaveBeenCalledOnce();
    expect(harness.database.close).toHaveBeenCalledOnce();
    expect(harness.databaseClosed()).toBe(true);
    expect(harness.controller.refresh).not.toHaveBeenCalled();
  });

  it("coalesces repeated quit requests and never refreshes after an approved quit closes the database", async () => {
    const project = { dirty: true };
    let finish!: (value: object | null) => void;
    harness.setCurrentProject(project);
    harness.setCloseResult(new Promise((resolve) => { finish = resolve; }));
    await startMain();

    const first = harness.app.quit();
    const repeated = harness.app.quit();
    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(repeated.preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(harness.requestProjectClose).toHaveBeenCalledOnce());
    expect(harness.database.close).not.toHaveBeenCalled();

    finish(null);
    await vi.waitFor(() => expect(harness.app.quit).toHaveBeenCalledTimes(3));

    expect(harness.requestProjectClose).toHaveBeenCalledOnce();
    expect(harness.app.quit).toHaveBeenCalledTimes(3);
    expect(harness.documents.close).toHaveBeenCalledOnce();
    expect(harness.database.close).toHaveBeenCalledOnce();
    expect(harness.controller.refresh).not.toHaveBeenCalled();
  });

  it("keeps the project and refreshes the running application after quit is cancelled", async () => {
    const project = { dirty: true };
    harness.setCurrentProject(project);
    harness.setCloseResult(Promise.resolve(project));
    await startMain();

    const event = harness.app.quit();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(harness.controller.refresh).toHaveBeenCalledOnce());

    expect(harness.requestProjectClose).toHaveBeenCalledOnce();
    expect(harness.documents.close).not.toHaveBeenCalled();
    expect(harness.database.close).not.toHaveBeenCalled();
    expect(harness.databaseClosed()).toBe(false);
    expect(harness.controller.refresh).toHaveBeenCalledOnce();
    expect(harness.documents.current()).toBe(project);
  });
});
