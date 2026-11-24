// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CatalogueScreen } from "../../src/renderer/catalogue/CatalogueScreen.js";
import { browseCatalogue } from "../../src/main/catalogue/browse-queries.js";
import { browseManufacturerNodes } from "../../src/main/catalogue/manufacturer-navigation.js";
import { createCatalogueFixture } from "../helpers/catalogue-fixtures.js";
import { fakeCatalogueApi, fakeConfigurationApi, fakeProjectApi, openProject } from "./fake-api.js";
import type { CatalogueBrowseRequest } from "../../src/shared/catalogue.js";

it("browses classified Siemens branches, retaining filters across both trees, paging and clearing selections", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createCatalogueFixture();
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    fixture.importDelivery({ issuer: "SIE", listino: "1", validFrom: "2026-01-01", products: [
      ...Array.from({ length: 64 }, (_, i) => ({ marchio: "SIE", code: `5SY${String(i).padStart(4, "0")}`,
        statisticalFamily: "P310 I22Y", description: `INT MT 2P C${i + 1} ICN 6KA` })),
      { marchio: "SIE", code: "UNKNOWN", statisticalFamily: "R132 IC12", description: "CPU 1211C DC/DC/DC" },
    ] });
    const db = fixture.lq, nodes = browseManufacturerNodes(db);
    const id = (code: string) => nodes.find(n => n.code === code)!.id;
    const functionalRoot = id("classified.sie.root"), modular = id("classified.sie.dispositivi_modulari");
    const breaker = id("classified.sie.dispositivi_modulari.magnetotermici");
    const fallback = id("classified.sie.unclassified");
    const statisticalRoot = nodes.find(n => n.parentId === null && n.code.startsWith("metel."))!.id;
    const requests: CatalogueBrowseRequest[] = [];
    const api = { ...fakeCatalogueApi(), manufacturerNodes: async () => nodes,
      browse: async (request: CatalogueBrowseRequest) => { requests.push(request); return browseCatalogue(db, request); } };
    const flush = async () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
    const click = async (button: HTMLElement) => { await act(async () => button.click()); await flush(); };
    const choose = async (nodeId: number) => click(host.querySelector<HTMLButtonElement>(`.tree-node-label[data-node-id="${nodeId}"]`)!);
    await act(async () => root.render(<CatalogueScreen api={api} configurationApi={fakeConfigurationApi()} projectApi={fakeProjectApi()}
      project={openProject} onProjectChange={() => {}} view="manufacturer" onViewChange={() => {}} />)); await flush();
    expect(host.querySelector<HTMLButtonElement>(`.tree-node-label[data-node-id="${functionalRoot}"]`)?.textContent).toContain("Apparecchi Siemens");
    await choose(functionalRoot);
    expect(host.querySelectorAll(".catalogue-article")).toHaveLength(50);
    await click([...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Mostra altri")!);
    expect(host.querySelectorAll(".catalogue-article")).toHaveLength(65);
    await choose(modular); await choose(breaker);
    const summary = [...host.querySelectorAll<HTMLElement>(".catalogue-facets summary")].find(s => s.textContent === "Corrente nominale")!;
    await click(summary);
    const current = [...document.querySelector(".catalogue-facet-options")!.querySelectorAll<HTMLLabelElement>("label")]
      .find(label => label.textContent!.startsWith("16 A"))!.querySelector<HTMLInputElement>("input")!;
    await click(current);
    expect(host.querySelectorAll(".catalogue-article")).toHaveLength(1);
    expect(requests.at(-1)?.attributeFilters).toContainEqual({ attributeCode: "rated_current", values: [16] });
    await click(host.querySelector<HTMLButtonElement>('[aria-label="Espandi Famiglie statistiche"]')!);
    await choose(statisticalRoot);
    expect(host.querySelectorAll(".catalogue-article")).toHaveLength(1);
    await choose(fallback);
    expect(host.querySelectorAll(".catalogue-article")).toHaveLength(0);
    expect(host.querySelector(".catalogue-active-filters")?.textContent).toContain("16 A");
    await click(host.querySelector<HTMLButtonElement>(".catalogue-clear-filters")!);
    expect(requests.at(-1)?.attributeFilters).toEqual([]);
    expect(host.querySelectorAll(".catalogue-article")).toHaveLength(1);
    await choose(functionalRoot);
    expect(host.querySelector(".catalogue-results-count")?.textContent).toContain("65 articoli");
  } finally { act(() => root.unmount()); host.remove(); fixture.close(); vi.unstubAllGlobals(); }
});
