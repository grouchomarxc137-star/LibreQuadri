import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { openMigratedRawDatabase } from "../src/main/database/raw-migrations.js";
import { closeConfiguredDatabase } from "../src/main/database/sqlite-connection.js";
import {
  ingestMetelFile,
  metelSourceSha256,
} from "../src/main/metel/raw-ingestion.js";

const temporaryDirectories: string[] = [];
const migrationsFolder = path.resolve("db", "migrations", "raw");

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "librequadri-raw-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function familySource(): Buffer {
  const header = "FAMIGLIE DI SCONTO  020".padEnd(94, " ");
  const row = `${"TSTTSTDISC".padEnd(24, " ")}${"Famiglia test".padEnd(70, " ")}`;
  return Buffer.from(`${header}\r\n${row}\r\n`, "ascii");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("metel_raw.db migration and ingestion", () => {
  it("opens the raw database explicitly with its own migrations and pragmas", () => {
    const filename = path.join(temporaryDirectory(), "nested", "metel_raw.db");
    const database = openMigratedRawDatabase({
      databaseFilename: filename,
      migrationsFolder,
    });

    try {
      expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
      const tables = database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE '__drizzle%' ORDER BY name",
        )
        .pluck()
        .all();
      expect(tables).toEqual(["family_row", "price_list_row", "raw_file"]);
    } finally {
      closeConfiguredDatabase(database);
    }
  });

  it("stores one source file transactionally and is idempotent by byte SHA-256", () => {
    const database = openMigratedRawDatabase({
      databaseFilename: path.join(temporaryDirectory(), "metel_raw.db"),
      migrationsFolder,
    });
    const bytes = familySource();

    try {
      const first = ingestMetelFile({
        database,
        sourceBytes: bytes,
        originalFileName: "families.txt",
        parsedAt: new Date("2026-09-21T12:00:00Z"),
      });
      const second = ingestMetelFile({
        database,
        sourceBytes: bytes,
        originalFileName: "renamed-copy.txt",
      });

      expect(first).toEqual({
        rawFileId: 1,
        fileSha256: metelSourceSha256(bytes),
        fileType: "FSC",
        rowCount: 1,
        alreadyParsed: false,
      });
      expect(second).toEqual({ ...first, alreadyParsed: true });
      expect(database.prepare("SELECT COUNT(*) AS count FROM raw_file").get()).toEqual({
        count: 1,
      });
      expect(database.prepare("SELECT COUNT(*) AS count FROM family_row").get()).toEqual({
        count: 1,
      });
      expect(
        database
          .prepare("SELECT original_file_name FROM raw_file WHERE id = 1")
          .pluck()
          .get(),
      ).toBe("families.txt");
    } finally {
      closeConfiguredDatabase(database);
    }
  });

  it("rolls back the raw-file row if child insertion fails", () => {
    const database = openMigratedRawDatabase({
      databaseFilename: path.join(temporaryDirectory(), "metel_raw.db"),
      migrationsFolder,
    });
    database.exec(`
      CREATE TRIGGER reject_family BEFORE INSERT ON family_row
      BEGIN SELECT RAISE(ABORT, 'test rejection'); END;
    `);

    try {
      expect(() =>
        ingestMetelFile({
          database,
          sourceBytes: familySource(),
          originalFileName: "families.txt",
        }),
      ).toThrow("test rejection");
      expect(database.prepare("SELECT COUNT(*) AS count FROM raw_file").get()).toEqual({
        count: 0,
      });
    } finally {
      closeConfiguredDatabase(database);
    }
  });
});
