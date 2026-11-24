import type { CatalogueOverview } from "../../shared/catalogue.js";
import { formatCount, formatIsoDate } from "../catalogue/formatting.js";
import { Icon } from "../ui/icons.js";
import { useStatusState, type StatusSegment } from "./status.js";

/** Current listino identification, from data the catalogue already reports. */
export function listinoLabels(overview: CatalogueOverview | null): string[] {
  return (overview?.currentPriceLists ?? []).map((list) =>
    `Listino ${list.issuerSigla} n. ${list.listinoNumber} · valido dal ${formatIsoDate(list.validFrom)}`);
}

function Segment({ segment }: { readonly segment: StatusSegment }) {
  const { label, value, unit } = segment;
  return <span className="status-segment" data-kind={segment.id.startsWith("Listino ") ? "listino" : "context"}
    title={segment.title ?? [label, value, unit].filter(Boolean).join(" ")}>
    <span>{label && (value || unit) ? `${label} ` : label}{value ? <b>{value}</b> : null}{unit && value ? ` ${unit}` : unit}</span>
  </span>;
}

/**
 * Persistent application status line (docs/R17_VISUAL_DESIGN.md §3.7): the single live region
 * with the latest operation, then the active workspace's context segments, then the catalogue
 * and listino state. Errors that need action stay next to the control that caused them.
 */
export function StatusBar({ overview, showCatalogueSize = false, source }: {
  readonly overview: CatalogueOverview | null;
  readonly showCatalogueSize?: boolean;
  /** The workspace whose published segments are shown. */
  readonly source?: string;
}) {
  const { message, tone, segments } = useStatusState();
  const context = source ? segments[source] ?? [] : [];
  const catalogue: StatusSegment | null = !showCatalogueSize || !overview ? null
    : overview.productCount === 0 ? { id: "catalogue", label: "Catalogo vuoto: nessun listino importato" }
    : { id: "catalogue", label: "Catalogo:", value: formatCount(overview.productCount), unit: "articoli" };
  return <footer className="status-bar">
    <span className="status-message" role="status" aria-live="polite" title={message ?? "Pronto."}>
      {message && tone === "ok" ? <Icon name="check" className="status-ok" /> : null}
      {message && tone === "valid" ? <span className="status-valid" aria-hidden="true" /> : null}
      <span>{message ?? "Pronto."}</span>
    </span>
    {context.map((segment) => <Segment key={segment.id} segment={segment} />)}
    {catalogue ? <Segment segment={catalogue} /> : null}
    {listinoLabels(overview).map((label) => <Segment key={label} segment={{ id: label, label }} />)}
  </footer>;
}
