import type Database from "better-sqlite3";

/** Generic, brand-neutral family grouping engine (DATABASE_DESIGN Rev 6 §5.5). */
export const FAMILY_GROUPING_VERSION = "1";

export type FamilyAttributeValue = string | number | boolean;

export interface FamilyGroupingInput {
  readonly productId: number;
  readonly manufacturerCode: string;
  readonly description: string | null;
  readonly brandMarchio: string;
  readonly categoryCode: string | null;
  readonly statisticalFamilyCode: string | null;
  readonly statisticalFamilyIssuerSigla: string | null;
  readonly attributes: ReadonlyMap<string, FamilyAttributeValue>;
}

export interface ProductFamilyGrouper {
  readonly code: string;
  readonly version: string;
  /** Proposes at most one existing, brand-local family code. */
  propose(input: FamilyGroupingInput): string | null;
}

export type ProductFamilyGrouperRegistry = ReadonlyMap<string, ProductFamilyGrouper>;

export interface FamilyGroupingStats {
  readonly inserted: number;
  readonly updated: number;
  readonly removed: number;
  readonly rejected: number;
  readonly protected: number;
}

interface ProductRow {
  readonly id: number;
  readonly brandId: number;
  readonly manufacturerCode: string;
  readonly description: string | null;
  readonly marchio: string;
  readonly categoryId: number | null;
  readonly categoryCode: string | null;
  readonly statisticalFamilyCode: string | null;
  readonly statisticalFamilyIssuerSigla: string | null;
}

interface FamilyRow {
  readonly id: number;
  readonly brandId: number;
  readonly code: string;
  readonly categoryId: number;
  readonly active: number;
}

interface AssignmentRow {
  readonly familyId: number | null;
  readonly state: "grouper" | "manual" | "manual_excluded";
  readonly grouperCode: string | null;
  readonly grouperVersion: string | null;
}

function valueFromRow(row: {
  valueNum: number | null;
  optionValue: string | null;
  valueBool: number | null;
  valueText: string | null;
}): FamilyAttributeValue | undefined {
  if (row.valueNum !== null) return row.valueNum;
  if (row.optionValue !== null) return row.optionValue;
  if (row.valueBool !== null) return row.valueBool === 1;
  return row.valueText ?? undefined;
}

/**
 * Re-evaluates automatic assignments for all products, or only affected IDs.
 * Manual assignments and manual exclusions are never changed. Listing state is
 * intentionally absent from both the input and every query in this module.
 */
