import type { ProjectPhysicalNode, ProjectPlacementTarget } from "../../shared/project.js";

type ExactPlacement = Extract<ProjectPlacementTarget, { action: "placeChild" | "moveNode" }>;

export function frontOrder(roots: readonly ProjectPhysicalNode[]): ProjectPhysicalNode[] {
  return roots.filter(node => node.nodeKind === "enclosure" && node.xMm !== null && node.yMm !== null)
    .sort((a, b) => a.xMm! - b.xMm! || a.yMm! - b.yMm! || a.uuid.localeCompare(b.uuid));
}

export function panelsInPlacementOrder(roots: readonly ProjectPhysicalNode[]): ProjectPhysicalNode[] {
  return roots.flatMap(root => root.children
    .filter(node => node.nodeKind === "support" && node.xMm !== null && node.yMm !== null)
    .sort((a, b) => a.yMm! - b.yMm! || a.xMm! - b.xMm! || a.sortOrder - b.sortOrder || a.uuid.localeCompare(b.uuid)));
}

export function findPhysicalNode(nodes: readonly ProjectPhysicalNode[], uuid: string): ProjectPhysicalNode | undefined {
  for (const node of nodes) {
    if (node.uuid === uuid) return node;
    const child = findPhysicalNode(node.children, uuid);
    if (child) return child;
  }
  return undefined;
}

function descendantsOf(node?: ProjectPhysicalNode): ReadonlySet<string> {
  const uuids = new Set<string>();
  const visit = (parent: ProjectPhysicalNode) => {
    for (const child of parent.children) {
      uuids.add(child.uuid);
      visit(child);
    }
  };
  if (node) visit(node);
  return uuids;
}

export function firstPlacement(parents: readonly ProjectPhysicalNode[], kind: "support" | "device",
  targetsFor: (parentUuid: string) => readonly ProjectPlacementTarget[], moving?: ProjectPhysicalNode): ExactPlacement | undefined {
  const descendants = descendantsOf(moving);
  const position = (target: ExactPlacement) => target.input.startUnits ?? target.input.slotNo ?? 0;
  const compare = (a: ExactPlacement, b: ExactPlacement) => {
    const vertical = a.subject.yMm - b.subject.yMm;
    if (kind === "support" && vertical) return vertical;
    return (a.input.zoneNo ?? 0) - (b.input.zoneNo ?? 0) || position(a) - position(b) ||
      vertical || a.subject.xMm - b.subject.xMm || a.input.viewCode.localeCompare(b.input.viewCode);
  };
  for (const parent of parents) {
    let first: ExactPlacement | undefined;
    for (const target of targetsFor(parent.uuid)) {
      if (target.action !== "placeChild" && target.action !== "moveNode") continue;
      // Only a moved subject may carry its own children.
      if (target.affected.some(node => !descendants.has(node.nodeUuid))) continue;
      if (!first || compare(target, first) < 0) first = target;
    }
    if (first) return first;
  }
  return undefined;
}
