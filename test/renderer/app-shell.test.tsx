import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppFrame, BrandedLoading, stateChangeMessage } from "../../src/renderer/app/App.js";
import { readFileSync } from "node:fs";
import { formatLastOpened, isMacPlatform, shortcutLabel } from "../../src/renderer/app/platform.js";
import { ProjectBar } from "../../src/renderer/app/ProjectBar.js";
import { initialShellState, shellReducer, type ShellAction, type ShellState } from "../../src/renderer/app/shell-state.js";
import { recentKeyAction, StartScreen } from "../../src/renderer/app/StartScreen.js";
import { initialStatusState, statusReducer, StatusStateContext, type StatusState } from "../../src/renderer/app/status.js";
import { listinoLabels, StatusBar } from "../../src/renderer/app/StatusBar.js";
import type { RecentProjectView } from "../../src/shared/app.js";
import type { CatalogueOverview } from "../../src/shared/catalogue.js";
import type { ProjectDocumentView } from "../../src/shared/project.js";
import { fakeLqApi, openProject } from "./fake-api.js";

const overview: CatalogueOverview = {
  productCount: 24_676, listedProductCount: 24_000, delistedProductCount: 676, classifiedProductCount: 872,
  unclassifiedProductCount: 23_804, listedClassifiedProductCount: 870, listedUnclassifiedProductCount: 23_130,
  brands: [], currentPriceLists: [{ issuerSigla: "BTI", listinoNumber: "2126", validFrom: "2026-04-01",
    importedAt: "2026-09-23T10:00:00.000Z", listedProductCount: 24_000 }],
};

const recent: RecentProjectView[] = [
  { id: "00000000-0000-4000-8000-000000000001", title: "Quadro generale QG1", documentName: "QG1 Rossi.lqp",
    folderLabel: "~/Documents/LibreQuadri", lastOpenedAt: "2026-09-24T09:42:00.000Z", available: true },
  { id: "00000000-0000-4000-8000-000000000002", title: "Ampliamento linea 3", documentName: "Linea3.lqp",
    folderLabel: "/Volumes/USB", lastOpenedAt: "2026-09-12T08:00:00.000Z", available: false },
];

function reduce(actions: readonly ShellAction[], state: ShellState = initialShellState): ShellState {
  return actions.reduce(shellReducer, state);
}

function frame(project: ProjectDocumentView | null, shell: ShellState = initialShellState, entries = recent): string {
  return renderToStaticMarkup(<AppFrame api={fakeLqApi()} project={project} shell={shell} dispatch={() => undefined}
    overview={overview} recent={entries} busy={false} startError={null}
    onProjectChange={() => undefined} onOpenProject={() => undefined} onOpenRecent={() => undefined}
    onForgetRecent={() => undefined} onCreated={() => undefined} />);
}

