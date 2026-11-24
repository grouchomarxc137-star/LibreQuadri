import type { StructuralNavigation } from "../../shared/project.js";

/** Search only within the current backend-approved hierarchy; never broaden compatibility. */
export function filterDeviceNavigation(navigation: StructuralNavigation, query: string): StructuralNavigation {
  const text = query.trim().toLocaleLowerCase("it");
  if (!text) return navigation;
  const offered = new Set(navigation.nodes.flatMap(node => node.modelIds));
  const candidates = navigation.candidates.filter(model => offered.has(model.id) &&
    `${model.name} ${model.brandMarchio} ${model.code}`.toLocaleLowerCase("it").includes(text));
  const ids = new Set(candidates.map(model => model.id));
  const byId = new Map(navigation.nodes.map(node => [node.id, node]));
  const kept = new Set<number>();
  for (const node of navigation.nodes) {
    if (!node.modelIds.some(id => ids.has(id))) continue;
    for (let current: typeof node | undefined = node; current && !kept.has(current.id);
      current = current.parentId === null ? undefined : byId.get(current.parentId)) kept.add(current.id);
  }
  return { ...navigation, candidates, nodes: navigation.nodes.filter(node => kept.has(node.id))
    .map(node => ({ ...node, modelIds: node.modelIds.filter(id => ids.has(id)) })) };
}

/** Fast access to existing physical-only models, with the same normal configuration/add path. */
export function physicalOnlyDevices(navigation: StructuralNavigation) {
  const offered = new Set(navigation.nodes.flatMap(node => node.modelIds));
  return navigation.candidates.filter(model => offered.has(model.id) && model.commercialContribution === "none");
}
