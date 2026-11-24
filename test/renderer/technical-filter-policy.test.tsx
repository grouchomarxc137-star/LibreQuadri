// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { CatalogueScreen } from "../../src/renderer/catalogue/CatalogueScreen.js";
import type { CatalogueBrowseRequest, CatalogueBrowseFilterAttribute, ManufacturerNode } from "../../src/shared/catalogue.js";
import { fakeCatalogueApi, fakeConfigurationApi, fakeProjectApi } from "./fake-api.js";

const kept = new Set(["rated_current", "poles", "trip_curve", "rated_voltage", "declared_breaking_capacity",
  "rated_short_circuit_capacity", "rated_ultimate_breaking_capacity", "rated_residual_current",
  "residual_current_type", "trip_unit_type", "coil_voltage"]);
const seed = JSON.parse(readFileSync("db/seed/attributes.json", "utf8")) as { code: string; name: string }[];
const attributes: CatalogueBrowseFilterAttribute[] = seed.map(row => ({ ...row, dataType: "number", unit: null,
  applicable: true, values: [{ value: 2, label: null, count: 1, selected: false }, { value: 1, label: null, count: 0, selected: false }] }));

it("keeps all 11 Siemens filters in both trees, hides the other 20, restores BTicino selections and clears them", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const nodes = [
    [1, "BTI", "Apparecchi BTicino", "import"], [2, "SIE", "Apparecchi Siemens", "import"],
    [3, "SIE", "Siemens statistiche", "metel"],
  ].map(([id, brandMarchio, name, source]) => ({ id, brandMarchio, name, source, code: `node.${id}`, parentId: null,
    kind: "section", levelCode: null, levelLabel: null, sortOrder: id, articleCount: 1, packageCount: 0 })) as ManufacturerNode[];
  const requests: CatalogueBrowseRequest[] = [];
  const api = { ...fakeCatalogueApi(), manufacturerNodes: async () => nodes, browse: async (request: CatalogueBrowseRequest) => {
    requests.push(request); return { products: [], packages: [], totalCount: 0, packageCount: 0, offset: 0, hasMore: false,
      facets: { brand: null, configurability: null, attributes } };
  } };
  const flush = async () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
  const click = async (element: HTMLElement) => { await act(async () => element.click()); await flush(); };
  const choose = async (id: number) => click(host.querySelector<HTMLElement>(`[data-node-id="${id}"]`)!);
  try {
    await act(async () => root.render(<CatalogueScreen api={api} configurationApi={fakeConfigurationApi()}
      projectApi={fakeProjectApi()} project={null} onProjectChange={() => {}} view="manufacturer" onViewChange={() => {}} />));
    await flush();
    await choose(1);
    await click([...host.querySelectorAll<HTMLElement>("summary")].find(s => s.textContent === "Potenza nominale")!);
    await click(document.querySelector<HTMLInputElement>('.catalogue-facet-options input:not(:disabled)')!);
    expect(requests.at(-1)?.attributeFilters).toEqual([{ attributeCode: "rated_power", values: [2] }]);
    await click(host.querySelector<HTMLElement>('[aria-label="Espandi Famiglie statistiche"]')!);
    for (const id of [2, 3]) {
      await choose(id);
      const names = [...host.querySelectorAll(".catalogue-facets summary")].map(s => s.textContent);
      expect(names).toHaveLength(11);
      for (const row of seed) expect(names.includes(row.name)).toBe(kept.has(row.code));
      expect(seed.filter(row => !kept.has(row.code))).toHaveLength(20);
      expect(requests.at(-1)?.attributeFilters).toEqual([]);
      expect(host.querySelector(".catalogue-active-filters")).toBeNull();
    }
    await choose(1);
    expect(requests.at(-1)?.attributeFilters).toEqual([{ attributeCode: "rated_power", values: [2] }]);
    expect(host.querySelector(".catalogue-active-filters")?.textContent).toContain("Potenza nominale");
    await click(host.querySelector<HTMLElement>(".catalogue-clear-filters")!);
    await choose(2); await choose(1);
    expect(requests.at(-1)?.attributeFilters).toEqual([]);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
