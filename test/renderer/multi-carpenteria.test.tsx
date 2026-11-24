/// <reference types="node" />
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FronteQuadro, ProgettazioneScreen } from "../../src/renderer/project/ProgettazioneScreen.js";
import { FrontScrollbar } from "../../src/renderer/project/FrontScrollbar.js";
import { ARROW_SCROLL_FRACTION, CAPTION_PX, keyScrollTarget, scrollThumb, scrolledX, wheelPanTarget, GHOST_MAX_PX, GHOST_MIN_PX, SECTOR_GAP_MM, captionText, combinedFrontGeometry, ghostSize,
  layoutSectors, sectorAt, sectorOfContainer, toDisplayPoint, toPersistedPoint, type CombinedFrontGeometry,
  type FrontViewBox } from "../../src/renderer/project/front-geometry.js";
import { clientToViewBox, dragGuidance, pickCombinedTarget, targetParents, type DragSubject, type LoadedTargets,
  type TargetEntry } from "../../src/renderer/project/placement-drag.js";
import { locateNode } from "../../src/renderer/project/placement-workflow.js";
import type { ProjectApi, ProjectConfiguredItem, ProjectDocumentView, ProjectPhysicalNode,
  ProjectPlacementRect } from "../../src/shared/project.js";

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
const box = item("box", "enclosure", "BOX", 400, 600);
const box2 = item("box2", "enclosure", "BOX-2", 300, 600);
const boxShort = item("box-short", "enclosure", "BOX-S", 400, 450);
const tray = item("tray", "support", "TRAY", 200, 100);
const switchItem = item("switch", "device", "SWITCH", 20, 40);
const items = [box, box2, boxShort, tray, switchItem];
const rect = (xMm: number, yMm: number, widthMm: number, heightMm: number): ProjectPlacementRect => ({ xMm, yMm, widthMm, heightMm });

// Roots as the backend creates them: side by side, one 50 mm gap apart, tops at 0.
const rootA = node("root-a", "box", "enclosure", 0, 0, [node("panel-a", "tray", "support", 10, 280, [], "root-a")]);
const rootB = node("root-b", "box", "enclosure", 450, 0, [node("panel-b", "tray", "support", 460, 280, [], "root-b")]);
const rootC = node("root-c", "box2", "enclosure", 900, 0, [node("panel-c", "tray", "support", 910, 280, [], "root-c")]);
const normal = [rootA, rootB, rootC];

const deviceEntry = (parentUuid: string, subject: ProjectPlacementRect, startUnits = 0): TargetEntry => ({ parentUuid,
  target: { action: "placeChild", input: { itemUuid: "switch", parentUuid, zoneNo: 0, startUnits, viewCode: "front" },
    subject, affected: [] } });
const supportEntry = (parentUuid: string, subject: ProjectPlacementRect): TargetEntry => ({ parentUuid,
  target: { action: "placeChild", input: { itemUuid: "tray", parentUuid, zoneNo: 0, startUnits: 0, viewCode: "front" },
    subject, affected: [] } });
const geometryOf = (roots: readonly ProjectPhysicalNode[], options: Parameters<typeof combinedFrontGeometry>[2] = {}) =>
  combinedFrontGeometry(roots, items, options);
const markup = (roots: readonly ProjectPhysicalNode[], props: Partial<Parameters<typeof FronteQuadro>[0]> = {}) =>
  renderToStaticMarkup(<FronteQuadro roots={roots} items={items} {...props} />);
const rootUuids = (html: string) => [...html.matchAll(/data-root-uuid="([^"]+)"/g)].map(match => match[1]);

const viewportPx = { width: 640, height: 480 };
const clientBox = { left: 120, top: 40, width: 640, height: 480 };
/** Where a display-space point is on screen for a viewBox drawn with meet scaling (as clientToViewBox inverts). */
function toClient(viewBox: FrontViewBox, point: { x: number; y: number }) {
  const scale = Math.min(clientBox.width / viewBox[2], clientBox.height / viewBox[3]);
  return { x: clientBox.left + (clientBox.width - viewBox[2] * scale) / 2 + (point.x - viewBox[0]) * scale,
    y: clientBox.top + (clientBox.height - viewBox[3] * scale) / 2 + (point.y - viewBox[1]) * scale };
}
const visible = (viewBox: FrontViewBox, point: { x: number; y: number }) =>
  point.x > viewBox[0] && point.x < viewBox[0] + viewBox[2] && point.y > viewBox[1] && point.y < viewBox[1] + viewBox[3];

