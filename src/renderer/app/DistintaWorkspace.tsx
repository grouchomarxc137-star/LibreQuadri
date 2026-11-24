import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { formatMoneyE4 } from "../../shared/money.js";
import { PROJECT_TYPES, type ProjectApi, type ProjectDistintaRow, type ProjectDocumentView } from "../../shared/project.js";
import { formatIsoDate } from "../catalogue/formatting.js";
import {
  articlesLabel, distintaOrigins, distintaStatusSegments, distintaTotals, filterDistinta, formatListTotal,
  commonUnitQuantity, isPieceUnit, nextCodeOrder, OTHER_UNITS_TITLE, piecesSummary, sortDistinta, unpricedExcludedText, type CodeOrder, type DistintaOrigins, type DistintaTotals,
} from "../quotation/distinta-model.js";
import { Icon } from "../ui/icons.js";
import { useStatusActions } from "./status.js";
import { DocumentPdfDialog } from "./DocumentPdfDialog.js";

const NO_DESCRIPTION = "Descrizione non disponibile";

function PriceCells({ row }: { readonly row: ProjectDistintaRow }) {
  if (row.listPriceUnitE4 === null || row.listTotalE4 === null) {
    return <td colSpan={2} className="numeric distinta-price-missing">
      <span className="librequadri-tag" data-tone="warn">Prezzo non disponibile</span>
    </td>;
  }
  return <>
    <td className="numeric">{formatMoneyE4(row.listPriceUnitE4, "EUR")}</td>
    <td className="numeric distinta-line-total">{formatMoneyE4(row.listTotalE4, "EUR")}</td>
  </>;
}

/** The materials table: sticky header and total row inside its own scroll area. */
export function DistintaTable({ rows, allRows, filtered, order, selectedUuid, onOrder, onSelect }: {
  /** Rows to show (filtered, sorted). */
  readonly rows: readonly ProjectDistintaRow[];
  readonly allRows: readonly ProjectDistintaRow[];
  readonly filtered: boolean;
  readonly order: CodeOrder;
  readonly selectedUuid: string | null;
  readonly onOrder: () => void;
  readonly onSelect: (snapshotUuid: string) => void;
}) {
  const shown = distintaTotals(rows);
  const shownQuantity = commonUnitQuantity(rows);
  const moveSelection = (event: KeyboardEvent<HTMLTableRowElement>, index: number) => {
    const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = rows[index + delta];
    if (!next) return;
    onSelect(next.snapshotUuid);
    (event.currentTarget.parentElement?.children[index + delta] as HTMLElement | undefined)?.focus();
  };
  // Roving tab stop: the selected row (or the first) is the one reachable with Tab.
  const stop = rows.some((row) => row.snapshotUuid === selectedUuid) ? selectedUuid : rows[0]?.snapshotUuid;
  return <div className="distinta-scroll">
    <table className="distinta-table">
      <colgroup>
        <col className="distinta-col-index" /><col className="distinta-col-brand" /><col className="distinta-col-code" />
        <col /><col className="distinta-col-um" /><col className="distinta-col-qty" />
        <col className="distinta-col-price" /><col className="distinta-col-total" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" className="numeric">#</th>
          <th scope="col" title="Marca">Marca</th>
          <th scope="col" aria-sort={order === "none" ? "none" : order === "asc" ? "ascending" : "descending"}
            data-sorted={order === "none" ? undefined : order}>
            <button type="button" className="distinta-sort" onClick={onOrder}
              title={order === "none" ? "Ordina per codice" : order === "asc" ? "Codice in ordine crescente: clic per l'ordine decrescente"
                : "Codice in ordine decrescente: clic per l'ordine originale"}>
              Codice{order === "none" ? null : <Icon name="chevronDown" className="librequadri-icon-small distinta-sort-icon" />}
            </button>
          </th>
          <th scope="col" title="Descrizione">Descrizione</th>
          <th scope="col" title="UM">UM</th>
          <th scope="col" className="numeric" title="Quantità">Quantità</th>
          <th scope="col" className="numeric" title="Prezzo di listino">Prezzo di listino</th>
          <th scope="col" className="numeric" title="Totale di listino">Totale di listino</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? <tr className="distinta-empty-row"><td colSpan={8}>
          {allRows.length === 0 ? "La distinta si compilerà con il preventivo." : "Nessun articolo corrisponde al filtro."}
        </td></tr> : rows.map((row, index) => {
          const selected = row.snapshotUuid === selectedUuid;
          const description = row.description ?? NO_DESCRIPTION;
          return <tr key={row.snapshotUuid} className={`${selected ? "is-selected" : ""}${row.listTotalE4 === null ? " is-unpriced" : ""}`.trim() || undefined}
            aria-selected={selected} tabIndex={row.snapshotUuid === stop ? 0 : -1}
            onClick={() => onSelect(row.snapshotUuid)} onKeyDown={(event) => moveSelection(event, index)}>
            <td className="numeric distinta-index">{index + 1}</td>
            <td className="distinta-cell-text" title={row.brandMarchio}>{row.brandMarchio}</td>
            <td className="distinta-cell-text distinta-code" title={row.manufacturerCode}>{row.manufacturerCode}</td>
            <td className="distinta-cell-text" title={description}>{description}</td>
            <td>{row.unitOfMeasure ?? ""}</td>
            <td className="numeric">{row.quantity}</td>
            <PriceCells row={row} />
          </tr>;
        })}
      </tbody>
      {rows.length > 0 ? <tfoot>
        <tr>
          <td colSpan={5} className="distinta-foot-label">
            {filtered ? `Totale righe filtrate · ${shown.articles} di ${allRows.length}` : "Totale di listino"}
          </td>
          <td className="numeric" title={shownQuantity ? undefined : "Quantità in unità di misura diverse: non si sommano"}>
            {shownQuantity ? `${shownQuantity.quantity}${isPieceUnit(shownQuantity.unit) ? "" : ` ${shownQuantity.unit}`}` : ""}</td>
          <td colSpan={2} className="numeric distinta-foot-total">
            {formatListTotal(shown.totalE4)}
            {shown.unpriced > 0 && shown.priced > 0 ? <small title={unpricedExcludedText(shown.unpriced)}> parziale</small> : null}
          </td>
        </tr>
      </tfoot> : null}
    </table>
  </div>;
}

