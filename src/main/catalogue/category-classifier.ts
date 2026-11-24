import type Database from "better-sqlite3";
import { reconcileDerivedDiagnostics, type DerivedDiagnostic } from "./derived-diagnostics.js";

export const CLASSIFIER_VERSION = "2";
export type MappingType = "STATISTICA" | "SCONTO" | "CODE_PREFIX" | "DESCRIPTION" | "ELECTROCOD";
export type MatchMode = "exact" | "prefix" | "regex";

export interface CategoryRule {
  id: number;
  code: string;
  brandId: number | null;
  issuerId: number | null;
  sourceType: MappingType;
  matchMode: MatchMode;
  matchValue: string;
  categoryId: number;
  priority: number;
}

export interface ClassificationInput {
  brandId: number;
  issuerId: number | null;
  statisticalCode: string | null;
  discountCode: string | null;
  manufacturerCode: string;
  description: string | null;
}

// The schema reserves ELECTROCOD, but this milestone never reads or matches it.
export function supportedMatch(type: MappingType, mode: MatchMode): boolean {
  return (type === "STATISTICA" && (mode === "exact" || mode === "prefix")) ||
    (type === "CODE_PREFIX" && (mode === "prefix" || mode === "regex")) ||
    (type === "DESCRIPTION" && mode === "regex") ||
    (type === "SCONTO" && ["exact", "prefix", "regex"].includes(mode));
}

function precedence(rule: CategoryRule): number[] {
  const stage = rule.sourceType === "STATISTICA" ? (rule.matchMode === "exact" ? 0 : 1)
    : rule.sourceType === "SCONTO" ? 3 : 2;
  return [stage, -Number(rule.issuerId !== null) - Number(rule.brandId !== null),
    rule.matchMode === "prefix" ? -rule.matchValue.length : 0, -rule.priority];
}

