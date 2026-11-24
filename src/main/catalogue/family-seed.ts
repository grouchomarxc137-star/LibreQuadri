import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

import { ATTRIBUTE_ENRICHMENT_FINGERPRINT_KEY } from "./attribute-seed.js";
import { canonical, STABLE_CODE } from "./category-seed.js";
import {
  FAMILY_GROUPING_VERSION,
  groupProductFamilies,
  type FamilyGroupingStats,
  type ProductFamilyGrouperRegistry,
} from "./family-grouping.js";
import { FAMILY_GROUPERS } from "./groupers/index.js";

export interface SeedProductFamily {
  readonly brandMarchio: string;
  readonly code: string;
  readonly categoryCode: string;
  readonly name: string;
  readonly series: string | null;
  readonly description: string | null;
  readonly active: boolean;
  /** Ordered stable attribute codes. */
  readonly axes: readonly string[];
}

export type ProductFamilySeed = readonly SeedProductFamily[];

export const FAMILY_GROUPING_FINGERPRINT_KEY = "catalogue.family_grouping_fingerprint";
const RETIRED_FAMILY_CODES_KEY = "catalogue.retired_product_family_codes";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid product family seed: ${message}`);
}

export function validateProductFamilySeed(value: unknown): asserts value is ProductFamilySeed {
  assert(Array.isArray(value), "expected an array");
  const identities = new Set<string>();
  for (const row of value as ProductFamilySeed) {
    assert(row && typeof row.brandMarchio === "string" && row.brandMarchio.trim().length > 0,
      "invalid brandMarchio");
    assert(typeof row.code === "string" && STABLE_CODE.test(row.code), "invalid family code");
    const identity = `${row.brandMarchio}\0${row.code}`;
    assert(!identities.has(identity), `duplicate family ${row.brandMarchio}/${row.code}`);
    identities.add(identity);
    assert(typeof row.categoryCode === "string" && STABLE_CODE.test(row.categoryCode),
      `invalid category for ${row.code}`);
    assert(typeof row.name === "string" && row.name.trim().length > 0, `invalid name for ${row.code}`);
    assert(row.series === null || typeof row.series === "string", `invalid series for ${row.code}`);
    assert(row.description === null || typeof row.description === "string", `invalid description for ${row.code}`);
    assert(typeof row.active === "boolean", `invalid active flag for ${row.code}`);
    assert(Array.isArray(row.axes) && row.axes.length > 0, `family ${row.code} requires axes`);
    const axes = new Set<string>();
    for (const axis of row.axes) {
      assert(typeof axis === "string" && STABLE_CODE.test(axis), `invalid axis for ${row.code}`);
      assert(!axes.has(axis), `duplicate axis ${axis} for ${row.code}`);
      axes.add(axis);
    }
  }
}

export function loadProductFamilySeed(folder = path.resolve("db", "seed")): ProductFamilySeed {
  const value: unknown = JSON.parse(readFileSync(path.join(folder, "product-families.json"), "utf8"));
  validateProductFamilySeed(value);
  return value;
}

export interface FamilySynchronizationOptions {
  readonly affectedIds?: ReadonlySet<number>;
  readonly groupers?: ProductFamilyGrouperRegistry;
}

export interface FamilySynchronizationResult {
  readonly fingerprint: string;
  readonly deferred: number;
  readonly regrouped: boolean;
  readonly grouping: FamilyGroupingStats | null;
}

interface ExistingFamily {
  readonly id: number;
  readonly brandId: number;
  readonly categoryId: number;
  readonly categoryCode: string;
  readonly marchio: string;
  readonly code: string;
  readonly source: "seed" | "manual";
}

/**
 * Reconciles family definitions/axes and then runs grouping. Missing scopes are
 * deferred, manual definitions are protected, and product membership is never
 * read from seed data.
 */
export function synchronizeProductFamilySeed(
  database: Database.Database,
  seed: ProductFamilySeed = loadProductFamilySeed(),
  options: FamilySynchronizationOptions = {},
): FamilySynchronizationResult {
  validateProductFamilySeed(seed);
  const groupers = options.groupers ?? FAMILY_GROUPERS;
  return database.transaction(() => {
    const getSetting = (key: string): string | undefined => database
      .prepare("SELECT value FROM app_setting WHERE key = ?").pluck().get(key) as string | undefined;
    const setSetting = database.prepare(`
      INSERT INTO app_setting (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    const retired = new Set<string>(JSON.parse(getSetting(RETIRED_FAMILY_CODES_KEY) ?? "[]") as string[]);
    const brandRows = database.prepare("SELECT id, metel_marchio FROM cat_brand").all() as Array<{ id: number; metel_marchio: string }>;
    const categoryRows = database.prepare("SELECT id, code, active FROM cat_category").all() as Array<{ id: number; code: string; active: number }>;
    const attributeRows = database.prepare("SELECT id, code, data_type, active FROM cat_attribute").all() as Array<{ id: number; code: string; data_type: string; active: number }>;
    const brands = new Map(brandRows.map(row => [row.metel_marchio, row.id]));
    const categories = new Map(categoryRows.map(row => [row.code, row]));
    const attributes = new Map(attributeRows.map(row => [row.code, row]));
    const applicable = new Set((database.prepare(`
      SELECT category_id || ':' || attribute_id FROM cat_category_attribute
    `).pluck().all() as string[]));
    const existing = database.prepare(`
      SELECT f.id, f.brand_id AS brandId, f.category_id AS categoryId,
        c.code AS categoryCode, b.metel_marchio AS marchio, f.code, f.source
      FROM cat_product_family f JOIN cat_brand b ON b.id = f.brand_id
      JOIN cat_category c ON c.id = f.category_id
    `).all() as ExistingFamily[];
    const byIdentity = new Map(existing.map(row => [`${row.marchio}\0${row.code}`, row]));
    const incoming = new Set(seed.map(row => `${row.brandMarchio}\0${row.code}`));

    for (const family of existing) {
      if (family.source === "seed" && !incoming.has(`${family.marchio}\0${family.code}`)) {
        database.prepare("UPDATE cat_product_family SET active = 0 WHERE id = ?").run(family.id);
        retired.add(`${family.marchio}:${family.code}`);
      }
    }

    let deferred = 0;
    for (const row of seed) {
      const retirementKey = `${row.brandMarchio}:${row.code}`;
      assert(!retired.has(retirementKey) || !row.active, `retired family code cannot be reused: ${retirementKey}`);
      if (!row.active) retired.add(retirementKey);

      const identity = `${row.brandMarchio}\0${row.code}`;
      let family = byIdentity.get(identity);
      if (family?.source === "seed") {
        assert(family.categoryCode === row.categoryCode,
          `category contract cannot change for ${row.brandMarchio}/${row.code}`);
      }
      // Retirement is effective reference-data state, not new materialization:
      // missing/inactive dependencies must never keep an existing seed family active.
      if (!row.active && family?.source === "seed") {
        database.prepare("UPDATE cat_product_family SET active = 0 WHERE id = ?").run(family.id);
      }

      const brandId = brands.get(row.brandMarchio);
      const category = categories.get(row.categoryCode);
      const axes = row.axes.map(code => attributes.get(code));
      const ready = brandId !== undefined && category !== undefined && category.active === 1
        && axes.every(axis => axis !== undefined && axis.active === 1
          && (axis.data_type === "enum" || axis.data_type === "number")
          && applicable.has(`${category.id}:${axis.id}`));
      if (!ready || brandId === undefined || category === undefined) {
        deferred++;
        continue;
      }

      if (family?.source === "manual") continue;
      if (!family) {
        const result = database.prepare(`
          INSERT INTO cat_product_family
            (brand_id, code, category_id, name, series, description, active, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'seed')
        `).run(brandId, row.code, category.id, row.name, row.series, row.description, Number(row.active));
        family = { id: Number(result.lastInsertRowid), brandId, categoryId: category.id,
          categoryCode: row.categoryCode, marchio: row.brandMarchio, code: row.code, source: "seed" };
        byIdentity.set(identity, family);
      } else {
        database.prepare(`
          UPDATE cat_product_family SET name = ?, series = ?, description = ?, active = ?
          WHERE id = ? AND source = 'seed'
        `).run(row.name, row.series, row.description, Number(row.active), family.id);
      }

      const currentAxes = database.prepare(`
        SELECT a.code FROM cat_family_variant_axis va
        JOIN cat_attribute a ON a.id = va.attribute_id
        WHERE va.family_id = ? ORDER BY va.sort_order
      `).pluck().all(family.id) as string[];
      if (currentAxes.length > 0) {
        assert(JSON.stringify(currentAxes) === JSON.stringify(row.axes),
          `axis contract cannot change for ${row.brandMarchio}/${row.code}`);
      } else {
        const insertAxis = database.prepare(`
          INSERT INTO cat_family_variant_axis (family_id, attribute_id, sort_order) VALUES (?, ?, ?)
        `);
        axes.forEach((axis, index) => insertAxis.run(family!.id, axis!.id, index));
      }
    }

    const effectiveFamilies = database.prepare(`
      SELECT f.id, f.brand_id, f.code, f.category_id, f.name, f.series,
        f.description, f.active, f.source
      FROM cat_product_family f ORDER BY f.brand_id, f.code
    `).all();
    const effectiveAxes = database.prepare(`
      SELECT family_id, attribute_id, sort_order
      FROM cat_family_variant_axis ORDER BY family_id, sort_order
    `).all();
    const fingerprint = createHash("sha256").update(canonical({
      engine: FAMILY_GROUPING_VERSION,
      groupers: [...groupers].sort(([a], [b]) => a.localeCompare(b))
        .map(([marchio, grouper]) => ({ marchio, code: grouper.code, version: grouper.version })),
      families: effectiveFamilies,
      axes: effectiveAxes,
      enrichment: getSetting(ATTRIBUTE_ENRICHMENT_FINGERPRINT_KEY) ?? null,
    })).digest("hex");
    const regrouped = getSetting(FAMILY_GROUPING_FINGERPRINT_KEY) !== fingerprint;
    const grouping = regrouped || options.affectedIds !== undefined
      ? groupProductFamilies(database, groupers, regrouped ? undefined : options.affectedIds)
      : null;
    setSetting.run(RETIRED_FAMILY_CODES_KEY, JSON.stringify([...retired].sort()));
    setSetting.run(FAMILY_GROUPING_FINGERPRINT_KEY, fingerprint);
    return { fingerprint, deferred, regrouped, grouping };
  })();
}
