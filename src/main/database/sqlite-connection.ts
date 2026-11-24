import Database from "better-sqlite3";

export type DatabaseKind = "lq" | "raw" | "project-working-copy";

export interface OpenDatabaseOptions {
  readonly kind: DatabaseKind;
  readonly checkIntegrity?: boolean;
}

export function assertQuickCheck(database: Database.Database): void {
  const result = database.pragma("quick_check", { simple: true });
  if (result !== "ok") {
    throw new Error(`SQLite quick_check failed: ${String(result)}`);
  }
}

export function assertIntegrityCheck(database: Database.Database): void {
  const result = database.pragma("integrity_check", { simple: true });
  if (result !== "ok") {
    throw new Error(`SQLite integrity_check failed: ${String(result)}`);
  }
}

export function applyConnectionPragmas(
  database: Database.Database,
  kind: DatabaseKind,
): void {
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = NORMAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.pragma("temp_store = MEMORY");

  if (kind === "lq") {
    database.pragma("cache_size = -65536");
  }
}

export function openConfiguredDatabase(
  filename: string,
  options: OpenDatabaseOptions,
): Database.Database {
  const database = new Database(filename);

  try {
    if (options.checkIntegrity) {
      assertQuickCheck(database);
    }
    applyConnectionPragmas(database, options.kind);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function closeConfiguredDatabase(database: Database.Database): void {
  try {
    database.pragma("optimize");
  } finally {
    database.close();
  }
}
