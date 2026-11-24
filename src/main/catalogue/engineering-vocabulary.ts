import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { canonical } from "./category-seed.js";

export interface EngineeringAttributeValue {
  readonly attribute: string;
  readonly number?: number;
  readonly option?: string;
}
export interface EngineeringValueSeed {
  readonly dimension: string;
  readonly value: string;
  readonly reviewedLabel: string;
  readonly attributes: readonly EngineeringAttributeValue[];
}
export interface EngineeringModelSeed {
  readonly model: string;
  readonly reviewedName: string;
  readonly category: string;
  readonly attributes: readonly EngineeringAttributeValue[];
  readonly evidence: string;
}
export interface EngineeringNotApplicable {
  readonly dimension?: string;
  readonly value?: string;
  readonly model?: string;
  readonly reviewedLabel?: string;
  readonly reviewedName?: string;
  readonly reason: string;
}
export interface EngineeringVocabularySeed {
  readonly adapterCode: string;
  readonly values: readonly EngineeringValueSeed[];
  readonly models: readonly EngineeringModelSeed[];
  readonly notApplicable: readonly EngineeringNotApplicable[];
}
export interface EngineeringVocabularyResult {
  readonly fingerprint: string;
  readonly deferred: readonly string[];
  readonly stale: readonly string[];
  readonly appliedValues: number;
  readonly appliedModels: number;
}
export interface EngineeringVocabularyWarnings {
  readonly deferred: { readonly count: number; readonly sampleKeys: readonly string[] };
  readonly stale: { readonly count: number; readonly sampleKeys: readonly string[] };
}

/** The same bounded warning shape used by import reports; stable codes remain visible. */
export function engineeringVocabularyWarnings(result: Pick<EngineeringVocabularyResult, "deferred" | "stale">): EngineeringVocabularyWarnings | null {
  if (!result.deferred.length && !result.stale.length) return null;
  const bucket = (keys: readonly string[]) => ({ count: keys.length, sampleKeys: keys.slice(0, 8).map(key => key.replace("\0", "/")) });
  return { deferred: bucket(result.deferred), stale: bucket(result.stale) };
}
export const ENGINEERING_VOCABULARY_FINGERPRINT_KEY = "catalogue.engineering_vocabulary_fingerprint";

const fail = (message: string): never => { throw new Error(`Invalid engineering vocabulary: ${message}`); };
const filled = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const keyOf = (dimension: string, value: string): string => `${dimension}\0${value}`;

export function validateEngineeringVocabulary(seed: EngineeringVocabularySeed): void {
  if (seed.adapterCode !== "tiquadri" || !Array.isArray(seed.values) || !Array.isArray(seed.models) || !Array.isArray(seed.notApplicable)) fail("invalid shape or adapter");
  const valueKeys = new Set<string>(), modelKeys = new Set<string>();
  const attributes = (rows: readonly EngineeringAttributeValue[], owner: string) => {
    if (!Array.isArray(rows) || rows.length === 0) fail(`missing attributes for ${owner}`);
    const seen = new Set<string>();
    for (const row of rows) {
      if (!filled(row.attribute) || seen.has(row.attribute) || (Number.isFinite(row.number) && row.number! > 0) === filled(row.option)) fail(`invalid attribute for ${owner}`);
      seen.add(row.attribute);
    }
  };
  for (const row of seed.values) {
    if (!filled(row.dimension) || !filled(row.value) || !filled(row.reviewedLabel)) fail("invalid value row");
    const key = keyOf(row.dimension, row.value);
    if (valueKeys.has(key)) fail(`duplicate value ${key}`);
    valueKeys.add(key);
    attributes(row.attributes, key);
  }
  for (const row of seed.models) {
    if (!filled(row.model) || !filled(row.reviewedName) || !filled(row.category) || !filled(row.evidence) || modelKeys.has(row.model)) fail(`invalid model ${row.model}`);
    modelKeys.add(row.model);
    if (!Array.isArray(row.attributes)) fail(`invalid model attributes ${row.model}`);
    if (row.attributes.length) attributes(row.attributes, row.model);
  }
  const excluded = new Set<string>();
  for (const row of seed.notApplicable) {
    if (!filled(row.reason) || (filled(row.model) === (filled(row.dimension) && filled(row.value)))) fail("invalid notApplicable row");
    const key = row.model ? `model:${row.model}` : `value:${keyOf(row.dimension!, row.value!)}`;
    if (excluded.has(key) || (row.model ? modelKeys.has(row.model) : valueKeys.has(keyOf(row.dimension!, row.value!)))) fail(`duplicate or mapped notApplicable ${key}`);
    excluded.add(key);
  }
}

