import path from "node:path";
import { ALPHA_NAME } from "./alpha/identity.js";

export const APPLICATION_NAME = "LibreQuadri";
export const DEVELOPMENT_APPLICATION_NAME = "LibreQuadri Development";
export const TEST_APPLICATION_NAME = "LibreQuadri Test";
export const DATA_DIRECTORY_OVERRIDE = "LIBREQUADRI_DATA_DIR";

export type ApplicationMode = "production" | "development" | "test";

export interface DataPathEnvironment {
  readonly LOCALAPPDATA?: string;
  readonly NODE_ENV?: string;
  readonly LIBREQUADRI_DATA_DIR?: string;
}

export interface DataPathResolutionOptions {
  readonly platform: NodeJS.Platform;
  readonly mode: ApplicationMode;
  readonly electronDefaultUserDataPath: string;
  readonly electronAppDataPath: string;
  readonly environment: DataPathEnvironment;
}

export interface ElectronApplicationPaths {
  readonly isPackaged: boolean;
  getPath(name: "appData" | "userData"): string;
  setPath(name: "userData", value: string): void;
  isReady(): boolean;
}

export interface ApplicationPaths {
  readonly root: string;
  readonly data: string;
  readonly lqDatabase: string;
  readonly rawDatabase: string;
  readonly working: string;
  readonly incoming: string;
  readonly imports: string;
  readonly assets: string;
  readonly backups: string;
  readonly projectBackups: string;
  readonly logs: string;
}

export function applicationMode(
  isPackaged: boolean,
  environment: DataPathEnvironment,
): ApplicationMode {
  if (environment.NODE_ENV === "test") {
    return "test";
  }

  return isPackaged ? "production" : "development";
}

export function resolveApplicationDataPath(
  options: DataPathResolutionOptions,
): string {
  const pathApi = options.platform === "win32" ? path.win32 : path;
  const override = options.environment[DATA_DIRECTORY_OVERRIDE]?.trim();

  if (options.mode !== "production" && override) {
    return pathApi.resolve(override);
  }

  if (options.mode === "production" && options.platform === "darwin") {
    return options.electronDefaultUserDataPath;
  }

  const directoryName = {
    production: APPLICATION_NAME,
    development: DEVELOPMENT_APPLICATION_NAME,
    test: TEST_APPLICATION_NAME,
  }[options.mode];

  if (options.platform === "win32") {
    const localAppData = options.environment.LOCALAPPDATA?.trim();
    if (!localAppData) {
      throw new Error("LOCALAPPDATA is required to locate LibreQuadri data on Windows");
    }
    return path.win32.join(localAppData, directoryName);
  }

  return pathApi.join(options.electronAppDataPath, directoryName);
}

/**
 * Configure Electron's userData path synchronously, before app.whenReady().
 * Production macOS deliberately keeps Electron's product-name-derived default.
 */
export function configureApplicationDataPath(
  electronApp: ElectronApplicationPaths,
  options: {
    readonly platform?: NodeJS.Platform;
    readonly environment?: DataPathEnvironment;
    readonly alpha?: boolean;
    readonly alphaName?: string;
  } = {},
): string {
  if (electronApp.isReady()) {
    throw new Error("The application data path must be configured before Electron app.ready");
  }

  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const mode = applicationMode(electronApp.isPackaged, environment);
  const electronDefaultUserDataPath = electronApp.getPath("userData");
  const resolvedPath = electronApp.isPackaged && options.alpha && platform === "darwin"
    ? path.join(electronApp.getPath("appData"), options.alphaName ?? ALPHA_NAME)
    : resolveApplicationDataPath({
    platform,
    mode,
    electronDefaultUserDataPath,
    electronAppDataPath: electronApp.getPath("appData"),
    environment,
  });

  if (resolvedPath !== electronDefaultUserDataPath) {
    electronApp.setPath("userData", resolvedPath);
  }

  return resolvedPath;
}

export function applicationPaths(root: string): ApplicationPaths {
  const data = path.join(root, "data");
  const working = path.join(root, "working");
  const backups = path.join(root, "backups");

  return {
    root,
    data,
    lqDatabase: path.join(data, "lq.db"),
    rawDatabase: path.join(data, "metel_raw.db"),
    working,
    incoming: path.join(working, "incoming"),
    imports: path.join(root, "imports"),
    assets: path.join(root, "assets"),
    backups,
    projectBackups: path.join(backups, "projects"),
    logs: path.join(root, "logs"),
  };
}
