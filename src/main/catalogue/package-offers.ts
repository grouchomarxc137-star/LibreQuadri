import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { ConfigModelDetail, ConfigurationResult } from "../../shared/configuration.js";
import { configuredItemAddable } from "./configuration-addability.js";
import { getConfigurationModel } from "./configuration-queries.js";
import { CONFIGURATION_RESOLVER_VERSION, resolveConfiguration } from "./configuration-resolver.js";
import { reconcileDerivedDiagnostics, type DerivedDiagnostic } from "./derived-diagnostics.js";
import { readEngineeringReadiness } from "./engineering-readiness.js";
import { ENGINEERING_ADAPTERS, type EngineeringAdapter } from "../sources/engineering-adapters.js";
import { SELECTABLE_PACKAGE_SQL } from "./manufacturer-navigation.js";
import { mapStableSelections } from "./stable-selections.js";

export const PACKAGE_OFFER_FINGERPRINT_KEY = "catalogue.package_offer_fingerprint";
export const PACKAGE_OFFER_SEARCH_BOUND = 4096;
const VERSION = "3";
type Value = { attributeId: number; valueNum: number | null; optionId: number | null };
type Candidate = { ids: number[]; key: string };
type OfferRow = { status: "feasible" | "undecided"; reason: "search_bound" | "value_conflict" | null;
  selections: Array<{ valueId: number; origin: "candidate" | "search" | "default" }>;
  values: Value[]; fingerprint: string | null };

function valueKey(value: Value): string {
  return JSON.stringify([value.attributeId, value.valueNum, value.optionId]);
}
function sortedOptions(options: ConfigModelDetail["axes"][number]["options"]) {
  return [...options].sort((a, b) => a.sortOrder - b.sortOrder ||
    a.valueCode.localeCompare(b.valueCode) || a.id - b.id);
}
function combineValues(values: readonly Value[]): { values: Value[]; conflict: boolean } {
  const byAttribute = new Map<number, Value>();
  let conflict = false;
  for (const value of values) {
    const previous = byAttribute.get(value.attributeId);
    if (previous && valueKey(previous) !== valueKey(value)) conflict = true;
    else byAttribute.set(value.attributeId, value);
  }
  return { values: [...byAttribute.values()].sort((a, b) => a.attributeId - b.attributeId), conflict };
}

