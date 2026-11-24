import Database from "better-sqlite3";
import type { MenuItemConstructorOptions } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALPHA_VERSION, isAlpha0Build } from "../src/main/alpha/identity.js";
import { AppSettingsStore, type ThemePreference } from "../src/main/app/app-settings.js";
import { ApplicationController, type ApplicationControllerOptions } from "../src/main/app/application-controller.js";

const electron = vi.hoisted(() => ({
  nativeTheme: {themeSource:"system"},
  Menu: {buildFromTemplate:vi.fn((template) => template),setApplicationMenu:vi.fn()},
}));
vi.mock("electron", () => ({...electron,dialog:{}}));
const databases: Database.Database[] = [];
beforeEach(() => {electron.nativeTheme.themeSource = "system";vi.clearAllMocks();});
afterEach(() => {for (const db of databases.splice(0)) db.close();});

function setup(isPackaged: boolean, version: string, preference?: ThemePreference) {
  const db = new Database(":memory:");databases.push(db);
  db.exec("CREATE TABLE app_setting(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
  const settings = new AppSettingsStore(db);
  if (preference) settings.setThemePreference(preference);
  const controller = new ApplicationController({
    applicationName:"LibreQuadri",development:!isPackaged,lightOnly:isAlpha0Build(isPackaged,version),settings,
    service:{currentSummary:()=>null},recent:{list:()=>[]},window:()=>undefined,
  } as unknown as ApplicationControllerOptions);
  controller.applyTheme();controller.refresh();
  return {settings,controller};
}

function menuItems(): MenuItemConstructorOptions[] {
  const template = electron.Menu.setApplicationMenu.mock.lastCall![0] as MenuItemConstructorOptions[];
  const flatten = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
    items.flatMap(item => [item,...(Array.isArray(item.submenu) ? flatten(item.submenu) : [])]);
  return flatten(template);
}

describe("Alpha 0 light-only theme policy", () => {
  it("defaults a new installation to light independently of the system theme", () => {
    const {settings} = setup(true,"0.1.0-alpha.1.1");
    expect(settings.themePreference()).toBe("light");
    expect(electron.nativeTheme.themeSource).toBe("light");
    expect(menuItems().find(item => item.id === "view.theme.light")?.checked).toBe(true);
  });

  it("falls back to light for an invalid stored preference", () => {
    const {settings,controller} = setup(true,"0.1.0-alpha.1.1");
    databases.at(-1)!.prepare("INSERT INTO app_setting(key,value) VALUES('ui.theme','invalid')").run();
    controller.applyTheme();
    expect(settings.themePreference()).toBe("light");
    expect(electron.nativeTheme.themeSource).toBe("light");
  });
  it.each(["light","dark","system"] as const)("forces packaged Alpha light without altering saved %s", preference => {
    const {settings,controller} = setup(true,ALPHA_VERSION,preference);
    expect(electron.nativeTheme.themeSource).toBe("light");
    expect(menuItems().some(item => item.id?.startsWith("view.theme"))).toBe(false);
    // A stale/native theme action cannot change the Alpha restriction either.
    (controller as unknown as {setTheme(theme:ThemePreference):void}).setTheme("dark");
    expect(electron.nativeTheme.themeSource).toBe("light");
    expect(settings.themePreference()).toBe(preference);
  });

  it.each([
    {packaged:false,version:ALPHA_VERSION},
    {packaged:false,version:"0.1.0"},
    {packaged:true,version:"0.1.0"},
    {packaged:true,version:"0.1.0-alpha.1"},
    {packaged:true,version:"0.1.0-alpha.1.1"},
  ])("keeps normal saved preferences and theme commands for $packaged/$version", ({packaged,version}) => {
    const {settings} = setup(packaged,version,"dark");
    expect(electron.nativeTheme.themeSource).toBe("dark");
    for (const theme of ["light","dark","system"] as const) {
      const item = menuItems().find(item => item.id === `view.theme.${theme}`)!;
      expect(item).toBeDefined();
      (item.click as () => void)();
      expect(electron.nativeTheme.themeSource).toBe(theme);
      expect(settings.themePreference()).toBe(theme);
      expect(menuItems().find(item => item.id === `view.theme.${theme}`)?.checked).toBe(true);
    }
  });
});