export function loadEngineeringVocabularySeed(folder = path.resolve("db", "seed")): EngineeringVocabularySeed {
  const seed = JSON.parse(readFileSync(path.join(folder, "engineering-vocabulary", "tiquadri.json"), "utf8")) as EngineeringVocabularySeed;
  validateEngineeringVocabulary(seed);
  return seed;
}

type AttributeInfo = { id: number; code: string; dataType: string; active: number };
type Resolved = { attributeId: number; valueNum: number | null; optionId: number | null };

/** Stable-code sync; the adapter owns definitions and this function owns seed relations only. */
export function synchronizeEngineeringVocabulary(
  database: Database.Database,
  seed: EngineeringVocabularySeed = loadEngineeringVocabularySeed(),
): EngineeringVocabularyResult {
  validateEngineeringVocabulary(seed);
  const run = (): EngineeringVocabularyResult => {
    const attrs = new Map((database.prepare("SELECT id, code, data_type AS dataType, active FROM cat_attribute").all() as AttributeInfo[]).map(a => [a.code, a]));
    const categories = new Map((database.prepare("SELECT id, code, active FROM cat_category").all() as Array<{ id: number; code: string; active: number }>).map(c => [c.code, c]));
    const options = new Map((database.prepare(`SELECT a.code || ':' || o.value AS key, o.id, o.active FROM cat_attribute_option o JOIN cat_attribute a ON a.id=o.attribute_id`).all() as Array<{key:string;id:number;active:number}>).map(o => [o.key, o]));
    const resolve = (row: EngineeringAttributeValue): Resolved => {
      const a = attrs.get(row.attribute) ?? fail(`unknown attribute ${row.attribute}`);
      if (!a.active) fail(`inactive attribute ${row.attribute}`);
      if (row.number !== undefined) {
        if (a.dataType !== "number" || !Number.isFinite(row.number) || row.number <= 0 || row.option !== undefined) fail(`invalid number ${row.attribute}`);
        return { attributeId: a.id, valueNum: row.number, optionId: null };
      }
      if (a.dataType !== "enum" || !filled(row.option)) fail(`invalid option ${row.attribute}`);
      const option = options.get(`${row.attribute}:${row.option}`) ?? fail(`unknown option ${row.attribute}:${row.option}`);
      if (!option.active) fail(`inactive option ${row.attribute}:${row.option}`);
      return { attributeId: a.id, valueNum: null, optionId: option.id };
    };
    // Empty catalogues defer source-code rows. Once TiQuadri is present, bad
    // reference codes are seed errors even if a particular source value is absent.
    if (database.prepare("SELECT 1 FROM cat_config_dimension WHERE code LIKE 'tq.%' LIMIT 1").get()) {
      for (const row of seed.values) for (const item of row.attributes) resolve(item);
      for (const row of seed.models) {
        const category = categories.get(row.category) ?? fail(`unknown category ${row.category}`);
        if (!category.active) fail(`inactive category ${row.category}`);
        for (const item of row.attributes) {
          const resolved = resolve(item);
          if (!database.prepare("SELECT 1 FROM cat_category_attribute WHERE category_id=? AND attribute_id=?").get(category.id, resolved.attributeId))
            fail(`attribute ${item.attribute} not linked to ${row.category}`);
        }
      }
    }
    const deferred: string[] = [], stale: string[] = [];
    const valueIds = new Set<number>(), modelIds = new Set<number>();
    const findValue = database.prepare(`SELECT v.id, v.label, v.active, d.active AS dimensionActive
      FROM cat_config_dimension_value v JOIN cat_config_dimension d ON d.id=v.dimension_id
      WHERE d.code=? AND v.code=?`);
    const findModel = database.prepare("SELECT id, name, active, obsolete, category_source AS categorySource FROM cat_config_model WHERE code=?");
    const upsertValue = database.prepare(`INSERT INTO cat_config_value_attribute(value_id,attribute_id,value_num,option_id,source)
      VALUES(?,?,?,?,'seed') ON CONFLICT(value_id,attribute_id) DO UPDATE SET value_num=excluded.value_num,option_id=excluded.option_id
      WHERE cat_config_value_attribute.source='seed' AND (cat_config_value_attribute.value_num IS NOT excluded.value_num OR cat_config_value_attribute.option_id IS NOT excluded.option_id)`);
    const upsertModel = database.prepare(`INSERT INTO cat_config_model_attribute(model_id,attribute_id,value_num,option_id,source)
      VALUES(?,?,?,?,'seed') ON CONFLICT(model_id,attribute_id) DO UPDATE SET value_num=excluded.value_num,option_id=excluded.option_id
      WHERE cat_config_model_attribute.source='seed' AND (cat_config_model_attribute.value_num IS NOT excluded.value_num OR cat_config_model_attribute.option_id IS NOT excluded.option_id)`);
    const wantedValues = new Set<string>(), wantedModels = new Set<string>();
    for (const row of seed.values) {
      const matches = findValue.all(row.dimension, row.value) as Array<{id:number;label:string;active:number;dimensionActive:number}>;
      const key = keyOf(row.dimension, row.value);
      if (!matches.length) { deferred.push(key); continue; }
      if (matches.length !== 1) fail(`non-unique value ${key}`);
      const match = matches[0]!;
      if (!match.active || !match.dimensionActive) continue;
      if (match.label !== row.reviewedLabel) { stale.push(key); continue; }
      valueIds.add(match.id);
      for (const attribute of row.attributes) {
        const v = resolve(attribute);
        wantedValues.add(`${match.id}:${v.attributeId}`);
        upsertValue.run(match.id, v.attributeId, v.valueNum, v.optionId);
      }
    }
    for (const row of seed.models) {
      const matches = findModel.all(row.model) as Array<{id:number;name:string;active:number;obsolete:number;categorySource:string}>;
      if (!matches.length) { deferred.push(row.model); continue; }
      if (matches.length !== 1) fail(`non-unique model ${row.model}`);
      const match = matches[0]!;
      if (!match.active || match.obsolete) continue;
      if (match.name !== row.reviewedName) { stale.push(row.model); continue; }
      modelIds.add(match.id);
      const category = categories.get(row.category) ?? fail(`unknown category ${row.category}`);
      if (!category.active) fail(`inactive category ${row.category}`);
      const categoryId = category.id;
      for (const item of row.attributes) {
        const resolved = resolve(item);
        if (!database.prepare("SELECT 1 FROM cat_category_attribute WHERE category_id=? AND attribute_id=?").get(categoryId, resolved.attributeId))
          fail(`attribute ${item.attribute} not linked to ${row.category}`);
      }
      database.prepare(`UPDATE cat_config_model SET category_id=?,category_source='seed'
        WHERE id=? AND category_source<>'manual' AND (category_id IS NOT ? OR category_source<>'seed')`).run(categoryId, match.id, categoryId);
      for (const attribute of row.attributes) {
        const v = resolve(attribute);
        wantedModels.add(`${match.id}:${v.attributeId}`);
        upsertModel.run(match.id, v.attributeId, v.valueNum, v.optionId);
      }
    }
    for (const row of seed.notApplicable) {
      if (row.model) {
        const matches = findModel.all(row.model) as Array<{id:number;name:string;active:number;obsolete:number}>;
        if (!matches.length) { deferred.push(row.model); continue; }
        if (matches.length !== 1) fail(`non-unique model ${row.model}`);
        if (matches[0]!.active && !matches[0]!.obsolete && row.reviewedName !== undefined &&
          matches[0]!.name !== row.reviewedName) stale.push(row.model);
      } else {
        const key = keyOf(row.dimension!, row.value!);
        const matches = findValue.all(row.dimension, row.value) as Array<{id:number;label:string;active:number;dimensionActive:number}>;
        if (!matches.length) { deferred.push(key); continue; }
        if (matches.length !== 1) fail(`non-unique value ${key}`);
        if (matches[0]!.active && matches[0]!.dimensionActive && row.reviewedLabel !== undefined &&
          matches[0]!.label !== row.reviewedLabel) stale.push(key);
      }
    }
    const staleSeedValues = database.prepare(`SELECT va.value_id AS valueId,va.attribute_id AS attributeId
      FROM cat_config_value_attribute va JOIN cat_config_dimension_value v ON v.id=va.value_id
      JOIN cat_config_dimension d ON d.id=v.dimension_id WHERE va.source='seed' AND d.code LIKE 'tq.%'`).all() as Array<{valueId:number;attributeId:number}>;
    const deleteValue = database.prepare("DELETE FROM cat_config_value_attribute WHERE value_id=? AND attribute_id=? AND source='seed'");
    for (const row of staleSeedValues) if (!wantedValues.has(`${row.valueId}:${row.attributeId}`)) deleteValue.run(row.valueId, row.attributeId);
    const staleSeedModels = database.prepare(`SELECT ma.model_id AS modelId,ma.attribute_id AS attributeId
      FROM cat_config_model_attribute ma JOIN cat_config_model m ON m.id=ma.model_id
      WHERE ma.source='seed' AND m.code LIKE 'tq.pack.%'`).all() as Array<{modelId:number;attributeId:number}>;
    const deleteModel = database.prepare("DELETE FROM cat_config_model_attribute WHERE model_id=? AND attribute_id=? AND source='seed'");
    for (const row of staleSeedModels) if (!wantedModels.has(`${row.modelId}:${row.attributeId}`)) deleteModel.run(row.modelId, row.attributeId);
    database.prepare(`UPDATE cat_config_model SET category_id=NULL,category_source='unmapped'
      WHERE category_source='seed' AND code LIKE 'tq.pack.%' AND id NOT IN (SELECT value FROM json_each(?))`)
      .run(JSON.stringify([...modelIds]));
    const fingerprint = createHash("sha256").update(canonical({ seed,
      values: database.prepare(`SELECT va.* FROM cat_config_value_attribute va JOIN cat_config_dimension_value v ON v.id=va.value_id
        JOIN cat_config_dimension d ON d.id=v.dimension_id WHERE d.code LIKE 'tq.%' ORDER BY va.value_id,va.attribute_id`).all(),
      models: database.prepare(`SELECT id,category_id,category_source FROM cat_config_model WHERE code LIKE 'tq.pack.%' ORDER BY code`).all(),
      modelAttributes: database.prepare(`SELECT ma.* FROM cat_config_model_attribute ma JOIN cat_config_model m ON m.id=ma.model_id
        WHERE m.code LIKE 'tq.pack.%' ORDER BY ma.model_id,ma.attribute_id`).all(),
    })).digest("hex");
    database.prepare(`INSERT INTO app_setting(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value<>excluded.value`)
      .run(ENGINEERING_VOCABULARY_FINGERPRINT_KEY, fingerprint);
    return { fingerprint, deferred, stale, appliedValues: valueIds.size, appliedModels: modelIds.size };
  };
  return database.inTransaction ? run() : database.transaction(run)();
}