function Property({ label, value }: { readonly label: string; readonly value: string }) {
  const text = value.trim();
  return <>
    <dt>{label}</dt>
    <dd title={text || undefined}>{text || "—"}</dd>
  </>;
}

function Origins({ origins }: { readonly origins: DistintaOrigins }) {
  const { lines, articles } = origins;
  return <section className="distinta-section" aria-labelledby="distinta-origin-title">
    <h3 id="distinta-origin-title">Origine delle righe</h3>
    <dl className="distinta-props">
      <Property label="Righe preventivo" value={String(lines.total)} />
      <Property label="Ordinarie" value={String(lines.ordinary)} />
      <Property label="Configurate" value={String(lines.configured)} />
    </dl>
    <p className="distinta-origin-articles">Articoli in distinta per provenienza</p>
    <dl className="distinta-props">
      <Property label="Solo ordinari" value={String(articles.ordinary)} />
      <Property label="Solo configurati" value={String(articles.configured)} />
      <Property label="Da entrambi" value={String(articles.mixed)} />
      {articles.unverified > 0 ? <Property label="Non verificabili" value={String(articles.unverified)} /> : null}
    </dl>
  </section>;
}

/** Riepilogo column: totals, price coverage, warning, row origin and project data. */
export function DistintaSummary({ project, totals, origins }: {
  readonly project: ProjectDocumentView;
  readonly totals: DistintaTotals;
  readonly origins: DistintaOrigins;
}) {
  const { metadata } = project;
  return <aside className="distinta-summary" aria-labelledby="distinta-summary-title">
    <header className="distinta-head"><h2 id="distinta-summary-title">Riepilogo</h2></header>
    <div className="distinta-summary-body">
      <section className="distinta-section distinta-total-section">
        <p className="distinta-total-label">Totale di listino</p>
        <p className="distinta-total">{formatListTotal(totals.totalE4)}</p>
        <p className="distinta-coverage">{totals.priced} di {articlesLabel(totals.articles)} con prezzo</p>
        {totals.unpriced > 0 ? <p className="distinta-warning" role="note">
          <Icon name="alert" />
          <span>{totals.unpriced === 1 ? "1 articolo non ha un prezzo di listino" : `${totals.unpriced} articoli non hanno un prezzo di listino`}
            {" "}e non {totals.unpriced === 1 ? "è compreso" : "sono compresi"} nel totale.</span>
        </p> : null}
      </section>
      <Origins origins={origins} />
      <section className="distinta-section" aria-labelledby="distinta-project-title">
        <h3 id="distinta-project-title">Progetto</h3>
        <dl className="distinta-props">
          <Property label="Titolo" value={metadata.title} />
          <Property label="Documento" value={`${project.documentName} · rev. ${project.revision}`} />
          <Property label="Norma" value={`${PROJECT_TYPES[metadata.projectType].label} · ${metadata.normCode}`} />
          <Property label="Esecutore" value={metadata.executor} />
          <Property label="Data" value={metadata.date ? formatIsoDate(metadata.date) : ""} />
          <Property label="Azienda" value={metadata.companyName} />
        </dl>
      </section>
    </div>
  </aside>;
}

