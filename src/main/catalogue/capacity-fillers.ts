import type Database from "better-sqlite3";

import type { ConfigurationResult } from "../../shared/configuration.js";
import { getConfigurationModel } from "./configuration-queries.js";
import { resolveConfiguration } from "./configuration-resolver.js";

/** Upper bound on option combinations resolved per filler model. */
const COMBINATION_LIMIT = 512;

/**
 * One complete filler configuration and the capacity it closes: its physical profile demands exactly
 * `amount` units of the requested capacity kind and nothing else.
 */
export interface CapacityFillerConfiguration {
  readonly amount: number;
  readonly result: ConfigurationResult;
}

/**
 * Every complete configuration of the active models the catalogue designates as fillers of
 * `capacityKind` (cat_config_capacity_filler), one per distinct amount. Models are taken in id order
 * and options in catalogue order, so when two configurations close the same amount the choice is
 * deterministic. Generic: no product, brand or source identifier is consulted.
 */
export function capacityFillerConfigurations(db: Database.Database, capacityKind: string): CapacityFillerConfiguration[] {
  const modelIds = db.prepare(`SELECT f.model_id FROM cat_config_capacity_filler f
    JOIN cat_config_model m ON m.id=f.model_id
    WHERE f.capacity_kind_code=? AND m.active=1 AND m.obsolete=0 ORDER BY m.id`).pluck().all(capacityKind) as number[];
  const byAmount = new Map<number, CapacityFillerConfiguration>();
  for (const modelId of modelIds) {
    const model = getConfigurationModel(db, modelId);
    let combinations: number[][] = [[]];
    for (const axis of model.axes) {
      const options = axis.options.filter(option => option.active).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
      if (!options.length) continue;
      combinations = combinations.flatMap(selection => options.map(option => [...selection, option.id]));
      if (combinations.length > COMBINATION_LIMIT) throw new Error("Il modello di riempimento ha troppe combinazioni di opzioni.");
    }
    for (const selectedOptionIds of combinations) {
      const result = resolveConfiguration(db, { modelId, selectedOptionIds });
      if (result.status !== "complete" || !result.physical || result.issues.some(issue => issue.severity === "error")) continue;
      const demands = result.physical.demands.filter(demand => demand.amount > 0);
      if (demands.length !== 1 || demands[0]!.capacityKindCode !== capacityKind) continue;
      const amount = demands[0]!.amount;
      if (Number.isSafeInteger(amount) && amount > 0 && !byAmount.has(amount)) byAmount.set(amount, { amount, result });
    }
  }
  return [...byAmount.values()].sort((a, b) => a.amount - b.amount);
}
