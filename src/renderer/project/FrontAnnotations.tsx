import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { FrontNoteContent, frontNoteTextStyle as textStyle } from "../../drawing/FrontContent.js";
import type { ProjectAnnotation } from "../../shared/project.js";
import { ANNOTATION_FONT_DEFAULT_MM, FONT_PRESETS, HANDLE_CURSOR, RESIZE_HANDLES,
  handlePoint, presetLabelFor, rectOf, steppedFontSize, type NoteEditing, type NoteRect } from "./front-annotations.js";
import { ANNOTATION_FONT_MAX_MM, ANNOTATION_FONT_MIN_MM } from "../../shared/project.js";

/** On-screen size of a resize handle and of the area that grabs it, in CSS pixels. */
const HANDLE_PX = 6;
const HANDLE_HIT_PX = 14;

/** Everything the drawing needs to show the boxes' interaction state; all of it is display state. */
export interface NoteLayer {
  selectedUuid: string | null;
  editing: NoteEditing | null;
  /** The rectangle a box has while it is being moved or resized (the saved one until the gesture ends). */
  overrides: ReadonlyMap<string, NoteRect>;
  /** The box being drawn by a drag. */
  rubber: NoteRect | null;
  /** Typing finished by Enter or by leaving the field; Esc is `onCancel`. */
  onCommit: (text: string) => void;
  onCancel: () => void;
}


/**
 * Text boxes of the Fronte Quadro, in drawing coordinates. The text is the drawing's own size and
 * wraps inside the box, so zoom and pan only ever scale the whole box. A box owns its area: a
 * press anywhere on it belongs to the box, never to the Pannello or Apparecchio underneath.
 */
export function FrontAnnotations({ notes, scale, layer }: {
  notes: readonly ProjectAnnotation[]; scale: number | null; layer?: NoteLayer;
}) {
  const selectedUuid = layer?.selectedUuid ?? null, editing = layer?.editing ?? null;
  const rectFor = (note: ProjectAnnotation): NoteRect => layer?.overrides.get(note.uuid) ?? rectOf(note);
  const selected = notes.find(note => note.uuid === selectedUuid);
  if (notes.length === 0 && !layer?.rubber && editing?.kind !== "new") return null;
  return <g className="front-annotations">
    {notes.map(note => {
      const rect = rectFor(note);
      const editingThis = editing?.kind === "edit" && editing.uuid === note.uuid;
      return <g key={note.uuid} className="front-note" data-annotation-uuid={note.uuid}
        data-selected={note.uuid === selectedUuid ? "true" : undefined} data-editing={editingThis ? "true" : undefined}>
        <FrontNoteContent note={{ ...note, ...rect }}>
          {editingThis && layer ? <NoteTextEditor initialText={note.text} fontSizeMm={note.fontSizeMm} onCommit={layer.onCommit} onCancel={layer.onCancel} /> : undefined}
        </FrontNoteContent>
      </g>;
    })}
    {layer?.rubber ? <rect className="front-note-rubber" x={layer.rubber.xMm} y={layer.rubber.yMm}
      width={layer.rubber.widthMm} height={layer.rubber.heightMm} /> : null}
    {editing?.kind === "new" && layer ? <g className="front-note" data-annotation-draft="true" data-editing="true">
      <rect className="front-note-box" x={editing.rect.xMm} y={editing.rect.yMm} width={editing.rect.widthMm} height={editing.rect.heightMm} />
      <foreignObject className="front-note-frame" x={editing.rect.xMm} y={editing.rect.yMm} width={editing.rect.widthMm} height={editing.rect.heightMm}>
        <NoteTextEditor initialText="" onCommit={layer.onCommit} onCancel={layer.onCancel} />
      </foreignObject>
    </g> : null}
    {selected && layer ? <NoteHandles uuid={selected.uuid} rect={rectFor(selected)} scale={scale} /> : null}
  </g>;
}

