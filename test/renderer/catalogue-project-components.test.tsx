// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigurationApi, ConfigurationRequest, ConfigModelDetail, ConfigurationResult } from "../../src/shared/configuration.js";
import type { ProjectApi, ProjectConfiguredItem, ProjectDocumentView, ProjectQuotationLine } from "../../src/shared/project.js";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgettazioneScreen } from "../../src/renderer/project/ProgettazioneScreen.js";
import { CatalogueScreen } from "../../src/renderer/catalogue/CatalogueScreen.js";
import { quantityError } from "../../src/renderer/catalogue/ProjectComponents.js";
import { ArticleConfiguration } from "../../src/renderer/catalogue/ArticleConfiguration.js";
import { ModelConfigurationSession, configurationChanged } from "../../src/renderer/configuration/model-configuration.js";
import { fakeCatalogueApi, fakeProjectApi, openProject } from "./fake-api.js";

const model: ConfigModelDetail = {
  id: 7, code: "switch", name: "Interruttore", kind: "device", brandMarchio: "TEST", active: true,
  obsolete: false, commercialContribution: "articles", definitionFingerprint: "def", sourceRef: null,
  baseProfileId: null, maxInsertQty: null, budgets: [], relations: [], axes: [{ id: 70,
    dimensionCode: "trip", label: "Taratura", sortOrder: 0, visibility: "visible", requirement: "required",
    binding: "none", editableWhenPlaced: true, selectsPrimary: false, options: [71, 72].map((id, index) => ({
      id, axisId: 70, valueId: id, valueCode: index ? "B" : "A", label: index ? "B" : "A",
      parentOptionId: null, isDefault: !index, visible: true, active: true, sortOrder: index,
    })) }],
};
const result = (request: ConfigurationRequest): ConfigurationResult => ({ model,
  selectedOptionIds: request.selectedOptionIds.length ? request.selectedOptionIds : [71], defaultedOptionIds: [],
  commercialContribution: "articles", matchingRuleIds: [], fingerprint: String(request.selectedOptionIds),
  status: "complete", issues: [], bom: [{ brandMarchio: "TEST", manufacturerCode: request.selectedOptionIds.includes(72) ? "ART-B" : "ART-A",
    productId: null, linkedBrandMarchio: null, linkedManufacturerCode: null, quantity: 1, roles: ["primary"],
    description: "Interruttore", unitPriceE4: 10000, rowTotalE4: 10000, currency: "EUR", priceIssuerSigla: null,
    priceListinoNumber: null, priceValidFrom: null, priceMultiplierOriginal: null }], totalE4: 10000,
  pricedSubtotalE4: 10000, budgets: [], physical: null, exclusions: [],
});
const accessory = (code: string) => ({ seq: 1, snapshotUuid: "s", brandMarchio: "TEST", manufacturerCode: code,
  description: "Fusibile salvato", quantityPerItem: 3, role: "accessory", listPriceUnitE4: null, salePriceUnitE4: null });
const item = (uuid: string, choice: "A" | "B"): ProjectConfiguredItem => ({
  uuid, modelKind: "device", modelName: `Interruttore ${choice}`, modelCode: "switch", modelBrandMarchio: "TEST",
  physStatus: "resolved", selections: [{ dimensionCode: "trip", dimensionLabel: "Taratura", valueCode: choice,
    valueLabel: choice, selectionSource: "explicit", binding: "none", editableWhenPlaced: true, visible: true }],
  bom: [{ seq: 0, snapshotUuid: "s", brandMarchio: "TEST", role: "primary", manufacturerCode: `ART-${choice}`,
    description: "Interruttore", quantityPerItem: 1 }, accessory(`ACC-${choice}`)],
  configFingerprint: choice, views: [], zones: [], slots: [], constraints: [], exclusions: [], demands: [],
} as unknown as ProjectConfiguredItem);
const first = item("item-a", "A"), second = item("item-b", "B");
const itemLine = (uuid: string, itemUuid: string, quantity: number): ProjectQuotationLine => ({
  uuid, itemUuid, quantity, lineType: "item", snapshotUuid: null, brandMarchio: "TEST", manufacturerCode: "switch",
  description: "Interruttore", unitOfMeasure: "pz", unitListPriceE4: 10000, lineTotalE4: quantity * 10000, currency: "EUR",
});
const productLine: ProjectQuotationLine = { uuid: "line-c", itemUuid: null, quantity: 1, lineType: "product",
  snapshotUuid: null, brandMarchio: "BTI", manufacturerCode: "FN82C16", description: "Magnetotermico", unitOfMeasure: "pz",
  unitListPriceE4: 5000, lineTotalE4: 5000, currency: "EUR" };
