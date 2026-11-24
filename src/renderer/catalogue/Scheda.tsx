import { useId, type ReactNode } from "react";
import type { CatalogueBrowseProduct } from "../../shared/catalogue.js";
import { Icon } from "../ui/icons.js";
import { validQuantity } from "./browse-state.js";
import { formatAttributeValue } from "./formatting.js";

/*
 * Scheda articolo (docs/R17_VISUAL_DESIGN.md §4.2): a docked inspector with a fixed header, a
 * body that scrolls on its own (identity, then compact collapsible sections) and a fixed footer
 * that keeps the quantity and the one primary action visible. Catalogo prices stay hidden (R-02).
 */

export function SchedaFrame({ label = "Scheda articolo", children, footer }: {
  label?: string; children: ReactNode; footer?: ReactNode;
}) {
  return <section className="catalogue-pane catalogue-inspector scheda" aria-label={label}>
    <header><h2>Scheda articolo</h2></header>
    <div className="scheda-body">{children}</div>
    {footer ? <footer className="scheda-footer">{footer}</footer> : null}
  </section>;
}

/** "project" marks the project context of an item (configured, placed): the restrained accent family. */
export function SchedaTag({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "project"; children: ReactNode }) {
  return <span className="scheda-tag" data-tone={tone}>{children}</span>;
}

/** Code line (mono, with status tags), 15/20 name, optional secondary line. Long text truncates with a tooltip. */
export function SchedaIdentity({ code, title, meta, tags }: {
  code: string | null; title: string; meta?: string | null; tags?: ReactNode;
}) {
  return <div className="scheda-identity">
    <p className="scheda-code-line">
      {code ? <span className="scheda-code" title={code}>{code}</span> : null}
      {tags ? <span className="scheda-tags">{tags}</span> : null}
    </p>
    <h3 className="scheda-title" title={title}>{title}</h3>
    {meta ? <p className="scheda-meta" title={meta}>{meta}</p> : null}
  </div>;
}

/** 28 px collapsible section header with chevron and optional count. */
export function SchedaSection({ title, count, open = true, children }: {
  title: string; count?: number | null; open?: boolean; children: ReactNode;
}) {
  return <details className="scheda-section" open={open}>
    <summary><Icon name="chevronDown" className="librequadri-icon-small scheda-chevron" /><span>{title}</span>
      {count !== undefined && count !== null ? <small>{count}</small> : null}</summary>
    <div className="scheda-section-body">{children}</div>
  </details>;
}

export type SchedaRow = readonly [label: string, value: ReactNode, tooltip?: string];

/** Label column / value column, 22 px rows; values truncate with ellipsis and show the full text in a tooltip. */
export function SchedaGrid({ rows }: { rows: readonly SchedaRow[] }) {
  return <dl className="scheda-grid">{rows.map(([label, value, tooltip], index) => <div key={`${index}-${label}`}>
    <dt title={label}>{label}</dt>
    <dd title={tooltip ?? (typeof value === "string" ? value : undefined)}>{value}</dd>
  </div>)}</dl>;
}

export function SchedaNotice({ tone, children }: { tone: "ok" | "warn" | "error" | "neutral"; children: ReactNode }) {
  const icon = tone === "ok" ? "check" : tone === "neutral" ? null : "alert";
  return <p className="scheda-notice" data-tone={tone} role={tone === "error" ? "alert" : undefined}>
    {icon ? <Icon name={icon} className="librequadri-icon-small" /> : null}<span>{children}</span></p>;
}

export const QUANTITY_ERROR = "Inserisci un intero da 1 a 9.999.";

/** Bordered − value + group; the text value is kept so an invalid entry stays visible and flagged. */
export function QuantityStepper({ value, onChange, disabled = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const id = useId();
  const parsed = validQuantity(value);
  return <div className="scheda-quantity">
    <label htmlFor={id}>Quantità</label>
    <div className="scheda-stepper">
      <button type="button" aria-label="Riduci quantità" disabled={disabled || (parsed !== null && parsed <= 1)}
        onClick={() => onChange(String(parsed === null ? 1 : Math.max(1, parsed - 1)))}><Icon name="minus" className="librequadri-icon-small" /></button>
      <input id={id} type="number" min="1" max="9999" step="1" inputMode="numeric" value={value}
        aria-invalid={parsed === null} disabled={disabled} onChange={event => onChange(event.target.value)} />
      <button type="button" aria-label="Aumenta quantità" disabled={disabled || (parsed !== null && parsed >= 9_999)}
        onClick={() => onChange(String(parsed === null ? 1 : Math.min(9_999, parsed + 1)))}><Icon name="plus" className="librequadri-icon-small" /></button>
    </div>
  </div>;
}

/**
 * A new selection takes an explicit quantity; an existing project line shows its quantity read
 * only; the quantity remains editable in project components and Distinta.
 */
export type SchedaQuantity =
  | { readonly kind: "new"; readonly value: string; readonly onChange: (value: string) => void }
  | { readonly kind: "project"; readonly quantity: number };

export function quantityAccepted(quantity: SchedaQuantity): boolean {
  return quantity.kind === "project" || validQuantity(quantity.value) !== null;
}

/** Quantity, the one primary action, then the reasons the action is unavailable. */
export function SchedaFooter({ quantity, busy, action, notes }: {
  quantity: SchedaQuantity; busy: boolean; action?: ReactNode; notes?: readonly (string | null | false)[];
}) {
  const reasons = [quantityAccepted(quantity) ? null : QUANTITY_ERROR, ...(notes ?? [])]
    .filter((note): note is string => !!note);
  return <>
    <div className="scheda-footer-row">
      {quantity.kind === "new" ? <QuantityStepper value={quantity.value} onChange={quantity.onChange} disabled={busy} />
        : <p className="scheda-project-quantity" title="Modifica la quantità nella Distinta">
          <span>Quantità nel progetto</span><strong>{quantity.quantity}</strong></p>}
      {action}
    </div>
    {reasons.map(reason => reason === QUANTITY_ERROR ?
      <p key={reason} className="scheda-footer-note error" role="alert">{reason}</p> :
      <p key={reason} className="scheda-footer-note">{reason}</p>)}
  </>;
}

export function productIdentity(product: CatalogueBrowseProduct): { code: string; meta: string | null } {
  const brand = product.brandName && product.brandName !== product.brandMarchio ? product.brandName : null;
  const meta = [brand, product.category?.name ?? null, product.unitOfMeasure ? `UM ${product.unitOfMeasure}` : null]
    .filter((part): part is string => !!part).join(" · ");
  return { code: `${product.brandMarchio} · ${product.manufacturerCode}`, meta: meta || null };
}

/** Listing and configurability are neutral states (R-03); only a delisted article gets a tag. */
export function ProductTags({ product }: { product: CatalogueBrowseProduct }) {
  return <>
    {product.configurable ? <SchedaTag>Configurabile</SchedaTag> : null}
    {product.isListed ? <span className="scheda-listing">A listino</span> : <SchedaTag>Fuori listino</SchedaTag>}
  </>;
}

export function ProductAttributes({ product }: { product: CatalogueBrowseProduct }) {
  if (!product.attributes.length) return null;
  return <SchedaSection title="Attributi tecnici" count={product.attributes.length}>
    <SchedaGrid rows={product.attributes.map(attribute => [attribute.name,
      formatAttributeValue(attribute.value, attribute.unit, attribute.label)] as const)} />
  </SchedaSection>;
}
