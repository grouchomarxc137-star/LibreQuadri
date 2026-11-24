import type {
  CatalogueAttributeFilterOptions,
  CatalogueCategory,
} from "../../shared/catalogue.js";
import type { SelectedAttributeValues } from "./attribute-filter-state.js";
import { formatAttributeValue, formatCount } from "./formatting.js";

export function CategorySelect({ categories, value, disabled, onChange }: {
  readonly categories: readonly CatalogueCategory[];
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (categoryCode: string) => void;
}) {
  return <label className="category-select">
    <span>Categoria</span>
    <select value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      <option value="">Tutte le categorie</option>
      {categories.map(category => <option key={category.code} value={category.code}>
        {"  ".repeat(category.depth)}{category.name} ({formatCount(category.productCount)})
      </option>)}
    </select>
  </label>;
}

interface ActiveSelection {
  readonly attributeCode: string;
  readonly value: string | number;
  readonly text: string;
}

/** Selected values in panel order, labelled from the current facets when available. */
export function activeSelections(
  selected: SelectedAttributeValues,
  options: CatalogueAttributeFilterOptions | null,
): ActiveSelection[] {
  const result: ActiveSelection[] = [];
  const seen = new Set<string>();
  for (const attribute of options?.attributes ?? []) {
    for (const entry of attribute.values) {
      if (!(selected[attribute.code] ?? []).includes(entry.value)) continue;
      seen.add(`${attribute.code}\0${String(entry.value)}`);
      result.push({ attributeCode: attribute.code, value: entry.value,
        text: `${attribute.name}: ${formatAttributeValue(entry.value, attribute.unit, entry.label)}` });
    }
  }
  for (const [code, values] of Object.entries(selected)) {
    for (const value of values) {
      if (!seen.has(`${code}\0${String(value)}`)) result.push({ attributeCode: code, value, text: `${code}: ${String(value)}` });
    }
  }
  return result;
}

/**
 * Checkbox facets with disjunctive counts: each count is the number of products
 * that would match with that value selected in its own attribute. Unselected
 * values without matches are disabled; selected ones always stay visible.
 */
export function AttributeFilterPanel({ options, selected, listedOnly, failed, onToggle, onReset, onListedOnlyChange }: {
  readonly options: CatalogueAttributeFilterOptions | null;
  readonly selected: SelectedAttributeValues;
  readonly listedOnly: boolean;
  readonly failed?: boolean;
  readonly onToggle: (attributeCode: string, value: string | number) => void;
  readonly onReset: () => void;
  readonly onListedOnlyChange: (listedOnly: boolean) => void;
}) {
  const active = activeSelections(selected, options);
  return <section className="attribute-filters" aria-label="Filtri caratteristiche">
    <div className="attribute-filters-bar">
      <label><input type="checkbox" checked={listedOnly} onChange={event => onListedOnlyChange(event.target.checked)} /> Solo prodotti a listino</label>
      {options ? <span className="facet-total">
        {formatCount(options.totalCount)} {options.totalCount === 1 ? "prodotto" : "prodotti"}
      </span> : null}
      <button type="button" disabled={active.length === 0} onClick={onReset}>Azzera filtri</button>
    </div>
    {active.length > 0 ? <div className="active-filters" aria-label="Filtri attivi">
      <span>Filtri attivi:</span>
      {active.map(item => <button type="button" key={`${item.attributeCode}\0${String(item.value)}`}
        aria-label={`Rimuovi filtro ${item.text}`} onClick={() => onToggle(item.attributeCode, item.value)}>
        {item.text} ✕
      </button>)}
    </div> : null}
    {failed ? <p className="error">Impossibile caricare i filtri.</p>
      : options === null ? <p className="hint">Caricamento filtri…</p>
      : options.attributes.length === 0 ? <p className="hint">Nessuna caratteristica disponibile per questa categoria.</p>
      : <div className="attribute-groups">{options.attributes.map(attribute => <fieldset key={attribute.code}>
        <legend>{attribute.name}</legend>
        {attribute.values.map(entry => {
          const checked = (selected[attribute.code] ?? []).includes(entry.value);
          const unavailable = entry.count === 0 && !checked;
          return <label key={String(entry.value)} className={unavailable ? "facet-value unavailable" : "facet-value"}>
            <input type="checkbox" checked={checked} disabled={unavailable} onChange={() => onToggle(attribute.code, entry.value)} />
            {" "}{formatAttributeValue(entry.value, attribute.unit, entry.label)}
            {" "}<span className="facet-count">({formatCount(entry.count)})</span>
          </label>;
        })}
      </fieldset>)}</div>}
  </section>;
}