describe("application shell state", () => {
  it("opens in Apparecchi and switches structural modes through native commands", () => {
    expect(initialShellState.designSection).toBe("device");
    for (const [command, section] of [["design:devices", "device"], ["design:enclosures", "enclosure"], ["design:panels", "support"]] as const)
      expect(reduce([{ type: "command", command, projectOpen: true }]).designSection).toBe(section);
  });
  it("defaults to Auto on project open and preserves Libera while switching sections", () => {
    const libera = reduce([{ type: "placement-mode", mode: "free" }]);
    expect(initialShellState.placementMode).toBe("auto");
    expect(reduce([{ type: "design-section", section: "support" }], libera).placementMode).toBe("free");
    expect(reduce([{ type: "project-opened" }], libera).placementMode).toBe("auto");
  });
  it("ignores project commands without a project", () => {
    for (const command of ["design:devices", "design:panels", "document:distinta", "project:properties"] as const)
      expect(reduce([{ type: "command", command, projectOpen: false }])).toEqual(initialShellState);
    expect(reduce([{ type: "command", command: "project:new", projectOpen: false }]).dialog).toBe("new-project");
  });
  it("opens and closes the overlay without changing the selected design mode", () => {
    const state = reduce([{ type: "design-section", section: "support" }, { type: "command", command: "document:distinta", projectOpen: true }]);
    expect(state).toMatchObject({ designSection: "support", dialog: "distinta" });
    expect(reduce([{ type: "close-dialog" }], state)).toMatchObject({ designSection: "support", dialog: null });
  });
  it("opens an overlay line in Apparecchi and clears stale line selection", () => {
    const state = reduce([{ type: "open-dialog", dialog: "distinta" }, { type: "open-line", lineUuid: "line-1" }]);
    expect(state).toMatchObject({ designSection: "device", dialog: null, activeLineUuid: "line-1" });
    expect(reduce([{ type: "active-line", lineUuid: null }], state).activeLineUuid).toBeNull();
    expect(reduce([{ type: "project-opened" }], state)).toEqual(initialShellState);
    expect(reduce([{ type: "project-closed" }], state)).toEqual(initialShellState);
  });
  it("resets project-only dialogs but retains catalogue management dialogs", () => {
    expect(reduce([{ type: "open-dialog", dialog: "distinta" }, { type: "project-closed" }])).toEqual(initialShellState);
    expect(reduce([{ type: "open-dialog", dialog: "unclassified" }, { type: "project-closed" }]).dialog).toBe("unclassified");
  });
});

describe("start screen", () => {
  it("uses the text identity inside a compact centered splash card",()=>{
    const html=renderToStaticMarkup(<BrandedLoading/>);
    expect(html).toContain("LibreQuadri");
    expect(html).toContain("Configurazione e preventivazione di quadri elettrici");
    expect(html).not.toMatch(/<img|data:image|logo\.png/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/class="app-frame branded-loading"[^>]*><div class="branded-splash-card">/);
    const styles = readFileSync("src/renderer/styles.css", "utf8");
    expect(styles).toMatch(/\.branded-loading\s*\{[^}]*place-items:\s*center/);
    expect(styles).toMatch(/\.branded-splash-card\s*\{[^}]*max-width:\s*440px/);
  });
  it("is shown when no project is open, with New, Open and the recent projects", () => {
    const html = frame(null);
    expect(html).toContain('class="app-frame start-screen"');
    expect(html).toContain("Nuovo progetto…");
    expect(html).toContain("Apri…");
    expect(html).toContain("Progetti recenti");
    expect(html).toContain("Quadro generale QG1");
    expect(html).toContain("~/Documents/LibreQuadri");
    expect(html).toContain("Nessun progetto aperto");
    expect(html).toMatch(/id="open-distinta"[^>]*disabled=""/);
    expect(html).not.toMatch(/role="tab" aria-selected="true"/);
    expect(html).not.toContain("rev.");
    expect(html).toContain("<span>Catalogo: <b>24.676</b> articoli</span>");
    expect(html).toContain("Listino BTI n. 2126 · valido dal 01/04/2026");
    expect(html).toContain("Aggiorna listino…");
  });

  it("marks missing files and offers removal from the list only", () => {
    const html = frame(null);
    expect(html).toContain('class="recent-missing"');
    expect(html).toContain("file non trovato");
    expect(html).toContain("Rimuovi dall&#x27;elenco");
    expect(html).not.toMatch(/Elimina|Cancella file/);
  });

  it("invites the first project when there is no history, and shows loading and errors", () => {
    expect(frame(null, initialShellState, [])).toContain("Nessun progetto recente");
    const loading = renderToStaticMarkup(<StartScreen recent={null} overview={null} busy={false} error="Il file non si trova più."
      onNewProject={() => undefined} onOpenProject={() => undefined} onOpenRecent={() => undefined}
      onForgetRecent={() => undefined} onUpdateListino={() => undefined} onUnclassified={() => undefined} statusBar={null} />);
    expect(loading).toContain("Caricamento dei progetti recenti");
    expect(loading).toContain('role="alert"');
  });

  it("opens with Enter, removes with Delete and moves with the arrow keys", () => {
    expect(recentKeyAction("ArrowDown", 0, 3)).toEqual({ type: "move", index: 1 });
    expect(recentKeyAction("ArrowDown", 2, 3)).toEqual({ type: "move", index: 2 });
    expect(recentKeyAction("ArrowUp", 0, 3)).toEqual({ type: "move", index: 0 });
    expect(recentKeyAction("End", 0, 3)).toEqual({ type: "move", index: 2 });
    expect(recentKeyAction("Enter", 1, 3)).toEqual({ type: "open" });
    expect(recentKeyAction("Delete", 1, 3)).toEqual({ type: "forget" });
    expect(recentKeyAction("Backspace", 1, 3)).toEqual({ type: "forget" });
    expect(recentKeyAction("Enter", 0, 0)).toBeNull();
    expect(recentKeyAction("a", 0, 3)).toBeNull();
  });

  it("formats the last opening time compactly", () => {
    const now = new Date(2026, 8, 24, 15, 0);
    expect(formatLastOpened(new Date(2026, 8, 24, 11, 42).toISOString(), now)).toBe("oggi 11:42");
    expect(formatLastOpened(new Date(2026, 8, 23, 17, 5).toISOString(), now)).toBe("ieri 17:05");
    expect(formatLastOpened(new Date(2026, 8, 12, 8, 0).toISOString(), now)).toBe("12/09/2026");
  });
});

