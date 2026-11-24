import { readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

export interface CapacityKindSeedRow {
  readonly code: string;
  readonly name: string;
  readonly unitLabel: string;
  readonly displayDivisor: number;
  readonly nominalPitchMm: number | null;
}
export type CapacityKindSeed = readonly CapacityKindSeedRow[];

export interface SourceBrandMapSeedRow {
  readonly adapterCode: string;
  readonly sourceBrandCode: string;
  readonly brandMarchio: string | null;
}
export type SourceBrandMapSeed = readonly SourceBrandMapSeedRow[];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid engineering seed: ${message}`);
}

function validateCapacityKinds(value: unknown): asserts value is CapacityKindSeed {
  assert(Array.isArray(value), "capacity kinds must be an array");
  const seen = new Set<string>();
  for (const row of value as CapacityKindSeed) {
    assert(row && typeof row.code === "string" && /^[a-z][a-z0-9_]*$/.test(row.code), "invalid capacity code");
    assert(!seen.has(row.code), `duplicate capacity code ${row.code}`);
    seen.add(row.code);
    assert(typeof row.name === "string" && row.name.trim().length > 0, `missing name for ${row.code}`);
    assert(typeof row.unitLabel === "string" && row.unitLabel.trim().length > 0, `missing unit for ${row.code}`);
    assert(Number.isSafeInteger(row.displayDivisor) && row.displayDivisor > 0, `invalid divisor for ${row.code}`);
    assert(row.nominalPitchMm === null || (typeof row.nominalPitchMm === "number" && Number.isFinite(row.nominalPitchMm) && row.nominalPitchMm > 0), `invalid pitch for ${row.code}`);
  }
  const din = (value as CapacityKindSeed).find(row => row.code === "din_rail");
  assert(din?.displayDivisor === 2 && din.nominalPitchMm === 9, "din_rail must use integer 9 mm half-modules");
}

function validateSourceBrandMap(value: unknown): asserts value is SourceBrandMapSeed {
  assert(Array.isArray(value), "source brand map must be an array");
  const seen = new Set<string>();
  for (const row of value as SourceBrandMapSeed) {
    assert(row && typeof row.adapterCode === "string" && /^[a-z][a-z0-9_]*$/.test(row.adapterCode), "invalid adapter code");
    assert(typeof row.sourceBrandCode === "string" && row.sourceBrandCode.length > 0, "invalid source brand code");
    assert(row.brandMarchio === null || (typeof row.brandMarchio === "string" && /^[A-Z0-9]{3}$/.test(row.brandMarchio)), "invalid METEL marchio");
    const key = `${row.adapterCode}\0${row.sourceBrandCode}`;
    assert(!seen.has(key), `duplicate source brand ${key}`);
    seen.add(key);
  }
}

export function loadCapacityKindSeed(folder = path.resolve("db", "seed")): CapacityKindSeed {
  const value: unknown = JSON.parse(readFileSync(path.join(folder, "capacity-kinds.json"), "utf8"));
  validateCapacityKinds(value);
  return value;
}

export function loadSourceBrandMapSeed(folder = path.resolve("db", "seed")): SourceBrandMapSeed {
  const value: unknown = JSON.parse(readFileSync(path.join(folder, "source-brand-map.json"), "utf8"));
  validateSourceBrandMap(value);
  return value;
}

/** Stable kind codes remain in place; manual definitions take precedence. */
export function synchronizeCapacityKindSeed(database: Database.Database, seed: CapacityKindSeed = loadCapacityKindSeed()): void {
  validateCapacityKinds(seed);
  database.transaction(() => {
    const upsert = database.prepare(`INSERT INTO cat_capacity_kind
      (code, name, unit_label, display_divisor, nominal_pitch_mm, source)
      VALUES (@code, @name, @unitLabel, @displayDivisor, @nominalPitchMm, 'seed')
      ON CONFLICT(code) DO UPDATE SET
        name = excluded.name, unit_label = excluded.unit_label,
        display_divisor = excluded.display_divisor, nominal_pitch_mm = excluded.nominal_pitch_mm
      WHERE cat_capacity_kind.source = 'seed'`);
    for (const row of seed) upsert.run(row);
  })();
}

/** Missing METEL brands are deferred; explicit null mappings remain unmapped. */
export function synchronizeSourceBrandMapSeed(database: Database.Database, seed: SourceBrandMapSeed = loadSourceBrandMapSeed()): number {
  validateSourceBrandMap(seed);
  return database.transaction(() => {
    const brands = new Map((database.prepare("SELECT id, metel_marchio FROM cat_brand").all() as Array<{id: number; metel_marchio: string}>).map(row => [row.metel_marchio, row.id]));
    const upsert = database.prepare(`INSERT INTO cat_source_brand_map
      (adapter_code, source_brand_code, brand_id, source)
      VALUES (?, ?, ?, 'seed')
      ON CONFLICT(adapter_code, source_brand_code) DO UPDATE SET brand_id = excluded.brand_id
      WHERE cat_source_brand_map.source = 'seed'`);
    let deferred = 0;
    for (const row of seed) {
      const brandId = row.brandMarchio === null ? null : brands.get(row.brandMarchio);
      if (brandId === undefined) { deferred++; continue; }
      upsert.run(row.adapterCode, row.sourceBrandCode, brandId);
    }
    return deferred;
  })();
}
