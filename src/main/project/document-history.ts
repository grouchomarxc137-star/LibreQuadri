import Database from "better-sqlite3";

/**
 * Document undo/redo for a project working copy. Each history step holds a complete image of the
 * document tables (an SQLite serialization of the working copy), so undoing restores exactly a
 * state the document already had: quantities, placements, engineering snapshots, BOM rows and
 * annotations are never re-derived. History lives with the open session only; it is never
 * written to the .lqp file.
 *
 * Save bookkeeping (lqp_meta: revision, saved_at, …) and the migration journal are not document
 * content and are never restored.
 */
export const HISTORY_ENTRY_LIMIT = 100;
export const HISTORY_BYTE_LIMIT = 64 * 1024 * 1024;
const EXCLUDED_TABLES = new Set(["lqp_meta", "__drizzle_migrations"]);

export interface HistoryEntry {
  /** User-facing name of the action, e.g. "Sposta". */
  readonly label: string;
  /** The document image to restore when this entry is applied. */
  readonly image: Buffer;
  /** Content identity of that image (see ProjectDocumentService state ids). */
  readonly stateId: number;
}

export interface HistoryState {
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
}

export class DocumentHistory {
  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];

  state(): HistoryState {
    return { undoLabel: this.#undo.at(-1)?.label ?? null, redoLabel: this.#redo.at(-1)?.label ?? null };
  }
  peekUndo(): HistoryEntry | undefined { return this.#undo.at(-1); }
  peekRedo(): HistoryEntry | undefined { return this.#redo.at(-1); }
  /** A new action: its "before" image becomes undoable and anything redoable is forgotten. */
  record(entry: HistoryEntry): void {
    this.#undo.push(entry);
    this.#redo = [];
    this.trim();
  }
  /** The top undo entry was applied; `current` (the image it replaced) becomes redoable. */
  undone(current: HistoryEntry): void {
    this.#undo.pop();
    this.#redo.push(current);
    this.trim();
  }
  /** The top redo entry was applied; `current` (the image it replaced) becomes undoable again. */
  redone(current: HistoryEntry): void {
    this.#redo.pop();
    this.#undo.push(current);
    this.trim();
  }
  clear(): void { this.#undo = []; this.#redo = []; }
  /** The stacks as they are now; the returned function puts them back (used when an operation fails). */
  checkpoint(): () => void {
    const undo = [...this.#undo], redo = [...this.#redo];
    return () => { this.#undo = undo; this.#redo = redo; };
  }
  get bytes(): number {
    return [...this.#undo, ...this.#redo].reduce((total, entry) => total + entry.image.byteLength, 0);
  }

  /** Oldest undo steps go first; a single oversized step is not kept at all. */
  private trim(): void {
    while (this.#undo.length + this.#redo.length > HISTORY_ENTRY_LIMIT || this.bytes > HISTORY_BYTE_LIMIT) {
      if (this.#undo.length) this.#undo.shift();
      else this.#redo.shift();
    }
  }
}

/** The document tables of a project working copy, in name order. */
export function documentTables(db: Database.Database): string[] {
  const names = db.prepare(`SELECT name FROM main.sqlite_master WHERE type='table'
    AND name NOT LIKE 'sqlite_%' ORDER BY name`).pluck().all() as string[];
  return names.filter(name => !EXCLUDED_TABLES.has(name));
}

function columns(db: Database.Database, table: string): string[] {
  return (db.prepare(`SELECT name FROM pragma_table_info(?) ORDER BY cid`).pluck().all(table) as string[]);
}

const quoted = (name: string) => `"${name.replaceAll("\"", "\"\"")}"`;

/** A complete image of the working copy, consistent because the session owns the only connection. */
export function captureDocument(db: Database.Database): Buffer {
  if (db.inTransaction) throw new Error("Impossibile acquisire lo stato del progetto durante una transazione.");
  const image = db.serialize();
  // The working copy runs in WAL mode; its serialized header says so (file format bytes 18–19 = 2), and
  // an in-memory database cannot be opened in WAL mode. Mark the image as a rollback-journal database.
  image[18] = 1;
  image[19] = 1;
  return image;
}

/**
 * Replaces every document table with the rows of `image`, in one transaction. Row ids and storage
 * classes are kept exactly. Foreign keys are checked once, at commit, against the complete restored
 * state. `inside` runs in the same transaction after the rows are restored; if it throws, or anything
 * else fails, the working copy is left unchanged.
 */
export function restoreDocument(db: Database.Database, image: Buffer, inside: () => void = () => undefined): void {
  const source = new Database(image, { readonly: true });
  try {
    const tables = documentTables(db);
    const sourceTables = documentTables(source);
    if (JSON.stringify(tables) !== JSON.stringify(sourceTables) ||
      tables.some(table => JSON.stringify(columns(db, table)) !== JSON.stringify(columns(source, table))))
      throw new Error("Lo stato salvato nella cronologia non corrisponde allo schema del progetto.");
    db.transaction(() => {
      db.pragma("defer_foreign_keys = ON");
      for (const table of tables) db.prepare(`DELETE FROM ${quoted(table)}`).run();
      for (const table of tables) {
        const names = columns(db, table).map(quoted).join(",");
        const insert = db.prepare(`INSERT INTO ${quoted(table)}(${names}) VALUES (${columns(db, table).map(() => "?").join(",")})`);
        const rows = source.prepare(`SELECT ${names} FROM ${quoted(table)}`).safeIntegers(true).raw().iterate() as
          IterableIterator<unknown[]>;
        for (const row of rows) insert.run(row);
      }
      inside();
    })();
  } finally {
    source.close();
  }
}
