import type { ConfigModelDetail } from "../../shared/configuration.js";

export interface StableSelection { readonly dimensionCode: string; readonly valueCode: string }
export type SelectionMapping = { readonly ok: true; readonly optionIds: number[] } |
  { readonly ok: false; readonly code: "selection_unavailable" | "selection_ambiguous" };

/** Rebuild option IDs from stable dimension/value codes, proving one parent-consistent mapping. */
export function mapStableSelections(model: ConfigModelDetail,
  selections: readonly StableSelection[]): SelectionMapping {
  const options = model.axes.flatMap(axis => axis.options.filter(option => option.active)
    .map(option => ({ ...option, dimensionCode: axis.dimensionCode })));
  const candidates = selections.map(selection => options.filter(option =>
    option.dimensionCode === selection.dimensionCode && option.valueCode === selection.valueCode));
  if (candidates.some(rows => !rows.length)) return { ok: false, code: "selection_unavailable" };
  const solutions = new Map<string, number[]>();
  let visited = 0;
  const walk = (mapped: Map<number, number>) => {
    if (solutions.size > 1 || ++visited > 10000) return;
    if (mapped.size === candidates.length) {
      const ids = [...mapped].sort(([a], [b]) => a - b).map(([, id]) => id);
      solutions.set(JSON.stringify(ids), ids);
      return;
    }
    const entry = candidates.map((rows, index) => ({ index, rows }))
      .filter(row => !mapped.has(row.index))
      .find(row => row.rows.every(option => option.parentOptionId === null ||
        !candidates.some((other, index) => !mapped.has(index) && other.some(parent => parent.id === option.parentOptionId))));
    if (!entry) return;
    for (const option of entry.rows.filter(option => option.parentOptionId === null ||
      [...mapped.values()].includes(option.parentOptionId))) {
      const next = new Map(mapped);
      next.set(entry.index, option.id);
      walk(next);
    }
  };
  walk(new Map());
  if (visited > 10000 || solutions.size > 1) return { ok: false, code: "selection_ambiguous" };
  const optionIds = [...solutions.values()][0];
  return optionIds ? { ok: true, optionIds } : { ok: false, code: "selection_unavailable" };
}
