/// <reference types="node" />
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FronteQuadro, ProgettazioneScreen, updateFrontViewport } from "../../src/renderer/project/ProgettazioneScreen.js";
import { FrontScrollbar } from "../../src/renderer/project/FrontScrollbar.js";
import { PAN_STEP_FRACTION, combinedFrontGeometry, drawingScale, keyPanTarget, keyScrollTarget, scrollThumb, scrollThumbY, sectorDimensions,
  scrolledY, wheelPanTarget, type CombinedFrontGeometry, type FrontViewBox } from "../../src/renderer/project/front-geometry.js";
import { clientToViewBox, pickCombinedTarget, type TargetEntry } from "../../src/renderer/project/placement-drag.js";
import type { ProjectAnnotation, ProjectApi, ProjectConfiguredItem, ProjectDocumentView, ProjectPhysicalNode } from "../../src/shared/project.js";

const item = (uuid: string, kind: "enclosure" | "support" | "device", code: string, width: number,
  height: number): ProjectConfiguredItem => ({
  uuid, modelKind: kind, modelName: `${code} modello`, modelCode: code, modelBrandMarchio: "TEST", configLabel: code,
  physStatus: "resolved", bom: [{ role: "primary", manufacturerCode: `${code}-ARTICLE` }],
  views: [{ viewCode: "front", widthMm: width, heightMm: height, assetKey: null }], zones: [],
} as unknown as ProjectConfiguredItem);
const node = (uuid: string, itemUuid: string, kind: "enclosure" | "support" | "device", x: number | null, y: number | null,
  children: ProjectPhysicalNode[] = [], parentUuid: string | null = null): ProjectPhysicalNode => ({
  uuid, itemUuid, nodeKind: kind, xMm: x, yMm: y, viewCode: "front", children, parentUuid,
  zoneNo: null, startUnits: null, slotNo: null, rootXMm: x, rootYMm: y, sortOrder: 0, positionIssue: null,
});
const tall = item("tall", "enclosure", "TALL", 448, 622);
const wide = item("wide", "enclosure", "WIDE", 1205.5, 900);
const small = item("small", "enclosure", "SMALL", 300, 400);
const tray = item("tray", "support", "TRAY", 200, 100);
const items = [tall, wide, small, tray];
const rootT = node("root-t", "tall", "enclosure", 0, 0, [node("panel-t", "tray", "support", 10, 280, [], "root-t")]);
const rootW = node("root-w", "wide", "enclosure", 498, 0, [node("panel-w", "tray", "support", 510, 300, [], "root-w")]);
const rootS = node("root-s", "small", "enclosure", 1753.5, 0);
const two = [rootT, rootW];
const viewportPx = { width: 640, height: 480 };
const geometryOf = (roots: readonly ProjectPhysicalNode[], options: Parameters<typeof combinedFrontGeometry>[2] = {}) =>
  combinedFrontGeometry(roots, items, options);
const markup = (roots: readonly ProjectPhysicalNode[], props: Partial<Parameters<typeof FronteQuadro>[0]> = {}) =>
  renderToStaticMarkup(<FronteQuadro roots={roots} items={items} {...props} />);
