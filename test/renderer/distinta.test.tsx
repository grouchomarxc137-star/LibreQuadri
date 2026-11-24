import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppFrame } from "../../src/renderer/app/App.js";
import { DistintaContent } from "../../src/renderer/app/DistintaWorkspace.js";
import { initialShellState, shellReducer } from "../../src/renderer/app/shell-state.js";
import { initialStatusState, statusReducer, StatusStateContext } from "../../src/renderer/app/status.js";
import { StatusBar } from "../../src/renderer/app/StatusBar.js";
import {
  commonUnitQuantity, distintaOrigins, distintaStatusSegments, distintaTotals, filterDistinta, nextCodeOrder, sortDistinta, type CodeOrder,
} from "../../src/renderer/quotation/distinta-model.js";
import type { CatalogueOverview } from "../../src/shared/catalogue.js";
import type { ProjectConfiguredItem, ProjectDistintaRow, ProjectDocumentView, ProjectQuotationLine } from "../../src/shared/project.js";
import { fakeLqApi, openProject } from "./fake-api.js";

const row = (snapshotUuid: string, manufacturerCode: string, quantity: number, listPriceUnitE4: number | null,
  description: string | null = `Descrizione ${manufacturerCode}`, brandMarchio = "BTI"): ProjectDistintaRow => ({
  snapshotUuid, brandMarchio, manufacturerCode, description, unitOfMeasure: "PCE", quantity, listPriceUnitE4,
  listTotalE4: listPriceUnitE4 === null ? null : listPriceUnitE4 * quantity,
});

const productLine = (uuid: string, snapshotUuid: string, quantity: number): ProjectQuotationLine => ({
  lineType: "product", uuid, snapshotUuid, itemUuid: null, brandMarchio: "BTI", manufacturerCode: "X", description: null,
  unitOfMeasure: "PCE", quantity, unitListPriceE4: null, lineTotalE4: null, currency: "EUR",
});
const itemLine = (uuid: string, itemUuid: string, quantity: number): ProjectQuotationLine =>
  ({ ...productLine(uuid, "", quantity), lineType: "item", snapshotUuid: null, itemUuid });
const configuredItem = (uuid: string, bom: readonly [string, number][]): ProjectConfiguredItem => ({
  uuid, bom: bom.map(([snapshotUuid, quantityPerItem]) => ({ snapshotUuid, quantityPerItem, brandMarchio: "BTI",
    manufacturerCode: "X", description: null, role: "component", listPriceUnitE4: null, salePriceUnitE4: null })),
}) as unknown as ProjectConfiguredItem;

/*
 * s1 FN81B16: 2 ordinary + (2 configured lines × 3) = 8 (mixed) · s2 NO-PRICE: 1 ordinary, no price
 * s3 CFG-100: configured only, 2 × 1 = 2 · Totals: 8 × 50,80 + 2 × 12,50 = 431,40 €; 11 pieces.
 */
const mixedProject: ProjectDocumentView = {
  ...openProject,
  lines: [productLine("l1", "s1", 2), productLine("l2", "s2", 1), itemLine("l3", "i1", 2)],
  configuredItems: [configuredItem("i1", [["s1", 3], ["s3", 1]])],
  distinta: [row("s1", "FN81B16", 8, 508_000), row("s2", "NO-PRICE", 1, null), row("s3", "CFG-100", 2, 125_000)],
};

function content(project: ProjectDocumentView, props: { filter?: string; order?: CodeOrder; selectedUuid?: string | null } = {}): string {
  return renderToStaticMarkup(<DistintaContent project={project} filter={props.filter ?? ""} onFilter={() => undefined}
    order={props.order ?? "none"} onOrder={() => undefined} selectedUuid={props.selectedUuid ?? null} onSelect={() => undefined} />);
}
const rowsOf = (html: string) => [...html.matchAll(/<tr [^>]*aria-selected[^>]*>/g)].length;

