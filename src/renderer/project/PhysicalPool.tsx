import type { PointerEvent } from "react";
import type { ProjectConfiguredItem } from "../../shared/project.js";
import { Icon } from "../ui/icons.js";
import { articleCode, availabilityText, frontSizeText, occupancyText, unitsToPlace } from "./design-presentation.js";
import { IDLE_GUIDANCE, type DragKind } from "./placement-drag.js";
import type { PoolEntry } from "./placement-workflow.js";

/** True when a unit of this entry can be picked up. Exhausted or physically unresolved items cannot. */
export function poolEntryDraggable(entry: PoolEntry, enabled: boolean): boolean {
  return enabled && entry.available > 0 && entry.item.physStatus === "resolved";
}

type DragStart = (kind: DragKind, item: ProjectConfiguredItem, event: PointerEvent<HTMLButtonElement>) => void;

function PoolList({ kind, entries, enabled, activeItemUuid, onSelect, onDragStart, onAutoPlace }: {
  kind: DragKind; entries: readonly PoolEntry[]; enabled: boolean;
  activeItemUuid: string | undefined; onSelect?: (item: ProjectConfiguredItem) => void; onDragStart: DragStart;
  onAutoPlace?: (item: ProjectConfiguredItem) => void;
}) {
  // Same-model configured variants (Q22) look alike in the row; their reveal tells them apart.
  const names = new Map<string, number>();
  for (const { item } of entries) names.set(item.modelName, (names.get(item.modelName) ?? 0) + 1);
  return <ul className="pool-list">{entries.map(entry => {
    const draggable = poolEntryDraggable(entry, enabled);
    const { item } = entry;
    const code = articleCode(item);
    const detail = kind === "device" ? occupancyText(item) : frontSizeText(item);
    const secondary = item.physStatus !== "resolved" ? "Profilo fisico non disponibile"
      : detail ? `${code} · ${detail}` : code;
    return <li key={item.uuid}>
      <button type="button" className="pool-item" data-pool-kind={kind} data-draggable={draggable}
        disabled={!draggable && !onSelect} aria-disabled={!draggable && !onSelect} aria-pressed={onSelect ? item.uuid === activeItemUuid : undefined} data-active={item.uuid === activeItemUuid ? "true" : undefined}
        data-full-text={`${item.modelName} · ${secondary} · Rif. ${item.uuid.slice(0, 8)}`}
        data-full-text-always={(names.get(item.modelName) ?? 0) > 1 ? "" : undefined}
        onClick={() => onSelect?.(item)}
        onDoubleClick={draggable && onAutoPlace ? () => onAutoPlace(item) : undefined}
        onPointerDown={event => { if (event.button !== 0) return; onSelect?.(item); if (draggable) onDragStart(kind, item, event); }}>
        <span className="pool-text">
          <strong>{item.modelName}</strong>
          {item.physStatus !== "resolved" ? <small className="pool-warning">
            <Icon name="alert" className="librequadri-icon-small" />Profilo fisico non disponibile</small>
            : <small><span className="code">{code}</span>{detail ? ` · ${detail}` : null}</small>}
        </span>
        <span className="pool-count"><span className="pool-figure">{entry.available}<span aria-hidden="true">/{entry.quantity}</span></span>
          <span className="visually-hidden">{availabilityText(entry.available, entry.quantity)}</span></span>
      </button>
    </li>;
  })}</ul>;
}

function PoolGroup({ title, kind, entries, empty, enabled, activeItemUuid, onSelect, onDragStart, onAutoPlace }: {
  title: string; kind: DragKind; entries: readonly PoolEntry[]; empty: string; enabled: boolean;
  activeItemUuid: string | undefined; onSelect?: (item: ProjectConfiguredItem) => void; onDragStart: DragStart;
  onAutoPlace?: (item: ProjectConfiguredItem) => void;
}) {
  const availableEntries = entries.filter(entry => entry.available > 0);
  return <div className="pool-group">
    <div className="pool-group-header">
      <h4><Icon name={kind === "support" ? "panel" : "device"} className="librequadri-icon-small" />{title}</h4>
      <span>{availabilityText(unitsToPlace(availableEntries))}</span>
    </div>
    {availableEntries.length === 0 ? <p className="dock-hint">{empty}</p>
      : <PoolList kind={kind} entries={availableEntries} enabled={enabled} activeItemUuid={activeItemUuid}
        onSelect={onSelect} onDragStart={onDragStart} onAutoPlace={onAutoPlace} />}
  </div>;
}

/**
 * "Da posizionare" (docs/R17_VISUAL_DESIGN.md §4.3): the configured Pannelli and Apparecchi with
 * the units still to place (Q − P), the sources for dragging onto the Fronte Quadro.
 */
export function PhysicalPool({ structural, devices, hasRoot, activeItemUuid, onSelect, onDragStart, onAutoPlace, devicesOnly = false }: {
  devicesOnly?: boolean;
  structural: readonly PoolEntry[]; devices: readonly PoolEntry[]; hasRoot: boolean;
  /** The selected configured item, or the current drag source while dragging. */
  activeItemUuid?: string;
  onSelect?: (item: ProjectConfiguredItem) => void;
  onDragStart: DragStart;
  onAutoPlace?: (item: ProjectConfiguredItem) => void;
}) {
  const total = unitsToPlace(structural) + unitsToPlace(devices);
  return <section className="dock-panel design-pool" aria-labelledby="design-pool-title">
    <header className="dock-header">
      <h3 id="design-pool-title">Da posizionare</h3>
      <span className="dock-count" title={availabilityText(total)}>{total}</span>
    </header>
    <div className="dock-body">
      {!hasRoot ? <p className="dock-notice">Aggiungi prima una carpenteria.</p> : null}
      <PoolGroup title="Apparecchi" kind="device" entries={devices} enabled={hasRoot}
        empty="Nessun apparecchio da posizionare." activeItemUuid={activeItemUuid} onSelect={onSelect} onDragStart={onDragStart}
        onAutoPlace={onAutoPlace} />
      {!devicesOnly ? <PoolGroup title="Pannelli" kind="support" entries={structural} enabled={hasRoot}
        empty="Nessun pannello da posizionare." activeItemUuid={activeItemUuid} onSelect={onSelect} onDragStart={onDragStart}
        onAutoPlace={onAutoPlace} /> : null}
    </div>
    <p className="dock-footer-hint">{onAutoPlace ? "Fai doppio clic o trascina sul disegno per posizionare automaticamente." : IDLE_GUIDANCE}</p>
  </section>;
}
