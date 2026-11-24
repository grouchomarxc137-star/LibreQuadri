import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProjectBar } from "../../src/renderer/app/ProjectBar.js";
import { calendarDaysAgo } from "../../src/renderer/app/platform.js";
import {
  filterRecent, groupRecent, neighbourOf, recentGroupOf, selectedRecentIndex, visibleRecent,
} from "../../src/renderer/app/recent-list.js";
import { StartCatalogue } from "../../src/renderer/app/StartCatalogue.js";
import { RecentProjectsPanel, resolveRecentKey, StartScreen } from "../../src/renderer/app/StartScreen.js";
import type { RecentProjectView } from "../../src/shared/app.js";
import type { CatalogueOverview } from "../../src/shared/catalogue.js";

/** 30 September 2026, 15:00 local time. */
const now = new Date(2026, 8, 30, 15, 0);
const at = (day: number, hour = 9, minute = 0, month = 8) => new Date(2026, month, day, hour, minute).toISOString();

function entry(n: number, title: string, documentName: string, folderLabel: string, lastOpenedAt: string, available = true): RecentProjectView {
  return { id: `00000000-0000-4000-8000-00000000000${n}`, title, documentName, folderLabel, lastOpenedAt, available };
}

// Deliberately not in date order within a group: input order is preserved inside a group.
const entries: readonly RecentProjectView[] = [
  entry(1, "Quadro generale QG1", "QG1 Rossi.lqp", "~/Documents/LibreQuadri", at(30, 11, 42)),
  entry(2, "Centrale termica", "Centrale.lqp", "~/Progetti/Bianchi", at(30, 8, 5)),
  entry(3, "Ampliamento linea 3", "Linea3.lqp", "/Volumes/USB", at(29, 17, 5), false),
  entry(4, "Cabina MT/BT", "Cabina.lqp", "~/Desktop", at(25)),
  entry(5, "Officina Ferrari", "Officina Ferrari.lqp", "~/Progetti/Ferrari", at(12)),
];

const overview: CatalogueOverview = {
  productCount: 24_676, listedProductCount: 24_000, delistedProductCount: 676, classifiedProductCount: 872,
  unclassifiedProductCount: 23_804, listedClassifiedProductCount: 870, listedUnclassifiedProductCount: 23_130,
  brands: [
    { marchio: "BTI", name: "BTI", productCount: 24_500, listedProductCount: 24_000 },
    { marchio: "LEG", name: "Legrand", productCount: 176, listedProductCount: 0 },
  ],
  currentPriceLists: [
    { issuerSigla: "BTI", listinoNumber: "2126", validFrom: "2026-04-01", importedAt: "2026-09-23T10:00:00.000Z", listedProductCount: 24_000 },
    { issuerSigla: "LEG", listinoNumber: "17", validFrom: "2026-01-15", importedAt: "2026-09-23T10:05:00.000Z", listedProductCount: 0 },
  ],
};

const noop = () => undefined;
const panel = (props: Partial<Parameters<typeof RecentProjectsPanel>[0]> = {}) => renderToStaticMarkup(
  <RecentProjectsPanel recent={entries} error={null} busy={false} now={now} onOpen={noop} onForget={noop} {...props} />);
const start = (props: Partial<Parameters<typeof StartScreen>[0]> = {}) => renderToStaticMarkup(
  <StartScreen recent={entries} overview={overview} busy={false} error={null} now={now} onNewProject={noop} onOpenProject={noop}
    onOpenRecent={noop} onForgetRecent={noop} onUpdateListino={noop} onUnclassified={noop}
    topBar={<ProjectBar project={null} />} statusBar={null} {...props} />);
const ids = (list: readonly RecentProjectView[]) => list.map((item) => item.id);
/** Row ids in the order the markup shows them. */
const renderedRows = (html: string) => [...html.matchAll(/<tr id="recent-([^"]+)"/g)].map((match) => match[1]!);