const base: ProjectDocumentView = { ...openProject, configuredItems: [first, second],
  lines: [itemLine("line-a", first.uuid, 2), itemLine("line-b", second.uuid, 3), productLine],
  physicalNodes: [{ uuid: "node", itemUuid: second.uuid, nodeKind: "device", children: [] }] } as unknown as ProjectDocumentView;

let host: HTMLDivElement, root: Root;
let current: ProjectDocumentView;
let projectApi: ProjectApi;
let modelByCode: ReturnType<typeof vi.fn>;
const configurationApi = () => ({ modelByCode, model: vi.fn(async () => model), productModels: vi.fn(async () => []),
  ranges: vi.fn(async () => []), nodeModels: vi.fn(async () => []),
  resolve: vi.fn(async (request: ConfigurationRequest) => result(request)) }) as unknown as ConfigurationApi;

function Harness() {
  const [project, setProject] = useState(current);
  const [active, setActive] = useState<string | null>(null);
  return <CatalogueScreen api={fakeCatalogueApi()} configurationApi={configurationApi()} projectApi={projectApi}
    project={project} onProjectChange={next => { current = next; setProject(next); }} view="manufacturer"
    onViewChange={() => undefined} activeLineUuid={active} onActiveLineChange={setActive} />;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  current = base; modelByCode = vi.fn(async () => model);
  projectApi = { ...fakeProjectApi(),
    setQuantity: vi.fn(async (uuid: string, quantity: number) => ({ ...current,
      lines: current.lines.map(line => line.uuid === uuid ? { ...line, quantity } : line) })),
    removeLines: vi.fn(async (uuids: readonly string[]) => ({ ...current,
      lines: current.lines.filter(line => !uuids.includes(line.uuid)) })),
    replaceConfiguredItem: vi.fn(async (uuid: string) => ({ ...current,
      lines: current.lines.map(line => line.uuid === uuid ? { ...line, itemUuid: "item-new" } : line),
      configuredItems: [...current.configuredItems, { ...first, uuid: "item-new", configFingerprint: "new" }] })),
  } as unknown as ProjectApi;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function flush() { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); }
async function mount() { await act(async () => root.render(<Harness />)); await flush(); }
const rows = () => [...host.querySelectorAll<HTMLElement>(".project-component-row")];
const open = async (index: number) => { await act(async () => rows()[index]!.querySelector<HTMLButtonElement>(".project-component-open")!.click()); await flush(); };
const rowChecks = () => [...host.querySelectorAll<HTMLInputElement>(".project-component-row > input[type=checkbox]")];
const scheda = () => host.querySelector(".catalogue-scheda-slot") as HTMLElement;
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.includes(label));
const type = (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true })); });
const key = (input: HTMLInputElement, name: string) => act(async () => {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })); });

