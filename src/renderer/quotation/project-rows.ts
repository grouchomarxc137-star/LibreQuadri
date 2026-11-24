import type { ProjectConfiguredItem, ProjectPhysicalNode, ProjectQuotationLine } from "../../shared/project.js";

const DIN_CAPACITY_KINDS = new Set(["din_rail", "din"]);

/** Every displayed product or configured-item line contributes its unit quantity. */
export function projectArticleCount(lines: readonly ProjectQuotationLine[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}

export function projectLineName(line: ProjectQuotationLine, item?: ProjectConfiguredItem): string {
  if (line.lineType === "item") return item?.modelName ||
    (line.description && !line.description.startsWith("tq.pack.") ? line.description : "Configurazione senza nome");
  return line.description || "Descrizione non disponibile";
}

/** The resolved device's stored physical demand is the sole source of DIN occupancy. */
export function dinModulesPerUnit(item: ProjectConfiguredItem | undefined): number | null {
  if (!item || item.modelKind !== "device" || item.physStatus !== "resolved") return null;
  const demand = item.demands.find(row => DIN_CAPACITY_KINDS.has(row.capacityKindCode) &&
    Number.isFinite(row.amount) && row.amount > 0 && Number.isFinite(row.displayDivisor) &&
    row.displayDivisor > 0);
  return demand ? demand.amount / demand.displayDivisor : null;
}

export function projectDinModules(lines: readonly ProjectQuotationLine[],
  configuredItems: readonly ProjectConfiguredItem[]): number | null {
  const byUuid = new Map(configuredItems.map(item => [item.uuid, item]));
  let total = 0;
  let hasDin = false;
  for (const line of lines) {
    const perUnit = dinModulesPerUnit(line.itemUuid ? byUuid.get(line.itemUuid) : undefined);
    if (perUnit === null) continue;
    hasDin = true;
    total += perUnit * line.quantity;
  }
  return hasDin ? total : null;
}

/** The service refuses removing a configured item while any of its units is placed. */
export function placedItemUuids(nodes: readonly ProjectPhysicalNode[]): Set<string> {
  const placed = new Set<string>();
  const visit = (node: ProjectPhysicalNode) => {
    if (node.itemUuid) placed.add(node.itemUuid);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return placed;
}
