import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { ProjectAnnotation, ProjectApi, ProjectDocumentView } from "../../shared/project.js";
import type { StatusTone } from "../app/status.js";
import type { NoteLayer } from "./FrontAnnotations.js";
import { beginGesture, drawingPointAt, endGesture, gestureOverride, gestureRubber, noteKeyCommand, rectOf, routeNotePress, routeTakesPress,
  stepGesture, submitNewNote, submitNoteFontSize, submitNoteRect, submitNoteRemoval, submitNoteText, type NoteEditing, type NoteGesture, type NoteRect,
  type ResizeHandle } from "./front-annotations.js";
import type { FrontViewBox, Point } from "./front-geometry.js";
import { isTextEntryTarget } from "./design-selection.js";

export interface FrontNotesOptions {
  annotations: readonly ProjectAnnotation[];
  api: Pick<ProjectApi, "addAnnotation" | "updateAnnotation" | "removeAnnotation">;
  onProjectChange: (project: ProjectDocumentView) => void;
  announce: (message: string | null, tone?: StatusTone) => void;
  svgRef: RefObject<SVGSVGElement | null>;
  sectionRef: RefObject<HTMLElement | null>;
  /** The viewBox the drawing is showing right now; read at each pointer event so panning never makes a drag stale. */
  viewBox: () => FrontViewBox;
  /** Another interaction owns the pointer: a Pannello/Apparecchio drag, a busy backend call or an open dialog. */
  blocked: () => boolean;
  physicalDragging: () => boolean;
  /** A box was selected: the Pannello/Apparecchio selection steps aside. */
  onSelected: () => void;
  setError: (message: string | null) => void;
}

const messageOf = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback;

/**
 * Interaction of the Fronte Quadro text boxes: draw, type, select, move, resize, delete. Everything
 * is expressed in drawing millimetres through the viewBox at the moment of each pointer event;
 * the backend is called only when a gesture or an edit finishes, never while a pointer is moving.
 */
