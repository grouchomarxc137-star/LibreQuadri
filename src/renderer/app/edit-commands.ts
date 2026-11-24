import type { ProjectApi, ProjectDocumentView } from "../../shared/project.js";
import { isTextEntryTarget } from "../project/design-selection.js";
import type { StatusTone } from "./status.js";

/**
 * Annulla / Ripeti routing. The document history lives in the backend; the renderer only decides
 * whether a request is meant for the focused text field (native text undo) or for the document.
 *
 * Keyboard paths, one per platform so a keystroke is never handled twice:
 *  - macOS: Cmd+Z / Shift+Cmd+Z are native-menu accelerators. Text fields there have no undo of
 *    their own without the Edit menu, so a menu command aimed at a text field is handed back to
 *    the web contents' native undo.
 *  - Windows/Linux: the menu shows Ctrl+Z / Ctrl+Y but does not capture them; the renderer's key
 *    handler takes them outside text fields, and text fields keep Chromium's own undo.
 */
export type EditCommand = "undo" | "redo";

export function isMacPlatform(platform: string = typeof navigator === "undefined" ? "" : navigator.platform): boolean {
  return /^mac/i.test(platform);
}

/** The document edit a keystroke asks for on Windows/Linux; null on macOS (the menu owns it) or otherwise. */
export function editKeyCommand(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean },
  mac: boolean): EditCommand | null {
  if (mac || !event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.shiftKey) return "redo";
  return null;
}

/** Interactions that must finish before the document may change under them (drag, dialogs, pending writes). */
const blockers = new Set<() => boolean>();
export function registerDocumentEditBlocker(blocked: () => boolean): () => void {
  blockers.add(blocked);
  return () => { blockers.delete(blocked); };
}
export function documentEditBlocked(): boolean {
  return [...blockers].some(blocked => blocked());
}

let inFlight = false;

/**
 * Runs Annulla / Ripeti on the document when there is something to undo/redo and nothing else holds
 * the document. Requests arriving while one is in flight (held-down keys) are dropped, never queued.
 * Returns the label that was undone/redone, or null when nothing happened.
 */
export async function runDocumentEdit(command: EditCommand, context: {
  project: ProjectDocumentView | null;
  api: Pick<ProjectApi, "undo" | "redo">;
  adopt: (view: ProjectDocumentView) => void;
  announce: (message: string | null, tone?: StatusTone) => void;
}): Promise<string | null> {
  const label = command === "undo" ? context.project?.history?.undoLabel : context.project?.history?.redoLabel;
  if (!label || inFlight || documentEditBlocked()) return null;
  inFlight = true;
  try {
    context.adopt(await (command === "undo" ? context.api.undo() : context.api.redo()));
    context.announce(`${command === "undo" ? "Annullato" : "Ripetuto"}: ${label}.`, "ok");
    return label;
  } catch (error) {
    context.announce(error instanceof Error && error.message ? error.message
      : command === "undo" ? "Annullamento non riuscito." : "Ripristino non riuscito.");
    return null;
  } finally { inFlight = false; }
}

/** Where a menu Annulla/Ripeti goes: the focused text field's own undo, or the document. */
export function editTarget(active: unknown): "text" | "document" {
  return isTextEntryTarget(active) ? "text" : "document";
}
