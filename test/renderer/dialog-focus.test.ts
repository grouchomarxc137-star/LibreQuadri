import { afterEach, describe, expect, it, vi } from "vitest";
import { installDialogFocus } from "../../src/renderer/ui/dialog-focus.js";
import { handleEnclosureDialogKey } from "../../src/renderer/project/EnclosureConfigurationDialog.js";

// Small platform doubles exercise the actual shared listeners/observer, using Vitest's node environment.
// Native Chromium disabling, focus event order and rendering remain live desktop acceptance checks.
class ElementDouble extends EventTarget {
  tagName = "BUTTON";
  disabled = false;
  visible = true;
  isConnected = true;
  tabIndex = 0;
  children: ElementDouble[] = [];
  focus = vi.fn(() => {
    if (this.disabled) return;
    dom.activeElement = this;
    dom.dispatchEvent(new Event("focusin"));
  });
  matches() { return this.disabled; }
  getClientRects() { return this.visible ? [{}] : []; }
  querySelectorAll() { return this.children; }
  contains(node: unknown): boolean { return node === this || this.children.some(child => child.contains(node)); }
  closest() { return this.visible ? null : this; }
}
class DocumentDouble extends EventTarget {
  activeElement: ElementDouble | null = null;
  modals: ElementDouble[] = [];
  activeTab = new ElementDouble();
  querySelectorAll() { return this.modals; }
  querySelector() { return this.activeTab; }
}
class ObserverDouble {
  static latest: ObserverDouble;
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(private readonly callback: (records?: MutationRecord[]) => void) { ObserverDouble.latest = this; }
  flush(records: MutationRecord[] = []) { if (!this.disconnect.mock.calls.length) this.callback(records); }
  flushQueued() { this.callback(); }
}
let dom: DocumentDouble;
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; vi.unstubAllGlobals(); });
function fixture() {
  dom = new DocumentDouble();
  vi.stubGlobal("document", dom);
  vi.stubGlobal("HTMLElement", ElementDouble);
  vi.stubGlobal("MutationObserver", ObserverDouble);
  const pane = new ElementDouble(), opener = new ElementDouble(), cancel = new ElementDouble(), select = new ElementDouble(), apply = new ElementDouble();
  pane.tabIndex = -1;
  pane.tagName = "SECTION";
  select.tagName = "SELECT";
  pane.children = [cancel, select, apply];
  dom.modals = [pane]; dom.activeElement = opener;
  dispose = installDialogFocus(pane as unknown as HTMLElement, cancel as unknown as HTMLElement);
  return { pane, opener, cancel, select, apply, observer: ObserverDouble.latest };
}
function tab(backwards = false) {
  const event = Object.assign(new Event("keydown", { cancelable: true }), { key: "Tab", shiftKey: backwards });
  dom.dispatchEvent(event); return event;
}

