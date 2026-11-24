import type {
  CatalogueAttributeFilter,
  CatalogueAttributeFilterOptions,
} from "../../shared/catalogue.js";

/** Selected values per attribute code. */
export type SelectedAttributeValues = Readonly<Record<string, readonly (string | number)[]>>;

export function toggleAttributeValue(
  selected: SelectedAttributeValues,
  attributeCode: string,
  value: string | number,
): SelectedAttributeValues {
  const current = selected[attributeCode] ?? [];
  const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
  const { [attributeCode]: _removed, ...rest } = selected;
  return next.length > 0 ? { ...rest, [attributeCode]: next } : rest;
}

/**
 * Keeps only selections that still exist among the offered attributes and
 * values. Returns `selected` itself when nothing is removed.
 */
export function pruneAttributeValues(
  selected: SelectedAttributeValues,
  options: CatalogueAttributeFilterOptions,
): SelectedAttributeValues {
  let result: SelectedAttributeValues = {};
  let removed = false;
  for (const [code, values] of Object.entries(selected)) {
    const offered = options.attributes.find(attribute => attribute.code === code)?.values.map(v => v.value) ?? [];
    const kept = values.filter(value => offered.includes(value));
    if (kept.length !== values.length) removed = true;
    if (kept.length > 0) result = { ...result, [code]: kept };
  }
  return removed ? result : selected;
}

/** Deterministic request form: attributes and values sorted, empty selections dropped. */
export function toAttributeFilters(selected: SelectedAttributeValues): CatalogueAttributeFilter[] {
  return Object.keys(selected).sort().filter(code => selected[code].length > 0).map(code => ({
    attributeCode: code,
    values: [...selected[code]].sort((a, b) => typeof a === "number" && typeof b === "number"
      ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0),
  }));
}

/** Technical-filter state of the Ricerca view. */
export interface CatalogueFilterState {
  /** "" when no category is selected. */
  readonly categoryCode: string;
  readonly listedOnly: boolean;
  readonly selected: SelectedAttributeValues;
}

export const initialFilterState: CatalogueFilterState = { categoryCode: "", listedOnly: true, selected: {} };

export type CatalogueFilterAction =
  | { readonly type: "category"; readonly categoryCode: string }
  | { readonly type: "toggle"; readonly attributeCode: string; readonly value: string | number }
  | { readonly type: "reset" }
  | { readonly type: "listed-only"; readonly listedOnly: boolean }
  | { readonly type: "prune"; readonly options: CatalogueAttributeFilterOptions };

export function filterReducer(state: CatalogueFilterState, action: CatalogueFilterAction): CatalogueFilterState {
  switch (action.type) {
    case "category":
      // Applicability depends on the category: selections never carry over.
      return action.categoryCode === state.categoryCode ? state : { ...state, categoryCode: action.categoryCode, selected: {} };
    case "toggle":
      return { ...state, selected: toggleAttributeValue(state.selected, action.attributeCode, action.value) };
    case "reset":
      return Object.keys(state.selected).length === 0 ? state : { ...state, selected: {} };
    case "listed-only":
      return { ...state, listedOnly: action.listedOnly };
    case "prune": {
      if (action.options.categoryCode !== state.categoryCode) return state;
      const selected = pruneAttributeValues(state.selected, action.options);
      return selected === state.selected ? state : { ...state, selected };
    }
  }
}