function comparePrecedence(a: CategoryRule, b: CategoryRule): number {
  const left = precedence(a), right = precedence(b);
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

function createClassifierDecision(rules: readonly CategoryRule[]) {
  const compiled = rules.filter(r => supportedMatch(r.sourceType, r.matchMode)).map(rule => ({
    rule,
    regex: rule.matchMode === "regex" ? new RegExp(rule.matchValue) : null,
  })).sort((a, b) => comparePrecedence(a.rule, b.rule) ||
    (a.rule.code < b.rule.code ? -1 : a.rule.code > b.rule.code ? 1 : 0));
  return (product: ClassificationInput): { rule: CategoryRule | null; conflict: boolean; matched: boolean } => {
    let winner: CategoryRule | null = null;
    let conflict = false;
    for (const { rule, regex } of compiled) {
      if (winner && comparePrecedence(winner, rule) !== 0) break;
      if (rule.brandId !== null && rule.brandId !== product.brandId) continue;
      if (rule.issuerId !== null && rule.issuerId !== product.issuerId) continue;
      const value = rule.sourceType === "STATISTICA" ? product.statisticalCode
        : rule.sourceType === "SCONTO" ? product.discountCode
        : rule.sourceType === "CODE_PREFIX" ? product.manufacturerCode : product.description;
      if (value === null) continue;
      const matches = rule.matchMode === "exact" ? value === rule.matchValue
        : rule.matchMode === "prefix" ? value.startsWith(rule.matchValue) : regex!.test(value);
      if (!matches) continue;
      if (winner && winner.categoryId !== rule.categoryId) conflict = true;
      winner ??= rule;
    }
    return { rule: conflict ? null : winner, conflict, matched: winner !== null };
  };
}

/** Compile once per batch. Equal-precedence disagreement is deliberately unmapped. */
export function createClassifier(rules: readonly CategoryRule[]) {
  const decide = createClassifierDecision(rules);
  return (product: ClassificationInput): CategoryRule | null => decide(product).rule;
}

export function classifyProducts(database: Database.Database, affectedIds?: ReadonlySet<number>): number {
  const rules = database.prepare(`
    SELECT m.id, m.code, m.brand_id AS brandId, m.issuer_id AS issuerId,
      m.source_type AS sourceType, m.match_mode AS matchMode, m.match_value AS matchValue,
      m.category_id AS categoryId, m.priority
    FROM cat_category_mapping m JOIN cat_category c ON c.id = m.category_id
    WHERE c.active = 1
  `).all() as CategoryRule[];
  const statistical = createClassifierDecision(rules.filter(r => r.sourceType === "STATISTICA"));
  const fallback = createClassifierDecision(rules.filter(r => r.sourceType !== "STATISTICA"));
  const contributions = new Map<number, Array<{id:number;code:string;categoryId:number|null;importId:number}>>();
  for (const row of database.prepare(`SELECT e.product_id AS productId,m.id,m.code,m.category_id AS categoryId,
    m.source_import_id AS importId FROM cat_config_model_entry e JOIN cat_config_model m ON m.id=e.model_id
    JOIN app_source_import i ON i.id=m.source_import_id AND i.became_current=1
    WHERE m.active=1 AND m.obsolete=0 AND m.model_kind='device' AND m.commercial_contribution='articles'
    ORDER BY m.code`).all() as Array<{productId:number;id:number;code:string;categoryId:number|null;importId:number}>) {
    const rows=contributions.get(row.productId)??[];
    rows.push(row);contributions.set(row.productId,rows);
  }
  const select = database.prepare(`
    SELECT p.id, p.brand_id AS brandId, p.governing_issuer_id AS issuerId,
      p.manufacturer_code AS manufacturerCode, p.short_description AS description,
      s.code AS statisticalCode, d.code AS discountCode,b.metel_marchio AS marchio
    FROM cat_product p
    JOIN cat_brand b ON b.id=p.brand_id
    LEFT JOIN cat_metel_family s ON s.id = p.statistical_family_id
      AND s.issuer_id = p.governing_issuer_id AND s.brand_id = p.brand_id AND s.family_type = 'STATISTICA'
    LEFT JOIN cat_metel_family d ON d.id = p.discount_family_id
      AND d.issuer_id = p.governing_issuer_id AND d.brand_id = p.brand_id AND d.family_type = 'SCONTO'
    WHERE p.category_source <> 'manual'
  `);
  const update = database.prepare(`
    UPDATE cat_product SET category_id = @categoryId, category_source = @source,
      category_mapping_id = @mappingId, category_model_id = @modelId, updated_at = @now
    WHERE id = @id AND category_source <> 'manual'
      AND (category_id IS NOT @categoryId OR category_source <> @source
        OR category_mapping_id IS NOT @mappingId OR category_model_id IS NOT @modelId)
  `);
  let changed = 0;
  const now = new Date().toISOString();
  const diagnostics: DerivedDiagnostic[]=[];
  const subjects=new Set<string>();
  for (const row of select.all() as Array<ClassificationInput & { id: number; marchio:string }>) {
    if (affectedIds && !affectedIds.has(row.id)) continue;
    const subjectKey=`${row.marchio}:${row.manufacturerCode}`;
    subjects.add(subjectKey);
    const high=statistical(row);
    const models=contributions.get(row.id)??[];
    const categoryIds=new Set(models.map(m=>m.categoryId));
    const engineeringConflict=categoryIds.size>1 && [...categoryIds].some(id=>id!==null);
    const engineering=models.length>0 && !categoryIds.has(null) && categoryIds.size===1
      ? [...models].sort((a,b)=>a.code.localeCompare(b.code))[0] : undefined;
    const candidateCategory=engineering?.categoryId??null;
    const diagnosticImport=models[0]?.importId;
    if (diagnosticImport && engineeringConflict) diagnostics.push({importId:diagnosticImport,subjectKind:"article",
      subjectKey,topic:"derived.category_conflict",valueA:JSON.stringify(models.map(m=>({model:m.code,category:m.categoryId}))),
      sourceA:"engineering",valueB:null,sourceB:null,notes:null});
    if (diagnosticImport && high.rule && candidateCategory!==null && high.rule.categoryId!==candidateCategory)
      diagnostics.push({importId:diagnosticImport,subjectKind:"article",subjectKey,topic:"derived.category_shadowed",
        valueA:String(candidateCategory),sourceA:"engineering",valueB:String(high.rule.categoryId),sourceB:"STATISTICA",notes:null});
    const lower=(!high.matched && !high.conflict && !engineering) ? fallback(row) : null;
    const match=high.rule??(engineering?null:lower?.rule??null);
    const model=!high.matched && !high.conflict ? engineering : undefined;
    const categoryId=high.conflict ? null : match?.categoryId??model?.categoryId??null;
    const mappingId=high.conflict ? null : match?.id??null;
    changed += update.run({id:row.id,categoryId,source:categoryId===null?"unmapped":"mapping",
      mappingId,modelId:match?null:model?.id??null,now}).changes;
  }
  reconcileDerivedDiagnostics(database,["derived.category_conflict","derived.category_shadowed"],diagnostics,
    affectedIds?subjects:undefined);
  return changed;
}
