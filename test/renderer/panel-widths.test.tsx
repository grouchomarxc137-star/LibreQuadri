import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { beginPanelDrag, CENTER_MIN, defaultPanelWidths, DIVIDER_WIDTH, fitPanelWidths, PANEL_MIN,
  panelStorageKey, readPanelWidths, resizePanel, writePanelWidths, type PanelWorkspace } from "../../src/renderer/ui/panel-widths.js";
import { ProgettazioneScreen } from "../../src/renderer/project/ProgettazioneScreen.js";
import { CatalogueScreen } from "../../src/renderer/catalogue/CatalogueScreen.js";
import { fakeCatalogueApi, fakeConfigurationApi, fakeProjectApi, openProject } from "./fake-api.js";

for (const workspace of ["design", "catalogue"] as const) describe(`${workspace} panel widths`, () => {
  it("keeps the existing responsive defaults and leaves the centre all remaining space", () => {
    for (const width of [900, 1100, 1279, 1280, 1440, 2000]) {
      const defaults = defaultPanelWidths(workspace, width);
      expect(fitPanelWidths(workspace, width, defaults)).toEqual(defaults);
      expect(width - defaults.left - defaults.right - 2 * DIVIDER_WIDTH).toBeGreaterThanOrEqual(CENTER_MIN);
    }
  });

  it("resizes either panel independently, clamping both extremes to protect the centre", () => {
    const current = defaultPanelWidths(workspace, 1440);
    for (const side of ["left", "right"] as const) {
      const other = side === "left" ? "right" : "left";
      for (const requested of [-1000, current[side] + 75, 99999]) {
        const next = resizePanel(workspace, 1440, current, side, requested);
        expect(next[other]).toBe(current[other]);
        expect(next[side]).toBeGreaterThanOrEqual(PANEL_MIN[workspace][side]);
        expect(1440 - next.left - next.right - 2 * DIVIDER_WIDTH).toBeGreaterThanOrEqual(CENTER_MIN);
      }
    }
  });

  it("adapts oversized preferences without mutating them and retains minima at extreme app zoom", () => {
    const preferred = { left: 600, right: 600 };
    const narrow = fitPanelWidths(workspace, 900, preferred);
    expect(narrow.left + narrow.right + CENTER_MIN + 2 * DIVIDER_WIDTH).toBeCloseTo(900);
    expect(fitPanelWidths(workspace, 300, preferred)).toEqual(PANEL_MIN[workspace]);
    expect(preferred).toEqual({ left: 600, right: 600 });
    expect(fitPanelWidths(workspace, 2000, preferred)).toEqual(preferred);
  });
});

describe("local panel preferences", () => {
  const storage = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  };
  it("round-trips each workspace independently through a fresh reader (navigation/restart)", () => {
    const store = storage();
    expect(readPanelWidths(store, "design")).toBeNull();
    writePanelWidths(store, "design", { left: 321, right: 354 });
    writePanelWidths(store, "catalogue", { left: 245, right: 450 });
    expect(readPanelWidths(store, "design")).toEqual({ left: 321, right: 354 });
    expect(readPanelWidths(store, "catalogue")).toEqual({ left: 245, right: 450 });
  });
  it.each(["{", "null", "[]", "{}", "1", '{"left":null}', '{"right":"300"}', '{"left":0,"right":300}',
    '{"left":-1,"right":300}', '{"left":"250","right":300}', '{"left":1e400,"right":300}'])("ignores corrupt preferences: %s", value => {
    const store = storage(); store.setItem(panelStorageKey("design"), value);
    expect(readPanelWidths(store, "design")).toBeNull();
  });
  it.each(["left", "right"] as const)("round-trips a %s-only preference without inventing an opposite width", side => {
    const store = storage();
    writePanelWidths(store, "design", { [side]: 250 });
    expect(readPanelWidths(store, "design")).toEqual({ [side]: 250 });
    expect(JSON.parse(store.getItem(panelStorageKey("design"))!)).toEqual({ [side]: 250 });
  });
  it("continues without persistence when storage access fails", () => {
    const store = { getItem: () => { throw Error("denied"); }, setItem: () => { throw Error("quota"); } };
    expect(readPanelWidths(store, "design")).toBeNull();
    expect(() => writePanelWidths(store, "design", { left: 300, right: 300 })).not.toThrow();
  });
});

function dragHarness(workspace: PanelWorkspace = "design") {
  const view = new EventTarget();
  const handle = Object.assign(new EventTarget(), {
    ownerDocument: { defaultView: view },
    setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn(),
    setAttribute: vi.fn(), removeAttribute: vi.fn(),
  });
  const emit = (type: string, clientX: number, pointerId = 7) => {
    handle.dispatchEvent(Object.assign(new Event(type), { clientX, pointerId }));
  };
  let widths = defaultPanelWidths(workspace, 1440);
  const start = widths;
  const finish = vi.fn();
  const stop = beginPanelDrag(handle as unknown as HTMLElement, { pointerId: 7, clientX: 600 },
    delta => { widths = resizePanel(workspace, 1440, start, "right", start.right - delta); }, finish);
  return { view, handle, emit, stop, finish, start, widths: () => widths };
}

describe("captured mouse/trackpad pointer resize", () => {
  it("captures the initiating pointer, grows the right panel leftwards and ignores other pointers", () => {
    const h = dragHarness();
    expect(h.handle.setPointerCapture).toHaveBeenCalledWith(7);
    h.emit("pointermove", 520, 8);
    expect(h.widths()).toEqual(h.start);
    h.emit("pointermove", 520);
    expect(h.widths()).toEqual({ left: h.start.left, right: h.start.right + 80 });
    h.emit("pointerup", 500, 8);
    expect(h.finish).not.toHaveBeenCalled();
    h.emit("pointerup", 500);
    expect(h.widths().right).toBe(h.start.right + 100);
    expect(h.finish).toHaveBeenCalledOnce();
    expect(h.handle.releasePointerCapture).toHaveBeenCalledWith(7);
    h.emit("pointermove", 800);
    expect(h.widths().right).toBe(h.start.right + 100);
  });
  it.each(["pointercancel", "lostpointercapture", "blur", "Escape", "unmount"])("cleans up on %s, once", reason => {
    const h = dragHarness(); h.emit("pointermove", 510);
    if (reason === "blur") h.view.dispatchEvent(new Event("blur"));
    else if (reason === "Escape") h.view.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    else if (reason === "unmount") h.stop();
    else h.emit(reason, 510);
    h.stop();
    expect(h.finish).toHaveBeenCalledOnce();
    expect(h.handle.removeAttribute).toHaveBeenCalledWith("data-resizing");
    h.emit("pointermove", 700);
    expect(h.widths().right).toBe(h.start.right + 90);
  });
});

it("exposes two accessible dividers in each existing workspace", () => {
  const screens = [<ProgettazioneScreen project={openProject} api={fakeProjectApi()} onProjectChange={() => undefined}/>,
    <CatalogueScreen api={fakeCatalogueApi()} configurationApi={fakeConfigurationApi()} projectApi={fakeProjectApi()}
      project={openProject} onProjectChange={() => undefined} view="manufacturer" onViewChange={() => undefined}/>];
  for (const screen of screens) {
    const html = renderToStaticMarkup(screen);
    expect(html.match(/role="separator"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Ridimensiona pannello sinistro"');
    expect(html).toContain('aria-label="Ridimensiona pannello destro"');
    expect(html.match(/aria-orientation="vertical"/g)).toHaveLength(2);
  }
});
