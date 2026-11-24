import type Database from "better-sqlite3";

import type {
  CatalogueAttributeDataType,
  CatalogueAttributeFilter,
  CatalogueCategory,
  CatalogueProductAttribute,
} from "../../shared/catalogue.js";

/*
 * Category browsing and basic attribute filtering (roadmap step 5A).
 * Filters are plain indexed `product_id IN (…)` subqueries (DATABASE_DESIGN
 * §5.4): values of one attribute are ORed, different attributes ANDed.
 * Codes are validated against the current reference data; unknown codes fail.
 */

/** A structurally valid request that names unknown or inapplicable codes. */
export class InvalidCatalogueFilterError extends Error {
  constructor(message: string) {
    super(`Invalid catalogue filter: ${message}`);
    this.name = "InvalidCatalogueFilterError";
  }
}

interface CategoryRow {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly parentId: number | null;
  readonly sortOrder: number;
}

function activeCategories(database: Database.Database): CategoryRow[] {
  return database.prepare(`SELECT id, code, name, parent_id AS parentId, sort_order AS sortOrder
    FROM cat_category WHERE active = 1 ORDER BY sort_order, code`).all() as CategoryRow[];
}

/** Ids of the active category and its active descendants, in no particular order. */
export function resolveCategoryScope(database: Database.Database, categoryCode: string): number[] {
  const categories = activeCategories(database);
  const root = categories.find(c => c.code === categoryCode);
  if (!root) throw new InvalidCatalogueFilterError(`unknown category "${categoryCode}"`);
  const scope = [root.id];
  for (let i = 0; i < scope.length; i++) {
    for (const child of categories) if (child.parentId === scope[i]) scope.push(child.id);
  }
  return scope;
}

/** Ids of every active category: the widest scope, for validating a code that no category narrows. */
export function allCategoryScope(database: Database.Database): number[] {
  return activeCategories(database).map(category => category.id);
}

export interface FilterableAttribute {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly dataType: "number" | "enum";
  readonly unit: string | null;
}

/** Active, filterable number/enum attributes linked to any category in scope, in display order. */
export function filterableAttributes(database: Database.Database, scope: readonly number[]): FilterableAttribute[] {
  return database.prepare(`
    SELECT a.id, a.code, a.name, a.data_type AS dataType, a.unit
    FROM cat_category_attribute ca JOIN cat_attribute a ON a.id = ca.attribute_id
    WHERE ca.category_id IN (SELECT value FROM json_each(?)) AND ca.is_filterable = 1
      AND a.active = 1 AND a.data_type IN ('number', 'enum')
    GROUP BY a.id ORDER BY MIN(ca.sort_order), a.code
  `).all(JSON.stringify(scope)) as FilterableAttribute[];
}

export interface ResolvedAttributeFilter {
  readonly attributeId: number;
  readonly column: "option_id" | "value_num";
  readonly values: readonly number[];
}

/** Translates stable codes into ids; every attribute must be filterable within `scope`. */
export function resolveAttributeFilters(
  database: Database.Database,
  scope: readonly number[],
  filters: readonly CatalogueAttributeFilter[],
): ResolvedAttributeFilter[] {
  if (filters.length === 0) return [];
  const attributes = new Map(filterableAttributes(database, scope).map(a => [a.code, a]));
  const option = database.prepare("SELECT id FROM cat_attribute_option WHERE attribute_id = ? AND value = ? AND active = 1");
  const seen = new Set<string>();
  return filters.map(filter => {
    const target = attributes.get(filter.attributeCode);
    if (!target) throw new InvalidCatalogueFilterError(`attribute "${filter.attributeCode}" does not apply to the selected category`);
    if (seen.has(filter.attributeCode)) throw new InvalidCatalogueFilterError(`attribute "${filter.attributeCode}" given twice`);
    seen.add(filter.attributeCode);
    if (filter.values.length === 0) throw new InvalidCatalogueFilterError(`no values for "${filter.attributeCode}"`);
    if (target.dataType === "number") {
      return { attributeId: target.id, column: "value_num" as const, values: filter.values.map(value => {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new InvalidCatalogueFilterError(`"${filter.attributeCode}" expects numbers`);
        }
        return value;
      }) };
    }
    return { attributeId: target.id, column: "option_id" as const, values: filter.values.map(value => {
      const id = typeof value === "string" ? option.pluck().get(target.id, value) as number | undefined : undefined;
      if (id === undefined) throw new InvalidCatalogueFilterError(`unknown option "${String(value)}" for "${filter.attributeCode}"`);
      return id;
    }) };
  });
}

