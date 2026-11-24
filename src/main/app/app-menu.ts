import type { MenuItemConstructorOptions } from "electron";

import type { AppCommand } from "../../shared/app.js";
import type { ThemePreference, ZoomDirection } from "./app-settings.js";

/*
 * The native application menu (macOS menu bar, Windows/Linux window menu).
 * Pure: it only describes the menu from the application state, so the
 * structure, enabled states and accelerators are testable without Electron.
 * Lifecycle commands (New, Open, Save, Close) run in the main process through
 * the existing project lifecycle; commands that need renderer UI are
 * forwarded as AppCommands.
 */

export interface ApplicationMenuState {
  readonly platform: NodeJS.Platform;
  readonly applicationName: string;
  readonly projectOpen: boolean;
  /** True when Salva can write something: the project is modified or has no saved location yet. */
  readonly canSave: boolean;
  readonly recent: readonly { readonly label: string; readonly path: string; readonly available: boolean }[];
  readonly theme: ThemePreference;
  readonly lightOnly?: boolean;
  readonly development: boolean;
  /** The document actions Annulla / Ripeti would revert or reapply; shown in the item labels. */
  readonly undoLabel?: string | null;
  readonly redoLabel?: string | null;
}

export interface ApplicationMenuActions {
  newProject(): void;
  openProject(): void;
  openRecent(filename: string): void;
  clearRecent(): void;
  closeProject(): void;
  saveProject(): void;
  saveProjectAs(): void;
  command(command: AppCommand): void;
  zoom(direction: ZoomDirection): void;
  setTheme(theme: ThemePreference): void;
}

export const RECENT_MENU_LIMIT = 10;

const separator: MenuItemConstructorOptions = { type: "separator" };

