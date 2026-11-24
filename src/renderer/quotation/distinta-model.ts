import type { StatusSegment } from "../app/status.js";
import { formatMoneyE4 } from "../../shared/money.js";
import type { ProjectDistintaRow, ProjectDocumentView } from "../../shared/project.js";

/*
 * Renderer-only view model of the Distinta (docs/R17_VISUAL_DESIGN.md §4.6). Every figure comes
 * from `ProjectDocumentView`: prices and totals are the persisted `ProjectDistintaRow` values,
 * never recomputed from the catalogue and never invented.
 */

/** Codice ordering: none = the backend order (marca, codice); asc/desc = by codice. */
export type CodeOrder = "none" | "asc" | "desc";

export function nextCodeOrder(order: CodeOrder): CodeOrder {
  return order === "none" ? "asc" : order === "asc" ? "desc" : "none";
}

const collator = new Intl.Collator("it", { numeric: true, sensitivity: "base" });

/** Total order: codice, then marca, then snapshot UUID, so equal codes never reorder between renders. */
function compareCode(a: ProjectDistintaRow, b: ProjectDistintaRow): number {
  return collator.compare(a.manufacturerCode, b.manufacturerCode)
    || collator.compare(a.brandMarchio, b.brandMarchio)
    || (a.snapshotUuid < b.snapshotUuid ? -1 : a.snapshotUuid > b.snapshotUuid ? 1 : 0);
}

export function sortDistinta(rows: readonly ProjectDistintaRow[], order: CodeOrder): readonly ProjectDistintaRow[] {
  if (order === "none") return rows;
  const sorted = [...rows].sort(compareCode);
  return order === "asc" ? sorted : sorted.reverse();
}

