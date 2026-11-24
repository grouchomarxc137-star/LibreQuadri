import type Database from "better-sqlite3";
import { InvalidCatalogueFilterError } from "./attribute-queries.js";

export interface FamilyAxis {
  readonly code: string;
  readonly name: string;
  readonly dataType: "number" | "enum";
  readonly unit: string | null;
  readonly sortOrder: number;
  readonly active: boolean;
}

export interface ConfigurableFamily {
  readonly id: number;
  readonly brandMarchio: string;
  readonly code: string;
  readonly name: string;
  readonly series: string | null;
  readonly description: string | null;
  readonly categoryCode: string;
  readonly active: boolean;
  readonly axes: readonly FamilyAxis[];
}

export type FamilyValidationIssueCode =
  | "missing_axis_value"
  | "duplicate_axis_tuple"
  | "brand_mismatch"
  | "category_mismatch"
  | "inactive_family"
  | "inactive_value";

export interface FamilyValidationIssue {
  readonly code: FamilyValidationIssueCode;
  readonly familyId: number;
  readonly productId: number;
  readonly manufacturerCode: string;
  readonly axisCode?: string;
  readonly duplicateProductIds?: readonly number[];
}

interface FamilyRow {
  readonly id: number;
  readonly brandId: number;
  readonly brandMarchio: string;
  readonly code: string;
  readonly name: string;
  readonly series: string | null;
  readonly description: string | null;
  readonly categoryId: number;
  readonly categoryCode: string;
  readonly active: number;
}

interface AxisRow extends FamilyAxis {
  readonly id: number;
}

interface AxisSqlRow {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly dataType: "number" | "enum";
  readonly unit: string | null;
  readonly sortOrder: number;
  readonly active: number;
}

interface Member {
  readonly productId: number;
  readonly manufacturerCode: string;
  readonly brandId: number;
  readonly categoryId: number | null;
  readonly isListed: number;
  readonly lifecycleStatusCode: string | null;
  readonly values: Map<string, MemberValue>;
}

interface MemberValue {
  readonly value: string | number;
  readonly label: string;
  readonly optionSortOrder: number | null;
  readonly active: boolean;
}

function familyRow(database: Database.Database, brandMarchio: string, familyCode: string): FamilyRow {
  const row = database.prepare(`
    SELECT f.id, f.brand_id AS brandId, b.metel_marchio AS brandMarchio,
      f.code, f.name, f.series, f.description, f.category_id AS categoryId,
      c.code AS categoryCode, f.active
    FROM cat_product_family f
    JOIN cat_brand b ON b.id = f.brand_id AND b.active=1
    JOIN cat_category c ON c.id = f.category_id
    WHERE b.metel_marchio = ? AND f.code = ?
  `).get(brandMarchio, familyCode) as FamilyRow | undefined;
  if (!row) throw new Error(`Unknown configurable family ${brandMarchio}/${familyCode}`);
  return row;
}

function axes(database: Database.Database, familyId: number): AxisRow[] {
  const rows = database.prepare(`
    SELECT a.id, a.code, a.name, a.data_type AS dataType, a.unit,
      va.sort_order AS sortOrder, a.active
    FROM cat_family_variant_axis va
    JOIN cat_attribute a ON a.id = va.attribute_id
    WHERE va.family_id = ? ORDER BY va.sort_order, a.code
  `).all(familyId) as AxisSqlRow[];
  return rows.map(row => ({ ...row, active: row.active === 1 }));
}

function members(database: Database.Database, familyId: number): Member[] {
  const result = (database.prepare(`
    SELECT p.id AS productId, p.manufacturer_code AS manufacturerCode,
      p.brand_id AS brandId, p.category_id AS categoryId, p.is_listed AS isListed,
      p.lifecycle_status_code AS lifecycleStatusCode
    FROM cat_product_family_assignment fa
    JOIN cat_product p ON p.id = fa.product_id AND p.import_removed=0 AND p.brand_id IN (SELECT id FROM cat_brand WHERE active=1)
    WHERE fa.family_id = ?
    ORDER BY p.id
  `).all(familyId) as Array<Omit<Member, "values">>).map(row => ({ ...row, values: new Map<string, MemberValue>() }));
  const byId = new Map(result.map(member => [member.productId, member]));
  for (const row of database.prepare(`
    SELECT pa.product_id AS productId, a.code, a.data_type AS dataType,
      pa.value_num AS valueNum, o.value AS optionValue, o.label AS optionLabel,
      o.sort_order AS optionSortOrder, o.active AS optionActive
    FROM cat_product_family_assignment fa
    JOIN cat_product_attribute pa ON pa.product_id = fa.product_id
    JOIN cat_attribute a ON a.id = pa.attribute_id
    JOIN cat_family_variant_axis va ON va.family_id = fa.family_id AND va.attribute_id = a.id
    LEFT JOIN cat_attribute_option o ON o.id = pa.option_id
    WHERE fa.family_id = ?
  `).all(familyId) as Array<{
    productId: number; code: string; dataType: string; valueNum: number | null;
    optionValue: string | null; optionLabel: string | null;
    optionSortOrder: number | null; optionActive: number | null;
  }>) {
    const member = byId.get(row.productId)!;
    if (row.dataType === "number" && row.valueNum !== null) {
      member.values.set(row.code, { value: row.valueNum, label: String(row.valueNum), optionSortOrder: null, active: true });
    } else if (row.dataType === "enum" && row.optionValue !== null) {
      member.values.set(row.code, { value: row.optionValue, label: row.optionLabel ?? row.optionValue,
        optionSortOrder: row.optionSortOrder, active: row.optionActive === 1 });
    }
  }
  return result;
}

