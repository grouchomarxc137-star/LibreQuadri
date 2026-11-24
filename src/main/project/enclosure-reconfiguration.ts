import type Database from "better-sqlite3";
import type { ConfigurationRequest, ConfigurationResult } from "../../shared/configuration.js";
import type { CatalogueProductSnapshotSource } from "../../shared/project.js";
import type { EngineeringIssue } from "../../shared/project-engineering.js";
import { grossAmountE4 } from "../../shared/commercial.js";
import { resolveEngineeringRefresh, bomRole } from "../catalogue/engineering-refresh-resolver.js";
import { duplicateConfiguredItem, engineeringSnapshotDiff, ensureConfiguredProductSnapshot,
  readConfiguredItems, removeUnusedProductSnapshots, writeEngineeringSnapshot } from "./configured-items.js";
import { itemEngineeringState, projectEngineeringChainStale } from "./engineering-status.js";
import { assessProjectPhysical, readPhysicalNodes } from "./physical-placement.js";

export class EnclosureReconfigurationError extends Error {
  constructor(readonly code: string, message: string, readonly diagnostics: EngineeringIssue[] = []) {
    super(message); this.name = "EnclosureReconfigurationError";
  }
}
function refuse(code: string, message: string): never { throw new EnclosureReconfigurationError(code,message); }
const articleKey = (brand: string | null, code: string | null) => JSON.stringify([brand,code]);