describe("project shell", () => {
  it("preserves project and document identity with one Distinta action", () => {
    const html = frame(openProject);
    for (const text of ["Quadro generale QG1", "CEI EN 60898", "Modificato", "QG1 Rossi.lqp", "rev. 4"]) expect(html).toContain(text);
    const bar = html.slice(html.indexOf('<header class="top-bar"'), html.indexOf("</header>"));
    expect(bar).toContain('id="open-distinta"');
    expect(bar).not.toMatch(/role="tab"|Catalogo|Progettazione|Preventivo/);
    expect(bar.indexOf('class="top-bar-actions"')).toBeGreaterThan(bar.indexOf('class="top-bar-document"'));
  });
  it("restores the original catalogue columns in Apparecchi while keeping the drawing mounted", () => {
    const html = frame(openProject);
    expect(html).toContain('aria-label="Progettazione"');
    expect(html).toContain('class="design-catalogue-navigation"');
    expect(html).toContain('class="design-catalogue-details"');
    expect(html).toContain('class="design-catalogue-results"');
    expect(html).toContain('class="design-front" hidden=""');
    expect(html).toContain('class="design-structural-docks" hidden=""');
    expect(html).toContain("Navigazione produttore");
    expect(html).toContain("Fronte Quadro");
    expect(html).not.toMatch(/id="workspace-(catalogue|quotation|distinta)"/);
    expect(html.indexOf('>Apparecchi</button>')).toBeLessThan(html.indexOf('>Carpenterie</button>'));
    expect(html.indexOf('>Carpenterie</button>')).toBeLessThan(html.indexOf('>Pannelli</button>'));
  });
  it("restores structural sidebars for Carpenterie and Pannelli", () => {
    for (const section of ["enclosure", "support"] as const) {
      const html = frame(openProject, reduce([{ type: "design-section", section }]));
      expect(html).toContain('class="design-catalogue-navigation" hidden=""');
      expect(html).toContain('class="design-structural-docks"');
      expect(html).toContain('class="design-catalogue-details" hidden=""');
      expect(html).toContain('class="design-properties-slot"');
    }
  });
  it("opens Distinta editors and print choices over the drawing", () => {
    const html = frame(openProject, reduce([{ type: "open-dialog", dialog: "distinta" }]));
    for (const text of ["Fronte Quadro", "Componenti del progetto", "Sconto globale", "Mostra prezzi", "Mostra sconti", "Anteprima PDF", "Salva PDF"]) expect(html).toContain(text);
    expect(html).toContain('role="dialog" aria-modal="true"');
    expect(html).not.toContain('<option value="preventivo"');
  });
  it("hides Modificato for a saved project", () => {
    expect(renderToStaticMarkup(<ProjectBar project={{ ...openProject, dirty: false }} />)).not.toContain("Modificato");
  });
  it("still opens project properties over the drawing", () => {
    expect(frame(openProject, reduce([{ type: "open-dialog", dialog: "properties" }]))).toContain("Proprietà progetto");
  });
});

