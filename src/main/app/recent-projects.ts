import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type Database from "better-sqlite3";

import { RECENT_PROJECTS_MAX, type RecentProjectView } from "../../shared/app.js";

export interface RecentProjectEntry {
  readonly path: string;
  readonly projectUuid: string;
  readonly title: string;
  readonly lastOpenedAt: string;
  readonly available: boolean;
}

export interface RecentProjectStoreOptions {
  readonly now?: () => Date;
  readonly fileExists?: (filename: string) => boolean;
  readonly limit?: number;
}

/**
 * The "Recenti" list (DATABASE_DESIGN §6, `app_recent_file`). It records
 * locations only: forgetting an entry never touches the project file, and a
 * missing file stays listed, flagged unavailable, until the user removes it.
 */
export class RecentProjectStore {
  readonly #database: Database.Database;
  readonly #now: () => Date;
  readonly #fileExists: (filename: string) => boolean;
  readonly #limit: number;

  constructor(database: Database.Database, options: RecentProjectStoreOptions = {}) {
    this.#database = database;
    this.#now = options.now ?? (() => new Date());
    this.#fileExists = options.fileExists ?? existsSync;
    this.#limit = options.limit ?? RECENT_PROJECTS_MAX;
  }

  touch(document: { readonly path: string; readonly projectUuid: string; readonly title: string }): void {
    const filename = path.resolve(document.path);
    this.#database.transaction(() => {
      this.#database.prepare(`INSERT INTO app_recent_file(path, project_uuid, title, last_opened_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET project_uuid = excluded.project_uuid,
          title = excluded.title, last_opened_at = excluded.last_opened_at`)
        .run(filename, document.projectUuid, document.title, this.#now().toISOString());
      this.#database.prepare(`DELETE FROM app_recent_file WHERE path NOT IN (
        SELECT path FROM app_recent_file ORDER BY last_opened_at DESC, path LIMIT ?)`).run(this.#limit);
    })();
  }

  list(): RecentProjectEntry[] {
    const rows = this.#database.prepare(`SELECT path, project_uuid AS projectUuid, title,
      last_opened_at AS lastOpenedAt FROM app_recent_file
      ORDER BY last_opened_at DESC, path LIMIT ?`).all(this.#limit) as Omit<RecentProjectEntry, "available">[];
    return rows.map((row) => ({ ...row, available: this.#fileExists(row.path) }));
  }

  forget(filename: string): void {
    this.#database.prepare("DELETE FROM app_recent_file WHERE path = ?").run(filename);
  }

  clear(): void {
    this.#database.prepare("DELETE FROM app_recent_file").run();
  }
}

/** Display-only folder label: the parent folder, with the home directory abbreviated to "~". */
export function recentFolderLabel(filename: string, homeDirectory = os.homedir()): string {
  const folder = path.dirname(filename);
  if (homeDirectory && (folder === homeDirectory || folder.startsWith(`${homeDirectory}${path.sep}`))) {
    return `~${folder.slice(homeDirectory.length)}`;
  }
  return folder;
}

/**
 * Opaque renderer handles for recent entries, following the destination-token
 * pattern of project IPC: main keeps the path, the renderer only gets an id.
 */
export class RecentProjectHandles {
  readonly #idByPath = new Map<string, string>();
  readonly #pathById = new Map<string, string>();

  views(entries: readonly RecentProjectEntry[], homeDirectory?: string): RecentProjectView[] {
    return entries.map((entry) => ({
      id: this.idFor(entry.path),
      title: entry.title,
      documentName: path.basename(entry.path),
      folderLabel: recentFolderLabel(entry.path, homeDirectory),
      lastOpenedAt: entry.lastOpenedAt,
      available: entry.available,
    }));
  }

  pathFor(id: string): string | undefined {
    return this.#pathById.get(id);
  }

  private idFor(filename: string): string {
    let id = this.#idByPath.get(filename);
    if (!id) {
      id = randomUUID();
      this.#idByPath.set(filename, id);
      this.#pathById.set(id, filename);
    }
    return id;
  }
}
