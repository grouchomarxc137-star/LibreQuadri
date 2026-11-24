/// <reference types="node" />
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FronteQuadro } from "../../src/renderer/project/ProgettazioneScreen.js";
import * as annotationLayer from "../../src/renderer/project/FrontAnnotations.js";
import type { NoteLayer } from "../../src/renderer/project/FrontAnnotations.js";
import { FONT_PRESETS, RESIZE_HANDLES, annotationMinHeightMm, beginGesture, presetLabelFor, steppedFontSize, submitNoteFontSize, validFontSize, createdRect, drawingPointAt, endGesture, enforceMinimum, gestureOverride, gestureRubber, handlePoint, noteKeyCommand, normalizedRect, rectOf, resizedRect, routeNotePress, routeTakesPress, stepGesture, submitNewNote, submitNoteRect,
  submitNoteRemoval, submitNoteText, type NoteGesture, type NoteRect, type ResizeHandle } from "../../src/renderer/project/front-annotations.js";
import { combinedFrontGeometry, drawingScale, type FrontViewBox } from "../../src/renderer/project/front-geometry.js";
import { isTextEntryTarget } from "../../src/renderer/project/design-selection.js";
import { ANNOTATION_FONT_MAX_MM, ANNOTATION_FONT_MIN_MM, ANNOTATION_MIN_HEIGHT_MM, ANNOTATION_MIN_WIDTH_MM, type ProjectAnnotation, type ProjectConfiguredItem,
  type ProjectPhysicalNode } from "../../src/shared/project.js";

const item = (uuid: string, kind: "enclosure" | "support" | "device", code: string, width: number, height: number): ProjectConfiguredItem => ({
  uuid, modelKind: kind, modelName: `${code} modello`, modelCode: code, modelBrandMarchio: "TEST", configLabel: code,
  physStatus: "resolved", bom: [{ role: "primary", manufacturerCode: `${code}-ARTICLE` }],
  views: [{ viewCode: "front", widthMm: width, heightMm: height, assetKey: null }], zones: [],
} as unknown as ProjectConfiguredItem);
const node = (uuid: string, itemUuid: string, kind: "enclosure" | "support" | "device", x: number, y: number,
  children: ProjectPhysicalNode[] = [], parentUuid: string | null = null): ProjectPhysicalNode => ({
  uuid, itemUuid, nodeKind: kind, xMm: x, yMm: y, viewCode: "front", children, parentUuid,
  zoneNo: null, startUnits: null, slotNo: null, rootXMm: x, rootYMm: y, sortOrder: 0, positionIssue: null,
});
const box = item("box", "enclosure", "BOX", 600, 900);
const tray = item("tray", "support", "TRAY", 300, 100);
const items = [box, tray];
const root = node("root", "box", "enclosure", 0, 0, [node("panel", "tray", "support", 100, 400, [], "root")]);
const note = (uuid: string, x = 50, y = 60, w = 200, h = 80, text = "Nota", fontSizeMm = 12): ProjectAnnotation =>
  ({ uuid, text, xMm: x, yMm: y, widthMm: w, heightMm: h, fontSizeMm });

// A 800 x 600 px drawing box at (100, 50): where a drawing point is on screen, and back.
const client = { left: 100, top: 50, width: 800, height: 600 };
const viewportPx = { width: client.width, height: client.height };
const toClient = (viewBox: FrontViewBox, point: { x: number; y: number }) => {
  const scale = Math.min(client.width / viewBox[2], client.height / viewBox[3]);
  return { x: client.left + (client.width - viewBox[2] * scale) / 2 + (point.x - viewBox[0]) * scale,
    y: client.top + (client.height - viewBox[3] * scale) / 2 + (point.y - viewBox[1]) * scale, scale };
};
const geometryAt = (zoom: number, scrollX: number | null = null, scrollY: number | null = null) =>
  combinedFrontGeometry([root], items, { viewportPx, zoom, focusUuid: "root", scrollX, scrollY });
