import {parseMountingFacts} from "../../shared/mounting.js";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

import { isOutOfCatalogue } from "../../shared/out-of-catalogue.js";
import type { ConfigurationResult } from "../../shared/configuration.js";
import { configuredItemAddable } from "../catalogue/configuration-addability.js";
import type { CatalogueProductSnapshotSource, ProjectConfiguredItem, ProjectDistintaRow } from "../../shared/project.js";
import { projectEngineeringChainStale } from "./engineering-status.js";
import { PlacementError } from "./physical-placement.js";

type ProductSource = (id: number) => CatalogueProductSnapshotSource;

/** Remove only former references that are now unused. The caller owns the transaction. */
export function removeUnusedProductSnapshots(db: Database.Database, candidates: Iterable<number>): void {
  const removeUnused = db.prepare(`DELETE FROM prj_product_snapshot WHERE id=?
    AND NOT EXISTS (SELECT 1 FROM prj_line WHERE snapshot_id=prj_product_snapshot.id)
    AND NOT EXISTS (SELECT 1 FROM prj_item_bom WHERE snapshot_id=prj_product_snapshot.id)
    AND NOT EXISTS (SELECT 1 FROM prj_item WHERE primary_snapshot_id=prj_product_snapshot.id)`);
  for (const id of new Set(candidates)) removeUnused.run(id);
}

function canonicalRows(rows: readonly (readonly unknown[])[]): string[] {
  return rows.map(row => JSON.stringify(row)).sort();
}

function storedConstraintSets(rows: ProjectConfiguredItem["constraints"]): string[] {
  const sets = new Map<string,{relation:string;classes:string[]}>();
  for (const row of rows) {
    const key = JSON.stringify([row.relation,row.setNo]);
    const set = sets.get(key) ?? {relation:row.relation,classes:[]};
    set.classes.push(row.classCode);
    sets.set(key,set);
  }
  return canonicalRows([...sets.values()].map(set =>
    [set.relation,[...new Set(set.classes)].sort()]));
}

export function engineeringSnapshotDiff(result: ConfigurationResult, stored: ProjectConfiguredItem): string[] {
  const physical = result.physical;
  const selected = new Set(result.selectedOptionIds);
  const incoming = {
    mounting:physical?.mounting??null,
    identity:[result.model.brandMarchio,result.model.code,result.model.definitionFingerprint,
      result.model.kind,result.commercialContribution,result.fingerprint,result.status,physical ? "resolved" : "not_physical",
      physical?.code ?? null,physical?.fitClass.code ?? null,physical?.depthMm ?? null,
      physical?.outerDepthMm ?? null,physical?.usableDepthMm ?? null],
    selections:canonicalRows(result.model.axes.flatMap(axis => axis.options
      .filter(option => selected.has(option.id)).map(option => [axis.dimensionCode,option.valueCode,
        axis.binding,axis.editableWhenPlaced,axis.visibility === "visible" && option.visible]))),
    demands:canonicalRows((physical?.demands ?? []).map(row => [row.capacityKindCode,row.amount,
      row.displayDivisor,row.nominalPitchMm])),
    views:canonicalRows((physical?.views ?? []).map(row => [row.code,row.widthMm,row.heightMm,
      row.insertDxMm,row.insertDyMm,row.symbolKind,row.assetKey])),
    zones:canonicalRows((physical?.zones ?? []).map(row => [row.zoneNo,row.layout,row.capacityKindCode,
      row.displayDivisor ?? null,row.nominalPitchMm ?? null,row.capacityAmount,row.originXMm,
      row.originYMm,row.lengthMm,row.breadthMm,row.direction,row.pitchMm,row.requiredViewCode,row.mounting??null])),
    slots:canonicalRows((physical?.slots ?? []).map(row => [row.zoneNo,row.slotNo,row.xMm,row.yMm])),
    constraints:canonicalRows((physical?.constraints ?? []).map(row =>
      [row.relation,[...new Set(row.classCodes)].sort()])),
    exclusions:canonicalRows(result.exclusions.map(row => [row.ownDimensionCode,row.ownValueCode,
      row.ancestorDimensionCode,row.ancestorValueCode])),
  };
  const saved = {
    mounting:stored.mounting??null,
    identity:[stored.modelBrandMarchio,stored.modelCode,stored.modelDefinitionFingerprint,
      stored.modelKind,stored.commercialContribution,stored.configFingerprint,stored.configStatus,stored.physStatus,
      stored.profileCode,stored.fitClassCode,stored.depthMm,stored.outerDepthMm,stored.usableDepthMm],
    selections:canonicalRows(stored.selections.map(row => [row.dimensionCode,row.valueCode,
      row.binding,row.editableWhenPlaced,row.visible])),
    demands:canonicalRows(stored.demands.map(row => [row.capacityKindCode,row.amount,
      row.displayDivisor,row.nominalPitchMm])),
    views:canonicalRows(stored.views.map(row => [row.viewCode,row.widthMm,row.heightMm,
      row.insertDxMm,row.insertDyMm,row.symbolKind,row.assetKey])),
    zones:canonicalRows(stored.zones.map(row => [row.zoneNo,row.layout,row.capacityKindCode,
      row.displayDivisor,row.nominalPitchMm,row.capacityAmount,row.originXMm,row.originYMm,
      row.lengthMm,row.breadthMm,row.direction,row.pitchMm,row.requiredViewCode,row.mounting??null])),
    slots:canonicalRows(stored.slots.map(row => [row.zoneNo,row.slotNo,row.xMm,row.yMm])),
    constraints:storedConstraintSets(stored.constraints),
    exclusions:canonicalRows(stored.exclusions.map(row => [row.ownDimensionCode,row.ownValueCode,
      row.ancestorDimensionCode,row.ancestorValueCode])),
  };
  return (Object.keys(incoming) as Array<keyof typeof incoming>).filter(key =>
    JSON.stringify(incoming[key]) !== JSON.stringify(saved[key]));
}

