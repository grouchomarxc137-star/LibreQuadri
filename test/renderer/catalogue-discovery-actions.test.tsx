import type { ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ManufacturerNode } from "../../src/shared/catalogue.js";
import type { StructuralNavigation } from "../../src/shared/project.js";
import { BrowseNavigation } from "../../src/renderer/catalogue/CatalogueScreen.js";
import { STATISTICAL_FAMILIES_GROUP as group } from "../../src/renderer/showcase/catalogue-navigation.js";
import { DeviceDiscovery } from "../../src/renderer/project/DeviceDiscovery.js";
import { HierarchyTree } from "../../src/renderer/project/HierarchyTree.js";

// Exercise actual callbacks over rerenders with the repository's existing lightweight hook approach.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useEffect: () => undefined,
  useMemo: <T,>(factory: () => T) => factory(),
  useState: <T,>(initial: T | (() => T)) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === "function" ? (initial as () => T)() : initial;
    return [hooks.values[index] as T, (value: T | ((previous: T) => T)) => {
      hooks.values[index] = typeof value === "function" ? (value as (previous: T) => T)(hooks.values[index] as T) : value;
    }] as const;
  },
}));
beforeEach(() => { hooks.values = []; hooks.cursor = 0; });
type Props = { children?: unknown; [key: string]: unknown };
function find(tree: unknown, predicate: (element: ReactElement<Props>) => boolean): ReactElement<Props> | undefined {
  if (Array.isArray(tree)) {
    for (const child of tree) { const match = find(child, predicate); if (match) return match; }
  } else if (tree && typeof tree === "object" && "props" in tree) {
    const element = tree as ReactElement<Props>;
    if (predicate(element)) return element;
    return find(element.props.children, predicate);
  }
  return undefined;
}
const click = (element: ReactElement<Props>) => (element.props.onClick as () => void)();
const node = (id: number, parentId: number | null, name: string, source: "import" | "metel", brand = "BTI"): ManufacturerNode => ({
  id, parentId, code: id === 1 ? "tq.system.3" : String(id), name, source, brandMarchio: brand, kind: "section",
  levelCode: null, levelLabel: null, sortOrder: 0, articleCount: 9, packageCount: 0,
});
it("opens the presentation parent without a query, then selects the original family/child IDs and filters brands", () => {
  const nodes = [node(1, null, "Apparecchi", "import"), node(2, null, "Famiglie SIE", "metel", "SIE"),
    node(3, 2, "Motori", "metel", "SIE"), node(4, null, "Famiglie BTI", "metel")];
  const onSelect = vi.fn();
  const render = () => { hooks.cursor = 0; return BrowseNavigation({ nodes, selectedId: null, onSelect }); };
  const label = (id: number) => find(render(), element => element.props["data-node-id"] === id)!;
  expect(label(2)).toBeUndefined();
  click(label(group));
  expect(onSelect).not.toHaveBeenCalled();
  click(label(2));
  expect(onSelect).toHaveBeenLastCalledWith(2);
  click(label(3));
  expect(onSelect).toHaveBeenLastCalledWith(3);
  const select = find(render(), element => element.type === "select")!;
  (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "SIE" } });
  expect(onSelect).toHaveBeenLastCalledWith(null);
  expect(label(4)).toBeUndefined();
  expect(label(1)).toBeUndefined();
  expect(label(group)).toBeDefined();
  expect(label(3)).toBeDefined();
  expect(onSelect.mock.calls.flat()).not.toContain(group);
});
it("searches and selects DIN generico with the existing model ID through the normal selection callback", () => {
  const navigation: StructuralNavigation = { status: "ready", staleImportIds: [], contextDataUnavailable: 0,
    candidates: [{ id: 7, name: "Din generico - Solo spazio", code: "space", brandMarchio: "TEST", kind: "device",
      active: true, obsolete: false, commercialContribution: "none" }],
    nodes: [{ id: 1, parentId: null, name: "Apparecchi", kind: "section", sortOrder: 0, modelIds: [] },
      { id: 2, parentId: 1, name: "Accessori", kind: "group", sortOrder: 0, modelIds: [7] }] };
  const onSelect = vi.fn(), onToggle = vi.fn();
  const render = () => { hooks.cursor = 0; return DeviceDiscovery({ navigation, expanded: new Set([1]), onToggle, modelId: null, onSelect }); };
  click(find(render(), element => element.type === "button")!);
  expect(onSelect).toHaveBeenLastCalledWith(7);
  const search = find(render(), element => element.type === "input")!;
  const change = search.props.onChange as (event: { target: { value: string } }) => void;
  change({ target: { value: "generico" } });
  const tree = find(render(), element => element.type === HierarchyTree)!;
  expect(tree.props.expanded).toEqual(new Set([1, 2]));
  (tree.props.onSelectLeaf as (id: number) => void)(7);
  expect(onSelect).toHaveBeenLastCalledWith(7);
  change({ target: { value: "missing" } });
  expect(find(render(), element => element.type === HierarchyTree)).toBeUndefined();
  expect(find(render(), element => element.props.role === "status")?.props.children).toBe("Nessun apparecchio corrisponde alla ricerca.");
  change({ target: { value: "" } });
  expect(find(render(), element => element.type === HierarchyTree)!.props.expanded).toEqual(new Set([1]));
});