describe("Distinta header, columns and counts", () => {
  it("counts articles and pieces in the heading", () => {
    const html = content(mixedProject);
    expect(html).toContain("<h2 id=\"distinta-title\">Distinta materiali</h2>");
    expect(html).toContain("3 articoli · 11 pezzi");
    expect(content({ ...mixedProject, distinta: [row("s1", "A", 1, 100)] })).toContain("1 articolo · 1 pezzo");
    expect(distintaTotals(mixedProject.distinta)).toMatchObject({ articles: 3, pieces: 11, priced: 2, unpriced: 1 });
  });

  it("shows the eight columns in the approved order", () => {
    const head = content(mixedProject).match(/<thead>.*<\/thead>/s)![0];
    const labels = [...head.matchAll(/<th [^>]*>(.*?)<\/th>/gs)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));
    expect(labels).toEqual(["#", "Marca", "Codice", "Descrizione", "UM", "Quantità", "Prezzo di listino", "Totale di listino"]);
    expect(content(mixedProject)).toContain("<td class=\"numeric distinta-index\">1</td>");
  });

  it("shows the document entry and list-price note", () => {
    const html = content(mixedProject);
    expect(html).toContain("Prezzi di listino, senza sconti né ricarichi");
    expect(html).toContain("Documenti PDF</button>");
  });

  it("truncates technical text with a title carrying the full value", () => {
    const long = "btdin60 - magnetotermico differenziale 2P C 16A 30mA tipo AC con contatti ausiliari";
    const html = content({ ...mixedProject, distinta: [row("s1", "FN81B16-VERY-LONG-CODE", 1, 100, long)] });
    expect(html).toContain(`<td class="distinta-cell-text" title="${long}">${long}</td>`);
    expect(html).toContain('<td class="distinta-cell-text distinta-code" title="FN81B16-VERY-LONG-CODE">');
    expect(html).toContain('<td class="distinta-cell-text" title="BTI">BTI</td>');
  });
});

/** A row with an explicit unit of measure. */
const rowIn = (uuid: string, code: string, quantity: number, unit: string | null): ProjectDistintaRow =>
  ({ ...row(uuid, code, quantity, 1_000), unitOfMeasure: unit });
const withRows = (distinta: readonly ProjectDistintaRow[]): ProjectDocumentView => ({ ...openProject, distinta });
const tfoot = (html: string) => html.match(/<tfoot>.*<\/tfoot>/s)?.[0] ?? "";
const countText = (html: string) => html.match(/<span class="distinta-count"[^>]*>(.*?)<\/span>/s)![1]!.replace(/<[^>]+>/g, "");
const statusFor = (rows: readonly ProjectDistintaRow[]) => distintaStatusSegments(distintaTotals(rows)).map((s) => `${s.label} ${s.value}${s.unit ? ` ${s.unit}` : ""}`);

