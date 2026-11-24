import { ANNOTATION_FONT_DEFAULT_MM, ANNOTATION_FONT_MAX_MM, ANNOTATION_FONT_MIN_MM, ANNOTATION_LINE_HEIGHT, ANNOTATION_MAX_SIZE_MM,
  ANNOTATION_MIN_HEIGHT_MM, ANNOTATION_MIN_WIDTH_MM, ANNOTATION_PADDING_MM, annotationMinHeightMm, type ProjectAnnotation, type ProjectApi, type ProjectDocumentView } from "../../shared/project.js";
import type { FrontViewBox, Point } from "./front-geometry.js";

/*
 * Fronte Quadro text boxes: the pure steps between pointer input and the backend call. A box is
 * a rectangle of the combined drawing in millimetres (position = top-left corner); nothing here
 * ever holds a screen position past the moment a pointer is converted.
 */

/**
 * Text size, padding and line height of a box, in drawing millimetres: the text scales with the drawing.
 * Each box keeps its own text size (`fontSizeMm`); the default is the size every box had before it could be chosen.
 */
export { ANNOTATION_FONT_DEFAULT_MM, ANNOTATION_LINE_HEIGHT, ANNOTATION_PADDING_MM };

/** The text sizes offered by name, and the step of A− / A+. */
export const FONT_PRESETS: readonly { readonly label: string; readonly mm: number }[] = [
  { label: "Piccolo", mm: 8 }, { label: "Normale", mm: 12 }, { label: "Grande", mm: 18 }, { label: "Molto grande", mm: 28 },
];
export const FONT_STEP_MM = 2;
export const validFontSize = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= ANNOTATION_FONT_MIN_MM && value <= ANNOTATION_FONT_MAX_MM;
/** The preset a size equals, if any. */
export const presetLabelFor = (fontSizeMm: number): string | null => FONT_PRESETS.find(preset => preset.mm === fontSizeMm)?.label ?? null;
/** One A− / A+ step, kept inside the accepted range and to a tenth of a millimetre; null when already at the limit. */
export function steppedFontSize(fontSizeMm: number, direction: -1 | 1): number | null {
  const next = Math.round(Math.min(ANNOTATION_FONT_MAX_MM, Math.max(ANNOTATION_FONT_MIN_MM, fontSizeMm + direction * FONT_STEP_MM)) * 10) / 10;
  return next === fontSizeMm ? null : next;
}
/** Space between a pointer press and a move that counts as a drag, in CSS pixels. */
export const NOTE_DRAG_THRESHOLD_PX = 4;

/** A box's position and size, drawing millimetres. */
export interface NoteRect { readonly xMm: number; readonly yMm: number; readonly widthMm: number; readonly heightMm: number; }

/** What the screen is doing with the boxes: nothing, drawing a new one, moving one or resizing one. */
export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const RESIZE_HANDLES: readonly ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** The text field's state: typing into a box not yet saved ("new"), or into an existing one. */
export type NoteEditing = { readonly kind: "new"; readonly rect: NoteRect } | { readonly kind: "edit"; readonly uuid: string };

/** Drawing coordinates are kept to a tenth of a millimetre. */
const roundMm = (value: number) => Math.round(value * 10) / 10;

export function roundRect(rect: NoteRect): NoteRect {
  return { xMm: roundMm(rect.xMm), yMm: roundMm(rect.yMm), widthMm: roundMm(rect.widthMm), heightMm: roundMm(rect.heightMm) };
}

/**
 * The drawing point under a pointer, from the drawing box and its viewBox. Unlike hit-testing it
 * does not stop at the drawing's edge, so a drag that leaves the canvas keeps following the pointer;
 * null only when the box or viewBox has no size.
 */
