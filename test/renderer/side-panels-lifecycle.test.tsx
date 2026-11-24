// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSidePanels } from "../../src/renderer/ui/useSidePanels.js";
import { defaultPanelWidths, fitPanelWidths, PANEL_MIN, panelStorageKey, readPanelWidths,
  type PanelSide, type PanelWidths, type PanelWorkspace } from "../../src/renderer/ui/panel-widths.js";

class ObservedSize {
  static instances: ObservedSize[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(private callback: ResizeObserverCallback) { ObservedSize.instances.push(this); }
  deliver() { this.callback([], this as unknown as ResizeObserver); }
}

function Panels({ workspace, tab }: { workspace: PanelWorkspace; tab?: string }) {
  const panels = useSidePanels(workspace, undefined, tab);
  return <div className="test-panels" ref={panels.ref} style={panels.style}>
    {panels.divider("left")}{panels.divider("right")}
  </div>;
}

let viewportWidth: number;
let root: Root | null;
let container: HTMLDivElement;
let storage: Storage;
let storageWrites: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  viewportWidth = 900;
  ObservedSize.instances = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", ObservedSize);
  // jsdom does not implement native pointer capture. Keep its events on the real React DOM handlers.
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    readonly pointerId: number;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit) {
      super(type, init); this.pointerId = init.pointerId ?? 1; this.isPrimary = init.isPrimary ?? true;
    }
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("test-panels") ? viewportWidth : 0;
  });
  // Vitest retains Node 25's global localStorage; use the DOM environment's actual Storage.
  storage = (globalThis as typeof globalThis & { jsdom: { window: Window } }).jsdom.window.localStorage;
  vi.stubGlobal("localStorage", storage);
  storage.clear();
  storageWrites = vi.spyOn(Object.getPrototypeOf(storage) as Storage, "setItem");
  container = document.createElement("div");
  document.body.append(container);
  root = null;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(workspace: PanelWorkspace) {
  root = createRoot(container);
  act(() => root!.render(<Panels workspace={workspace}/>));
  for (const handle of container.querySelectorAll<HTMLElement>("[role=separator]")) {
    let captured: number | null = null;
    handle.setPointerCapture = vi.fn(id => { captured = id; });
    handle.hasPointerCapture = id => captured === id;
    handle.releasePointerCapture = vi.fn(() => { captured = null; });
  }
}
function unmount() { act(() => root!.unmount()); root = null; }
function seed(workspace: PanelWorkspace, widths = { left: 400, right: 400 }) {
  storage.setItem(panelStorageKey(workspace), JSON.stringify(widths));
  storageWrites.mockClear();
}
const handle = (side: PanelSide) => container.querySelectorAll<HTMLElement>("[role=separator]")[side === "left" ? 0 : 1]!;
function pointer(side: PanelSide, type: string, clientX: number) {
  act(() => { handle(side).dispatchEvent(new PointerEvent(type,
    { bubbles: true, cancelable: true, clientX, button: 0, pointerId: 1, isPrimary: true })); });
}
function key(side: PanelSide, value: string, shiftKey = false) {
  act(() => { handle(side).dispatchEvent(new KeyboardEvent("keydown",
    { bubbles: true, cancelable: true, key: value, shiftKey })); });
}
function resize(width: number) {
  viewportWidth = width;
  act(() => ObservedSize.instances.at(-1)!.deliver());
}
function display(): PanelWidths {
  const style = container.querySelector<HTMLElement>(".test-panels")!.style;
  return { left: parseFloat(style.getPropertyValue("--panel-left")), right: parseFloat(style.getPropertyValue("--panel-right")) };
}
function expectDisplay(expected: PanelWidths) {
  expect(display().left).toBeCloseTo(expected.left);
  expect(display().right).toBeCloseTo(expected.right);
}

