import { createPortal } from "react-dom";
import { Fragment, memo, useCallback, useLayoutEffect, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { CatalogueApi, CatalogueBrowsePackage, CatalogueBrowseProduct, CatalogueBrowseResult, ManufacturerNode }
  from "../../shared/catalogue.js";
import { CATALOGUE_QUERY_MAX_LENGTH } from "../../shared/catalogue.js";
import type { ConfigurationApi } from "../../shared/configuration.js";
import { configurationCanBeAdded } from "../../shared/out-of-catalogue.js";
import type { ProjectApi, ProjectConfiguredItem, ProjectDocumentView, ProjectQuotationLine } from "../../shared/project.js";
import type { CatalogueView } from "../app/shell-state.js";
import { useStatusActions } from "../app/status.js";
import { useQuickAdd } from "../app/QuickAdd.js";
import { ConfigurationScreen } from "../configuration/ConfigurationScreen.js";
import { confirmCatalogueAddition } from "../configuration/out-of-catalogue.js";
import { configurationRequest } from "../configuration/presentation.js";
import { placedItemUuids } from "../quotation/project-rows.js";
import { FullTextTooltip } from "../ui/FullTextTooltip.js";
import { useSidePanels } from "../ui/useSidePanels.js";
import { Icon } from "../ui/icons.js";
import { ArticleConfiguration, articleModels, preferredArticleModel } from "./ArticleConfiguration.js";
import { formatAttributeValue, formatCount } from "./formatting.js";
import { showcaseBrandNodes, showcaseNavigation, STATISTICAL_FAMILIES_GROUP } from "../showcase/catalogue-navigation.js";
import { manufacturerNodeLabel } from "./ManufacturerNavigation.js";
import { PackageInspector } from "./PackageInspector.js";
import { ProjectComponents, SavedItemSnapshot } from "./ProjectComponents.js";
import { ProductAttributes, ProductTags, productIdentity, quantityAccepted, SchedaFooter, SchedaFrame,
  SchedaIdentity, SchedaNotice, SchedaTag, type SchedaQuantity } from "./Scheda.js";
import { ProjectActionQueue } from "./project-actions.js";
import { addOrdinaryQuantity, attributeRequest, BrowseSession, emptyBrowseState,
  toggleValue, validQuantity, type BrowseState } from "./browse-state.js";

export const SIEMENS_FILTERS: ReadonlySet<string> = new Set([
  "rated_current", "poles", "trip_curve", "rated_voltage", "declared_breaking_capacity",
  "rated_short_circuit_capacity", "rated_ultimate_breaking_capacity", "rated_residual_current",
  "residual_current_type", "trip_unit_type", "coil_voltage",
]);
export function visibleTechnicalFilter(brand: string | undefined, code: string): boolean {
  return brand !== "SIE" || SIEMENS_FILTERS.has(code);
}
export function presentedAttributes(attributes: Readonly<Record<string, readonly (string | number)[]>>, brand: string | undefined) {
  return Object.fromEntries(Object.entries(attributes).filter(([code]) => visibleTechnicalFilter(brand, code)));
}

function attributesText(product: CatalogueBrowseProduct): string {
  return product.attributes.map(attribute => `${attribute.name}: ${formatAttributeValue(attribute.value,
    attribute.unit, attribute.label)}`).join(" · ");
}

function selectedAttributeText(facets: CatalogueBrowseResult["facets"] | null, code: string,
  value: string | number): string {
  const facet = facets?.attributes.find(entry => entry.code === code);
  const option = facet?.values.find(entry => entry.value === value);
  return `${facet?.name ?? code}: ${formatAttributeValue(value, facet?.unit ?? null, option?.label ?? null)}`;
}

export function nextOpenFacet(current: string | null, clicked: string): string | null {
  return current === clicked ? null : clicked;
}

/** Project snapshots have no local catalogue ID; resolve the current article by exact identity. */
export async function projectCatalogueProduct(api: CatalogueApi, configurationApi: ConfigurationApi,
  line: ProjectQuotationLine): Promise<CatalogueBrowseProduct | null> {
  if (line.lineType !== "product") return null;
  let offset = 0;
  while (true) {
    const matches = await api.search({ query: line.manufacturerCode, limit: 200, offset });
    const product = matches.products.find(row => row.brandMarchio === line.brandMarchio &&
      row.manufacturerCode === line.manufacturerCode);
    if (product) {
      const models = await configurationApi.productModels(product.id);
      return { ...product, configurable: models.some(model => model.active && !model.obsolete &&
        model.kind !== "enclosure" && model.kind !== "support") };
    }
    if (!matches.hasMore || matches.products.length === 0) return null;
    offset += matches.products.length;
  }
}

/** The selected node and its ancestors, root first. */
export function manufacturerPath(nodes: readonly ManufacturerNode[], selectedId: number | null): ManufacturerNode[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const path: ManufacturerNode[] = [];
  for (let current: ManufacturerNode | undefined | null = selectedId === null ? null : byId.get(selectedId);
    current; current = current.parentId === null ? undefined : byId.get(current.parentId)) {
    path.unshift(current);
  }
  return path;
}

function branchTitle(node: ManufacturerNode): string {
  return `Nel ramo: ${node.articleCount} articoli${node.packageCount ? ` · ${node.packageCount} pacchetti` : ""}`;
}

/**
 * The selected node's path as a breadcrumb (Gamma › Tipologia › Famiglia): context for the results.
 * Every step selects that level; the current one is marked.
 */
export function BrowsePath({ nodes, selectedId, onSelect }: {
  nodes: readonly ManufacturerNode[]; selectedId: number | null; onSelect: (id: number) => void;
}) {
  const path = manufacturerPath(nodes, selectedId);
  if (path.length === 0) return <h2 className="catalogue-results-title">Articoli</h2>;
  return <nav aria-label="Percorso produttore" className="catalogue-path">
    <h2 className="visually-hidden">Articoli</h2>
    <ol>{path.map(node => <li key={node.id}>
      <button type="button" aria-current={selectedId === node.id ? "page" : undefined}
        title={manufacturerNodeLabel(node)} onClick={() => onSelect(node.id)}>{manufacturerNodeLabel(node)}</button>
    </li>)}</ol>
  </nav>;
}

/** Up/Down walk the visible rows, Right opens (then descends), Left closes (then climbs), Home/End jump. */
export function treeKeyTarget(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown": return Math.min(count - 1, index + 1);
    case "ArrowUp": return Math.max(0, index - 1);
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

/**
 * Produttori (docs/R17_VISUAL_DESIGN.md §4.2): the manufacturer hierarchy and the METEL statistical
 * families as one expandable tree over the existing `manufacturerNodes` data. Choosing a row browses
 * it and opens it; clicking the selected row toggles it. The chevron only opens or closes.
 */
export function BrowseNavigation({ nodes, selectedId, onSelect }: {
  nodes: readonly ManufacturerNode[]; selectedId: number | null; onSelect: (id: number | null) => void;
}) {
  const [brand, setBrand] = useState("");
  const presentation = useMemo(() => showcaseNavigation(nodes), [nodes]);
  const visibleNodes = useMemo(() => showcaseBrandNodes(presentation, brand), [presentation, brand]);
  const children = useMemo(() => {
    const byParent = new Map<number | null, ManufacturerNode[]>();
    for (const node of visibleNodes) {
      const siblings = byParent.get(node.parentId) ?? [];
      siblings.push(node); byParent.set(node.parentId, siblings);
    }
    return byParent;
  }, [visibleNodes]);
  const byId = useMemo(() => new Map(presentation.map(node => [node.id, node])), [presentation]);
  const pathIds = useMemo(() => {
    const ids: number[] = [];
    for (let node = selectedId === null ? undefined : byId.get(selectedId); node; node = node.parentId === null ? undefined : byId.get(node.parentId)) ids.unshift(node.id);
    return ids;
  }, [byId, selectedId]);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set(pathIds));
  const pathKey = pathIds.join("/");
  useEffect(() => {
    if (!pathKey) return;
    const ids = pathKey.split("/").map(Number);
    setExpanded(previous => ids.every(id => previous.has(id)) ? previous : new Set([...previous, ...ids]));
  }, [pathKey]);
  const toggle = (id: number) => setExpanded(previous => {
    const next = new Set(previous);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const choose = (node: ManufacturerNode) => {
    if (node.id === STATISTICAL_FAMILIES_GROUP || node.id === selectedId && children.get(node.id)?.length) {
      toggle(node.id);
      return;
    }
    onSelect(node.id);
    if (children.get(node.id)?.length) setExpanded(previous => new Set([...previous, node.id]));
  };
  const keyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const labels = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".tree-node-label")];
    const index = labels.findIndex(label => label === event.target);
    if (index < 0) return;
    const id = Number(labels[index]!.dataset["nodeId"]);
    const node = byId.get(id);
    const hasChildren = !!children.get(id)?.length;
    if (event.key === "ArrowRight" && hasChildren) {
      event.preventDefault();
      if (!expanded.has(id)) toggle(id); else labels[index + 1]?.focus();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (hasChildren && expanded.has(id)) toggle(id);
      else if (node?.parentId != null) labels.find(label => Number(label.dataset["nodeId"]) === node.parentId)?.focus();
      return;
    }
    const target = treeKeyTarget(event.key, index, labels.length);
    if (target === null) return;
    event.preventDefault();
    labels[target]?.focus();
  };
  const roots = children.get(null) ?? [];
  const brands = useMemo(() => [...new Set(nodes.map(node => node.brandMarchio))].sort(), [nodes]);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const visibleIds = new Set<number>();
  const visit = (node: ManufacturerNode) => {
    visibleIds.add(node.id);
    if (expanded.has(node.id)) (children.get(node.id) ?? []).forEach(visit);
  };
  roots.forEach(visit);
  // A collapsed selected branch must still leave a reachable tab stop. Arrow navigation remembers focus.
  const tabStop = focusedId !== null && visibleIds.has(focusedId) ? focusedId
    : [...pathIds].reverse().find(id => visibleIds.has(id)) ?? roots[0]?.id;
  const row = (node: ManufacturerNode, depth: number): ReactNode => {
    const kids = children.get(node.id) ?? [];
    const open = kids.length > 0 && expanded.has(node.id);
    const selected = node.id !== STATISTICAL_FAMILIES_GROUP && node.id === selectedId;
    const label = manufacturerNodeLabel(node);
    return <li key={node.id} role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={selected}>
      <div className="catalogue-tree-row" data-selected={selected ? "true" : undefined}
        style={{ paddingLeft: 4 + depth * 14, "--tree-depth": depth } as CSSProperties}>
        {kids.length ? <button type="button" className="tree-toggle" tabIndex={-1}
          aria-label={`${open ? "Comprimi" : "Espandi"} ${label}`} onClick={() => toggle(node.id)}>
          <Icon name={open ? "chevronDown" : "chevronRight"} className="librequadri-icon-small" /></button>
          : <span className="tree-toggle" aria-hidden="true" />}
        <button type="button" className="tree-node-label" data-node-id={node.id} tabIndex={node.id === tabStop ? 0 : -1}
          title={label} data-full-text={label} onFocus={() => setFocusedId(node.id)} onClick={() => choose(node)}>
          <strong>{label}</strong>
          <small title={branchTitle(node)}>{node.articleCount ? formatCount(node.articleCount) : null}
            {node.packageCount ? <span className="tree-packages"><Icon name="package" className="librequadri-icon-small" />
              {formatCount(node.packageCount)}</span> : null}</small>
        </button>
      </div>
      {open ? <ul role="group">{kids.map(child => row(child, depth + 1))}</ul> : null}
    </li>;
  };
  return <section className="catalogue-pane catalogue-navigation" aria-label="Navigazione produttore">
    <header><h2>Produttori</h2>
      <select className="catalogue-brand-select" aria-label="Marchio" value={brand} onChange={event => {
        setBrand(event.target.value); onSelect(null);
      }}><option value="">Tutti i marchi</option>{brands.map(value =>
        <option key={value} value={value}>{value}</option>)}</select>
    </header>
    {roots.length ? <ul className="catalogue-tree" role="tree" aria-label="Gamme e famiglie" onKeyDown={keyDown}>
      {roots.map(node => row(node, 0))}</ul> : <p className="hint">Nessuna navigazione disponibile.</p>}
  </section>;
}

