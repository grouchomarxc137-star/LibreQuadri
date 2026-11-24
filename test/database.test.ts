import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { applicationPaths } from "../src/main/data-paths.js";
import { MainDatabaseService } from "../src/main/database/database-service.js";
import { TIQUADRI_ENGINEERING_ADAPTER } from "../src/main/sources/tiquadri/adapter.js";
import {
  closeConfiguredDatabase,
  openConfiguredDatabase,
} from "../src/main/database/sqlite-connection.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "librequadri-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite connection configuration", () => {
  it("applies the approved lq.db pragmas", () => {
    const filename = path.join(temporaryDirectory(), "lq.db");
    const database = openConfiguredDatabase(filename, {
      kind: "lq",
      checkIntegrity: true,
    });

    try {
      expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(database.pragma("synchronous", { simple: true })).toBe(1);
      expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(database.pragma("busy_timeout", { simple: true })).toBe(5000);
      expect(database.pragma("temp_store", { simple: true })).toBe(2);
      expect(database.pragma("cache_size", { simple: true })).toBe(-65536);
    } finally {
      closeConfiguredDatabase(database);
    }
  });

  it("enables foreign-key enforcement per connection", () => {
    const filename = path.join(temporaryDirectory(), "foreign-keys.db");
    const database = openConfiguredDatabase(filename, { kind: "raw" });

    try {
      database.exec(`
        CREATE TABLE parent (id INTEGER PRIMARY KEY);
        CREATE TABLE child (parent_id INTEGER REFERENCES parent(id));
      `);
      expect(() =>
        database.prepare("INSERT INTO child (parent_id) VALUES (?)").run(42),
      ).toThrow();
    } finally {
      closeConfiguredDatabase(database);
    }
  });
});

describe("main-process database service", () => {
  it("creates and validates lq.db without opening the raw import database", () => {
    const root = temporaryDirectory();
    const paths = applicationPaths(root);
    const service = MainDatabaseService.initialize(root);

    try {
      expect(service.healthCheck()).toEqual({ catalogue: "ok" });
      expect(service.engineeringSourceStatus()).toMatchObject([{adapterCode:TIQUADRI_ENGINEERING_ADAPTER.code,
        status:"missing",reason:"not_imported",requiredVersion:TIQUADRI_ENGINEERING_ADAPTER.version}]);
      expect(existsSync(paths.lqDatabase)).toBe(true);
      expect(existsSync(paths.rawDatabase)).toBe(false);
    } finally {
      service.close();
    }
  });

  it("closes idempotently and rejects later use", () => {
    const service = MainDatabaseService.initialize(temporaryDirectory());

    service.close();
    service.close();

    expect(() => service.healthCheck()).toThrow("Database service is closed");
    expect(() => service.engineeringSourceStatus()).toThrow("Database service is closed");
  });
});
