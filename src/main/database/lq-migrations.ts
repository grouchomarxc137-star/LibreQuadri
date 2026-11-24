import {
  copyFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  readMigrationFiles,
  type MigrationMeta,
} from "drizzle-orm/migrator";

import {
  assertQuickCheck,
  openConfiguredDatabase,
} from "./sqlite-connection.js";

const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations";

interface AppliedMigrationRow {
  readonly hash: unknown;
  readonly created_at: unknown;
}

interface ForeignKeyViolationRow {
  readonly table: string;
  readonly rowid: number | null;
  readonly parent: string;
  readonly fkid: number;
}

export interface OpenMigratedLqDatabaseOptions {
  readonly databaseFilename: string;
  readonly backupDirectory: string;
  readonly migrationsFolder: string;
  readonly now?: Date;
}

export interface LqMigrationFailureOptions {
  readonly backupPath: string;
  readonly cause: unknown;
  readonly restoreFailure?: unknown;
}

export class LqMigrationFailure extends Error {
  readonly backupPath: string;
  readonly restoreFailure?: unknown;

  constructor(options: LqMigrationFailureOptions) {
    const causeMessage =
      options.cause instanceof Error ? options.cause.message : String(options.cause);
    const restorationMessage = options.restoreFailure
      ? ` Backup restoration also failed: ${
          options.restoreFailure instanceof Error
            ? options.restoreFailure.message
            : String(options.restoreFailure)
        }`
      : " The verified pre-migration backup was restored.";

    super(`lq.db migration failed: ${causeMessage}.${restorationMessage}`, {
      cause: options.cause,
    });
    this.name = "LqMigrationFailure";
    this.backupPath = options.backupPath;
    this.restoreFailure = options.restoreFailure;
  }
}

export class IncompatibleMigrationHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompatibleMigrationHistoryError";
  }
}

export class ForeignKeyValidationError extends Error {
  readonly violations: readonly ForeignKeyViolationRow[];

  constructor(violations: readonly ForeignKeyViolationRow[]) {
    const details = violations
      .map(
        (violation) =>
          `${violation.table}(rowid=${String(violation.rowid)}) -> ${
            violation.parent
          }[fkid=${violation.fkid}]`,
      )
      .join(", ");
    super(`PRAGMA foreign_key_check found violations: ${details}`);
    this.name = "ForeignKeyValidationError";
    this.violations = violations;
  }
}

function migrationTableExists(database: Database.Database): boolean {
  return Boolean(
    database
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ? LIMIT 1",
      )
      .get(DRIZZLE_MIGRATIONS_TABLE),
  );
}

/**
 * Drizzle SQLite currently records every applied migration as (hash, created_at),
 * while its own migrator only consults the newest created_at value. An exact
 * prefix comparison supplies the application-level downgrade/rewrite protection.
 */
export function assertCompatibleMigrationHistory(
  database: Database.Database,
  bundledMigrations: readonly MigrationMeta[],
): void {
  if (!migrationTableExists(database)) {
    return;
  }

  let appliedMigrations: readonly AppliedMigrationRow[];
  try {
    appliedMigrations = database
      .prepare(
        `SELECT hash, created_at FROM ${DRIZZLE_MIGRATIONS_TABLE} ORDER BY created_at ASC, rowid ASC`,
      )
      .all() as AppliedMigrationRow[];
  } catch (error) {
    throw new IncompatibleMigrationHistoryError(
      `The ${DRIZZLE_MIGRATIONS_TABLE} table is not compatible with this application: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (appliedMigrations.length > bundledMigrations.length) {
    throw new IncompatibleMigrationHistoryError(
      `The database has ${appliedMigrations.length} applied migrations, but this application bundles only ${bundledMigrations.length}`,
    );
  }

  for (const [index, applied] of appliedMigrations.entries()) {
    const bundled = bundledMigrations[index];
    const appliedTimestamp = Number(applied.created_at);

    if (
      !bundled ||
      typeof applied.hash !== "string" ||
      !Number.isFinite(appliedTimestamp) ||
      appliedTimestamp !== bundled.folderMillis ||
      applied.hash !== bundled.hash
    ) {
      throw new IncompatibleMigrationHistoryError(
        `Applied migration ${index + 1} is not the same migration as entry ${
          index + 1
        } in the bundled journal`,
      );
    }
  }
}

function backupFilename(now: Date): string {
  const timestamp = now.toISOString().replaceAll(":", "-");
  return `librequadri-pre-migration-${timestamp}.db`;
}

function availableBackupPath(backupDirectory: string, now: Date): string {
  const initialPath = path.join(backupDirectory, backupFilename(now));
  if (!existsSync(initialPath)) {
    return initialPath;
  }

  const extension = path.extname(initialPath);
  const stem = initialPath.slice(0, -extension.length);
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `${stem}-${suffix}${extension}`;
    if (!existsSync(candidate)) {
      return candidate;
    }
  }
}

export function createPreMigrationBackup(
  database: Database.Database,
  backupDirectory: string,
  now = new Date(),
): string {
  mkdirSync(backupDirectory, { recursive: true });
  const destination = availableBackupPath(backupDirectory, now);

  database.prepare("VACUUM INTO ?").run(destination);

  const backup = new Database(destination, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    assertQuickCheck(backup);
  } catch (error) {
    backup.close();
    unlinkSync(destination);
    throw error;
  }
  backup.close();

  return destination;
}

function restoreBackup(backupPath: string, databaseFilename: string): void {
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${databaseFilename}${suffix}`;
    if (existsSync(sidecar)) {
      unlinkSync(sidecar);
    }
  }

  copyFileSync(backupPath, databaseFilename);

  const restored = new Database(databaseFilename, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    assertQuickCheck(restored);
  } finally {
    restored.close();
  }
}

function runMigrations(
  database: Database.Database,
  migrationsFolder: string,
  bundledMigrations: readonly MigrationMeta[],
): void {
  assertCompatibleMigrationHistory(database, bundledMigrations);

  if (database.inTransaction) {
    throw new Error("Cannot start migrations while a SQLite transaction is active");
  }

  database.pragma("foreign_keys = OFF");
  if (database.pragma("foreign_keys", { simple: true }) !== 0) {
    throw new Error("Could not disable SQLite foreign-key enforcement for migrations");
  }

  let migrationError: unknown;
  try {
    migrate(drizzle(database), { migrationsFolder });

    const violations = database.pragma("foreign_key_check") as ForeignKeyViolationRow[];
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
      throw new Error("Could not restore SQLite foreign-key enforcement after migrations");
    }
  }
}

/**
 * Opens lq.db with the Foundation 1 settings and completes the full migration
 * safety sequence before returning a connection to normal application startup.
 */
export function openMigratedLqDatabase(
  options: OpenMigratedLqDatabaseOptions,
): Database.Database {
  const database = openConfiguredDatabase(options.databaseFilename, {
    kind: "lq",
    checkIntegrity: true,
  });

  let backupPath: string;
  try {
    backupPath = createPreMigrationBackup(
      database,
      options.backupDirectory,
      options.now,
    );
  } catch (error) {
    database.close();
    throw error;
  }

  try {
    const bundledMigrations = readMigrationFiles({
      migrationsFolder: options.migrationsFolder,
    });
    runMigrations(database, options.migrationsFolder, bundledMigrations);
    return database;
  } catch (cause) {
    database.close();

    let restoreFailure: unknown;
    try {
      restoreBackup(backupPath, options.databaseFilename);
    } catch (error) {
      restoreFailure = error;
    }

    throw new LqMigrationFailure({
      backupPath,
      cause,
      restoreFailure,
    });
  }
}
