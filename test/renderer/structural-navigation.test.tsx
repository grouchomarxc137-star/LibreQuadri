/// <reference types="node" />
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HierarchyTree, initialExpanded, toggleExpanded } from "../../src/renderer/project/HierarchyTree.js";
import { PresetNotices, StructuralNavigator, StructuralWorkflow } from "../../src/renderer/project/StructuralWorkflow.js";
import { buildNavigationTree, currentNavigation, eligibleModelId, navigationNotice, contextUnavailableCount,
  StructuralNavigationSession, parsePannelloQuantity, structuralAddLabel, structuralAddRequest, submitStructuralAdd,
  type StructuralNavigationState } from "../../src/renderer/project/structural-navigation.js";
import type { ProjectApi, ProjectDocumentView, ProjectPhysicalNode, StructuralNavigation } from "../../src/shared/project.js";
import { fakeConfigurationApi, fakeProjectApi } from "./fake-api.js";

const model = (id: number, name: string, kind = "support") =>
  ({ id, code: `code-${id}`, name, kind, brandMarchio: "TEST", active: true, obsolete: false,
    commercialContribution:"articles" as const });
const navigation = (overrides: Partial<StructuralNavigation> = {}): StructuralNavigation => ({
  status: "ready", staleImportIds: [], contextDataUnavailable: 0,
  candidates: [model(10, "Model ten"), model(11, "Model eleven"), model(12, "Model twelve")],
  nodes: [
    { id: 1, parentId: null, name: "Section A", kind: "section", sortOrder: 0, modelIds: [] },
    { id: 2, parentId: 1, name: "Group one", kind: "level", sortOrder: 0, modelIds: [] },
    { id: 3, parentId: 2, name: "Family X", kind: "level", sortOrder: 0, modelIds: [10, 11] },
    { id: 4, parentId: 1, name: "Group two", kind: "level", sortOrder: 1, modelIds: [] },
    { id: 5, parentId: 4, name: "Family Y", kind: "level", sortOrder: 0, modelIds: [12] },
  ], ...overrides });
const loaded = (nav: StructuralNavigation, kind: "enclosure" | "support" = "support",
  parentUuid: string | undefined = "root-a"): StructuralNavigationState =>
  ({ phase: "loaded", kind, parentUuid, navigation: nav });
