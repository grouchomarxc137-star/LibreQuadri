import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { getConfigurationModel } from "../src/main/catalogue/configuration-queries.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";
import { readEngineeringReadiness } from "../src/main/catalogue/engineering-readiness.js";
import { TIQUADRI_ENGINEERING_ADAPTER } from "../src/main/sources/tiquadri/adapter.js";
import type { ConfigModelDetail, ConfigurationResult } from "../src/shared/configuration.js";

const filename = process.env.LIBREQUADRI_REV83_REAL_DB;

// Only explicit selection/eligibility failures can make an enumerated choice unreachable.
// Other engineering or commercial errors are not evidence that its profile can be omitted.
const unreachableCodes = new Set(["duplicate_option", "foreign_option", "invalid_entry", "inactive_model",
  "multiple_on_axis", "ambiguous_default", "unavailable_option", "missing_required", "budget_exceeded"]);
function assertReachableProfile(result: Pick<ConfigurationResult, "issues" | "physical">, context: string): boolean {
  // Check the issue code before any exclusion, independent of severity or resolver status.
  expect(result.issues.filter(issue => issue.code === "no_profile"), `${context}: no_profile`).toEqual([]);
  if (result.issues.some(issue => unreachableCodes.has(issue.code))) return false;
  expect(result.physical, `${context}: missing physical profile`).not.toBeNull();
  return true;
}

describe("enclosure profile invariant exclusions", () => {
  it.each(["warning", "error"] as const)("fails a reachable no_profile with severity %s, even alongside another error", severity => {
    const result = { physical: null, issues: [
      { code: "no_profile", severity, message: "No effective physical profile exists" },
    ] };
    expect(() => assertReachableProfile(result, "reachable enclosure")).toThrow(/no_profile/);
    // This unrelated engineering error used to filter out the missing profile before checking it.
    result.issues.push({ code: "unknown_capacity_kind", severity: "error", message: "Unknown capacity kind" });
    expect(() => assertReachableProfile(result, "reachable enclosure")).toThrow(/no_profile/);
  });

  it("excludes explicit invalid selections and exceeded budgets, but never a no_profile issue", () => {
    for (const code of unreachableCodes) {
      const issues: ConfigurationResult["issues"] = [{ code, severity: "error", message: "Unreachable choice" }];
      expect(assertReachableProfile({ physical: null, issues }, code)).toBe(false);
      issues.push({ code: "no_profile", severity: "warning", message: "Missing profile" });
      expect(() => assertReachableProfile({ physical: null, issues }, code)).toThrow(/no_profile/);
    }
  });

  it("fails a missing profile without a no_profile diagnostic instead of treating another error as unreachable", () => {
    expect(() => assertReachableProfile({ physical: null, issues: [
      { code: "unknown_capacity_kind", severity: "error", message: "Unknown capacity kind" },
    ] }, "reachable enclosure")).toThrow(/missing physical profile/);
  });
});

/** Independent normalized-catalogue enumeration, not the source importer's delta algorithm.
 * Enumerate every choice on axes participating in a physical-key effect, plus their parents.
 * Axes with no physical effects use a valid representative: their entire Cartesian product has
 * the same physical key. Explicit completion also covers required axes with no source default.
 */