const MemoizedBrowseNavigation = memo(BrowseNavigation);

export function BrowseFacets({ facets, brands, configurability, attributes, onBrand, onConfigurable,
  onAttribute, busy = false }: {
  facets: CatalogueBrowseResult["facets"]; busy?: boolean;
  brands: readonly string[]; configurability: readonly boolean[];
  attributes: Readonly<Record<string, readonly (string | number)[]>>;
  onBrand: (value: string) => void; onConfigurable: (value: boolean) => void;
  onAttribute: (code: string, value: string | number) => void;
}) {
  const [openFacet, setOpenFacet] = useState<string | null>(null);
  const facetsRef = useRef<HTMLDivElement>(null);
  const barId = useId();
  const [scroll, setScroll] = useState({ left: 0, width: 0, total: 0 });
  const drag = useRef<{ x: number; left: number } | null>(null);
  const measureScroll = useCallback(() => {
    const bar = facetsRef.current;
    if (!bar) return;
    const next = { left: bar.scrollLeft, width: bar.clientWidth, total: bar.scrollWidth };
    setScroll(previous => previous.left === next.left && previous.width === next.width && previous.total === next.total ? previous : next);
  }, []);
  const frame = useRef<number | null>(null);
  const scheduleMeasure = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => { frame.current = null; measureScroll(); });
  }, [measureScroll]);
  const sortedAttributes = useMemo(() => facets.attributes.map(attribute => ({ ...attribute,
    values: [...attribute.values].sort((a, b) => typeof a.value === "number" && typeof b.value === "number" ? a.value - b.value : 0),
  })), [facets.attributes]);
  useLayoutEffect(() => {
    measureScroll();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    if (facetsRef.current) {
      observer?.observe(facetsRef.current);
      for (const child of facetsRef.current.children) observer?.observe(child);
    }
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      observer?.disconnect(); window.removeEventListener("resize", scheduleMeasure);
      if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    };
  }, [facets, measureScroll, scheduleMeasure]);
  useEffect(() => {
    if (openFacet === null) return;
    const dismiss = (event: PointerEvent) => {
      if (!facetsRef.current?.contains(event.target as Node) && !(event.target as Element).closest?.(".catalogue-facet-options")) setOpenFacet(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [openFacet]);
  const toggleFacet = useCallback((code: string) => setOpenFacet(current => nextOpenFacet(current, code)), []);
  const closeFacet = useCallback(() => setOpenFacet(null), []);
  return <div className="catalogue-facets-shell"><div id={barId} onScroll={scheduleMeasure} className="catalogue-facets" aria-label="Filtri articoli" ref={facetsRef} aria-busy={busy || undefined} onKeyDown={event => {
    if (event.key !== "Escape" || openFacet === null) return;
    event.preventDefault(); event.stopPropagation();
    facetsRef.current?.querySelector<HTMLElement>("details[open] > summary")?.focus();
    setOpenFacet(null);
  }}>
    {facets.brand ? <FacetGroup id="brand" label="Marchio" selectedCount={brands.length} open={openFacet === "brand"}
      onToggle={toggleFacet} onClose={closeFacet} counts={facets.brand.values}
      note="Nessun articolo di questo ramo corrisponde agli altri filtri.">
      {() => facets.brand!.values.map(entry => <FacetOption key={entry.value} label={entry.value} count={entry.count}
        checked={brands.includes(entry.value)} onChange={() => onBrand(entry.value)} />)}</FacetGroup> : null}
    {facets.configurability ? <FacetGroup id="configurability" label="Configurabilità" selectedCount={configurability.length}
      open={openFacet === "configurability"} onToggle={toggleFacet} onClose={closeFacet} counts={facets.configurability.values}
      note="Nessun articolo di questo ramo corrisponde agli altri filtri.">
      {() => facets.configurability!.values.map(entry => <FacetOption key={String(entry.value)}
        label={entry.value ? "Configurabile" : "Ordinario"} count={entry.count}
        checked={configurability.includes(entry.value)} onChange={() => onConfigurable(entry.value)} />)}</FacetGroup> : null}
    {sortedAttributes.map(attribute => <FacetGroup key={attribute.code} id={`attribute:${attribute.code}`}
      label={attribute.name} selectedCount={(attributes[attribute.code] ?? []).length}
      open={openFacet === `attribute:${attribute.code}`} onToggle={toggleFacet} onClose={closeFacet} counts={attribute.values}
      note={attribute.applicable ? "Nessun articolo di questo ramo corrisponde agli altri filtri."
        : "Non applicabile agli articoli di questo ramo."}>
      {() => attribute.values.map(entry => <FacetOption key={`${typeof entry.value}:${entry.value}`}
        label={formatAttributeValue(entry.value, attribute.unit, entry.label)} count={entry.count}
        checked={(attributes[attribute.code] ?? []).includes(entry.value)}
        onChange={() => onAttribute(attribute.code, entry.value)} />)}</FacetGroup>)}
  </div>
    {scroll.total > scroll.width ? <div className="catalogue-filter-scrollbar" role="scrollbar" tabIndex={0}
      aria-label="Scorri filtri articoli" aria-controls={barId} aria-orientation="horizontal" aria-valuemin={0}
      aria-valuemax={scroll.total - scroll.width} aria-valuenow={Math.round(scroll.left)}
      onKeyDown={event => {
        const bar = facetsRef.current!;
        const next = event.key === "Home" ? 0 : event.key === "End" ? scroll.total :
          event.key === "ArrowRight" ? bar.scrollLeft + 80 : event.key === "ArrowLeft" ? bar.scrollLeft - 80 : null;
        if (next !== null) { event.preventDefault(); bar.scrollLeft = next; }
      }} onPointerDown={event => {
        const bar = facetsRef.current!, track = event.currentTarget;
        const rect = track.getBoundingClientRect();
        if (event.target === track) bar.scrollLeft = (event.clientX - rect.left) / rect.width * scroll.total - scroll.width / 2;
        drag.current = { x: event.clientX, left: bar.scrollLeft };
        track.setPointerCapture(event.pointerId);
      }} onPointerMove={event => {
        if (!drag.current) return;
        facetsRef.current!.scrollLeft = drag.current.left + (event.clientX - drag.current.x) * scroll.total / event.currentTarget.clientWidth;
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <div className="catalogue-filter-scrollbar-thumb" style={{ width: `${scroll.width / scroll.total * 100}%`,
        left: `${scroll.left / scroll.total * 100}%` }} />
    </div> : null}
  </div>;
}

/**
 * One facet of the bar. A facet whose options all have no matching article stays visible and greyed, and still
 * opens to say why; an active one stays highlighted so a selection that no longer matches is never hidden.
 */
function FacetGroup({ id, label, selectedCount, open, onToggle, onClose, counts, note, children }: {
  id: string; label: string; selectedCount: number; open: boolean; onToggle: (id: string) => void; onClose: () => void;
  counts: readonly { readonly count: number }[]; note: string; children: () => ReactNode;
}) {
  const anchor = useRef<HTMLElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const button = anchor.current, panel = popup.current;
      if (!button || !panel) return;
      const rect = button.getBoundingClientRect();
      const bar = button.closest(".catalogue-facets")!.getBoundingClientRect();
      if (rect.width && (rect.right <= Math.max(0, bar.left) || rect.left >= Math.min(innerWidth, bar.right) || rect.bottom <= 0 || rect.top >= innerHeight)) {
        onClose(); return;
      }
      const below = Math.max(0, innerHeight - rect.bottom - 12), above = Math.max(0, rect.top - 12);
      const up = below < Math.min(260, panel.scrollHeight) && above > below;
      const height = Math.min(260, panel.scrollHeight + 2, up ? above : below);
      // Measure intrinsic width, independent of the previously constrained popover width.
      const previousWidth = panel.style.width;
      panel.style.width = "max-content";
      const width = Math.min(Math.max(180, panel.getBoundingClientRect().width), Math.max(0, innerWidth - 16));
      panel.style.width = previousWidth;
      setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)), width,
        top: up ? Math.max(8, rect.top - height - 4) : Math.max(8, rect.bottom + 4), maxHeight: height });
    };
    update();
    let frame: number | null = null;
    const schedule = (event?: Event) => {
      if (event?.target instanceof Node && panelContains(event.target)) return;
      if (frame === null) frame = requestAnimationFrame(() => { frame = null; update(); });
    };
    const panelContains = (target: Node) => popup.current?.contains(target);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule());
    observer?.observe(anchor.current!); observer?.observe(anchor.current!.closest(".catalogue-facets")!);
    window.addEventListener("resize", schedule); document.addEventListener("scroll", schedule, true);
    return () => {
      observer?.disconnect(); window.removeEventListener("resize", schedule); document.removeEventListener("scroll", schedule, true);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [open, onClose, counts, selectedCount]);
  const unavailable = counts.every(entry => entry.count === 0);
  return <details open={open} data-active={selectedCount ? "true" : undefined}
    data-unavailable={unavailable ? "true" : undefined}>
    <summary ref={anchor} aria-expanded={open} onKeyDown={event => {
      if (open && (event.key === "ArrowDown" || event.key === "Tab" && !event.shiftKey)) {
        const first = popup.current?.querySelector<HTMLInputElement>("input:not(:disabled)");
        if (first) { event.preventDefault(); first.focus(); }
      }
    }} title={unavailable ? `${label}: ${note}` : label}
      onClick={event => { event.preventDefault(); onToggle(id); }}>
      {label}{selectedCount ? ` (${selectedCount})` : ""}</summary>
    {open ? createPortal(<div ref={popup} className="catalogue-facet-options" style={position}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); anchor.current?.focus(); onClose(); }
        if (event.key === "Tab") {
          const inputs = [...popup.current!.querySelectorAll<HTMLInputElement>("input:not(:disabled)")];
          if (event.shiftKey && event.target === inputs[0]) { event.preventDefault(); anchor.current?.focus(); }
          else if (!event.shiftKey && event.target === inputs.at(-1)) {
            anchor.current?.focus(); onClose();
          }
        }
      }}>
      {unavailable ? <p className="catalogue-facet-note">{note}</p> : null}
      {children()}</div>, document.body) : null}</details>;
}

