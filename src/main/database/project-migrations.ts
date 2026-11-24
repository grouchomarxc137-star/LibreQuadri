import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";

import { assertCompatibleMigrationHistory } from "./lq-migrations.js";
import { openConfiguredDatabase } from "./sqlite-connection.js";

export const LQP_APPLICATION_ID = 0x4c515031;

interface DrizzleMigrationRunner {
  readonly dialect: {
    migrate(migrations: readonly MigrationMeta[], session: unknown, config: { readonly migrationsTable: string }): void;
  };
  readonly session: unknown;
}

function runProjectMigrations(
  database: Database.Database,
  migrations: readonly MigrationMeta[],
): void {
  if (database.inTransaction) throw new Error("Cannot migrate a project inside a transaction");
  database.pragma("foreign_keys = OFF");
  if (database.pragma("foreign_keys", { simple: true }) !== 0) throw new Error("Could not disable project foreign keys for migration");
  let failure: unknown;
  try {
    const orm = drizzle(database) as unknown as DrizzleMigrationRunner;
    orm.dialect.migrate(migrations, orm.session, { migrationsTable: "__drizzle_migrations" });
    const violations = database.pragma("foreign_key_check") as unknown[];
    if (violations.length > 0) throw new Error("Project migration produced foreign-key violations");
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    database.pragma("foreign_keys = ON");
    if (database.pragma("foreign_keys", { simple: true }) !== 1 && failure === undefined) {
      throw new Error("Could not restore project foreign-key enforcement after migration");
    }
  }
}

export function openProjectDatabaseAtVersion(
  filename: string,
  migrationsFolder: string,
  formatVersion: number,
): Database.Database {
  const migrations = readMigrationFiles({ migrationsFolder });
  if (!Number.isInteger(formatVersion) || formatVersion < 0 || formatVersion > migrations.length) {
    throw new RangeError(`Unsupported project format version ${formatVersion}`);
  }
  const database = openConfiguredDatabase(filename, { kind: "project-working-copy" });
  try {
    database.pragma(`application_id = ${LQP_APPLICATION_ID}`);
    assertCompatibleMigrationHistory(database, migrations);
    runProjectMigrations(database, migrations.slice(0, formatVersion));
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function openCurrentProjectDatabase(
  filename: string,
  migrationsFolder: string,
): Database.Database {
  return openProjectDatabaseAtVersion(filename, migrationsFolder, projectFormatVersion(migrationsFolder));
}

export function migrateProjectDatabaseToCurrent(
  database: Database.Database,
  migrationsFolder: string,
): void {
  const migrations = readMigrationFiles({ migrationsFolder });
  assertCompatibleMigrationHistory(database, migrations);
  runProjectMigrations(database, migrations);
}

export function projectFormatVersion(migrationsFolder: string): number {
  return readMigrationFiles({ migrationsFolder }).length;
}