/** The selected box's outline and its eight resize handles, at constant on-screen size. */
function NoteHandles({ uuid, rect, scale }: { uuid: string; rect: NoteRect; scale: number | null }) {
  const factor = scale !== null && scale > 0 ? 1 / scale : 1;
  const size = HANDLE_PX * factor, hit = HANDLE_HIT_PX * factor;
  return <g className="front-note-selection" data-selection-note={uuid}>
    <rect className="front-note-outline" x={rect.xMm} y={rect.yMm} width={rect.widthMm} height={rect.heightMm} />
    {RESIZE_HANDLES.map(handle => {
      const point = handlePoint(rect, handle);
      return <g key={handle} className="front-note-handle-group" data-annotation-uuid={uuid} data-note-handle={handle}>
        <rect className="front-note-handle-hit" x={point.x - hit / 2} y={point.y - hit / 2} width={hit} height={hit}
          style={{ cursor: HANDLE_CURSOR[handle] }} />
        <rect className="front-note-handle" x={point.x - size / 2} y={point.y - size / 2} width={size} height={size} />
      </g>;
    })}
  </g>;
}

/**
 * The text field of a box, drawn inside the box itself. Esc abandons the typing, Enter
 * and leaving the field (a click elsewhere) save it; Shift+Enter is a line break. Whatever is typed here,
 * including Delete and Backspace, is text: the drawing's shortcuts never see it.
 */
export function NoteTextEditor({ initialText, fontSizeMm = ANNOTATION_FONT_DEFAULT_MM, onCommit, onCancel }: {
  initialText: string; fontSizeMm?: number; onCommit: (text: string) => void; onCancel: () => void;
}) {
  const [text, setText] = useState(initialText);
  const field = useRef<HTMLTextAreaElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (save) onCommit(text); else onCancel();
  };
  const key = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
    else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); finish(true); }
  };
  return <textarea ref={field} className="front-note-input" style={textStyle(fontSizeMm)} value={text} maxLength={2000}
    aria-label="Testo dell'annotazione" spellCheck={false} onChange={event => setText(event.target.value)}
    onKeyDown={key} onBlur={() => finish(true)} />;
}

/**
 * Text size of the selected box, in the Fronte Quadro toolbar: four named sizes, A− / A+ and the
 * current size in millimetres. It changes only the selected box; each choice is saved at once.
 */
export function NoteFontControls({ fontSizeMm, busy, onChange }: {
  fontSizeMm: number; busy: boolean; onChange: (fontSizeMm: number) => void;
}) {
  const smaller = steppedFontSize(fontSizeMm, -1), larger = steppedFontSize(fontSizeMm, 1);
  const preset = presetLabelFor(fontSizeMm);
  return <div className="note-font-controls" role="group" aria-label="Dimensione del testo">
    <button type="button" className="toolbar-button note-font-step" aria-label="Riduci il testo" title={`Riduci il testo (minimo ${ANNOTATION_FONT_MIN_MM} mm)`}
      disabled={busy || smaller === null} onClick={() => smaller !== null && onChange(smaller)}>A−</button>
    <span className="note-font-value" aria-live="polite">{fontSizeMm} mm</span>
    <button type="button" className="toolbar-button note-font-step" aria-label="Ingrandisci il testo" title={`Ingrandisci il testo (massimo ${ANNOTATION_FONT_MAX_MM} mm)`}
      disabled={busy || larger === null} onClick={() => larger !== null && onChange(larger)}>A+</button>
    <select className="note-font-preset" aria-label="Dimensione predefinita del testo" value={preset ?? ""} disabled={busy}
      onChange={event => { const choice = FONT_PRESETS.find(entry => entry.label === event.target.value); if (choice) onChange(choice.mm); }}>
      {preset === null ? <option value="" disabled>Personalizzata</option> : null}
      {FONT_PRESETS.map(entry => <option key={entry.label} value={entry.label}>{entry.label} · {entry.mm} mm</option>)}
    </select>
  </div>;
}