describe("combined Fronte Quadro: every Carpenteria is a sector of one drawing", () => {
  it("renders every placed Carpenteria at once, in one svg, with model-name captions", () => {
    const html = markup(normal, { focusUuid: "root-b" });
    expect(html.match(/<svg class="front-drawing"/g)).toHaveLength(1);
    expect(rootUuids(html)).toEqual(["root-a", "root-b", "root-c"]);
    for (const uuid of ["root-a", "root-b", "root-c", "panel-a", "panel-b", "panel-c"])
      expect(html).toContain(`data-node-uuid="${uuid}"`);
    expect(html).toContain('aria-label="Fronte Quadro: 3 carpenterie"');
    expect([...html.matchAll(/class="front-caption"[^>]*>([^<]+)</g)].map(match => match[1]))
      .toEqual(["BOX modello", "BOX modello", "BOX-2 modello"]);
    expect(html).not.toMatch(/Settore|#\d/);
    // A single Carpenteria needs no caption, and the label describes the workspace, not one root.
    const single = markup([rootA]);
    expect(single).not.toContain("front-caption");
    expect(single).toContain('aria-label="Fronte Quadro: 1 carpenteria"');
  });

  it("keeps every root visible whichever one is focused, and only marks the focus", () => {
    const shown = ["root-a", "root-b", "root-c"].map(focus => {
      const html = markup(normal, { focusUuid: focus });
      expect(html.match(/data-focus="true"/g)).toHaveLength(1);
      expect(html).toMatch(new RegExp(`data-root-uuid="${focus}" data-focus="true"`));
      return rootUuids(html);
    });
    expect(shown).toEqual([["root-a", "root-b", "root-c"], ["root-a", "root-b", "root-c"], ["root-a", "root-b", "root-c"]]);
    const project = { configuredItems: items, physicalNodes: normal,
      lines: items.map(entry => ({ itemUuid: entry.uuid, quantity: 1 })) } as unknown as ProjectDocumentView;
    const screen = renderToStaticMarkup(<ProgettazioneScreen project={project} api={{} as ProjectApi} onProjectChange={() => undefined} />);
    expect(rootUuids(screen)).toEqual(["root-a", "root-b", "root-c"]);
    expect(screen).toContain('aria-label="Fronte Quadro: 3 carpenterie"');
    // Focus only decides zoom centring: the sector set and their offsets are identical.
    const one = geometryOf(normal, { focusUuid: "root-a", zoom: 2 });
    const other = geometryOf(normal, { focusUuid: "root-c", zoom: 2 });
    expect(one.sectors.map(sector => [sector.root.uuid, sector.offset])).toEqual(other.sectors.map(sector => [sector.root.uuid, sector.offset]));
  });

  it("gives backend-created, already separated roots zero offset and their persisted positions", () => {
    const geometry = geometryOf(normal);
    expect(geometry.sectors.map(sector => sector.offset)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]);
    expect(geometry.sectors.map(sector => sector.displayBounds)).toEqual(geometry.sectors.map(sector => sector.bounds));
    const html = markup(normal);
    expect(html).not.toContain("transform=");
    expect(html).toContain('<rect x="450" y="0" width="400" height="600"');
    expect(html).toContain('<rect x="900" y="0" width="300" height="600"');
    // Exactly one gap apart is still "separated"; anything closer is moved.
    expect(SECTOR_GAP_MM).toBe(50);
  });

  it("separates older overlapping roots deterministically, on screen only", () => {
    const first = node("uuid-1", "box", "enclosure", 100, 200, [node("p1", "tray", "support", 110, 220, [], "uuid-1")]);
    const twin = node("uuid-2", "box", "enclosure", 100, 200, [node("p2", "tray", "support", 110, 220, [], "uuid-2")]);
    const partial = node("uuid-3", "box2", "enclosure", 300, 260, []);
    const lower = node("uuid-4", "box", "enclosure", 1500, 50, []);
    const frozen = JSON.stringify([first, twin, partial, lower]);
    const forward = geometryOf([first, twin, partial, lower]);
    const reverse = geometryOf([lower, partial, twin, first]);
    const offsets = (geometry: CombinedFrontGeometry) => geometry.sectors.map(sector => [sector.root.uuid, sector.offset.x, sector.offset.y]);
    // Ordered by persisted X, then Y, then uuid; overlapping roots follow at one gap each, and so does
    // the far root after them (its hole is closed); all stand on the lowest floor.
    expect(offsets(forward)).toEqual([["uuid-1", 0, 60], ["uuid-2", 450, 60], ["uuid-3", 700, 0], ["uuid-4", -150, 210]]);
    expect(offsets(reverse)).toEqual(offsets(forward));
    expect(forward.sectors.map(sector => sector.displayBounds.left)).toEqual([100, 550, 1000, 1350]);
    expect(forward.sectors[2]!.displayBounds).toMatchObject({ left: 1000, right: 1300, top: 260, bottom: 860 });
    for (let index = 1; index < forward.sectors.length; index++)
      expect(forward.sectors[index]!.displayBounds.left - forward.sectors[index - 1]!.displayBounds.right)
        .toBe(SECTOR_GAP_MM);
    // Persisted coordinates are untouched: the offset is applied by a transform, and titles keep the saved (x, y).
    expect(JSON.stringify([first, twin, partial, lower])).toBe(frozen);
    const html = markup([first, twin, partial, lower]);
    expect(html).toContain('data-root-uuid="uuid-2" transform="translate(450 60)"');
    expect(html).toContain("· (100, 200) mm</title>");
    expect(html).toContain('<rect x="100" y="200" width="400" height="600"');
    // The generic layout keeps an already separated sector still, even after a displaced one.
    const laid = layoutSectors([{ root: first, bounds: { left: 100, top: 200, right: 500, bottom: 800 } },
      { root: twin, bounds: { left: 100, top: 200, right: 500, bottom: 800 } }]);
    expect(laid.map(entry => entry.offset.x)).toEqual([0, 450]);
  });

  it("closes the hole a removed Carpenteria leaves, keeping order, on screen only", () => {
    const box = (uuid: string, x: number) => ({ root: node(uuid, "box", "enclosure", x, 0), bounds: { left: x, top: 0, right: x + 400, bottom: 600 } });
    const strip = [box("a", 0), box("b", 450), box("c", 900), box("d", 1350)];
    const lefts = (sectors: ReadonlyArray<{ root: { uuid: string }; bounds: { left: number }; offset: { x: number } }>) =>
      sectors.map(sector => [sector.root.uuid, sector.bounds.left + sector.offset.x]);
    // The backend's own strip: one gap apart, zero offsets.
    expect(layoutSectors(strip).map(sector => sector.offset.x)).toEqual([0, 0, 0, 0]);
    // Removing the middle, the first, the last, then several in turn always yields the same packed strip.
    expect(lefts(layoutSectors([strip[0]!, strip[2]!, strip[3]!]))).toEqual([["a", 0], ["c", 450], ["d", 900]]);
    expect(lefts(layoutSectors([strip[1]!, strip[2]!, strip[3]!]))).toEqual([["b", 450], ["c", 900], ["d", 1350]]);
    expect(lefts(layoutSectors([strip[0]!, strip[1]!, strip[2]!]))).toEqual([["a", 0], ["b", 450], ["c", 900]]);
    expect(lefts(layoutSectors([strip[0]!, strip[3]!]))).toEqual([["a", 0], ["d", 450]]);
    // A root added after removals goes after the last persisted one and is packed like the rest.
    expect(lefts(layoutSectors([strip[3]!, box("e", 1800), strip[0]!]))).toEqual([["a", 0], ["d", 450], ["e", 900]]);
    expect(SECTOR_GAP_MM).toBe(50);
  });

  it("does not blank valid roots when one has no drawable geometry", () => {
    const unplaced = node("root-x", "box", "enclosure", null, null);
    const unknown = node("root-y", "missing-item", "enclosure", 1400, 0);
    const geometry = geometryOf([rootA, unplaced, rootB, unknown]);
    expect(geometry.sectors.map(sector => sector.root.uuid)).toEqual(["root-a", "root-b"]);
    expect(geometry.skipped.map(entry => entry.uuid)).toEqual(["root-x", "root-y"]);
    const html = markup([rootA, unplaced, rootB, unknown]);
    expect(rootUuids(html)).toEqual(["root-a", "root-b"]);
    expect(html).toContain("2 carpenterie non sono mostrate");
    expect(markup([rootA, unplaced])).toContain("Una carpenteria non è mostrata");
    // Nothing drawable at all keeps the existing explanation instead of an empty drawing.
    expect(markup([unplaced])).toContain("Vista non disponibile");
  });

  it("fits every sector, including at the drawing box's own aspect ratio", () => {
    for (const viewport of [null, viewportPx, { width: 300, height: 900 }]) {
      const geometry = geometryOf(normal, { viewportPx: viewport });
      const [x, y, w, h] = geometry.viewBox;
      for (const sector of geometry.sectors) {
        expect(sector.displayBounds.left).toBeGreaterThanOrEqual(x);
        expect(sector.displayBounds.right).toBeLessThanOrEqual(x + w);
        expect(sector.displayBounds.top).toBeGreaterThanOrEqual(y);
        expect(sector.displayBounds.bottom).toBeLessThanOrEqual(y + h);
      }
      if (viewport) expect(w / h).toBeCloseTo(viewport.width / viewport.height, 9);
    }
    // Overlapping older roots are fitted where they are shown, not where they are saved.
    const twin = node("root-t", "box", "enclosure", 0, 0, []);
    const stacked = geometryOf([rootA, twin]);
    expect(stacked.bounds!.right).toBe(850);
    expect(stacked.viewBox[0] + stacked.viewBox[2]).toBeGreaterThan(850);
  });

  it("centres zoom on the focused sector without hiding the others", () => {
    const centreX = (geometry: CombinedFrontGeometry) => geometry.viewBox[0] + geometry.viewBox[2] / 2;
    const fit = geometryOf(normal, { viewportPx, focusUuid: "root-a" });
    const fitOther = geometryOf(normal, { viewportPx, focusUuid: "root-c" });
    // At the fitted zoom the focus changes nothing.
    expect(fitOther.viewBox).toEqual(fit.viewBox);
    const zoomedA = geometryOf(normal, { viewportPx, focusUuid: "root-a", zoom: 2.5 });
    const zoomedC = geometryOf(normal, { viewportPx, focusUuid: "root-c", zoom: 2.5 });
    expect(centreX(zoomedA)).toBeLessThan(centreX(zoomedC));
    // The focused sector is inside the zoomed window, and the window stays within the fitted extent.
    for (const [zoomed, uuid] of [[zoomedA, "root-a"], [zoomedC, "root-c"]] as const) {
      const sector = zoomed.sectors.find(entry => entry.root.uuid === uuid)!;
      const [x, , w] = zoomed.viewBox;
      expect(sector.displayBounds.left).toBeGreaterThanOrEqual(x);
      expect(sector.displayBounds.right).toBeLessThanOrEqual(x + w);
      expect(x).toBeGreaterThanOrEqual(fit.viewBox[0] - 1e-9);
      expect(x + w).toBeLessThanOrEqual(fit.viewBox[0] + fit.viewBox[2] + 1e-9);
      expect(zoomed.sectors).toHaveLength(3);
    }
    // Zooming out is centred on the whole drawing.
    expect(centreX(geometryOf(normal, { viewportPx, focusUuid: "root-c", zoom: .5 }))).toBeCloseTo(centreX(fit), 9);
    expect(markup(normal, { zoom: 2.5, focusUuid: "root-c" })).toContain('data-root-uuid="root-a"');
  });

  it("converts between display and persisted coordinates through the sector's offset only", () => {
    const shifted = geometryOf([node("root-1", "box", "enclosure", 0, 0), node("root-2", "box", "enclosure", 100, 30)]);
    const second = shifted.sectors[1]!;
    expect(shifted.sectors[0]!.offset).toEqual({ x: 0, y: 30 });
    expect(second.offset).toEqual({ x: 350, y: 0 });
    expect(toDisplayPoint(shifted.sectors[0]!, { x: 10, y: 60 })).toEqual({ x: 10, y: 90 });
    expect(toDisplayPoint(second, { x: 150, y: 60 })).toEqual({ x: 500, y: 60 });
    expect(toPersistedPoint(second, { x: 500, y: 60 })).toEqual({ x: 150, y: 60 });
    expect(toPersistedPoint(shifted.sectors[0]!, { x: 10, y: 90 })).toEqual({ x: 10, y: 60 });
    expect(sectorOfContainer(shifted, "root-2")).toBe(second);
    expect(sectorOfContainer(shifted, "nowhere")).toBeUndefined();
  });
});

