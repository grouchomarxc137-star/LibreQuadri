import type Database from "better-sqlite3";

/*
 * Per-installation user-interface preferences, stored in lq.db `app_setting`
 * (DATABASE_DESIGN §6). Unknown or damaged values fall back to the defaults.
 */

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const THEME_SETTING_KEY = "ui.theme";
export const ZOOM_SETTING_KEY = "ui.zoom_level";

/** Chromium zoom levels: 0 is 100 %, each level is a factor of 1.2. */
export const ZOOM_STEP = 0.5;
/** Compact interface scale, approximately 91%; drawing zoom is independent. */
export const DEFAULT_ZOOM_LEVEL = -0.5;
export const ZOOM_MIN = -2;
export const ZOOM_MAX = 3;

export type ZoomDirection = "in" | "out" | "reset";

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** The next zoom level, kept on the step grid and within [ZOOM_MIN, ZOOM_MAX]. */
export function nextZoomLevel(current: number, direction: ZoomDirection): number {
  if (direction === "reset") return 0;
  const base = normalizeZoomLevel(current);
  return normalizeZoomLevel(base + (direction === "in" ? ZOOM_STEP : -ZOOM_STEP));
}

export function normalizeZoomLevel(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return 0;
  const stepped = Math.round(numeric / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stepped));
}

export class AppSettingsStore {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  themePreference(): ThemePreference {
    const value = this.read(THEME_SETTING_KEY);
    return isThemePreference(value) ? value : "light";
  }

  setThemePreference(value: ThemePreference): void {
    if (!isThemePreference(value)) throw new Error("Tema non valido.");
    this.write(THEME_SETTING_KEY, value);
  }

  zoomLevel(): number {
    return normalizeZoomLevel(this.read(ZOOM_SETTING_KEY) ?? DEFAULT_ZOOM_LEVEL);
  }

  setZoomLevel(value: number): number {
    const level = normalizeZoomLevel(value);
    this.write(ZOOM_SETTING_KEY, String(level));
    return level;
  }

  private read(key: string): string | undefined {
    return (this.#database.prepare("SELECT value FROM app_setting WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  }

  private write(key: string, value: string): void {
    this.#database.prepare(`INSERT INTO app_setting(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
  }
}
