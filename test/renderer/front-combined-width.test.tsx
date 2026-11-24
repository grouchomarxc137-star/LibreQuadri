import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { combinedFrontGeometry, depthDimensionGeometry, SECTOR_GAP_MM } from "../../src/drawing/front-geometry.js";
import { buildFrontDocument } from "../../src/main/documents/front-document.js";
import { FronteQuadro } from "../../src/renderer/project/ProgettazioneScreen.js";
import { frontProject } from "../helpers/front-project.js";

const project = {
  ...frontProject,
  configuredItems: frontProject.configuredItems.map(item => item.modelKind === "enclosure" ? {
    ...item, outerDepthMm: item.uuid === "case" ? 230 : 600,
    views: item.views.map(view => ({ ...view, widthMm: item.uuid === "case" ? 600 : 800 })),
  } : item),
};

const dimensionMarkup = (markup: string) => markup.match(/<text[^>]+data-dimension="[^"]+"[^>]*>[^<]*<\/text>/g) ?? [];

it.each([2, 3])("sums %i visible fronts with older overlapping positions, excluding all display gaps", count => {
  const roots = count === 2 ? project.physicalNodes : [...project.physicalNodes,
    { ...project.physicalNodes[1]!, uuid: "case3" }];
  const items = project.configuredItems;
  const original = structuredClone({ roots, items, annotations: project.annotations });
  const combined = combinedFrontGeometry(roots, items, { dimensions: true, combinedWidths: true });
  const separate = combinedFrontGeometry(roots, items, { dimensions: true });
  const width = combined.combinedWidth!;
  expect(width.widthMm).toBe(count === 2 ? 1400 : 2200);
  expect(width.right - width.left).toBe(width.widthMm + (count - 1) * SECTOR_GAP_MM);
  expect(width.lineY).toBeGreaterThan(combined.bounds!.bottom);
  expect(combined.contentBounds!.bottom).toBeGreaterThan(width.lineY);
  expect(combined.sectors).toEqual(separate.sectors);
  for (const sector of combined.sectors) {
    const dims = combined.dimensionsByRoot.get(sector.root.uuid)!;
    const depth = depthDimensionGeometry(dims, null)!;
    expect(depth.bounds.bottom + sector.offset.y).toBeLessThan(width.lineY);
    expect(dims.rect.y + dims.rect.height + sector.offset.y).toBeLessThan(width.lineY);
  }
  expect({ roots, items, annotations: project.annotations }).toEqual(original);
});

it.each([true, false])("shares dimension markup in canvas and PDF with combined widths set to %s", combinedWidths => {
  const options = { labels: true, dimensions: true, combinedWidths };
  const html = renderToStaticMarkup(<FronteQuadro roots={project.physicalNodes} items={project.configuredItems}
    annotations={project.annotations} {...options} />);
  const pdf = buildFrontDocument(project, {}, options);
  expect(dimensionMarkup(html)).toEqual(dimensionMarkup(pdf.html));
  expect(html.match(/data-dimension="width"/g) ?? []).toHaveLength(combinedWidths ? 0 : 2);
  expect(html.match(/data-dimension="combined-width"/g) ?? []).toHaveLength(combinedWidths ? 1 : 0);
  expect(html.match(/data-dimension="height"/g)).toHaveLength(2);
  expect(html.match(/data-dimension="depth"/g)).toHaveLength(2);
  if (combinedWidths) expect(html).toContain("Totale carpenterie · 1.400 mm");
  expect(html).toContain('x="-180" y="-120" width="160" height="90"');
});

it("keeps individual widths for a single sector or when a visible sector has only drawable children", () => {
  const missingFront = project.configuredItems.map(item => item.uuid === "case" ? { ...item, views: [] } : item);
  for (const [roots, items] of [[project.physicalNodes.slice(0, 1), project.configuredItems],
    [project.physicalNodes, missingFront]] as const) {
    const geometry = combinedFrontGeometry(roots, items, { dimensions: true, combinedWidths: true });
    expect(geometry.canCombineWidths).toBe(false);
    expect(geometry.combinedWidth).toBeNull();
    const html = renderToStaticMarkup(<FronteQuadro roots={roots} items={items} dimensions combinedWidths />);
    expect(html.match(/data-dimension="width"/g)).toHaveLength(roots.length);
  }
});

it("hides every dimension with Quote off, including the combined width", () => {
  const options = { labels: true, dimensions: false, combinedWidths: true };
  const html = renderToStaticMarkup(<FronteQuadro roots={project.physicalNodes} items={project.configuredItems} {...options} />);
  expect(dimensionMarkup(html)).toEqual([]);
  expect(dimensionMarkup(buildFrontDocument(project, {}, options).html)).toEqual([]);
});
