/**
 * Application-shell contract shared by the main process, the preload script
 * and the renderer: recent projects and native-menu events. Types and
 * constants only.
 */

export const APP_CHANNELS = {
  recentProjects: "app:recent-projects",
  openRecent: "app:open-recent",
  forgetRecent: "app:forget-recent",
  /** main → renderer: a native-menu command that needs renderer UI. */
  command: "app:command",
  /** main → renderer: the project or the recent list changed outside a renderer request. */
  stateChanged: "app:state-changed",
  /** renderer → main: run the web contents' native text undo/redo (a menu Annulla aimed at a text field). */
  nativeEdit: "app:native-edit",
} as const;

export const APP_COMMANDS = [
  "design:devices",
  "design:enclosures",
  "design:panels",
  "document:distinta",
  "project:new",
  "project:properties",
  "project:engineering",
  "listino:update",
  "listino:unclassified",
  "listino:brands",
  /** Annulla / Ripeti from the native menu: the renderer routes it to a text field or to the document. */
  "edit:undo",
  "edit:redo",
] as const;
export type AppCommand = (typeof APP_COMMANDS)[number];

export type AppStateChangeReason = "opened" | "saved" | "closed" | "recent" | "catalogue";
export type AppStateChange =
  | { readonly reason: "closed"; readonly openNewProject?: boolean }
  | { readonly reason: Exclude<AppStateChangeReason, "closed"> };

/**
 * A "Recenti" entry as the renderer sees it. `id` is an opaque handle that
 * main maps back to the file; the renderer never receives or sends a path.
 */
export interface RecentProjectView {
  readonly id: string;
  readonly title: string;
  readonly documentName: string;
  /** Display-only folder name, abbreviated; never accepted back by main. */
  readonly folderLabel: string;
  /** ISO timestamp. */
  readonly lastOpenedAt: string;
  /** False when the file no longer exists at the remembered location. */
  readonly available: boolean;
}

export const RECENT_PROJECTS_MAX = 15;

export interface AppApi {
  recentProjects(): Promise<readonly RecentProjectView[]>;
  /** Opens the entry through the normal project lifecycle; null when the user cancelled. */
  openRecent(id: string): Promise<import("./project.js").ProjectDocumentView | null>;
  /** Removes the entry from the list. The file itself is never touched. */
  forgetRecent(id: string): Promise<readonly RecentProjectView[]>;
  onCommand(listener: (command: AppCommand) => void): () => void;
  onStateChanged(listener: (change: AppStateChange) => void): () => void;
  /** Native undo/redo of the focused text field (Electron webContents.undo/redo). */
  nativeEdit(command: "undo" | "redo"): Promise<void>;
}