/** SQL conditions on `p` (cat_product) for a category scope and resolved filters. */
export function categoryFilterConditions(
  scope: readonly number[],
  filters: readonly ResolvedAttributeFilter[],
  parameters: Record<string, string | number | null>,
): string[] {
  const list = (prefix: string, values: readonly number[]) => values.map((value, index) => {
    parameters[`${prefix}_${index}`] = value;
    return `@${prefix}_${index}`;
  }).join(", ");
  return [
    `p.category_id IN (${list("category", scope)})`,
    ...filters.map((filter, index) => {
      parameters[`attribute${index}`] = filter.attributeId;
      return `p.id IN (SELECT product_id FROM cat_product_attribute
        WHERE attribute_id = @attribute${index} AND ${filter.column} IN (${list(`attribute${index}_value`, filter.values)}))`;
    }),
  ];
}

/** Active categories in depth-first display order, with subtree product counts. */
export function listCategories(database: Database.Database): CatalogueCategory[] {
  const categories = activeCategories(database);
  const counts = new Map((database.prepare(`SELECT category_id AS id, COUNT(*) AS total, SUM(is_listed) AS listed
    FROM cat_product WHERE import_removed=0 AND category_id IS NOT NULL AND brand_id IN (SELECT id FROM cat_brand WHERE active=1) GROUP BY category_id`).all() as Array<{ id: number; total: number; listed: number }>)
    .map(row => [row.id, row]));
  const ids = new Set(categories.map(c => c.id));
  const result: CatalogueCategory[] = [];
  const visit = (node: CategoryRow, parentCode: string | null, depth: number): { total: number; listed: number } => {
    const index = result.length;
    result.push({ code: node.code, name: node.name, parentCode, depth, productCount: 0, listedProductCount: 0 });
    let total = counts.get(node.id)?.total ?? 0, listed = counts.get(node.id)?.listed ?? 0;
    for (const child of categories) {
      if (child.parentId !== node.id) continue;
      const sub = visit(child, node.code, depth + 1);
      total += sub.total; listed += sub.listed;
    }
    result[index] = { ...result[index], productCount: total, listedProductCount: listed };
    return { total, listed };
  };
  // An active category below an inactive parent is shown at top level.
  for (const root of categories) if (root.parentId === null || !ids.has(root.parentId)) visit(root, null, 0);
  return result;
}

/** Stored values of active attributes for the given products. */
export function productAttributes(
  database: Database.Database,
  productIds: readonly number[],
): Map<number, CatalogueProductAttribute[]> {
  const result = new Map<number, CatalogueProductAttribute[]>();
  if (productIds.length === 0) return result;
  const rows = database.prepare(`
    SELECT pa.product_id AS productId, a.code, a.name, a.data_type AS dataType, a.unit,
      pa.value_num AS valueNum, pa.value_bool AS valueBool, pa.value_text AS valueText,
      o.value AS optionValue, o.label AS optionLabel
    FROM cat_product_attribute pa
    JOIN cat_attribute a ON a.id = pa.attribute_id AND a.active = 1
    JOIN cat_product p ON p.id = pa.product_id
    LEFT JOIN cat_attribute_option o ON o.id = pa.option_id
    LEFT JOIN cat_category_attribute ca ON ca.category_id = p.category_id AND ca.attribute_id = pa.attribute_id
    WHERE pa.product_id IN (SELECT value FROM json_each(?))
    ORDER BY pa.product_id, ca.sort_order IS NULL, ca.sort_order, a.code
  `).all(JSON.stringify(productIds)) as Array<{
    productId: number; code: string; name: string; dataType: CatalogueAttributeDataType; unit: string | null;
    valueNum: number | null; valueBool: number | null; valueText: string | null; optionValue: string | null; optionLabel: string | null;
  }>;
  for (const row of rows) {
    const value = row.valueNum ?? row.optionValue ?? row.valueText ?? (row.valueBool === null ? null : row.valueBool === 1);
    if (value === null) continue;
    const list = result.get(row.productId) ?? [];
    list.push({ code: row.code, name: row.name, dataType: row.dataType, unit: row.unit, value, label: row.optionLabel });
    result.set(row.productId, list);
  }
  return result;
}
