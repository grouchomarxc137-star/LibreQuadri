import type Database from "better-sqlite3";
import { grossAmountE4 } from "../../shared/commercial.js";
import { getCatalogueProductSnapshot } from "../catalogue/catalogue-queries.js";

type Price = number | null;
type Component = { snapshotId: number; quantity: number; price: Price };
type ItemLine = { id: number; itemId: number; quantity: number; price: Price; overridden: number };

function itemPrice(components: readonly Component[]): Price {
  if (components.some(component => component.price === null)) return null;
  const total = components.reduce((sum, component) =>
    sum + BigInt(grossAmountE4(component.price!, component.quantity)), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Totale della configurazione fuori intervallo.");
  return Number(total);
}

/** Runs inside a project write transaction and one consistent catalogue read snapshot. */
export function repriceProject(project: Database.Database, catalogue: Database.Database,
  suspectSnapshots: ReadonlySet<string>): number {
  const snapshots = project.prepare(`SELECT id, uuid, brand_marchio AS brand, manufacturer_code AS code,
    unit_of_measure AS unit, list_price_unit_e4 AS price FROM prj_product_snapshot s
    WHERE (EXISTS (SELECT 1 FROM prj_line WHERE snapshot_id=s.id AND line_type='product')
      OR EXISTS (SELECT 1 FROM prj_item_bom WHERE snapshot_id=s.id))
    AND NOT EXISTS (SELECT 1 FROM prj_line WHERE snapshot_id=s.id AND
      (line_type<>'product' OR price_locked=1 OR sale_price_unit_e4 IS NOT s.list_price_unit_e4
        OR net_cost_unit_e4 IS NOT NULL OR markup_bp IS NOT NULL))
    AND NOT EXISTS (SELECT 1 FROM prj_item_bom WHERE snapshot_id=s.id AND
      (price_locked=1 OR sale_price_unit_e4 IS NOT s.list_price_unit_e4
        OR net_cost_unit_e4 IS NOT NULL OR markup_bp IS NOT NULL))`)
    .all() as { id: number; uuid: string; brand: string; code: string; unit: string | null; price: Price }[];
  const itemLines = project.prepare(`SELECT id,item_id AS itemId,quantity,sale_price_unit_e4 AS price,
    (price_locked=1 OR net_cost_unit_e4 IS NOT NULL OR markup_bp IS NOT NULL) AS overridden
    FROM prj_line WHERE line_type='item'`).all() as ItemLine[];
  const bom = project.prepare(`SELECT snapshot_id AS snapshotId,quantity_per_item AS quantity,
    sale_price_unit_e4 AS price FROM prj_item_bom WHERE item_id=? ORDER BY seq`);
  const components = new Map(itemLines.map(line => [line.itemId, bom.all(line.itemId) as Component[]]));
  const protectedSnapshots = new Set<number>();
  for (const line of itemLines) {
    const rows = components.get(line.itemId)!;
    if (line.overridden || line.price !== itemPrice(rows)) {
      for (const row of rows) protectedSnapshots.add(row.snapshotId);
    }
  }

  const lookup = catalogue.prepare(`SELECT p.id FROM cat_product p JOIN cat_brand b ON b.id=p.brand_id
    WHERE b.metel_marchio=? AND p.manufacturer_code=? AND b.active=1 AND p.import_removed=0 LIMIT 2`);
  const updateSnapshot = project.prepare(`UPDATE prj_product_snapshot SET list_price_unit_e4=?,
    price_issuer_sigla=?,price_listino_number=?,price_valid_from=?,price_multiplier_original=? WHERE id=?`);
  const updateBom = project.prepare("UPDATE prj_item_bom SET sale_price_unit_e4=? WHERE snapshot_id=?");
  const updateLine = project.prepare("UPDATE prj_line SET sale_price_unit_e4=?,line_total_e4=? WHERE id=?");
  const productLines = project.prepare("SELECT id,quantity FROM prj_line WHERE line_type='product' AND snapshot_id=?");
  const updated = new Set<number>();
  for (const snapshot of snapshots) {
    if (protectedSnapshots.has(snapshot.id) || suspectSnapshots.has(snapshot.uuid) || !snapshot.unit) continue;
    const matches = lookup.all(snapshot.brand, snapshot.code) as { id: number }[];
    if (matches.length !== 1) continue;
    const source = getCatalogueProductSnapshot(catalogue, matches[0]!.id);
    const price = source.listPriceUnitE4;
    if (price === null || price === snapshot.price || source.unitOfMeasure !== snapshot.unit || source.priceCurrency !== "EUR" ||
        !source.priceIssuerSigla || !source.priceListinoNumber || !source.priceValidFrom) continue;
    updateSnapshot.run(price, source.priceIssuerSigla, source.priceListinoNumber,
      source.priceValidFrom, source.priceMultiplierOriginal, snapshot.id);
    updateBom.run(price, snapshot.id);
    for (const line of productLines.all(snapshot.id) as { id: number; quantity: number }[])
      updateLine.run(price, grossAmountE4(price, line.quantity), line.id);
    updated.add(snapshot.id);
  }
  for (const line of itemLines) {
    if (!components.get(line.itemId)!.some(component => updated.has(component.snapshotId))) continue;
    const price = itemPrice(bom.all(line.itemId) as Component[]);
    updateLine.run(price, price === null ? null : grossAmountE4(price, line.quantity), line.id);
  }
  return updated.size;
}
