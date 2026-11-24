import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Quick full-text reveal for ellipsized labels. A row opts in with `data-full-text`: the same
 * user-facing text it shows, never internal identifiers. One delegated layer serves every opted-in
 * row inside `scopeRef`. It appears only when something in the row is actually cut off (or always,
 * for a row marked `data-full-text-always` whose reveal adds what the row cannot show), after a
 * short hover delay (the native title tooltip takes about a second), or at once on keyboard focus;
 * it ignores the pointer, so it never blocks clicks, expansion, scrolling or dragging, and it goes
 * away as soon as the pointer or focus leaves, on any press, scroll, wheel, Escape or window blur.
 * The visible text stays in the row's DOM, so the row's accessible name is already complete and the
 * bubble is decorative (aria-hidden).
 */
export const FULL_TEXT_DELAY_MS = 120;
const VIEWPORT_MARGIN_PX = 8;
const GAP_PX = 4;

/** What the reveal needs to know about a row; the DOM layer adapts elements to it. */
export interface RevealTrigger<Anchor = unknown> {
  readonly text: string;
  /** Measured when the reveal is due, so a row that has become wide enough shows nothing. */
  truncated(): boolean;
  anchor(): Anchor;
}

export interface FullTextReveal<Anchor> {
  /** The pointer entered a row (or moved within one: repeated calls for the same row are ignored). */
  enter(trigger: RevealTrigger<Anchor>): void;
  /** Keyboard focus reached a row: shown at once when cut off. */
  focus(trigger: RevealTrigger<Anchor>): void;
  /** Pointer or focus left, or a press, scroll, wheel, Escape or blur happened. */
  dismiss(): void;
  dispose(): void;
}

/**
 * The timing rules, free of the DOM. Hover waits `delayMs`; once a bubble is visible, moving to the
 * next row shows that one at once; focus shows at once. `show(null)` hides.
 */
export function createFullTextReveal<Anchor>(show: (shown: { text: string; anchor: Anchor } | null) => void,
  delayMs = FULL_TEXT_DELAY_MS,
  timers: { set: (run: () => void, ms: number) => unknown; clear: (handle: unknown) => void } =
    { set: (run, ms) => setTimeout(run, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }):
  FullTextReveal<Anchor> {
  let current: RevealTrigger<Anchor> | null = null;
  let visible = false;
  let timer: unknown;
  const cancel = () => { if (timer !== undefined) timers.clear(timer); timer = undefined; };
  const reveal = (trigger: RevealTrigger<Anchor>) => {
    timer = undefined;
    if (current !== trigger) return;
    if (!trigger.truncated()) { if (visible) { visible = false; show(null); } return; }
    visible = true;
    show({ text: trigger.text, anchor: trigger.anchor() });
  };
  const start = (trigger: RevealTrigger<Anchor>, immediate: boolean) => {
    if (trigger === current) return;
    cancel();
    current = trigger;
    if (immediate || visible) reveal(trigger);
    else timer = timers.set(() => reveal(trigger), delayMs);
  };
  const dismiss = () => {
    cancel();
    current = null;
    if (visible) { visible = false; show(null); }
  };
  return { enter: trigger => start(trigger, false), focus: trigger => start(trigger, true), dismiss, dispose: cancel };
}

/** True when the element, or anything inside it, is cut off by an ellipsis. */
export function isTruncated(trigger: HTMLElement): boolean {
  const view = trigger.ownerDocument.defaultView;
  if (!view) return false;
  return [trigger, ...trigger.querySelectorAll<HTMLElement>("*")].some(element =>
    view.getComputedStyle(element).textOverflow === "ellipsis" && element.scrollWidth > element.clientWidth);
}

export interface Box { left: number; top: number; right: number; bottom: number; }

/** Below the row and left-aligned with it; above it when there is no room below; always inside the window. */
export function tooltipPosition(anchor: Box, size: { width: number; height: number },
  viewport: { width: number; height: number }): { left: number; top: number } {
  const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(anchor.left, viewport.width - VIEWPORT_MARGIN_PX - size.width));
  const below = anchor.bottom + GAP_PX;
  const top = below + size.height <= viewport.height - VIEWPORT_MARGIN_PX ? below
    : Math.max(VIEWPORT_MARGIN_PX, anchor.top - GAP_PX - size.height);
  return { left, top };
}

function rowOf(target: EventTarget | null, scope: HTMLElement): HTMLElement | null {
  // Duck-typed (not `instanceof Element`) so the wiring also runs against a minimal fake DOM in tests.
  if (!target || typeof (target as Element).closest !== "function") return null;
  const row = (target as Element).closest<HTMLElement>("[data-full-text]");
  return row && scope.contains(row) && row.dataset["fullText"] ? row : null;
}