const labelled = (html: string) => [...html.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map(match => match[1]);
const layerOf = (overrides: Partial<NoteLayer> = {}): NoteLayer => ({ selectedUuid: null, editing: null, overrides: new Map(), rubber: null,
  onCommit: () => undefined, onCancel: () => undefined, ...overrides });
const draw = (notes: readonly ProjectAnnotation[], layer?: NoteLayer, props: Partial<Parameters<typeof FronteQuadro>[0]> = {}) =>
  renderToStaticMarkup(<FronteQuadro roots={[root]} items={items} annotations={notes} noteLayer={layer} viewportPx={viewportPx} {...props} />);
const rectAttrs = (html: string, className: string) => [...html.matchAll(new RegExp(`<rect class="${className}" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`, "g"))]
  .map(match => match.slice(1, 5).map(Number));
const drag = (gesture: NoteGesture, steps: [number, number][], view: FrontViewBox = geometryAt(1).viewBox) => {
  let current = gesture;
  for (const [x, y] of steps) {
    const point = drawingPointAt({ x, y }, client, view)!;
    current = stepGesture(current, point, { x, y });
  }
  return current;
};

describe("creating a text box by dragging", () => {
  it("makes a rectangle in drawing millimetres from the two corners", () => {
    const view = geometryAt(1).viewBox;
    const a = toClient(view, { x: 100, y: 120 }), b = toClient(view, { x: 400, y: 260 });
    const start = drawingPointAt({ x: a.x, y: a.y }, client, view)!;
    expect(start.x).toBeCloseTo(100, 6); expect(start.y).toBeCloseTo(120, 6);
    const gesture = drag(beginGesture("create", { start, startPx: { x: a.x, y: a.y } }), [[b.x, b.y]], view);
    const outcome = endGesture(gesture, drawingPointAt({ x: b.x, y: b.y }, client, view), { x: b.x, y: b.y });
    expect(outcome).toEqual({ kind: "new-box", rect: { xMm: 100, yMm: 120, widthMm: 300, heightMm: 140 } });
    expect(gestureRubber(gesture)).toEqual(normalizedRect(start, drawingPointAt({ x: b.x, y: b.y }, client, view)!));
  });

  it("is the same rectangle whichever way the drag goes", () => {
    const corners = [[{ x: 100, y: 100 }, { x: 400, y: 300 }], [{ x: 400, y: 300 }, { x: 100, y: 100 }],
      [{ x: 400, y: 100 }, { x: 100, y: 300 }], [{ x: 100, y: 300 }, { x: 400, y: 100 }]] as const;
    for (const [from, to] of corners) expect(createdRect(from, to)).toEqual({ xMm: 100, yMm: 100, widthMm: 300, heightMm: 200 });
    expect(normalizedRect({ x: 5, y: 9 }, { x: 1, y: 2 })).toEqual({ xMm: 1, yMm: 2, widthMm: 4, heightMm: 7 });
  });

  it("raises a tiny or accidental box to the minimum size, keeping its top-left corner", () => {
    expect(createdRect({ x: 10, y: 20 }, { x: 12, y: 21 })).toEqual({ xMm: 10, yMm: 20, widthMm: ANNOTATION_MIN_WIDTH_MM, heightMm: ANNOTATION_MIN_HEIGHT_MM });
    // A reverse tiny drag keeps the normalised top-left.
    expect(createdRect({ x: 12, y: 21 }, { x: 10, y: 20 })).toEqual({ xMm: 10, yMm: 20, widthMm: ANNOTATION_MIN_WIDTH_MM, heightMm: ANNOTATION_MIN_HEIGHT_MM });
    // One side small, the other large: only the small side is raised.
    expect(createdRect({ x: 0, y: 0 }, { x: 500, y: 3 })).toEqual({ xMm: 0, yMm: 0, widthMm: 500, heightMm: ANNOTATION_MIN_HEIGHT_MM });
    expect(enforceMinimum({ xMm: 1, yMm: 2, widthMm: 1e9, heightMm: 1 }).widthMm).toBe(100_000);
    // A plain click (no drag at all) is a minimum box at that point and goes straight to typing.
    const click = beginGesture("create", { start: { x: 70.04, y: 80.06 }, startPx: { x: 300, y: 300 } });
    expect(endGesture(click, { x: 70.04, y: 80.06 }, { x: 300, y: 300 })).toEqual({ kind: "new-box",
      rect: { xMm: 70, yMm: 80.1, widthMm: ANNOTATION_MIN_WIDTH_MM, heightMm: ANNOTATION_MIN_HEIGHT_MM } });
    // A drag shorter than the drag threshold is a click.
    const jitter = drag(click, [[302, 301]]);
    expect(jitter.kind === "create" && jitter.moved).toBe(false);
    expect(gestureRubber(jitter)).toBeNull();
  });

  it("is typed into directly: a text field inside the new box, with no separate editor or menu", () => {
    const rect: NoteRect = { xMm: 50, yMm: 60, widthMm: 200, heightMm: 80 };
    const html = draw([], layerOf({ editing: { kind: "new", rect } }));
    expect(html).toMatch(/<g class="front-note" data-annotation-draft="true" data-editing="true">/);
    expect(html).toMatch(/<foreignObject class="front-note-frame" x="50" y="60" width="200" height="80"><textarea[^>]*aria-label="Testo dell&#x27;annotazione"/);
    expect(html).not.toContain("front-note-editor");
    expect(annotationLayer).not.toHaveProperty("AnnotationEditor");
    expect(readFileSync("src/renderer/project/ProgettazioneScreen.tsx", "utf8")).not.toMatch(/AnnotationEditor|noteEditor|front-note-editor/);
    expect(readFileSync("src/renderer/styles.css", "utf8")).not.toContain(".front-note-editor");
    // While the pointer drags, the rubber band shows the rectangle.
    expect(rectAttrs(draw([], layerOf({ rubber: rect })), "front-note-rubber")).toEqual([[50, 60, 200, 80]]);
  });

  it("saves the typed text with the rectangle; a blank new box is never saved", () => {
    const add = vi.fn().mockResolvedValue({});
    void submitNewNote({ addAnnotation: add }, { xMm: 50.04, yMm: 60, widthMm: 200, heightMm: 80 }, "Cablaggio");
    expect(add).toHaveBeenCalledWith({ text: "Cablaggio", xMm: 50, yMm: 60, widthMm: 200, heightMm: 80 });
    const hook = readFileSync("src/renderer/project/useFrontNotes.ts", "utf8");
    expect(hook).toMatch(/if \(blank\) \{ latest\.current\.announce\(null\); return; \}\s+await run\(\(\) => submitNewNote/);
  });
});

describe("moving a text box", () => {
  const origin = rectOf(note("n"));
  const press = (view: FrontViewBox, selected: boolean) => {
    const at = toClient(view, { x: 120, y: 90 });
    return { at, gesture: beginGesture("move", { start: drawingPointAt({ x: at.x, y: at.y }, client, view)!, startPx: { x: at.x, y: at.y },
      uuid: "n", origin, wasSelected: selected }) };
  };

  it("moves by the drawing distance the pointer covered, at any zoom", () => {
    for (const zoom of [1, 2.5, 4]) {
      const view = geometryAt(zoom).viewBox;
      const { at, gesture } = press(view, false);
      const scale = drawingScale(viewportPx, view)!;
      const end = { x: at.x + 60, y: at.y - 30 };
      const moved = drag(gesture, [[at.x + 20, at.y - 10], [end.x, end.y]], view);
      const outcome = endGesture(moved, drawingPointAt(end, client, view), end);
      expect(outcome.kind).toBe("commit");
      if (outcome.kind !== "commit") continue;
      // Positions are kept to a tenth of a millimetre, so they sit within 0.05 mm of the exact distance.
      expect(Math.abs(outcome.rect.xMm - (origin.xMm + 60 / scale))).toBeLessThanOrEqual(0.0501);
      expect(Math.abs(outcome.rect.yMm - (origin.yMm - 30 / scale))).toBeLessThanOrEqual(0.0501);
      expect([outcome.rect.widthMm, outcome.rect.heightMm]).toEqual([origin.widthMm, origin.heightMm]);
      // The live rectangle during the drag is the one that is saved on release.
      expect(gestureOverride(moved)!.rect).toEqual(outcome.rect);
    }
  });

  it("stays geometrically correct after panning either axis, even when the view pans during the drag", () => {
    const base = geometryAt(3);
    const panned = geometryAt(3, base.scrollRange.max, base.scrollRangeY.max);
    expect(panned.viewBox[0]).not.toBe(base.viewBox[0]);
    expect(panned.viewBox[1]).not.toBe(base.viewBox[1]);
    const view = panned.viewBox, scale = drawingScale(viewportPx, view)!;
    const { at, gesture } = press(view, false);
    const end = { x: at.x + 90, y: at.y + 45 };
    const outcome = endGesture(drag(gesture, [[end.x, end.y]], view), drawingPointAt(end, client, view), end);
    expect(outcome.kind).toBe("commit");
    if (outcome.kind === "commit") {
      expect(Math.abs(outcome.rect.xMm - (origin.xMm + 90 / scale))).toBeLessThanOrEqual(0.0501);
      expect(Math.abs(outcome.rect.yMm - (origin.yMm + 45 / scale))).toBeLessThanOrEqual(0.0501);
    }
    // The view scrolls 40 mm left while the pointer rests: the content under it is 40 mm further left, and the box follows.
    const later = geometryAt(3, panned.viewBox[0] - 40, panned.viewBox[1]).viewBox;
    const pointer = { x: at.x + 10, y: at.y };
    const onScrolled = endGesture(gesture, drawingPointAt(pointer, client, later), pointer);
    expect(onScrolled).toMatchObject({ kind: "commit" });
    if (onScrolled.kind === "commit") expect(Math.abs(onScrolled.rect.xMm - (origin.xMm + 10 / scale + (later[0] - panned.viewBox[0])))).toBeLessThanOrEqual(0.0501);
  });

  it("selects without moving on a click, and a click on the already-selected box starts typing", () => {
    const view = geometryAt(1).viewBox;
    const first = press(view, false), second = press(view, true);
    expect(endGesture(first.gesture, { x: 120, y: 90 }, { x: first.at.x + 1, y: first.at.y })).toEqual({ kind: "none" });
    expect(endGesture(second.gesture, { x: 120, y: 90 }, { x: second.at.x + 1, y: second.at.y })).toEqual({ kind: "edit", uuid: "n" });
    const jitter = drag(second.gesture, [[second.at.x + 2, second.at.y]], view);
    expect(gestureOverride(jitter)).toBeNull();
  });

  it("stores the moved rectangle with the position only changed, through the update call", () => {
    const update = vi.fn().mockResolvedValue({});
    void submitNoteRect({ updateAnnotation: update }, "n", { xMm: 10.04, yMm: 20.06, widthMm: 200, heightMm: 80 });
    expect(update).toHaveBeenCalledWith("n", { xMm: 10, yMm: 20.1, widthMm: 200, heightMm: 80 });
    void submitNoteText({ updateAnnotation: update }, "n", "nuovo");
    expect(update).toHaveBeenLastCalledWith("n", { text: "nuovo" });
  });
});

describe("resizing a text box", () => {
  const origin: NoteRect = { xMm: 100, yMm: 100, widthMm: 200, heightMm: 100 };
  const expected: Record<ResizeHandle, NoteRect> = {
    e: { xMm: 100, yMm: 100, widthMm: 230, heightMm: 100 }, w: { xMm: 130, yMm: 100, widthMm: 170, heightMm: 100 },
    s: { xMm: 100, yMm: 100, widthMm: 200, heightMm: 110 }, n: { xMm: 100, yMm: 110, widthMm: 200, heightMm: 90 },
    se: { xMm: 100, yMm: 100, widthMm: 230, heightMm: 110 }, nw: { xMm: 130, yMm: 110, widthMm: 170, heightMm: 90 },
    ne: { xMm: 100, yMm: 110, widthMm: 230, heightMm: 90 }, sw: { xMm: 130, yMm: 100, widthMm: 170, heightMm: 110 },
  };

  it("moves only the dragged edges, the opposite ones staying put, for each of the eight handles", () => {
    expect(RESIZE_HANDLES).toHaveLength(8);
    for (const handle of RESIZE_HANDLES) expect(resizedRect(origin, handle, { x: 30, y: 10 }), handle).toEqual(expected[handle]);
    expect(handlePoint(origin, "nw")).toEqual({ x: 100, y: 100 });
    expect(handlePoint(origin, "se")).toEqual({ x: 300, y: 200 });
    expect(handlePoint(origin, "n")).toEqual({ x: 200, y: 100 });
    expect(handlePoint(origin, "e")).toEqual({ x: 300, y: 150 });
  });

  it("never goes below the minimum size: the dragged edge stops and the opposite edge does not move", () => {
    for (const handle of RESIZE_HANDLES) {
      const squeezed = resizedRect(origin, handle, { x: handle.includes("w") ? 5000 : -5000, y: handle.includes("n") ? 5000 : -5000 });
      if (handle.length === 1 && "ew".includes(handle)) expect(squeezed.widthMm).toBe(ANNOTATION_MIN_WIDTH_MM);
      else if (handle.length === 1) expect(squeezed.heightMm).toBe(ANNOTATION_MIN_HEIGHT_MM);
      else expect([squeezed.widthMm, squeezed.heightMm]).toEqual([ANNOTATION_MIN_WIDTH_MM, ANNOTATION_MIN_HEIGHT_MM]);
      const right = squeezed.xMm + squeezed.widthMm, bottom = squeezed.yMm + squeezed.heightMm;
      if (handle.includes("w")) expect(right).toBe(300); else expect(squeezed.xMm).toBe(100);
      if (handle.includes("n")) expect(bottom).toBe(200); else expect(squeezed.yMm).toBe(100);
    }
  });

  it("converts the drag correctly at any zoom and pan, and ignores a resize that changes nothing", () => {
    for (const [zoom, panned] of [[1, false], [2.5, false], [3, true]] as const) {
      const base = geometryAt(zoom);
      const view = (panned ? geometryAt(zoom, base.scrollRange.max, base.scrollRangeY.min) : base).viewBox;
      const scale = drawingScale(viewportPx, view)!;
      const grip = handlePoint(origin, "se");
      const at = toClient(view, grip);
      const gesture = beginGesture("resize", { start: drawingPointAt({ x: at.x, y: at.y }, client, view)!, startPx: { x: at.x, y: at.y },
        uuid: "n", origin, handle: "se" });
      const end = { x: at.x + 40, y: at.y + 20 };
      const outcome = endGesture(drag(gesture, [[end.x, end.y]], view), drawingPointAt(end, client, view), end);
      expect(outcome.kind).toBe("commit");
      if (outcome.kind === "commit") {
        expect(Math.abs(outcome.rect.widthMm - (origin.widthMm + 40 / scale))).toBeLessThanOrEqual(0.0501);
        expect(Math.abs(outcome.rect.heightMm - (origin.heightMm + 20 / scale))).toBeLessThanOrEqual(0.0501);
        expect([outcome.rect.xMm, outcome.rect.yMm]).toEqual([100, 100]);
      }
      expect(endGesture(gesture, drawingPointAt({ x: at.x, y: at.y }, client, view), { x: at.x, y: at.y })).toEqual({ kind: "none" });
    }
  });
});

describe("deleting and the keyboard", () => {
  const state = { selected: true, editing: false, textEntry: false, busy: false, dragging: false };

  it("Delete and Backspace remove the selected box; Enter types into it; Esc deselects", () => {
    expect(noteKeyCommand({ key: "Delete" }, state)).toBe("delete");
    expect(noteKeyCommand({ key: "Backspace" }, state)).toBe("delete");
    expect(noteKeyCommand({ key: "Enter" }, state)).toBe("edit");
    expect(noteKeyCommand({ key: "Escape" }, state)).toBe("deselect");
    expect(noteKeyCommand({ key: "x" }, state)).toBeNull();
  });

  it("does nothing without a selected box, with a modifier, mid-gesture or while a call is in flight", () => {
    expect(noteKeyCommand({ key: "Delete" }, { ...state, selected: false })).toBeNull();
    for (const modifier of ["ctrlKey", "metaKey", "altKey"] as const) expect(noteKeyCommand({ key: "Delete", [modifier]: true }, state)).toBeNull();
    expect(noteKeyCommand({ key: "Delete" }, { ...state, dragging: true })).toBeNull();
    expect(noteKeyCommand({ key: "Delete" }, { ...state, busy: true })).toBeNull();
  });

  it("is text, not deletion, while typing in the box: Delete and Backspace edit the text", () => {
    expect(noteKeyCommand({ key: "Delete" }, { ...state, editing: true })).toBeNull();
    expect(noteKeyCommand({ key: "Backspace" }, { ...state, editing: true })).toBeNull();
    expect(noteKeyCommand({ key: "Backspace" }, { ...state, textEntry: true })).toBeNull();
    expect(isTextEntryTarget({ tagName: "TEXTAREA" })).toBe(true);
    const field = draw([note("n")], layerOf({ selectedUuid: "n", editing: { kind: "edit", uuid: "n" } }));
    expect(field).toContain("<textarea");
    expect(field).toContain('data-editing="true"');
    // Ctrl/Cmd + arrows reach the drawing's pan only from the drawing itself, never from the text field.
    expect(readFileSync("src/renderer/project/ProgettazioneScreen.tsx", "utf8"))
      .toContain("isTextEntryTarget(event.target)?null:keyPanTarget(geometry,event,event.target===svgRef.current)");
  });

  it("removes through the normal backend mutation", () => {
    const remove = vi.fn().mockResolvedValue({});
    void submitNoteRemoval({ removeAnnotation: remove }, "n");
    expect(remove).toHaveBeenCalledWith("n");
    const hook = readFileSync("src/renderer/project/useFrontNotes.ts", "utf8");
    expect(hook).toContain("submitNoteRemoval(latest.current.api, uuid)");
    expect(hook).toContain("onProjectChange(view)");
  });

  it("the text field's own keys: Esc abandons, Enter and leaving the field save, Shift+Enter is a line break", () => {
    const source = readFileSync("src/renderer/project/FrontAnnotations.tsx", "utf8");
    expect(source).toMatch(/event\.key === "Escape".*finish\(false\)/);
    expect(source).toMatch(/event\.key === "Enter" && !event\.shiftKey && !event\.nativeEvent\.isComposing.*finish\(true\)/);
    expect(source).toContain("onBlur={() => finish(true)}");
    expect(source).toContain("maxLength={2000}");
  });
});

describe("who gets a press", () => {
  const base = { button: 0, insideDrawing: true, inTextInput: false, onHandle: false, onNote: false, adding: false };

  it("gives a press on a box or handle, or on the drawing while adding, to the boxes alone", () => {
    expect(routeNotePress({ ...base, onNote: true })).toBe("move");
    expect(routeNotePress({ ...base, onNote: true, onHandle: true })).toBe("resize");
    expect(routeNotePress({ ...base, adding: true })).toBe("create");
    // Even over a Pannello or Apparecchio: creating wins over the physical drag.
    expect(routeNotePress({ ...base, adding: true, onNote: false })).toBe("create");
    expect(routeNotePress({ ...base, inTextInput: true, onNote: true })).toBe("text");
    for (const route of ["move", "resize", "create", "text"] as const) expect(routeTakesPress(route)).toBe(true);
  });

  it("leaves every other press to the physical objects and viewport", () => {
    expect(routeNotePress(base)).toBe("none");
    expect(routeTakesPress("none")).toBe(false);
    expect(routeNotePress({ ...base, button: 2, onNote: true })).toBe("ignore");
    expect(routeNotePress({ ...base, insideDrawing: false, onNote: true })).toBe("ignore");
    expect(routeTakesPress("ignore")).toBe(false);
  });

  it("keeps boxes above the physical drawing, owning their whole area, and stops physical drags while adding", () => {
    const html = draw([note("n", 100, 400, 300, 100)]);
    expect(html.indexOf("front-annotations")).toBeGreaterThan(html.lastIndexOf('data-node-uuid="panel"'));
    expect(readFileSync("src/renderer/styles.css", "utf8")).toMatch(/\.front-note-box \{[^}]*pointer-events: all/);
    const screen = readFileSync("src/renderer/project/ProgettazioneScreen.tsx", "utf8");
    expect(screen).toContain("onNodePointerDown={busy||drag||notes.adding?undefined:grabNode}");
    expect(screen).toMatch(/if\(notes\.pointerDown\(event\)\)return;/);
    // A box selection and a physical selection never coexist.
    expect(screen).toContain("onSelected:()=>{dispatchPointer({type:\"clear\"});setPoolSelected(null);}");
    expect(screen).toMatch(/if\(selectedUuid!==null\)clearNoteSelection\(\)/);
  });
});

describe("how a box is drawn", () => {
  it("shows only text for an unselected box while retaining its whole invisible hit area", () => {
    const html = draw([note("n", 50, 60, 200, 80, "Cablaggio FS17")]);
    expect(rectAttrs(html, "front-note-box")).toEqual([[50, 60, 200, 80]]);
    expect(html).toMatch(/<foreignObject class="front-note-frame" x="50" y="60" width="200" height="80"><div class="front-note-text"[^>]*>Cablaggio FS17<\/div>/);
    expect(html).not.toContain("front-note-handle");
    expect(html).not.toContain("front-note-outline");
    expect(html).not.toContain("<textarea");
    const css = readFileSync("src/renderer/styles.css", "utf8");
    const boxStyle = css.match(/\.front-drawing \.front-note-box \{([^}]+)\}/)![1]!;
    expect(boxStyle).toMatch(/fill: none;/);
    expect(boxStyle).toMatch(/stroke: none;/);
    expect(boxStyle).toMatch(/pointer-events: all;/);
    expect(boxStyle).not.toMatch(/opacity:|visibility:|display:/);
    // The text is independently painted; hiding the hit area must never hide the whole note.
    expect(css).toMatch(/\.front-note-text \{[^}]*color: var\(--librequadri-ink\)/);
    expect(css).toMatch(/\.front-note-frame \{[^}]*pointer-events: none/);
  });

  it("shows the selected box with an outline and eight handles at constant on-screen size", () => {
    const fit = draw([note("n")], layerOf({ selectedUuid: "n" }));
    expect(rectAttrs(fit, "front-note-outline")).toEqual([[50, 60, 200, 80]]);
    expect(fit.match(/data-note-handle="/g)).toHaveLength(8);
    const handleSize = (html: string) => rectAttrs(html, "front-note-handle")[0]![2]!;
    expect(handleSize(draw([note("n")], layerOf({ selectedUuid: "n" }), { zoom: 3 }))).toBeLessThan(handleSize(fit));
    // Unselected boxes never get handles, even when another is selected.
    expect(draw([note("n"), note("m", 400, 500)], layerOf({ selectedUuid: "m" })).match(/data-selection-note="([^"]+)"/)![1]).toBe("m");
    const css = readFileSync("src/renderer/styles.css", "utf8");
    expect(css).toMatch(/\.front-note\[data-selected="true"\] \.front-note-box,\s*\.front-drawing \.front-note\[data-editing="true"\] \.front-note-box \{ stroke: var\(--librequadri-accent\); \}/);
    expect(css).toMatch(/\.front-note-outline \{[^}]*fill: none;[^}]*stroke: var\(--librequadri-accent\)/);
    expect(css).toMatch(/\.front-note-input \{[^}]*background: transparent;[^}]*pointer-events: auto/);
  });

  it("keeps position and size in drawing millimetres whatever the zoom or pan; text is the drawing's own size", () => {
    const notes = [note("n", 120.5, 640, 180, 60)];
    const base = geometryAt(2);
    for (const props of [{ zoom: 1 }, { zoom: 2 }, { zoom: 3, scrollX: base.scrollRange.max, scrollY: base.scrollRangeY.max }])
      expect(rectAttrs(draw(notes, undefined, props), "front-note-box")).toEqual([[120.5, 640, 180, 60]]);
    expect(draw(notes, undefined, { zoom: 3 })).toContain("font-size:12px");
    expect(readFileSync("src/renderer/styles.css", "utf8")).toMatch(/\.front-note-text \{[^}]*white-space: pre-wrap/);
  });

  it("draws the live rectangle during a move or resize without touching the saved box", () => {
    const saved = note("n");
    const live: NoteRect = { xMm: 70, yMm: 90, widthMm: 260, heightMm: 120 };
    const html = draw([saved], layerOf({ selectedUuid: "n", overrides: new Map([["n", live]]) }));
    expect(rectAttrs(html, "front-note-box")).toEqual([[70, 90, 260, 120]]);
    expect(rectAttrs(html, "front-note-outline")).toEqual([[70, 90, 260, 120]]);
    expect(saved).toEqual(note("n"));
  });

  it("keeps Pannelli free of text and the viewBox stable while a gesture is in progress", () => {
    const html = draw([note("n")], layerOf({ selectedUuid: "n" }));
    expect(labelled(html).join(" ")).not.toMatch(/TRAY|panel/);
    const during = draw([note("n")], layerOf({ overrides: new Map([["n", { xMm: 5000, yMm: 5000, widthMm: 100, heightMm: 50 }]]) }));
    const viewBox = (markup: string) => markup.match(/viewBox="([^"]+)"/)![1];
    expect(viewBox(during)).toBe(viewBox(draw([note("n")])));
  });
});