describe("Distinta quantities and units of measure (pieces are only PCE)", () => {
  it("counts pezzi when every article is sold in PCE, in the header, footer and status bar", () => {
    const rows = [rowIn("a", "A", 4, "PCE"), rowIn("b", "B", 3, "pce"), rowIn("c", "C", 2, " PCE ")];
    const html = content(withRows(rows));
    expect(distintaTotals(rows)).toMatchObject({ pieces: 9, pieceArticles: 3, otherUnitArticles: 0 });
    expect(countText(html)).toBe("3 articoli · 9 pezzi");
    expect(html).not.toContain("altre UM");
    expect(tfoot(html)).toContain('<td class="numeric">9</td>');
    expect(statusFor(rows)).toContain("Pezzi: 9");
  });

  it("never adds metres to pieces: 10 LM + 3 PCE is 3 pezzi plus other units", () => {
    const rows = [rowIn("a", "CABLE", 10, "LM"), rowIn("b", "MCB", 3, "PCE")];
    expect(distintaTotals(rows)).toMatchObject({ pieces: 3, pieceArticles: 1, otherUnitArticles: 1 });
    const html = content(withRows(rows));
    expect(countText(html)).toBe("2 articoli · 3 pezzi + altre UM");
    expect(countText(html)).not.toContain("13");
    expect(html).toContain('class="distinta-count" title="Solo gli articoli in PCE');
    // The footer has no cross-unit quantity total.
    expect(tfoot(html)).toContain('<td class="numeric" title="Quantità in unità di misura diverse: non si sommano"></td>');
    expect(tfoot(html)).not.toContain(">13<");
    expect(statusFor(rows)).toContain("Pezzi: 3 + altre UM");
  });

  it("does not present non-piece-only quantities as pezzi, but totals a single common unit in the footer", () => {
    const rows = [rowIn("a", "CABLE-A", 10, "LM"), rowIn("b", "CABLE-B", 5, "LM")];
    expect(distintaTotals(rows)).toMatchObject({ pieces: 0, pieceArticles: 0, otherUnitArticles: 2 });
    const html = content(withRows(rows));
    expect(countText(html)).toBe("2 articoli · quantità in altre UM");
    expect(countText(html)).not.toContain("pezz");
    expect(tfoot(html)).toContain('<td class="numeric">15 LM</td>');
    expect(statusFor(rows).some((segment) => segment.startsWith("Pezzi"))).toBe(false);
    expect(statusFor(rows)).toContain("Articoli: 2");
  });

  it("treats a missing or unknown UM as not provably pieces", () => {
    for (const unit of [null, "", "  ", "BRD", "XYZ"]) {
      const rows = [rowIn("a", "A", 7, unit)];
      expect(distintaTotals(rows)).toMatchObject({ pieces: 0, pieceArticles: 0, otherUnitArticles: 1 });
      const html = content(withRows(rows));
      expect(countText(html)).toBe("1 articolo · quantità in altre UM");
      expect(countText(html)).not.toContain("pezz");
    }
    // Rows with no unit have no quantity total either.
    expect(commonUnitQuantity([rowIn("a", "A", 7, null), rowIn("b", "B", 1, null)])).toBeNull();
    expect(tfoot(content(withRows([rowIn("a", "A", 7, null)])))).toContain('title="Quantità in unità di misura diverse: non si sommano"></td>');
    // A piece article with an unknown one: pieces count only the PCE row.
    expect(countText(content(withRows([rowIn("a", "A", 7, null), rowIn("b", "B", 2, "PCE")])))).toBe("2 articoli · 2 pezzi + altre UM");
  });

  it("keeps a plain empty Distinta at 0 pezzi with no footer quantity", () => {
    const html = content(withRows([]));
    expect(countText(html)).toBe("0 articoli · 0 pezzi");
    expect(html).not.toContain("<tfoot>");
    expect(statusFor([])).toContain("Pezzi: 0");
    expect(commonUnitQuantity([])).toBeNull();
  });

  it("applies the same rule to a filtered footer subtotal", () => {
    const project = withRows([rowIn("a", "CABLE", 10, "LM"), rowIn("b", "MCB", 3, "PCE"), rowIn("c", "MCB2", 2, "PCE")]);
    const filtered = content(project, { filter: "MCB" });
    expect(tfoot(filtered)).toContain('<td class="numeric">5</td>');
    expect(countText(filtered)).toBe("3 articoli · 5 pezzi + altre UM");
    expect(tfoot(content(project, { filter: "CABLE" }))).toContain('<td class="numeric">10 LM</td>');
  });
});