function focusVisible(element: HTMLElement): boolean {
  try { return element.matches(":focus-visible"); } catch { return true; }
}

/**
 * The delegated listeners for one scope: hover and keyboard focus start a reveal for the nearest
 * opted-in row; leaving, a press, wheel, scroll, Escape, blur or resize dismiss it. Returns the detach.
 */
export function attachFullTextReveal(scope: HTMLElement, show: (shown: { text: string; anchor: Box } | null) => void,
  delayMs = FULL_TEXT_DELAY_MS): () => void {
  const view = scope.ownerDocument.defaultView ?? window;
  const reveal = createFullTextReveal<Box>(show, delayMs);
  // One trigger object per row element, so moving within a row is recognised as the same row.
  const triggers = new WeakMap<HTMLElement, RevealTrigger<Box>>();
  const triggerOf = (row: HTMLElement): RevealTrigger<Box> => {
    let trigger = triggers.get(row);
    if (!trigger) {
      const always = row.hasAttribute("data-full-text-always");
      trigger = { text: row.dataset["fullText"]!, truncated: () => row.isConnected && (always || isTruncated(row)),
        anchor: () => row.getBoundingClientRect() };
      triggers.set(row, trigger);
    }
    return trigger;
  };
  let hovered: HTMLElement | null = null;
  const over = (event: PointerEvent) => {
    if (event.buttons !== 0) return;
    const row = rowOf(event.target, scope);
    if (row) { hovered = row; reveal.enter(triggerOf(row)); }
  };
  const out = (event: PointerEvent) => {
    const next = event.relatedTarget;
    if (hovered && next && hovered.contains(next as Node)) return;
    const row = rowOf(next, scope);
    if (row) { hovered = row; reveal.enter(triggerOf(row)); } else { hovered = null; reveal.dismiss(); }
  };
  const focusIn = (event: FocusEvent) => {
    const row = rowOf(event.target, scope);
    if (row && focusVisible(row)) reveal.focus(triggerOf(row)); else reveal.dismiss();
  };
  const dismiss = () => { hovered = null; reveal.dismiss(); };
  const key = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
  scope.addEventListener("pointerover", over as EventListener);
  scope.addEventListener("pointerout", out as EventListener);
  scope.addEventListener("focusin", focusIn as EventListener);
  scope.addEventListener("focusout", dismiss);
  view.addEventListener("pointerdown", dismiss, true);
  view.addEventListener("wheel", dismiss, { capture: true, passive: true });
  view.addEventListener("scroll", dismiss, true);
  view.addEventListener("keydown", key as EventListener, true);
  view.addEventListener("blur", dismiss);
  view.addEventListener("resize", dismiss);
  return () => {
    reveal.dispose();
    scope.removeEventListener("pointerover", over as EventListener);
    scope.removeEventListener("pointerout", out as EventListener);
    scope.removeEventListener("focusin", focusIn as EventListener);
    scope.removeEventListener("focusout", dismiss);
    view.removeEventListener("pointerdown", dismiss, true);
    view.removeEventListener("wheel", dismiss, { capture: true });
    view.removeEventListener("scroll", dismiss, true);
    view.removeEventListener("keydown", key as EventListener, true);
    view.removeEventListener("blur", dismiss);
    view.removeEventListener("resize", dismiss);
  };
}

export function FullTextTooltip({ scopeRef, delayMs = FULL_TEXT_DELAY_MS }: {
  scopeRef: RefObject<HTMLElement | null>; delayMs?: number;
}) {
  const [shown, setShown] = useState<{ text: string; anchor: Box } | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scope = scopeRef.current;
    return scope ? attachFullTextReveal(scope, setShown, delayMs) : undefined;
  }, [scopeRef, delayMs]);

  useLayoutEffect(() => {
    if (!shown || !bubble.current) { setPlace(null); return; }
    const view = bubble.current.ownerDocument.defaultView ?? window;
    const { width, height } = bubble.current.getBoundingClientRect();
    setPlace(tooltipPosition(shown.anchor, { width, height }, { width: view.innerWidth, height: view.innerHeight }));
  }, [shown]);

  if (!shown) return null;
  return <div ref={bubble} className="full-text-tooltip" role="tooltip" aria-hidden="true"
    // Measured first at the window's left edge, hidden, so its natural width is not narrowed by the anchor's position.
    style={place ?? { left: 0, top: 0, visibility: "hidden" }}>
    {shown.text}
  </div>;
}
