import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertDevelopmentSyncRoot, syncProfileDirectories, type SyncProfileDirectories } from "../src/main/development/engineering-sync.js";

const scratchRoots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "librequadri-directory-"));
  scratchRoots.push(root);
  const appData = path.join(root, "application-data");
  const development = path.join(appData, "development");
  const directories: SyncProfileDirectories = { appDataRoots: [appData], developmentRoots: [development] };
  return { root, appData, development, directories };
}

function catalogue(root: string): string {
  mkdirSync(path.join(root, "data"), { recursive: true });
  const filename = path.join(root, "data", "lq.db");
  copyFileSync(path.resolve("test/fixtures/quotation-format1.lqp"), filename);
  return filename;
}

describe("generic engineering-sync directory validation", () => {
  it("refuses every unmanaged application-data profile without relying on its name or changing its files", () => {
    const f = fixture();
    for (const name of ["Example Stable", "Example Development", "another-product", "renamed-profile"]) {
      const root = path.join(f.appData, name);
      const filename = catalogue(root), before = readFileSync(filename);
      expect(() => assertDevelopmentSyncRoot(root, f.directories)).toThrow(/development-only/);
      expect(readFileSync(filename)).toEqual(before);
      expect(existsSync(path.join(root, "backups"))).toBe(false);
    }
    expect(() => assertDevelopmentSyncRoot(f.appData, f.directories)).toThrow(/development-only/);
  });

  it("accepts the managed development profile and explicit custom roots outside application data", () => {
    const f = fixture();
    for (const root of [f.development, path.join(f.development, "scratch"), path.join(f.root, "workspace", "local-profile")]) {
      catalogue(root);
      expect(() => assertDevelopmentSyncRoot(root, f.directories)).not.toThrow();
    }
  });

  it("refuses production execution even for an otherwise valid custom development root", () => {
    const f = fixture(), root = path.join(f.root, "custom");
    const filename = catalogue(root), before = readFileSync(filename);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertDevelopmentSyncRoot(root, f.directories)).toThrow(/development-only/);
    expect(readFileSync(filename)).toEqual(before);
  });

  it("refuses bundles and seed trees including nested directories", () => {
    const f = fixture();
    const bundle = path.join(f.root, "Any Name.APP", "Contents", "profile");
    catalogue(bundle);
    expect(() => assertDevelopmentSyncRoot(bundle, f.directories)).toThrow(/development-only/);
    const seed = path.join(f.root, "arbitrary-seed-name"), nested = path.join(seed, "nested-profile");
    catalogue(nested);
    writeFileSync(path.join(seed, "manifest.json"), "{}");
    expect(() => assertDevelopmentSyncRoot(nested, f.directories)).toThrow(/development-only/);
  });

  it("requires a directory and a regular catalogue in its data subdirectory", () => {
    const f = fixture(), root = path.join(f.root, "custom");
    mkdirSync(root);
    expect(() => assertDevelopmentSyncRoot(root, f.directories)).toThrow();
    const filename = catalogue(root);
    expect(() => assertDevelopmentSyncRoot(filename, f.directories)).toThrow(/requires a development directory/);
  });

  it.skipIf(process.platform === "win32")("rejects development symlinks and aliases that resolve to a production profile", () => {
    const f = fixture(), production = path.join(f.appData, "stable");
    catalogue(production);
    symlinkSync(production, f.development);
    expect(() => assertDevelopmentSyncRoot(f.development, f.directories)).toThrow(/development-only/);
    const alias = path.join(f.root, "outside-alias");
    symlinkSync(production, alias);
    expect(() => assertDevelopmentSyncRoot(alias, f.directories)).toThrow(/development-only/);
  });

  it.skipIf(process.platform === "win32")("refuses protected profiles that link outside application data", () => {
    const f = fixture(), outside = path.join(f.root, "outside-target");
    const filename = catalogue(outside), before = readFileSync(filename);
    mkdirSync(f.appData);
    for (const alias of [path.join(f.appData, "stable"), f.development]) {
      symlinkSync(outside, alias);
      expect(() => assertDevelopmentSyncRoot(alias, f.directories)).toThrow(/development-only/);
    }
    expect(readFileSync(filename)).toEqual(before);
  });

  it.skipIf(process.platform === "win32")("refuses a seed-tree alias even when its target is outside the seed", () => {
    const f = fixture(), outside = path.join(f.root, "outside-target"); catalogue(outside);
    const seed = path.join(f.root, "seed"); mkdirSync(seed);
    writeFileSync(path.join(seed, "manifest.json"), "{}");
    const alias = path.join(seed, "nested"); symlinkSync(outside, alias);
    expect(() => assertDevelopmentSyncRoot(alias, f.directories)).toThrow(/development-only/);
  });

  it.skipIf(process.platform === "win32")("handles an aliased application-data parent without allowing its production profiles", () => {
    const f = fixture(), alias = path.join(f.root, "app-data-alias");
    catalogue(f.development);
    const production = path.join(f.appData, "stable"); catalogue(production);
    symlinkSync(f.appData, alias);
    const directories = { appDataRoots: [alias], developmentRoots: [path.join(alias, "development")] };
    expect(() => assertDevelopmentSyncRoot(path.join(alias, "development"), directories)).not.toThrow();
    expect(() => assertDevelopmentSyncRoot(path.join(alias, "stable"), directories)).toThrow(/development-only/);
  });

  it("retains the refusal of catalogue hard links", () => {
    const f = fixture(), root = path.join(f.root, "custom");
    const filename = catalogue(root);
    linkSync(filename, path.join(f.root, "linked.db"));
    expect(() => assertDevelopmentSyncRoot(root, f.directories)).toThrow(/unaliased/);
  });
});

describe("standard profile locations", () => {
  it.each([
    { platform: "darwin" as const, homeDirectory: "/example/profile", environment: {},
      protectedRoot: "/example/profile/Library/Application Support", developmentRoot: "/example/profile/Library/Application Support/LibreQuadri Development" },
    { platform: "linux" as const, homeDirectory: "/example/profile", environment: { XDG_CONFIG_HOME: "/example/config" },
      protectedRoot: "/example/config", developmentRoot: "/example/config/LibreQuadri Development" },
    { platform: "win32" as const, homeDirectory: "C:\\Example", environment: { APPDATA: "D:\\Roaming", LOCALAPPDATA: "D:\\Local" },
      protectedRoot: "D:\\Local", developmentRoot: "D:\\Local\\LibreQuadri Development" },
  ])("protects platform profile storage on $platform and ignores data-dir overrides for its allowlist", options => {
    const directories = syncProfileDirectories({ ...options,
      environment: { ...options.environment, LIBREQUADRI_DATA_DIR: "unmanaged-production-profile" } });
    expect(directories.appDataRoots).toContain(options.protectedRoot);
    expect(directories.developmentRoots).toContain(options.developmentRoot);
    expect(directories.developmentRoots).not.toContain("unmanaged-production-profile");
  });
});