interface StoredContext { policy: string | null; role: "provides" | "accepts" | null; codes: string[]; }

function readStoredContext(db: Database.Database, itemId: number): StoredContext {
  const policy = db.prepare("SELECT context_policy FROM prj_item WHERE id=?").pluck().get(itemId) as string | null;
  const rows = db.prepare("SELECT role,context_code AS code FROM prj_item_context WHERE item_id=? ORDER BY context_code")
    .all(itemId) as Array<{role:"provides"|"accepts";code:string}>;
  return { policy, role: rows[0]?.role ?? null, codes: rows.map(row => row.code) };
}

/** Context facts are part of the semantic snapshot: policy, role and the sorted, distinct active codes. */
function sameContext(incoming: ConfigurationResult["context"], stored: StoredContext): boolean {
  if (!incoming) return stored.policy === null;
  const codes = [...new Set(incoming.codes)].sort();
  return stored.policy === incoming.policy && JSON.stringify(stored.codes) === JSON.stringify(codes) &&
    (codes.length === 0 || stored.role === incoming.role);
}

function writeContext(db: Database.Database, itemId: number, context: NonNullable<ConfigurationResult["context"]>): void {
  db.prepare("UPDATE prj_item SET context_policy=? WHERE id=?").run(context.policy, itemId);
  const insert = db.prepare("INSERT INTO prj_item_context(item_id,role,context_code) VALUES (?,?,?)");
  for (const code of new Set(context.codes)) insert.run(itemId, context.role, code);
}

export class ConfiguredPriceSnapshotError extends Error {
  readonly code = "price_snapshot_conflict";
}

/** Shared price-snapshot identity policy. The caller owns the transaction. */
export function ensureConfiguredProductSnapshot(db: Database.Database, source: CatalogueProductSnapshotSource,
  takenAt: string): number {
  const snapshot = db.prepare(`SELECT id,price_issuer_sigla AS priceIssuerSigla,
    price_listino_number AS priceListinoNumber,price_valid_from AS priceValidFrom,
    list_price_unit_e4 AS listPriceUnitE4,price_multiplier_original AS priceMultiplierOriginal
    FROM prj_product_snapshot WHERE brand_marchio=? AND manufacturer_code=?`)
    .get(source.brandMarchio, source.manufacturerCode) as {id:number;priceIssuerSigla:string|null;
      priceListinoNumber:string|null;priceValidFrom:string|null;listPriceUnitE4:number|null;
      priceMultiplierOriginal:number|null}|undefined;
  if (snapshot && (snapshot.priceIssuerSigla !== source.priceIssuerSigla ||
      snapshot.priceListinoNumber !== source.priceListinoNumber ||
      snapshot.priceValidFrom !== source.priceValidFrom ||
      snapshot.listPriceUnitE4 !== source.listPriceUnitE4 ||
      snapshot.priceMultiplierOriginal !== source.priceMultiplierOriginal)) {
    throw new ConfiguredPriceSnapshotError(`L'articolo ${source.brandMarchio}/${source.manufacturerCode} ha già nel progetto un prezzo o listino diverso. Rivedi il preventivo prima di aggiungerlo.`);
  }
  let snapshotId = snapshot?.id;
  if (!snapshot) {
    const inserted = db.prepare(`INSERT INTO prj_product_snapshot(
      uuid,brand_marchio,brand_name,manufacturer_code,ean,short_description,description,
      unit_of_measure,category_code,category_path_label,family_code,family_name,
      price_issuer_sigla,price_listino_number,price_valid_from,list_price_unit_e4,
      price_multiplier_original,snapshot_taken_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),source.brandMarchio,
        source.brandName,source.manufacturerCode,source.ean,source.shortDescription,
        source.description,source.unitOfMeasure,source.categoryCode,source.categoryPathLabel,
        source.familyCode,source.familyName,source.priceIssuerSigla,source.priceListinoNumber,
        source.priceValidFrom,source.listPriceUnitE4,source.priceMultiplierOriginal,takenAt);
    snapshotId = Number(inserted.lastInsertRowid);
    const attributeInsert = db.prepare(`INSERT INTO prj_product_snapshot_attribute(
      snapshot_id,attribute_code,attribute_name,data_type,unit,value_num,option_value,
      option_label,value_bool,value_text) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const attribute of source.attributes) attributeInsert.run(snapshotId,attribute.code,
      attribute.name,attribute.dataType,attribute.unit,
      attribute.dataType === "number" ? attribute.value : null,
      attribute.dataType === "enum" ? attribute.value : null,
      attribute.dataType === "enum" ? attribute.label : null,
      attribute.dataType === "boolean" ? Number(attribute.value) : null,
      attribute.dataType === "text" ? attribute.value : null);
  }
  return snapshotId!;
}

