import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributeColumns, BrowseNavigation, BrowsePath, manufacturerPath, projectQuantities,
  ProjectQuantityTag, treeKeyTarget } from "../../src/renderer/catalogue/CatalogueScreen.js";
import { placedCounts, PreventivoContent, quotationStatusSegments } from "../../src/renderer/quotation/PreventivoWorkspace.js";
import { calculateCommercial } from "../../src/shared/commercial.js";
import type { ManufacturerNode } from "../../src/shared/catalogue.js";
import type { ProjectConfiguredItem, ProjectPhysicalNode, ProjectQuotationLine } from "../../src/shared/project.js";
import { openProject } from "./fake-api.js";

const nodes: ManufacturerNode[] = [0, 1, 2, 3, 4].map(id => ({ id, parentId: id ? id - 1 : null,
  name: `Livello ${id}`, code: String(id), kind: "group", levelCode: null, levelLabel: null,
  brandMarchio: "TEST", source: "import", sortOrder: id, articleCount: 9, packageCount: 0 }));

describe("Catalogo hierarchy and real data presentation", () => {
  it("opens every ancestor of a deep selection, retaining one entry point for keyboard navigation", () => {
    expect(manufacturerPath(nodes, 4).map(n => n.id)).toEqual([0, 1, 2, 3, 4]);
    const html = renderToStaticMarkup(<BrowseNavigation nodes={nodes} selectedId={4} onSelect={() => undefined} />);
    expect(html.match(/role="treeitem"/g)).toHaveLength(5);
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(4);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('data-node-id="4" tabindex="0"');
    const path = renderToStaticMarkup(<BrowsePath nodes={nodes} selectedId={4} onSelect={() => undefined} />);
    expect(path.match(/aria-current="page"/g)).toHaveLength(1);
    expect(path).toContain('title="Livello 4"');
    expect(manufacturerPath(nodes, 999)).toEqual([]);
  });
  it("bounds keyboard traversal without changing selection on focus", () => {
    expect(treeKeyTarget("ArrowUp", 0, 5)).toBe(0);
    expect(treeKeyTarget("ArrowDown", 4, 5)).toBe(4);
    expect(treeKeyTarget("ArrowDown", 1, 5)).toBe(2);
    expect(treeKeyTarget("Home", 3, 5)).toBe(0);
    expect(treeKeyTarget("End", 0, 5)).toBe(4);
    expect(treeKeyTarget("Enter", 2, 5)).toBeNull();
    expect(treeKeyTarget("Home", 0, 0)).toBeNull();
  });
  it("creates no attribute columns without actual facets and uses Distinta quantities including BOM components", () => {
    expect(attributeColumns(null)).toEqual([]);
    const row = { snapshotUuid: "s", brandMarchio: "TEST", manufacturerCode: "A", description: "A",
      unitOfMeasure: "PZ", quantity: 2, listPriceUnitE4: 10000, listTotalE4: 20000 };
    const counts = projectQuantities({ distinta: [row, { ...row, quantity: 3.5 }] });
    expect(counts.get("TEST\u0000A")).toBe(5.5);
    expect(counts.get("OTHER\u0000A")).toBeUndefined();
    expect(renderToStaticMarkup(<ProjectQuantityTag quantity={5.5} />)).toContain("5,5 nel progetto");
    expect(renderToStaticMarkup(<ProjectQuantityTag quantity={0} />)).toBe("");
  });
});