const all = new Set([1, 2, 3, 4, 5]);
const html = (state: StructuralNavigationState, expanded: ReadonlySet<number> = all,
  kind: "enclosure" | "support" = "support", modelId: number | null = null) =>
  renderToStaticMarkup(<StructuralNavigator kind={kind} state={state} expanded={expanded}
    onToggle={() => undefined} modelId={modelId} onSelect={() => undefined} />);
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("grouped structural navigation", () => {
  it("renders the backend hierarchy as a tree, not a flat global model list, in backend order", () => {
    for (const kind of ["enclosure", "support"] as const) {
      const markup = html(loaded(navigation(), kind, kind === "support" ? "root-a" : undefined), all, kind);
      expect(markup).toContain('role="tree"');
      expect(markup).not.toContain("<select");
      expect(markup).not.toContain("<option");
    }
    const markup = html(loaded(navigation()));
    const order = ["Section A", "Group one", "Family X", "Model ten", "Model eleven", "Group two", "Family Y", "Model twelve"]
      .map(text => markup.indexOf(text));
    expect(order.every(index => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(markup).toContain("TEST / code-10");
  });

  it("places each model under its own eligible branch", () => {
    const tree = buildNavigationTree(navigation());
    expect(tree).toHaveLength(1);
    const [one, two] = tree[0]!.children;
    expect(one!.label).toBe("Group one");
    expect(one!.children[0]!.leaves.map(leaf => leaf.label)).toEqual(["Model ten", "Model eleven"]);
    expect(two!.children[0]!.leaves.map(leaf => leaf.label)).toEqual(["Model twelve"]);
    expect(tree[0]!.leaves).toEqual([]);
    // A model id without an eligible candidate never becomes a leaf; a node with a missing parent is not shown.
    const partial = buildNavigationTree(navigation({ candidates: [model(10, "Model ten")],
      nodes: [...navigation().nodes, { id: 9, parentId: 99, name: "Orphan", kind: "level", sortOrder: 0, modelIds: [10] }] }));
    expect(JSON.stringify(partial)).not.toContain("Model eleven");
    expect(JSON.stringify(partial)).not.toContain("Orphan");
  });

  it("expands and collapses branches; only the top level starts open", () => {
    const tree = buildNavigationTree(navigation());
    const start = initialExpanded(tree);
    expect([...start]).toEqual([1]);
    const collapsedMarkup = html(loaded(navigation()), start);
    expect(collapsedMarkup).toContain("Group one");
    expect(collapsedMarkup).not.toContain("Model ten");
    const opened = toggleExpanded(toggleExpanded(start, 2), 3);
    expect(html(loaded(navigation()), opened)).toContain("Model ten");
    expect(html(loaded(navigation()), opened)).not.toContain("Model twelve");
    expect(toggleExpanded(opened, 3).has(3)).toBe(false);
    expect(html(loaded(navigation()), toggleExpanded(start, 1))).not.toContain("Group one");
    expect(renderToStaticMarkup(<HierarchyTree label="Test" tree={tree} expanded={start} onToggle={() => undefined}
      selectedLeaf={null} onSelectLeaf={() => undefined} />)).toContain('aria-expanded="true"');
    expect(html(loaded(navigation()), all, "support", 12)).toMatch(/aria-pressed="true"[^>]*><span class="hierarchy-name">Model twelve<\/span>/);
  });

  it("keeps long folder, model and article identities in single-line ellipsized tree rows", () => {
    const folder = "Famiglia carpenterie con identificazione tecnica molto lunga";
    const name = "Pannello componibile con nome di modello molto lungo";
    const code = "CODICE-ARTICOLO-TECNICO-ESTESO-123456789";
    const markup = html(loaded(navigation({ candidates: [{ ...model(10, name), code }], nodes: [
      { id: 1, parentId: null, name: folder, kind: "section", sortOrder: 0, modelIds: [10] },
    ] })));
    // The full text is revealed quickly by the Progettazione tooltip layer, not by the slow native title.
    expect(markup).toContain(`class="hierarchy-branch" data-full-text="${folder}"`);
    expect(markup).toContain(`<span class="hierarchy-name">${folder}</span>`);
    expect(markup).toContain(`data-full-text="${name} · TEST / ${code}"`);
    expect(markup).not.toContain("title=");
    expect(markup).toContain(`<span class="hierarchy-name">${name}</span><small>TEST / ${code}</small>`);
    const css = readFileSync("src/renderer/styles.css", "utf8");
    expect(css).toMatch(/\.hierarchy-tree \.hierarchy-name \{[^}]*overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/);
    expect(css).toMatch(/\.hierarchy-tree small \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis; white-space: nowrap;/);
  });

  it("requests Pannelli for the selected root, reloads on root change and ignores stale answers", async () => {
    const first = deferred<StructuralNavigation>();
    const second = deferred<StructuralNavigation>();
    const designNavigation = vi.fn((_kind: string, parentUuid?: string) =>
      parentUuid === "root-a" ? first.promise : second.promise);
    const states: StructuralNavigationState[] = [];
    const session = new StructuralNavigationSession({ designNavigation } as unknown as Pick<ProjectApi, "designNavigation">,
      state => states.push(state));
    session.load("support", "root-a");
    session.load("support", "root-b");
    expect(designNavigation.mock.calls).toEqual([["support", "root-a"], ["support", "root-b"]]);
    second.resolve(navigation({ candidates: [model(20, "Wide panel")], nodes: [
      { id: 1, parentId: null, name: "Section A", kind: "section", sortOrder: 0, modelIds: [20] }] }));
    await flush();
    first.resolve(navigation());
    await flush();
    expect(states.at(-1)).toMatchObject({ phase: "loaded", parentUuid: "root-b" });
    expect((states.at(-1) as { navigation: StructuralNavigation }).navigation.candidates.map(entry => entry.id)).toEqual([20]);
    session.load("enclosure", undefined);
    expect(designNavigation).toHaveBeenLastCalledWith("enclosure", undefined);
  });

  it("gives Pannelli an explicit state and never queries without a Carpenteria", async () => {
    const designNavigation = vi.fn();
    const states: StructuralNavigationState[] = [];
    new StructuralNavigationSession({ designNavigation } as unknown as Pick<ProjectApi, "designNavigation">,
      state => states.push(state)).load("support", undefined);
    expect(designNavigation).not.toHaveBeenCalled();
    expect(states).toEqual([{ phase: "no_root" }]);
    const markup = html({ phase: "no_root" });
    expect(markup).toContain("Seleziona prima una carpenteria");
    expect(markup).not.toContain('role="tree"');
    // Even a previously loaded hierarchy is not shown once the selection has no root.
    expect(currentNavigation(loaded(navigation()), "support", undefined)).toEqual({ phase: "no_root" });
  });

  it("shows only the models eligible for the selected root and drops a stale selection", () => {
    const rootA = loaded(navigation(), "support", "root-a");
    const rootB = loaded(navigation({ candidates: [model(12, "Model twelve")], nodes: [
      { id: 1, parentId: null, name: "Section A", kind: "section", sortOrder: 0, modelIds: [] },
      { id: 4, parentId: 1, name: "Group two", kind: "level", sortOrder: 1, modelIds: [] },
      { id: 5, parentId: 4, name: "Family Y", kind: "level", sortOrder: 0, modelIds: [12] }] }), "support", "root-b");
    expect(html(rootB)).not.toContain("Model ten");
    expect(html(rootB)).not.toContain("Group one");
    expect(html(rootB)).toContain("Model twelve");
    expect(eligibleModelId(rootA, "support", "root-a", 10)).toBe(10);
    // The selected root changed: the old answer is not current, and the new one does not offer model 10.
    expect(eligibleModelId(rootA, "support", "root-b", 10)).toBeNull();
    expect(currentNavigation(rootA, "support", "root-b")).toEqual({ phase: "loading" });
    expect(eligibleModelId(rootB, "support", "root-b", 10)).toBeNull();
    expect(eligibleModelId(rootB, "support", "root-b", 12)).toBe(12);
    // A selection is also dropped when data is stale, on a kind change, or without a selection.
    expect(eligibleModelId(loaded(navigation({ status: "engineering_data_stale", candidates: [], nodes: [] })),
      "support", "root-a", 10)).toBeNull();
    expect(eligibleModelId(rootA, "enclosure", undefined, 10)).toBeNull();
    expect(eligibleModelId(rootA, "support", "root-a", null)).toBeNull();
  });

  it("states stale, unavailable, empty, unverifiable and failing situations explicitly without any models", () => {
    const stale = html(loaded(navigation({ status: "engineering_data_stale", staleImportIds: [1], candidates: [], nodes: [] })));
    expect(stale).toContain("I dati di ingegneria sono obsoleti");
    expect(stale).toContain('role="alert"');
    expect(stale).not.toContain('role="tree"');
    const unavailable = html(loaded(navigation({ status: "container_unavailable", candidates: [], nodes: [] })));
    expect(unavailable).toContain("carpenteria selezionata non è disponibile");
    expect(html(loaded(navigation({ candidates: [], nodes: [] })))).toContain("Nessun pannello compatibile");
    expect(html(loaded(navigation({ candidates: [], nodes: [] }), "enclosure", undefined), all, "enclosure"))
      .toContain("Nessuna carpenteria disponibile");
    expect(html({ phase: "loading" })).toContain("Caricamento");
    const failed = renderToStaticMarkup(<StructuralNavigator kind="support" expanded={all} modelId={null}
      state={{ phase: "error", message: "boom" }} onToggle={() => undefined} onSelect={() => undefined}
      onRetry={() => undefined} />);
    expect(failed).toContain("boom");
    expect(failed).toContain("Riprova");
    expect(failed).not.toContain('role="tree"');
    const unverifiable = loaded(navigation({ contextDataUnavailable: 2 }));
    expect(contextUnavailableCount(unverifiable)).toBe(2);
    expect(html(unverifiable)).toContain("2 modelli non sono stati inclusi");
    expect(html(unverifiable)).toContain('role="tree"');
    expect(navigationNotice(loaded(navigation()), "support")).toBeNull();
    // A failed load is reported, then a new load can succeed.
    expect(contextUnavailableCount({ phase: "loading" })).toBe(0);
  });

  it("reports API failures from the session", async () => {
    const states: StructuralNavigationState[] = [];
    new StructuralNavigationSession({ designNavigation: () => Promise.reject(new Error("offline")) } as unknown as
      Pick<ProjectApi, "designNavigation">, state => states.push(state)).load("enclosure", undefined);
    await flush();
    expect(states).toEqual([{ phase: "loading" }, { phase: "error", message: "offline" }]);
  });
});

describe("structural add", () => {
  const configuration = { modelId: 2, selectedOptionIds: [3] };
  const project = { physicalNodes: [{ uuid: "old-root" }] } as unknown as ProjectDocumentView;

  it("labels Pannelli 'Aggiungi' and keeps the Carpenteria placement label", () => {
    expect(structuralAddLabel("support")).toBe("Aggiungi");
    expect(structuralAddLabel("support")).not.toContain("posiziona");
    expect(structuralAddLabel("enclosure")).toBe("Aggiungi e posiziona carpenteria");
  });

  it("adds a Pannello without placement and without any placement call", async () => {
    const updated = { physicalNodes: [{ uuid: "old-root" }] } as unknown as ProjectDocumentView;
    const addStructural = vi.fn(async () => updated);
    const result = await submitStructuralAdd({ addStructural }, project, "support", configuration, "root-a");
    expect(addStructural).toHaveBeenCalledOnce();
    expect(addStructural).toHaveBeenCalledWith({ configuration, kind: "support", parentUuid: "root-a", place: false });
    expect(result).toEqual({ project: updated, message: "Pannello aggiunto al progetto, non ancora posizionato." });
    expect(result.message).toContain("non ancora posizionato");
    await expect(submitStructuralAdd({ addStructural }, project, "support", configuration, undefined)).rejects.toThrow();
    expect(addStructural).toHaveBeenCalledOnce();
  });

  it("carries the Pannello quantity as the one add's quantity, only for an unplaced Pannello", async () => {
    expect(structuralAddRequest("support", configuration, "root-a", 7)).toEqual({ configuration, kind: "support", parentUuid: "root-a", place: false, quantity: 7 });
    expect("quantity" in structuralAddRequest("support", configuration, "root-a")).toBe(false);
    // Carpenterie and Apparecchi never carry a quantity, whatever is passed.
    expect(structuralAddRequest("enclosure", configuration, undefined, 7)).toEqual({ configuration, kind: "enclosure" });
    expect(structuralAddRequest("device", configuration, "panel", 7)).toEqual({ configuration, kind: "device", parentUuid: "panel", place: false });
    const updated = { physicalNodes: [] } as unknown as ProjectDocumentView;
    const addStructural = vi.fn(async () => updated);
    const many = await submitStructuralAdd({ addStructural }, project, "support", configuration, "root-a", 12);
    expect(addStructural).toHaveBeenCalledExactlyOnceWith({ configuration, kind: "support", parentUuid: "root-a", place: false, quantity: 12 });
    expect(many.message).toBe("12 pannelli aggiunti al progetto, non ancora posizionati.");
    const one = await submitStructuralAdd({ addStructural }, project, "support", configuration, "root-a", 1);
    expect(one.message).toBe("Pannello aggiunto al progetto, non ancora posizionato.");
    await submitStructuralAdd({ addStructural }, project, "device", configuration, "panel");
    expect(addStructural).toHaveBeenLastCalledWith({ configuration, kind: "device", parentUuid: "panel", place: false });
  });

  it("accepts only whole quantities from 1 to 99 in the Pannello quantity field", () => {
    for (const [text, value] of [["1", 1], ["7", 7], ["10", 10], ["99", 99], [" 12 ", 12], ["05", 5]] as const) expect(parsePannelloQuantity(text), text).toBe(value);
    for (const text of ["", " ", "0", "00", "100", "-1", "1.5", "1,5", "abc", "1e1", "+3", "٣", "999"]) expect(parsePannelloQuantity(text), text).toBeNull();
  });

  it("shows the quantity next to Aggiungi for Pannelli only, defaulting to 1, and blocks an invalid value", () => {
    const source = readFileSync("src/renderer/project/StructuralWorkflow.tsx", "utf8");
    expect(source).toMatch(/useState\("1"\)/);
    expect(source).toMatch(/kind==="support"\?<label className="structural-quantity">/);
    expect(source).toMatch(/min=\{STRUCTURAL_ADD_QUANTITY_MIN\} max=\{STRUCTURAL_ADD_QUANTITY_MAX\}/);
    expect(source).toMatch(/\(kind==="support"&&quantity===null\)\} onClick=\{\(\)=>void add\(\)\}/);
    expect(source).toMatch(/if\(kind==="support"&&quantity===null\)return;/);
    // The quantity travels only for a Pannello, then the field returns to 1.
    expect(source).toMatch(/kind==="support"\?quantity\?\?undefined:undefined/);
    expect(source).toMatch(/setQuantityText\("1"\);/);
    expect(source).not.toMatch(/kind==="device"[^;\n]*quantity/i);
  });

  it("keeps the Carpenteria request and immediate placement unchanged", async () => {
    expect(structuralAddRequest("enclosure", configuration, undefined)).toEqual({ configuration, kind: "enclosure" });
    expect("place" in structuralAddRequest("enclosure", configuration, undefined)).toBe(false);
    const created = { uuid: "new-root" } as ProjectPhysicalNode;
    const updated = { physicalNodes: [{ uuid: "old-root" }, created] } as unknown as ProjectDocumentView;
    const addStructural = vi.fn(async () => updated);
    const result = await submitStructuralAdd({ addStructural }, project, "enclosure", configuration, undefined);
    expect(addStructural).toHaveBeenCalledWith({ configuration, kind: "enclosure" });
    expect(result.createdRootUuid).toBe("new-root");
  });

  it("renders the workflow shell with the section switch and no flat model selector", () => {
    const markup = renderToStaticMarkup(<StructuralWorkflow project={{ physicalNodes: [], configuredItems: [],
      metadata: { uuid: "p" } } as unknown as ProjectDocumentView} api={fakeProjectApi()}
      configurationApi={fakeConfigurationApi()} root={undefined} onProjectChange={() => undefined}
      onRootCreated={() => undefined} />);
    expect(markup).toContain("Carpenterie");
    expect(markup).toContain("Pannelli");
    expect(markup).toContain("Apparecchi");
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("Aggiungi e posiziona pannello");
    // A docked "Struttura" panel with a reload action and a three-segment switch.
    expect(markup).toContain('<h3 id="design-structure-title">Struttura</h3>');
    expect(markup).toContain('aria-label="Ricarica la navigazione strutturale"');
    expect(markup).toMatch(/<div class="segmented" role="group" aria-label="Sezione strutturale"><button type="button" aria-pressed="true">Carpenterie<\/button><button type="button" aria-pressed="false">Pannelli<\/button><button type="button" aria-pressed="false">Apparecchi<\/button><\/div>/);
  });

  it("has no Carpenteria selector of its own when the project has several Carpenterie", () => {
    const markup = renderToStaticMarkup(<StructuralWorkflow project={{ physicalNodes: [
      { uuid: "root-a", itemUuid: "box" }, { uuid: "root-b", itemUuid: "box" }], configuredItems: [{ uuid: "box", modelName: "Box A" }],
      metadata: { uuid: "p" } } as unknown as ProjectDocumentView} api={fakeProjectApi()}
      configurationApi={fakeConfigurationApi()} root={{ uuid: "root-a", itemUuid: "box" } as ProjectPhysicalNode}
      onProjectChange={() => undefined} onRootCreated={() => undefined} />);
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("Involucro selezionato");
  });

  it("keeps manufacturer and source vocabulary out of the generic navigation renderer", () => {
    for (const file of ["HierarchyTree.tsx", "StructuralWorkflow.tsx", "structural-navigation.ts"]) {
      const source = readFileSync(`src/renderer/project/${file}`, "utf8");
      expect(source).not.toMatch(/BTicino|TiQuadri|BTI|Legrand|\btq\.|MDX|Btdin|Megatiker|gamma|armadi/i);
      expect(source).not.toContain("designDiscover");
    }
  });
});


describe("preset creation notices",()=>{
  it("shows backend withholding reasons without hiding successful structure",()=>{
    const project={presetDiagnostics:[{seq:1,modelCode:"window",status:"instantiated",code:"created",message:"Created"},
      {seq:2,modelCode:"configurable",modelName:"Configurable panel",status:"withheld",code:"preset_configuration_unresolved",message:"Choose an option",
        issues:[{severity:"error",code:"missing_required",message:"Required axis"}]}]} satisfies Pick<ProjectDocumentView,"presetDiagnostics">;
    const markup=renderToStaticMarkup(<PresetNotices project={project}/>);
    expect(markup).toContain("Configurable panel (2): Choose an option");
    expect(markup).toContain("Required axis");
    expect(markup).not.toContain("window");
  });
});