export function getFamilyAxes(
  database: Database.Database,
  brandMarchio: string,
  familyCode: string,
): ConfigurableFamily {
  const family = familyRow(database, brandMarchio, familyCode);
  return {
    id: family.id,
    brandMarchio: family.brandMarchio,
    code: family.code,
    name: family.name,
    series: family.series,
    description: family.description,
    categoryCode: family.categoryCode,
    active: family.active === 1,
    axes: axes(database, family.id).map(({ id: _id, ...axis }) => axis),
  };
}

function validationFor(
  family: FamilyRow,
  familyAxes: readonly AxisRow[],
  familyMembers: readonly Member[],
): FamilyValidationIssue[] {
  const issues: FamilyValidationIssue[] = [];
  const complete = new Map<string, Member[]>();
  for (const member of familyMembers) {
    if (family.active !== 1) issues.push({ code: "inactive_family", familyId: family.id,
      productId: member.productId, manufacturerCode: member.manufacturerCode });
    if (member.brandId !== family.brandId) issues.push({ code: "brand_mismatch", familyId: family.id,
      productId: member.productId, manufacturerCode: member.manufacturerCode });
    if (member.categoryId !== family.categoryId) issues.push({ code: "category_mismatch", familyId: family.id,
      productId: member.productId, manufacturerCode: member.manufacturerCode });
    const tuple: Array<string | number> = [];
    let isComplete = true;
    for (const axis of familyAxes) {
      const value = member.values.get(axis.code);
      if (!value) {
        isComplete = false;
        issues.push({ code: "missing_axis_value", familyId: family.id, productId: member.productId,
          manufacturerCode: member.manufacturerCode, axisCode: axis.code });
      } else {
        tuple.push(value.value);
        if (!axis.active || !value.active) issues.push({ code: "inactive_value", familyId: family.id,
          productId: member.productId, manufacturerCode: member.manufacturerCode, axisCode: axis.code });
      }
    }
    if (isComplete) {
      const key = JSON.stringify(tuple);
      const group = complete.get(key) ?? [];
      group.push(member);
      complete.set(key, group);
    }
  }
  for (const duplicates of complete.values()) {
    if (duplicates.length < 2) continue;
    const ids = duplicates.map(member => member.productId);
    for (const member of duplicates) issues.push({ code: "duplicate_axis_tuple", familyId: family.id,
      productId: member.productId, manufacturerCode: member.manufacturerCode,
      duplicateProductIds: ids.filter(id => id !== member.productId) });
  }
  return issues;
}

/** Derived, read-only validation over all members, including delisted products. */
export function validateFamily(
  database: Database.Database,
  brandMarchio: string,
  familyCode: string,
): readonly FamilyValidationIssue[] {
  const family = familyRow(database, brandMarchio, familyCode);
  const familyAxes = axes(database, family.id);
  return validationFor(family, familyAxes, members(database, family.id));
}

export interface AvailableFamilyValue {
  readonly value: string | number;
  readonly label: string;
  readonly listedMemberCount: number;
  readonly unlistedMemberCount: number;
  readonly hasConflict: boolean;
}

interface MutableAvailableFamilyValue {
  value: string | number;
  label: string;
  listedMemberCount: number;
  unlistedMemberCount: number;
  hasConflict: boolean;
  sort: number | null;
}

function same(a: string | number, b: string | number): boolean {
  return typeof a === typeof b && a === b;
}

