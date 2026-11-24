import type { ManufacturerNode } from "../../shared/catalogue.js";

/** UI-only group: its negative ID is never sent to a catalogue query. Imported IDs stay intact. */
export const STATISTICAL_FAMILIES_GROUP = -1;

/** Current showcase presentation; normalized source hierarchy and counts are left untouched. */
export function showcaseNavigation(nodes: readonly ManufacturerNode[]): ManufacturerNode[] {
  const isStatisticalRoot = (node: ManufacturerNode) => node.parentId === null && node.source === "metel"
    && !node.code.startsWith("classified.");
  const statisticalRoots = nodes.filter(isStatisticalRoot);
  const presented = nodes.map(node => ({ ...node,
    name: node.parentId === null && node.brandMarchio === "BTI" && node.code === "tq.system.3"
      ? "Apparecchi BTicino" : node.name,
    parentId: isStatisticalRoot(node) ? STATISTICAL_FAMILIES_GROUP : node.parentId,
  }));
  if (!statisticalRoots.length) return presented;
  // No aggregate count: overlapping family/product memberships must not be summed as unique articles.
  return [...presented, { id: STATISTICAL_FAMILIES_GROUP, parentId: null, name: "Famiglie statistiche",
    code: "ui.statistical-families", kind: "section", source: "metel", levelCode: null, levelLabel: null,
    brandMarchio: "", sortOrder: 0, articleCount: 0, packageCount: 0 }];
}

/** A manufacturer filter narrows the group's children, while retaining its presentation parent. */
export function showcaseBrandNodes(nodes: readonly ManufacturerNode[], brand: string): ManufacturerNode[] {
  return nodes.filter(node => !brand || node.id === STATISTICAL_FAMILIES_GROUP || node.brandMarchio === brand);
}