describe("recent grouping by lastOpenedAt", () => {
  it("draws the day boundaries on the local calendar", () => {
    expect(recentGroupOf(at(30, 0, 0), now)).toBe("today");
    expect(recentGroupOf(at(30, 23, 59), now)).toBe("today");
    expect(recentGroupOf(at(29, 23, 59), now)).toBe("yesterday");
    expect(recentGroupOf(at(29, 0, 0), now)).toBe("yesterday");
    expect(recentGroupOf(at(28, 23, 59), now)).toBe("week");
    expect(recentGroupOf(at(23, 0, 0), now)).toBe("week");
    expect(recentGroupOf(at(22, 23, 59), now)).toBe("older");
    expect(recentGroupOf(at(1, 12, 0, 0), now)).toBe("older");
  });

  it("puts a future or unreadable timestamp somewhere sensible", () => {
    expect(recentGroupOf(at(1, 9, 0, 9), now)).toBe("today");
    expect(recentGroupOf("not a date", now)).toBe("older");
    expect(calendarDaysAgo("not a date", now)).toBeNull();
  });

  it("groups in display order, drops empty groups and keeps the arrival order inside each", () => {
    const groups = groupRecent(entries, now);
    expect(groups.map((group) => group.label)).toEqual(["Oggi", "Ieri", "Ultimi 7 giorni", "Precedenti"]);
    expect(groups.map((group) => group.entries.length)).toEqual([2, 1, 1, 1]);
    expect(ids(groups[0]!.entries)).toEqual([entries[0]!.id, entries[1]!.id]);
    expect(groupRecent([entries[4]!, entries[0]!], now).map((group) => group.label)).toEqual(["Oggi", "Precedenti"]);
    expect(groupRecent([], now)).toEqual([]);
  });

  it("shows the group rows with their counts and the rows in the same order the keyboard walks", () => {
    const html = panel();
    expect(html).toContain('<th scope="rowgroup" colSpan="4">Oggi<span class="recent-group-count">2</span></th>');
    expect(html).toContain("Ieri<span");
    expect(html).toContain("Ultimi 7 giorni<span");
    expect(html).toContain("Precedenti<span");
    const shuffled = [entries[4]!, entries[2]!, entries[0]!, entries[3]!, entries[1]!];
    expect(renderedRows(panel({ recent: shuffled }))).toEqual(ids(visibleRecent(groupRecent(shuffled, now))));
    expect(ids(visibleRecent(groupRecent(shuffled, now)))).toEqual(
      [entries[0]!, entries[1]!, entries[2]!, entries[3]!, entries[4]!].map((item) => item.id));
  });
});

describe("recent filter", () => {
  it("matches the project title, the file name and the folder label only", () => {
    expect(ids(filterRecent(entries, "generale"))).toEqual([entries[0]!.id]);
    expect(ids(filterRecent(entries, "centrale.lqp"))).toEqual([entries[1]!.id]);
    expect(ids(filterRecent(entries, "Volumes"))).toEqual([entries[2]!.id]);
    expect(ids(filterRecent(entries, "~/progetti"))).toEqual([entries[1]!.id, entries[4]!.id]);
    // The entry id is not a searchable field, and nothing else reaches the filter.
    expect(filterRecent(entries, "00000000-0000")).toEqual([]);
    expect(filterRecent(entries, "/Users/")).toEqual([]);
  });

  it("ignores case, accents, surrounding spaces and requires every term", () => {
    expect(ids(filterRecent(entries, "  CENTRALE "))).toEqual([entries[1]!.id]);
    expect(ids(filterRecent([entry(6, "Officina più", "P.lqp", "~/x", at(30))], "piu"))).toHaveLength(1);
    expect(ids(filterRecent(entries, "progetti ferrari"))).toEqual([entries[4]!.id]);
    expect(ids(filterRecent(entries, "progetti rossi"))).toEqual([]);
    expect(filterRecent(entries, "   ")).toBe(entries);
  });

  it("shows only the matching rows, regrouped, with an 'x di y' count", () => {
    const html = panel({ initialFilter: "progetti" });
    expect(renderedRows(html)).toEqual([entries[1]!.id, entries[4]!.id]);
    expect(html).toContain('<span class="dock-count">2 di 5</span>');
    expect(html).toContain("Oggi<span");
    expect(html).toContain("Precedenti<span");
    expect(html).not.toContain("Ieri<span");
    expect(html).toContain('aria-label="Cancella il filtro"');
    expect(panel()).not.toContain("Cancella il filtro");
    expect(panel()).toContain('<span class="dock-count">5</span>');
  });

  it("says so when nothing matches, and keeps the filter usable", () => {
    const html = panel({ initialFilter: "zzz" });
    expect(html).toContain("Nessun progetto corrisponde a «zzz».");
    expect(html).not.toContain('role="grid"');
    expect(html).toContain('placeholder="Filtra per nome, file o cartella"');
    expect(html).toMatch(/<button type="button" class="recent-open" disabled="">Apri<\/button>/);
  });
});

