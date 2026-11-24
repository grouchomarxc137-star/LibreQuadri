// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { NoteTextEditor } from "../../src/renderer/project/FrontAnnotations.js";
import { PhysicalPool } from "../../src/renderer/project/PhysicalPool.js";

it("places text with Enter once, retaining Shift+Enter and composition for typing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const commit = vi.fn();
  try {
    await act(async () => root.render(<NoteTextEditor initialText="My note" onCommit={commit} onCancel={vi.fn()} />));
    const field = host.querySelector("textarea")!;
    for (const options of [{ shiftKey: true }, { isComposing: true }]) {
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...options });
      await act(async () => { field.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(false);
      expect(commit).not.toHaveBeenCalled();
    }
    await act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    await act(async () => { field.blur(); });
    expect(commit).toHaveBeenCalledExactlyOnceWith("My note");
    await act(async () => root.render(<PhysicalPool structural={[]} devices={[]} hasRoot onDragStart={vi.fn()} />));
    expect([...host.querySelectorAll("h4")].map(node => node.textContent)).toEqual(["Apparecchi", "Pannelli"]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