export function useFrontNotes(options: FrontNotesOptions) {
  const { annotations } = options;
  const [adding, setAdding] = useState(false);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [editing, setEditing] = useState<NoteEditing | null>(null);
  const [gesture, setGesture] = useState<NoteGesture | null>(null);
  /** The rectangle a finished move or resize shows while its save is in flight. */
  const [pending, setPending] = useState<{ uuid: string; rect: NoteRect } | null>(null);
  /** A text size is being saved: the size controls wait for it, so a quick second click never works from a stale size. */
  const [fontSaving, setFontSaving] = useState(false);
  const latest = useRef(options);
  latest.current = options;
  const gestureRef = useRef(gesture); gestureRef.current = gesture;
  const editingRef = useRef(editing); editingRef.current = editing;
  const selectedRef = useRef(selectedUuid); selectedRef.current = selectedUuid;
  const addingRef = useRef(adding); addingRef.current = adding;
  const notesRef = useRef(annotations); notesRef.current = annotations;

  const focusDrawing = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    latest.current.svgRef.current?.focus({ preventScroll: true });
  };
  const pointAt = (client: Point): Point | null => {
    const svg = latest.current.svgRef.current;
    return svg ? drawingPointAt(client, svg.getBoundingClientRect(), latest.current.viewBox()) : null;
  };

  const select = (uuid: string | null) => { setSelectedUuid(uuid); if (uuid !== null) latest.current.onSelected(); };
  const clearSelection = useCallback(() => { setSelectedUuid(null); setEditing(current => current?.kind === "edit" ? null : current); }, []);

  // A box that left the project is forgotten, selected or being typed into.
  useEffect(() => {
    const present = new Set(annotations.map(note => note.uuid));
    setSelectedUuid(current => current !== null && !present.has(current) ? null : current);
    setEditing(current => current?.kind === "edit" && !present.has(current.uuid) ? null : current);
  }, [annotations]);

  const run = async (work: () => Promise<ProjectDocumentView>, done: (view: ProjectDocumentView) => void, failure: string) => {
    const { onProjectChange, setError, announce } = latest.current;
    setError(null);
    try { const view = await work(); onProjectChange(view); done(view); }
    catch (error) { setError(messageOf(error, failure)); announce(failure); }
  };

  const commitRect = async (uuid: string, rect: NoteRect) => {
    setPending({ uuid, rect });
    await run(() => submitNoteRect(latest.current.api, uuid, rect), () => latest.current.announce(
      "Annotazione aggiornata. Salva il progetto per conservare le modifiche.", "ok"), "Annotazione non aggiornata.");
    setPending(null);
  };

  /** Typing finished: save it, or drop an empty one. */
  const commitText = async (text: string) => {
    const current = editingRef.current;
    if (!current) return;
    setEditing(null);
    const blank = text.trim().length === 0;
    if (current.kind === "new") {
      focusDrawing();
      if (blank) { latest.current.announce(null); return; }
      await run(() => submitNewNote(latest.current.api, current.rect, text), view => {
        const created = view.annotations[view.annotations.length - 1];
        if (created) select(created.uuid);
        latest.current.announce("Annotazione aggiunta. Salva il progetto per conservare le modifiche.", "ok");
      }, "Annotazione non salvata.");
      return;
    }
    focusDrawing();
    const note = notesRef.current.find(entry => entry.uuid === current.uuid);
    if (!note || text === note.text) return;
    if (blank) { latest.current.announce("Testo vuoto: annotazione non modificata. Selezionala e premi Canc per eliminarla."); return; }
    await run(() => submitNoteText(latest.current.api, current.uuid, text), () => latest.current.announce(
      "Annotazione aggiornata. Salva il progetto per conservare le modifiche.", "ok"), "Annotazione non aggiornata.");
  };
  const cancelEdit = () => { setEditing(null); focusDrawing(); };

  /** Gives the selected box a new text size and returns the keyboard to the drawing. */
  const changeFontSize = async (fontSizeMm: number) => {
    const uuid = selectedRef.current;
    if (uuid === null || fontSaving) return;
    setFontSaving(true);
    await run(() => submitNoteFontSize(latest.current.api, uuid, fontSizeMm), () => latest.current.announce(
      "Dimensione del testo aggiornata. Salva il progetto per conservare le modifiche.", "ok"), "Dimensione del testo non aggiornata.");
    setFontSaving(false);
    focusDrawing();
  };

  const deleteSelected = async () => {
    const uuid = selectedRef.current;
    if (uuid === null) return;
    setSelectedUuid(null);
    await run(() => submitNoteRemoval(latest.current.api, uuid), () => latest.current.announce(
      "Annotazione eliminata. Salva il progetto per conservare le modifiche.", "ok"), "Annotazione non eliminata.");
  };

  const toggleAdding = () => {
    setEditing(null);
    const next = !addingRef.current;
    setAdding(next);
    if (next) {
      setSelectedUuid(null);
      latest.current.announce("Trascina sul disegno per tracciare il riquadro di testo. Esc annulla.");
    }
  };

  /**
   * A press inside the canvas. True when a box (or the drawing, while adding one) takes it: the press
   * is then not a click on whatever Pannello or Apparecchio lies underneath.
   */
  const pointerDown = (event: ReactPointerEvent<Element>): boolean => {
    const svg = latest.current.svgRef.current, target = event.target as Element;
    const handleElement = svg?.contains(target) ? target.closest("[data-note-handle]") : null;
    const noteElement = svg?.contains(target) ? target.closest("[data-annotation-uuid]") : null;
    const route = routeNotePress({ button: event.button, insideDrawing: svg?.contains(target) ?? false,
      inTextInput: target.closest(".front-note-input") !== null, onHandle: handleElement !== null, onNote: noteElement !== null,
      adding: addingRef.current });
    if (route === "none") { if (selectedRef.current !== null || editingRef.current !== null) clearSelection(); return false; }
    if (!routeTakesPress(route)) return false;
    if (route === "text") return true; // the text field keeps its own caret and selection
    event.preventDefault();
    if (latest.current.blocked() || gestureRef.current) return true;
    const startPx = { x: event.clientX, y: event.clientY };
    const start = pointAt(startPx);
    if (!start) return true;
    if (noteElement) {
      const uuid = noteElement.getAttribute("data-annotation-uuid")!;
      const note = notesRef.current.find(entry => entry.uuid === uuid);
      if (!note) return true;
      const wasSelected = selectedRef.current === uuid;
      if (editingRef.current && !(editingRef.current.kind === "edit" && editingRef.current.uuid === uuid)) setEditing(null);
      select(uuid);
      focusDrawing();
      setGesture(beginGesture(route as "move" | "resize", { start, startPx, uuid, origin: rectOf(note), wasSelected,
        handle: handleElement?.getAttribute("data-note-handle") as ResizeHandle | undefined, fontSizeMm: note.fontSizeMm }));
      return true;
    }
    setSelectedUuid(null);
    focusDrawing();
    setGesture(beginGesture("create", { start, startPx }));
    return true;
  };

  const active = gesture !== null;
  useEffect(() => {
    if (!active) return;
    const move = (event: PointerEvent) => {
      const px = { x: event.clientX, y: event.clientY };
      const point = pointAt(px);
      if (point) setGesture(current => current ? stepGesture(current, point, px) : current);
    };
    const finish = (event: PointerEvent) => {
      const current = gestureRef.current;
      if (!current) return;
      setGesture(null);
      const px = { x: event.clientX, y: event.clientY };
      const outcome = endGesture(current, pointAt(px), px);
      if (outcome.kind === "new-box") { setEditing({ kind: "new", rect: outcome.rect }); setAdding(false); }
      else if (outcome.kind === "commit") void commitRect(outcome.uuid, outcome.rect);
      else if (outcome.kind === "edit") setEditing({ kind: "edit", uuid: outcome.uuid });
    };
    const cancel = () => { setGesture(null); setAdding(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel); window.removeEventListener("keydown", escape);
    };
  }, [active]);

  // Esc leaves "Aggiungi testo".
  useEffect(() => {
    if (!adding) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setAdding(false); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [adding]);

  // Delete/Backspace remove the selected box, Enter types into it, Esc deselects: never while typing in a text field.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const { sectionRef, blocked, physicalDragging } = latest.current;
      const section = sectionRef.current;
      if (!section || event.defaultPrevented || section.closest("[hidden]")) return;
      const target = event.target;
      const onPage = target === document.body || target === document.documentElement || target === document;
      if (!onPage && !(target instanceof Node && section.contains(target))) return;
      const command = noteKeyCommand(event, { selected: selectedRef.current !== null, editing: editingRef.current !== null,
        textEntry: isTextEntryTarget(target), busy: blocked(), dragging: gestureRef.current !== null || physicalDragging() });
      if (!command) return;
      event.preventDefault();
      if (command === "delete") void deleteSelected();
      else if (command === "edit") setEditing({ kind: "edit", uuid: selectedRef.current! });
      else setSelectedUuid(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const overrides = new Map<string, NoteRect>();
  if (pending) overrides.set(pending.uuid, pending.rect);
  const live = gestureOverride(gesture);
  if (live) overrides.set(live.uuid, live.rect);
  const rubber = gestureRubber(gesture);
  const layer: NoteLayer = { selectedUuid, editing, overrides, rubber, onCommit: text => void commitText(text), onCancel: cancelEdit };
  const selectedNote = annotations.find(note => note.uuid === selectedUuid) ?? null;
  return { adding, selectedUuid, selectedNote, editing, gesturing: gesture !== null, layer, pointerDown, toggleAdding, clearSelection,
    fontSaving, changeFontSize: (fontSizeMm: number) => void changeFontSize(fontSizeMm) };
}