/** Only selectable options are shown; selected zero-count values remain removable. */
function FacetOption({ label, count, checked, onChange }: {
  label: string; count: number; checked: boolean; onChange: () => void;
}) {
  if (count === 0 && !checked) return null;
  return <label title={checked && count === 0 ? "Nessun articolo corrisponde: deseleziona per rimuovere il filtro" : undefined}>
    <input type="checkbox" checked={checked} onChange={onChange} />
    {label} <small>{count}</small></label>;
}

/**
 * Scheda articolo for a browsed article or an ordinary project line (docs/R17_VISUAL_DESIGN.md
 * §4.2). A configurable article opens its configuration on Configura; `configuration` then
 * renders the whole Scheda from the same identity and quantity.
 */
export function ArticleInspector({ product, line, quantity, busy, onQuantity, onAdd, onConfigure,
  configuration, projectOpen = true, lookupPending = false, projectQuantity }: {
  product: CatalogueBrowseProduct | null; line?: ProjectQuotationLine | null; quantity: string; busy: boolean;
  onQuantity: (value: string) => void; onAdd: () => void; onConfigure: () => void;
  configuration?: (slots: { lead: ReactNode; quantity: SchedaQuantity }) => ReactNode;
  projectOpen?: boolean; lookupPending?: boolean;
  /** How many of this article the project already holds (Distinta quantity); shown as a project tag. */
  projectQuantity?: number;
}) {
  if (!product && !line) return <SchedaFrame>
    <p className="scheda-empty">Seleziona un articolo dall’elenco per vedere la scheda.</p></SchedaFrame>;
  const amount: SchedaQuantity = line ? { kind: "project", quantity: line.quantity } :
    { kind: "new", value: quantity, onChange: onQuantity };
  const lead = product ? <>
    <SchedaIdentity {...productIdentity(product)} title={product.description ?? "Descrizione non disponibile"}
      tags={<><ProjectQuantityTag quantity={line ? undefined : projectQuantity} /><ProductTags product={product} /></>} />
    <ProductAttributes product={product} />
  </> : <>
    <SchedaIdentity code={line!.lineType === "product" ? `${line!.brandMarchio} · ${line!.manufacturerCode}` : null}
      title={line!.description ?? "Descrizione non disponibile"} />
    {lookupPending ? <p className="scheda-hint">Ricerca dell’articolo nel catalogo corrente…</p> :
      <SchedaNotice tone="warn">Articolo non disponibile nel catalogo corrente.</SchedaNotice>}
  </>;
  if (configuration && product?.configurable) return configuration({ lead, quantity: amount });
  const accepted = quantityAccepted(amount);
  const action = product?.configurable ? <button type="button" className="primary"
    disabled={busy || !accepted} onClick={onConfigure}>Configura</button> :
    line ? null : <button type="button" className="primary"
      disabled={busy || !accepted || !product || !projectOpen} onClick={onAdd}>Aggiungi al progetto</button>;
  return <SchedaFrame footer={<SchedaFooter quantity={amount} busy={busy} action={action}
    notes={[!line && !projectOpen ? "Crea o apri un progetto per aggiungere l’articolo." : null]} />}>
    {lead}
    {product?.configurable ? <p className="scheda-hint">Usa Configura per scegliere le opzioni e gli accessori
      prima di aggiungerlo al progetto.</p> : null}
  </SchedaFrame>;
}