const texts = (html: string) => [...html.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map(match => match[1]!.replace(/<[^>]+>/g, ""));
const note = (uuid: string, text: string, xMm: number, yMm: number, widthMm = 200, heightMm = 40): ProjectAnnotation => ({ uuid, text, xMm, yMm, widthMm, heightMm, fontSizeMm: 12 });
const screenSource = readFileSync("src/renderer/project/ProgettazioneScreen.tsx", "utf8");

describe("Fronte Quadro overall dimensions", () => {
  it("are off by default and drawn only when asked for", () => {
    expect(markup(two)).not.toContain("front-dimensions");
    expect(markup(two, { dimensions: true })).toContain("front-dimensions");
    const project = { configuredItems: items, physicalNodes: two, annotations: [], lines: [] } as unknown as ProjectDocumentView;
    const html = renderToStaticMarkup(<ProgettazioneScreen project={project} api={{} as ProjectApi} onProjectChange={() => undefined} />);
    expect(html).toMatch(/aria-pressed="false" aria-label="Quote"/);
    expect(html).not.toContain("front-dimensions");
    expect(screenSource).toContain("useState(false)");
  });

  it("show each Carpenteria's own snapshotted overall width and height", () => {
    const geometry = geometryOf(two, { viewportPx, dimensions: true });
    const dims = geometry.sectors.map(sector => sectorDimensions(sector));
    expect(dims.map(entry => [entry.widthMm, entry.heightMm])).toEqual([[448, 622], [1205.5, 900]]);
    expect(dims.map(entry => entry.rect)).toEqual([{ x: 0, y: 0, width: 448, height: 622 }, { x: 498, y: 0, width: 1205.5, height: 900 }]);
    const html = markup(two, { dimensions: true, viewportPx });
    expect([...html.matchAll(/data-dimension="(width|height)"[^>]*>([^<]*)</g)].map(match => `${match[1]} ${match[2]}`))
      .toEqual(["width 448 mm", "height 622 mm", "width 1205,5 mm", "height 900 mm"]);
    // Each pair sits inside its own sector's group, so it stays with the Carpenteria it measures.
    const sectorsHtml = html.split('class="front-sector"').slice(1);
    expect(sectorsHtml).toHaveLength(2);
    expect(sectorsHtml[0]).toContain("448 mm");
    expect(sectorsHtml[0]).not.toContain("1205,5 mm");
    expect(sectorsHtml[1]).toContain("1205,5 mm");
  });

  it("follow a bottom-aligned shorter Carpenteria through its sector offset", () => {
    const pair = [rootT, rootS];
    const geometry = geometryOf(pair, { viewportPx });
    const shorter = geometry.sectors.find(sector => sector.root.uuid === "root-s")!;
    expect(shorter.offset.y).toBeGreaterThan(0);
    const html = markup(pair, { dimensions: true, viewportPx });
    const group = html.split('data-root-uuid="root-s"')[1]!;
    expect(group).toContain(`translate(${shorter.offset.x} ${shorter.offset.y})`);
    expect(group.slice(0, group.indexOf('data-root-uuid') > 0 ? group.indexOf('data-root-uuid') : undefined)).toContain("300 mm");
    // The persisted root coordinates the dimension is built from are untouched.
    expect(rootS.xMm).toBe(1753.5);
    expect(shorter.bounds).toEqual({ left: 1753.5, top: 0, right: 2053.5, bottom: 400 });
  });

  it("never change the sectors, container rectangles or what hit-testing picks", () => {
    const off = geometryOf(two, { viewportPx }), on = geometryOf(two, { viewportPx, dimensions: true });
    const shape = (geometry: CombinedFrontGeometry) => geometry.sectors.map(sector =>
      [sector.root.uuid, sector.offset, sector.bounds, sector.displayBounds, [...sector.parentRects]]);
    expect(shape(on)).toEqual(shape(off));
    expect(on.bounds).toEqual(off.bounds);
    // The viewBox may widen to show the lines, so the same on-screen pointer is mapped through each viewBox.
    const target: TargetEntry = { parentUuid: "panel-w", target: { action: "placeChild",
      input: { itemUuid: "tray", parentUuid: "panel-w", zoneNo: 0, startUnits: 0, viewCode: "front" },
      subject: { xMm: 520, yMm: 310, widthMm: 40, heightMm: 40 }, affected: [] } };
    const clientBox = { left: 0, top: 0, width: 640, height: 480 };
    for (const geometry of [off, on]) {
      const scale = Math.min(640 / geometry.viewBox[2], 480 / geometry.viewBox[3]);
      const point = { x: (540 - geometry.viewBox[0]) * scale + (640 - geometry.viewBox[2] * scale) / 2,
        y: (330 - geometry.viewBox[1]) * scale + (480 - geometry.viewBox[3] * scale) / 2 };
      const drawn = clientToViewBox(point, clientBox, geometry.viewBox)!;
      expect(pickCombinedTarget([target], geometry, drawn, "support")!.entry).toBe(target);
    }
    const html = markup(two, { dimensions: true, viewportPx });
    expect(html.match(/data-node-uuid="/g)).toHaveLength(markup(two, { viewportPx }).match(/data-node-uuid="/g)!.length);
    expect(html.match(/class="front-hit"/g)).toBeNull();
    const css = readFileSync("src/renderer/styles.css", "utf8");
    expect(css).toMatch(/\.front-drawing \.front-dimensions \{ pointer-events: none; \}/);
    const groups = html.match(/<g class="front-dimensions"[^>]*>/g)!;
    expect(groups).toHaveLength(2);
    for (const group of groups) expect(group).not.toMatch(/onpointer|data-node-uuid/);
  });

  it("reserve room outside the Carpenteria so the lines stay reachable in a fitted view", () => {
    const off = geometryOf([rootT], { viewportPx }), on = geometryOf([rootT], { viewportPx, dimensions: true });
    expect(on.contentBounds!.left).toBeLessThan(off.contentBounds!.left);
    expect(on.contentBounds!.bottom).toBeGreaterThan(off.contentBounds!.bottom);
    expect(on.contentBounds!.right).toBe(off.contentBounds!.right);
    expect(on.contentBounds!.top).toBe(off.contentBounds!.top);
  });
});

describe("Fronte Quadro two-axis navigation (display only)", () => {
  const zoomed = (zoom: number, options: Parameters<typeof combinedFrontGeometry>[2] = {}) =>
    geometryOf(two, { viewportPx, zoom, focusUuid: "root-t", ...options });
  const scaleOf = (geometry: CombinedFrontGeometry) => drawingScale(viewportPx, geometry.viewBox)!;

  it("has nothing to scroll while the whole drawing fits, on either axis", () => {
    for (const zoom of [.5, 1]) {
      const geometry = zoomed(zoom, { scrollX: 500, scrollY: 500 });
      expect(scrollThumb(geometry)).toBeNull();
      expect(scrollThumbY(geometry)).toBeNull();
      expect(geometry.scrollRangeY.max).toBe(geometry.scrollRangeY.min);
      expect(wheelPanTarget(geometry, scaleOf(geometry), { shiftKey: false, deltaX: 50, deltaY: 50 })).toBeNull();
      expect(keyPanTarget(geometry, { key: "ArrowDown", ctrlKey: true }, true)).toBeNull();
    }
    const project = { configuredItems: items, physicalNodes: two, annotations: [], lines: [] } as unknown as ProjectDocumentView;
    expect(renderToStaticMarkup(<ProgettazioneScreen project={project} api={{} as ProjectApi} onProjectChange={() => undefined} />))
      .not.toContain("front-scrollbar");
  });

  it("reaches every part of the drawing vertically as well as horizontally when zoomed", () => {
    const fit = zoomed(1);
    for (const zoom of [1.25 ** 2, 2, 4]) {
      const geometry = zoomed(zoom);
      expect(scrollThumb(geometry)).not.toBeNull();
      const thumb = scrollThumbY(geometry)!;
      expect(thumb.size).toBeCloseTo(1 / zoom, 9);
      const { min, max } = geometry.scrollRangeY;
      expect(min).toBeCloseTo(fit.viewBox[1], 9);
      expect(max + geometry.viewBox[3]).toBeCloseTo(fit.viewBox[1] + fit.viewBox[3], 9);
      const top = zoomed(zoom, { scrollY: min }), bottom = zoomed(zoom, { scrollY: max });
      expect(top.viewBox[1]).toBeCloseTo(fit.viewBox[1], 9);
      expect(bottom.viewBox[1] + bottom.viewBox[3]).toBeCloseTo(fit.viewBox[1] + fit.viewBox[3], 9);
      expect(scrollThumbY(top)!.start).toBeCloseTo(0, 9);
      expect(scrollThumbY(bottom)!.start + scrollThumbY(bottom)!.size).toBeCloseTo(1, 9);
      // Out-of-range positions are clamped, never unreachable or beyond the drawing.
      expect(zoomed(zoom, { scrollY: max + 1e6 }).viewBox[1]).toBeCloseTo(max, 9);
      expect(scrolledY(geometry, -1e9)).toBe(min);
      // The horizontal range is unchanged by the new axis.
      expect(zoomed(zoom, { scrollX: geometry.scrollRange.max }).viewBox[0]).toBeCloseTo(geometry.scrollRange.max, 9);
    }
    const html = markup(two, { zoom: 2, viewportPx, scrollY: zoomed(2).scrollRangeY.max });
    expect(html).toContain('id="front-drawing"');
  });

  it("pans vertically on wheel deltaY, horizontally on deltaX, and both on a two-axis gesture", () => {
    const edge = zoomed(2);
    const geometry = zoomed(2, { scrollX: (edge.scrollRange.min + edge.scrollRange.max) / 2,
      scrollY: (edge.scrollRangeY.min + edge.scrollRangeY.max) / 2 });
    const scale = scaleOf(geometry);
    const down = wheelPanTarget(geometry, scale, { shiftKey: false, deltaX: 0, deltaY: 40 })!;
    expect(down.y).toBeCloseTo(geometry.viewBox[1] + 40 / scale, 9);
    expect(down.x).toBeNull();
    const sideways = wheelPanTarget(geometry, scale, { shiftKey: false, deltaX: -30, deltaY: 0 })!;
    expect(sideways.x).toBeCloseTo(geometry.viewBox[0] - 30 / scale, 9);
    expect(sideways.y).toBeNull();
    const both = wheelPanTarget(geometry, scale, { shiftKey: false, deltaX: 25, deltaY: -15 })!;
    expect(both.x).toBeCloseTo(geometry.viewBox[0] + 25 / scale, 9);
    expect(both.y).toBeCloseTo(geometry.viewBox[1] - 15 / scale, 9);
    // Shift turns a vertical wheel into a horizontal pan, as before; a real deltaX is left as it is.
    const shifted = wheelPanTarget(geometry, scale, { shiftKey: true, deltaX: 0, deltaY: 40 })!;
    expect(shifted.x).toBeCloseTo(geometry.viewBox[0] + 40 / scale, 9);
    expect(shifted.y).toBeNull();
    // Line and page deltas are converted; pinch-zoom (Ctrl + wheel) and unknown scale are not taken.
    expect(wheelPanTarget(geometry, scale, { shiftKey: false, deltaX: 0, deltaY: 3, deltaMode: 1 })!.y)
      .toBeCloseTo(geometry.viewBox[1] + 48 / scale, 9);
    expect(wheelPanTarget(geometry, scale, { shiftKey: false, ctrlKey: true, deltaX: 0, deltaY: 40 })).toBeNull();
    expect(wheelPanTarget(geometry, null, { shiftKey: false, deltaX: 0, deltaY: 40 })).toBeNull();
    expect(wheelPanTarget(geometry, scale, { shiftKey: false, deltaX: 0, deltaY: 1e7 })!.y).toBe(geometry.scrollRangeY.max);
  });

  it("pans with Ctrl (or Cmd) + arrows, by a fixed share of the window, only when the drawing is focused", () => {
    const geometry = zoomed(2, { focusUuid: "root-t" });
    const middle = zoomed(2, { scrollX: (geometry.scrollRange.min + geometry.scrollRange.max) / 2,
      scrollY: (geometry.scrollRangeY.min + geometry.scrollRangeY.max) / 2 });
    const [x, y, width, height] = middle.viewBox;
    for (const modifier of ["ctrlKey", "metaKey"] as const) {
      expect(keyPanTarget(middle, { key: "ArrowRight", [modifier]: true }, true)).toEqual({ x: x + width * PAN_STEP_FRACTION, y: null });
      expect(keyPanTarget(middle, { key: "ArrowLeft", [modifier]: true }, true)).toEqual({ x: x - width * PAN_STEP_FRACTION, y: null });
      expect(keyPanTarget(middle, { key: "ArrowDown", [modifier]: true }, true)).toEqual({ x: null, y: y + height * PAN_STEP_FRACTION });
      expect(keyPanTarget(middle, { key: "ArrowUp", [modifier]: true }, true)).toEqual({ x: null, y: y - height * PAN_STEP_FRACTION });
    }
    expect(keyPanTarget(middle, { key: "ArrowDown", ctrlKey: true }, false)).toBeNull();
    for (const extra of ["altKey", "shiftKey"]) expect(keyPanTarget(middle, { key: "ArrowDown", ctrlKey: true, [extra]: true }, true)).toBeNull();
    expect(keyPanTarget(middle, { key: "ArrowDown" }, true)).toBeNull();
    expect(keyPanTarget(middle, { key: "Enter", ctrlKey: true }, true)).toBeNull();
    // The plain Left/Right behaviour is unchanged and never takes a Ctrl chord.
    expect(keyScrollTarget(middle, { key: "ArrowRight" }, true)).toBeCloseTo(x + width * 0.15, 9);
    expect(keyScrollTarget(middle, { key: "ArrowRight", ctrlKey: true }, true)).toBeNull();
    // Clamped at the ends.
    expect(keyPanTarget(zoomed(2, { scrollY: geometry.scrollRangeY.max }), { key: "ArrowDown", ctrlKey: true }, true)!.y).toBe(geometry.scrollRangeY.max);
  });

  it("wires both axes into the screen: wheel, keys, scrollbars, and a reset by zoom and focus", () => {
    expect(screenSource).toMatch(/const next=wheelPanTarget\(shown,scale,event\)/);
    expect(screenSource).toMatch(/if\(next\.y!==null\)setScrollY\(next\.y\)/);
    expect(screenSource).toMatch(/if\(pan\.y!==null\)setScrollY\(pan\.y\)/);
    expect(screenSource).toMatch(/const focusRoot=\(uuid:string\)=>\{setScrollX\(null\);setScrollY\(null\)/);
    expect(screenSource).toMatch(/setScrollX\(null\);setScrollY\(null\);\s*setFrontViewport/);
    expect(screenSource).toContain('orientation="vertical"');
    expect(screenSource).toContain("keyScrollTarget(geometry,event,event.target===svgRef.current)");
  });

  it("restores the complete drawing on Adatta vista and never touches persisted coordinates", () => {
    expect(updateFrontViewport({ zoom: 3 }, "fit").zoom).toBe(1);
    const fitted = geometryOf(two, { viewportPx, zoom: 1, focusUuid: "root-w" });
    const stale = geometryOf(two, { viewportPx, zoom: 1, focusUuid: "root-w", scrollX: 12345, scrollY: -999 });
    expect(stale.viewBox).toEqual(fitted.viewBox);
    expect(fitted.viewBox[2] * fitted.viewBox[3]).toBeGreaterThan(zoomed(3).viewBox[2] * zoomed(3).viewBox[3]);
    const before = JSON.stringify(two);
    for (const zoom of [1, 2, 4]) geometryOf(two, { viewportPx, zoom, scrollX: 300, scrollY: 200, dimensions: true, annotations: [note("n", "x", 1, 1)] });
    expect(JSON.stringify(two)).toBe(before);
    const panned = geometryOf(two, { viewportPx, zoom: 3, scrollX: 700, scrollY: 100 });
    expect(panned.sectors.map(sector => [sector.root.xMm, sector.root.yMm, sector.offset, sector.bounds]))
      .toEqual(fitted.sectors.map(sector => [sector.root.xMm, sector.root.yMm, sector.offset, sector.bounds]));
  });

  it("renders a compact vertical scrollbar that reflects the window and stays display-only", () => {
    const html = renderToStaticMarkup(<FrontScrollbar orientation="vertical" start={.25} size={.5} onStart={() => undefined} />);
    expect(html).toContain('role="scrollbar" aria-orientation="vertical"');
    expect(html).toContain("front-scrollbar-vertical");
    expect(html).toContain('style="top:25%;height:50%"');
    expect(html).toContain('aria-valuenow="50"');
    expect(renderToStaticMarkup(<FrontScrollbar start={.25} size={.5} onStart={() => undefined} />)).toContain('style="left:25%;width:50%"');
    const css = readFileSync("src/renderer/styles.css", "utf8");
    expect(css).toMatch(/\.front-scrollbar\.front-scrollbar-vertical \{[^}]*width: 8px/);
  });
});

describe("Fronte Quadro regressions", () => {
  const panel = item("panel", "support", "TRAY-X", 200, 100);
  const dev = item("dev", "device", "SW", 60, 45);
  const sample = [panel, tall, dev];
  const root = node("r", "tall", "enclosure", 0, 0, [node("p", "panel", "support", 20, 40, [], "r"), node("d", "dev", "device", 30, 200, [], "p")]);
  const draw = (props: Partial<Parameters<typeof FronteQuadro>[0]>) =>
    renderToStaticMarkup(<FronteQuadro roots={[root]} items={sample} {...props} />);

  it("keeps Pannelli free of text and devices labelled with their article code, with dimensions and notes on", () => {
    for (const props of [{}, { dimensions: true }, { annotations: [note("n", "Nota", 5, 5)] }]) {
      const labels = texts(draw(props));
      expect(labels).toContain("SW-ARTICLE");
      expect(labels.join(" ")).not.toMatch(/TRAY|panel/);
    }
    expect(texts(draw({ labels: false }))).not.toContain("SW-ARTICLE");
    expect(draw({})).toMatch(/class="front-support front-opening"/);
  });

  it("introduces no source-specific condition in the generic renderer", () => {
    for (const file of ["FrontAnnotations.tsx", "FrontDimensions.tsx", "front-annotations.ts", "useFrontNotes.ts", "front-geometry.ts", "ProgettazioneScreen.tsx", "FrontScrollbar.tsx"])
      expect(readFileSync(`src/renderer/project/${file}`, "utf8")).not.toMatch(/tq\.pack|tiquadri|bticino/i);
    expect(readFileSync("src/main/project/annotations.ts", "utf8")).not.toMatch(/tq\.pack|tiquadri|bticino/i);
  });
});
