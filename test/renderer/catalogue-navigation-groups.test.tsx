import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ManufacturerNode } from "../../src/shared/catalogue.js";
import { BrowseNavigation, manufacturerPath } from "../../src/renderer/catalogue/CatalogueScreen.js";
import { showcaseBrandNodes, showcaseNavigation, STATISTICAL_FAMILIES_GROUP as group } from "../../src/renderer/showcase/catalogue-navigation.js";

const nodes: ManufacturerNode[] = [
  { id: 10, parentId: null, code: "tq.system.3", name: "Apparecchi", brandMarchio: "BTI", source: "import" },
  { id: 11, parentId: 10, name: "Interruttori", source: "import", brandMarchio: "BTI" },
  { id: 20, parentId: null, name: "Famiglie statistiche · SIE · SIE", source: "metel", brandMarchio: "SIE" },
  { id: 21, parentId: 20, name: "Automazione", source: "metel", brandMarchio: "SIE" },
  { id: 30, parentId: null, name: "Famiglie statistiche · BTI · LEG", source: "metel", brandMarchio: "LEG" },
  { id: 31, parentId: 30, name: "Canaline", source: "metel", brandMarchio: "LEG" },
].map((node, i) => ({ code: String(node.id), kind: "section", levelCode: null, levelLabel: null,
  sortOrder: i, articleCount: i + 10, packageCount: i === 0 ? 3 : 0, ...node })) as ManufacturerNode[];

describe("Catalogo presentation grouping", () => {
  it("keeps classified METEL navigation beside Apparecchi BTicino, outside statistical families", () => {
    const classified = { ...nodes[0]!, id: 40, code: "classified.sie.root", name: "Apparecchi Siemens",
      source: "metel" as const, brandMarchio: "SIE" };
    const tree = showcaseNavigation([...nodes, classified]);
    expect(tree.filter(n => n.parentId === null).map(n => n.name))
      .toEqual(["Apparecchi BTicino", "Apparecchi Siemens", "Famiglie statistiche"]);
    expect(showcaseBrandNodes(tree, "SIE").map(n => n.id)).toEqual([20, 21, 40, group]);
    expect(tree.find(n => n.id === 40)).toEqual(classified);
  });
  it("has exactly two primary entries in order, retaining every supplied node and count", () => {
    const before = structuredClone(nodes), tree = showcaseNavigation(nodes);
    expect(tree.filter(node => node.parentId === null).map(node => node.name))
      .toEqual(["Apparecchi BTicino", "Famiglie statistiche"]);
    expect(tree.filter(node => node.id !== group).map(node => [node.id, node.articleCount, node.packageCount]))
      .toEqual(nodes.map(node => [node.id, node.articleCount, node.packageCount]));
    expect(tree.filter(node => node.parentId === group).map(node => node.name))
      .toEqual([nodes[2]!.name, nodes[4]!.name]);
    expect(manufacturerPath(tree, 21).map(node => node.id)).toEqual([group, 20, 21]);
    expect(manufacturerPath(nodes, 21).map(node => node.id)).toEqual([20, 21]);
    expect(nodes).toEqual(before);
  });
  it("opens the selected statistical branch and retains one keyboard tab stop", () => {
    const html = renderToStaticMarkup(<BrowseNavigation nodes={nodes} selectedId={21} onSelect={() => undefined}/>);
    expect(html).toContain('aria-label="Comprimi Famiglie statistiche"');
    expect(html).toContain('data-node-id="21" tabindex="0"');
    expect(html).toContain('title="Nel ramo: 13 articoli">13</small>');
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.indexOf(">Apparecchi BTicino<")).toBeLessThan(html.indexOf(">Famiglie statistiche<"));
  });
  it("preserves manufacturer filtering and the identities used by unchanged browse/search requests", () => {
    const tree = showcaseNavigation(nodes);
    expect(showcaseBrandNodes(tree, "SIE").map(node => node.id)).toEqual([20, 21, group]);
    expect(showcaseBrandNodes(tree, "").filter(node => node.parentId === group).map(node => node.brandMarchio))
      .toEqual(["SIE", "LEG"]);
    expect(tree.find(node => node.id === 31)).toMatchObject({ parentId: 30, name: "Canaline" });
    expect(tree.find(node => node.id === 11)).toMatchObject({ parentId: 10, name: "Interruttori" });
  });
});
