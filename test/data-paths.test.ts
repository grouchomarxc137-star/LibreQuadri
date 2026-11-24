import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  applicationMode,
  applicationPaths,
  configureApplicationDataPath,
  resolveApplicationDataPath,
  type ElectronApplicationPaths,
} from "../src/main/data-paths.js";

function fakeElectronApp(options: {
  isPackaged: boolean;
  ready?: boolean;
  userData?: string;
  appData?: string;
}): ElectronApplicationPaths & { setPath: ReturnType<typeof vi.fn> } {
  const setPath = vi.fn();
  return {
    isPackaged: options.isPackaged,
    isReady: () => options.ready ?? false,
    getPath: (name) =>
      name === "userData"
        ? (options.userData ?? "/Users/test/Library/Application Support/LibreQuadri")
        : (options.appData ?? "/Users/test/Library/Application Support"),
    setPath,
  };
}

describe("application data paths", () => {
  it("isolates packaged Alpha 1 even with development/test overrides", () => {
    const electronApp = fakeElectronApp({isPackaged:true});
    const result = configureApplicationDataPath(electronApp, {platform:"darwin",alpha:true,
      alphaName:"LibreQuadri Alpha 1",
      environment:{NODE_ENV:"test",LIBREQUADRI_DATA_DIR:"/developer-data"}});
    expect(result).toBe("/Users/test/Library/Application Support/LibreQuadri Alpha 1");
    expect(electronApp.setPath).toHaveBeenCalledWith("userData",result);
  });
  it("isolates packaged Alpha 0 from normal development/production data and environment overrides", () => {
    const electronApp = fakeElectronApp({isPackaged:true});
    const result = configureApplicationDataPath(electronApp, {platform:"darwin",alpha:true,
      environment:{NODE_ENV:"test",LIBREQUADRI_DATA_DIR:"/developer-data"}});
    expect(result).toBe("/Users/test/Library/Application Support/LibreQuadri Alpha 0");
    expect(electronApp.setPath).toHaveBeenCalledWith("userData",result);
  });

  it("does not change unpackaged data paths when Alpha options are supplied", () => {
    const electronApp = fakeElectronApp({isPackaged:false});
    expect(configureApplicationDataPath(electronApp,{platform:"darwin",alpha:true,environment:{}}))
      .toBe("/Users/test/Library/Application Support/LibreQuadri Development");
  });
  it("uses Electron userData unchanged for packaged macOS builds", () => {
    const electronApp = fakeElectronApp({ isPackaged: true });

    const result = configureApplicationDataPath(electronApp, {
      platform: "darwin",
      environment: {},
    });

    expect(result).toBe("/Users/test/Library/Application Support/LibreQuadri");
    expect(electronApp.setPath).not.toHaveBeenCalled();
  });

  it("uses LOCALAPPDATA and configures userData for packaged Windows builds", () => {
    const electronApp = fakeElectronApp({
      isPackaged: true,
      userData: "C:\\Users\\test\\AppData\\Roaming\\LibreQuadri",
      appData: "C:\\Users\\test\\AppData\\Roaming",
    });

    const result = configureApplicationDataPath(electronApp, {
      platform: "win32",
      environment: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
    });

    expect(result).toBe("C:\\Users\\test\\AppData\\Local\\LibreQuadri");
    expect(electronApp.setPath).toHaveBeenCalledWith("userData", result);
  });

  it("keeps development and test data separate from production", () => {
    const productionPath = resolveApplicationDataPath({
      platform: "darwin",
      mode: "production",
      electronDefaultUserDataPath: "/app-data/LibreQuadri",
      electronAppDataPath: "/app-data",
      environment: {},
    });
    const developmentPath = resolveApplicationDataPath({
      platform: "darwin",
      mode: "development",
      electronDefaultUserDataPath: "/app-data/LibreQuadri",
      electronAppDataPath: "/app-data",
      environment: {},
    });
    const testPath = resolveApplicationDataPath({
      platform: "darwin",
      mode: "test",
      electronDefaultUserDataPath: "/app-data/LibreQuadri",
      electronAppDataPath: "/app-data",
      environment: {},
    });

    expect(new Set([productionPath, developmentPath, testPath]).size).toBe(3);
    expect(developmentPath).toBe("/app-data/LibreQuadri Development");
    expect(testPath).toBe("/app-data/LibreQuadri Test");
  });

  it("supports an explicit non-production data location", () => {
    expect(
      resolveApplicationDataPath({
        platform: "darwin",
        mode: "test",
        electronDefaultUserDataPath: "/production",
        electronAppDataPath: "/app-data",
        environment: { LIBREQUADRI_DATA_DIR: "/tmp/lq-test" },
      }),
    ).toBe("/tmp/lq-test");
  });

  it("rejects configuration after Electron is ready", () => {
    const electronApp = fakeElectronApp({ isPackaged: false, ready: true });

    expect(() => configureApplicationDataPath(electronApp)).toThrow(
      "before Electron app.ready",
    );
  });

  it("derives runtime mode without letting NODE_ENV override packaged production", () => {
    expect(applicationMode(false, {})).toBe("development");
    expect(applicationMode(false, { NODE_ENV: "test" })).toBe("test");
    expect(applicationMode(true, { NODE_ENV: "development" })).toBe("production");
  });

  it("maps approved subdirectories and database names", () => {
    const paths = applicationPaths(path.join("/tmp", "LibreQuadri Test"));

    expect(paths.lqDatabase).toBe("/tmp/LibreQuadri Test/data/lq.db");
    expect(paths.rawDatabase).toBe("/tmp/LibreQuadri Test/data/metel_raw.db");
    expect(paths.incoming).toBe("/tmp/LibreQuadri Test/working/incoming");
    expect(paths.projectBackups).toBe("/tmp/LibreQuadri Test/backups/projects");
  });
});