/**
 * Distinta materiali (docs/R17_VISUAL_DESIGN.md §4.6): the project-derived Distinta (ordinary product
 * lines plus configured-item BOM × line quantity, grouped by article) with a fixed Riepilogo column.
 * The workspace never scrolls as a page; the table and the summary scroll inside themselves.
 * Document preview/export opens from its header without changing the screen's data.
 */
export function DistintaContent({ project, filter, onFilter, order, onOrder, selectedUuid, onSelect, onDocuments }: {
  readonly project: ProjectDocumentView;
  readonly filter: string;
  readonly onFilter: (filter: string) => void;
  readonly order: CodeOrder;
  readonly onOrder: () => void;
  readonly selectedUuid: string | null;
  readonly onSelect: (snapshotUuid: string) => void;
  readonly onDocuments?: () => void;
}) {
  const all = project.distinta;
  const totals = useMemo(() => distintaTotals(all), [all]);
  const origins = useMemo(() => distintaOrigins(project), [project]);
  const rows = useMemo(() => sortDistinta(filterDistinta(all, filter), order), [all, filter, order]);
  const filtered = filter.trim() !== "";
  // Escape clears a filter; it leaves Distinta only once the field is empty.
  const onFilterKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && filter !== "") { event.nativeEvent.stopPropagation(); onFilter(""); }
  };
  return <div className="distinta-workspace">
    <section className="distinta-main" aria-labelledby="distinta-title">
      <header className="distinta-head">
        <h2 id="distinta-title">Distinta materiali</h2>
        <span className="distinta-count" title={totals.otherUnitArticles > 0 ? OTHER_UNITS_TITLE : undefined}>
          {articlesLabel(totals.articles)} · {piecesSummary(totals)}</span>
        <span className="distinta-pdf">
          <button type="button" onClick={onDocuments} disabled={!onDocuments}><Icon name="download" />Documenti PDF</button>
        </span>
      </header>
      <div className="distinta-toolbar">
        <label className="distinta-filter">
          <Icon name="search" />
          <input type="search" value={filter} disabled={all.length === 0} placeholder="Filtra per marca, codice o descrizione"
            aria-label="Filtra la distinta" onChange={(event) => onFilter(event.target.value)} onKeyDown={onFilterKey} />
        </label>
        <span className="distinta-note" title="Prezzi di listino, senza sconti né ricarichi">Prezzi di listino, senza sconti né ricarichi</span>
      </div>
      <DistintaTable rows={rows} allRows={all} filtered={filtered} order={order} selectedUuid={selectedUuid}
        onOrder={onOrder} onSelect={onSelect} />
    </section>
    <DistintaSummary project={project} totals={totals} origins={origins} />
  </div>;
}

export function DistintaWorkspace({ project, api }: { readonly project: ProjectDocumentView; readonly api?: ProjectApi }) {
  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState<CodeOrder>("none");
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const { setSegments } = useStatusActions();
  const totals = distintaTotals(project.distinta);
  const segments = distintaStatusSegments(totals);
  // Publishing unchanged segments is a no-op in the status reducer, so this can run after every render.
  useEffect(() => { setSegments("distinta", segments); });
  useEffect(() => () => setSegments("distinta", null), [setSegments]);
  return <><DistintaContent project={project} filter={filter} onFilter={setFilter} order={order}
    onOrder={() => setOrder(nextCodeOrder)} selectedUuid={selectedUuid} onSelect={setSelectedUuid}
    onDocuments={api ? () => setDocumentsOpen(true) : undefined} />
    {documentsOpen && api ? <DocumentPdfDialog api={api} onClose={() => setDocumentsOpen(false)} /> : null}</>;
}
