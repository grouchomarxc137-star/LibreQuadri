import Database from "better-sqlite3";

/** Keep driver codes and nested parser/filesystem causes visible in CLI diagnostics. */
export function describeEngineeringSyncError(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  while (error !== undefined && !seen.has(error)) {
    seen.add(error);
    const message = error instanceof Error ? error.message : String(error);
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : null;
    const detail = code ? `${code}: ${message}` : message;
    if (!parts.some(part => part.includes(detail))) parts.push(detail);
    error = error instanceof Error ? error.cause : undefined;
  }
  return parts.join("; caused by: ");
}

/**
 * Acquire before the first database read (including journal_mode). WAL's shared
 * connection lock must be upgraded before this connection joins the WAL index.
 * BEGIN EXCLUSIVE alone in NORMAL locking mode does NOT exclude WAL readers.
 * EXCLUSIVE locking mode retains the OS locks across COMMIT, backup and awaits.
 */
export function openExclusiveCatalogue(filename: string): Database.Database {
  let database: Database.Database | undefined;
  try {
    database = new Database(filename, { fileMustExist: true, timeout: 0 });
    if (database.pragma("locking_mode = EXCLUSIVE", { simple: true }) !== "exclusive") {
      throw new Error("SQLite did not enable exclusive locking");
    }
    database.exec("BEGIN EXCLUSIVE; COMMIT");
    const journal = database.pragma("journal_mode", { simple: true });
    if (journal !== "wal") {
      throw new Error(`Unsupported catalogue journal mode: ${String(journal)}. Engineering sync requires existing WAL mode`);
    }
    database.pragma("foreign_keys = ON");
    database.pragma("synchronous = NORMAL");
    database.pragma("temp_store = MEMORY");
    database.pragma("cache_size = -65536");
    return database;
  } catch (cause) {
    database?.close();
    const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
    const context = /^SQLITE_(BUSY|LOCKED)(_|$)/.test(code)
      ? "Cannot exclusively access catalogue. Close Electron and all catalogue readers/importers"
      : "Cannot safely open catalogue";
    throw new Error(`${context}: ${describeEngineeringSyncError(cause)}. No import was started.`, { cause });
  }
}
