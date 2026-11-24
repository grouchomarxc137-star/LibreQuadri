import { useCallback, useRef, useState, type CSSProperties, type RefObject } from "react";
import { beginPanelDrag, CENTER_MIN, defaultPanelWidths, DIVIDER_WIDTH, fitPanelWidths, PANEL_MIN,
  readPanelWidths, resizePanel, writePanelWidths, type PanelPreferences, type PanelSide, type PanelWidths, type PanelWorkspace } from "./panel-widths.js";

// Ignore floating-point noise when a fractional fitted width is clamped to the same limit.
const widthChanged = (before: number, after: number) => Math.abs(before - after) > 1e-6;
const DESIGN_TAB_LEFT_DEFAULT = 372;

/** Only the existing grid tracks change. No wrappers or containing blocks around the drawing. */
export function useSidePanels(workspace: PanelWorkspace, externalRef?: RefObject<HTMLElement | null>, leftResetKey?: string) {
  // Fitted display widths are independent of the preferences restored on the next window resize.
  const [layout, setLayout] = useState<{ width: number; widths: PanelWidths } | null>(null);
  const preferred = useRef<PanelPreferences | null>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  const element = useRef<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLElement | null) => {
    element.current = node;
    if (externalRef) externalRef.current = node;
    if (!node) return;
    const storage = () => node.ownerDocument.defaultView!.localStorage;
    try { preferred.current = readPanelWidths(storage(), workspace); } catch { preferred.current = null; }
    if (leftResetKey !== undefined) preferred.current = { right: preferred.current?.right };
    let lastWidth: number | null = null;
    const measure = () => {
      const width = node.clientWidth;
      // Mounted-but-hidden workspaces report zero; never replace their saved/display widths with zero.
      if (!width) { stopDrag.current?.(); return; }
      // Initial/duplicate observer deliveries must not refit a deliberate one-sided resize.
      if (width === lastWidth) return;
      stopDrag.current?.();
      lastWidth = width;
      const defaults = defaultPanelWidths(workspace, width);
      const desired = { left: preferred.current?.left ?? defaults.left, right: preferred.current?.right ?? defaults.right };
      if (leftResetKey !== undefined) {
        // Keep room for the widest right-panel minimum so every tab starts at the same left width.
        const available = width - CENTER_MIN - 2 * DIVIDER_WIDTH;
        const commonMinimum = PANEL_MIN.design.left;
        const rightMinimum = Math.max(PANEL_MIN.design.right, PANEL_MIN.catalogue.right);
        const baseline = Math.max(commonMinimum, Math.min(DESIGN_TAB_LEFT_DEFAULT, available - rightMinimum));
        desired.left = preferred.current?.left ?? baseline;
        desired.right = Math.min(desired.right, available - desired.left);
      }
      setLayout({ width, widths: fitPanelWidths(workspace, width, desired) });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      stopDrag.current?.(); stopDrag.current = null;
      observer?.disconnect();
      element.current = null;
      if (externalRef) externalRef.current = null;
    };
  }, [workspace, externalRef, leftResetKey]);
  const width = layout?.width ?? 1440;
  const widths = layout?.widths ?? defaultPanelWidths(workspace, width);
  const persistSide = (side: PanelSide, value: number) => {
    // Save only explicit choices; missing sides must continue following responsive defaults.
    const next = { ...preferred.current, [side]: value };
    preferred.current = next;
    if (leftResetKey !== undefined && side === "left") return;
    try {
      writePanelWidths(element.current!.ownerDocument.defaultView!.localStorage, workspace,
        leftResetKey === undefined ? next : { right: value });
    } catch { /* Unavailable storage. */ }
  };
  const divider = (side: PanelSide, disabled = false) => <div className="panel-divider" role="separator"
    aria-label={`Ridimensiona pannello ${side === "left" ? "sinistro" : "destro"}`}
    aria-orientation="vertical" aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : 0}
    aria-valuemin={PANEL_MIN[workspace][side]} aria-valuenow={Math.round(widths[side])}
    aria-valuemax={Math.round(Math.max(PANEL_MIN[workspace][side], width - CENTER_MIN - 2 * DIVIDER_WIDTH - widths[side === "left" ? "right" : "left"]))}
    onPointerDown={event => {
      if (disabled || event.button !== 0 || !event.isPrimary || stopDrag.current) return;
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      const start = widths;
      let next = start;
      stopDrag.current = beginPanelDrag(event.currentTarget, event, delta => {
        next = resizePanel(workspace, width, start, side, start[side] + (side === "left" ? delta : -delta));
        setLayout({ width, widths: next });
      }, () => {
        stopDrag.current = null;
        // A click, clamped movement or a drag back to the starting width changes no preference.
        if (widthChanged(start[side], next[side])) persistSide(side, next[side]);
      });
    }}
    onKeyDown={event => {
      // Keep drawing shortcuts and global selection handling out of a focused divider.
      if (["Escape", "Delete", "Backspace"].includes(event.key)) { event.stopPropagation(); return; }
      if (disabled || stopDrag.current || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const delta = (event.key === "ArrowLeft" ? -1 : 1) * (side === "left" ? 1 : -1) * (event.shiftKey ? 40 : 10);
      const requested = event.key === "Home" ? 0 : event.key === "End" ? Infinity : widths[side] + delta;
      const next = resizePanel(workspace, width, widths, side, requested);
      if (!widthChanged(widths[side], next[side])) return;
      persistSide(side, next[side]); setLayout({ width, widths: next });
    }} />;
  const style = layout ? { "--panel-left": `${widths.left}px`, "--panel-right": `${widths.right}px` } as CSSProperties : undefined;
  return { ref, style, divider };
}