/** One relevant choice per axis, with dependent parents included even when their axis has no mapped value. */
function candidates(model: ConfigModelDetail, relevantValues: ReadonlySet<number>): Candidate[] {
  const byId = new Map(model.axes.flatMap(axis => axis.options.map(option => [option.id, option] as const)));
  const relevant = model.axes.filter(axis => axis.visibility === "visible" &&
    axis.options.some(option => option.active && relevantValues.has(option.valueId)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.dimensionCode.localeCompare(b.dimensionCode));
  if (!relevant.length) return [{ ids: [], key: "" }];
  let rows: Candidate[] = [{ ids: [], key: "" }];
  for (const axis of relevant) {
    const next: Candidate[] = [];
    for (const row of rows) {
      let added = false;
      for (const option of sortedOptions(axis.options).filter(option => option.active)) {
      const ids = new Set(row.ids);
      let parent = option.parentOptionId;
      let valid = true;
      while (parent !== null) {
        const ancestor = byId.get(parent);
        if (!ancestor || !ancestor.active) { valid = false; break; }
        if (model.axes.some(other => other.options.some(choice => ids.has(choice.id) && choice.axisId === ancestor.axisId && choice.id !== parent))) {
          valid = false; break;
        }
        ids.add(parent);
        parent = ancestor.parentOptionId;
      }
      if (!valid || [...ids].some(id => byId.get(id)?.axisId === axis.id && id !== option.id)) continue;
      ids.add(option.id);
      next.push({ ids: [...ids].sort((a, b) => a - b), key: [...ids].sort((a, b) => a - b).join(",") });
      added = true;
      }
      if (!added) next.push(row);
    }
    rows = next;
  }
  return [...new Map(rows.map(row => [row.key, row])).values()];
}

/** Deterministic alternatives on other visible axes. The first attempt is always the resolver defaults. */
function* completions(model: ConfigModelDetail, candidate: readonly number[]): Generator<number[]> {
  const locked = new Set(model.axes.filter(axis => axis.options.some(option => candidate.includes(option.id))).map(axis => axis.id));
  const axes = model.axes.filter(axis => axis.visibility === "visible" && !locked.has(axis.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.dimensionCode.localeCompare(b.dimensionCode));
  function* walk(index: number, explicit: number[]): Generator<number[]> {
    if (index === axes.length) { yield explicit; return; }
    const axis = axes[index]!;
    // Leaving an axis to its default must be tried first. Explicit choices then cover ambiguous defaults.
    yield* walk(index + 1, explicit);
    for (const option of sortedOptions(axis.options).filter(option => option.active)) {
      yield* walk(index + 1, [...explicit, option.id]);
    }
  }
  yield* walk(0, [...candidate]);
}

function selectedValues(result: ConfigurationResult, valuesById: ReadonlyMap<number, readonly Value[]>,
  facts: readonly Value[]): { values: Value[]; conflict: boolean } {
  const options = new Map(result.model.axes.flatMap(axis => axis.options.map(option => [option.id, option] as const)));
  return combineValues([...facts, ...result.selectedOptionIds.flatMap(id => valuesById.get(options.get(id)?.valueId ?? -1) ?? [])]);
}

function stableSelections(result: ConfigurationResult, candidate: readonly number[], explicit: readonly number[]): OfferRow["selections"] {
  const options = new Map(result.model.axes.flatMap(axis => axis.options.map(option => [option.id, option] as const)));
  const candidateSet = new Set(candidate), explicitSet = new Set(explicit);
  return result.selectedOptionIds.map(id => ({ valueId: options.get(id)!.valueId,
    origin: candidateSet.has(id) ? "candidate" as const : explicitSet.has(id) ? "search" as const : "default" as const }));
}

function sourceFingerprint(db: Database.Database, bound: number,
  readiness: ReturnType<typeof readEngineeringReadiness>): string {
  const rows = (sql: string) => db.prepare(sql).all();
  const source = {
    version: VERSION, resolver: CONFIGURATION_RESOLVER_VERSION, bound,
    // The running adapters' required versions and readiness: an adapter upgrade invalidates every
    // offer even when the catalogue rows are unchanged.
    readiness: readiness.sources.map(source => [source.adapterCode, source.requiredVersion,
      source.installedVersion, source.status, source.reason, source.importFingerprint ?? null]),
    vocabulary: rows("SELECT value_id,attribute_id,value_num,option_id FROM cat_config_value_attribute ORDER BY value_id,attribute_id"),
    facts: rows("SELECT model_id,attribute_id,value_num,option_id FROM cat_config_model_attribute ORDER BY model_id,attribute_id"),
    applicability: rows("SELECT category_id,attribute_id,is_filterable FROM cat_category_attribute ORDER BY category_id,attribute_id"),
    models: rows(`SELECT id,category_id,definition_fingerprint,active,obsolete,source_import_id FROM cat_config_model ORDER BY id`),
    axes: rows("SELECT * FROM cat_config_axis ORDER BY id"),
    options: rows("SELECT * FROM cat_config_option ORDER BY id"),
    rules: rows("SELECT * FROM cat_config_rule ORDER BY id"),
    conditions: rows("SELECT * FROM cat_config_rule_condition ORDER BY rule_id,option_id"),
    effects: rows("SELECT * FROM cat_config_rule_effect ORDER BY rule_id,seq"),
    articles: rows("SELECT * FROM cat_config_model_article ORDER BY model_id,seq"),
    profiles: rows("SELECT * FROM cat_phys_profile ORDER BY id"),
    imports: rows("SELECT id,adapter_code,fingerprint,adapter_version FROM app_source_import WHERE became_current=1 ORDER BY adapter_code"),
    prices: rows("SELECT id,issuer_id,listino_number,valid_from,is_current FROM com_price_list ORDER BY id"),
    productPrices: rows("SELECT product_id,price_list_id,list_price_unit_e4,currency FROM com_product_price ORDER BY product_id,price_list_id"),
    products: rows("SELECT id,is_listed,governing_issuer_id FROM cat_product ORDER BY id"),
  };
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

export interface PackageOfferStats { readonly recomputed: boolean; readonly models: number;
  readonly candidates: number; readonly feasible: number; readonly infeasible: number; readonly undecided: number;
  /** Packages left without offers because their engineering source is not current. */
  readonly unavailable: number }

/** Caller owns the encompassing import/seed transaction. All old offers survive any failure. */
export function synchronizePackageOffers(db: Database.Database,
  { bound = PACKAGE_OFFER_SEARCH_BOUND, adapters = ENGINEERING_ADAPTERS }:
    { bound?: number; adapters?: readonly EngineeringAdapter[] } = {}): PackageOfferStats {
  if (!Number.isSafeInteger(bound) || bound < 1) throw new Error("Invalid package offer search bound");
  const readiness = readEngineeringReadiness(db, adapters);
  const fingerprint = sourceFingerprint(db, bound, readiness);
  const old = db.prepare("SELECT value FROM app_setting WHERE key=?").pluck().get(PACKAGE_OFFER_FINGERPRINT_KEY) as string | undefined;
  if (old === fingerprint) return { recomputed: false, models: 0, candidates: 0, feasible: 0, infeasible: 0, undecided: 0, unavailable: 0 };
  const models = db.prepare(`SELECT m.id,m.code,m.category_id AS categoryId,m.source_import_id AS importId,m.source
    FROM cat_config_model m WHERE ${SELECTABLE_PACKAGE_SQL} ORDER BY m.id`)
    .all() as Array<{ id: number; code: string; categoryId: number | null; importId: number | null; source: string }>;
  const work = db.transaction(() => {
    db.prepare("DELETE FROM cat_config_model_offer_state").run();
    db.prepare("DELETE FROM cat_config_model_offer").run();
    const insertOffer = db.prepare(`INSERT INTO cat_config_model_offer
      (model_id,offer_no,status,undecided_reason,definition_fingerprint,config_fingerprint) VALUES (?,?,?,?,?,?)`);
    const insertSelection = db.prepare(`INSERT INTO cat_config_model_offer_selection
      (model_id,offer_no,value_id,origin) VALUES (?,?,?,?)`);
    const insertValue = db.prepare(`INSERT INTO cat_config_model_offer_value
      (model_id,offer_no,attribute_id,value_num,option_id) VALUES (?,?,?,?,?)`);
    const insertState = db.prepare(`INSERT INTO cat_config_model_offer_state
      (model_id,status,candidates,feasible,infeasible,undecided,resolutions) VALUES (?,?,?,?,?,?,?)`);
    const diagnostics: DerivedDiagnostic[] = [];
    const diagnosticImport = db.prepare("SELECT id FROM app_source_import WHERE became_current=1 ORDER BY id LIMIT 1")
      .pluck().get() as number | undefined;
    const totals = { models: 0, candidates: 0, feasible: 0, infeasible: 0, undecided: 0, unavailable: 0 };
    for (const model of models) {
      if (model.categoryId === null) continue;
      const applicable = new Set(db.prepare(`SELECT attribute_id FROM cat_category_attribute
        WHERE category_id=?`).pluck().all(model.categoryId) as number[]);
      if (!applicable.size) continue;
      const facts = db.prepare(`SELECT attribute_id AS attributeId,value_num AS valueNum,option_id AS optionId
        FROM cat_config_model_attribute WHERE model_id=?`).all(model.id) as Value[];
      // Only the package's own option values (hidden axes included, since their defaults are part of the
      // effective selection) decide eligibility; a mapping elsewhere in the catalogue never does.
      const valueRows = db.prepare(`SELECT va.value_id AS valueId,va.attribute_id AS attributeId,
        va.value_num AS valueNum,va.option_id AS optionId FROM cat_config_value_attribute va
        WHERE va.attribute_id IN (SELECT value FROM json_each(?)) AND EXISTS (SELECT 1 FROM cat_config_option o
          JOIN cat_config_axis a ON a.id=o.axis_id WHERE a.model_id=? AND o.value_id=va.value_id)`)
        .all(JSON.stringify([...applicable]), model.id) as Array<Value & { valueId: number }>;
      if (!facts.some(fact => applicable.has(fact.attributeId)) && !valueRows.length) continue;
      // Fail closed: a stale engineering source is never resolved. Its package keeps no offer (all were
      // deleted above), cannot match technical filters, and the derivation still completes, so METEL
      // normalization and startup succeed. Any other resolver failure still rolls the transaction back.
      const stale = readiness.staleModel({ source: model.source, sourceImportId: model.importId });
      if (stale) {
        totals.unavailable++;
        const importId = model.importId ?? stale.importIds[0];
        if (importId !== undefined) diagnostics.push({ importId, subjectKind: "model", subjectKey: model.code,
          topic: "derived.offers_unavailable", valueA: stale.reason, sourceA: "engineering_readiness",
          valueB: stale.requiredVersion, sourceB: stale.adapterCode, notes: stale.installedVersion === null ? null :
            `installed_version=${stale.installedVersion}` });
        continue;
      }
      const valuesById = new Map<number, Value[]>();
      for (const row of valueRows) {
        const list = valuesById.get(row.valueId) ?? [];
        list.push(row); valuesById.set(row.valueId, list);
      }
      const detail = getConfigurationModel(db, model.id);
      const relevant = new Set(valueRows.map(row => row.valueId));
      const choices = candidates(detail, relevant);
      let feasible = 0, infeasible = 0, undecided = 0, resolutions = 0;
      const seen = new Set<string>();
      choices.forEach((candidate, offerNo) => {
        let offer: OfferRow | null = null;
        let exhausted = true;
        const attempted = new Set<string>();
        for (const explicit of completions(detail, candidate.ids)) {
          const key = [...explicit].sort((a, b) => a - b).join(",");
          if (attempted.has(key)) continue;
          attempted.add(key);
          if (resolutions >= bound) { exhausted = false; break; }
          resolutions++;
          const result = resolveConfiguration(db, { modelId: model.id, selectedOptionIds: explicit });
          if (!configuredItemAddable(result)) continue;
          const combined = selectedValues(result, valuesById, facts.filter(fact => applicable.has(fact.attributeId)));
          offer = { status: combined.conflict ? "undecided" : "feasible",
            reason: combined.conflict ? "value_conflict" : null,
            selections: stableSelections(result, candidate.ids, explicit),
            values: combined.values, fingerprint: combined.conflict ? null : result.fingerprint };
          break;
        }
        if (!offer && !exhausted) {
          const chosen = new Set(candidate.ids);
          const own = detail.axes.flatMap(axis => axis.options.filter(option => chosen.has(option.id)));
          offer = { status: "undecided", reason: "search_bound",
            selections: own.map(option => ({ valueId: option.valueId, origin: "candidate" })),
            values: combineValues([...facts.filter(fact => applicable.has(fact.attributeId)),
              ...own.flatMap(option => valuesById.get(option.valueId) ?? [])]).values, fingerprint: null };
        }
        if (!offer) { infeasible++; return; }
        if (offer.status === "feasible") {
          const key = JSON.stringify(offer.values.map(valueKey));
          if (seen.has(key)) { feasible++; return; }
          seen.add(key); feasible++;
        } else {
          undecided++;
          if (model.importId !== null || diagnosticImport !== undefined) diagnostics.push({ importId: model.importId ?? diagnosticImport!, subjectKind: "model",
            subjectKey: model.code, topic: offer.reason === "value_conflict" ? "derived.offer_value_conflict" : "derived.offer_undecided",
            valueA: JSON.stringify(candidate.ids), sourceA: "offer", valueB: null, sourceB: null,
            notes: `offer_no=${offerNo}` });
        }
        insertOffer.run(model.id, offerNo, offer.status, offer.reason, detail.definitionFingerprint, offer.fingerprint);
        for (const selection of offer.selections) insertSelection.run(model.id, offerNo, selection.valueId, selection.origin);
        for (const value of offer.values) insertValue.run(model.id, offerNo, value.attributeId, value.valueNum, value.optionId);
      });
      insertState.run(model.id, undecided ? "partial" : feasible ? "complete" : "none",
        choices.length, feasible, infeasible, undecided, resolutions);
      totals.models++; totals.candidates += choices.length; totals.feasible += feasible;
      totals.infeasible += infeasible; totals.undecided += undecided;
    }
    reconcileDerivedDiagnostics(db, ["derived.offer_undecided", "derived.offer_value_conflict",
      "derived.offers_unavailable"], diagnostics);
    db.prepare(`INSERT INTO app_setting(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .run(PACKAGE_OFFER_FINGERPRINT_KEY, fingerprint);
    return totals;
  });
  return { recomputed: true, ...work() };
}

export type OfferSelectionResult = { status: "ready"; selectedOptionIds: number[] } | { status: "offer_stale" };

/** Read-only witness reconstruction. No substitute offer is chosen on stale data. */
export function offerSelection(db: Database.Database, modelId: number, offerNo: number): OfferSelectionResult {
  const row = db.prepare(`SELECT definition_fingerprint AS definitionFingerprint,
    config_fingerprint AS configFingerprint,status FROM cat_config_model_offer WHERE model_id=? AND offer_no=?`)
    .get(modelId, offerNo) as { definitionFingerprint: string; configFingerprint: string | null; status: string } | undefined;
  if (!row || row.status !== "feasible" || !row.configFingerprint) return { status: "offer_stale" };
  // Stale engineering data never reconstructs a witness; Catalogo then opens from defaults with the notice.
  const provenance = db.prepare("SELECT source,source_import_id AS sourceImportId FROM cat_config_model WHERE id=?")
    .get(modelId) as { source: string; sourceImportId: number | null } | undefined;
  if (!provenance || readEngineeringReadiness(db).staleModel(provenance)) return { status: "offer_stale" };
  const model = getConfigurationModel(db, modelId);
  if (model.definitionFingerprint !== row.definitionFingerprint) return { status: "offer_stale" };
  const selections = db.prepare(`SELECT d.code AS dimensionCode,v.code AS valueCode
    FROM cat_config_model_offer_selection s JOIN cat_config_dimension_value v ON v.id=s.value_id
    JOIN cat_config_dimension d ON d.id=v.dimension_id
    WHERE s.model_id=? AND s.offer_no=? ORDER BY d.code,v.code`).all(modelId, offerNo) as
    Array<{ dimensionCode: string; valueCode: string }>;
  const mapped = mapStableSelections(model, selections);
  if (!mapped.ok) return { status: "offer_stale" };
  const result = resolveConfiguration(db, { modelId, selectedOptionIds: mapped.optionIds });
  if (!configuredItemAddable(result) || result.fingerprint !== row.configFingerprint ||
    result.selectedOptionIds.length !== mapped.optionIds.length) return { status: "offer_stale" };
  const actual = db.prepare(`SELECT va.attribute_id AS attributeId,va.value_num AS valueNum,va.option_id AS optionId
    FROM cat_config_value_attribute va JOIN cat_config_option o ON o.value_id=va.value_id
    WHERE o.id IN (SELECT value FROM json_each(?))
    UNION ALL SELECT ma.attribute_id,ma.value_num,ma.option_id FROM cat_config_model_attribute ma
      WHERE ma.model_id=?`).all(JSON.stringify(result.selectedOptionIds), modelId) as Value[];
  const categoryId = db.prepare("SELECT category_id FROM cat_config_model WHERE id=?").pluck().get(modelId) as number | null;
  const applicable = new Set(db.prepare("SELECT attribute_id FROM cat_category_attribute WHERE category_id=?")
    .pluck().all(categoryId) as number[]);
  const combined = combineValues(actual.filter(value => applicable.has(value.attributeId)));
  const stored = db.prepare(`SELECT attribute_id AS attributeId,value_num AS valueNum,option_id AS optionId
    FROM cat_config_model_offer_value WHERE model_id=? AND offer_no=? ORDER BY attribute_id`)
    .all(modelId, offerNo) as Value[];
  if (combined.conflict || JSON.stringify(combined.values.map(valueKey)) !== JSON.stringify(stored.map(valueKey)))
    return { status: "offer_stale" };
  return { status: "ready", selectedOptionIds: mapped.optionIds };
}