export function groupProductFamilies(
  database: Database.Database,
  groupers: ProductFamilyGrouperRegistry,
  affectedIds?: ReadonlySet<number>,
): FamilyGroupingStats {
  const families = new Map<string, FamilyRow>();
  for (const row of database.prepare(`
    SELECT id, brand_id AS brandId, code, category_id AS categoryId, active
    FROM cat_product_family
  `).all() as FamilyRow[]) {
    families.set(`${row.brandId}\0${row.code}`, row);
  }

  const assignments = new Map<number, AssignmentRow>();
  for (const row of database.prepare(`
    SELECT product_id AS productId, family_id AS familyId, state,
      grouper_code AS grouperCode, grouper_version AS grouperVersion
    FROM cat_product_family_assignment
  `).all() as Array<AssignmentRow & { productId: number }>) {
    assignments.set(row.productId, row);
  }

  const attributes = new Map<number, Map<string, FamilyAttributeValue>>();
  for (const row of database.prepare(`
    SELECT pa.product_id AS productId, a.code, pa.value_num AS valueNum,
      o.value AS optionValue, pa.value_bool AS valueBool, pa.value_text AS valueText
    FROM cat_product_attribute pa
    JOIN cat_attribute a ON a.id = pa.attribute_id
    LEFT JOIN cat_attribute_option o ON o.id = pa.option_id
    ORDER BY pa.product_id, a.code
  `).all() as Array<{
    productId: number; code: string; valueNum: number | null;
    optionValue: string | null; valueBool: number | null; valueText: string | null;
  }>) {
    if (affectedIds && !affectedIds.has(row.productId)) continue;
    let values = attributes.get(row.productId);
    if (!values) attributes.set(row.productId, values = new Map());
    const value = valueFromRow(row);
    if (value !== undefined) values.set(row.code, value);
  }

  const products = database.prepare(`
    SELECT p.id, p.brand_id AS brandId, p.manufacturer_code AS manufacturerCode,
      p.short_description AS description, b.metel_marchio AS marchio,
      p.category_id AS categoryId, c.code AS categoryCode,
      mf.code AS statisticalFamilyCode, mi.metel_sigla AS statisticalFamilyIssuerSigla
    FROM cat_product p
    JOIN cat_brand b ON b.id = p.brand_id
    LEFT JOIN cat_category c ON c.id = p.category_id
    LEFT JOIN cat_metel_family mf ON mf.id = p.statistical_family_id
    LEFT JOIN cat_metel_issuer mi ON mi.id = mf.issuer_id
    ORDER BY p.id
  `).all() as ProductRow[];

  const insert = database.prepare(`
    INSERT INTO cat_product_family_assignment
      (product_id, family_id, state, grouper_code, grouper_version)
    VALUES (?, ?, 'grouper', ?, ?)
  `);
  const update = database.prepare(`
    UPDATE cat_product_family_assignment
    SET family_id = ?, grouper_code = ?, grouper_version = ?
    WHERE product_id = ? AND state = 'grouper'
  `);
  const remove = database.prepare(
    "DELETE FROM cat_product_family_assignment WHERE product_id = ? AND state = 'grouper'",
  );

  let inserted = 0, updated = 0, removed = 0, rejected = 0, protectedCount = 0;
  for (const product of products) {
    if (affectedIds && !affectedIds.has(product.id)) continue;
    const current = assignments.get(product.id);
    if (current && current.state !== "grouper") {
      protectedCount++;
      continue;
    }
    const grouper = groupers.get(product.marchio);
    const proposedCode = grouper?.propose({
      productId: product.id,
      manufacturerCode: product.manufacturerCode,
      description: product.description,
      brandMarchio: product.marchio,
      categoryCode: product.categoryCode,
      statisticalFamilyCode: product.statisticalFamilyCode,
      statisticalFamilyIssuerSigla: product.statisticalFamilyIssuerSigla,
      attributes: attributes.get(product.id) ?? new Map(),
    }) ?? null;
    const proposed = proposedCode === null ? undefined : families.get(`${product.brandId}\0${proposedCode}`);
    const valid = proposed !== undefined && proposed.active === 1
      && proposed.brandId === product.brandId && proposed.categoryId === product.categoryId;

    if (proposedCode !== null && !valid) rejected++;
    if (!valid || !grouper) {
      if (current) removed += remove.run(product.id).changes;
      continue;
    }
    if (!current) {
      inserted += insert.run(product.id, proposed.id, grouper.code, grouper.version).changes;
    } else if (current.familyId !== proposed.id || current.grouperCode !== grouper.code
      || current.grouperVersion !== grouper.version) {
      updated += update.run(proposed.id, grouper.code, grouper.version, product.id).changes;
    }
  }
  return { inserted, updated, removed, rejected, protected: protectedCount };
}

/** Protected manual membership; rejects cross-brand assignments. */
export function setManualFamilyAssignment(
  database: Database.Database,
  productId: number,
  familyId: number,
): void {
  const compatible = database.prepare(`
    SELECT 1 FROM cat_product p JOIN cat_product_family f ON f.id = ?
    WHERE p.id = ? AND p.brand_id = f.brand_id
  `).get(familyId, productId);
  if (!compatible) throw new Error("Manual family assignment requires product and family to have the same brand");
  database.prepare(`
    INSERT INTO cat_product_family_assignment (product_id, family_id, state, grouper_code, grouper_version)
    VALUES (?, ?, 'manual', NULL, NULL)
    ON CONFLICT(product_id) DO UPDATE SET family_id = excluded.family_id,
      state = 'manual', grouper_code = NULL, grouper_version = NULL
  `).run(productId, familyId);
}

/** Protected absence: automatic grouping will never assign this product. */
export function setManualFamilyExclusion(database: Database.Database, productId: number): void {
  const exists = database.prepare("SELECT 1 FROM cat_product WHERE id = ?").get(productId);
  if (!exists) throw new Error(`Unknown product ${productId}`);
  database.prepare(`
    INSERT INTO cat_product_family_assignment (product_id, family_id, state, grouper_code, grouper_version)
    VALUES (?, NULL, 'manual_excluded', NULL, NULL)
    ON CONFLICT(product_id) DO UPDATE SET family_id = NULL,
      state = 'manual_excluded', grouper_code = NULL, grouper_version = NULL
  `).run(productId);
}