describe("text size per box", () => {
  const sizeOf = (html: string, uuid: string) => {
    const group = html.match(new RegExp(`data-annotation-uuid="${uuid}".*?</foreignObject>`))![0];
    return Number(group.match(/font-size:([0-9.]+)px/)![1]);
  };

  it("draws each box at its own persisted size, so different boxes differ", () => {
    const html = draw([note("a", 0, 0, 200, 80, "Piccolo", 8), note("b", 0, 100, 200, 80, "Normale", 12), note("c", 0, 200, 300, 120, "Enorme", 60)]);
    expect([sizeOf(html, "a"), sizeOf(html, "b"), sizeOf(html, "c")]).toEqual([8, 12, 60]);
    // The size is the drawing's own: zoom never changes it.
    expect(sizeOf(draw([note("a", 0, 0, 200, 80, "x", 28)], undefined, { zoom: 3 }), "a")).toBe(28);
  });

  it("types into a box at that box's size", () => {
    const html = draw([note("a", 0, 0, 200, 80, "Testo", 18)], layerOf({ selectedUuid: "a", editing: { kind: "edit", uuid: "a" } }));
    expect(html.match(/<textarea[^>]*style="[^"]*font-size:18px/)).not.toBeNull();
    // A new box starts at the default size.
    const draft = draw([], layerOf({ editing: { kind: "new", rect: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 40 } } }));
    expect(draft.match(/<textarea[^>]*style="[^"]*font-size:12px/)).not.toBeNull();
  });

  it("offers Piccolo 8, Normale 12, Grande 18 and Molto grande 28", () => {
    expect(FONT_PRESETS).toEqual([{ label: "Piccolo", mm: 8 }, { label: "Normale", mm: 12 }, { label: "Grande", mm: 18 }, { label: "Molto grande", mm: 28 }]);
    expect(presetLabelFor(18)).toBe("Grande");
    expect(presetLabelFor(14)).toBeNull();
  });

  it("A− and A+ step inside 6–60 mm and are unavailable at the limits", () => {
    expect([ANNOTATION_FONT_MIN_MM, ANNOTATION_FONT_MAX_MM]).toEqual([6, 60]);
    expect(steppedFontSize(12, 1)).toBe(14);
    expect(steppedFontSize(12, -1)).toBe(10);
    expect(steppedFontSize(7, -1)).toBe(6);
    expect(steppedFontSize(59, 1)).toBe(60);
    expect(steppedFontSize(6, -1)).toBeNull();
    expect(steppedFontSize(60, 1)).toBeNull();
    for (let size = 6, guard = 0; guard < 100; guard++) { const next = steppedFontSize(size, 1); if (next === null) { expect(size).toBe(60); break; } size = next; }
  });

  it("renders the size control only for a selected box, with the current size and disabled limits", () => {
    const html = (fontSizeMm: number, busy = false) => renderToStaticMarkup(<annotationLayer.NoteFontControls fontSizeMm={fontSizeMm} busy={busy} onChange={() => undefined} />);
    const normal = html(12);
    expect(normal).toContain("12 mm");
    expect(normal).toContain('aria-label="Riduci il testo"');
    expect(normal).toContain('aria-label="Ingrandisci il testo"');
    expect(normal).toContain('<option value="Normale" selected="">Normale · 12 mm</option>');
    for (const label of ["Piccolo · 8 mm", "Grande · 18 mm", "Molto grande · 28 mm"]) expect(normal).toContain(label);
    expect(html(6)).toMatch(/aria-label="Riduci il testo"[^>]*disabled=""/);
    expect(html(60)).toMatch(/aria-label="Ingrandisci il testo"[^>]*disabled=""/);
    expect(html(60)).not.toMatch(/aria-label="Riduci il testo"[^>]*disabled=""/);
    expect(html(14)).toContain("Personalizzata");
    expect(html(12, true).match(/disabled=""/g)!.length).toBeGreaterThanOrEqual(3);
    const screen = readFileSync("src/renderer/project/ProgettazioneScreen.tsx", "utf8");
    expect(screen).toMatch(/notes\.selectedNote\?<NoteFontControls/);
  });

  it("saves only the text size of the box it is asked for, and refuses an invalid size before calling the backend", async () => {
    const updateAnnotation = vi.fn(async () => ({}) as never);
    await submitNoteFontSize({ updateAnnotation }, "box-1", 28);
    expect(updateAnnotation).toHaveBeenCalledExactlyOnceWith("box-1", { fontSizeMm: 28 });
    for (const bad of [5.9, 60.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(submitNoteFontSize({ updateAnnotation }, "box-1", bad)).rejects.toThrow("Dimensione del testo");
      expect(validFontSize(bad)).toBe(false);
    }
    expect(updateAnnotation).toHaveBeenCalledOnce();
    for (const ok of [6, 12, 60]) expect(validFontSize(ok)).toBe(true);
  });

  it("keeps a resized box at least one line of its own size tall", () => {
    expect(annotationMinHeightMm(12)).toBe(ANNOTATION_MIN_HEIGHT_MM);
    expect(annotationMinHeightMm(60)).toBe(84);
    const origin = { xMm: 0, yMm: 0, widthMm: 200, heightMm: 200 };
    const press = { start: { x: 100, y: 200 }, startPx: { x: 0, y: 0 }, uuid: "n", origin, handle: "s" as ResizeHandle, fontSizeMm: 60 };
    const gesture = stepGesture(beginGesture("resize", press), { x: 100, y: -5000 }, { x: 0, y: 0 });
    expect(gesture.kind === "resize" && gesture.rect.heightMm).toBe(84);
    // Without a text size the ordinary minimum applies.
    const plain = stepGesture(beginGesture("resize", { ...press, fontSizeMm: undefined }), { x: 100, y: -5000 }, { x: 0, y: 0 });
    expect(plain.kind === "resize" && plain.rect.heightMm).toBe(ANNOTATION_MIN_HEIGHT_MM);
    expect(endGesture(gesture, { x: 100, y: -5000 }, { x: 0, y: 0 })).toEqual({ kind: "commit", uuid: "n", rect: { ...origin, heightMm: 84 } });
  });

  it("selecting another box changes which box the control edits, not the others' sizes", () => {
    const source = readFileSync("src/renderer/project/useFrontNotes.ts", "utf8");
    expect(source).toMatch(/submitNoteFontSize\(latest\.current\.api, uuid, fontSizeMm\)/);
    expect(source).toMatch(/const uuid = selectedRef\.current;\s*if \(uuid === null \|\| fontSaving\) return;/);
  });
});

describe("independence", () => {
  it("keeps the text-box code generic and free of source-specific conditions", () => {
    for (const file of ["FrontAnnotations.tsx", "front-annotations.ts", "useFrontNotes.ts", "front-geometry.ts", "ProgettazioneScreen.tsx"])
      expect(readFileSync(`src/renderer/project/${file}`, "utf8")).not.toMatch(/tq\.pack|tiquadri|bticino/i);
    expect(readFileSync("src/main/project/annotations.ts", "utf8")).not.toMatch(/tq\.pack|tiquadri|bticino/i);
  });

  it("never sends a pointer position or viewport value to the backend", () => {
    const source = readFileSync("src/renderer/project/useFrontNotes.ts", "utf8");
    expect(source).not.toMatch(/(submitNote\w*|api\.\w+)\([^)]*(clientX|clientY|scroll[XY]|viewBox)/);
    expect(readFileSync("src/renderer/project/ProgettazioneScreen.tsx", "utf8")).not.toMatch(/onProjectChange\([^)]*scroll[XY]/);
  });
});