describe("status bar and messages", () => {
  it("reports the current listino from catalogue data only", () => {
    expect(listinoLabels(overview)).toEqual(["Listino BTI n. 2126 · valido dal 01/04/2026"]);
    expect(listinoLabels(null)).toEqual([]);
    const empty = renderToStaticMarkup(<StatusBar showCatalogueSize
      overview={{ ...overview, productCount: 0, currentPriceLists: [] }} />);
    expect(empty).toContain("Catalogo vuoto");
    expect(empty).toContain('role="status" aria-live="polite"');
    expect(empty).toContain("Pronto.");
  });

  it("shows the latest operation and the active workspace's segments from the status provider", () => {
    const state: StatusState = { message: "Salvato QG1 Rossi.lqp.", tone: "ok", segments: {
      design: [{ id: "pool", label: "Da posizionare:", value: "2", unit: "pannelli" }],
      catalogue: [{ id: "scope", label: "BTDIN60" }],
    } };
    const html = renderToStaticMarkup(<StatusStateContext.Provider value={state}>
      <StatusBar overview={overview} source="design" /></StatusStateContext.Provider>);
    expect(html).toContain("Salvato QG1 Rossi.lqp.");
    expect(html).toContain('class="librequadri-icon status-ok"');
    expect(html).toContain("<span>Da posizionare: <b>2</b> pannelli</span>");
    expect(html).not.toContain("BTDIN60");
    expect(html.match(/role="status"/g)).toHaveLength(1);
    const neutral = renderToStaticMarkup(<StatusStateContext.Provider value={{ ...state, tone: "neutral" }}>
      <StatusBar overview={null} /></StatusStateContext.Provider>);
    expect(neutral).not.toContain("status-ok");
    expect(neutral).not.toContain("Da posizionare");
  });

  it("keeps the status state unchanged for repeated publications and withdraws segments", () => {
    const announced = statusReducer(initialStatusState, { type: "announce", message: "Aperto QG1 Rossi.lqp.", tone: "ok" });
    expect(announced).toMatchObject({ message: "Aperto QG1 Rossi.lqp.", tone: "ok" });
    expect(statusReducer(announced, { type: "announce", message: "Aperto QG1 Rossi.lqp.", tone: "ok" })).toBe(announced);
    const segments = [{ id: "zoom", label: "Zoom", value: "150%" }];
    const published = statusReducer(announced, { type: "segments", source: "design", segments });
    expect(published.segments.design).toEqual(segments);
    expect(statusReducer(published, { type: "segments", source: "design", segments: [{ ...segments[0]! }] })).toBe(published);
    const withdrawn = statusReducer(published, { type: "segments", source: "design", segments: null });
    expect(withdrawn.segments).toEqual({});
    expect(statusReducer(withdrawn, { type: "segments", source: "design", segments: null })).toBe(withdrawn);
  });

  it("describes native-menu changes", () => {
    expect(stateChangeMessage({ reason: "saved" }, openProject)).toBe("Salvato QG1 Rossi.lqp.");
    expect(stateChangeMessage({ reason: "opened" }, openProject)).toBe("Aperto QG1 Rossi.lqp.");
    expect(stateChangeMessage({ reason: "closed" }, null)).toBe("Progetto chiuso.");
    expect(stateChangeMessage({ reason: "recent" }, null)).toBeNull();
  });

  it("labels shortcuts for the platform", () => {
    expect(isMacPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(true);
    expect(isMacPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
    expect(shortcutLabel("N", true)).toBe("⌘N");
    expect(shortcutLabel("N", false)).toBe("Ctrl+N");
  });
});