export function buildApplicationMenuTemplate(
  state: ApplicationMenuState,
  actions: ApplicationMenuActions,
): MenuItemConstructorOptions[] {
  const mac = state.platform === "darwin";
  const project = state.projectOpen;
  const recent = state.recent.slice(0, RECENT_MENU_LIMIT);

  const file: MenuItemConstructorOptions = {
    id: "file", label: "File",
    submenu: [
      { id: "file.new", label: "Nuovo progetto…", accelerator: "CmdOrCtrl+N", click: () => actions.newProject() },
      { id: "file.open", label: "Apri…", accelerator: "CmdOrCtrl+O", click: () => actions.openProject() },
      {
        id: "file.recent", label: "Apri recente", enabled: recent.length > 0,
        submenu: recent.length === 0 ? [{ label: "Nessun progetto recente", enabled: false }] : [
          ...recent.map((entry): MenuItemConstructorOptions => ({
            label: entry.available ? entry.label : `${entry.label} (file non trovato)`,
            enabled: entry.available,
            click: () => actions.openRecent(entry.path),
          })),
          separator,
          { id: "file.recent.clear", label: "Cancella elenco", click: () => actions.clearRecent() },
        ],
      },
      separator,
      { id: "file.close", label: "Chiudi progetto", accelerator: "CmdOrCtrl+W", enabled: project, click: () => actions.closeProject() },
      separator,
      { id: "file.save", label: "Salva", accelerator: "CmdOrCtrl+S", enabled: project && state.canSave, click: () => actions.saveProject() },
      { id: "file.saveAs", label: "Salva con nome…", accelerator: "Shift+CmdOrCtrl+S", enabled: project, click: () => actions.saveProjectAs() },
      ...(mac ? [] : [separator, { id: "file.quit", label: "Esci", role: "quit", accelerator: "Ctrl+Q" } satisfies MenuItemConstructorOptions]),
    ],
  };

  // Annulla / Ripeti are always enabled: with nothing to undo in the document they still serve the
  // focused text field. The renderer decides which (see src/renderer/app/edit-commands.ts). On macOS
  // the accelerators are the keyboard path; elsewhere the renderer takes the keys itself, so the
  // shortcuts are only displayed and a keystroke is never handled twice.
  const undoLabel = project && state.undoLabel ? `Annulla ${state.undoLabel}` : "Annulla";
  const redoLabel = project && state.redoLabel ? `Ripeti ${state.redoLabel}` : "Ripeti";
  const edit: MenuItemConstructorOptions = {
    id: "edit", label: "Modifica",
    submenu: [
      { id: "edit.undo", label: undoLabel, accelerator: "CmdOrCtrl+Z", registerAccelerator: mac,
        click: () => actions.command("edit:undo") },
      { id: "edit.redo", label: redoLabel, accelerator: mac ? "Shift+CmdOrCtrl+Z" : "Ctrl+Y", registerAccelerator: mac,
        click: () => actions.command("edit:redo") },
      separator,
      { role: "cut", label: "Taglia" },
      { role: "copy", label: "Copia" },
      { role: "paste", label: "Incolla" },
      { role: "selectAll", label: "Seleziona tutto" },
    ],
  };

  const projectMenu: MenuItemConstructorOptions = {
    id: "project", label: "Progetto",
    submenu: [
      { id: "project.devices", label: "Apparecchi", accelerator: "CmdOrCtrl+1", enabled: project, click: () => actions.command("design:devices") },
      { id: "project.enclosures", label: "Carpenterie", accelerator: "CmdOrCtrl+2", enabled: project, click: () => actions.command("design:enclosures") },
      { id: "project.panels", label: "Pannelli", accelerator: "CmdOrCtrl+3", enabled: project, click: () => actions.command("design:panels") },
      { id: "project.distinta", label: "Distinta…", enabled: project, click: () => actions.command("document:distinta") },
      separator,
      { id: "project.engineering", label: "Verifica dati di ingegneria…", enabled: project, click: () => actions.command("project:engineering") },
      { id: "project.properties", label: "Proprietà progetto…", accelerator: "CmdOrCtrl+I", enabled: project, click: () => actions.command("project:properties") },
    ],
  };

  const listino: MenuItemConstructorOptions = {
    id: "listino", label: "Listino",
    submenu: [
      { id: "listino.update", label: "Aggiorna listino…", click: () => actions.command("listino:update") },
      { id: "listino.brands", label: "Gestisci marchi…", click: () => actions.command("listino:brands") },
      { id: "listino.unclassified", label: "Famiglie da classificare…", click: () => actions.command("listino:unclassified") },
    ],
  };

  const themeItem = (theme: ThemePreference, label: string): MenuItemConstructorOptions => ({
    id: `view.theme.${theme}`, label, type: "radio", checked: state.theme === theme, click: () => actions.setTheme(theme),
  });
  const view: MenuItemConstructorOptions = {
    id: "view", label: "Vista",
    submenu: [
      { id: "view.zoomIn", label: "Ingrandisci", accelerator: "CmdOrCtrl+=", click: () => actions.zoom("in") },
      // Same command for keyboards and keypads that send "+" rather than "=".
      { id: "view.zoomInPlus", label: "Ingrandisci", accelerator: "CmdOrCtrl+Plus", visible: false, acceleratorWorksWhenHidden: true, click: () => actions.zoom("in") },
      { id: "view.zoomOut", label: "Riduci", accelerator: "CmdOrCtrl+-", click: () => actions.zoom("out") },
      { id: "view.zoomReset", label: "Dimensione reale", accelerator: "CmdOrCtrl+0", click: () => actions.zoom("reset") },
      ...(state.lightOnly ? [] : [separator, {
        id: "view.theme", label: "Tema",
        submenu: [themeItem("light", "Chiaro"), themeItem("dark", "Scuro"), themeItem("system", "Come il sistema")],
      } satisfies MenuItemConstructorOptions]),
      ...(state.development ? [
        separator,
        { role: "reload", label: "Ricarica" } satisfies MenuItemConstructorOptions,
        { role: "toggleDevTools", label: "Strumenti per sviluppatori" } satisfies MenuItemConstructorOptions,
      ] : []),
    ],
  };

  if (!mac) {
    const help: MenuItemConstructorOptions = {
      id: "help", label: "Aiuto",
      submenu: [{ role: "about", label: `Informazioni su ${state.applicationName}` }],
    };
    return [file, edit, projectMenu, listino, view, help];
  }

  const application: MenuItemConstructorOptions = {
    id: "app", label: state.applicationName,
    submenu: [
      { role: "about", label: `Informazioni su ${state.applicationName}` },
      separator,
      { role: "services", label: "Servizi" },
      separator,
      { role: "hide", label: `Nascondi ${state.applicationName}` },
      { role: "hideOthers", label: "Nascondi altre" },
      { role: "unhide", label: "Mostra tutte" },
      separator,
      { role: "quit", label: `Esci da ${state.applicationName}` },
    ],
  };
  const window: MenuItemConstructorOptions = {
    id: "window", label: "Finestra", role: "window",
    submenu: [
      { role: "minimize", label: "Contrai" },
      { role: "zoom", label: "Ridimensiona" },
      separator,
      { role: "front", label: "Porta tutto in primo piano" },
    ],
  };
  return [application, file, edit, projectMenu, listino, view, window];
}