describe("Catalogo right column: Scheda above, Componenti del progetto below", () => {
  it("lists every project line, placed or not, below the Scheda with its quantity", async () => {
    await mount();
    const column = host.querySelector(".catalogue-right")!;
    expect([...column.children].map(node => node.className.split(" ")[0])).toEqual(["catalogue-scheda-slot", "catalogue-pane"]);
    expect(host.querySelector("#project-components-title")?.textContent).toBe("Componenti del progetto");
    expect(rows()).toHaveLength(3);
    expect([...host.querySelectorAll<HTMLInputElement>(".project-component-quantity input")].map(node => node.value)).toEqual(["2", "3", "1"]);
    expect(rows()[0]!.textContent).toContain("Interruttore A");
    expect(rows()[1]!.textContent).toContain("1 di 3 posizionati");
    expect(rows()[2]!.textContent).toContain("Magnetotermico");
    expect(scheda().textContent).toContain("Seleziona un articolo dall’elenco");
  });

  it("opens the clicked row in the Scheda with the saved choices and the saved BOM including accessories", async () => {
    await mount(); await open(0);
    expect(rows()[0]!.dataset["active"]).toBe("true");
    const text = scheda().textContent ?? "";
    expect(text).toContain("Configurazione salvata (progetto)");
    expect(text).toContain("Distinta/accessori salvati (progetto)");
    expect(text).toContain("ACC-A");
    expect(text).toContain("Accessorio");
    expect(host.querySelector<HTMLSelectElement>(".catalogue-scheda-slot select")!.value).toBe("71");
    await open(1);
    expect(rows().map(row => row.dataset["active"])).toEqual(["false", "true", "false"]);
    expect(scheda().textContent).toContain("ACC-B");
    expect(host.querySelector<HTMLSelectElement>(".catalogue-scheda-slot select")!.value).toBe("72");
  });

  it("keeps checkbox selection independent of the active row and supports Seleziona tutti", async () => {
    await mount(); await open(0);
    await act(async () => rowChecks()[2]!.click());
    expect(rowChecks().map(box => box.checked)).toEqual([false, false, true]);
    await open(1);
    expect(rowChecks().map(box => box.checked)).toEqual([false, false, true]);
    expect(rows().map(row => row.dataset["active"])).toEqual(["false", "true", "false"]);
    const all = host.querySelector<HTMLInputElement>(".project-components-all input")!;
    await act(async () => all.click());
    expect(rowChecks().every(box => box.checked)).toBe(true);
    expect(rows().map(row => row.dataset["active"])).toEqual(["false", "true", "false"]);
    await act(async () => all.click());
    expect(rowChecks().every(box => !box.checked)).toBe(true);
  });

  it("keeps the saved snapshot visible, and apart from the proposal, when the catalogue model is unavailable", async () => {
    modelByCode = vi.fn(async () => null);
    await mount(); await open(0);
    const text = scheda().textContent ?? "";
    expect(text).toContain("ACC-A");
    expect(text).toContain("Distinta/accessori salvati (progetto)");
    expect(text).not.toContain("Distinta proposta");
    expect(button("Applica modifiche")!.disabled).toBe(true);
    expect(projectApi.replaceConfiguredItem).not.toHaveBeenCalled();
  });

  it("edits an unplaced item with the existing replacement API, labelling the new resolution as a proposal", async () => {
    await mount(); await open(0);
    const select = host.querySelector<HTMLSelectElement>(".catalogue-scheda-slot select")!;
    await act(async () => { select.value = "72"; select.dispatchEvent(new Event("change", { bubbles: true })); }); await flush();
    const text = scheda().textContent ?? "";
    expect(text).toContain("Distinta proposta (configurazione corrente)");
    expect(text).toContain("ART-B");
    expect(host.querySelector(".saved-item-snapshot")?.textContent).toContain("ACC-A");
    expect(button("Applica modifiche")!.disabled).toBe(false);
    await act(async () => button("Applica modifiche")!.click()); await flush();
    expect(projectApi.replaceConfiguredItem).toHaveBeenCalledWith("line-a", { modelId: 7, selectedOptionIds: [72] });
  });

  it("refuses to reconfigure a placed item and never calls the replacement API", async () => {
    await mount(); await open(1);
    expect(scheda().textContent).toContain("Posizionato in Progettazione: rimuovi prima la posizione");
    expect(scheda().textContent).toContain("ACC-B");
    expect(button("Applica modifiche")!.disabled).toBe(true);
    await act(async () => button("Applica modifiche")!.click());
    expect(projectApi.replaceConfiguredItem).not.toHaveBeenCalled();
  });
});