/** The configured project item's own snapshot identity: model name and primary article, never its model code. */
export function ConfiguredItemIdentity({ item, placed }: { item: ProjectConfiguredItem; placed: boolean }) {
  const primary = item.bom.find(row => row.role === "primary");
  return <SchedaIdentity code={primary ? `${primary.brandMarchio} · ${primary.manufacturerCode}` : item.modelBrandMarchio}
    title={item.modelName || "Configurazione senza nome"}
    tags={<><SchedaTag tone="project">Configurato</SchedaTag>{placed ? <SchedaTag tone="project">Posizionato</SchedaTag> : null}</>} />;
}

/** Packages arrive in navigation-tree order; consecutive rows of one holding node form a group. */
export function packageGroups(packages: readonly CatalogueBrowsePackage[]) {
  const groups: { groupId: number; path: readonly string[]; items: CatalogueBrowsePackage[] }[] = [];
  for (const item of packages) {
    const last = groups[groups.length - 1];
    if (last && last.groupId === item.groupId) last.items.push(item);
    else groups.push({ groupId: item.groupId, path: item.groupPath, items: [item] });
  }
  return groups;
}

/** At most this many attribute columns; narrower lists hide the later ones (container query). */
export const ATTRIBUTE_COLUMN_LIMIT = 5;

export type AttributeColumn = Pick<CatalogueBrowseResult["facets"]["attributes"][number], "code" | "name" | "unit">;

/**
 * The browse's own applicable attribute facets, in their order, become the result columns: never invented
 * attributes, and never a column for a facet that stays in the filter bar only because a parent offers it.
 */
export function attributeColumns(facets: CatalogueBrowseResult["facets"] | null): readonly AttributeColumn[] {
  return (facets?.attributes ?? []).filter(attribute => attribute.applicable).slice(0, ATTRIBUTE_COLUMN_LIMIT)
    .map(({ code, name, unit }) => ({ code, name, unit }));
}