describe("keyboard selection with a filtered list", () => {
  const visible = visibleRecent(groupRecent(filterRecent(entries, "progetti"), now)); // Centrale, Officina Ferrari

  it("starts on the first visible row when the selected project is filtered out", () => {
    expect(selectedRecentIndex(visible, entries[0]!.id)).toBe(0);
    expect(selectedRecentIndex(visible, null)).toBe(0);
    expect(selectedRecentIndex([], entries[0]!.id)).toBe(-1);
    const html = panel({ initialFilter: "progetti", initialSelectedId: entries[0]!.id });
    expect(html).toContain(`aria-activedescendant="recent-${entries[1]!.id}"`);
    expect(html).toMatch(new RegExp(`id="recent-${entries[1]!.id}" role="row" aria-selected="true"`));
    expect(html).toMatch(new RegExp(`id="recent-${entries[4]!.id}" role="row" aria-selected="false"`));
  });

  it("walks only the visible rows", () => {
    expect(resolveRecentKey(visible, null, "ArrowDown")).toEqual({ type: "select", id: entries[4]!.id });
    expect(resolveRecentKey(visible, entries[4]!.id, "ArrowDown")).toEqual({ type: "select", id: entries[4]!.id });
    expect(resolveRecentKey(visible, entries[4]!.id, "ArrowUp")).toEqual({ type: "select", id: entries[1]!.id });
    expect(resolveRecentKey(visible, entries[1]!.id, "End")).toEqual({ type: "select", id: entries[4]!.id });
    expect(resolveRecentKey(visible, entries[4]!.id, "Home")).toEqual({ type: "select", id: entries[1]!.id });
  });

  it("opens and removes the selected filtered entry, never a hidden one", () => {
    expect(resolveRecentKey(visible, entries[4]!.id, "Enter")).toEqual({ type: "open", entry: entries[4] });
    // The previous selection (QG1) is filtered out: Enter opens the highlighted first visible row.
    expect(resolveRecentKey(visible, entries[0]!.id, "Enter")).toEqual({ type: "open", entry: entries[1] });
    expect(resolveRecentKey(visible, entries[1]!.id, "Delete")).toEqual({ type: "forget", entry: entries[1], next: entries[4]!.id });
    expect(resolveRecentKey(visible, entries[4]!.id, "Backspace")).toEqual({ type: "forget", entry: entries[4], next: entries[1]!.id });
  });

  it("does nothing without rows or for other keys", () => {
    expect(resolveRecentKey([], null, "Enter")).toBeNull();
    expect(resolveRecentKey([], null, "Delete")).toBeNull();
    expect(resolveRecentKey(visible, entries[1]!.id, "a")).toBeNull();
  });

  it("moves the selection to the neighbour when a row is removed", () => {
    const all = visibleRecent(groupRecent(entries, now));
    expect(neighbourOf(all, all[1]!.id)).toBe(all[2]!.id);
    expect(neighbourOf(all, all[4]!.id)).toBe(all[3]!.id);
    expect(neighbourOf([all[0]!], all[0]!.id)).toBeNull();
    expect(neighbourOf(all, "unknown")).toBeNull();
  });
});