/** The caller owns the transaction. Catalogue reads finish before writes. Returns the inserted or merged item UUID. */
export function insertConfiguredItem(db: Database.Database, result: ConfigurationResult,
  productSource: ProductSource, takenAt: string, quantity = 1, mergeExisting = true, acceptOutOfCatalogue = false): string {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 9_999) {
    throw new Error("Quantità non valida.");
  }
  const outside = acceptOutOfCatalogue && isOutOfCatalogue(result);
  if (!configuredItemAddable(result) && !outside) {
    throw new Error("Solo una configurazione completa e attiva può essere aggiunta al progetto.");
  }
  const existing = db.prepare(`SELECT l.id,l.quantity,l.sale_price_unit_e4 AS salePriceUnitE4,
    i.id AS itemId,i.uuid AS itemUuid
    FROM prj_item i JOIN prj_line l ON l.item_id=i.id AND l.line_type='item'
    WHERE i.model_brand_marchio=? AND i.model_code=? AND i.config_fingerprint=? ORDER BY i.id`)
    .get(result.model.brandMarchio,result.model.code,result.fingerprint) as
      {id:number;itemId:number;itemUuid:string;quantity:number;salePriceUnitE4:number|null}|undefined;
  // Q22 is a catalogue-backed addition. Known older/newer saved interpretations require the
  // explicit project refresh before any snapshot comparison, commerce check or project write.
  if (existing && projectEngineeringChainStale(db,undefined,existing.itemUuid)) {
    throw new PlacementError("project_engineering_stale","Aggiorna i dati di ingegneria del progetto.");
  }
  const articles = result.bom.map(article => {
    if (outside && article.productId === null) {
      const source: CatalogueProductSnapshotSource = {
        brandMarchio: article.brandMarchio, brandName: article.brandMarchio,
        manufacturerCode: article.manufacturerCode, ean: null,
        shortDescription: `${article.description ?? article.manufacturerCode} · Fuori catalogo`,
        description: `${article.description ?? article.manufacturerCode} · Fuori catalogo — articolo non presente in METEL`,
        unitOfMeasure: null, categoryCode: null, categoryPathLabel: null, familyCode: null, familyName: null,
        priceIssuerSigla: null, priceListinoNumber: null, priceValidFrom: null,
        listPriceUnitE4: null, priceMultiplierOriginal: null, attributes: [],
      };
      return { article, source };
    }
    if (article.productId === null || (!outside && (article.unitPriceE4 === null || article.rowTotalE4 === null ||
        article.currency !== "EUR")) || article.quantity <= 0 || !Number.isFinite(article.quantity)) {
      throw new Error("La distinta della configurazione non è completa.");
    }
    const source = productSource(article.productId);
    if (source.brandMarchio !== article.linkedBrandMarchio ||
        source.manufacturerCode !== article.linkedManufacturerCode ||
        source.listPriceUnitE4 !== article.unitPriceE4 ||
        source.priceIssuerSigla !== article.priceIssuerSigla ||
        source.priceListinoNumber !== article.priceListinoNumber ||
        source.priceValidFrom !== article.priceValidFrom ||
        source.priceMultiplierOriginal !== article.priceMultiplierOriginal) {
      throw new Error("Il catalogo è cambiato durante la risoluzione. Riprova la configurazione.");
    }
    return { article, source };
  });
  const snapshotIds = new Map<ConfigurationResult["bom"][number], number>();
  for (const { article, source } of articles) {
    const snapshotId = ensureConfiguredProductSnapshot(db,source,takenAt);
    snapshotIds.set(article,snapshotId!);
  }
  if (existing) {
    const stored = readConfiguredItems(db,existing.itemId)[0]!;
    const storedContext = readStoredContext(db,existing.itemId);
    // A legacy item (no context snapshot) may be completed by re-adding the same configuration;
    // an item that has facts must match them exactly.
    const fillsLegacyContext = storedContext.policy === null && !!result.context;
    if (engineeringSnapshotDiff(result,stored).length > 0 || !(fillsLegacyContext || sameContext(result.context,storedContext))) {
      throw new Error("I dati tecnici della configurazione sono diversi dalla versione già nel progetto. Rivedi la configurazione prima di aggiungerla.");
    }
    const storedBom = db.prepare(`SELECT s.brand_marchio AS brandMarchio,
      s.manufacturer_code AS manufacturerCode,b.quantity_per_item AS quantity,
      b.sale_price_unit_e4 AS unitPriceE4,b.role FROM prj_item_bom b
      JOIN prj_item i ON i.id=b.item_id JOIN prj_line l ON l.item_id=i.id
      JOIN prj_product_snapshot s ON s.id=b.snapshot_id WHERE l.id=? ORDER BY b.seq`)
      .all(existing.id) as Array<{brandMarchio:string;manufacturerCode:string;quantity:number;
        unitPriceE4:number;role:string}>;
    const sameBom = JSON.stringify(canonicalRows(storedBom.map(row => [row.brandMarchio,
      row.manufacturerCode,row.quantity,row.unitPriceE4,row.role]))) ===
      JSON.stringify(canonicalRows(articles.map(({article,source}) => [source.brandMarchio,
        source.manufacturerCode,article.quantity,article.unitPriceE4,
        article.roles.includes("primary") ? "primary" :
          article.roles.includes("accessory") ? "accessory" : "component"])));
    if (!sameBom || existing.salePriceUnitE4 !== result.totalE4) {
      throw new Error("La configurazione ha prezzi o distinta diversi dalla versione nel progetto. Rivedi il preventivo prima di aggiungerla.");
    }
    if (mergeExisting) {
      if (fillsLegacyContext) writeContext(db,existing.itemId,result.context!);
      if (stored.engineeringProvenance == null) writeEngineeringProvenance(db,existing.itemId,result.provenance);
      const nextQuantity = existing.quantity + quantity;
      if (!Number.isSafeInteger(nextQuantity) || nextQuantity > 9_999) {
        throw new Error("La quantità massima per riga è 9.999.");
      }
      const total = existing.salePriceUnitE4===null?null:existing.salePriceUnitE4 * nextQuantity;
      if (total!==null&&!Number.isSafeInteger(total)) throw new Error("Il totale della riga supera l'intervallo numerico supportato.");
      db.prepare("UPDATE prj_line SET quantity=?,line_total_e4=? WHERE id=?")
        .run(nextQuantity,total,existing.id);
      return existing.itemUuid;
    }
  }
  const lineTotal = result.totalE4===null?null:result.totalE4 * quantity;
  if (lineTotal!==null&&!Number.isSafeInteger(lineTotal)) throw new Error("Il totale della riga supera l'intervallo numerico supportato.");
  const physical = result.physical;
  const selected = new Set(result.selectedOptionIds);
  const defaulted = new Set(result.defaultedOptionIds);
  const selections = result.model.axes.flatMap(axis => axis.options.filter(option => selected.has(option.id))
    .map(option => ({axis,option})));
  const configLabel = [result.model.name,...selections.filter(({axis,option}) =>
    axis.visibility === "visible" && option.visible).map(({option}) => option.label)].join(" · ");
  const primary = articles.find(({article}) => article.roles.includes("primary"));
  const primaryId = primary ? snapshotIds.get(primary.article)! : null;
  const itemUuid=randomUUID();
  const item = db.prepare(`INSERT INTO prj_item(uuid,model_brand_marchio,model_code,model_name,
    model_kind,commercial_contribution,model_definition_fingerprint,model_source_ref,config_fingerprint,config_label,
    config_status,primary_snapshot_id,phys_status,profile_code,profile_name,fit_class_code,
    fit_class_label,depth_mm,outer_depth_mm,usable_depth_mm,snapshot_taken_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(itemUuid,result.model.brandMarchio,
      result.model.code,outside ? `${result.model.name} · Fuori catalogo` : result.model.name,result.model.kind,result.commercialContribution,result.model.definitionFingerprint,
      result.model.sourceRef,result.fingerprint,outside ? `${configLabel} · Fuori catalogo` : configLabel,result.status,primaryId,
      physical ? "resolved" : "not_physical",physical?.code ?? null,physical?.name ?? null,
      physical?.fitClass.code ?? null,physical?.fitClass.name ?? null,
      physical?.depthMm ?? null,physical?.outerDepthMm ?? null,
      physical?.usableDepthMm ?? null,takenAt);
  const itemId = Number(item.lastInsertRowid);
  writeEngineeringSnapshot(db,itemId,result,takenAt);
  const bomInsert = db.prepare(`INSERT INTO prj_item_bom(item_id,seq,snapshot_id,quantity_per_item,
    role,sale_price_unit_e4,price_locked) VALUES (?,?,?,?,?,?,0)`);
  articles.forEach(({article},index) => bomInsert.run(itemId,index,
    snapshotIds.get(article),article.quantity,
    article.roles.includes("primary") ? "primary" : article.roles.includes("accessory") ? "accessory" : "component",
    article.unitPriceE4));
  const next = db.prepare(`SELECT COALESCE(MAX(sort_order),-1)+1 AS value FROM prj_line WHERE group_id=1`)
    .get() as {value:number};
  db.prepare(`INSERT INTO prj_line(uuid,group_id,sort_order,line_type,item_id,quantity,
    sale_price_unit_e4,line_total_e4) VALUES (?,1,?,'item',?,?,?,?)`)
    .run(randomUUID(),next.value,itemId,quantity,result.totalE4,lineTotal);
  return itemUuid;
}

export function configuredItemCanBeDuplicated(status: string): boolean {
  return status === "complete" || status === "bom_incomplete";
}

/** A separate project row copies the saved per-unit snapshot. No catalogue lookup or placement is involved. */
export function duplicateConfiguredItem(db: Database.Database, lineUuid: string): string {
  const source = db.prepare(`SELECT l.id AS lineId,l.item_id AS itemId,l.group_id AS groupId,
    l.sale_price_unit_e4 AS unitPrice,i.config_status AS configStatus
    FROM prj_line l JOIN prj_item i ON i.id=l.item_id
    WHERE l.uuid=? AND l.line_type='item'`).get(lineUuid) as
      {lineId:number;itemId:number;groupId:number;unitPrice:number|null;configStatus:string}|undefined;
  if (!source || !configuredItemCanBeDuplicated(source.configStatus)) throw new Error("Configurazione da duplicare non disponibile.");
  const reviewedColumns = {
    prj_item: ["id","uuid","model_brand_marchio","model_code","model_name","model_kind",
      "model_definition_fingerprint","model_source_ref","config_fingerprint","config_label",
      "config_status","primary_snapshot_id","phys_status","profile_code","profile_name",
      "fit_class_code","depth_mm","outer_depth_mm","usable_depth_mm","snapshot_taken_at",
      "fit_class_label","context_policy","commercial_contribution",
      "engineering_provenance","source_adapter_code","source_adapter_version","source_import_fingerprint","mounting_json"],
    prj_line: ["id","uuid","group_id","sort_order","line_type","snapshot_id","item_id",
      "description_override","quantity","purchase_discount_chain","purchase_discount_bp",
      "net_cost_unit_e4","markup_bp","sale_price_unit_e4","line_discount_bp",
      "line_total_e4","price_locked"],
  } as const;
  for (const [table, expected] of Object.entries(reviewedColumns)) {
    const actual = (db.pragma(`table_info(${table})`) as {name:string}[]).map(row => row.name);
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(`Il formato di ${table} richiede una revisione della duplicazione.`);
  }
  const columns = (table: string, excluded: readonly string[]) =>
    (db.pragma(`table_info(${table})`) as {name:string}[]).map(row => row.name)
      .filter(name => !excluded.includes(name));
  const quoted = (name: string) => `"${name.replaceAll('"','""')}"`;
  const itemUuid = randomUUID();
  const item = db.prepare(`INSERT INTO prj_item (uuid,model_brand_marchio,model_code,model_name,
    model_kind,commercial_contribution,model_definition_fingerprint,model_source_ref,config_fingerprint,config_label,
    config_status,primary_snapshot_id,phys_status,profile_code,profile_name,fit_class_code,
    depth_mm,outer_depth_mm,usable_depth_mm,snapshot_taken_at,fit_class_label,context_policy,engineering_provenance,source_adapter_code,source_adapter_version,source_import_fingerprint,mounting_json)
    SELECT ?,model_brand_marchio,model_code,model_name,model_kind,commercial_contribution,model_definition_fingerprint,
      model_source_ref,config_fingerprint,config_label,config_status,primary_snapshot_id,
      phys_status,profile_code,profile_name,fit_class_code,depth_mm,outer_depth_mm,usable_depth_mm,
      snapshot_taken_at,fit_class_label,context_policy,engineering_provenance,source_adapter_code,source_adapter_version,source_import_fingerprint,mounting_json FROM prj_item WHERE id=?`)
    .run(itemUuid,source.itemId);
  const itemId = Number(item.lastInsertRowid);
  // Keep this explicit list in parent-before-child order; newly introduced snapshot tables require review.
  const children = ["prj_item_selection","prj_item_bom","prj_item_demand","prj_item_view",
    "prj_item_zone","prj_item_zone_slot","prj_item_constraint","prj_item_exclusion","prj_item_context"];
  const actual = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'prj_item_%'`)
    .all() as {name:string}[];
  if (actual.some(row => !children.includes(row.name)))
    throw new Error("Il formato dei dati configurati richiede una revisione della duplicazione.");
  for (const table of children) {
    const fields = columns(table,["id","item_id"]);
    db.prepare(`INSERT INTO ${table} ("item_id",${fields.map(quoted).join(",")})
      SELECT ?,${fields.map(quoted).join(",")} FROM ${table} WHERE item_id=?`)
      .run(itemId,source.itemId);
  }
  const next = db.prepare(`SELECT COALESCE(MAX(sort_order),-1)+1 AS value FROM prj_line WHERE group_id=?`)
    .get(source.groupId) as {value:number};
  db.prepare(`INSERT INTO prj_line (uuid,group_id,sort_order,line_type,item_id,description_override,
    quantity,sale_price_unit_e4,line_discount_bp,line_total_e4,price_locked)
    SELECT ?,?,?,'item',?,description_override,1,sale_price_unit_e4,line_discount_bp,?,price_locked
    FROM prj_line WHERE id=?`)
    .run(randomUUID(),source.groupId,next.value,itemId,source.unitPrice,source.lineId);
  return itemUuid;
}

export function readConfiguredItems(db: Database.Database, itemId: number | null = null): ProjectConfiguredItem[] {
  const items = db.prepare(`SELECT mounting_json AS mountingJson,uuid,model_brand_marchio AS modelBrandMarchio,model_code AS modelCode,
    model_name AS modelName,model_kind AS modelKind,model_definition_fingerprint AS modelDefinitionFingerprint,
    model_source_ref AS modelSourceRef,engineering_provenance AS engineeringProvenance,
    source_adapter_code AS sourceAdapterCode,source_adapter_version AS sourceAdapterVersion,
    source_import_fingerprint AS sourceImportFingerprint,
    config_fingerprint AS configFingerprint,config_label AS configLabel,config_status AS configStatus,
    commercial_contribution AS commercialContribution,
    phys_status AS physStatus,profile_code AS profileCode,profile_name AS profileName,
    fit_class_code AS fitClassCode,fit_class_label AS fitClassLabel,
    depth_mm AS depthMm,outer_depth_mm AS outerDepthMm,
    usable_depth_mm AS usableDepthMm,id FROM prj_item
    WHERE (? IS NULL OR id=?) ORDER BY id`).all(itemId,itemId) as Array<Omit<ProjectConfiguredItem,
    "selections"|"bom"|"demands"|"views"|"zones"|"slots"|"constraints"|"exclusions"> & {id:number;mountingJson:string|null}>;
  const read = (sql:string,id:number) => db.prepare(sql).all(id);
  return items.map(({id,mountingJson,...item}) => ({...item,...(mountingJson?{mounting:parseMountingFacts(mountingJson)}:{}),
    selections:(read(`SELECT dimension_code AS dimensionCode,dimension_label AS dimensionLabel,
      value_code AS valueCode,value_label AS valueLabel,selection_source AS selectionSource,binding,
      editable_when_placed AS editableWhenPlaced,visible FROM prj_item_selection
      WHERE item_id=? ORDER BY sort_order`,id) as Array<Omit<ProjectConfiguredItem["selections"][number],"visible"|"editableWhenPlaced"> & {visible:number;editableWhenPlaced:number}>)
      .map(row => ({...row,visible:Boolean(row.visible),editableWhenPlaced:Boolean(row.editableWhenPlaced)})),
    bom:read(`SELECT b.seq,s.uuid AS snapshotUuid,s.brand_marchio AS brandMarchio,
      s.manufacturer_code AS manufacturerCode,COALESCE(s.description,s.short_description) AS description,
      b.quantity_per_item AS quantityPerItem,b.role,s.list_price_unit_e4 AS listPriceUnitE4,
      b.sale_price_unit_e4 AS salePriceUnitE4,b.line_discount_bp AS lineDiscountBp FROM prj_item_bom b
      JOIN prj_product_snapshot s ON s.id=b.snapshot_id WHERE b.item_id=? ORDER BY b.seq`,id) as ProjectConfiguredItem["bom"],
    demands:read(`SELECT capacity_kind_code AS capacityKindCode,capacity_kind_label AS capacityKindLabel,
      amount,display_divisor AS displayDivisor,nominal_pitch_mm AS nominalPitchMm
      FROM prj_item_demand WHERE item_id=? ORDER BY capacity_kind_code`,id) as ProjectConfiguredItem["demands"],
    views:read(`SELECT view_code AS viewCode,width_mm AS widthMm,height_mm AS heightMm,
      insert_dx_mm AS insertDxMm,insert_dy_mm AS insertDyMm,symbol_kind AS symbolKind,
      asset_key AS assetKey,asset_sha256 AS assetSha256 FROM prj_item_view
      WHERE item_id=? ORDER BY view_code`,id) as ProjectConfiguredItem["views"],
    zones:(read(`SELECT mounting_json AS mountingJson,zone_no AS zoneNo,layout,capacity_kind_code AS capacityKindCode,
      capacity_kind_label AS capacityKindLabel,display_divisor AS displayDivisor,
      nominal_pitch_mm AS nominalPitchMm,capacity_amount AS capacityAmount,
      origin_x_mm AS originXMm,origin_y_mm AS originYMm,
      length_mm AS lengthMm,breadth_mm AS breadthMm,direction,pitch_mm AS pitchMm,
      required_view_code AS requiredViewCode FROM prj_item_zone WHERE item_id=? ORDER BY zone_no`,id) as Array<ProjectConfiguredItem["zones"][number]&{mountingJson:string|null}>).map(({mountingJson,...zone})=>({...zone,...(mountingJson?{mounting:parseMountingFacts(mountingJson)}:{})})),
    slots:read(`SELECT zone_no AS zoneNo,slot_no AS slotNo,x_mm AS xMm,y_mm AS yMm
      FROM prj_item_zone_slot WHERE item_id=? ORDER BY zone_no,slot_no`,id) as ProjectConfiguredItem["slots"],
    constraints:read(`SELECT relation,set_no AS setNo,class_code AS classCode
      FROM prj_item_constraint WHERE item_id=? ORDER BY relation,set_no,class_code`,id) as ProjectConfiguredItem["constraints"],
    exclusions:read(`SELECT own_dimension_code AS ownDimensionCode,own_value_code AS ownValueCode,
      ancestor_dimension_code AS ancestorDimensionCode,ancestor_value_code AS ancestorValueCode
      FROM prj_item_exclusion WHERE item_id=?`,id) as ProjectConfiguredItem["exclusions"],
  }));
}

export function readDistinta(db: Database.Database): ProjectDistintaRow[] {
  const rows = db.prepare(`SELECT s.uuid AS snapshotUuid,s.brand_marchio AS brandMarchio,
    s.manufacturer_code AS manufacturerCode,COALESCE(s.description,s.short_description) AS description,
    s.unit_of_measure AS unitOfMeasure,s.list_price_unit_e4 AS listPriceUnitE4,
    SUM(source.quantity) AS quantity FROM (
      SELECT snapshot_id,quantity FROM prj_line WHERE line_type='product'
      UNION ALL
      SELECT b.snapshot_id,b.quantity_per_item*l.quantity AS quantity FROM prj_item_bom b
      JOIN prj_line l ON l.item_id=b.item_id WHERE l.line_type='item'
    ) source JOIN prj_product_snapshot s ON s.id=source.snapshot_id
    GROUP BY s.id ORDER BY s.brand_marchio,s.manufacturer_code`).all() as
    Array<Omit<ProjectDistintaRow,"listTotalE4">>;
  return rows.map(row => {
    if (row.listPriceUnitE4 === null) return {...row,listTotalE4:null};
    const listTotalE4 = row.listPriceUnitE4 * row.quantity;
    if (!Number.isSafeInteger(listTotalE4)) {
      throw new Error("Il totale di listino della distinta supera l'intervallo numerico supportato.");
    }
    return {...row,listTotalE4};
  });
}

export function writeEngineeringProvenance(db:Database.Database,itemId:number,provenance:ConfigurationResult["provenance"]):void {
  db.prepare(`UPDATE prj_item SET engineering_provenance=?,source_adapter_code=?,source_adapter_version=?,
    source_import_fingerprint=? WHERE id=?`).run(provenance?.kind??null,
    provenance?.kind==="import"?provenance.adapterCode:null,
    provenance?.kind==="import"?provenance.adapterVersion:null,
    provenance?.kind==="import"?provenance.importFingerprint:null,itemId);
}

/** Shared initial-insert/refresh serialization. Caller owns the transaction; commercial rows and nodes are never written. */
export function writeEngineeringSnapshot(db:Database.Database,itemId:number,result:ConfigurationResult,takenAt:string):void {
  const outside=db.prepare("SELECT config_status FROM prj_item WHERE id=?").pluck().get(itemId)==="bom_incomplete";
  const physical=result.physical;
  db.prepare("UPDATE prj_item SET mounting_json=? WHERE id=?").run(physical?.mounting?JSON.stringify(parseMountingFacts(physical.mounting)):null,itemId);
  const selected=new Set(result.selectedOptionIds), defaulted=new Set(result.defaultedOptionIds);
  const selections=result.model.axes.flatMap(axis=>axis.options.filter(option=>selected.has(option.id)).map(option=>({axis,option})));
  const sources=new Map((db.prepare("SELECT dimension_code,selection_source FROM prj_item_selection WHERE item_id=?").all(itemId) as
    {dimension_code:string;selection_source:string}[]).map(row=>[row.dimension_code,row.selection_source]));
  const assets=db.prepare("SELECT view_code,asset_key,asset_sha256 FROM prj_item_view WHERE item_id=?").all(itemId) as
    {view_code:string;asset_key:string|null;asset_sha256:string|null}[];
  const configLabel=[result.model.name,...selections.filter(({axis,option})=>axis.visibility==="visible"&&option.visible).map(({option})=>option.label)].join(" · ");
  db.prepare(`UPDATE prj_item SET model_name=?,model_definition_fingerprint=?,model_source_ref=?,config_fingerprint=?,
    config_label=?,phys_status=?,profile_code=?,profile_name=?,fit_class_code=?,fit_class_label=?,depth_mm=?,
    outer_depth_mm=?,usable_depth_mm=?,context_policy=NULL,snapshot_taken_at=? WHERE id=?`).run(
    outside ? `${result.model.name} · Fuori catalogo` : result.model.name,result.model.definitionFingerprint,result.model.sourceRef,result.fingerprint,
    outside ? `${configLabel} · Fuori catalogo` : configLabel,
    physical?"resolved":"not_physical",physical?.code??null,physical?.name??null,physical?.fitClass.code??null,
    physical?.fitClass.name??null,physical?.depthMm??null,physical?.outerDepthMm??null,physical?.usableDepthMm??null,takenAt,itemId);
  for(const table of ["prj_item_selection","prj_item_zone_slot","prj_item_zone","prj_item_demand","prj_item_view",
    "prj_item_constraint","prj_item_exclusion","prj_item_context"])db.prepare(`DELETE FROM ${table} WHERE item_id=?`).run(itemId);
  writeEngineeringProvenance(db,itemId,result.provenance);
  const selectionInsert = db.prepare(`INSERT INTO prj_item_selection(item_id,sort_order,dimension_code,
    dimension_label,value_code,value_label,selection_source,binding,editable_when_placed,visible)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  selections.forEach(({axis,option},index) => selectionInsert.run(itemId,index,axis.dimensionCode,
    axis.label,option.valueCode,option.label,sources.get(axis.dimensionCode) ?? (defaulted.has(option.id) ? "default" : "user"),
    axis.binding,Number(axis.editableWhenPlaced),Number(axis.visibility === "visible" && option.visible)));
  if (physical) {
    const demandInsert = db.prepare(`INSERT INTO prj_item_demand(item_id,capacity_kind_code,
      capacity_kind_label,amount,display_divisor,nominal_pitch_mm) VALUES (?,?,?,?,?,?)`);
    for (const demand of physical.demands) demandInsert.run(itemId,demand.capacityKindCode,
      demand.unitLabel,demand.amount,demand.displayDivisor,demand.nominalPitchMm);
    const viewInsert = db.prepare(`INSERT INTO prj_item_view(item_id,view_code,width_mm,height_mm,
      insert_dx_mm,insert_dy_mm,symbol_kind,asset_key) VALUES (?,?,?,?,?,?,?,?)`);
    for (const view of physical.views) viewInsert.run(itemId,view.code,view.widthMm,view.heightMm,
      view.insertDxMm,view.insertDyMm,view.symbolKind,view.assetKey);
    const zoneInsert = db.prepare(`INSERT INTO prj_item_zone(item_id,zone_no,layout,capacity_kind_code,
      capacity_kind_label,display_divisor,nominal_pitch_mm,capacity_amount,
      origin_x_mm,origin_y_mm,length_mm,breadth_mm,direction,pitch_mm,required_view_code)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const zone of physical.zones) {zoneInsert.run(itemId,zone.zoneNo,zone.layout,
      zone.capacityKindCode,zone.capacityKindLabel ?? null,zone.displayDivisor ?? null,
      zone.nominalPitchMm ?? null,zone.capacityAmount,zone.originXMm,zone.originYMm,zone.lengthMm,
      zone.breadthMm,zone.direction,zone.pitchMm,zone.requiredViewCode);
      db.prepare("UPDATE prj_item_zone SET mounting_json=? WHERE item_id=? AND zone_no=?").run(zone.mounting?JSON.stringify(parseMountingFacts(zone.mounting)):null,itemId,zone.zoneNo);}
    const slotInsert = db.prepare(`INSERT INTO prj_item_zone_slot(item_id,zone_no,slot_no,x_mm,y_mm)
      VALUES (?,?,?,?,?)`);
    for (const slot of physical.slots) slotInsert.run(itemId,slot.zoneNo,slot.slotNo,slot.xMm,slot.yMm);
    const constraintInsert = db.prepare(`INSERT INTO prj_item_constraint(item_id,relation,set_no,class_code)
      VALUES (?,?,?,?)`);
    physical.constraints.forEach((constraint,setNo) => {
      if (constraint.classCodes.length === 0) throw new Error("Insieme di compatibilità vuoto.");
      for (const classCode of constraint.classCodes) constraintInsert.run(itemId,constraint.relation,setNo,classCode);
    });
  }
  if (result.context && ["enclosure","support"].includes(result.model.kind)) writeContext(db,itemId,result.context);
  const exclusionInsert = db.prepare(`INSERT INTO prj_item_exclusion(item_id,own_dimension_code,
    own_value_code,ancestor_dimension_code,ancestor_value_code) VALUES (?,?,?,?,?)`);
  for (const exclusion of result.exclusions) exclusionInsert.run(itemId,exclusion.ownDimensionCode,
    exclusion.ownValueCode,exclusion.ancestorDimensionCode,exclusion.ancestorValueCode);

  const restore=db.prepare("UPDATE prj_item_view SET asset_sha256=? WHERE item_id=? AND view_code=? AND asset_key IS ?");
  for(const asset of assets)restore.run(asset.asset_sha256,itemId,asset.view_code,asset.asset_key);
}
