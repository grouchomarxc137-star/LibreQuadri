// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManufacturerNode } from "../../src/shared/catalogue.js";
import { BrowseNavigation } from "../../src/renderer/catalogue/CatalogueScreen.js";

const nodes = [
  { id: 1, parentId: null, name: "Apparecchi", source: "import", brandMarchio: "BTI" },
  { id: 2, parentId: 1, name: "Interruttori", source: "import", brandMarchio: "BTI" },
  { id: 3, parentId: null, name: "Famiglie statistiche · SIE", source: "metel", brandMarchio: "SIE" },
  { id: 4, parentId: 3, name: "Automazione", source: "metel", brandMarchio: "SIE" },
].map((node, index) => ({ code: String(node.id), kind: "section", levelCode: null, levelLabel: null,
  sortOrder: index, articleCount: 1, packageCount: 0, ...node })) as ManufacturerNode[];

let host: HTMLDivElement;
let root: Root;
let selected: number | null;
let onSelect: ReturnType<typeof vi.fn<(id: number | null) => void>>;
function Harness() {
  const [, refresh] = useRefresh();
  return <BrowseNavigation nodes={nodes} selectedId={selected} onSelect={id => {
    selected = id; onSelect(id); refresh(value => value + 1);
  }} />;
}
function useRefresh() { return useState(0); }
function label(id: number) { return host.querySelector<HTMLButtonElement>(`.tree-node-label[data-node-id="${id}"]`)!; }
function item(id: number) { return label(id).closest<HTMLLIElement>("[role=treeitem]")!; }
async function click(button: HTMLButtonElement) { await act(async () => button.click()); }
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  selected = null; onSelect = vi.fn(); host = document.createElement("div"); document.body.append(host);
  root = createRoot(host); await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("catalogue tree label toggle", () => {
  it("selects and opens a branch, then collapses and reopens without changing selection", async () => {
    await click(label(1));
    expect(selected).toBe(1); expect(item(1).getAttribute("aria-expanded")).toBe("true");
    await click(label(1));
    expect(selected).toBe(1); expect(onSelect).toHaveBeenCalledTimes(1);
    expect(item(1).getAttribute("aria-expanded")).toBe("false");
    expect(item(1).getAttribute("aria-selected")).toBe("true");
    await click(label(1));
    expect(item(1).getAttribute("aria-expanded")).toBe("true");
    expect(onSelect).toHaveBeenCalledTimes(1);
    await click(label(2));
    expect(selected).toBe(2); expect(onSelect).toHaveBeenLastCalledWith(2);
  });

  it("toggles the synthetic group and chevron without selecting a different category", async () => {
    await click(label(-1));
    expect(item(-1).getAttribute("aria-expanded")).toBe("true");
    expect(onSelect).not.toHaveBeenCalled();
    await click(label(-1));
    expect(item(-1).getAttribute("aria-expanded")).toBe("false");
    await click(label(-1));
    await click(label(3));
    expect(selected).toBe(3);
    await click(item(3).querySelector<HTMLButtonElement>(".tree-toggle")!);
    expect(item(3).getAttribute("aria-expanded")).toBe("false");
    expect(selected).toBe(3);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("keeps arrow navigation and one reachable tab stop after collapse", async () => {
    label(1).focus();
    await act(async () => label(1).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(item(1).getAttribute("aria-expanded")).toBe("true");
    await click(label(1)); await click(label(1));
    label(1).focus();
    await act(async () => label(1).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(item(1).getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelectorAll('.tree-node-label[tabindex="0"]')).toHaveLength(1);
  });
});
