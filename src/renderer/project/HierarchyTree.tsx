import { Icon } from "../ui/icons.js";

/** Generic, data-driven expandable hierarchy with selectable leaves. It knows nothing about the data's source. */
export interface HierarchyLeaf { key: number; label: string; detail?: string; }
export interface HierarchyBranch {
  key: number; label: string; children: HierarchyBranch[]; leaves: HierarchyLeaf[];
}

/** Top-level branches start open; everything below stays collapsed until the user opens it. */
export function initialExpanded(tree: readonly HierarchyBranch[]): ReadonlySet<number> {
  return new Set(tree.map(branch => branch.key));
}

export function toggleExpanded(expanded: ReadonlySet<number>, key: number): ReadonlySet<number> {
  const next = new Set(expanded);
  if (!next.delete(key)) next.add(key);
  return next;
}

export function HierarchyTree({ label, tree, expanded, onToggle, selectedLeaf, onSelectLeaf, onQuickAddLeaf }: {
  label: string; tree: readonly HierarchyBranch[]; expanded: ReadonlySet<number>;
  onToggle: (key: number) => void; selectedLeaf: number | null; onSelectLeaf: (key: number) => void;
  onQuickAddLeaf?: (key: number) => void;
}) {
  return <ul className="hierarchy-tree" role="tree" aria-label={label}>
    {tree.map(branch => <Branch key={branch.key} branch={branch} expanded={expanded} onToggle={onToggle}
      selectedLeaf={selectedLeaf} onSelectLeaf={onSelectLeaf} onQuickAddLeaf={onQuickAddLeaf} />)}
  </ul>;
}

function Branch({ branch, expanded, onToggle, selectedLeaf, onSelectLeaf, onQuickAddLeaf }: {
  branch: HierarchyBranch; expanded: ReadonlySet<number>; onToggle: (key: number) => void;
  selectedLeaf: number | null; onSelectLeaf: (key: number) => void; onQuickAddLeaf?: (key: number) => void;
}) {
  const open = expanded.has(branch.key);
  return <li role="treeitem" aria-expanded={open} aria-selected={false}>
    <button type="button" className="hierarchy-branch" data-full-text={branch.label} onClick={() => onToggle(branch.key)}>
      <Icon name={open ? "chevronDown" : "chevronRight"} className="librequadri-icon-small" /><span className="hierarchy-name">{branch.label}</span>
    </button>
    {open ? <ul role="group">
      {branch.children.map(child => <Branch key={child.key} branch={child} expanded={expanded}
        onToggle={onToggle} selectedLeaf={selectedLeaf} onSelectLeaf={onSelectLeaf} onQuickAddLeaf={onQuickAddLeaf} />)}
      {branch.leaves.map(leaf => <li key={leaf.key} role="treeitem" aria-selected={leaf.key === selectedLeaf}>
        <button type="button" className="hierarchy-leaf" aria-pressed={leaf.key === selectedLeaf}
          data-full-text={leaf.detail ? `${leaf.label} · ${leaf.detail}` : leaf.label} onClick={() => onSelectLeaf(leaf.key)}
          onDoubleClick={onQuickAddLeaf && (() => onQuickAddLeaf(leaf.key))}>
          <span className="hierarchy-name">{leaf.label}</span>{leaf.detail ? <small>{leaf.detail}</small> : null}
        </button>
      </li>)}
    </ul> : null}
  </li>;
}