describe("recent rows", () => {
  it("uses the supplied clock for groups, row dates and the footer when the system date differs", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 9, 1, 15, 0));
      const html = panel();
      expect(html).toContain('data-group="today"');
      expect(html).toContain('<td class="recent-date">oggi 11:42</td>');
      expect(html).toContain('<td class="recent-date">ieri 17:05</td>');
      expect(html).toContain('title="QG1 Rossi.lqp · ~/Documents/LibreQuadri · oggi 11:42"');
      expect(html).toContain('<span class="recent-summary-date">· oggi 11:42</span>');
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a missing file with the warning tag and the muted row, and keeps opening possible", () => {
    const html = panel();
    expect(html).toContain('class="recent-missing"');
    expect(html).toContain('<span class="librequadri-tag" data-tone="warn">file non trovato</span>');
    expect(html.match(/file non trovato/g)).toHaveLength(1);
    expect(html).toContain("Rimuovi dall&#x27;elenco");
    expect(html).not.toMatch(/Elimina|Cancella file/);
  });

  it("selects the first row and summarises it in the footer as file · folder · opened", () => {
    const html = panel();
    expect(html).toMatch(new RegExp(`id="recent-${entries[0]!.id}" role="row" aria-selected="true"`));
    expect(html).toContain('<span class="recent-summary"');
    expect(html).toContain('<b>QG1 Rossi.lqp</b><span class="recent-summary-folder">· ~/Documents/LibreQuadri</span><span class="recent-summary-date">· oggi 11:42</span>');
    expect(html).toContain('aria-sort="descending"');
    for (const column of ["Progetto", "File", "Cartella"]) expect(html).toContain(`scope="col">${column}</th>`);
    expect(html).toContain('<span class="recent-sorted">Aperto<svg');
  });

  it("gives long technical names a tooltip for their ellipsis", () => {
    const html = panel();
    expect(html).toContain('class="recent-title" title="Quadro generale QG1"');
    expect(html).toContain('class="recent-file-name" title="QG1 Rossi.lqp"');
    expect(html).toContain('class="recent-folder" title="~/Documents/LibreQuadri"');
  });

  it("disables the row actions while busy", () => {
    const html = panel({ busy: true });
    expect(html).toMatch(/class="recent-open" disabled=""/);
    expect(html).toMatch(/disabled="">Rimuovi dall&#x27;elenco/);
  });

  it("does not show a path anywhere: only the display folder label reaches the markup", () => {
    expect(panel()).not.toMatch(/\/Users\//);
  });
});

describe("recent list states", () => {
  it("shows loading, empty and error states", () => {
    const loading = panel({ recent: null });
    expect(loading).toContain("Caricamento dei progetti recenti…");
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toMatch(/<input[^>]*disabled=""/);
    expect(loading).not.toContain('role="grid"');
    expect(loading).toContain('<span class="dock-count"></span>');

    const empty = panel({ recent: [] });
    expect(empty).toContain("Nessun progetto recente. I progetti che crei o apri compariranno qui.");
    expect(empty).toContain('<span class="dock-count">0</span>');
    expect(empty).toMatch(/class="recent-open" disabled=""/);
    expect(empty).not.toContain("recent-summary");

    const failed = panel({ recent: [], error: "Il file non si trova più." });
    expect(failed).toMatch(/<p class="start-error" role="alert">.*Il file non si trova più\.<\/p>/);
    expect(panel()).not.toContain('role="alert"');
  });
});