describe("Distinta totals and prices", () => {
  it("uses only the persisted row totals and shows the sticky total row", () => {
    const html = content(mixedProject);
    expect(distintaTotals(mixedProject.distinta).totalE4).toBe(4_314_000);
    expect(html).toContain("50,80 €");
    expect(html).toContain("406,40 €");
    expect(html).toContain("12,50 €");
    expect(html).toContain("25,00 €");
    const footer = html.match(/<tfoot>.*<\/tfoot>/s)![0];
    expect(footer).toContain("Totale di listino");
    expect(footer).toContain("431,40 €");
    expect(footer).toContain(">11</td>");
    expect(footer).toContain("parziale");
  });

  it("does not recompute a total from the unit price", () => {
    // A persisted total that differs from unit × quantity is shown as stored (semantics are the backend's).
    const odd = { ...row("s1", "A", 3, 100), listTotalE4: 999_000 };
    expect(distintaTotals([odd]).totalE4).toBe(999_000);
    expect(content({ ...mixedProject, distinta: [odd] })).toContain("99,90 €");
  });

  it("marks an article without a price with the warning tag and row tint, once per row", () => {
    const html = content(mixedProject);
    expect(html.match(/Prezzo non disponibile/g)).toHaveLength(1);
    expect(html).toContain('<span class="librequadri-tag" data-tone="warn">Prezzo non disponibile</span>');
    expect(html).toMatch(/<tr class="is-unpriced"(?:(?!<\/tr>).)*NO-PRICE(?:(?!<\/tr>).)*<td colSpan="2" class="numeric distinta-price-missing">/s);
    expect(rowsOf(html)).toBe(3);
    expect(html.match(/is-unpriced/g)).toHaveLength(1);
  });

  it("reports no total when no article has a price", () => {
    const none = { ...mixedProject, distinta: [row("s2", "NO-PRICE", 1, null)] };
    expect(distintaTotals(none.distinta).totalE4).toBeNull();
    const html = content(none);
    expect(html).toContain("0 di 1 articolo con prezzo");
    expect(html).toContain("Non disponibile");
    expect(html).not.toContain("0,00 €");
  });

  it("treats a sum outside the safe integer range as unavailable instead of throwing", () => {
    const huge = [{ ...row("a", "A", 1, 1), listTotalE4: Number.MAX_SAFE_INTEGER }, { ...row("b", "B", 1, 1), listTotalE4: Number.MAX_SAFE_INTEGER }];
    expect(distintaTotals(huge).totalE4).toBeNull();
  });
});

describe("Distinta filter", () => {
  const rows = [row("s1", "FN81B16", 1, 100, "Magnetotermico 1P curva B"), row("s2", "GW12345", 1, 100, "Interruttore differenziale", "BTI"),
    row("s3", "ABB-77", 1, 100, "Contattore modulare", "ABB")];

  it("matches marca, codice and descrizione, ignoring case and accents, on every word", () => {
    expect(filterDistinta(rows, "").length).toBe(3);
    expect(filterDistinta(rows, "  ").length).toBe(3);
    expect(filterDistinta(rows, "fn81").map((r) => r.snapshotUuid)).toEqual(["s1"]);
    expect(filterDistinta(rows, "abb").map((r) => r.snapshotUuid)).toEqual(["s3"]);
    expect(filterDistinta(rows, "DIFFERENZIALE").map((r) => r.snapshotUuid)).toEqual(["s2"]);
    expect(filterDistinta(rows, "magnetotermico curva").map((r) => r.snapshotUuid)).toEqual(["s1"]);
    expect(filterDistinta(rows, "magnetotermico contattore")).toEqual([]);
    expect(filterDistinta([row("s4", "X", 1, 1, "Può funzionare")], "puo funzionare").length).toBe(1);
  });

  it("shows only matching rows and a filtered subtotal, while the summary stays project-wide", () => {
    const html = content(mixedProject, { filter: "FN81" });
    expect(rowsOf(html)).toBe(1);
    expect(html).not.toContain("CFG-100");
    const footer = html.match(/<tfoot>.*<\/tfoot>/s)![0];
    expect(footer).toContain("Totale righe filtrate · 1 di 3");
    expect(footer).toContain("406,40 €");
    expect(html).toContain('<p class="distinta-total">431,40 €</p>');
    expect(html).toContain("3 articoli · 11 pezzi");
    expect(html).toContain('value="FN81"');
  });

  it("explains an empty filter result and drops the total row", () => {
    const html = content(mixedProject, { filter: "zzz" });
    expect(html).toContain("Nessun articolo corrisponde al filtro.");
    expect(html).not.toContain("<tfoot>");
    expect(rowsOf(html)).toBe(0);
  });
});