export function drawingPointAt(client: Point, box: { left: number; top: number; width: number; height: number },
  viewBox: FrontViewBox): Point | null {
  if (!(box.width > 0) || !(box.height > 0) || !(viewBox[2] > 0) || !(viewBox[3] > 0)) return null;
  const scale = Math.min(box.width / viewBox[2], box.height / viewBox[3]);
  const offsetX = (box.width - viewBox[2] * scale) / 2, offsetY = (box.height - viewBox[3] * scale) / 2;
  return { x: viewBox[0] + (client.x - box.left - offsetX) / scale, y: viewBox[1] + (client.y - box.top - offsetY) / scale };
}

/** The rectangle between two corners, whichever way it was dragged. */
export function normalizedRect(a: Point, b: Point): NoteRect {
  return { xMm: Math.min(a.x, b.x), yMm: Math.min(a.y, b.y), widthMm: Math.abs(a.x - b.x), heightMm: Math.abs(a.y - b.y) };
}

/** A box smaller than the minimum is raised to it, keeping its top-left corner. */
export function enforceMinimum(rect: NoteRect, minHeightMm = ANNOTATION_MIN_HEIGHT_MM): NoteRect {
  return { ...rect, widthMm: Math.min(ANNOTATION_MAX_SIZE_MM, Math.max(ANNOTATION_MIN_WIDTH_MM, rect.widthMm)),
    heightMm: Math.min(ANNOTATION_MAX_SIZE_MM, Math.max(minHeightMm, rect.heightMm)) };
}

/** A new box from a press and a release: normalised, at least the minimum size, to a tenth of a millimetre. */
export function createdRect(start: Point, end: Point): NoteRect {
  return roundRect(enforceMinimum(normalizedRect(start, end)));
}

/** The box moved by a drawing-space delta; its size is unchanged. */
export function movedRect(origin: NoteRect, delta: Point): NoteRect {
  return roundRect({ ...origin, xMm: origin.xMm + delta.x, yMm: origin.yMm + delta.y });
}

/**
 * The box with one handle dragged by a drawing-space delta. The opposite edges stay where they are;
 * a side never goes below the minimum (the dragged edge stops there) and the box keeps its top-left
 * corner on the opposite side.
 */
export function resizedRect(origin: NoteRect, handle: ResizeHandle, delta: Point, minHeightMm = ANNOTATION_MIN_HEIGHT_MM): NoteRect {
  let left = origin.xMm, top = origin.yMm, right = origin.xMm + origin.widthMm, bottom = origin.yMm + origin.heightMm;
  if (handle.includes("w")) left = Math.min(origin.xMm + delta.x, right - ANNOTATION_MIN_WIDTH_MM);
  if (handle.includes("e")) right = Math.max(right + delta.x, left + ANNOTATION_MIN_WIDTH_MM);
  if (handle.includes("n")) top = Math.min(origin.yMm + delta.y, bottom - minHeightMm);
  if (handle.includes("s")) bottom = Math.max(bottom + delta.y, top + minHeightMm);
  const widthMm = Math.min(ANNOTATION_MAX_SIZE_MM, right - left), heightMm = Math.min(ANNOTATION_MAX_SIZE_MM, bottom - top);
  return roundRect({ xMm: handle.includes("w") ? right - widthMm : left, yMm: handle.includes("n") ? bottom - heightMm : top, widthMm, heightMm });
}

/** Where a handle sits on a box, and the cursor it shows. */
export function handlePoint(rect: NoteRect, handle: ResizeHandle): Point {
  const x = handle.includes("w") ? rect.xMm : handle.includes("e") ? rect.xMm + rect.widthMm : rect.xMm + rect.widthMm / 2;
  const y = handle.includes("n") ? rect.yMm : handle.includes("s") ? rect.yMm + rect.heightMm : rect.yMm + rect.heightMm / 2;
  return { x, y };
}
export const HANDLE_CURSOR: Readonly<Record<ResizeHandle, string>> = {
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize",
};