/** Case- and accent-insensitive text used to match the filter. */
function searchable(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Rows whose marca, codice or descrizione contain every word of the query. */
export function filterDistinta(rows: readonly ProjectDistintaRow[], query: string): readonly ProjectDistintaRow[] {
  const words = searchable(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter((row) => {
    const haystack = searchable(`${row.brandMarchio} ${row.manufacturerCode} ${row.description ?? ""}`);
    return words.every((word) => haystack.includes(word));
  });
}

export interface DistintaTotals {
  readonly articles: number;
  /** Sum of the quantities of the articles sold by the piece (UM "PCE"); other units are never added in. */
  readonly pieces: number;
  /** Articles counted in `pieces`. */
  readonly pieceArticles: number;
  /** Articles whose unit is not a piece or is missing: their quantities cannot be added to pieces. */
  readonly otherUnitArticles: number;
  readonly priced: number;
  readonly unpriced: number;
  /**
   * Sum of the persisted row totals of the priced articles. Null when no article has a price (a
   * total of nothing is not 0,00 €) or when the sum leaves the safe integer range; an empty
   * Distinta totals 0.
   */
  readonly totalE4: number | null;
}

/** METEL sells by "PCE" (pezzo), "LM" (metro lineare) or "BRD"; only PCE is provably a piece count. */
export function isPieceUnit(unit: string | null): boolean {
  return unit !== null && unit.trim().toUpperCase() === "PCE";
}

/**
 * The quantity total of a set of rows, only when it is meaningful: every row has the same unit of
 * measure. Rows in different units, or without one, have no additive total (null).
 */
export function commonUnitQuantity(rows: readonly ProjectDistintaRow[]): { readonly quantity: number; readonly unit: string } | null {
  const first = rows[0]?.unitOfMeasure?.trim().toUpperCase();
  if (!first || rows.some((row) => row.unitOfMeasure?.trim().toUpperCase() !== first)) return null;
  return { quantity: rows.reduce((sum, row) => sum + row.quantity, 0), unit: first };
}

export function distintaTotals(rows: readonly ProjectDistintaRow[]): DistintaTotals {
  let pieces = 0;
  let pieceArticles = 0;
  let priced = 0;
  let totalE4 = 0;
  for (const row of rows) {
    if (isPieceUnit(row.unitOfMeasure)) { pieces += row.quantity; pieceArticles++; }
    if (row.listTotalE4 === null) continue;
    priced++;
    totalE4 += row.listTotalE4;
  }
  const valid = Number.isSafeInteger(totalE4) && (priced > 0 || rows.length === 0);
  return { articles: rows.length, pieces, pieceArticles, otherUnitArticles: rows.length - pieceArticles, priced, unpriced: rows.length - priced, totalE4: valid ? totalE4 : null };
}

export function formatListTotal(totalE4: number | null): string {
  return totalE4 === null ? "Non disponibile" : formatMoneyE4(totalE4, "EUR");
}

export function articlesLabel(count: number): string {
  return `${count} ${count === 1 ? "articolo" : "articoli"}`;
}
/** Why a total is partial: the articles without a price of listino are left out of it. */
export function unpricedExcludedText(count: number): string {
  return count === 1 ? "1 articolo senza prezzo di listino non è compreso nel totale"
    : `${count} articoli senza prezzo di listino non sono compresi nel totale`;
}
export function piecesLabel(count: number): string {
  return `${count} ${count === 1 ? "pezzo" : "pezzi"}`;
}

/**
 * The piece part of "N articoli · M pezzi": all articles in pieces → "M pezzi"; some in other
 * units → "M pezzi + altre UM" (M counts only the piece articles); none in pieces → "altre UM".
 * An empty Distinta counts 0 pieces.
 */
export function piecesSummary(totals: DistintaTotals): string {
  if (totals.otherUnitArticles === 0) return piecesLabel(totals.pieces);
  return totals.pieceArticles === 0 ? "quantità in altre UM" : `${piecesLabel(totals.pieces)} + altre UM`;
}
export const OTHER_UNITS_TITLE = "Solo gli articoli in PCE sono contati come pezzi; le quantità in altre unità di misura (o senza UM) non si sommano ai pezzi";

/** How one Distinta article is made up, as far as the loaded project can prove. */
export type RowOrigin = "ordinary" | "configured" | "mixed" | "unverified";

export interface DistintaOrigins {
  /** `project.lines`: righe preventivo by type. */
  readonly lines: { readonly total: number; readonly ordinary: number; readonly configured: number };
  /** Distinta articles by origin. */
  readonly articles: Readonly<Record<RowOrigin, number>>;
  readonly byRow: ReadonlyMap<string, RowOrigin>;
}

/**
 * The backend builds each Distinta row as the grouped sum, per article snapshot, of
 * (a) ordinary product lines (`prj_line.line_type = 'product'`, quantity) and
 * (b) configured-item BOM entries × the item line's quantity. The view carries both inputs:
 * product lines expose `snapshotUuid` (the same snapshot UUID as the Distinta row) and each
 * configured item exposes its BOM by snapshot UUID and `quantityPerItem`. The renderer re-adds
 * the two contributions per article and classifies the row only when they reproduce the row's
 * quantity exactly: only ordinary, only configured, or both. Any row they do not explain is
 * `unverified`; nothing else (roles, placement, prices) is used.
 */
export function distintaOrigins(project: Pick<ProjectDocumentView, "lines" | "configuredItems" | "distinta">): DistintaOrigins {
  const ordinaryBySnapshot = new Map<string, number>();
  const configuredBySnapshot = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, amount: number) => map.set(key, (map.get(key) ?? 0) + amount);
  const itemsByUuid = new Map(project.configuredItems.map((item) => [item.uuid, item]));
  let ordinaryLines = 0;
  let configuredLines = 0;
  for (const line of project.lines) {
    if (line.lineType === "product") {
      ordinaryLines++;
      if (line.snapshotUuid !== null) add(ordinaryBySnapshot, line.snapshotUuid, line.quantity);
      continue;
    }
    configuredLines++;
    const item = line.itemUuid === null ? undefined : itemsByUuid.get(line.itemUuid);
    for (const entry of item?.bom ?? []) add(configuredBySnapshot, entry.snapshotUuid, entry.quantityPerItem * line.quantity);
  }
  const articles: Record<RowOrigin, number> = { ordinary: 0, configured: 0, mixed: 0, unverified: 0 };
  const byRow = new Map<string, RowOrigin>();
  for (const row of project.distinta) {
    const ordinary = ordinaryBySnapshot.get(row.snapshotUuid) ?? 0;
    const configured = configuredBySnapshot.get(row.snapshotUuid) ?? 0;
    const origin: RowOrigin = ordinary + configured !== row.quantity || ordinary + configured === 0 ? "unverified"
      : configured === 0 ? "ordinary" : ordinary === 0 ? "configured" : "mixed";
    articles[origin]++;
    byRow.set(row.snapshotUuid, origin);
  }
  return { lines: { total: project.lines.length, ordinary: ordinaryLines, configured: configuredLines }, articles, byRow };
}

/** Distinta-only status segments; the current listino segments are appended by the status bar itself. */
export function distintaStatusSegments(totals: DistintaTotals): StatusSegment[] {
  const partial = totals.unpriced > 0 && totals.priced > 0;
  return [
    { id: "articles", label: "Articoli:", value: String(totals.articles) },
    ...(totals.otherUnitArticles > 0 && totals.pieceArticles === 0 ? [] : [{ id: "pieces", label: "Pezzi:", value: String(totals.pieces),
      ...(totals.otherUnitArticles > 0 ? { unit: "+ altre UM", title: OTHER_UNITS_TITLE } : {}) }]),
    { id: "total", label: "Totale di listino:", value: formatListTotal(totals.totalE4),
      ...(partial ? { unit: "parziale", title: unpricedExcludedText(totals.unpriced) } : {}) },
  ];
}