describe("Componenti del progetto quantities", () => {
  const field = (index = 0) => host.querySelectorAll<HTMLInputElement>(".project-component-quantity input")[index]!;

  it("commits through setQuantity on Enter and on ordinary blur", async () => {
    await mount();
    await act(async () => field().focus()); await type(field(), "3"); await key(field(), "Enter"); await flush();
    expect(projectApi.setQuantity).toHaveBeenLastCalledWith("line-a", 3);
    expect(field().value).toBe("3");
    await act(async () => field().focus()); await type(field(), "6"); await act(async () => field().blur()); await flush();
    expect(projectApi.setQuantity).toHaveBeenLastCalledWith("line-a", 6);
    expect(projectApi.setQuantity).toHaveBeenCalledTimes(2);
  });

  it("restores the saved quantity on Escape without calling setQuantity", async () => {
    await mount();
    await act(async () => field().focus()); await type(field(), "5"); await key(field(), "Escape"); await flush();
    expect(projectApi.setQuantity).not.toHaveBeenCalled();
    expect(field().value).toBe("2");
    await act(async () => field().focus()); await type(field(), "4"); await act(async () => field().blur()); await flush();
    expect(projectApi.setQuantity).toHaveBeenCalledWith("line-a", 4);
  });

  it("shows the saved quantity and the reason when the backend refuses the update", async () => {
    (projectApi.setQuantity as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Quantità non valida."));
    await mount();
    await act(async () => field().focus()); await type(field(), "7"); await key(field(), "Enter"); await flush();
    expect(projectApi.setQuantity).toHaveBeenCalledWith("line-a", 7);
    expect(field().value).toBe("2");
    expect(host.querySelector(".project-component-error")?.textContent).toBe("Quantità non valida.");
  });

  it("rejects a quantity below the placed units before calling the backend", async () => {
    expect(quantityError("0", 0)).toContain("quantità intera");
    expect(quantityError("2", 3)).toContain("3 unità posizionate");
    expect(quantityError("3", 3)).toBeNull();
    await mount();
    await act(async () => field(1).focus()); await type(field(1), "0"); await key(field(1), "Enter"); await flush();
    expect(projectApi.setQuantity).not.toHaveBeenCalled();
    expect(host.querySelector(".project-component-error")?.textContent).toContain("quantità intera");
  });
});

describe("Componenti del progetto bulk removal", () => {
  it("removes only the checked lines the backend permits and leaves placed lines alone", async () => {
    await mount();
    await act(async () => host.querySelector<HTMLInputElement>(".project-components-all input")!.click());
    const remove = button("Rimuovi selezionati")!;
    expect(remove.textContent).toBe("Rimuovi selezionati (2)");
    expect(host.querySelector(".project-components-note")?.textContent).toContain("1 riga posizionata non verrà rimossa");
    await act(async () => remove.click()); await flush();
    expect(projectApi.removeLines).toHaveBeenCalledWith(["line-a", "line-c"]);
    expect(rows().map(row => row.textContent)).toEqual([expect.stringContaining("Interruttore B")]);
    expect(rowChecks().map(box => box.checked)).toEqual([true]);
  });

  it("offers no removal when only placed lines are checked", async () => {
    await mount();
    await act(async () => rowChecks()[1]!.click());
    expect(button("Rimuovi selezionati")!.disabled).toBe(true);
    expect(projectApi.removeLines).not.toHaveBeenCalled();
  });
});

describe("Progettazione keeps its original right column", () => {
  it("shows Da posizionare above Proprietà and none of the Catalogo project-component panels", () => {
    const html = renderToStaticMarkup(<ProgettazioneScreen project={base} api={fakeProjectApi()}
      onProjectChange={() => undefined} />);
    expect(html.match(/<h3 id="design-pool-title">Da posizionare<\/h3>/g)).toHaveLength(1);
    expect(html.indexOf("design-pool-title")).toBeLessThan(html.indexOf("design-properties-title"));
    expect(html).toContain("Nessun oggetto selezionato.");
    for (const absent of ["Componenti del progetto", "project-components", "Seleziona tutti", "Attributi / Accessori",
      "project-component-inspector", "Distinta/accessori salvati"]) expect(html).not.toContain(absent);
  });
});

describe("Applica modifiche needs a genuine change", () => {
  const apply = () => button("Applica modifiche")!;
  const choose = async (value: string) => {
    const select = host.querySelector<HTMLSelectElement>(".catalogue-scheda-slot select")!;
    await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); }); await flush();
  };

  it("keeps Applica disabled for an unchanged item and explains why", async () => {
    await mount(); await open(0);
    expect(apply().disabled).toBe(true);
    expect(scheda().textContent).toContain("Modifica una scelta per applicare una nuova configurazione.");
    await act(async () => apply().click());
    expect(projectApi.replaceConfiguredItem).not.toHaveBeenCalled();
  });

  it("enables Applica after a change and disables it again when the original choice is restored", async () => {
    await mount(); await open(0);
    await choose("72");
    expect(apply().disabled).toBe(false);
    await choose("71");
    expect(apply().disabled).toBe(true);
    expect(scheda().textContent).toContain("Modifica una scelta");
    await choose("72");
    expect(apply().disabled).toBe(false);
    await act(async () => apply().click()); await flush();
    expect(projectApi.replaceConfiguredItem).toHaveBeenCalledTimes(1);
    expect(projectApi.replaceConfiguredItem).toHaveBeenCalledWith("line-a", { modelId: 7, selectedOptionIds: [72] });
  });

  it("never treats catalogue resolution drift alone as a change", async () => {
    const drifted = { ...configurationApi(), modelByCode, model: vi.fn(async () => model),
      resolve: vi.fn(async (request: ConfigurationRequest) => ({ ...result(request),
        bom: result({ ...request, selectedOptionIds: [72] }).bom, totalE4: 99999, fingerprint: "drifted" })) } as unknown as ConfigurationApi;
    const Drifted = () => <CatalogueScreen api={fakeCatalogueApi()} configurationApi={drifted} projectApi={projectApi}
      project={base} onProjectChange={() => undefined} view="manufacturer" onViewChange={() => undefined}
      activeLineUuid="line-a" onActiveLineChange={() => undefined} />;
    await act(async () => root.render(<Drifted />)); await flush();
    expect(scheda().textContent).toContain("ART-B");
    expect(scheda().textContent).toContain("ART-A");
    expect(apply().disabled).toBe(true);
  });

  it("compares the resolved choices with the first resolution", async () => {
    const api = { model: async () => model, resolve: async (request: ConfigurationRequest) => result(request) };
    let latest: Parameters<typeof configurationChanged>[0] = { result: null };
    const session = new ModelConfigurationSession(api, state => { latest = state; });
    session.select(7, undefined, [{ dimensionCode: "trip", valueCode: "A" }]);
    await vi.waitFor(() => expect(latest.baseline).toEqual([71]));
    expect(configurationChanged(latest)).toBe(false);
    session.choose(70, 72);
    await vi.waitFor(() => expect(configurationChanged(latest)).toBe(true));
    session.choose(70, 71);
    await vi.waitFor(() => expect(latest.result?.selectedOptionIds).toEqual([71]));
    expect(configurationChanged(latest)).toBe(false);
    expect(configurationChanged({ baseline: null, result: latest.result })).toBe(false);
  });

  it("leaves Aggiungi al progetto unaffected for a new configuration", async () => {
    const added = vi.fn();
    const api = { ...configurationApi(), productModels: vi.fn(async () => [model]) } as unknown as ConfigurationApi;
    await act(async () => root.render(<ArticleConfiguration api={api} product={{ id: 1 } as never} busy={false} canApply
      lead={null} quantity={{ kind: "new", value: "1", onChange: () => undefined }} onApply={added} />)); await flush();
    const add = button("Aggiungi al progetto")!;
    expect(add.disabled).toBe(false);
    await act(async () => add.click());
    expect(added).toHaveBeenCalledWith({ modelId: 7, productId: 1, selectedOptionIds: [] });
  });
});