function* physicalConfigurations(model: ConfigModelDetail, effectOptions: Set<number>): Generator<number[]> {
  const options = new Map(model.axes.flatMap(axis => axis.options.map(option => [option.id, option] as const)));
  const axisById = new Map(model.axes.map(axis => [axis.id, axis]));
  const involved = new Set([...effectOptions].map(id => options.get(id)!.axisId));
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...involved]) for (const option of axisById.get(id)!.options) {
      if (option.parentOptionId === null) continue;
      const parentAxis = options.get(option.parentOptionId)!.axisId;
      if (!involved.has(parentAxis)) { involved.add(parentAxis); changed = true; }
    }
  }
  const axes = model.axes.filter(axis => involved.has(axis.id));
  function* enumerate(index: number, selected: Set<number>): Generator<number[]> {
    if (index < axes.length) {
      const axis = axes[index]!;
      if (axis.requirement === "optional") yield* enumerate(index + 1, selected);
      for (const option of axis.options.filter(option => option.active)) {
        selected.add(option.id); yield* enumerate(index + 1, selected); selected.delete(option.id);
      }
      return;
    }
    if ([...selected].some(id => {
      const parent = options.get(id)!.parentOptionId; return parent !== null && !selected.has(parent);
    })) return;
    const completed = new Set(selected);
    for (let pass = 0; pass <= model.axes.length; pass++) for (const axis of model.axes) {
      if (involved.has(axis.id) || axis.options.some(option => completed.has(option.id))) continue;
      const available = axis.options.filter(option => option.active &&
        (option.parentOptionId === null || completed.has(option.parentOptionId)));
      const choice = available.find(option => option.isDefault) ??
        (axis.requirement === "required" ? available[0] : undefined);
      if (choice) completed.add(choice.id);
    }
    yield [...completed];
  }
  yield* enumerate(0, new Set());
}

describe.runIf(!!filename && existsSync(filename))("current enclosure catalogue invariant (no migration baseline)", () => {
  it("has a profile for every reachable physical-effect configuration of every placeable active enclosure", () => {
    const db = new Database(filename!, { readonly: true });
    try {
      expect(readEngineeringReadiness(db).sources.find(source => source.adapterCode === "tiquadri"))
        .toMatchObject({ installedVersion: TIQUADRI_ENGINEERING_ADAPTER.version,
          requiredVersion: TIQUADRI_ENGINEERING_ADAPTER.version, status: "ready" });
      const models = db.prepare(`SELECT id,code,base_profile_id FROM cat_config_model
        WHERE model_kind='enclosure' AND active=1 AND obsolete=0 AND code LIKE 'tq.pack.%' ORDER BY code`)
        .all() as { id: number; code: string; base_profile_id: number | null }[];
      const omitted = models.filter(model => model.base_profile_id === null);
      // Explicit source-backed geometry exclusions, not missing effective profile variants.
      // A newly missing base profile must not silently enter this exclusion list.
      expect(omitted.map(model => model.code)).toEqual([
        "tq.pack.3196", "tq.pack.3197", "tq.pack.3198", "tq.pack.3199", "tq.pack.3254",
        "tq.pack.3255", "tq.pack.3310", "tq.pack.3311", "tq.pack.3312",
      ]);
      let checked = 0, placeable = 0;
      const profiles = new Set<string>();
      for (const source of models.filter(model => model.base_profile_id !== null)) {
        const model = getConfigurationModel(db, source.id);
        const effects = db.prepare(`SELECT e.effect_kind,c.option_id FROM cat_config_rule_effect e
          JOIN cat_config_rule r ON r.id=e.rule_id LEFT JOIN cat_config_rule_condition c ON c.rule_id=r.id
          WHERE r.model_id=? AND e.effect_kind IN ('profile_key_delta','profile_override')`).all(source.id) as
          { effect_kind: string; option_id: number | null }[];
        expect(effects.every(effect => effect.effect_kind === "profile_key_delta")).toBe(true);
        const effectOptions = new Set(effects.flatMap(effect => effect.option_id === null ? [] : [effect.option_id]));
        let reachable = 0;
        for (const selectedOptionIds of physicalConfigurations(model, effectOptions)) {
          const result = resolveConfiguration(db, { modelId: source.id, selectedOptionIds });
          if (!assertReachableProfile(result, `${source.code} options ${JSON.stringify(selectedOptionIds)}`)) continue;
          reachable++; checked++;
          profiles.add(result.physical!.code);
        }
        expect(reachable, source.code).toBeGreaterThan(0); placeable++;
      }
      console.log("Enclosure profile invariant:", JSON.stringify({ active: models.length,
        omittedWithoutGeometry: omitted.map(model => model.code), placeable, checked,
        distinctProfiles: profiles.size, noProfile: 0 }));
      expect(placeable).toBe(595); expect(checked).toBeGreaterThan(placeable);
    } finally { db.close(); }
  }, 120_000);
});