function projectKey(brandMarchio: string, manufacturerCode: string): string {
  return `${brandMarchio}\u0000${manufacturerCode}`;
}

/** How many of each article the project already holds: the Distinta quantities (ordinary lines and configured BOMs). */
export function projectQuantities(project: Pick<ProjectDocumentView, "distinta"> | null): ReadonlyMap<string, number> {
  const quantities = new Map<string, number>();
  for (const row of project?.distinta ?? []) {
    const key = projectKey(row.brandMarchio, row.manufacturerCode);
    quantities.set(key, (quantities.get(key) ?? 0) + row.quantity);
  }
  return quantities;
}

const quantityFormat = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 });
const PROJECT_TAG_TITLE = "Quantità di questo articolo nella distinta del progetto";

export function ProjectQuantityTag({ quantity }: { quantity: number | undefined }) {
  return quantity ? <span className="librequadri-tag" data-tone="project" title={PROJECT_TAG_TITLE}>
    {quantityFormat.format(quantity)} nel progetto</span> : null;
}

export function BrowseProductList({ nodeId, browse, selectedId, onSelect, onMore, onRetry,
  selectedPackageId = null, onSelectPackage, inProject, onQuickAdd, onQuickAddPackage }: {
  nodeId: number | null; browse: BrowseState; selectedId: number | null;
  onSelect: (id: number) => void; onMore: () => void; onRetry: () => void;
  selectedPackageId?: number | null; onSelectPackage?: (modelId: number) => void;
  onQuickAdd?: (product: CatalogueBrowseProduct) => void;
  onQuickAddPackage?: (item: CatalogueBrowsePackage, undecided: boolean) => void;
  /** Distinta quantity per article ({@link projectQuantities}). */
  inProject?: ReadonlyMap<string, number>;
}) {
  const undecidedPackages = browse.undecidedPackages ?? [];
  const columns = attributeColumns(browse.facets);
  // Without attribute facets the attributes stay readable as one text column, as before.
  const textAttributes = columns.length === 0 && browse.products.some(product => product.attributes.length > 0);
  const attributeCells = (product: CatalogueBrowseProduct | null) => textAttributes
    ? <small className="article-attributes" title={product ? attributesText(product) : undefined}>
      {product ? attributesText(product) : "—"}</small>
    : columns.map((column, index) => {
      const attribute = product?.attributes.find(entry => entry.code === column.code);
      const value = attribute ? formatAttributeValue(attribute.value, attribute.unit, attribute.label) : null;
      return <span key={column.code} className="article-attribute" data-column={index}
        title={value ? `${column.name}: ${value}` : undefined}>{value ?? "—"}</span>;
    });
  return <div className="catalogue-article-list" aria-live="polite">
    {nodeId === null ? <p className="hint">Scegli una gamma o una famiglia statistica per vedere gli articoli.</p> : null}
    {browse.status === "loading" ? <p className="hint">Caricamento articoli…</p> : null}
    {browse.status === "error" ? <p className="error" role="alert">Articoli non disponibili.
      <button type="button" onClick={onRetry}>Riprova</button></p> : null}
    {browse.packageOffersStale ? <p className="hint catalogue-offers-stale" role="status">I dati di ingegneria sono obsoleti:
      reimporta il catalogo. I pacchetti non possono essere filtrati per caratteristiche tecniche.</p> : null}
    {browse.status === "ready" && browse.products.length === 0 && browse.packages.length === 0 && !undecidedPackages.length ?
      <p className="hint">Nessun articolo corrisponde ai filtri.</p> : null}
    {browse.products.length || browse.packages.length || undecidedPackages.length ? <div className="catalogue-result-head" aria-hidden="true">
      <span className="article-identity">Articolo</span>
      {textAttributes ? <span className="article-attributes">Attributi</span> : columns.map((column, index) =>
        <span key={column.code} className="article-attribute" data-column={index} title={column.name}>{column.name}</span>)}
      <span className="article-status">Stato</span>
    </div> : null}
    {browse.packages.length ? <>
      <h3 className="catalogue-list-heading" title="Configurazioni senza un codice articolo proprio: le opzioni si scelgono nella scheda e generano la distinta degli articoli">
        Pacchetti <small>{browse.packageCount}</small>
        <span className="catalogue-list-note">da configurare · generano più articoli</span></h3>
      {packageGroups(browse.packages).map(group => <Fragment key={`group-${group.groupId}`}>
        {group.path.length ? <div className="catalogue-package-group" title={group.path.join(" › ")}>
          {group.path.length > 1 ? <span>{group.path.slice(0, -1).join(" › ")} › </span> : null}
          <strong>{group.path[group.path.length - 1]}</strong></div> : null}
        {group.items.map(item => <button key={`package-${item.modelId}`} type="button"
          className="catalogue-article catalogue-package" aria-pressed={selectedPackageId === item.modelId}
          title={[item.name, ...item.groupPath].join(" — ")} onClick={() => onSelectPackage?.(item.modelId)}
          onDoubleClick={onQuickAddPackage && (() => onQuickAddPackage(item, false))}>
          <span className="article-identity"><strong className="article-description">{item.name}</strong>
            <small className="package-context">{item.brandMarchio} · Pacchetto</small></span>
          {attributeCells(null)}<span className="article-status"><span className="librequadri-tag">Configurabile</span></span>
        </button>)}
      </Fragment>)}
      {browse.packageCount > browse.packages.length ? <p className="hint">Mostrati {browse.packages.length} pacchetti
        su {browse.packageCount}: restringi la ricerca.</p> : null}
      {browse.products.length ? <h3 className="catalogue-list-heading">Articoli</h3> : null}
    </> : null}
    {undecidedPackages.length ? <details className="catalogue-undecided-packages">
      <summary>Non valutabili con questi filtri ({undecidedPackages.length})</summary>
      <p className="hint">La verifica tecnica non è conclusa. Questi pacchetti non sono inclusi nei risultati o nei conteggi.</p>
      {undecidedPackages.map(item => <button key={`undecided-${item.modelId}`} type="button"
        className="catalogue-article catalogue-package" aria-pressed={selectedPackageId === item.modelId}
        onClick={() => onSelectPackage?.(item.modelId)}
        onDoubleClick={onQuickAddPackage && (() => onQuickAddPackage(item, true))}>
        <span className="article-identity"><strong className="article-description">{item.name}</strong>
          <small className="package-context">{item.brandMarchio} · Non valutabile</small></span>
        {attributeCells(null)}<span className="article-status"><span className="librequadri-tag">Da verificare</span></span>
      </button>)}
    </details> : null}
    {browse.products.map(product => <button key={product.id} type="button"
      className={`catalogue-article${product.isListed ? "" : " is-delisted"}`}
      aria-pressed={selectedId === product.id} onClick={() => onSelect(product.id)}
      onDoubleClick={onQuickAdd && (() => onQuickAdd(product))}>
      <span className="article-identity"><strong className="article-description"
        title={product.description ?? "Descrizione non disponibile"}>
        {product.description ?? "Descrizione non disponibile"}</strong>
        <small className="article-code" title={`${product.brandMarchio} · ${product.manufacturerCode}`}>
          {product.brandMarchio} · {product.manufacturerCode}</small></span>
      {attributeCells(product)}
      <span className="article-status">
        <ProjectQuantityTag quantity={inProject?.get(projectKey(product.brandMarchio, product.manufacturerCode))} />
        {product.isListed ? product.configurable ? <span className="librequadri-tag">Configurabile</span> : null :
          <span className="librequadri-tag" data-tone="muted">Fuori listino</span>}</span>
    </button>)}
    {(browse.status === "ready" || browse.status === "loading-more") &&
      (browse.totalCount > 0 || browse.hasMore) ? <footer className="catalogue-result-footer">
      <span>Mostrati {browse.products.length} di {browse.totalCount} articoli</span>
      {browse.hasMore ? <button type="button" className="more" disabled={browse.status !== "ready"}
        onClick={onMore}>{browse.status === "loading-more" ? "Caricamento…" : "Mostra altri"}</button> : null}
    </footer> : null}
  </div>;
}