for (const workspace of ["design", "catalogue"] as const) describe(`${workspace} mounted panel lifecycle`, () => {
  it("does not write preferences on a zero-movement gesture and restores them when widened", () => {
    seed(workspace); mount(workspace);
    expectDisplay(fitPanelWidths(workspace, 900, { left: 400, right: 400 }));
    pointer("left", "pointerdown", 500); pointer("left", "pointerup", 500);
    pointer("right", "pointerdown", 500); pointer("right", "pointerup", 500);
    expect(storageWrites).not.toHaveBeenCalled();
    expect(readPanelWidths(storage, workspace)).toEqual({ left: 400, right: 400 });
    resize(1440); expectDisplay({ left: 400, right: 400 });
  });

  it("keeps responsive defaults after a click when no preference has been saved", () => {
    mount(workspace);
    pointer("left", "pointerdown", 500); pointer("left", "pointerup", 500);
    expect(storageWrites).not.toHaveBeenCalled();
    expect(readPanelWidths(storage, workspace)).toBeNull();
    resize(1440); expectDisplay(defaultPanelWidths(workspace, 1440));
  });

  it.each(["left", "right"] as const)("keeps the untouched panel responsive after a %s-only pointer resize from defaults", side => {
    mount(workspace);
    const start = display(), other = side === "left" ? "right" : "left";
    const x = side === "left" ? 510 : 490;
    pointer(side, "pointerdown", 500); pointer(side, "pointermove", x); pointer(side, "pointerup", x);
    expectDisplay({ ...start, [side]: start[side] + 10 });
    expect(readPanelWidths(storage, workspace)).toEqual({ [side]: start[side] + 10 });
    expect(JSON.parse(storage.getItem(panelStorageKey(workspace))!)).not.toHaveProperty(other);
    resize(1280);
    const wide = { ...defaultPanelWidths(workspace, 1280), [side]: start[side] + 10 };
    expectDisplay(wide);
    expect(display()[other]).toBe(defaultPanelWidths(workspace, 1280)[other]);
    unmount(); mount(workspace); expectDisplay(wide);
    resize(900); expectDisplay({ ...start, [side]: start[side] + 10 });
  });

  it.each(["left", "right"] as const)("keeps the untouched panel responsive after a %s-only keyboard resize", side => {
    mount(workspace);
    const start = display();
    key(side, side === "left" ? "ArrowRight" : "ArrowLeft");
    expect(readPanelWidths(storage, workspace)).toEqual({ [side]: start[side] + 10 });
    resize(1280);
    expectDisplay({ ...defaultPanelWidths(workspace, 1280), [side]: start[side] + 10 });
  });

  it.each(["pointercancel", "lostpointercapture", "blur", "Escape"])("preserves and saves partial resizing on %s, then ignores stale movement", reason => {
    seed(workspace); mount(workspace);
    const start = display(), divider = handle("left");
    pointer("left", "pointerdown", 500); pointer("left", "pointermove", 480);
    const partial = { ...start, left: start.left - 20 };
    expectDisplay(partial);
    expect(storageWrites).not.toHaveBeenCalled();
    if (reason === "blur") act(() => { window.dispatchEvent(new Event("blur")); });
    else if (reason === "Escape") key("left", "Escape");
    else pointer("left", reason, 460); // Cancellation coordinates must not apply a further delta.
    expectDisplay(partial);
    expect(readPanelWidths(storage, workspace)).toEqual({ left: partial.left, right: 400 });
    expect(storageWrites).toHaveBeenCalledTimes(1);
    expect(divider.hasPointerCapture(1)).toBe(false);
    expect(divider.hasAttribute("data-resizing")).toBe(false);
    pointer("left", "pointermove", 600); pointer("left", "pointerup", 600);
    expectDisplay(partial);
    expect(storageWrites).toHaveBeenCalledTimes(1);
    unmount(); mount(workspace); resize(1440);
    expectDisplay({ left: partial.left, right: 400 });
  });

  it.each(["left", "right"] as const)("resizes only %s under constraint, retaining the other preference and display", side => {
    seed(workspace); mount(workspace);
    const start = display(), other = side === "left" ? "right" : "left";
    const x = side === "left" ? 480 : 520; // Shrink the selected side by 20 CSS pixels.
    pointer(side, "pointerdown", 500); pointer(side, "pointermove", x);
    expect(display()[side]).toBeCloseTo(start[side] - 20);
    expect(display()[other]).toBeCloseTo(start[other]);
    expect(storageWrites).not.toHaveBeenCalled();
    // Duplicate/initial observer delivery must not refit the panels during or after this gesture.
    resize(900); expect(display()[other]).toBeCloseTo(start[other]);
    pointer(side, "pointerup", x);
    const saved = { left: 400, right: 400, [side]: start[side] - 20 };
    expect(readPanelWidths(storage, workspace)).toEqual(saved);
    expect(storageWrites).toHaveBeenCalledTimes(1);
    resize(900);
    expect(display()[side]).toBeCloseTo(start[side] - 20);
    expect(display()[other]).toBeCloseTo(start[other]);
    resize(1440); expectDisplay(saved);
    resize(900); expectDisplay(fitPanelWidths(workspace, 900, saved));
    resize(1440); expectDisplay(saved);
  });

  it("does not save clamped movement or a drag that returns to its initial width", () => {
    seed(workspace); mount(workspace);
    // Both side widths already consume the room allowed by the central minimum.
    pointer("left", "pointerdown", 500); pointer("left", "pointerup", 600);
    expect(storageWrites).not.toHaveBeenCalled();
    pointer("left", "pointerdown", 500); pointer("left", "pointermove", 480); pointer("left", "pointerup", 500);
    expect(storageWrites).not.toHaveBeenCalled();
    resize(1440); expectDisplay({ left: 400, right: 400 });
  });

  it("responds to ResizeObserver narrow/widen and hidden-workspace updates without saving them", () => {
    viewportWidth = 1440; seed(workspace); mount(workspace);
    expect(ObservedSize.instances).toHaveLength(1);
    expect(ObservedSize.instances[0]!.observe).toHaveBeenCalledWith(container.firstElementChild);
    expectDisplay({ left: 400, right: 400 });
    resize(900); expectDisplay(fitPanelWidths(workspace, 900, { left: 400, right: 400 }));
    const narrow = display(); resize(0); expectDisplay(narrow);
    resize(1440); expectDisplay({ left: 400, right: 400 });
    expect(storageWrites).not.toHaveBeenCalled();
  });

  it("persists an unfinished one-sided gesture on unmount and restores it in a fresh mount", () => {
    seed(workspace); mount(workspace);
    const start = display(), divider = handle("left"), observer = ObservedSize.instances[0]!;
    pointer("left", "pointerdown", 500); pointer("left", "pointermove", 480);
    unmount();
    const saved = { left: start.left - 20, right: 400 };
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(divider.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(readPanelWidths(storage, workspace)).toEqual(saved);
    mount(workspace); expectDisplay(fitPanelWidths(workspace, 900, saved));
    resize(1440); expectDisplay(saved);
    expect(storageWrites).toHaveBeenCalledTimes(1);
  });

  it("ends a gesture when ResizeObserver reports a new viewport width", () => {
    viewportWidth = 1440; seed(workspace); mount(workspace);
    const divider = handle("left");
    pointer("left", "pointerdown", 500); pointer("left", "pointermove", 550);
    resize(900);
    expect(divider.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(readPanelWidths(storage, workspace)).toEqual({ left: 450, right: 400 });
    expectDisplay(fitPanelWidths(workspace, 900, { left: 450, right: 400 }));
    const settled = display();
    pointer("left", "pointermove", 600); // The previous capture/listeners have been cleaned up.
    expectDisplay(settled); // Assert before an observer delivery could hide a stale-listener mutation.
    resize(1440); expectDisplay({ left: 450, right: 400 });
  });

  it.each(["left", "right"] as const)("keyboard resize of %s preserves the other preferred width", side => {
    seed(workspace); mount(workspace);
    const start = display(), other = side === "left" ? "right" : "left";
    // Attempting to grow at the central limit is a no-op, including for storage.
    key(side, side === "left" ? "ArrowRight" : "ArrowLeft");
    expect(storageWrites).not.toHaveBeenCalled();
    key(side, side === "left" ? "ArrowLeft" : "ArrowRight");
    expect(display()[side]).toBeCloseTo(start[side] - 10);
    expect(display()[other]).toBeCloseTo(start[other]);
    const saved = { left: 400, right: 400, [side]: start[side] - 10 };
    expect(readPanelWidths(storage, workspace)).toEqual(saved);
    resize(1440); expectDisplay(saved);
    unmount(); mount(workspace); expectDisplay(saved);
  });

  it("supports Home/End and Shift+arrows without writing keyboard no-ops", () => {
    viewportWidth = 1440; seed(workspace); mount(workspace);
    key("left", "Home");
    expectDisplay({ left: PANEL_MIN[workspace].left, right: 400 });
    const writes = storageWrites.mock.calls.length;
    key("left", "Home");
    expect(storageWrites).toHaveBeenCalledTimes(writes);
    key("left", "End"); expectDisplay({ left: 710, right: 400 });
    key("left", "ArrowLeft", true); expectDisplay({ left: 670, right: 400 });
    key("right", "Home"); expectDisplay({ left: 670, right: PANEL_MIN[workspace].right });
    key("right", "End"); expectDisplay({ left: 670, right: 440 });
    expect(readPanelWidths(storage, workspace)).toEqual({ left: 670, right: 440 });
  });

});

it.each([900, 1440])("uses the structural left baseline on every tab at %i px", width => {
  viewportWidth = width;
  seed("design", { left: 460, right: 280 });
  seed("catalogue", { left: 205, right: 300 });
  root = createRoot(container);
  const tab = (tab: string) => act(() => root!.render(<Panels workspace={tab === "device" ? "catalogue" : "design"} tab={tab} />));
  const baseline = width === 900 ? 270 : 372;
  for (const name of ["enclosure", "support", "device", "enclosure"]) {
    tab(name);
    expect(display().left).toBe(baseline);
    key("left", "ArrowRight");
    expect(display().left).toBe(width === 900 && name === "device" ? baseline : baseline + 10);
  }
  expect(storageWrites).not.toHaveBeenCalled();
  expect(display().right).toBe(280);
});
