import type Database from "better-sqlite3";
import { reconcileDerivedDiagnostics, type DerivedDiagnostic } from "./derived-diagnostics.js";

/** Storage decisions and parser reconciliation share one deterministic engine pass. */
export const ENRICHMENT_VERSION = "3";
export type ParsedAttributeValue =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "option"; readonly value: string };
export interface AttributeParseInput {
  readonly description: string;
  readonly manufacturerCode?: string;
  readonly categoryCode?: string | null;
  readonly statisticalFamilyCode?: string | null;
  readonly statisticalFamilyIssuerSigla?: string | null;
}
export interface AttributeParseResult {
  readonly values: ReadonlyMap<string, ParsedAttributeValue>;
  readonly ambiguous: readonly string[];
}
export interface AttributeParser {
  readonly code: string;
  readonly version: string;
  parse(input: AttributeParseInput): AttributeParseResult;
}
export type AttributeParserRegistry = ReadonlyMap<string, AttributeParser>;
export interface AttributeEnrichmentStats {
  readonly inserted: number;
  readonly updated: number;
  readonly deleted: number;
  readonly ambiguous: Readonly<Record<string, number>>;
  readonly invalid: number;
}
type Applicable = { attributeId: number; dataType: string; code: string };
type Value = { valueNum: number | null; optionId: number | null };
type Candidate = Value & { ref: string; importId: number };
type Existing = Value & { productId: number; attributeId: number; source: string; sourceImportId: number | null; derivationRef: string | null; valueBool: number | null; valueText: string | null; confidence: number | null };
const same = (a: Value, b: Value): boolean => a.valueNum === b.valueNum && a.optionId === b.optionId;
const printable = (v: Value): string => JSON.stringify({ number: v.valueNum, option: v.optionId });