describe("combined hit-testing", () => {
  const targets: TargetEntry[] = [deviceEntry("panel-a", rect(20, 290, 20, 40)), deviceEntry("panel-b", rect(470, 290, 20, 40)),
    deviceEntry("panel-c", rect(920, 290, 20, 40))];
  const centre = (entry: TargetEntry) => ({ x: entry.target.subject.xMm + entry.target.subject.widthMm / 2,
    y: entry.target.subject.yMm + entry.target.subject.heightMm / 2 });

  it("picks the target in every sector at every supported zoom, exactly", () => {
    // 100%, 125%, ~156% and ~195%: the zoom steps of the Fronte Quadro controls.
    for (const zoom of [1, 1.25, 1.25 ** 2, 1.25 ** 3]) {
      for (const [focusUuid, wanted] of [["root-a", targets[0]!], ["root-b", targets[1]!], ["root-c", targets[2]!]] as const) {
        const geometry = geometryOf(normal, { zoom, focusUuid, viewportPx });
        // The focused sector is always on screen and hit-testable; the others where they are visible.
        for (const entry of targets) {
          const point = centre(entry);
          if (entry !== wanted && !visible(geometry.viewBox, point)) continue;
          const drawn = clientToViewBox(toClient(geometry.viewBox, point), clientBox, geometry.viewBox)!;
          const picked = pickCombinedTarget(targets, geometry, drawn, "device")!;
          expect(picked.entry).toBe(entry);
          expect(picked.sector.root.uuid).toBe(`root-${entry.parentUuid.slice(-1)}`);
          // One millimetre outside the returned rectangle nothing is snapped.
          const beside = { x: entry.target.subject.xMm + entry.target.subject.widthMm + 1, y: point.y };
          if (visible(geometry.viewBox, beside))
            expect(pickCombinedTarget(targets, geometry, clientToViewBox(toClient(geometry.viewBox, beside), clientBox,
              geometry.viewBox)!, "device")).toBeNull();
        }
        expect(visible(geometry.viewBox, centre(wanted))).toBe(true);
      }
    }
  });

  it("offers no target in the gap between sectors, or outside every sector", () => {
    const geometry = geometryOf(normal, { viewportPx });
    const wide = deviceEntry("panel-a", rect(0, 0, 400, 600));
    for (const x of [400.5, 425, 449.5, 850.5, 875]) {
      expect(sectorAt(geometry, { x, y: 300 })).toBeNull();
      expect(pickCombinedTarget([...targets, wide], geometry, { x, y: 300 }, "device")).toBeNull();
      expect(pickCombinedTarget([...targets, wide], geometry, { x, y: 300 }, "support")).toBeNull();
    }
    expect(pickCombinedTarget(targets, geometry, { x: -30, y: 30 }, "device")).toBeNull();
    expect(pickCombinedTarget(targets, geometry, { x: 30, y: 900 }, "device")).toBeNull();
    // The gap in screen terms: the pointer maps into the drawing, lands between sectors, and finds nothing.
    const drawn = clientToViewBox(toClient(geometry.viewBox, { x: 425, y: 300 }), clientBox, geometry.viewBox)!;
    expect(pickCombinedTarget(targets, geometry, drawn, "device")).toBeNull();
  });

  it("never lets a target leak across sectors, even when overlapping roots share persisted coordinates", () => {
    // Two older roots saved at the same place: identical persisted rectangles, one shown 450 mm to the right.
    const older = node("old-a", "box", "enclosure", 0, 0, [node("old-panel-a", "tray", "support", 10, 20, [], "old-a")]);
    const newer = node("old-b", "box", "enclosure", 0, 0, [node("old-panel-b", "tray", "support", 10, 20, [], "old-b")]);
    const geometry = geometryOf([older, newer], { viewportPx });
    expect(geometry.sectors.map(sector => sector.offset.x)).toEqual([0, 450]);
    const onlyB = [deviceEntry("old-panel-b", rect(20, 30, 20, 40))];
    const onlyA = [deviceEntry("old-panel-a", rect(20, 30, 20, 40))];
    const overA = { x: 30, y: 50 }, overB = { x: 480, y: 50 };
    expect(pickCombinedTarget(onlyB, geometry, overA, "device")).toBeNull();
    expect(pickCombinedTarget(onlyB, geometry, overB, "device")!.entry).toBe(onlyB[0]);
    expect(pickCombinedTarget(onlyB, geometry, overB, "device")!.sector.root.uuid).toBe("old-b");
    expect(pickCombinedTarget(onlyA, geometry, overB, "device")).toBeNull();
    expect(pickCombinedTarget(onlyA, geometry, overA, "device")!.sector.root.uuid).toBe("old-a");
    // The chosen entry is the backend's own, in persisted coordinates: it is never translated.
    expect(pickCombinedTarget(onlyB, geometry, overB, "device")!.entry.target.subject).toEqual(rect(20, 30, 20, 40));
    // Pannello targets are confined to the Carpenteria sector they were offered for.
    const panelTargets = [supportEntry("old-b", rect(0, 100, 400, 100))];
    expect(pickCombinedTarget(panelTargets, geometry, { x: 100, y: 120 }, "support")).toBeNull();
    expect(pickCombinedTarget(panelTargets, geometry, { x: 550, y: 120 }, "support")!.sector.root.uuid).toBe("old-b");
  });

  it("makes everything visible in the drawing box hit-testable (letterbox), as long as its size is known", () => {
    const tight = geometryOf(normal);
    const fitted = geometryOf(normal, { viewportPx });
    const left = { x: clientBox.left + 1, y: clientBox.top + clientBox.height / 2 };
    const right = { x: clientBox.left + clientBox.width - 1, y: left.y };
    // Without the box size the viewBox is tight and the canvas letterboxes it: those pixels find no drawing coordinates.
    expect(clientToViewBox({ x: left.x, y: clientBox.top + 1 }, clientBox, tight.viewBox)).toBeNull();
    for (const zoom of [.5, 1, 1.25, 1.25 ** 3]) {
      const geometry = geometryOf(normal, { viewportPx, zoom, focusUuid: "root-b" });
      for (const edge of [left, right, { x: left.x, y: clientBox.top + 1 }, { x: left.x, y: clientBox.top + clientBox.height - 1 }])
        expect(clientToViewBox(edge, clientBox, geometry.viewBox)).not.toBeNull();
    }
    expect(fitted.viewBox[2] / fitted.viewBox[3]).toBeCloseTo(4 / 3, 9);
  });

  it("keeps caption text small and inside its sector", () => {
    expect(captionText("MDX 800", 400, 10)).toBe("MDX 800");
    const cut = captionText("Un nome di carpenteria molto molto lungo", 100, 10);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length * 10 * .62).toBeLessThanOrEqual(100);
    expect(captionText("X", 1, 10)).toBe("X");
    // Captions stay CAPTION_PX tall on screen at every zoom, and a single sector has none.
    for (const zoom of [1, 2, .5]) {
      const geometry = geometryOf(normal, { viewportPx, zoom });
      const scale = viewportPx.width / geometry.viewBox[2];
      expect(geometry.captionMm! * scale).toBeCloseTo(CAPTION_PX, 6);
    }
    expect(geometryOf([rootA], { viewportPx }).captionMm).toBeNull();
    // The band above the sectors is reserved, so a caption never leaves the viewBox.
    for (const viewport of [viewportPx, { width: 1600, height: 400 }]) {
      const reserved = geometryOf(normal, { viewportPx: viewport });
      expect(reserved.viewBox[1]).toBeLessThan(-reserved.captionMm! * 1.35);
    }
  });
});

