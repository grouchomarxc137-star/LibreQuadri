import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { calculateCommercial, type CommercialCalculation, type CommercialRow } from "../../shared/commercial.js";
import { formatMoneyE4 } from "../../shared/money.js";
import type { ProjectApi, ProjectConfiguredItem, ProjectDocumentView, ProjectPhysicalNode,
  ProjectQuotationLine } from "../../shared/project.js";
import { DocumentPdfDialog } from "../app/DocumentPdfDialog.js";
import { useStatusActions, type StatusSegment } from "../app/status.js";
import { ProjectActionQueue } from "../catalogue/project-actions.js";
import { Icon } from "../ui/icons.js";
import { DEMO_QUANTITY_MAX } from "./demo-quotation.js";
import { dinModulesPerUnit, projectArticleCount, projectDinModules, projectLineName } from "./project-rows.js";

/* Commercial editors hosted inside Distinta. Configured items retain their component rows;
 * shared calculations apply row discounts, then the global discount, then labour. */

type DecimalKind = "discount" | "labour";

export function formatEditableDecimal(value: number, kind: DecimalKind): string {
  // Labour is stored in E4; the editor shows cents without changing stored values.
  const cents = kind === "labour" ? (BigInt(value) + 50n) / 100n : BigInt(value);
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${whole},${(cents % 100n).toString().padStart(2, "0")}`;
}

export function parseEditableDecimal(draft: string, kind: DecimalKind): number | null {
  const cleaned = draft.trim().replace(/\./g, "").replace(",", ".");
  const match = cleaned.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const cents = BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (kind === "discount" && cents > 10000n) return null;
  const stored = kind === "labour" ? cents * 100n : cents;
  return stored <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(stored) : null;
}

function DecimalEditor({ value, kind, label, busy, onCommit }: {
  value: number; kind: DecimalKind; label: string; busy: boolean; onCommit: (value: number) => void;
}) {
  const display = formatEditableDecimal(value, kind);
  const [draft, setDraft] = useState(display);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(display); setInvalid(false); }, [display]);
  const commit = () => {
    if (draft === display) return;
    const parsed = parseEditableDecimal(draft, kind);
    if (parsed === null) { setInvalid(true); return; }
    setInvalid(false); if (parsed !== value) onCommit(parsed); else setDraft(display);
  };
  return <input className="commercial-input" type="text" inputMode="decimal" aria-label={label}
    aria-invalid={invalid} title={invalid ? (kind === "discount" ? "Inserisci un valore valido (sconto da 0 a 100%)."
      : "Inserisci un importo in euro con massimo due decimali.") : undefined}
    value={draft} disabled={busy} onChange={event => { setDraft(event.target.value); setInvalid(false); }}
    onBlur={commit} onKeyDown={event => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") { event.preventDefault(); setDraft(display); setInvalid(false); }
    }} />;
}

const money = (value: number | null): string => value === null ? "Da definire" : formatMoneyE4(value, "EUR");
const modulesFormat = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });
const quantityFormat = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 });
const PLACED_TITLE = "Rimuovi prima la posizione in Progettazione";

/** How many units of each configured item are placed in Progettazione. */
export function placedCounts(nodes: readonly ProjectPhysicalNode[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const visit = (node: ProjectPhysicalNode) => {
    if (node.itemUuid) counts.set(node.itemUuid, (counts.get(node.itemUuid) ?? 0) + 1);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return counts;
}

interface QuotationLineEntry {
  readonly line: ProjectQuotationLine;
  readonly index: number;
}

function groupPlacedLines(lines: readonly ProjectQuotationLine[], itemsByUuid: ReadonlyMap<string, ProjectConfiguredItem>,
  placed: ReadonlyMap<string, number>): readonly QuotationLineEntry[][] {
  const groups: QuotationLineEntry[][] = [];
  const matches = new Map<string, QuotationLineEntry[]>();
  lines.forEach((line, index) => {
    const entry = { line, index };
    const item = line.itemUuid ? itemsByUuid.get(line.itemUuid) : undefined;
    if (!item || line.lineType !== "item" || !placed.get(item.uuid) ||
      (item.modelKind !== "support" && item.modelKind !== "device")) {
      groups.push([entry]);
      return;
    }
    // The existing physical copies have separate IDs. Only group matching saved engineering and commercial data.
    const { uuid: _itemUuid, frontOptionLabels: _labels, ...snapshot } = item;
    const { uuid: _lineUuid, itemUuid: _item, quantity: _quantity, lineTotalE4: _total, ...terms } = line;
    const key = JSON.stringify([snapshot, terms]);
    const existing = matches.get(key);
    if (existing) existing.push(entry);
    else {
      const group = [entry];
      matches.set(key, group);
      groups.push(group);
    }
  });
  return groups;
}

export function placedText(placed: number, quantity: number): string {
  return placed >= quantity ? "Posizionato" : `${placed} di ${quantity} posizionati`;
}

function UnplacedDevicesWarning({ lines, itemsByUuid, placed }: {
  lines: readonly ProjectQuotationLine[];
  itemsByUuid: ReadonlyMap<string, ProjectConfiguredItem>;
  placed: ReadonlyMap<string, number>;
}) {
  const unplaced = lines.flatMap(line => {
    const item = line.itemUuid ? itemsByUuid.get(line.itemUuid) : undefined;
    if (line.lineType !== "item" || item?.modelKind !== "device") return [];
    const remaining = line.quantity - (placed.get(item.uuid) ?? 0);
    return remaining > 0 ? [{ line, name: item.configLabel || projectLineName(line, item), remaining }] : [];
  });
  if (!unplaced.length) return null;
  const total = unplaced.reduce((sum, entry) => sum + entry.remaining, 0);
  return <details className="quotation-unplaced">
    <summary>
      <Icon name="alert" className="librequadri-icon-small" />
      <strong>{quantityFormat.format(total)} {total === 1 ? "apparecchio" : "apparecchi"} da posizionare</strong>
      <span className="quotation-unplaced-show">Mostra elenco</span>
      <span className="quotation-unplaced-hide">Nascondi elenco</span>
      <Icon name="chevronDown" className="librequadri-icon-small quotation-unplaced-chevron" />
    </summary>
    <ul aria-label="Apparecchi da posizionare">
      {unplaced.map(({ line, name, remaining }) => <li key={line.uuid}>
        <span>{name}</span>
        <span>{quantityFormat.format(remaining)} da posizionare su {quantityFormat.format(line.quantity)}</span>
      </li>)}
    </ul>
  </details>;
}

/** Commercial rows with and without a complete price: the reason a total is "Da definire". */
export function priceCoverage(commercial: CommercialCalculation): { rows: number; priced: number } {
  const rows = commercial.groups.flatMap(group => group.rows);
  return { rows: rows.length, priced: rows.filter(row => row.netE4 !== null).length };
}

function rowCountText(count: number): string {
  return `${count} ${count === 1 ? "riga" : "righe"}`;
}

/** Status context while the Distinta editor is open. */
export function quotationStatusSegments(lines: readonly ProjectQuotationLine[], commercial: CommercialCalculation,
  lineCount = lines.length): StatusSegment[] {
  return [
    { id: "lines", label: "Righe:", value: String(lineCount) },
    { id: "articles", label: "Articoli:", value: String(projectArticleCount(lines)) },
    { id: "total", label: "Totale progetto:", value: money(commercial.finalTotalE4) },
  ];
}

interface LineCommands {
  readonly busy: boolean;
  readonly onQuantityChange: (lineUuid: string, quantity: number) => void;
  readonly onDuplicate?: (lineUuid: string) => void;
  readonly onRemove: (lineUuid: string) => void;
  readonly onOpenLine: (lineUuid: string) => void;
  readonly onLineDiscount?: (lineUuid: string, bp: number) => void;
  readonly onComponentDiscount?: (itemUuid: string, seq: number, bp: number) => void;
}

function QuantityEditor({ line, name, busy, onChange }: {
  line: ProjectQuotationLine; name: string; busy: boolean; onChange: (lineUuid: string, quantity: number) => void;
}) {
  return <div className="quantity-editor" aria-label={`Quantità ${name}`}>
    <button type="button" disabled={busy || line.quantity <= 1}
      onClick={() => onChange(line.uuid, line.quantity - 1)} aria-label={`Riduci quantità di ${name}`}>−</button>
    <input type="number" min="1" max={DEMO_QUANTITY_MAX} step="1" inputMode="numeric"
      value={line.quantity} disabled={busy} aria-label={`Quantità ${name}`}
      onChange={event => {
        const quantity = Number(event.target.value);
        if (Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= DEMO_QUANTITY_MAX) onChange(line.uuid, quantity);
      }} />
    <button type="button" disabled={busy || line.quantity >= DEMO_QUANTITY_MAX}
      onClick={() => onChange(line.uuid, line.quantity + 1)} aria-label={`Aumenta quantità di ${name}`}>+</button>
  </div>;
}

/** Unit price, discount editor and net amount of one commercial row. */
function CommercialCells({ row, name, line, commands }: {
  row: CommercialRow; name: string; line: ProjectQuotationLine; commands: LineCommands;
}) {
  return <>
    <td className="numeric quotation-col-price">{row.unitPriceE4 === null
      ? <span className="librequadri-tag" data-tone="warn">Prezzo non disponibile</span> : formatMoneyE4(row.unitPriceE4, "EUR")}</td>
    <td className="numeric quotation-discount">
      <DecimalEditor key={`${row.key}-${row.discountBp}`} value={row.discountBp} kind="discount"
        label={`Sconto ${row.description} ${name}`} busy={commands.busy}
        onCommit={bp => row.itemUuid !== null && row.componentSeq !== null
          ? commands.onComponentDiscount?.(row.itemUuid, row.componentSeq, bp) : commands.onLineDiscount?.(line.uuid, bp)} />
    </td>
    <td className={`numeric quotation-net${row.netE4 === null ? " is-undefined" : ""}`}>{money(row.netE4)}</td>
  </>;
}

/**
 * Each project line keeps its own editing controls. Matching placed lines can be expanded from
 * one summary row to show their saved lines and component details.
 */
function QuotationTable({ lineGroups, itemsByUuid, placed, commercial, checked, onCheck,
  activeLineUuid = null, ...commands }: LineCommands & {
  readonly lineGroups: readonly QuotationLineEntry[][];
  readonly itemsByUuid: ReadonlyMap<string, ProjectConfiguredItem>;
  readonly placed: ReadonlyMap<string, number>;
  readonly commercial: CommercialCalculation;
  readonly checked: readonly string[];
  readonly onCheck: (lineUuid: string, checked: boolean) => void;
  /** The line currently shown in the Apparecchi inspector. */
  readonly activeLineUuid?: string | null;
}) {
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const groups = new Map(commercial.groups.map(group => [group.key, group]));
  const { busy } = commands;
  const renderLine = ({ line, index }: QuotationLineEntry) => {
    const item = line.itemUuid ? itemsByUuid.get(line.itemUuid) : undefined;
    const name = projectLineName(line, item);
    const perUnit = dinModulesPerUnit(item);
    const placedUnits = line.itemUuid ? placed.get(line.itemUuid) ?? 0 : 0;
    const removable = placedUnits === 0;
    const group = groups.get(line.uuid);
    const single = line.lineType === "product" && group?.rows.length === 1 ? group.rows[0]! : null;
    const components = line.lineType === "item" ? group?.rows ?? [] : [];
    const active = activeLineUuid === line.uuid;
    return <tbody key={line.uuid} className="quotation-line" data-line-type={line.lineType}
      data-active={active ? "true" : undefined}>
      <tr className="quotation-line-row" aria-selected={active}>
        <td className="numeric quotation-index"><span className="quotation-row-number" aria-label={`Riga ${index + 1}`}>{index + 1}</span></td>
        <td className="quotation-check-cell"><label className="quotation-check" title={removable ? undefined : PLACED_TITLE}>
          <input type="checkbox" checked={checked.includes(line.uuid)} disabled={busy || !removable}
            aria-label={`Seleziona ${name} per la rimozione`}
            onChange={event => onCheck(line.uuid, event.target.checked)} />
        </label></td>
        <td className="quotation-description">
          <button type="button" className="quotation-row-select" disabled={busy} title={`${name}: apri nella scheda di Apparecchi`}
            aria-label={`Apri ${name} nella scheda articolo`} onClick={() => commands.onOpenLine(line.uuid)}>
            <strong>{name}</strong><Icon name="open" className="librequadri-icon-small quotation-open-icon" />
          </button>
          <span className="quotation-meta">
            {line.lineType === "product" ? <span className="code" title={`${line.brandMarchio} · ${line.manufacturerCode}`}>
              {line.brandMarchio} · {line.manufacturerCode}</span> : null}
            {perUnit !== null ? <span>{modulesFormat.format(perUnit * line.quantity)} moduli DIN</span> : null}
            {placedUnits > 0 ? <span className="librequadri-tag" data-tone="project">{placedText(placedUnits, line.quantity)}</span> : null}
          </span>
        </td>
        <td className="numeric quotation-quantity"><QuantityEditor line={line} name={name} busy={busy} onChange={commands.onQuantityChange} /></td>
        {single ? <CommercialCells row={single} name={name} line={line} commands={commands} />
          : <><td className="quotation-col-price" /><td /><td /></>}
        <td className="quotation-actions">
          {line.lineType === "item" && commands.onDuplicate ? <button type="button" className="icon-button duplicate-line"
            disabled={busy} title="Duplica" onClick={() => commands.onDuplicate?.(line.uuid)}
            aria-label={`Duplica ${name}`}><Icon name="copy" className="librequadri-icon-small" /></button> : null}
          <button type="button" className="icon-button remove-line" disabled={busy || !removable}
            title={removable ? "Rimuovi dal progetto" : PLACED_TITLE}
            onClick={() => commands.onRemove(line.uuid)} aria-label={`Rimuovi ${name} dal progetto`}>
            <Icon name="trash" className="librequadri-icon-small" /></button>
        </td>
      </tr>
      {components.map(component => <tr key={component.key} className="quotation-component">
        <td /><td />
        <td className="quotation-component-name" title={`${component.code} · ${component.description}`}>
          {component.code !== "—" ? <span className="code">{component.code}</span> : null}
          <span className="quotation-component-description">{component.description}</span>
        </td>
        <td className="numeric quotation-component-quantity">× {quantityFormat.format(component.quantity)}</td>
        <CommercialCells row={component} name={name} line={line} commands={commands} />
        <td />
      </tr>)}
    </tbody>;
  };
  return <div className="quotation-scroll">
    <table className="quotation-table">
      <colgroup>
        <col className="quotation-col-index" /><col className="quotation-col-check" /><col />
        <col className="quotation-col-qty" /><col className="quotation-col-price" /><col className="quotation-col-discount" />
        <col className="quotation-col-total" /><col className="quotation-col-actions" />
      </colgroup>
      <thead><tr>
        <th scope="col" className="numeric">#</th>
        <th scope="col"><span className="visually-hidden">Selezione per la rimozione</span></th>
        <th scope="col">Descrizione</th>
        <th scope="col" className="numeric">Quantità</th>
        <th scope="col" className="numeric quotation-col-price">Prezzo unitario</th>
        <th scope="col" className="numeric">Sconto %</th>
        <th scope="col" className="numeric">Totale</th>
        <th scope="col"><span className="visually-hidden">Comandi</span></th>
      </tr></thead>
      {lineGroups.length === 0 ? <tbody><tr className="quotation-empty-row"><td colSpan={8}>
        <p>Nessun prodotto nel progetto.</p><span>Cerca in Apparecchi e usa “Aggiungi”.</span>
      </td></tr></tbody> : lineGroups.map(entries => {
        const first = entries[0]!;
        if (entries.length === 1) return renderLine(first);
        const { line, index } = first;
        const item = itemsByUuid.get(line.itemUuid!);
        const name = projectLineName(line, item);
        const quantity = entries.reduce((sum, entry) => sum + entry.line.quantity, 0);
        const placedUnits = entries.reduce((sum, entry) => sum + (placed.get(entry.line.itemUuid!) ?? 0), 0);
        const rows = entries.flatMap(entry => groups.get(entry.line.uuid)?.rows ?? []);
        const net = rows.reduce((sum, row) => sum + (row.netE4 ?? 0), 0);
        const total = rows.some(row => row.netE4 === null) || !Number.isSafeInteger(net) ? null : net;
        const expanded = expandedGroups.has(line.uuid);
        return <Fragment key={line.uuid}>
          <tbody className="quotation-line quotation-line-group" data-line-type="item">
            <tr className="quotation-line-row">
              <td className="numeric quotation-index">{index + 1}</td><td />
              <td className="quotation-description">
                <button type="button" className="quotation-row-select" aria-expanded={expanded}
                  aria-label={`${name}, ${rowCountText(entries.length)}`}
                  onClick={() => setExpandedGroups(previous => {
                    const next = new Set(previous);
                    if (next.has(line.uuid)) next.delete(line.uuid); else next.add(line.uuid);
                    return next;
                  })}>
                  <Icon name={expanded ? "chevronDown" : "chevronRight"} className="librequadri-icon-small" />
                  <strong>{name}</strong>
                </button>
                <span className="quotation-meta"><span className="librequadri-tag" data-tone="project">{placedText(placedUnits, quantity)}</span></span>
              </td>
              <td className="numeric quotation-quantity">{quantityFormat.format(quantity)}</td>
              <td className="quotation-col-price" /><td />
              <td className="numeric quotation-net">{rows.length ? money(total) : null}</td><td />
            </tr>
          </tbody>
          {expanded ? entries.map(renderLine) : null}
        </Fragment>;
      })}
    </table>
  </div>;
}

/** Riepilogo: the total first, then the calculation in its order with the global discount and labour editors. */
export function QuotationSummary({ commercial, globalDiscountBp, labourTotalE4, busy, onGlobalDiscount, onLabourTotal, onDocuments }: {
  readonly commercial: CommercialCalculation;
  readonly globalDiscountBp: number;
  readonly labourTotalE4: number;
  readonly busy: boolean;
  readonly onGlobalDiscount?: (bp: number) => void;
  readonly onLabourTotal?: (amountE4: number) => void;
  readonly onDocuments?: () => void;
}) {
  const coverage = priceCoverage(commercial);
  const unpriced = coverage.rows - coverage.priced;
  return <aside className="quotation-summary" aria-labelledby="quotation-summary-title">
    <header className="quotation-panel-head"><h2 id="quotation-summary-title">Riepilogo</h2></header>
    <div className="quotation-summary-body">
      <section className="quotation-summary-section quotation-total-section">
        <p className="quotation-total-label">Totale progetto</p>
        <p className={`quotation-total${commercial.finalTotalE4 === null ? " is-undefined" : ""}`}>{money(commercial.finalTotalE4)}</p>
        <p className="quotation-coverage">{coverage.priced} di {rowCountText(coverage.rows)} con prezzo</p>
        {unpriced > 0 ? <p className="quotation-warning" role="note"><Icon name="alert" />
          <span>{unpriced === 1 ? "1 riga non ha un prezzo" : `${unpriced} righe non hanno un prezzo`}: il totale è da definire.</span>
        </p> : null}
      </section>
      <section className="quotation-summary-section commercial-summary" aria-label="Calcolo del totale">
        <div><span>Materiali dopo sconti di riga</span><strong>{money(commercial.materialsSubtotalE4)}</strong></div>
        <label><span>Sconto globale</span><span className="commercial-field">
          <DecimalEditor value={globalDiscountBp} kind="discount" label="Sconto globale progetto" busy={busy}
            onCommit={bp => onGlobalDiscount?.(bp)} /><span aria-hidden="true">%</span></span></label>
        {globalDiscountBp ? <>
          <div><span>Importo sconto globale</span><strong>{commercial.globalDiscountE4 === null ? "Da definire"
            : `− ${formatMoneyE4(commercial.globalDiscountE4, "EUR")}`}</strong></div>
          <div><span>Materiali dopo sconto globale</span><strong>{money(commercial.materialsAfterGlobalE4)}</strong></div>
        </> : null}
        <label><span>Mano d'opera</span><span className="commercial-field">
          <DecimalEditor value={labourTotalE4} kind="labour" label="Mano d'opera totale in euro" busy={busy}
            onCommit={amount => onLabourTotal?.(amount)} /><span aria-hidden="true">€</span></span></label>
        <div className="commercial-final"><span>Totale progetto</span><strong>{money(commercial.finalTotalE4)}</strong></div>
      </section>
      {onDocuments ? <section className="quotation-summary-section">
        <button type="button" className="quotation-documents" onClick={onDocuments}><Icon name="file" />Documento Distinta PDF…</button>
      </section> : null}
    </div>
    <p className="quotation-summary-note">Prezzi salvati nel progetto. Sconti percentuali per riga o componente, poi lo sconto
      globale; la mano d'opera si aggiunge dopo lo sconto globale.</p>
  </aside>;
}

/** The workspace without its own state: lines table beside the Riepilogo. */
export function PreventivoContent({ project, busy = false, error = null, checked = [], onCheck = () => undefined,
  onRemoveMany = () => undefined, onBrowse, onGlobalDiscount, onLabourTotal, onDocuments, ...commands }:
  Omit<LineCommands, "busy"> & {
  readonly project: Pick<ProjectDocumentView, "lines" | "configuredItems" | "physicalNodes" | "globalDiscountBp" | "labourTotalE4">;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly checked?: readonly string[];
  readonly onCheck?: (lineUuid: string, checked: boolean) => void;
  readonly onRemoveMany?: (lineUuids: readonly string[]) => void;
  readonly onBrowse?: () => void;
  readonly onGlobalDiscount?: (bp: number) => void;
  readonly onLabourTotal?: (amountE4: number) => void;
  readonly onDocuments?: () => void;
  readonly activeLineUuid?: string | null;
}) {
  const { lines, configuredItems, physicalNodes } = project;
  const globalDiscountBp = project.globalDiscountBp ?? 0;
  const labourTotalE4 = project.labourTotalE4 ?? 0;
  const commercial = useMemo(() => calculateCommercial({ lines, configuredItems, globalDiscountBp, labourTotalE4 }),
    [lines, configuredItems, globalDiscountBp, labourTotalE4]);
  const placed = useMemo(() => placedCounts(physicalNodes), [physicalNodes]);
  const itemsByUuid = useMemo(() => new Map(configuredItems.map(item => [item.uuid, item])), [configuredItems]);
  const lineGroups = useMemo(() => groupPlacedLines(lines, itemsByUuid, placed), [lines, itemsByUuid, placed]);
  const { setSegments } = useStatusActions();
  const segments = quotationStatusSegments(lines, commercial, lineGroups.length);
  // Publishing unchanged segments is a no-op in the status reducer, so this can run after every render.
  useEffect(() => { setSegments("quotation", segments); });
  useEffect(() => () => setSegments("quotation", null), [setSegments]);
  const removable = (line: ProjectQuotationLine) => !line.itemUuid || !placed.get(line.itemUuid);
  const checkedPresent = checked.filter(uuid => lines.some(line => line.uuid === uuid && removable(line)));
  const dinTotal = projectDinModules(lines, configuredItems);
  return <div className="quotation-workspace">
    <section className="quotation-main" aria-labelledby="quotation-title">
      <header className="quotation-panel-head">
        <h2 id="quotation-title">Componenti del progetto</h2>
        <span className="quotation-count">{rowCountText(lineGroups.length)} · {projectArticleCount(lines)} articoli
          {dinTotal !== null ? ` · ${modulesFormat.format(dinTotal)} moduli DIN` : ""}</span>
        <span className="quotation-head-actions">
          {checkedPresent.length ? <button type="button" className="remove-checked danger" disabled={busy}
            onClick={() => onRemoveMany(checkedPresent)}>Rimuovi selezionati ({checkedPresent.length})</button> : null}
          {onBrowse ? <button type="button" onClick={onBrowse}><Icon name="plus" className="librequadri-icon-small" />Aggiungi apparecchi</button> : null}
        </span>
      </header>
      {error ? <p className="quotation-error" role="alert"><Icon name="alert" className="librequadri-icon-small" />{error}</p> : null}
      <UnplacedDevicesWarning lines={lines} itemsByUuid={itemsByUuid} placed={placed} />
      <QuotationTable lineGroups={lineGroups} itemsByUuid={itemsByUuid} placed={placed} commercial={commercial}
        checked={checkedPresent} onCheck={onCheck} busy={busy} {...commands} />
    </section>
    <QuotationSummary commercial={commercial} globalDiscountBp={globalDiscountBp} labourTotalE4={labourTotalE4} busy={busy}
      onGlobalDiscount={onGlobalDiscount} onLabourTotal={onLabourTotal} onDocuments={onDocuments} />
  </div>;
}

/**
 * Commercial editor controller: commands share the catalogue/drawing write queue.
 * Opening a line returns to the Apparecchi inspector.
 */
export function PreventivoWorkspace({ project, api, activeLineUuid = null, onOpenLine, onBrowse, onLinesRemoved,
  onProjectChange, actionQueue, hideDocuments = false, disabled = false, onBusyChange }: {
  readonly project: ProjectDocumentView;
  readonly api: ProjectApi;
  readonly activeLineUuid?: string | null;
  readonly onOpenLine: (lineUuid: string) => void;
  readonly onBrowse?: () => void;
  readonly onLinesRemoved?: (lineUuids: readonly string[]) => void;
  readonly onProjectChange: (project: ProjectDocumentView) => void;
  readonly actionQueue?: ProjectActionQueue;
  readonly hideDocuments?: boolean;
  readonly disabled?: boolean;
  readonly onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<readonly string[]>([]);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const ownQueue = useMemo(() => new ProjectActionQueue(), []);
  const queue = actionQueue ?? ownQueue;
  const pending = useRef(0);
  const run = async (action: () => Promise<ProjectDocumentView | null>): Promise<boolean> => {
    pending.current++; setBusy(true); onBusyChange?.(true); setError(null);
    try { return await queue.enqueue(action, onProjectChange, setError); }
    finally { pending.current--; if (pending.current === 0) { setBusy(false); onBusyChange?.(false); } }
  };
  const removed = (uuids: readonly string[]) => {
    setChecked(previous => previous.filter(uuid => !uuids.includes(uuid)));
    onLinesRemoved?.(uuids);
  };
  return <>
    <PreventivoContent project={project} busy={busy || disabled} error={error} checked={checked} activeLineUuid={activeLineUuid}
      onCheck={(uuid, value) => setChecked(previous => value ? [...previous, uuid] : previous.filter(entry => entry !== uuid))}
      onOpenLine={onOpenLine} onBrowse={onBrowse} onDocuments={hideDocuments ? undefined : () => setDocumentsOpen(true)}
      onQuantityChange={(lineUuid, next) => void run(() => api.setQuantity(lineUuid, next))}
      onDuplicate={lineUuid => void run(() => api.duplicateConfiguredItem(lineUuid))}
      onRemove={lineUuid => void run(() => api.removeLine(lineUuid)).then(ok => { if (ok) removed([lineUuid]); })}
      onRemoveMany={lineUuids => void run(() => api.removeLines(lineUuids)).then(ok => { if (ok) removed(lineUuids); })}
      onLineDiscount={(uuid, bp) => void run(() => api.setLineDiscount(uuid, bp))}
      onComponentDiscount={(itemUuid, seq, bp) => void run(() => api.setComponentDiscount(itemUuid, seq, bp))}
      onGlobalDiscount={bp => void run(() => api.setGlobalDiscount(bp))}
      onLabourTotal={amount => void run(() => api.setLabourTotal(amount))} />
    {documentsOpen ? <DocumentPdfDialog api={api} initialKind="distinta" onClose={() => setDocumentsOpen(false)} /> : null}
  </>;
}