/** Called inside the caller's transaction. Only parser and engineering rows are writable. */
export function enrichProductAttributes(
  database: Database.Database,
  parsers: AttributeParserRegistry,
  affectedIds?: ReadonlySet<number>,
): AttributeEnrichmentStats {
  const applicability = new Map<number, Map<string, Applicable>>();
  const applicableIds = new Map<number, Set<number>>();
  for (const row of database.prepare(`SELECT ca.category_id AS categoryId,a.id AS attributeId,a.code,a.data_type AS dataType
    FROM cat_category_attribute ca JOIN cat_attribute a ON a.id=ca.attribute_id
    JOIN cat_category c ON c.id=ca.category_id WHERE a.active=1 AND c.active=1`).all() as Array<Applicable & {categoryId:number}>) {
    let attrs = applicability.get(row.categoryId);
    if (!attrs) applicability.set(row.categoryId, attrs = new Map());
    attrs.set(row.code, row);
    let ids = applicableIds.get(row.categoryId);
    if (!ids) applicableIds.set(row.categoryId, ids = new Set());
    ids.add(row.attributeId);
  }
  const optionIds = new Map<number, Map<string, number>>();
  for (const row of database.prepare("SELECT attribute_id AS attributeId,value,id FROM cat_attribute_option WHERE active=1").all() as Array<{attributeId:number;value:string;id:number}>) {
    let options = optionIds.get(row.attributeId);
    if (!options) optionIds.set(row.attributeId, options = new Map());
    options.set(row.value, row.id);
  }
  const existing = new Map<number, Map<number, Existing>>();
  for (const row of database.prepare(`SELECT product_id AS productId,attribute_id AS attributeId,value_num AS valueNum,
    option_id AS optionId,value_bool AS valueBool,value_text AS valueText,confidence,source,
    source_import_id AS sourceImportId,derivation_ref AS derivationRef FROM cat_product_attribute`).all() as Existing[]) {
    if (affectedIds && !affectedIds.has(row.productId)) continue;
    let attrs = existing.get(row.productId);
    if (!attrs) existing.set(row.productId, attrs = new Map());
    attrs.set(row.attributeId, row);
  }
  const candidates = new Map<number, Map<number, Candidate[]>>();
  const add = (productId: number, attributeId: number, value: Candidate) => {
    if (affectedIds && !affectedIds.has(productId)) return;
    let attrs = candidates.get(productId);
    if (!attrs) candidates.set(productId, attrs = new Map());
    let values = attrs.get(attributeId);
    if (!values) attrs.set(attributeId, values = []);
    values.push(value);
  };
  const modelSql = `FROM cat_config_model_entry e JOIN cat_config_model m ON m.id=e.model_id
    JOIN app_source_import i ON i.id=m.source_import_id AND i.became_current=1`;
  const eligibilitySql = `WHERE m.active=1 AND m.obsolete=0 AND m.model_kind='device'
    AND m.commercial_contribution='articles'`;
  for (const row of database.prepare(`SELECT e.product_id AS productId,ma.attribute_id AS attributeId,
    ma.value_num AS valueNum,ma.option_id AS optionId,m.code AS modelCode,a.code AS attributeCode,m.source_import_id AS importId
    ${modelSql} JOIN cat_config_model_attribute ma ON ma.model_id=m.id
    JOIN cat_attribute a ON a.id=ma.attribute_id ${eligibilitySql}`).all() as Array<{productId:number;attributeId:number;valueNum:number|null;optionId:number|null;modelCode:string;attributeCode:string;importId:number}>) {
    add(row.productId, row.attributeId, {valueNum:row.valueNum,optionId:row.optionId,
      ref:`${row.modelCode}/model.${row.attributeCode}`,importId:row.importId});
  }
  for (const row of database.prepare(`SELECT e.product_id AS productId,va.attribute_id AS attributeId,
    va.value_num AS valueNum,va.option_id AS optionId,m.code AS modelCode,v.code AS valueCode,
    m.source_import_id AS importId ${modelSql}
    JOIN cat_config_option o ON o.id=e.option_id AND o.active=1
    JOIN cat_config_dimension_value v ON v.id=o.value_id AND v.active=1
    JOIN cat_config_value_attribute va ON va.value_id=v.id ${eligibilitySql}`).all() as Array<{productId:number;attributeId:number;valueNum:number|null;optionId:number|null;modelCode:string;valueCode:string;importId:number}>) {
    add(row.productId,row.attributeId,{valueNum:row.valueNum,optionId:row.optionId,
      ref:`${row.modelCode}/${row.valueCode}`,importId:row.importId});
  }
  const insert = database.prepare(`INSERT INTO cat_product_attribute
    (product_id,attribute_id,value_num,option_id,source,source_import_id,derivation_ref)
    VALUES(?,?,?,?,?,?,?)`);
  const update = database.prepare(`UPDATE cat_product_attribute SET value_num=?,option_id=?,value_bool=NULL,value_text=NULL,
    confidence=NULL,source=?,source_import_id=?,derivation_ref=? WHERE product_id=? AND attribute_id=?
    AND source IN ('parser','engineering')`);
  const remove = database.prepare("DELETE FROM cat_product_attribute WHERE product_id=? AND attribute_id=? AND source IN ('parser','engineering')");
  let inserted=0,updated=0,deleted=0,invalid=0;
  const ambiguous: Record<string,number> = {};
  const diagnostics: DerivedDiagnostic[] = [];
  const subjects = new Set<string>();
  const products = database.prepare(`SELECT p.id,p.category_id AS categoryId,p.short_description AS description,
    p.manufacturer_code AS code,b.metel_marchio AS marchio,c.code AS categoryCode,
    f.code AS statisticalFamilyCode,i.metel_sigla AS statisticalFamilyIssuerSigla
    FROM cat_product p JOIN cat_brand b ON b.id=p.brand_id
    LEFT JOIN cat_category c ON c.id=p.category_id
    LEFT JOIN cat_metel_family f ON f.id=p.statistical_family_id AND f.brand_id=p.brand_id
      AND f.issuer_id=p.governing_issuer_id AND f.family_type='STATISTICA'
    LEFT JOIN cat_metel_issuer i ON i.id=f.issuer_id ORDER BY p.id`)
    .all() as Array<{id:number;categoryId:number|null;description:string|null;code:string;marchio:string;
      categoryCode:string|null;statisticalFamilyCode:string|null;statisticalFamilyIssuerSigla:string|null}>;
  for (const product of products) {
    if (affectedIds && !affectedIds.has(product.id)) continue;
    const subjectKey = `${product.marchio}:${product.code}`;
    subjects.add(subjectKey);
    const applicable = product.categoryId === null ? undefined : applicability.get(product.categoryId);
    const allowed = product.categoryId === null ? undefined : applicableIds.get(product.categoryId);
    const parser = parsers.get(product.marchio);
    const proposed = new Map<number,Value>();
    if (applicable && parser && product.description !== null) {
      const result = parser.parse({description:product.description,manufacturerCode:product.code,
        categoryCode:product.categoryCode,statisticalFamilyCode:product.statisticalFamilyCode,
        statisticalFamilyIssuerSigla:product.statisticalFamilyIssuerSigla});
      for (const code of result.ambiguous) if (applicable.has(code)) ambiguous[code]=(ambiguous[code]??0)+1;
      for (const [code,value] of result.values) {
        const target = applicable.get(code);
        if (!target) continue;
        if (value.kind === "number") {
          if (target.dataType === "number" && Number.isFinite(value.value) && value.value > 0)
            proposed.set(target.attributeId,{valueNum:value.value,optionId:null});
          else invalid++;
        } else {
          const option = target.dataType === "enum" ? optionIds.get(target.attributeId)?.get(value.value) : undefined;
          if (option === undefined) invalid++;
          else proposed.set(target.attributeId,{valueNum:null,optionId:option});
        }
      }
    }
    const current = existing.get(product.id) ?? new Map();
    const evidence = candidates.get(product.id) ?? new Map();
    const attributes = new Set([...current.keys(),...proposed.keys(),...evidence.keys()]);
    for (const attributeId of attributes) {
      const row = current.get(attributeId);
      const parserValue = allowed?.has(attributeId) ? proposed.get(attributeId) : undefined;
      const engineering = allowed?.has(attributeId) ? [...(evidence.get(attributeId)??[])].sort((a,b)=>a.ref.localeCompare(b.ref)) : [];
      const conflict = engineering.length > 1 && engineering.some(v=>!same(v,engineering[0]!));
      const agreement = !conflict ? engineering[0] : undefined;
      const protectedRow = row && !["parser","engineering"].includes(row.source);
      const addDiagnostic = (topic:string,valueA:string,valueB:string|null,sourceB:string|null,importId:number) => {
        diagnostics.push({importId,subjectKind:"article",subjectKey,topic,valueA,sourceA:"engineering",
          valueB,sourceB,notes:`attribute_id=${attributeId}`});
      };
      if (conflict) {
        const valueA=JSON.stringify(engineering.map(v=>({ref:v.ref,number:v.valueNum,option:v.optionId})));
        addDiagnostic("derived.conflict",valueA,row?.source==="parser"?printable(row):protectedRow?printable(row):null,
          row?.source==="parser"?"parser":protectedRow?row.source:null,engineering[0]!.importId);
      } else if (protectedRow && agreement && !same(row,agreement)) {
        addDiagnostic("derived.shadowed",printable(agreement),printable(row),row.source,agreement.importId);
      } else if (!protectedRow && agreement && parserValue && !same(agreement,parserValue)) {
        addDiagnostic("derived.parser_disagrees",printable(agreement),printable(parserValue),"parser",agreement.importId);
      }
      if (protectedRow) continue;
      const wanted = conflict ? undefined : agreement ?? parserValue;
      if (!wanted) { if (row) deleted += remove.run(product.id,attributeId).changes; continue; }
      const source=agreement?"engineering":"parser";
      const importId=agreement?.importId??null, ref=agreement?.ref??null;
      if (!row) inserted+=insert.run(product.id,attributeId,wanted.valueNum,wanted.optionId,source,importId,ref).changes;
      else if (!same(row,wanted) || row.source!==source || row.sourceImportId!==importId || row.derivationRef!==ref ||
        row.valueBool!==null || row.valueText!==null || row.confidence!==null)
        updated+=update.run(wanted.valueNum,wanted.optionId,source,importId,ref,product.id,attributeId).changes;
    }
  }
  reconcileDerivedDiagnostics(database,["derived.conflict","derived.shadowed","derived.parser_disagrees"],diagnostics,
    affectedIds ? subjects : undefined);
  return {inserted,updated,deleted,ambiguous,invalid};
}
