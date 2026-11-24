import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

import {
  assertCompatibleMigrationHistory,
  ForeignKeyValidationError,
} from "./lq-migrations.js";
import { openConfiguredDatabase } from "./sqlite-connection.js";

interface ForeignKeyViolationRow {
  readonly table: string;
  readonly rowid: number | null;
  readonly parent: string;
  readonly fkid: number;
}

export interface OpenMigratedRawDatabaseOptions {
  readonly databaseFilename: string;
  readonly migrationsFolder: string;
}

/**
 * Opens the rebuildable raw database only when the import path explicitly asks
 * for it. Normal application startup must continue to open lq.db alone.
 */
export function openMigratedRawDatabase(
  options: OpenMigratedRawDatabaseOptions,
): Database.Database {
  mkdirSync(path.dirname(options.databaseFilename), { recursive: true });
  const database = openConfiguredDatabase(options.databaseFilename, {
    kind: "raw",
    checkIntegrity: true,
  });

  try {
    const bundledMigrations = readMigrationFiles({
      migrationsFolder: options.migrationsFolder,
    });
    assertCompatibleMigrationHistory(database, bundledMigrations);

    if (database.inTransaction) {
      throw new Error("Cannot start raw migrations inside a transaction");
    }
    database.pragma("foreign_keys = OFF");
    if (database.pragma("foreign_keys", { simple: true }) !== 0) {
      throw new Error("Could not disable foreign keys for raw migrations");
    }

    let migrationError: unknown;
    try {
      migrate(drizzle(database), {
        migrationsFolder: options.migrationsFolder,
      });
      const violations = database.pragma(
        "foreign_key_check",
      ) as ForeignKeyViolationRow[];
      if (violations.length > 0) {
        throw new ForeignKeyValidationError(violations);
      }
    } catch (error) {
      migrationError = error;
      throw error;
    } finally {
      database.pragma("foreign_keys = ON");
      if (
        database.pragma("foreign_keys", { simple: true }) !== 1 &&
        migrationError === undefined
      ) {
        throw new Error("Could not restore foreign keys after raw migrations");
      }
    }

    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