/**
 * Catalogue controller shared by Apparecchi's two docks: preserve browsing and inspector state
 * while the drawing stays mounted. The standalone composition is retained for component previews.
 * A project line opened from Distinta is edited in the same inspector as a browsed article.
 */
export function CatalogueScreen({ api, configurationApi, projectApi, project, onProjectChange, view, onViewChange,
  activeLineUuid, onActiveLineChange, onShowQuotation, actionQueue, renderDocked, autoPlace = false }: {
  readonly api: CatalogueApi; readonly configurationApi: ConfigurationApi; readonly projectApi: ProjectApi;
  readonly project: ProjectDocumentView | null; readonly onProjectChange: (project: ProjectDocumentView) => void;
  readonly view: CatalogueView; readonly onViewChange: (view: CatalogueView) => void;
  /** Project line in the inspector; owned by the shell when given. */
  readonly activeLineUuid?: string | null; readonly onActiveLineChange?: (lineUuid: string | null) => void;
  /** Reopen Distinta while a project line is selected. */
  readonly onShowQuotation?: () => void;
  /** Project writes shared with the other workspaces, so they publish in invocation order. */
  readonly actionQueue?: ProjectActionQueue;
  readonly autoPlace?: boolean;
  /** Compose the existing browser and inspector around the persistent drawing. */
  readonly renderDocked?: (navigation: ReactNode, results: ReactNode, details: ReactNode) => ReactNode;
}) {
  const [nodes, setNodes] = useState<readonly ManufacturerNode[]>([]);
  const [navigationStatus, setNavigationStatus] = useState<"loading" | "ready" | "error">("loading");
  const [nodeId, setNodeId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [listedOnly, setListedOnly] = useState(false);
  const [brands, setBrands] = useState<readonly string[]>([]);
  const [configurability, setConfigurability] = useState<readonly boolean[]>([]);
  const [attributes, setAttributes] = useState<Readonly<Record<string, readonly (string | number)[]>>>({});
  const [browse, setBrowse] = useState(emptyBrowseState);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [localLineUuid, setLocalLineUuid] = useState<string | null>(null);
  const activeProjectLineUuid = activeLineUuid !== undefined ? activeLineUuid : localLineUuid;
  const setActiveProjectLineUuid = useCallback((lineUuid: string | null) => {
    if (onActiveLineChange) onActiveLineChange(lineUuid); else setLocalLineUuid(lineUuid);
  }, [onActiveLineChange]);
  const [projectProduct, setProjectProduct] = useState<{ lineUuid: string; product: CatalogueBrowseProduct | null } | null>(null);
  const [projectProductError, setProjectProductError] = useState(false);
  const [configureOpen, setConfigureOpen] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkedLines, setCheckedLines] = useState<ReadonlySet<string>>(new Set());
  const { announce } = useStatusActions();
  const quickAdd = useQuickAdd();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const panels = useSidePanels("catalogue");
  const ownQueue = useMemo(() => new ProjectActionQueue(), []);
  const queue = actionQueue ?? ownQueue;
  const pendingActions = useRef(0);
  const session = useMemo(() => new BrowseSession(api, setBrowse), [api]);
  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    let live = true;
    setNavigationStatus("loading");
    api.manufacturerNodes().then(value => { if (live) { setNodes(value); setNavigationStatus("ready"); } },
      () => { if (live) setNavigationStatus("error"); });
    return () => { live = false; };
  }, [api]);
  const selectedBrand = nodes.find(node => node.id === nodeId)?.brandMarchio;
  const branchModelIds = useCallback(async (productId: number) => {
    const positions = await api.manufacturerPositions(productId);
    const matches = new Set<number>();
    for (const position of positions) {
      if (position.modelId !== null && manufacturerPath(nodes, position.nodeId).some(node => node.id === nodeId)) {
        matches.add(position.modelId);
      }
    }
    return matches;
  }, [api, nodes, nodeId]);
  const visibleAttributes = useMemo(() => presentedAttributes(attributes, selectedBrand), [attributes, selectedBrand]);
  const presentedFacets = useMemo(() => browse.facets ? { ...browse.facets,
    attributes: browse.facets.attributes.filter(attribute => visibleTechnicalFilter(selectedBrand, attribute.code)),
  } : null, [browse.facets, selectedBrand]);
  const filters = useMemo(() => attributeRequest(visibleAttributes), [visibleAttributes]);
  useEffect(() => {
    setSelectedId(null); setSelectedPackageId(null);
    session.select(nodeId === null ? null : {
      nodeId, query: query.trim(), listedOnly, brandMarchio: brands, configurable: configurability,
      attributeFilters: filters,
    });
  }, [session, nodeId, query, listedOnly, brands, configurability, filters]);
  // A project line opened for editing replaces a browsed package and opens its configuration.
  useEffect(() => {
    if (activeProjectLineUuid === null) return;
    setProjectProductError(false); setSelectedPackageId(null); setConfigureOpen(true);
  }, [activeProjectLineUuid]);
  const activeLineIndex = project?.lines.findIndex(line => line.uuid === activeProjectLineUuid) ?? -1;
  const activeLine = activeLineIndex >= 0 ? project!.lines[activeLineIndex]! : null;
  const activeItem = activeLine?.itemUuid ? project?.configuredItems.find(item =>
    item.uuid === activeLine.itemUuid) : null;
  const activeItemPlaced = !!activeItem && placedItemUuids(project?.physicalNodes ?? []).has(activeItem.uuid);
  useEffect(() => {
    if (!activeLine || activeLine.lineType !== "product") return;
    let live = true;
    setProjectProduct(null); setProjectProductError(false);
    projectCatalogueProduct(api, configurationApi, activeLine).then(found => {
      if (live) setProjectProduct({ lineUuid: activeLine.uuid, product: found });
    }, () => { if (live) setProjectProductError(true); });
    return () => { live = false; };
  }, [api, configurationApi, activeLine?.uuid]);
  const inProject = useMemo(() => projectQuantities(project), [project]);
  const selectNode = useCallback((id: number | null) => {
    // Search and filter selections belong to the user, not to the node: they survive navigation.
    setNodeId(id);
    setSelectedId(null); setSelectedPackageId(null); setQuantity("1");
    setActiveProjectLineUuid(null); setProjectProductError(false); setConfigureOpen(false);
  }, [setActiveProjectLineUuid]);
  const selected = activeLine ? projectProduct?.lineUuid === activeLine.uuid ? projectProduct.product : null :
    browse.products.find(product => product.id === selectedId) ?? null;
  const selectedPackage = [...browse.packages, ...(browse.undecidedPackages ?? [])].find(item => item.modelId === selectedPackageId) ?? null;
  const selectedPackageUndecided = !!selectedPackage && (browse.undecidedPackages ?? []).some(item => item.modelId === selectedPackage.modelId);
  const resultCount = [`${formatCount(browse.totalCount)} ${browse.totalCount === 1 ? "articolo" : "articoli"}`,
    browse.packageCount ? `${browse.packageCount} ${browse.packageCount === 1 ? "pacchetto" : "pacchetti"}` : ""]
    .filter(Boolean).join(" · ");
  const activeFilters = query.trim() || listedOnly || brands.length || configurability.length ||
    Object.values(visibleAttributes).some(values => values.length);
  const runProjectAction = async (action: () => Promise<ProjectDocumentView | null>,
    onError: (message: string) => void = setProjectError): Promise<boolean> => {
    pendingActions.current++; setBusy(true); setProjectError(null);
    try { return await queue.enqueue(action, onProjectChange, onError); }
    finally { pendingActions.current--; if (pendingActions.current === 0) setBusy(false); }
  };
  useEffect(() => {
    const present = new Set(project?.lines.map(line => line.uuid) ?? []);
    setCheckedLines(previous => {
      const next = new Set([...previous].filter(uuid => present.has(uuid)));
      return next.size === previous.size ? previous : next;
    });
  }, [project?.lines]);
  /** A rejected quantity keeps the field on the saved value and reports the reason there, not in the page banner. */
  const changeQuantity = async (line: ProjectQuotationLine, next: number) => {
    let message = "Quantità non aggiornata.";
    const ok = await runProjectAction(() => projectApi.setQuantity(line.uuid, next), reason => { message = reason; });
    if (!ok) throw new Error(message);
  };
  const removeLines = (lineUuids: readonly string[]) => {
    if (lineUuids.length === 0) return;
    void runProjectAction(() => projectApi.removeLines(lineUuids)).then(ok => {
      if (!ok) return;
      setCheckedLines(previous => new Set([...previous].filter(uuid => !lineUuids.includes(uuid))));
      if (activeProjectLineUuid && lineUuids.includes(activeProjectLineUuid)) setActiveProjectLineUuid(null);
      announce(lineUuids.length === 1 ? "Riga rimossa dal progetto." : `${lineUuids.length} righe rimosse dal progetto.`, "ok");
    });
  };
  const added = (description: string | null, count: number) =>
    announce(`Aggiunto al progetto: ${description ?? "articolo"}${count > 1 ? ` × ${count}` : ""}.`, "ok");
  const selectResult = (id: number, isPackage = false) => {
    setSelectedId(isPackage ? null : id);
    setSelectedPackageId(isPackage ? id : null);
    setQuantity("1");
    setActiveProjectLineUuid(null);
    setProjectProductError(false);
    setConfigureOpen(false);
  };
  const quickAddResult = (product: CatalogueBrowseProduct | CatalogueBrowsePackage, undecided = false) => {
    const isPackage = "modelId" in product;
    selectResult(isPackage ? product.modelId : product.id, isPackage);
    if (!isPackage && product.configurable) setConfigureOpen(true);
    quickAdd?.(isPackage ? product.name : product.description ?? product.manufacturerCode, async api => {
      if (!isPackage && !product.configurable) return api.addCatalogueProduct(product.id, 1, true);
      if (undecided) return null;
      let request;
      if (isPackage) {
        let options: readonly number[] = [];
        if (product.offerNo !== undefined) {
          const offer = await configurationApi.offerSelection?.(product.modelId, product.offerNo);
          if (offer?.status !== "ready") return null;
          options = offer.selectedOptionIds;
        }
        request = configurationRequest(product.modelId, options);
      } else {
        const models = articleModels(await configurationApi.productModels(product.id));
        const model = await preferredArticleModel(models, product.id, branchModelIds);
        if (!model) return null;
        request = configurationRequest(model.id, [], product.id);
      }
      const result = await configurationApi.resolve(request);
      if (!configurationCanBeAdded(result) || !result.model.active || result.model.obsolete) return null;
      const accepted = confirmCatalogueAddition(request, result);
      if (!accepted) return null;
      return autoPlace && result.model.kind === "device" && result.physical
        ? api.addConfiguredItem(accepted, 1, true, true) : api.addConfiguredItem(accepted, 1, true);
    });
  };
  if (!renderDocked && view === "configuration") return <div className="catalogue-configuration">
    <button type="button" onClick={() => onViewChange("manufacturer")}>← Torna al Catalogo</button>
    <ConfigurationScreen api={configurationApi} projectOpen={project !== null}
      onAdd={async request => { const updated = await projectApi.addConfiguredItem(request, 1);
        onProjectChange(updated); setProjectError(null); onViewChange("manufacturer"); }} />
  </div>;
  const navigation = (<div className="catalogue-navigation-slot">{navigationStatus === "loading" ? <p className="hint">Caricamento navigazione…</p> : null}
        {navigationStatus === "error" ? <p className="error" role="alert">Navigazione non disponibile.</p> : null}
        <MemoizedBrowseNavigation nodes={nodes} selectedId={nodeId} onSelect={selectNode} /></div>);
  const results = (<section className="catalogue-pane catalogue-results" aria-label="Articoli catalogo">
        <header className="catalogue-results-head">
          <BrowsePath nodes={nodes} selectedId={nodeId} onSelect={selectNode} />
          <span className="catalogue-results-count" title={nodeId === null ? "Seleziona un nodo" : resultCount}>
            {nodeId === null ? "Seleziona un nodo" : resultCount}</span>
        </header>
        <div className="catalogue-browse-controls">
          <label className="catalogue-search">
            <Icon name="search" className="librequadri-icon-small" />
            <input type="search" aria-label="Cerca articoli" placeholder="Cerca per codice o descrizione" value={query}
              maxLength={CATALOGUE_QUERY_MAX_LENGTH} disabled={nodeId === null}
              onChange={event => setQuery(event.target.value)} />
          </label>
          <label className="catalogue-listed"><input type="checkbox" checked={listedOnly} disabled={nodeId === null}
            onChange={event => setListedOnly(event.target.checked)} /> Solo a listino</label>
        </div>
        {presentedFacets ? <BrowseFacets facets={presentedFacets} busy={browse.status === "loading"} brands={brands} configurability={configurability}
          attributes={attributes} onBrand={value => setBrands(previous => toggleValue(previous, value))}
          onConfigurable={value => setConfigurability(previous => toggleValue(previous, value))}
          onAttribute={(code, value) => setAttributes(previous => ({ ...previous,
            [code]: toggleValue(previous[code] ?? [], value) }))} /> : null}
        {activeFilters ? <div className="catalogue-active-filters" aria-label="Filtri attivi">
          {query.trim() ? <button type="button" onClick={() => setQuery("")}>Ricerca: {query.trim()} ×</button> : null}
          {listedOnly ? <button type="button" onClick={() => setListedOnly(false)}>Solo a listino ×</button> : null}
          {brands.map(value => <button key={`brand-${value}`} type="button" onClick={() =>
            setBrands(previous => toggleValue(previous, value))}>Marchio: {value} ×</button>)}
          {configurability.map(value => <button key={`config-${value}`} type="button" onClick={() =>
            setConfigurability(previous => toggleValue(previous, value))}>
            {value ? "Configurabile" : "Ordinario"} ×</button>)}
          {Object.entries(visibleAttributes).flatMap(([code, values]) => values.map(value =>
            <button key={`${code}-${typeof value}-${value}`} type="button" onClick={() =>
              setAttributes(previous => ({ ...previous, [code]: toggleValue(previous[code] ?? [], value) }))}>
              {selectedAttributeText(browse.facets, code, value)} ×
            </button>))}
          <button type="button" className="catalogue-clear-filters" onClick={() => {
            setQuery(""); setListedOnly(false); setBrands([]); setConfigurability([]); setAttributes({});
          }}>Azzera filtri</button>
        </div> : null}
        <BrowseProductList nodeId={nodeId} browse={browse} selectedId={selectedId} inProject={inProject}
          onSelect={selectResult}
          selectedPackageId={selectedPackageId}
          onSelectPackage={id => selectResult(id, true)}
          onQuickAdd={quickAdd ? quickAddResult : undefined}
          onQuickAddPackage={quickAdd ? quickAddResult : undefined}
          onMore={() => session.more()}
          onRetry={() => session.select({ nodeId: nodeId!, query: query.trim(), listedOnly,
            brandMarchio: brands, configurable: configurability, attributeFilters: filters })} />
      </section>);
  const details = (<div className="catalogue-right">
        <div className="catalogue-scheda-slot" id="catalogue-scheda">
        {activeLine ? <div className="scheda-context" role="note">
          <span>Riga {activeLineIndex + 1} del progetto</span>
          {onShowQuotation ? <button type="button" onClick={onShowQuotation}>Apri Distinta</button> : null}
        </div> : null}
        {projectProductError ? <p className="error scheda-slot-error" role="alert">Catalogo corrente non disponibile.</p> : null}
        {activeItem && activeLine ? <ArticleConfiguration key={activeItem.uuid} api={configurationApi} item={activeItem}
          replacing busy={busy} canApply={true}
          lead={<><ConfiguredItemIdentity item={activeItem} placed={activeItemPlaced} />
            <SavedItemSnapshot item={activeItem} /></>}
          quantity={{ kind: "project", quantity: activeLine.quantity }}
          blockedReason={activeItemPlaced ? "Posizionato in Progettazione: rimuovi prima la posizione per cambiarne la configurazione." : null}
          onApply={request => void runProjectAction(() =>
            projectApi.replaceConfiguredItem(activeLine.uuid, request)).then(ok => {
              if (ok) { setActiveProjectLineUuid(null); announce("Configurazione della riga aggiornata.", "ok"); }
            })} />
        : selectedPackage && !activeLine ? <PackageInspector key={`${selectedPackage.modelId}-${selectedPackage.offerNo ?? "default"}`} api={configurationApi} item={selectedPackage}
          undecided={selectedPackageUndecided}
          projectOpen={project !== null} busy={busy} quantity={quantity} onQuantity={setQuantity}
          onAdd={request => { const parsed = validQuantity(quantity); if (parsed === null || !project) return;
            void runProjectAction(() => projectApi.addConfiguredItem(request, parsed)).then(ok => {
              if (ok) added(selectedPackage.name, parsed);
            }); }} /> :
        <ArticleInspector product={selected} line={activeLine} quantity={quantity} busy={busy} onQuantity={setQuantity}
          projectOpen={project !== null}
          projectQuantity={selected ? inProject.get(projectKey(selected.brandMarchio, selected.manufacturerCode)) : undefined}
          lookupPending={!!activeLine && activeLine.lineType === "product" && !projectProductError &&
            projectProduct?.lineUuid !== activeLine.uuid}
          onAdd={() => { if (selected && project) { const parsed = validQuantity(quantity)!;
            void runProjectAction(() => addOrdinaryQuantity(projectApi, selected, parsed)).then(ok => {
              if (ok) added(selected.description, parsed);
            }); } }}
          onConfigure={() => { if (selected?.configurable) setConfigureOpen(true); }}
          configuration={selected && selected.configurable ? slots =>
            <ArticleConfiguration key={`${selected.id}-${activeLine?.uuid ?? nodeId}`} api={configurationApi}
              branchModelIds={!activeLine && nodeId !== null ? branchModelIds : undefined}
              product={selected} replacing={!!activeLine} busy={busy} lead={slots.lead} quantity={slots.quantity}
              expanded={configureOpen || !!activeLine} onConfigure={() => setConfigureOpen(true)}
              canApply={!!project && (activeLine !== null || validQuantity(quantity) !== null)}
              onApply={request => { const parsed = activeLine ? null : validQuantity(quantity)!;
                void runProjectAction(() => activeLine ?
                  projectApi.replaceConfiguredItem(activeLine.uuid, request) :
                  projectApi.addConfiguredItem(request, parsed!)).then(ok => {
                    if (!ok) return;
                    setActiveProjectLineUuid(null); setConfigureOpen(false);
                    if (parsed === null) announce("Configurazione della riga aggiornata.", "ok");
                    else added(selected.description, parsed);
                  }); }} /> : undefined} />}
        </div>
        {project ? <ProjectComponents project={project} activeUuid={activeProjectLineUuid} checked={checkedLines}
          busy={busy} onActive={setActiveProjectLineUuid} onChecked={setCheckedLines}
          onQuantity={changeQuantity} onRemove={removeLines} /> : null}
      </div>);
  const errorNotice = projectError ? <p className="project-error error" role="alert">{projectError}</p> : null;
  if (renderDocked) return renderDocked(navigation, <>{errorNotice}{results}</>, details);
  return <div className="catalogue-host" ref={hostRef}>
    {errorNotice}
    <div className="catalogue-three-panel" ref={panels.ref} style={panels.style}>
      {navigation}{panels.divider("left")}{results}{panels.divider("right")}{details}
    </div>
    <FullTextTooltip scopeRef={hostRef} />
  </div>;
}
