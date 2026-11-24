import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { appSetting, attribute, attributeOption, category, categoryAttribute } from "../../../db/schema/lq.js";
import {
  ENRICHMENT_VERSION,
  enrichProductAttributes,
  type AttributeEnrichmentStats,
  type AttributeParserRegistry,
} from "./attribute-enrichment.js";
import { canonical, CLASSIFICATION_FINGERPRINT_KEY, STABLE_CODE } from "./category-seed.js";
import { ATTRIBUTE_PARSERS } from "./parsers/index.js";
import { ENGINEERING_VOCABULARY_FINGERPRINT_KEY } from "./engineering-vocabulary.js";

export type AttributeDataType = "number" | "enum" | "boolean" | "text";
export type FilterWidget = "range" | "checkbox" | "select";

export interface SeedAttributeOption {
  value: string;
  label: string;
  sortOrder: number;
  active: boolean;
}
export interface SeedAttribute {
  code: string;
  name: string;
  dataType: AttributeDataType;
  /** Only number attributes have a unit. Values are stored in this unit. */
  unit: string | null;
  active: boolean;
  /** Required for enum attributes, empty otherwise. */
  options: SeedAttributeOption[];
}
export interface SeedCategoryAttribute {
  categoryCode: string;
  attributeCode: string;
  sortOrder: number;
  isFilterable: boolean;
  isRequired: boolean;
  filterWidget: FilterWidget;
}
export interface AttributeSeed {
  attributes: SeedAttribute[];
  categoryAttributes: SeedCategoryAttribute[];
}