describe("Catalogo configuration branch", () => {
  it.each([
    { branch: 2, expected: 8, single: false, failed: false },
    { branch: 1, expected: 7, single: false, failed: false },
    { branch: 2, expected: 8, single: true, failed: false },
    { branch: 2, expected: null, single: false, failed: true },
  ])("uses the branch model before adding ($branch, $single, $failed)", async ({ branch, expected, single, failed }) => {
    const catalogue = fakeCatalogueApi();
    const differential = { ...model, id: 8, name: "Magnetot. Diff." };
    const config = { ...configurationApi(),
      productModels: vi.fn(async () => (single ? [differential] : [model, differential]).map(entry => ({
        ...entry, preselectedOptionId: null,
      }))),
      model: vi.fn(async (id: number) => id === 8 ? differential : model),
    };
    catalogue.manufacturerNodes = async () => [
      { id: 1, parentId: null, name: "Magnetotermici" },
      { id: 2, parentId: null, name: "Magnetotermici differenziali" },
      { id: 3, parentId: 2, name: "Curva C" },
    ].map(node => ({ ...node, code: String(node.id), brandMarchio: "TEST", source: "import", kind: "level",
      levelCode: null, levelLabel: null, sortOrder: node.id, articleCount: 1, packageCount: 0 }));
    catalogue.manufacturerPositions = vi.fn(async () => {
      if (failed || single) throw new Error("Positions unavailable");
      return [{ nodeId: 1, modelId: 7, source: "import" }, { nodeId: 3, modelId: 8, source: "import" }] as const;
    });
    catalogue.browse = async () => ({ products: [{ id: 1, brandMarchio: "TEST", manufacturerCode: "ART-A",
      description: "Interruttore", isListed: true, configurable: true, attributes: [] } as never],
      totalCount: 1, offset: 0, hasMore: false, packages: [], packageCount: 0,
      facets: { brand: null, configurability: null, attributes: [] } });
    const addConfiguredItem = vi.fn(async () => base);
    await act(async () => root.render(<CatalogueScreen api={catalogue} configurationApi={config}
      projectApi={{ ...projectApi, addConfiguredItem }} project={base} onProjectChange={() => undefined}
      view="manufacturer" onViewChange={() => undefined} />));
    await act(async () => host.querySelector<HTMLButtonElement>(`[data-node-id="${branch}"]`)!.click());
    await act(async () => host.querySelector<HTMLButtonElement>(".catalogue-article")!.click());
    const add = button("Aggiungi al progetto")!;
    expect(add.disabled).toBe(failed);
    await act(async () => add.click());
    if (expected === null) {
      expect(scheda().textContent).toContain("Impossibile caricare i modelli");
      expect(addConfiguredItem).not.toHaveBeenCalled();
    } else {
      expect(addConfiguredItem).toHaveBeenCalledWith({ modelId: expected, productId: 1, selectedOptionIds: [] }, 1);
    }
    expect(catalogue.manufacturerPositions).toHaveBeenCalledTimes(single ? 0 : 1);
  });
});

