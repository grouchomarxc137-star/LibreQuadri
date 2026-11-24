import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { appSetting, brand, category, categoryMapping, metelIssuer } from "../../../db/schema/lq.js";
import { ENGINEERING_LINK_POLICY_VERSION } from "../sources/engineering-links.js";
import { CLASSIFIER_VERSION, classifyProducts, supportedMatch, type MappingType, type MatchMode } from "./category-classifier.js";

export interface SeedCategory {
  code: string;
  parentCode: string | null;
  name: string;
  sortOrder: number;
  active: boolean;
}
export interface SeedMapping {
  code: string;
  // Explicit null means any. Missing/empty scope is invalid, never a wildcard.
  issuerSigla: string | null;
  brandMarchio: string | null;
  sourceType: MappingType;
  matchMode: MatchMode;
  matchValue: string;
  categoryCode: string;
  priority: number;
  notes: string | null;
}
export interface CategorySeed {
  categories: SeedCategory[];
  mappings: SeedMapping[];
}

export const CLASSIFICATION_FINGERPRINT_KEY = "catalogue.category_classifier_fingerprint";
const RETIRED_CODES_KEY = "catalogue.retired_category_codes";
export const STABLE_CODE = /^[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*$/;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid category seed: ${message}`);
}

export function validateCategorySeed(value: unknown): asserts value is CategorySeed {
  assert(value && typeof value === "object", "expected an object");
  const seed = value as CategorySeed;
  assert(Array.isArray(seed.categories) && Array.isArray(seed.mappings), "expected categories and mappings arrays");
  const unique = (rows: Array<{ code: string }>) => {
    const seen = new Set<string>();
    for (const row of rows) {
      assert(row && typeof row.code === "string" && STABLE_CODE.test(row.code), "invalid stable code");
      assert(!seen.has(row.code), `duplicate stable code ${row.code}`);
      seen.add(row.code);
    }
    return seen;
  };
  const codes = unique(seed.categories);
  unique(seed.mappings);
  const categories = new Map(seed.categories.map(c => [c.code, c]));
  for (const c of seed.categories) {
    assert(typeof c.name === "string" && c.name.trim() && Number.isSafeInteger(c.sortOrder) && typeof c.active === "boolean", `invalid category ${c.code}`);
    assert(c.parentCode === null || codes.has(c.parentCode), `missing parent for ${c.code}`);
    const ancestors = new Set<string>([c.code]);
    let parent = c.parentCode;
    while (parent !== null) {
      assert(!ancestors.has(parent), `parent cycle at ${c.code}`);
      ancestors.add(parent);
      const ancestor = categories.get(parent);
      assert(ancestor !== undefined, `missing parent ${parent}`);
      parent = ancestor.parentCode;
    }
  }
  const rules = new Map<string, string>();
  for (const m of seed.mappings) {
    for (const scope of [m.issuerSigla, m.brandMarchio]) {
      assert(scope === null || (typeof scope === "string" && /^[A-Z0-9]{3}$/.test(scope)), `missing or invalid scope for ${m.code}`);
    }
    assert(codes.has(m.categoryCode), `unknown target for ${m.code}`);
    assert(supportedMatch(m.sourceType, m.matchMode), `unsupported rule ${m.code}`);
    assert(typeof m.matchValue === "string" && m.matchValue.trim().length > 0 && Number.isSafeInteger(m.priority), `invalid match or priority for ${m.code}`);
    assert(m.notes === null || typeof m.notes === "string", `invalid notes for ${m.code}`);
    if (m.matchMode === "regex") new RegExp(m.matchValue);
    const key = JSON.stringify([m.issuerSigla, m.brandMarchio, m.sourceType, m.matchMode, m.matchValue, m.priority]);
    assert(!rules.has(key) || rules.get(key) === m.categoryCode, `conflicting rules for ${m.code}`);
    rules.set(key, m.categoryCode);
  }
  // Catch simple scope intersections too (e.g. issuer-only versus brand-only).
  // Arbitrary regex overlap is resolved conservatively by the runtime classifier.
  for (let i = 0; i < seed.mappings.length; i++) {
    const a = seed.mappings[i];
    for (const b of seed.mappings.slice(i + 1)) {
      const overlap = (x: string | null, y: string | null) => x === null || y === null || x === y;
      const specificity = (m: SeedMapping) => Number(m.issuerSigla !== null) + Number(m.brandMarchio !== null);
      if (a.sourceType === b.sourceType && a.matchMode === b.matchMode && a.matchValue === b.matchValue &&
        a.priority === b.priority && specificity(a) === specificity(b) &&
        overlap(a.issuerSigla, b.issuerSigla) && overlap(a.brandMarchio, b.brandMarchio)) {
        assert(a.categoryCode === b.categoryCode, `conflicting scoped rules ${a.code} / ${b.code}`);
      }
    }
  }
}

/** Mapping rules live in one or more `category-mappings/*.json` files (e.g. one per
 * issuer). Files are read in code-unit filename order and concatenated; stable codes
 * must be unique across all files. The fingerprint does not depend on file order.
 */
export const CATEGORY_MAPPINGS_FOLDER = "category-mappings";

export function loadCategorySeed(folder = path.resolve("db", "seed")): CategorySeed {
  const mappingsFolder = path.join(folder, CATEGORY_MAPPINGS_FOLDER);
  const mappingFiles = readdirSync(mappingsFolder, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
    .map(entry => entry.name)
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const mappings: unknown[] = [];
  for (const file of mappingFiles) {
    const rows: unknown = JSON.parse(readFileSync(path.join(mappingsFolder, file), "utf8"));
    assert(Array.isArray(rows), `${CATEGORY_MAPPINGS_FOLDER}/${file} must contain an array`);
    mappings.push(...rows);
  }
  const seed: unknown = {
    categories: JSON.parse(readFileSync(path.join(folder, "categories.json"), "utf8")),
    mappings,
  };
  validateCategorySeed(seed);
  return seed;
}

/** Deterministic JSON for fingerprints: object keys sorted, array order kept. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Seed reconciliation and classification commit together, including the fingerprint.
 * Called in the startup worker or within the delivery normalization transaction.
 */
export function synchronizeCategorySeed(
  database: Database.Database,
  seed: CategorySeed = loadCategorySeed(),
  affectedIds?: ReadonlySet<number>,
  referenceOnly = false,
): { fingerprint: string; reclassified: boolean; changedProducts: number } {
  validateCategorySeed(seed);
  return database.transaction(() => {
    const db = drizzle(database);
    const getSetting = (key: string) => db.select().from(appSetting).where(eq(appSetting.key, key)).get()?.value;
    const setSetting = (key: string, value: string) => db.insert(appSetting).values({ key, value })
      .onConflictDoUpdate({ target: appSetting.key, set: { value } }).run();
    const existingCategories = db.select().from(category).all();
    const retired = new Set<string>(JSON.parse(getSetting(RETIRED_CODES_KEY) ?? "[]") as string[]);
    const incoming = new Map(seed.categories.map(c => [c.code, c]));
    for (const c of existingCategories) {
      if (c.source === "seed" && (!incoming.has(c.code) || !c.active)) retired.add(c.code);
    }
    for (const c of seed.categories) {
      assert(!retired.has(c.code) || !c.active, `retired code cannot be reused: ${c.code}`);
      if (!c.active) retired.add(c.code);
    }
    // Insert all identities before resolving parents; preserve protected manual rows.
    for (const c of seed.categories) {
      db.insert(category).values({ code: c.code, name: c.name, source: "seed", active: Number(c.active), sortOrder: c.sortOrder })
        .onConflictDoNothing({ target: category.code }).run();
    }
    const categoryIds = new Map(db.select().from(category).all().map(c => [c.code, c.id]));
    for (const c of seed.categories) {
      db.update(category).set({ name: c.name, parentId: c.parentCode === null ? null : categoryIds.get(c.parentCode)!,
        active: Number(c.active), sortOrder: c.sortOrder })
        .where(and(eq(category.code, c.code), eq(category.source, "seed"))).run();
    }
    for (const c of existingCategories) {
      if (c.source === "seed" && !incoming.has(c.code)) db.update(category).set({ active: 0 }).where(eq(category.id, c.id)).run();
    }
    // Manual parents can combine with seed parents to form a cycle: fail atomically.
    const effectiveCategories = db.select().from(category).orderBy(category.code).all();
    const parents = new Map(effectiveCategories.map(c => [c.id, c.parentId]));
    for (const c of effectiveCategories) {
      const seen = new Set<number>();
      let id: number | null = c.id;
      while (id !== null) {
        assert(!seen.has(id), `effective parent cycle at ${c.code}`);
        seen.add(id);
        id = parents.get(id) ?? null;
      }
    }
    const issuers = new Map(db.select().from(metelIssuer).all().map(i => [i.metelSigla, i.id]));
    const brands = new Map(db.select().from(brand).all().map(b => [b.metelMarchio, b.id]));
    const materialized = new Set<string>();
    for (const m of seed.mappings) {
      const issuerId = m.issuerSigla === null ? null : issuers.get(m.issuerSigla);
      const brandId = m.brandMarchio === null ? null : brands.get(m.brandMarchio);
      if (issuerId === undefined || brandId === undefined) continue;
      materialized.add(m.code);
      const values = { code: m.code, issuerId, brandId, sourceType: m.sourceType, matchMode: m.matchMode,
        matchValue: m.matchValue, categoryId: categoryIds.get(m.categoryCode)!, priority: m.priority, notes: m.notes, source: "seed" as const };
      db.insert(categoryMapping).values(values).onConflictDoUpdate({ target: categoryMapping.code,
        set: values, setWhere: eq(categoryMapping.source, "seed") }).run();
    }
    for (const m of db.select().from(categoryMapping).all()) {
      if (m.source === "seed" && !materialized.has(m.code)) db.delete(categoryMapping).where(eq(categoryMapping.id, m.id)).run();
    }
    if (referenceOnly) {
      setSetting(RETIRED_CODES_KEY, JSON.stringify([...retired].sort()));
      return {fingerprint:getSetting(CLASSIFICATION_FINGERPRINT_KEY)??"",reclassified:false,changedProducts:0};
    }
    const fingerprint = createHash("sha256").update(canonical({
      classifier: CLASSIFIER_VERSION,
      engineeringLinkPolicy: ENGINEERING_LINK_POLICY_VERSION,
      categories: [...seed.categories].sort((a, b) => a.code < b.code ? -1 : 1),
      mappings: [...seed.mappings].sort((a, b) => a.code < b.code ? -1 : 1),
      effectiveCategories,
      effectiveMappings: db.select().from(categoryMapping).orderBy(categoryMapping.code).all(),
      contributedModels: database.prepare(`SELECT code,category_id,category_source,active,obsolete,
        commercial_contribution FROM cat_config_model WHERE source_import_id IN
        (SELECT id FROM app_source_import WHERE became_current=1) ORDER BY code`).all(),
      engineeringImports: database.prepare(`SELECT adapter_code,fingerprint FROM app_source_import
        WHERE became_current=1 ORDER BY adapter_code,fingerprint`).all(),
    })).digest("hex");
    const reclassified = getSetting(CLASSIFICATION_FINGERPRINT_KEY) !== fingerprint;
    const changedProducts = reclassified || affectedIds !== undefined
      ? classifyProducts(database, reclassified ? undefined : affectedIds) : 0;
    setSetting(RETIRED_CODES_KEY, JSON.stringify([...retired].sort()));
    setSetting(CLASSIFICATION_FINGERPRINT_KEY, fingerprint);
    return { fingerprint, reclassified, changedProducts };
  })();
}