/** The press-drag-release being followed: drawing a new box, moving one or resizing one. All positions are drawing millimetres except `startPx`. */
export type NoteGesture =
  | { readonly kind: "create"; readonly startPx: Point; readonly start: Point; readonly end: Point; readonly moved: boolean }
  | { readonly kind: "move"; readonly uuid: string; readonly origin: NoteRect; readonly start: Point; readonly startPx: Point;
    readonly rect: NoteRect; readonly moved: boolean; readonly wasSelected: boolean }
  | { readonly kind: "resize"; readonly uuid: string; readonly handle: ResizeHandle; readonly origin: NoteRect;
    readonly start: Point; readonly startPx: Point; readonly rect: NoteRect; readonly minHeightMm: number };

/** Who gets a press inside the canvas. */
export type PressRoute = "ignore" | "text" | "resize" | "move" | "create" | "none";

/**
 * A press on a box or its handle, in the text field, or on the drawing while a box is being drawn
 * belongs to the text boxes, so it never selects or drags the Pannello or Apparecchio underneath.
 * Anything else is an ordinary press ("none"; it only deselects a box); other buttons and presses
 * outside the drawing are not the boxes' business ("ignore").
 */
export function routeNotePress(press: { button: number; insideDrawing: boolean; inTextInput: boolean; onHandle: boolean;
  onNote: boolean; adding: boolean }): PressRoute {
  if (press.button !== 0 || !press.insideDrawing) return "ignore";
  if (press.inTextInput) return "text";
  if (press.onHandle && press.onNote) return "resize";
  if (press.onNote) return "move";
  return press.adding ? "create" : "none";
}
export const routeTakesPress = (route: PressRoute) => route === "text" || route === "resize" || route === "move" || route === "create";

export function beginGesture(route: "resize" | "move" | "create", press: { start: Point; startPx: Point; uuid?: string; origin?: NoteRect;
  handle?: ResizeHandle; wasSelected?: boolean; fontSizeMm?: number }): NoteGesture {
  if (route === "create") return { kind: "create", startPx: press.startPx, start: press.start, end: press.start, moved: false };
  const origin = press.origin!, uuid = press.uuid!;
  return route === "move"
    ? { kind: "move", uuid, origin, start: press.start, startPx: press.startPx, rect: origin, moved: false, wasSelected: press.wasSelected === true }
    : { kind: "resize", uuid, handle: press.handle!, origin, start: press.start, startPx: press.startPx, rect: origin,
      minHeightMm: annotationMinHeightMm(press.fontSizeMm ?? ANNOTATION_FONT_DEFAULT_MM) };
}

const farFrom = (gesture: NoteGesture, px: Point) => Math.hypot(px.x - gesture.startPx.x, px.y - gesture.startPx.y) >= NOTE_DRAG_THRESHOLD_PX;

/** The gesture after the pointer reached `point` (drawing mm; `px` is the same position on screen, for the drag threshold). */
export function stepGesture(gesture: NoteGesture, point: Point, px: Point): NoteGesture {
  const delta = { x: point.x - gesture.start.x, y: point.y - gesture.start.y };
  if (gesture.kind === "create") return { ...gesture, end: point, moved: gesture.moved || farFrom(gesture, px) };
  if (gesture.kind === "move") {
    const moved = gesture.moved || farFrom(gesture, px);
    return { ...gesture, moved, rect: moved ? movedRect(gesture.origin, delta) : gesture.origin };
  }
  return { ...gesture, rect: resizedRect(gesture.origin, gesture.handle, delta, gesture.minHeightMm) };
}

/** What a finished gesture asks for: a new box to type into, a saved rectangle, typing into an existing box, or nothing. */
export type GestureOutcome =
  | { readonly kind: "new-box"; readonly rect: NoteRect }
  | { readonly kind: "commit"; readonly uuid: string; readonly rect: NoteRect }
  | { readonly kind: "edit"; readonly uuid: string }
  | { readonly kind: "none" };