describe("Pannelli and Carpenterie in the Catalogo Scheda", () => {
  const structural = (uuid: string, kind: "support" | "enclosure"): ProjectConfiguredItem =>
    ({ ...item(uuid, "A"), modelKind: kind, modelName: `${kind} ${uuid}`, modelCode: kind } as ProjectConfiguredItem);
  const withStructural = (kind: "support" | "enclosure", placed: boolean) => {
    const unit = structural(`item-${kind}`, kind);
    current = { ...base, configuredItems: [unit], lines: [itemLine(`line-${kind}`, unit.uuid, 1)],
      physicalNodes: placed ? [{ uuid: "n", itemUuid: unit.uuid, nodeKind: kind, children: [] }] : [] } as unknown as ProjectDocumentView;
    modelByCode = vi.fn(async () => ({ ...model, kind, code: kind }));
  };

  it.each(["support", "enclosure"] as const)("edits an unplaced %s through the existing replacement API", async kind => {
    withStructural(kind, false);
    await mount(); await open(0);
    expect(scheda().textContent).toContain("ACC-A");
    expect(scheda().textContent).not.toContain("Nessun modello configurabile");
    const select = host.querySelector<HTMLSelectElement>(".catalogue-scheda-slot select")!;
    await act(async () => { select.value = "72"; select.dispatchEvent(new Event("change", { bubbles: true })); }); await flush();
    expect(button("Applica modifiche")!.disabled).toBe(false);
    await act(async () => button("Applica modifiche")!.click()); await flush();
    expect(projectApi.replaceConfiguredItem).toHaveBeenCalledWith(`line-${kind}`, { modelId: 7, selectedOptionIds: [72] });
  });

  it.each(["support", "enclosure"] as const)("keeps a placed %s read-only and never replaces it", async kind => {
    withStructural(kind, true);
    await mount(); await open(0);
    expect(scheda().textContent).toContain("Posizionato in Progettazione: rimuovi prima la posizione");
    const select = host.querySelector<HTMLSelectElement>(".catalogue-scheda-slot select");
    if (select) await act(async () => { select.value = "72"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(button("Applica modifiche")!.disabled).toBe(true);
    await act(async () => button("Applica modifiche")!.click());
    expect(projectApi.replaceConfiguredItem).not.toHaveBeenCalled();
  });

  it("still keeps structural models out of the browsed-article configuration", async () => {
    const api = { ...configurationApi(), productModels: vi.fn(async () => [{ ...model, kind: "support" }]) } as unknown as ConfigurationApi;
    await act(async () => root.render(<ArticleConfiguration api={api} product={{ id: 1 } as never} busy={false} canApply
      lead={null} quantity={{ kind: "new", value: "1", onChange: () => undefined }} onApply={() => undefined} />)); await flush();
    expect(host.textContent).toContain("Nessun modello configurabile disponibile");
  });
});
