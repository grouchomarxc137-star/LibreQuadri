/// <reference types="node" />
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrowseFacets, ConfiguredItemIdentity } from "../../src/renderer/catalogue/CatalogueScreen.js";
import { PreventivoContent } from "../../src/renderer/quotation/PreventivoWorkspace.js";
import { PhysicalTree } from "../../src/renderer/project/PhysicalTree.js";
import type { CatalogueBrowseResult } from "../../src/shared/catalogue.js";
import type { ProjectConfiguredItem, ProjectPhysicalNode, ProjectQuotationLine } from "../../src/shared/project.js";

/*
 * Quiet Workbench X2 (docs/R17_VISUAL_DESIGN.md §0.1, §0.6): lists, trees, tables and controls.
 * Presentation only: hierarchy, data and behaviour are unchanged.
 */
const css = readFileSync("src/renderer/styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = (): [string[], string][] => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(match => [match[1]!.split(/,(?![^(]*\))/).map(selector => selector.trim()), match[2]!]);
const declarations = (selector: string) =>
  rules().filter(([selectors]) => selectors.includes(selector)).map(([, body]) => body).join(";");

const item = (uuid: string, kind: "enclosure" | "support" | "device", code: string) => ({
  uuid, modelKind: kind, modelName: `${code} modello`, modelCode: code, modelBrandMarchio: "TEST", configLabel: code,
  physStatus: "resolved", bom: [{ role: "primary", manufacturerCode: `${code}-ART`, brandMarchio: "TEST" }], selections: [],
  demands: [], views: [{ viewCode: "front", widthMm: 10, heightMm: 10, assetKey: null }], zones: [],
} as unknown as ProjectConfiguredItem);
const node = (uuid: string, itemUuid: string, kind: "enclosure" | "support" | "device",
  children: ProjectPhysicalNode[] = [], parentUuid: string | null = null): ProjectPhysicalNode => ({
  uuid, itemUuid, nodeKind: kind, xMm: 0, yMm: 0, viewCode: "front", children, parentUuid, zoneNo: null, startUnits: null,
  slotNo: null, rootXMm: parentUuid ? null : 0, rootYMm: parentUuid ? null : 0, sortOrder: 0, positionIssue: null,
} as ProjectPhysicalNode);

describe("Albero fisico indent guides", () => {
  it("passes each row's depth to the stylesheet and keeps the row indentation unchanged", () => {
    const items = new Map([item("box", "enclosure", "BOX"), item("tray", "support", "TRAY"), item("dev", "device", "DEV")]
      .map(entry => [entry.uuid, entry]));
    const root = node("r", "box", "enclosure", [node("p", "tray", "support", [node("d", "dev", "device", [], "p")], "r")]);
    const html = renderToStaticMarkup(<PhysicalTree roots={[root]} items={items} currentRootUuid="r"
      onSelect={() => undefined} onHover={() => undefined} />);
    const style = (uuid: string) => html.match(new RegExp(`data-tree-uuid="${uuid}"[^>]*style="([^"]*)"`))![1];
    expect(style("r")).toBe("padding-left:4px;--tree-depth:0");
    expect(style("p")).toBe("padding-left:18px;--tree-depth:1");
    expect(style("d")).toBe("padding-left:32px;--tree-depth:2");
    // The guides are a background on the row (one hairline per ancestor level), never extra markup.
    const row = declarations(".design-tree-row");
    expect(row).toMatch(/background-size:\s*calc\(var\(--tree-depth, 0\) \* 14px\) 100%/);
    // Hover and selection set only the colour, so the guides stay visible under them.
    expect(declarations('.design-tree-row[data-selected="true"]')).toMatch(/background-color:/);
    expect(declarations('.design-tree-row[data-selected="true"]')).not.toMatch(/(^|[;\s])background:/);
  });
});

describe("Da posizionare quantity typography", () => {
  it("uses restrained metadata typography and right alignment without progress bars", () => {
    const count = declarations(".pool-count");
    expect(count).toMatch(/font-size:\s*11\.5px/);
    expect(declarations(".pool-text small")).toMatch(/font-size:\s*11\.5px/);
    expect(count).toMatch(/font-weight:\s*var\(--fw-regular\)/);
    expect(count).toMatch(/color:\s*var\(--librequadri-ink-3\)/);
    expect(count).toMatch(/justify-items:\s*end/);
    expect(count).toMatch(/text-align:\s*right/);
    expect(count).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(css).not.toContain(".pool-meter");
    expect(css).not.toContain(".pool-count b");
    expect(declarations(".pool-item:disabled")).toMatch(/opacity:\s*\.5/);
  });
});

describe("active facets", () => {
  const facets: CatalogueBrowseResult["facets"] = {
    brand: { values: [{ value: "BTI", count: 3, selected: false }] },
    configurability: { values: [{ value: false, count: 2, selected: false }] },
    attributes: [{ code: "poles", name: "Poli", dataType: "number", unit: null, applicable: true, values: [{ value: 2, label: null, count: 2, selected: true }] },
      { code: "curve", name: "Curva", dataType: "enum", unit: null, applicable: true, values: [{ value: "C", label: "C", count: 2, selected: false }] }],
  };
  it("marks only the facets that hold a selection; inactive facets stay neutral", () => {
    const html = renderToStaticMarkup(<BrowseFacets facets={facets} brands={[]} configurability={[]}
      attributes={{ poles: [2] }} onBrand={() => undefined} onConfigurable={() => undefined} onAttribute={() => undefined} />);
    const details = [...html.matchAll(/<details([^>]*)><summary[^>]*>([^<(]*)/g)].map(match => [match[2]!.trim(), match[1]!]);
    expect(details).toEqual([["Marchio", ""], ["Configurabilità", ""], ["Poli", ' data-active="true"'], ["Curva", ""]]);
    expect(declarations('.catalogue-facets details[data-active="true"] > summary')).toMatch(/background-color:\s*var\(--librequadri-accent-tint\)/);
  });
});

describe("project-context tags", () => {
  it("tints the configured and placed tags of a project item with the restrained accent", () => {
    const html = renderToStaticMarkup(<ConfiguredItemIdentity item={item("dev", "device", "DEV")} placed />);
    expect(html).toContain('<span class="scheda-tag" data-tone="project">Configurato</span>');
    expect(html).toContain('<span class="scheda-tag" data-tone="project">Posizionato</span>');
  });
});

describe("selection language: lists versus tables (O2)", () => {
  it("gives tree and list rows an inset rounded tint with a short accent bar, never a full-height edge bar", () => {
    const listSelected = ['.hierarchy-tree .hierarchy-leaf[aria-pressed="true"]', '.design-tree-row[data-selected="true"]',
      '.pool-item[data-active="true"]', '.catalogue-tree-row[data-selected="true"]'];
    const bar = rules().find(([selectors]) => selectors.includes('.design-tree-row[data-selected="true"]::before'))!;
    for (const selector of listSelected) {
      expect(bar[0]).toContain(`${selector}::before`);
      expect(declarations(selector), selector).not.toMatch(/inset 3px|inset 2px/);
    }
    expect(bar[1]).toMatch(/height:\s*14px/);
    expect(bar[1]).toMatch(/border-radius:\s*2px/);
  });

  it("keeps tables full width with the left accent bar on the first cell", () => {
    expect(declarations(".distinta-table tbody tr.is-selected td:first-child")).toMatch(/box-shadow:\s*inset 3px 0 var\(--librequadri-accent\)/);
    expect(declarations('.recent-table tbody tr[aria-selected="true"] td:first-child')).toMatch(/box-shadow:\s*inset 3px 0 0 var\(--librequadri-accent\)/);
  });

  it("raises the pressed segment as a thumb; no accent underline and no sliding", () => {
    const pressed = declarations('.segmented button[aria-pressed="true"]');
    expect(pressed).toMatch(/box-shadow:\s*var\(--shadow-thumb\)/);
    expect(pressed).not.toMatch(/inset 0 -2px/);
    expect(declarations(".segmented")).not.toMatch(/transition|transform/);
  });
});

describe("dense controls in Righe del progetto", () => {
  it("draws the quantity stepper as one grouped control on the element the panel actually renders", () => {
    const line = { lineType: "product", uuid: "l1", snapshotUuid: "s1", itemUuid: null, brandMarchio: "BTI", manufacturerCode: "F80RC",
      description: "Morsettiera", unitOfMeasure: "PZ", quantity: 2, unitListPriceE4: 10000, lineTotalE4: 20000, currency: "EUR" } as ProjectQuotationLine;
    const html = renderToStaticMarkup(<PreventivoContent project={{ lines: [line], configuredItems: [], physicalNodes: [], globalDiscountBp: 0, labourTotalE4: 0 }}
      onQuantityChange={() => undefined} onRemove={() => undefined} onRemoveMany={() => undefined} onOpenLine={() => undefined} />);
    // − value + are direct children of .quantity-editor: the group frame must live on that element.
    expect(html).toMatch(/<div class="quantity-editor"[^>]*><button[^>]*>−<\/button><input[^>]*><button[^>]*>\+<\/button><\/div>/);
    const group = declarations(".quantity-editor");
    expect(group).toMatch(/border:\s*1px solid var\(--librequadri-line-strong\)/);
    expect(group).toMatch(/overflow:\s*hidden/);
    expect(declarations(".quantity-editor:focus-within")).toMatch(/box-shadow:\s*0 0 0 3px var\(--librequadri-focus-halo\)/);
  });
});
