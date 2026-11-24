import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readMigrationFiles } from "drizzle-orm/migrator";

import { closeConfiguredDatabase } from "../src/main/database/sqlite-connection.js";
import { openProjectDatabaseAtVersion } from "../src/main/database/project-migrations.js";

type ManifestColumn = readonly [string, string, number, number];
type ManifestIndex = readonly [string, number, readonly string[]];

export function generateProjectManifest(migrationsFolder: string): string {
  const migrationCount = readMigrationFiles({ migrationsFolder }).length;
  const root = mkdtempSync(path.join(tmpdir(), "lqp-manifest-"));
  try {
    const versions: Record<string, unknown> = {};
    for (let version = 1; version <= migrationCount; version += 1) {
      const database = openProjectDatabaseAtVersion(path.join(root, `${version}.lqp`), migrationsFolder, version);
      try {
        const tableNames = (database.prepare(`SELECT name FROM sqlite_schema
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'
          ORDER BY name`).all() as { name: string }[]).map((row) => row.name);
        const tables: Record<string, readonly ManifestColumn[]> = {};
        for (const table of tableNames) {
          tables[table] = (database.pragma(`table_xinfo('${table}')`) as { name: string; type: string; notnull: number; pk: number }[])
            .map((column) => [column.name, column.type.toUpperCase(), column.notnull, column.pk]);
        }
        const indexes: Record<string, ManifestIndex> = {};
        const indexRows = database.prepare(`SELECT name, tbl_name AS tableName FROM sqlite_schema
          WHERE type = 'index' AND sql IS NOT NULL ORDER BY name`).all() as { name: string; tableName: string }[];
        for (const index of indexRows) {
          const listed = (database.pragma(`index_list('${index.tableName}')`) as { name: string; unique: number }[])
            .find((candidate) => candidate.name === index.name);
          if (!listed) throw new Error(`Could not inspect project index ${index.name}`);
          const columns = (database.pragma(`index_xinfo('${index.name}')`) as { name: string | null; key: number }[])
            .filter((column) => column.key === 1).map((column) => column.name).filter((name): name is string => name !== null);
          indexes[index.name] = [index.tableName, listed.unique, columns];
        }
        versions[String(version)] = { tables, indexes };
      } finally {
        closeConfiguredDatabase(database);
      }
    }
    return `${JSON.stringify({ versions }, null, 2)}\n`;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function checkOrWriteProjectManifest(write: boolean): void {
  const migrationsFolder = path.resolve("db", "migrations", "project");
  const manifestPath = path.join(migrationsFolder, "manifest.json");
  const generated = generateProjectManifest(migrationsFolder);
  if (write) {
    writeFileSync(manifestPath, generated, "utf8");
    return;
  }
  if (readFileSync(manifestPath, "utf8") !== generated) {
    throw new Error("db/migrations/project/manifest.json is stale; run npm run db:manifest:project");
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  checkOrWriteProjectManifest(process.argv.includes("--write"));
}
