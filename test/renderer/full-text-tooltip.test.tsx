/// <reference types="node" />
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProjectConfiguredItem, ProjectDocumentView } from "../../src/shared/project.js";
import { attachFullTextReveal, createFullTextReveal, FULL_TEXT_DELAY_MS, FullTextTooltip, isTruncated, tooltipPosition,
  type RevealTrigger } from "../../src/renderer/ui/FullTextTooltip.js";
import { PhysicalPool } from "../../src/renderer/project/PhysicalPool.js";
import { devicePool, structuralPool } from "../../src/renderer/project/placement-workflow.js";

type Shown = { text: string; anchor: string } | null;
function harness() {
  const shown: Shown[] = [];
  const reveal = createFullTextReveal<string>(value => shown.push(value));
  const row = (text: string, cut = true): RevealTrigger<string> & { cut: boolean } => {
    const trigger = { text, cut, truncated: () => trigger.cut, anchor: () => `rect:${text}` };
    return trigger;
  };
  return { shown, reveal, row, last: () => shown.at(-1) };
}

describe("quick full-text reveal timing", () => {
  it("is much faster than the native title tooltip", () => {
    expect(FULL_TEXT_DELAY_MS).toBeGreaterThan(0);
    expect(FULL_TEXT_DELAY_MS).toBeLessThanOrEqual(150);
  });

  it("shows a cut-off row after the short hover delay and hides it as soon as the pointer leaves", () => {
    vi.useFakeTimers();
    try {
      const { shown, reveal, row, last } = harness();
      const long = row("Quadro MDX800 - 850(600+250)x1200x230mm");
      reveal.enter(long);
      vi.advanceTimersByTime(FULL_TEXT_DELAY_MS - 1);
      expect(shown).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(last()).toEqual({ text: "Quadro MDX800 - 850(600+250)x1200x230mm", anchor: "rect:Quadro MDX800 - 850(600+250)x1200x230mm" });
      // Moving inside the same row neither re-schedules nor flickers.
      reveal.enter(long);
      vi.advanceTimersByTime(FULL_TEXT_DELAY_MS * 3);
      expect(shown).toHaveLength(1);
      reveal.dismiss();
      expect(last()).toBeNull();
      expect(shown).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });

  it("never shows anything for a row that fits, measured when the reveal is due", () => {
    vi.useFakeTimers();
    try {
      const { shown, reveal, row } = harness();
      const short = row("Cieco 600x400mm", false);
      reveal.enter(short);
      vi.advanceTimersByTime(FULL_TEXT_DELAY_MS * 5);
      expect(shown).toEqual([]);
      reveal.focus(short);
      expect(shown).toEqual([]);
      // A row that became cut off meanwhile (a narrower sidebar) is revealed on the next hover.
      const resized = row("Pannello", false);
      reveal.enter(resized);
      resized.cut = true;
      vi.advanceTimersByTime(FULL_TEXT_DELAY_MS);
      expect(shown.at(-1)?.text).toBe("Pannello");
    } finally { vi.useRealTimers(); }
  });

  it("cancels a pending reveal when the pointer leaves first, and switches between rows at once once visible", () => {
    vi.useFakeTimers();
    try {
      const { shown, reveal, row, last } = harness();
      reveal.enter(row("Primo nome lungo"));
      vi.advanceTimersByTime(FULL_TEXT_DELAY_MS / 2);
      reveal.dismiss();
      vi.advanceTimersByTime(FULL_TEXT_DELAY_MS * 2);
      expect(shown).toEqual([]);
      reveal.enter(row("Secondo nome lungo"));
      vi.advanceTimersByTime(FULL_TEXT_DELAY_MS);
      reveal.enter(row("Terzo nome lungo"));
      expect(last()?.text).toBe("Terzo nome lungo");
      // Leaving the revealed row for one that fits hides the bubble instead of keeping the old text.
      reveal.enter(row("Corto", false));
      expect(last()).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("reveals at once on keyboard focus, and dispose cancels anything pending", () => {
    vi.useFakeTimers();
    try {
      const { shown, reveal, row, last } = harness();
      reveal.focus(row("Apparecchio dal nome molto lungo"));
      expect(last()?.text).toBe("Apparecchio dal nome molto lungo");
      reveal.dismiss();
      reveal.enter(row("Altro"));
      reveal.dispose();
      vi.advanceTimersByTime(FULL_TEXT_DELAY_MS * 2);
      expect(shown.filter(Boolean)).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
});

describe("full-text bubble placement and truncation", () => {
  const viewport = { width: 1280, height: 800 };
  it("sits just below the row, left-aligned, and flips above or shifts left only when it would leave the window", () => {
    const row = { left: 20, top: 100, right: 260, bottom: 122 };
    expect(tooltipPosition(row, { width: 300, height: 24 }, viewport)).toEqual({ left: 20, top: 126 });
    expect(tooltipPosition({ ...row, top: 770, bottom: 792 }, { width: 300, height: 24 }, viewport)).toEqual({ left: 20, top: 742 });
    expect(tooltipPosition({ ...row, left: 1100, right: 1270 }, { width: 300, height: 24 }, viewport)).toEqual({ left: 972, top: 126 });
    expect(tooltipPosition({ ...row, left: -40 }, { width: 300, height: 24 }, viewport).left).toBe(8);
  });

  it("detects truncation only on ellipsized content that overflows", () => {
    const element = (style: string, scrollWidth: number, clientWidth: number, children: object[] = []) =>
      ({ style, scrollWidth, clientWidth, children });
    const fake = (root: ReturnType<typeof element>) => {
      const all = (node: ReturnType<typeof element>): ReturnType<typeof element>[] =>
        (node.children as ReturnType<typeof element>[]).flatMap(child => [child, ...all(child)]);
      return { ...root, ownerDocument: { defaultView: { getComputedStyle: (node: { style: string }) => ({ textOverflow: node.style }) } },
        querySelectorAll: () => all(root) } as unknown as HTMLElement;
    };
    expect(isTruncated(fake(element("clip", 0, 0, [element("ellipsis", 180, 180)])))).toBe(false);
    expect(isTruncated(fake(element("clip", 0, 0, [element("ellipsis", 312, 180)])))).toBe(true);
    expect(isTruncated(fake(element("clip", 0, 0, [element("clip", 312, 180)])))).toBe(false);
    expect(isTruncated(fake(element("ellipsis", 400, 200)))).toBe(true);
  });

  it("is styled to stay out of the way: fixed, above the docks, never taking the pointer", () => {
    const css = readFileSync("src/renderer/styles.css", "utf8");
    expect(css).toMatch(/\.full-text-tooltip \{[^}]*position: fixed;[^}]*pointer-events: none;/);
    // Nothing is shown until a row is hovered or focused.
    expect(renderToStaticMarkup(<FullTextTooltip scopeRef={{ current: null }} />)).toBe("");
    expect(readFileSync("src/renderer/project/ProgettazioneScreen.tsx", "utf8")).toContain("<FullTextTooltip scopeRef={sectionRef}/>");
  });
});

describe("Da posizionare rows reveal what they show", () => {
  it("uses the row's own name and code line, without internal model codes or reference ids", () => {
    const device = { uuid: "item-device-uuid-1", modelName: "Btdin 60 Magnetot. Diff. - 30mA - 1 Polo+Neutro (2-40A)",
      modelBrandMarchio: "TEST", modelCode: "tq.pack.4423", modelKind: "device", commercialContribution: "articles",
      physStatus: "resolved", profileCode: "p", views: [], demands: [{ capacityKindCode: "din_rail", capacityKindLabel: "DIN",
        amount: 4, displayDivisor: 2, nominalPitchMm: 9 }], bom: [{ role: "primary", manufacturerCode: "F81NAC16" }],
      selections: [] } as unknown as ProjectConfiguredItem;
    const panel = { ...device, uuid: "item-panel-uuid-2", modelName: "1 Megaswitch MW250 600x300mm 1/4 giro",
      modelCode: "tq.pack.1240", modelKind: "support", demands: [], bom: [{ role: "primary", manufacturerCode: "9561/1WQ" }],
      views: [{ viewCode: "front", widthMm: 600, heightMm: 300 }] } as unknown as ProjectConfiguredItem;
    const project = { configuredItems: [device, panel], physicalNodes: [], lines: [
      { lineType: "item", uuid: "l1", itemUuid: device.uuid, quantity: 1 },
      { lineType: "item", uuid: "l2", itemUuid: panel.uuid, quantity: 1 }] } as unknown as ProjectDocumentView;
    const markup = renderToStaticMarkup(<PhysicalPool structural={structuralPool(project)} devices={devicePool(project)}
      hasRoot onDragStart={() => undefined} />);
    const reveals = [...markup.matchAll(/data-full-text="([^"]*)"/g)].map(match => match[1]);
    expect(reveals).toHaveLength(2);
    expect(reveals[1]).toMatch(/^Btdin 60 Magnetot\. Diff\. - 30mA - 1 Polo\+Neutro \(2-40A\) · F81NAC16 · /);
    expect(reveals[0]).toMatch(/^1 Megaswitch MW250 600x300mm 1\/4 giro · 9561\/1WQ/);
    expect(markup).not.toContain("tq.pack");
    expect(markup).not.toContain("item-device");
    // Distinct names add nothing beyond the row text, so they reveal only when cut off.
    expect(markup).not.toContain("data-full-text-always");
    expect(markup).not.toMatch(/class="pool-item"[^>]*title=/);
  });
});

/*
 * The delegated wiring itself: which events reach the scope, which element is measured, and what
 * dismisses. A minimal fake DOM (no browser is available to the unit tests) mirrors the real shape of
 * a Struttura model row: a button owning data-full-text, with an ellipsized name span and detail.
 */
type Handler = (event: unknown) => void;
class Bus {
  readonly handlers = new Map<string, Set<Handler>>();
  addEventListener(type: string, handler: Handler) { (this.handlers.get(type) ?? this.handlers.set(type, new Set()).get(type)!).add(handler); }
  removeEventListener(type: string, handler: Handler) { this.handlers.get(type)?.delete(handler); }
  emit(type: string, event: object = {}) { for (const handler of [...(this.handlers.get(type) ?? [])]) handler({ buttons: 0, ...event }); }
  count() { return [...this.handlers.values()].reduce((sum, set) => sum + set.size, 0); }
}
function fakeRow(text: string, overflow: { scrollWidth: number; clientWidth: number }, view: unknown, always = false) {
  const children: Array<{ style: string; scrollWidth: number; clientWidth: number; closest: (selector: string) => unknown }> = [];
  const row: Record<string, unknown> = {
    dataset: { fullText: text }, isConnected: true, style: "clip", scrollWidth: 189, clientWidth: 189,
    ownerDocument: { defaultView: view },
    hasAttribute: (name: string) => always && name === "data-full-text-always",
    getBoundingClientRect: () => ({ left: 90, top: 260, right: 280, bottom: 284 }),
    querySelectorAll: () => children, matches: () => true,
    contains: (other: unknown) => other === row || children.includes(other as never),
    closest: (selector: string) => selector === "[data-full-text]" ? row : null,
  };
  const name = { style: "ellipsis", ...overflow, closest: (selector: string) => selector === "[data-full-text]" ? row : null };
  children.push(name);
  return { row, name };
}
function fakeScope(make: (view: unknown) => Array<ReturnType<typeof fakeRow>>) {
  const view = Object.assign(new Bus(), { getComputedStyle: (element: { style: string }) => ({ textOverflow: element.style }) });
  const rows = make(view);
  const scope = Object.assign(new Bus(), { ownerDocument: { defaultView: view },
    contains: (node: unknown) => rows.some(entry => entry.row === node) });
  return { scope, view, rows };
}
const REAL_ROW = { scrollWidth: 202, clientWidth: 106 }; // "Armadio HDX - 350x1800x350mm", as measured in the live app

describe("delegated hover and focus wiring", () => {
  function wired(overflow = REAL_ROW, always = false) {
    const { scope, view, rows } = fakeScope(shared => [fakeRow("Armadio HDX - 350x1800x350mm · BTI / code", overflow, shared, always)]);
    const entry = rows[0]!;
    const shown: Array<{ text: string } | null> = [];
    const detach = attachFullTextReveal(scope as never, value => shown.push(value));
    return { entry, scope, view, shown, detach };
  }

  it("reveals the full text when the pointer enters a child of a truncated row, measuring the ellipsized child", () => {
    vi.useFakeTimers();
    try {
      const { entry, scope, shown } = wired();
      // The pointer is over the inner name span, not the row: the row that owns data-full-text is found from it.
      scope.emit("pointerover", { target: entry.name });
      vi.advanceTimersByTime(FULL_TEXT_DELAY_MS - 1);
      expect(shown).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(shown.at(-1)).toMatchObject({ text: "Armadio HDX - 350x1800x350mm · BTI / code" });
    } finally { vi.useRealTimers(); }
  });

  it("shows nothing for a row whose text fits, and ignores presses in progress (a drag)", () => {
    vi.useFakeTimers();
    try {
      const fits = wired({ scrollWidth: 106, clientWidth: 106 });
      fits.scope.emit("pointerover", { target: fits.entry.name });
      vi.advanceTimersByTime(1000);
      expect(fits.shown).toEqual([]);
      const dragging = wired();
      dragging.scope.emit("pointerover", { target: dragging.entry.name, buttons: 1 });
      vi.advanceTimersByTime(1000);
      expect(dragging.shown).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  it("reveals a same-named variant row even when nothing is cut off", () => {
    vi.useFakeTimers();
    try {
      const { entry, scope, shown } = wired({ scrollWidth: 100, clientWidth: 100 }, true);
      scope.emit("pointerover", { target: entry.row });
      vi.advanceTimersByTime(FULL_TEXT_DELAY_MS);
      expect(shown.at(-1)).toMatchObject({ text: expect.stringContaining("Armadio HDX") });
    } finally { vi.useRealTimers(); }
  });

  it("hides on leaving, but not when the pointer only crosses between children of the same row", () => {
    vi.useFakeTimers();
    try {
      const { entry, scope, shown } = wired();
      scope.emit("pointerover", { target: entry.name });
      vi.advanceTimersByTime(FULL_TEXT_DELAY_MS);
      scope.emit("pointerout", { target: entry.name, relatedTarget: entry.row });
      expect(shown.at(-1)).not.toBeNull();
      scope.emit("pointerout", { target: entry.row, relatedTarget: null });
      expect(shown.at(-1)).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("is dismissed by a press, wheel, scroll, Escape, blur or resize anywhere in the window", () => {
    vi.useFakeTimers();
    try {
      const { entry, scope, view, shown } = wired();
      const reveal = () => { scope.emit("pointerover", { target: entry.name }); vi.advanceTimersByTime(FULL_TEXT_DELAY_MS); };
      for (const [type, event] of [["pointerdown", {}], ["wheel", {}], ["scroll", {}], ["keydown", { key: "Escape" }],
        ["blur", {}], ["resize", {}]] as const) {
        // A fresh row each time: dismissal forgets the row, so it has to be entered again.
        reveal();
        expect(shown.at(-1)).not.toBeNull();
        view.emit(type, event);
        expect(shown.at(-1)).toBeNull();
        scope.emit("pointerout", { target: entry.row, relatedTarget: null });
      }
      reveal();
      view.emit("keydown", { key: "Enter" });
      expect(shown.at(-1)).not.toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("reveals at once on keyboard focus and hides on blur of the row; detach removes every listener", () => {
    const { entry, scope, view, shown, detach } = wired();
    scope.emit("focusin", { target: entry.row });
    expect(shown.at(-1)).toMatchObject({ text: expect.stringContaining("Armadio HDX") });
    scope.emit("focusout", { target: entry.row });
    expect(shown.at(-1)).toBeNull();
    expect(scope.count() + view.count()).toBeGreaterThan(0);
    detach();
    expect(scope.count() + view.count()).toBe(0);
  });
});

describe("rows opt in on the elements the user actually points at", () => {
  it("puts data-full-text on the Struttura model button that owns both the name and the detail", () => {
    const source = readFileSync("src/renderer/project/HierarchyTree.tsx", "utf8");
    expect(source).toMatch(/className="hierarchy-leaf"[\s\S]*?data-full-text=/);
    expect(source).toMatch(/className="hierarchy-branch" data-full-text=/);
    const css = readFileSync("src/renderer/styles.css", "utf8");
    // The ellipsis is on the children, inside the opted-in button: that is what the measurement walks.
    expect(css).toMatch(/\.hierarchy-tree \.hierarchy-name \{[^}]*text-overflow: ellipsis/);
  });
});