describe("Distinta Codice ordering", () => {
  const rows = [row("u3", "FN10", 1, 1), row("u1", "FN2", 1, 1), row("u2", "FN2", 1, 1, "x", "ABB"), row("u4", "AAA", 1, 1)];
  const order = (o: CodeOrder) => sortDistinta(rows, o).map((r) => r.snapshotUuid);

  it("cycles original → crescente → decrescente → original", () => {
    expect(nextCodeOrder("none")).toBe("asc");
    expect(nextCodeOrder("asc")).toBe("desc");
    expect(nextCodeOrder("desc")).toBe("none");
  });

  it("sorts numerically by codice with a deterministic marca then UUID tie-break, without mutating the input", () => {
    const before = rows.map((r) => r.snapshotUuid);
    expect(order("none")).toEqual(before);
    expect(order("asc")).toEqual(["u4", "u2", "u1", "u3"]);
    expect(order("desc")).toEqual(["u3", "u1", "u2", "u4"]);
    expect(rows.map((r) => r.snapshotUuid)).toEqual(before);
    expect(sortDistinta([...rows].reverse(), "asc").map((r) => r.snapshotUuid)).toEqual(order("asc"));
  });

  it("renders the sorted rows and the sort state on the header", () => {
    const project = { ...mixedProject, distinta: [row("s1", "FN81B16", 8, 508_000), row("s2", "NO-PRICE", 1, null), row("s3", "CFG-100", 2, 125_000)] };
    const asc = content(project, { order: "asc" });
    expect(asc.indexOf("CFG-100")).toBeLessThan(asc.indexOf("FN81B16"));
    expect(asc.indexOf("FN81B16")).toBeLessThan(asc.indexOf("NO-PRICE"));
    expect(asc).toContain('aria-sort="ascending" data-sorted="asc"');
    const desc = content(project, { order: "desc" });
    expect(desc.indexOf("NO-PRICE")).toBeLessThan(desc.indexOf("CFG-100"));
    expect(desc).toContain('aria-sort="descending" data-sorted="desc"');
    const none = content(project);
    expect(none).toContain('aria-sort="none"');
    expect(none.indexOf("FN81B16")).toBeLessThan(none.indexOf("CFG-100"));
    // # follows the displayed order.
    expect(asc).toMatch(/distinta-index">1<\/td>(?:(?!<\/tr>).)*CFG-100/s);
  });
});

describe("Distinta selection", () => {
  it("marks the selected row and gives it the only tab stop", () => {
    const html = content(mixedProject, { selectedUuid: "s3" });
    expect(html.match(/is-selected/g)).toHaveLength(1);
    expect(html).toMatch(/<tr class="is-selected" aria-selected="true" tabindex="0"(?:(?!<\/tr>).)*CFG-100/s);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    // Without a selection the first row is the tab stop.
    expect(content(mixedProject).match(/aria-selected="false" tabindex="0"/g)).toHaveLength(1);
  });
});

describe("Distinta empty state", () => {
  it("renders an empty Distinta without a table body row list, filter enabled state or warnings", () => {
    const html = content({ ...mixedProject, lines: [], configuredItems: [], distinta: [] });
    expect(html).toContain("La distinta si compilerà con il preventivo.");
    expect(html).toContain("0 articoli · 0 pezzi");
    expect(html).toContain('<p class="distinta-total">0,00 €</p>');
    expect(html).toContain("0 di 0 articoli con prezzo");
    expect(html).not.toContain("distinta-warning");
    expect(html).not.toContain("<tfoot>");
    expect(html).toMatch(/<input type="search"[^>]*disabled=""/);
    expect(distintaTotals([])).toEqual({ articles: 0, pieces: 0, pieceArticles: 0, otherUnitArticles: 0, priced: 0, unpriced: 0, totalE4: 0 });
  });
});

describe("Riepilogo", () => {
  it("shows the total, price coverage and the missing-price warning", () => {
    const html = content(mixedProject);
    expect(html).toContain('<p class="distinta-total-label">Totale di listino</p>');
    expect(html).toContain('<p class="distinta-total">431,40 €</p>');
    expect(html).toContain('<p class="distinta-coverage">2 di 3 articoli con prezzo</p>');
    expect(html).toMatch(/class="distinta-warning" role="note">.*1 articolo non ha un prezzo di listino e non è compreso nel totale\./s);
    const two = content({ ...mixedProject, distinta: [row("a", "A", 1, null), row("b", "B", 1, null), row("c", "C", 1, 100)] });
    expect(two).toContain("2 articoli non hanno un prezzo di listino e non sono compresi nel totale.");
  });

  it("shows no warning when every article has a price", () => {
    const html = content({ ...mixedProject, distinta: [row("s1", "A", 1, 100), row("s3", "C", 1, 100)] });
    expect(html).toContain("2 di 2 articoli con prezzo");
    expect(html).not.toContain("distinta-warning");
  });

  it("lists the project metadata", () => {
    const html = content(mixedProject);
    expect(html).toContain(">Progetto</h3>");
    for (const expected of ["Quadro generale QG1", "QG1 Rossi.lqp · rev. 4", "Norma civile · CEI EN 60898", "M. Rossi", "24/09/2026", "Rossi Srl"])
      expect(html).toContain(`>${expected}</dd>`);
    expect(content({ ...mixedProject, metadata: { ...mixedProject.metadata, executor: "" } })).toContain("<dt>Esecutore</dt><dd>—</dd>");
  });
});

describe("Origine delle righe (only what the loaded project proves)", () => {
  it("counts righe preventivo by type from project.lines", () => {
    const origins = distintaOrigins(mixedProject);
    expect(origins.lines).toEqual({ total: 3, ordinary: 2, configured: 1 });
    const html = content(mixedProject);
    expect(html).toContain(">Origine delle righe</h3>");
    expect(html).toContain("<dt>Righe preventivo</dt><dd title=\"3\">3</dd>");
    expect(html).toContain("<dt>Ordinarie</dt><dd title=\"2\">2</dd>");
    expect(html).toContain("<dt>Configurate</dt><dd title=\"1\">1</dd>");
  });

  it("classifies each article by re-adding ordinary and configured BOM quantities", () => {
    const origins = distintaOrigins(mixedProject);
    expect(origins.byRow.get("s1")).toBe("mixed");        // 2 ordinary + 2 lines × 3 = 8
    expect(origins.byRow.get("s2")).toBe("ordinary");
    expect(origins.byRow.get("s3")).toBe("configured");   // 2 lines × 1 = 2
    expect(origins.articles).toEqual({ ordinary: 1, configured: 1, mixed: 1, unverified: 0 });
    const html = content(mixedProject);
    expect(html).toContain("<dt>Solo ordinari</dt><dd title=\"1\">1</dd>");
    expect(html).toContain("<dt>Da entrambi</dt><dd title=\"1\">1</dd>");
    expect(html).not.toContain("Non verificabili");
  });

  it("does not classify a row whose quantity the lines cannot explain", () => {
    const inconsistent: ProjectDocumentView = { ...mixedProject, distinta: [...mixedProject.distinta, row("s9", "ORPHAN", 4, 100), row("s1b", "WRONGQTY", 5, 100)],
      lines: [...mixedProject.lines, productLine("l9", "s1b", 2)] };
    const origins = distintaOrigins(inconsistent);
    expect(origins.byRow.get("s9")).toBe("unverified");
    expect(origins.byRow.get("s1b")).toBe("unverified");
    expect(origins.articles.unverified).toBe(2);
    expect(content(inconsistent)).toContain("<dt>Non verificabili</dt><dd title=\"2\">2</dd>");
  });

  it("ignores a configured line whose item is not in the project view", () => {
    const origins = distintaOrigins({ ...mixedProject, configuredItems: [] });
    expect(origins.lines.configured).toBe(1);
    expect(origins.byRow.get("s3")).toBe("unverified");
  });
});

describe("Distinta status bar segments", () => {
  const listino: CatalogueOverview = { productCount: 1, listedProductCount: 1, delistedProductCount: 0, classifiedProductCount: 1,
    unclassifiedProductCount: 0, listedClassifiedProductCount: 1, listedUnclassifiedProductCount: 0, brands: [],
    currentPriceLists: [{ issuerSigla: "BTI", listinoNumber: "2126", validFrom: "2026-04-01", importedAt: "2026-09-23T10:00:00.000Z", listedProductCount: 1 }] };

  it("publishes articoli, pezzi and the total, marking a partial total", () => {
    expect(distintaStatusSegments(distintaTotals(mixedProject.distinta))).toEqual([
      { id: "articles", label: "Articoli:", value: "3" },
      { id: "pieces", label: "Pezzi:", value: "11" },
      { id: "total", label: "Totale di listino:", value: "431,40 €", unit: "parziale",
        title: "1 articolo senza prezzo di listino non è compreso nel totale" },
    ]);
    const complete = distintaStatusSegments(distintaTotals([row("a", "A", 2, 100)]));
    expect(complete.at(-1)).toEqual({ id: "total", label: "Totale di listino:", value: "0,02 €" });
    expect(distintaStatusSegments(distintaTotals([])).at(-1)).toMatchObject({ value: "0,00 €" });
    expect(distintaStatusSegments(distintaTotals([row("a", "A", 2, null)])).at(-1)).toMatchObject({ value: "Non disponibile" });
  });

  it("shows the Distinta segments only for the Distinta source, followed by the current listino", () => {
    const segments = distintaStatusSegments(distintaTotals([row("a", "A", 2, 508_000)]));
    const state = statusReducer(initialStatusState, { type: "segments", source: "distinta", segments });
    const html = renderToStaticMarkup(<StatusStateContext.Provider value={state}><StatusBar overview={listino} source="distinta" /></StatusStateContext.Provider>);
    expect(html).toContain("<span>Articoli: <b>1</b></span>");
    expect(html).toContain("<span>Pezzi: <b>2</b></span>");
    expect(html).toContain("<span>Totale di listino: <b>101,60 €</b></span>");
    expect(html.indexOf("Totale di listino")).toBeLessThan(html.indexOf("Listino BTI n. 2126"));
    for (const other of ["design", "catalogue"]) {
      const elsewhere = renderToStaticMarkup(<StatusStateContext.Provider value={state}><StatusBar overview={listino} source={other} /></StatusStateContext.Provider>);
      expect(elsewhere).not.toContain("Totale di listino");
      expect(elsewhere).not.toContain("101,60");
    }
    expect(statusReducer(state, { type: "segments", source: "distinta", segments: null }).segments).toEqual({});
  });
});

describe("Distinta workspace structure", () => {
  it("is a docked pane whose workspace, table area and summary scroll inside themselves", () => {
    const shell = shellReducer(initialShellState, { type: "open-dialog", dialog: "distinta" });
    const html = renderToStaticMarkup(<AppFrame api={fakeLqApi()} project={mixedProject} shell={shell} dispatch={() => undefined}
      overview={null} recent={[]} busy={false} startError={null} onProjectChange={() => undefined} onOpenProject={() => undefined}
      onOpenRecent={() => undefined} onForgetRecent={() => undefined} onCreated={() => undefined} />);
    expect(html).toContain('role="dialog" aria-modal="true"');
    expect(html).toContain('<div class="distinta-editor">');
    expect(html).toContain('class="quotation-scroll"');
    expect(html).toContain('class="quotation-summary-body"');
  });

  it("is styled as a non-scrolling 320 px column layout with internal scrolling and sticky rows", () => {
    const css = readFileSync("src/renderer/styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.workspace-pane-docked \{ padding: 0; overflow: hidden; \}/);
    expect(css).toMatch(/\.distinta-workspace \{[^}]*grid-template-columns: minmax\(0, 1fr\) 320px;[^}]*height: 100%;[^}]*overflow: hidden;/);
    expect(css).toMatch(/\.distinta-scroll \{[^}]*flex: 1;[^}]*min-height: 0;[^}]*overflow: auto;/);
    expect(css).toMatch(/\.distinta-summary-body \{[^}]*min-height: 0;[^}]*overflow-y: auto;/);
    expect(css).toMatch(/\.distinta-table th \{[^}]*position: sticky;[^}]*top: 0;/);
    expect(css).toMatch(/\.distinta-table tfoot td \{[^}]*position: sticky;[^}]*bottom: 0;/);
    expect(css).toMatch(/\.distinta-table th, \.distinta-table td \{[^}]*height: 30px;/);
    expect(css).toMatch(/\.distinta-cell-text \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/);
    expect(css).not.toMatch(/\.distinta-workspace \{[^}]*max-width/);
  });
});