describe("start screen structure", () => {
  it("has the command band without a second branding header, one primary action and the two-column body", () => {
    const html = start();
    expect(html).toContain('class="start-band"');
    expect(html).toContain('class="top-bar-brand">LibreQuadri</span>');
    expect(html).not.toMatch(/<img|logo\.png/);
    expect(html).not.toContain("start-logo");
    expect(html).not.toContain("start-identity");
    expect(html).not.toContain("<h1");
    expect(html).toContain("Nessun progetto aperto");
    expect(html.indexOf('class="start-band"')).toBeLessThan(html.indexOf('class="start-body"'));
    // Nothing sits between the commands and the recent projects any more but the commands themselves.
    expect(html).toMatch(/<main class="start-main"><div class="start-band"><nav class="start-commands" aria-label="Progetto">/);
    const styles = readFileSync("src/renderer/styles.css", "utf8");
    expect(styles).not.toMatch(/\.start-logo|\.start-identity/);
    expect(html).toMatch(/class="primary"[^>]*>(?:(?!<\/button>).)*Nuovo progetto…(?:(?!<\/button>).)*<kbd>(⌘|Ctrl\+)N<\/kbd>/);
    expect(html).toMatch(/<button type="button"[^>]*>(?:(?!<\/button>).)*Apri…(?:(?!<\/button>).)*<kbd>(⌘|Ctrl\+)O<\/kbd>/);
    expect(html.match(/class="primary"/g)).toHaveLength(1);
    expect(html).toContain('class="start-recent"');
    expect(html).toContain('class="start-side"');
    expect(html.indexOf('class="start-recent"')).toBeLessThan(html.indexOf('class="start-side"'));
    expect(html).not.toMatch(/<h1[^>]*>[^<]*<\/h1>\s*<div class="start-body"/);
  });

  it("disables Nuovo and Apri while busy", () => {
    const html = start({ busy: true });
    expect(html).toMatch(/class="primary" disabled=""/);
  });

  it("keeps Distinta visible but disabled with no project", () => {
    const html = start();
    expect(html).toContain("Nessun progetto aperto");
    expect(html).toMatch(/id="open-distinta"[^>]*disabled=""/);
    expect(html).toContain("<span>Distinta</span>");
    expect(html).not.toMatch(/role="tab" aria-selected="true"/);
    expect(html).not.toMatch(/aria-controls="workspace-/);
  });
});

describe("Catalogo locale column", () => {
  const html = renderToStaticMarkup(<StartCatalogue overview={overview} onUpdateListino={noop} onUnclassified={noop} />);

  it("shows the local catalogue counts", () => {
    expect(html).toContain("Catalogo locale");
    expect(html).toContain("<dt>Articoli</dt><dd>24.676</dd>");
    expect(html).toContain("<dt>A listino</dt><dd>24.000</dd>");
    expect(html).toContain("<dt>Fuori listino</dt><dd>676</dd>");
    expect(html).toContain("<dt>Da classificare</dt><dd>23.804</dd>");
  });

  it("lists the installed listini and both catalogue actions", () => {
    expect(html).toContain("Listini installati");
    for (const column of ["Emittente", "Listino", "Valido dal", "Articoli"]) expect(html).toContain(`scope="col"${column === "Articoli" ? ' class="numeric"' : ""}>${column}</th>`);
    expect(html).toContain("n. 2126");
    expect(html).toContain("01/04/2026");
    expect(html).toContain('<td class="numeric">24.000</td>');
    expect(html).toContain("n. 17");
    expect(html).toContain("15/01/2026");
    expect(html).toContain("Aggiorna listino…");
    expect(html).toContain("Famiglie da classificare…");
  });

  it("lists the brands with their counts, and does not repeat a marchio as its own name", () => {
    expect(html).toContain("Marchi nel catalogo");
    for (const column of ["Marchio", "Nome", "Articoli", "A listino"]) expect(html).toContain(`>${column}</th>`);
    expect(html).toContain('<td class="start-code" title="BTI">BTI</td><td class="start-muted">—</td><td class="numeric">24.500</td><td class="numeric">24.000</td>');
    expect(html).toContain('<td title="Legrand">Legrand</td><td class="numeric">176</td><td class="numeric">0</td>');
  });

  it("ends with the keyboard hints", () => {
    expect(html).toContain('class="start-hints"');
    expect(html).toContain("<kbd>Invio</kbd> apre");
    expect(html).toContain("<kbd>Canc</kbd> rimuove dall&#x27;elenco");
    expect(html).toContain("seleziona");
    expect(html.indexOf("start-hints")).toBeGreaterThan(html.indexOf("Marchi nel catalogo"));
  });

  it("says what is missing instead of showing empty tables", () => {
    const unavailable = renderToStaticMarkup(<StartCatalogue overview={null} onUpdateListino={noop} onUnclassified={noop} />);
    expect(unavailable).toContain("Dati del catalogo non disponibili.");
    expect(unavailable).not.toContain("<dt>");
    expect(unavailable).toContain("Aggiorna listino…");
    const empty = renderToStaticMarkup(<StartCatalogue onUpdateListino={noop} onUnclassified={noop}
      overview={{ ...overview, productCount: 0, listedProductCount: 0, delistedProductCount: 0, unclassifiedProductCount: 0, brands: [], currentPriceLists: [] }} />);
    expect(empty).toContain("Nessun listino installato.");
    expect(empty).toContain("Nessun marchio nel catalogo.");
    expect(empty).toContain("<dt>Articoli</dt><dd>0</dd>");
  });
});