describe("multi-Carpenteria targets and drag ghost", () => {
  const device: DragSubject = { origin: "pool", kind: "device", item: switchItem };
  const placedDevice: DragSubject = { origin: "node", kind: "device", item: switchItem, nodeUuid: "d1", parentUuid: "panel-a" };
  const pooledPanel: DragSubject = { origin: "pool", kind: "support", item: tray };
  const placedPanel: DragSubject = { origin: "node", kind: "support", item: tray, nodeUuid: "panel-b", parentUuid: "root-b" };

  it("asks every visible Carpenteria about a Pannello, pooled or placed, and every Pannello for a device", () => {
    expect(targetParents(device, rootB, normal)).toEqual(["panel-a", "panel-b", "panel-c"]);
    expect(targetParents(placedDevice, rootA, normal)).toEqual(["panel-a", "panel-b", "panel-c"]);
    // The focused Carpenteria plays no part: the backend alone decides which of them accept the Pannello.
    for (const focus of normal) {
      expect(targetParents(pooledPanel, focus, normal)).toEqual(["root-a", "root-b", "root-c"]);
      expect(targetParents(placedPanel, focus, normal)).toEqual(["root-a", "root-b", "root-c"]);
    }
    expect(targetParents({ ...placedPanel, parentUuid: undefined }, rootA, normal)).toEqual(["root-a", "root-b", "root-c"]);
    // One argument keeps the single-Carpenteria behaviour.
    expect(targetParents(device, rootA)).toEqual(["panel-a"]);
    expect(targetParents(pooledPanel, rootA)).toEqual(["root-a"]);
  });

  it("finds a container's Carpenteria and phrases the empty-quadro guidance for several", () => {
    expect(locateNode(normal, "panel-c")).toEqual({ node: rootC.children[0], root: rootC });
    expect(locateNode(normal, "root-b")!.root).toBe(rootB);
    expect(locateNode(normal, "nowhere")).toBeUndefined();
    const none: LoadedTargets = { entries: [], diagnostics: [], parents: [] };
    expect(dragGuidance(device, "ready", none, null)).toContain("Nessun pannello in questa carpenteria");
    expect(dragGuidance(device, "ready", none, null, 3)).toBe("Nessun pannello nel quadro: trascina prima un pannello su una carpenteria.");
  });

  it("sizes the drag ghost from the drawing scale within a sensible range", () => {
    // True on-screen size at the drawing's scale.
    expect(ghostSize({ widthMm: 200, heightMm: 100 }, .25)).toEqual({ width: 50, height: 25 });
    expect(ghostSize({ widthMm: 18, heightMm: 80 }, .1)).toEqual({ width: 4.5, height: GHOST_MIN_PX });
    expect(ghostSize({ widthMm: 18, heightMm: 80 }, .5)).toEqual({ width: 9, height: 40 });
    // Never oversized, aspect ratio preserved; never a speck.
    const large = ghostSize({ widthMm: 600, heightMm: 300 }, 1);
    expect(large.width).toBe(GHOST_MAX_PX);
    expect(large.height).toBe(GHOST_MAX_PX / 2);
    const tiny = ghostSize({ widthMm: 9, heightMm: 45 }, .1);
    expect(Math.max(tiny.width, tiny.height)).toBe(GHOST_MIN_PX);
    expect(tiny.width / tiny.height).toBeCloseTo(.2, 9);
    // Before layout there is no scale: one pixel per millimetre, clamped the same way.
    expect(ghostSize({ widthMm: 500, heightMm: 100 }, null).width).toBe(GHOST_MAX_PX);
    expect(ghostSize({ widthMm: 0, heightMm: 0 }, 1)).toEqual({ width: 0, height: 0 });
  });

  it("makes the pointer ghost subtler over a valid target and passes the drawn size through", () => {
    const css = readFileSync("src/renderer/styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const opacity = (selector: string) => Number(css.match(new RegExp(`${selector.replace(/[[\]"=.]/g, "\\$&")}\\s*\\{[^}]*opacity:\\s*([\\d.]+)`))![1]);
    expect(opacity('.drag-ghost[data-hovering="true"]')).toBeLessThan(opacity(".drag-ghost"));
    expect(opacity('.drag-ghost[data-hovering="true"]')).toBeLessThanOrEqual(.2);
    const source = readFileSync("src/renderer/project/ProgettazioneScreen.tsx", "utf8");
    expect(source).toMatch(/width:ghost\.width,height:ghost\.height/);
    expect(source).not.toMatch(/ghostScale/);
  });
});

describe("combined workspace is renderer-only", () => {
  it("adds no pan tool, persisted sector order, or renderer compatibility rule", () => {
    for (const file of ["ProgettazioneScreen.tsx", "front-geometry.ts", "placement-drag.ts"]) {
      const source = readFileSync(`src/renderer/project/${file}`, "utf8");
      expect(source).not.toMatch(/onWheel|pan(?:X|Y|ning)|setPointerCapture|sectorNumber|sectorOrder|sortOrder/);
      expect(source).not.toMatch(/BTicino|TiQuadri|\btq\.|MDX|checkPackedChild|validPackedDestinations/i);
    }
  });
});

describe("horizontal navigation of the zoomed drawing (display only)", () => {
  const at = (zoom: number, scrollX: number | null = null, focusUuid = "root-a") =>
    geometryOf(normal, { viewportPx, zoom, focusUuid, scrollX });
  const scaleOf = (geometry: CombinedFrontGeometry) => viewportPx.width / geometry.viewBox[2];

  it("has no scrollbar or scrolling while the whole drawing fits", () => {
    for (const zoom of [.5, 1]) {
      const geometry = at(zoom, 500);
      expect(scrollThumb(geometry)).toBeNull();
      expect(geometry.scrollRange.max).toBe(geometry.scrollRange.min);
      expect(wheelPanTarget(geometry, scaleOf(geometry), { shiftKey: true, deltaX: 0, deltaY: 100 })).toBeNull();
      expect(keyScrollTarget(geometry, { key: "ArrowRight" }, true)).toBeNull();
    }
    const project = { configuredItems: items, physicalNodes: normal,
      lines: items.map(entry => ({ itemUuid: entry.uuid, quantity: 1 })) } as unknown as ProjectDocumentView;
    expect(renderToStaticMarkup(<ProgettazioneScreen project={project} api={{} as ProjectApi} onProjectChange={() => undefined} />))
      .not.toContain("front-scrollbar");
  });

  it("overflows above the fitted zoom, and the thumb reports the visible region", () => {
    const fit = at(1);
    for (const zoom of [1.25, 1.25 ** 2, 1.25 ** 3]) {
      const geometry = at(zoom);
      const thumb = scrollThumb(geometry)!;
      expect(thumb.size).toBeCloseTo(1 / zoom, 9);
      expect(thumb.start).toBeGreaterThanOrEqual(0);
      expect(thumb.start + thumb.size).toBeLessThanOrEqual(1 + 1e-9);
      expect(geometry.scrollRange.min).toBeCloseTo(fit.viewBox[0], 9);
      expect(geometry.scrollRange.max + geometry.viewBox[2]).toBeCloseTo(fit.viewBox[0] + fit.viewBox[2], 9);
    }
    // Without a scroll position the window follows the focus (as before).
    expect(scrollThumb(at(1.25 ** 3, null, "root-a"))!.start).toBeLessThan(scrollThumb(at(1.25 ** 3, null, "root-c"))!.start);
  });

  it("moves the visible horizontal region with the scrollbar position and clamps at the ends", () => {
    const zoom = 1.25 ** 3;
    const { min, max } = at(zoom).scrollRange;
    const start = at(zoom, min), middle = at(zoom, (min + max) / 2), end = at(zoom, max), beyond = at(zoom, max + 500);
    expect(start.viewBox[0]).toBe(min);
    expect(scrollThumb(start)!.start).toBeCloseTo(0, 9);
    expect(middle.viewBox[0]).toBeCloseTo((min + max) / 2, 9);
    expect(end.viewBox[0]).toBeCloseTo(max, 9);
    expect(scrollThumb(end)!.start + scrollThumb(end)!.size).toBeCloseTo(1, 9);
    expect(beyond.viewBox[0]).toBeCloseTo(max, 9);
    expect(at(zoom, min - 500).viewBox[0]).toBe(min);
    // Only the horizontal window moves: same width, same vertical window, same sectors and offsets.
    expect(end.viewBox.slice(1)).toEqual(start.viewBox.slice(1));
    expect(end.sectors.map(sector => [sector.root.uuid, sector.offset, sector.bounds])).toEqual(
      start.sectors.map(sector => [sector.root.uuid, sector.offset, sector.bounds]));
    // Every Carpenteria can be brought into view.
    for (const [uuid, wanted] of [["root-a", start], ["root-c", end]] as const) {
      const sector = wanted.sectors.find(entry => entry.root.uuid === uuid)!;
      expect(sector.displayBounds.left).toBeGreaterThanOrEqual(wanted.viewBox[0]);
      expect(sector.displayBounds.right).toBeLessThanOrEqual(wanted.viewBox[0] + wanted.viewBox[2]);
    }
    // The drawing itself is drawn through the scrolled window, and only its viewBox changes.
    const vb = (html: string) => html.match(/<svg class="front-drawing"[^>]*viewBox="([^"]+)"/)![1]!.split(" ").map(Number);
    const drawnStart = markup(normal, { zoom, focusUuid: "root-a", viewportPx, scrollX: min });
    const drawnEnd = markup(normal, { zoom, focusUuid: "root-a", viewportPx, scrollX: max });
    expect(vb(drawnStart)).toEqual(start.viewBox);
    expect(vb(drawnEnd)[0]).toBeCloseTo(end.viewBox[0], 9);
    expect(drawnEnd.slice(drawnEnd.indexOf(">"))).toBe(drawnStart.slice(drawnStart.indexOf(">")));
    expect(drawnEnd).toContain('id="front-drawing"');
  });

  it("pans sideways with Shift + wheel (or a horizontal delta), by the wheel distance at the current scale", () => {
    const geometry = at(1.25 ** 2, null, "root-b");
    const scale = scaleOf(geometry);
    const wheel = { shiftKey: true, deltaX: 0, deltaY: 60 };
    // Without Shift a vertical wheel moves vertically only; the horizontal position is untouched.
    expect(wheelPanTarget(geometry, scale, { ...wheel, shiftKey: false })!.x).toBeNull();
    const right = wheelPanTarget(geometry, scale, wheel)!;
    expect(right.x).toBeCloseTo(geometry.viewBox[0] + 60 / scale, 9);
    expect(right.y).toBeNull();
    // macOS reports the Shift-scroll on deltaX; negative goes left; line-mode deltas are scaled.
    expect(wheelPanTarget(geometry, scale, { shiftKey: true, deltaX: -30, deltaY: 0 })!.x).toBeCloseTo(geometry.viewBox[0] - 30 / scale, 9);
    expect(wheelPanTarget(geometry, scale, { shiftKey: true, deltaX: 0, deltaY: 3, deltaMode: 1 })!.x).toBeCloseTo(geometry.viewBox[0] + 48 / scale, 9);
    expect(wheelPanTarget(geometry, null, wheel)).toBeNull();
    expect(wheelPanTarget(geometry, scale, { shiftKey: true, deltaX: 0, deltaY: 1e6 })!.x).toBe(geometry.scrollRange.max);
    expect(scrolledX(geometry, -1e6)).toBe(geometry.scrollRange.min);
  });

  it("scrolls with Left/Right only when the drawing area itself has focus", () => {
    const geometry = at(1.25 ** 2, null, "root-b");
    const step = geometry.viewBox[2] * ARROW_SCROLL_FRACTION;
    expect(keyScrollTarget(geometry, { key: "ArrowRight" }, true)).toBeCloseTo(geometry.viewBox[0] + step, 9);
    expect(keyScrollTarget(geometry, { key: "ArrowLeft" }, true)).toBeCloseTo(geometry.viewBox[0] - step, 9);
    // A focused control inside or outside the area keeps its own arrow keys.
    expect(keyScrollTarget(geometry, { key: "ArrowRight" }, false)).toBeNull();
    for (const key of ["ArrowUp", "ArrowDown", "Enter", "a"]) expect(keyScrollTarget(geometry, { key }, true)).toBeNull();
    for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) expect(keyScrollTarget(geometry, { key: "ArrowLeft", [modifier]: true }, true)).toBeNull();
    const source = readFileSync("src/renderer/project/ProgettazioneScreen.tsx", "utf8");
    expect(source).toContain("keyScrollTarget(geometry,event,event.target===svgRef.current)");
    expect(source).toMatch(/tabIndex=\{focusable \? 0 : undefined\}/);
    expect(markup(normal, { focusable: true })).toMatch(/<svg class="front-drawing" role="img"[^>]*tabindex="0"/);
    expect(markup(normal)).not.toContain("tabindex");
  });

  it("renders a thin scrollbar reflecting the window and never touches project state", () => {
    const html = renderToStaticMarkup(<FrontScrollbar start={.25} size={.5} onStart={() => undefined} />);
    expect(html).toContain('role="scrollbar" aria-orientation="horizontal"');
    expect(html).toContain('style="left:25%;width:50%"');
    expect(html).toContain('aria-valuenow="50"');
    const css = readFileSync("src/renderer/styles.css", "utf8");
    expect(css).toMatch(/\.front-scrollbar \{[^}]*height: 8px/);
    for (const file of ["FrontScrollbar.tsx", "front-geometry.ts"])
      expect(readFileSync(`src/renderer/project/${file}`, "utf8")).not.toMatch(/onProjectChange|placeRoot|moveNode|api\./);
    // Navigation state is local: it is reset by zoom and focus, and never passed to a project call.
    const screen = readFileSync("src/renderer/project/ProgettazioneScreen.tsx", "utf8");
    expect(screen).not.toMatch(/onProjectChange\([^)]*scrollX/);
    expect(screen).toMatch(/const focusRoot=\(uuid:string\)=>\{setScrollX\(null\)/);
  });
});

describe("bottom alignment of different-height Carpenterie (display only)", () => {
  const tall = node("tall", "box", "enclosure", 0, 0, [node("tall-panel", "tray", "support", 10, 300, [], "tall")]);
  const shortRoot = node("short", "box-short", "enclosure", 450, 0, [node("short-panel", "tray", "support", 460, 300, [], "short")]);
  const mixed = [tall, shortRoot];
  const bottomOf = (geometry: CombinedFrontGeometry, uuid: string) => {
    const sector = geometry.sectors.find(entry => entry.root.uuid === uuid)!;
    const own = sector.drawable.find(entry => entry.node.uuid === uuid)!;
    return own.node.yMm! + own.view.heightMm + sector.offset.y;
  };

  it("keeps equal-height roots on one line with no Y offset", () => {
    for (const geometry of [geometryOf(normal), geometryOf([rootA, rootB])])
      expect(geometry.sectors.map(sector => sector.offset.y)).toEqual(geometry.sectors.map(() => 0));
    expect(markup(normal)).not.toContain("transform=");
  });

  it("puts different-height roots on a common displayed bottom edge without touching persisted coordinates", () => {
    const frozen = JSON.stringify(mixed);
    const geometry = geometryOf(mixed);
    expect(geometry.sectors.map(sector => sector.offset)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 150 }]);
    expect(bottomOf(geometry, "tall")).toBe(600);
    expect(bottomOf(geometry, "short")).toBe(600);
    // The 450 mm root is drawn 150 mm lower; its panel goes with it; the saved coordinates are untouched.
    const html = markup(mixed);
    expect(html).toContain('data-root-uuid="short" transform="translate(0 150)"');
    expect(html).toContain('<rect x="450" y="0" width="400" height="450"');
    expect(html).toContain("· (450, 0) mm</title>");
    expect(JSON.stringify(mixed)).toBe(frozen);
    expect(mixed.map(entry => [entry.xMm, entry.yMm, entry.rootXMm, entry.rootYMm])).toEqual([[0, 0, 0, 0], [450, 0, 450, 0]]);
    // The floor follows the lowest root wherever it is saved, and the order of the input does not matter.
    const lower = node("lower", "box-short", "enclosure", 450, 300, []);
    const other = geometryOf([lower, tall]);
    expect(other.sectors.map(sector => [sector.root.uuid, sector.offset.y])).toEqual([["tall", 150], ["lower", 0]]);
    expect(geometryOf([shortRoot, tall]).sectors.map(sector => sector.offset)).toEqual(geometry.sectors.map(sector => sector.offset));
    // With overlapping roots the X strip and the floor combine.
    const stacked = geometryOf([tall, node("twin", "box-short", "enclosure", 0, 0, [])]);
    expect(stacked.sectors.map(sector => sector.offset)).toEqual([{ x: 0, y: 0 }, { x: 450, y: 150 }]);
    expect(stacked.sectors[1]!.displayBounds).toMatchObject({ left: 450, bottom: 600 });
  });

  it("hit-tests exactly through a non-zero Y offset, also while scrolled and at every zoom", () => {
    const geometryAt = (zoom: number, scrollX: number | null = null) =>
      geometryOf(mixed, { viewportPx, zoom, focusUuid: "tall", scrollX });
    const entry = deviceEntry("short-panel", rect(470, 310, 20, 40));
    const other = deviceEntry("tall-panel", rect(20, 310, 20, 40));
    const entries = [entry, other];
    const persistedCentre = { x: 480, y: 330 };
    for (const zoom of [1, 1.25, 1.25 ** 2, 1.25 ** 3]) {
      const fit = geometryAt(zoom);
      const { min, max } = fit.scrollRange;
      for (const scrollX of [null, min, (min + max) / 2, max]) {
        const geometry = geometryAt(zoom, scrollX);
        const display = toDisplayPoint(geometry.sectors[1]!, persistedCentre);
        expect(display).toEqual({ x: 480, y: 480 });
        if (!visible(geometry.viewBox, display)) continue;
        const drawn = clientToViewBox(toClient(geometry.viewBox, display), clientBox, geometry.viewBox)!;
        const picked = pickCombinedTarget(entries, geometry, drawn, "device")!;
        expect(picked.entry).toBe(entry);
        expect(picked.sector.root.uuid).toBe("short");
        // The unshifted position (what the pointer would be over without the Y offset) picks nothing.
        expect(pickCombinedTarget(entries, geometry, persistedCentre, "device")).toBeNull();
        // One millimetre outside the rectangle, above and below, finds nothing.
        for (const dy of [-21, 21]) expect(pickCombinedTarget(entries, geometry, { x: display.x, y: display.y + dy }, "device")).toBeNull();
      }
    }
    // The other sector (no offset) still picks in place.
    const geometry = geometryAt(1);
    expect(pickCombinedTarget(entries, geometry, { x: 30, y: 330 }, "device")!.entry).toBe(other);
  });

  it("draws overlays and the hover preview inside the sector's Y offset", () => {
    const base = deviceEntry("short-panel", rect(470, 310, 20, 40));
    const hover: TargetEntry = { ...base, target: { ...base.target, affected: [{ nodeUuid: "x", rect: rect(490, 310, 20, 40) }] } };
    const html = markup(mixed, { overlay: { parents: ["short-panel"], hover,
      subject: { origin: "pool", kind: "device", item: switchItem } } });
    const sector = html.slice(html.indexOf('data-root-uuid="short"'));
    expect(sector).toContain('class="front-target-parent" data-parent-uuid="short-panel"');
    expect(sector).toContain('class="front-target-subject" x="470" y="310"');
    expect(sector).toContain('class="front-target-affected" x="490" y="310"');
    expect(html.slice(0, html.indexOf('data-root-uuid="short"'))).not.toContain("front-target");
  });
});