describe("Preventivo preserves commercial grouping and precision", () => {
  const line = { lineType: "item", uuid: "line-a", itemUuid: "item-a", snapshotUuid: null, quantity: 2,
    brandMarchio: "TEST", manufacturerCode: "internal", description: "Gruppo A", unitOfMeasure: "PZ",
    unitListPriceE4: null, lineTotalE4: null, currency: "EUR" } as ProjectQuotationLine;
  const item = { uuid: "item-a", modelName: "Gruppo A", modelKind: "device", physStatus: "not_physical", demands: [],
    bom: [{ seq: 1, manufacturerCode: "SAME", description: "Componente", quantityPerItem: 1, salePriceUnitE4: 100001, lineDiscountBp: 2500 }],
  } as unknown as ProjectConfiguredItem;
  it("keeps identical component codes under separate parents and shows the unchanged calculator's total", () => {
    const project = { ...openProject, lines: [line, { ...line, uuid: "line-b", itemUuid: "item-b", quantity: 1 }],
      configuredItems: [item, { ...item, uuid: "item-b", modelName: "Gruppo B", bom: [{ ...item.bom[0]!, lineDiscountBp: 0 }] }],
      globalDiscountBp: 1000, labourTotalE4: 200001 };
    const calc = calculateCommercial(project);
    expect(calc.materialsSubtotalE4).toBe(250002);
    expect(calc.finalTotalE4).toBe(425003);
    const html = renderToStaticMarkup(<PreventivoContent project={project} onOpenLine={() => undefined}
      onQuantityChange={() => undefined} onRemove={() => undefined} onDuplicate={() => undefined} />);
    expect(html.match(/class="quotation-component"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Sconto Componente Gruppo A"');
    expect(html).toContain('aria-label="Sconto Componente Gruppo B"');
    expect(html).toContain("42,5003 €");
    expect(html).not.toContain(">Configurato<");
    expect(quotationStatusSegments(project.lines, calc).at(-1)?.value).toBe("42,5003 €");
  });
  it("keeps unknown prices indeterminate and removes stale or placed rows from bulk removal", () => {
    const placed = { itemUuid: "item-a", children: [] } as unknown as ProjectPhysicalNode;
    expect(placedCounts([{ ...placed, itemUuid: null, children: [placed, placed] }]).get("item-a")).toBe(2);
    const html = renderToStaticMarkup(<PreventivoContent project={{ ...openProject, lines: [line],
      configuredItems: [{ ...item, bom: [{ ...item.bom[0]!, salePriceUnitE4: null }] }], physicalNodes: [placed] }}
      checked={[line.uuid, "deleted"]} onOpenLine={() => undefined} onQuantityChange={() => undefined} onRemove={() => undefined} />);
    expect(html).toContain("Da definire");
    expect(html).toContain("1 riga non ha un prezzo");
    expect(html).not.toContain("Rimuovi selezionati");
    expect(html).toContain("Rimuovi prima la posizione in Progettazione");
  });
});

describe("overlay motion and responsive protection", () => {
  const css = readFileSync("src/renderer/styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  it("only animates entering floating chrome, with no scale or layout animation", () => {
    for (const name of ["librequadri-fade-in", "librequadri-dialog-in", "librequadri-popover-in"]) expect(css).toContain(`@keyframes ${name}`);
    expect(css).not.toMatch(/scale\(/);
    for (const [, selector, declarations] of css.matchAll(/([^{}]+)\{([^{}]*animation:[^{}]*)\}/g)) {
      expect(selector).not.toMatch(/\.front-(drawing|target|selection|vector)|\.drag-ghost/);
      expect(declarations).not.toMatch(/animation:.*(width|height|left|top)/);
    }
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)/)!;
    for (const speed of ["fast", "base", "slow"]) expect(reduced[1]).toContain(`--dur-${speed}: 0ms`);
  });
  it("keeps stepper and action cells unclipped and gives narrow status messages priority", () => {
    expect(css).toMatch(/\.quotation-table td\.quotation-quantity,[^{]+\.quotation-table td\.quotation-actions \{ overflow: visible; text-overflow: clip;/);
    expect(css).toContain('.status-segment[data-kind="listino"] { display: none; }');
    expect(css).toContain('.status-message { flex: 1 0 160px; }');
    expect(css).toContain('grid-template-columns: minmax(0, 1.3fr) auto minmax(0, .7fr)');
    expect(css).toContain('.catalogue-path li:last-child { flex: 2 0 auto; min-width: 0; max-width: 60%; }');
    expect(css).not.toContain('.catalogue-project-lines');
    expect(css).not.toContain('.quotation-line-select');
  });
});