/** Caller owns both the project write transaction and a consistent catalogue read transaction. */
export function reconfigureEnclosure(project: Database.Database, catalogue: Database.Database,
  nodeUuid: string, request: ConfigurationRequest, resolve: (request: ConfigurationRequest) => ConfigurationResult,
  productSource: (id: number) => CatalogueProductSnapshotSource, takenAt: string): boolean {
  const target = project.prepare(`SELECT n.id,n.item_id AS itemId,n.node_kind AS kind,n.parent_id AS parentId,
    l.uuid AS lineUuid,l.quantity,l.sale_price_unit_e4 AS unitPrice FROM prj_node n
    JOIN prj_line l ON l.item_id=n.item_id WHERE n.uuid=?`).get(nodeUuid) as
    {id:number;itemId:number;kind:string;parentId:number|null;lineUuid:string;quantity:number;unitPrice:number|null}|undefined;
  if (!target || target.kind !== "enclosure" || target.parentId !== null)
    refuse("invalid_enclosure","Seleziona una carpenteria fisica del progetto.");
  const stored = readConfiguredItems(project,target.itemId)[0]!;
  const nodes = readPhysicalNodes(project);
  const root = nodes.find(node => node.uuid === nodeUuid)!;
  const affected = new Set<string>();
  const positions = new Map<string,string>();
  const visit = (list: typeof nodes) => { for (const node of list) {
    affected.add(node.uuid); positions.set(node.uuid,JSON.stringify([node.xMm,node.yMm])); visit(node.children);
  } };
  visit([root]);
  const items = readConfiguredItems(project);
  for (const uuid of affected) {
    if (projectEngineeringChainStale(project,uuid))
      refuse("project_engineering_stale","Aggiorna i dati di ingegneria del progetto.");
  }
  const affectedItemIds = project.prepare(`WITH RECURSIVE subtree(id,item_id) AS (
    SELECT id,item_id FROM prj_node WHERE id=? UNION ALL
    SELECT n.id,n.item_id FROM prj_node n JOIN subtree s ON n.parent_id=s.id)
    SELECT DISTINCT i.uuid FROM prj_item i JOIN subtree s ON s.item_id=i.id`).pluck().all(target.id) as string[];
  for (const item of items.filter(item => affectedItemIds.includes(item.uuid))) {
    const state = itemEngineeringState(item,catalogue);
    if (state === "catalogue_stale")
      refuse("engineering_data_stale","I dati di ingegneria sono obsoleti: reimporta il catalogo.");
    if (state === "catalogue_unavailable")
      refuse("catalogue_unavailable","Importa il catalogo di ingegneria richiesto dalla carpenteria.");
    if (!["current_generation","manual","unknown"].includes(state))
      refuse("project_engineering_stale",`Aggiorna i dati di ingegneria del progetto: ${item.modelName} (${state}).`);
  }
  // Prove the old interpretation before changing options; reconfiguration is never an implicit refresh.
  const baseline = resolveEngineeringRefresh(catalogue,stored);
  if (!baseline.ok) {
    if (baseline.code === "catalogue_stale") refuse("engineering_data_stale","I dati di ingegneria sono obsoleti: reimporta il catalogo.");
    refuse("project_engineering_stale",`Verifica i dati di ingegneria di ${stored.modelName}: ${baseline.code}.`);
  }
  if (engineeringSnapshotDiff({...baseline.result,status:stored.configStatus as ConfigurationResult["status"]},stored).length ||
    !sameContext(project,target.itemId,baseline.result))
    refuse("project_engineering_stale","Aggiorna i dati di ingegneria del progetto prima di modificare la carpenteria.");
  const result = resolve(request);
  if (result.model.kind !== "enclosure" || result.model.brandMarchio !== stored.modelBrandMarchio ||
    result.model.code !== stored.modelCode)
    refuse("model_replacement_unsupported","La sostituzione del modello di carpenteria non è supportata.");
  if (!result.model.active || result.model.obsolete || !result.fingerprint || !result.physical ||
    result.physical.kind !== "enclosure" || !["complete","price_incomplete"].includes(result.status) ||
    result.issues.some(issue => issue.severity === "error" && issue.code !== "missing_price") ||
    result.commercialContribution !== stored.commercialContribution ||
    result.commercialContribution !== result.model.commercialContribution || result.context?.policy === "unknown")
    refuse("configuration_unavailable","La nuova configurazione deve avere distinta, profilo e contesto verificabili.");
  if (JSON.stringify(result.provenance) !== JSON.stringify(baseline.result.provenance))
    refuse("catalogue_changed","Il catalogo è cambiato: risolvi nuovamente la configurazione.");
  const changed = result.model.axes.filter(axis => {
    const before = stored.selections.find(selection => selection.dimensionCode === axis.dimensionCode);
    const after = axis.options.find(option => result.selectedOptionIds.includes(option.id));
    return (before?.valueCode ?? null) !== (after?.valueCode ?? null);
  });
  for (const axis of changed) {
    const saved = baseline.result.model.axes.find(old => old.dimensionCode === axis.dimensionCode);
    if (!axis.editableWhenPlaced || !saved?.editableWhenPlaced)
      refuse("axis_not_editable",`La caratteristica «${axis.label}» non è modificabile dopo il posizionamento.`);
  }
  if ([result.physical.depthMm,result.physical.outerDepthMm,result.physical.usableDepthMm].some((value,index) =>
    value !== [stored.depthMm,stored.outerDepthMm,stored.usableDepthMm][index]))
    refuse("depth_replacement_unsupported","La sostituzione della profondità della carpenteria non è supportata.");
  if (!changed.length) return false;

  const oldBom = project.prepare(`SELECT b.*,s.brand_marchio AS brand,s.manufacturer_code AS code
    FROM prj_item_bom b JOIN prj_product_snapshot s ON s.id=b.snapshot_id WHERE b.item_id=? ORDER BY b.seq`)
    .all(target.itemId) as Array<{id:number;seq:number;snapshot_id:number;brand:string;code:string;role:string;
      sale_price_unit_e4:number|null}>;
  const previousPrimary = project.prepare("SELECT primary_snapshot_id FROM prj_item WHERE id=?")
    .pluck().get(target.itemId) as number|null;
  const snapshotCandidates = oldBom.map(row => row.snapshot_id);
  if (previousPrimary !== null) snapshotCandidates.push(previousPrimary);
  const commerce = result.bom.map(article => {
    if (!article.linkedBrandMarchio || !article.linkedManufacturerCode || article.productId === null ||
      !Number.isFinite(article.quantity) || article.quantity <= 0)
      return refuse("bom_unverifiable","La distinta contiene un articolo non verificabile.");
    const retained = oldBom.filter(row => articleKey(row.brand,row.code) ===
      articleKey(article.linkedBrandMarchio,article.linkedManufacturerCode));
    if (retained.length > 1)
      return refuse("price_snapshot_conflict",`Rivedi il preventivo: prezzi non univoci per ${article.linkedBrandMarchio}/${article.linkedManufacturerCode}.`);
    const previous = retained[0];
    if (previous) {
      if (previous.sale_price_unit_e4 === null)
        return refuse("price_snapshot_conflict",`Prezzo storico mancante per ${previous.brand}/${previous.code}: rivedi il preventivo.`);
      return {article,previous,source:null,price:previous.sale_price_unit_e4,role:bomRole(article.roles)};
    }
    const source = productSource(article.productId);
    if (article.unitPriceE4 === null)
      return refuse("catalogue_changed",`Prezzo corrente mancante per ${article.linkedManufacturerCode}: importa un listino con il prezzo prima di riprovare.`);
    if (article.currency !== "EUR" ||
      source.brandMarchio !== article.linkedBrandMarchio || source.manufacturerCode !== article.linkedManufacturerCode ||
      source.listPriceUnitE4 !== article.unitPriceE4 || source.priceIssuerSigla !== article.priceIssuerSigla ||
      source.priceListinoNumber !== article.priceListinoNumber || source.priceValidFrom !== article.priceValidFrom ||
      source.priceMultiplierOriginal !== article.priceMultiplierOriginal)
      return refuse("catalogue_changed",`Prezzo corrente non verificabile per ${article.linkedManufacturerCode}: risolvi nuovamente la configurazione.`);
    return {article,previous:undefined,source,price:article.unitPriceE4,role:bomRole(article.roles)};
  });
  if (stored.commercialContribution === "none" && commerce.length)
    refuse("bom_unverifiable","Una configurazione fisica senza contributo commerciale non può avere articoli.");
  if (stored.commercialContribution === "articles" && !commerce.length)
    refuse("bom_unverifiable","La distinta della carpenteria è vuota.");
  const total = stored.commercialContribution === "none" ? null : commerce.reduce((sum,row) =>
    sum + grossAmountE4(row.price,row.article.quantity),0);
  if (total !== null && !Number.isSafeInteger(total)) refuse("price_overflow","Il totale supera l'intervallo monetario supportato.");

  let itemId = target.itemId;
  if (target.quantity > 1) {
    const itemUuid = duplicateConfiguredItem(project,target.lineUuid);
    itemId = project.prepare("SELECT id FROM prj_item WHERE uuid=?").pluck().get(itemUuid) as number;
    project.prepare("UPDATE prj_line SET quantity=quantity-1,line_total_e4=? WHERE uuid=?")
      .run(target.unitPrice === null ? null : grossAmountE4(target.unitPrice,target.quantity-1),target.lineUuid);
    // This is the only node write: one unit changes configuration, every identity/position stays.
    project.prepare("UPDATE prj_node SET item_id=? WHERE id=?").run(itemId,target.id);
  }
  writeEngineeringSnapshot(project,itemId,result,takenAt);
  const selectionSource = project.prepare("UPDATE prj_item_selection SET selection_source=? WHERE item_id=? AND dimension_code=?");
  for (const axis of changed) {
    const selected = axis.options.find(option => result.selectedOptionIds.includes(option.id));
    selectionSource.run(selected && result.defaultedOptionIds.includes(selected.id) ? "default" : "user",itemId,axis.dimensionCode);
  }
  const rows = project.prepare("SELECT id,seq FROM prj_item_bom WHERE item_id=?").all(itemId) as {id:number;seq:number}[];
  project.prepare("UPDATE prj_item_bom SET seq=-seq-1 WHERE item_id=?").run(itemId);
  const keep = new Set<number>();
  let primaryId: number|null = null;
  commerce.forEach((row,seq) => {
    let snapshotId = row.previous?.snapshot_id;
    if (row.source) {
      snapshotId = ensureConfiguredProductSnapshot(project,row.source,takenAt);
    }
    const retainedRow = row.previous?.role === row.role ? rows.find(old => old.seq === row.previous!.seq) : undefined;
    if (retainedRow) {
      keep.add(retainedRow.id);
      project.prepare("UPDATE prj_item_bom SET seq=?,quantity_per_item=? WHERE id=?").run(seq,row.article.quantity,retainedRow.id);
    } else {
      project.prepare(`INSERT INTO prj_item_bom(item_id,seq,snapshot_id,quantity_per_item,role,sale_price_unit_e4)
        VALUES (?,?,?,?,?,?)`).run(itemId,seq,snapshotId!,row.article.quantity,row.role,row.price);
    }
    if (row.role === "primary" && primaryId === null) primaryId = snapshotId!;
  });
  for (const row of rows) if (!keep.has(row.id)) project.prepare("DELETE FROM prj_item_bom WHERE id=?").run(row.id);
  project.prepare("UPDATE prj_item SET primary_snapshot_id=?,config_status='complete' WHERE id=?").run(primaryId,itemId);
  project.prepare("UPDATE prj_line SET sale_price_unit_e4=?,line_total_e4=? WHERE item_id=?").run(total,total,itemId);
  removeUnusedProductSnapshots(project,snapshotCandidates);
  const issues = assessProjectPhysical(project).filter(issue => issue.nodeUuid === null || affected.has(issue.nodeUuid));
  if (issues.length) throw new EnclosureReconfigurationError("incompatible_subtree",
    `Configurazione incompatibile: ${issues.map(issue => `${issue.nodeUuid ?? nodeUuid}: ${issue.message}`).join(" ")}`,issues);
  const verifyPositions = (list: typeof nodes) => { for (const node of list) {
    if (positions.has(node.uuid) && positions.get(node.uuid) !== JSON.stringify([node.xMm,node.yMm]))
      refuse("position_changed",`La configurazione sposterebbe ${node.uuid}: scegli opzioni che mantengano le posizioni dei componenti.`);
    verifyPositions(node.children);
  } };
  verifyPositions(readPhysicalNodes(project));
  return true;
}

function sameContext(project: Database.Database, itemId: number, result: ConfigurationResult): boolean {
  const policy = project.prepare("SELECT context_policy FROM prj_item WHERE id=?").pluck().get(itemId);
  const contexts = project.prepare("SELECT role,context_code FROM prj_item_context WHERE item_id=? ORDER BY context_code").raw().all(itemId);
  const incoming = (result.context?.codes ?? []).map(code => [result.context!.role,code]);
  return policy === (result.context?.policy ?? null) && JSON.stringify(contexts) === JSON.stringify(incoming);
}