function validateAxisSelections(
  database: Database.Database,
  familyAxes: readonly AxisRow[],
  selections: Readonly<Record<string, unknown>>,
): void {
  const byCode = new Map(familyAxes.map(axis => [axis.code, axis]));
  const activeOption = database.prepare(`
    SELECT 1 FROM cat_attribute_option
    WHERE attribute_id = ? AND value = ? AND active = 1
  `);
  for (const [code, value] of Object.entries(selections)) {
    const axis = byCode.get(code);
    if (!axis) throw new InvalidCatalogueFilterError(`unknown family axis "${code}"`);
    if (!axis.active) throw new InvalidCatalogueFilterError(`family axis "${code}" is inactive`);
    if (axis.dataType === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new InvalidCatalogueFilterError(`family axis "${code}" expects a finite number`);
      }
    } else if (typeof value !== "string" || activeOption.get(axis.id, value) === undefined) {
      throw new InvalidCatalogueFilterError(`unknown or inactive option "${String(value)}" for family axis "${code}"`);
    }
  }
}

/** Values actually present among members matching selections on the other axes. */
export function getConditionallyAvailableFamilyValues(
  database: Database.Database,
  brandMarchio: string,
  familyCode: string,
  axisCode: string,
  selections: Readonly<Record<string, string | number>>,
): readonly AvailableFamilyValue[] {
  const family = familyRow(database, brandMarchio, familyCode);
  const familyAxes = axes(database, family.id);
  const targetAxis = familyAxes.find(axis => axis.code === axisCode);
  if (!targetAxis) throw new InvalidCatalogueFilterError(`unknown family axis "${axisCode}"`);
  if (!targetAxis.active) throw new InvalidCatalogueFilterError(`family axis "${axisCode}" is inactive`);
  validateAxisSelections(database, familyAxes, selections);
  const familyMembers = members(database, family.id);
  const conflicted = new Set(validationFor(family, familyAxes, familyMembers).map(issue => issue.productId));
  const values = new Map<string, MutableAvailableFamilyValue>();
  for (const member of familyMembers) {
    const matches = Object.entries(selections).every(([code, selected]) => code === axisCode
      || (member.values.get(code) !== undefined && same(member.values.get(code)!.value, selected)));
    const value = member.values.get(axisCode);
    if (!matches || !value) continue;
    const key = `${typeof value.value}:${String(value.value)}`;
    const current = values.get(key) ?? { value: value.value, label: value.label,
      listedMemberCount: 0, unlistedMemberCount: 0, hasConflict: false, sort: value.optionSortOrder };
    if (member.isListed === 1) current.listedMemberCount++;
    else current.unlistedMemberCount++;
    current.hasConflict ||= conflicted.has(member.productId);
    values.set(key, current);
  }
  return [...values.values()].sort((a, b) => a.sort !== null && b.sort !== null
    ? a.sort - b.sort : typeof a.value === "number" && typeof b.value === "number"
      ? a.value - b.value : String(a.value).localeCompare(String(b.value)))
    .map(({ sort: _sort, ...value }) => value);
}

export type FamilyResolution =
  | { readonly status: "incomplete"; readonly missingAxisCodes: readonly string[] }
  | { readonly status: "not_offered" }
  | { readonly status: "conflict"; readonly productIds: readonly number[]; readonly issues: readonly FamilyValidationIssue[] }
  | { readonly status: "resolved"; readonly productId: number; readonly manufacturerCode: string;
      readonly isListed: boolean; readonly lifecycleStatusCode: string | null };

/** Resolves a complete tuple against actual members; no Cartesian grid is generated. */
export function resolveFamilySelection(
  database: Database.Database,
  brandMarchio: string,
  familyCode: string,
  selections: Readonly<Record<string, string | number>>,
): FamilyResolution {
  const family = familyRow(database, brandMarchio, familyCode);
  const familyAxes = axes(database, family.id);
  validateAxisSelections(database, familyAxes, selections);
  const missingAxisCodes = familyAxes.filter(axis => selections[axis.code] === undefined).map(axis => axis.code);
  if (missingAxisCodes.length > 0) return { status: "incomplete", missingAxisCodes };
  const familyMembers = members(database, family.id);
  const matching = familyMembers.filter(member => familyAxes.every(axis => {
    const value = member.values.get(axis.code);
    return value !== undefined && same(value.value, selections[axis.code]!);
  }));
  const allIssues = validationFor(family, familyAxes, familyMembers);
  const matchingIds = new Set(matching.map(member => member.productId));
  const issues = allIssues.filter(issue => matchingIds.has(issue.productId));
  if (family.active !== 1 || matching.length > 1 || issues.length > 0) {
    return { status: "conflict", productIds: matching.map(member => member.productId), issues };
  }
  const member = matching[0];
  if (!member) return { status: "not_offered" };
  return { status: "resolved", productId: member.productId, manufacturerCode: member.manufacturerCode,
    isListed: member.isListed === 1, lifecycleStatusCode: member.lifecycleStatusCode };
}
