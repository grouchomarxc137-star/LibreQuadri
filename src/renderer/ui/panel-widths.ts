export type PanelWorkspace = "design" | "catalogue";
export type PanelSide = "left" | "right";
export type PanelWidths = Readonly<{ left: number; right: number }>;
// Missing sides have never been explicitly resized and keep following responsive defaults.
export type PanelPreferences = Partial<PanelWidths>;
export const DIVIDER_WIDTH = 5;
export const CENTER_MIN = 320;
export const PANEL_MIN: Record<PanelWorkspace, PanelWidths> = {
  design: { left: 220, right: 220 }, catalogue: { left: 200, right: 300 },
};

export function defaultPanelWidths(workspace: PanelWorkspace, width: number): PanelWidths {
  if (workspace === "catalogue") return width <= 1100 ? { left: 200, right: 300 }
    : width < 1280 ? { left: 236, right: 340 } : { left: 272, right: 404 };
  return width < 1100 ? { left: 236, right: 236 }
    : width < 1280 ? { left: 260, right: 260 } : { left: 280, right: 288 };
}

/** Shrink only the display widths when the window narrows; retain the user's preference. */
export function fitPanelWidths(workspace: PanelWorkspace, width: number, preferred: PanelWidths): PanelWidths {
  const min = PANEL_MIN[workspace];
  const left = Math.max(min.left, preferred.left), right = Math.max(min.right, preferred.right);
  const spare = Math.max(0, width - CENTER_MIN - 2 * DIVIDER_WIDTH - min.left - min.right);
  const wanted = left - min.left + right - min.right;
  const ratio = wanted > spare ? spare / wanted : 1;
  return { left: min.left + (left - min.left) * ratio, right: min.right + (right - min.right) * ratio };
}

/** The opposite panel stays fixed throughout a deliberate resize. */
export function resizePanel(workspace: PanelWorkspace, width: number, current: PanelWidths,
  side: PanelSide, requested: number): PanelWidths {
  const other = side === "left" ? "right" : "left";
  const minimum = PANEL_MIN[workspace][side];
  const maximum = Math.max(minimum, width - CENTER_MIN - 2 * DIVIDER_WIDTH - current[other]);
  return { ...current, [side]: Math.max(minimum, Math.min(maximum, requested)) };
}

type WidthStorage = Pick<Storage, "getItem" | "setItem">;
export const panelStorageKey = (workspace: PanelWorkspace) => `lq.panel-widths.v1.${workspace}`;
export function readPanelWidths(storage: WidthStorage, workspace: PanelWorkspace): PanelPreferences | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(panelStorageKey(workspace)) ?? "null");
    if (!value || typeof value !== "object") return null;
    const saved = value as Record<string, unknown>;
    const preferred: PanelPreferences = {};
    for (const side of ["left", "right"] as const) {
      if (!Object.hasOwn(saved, side)) continue;
      const width = saved[side];
      if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) return null;
      Object.assign(preferred, { [side]: width });
    }
    return Object.keys(preferred).length ? preferred : null;
  } catch { return null; }
}
export function writePanelWidths(storage: WidthStorage, workspace: PanelWorkspace, widths: PanelPreferences): void {
  try { storage.setItem(panelStorageKey(workspace), JSON.stringify(widths)); } catch { /* Layout works without storage. */ }
}

/** Pointer capture keeps a mouse/trackpad drag on the divider even over the drawing or outside the window. */
export function beginPanelDrag(handle: HTMLElement, start: Pick<PointerEvent, "pointerId" | "clientX">,
  move: (deltaX: number) => void, finish: () => void): () => void {
  const view = handle.ownerDocument.defaultView!;
  let stopped = false;
  const moved = (event: PointerEvent) => {
    if (event.pointerId === start.pointerId) move(event.clientX - start.clientX);
  };
  const ended = (event: PointerEvent) => {
    if (event.pointerId !== start.pointerId) return;
    if (event.type === "pointerup") moved(event);
    stop();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); stop(); }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    handle.removeEventListener("pointermove", moved);
    handle.removeEventListener("pointerup", ended);
    handle.removeEventListener("pointercancel", ended);
    handle.removeEventListener("lostpointercapture", ended);
    view.removeEventListener("blur", stop);
    view.removeEventListener("keydown", key, true);
    handle.removeAttribute("data-resizing");
    if (handle.hasPointerCapture(start.pointerId)) handle.releasePointerCapture(start.pointerId);
    finish();
  };
  handle.setPointerCapture(start.pointerId);
  handle.setAttribute("data-resizing", "true");
  handle.addEventListener("pointermove", moved);
  handle.addEventListener("pointerup", ended);
  handle.addEventListener("pointercancel", ended);
  handle.addEventListener("lostpointercapture", ended);
  view.addEventListener("blur", stop);
  view.addEventListener("keydown", key, true);
  return stop;
}