describe("shared modal focus across asynchronous control changes", () => {
  it.each(["retained", "body", "body-focusin"])("restores the same select after resolution (disabled focus: %s)", async blur => {
    const { cancel, select, observer, pane } = fixture();
    expect(dom.activeElement).toBe(cancel);
    select.focus();
    await Promise.resolve();
    select.disabled = true;
    // Covers both browser outcomes: activeElement stays disabled, or it is cleared without focusin.
    if (blur !== "retained") dom.activeElement = null;
    if (blur === "body-focusin") dom.dispatchEvent(new Event("focusin"));
    observer.flush();
    expect(dom.activeElement).toBe(pane);
    expect(observer.observe).toHaveBeenCalledWith(pane, expect.objectContaining({ subtree: true, attributes: true, childList: true }));
    await Promise.resolve();
    select.disabled = false;
    observer.flush();
    expect(dom.activeElement).toBe(select);
    expect(select.focus).toHaveBeenCalledTimes(2);
    expect(cancel.focus).toHaveBeenCalledOnce(); // Initial focus only; waiting never puts Enter on Annulla.
    observer.flush();
    expect(select.focus).toHaveBeenCalledTimes(2); // Restore once, not on every later mutation.
    pane.children.at(-1)!.focus();
    expect(tab().defaultPrevented).toBe(true);
    expect(dom.activeElement).toBe(cancel);
    expect(tab(true).defaultPrevented).toBe(true);
    expect(dom.activeElement).toBe(pane.children.at(-1));
  });

  it.each(["Tab", "Shift+Tab", "focus"])("does not restore the select after a deliberate %s focus move", async action => {
    const { pane, select, cancel, apply, observer } = fixture();
    select.focus(); select.disabled = true; dom.activeElement = null;
    observer.flush();
    expect(dom.activeElement).toBe(pane);
    const chosen = action === "Shift+Tab" ? apply : cancel;
    if (action === "focus") chosen.focus();
    else expect(tab(action === "Shift+Tab").defaultPrevented).toBe(true);
    expect(dom.activeElement).toBe(chosen);
    await Promise.resolve();
    select.disabled = false;
    observer.flush();
    expect(dom.activeElement).toBe(chosen);
    expect(select.focus).toHaveBeenCalledOnce();
  });

  it("restores an editing select when a fast resolution disables and reenables it in one mutation delivery", () => {
    const { select, observer } = fixture();
    select.focus(); select.disabled = true; dom.activeElement = null;
    select.disabled = false;
    observer.flush([{ type: "attributes", target: select, attributeName: "disabled", oldValue: null },
      { type: "attributes", target: select, attributeName: "disabled", oldValue: "" }] as unknown as MutationRecord[]);
    expect(dom.activeElement).toBe(select);
    expect(select.focus).toHaveBeenCalledTimes(2);
    expect(observer.observe).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ attributeOldValue: true }));
  });

  it("honors a deliberate enabled-control move before the disable mutation is delivered", () => {
    const { select, apply, observer } = fixture();
    select.focus(); select.disabled = true;
    apply.focus(); select.disabled = false;
    observer.flush([{ type: "attributes", target: select, attributeName: "disabled", oldValue: null },
      { type: "attributes", target: select, attributeName: "disabled", oldValue: "" }] as unknown as MutationRecord[]);
    expect(dom.activeElement).toBe(apply);
    expect(select.focus).toHaveBeenCalledOnce();
  });

  it("does not restore a select after the dialog closes, even if a queued callback arrives after resolution", async () => {
    const { pane, select, opener, observer } = fixture();
    select.focus(); select.disabled = true; dom.activeElement = null;
    observer.flush();
    expect(dom.activeElement).toBe(pane);
    dispose!(); dispose = undefined;
    expect(dom.activeElement).toBe(opener);
    await Promise.resolve();
    select.disabled = false;
    observer.flushQueued();
    expect(dom.activeElement).toBe(opener);
    expect(select.focus).toHaveBeenCalledOnce();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(tab().defaultPrevented).toBe(false);
  });

  it.each(["covered", "hidden"])("abandons pending restoration when the dialog becomes %s", mode => {
    const { pane, cancel, select, observer } = fixture();
    select.focus(); select.disabled = true; observer.flush();
    expect(dom.activeElement).toBe(pane);
    const covering = new ElementDouble();
    if (mode === "covered") dom.modals.push(covering);
    else pane.visible = false;
    covering.focus();
    select.disabled = false; observer.flush();
    expect(dom.activeElement).toBe(covering);
    expect(select.focus).toHaveBeenCalledOnce();
    if (mode === "covered") dom.modals.pop();
    else pane.visible = true;
    observer.flush();
    expect(dom.activeElement).toBe(cancel);
    expect(select.focus).toHaveBeenCalledOnce();
  });

  it("forgets a pending select that is removed while resolution is running", () => {
    const { pane, select, observer } = fixture();
    select.focus(); select.disabled = true; observer.flush();
    pane.children = pane.children.filter(control => control !== select);
    observer.flush();
    select.disabled = false; pane.children.push(select); observer.flush();
    expect(dom.activeElement).toBe(pane);
    expect(select.focus).toHaveBeenCalledOnce();
  });

  it("retains keyboard focus when Apply disables every control and a failed submission enables them again", async () => {
    const { pane, cancel, select, apply, observer } = fixture();
    select.focus(); select.disabled = true; observer.flush();
    select.disabled = false; observer.flush();
    expect(dom.activeElement).toBe(select);
    apply.focus();
    let finish!: () => void;
    const request = new Promise<void>(resolve => { finish = resolve; });
    pane.children.forEach(control => { control.disabled = true; });
    dom.activeElement = null;
    observer.flush();
    expect(dom.activeElement).toBe(pane);
    for (const backwards of [false, true]) {
      expect(tab(backwards).defaultPrevented).toBe(true);
      expect(dom.activeElement).toBe(pane);
    }
    const onCancel = vi.fn();
    const escape = { key: "Escape", repeat: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    handleEnclosureDialogKey(escape, true, onCancel);
    expect(onCancel).not.toHaveBeenCalled();
    finish(); await request;
    // Failure retains the modal and reenables its choices/actions; do not restore focus to the page.
    cancel.disabled = select.disabled = apply.disabled = false;
    const alert = new ElementDouble();
    pane.children.unshift(alert); // The new focusable diagnostic is readable/scrollable with the keyboard.
    observer.flush();
    expect(dom.activeElement).toBe(pane);
    expect(tab().defaultPrevented).toBe(true);
    expect(dom.activeElement).toBe(alert);
    expect(tab(true).defaultPrevented).toBe(true);
    expect(dom.activeElement).toBe(apply);
    expect(select.focus).toHaveBeenCalledTimes(2); // The old editing position must not revive after Apply.
    handleEnclosureDialogKey(escape, false, onCancel);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(escape.preventDefault).toHaveBeenCalledTimes(2);
    expect(escape.stopPropagation).toHaveBeenCalledTimes(2);
  });

  it("keeps focus inside when the page receives focus, without moving a still-enabled selection on unrelated mutations", () => {
    const { select, cancel, observer } = fixture();
    select.focus(); observer.flush();
    expect(dom.activeElement).toBe(select);
    new ElementDouble().focus();
    expect(dom.activeElement).toBe(cancel);
  });

  it("does not let a covered or hidden workspace modal steal focus", () => {
    const { pane, cancel, select, observer } = fixture();
    const covering = new ElementDouble();
    dom.modals.push(covering); covering.focus();
    observer.flush();
    expect(dom.activeElement).toBe(covering);
    expect(tab().defaultPrevented).toBe(false);
    dom.modals.pop(); pane.visible = false;
    observer.flush();
    expect(dom.activeElement).toBe(covering);
    expect(cancel.focus).toHaveBeenCalledOnce();
    expect(select.focus).not.toHaveBeenCalled();
  });

  it("disconnects observation/listeners before restoring the opener; no repair runs after close", () => {
    const { opener, observer } = fixture();
    dispose!(); dispose = undefined;
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(dom.activeElement).toBe(opener);
    const outside = new ElementDouble(); outside.focus(); observer.flush();
    expect(dom.activeElement).toBe(outside);
    expect(tab().defaultPrevented).toBe(false);
  });

  it("returns focus to the current workspace tab when the opener has gone", () => {
    const { opener } = fixture(); opener.isConnected = false;
    dispose!(); dispose = undefined;
    expect(dom.activeElement).toBe(dom.activeTab);
  });

  it("leaves ordinary Tab and Enter native, but suppresses repeated Enter", () => {
    const { select } = fixture(); select.focus();
    expect(tab().defaultPrevented).toBe(false);
    const onCancel = vi.fn();
    const enter = { key: "Enter", repeat: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    handleEnclosureDialogKey(enter, false, onCancel);
    expect(enter.preventDefault).not.toHaveBeenCalled();
    handleEnclosureDialogKey({ ...enter, repeat: true }, false, onCancel);
    expect(enter.preventDefault).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