export const ATTRIBUTE_ENRICHMENT_FINGERPRINT_KEY = "catalogue.attribute_enrichment_fingerprint";
const RETIRED_ATTRIBUTES_KEY = "catalogue.retired_attribute_codes";
const RETIRED_OPTIONS_KEY = "catalogue.retired_attribute_option_codes";
/** Option values are stable codes too, e.g. `1p_n`; they may start with a digit. */
export const OPTION_VALUE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const DATA_TYPES: readonly string[] = ["number", "enum", "boolean", "text"];
const WIDGETS: readonly string[] = ["range", "checkbox", "select"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid attribute seed: ${message}`);
}

const nonEmpty = (value: unknown) => typeof value === "string" && value.trim().length > 0;

/** `categoryCodes`, when given, must contain every linked category code. */
export function validateAttributeSeed(value: unknown, categoryCodes?: ReadonlySet<string>): asserts value is AttributeSeed {
  assert(value && typeof value === "object", "expected an object");
  const seed = value as AttributeSeed;
  assert(Array.isArray(seed.attributes) && Array.isArray(seed.categoryAttributes), "expected attributes and categoryAttributes arrays");
  const attributes = new Map<string, SeedAttribute>();
  for (const a of seed.attributes) {
    assert(a && typeof a.code === "string" && STABLE_CODE.test(a.code), "invalid attribute code");
    assert(!attributes.has(a.code), `duplicate attribute code ${a.code}`);
    attributes.set(a.code, a);
    assert(nonEmpty(a.name) && DATA_TYPES.includes(a.dataType) && typeof a.active === "boolean", `invalid attribute ${a.code}`);
    assert(a.dataType === "number" ? a.unit === null || nonEmpty(a.unit) : a.unit === null, `invalid unit for ${a.code}`);
    assert(Array.isArray(a.options), `options must be an array for ${a.code}`);
    assert(a.dataType === "enum" ? a.options.length > 0 : a.options.length === 0, `options only and always for enum attribute ${a.code}`);
    const values = new Set<string>();
    for (const o of a.options) {
      assert(o && typeof o.value === "string" && OPTION_VALUE.test(o.value), `invalid option value for ${a.code}`);
      assert(!values.has(o.value), `duplicate option ${a.code}:${o.value}`);
      values.add(o.value);
      assert(nonEmpty(o.label) && Number.isSafeInteger(o.sortOrder) && typeof o.active === "boolean", `invalid option ${a.code}:${o.value}`);
    }
  }
  const links = new Set<string>();
  for (const l of seed.categoryAttributes) {
    assert(l && typeof l.categoryCode === "string" && STABLE_CODE.test(l.categoryCode), "invalid link category code");
    assert(attributes.has(l.attributeCode), `unknown attribute ${String(l.attributeCode)} in link`);
    assert(!categoryCodes || categoryCodes.has(l.categoryCode), `unknown category ${l.categoryCode} in link`);
    const key = `${l.categoryCode}\0${l.attributeCode}`;
    assert(!links.has(key), `duplicate link ${l.categoryCode} / ${l.attributeCode}`);
    links.add(key);
    assert(Number.isSafeInteger(l.sortOrder) && typeof l.isFilterable === "boolean" && typeof l.isRequired === "boolean"
      && WIDGETS.includes(l.filterWidget), `invalid link ${l.categoryCode} / ${l.attributeCode}`);
  }
}

/** Reads `attributes.json` and `category-attributes.json`; links are checked against `categories.json`. */
export function loadAttributeSeed(folder = path.resolve("db", "seed")): AttributeSeed {
  const read = (file: string): unknown => JSON.parse(readFileSync(path.join(folder, file), "utf8"));
  const categories = read("categories.json");
  assert(Array.isArray(categories), "categories.json must contain an array");
  const seed: unknown = { attributes: read("attributes.json"), categoryAttributes: read("category-attributes.json") };
  validateAttributeSeed(seed, new Set(categories.map(c => (c as { code: string }).code)));
  return seed;
}

export interface AttributeSynchronizationOptions {
  /** When the fingerprint is unchanged, only these products are re-enriched. */
  readonly affectedIds?: ReadonlySet<number>;
  /** Defaults to the production parser registry. */
  readonly parsers?: AttributeParserRegistry;
  /** Install reference definitions before vocabulary resolution; classify and derive in the final pass. */
  readonly referenceOnly?: boolean;
}

export interface AttributeSynchronizationResult {
  readonly fingerprint: string;
  /** True when every product was re-enriched because the fingerprint changed. */
  readonly reenriched: boolean;
  readonly enrichment: AttributeEnrichmentStats | null;
}

/**
 * Reconciles attribute reference data and enriches products, atomically with
 * the fingerprint. Must run after category synchronization, because
 * applicability follows each product's current category. Called in the
 * startup worker and inside the delivery normalization transaction.
 */
export function synchronizeAttributeSeed(
  database: Database.Database,
  seed: AttributeSeed = loadAttributeSeed(),
  options: AttributeSynchronizationOptions = {},
): AttributeSynchronizationResult {
  validateAttributeSeed(seed);
  const parsers = options.parsers ?? ATTRIBUTE_PARSERS;
  return database.transaction(() => {
    const db = drizzle(database);
    const getSetting = (key: string) => db.select().from(appSetting).where(eq(appSetting.key, key)).get()?.value;
    const setSetting = (key: string, value: string) => db.insert(appSetting).values({ key, value })
      .onConflictDoUpdate({ target: appSetting.key, set: { value } }).run();

    // Attributes: stable identity, protected manual rows, retirement instead of reuse.
    const existing = db.select().from(attribute).all();
    const incoming = new Map(seed.attributes.map(a => [a.code, a]));
    const retired = new Set<string>(JSON.parse(getSetting(RETIRED_ATTRIBUTES_KEY) ?? "[]") as string[]);
    for (const a of existing) {
      const next = incoming.get(a.code);
      if (a.source === "seed" && (!next || !a.active)) retired.add(a.code);
      if (next) {
        assert(next.dataType === a.dataType && next.unit === a.unit, `data type/unit of ${a.code} cannot change`);
      }
    }
    for (const a of seed.attributes) {
      assert(!retired.has(a.code) || !a.active, `retired attribute code cannot be reused: ${a.code}`);
      if (!a.active) retired.add(a.code);
      db.insert(attribute).values({ code: a.code, name: a.name, dataType: a.dataType, unit: a.unit, active: Number(a.active), source: "seed" })
        .onConflictDoUpdate({ target: attribute.code, set: { name: a.name, active: Number(a.active) }, setWhere: eq(attribute.source, "seed") }).run();
    }
    for (const a of existing) {
      if (a.source === "seed" && !incoming.has(a.code)) db.update(attribute).set({ active: 0 }).where(eq(attribute.id, a.id)).run();
    }
    const attributeIds = new Map(db.select().from(attribute).all().map(a => [a.code, a.id]));
    const attributeCodes = new Map([...attributeIds].map(([code, id]) => [id, code]));

    // Options: same lifecycle, keyed by (attribute code, value).
    const retiredOptions = new Set<string>(JSON.parse(getSetting(RETIRED_OPTIONS_KEY) ?? "[]") as string[]);
    const incomingOptions = new Set<string>();
    const existingOptions = db.select().from(attributeOption).all();
    for (const o of existingOptions) {
      const key = `${attributeCodes.get(o.attributeId)}:${o.value}`;
      const next = incoming.get(attributeCodes.get(o.attributeId)!)?.options.find(n => n.value === o.value);
      if (o.source === "seed" && (!next || !o.active)) retiredOptions.add(key);
    }
    for (const a of seed.attributes) {
      for (const o of a.options) {
        const key = `${a.code}:${o.value}`;
        incomingOptions.add(key);
        assert(!retiredOptions.has(key) || !o.active, `retired option cannot be reused: ${key}`);
        if (!o.active) retiredOptions.add(key);
        db.insert(attributeOption).values({ attributeId: attributeIds.get(a.code)!, value: o.value, label: o.label,
          sortOrder: o.sortOrder, active: Number(o.active), source: "seed" })
          .onConflictDoUpdate({ target: [attributeOption.attributeId, attributeOption.value],
            set: { label: o.label, sortOrder: o.sortOrder, active: Number(o.active) }, setWhere: eq(attributeOption.source, "seed") }).run();
      }
    }
    for (const o of existingOptions) {
      if (o.source === "seed" && !incomingOptions.has(`${attributeCodes.get(o.attributeId)}:${o.value}`)) {
        db.update(attributeOption).set({ active: 0 }).where(eq(attributeOption.id, o.id)).run();
      }
    }

    // Applicability links are not referenced elsewhere: removed seed links are deleted.
    // A link to a category that does not exist yet is deferred, never widened.
    const categoryIds = new Map(db.select().from(category).all().map(c => [c.code, c.id]));
    const materialized = new Set<string>();
    for (const l of seed.categoryAttributes) {
      const categoryId = categoryIds.get(l.categoryCode);
      if (categoryId === undefined) continue;
      const attributeId = attributeIds.get(l.attributeCode)!;
      materialized.add(`${categoryId}:${attributeId}`);
      const values = { sortOrder: l.sortOrder, isFilterable: Number(l.isFilterable), isRequired: Number(l.isRequired), filterWidget: l.filterWidget };
      db.insert(categoryAttribute).values({ categoryId, attributeId, ...values, source: "seed" })
        .onConflictDoUpdate({ target: [categoryAttribute.categoryId, categoryAttribute.attributeId], set: values,
          setWhere: eq(categoryAttribute.source, "seed") }).run();
    }
    for (const l of db.select().from(categoryAttribute).all()) {
      if (l.source === "seed" && !materialized.has(`${l.categoryId}:${l.attributeId}`)) {
        db.delete(categoryAttribute).where(and(eq(categoryAttribute.categoryId, l.categoryId), eq(categoryAttribute.attributeId, l.attributeId))).run();
      }
    }

    if (options.referenceOnly) {
      setSetting(RETIRED_ATTRIBUTES_KEY, JSON.stringify([...retired].sort()));
      setSetting(RETIRED_OPTIONS_KEY, JSON.stringify([...retiredOptions].sort()));
      return {fingerprint:getSetting(ATTRIBUTE_ENRICHMENT_FINGERPRINT_KEY)??"",reenriched:false,enrichment:null};
    }
    const byCode = <T extends { code: string }>(rows: T[]) => [...rows].sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    const fingerprint = createHash("sha256").update(canonical({
      engine: ENRICHMENT_VERSION,
      parsers: [...parsers].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([marchio, parser]) => ({ marchio, code: parser.code, version: parser.version })),
      attributes: byCode(seed.attributes).map(a => ({ ...a, options: [...a.options].sort((x, y) => x.value < y.value ? -1 : 1) })),
      categoryAttributes: [...seed.categoryAttributes].map(l => ({ ...l, key: `${l.categoryCode}\0${l.attributeCode}` }))
        .sort((a, b) => a.key < b.key ? -1 : 1),
      effectiveAttributes: db.select().from(attribute).orderBy(attribute.code).all(),
      effectiveOptions: db.select().from(attributeOption).orderBy(attributeOption.attributeId, attributeOption.value).all(),
      effectiveLinks: db.select().from(categoryAttribute).orderBy(categoryAttribute.categoryId, categoryAttribute.attributeId).all(),
      // Applicability follows categories: a reclassification must re-enrich.
      classification: getSetting(CLASSIFICATION_FINGERPRINT_KEY) ?? null,
      engineeringVocabulary: getSetting(ENGINEERING_VOCABULARY_FINGERPRINT_KEY) ?? null,
      engineeringImports: database.prepare(`SELECT adapter_code,fingerprint FROM app_source_import
        WHERE became_current=1 ORDER BY adapter_code,fingerprint`).all(),
    })).digest("hex");
    const reenriched = getSetting(ATTRIBUTE_ENRICHMENT_FINGERPRINT_KEY) !== fingerprint;
    const enrichment = reenriched || options.affectedIds !== undefined
      ? enrichProductAttributes(database, parsers, reenriched ? undefined : options.affectedIds) : null;
    setSetting(RETIRED_ATTRIBUTES_KEY, JSON.stringify([...retired].sort()));
    setSetting(RETIRED_OPTIONS_KEY, JSON.stringify([...retiredOptions].sort()));
    setSetting(ATTRIBUTE_ENRICHMENT_FINGERPRINT_KEY, fingerprint);
    return { fingerprint, reenriched, enrichment };
  })();
}
