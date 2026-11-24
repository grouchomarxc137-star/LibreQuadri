import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ProjectConfiguredItem, ProjectPhysicalNode } from "../../shared/project.js";
import { Icon, type IconName } from "../ui/icons.js";
import { articleCode, countPlaced, countText } from "./design-presentation.js";
import { ancestorUuids, isSelectable } from "./design-selection.js";

const KIND_ICON: Readonly<Record<ProjectPhysicalNode["nodeKind"], IconName>> = {
  enclosure: "box", support: "panel", device: "device", group: "layers",
};

/** The row's own visible text, revealed in full when the narrow tree cuts it off. */
function nodeText(node: ProjectPhysicalNode, item: ProjectConfiguredItem | undefined): string {
  return node.nodeKind === "device" && item ? `${articleCode(item)} · ${item.modelName}` : item?.modelName ?? node.nodeKind;
}

interface TreeCallbacks {
  onToggle: (uuid: string) => void;
  onSelect: (node: ProjectPhysicalNode, rootUuid: string) => void;
  onHover: (uuid: string | null) => void;
}

/**
 * "Albero fisico" (docs/R17_VISUAL_DESIGN.md §4.3): the placed Carpenterie, Pannelli and
 * Apparecchi as an outliner with their drawing coordinates. Choosing a row selects that object
 * (the same selection as the Fronte Quadro and Proprietà) and focuses its Carpenteria; hovering a
 * row pre-highlights the object in the drawing and the other way round. Every Carpenteria stays
 * visible whatever is focused or selected. Physical actions live in Proprietà.
 */
export function PhysicalTree({ roots, items, currentRootUuid, selectedUuid = null, hoverUuid = null, onSelect, onHover }: {
  roots: readonly ProjectPhysicalNode[]; items: ReadonlyMap<string, ProjectConfiguredItem>;
  currentRootUuid: string | undefined;
  /** The persistent selection (orange); `hoverUuid` is the transient neutral pre-highlight. */
  selectedUuid?: string | null; hoverUuid?: string | null;
  onSelect: TreeCallbacks["onSelect"]; onHover: TreeCallbacks["onHover"];
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const body = useRef<HTMLDivElement>(null);
  const toggle = (uuid: string) => setCollapsed(previous => {
    const next = new Set(previous);
    if (!next.delete(uuid)) next.add(uuid);
    return next;
  });
  // A selection made in the drawing opens the rows above it and scrolls its row into view.
  useEffect(() => {
    if (selectedUuid === null) return;
    const hidden = ancestorUuids(roots, selectedUuid);
    setCollapsed(previous => hidden.some(uuid => previous.has(uuid))
      ? new Set([...previous].filter(uuid => !hidden.includes(uuid))) : previous);
  }, [roots, selectedUuid]);
  useEffect(() => {
    if (selectedUuid === null) return;
    const row = body.current?.querySelector<HTMLElement>('.design-tree-row[data-selected="true"]');
    row?.scrollIntoView?.({ block: "nearest" });
  }, [selectedUuid, collapsed]);
  const supports = countPlaced(roots, "support");
  const devices = countPlaced(roots, "device");
  const callbacks: TreeCallbacks = { onToggle: toggle, onSelect, onHover };
  return <section className="dock-panel physical-tree" aria-labelledby="design-tree-title">
    <header className="dock-header">
      <h3 id="design-tree-title">Albero fisico</h3>
      {roots.length ? <span className="dock-count">{countText(supports, "pannello", "pannelli")} · {countText(devices, "apparecchio", "apparecchi")}</span> : null}
    </header>
    <div className="dock-body" ref={body}>
      {roots.length === 0 ? <p className="dock-hint">Nessuna carpenteria posizionata.</p>
        : <ul className="design-tree" role="tree" aria-label="Albero fisico" onPointerLeave={() => onHover(null)}>{roots.map(node =>
          <TreeNode key={node.uuid} node={node} rootUuid={node.uuid} depth={0} items={items} current={node.uuid === currentRootUuid}
            collapsed={collapsed} selectedUuid={selectedUuid} hoverUuid={hoverUuid} callbacks={callbacks} />)}</ul>}
    </div>
  </section>;
}

function TreeNode({ node, rootUuid, depth, items, current, collapsed, selectedUuid, hoverUuid, callbacks }: {
  node: ProjectPhysicalNode; rootUuid: string; depth: number; items: ReadonlyMap<string, ProjectConfiguredItem>;
  current: boolean; collapsed: ReadonlySet<string>; selectedUuid: string | null; hoverUuid: string | null;
  callbacks: TreeCallbacks;
}) {
  const item = node.itemUuid ? items.get(node.itemUuid) : undefined;
  const hasChildren = node.children.length > 0;
  const open = hasChildren && !collapsed.has(node.uuid);
  const selectable = isSelectable(node);
  const selected = selectable && node.uuid === selectedUuid;
  return <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={selected}>
    <div className="design-tree-row" data-kind={node.nodeKind} data-tree-uuid={node.uuid}
      data-selected={selected ? "true" : undefined} data-hover={selectable && node.uuid === hoverUuid ? "true" : undefined}
      style={{ paddingLeft: 4 + depth * 14, "--tree-depth": depth } as CSSProperties}
      onPointerEnter={selectable ? () => callbacks.onHover(node.uuid) : undefined}>
      {hasChildren ? <button type="button" className="tree-toggle" aria-label={open ? "Comprimi" : "Espandi"}
        onClick={() => callbacks.onToggle(node.uuid)}><Icon name={open ? "chevronDown" : "chevronRight"} className="librequadri-icon-small" /></button>
        : <span className="tree-toggle" aria-hidden="true" />}
      <button type="button" className="tree-label" aria-current={node.nodeKind === "enclosure" && current ? "true" : undefined}
        data-full-text={nodeText(node, item)} onClick={() => { if (selectable) callbacks.onSelect(node, rootUuid); }}>
        <Icon name={KIND_ICON[node.nodeKind]} className="librequadri-icon-small" />
        {node.nodeKind === "device" && item ? <><span className="code">{articleCode(item)}</span><span className="tree-secondary">{item.modelName}</span></>
          : <span>{item?.modelName ?? node.nodeKind}</span>}
        {hasChildren && !open ? <span className="tree-secondary">({node.children.length})</span> : null}
      </button>
      {node.positionIssue ? <span className="error tree-issue" title={node.positionIssue}>{node.positionIssue}</span>
        : <small className="tree-coordinates" title={`Posizione x, y: ${node.xMm}, ${node.yMm} mm`}>{node.xMm}, {node.yMm}</small>}
    </div>
    {open ? <ul role="group">{node.children.map(child => <TreeNode key={child.uuid} node={child} rootUuid={rootUuid}
      depth={depth + 1} items={items} current={false} collapsed={collapsed} selectedUuid={selectedUuid} hoverUuid={hoverUuid}
      callbacks={callbacks} />)}</ul> : null}
  </li>;
}