export function endGesture(gesture: NoteGesture, point: Point | null, px: Point): GestureOutcome {
  const delta = point ? { x: point.x - gesture.start.x, y: point.y - gesture.start.y } : { x: 0, y: 0 };
  if (gesture.kind === "create") {
    // A press without a drag still makes a usable (minimum size) box at that point.
    const dragged = (gesture.moved || farFrom(gesture, px)) && point !== null;
    return { kind: "new-box", rect: createdRect(gesture.start, dragged ? point : gesture.start) };
  }
  if (gesture.kind === "move") {
    if (gesture.moved || farFrom(gesture, px)) return { kind: "commit", uuid: gesture.uuid, rect: movedRect(gesture.origin, delta) };
    return gesture.wasSelected ? { kind: "edit", uuid: gesture.uuid } : { kind: "none" };
  }
  const rect = resizedRect(gesture.origin, gesture.handle, delta, gesture.minHeightMm);
  const same = rect.xMm === gesture.origin.xMm && rect.yMm === gesture.origin.yMm &&
    rect.widthMm === gesture.origin.widthMm && rect.heightMm === gesture.origin.heightMm;
  return same ? { kind: "none" } : { kind: "commit", uuid: gesture.uuid, rect };
}

/** The rectangle a box shows while it is being moved or resized; null when nothing has moved yet. */
export function gestureOverride(gesture: NoteGesture | null): { uuid: string; rect: NoteRect } | null {
  if (!gesture || gesture.kind === "create" || (gesture.kind === "move" && !gesture.moved)) return null;
  return { uuid: gesture.uuid, rect: gesture.rect };
}
/** The rubber band of a box being drawn. */
export function gestureRubber(gesture: NoteGesture | null): NoteRect | null {
  return gesture?.kind === "create" && gesture.moved ? normalizedRect(gesture.start, gesture.end) : null;
}

/** The keys the boxes act on, and what they do. `textEntry` is true while the pointer's text field has focus. */
export type NoteKeyCommand = "delete" | "edit" | "deselect";
export function noteKeyCommand(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean },
  state: { selected: boolean; editing: boolean; textEntry: boolean; busy: boolean; dragging: boolean }): NoteKeyCommand | null {
  if (!state.selected || state.editing || state.textEntry || state.busy || state.dragging) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === "Delete" || event.key === "Backspace") return "delete";
  if (event.key === "Enter" && !event.shiftKey) return "edit";
  if (event.key === "Escape") return "deselect";
  return null;
}

export { annotationMinHeightMm };

type NoteApi = Pick<ProjectApi, "addAnnotation" | "updateAnnotation" | "removeAnnotation">;

/** Saves a box drawn on screen together with its first text. */
export function submitNewNote(api: Pick<NoteApi, "addAnnotation">, rect: NoteRect, text: string): Promise<ProjectDocumentView> {
  return api.addAnnotation({ text, ...roundRect(rect) });
}
/** Replaces a box's text only. */
export function submitNoteText(api: Pick<NoteApi, "updateAnnotation">, uuid: string, text: string): Promise<ProjectDocumentView> {
  return api.updateAnnotation(uuid, { text });
}
/** Stores a box's new position and size after a move or a resize. */
export function submitNoteRect(api: Pick<NoteApi, "updateAnnotation">, uuid: string, rect: NoteRect): Promise<ProjectDocumentView> {
  return api.updateAnnotation(uuid, roundRect(rect));
}
/** Stores a box's text size; the backend lengthens the box if it could not hold one line of it. */
export function submitNoteFontSize(api: Pick<NoteApi, "updateAnnotation">, uuid: string, fontSizeMm: number): Promise<ProjectDocumentView> {
  if (!validFontSize(fontSizeMm)) return Promise.reject(new Error("Dimensione del testo non valida."));
  return api.updateAnnotation(uuid, { fontSizeMm });
}
export function submitNoteRemoval(api: Pick<NoteApi, "removeAnnotation">, uuid: string): Promise<ProjectDocumentView> {
  return api.removeAnnotation(uuid);
}

export const rectOf = (note: Pick<ProjectAnnotation, "xMm" | "yMm" | "widthMm" | "heightMm">): NoteRect =>
  ({ xMm: note.xMm, yMm: note.yMm, widthMm: note.widthMm, heightMm: note.heightMm });
