// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BrowseFacets } from "../../src/renderer/catalogue/CatalogueScreen.js";

it("portals its checklist, supports keyboard focus and Escape, and dismisses outside clicks", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const selected = vi.fn();
  try {
    await act(async () => root.render(<BrowseFacets brands={[]} configurability={[]} attributes={{ poles: [2] }}
      onBrand={() => {}} onConfigurable={() => {}} onAttribute={selected} facets={{ brand: null, configurability: null,
        attributes: [{ code: "poles", name: "Poli", dataType: "number", unit: null, applicable: true,
          values: [{ value: 2, label: null, count: 0, selected: true }, { value: 1, label: null, count: 0, selected: false }] }] }} />));
    const summary = host.querySelector("summary")!;
    await act(async () => summary.click());
    const popup = document.querySelector(".catalogue-facet-options")!;
    expect(host.contains(popup)).toBe(false);
    expect(popup.parentElement).toBe(document.body);
    expect(popup.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    await act(async () => summary.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(popup.querySelector("input:not(:disabled)"));
    await act(async () => (document.activeElement as HTMLInputElement).click());
    expect(selected).toHaveBeenCalledWith("poles", 2);
    await act(async () => popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.activeElement).toBe(summary);
    expect(document.querySelector(".catalogue-facet-options")).toBeNull();
    await act(async () => summary.click());
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.querySelector(".catalogue-facet-options")).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
