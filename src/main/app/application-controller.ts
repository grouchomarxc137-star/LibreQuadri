import path from "node:path";

import { dialog, Menu, nativeTheme, type BrowserWindow } from "electron";

import { APP_CHANNELS, type AppCommand, type AppStateChange } from "../../shared/app.js";
import type { ProjectDocumentService } from "../project/project-document-service.js";
import {
  openProjectInteractive,
  prepareProjectReplacement,
  ProjectLifecycleBusyError,
  requestProjectClose,
  saveProjectWithDialogs,
  type ProjectFileDialogs,
  type ProjectLifecycleOperationGuard,
} from "../project/project-ipc.js";
import { buildApplicationMenuTemplate, type ApplicationMenuActions } from "./app-menu.js";
import { nextZoomLevel, type AppSettingsStore, type ThemePreference, type ZoomDirection } from "./app-settings.js";
import type { RecentProjectStore } from "./recent-projects.js";

export interface ApplicationControllerOptions {
  readonly applicationName: string;
  readonly development: boolean;
  /** Internal Alpha 0 restriction; saved preferences remain intact. */
  readonly lightOnly?: boolean;
  /** Keep native menu writes and dialog switches away from an active catalogue import. */
  readonly catalogueImporting?: () => boolean;
  readonly service: ProjectDocumentService;
  readonly dialogs: ProjectFileDialogs;
  readonly lifecycle: ProjectLifecycleOperationGuard;
  readonly settings: AppSettingsStore;
  readonly recent: RecentProjectStore;
  readonly window: () => BrowserWindow | undefined;
}

/**
 * Owns the native menu and the window chrome state (title, edited marker,
 * theme, zoom). Menu lifecycle commands run here, through the same project
 * lifecycle functions and operation guard as the renderer's IPC requests;
 * the renderer is only told that the state changed.
 */
export class ApplicationController {
  readonly #options: ApplicationControllerOptions;

  constructor(options: ApplicationControllerOptions) {
    this.#options = options;
  }

  /** Applies the effective theme; call before the first window is created. */
  applyTheme(): void {
    nativeTheme.themeSource = this.#options.lightOnly ? "light" : this.#options.settings.themePreference();
  }

  attachWindow(window: BrowserWindow): void {
    // The window title follows the project, not the renderer document.
    window.on("page-title-updated", (event) => event.preventDefault());
    window.webContents.on("did-finish-load", () => {
      window.webContents.setZoomLevel(this.#options.settings.zoomLevel());
      this.refresh();
    });
  }

  /** Rebuilds the menu and window chrome from the current project and preferences. */
  refresh(): void {
    const { service, settings, recent, applicationName } = this.#options;
    const summary = service.currentSummary();
    const entries = recent.list();
    const template = buildApplicationMenuTemplate({
      platform: process.platform,
      applicationName,
      projectOpen: summary !== null,
      canSave: summary !== null && (summary.dirty || summary.targetPath === null),
      recent: entries.map((entry) => ({
        label: `${entry.title} (${path.basename(entry.path)})`, path: entry.path, available: entry.available,
      })),
      theme: settings.themePreference(),
      lightOnly: this.#options.lightOnly,
      development: this.#options.development,
      undoLabel: summary?.undoLabel ?? null,
      redoLabel: summary?.redoLabel ?? null,
    }, this.actions());
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));

    const window = this.#options.window();
    if (!window || window.isDestroyed()) return;
    window.setTitle(summary ? `${summary.title} — ${applicationName}` : applicationName);
    if (process.platform === "darwin") {
      window.setRepresentedFilename(summary?.targetPath ?? "");
      window.setDocumentEdited(summary?.dirty ?? false);
    }
  }

  private actions(): ApplicationMenuActions {
    const { service, dialogs } = this.#options;
    return {
      newProject: () => this.runLifecycle(async () => {
        const hadProject = service.current() !== null;
        if (!await prepareProjectReplacement(service, dialogs)) return;
        if (hadProject && service.current() === null) this.notify({ reason: "closed", openNewProject: true });
        else this.command("project:new");
      }),
      openProject: () => this.runLifecycle(async () => {
        if (await openProjectInteractive(service, dialogs)) this.notify({ reason: "opened" });
      }),
      openRecent: (filename) => this.runLifecycle(async () => {
        if (await openProjectInteractive(service, dialogs, filename)) this.notify({ reason: "opened" });
      }),
      clearRecent: () => {
        if(this.#options.catalogueImporting?.())return;
        this.#options.recent.clear();
        this.notify({ reason: "recent" });
        this.refresh();
      },
      closeProject: () => this.runLifecycle(async () => {
        if (await requestProjectClose(service, dialogs) === null) this.notify({ reason: "closed" });
      }),
      saveProject: () => this.runLifecycle(async () => {
        if ((await saveProjectWithDialogs(service, dialogs)).completed) this.notify({ reason: "saved" });
      }),
      saveProjectAs: () => this.runLifecycle(async () => {
        if ((await saveProjectWithDialogs(service, dialogs, true)).completed) this.notify({ reason: "saved" });
      }),
      command: (command) => this.command(command),
      zoom: (direction) => this.zoom(direction),
      setTheme: (theme) => this.setTheme(theme),
    };
  }

  private runLifecycle(task: () => Promise<void>): void {
    if(this.#options.catalogueImporting?.())return;
    void this.#options.lifecycle.run(task).catch(async (error: unknown) => {
      await this.showMessage(error instanceof ProjectLifecycleBusyError
        ? { type: "info", title: "Operazione progetto in corso", message: "Attendi il completamento dell’operazione sul progetto." }
        : { type: "error", title: "Operazione non riuscita", message: error instanceof Error ? error.message : String(error) });
    }).finally(() => {
      // A cancelled or failed operation may still have changed the document state.
      this.notify({ reason: "recent" });
      this.refresh();
    });
  }

  private zoom(direction: ZoomDirection): void {
    if(this.#options.catalogueImporting?.())return;
    const { settings } = this.#options;
    const level = settings.setZoomLevel(nextZoomLevel(settings.zoomLevel(), direction));
    this.#options.window()?.webContents.setZoomLevel(level);
  }

  private setTheme(theme: ThemePreference): void {
    if(this.#options.catalogueImporting?.())return;
    if (this.#options.lightOnly) return;
    this.#options.settings.setThemePreference(theme);
    nativeTheme.themeSource = theme;
    this.refresh();
  }

  private command(command: AppCommand): void {
    if(this.#options.catalogueImporting?.())return;
    this.send(APP_CHANNELS.command, command);
  }

  private notify(change: AppStateChange): void {
    this.send(APP_CHANNELS.stateChanged, change);
  }

  private send(channel: string, payload: unknown): void {
    const window = this.#options.window();
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  }

  private async showMessage(options: { type: "info" | "error"; title: string; message: string }): Promise<void> {
    const window = this.#options.window();
    const box = { ...options, buttons: ["OK"] };
    if (window && !window.isDestroyed()) await dialog.showMessageBox(window, box);
    else await dialog.showMessageBox(box);
  }
}
