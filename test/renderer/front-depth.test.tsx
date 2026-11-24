import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { combinedFrontGeometry, depthDimensionGeometry, drawingScale, sectorAt, sectorDimensions, toPersistedPoint } from "../../src/drawing/front-geometry.js";
import { frontDimensionPrimitives } from "../../src/drawing/front-primitives.js";
import { FrontDimensions } from "../../src/drawing/FrontDimensions.js";
import { frontPrimitiveMarkup } from "../../src/main/documents/front-markup.js";
import { buildFrontDocument, frontPageLayout } from "../../src/main/documents/front-document.js";
import { FronteQuadro } from "../../src/renderer/project/ProgettazioneScreen.js";
import { frontProject } from "../helpers/front-project.js";

const projectWithDepth = (depth: number | null) => ({ ...frontProject, configuredItems:
  frontProject.configuredItems.map((item, i) => ({ ...item, outerDepthMm: i === 0 ? depth : null,
    depthMm: 999, usableDepthMm: 888 })) });
describe("authoritative enclosure depth dimension", () => {
  it.each([161, 230, 475.5])("shows %s mm from the enclosure snapshot through shared screen/PDF primitives", depth => {
    const project = projectWithDepth(depth), before = structuredClone(project);
    const geometry = combinedFrontGeometry(project.physicalNodes, project.configuredItems, { dimensions: true });
    const dims = sectorDimensions(geometry.sectors[0]!);
    expect(dims).toMatchObject({ widthMm: 600, heightMm: 1200, depthMm: depth });
    const markup = frontPrimitiveMarkup(frontDimensionPrimitives(dims, null));
    expect(markup).toBe(renderToStaticMarkup(<FrontDimensions dimensions={dims} scale={null}/>));
    expect(markup).toContain('data-dimension="depth"');
    expect(markup).toContain(`${String(depth).replace(".", ",")} mm`);
    expect(markup).toContain("rotate(-45");
    expect(markup.match(/class="front-dimension-arrow"/g)).toHaveLength(3);
    const pdf = buildFrontDocument(project, {}, { labels: true, dimensions: true });
    const screen = renderToStaticMarkup(<FronteQuadro roots={project.physicalNodes} items={project.configuredItems} dimensions/>);
    expect(pdf.html).toContain(markup);
    expect(screen).toContain(markup);
    expect(project).toEqual(before);
  });
  it.each([null, undefined, 0, -1, NaN, Infinity, -Infinity])("omits missing/invalid depth %s without substituting other dimensions", depth => {
    const project = projectWithDepth(depth as number | null);
    const pdf = buildFrontDocument(project, {}, { labels: true, dimensions: true });
    expect(pdf.html).not.toContain('data-dimension="depth"');
    expect(pdf.html).toContain('data-dimension="width"');
    expect(pdf.html).toContain('data-dimension="height"');
  });
  it("follows Quote and leaves physical rectangles, offsets and hit-testing intact", () => {
    const project = projectWithDepth(161);
    const off = combinedFrontGeometry(project.physicalNodes, project.configuredItems);
    const on = combinedFrontGeometry(project.physicalNodes, project.configuredItems, { dimensions: true });
    expect(on.sectors).toEqual(off.sectors);
    expect(on.bounds).toEqual(off.bounds);
    const sector = on.sectors[0]!;
    const depth = depthDimensionGeometry(sectorDimensions(sector), null)!;
    expect(sectorAt(on, { x: depth.start.x, y: depth.start.y })).toBeNull();
    expect(toPersistedPoint(sector, { x: 100, y: 300 })).toEqual(toPersistedPoint(off.sectors[0]!, { x: 100, y: 300 }));
    expect(buildFrontDocument(project, {}, { labels: true, dimensions: false }).html).not.toContain('data-dimension=');
    expect(renderToStaticMarkup(<FronteQuadro roots={project.physicalNodes} items={project.configuredItems}/>)).not.toContain('data-dimension=');
  });
  it("includes diagonal arrows and rotated label extents in PDF fit at all screen scales", () => {
    const project = projectWithDepth(12345.5);
    for (const viewportPx of [null, { width: 240, height: 200 }, { width: 1600, height: 1200 }]) {
      for (const zoom of [1, 2, 4]) {
        const geometry = combinedFrontGeometry(project.physicalNodes, project.configuredItems, { dimensions: true, viewportPx, zoom });
        const bounds = geometry.contentBounds!;
        for (const sector of geometry.sectors) {
          const depth = depthDimensionGeometry(sectorDimensions(sector), null);
          if (!depth) continue;
          const rect = sectorDimensions(sector).rect;
          expect(depth.bounds.bottom).toBeLessThan(rect.y);
          expect(depth.bounds.left).toBeGreaterThan(rect.x + rect.width);
          expect(depth.end.x).toBeGreaterThan(depth.start.x);
          expect(depth.end.y).toBeLessThan(depth.start.y);
          expect(bounds.top).toBeLessThanOrEqual(depth.bounds.top + sector.offset.y);
          expect(bounds.bottom).toBeGreaterThanOrEqual(depth.bounds.bottom + sector.offset.y);
          expect(bounds.left).toBeLessThanOrEqual(depth.bounds.left + sector.offset.x);
          expect(bounds.right).toBeGreaterThanOrEqual(depth.bounds.right + sector.offset.x);
        }
      }
    }
    const pdf = buildFrontDocument(project, {}, { labels: false, dimensions: true });
    const layout = frontPageLayout(pdf.viewBox);
    expect(pdf.viewBox[2] * layout.scale).toBeLessThanOrEqual(layout.drawingWidthMm);
    expect(pdf.viewBox[3] * layout.scale).toBeLessThanOrEqual(layout.drawingHeightMm);
  });
  it("omits depth when the root itself has no authoritative drawable enclosure", () => {
    const project = projectWithDepth(161);
    const items = project.configuredItems.filter(item => item.uuid !== "case");
    const sector = combinedFrontGeometry(project.physicalNodes, items).sectors[0]!;
    expect(sectorDimensions(sector).depthMm).toBeNull();
  });
  it.each([955, 35])("moves the shorter enclosure's callout into its own %s mm sector", width => {
    const project = projectWithDepth(230);
    project.physicalNodes = project.physicalNodes.map(node => ({ ...node, children: [] }));
    project.configuredItems = project.configuredItems.map(item => item.modelKind === "enclosure" ? {
      ...item, outerDepthMm: item.uuid === "case" ? 230 : 1700,
      views: item.views.map(view => ({ ...view, widthMm: item.uuid === "case" ? width : 975,
        heightMm: item.uuid === "case" ? 1595 : 2032 })),
    } : item);
    const { physicalNodes: roots, configuredItems: items, annotations } = project;
    const off = combinedFrontGeometry(roots, items, { annotations });
    const plain = depthDimensionGeometry(sectorDimensions(off.sectors[0]!), null)!;
    expect(plain.bounds.right + off.sectors[0]!.offset.x).toBeGreaterThan(off.sectors[1]!.displayBounds.left);
    for (const viewportPx of [null, { width: 640, height: 480 }, { width: 1440, height: 900 }]) {
      for (const zoom of [.5, 1, 4]) {
        const on = combinedFrontGeometry(roots, items, { dimensions: true, annotations, viewportPx, zoom });
        expect(on.sectors).toEqual(off.sectors);
        const sector = on.sectors[0]!;
        const dims = on.dimensionsByRoot.get("case")!;
        const scale = viewportPx && drawingScale(viewportPx, on.viewBox);
        const depth = depthDimensionGeometry(dims, scale)!;
        expect(depth.bounds.left + sector.offset.x).toBeGreaterThanOrEqual(sector.displayBounds.left - 1e-8);
        expect(depth.bounds.right + sector.offset.x).toBeLessThanOrEqual(sector.displayBounds.right);
        expect(depth.bounds.bottom + sector.offset.y).toBeLessThan(sector.displayBounds.top - on.captionMm! * 1.35);
        expect(depth.bounds.top + sector.offset.y).toBeGreaterThanOrEqual(on.contentBounds!.top);
        expect(on.dimensionsByRoot.get("case2")!.depthPlacement).toBeUndefined();
        expect(depth.arrowScale).toBeCloseTo(Math.min(1, width / (plain.bounds.right - plain.bounds.left)));
      }
    }
    const pdf = buildFrontDocument(project, {}, { labels: true, dimensions: true });
    const on = combinedFrontGeometry(roots, items, { dimensions: true, annotations });
    const markup = frontPrimitiveMarkup(frontDimensionPrimitives(on.dimensionsByRoot.get("case")!, null));
    const canvas = renderToStaticMarkup(<FronteQuadro roots={roots} items={items} annotations={annotations} dimensions />);
    expect(pdf.html).toContain(markup);
    expect(canvas).toContain(markup);
    const withoutQuotes = renderToStaticMarkup(<FronteQuadro roots={roots} items={items} annotations={annotations} />);
    const noteRect = /<rect class="front-note-box"[^>]+>/;
    expect(canvas.match(noteRect)?.[0]).toBeTruthy();
    expect(canvas.match(noteRect)?.[0]).toBe(withoutQuotes.match(noteRect)?.[0]);
  });
});
