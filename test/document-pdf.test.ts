import { describe, expect, it } from "vitest";
import { buildDocumentModel } from "../src/main/documents/document-model.js";
import { buildDocumentHtml } from "../src/main/documents/document-html.js";
import type { ProjectDocumentView } from "../src/shared/project.js";

const project = {
  metadata: { uuid: "secret-uuid", title: 'Quadro <Q1>', description: "Descrizione & progetto",
    notes: "NOTA INTERNA SEGRETA", projectType: "civil", normCode: "CEI EN 60898", executor: "Mario",
    date: "2026-10-01", companyName: 'Azienda <script>alert(1)</script>', companyDescription: "Sede & officina" },
  lines: [
    { lineType: "product", manufacturerCode: "A-1", description: "Interruttore & sezionatore", quantity: 2,
      unitListPriceE4: 100_000, lineTotalE4: 200_000 },
    { lineType: "item", itemUuid: "item-uuid", manufacturerCode: "tq.pack.123", description: "Configurazione cliente", quantity: 3,
      unitListPriceE4: 250_000, lineTotalE4: 750_000 },
    { lineType: "item", itemUuid: "without-primary", manufacturerCode: "tq.pack.456", description: "Configurazione senza base", quantity: 1,
      unitListPriceE4: null, lineTotalE4: null },
    { lineType: "item", itemUuid: "physical", commercialContribution: "none", manufacturerCode: "tq.pack.1778",
      description: "Solo spazio", quantity: 2, unitListPriceE4: null, lineTotalE4: null },
  ],
  configuredItems: [
    { uuid: "item-uuid", bom: [
      { seq:0, role: "primary", manufacturerCode: "FN81B16", description:"Prodotto configurato",quantityPerItem:1,salePriceUnitE4:250_000 },
      { seq:1, role: "accessory", manufacturerCode: "ACC", description:"Accessorio",quantityPerItem:1,salePriceUnitE4:50_000 }] },
    { uuid: "without-primary", bom: [{seq:0, role: "component", manufacturerCode: "COMP",description:"Componente",
      quantityPerItem:1,salePriceUnitE4:null }] },
  ],
  distinta: [
    { manufacturerCode: "A-1", description: "Interruttore & sezionatore", quantity: 2, listPriceUnitE4: 100_000, listTotalE4: 200_000 },
    { manufacturerCode: "FN81B16", description: "Prodotto configurato", quantity: 6, listPriceUnitE4: 125_000, listTotalE4: 750_000 },
    { manufacturerCode: "ACC", description: "Accessorio", quantity: 3, listPriceUnitE4: null, listTotalE4: null },
  ],
} as unknown as ProjectDocumentView;

describe("PDF document models and templates", () => {
  it("shows configured components under each parent and omits physical-only", () => {
    const model = buildDocumentModel(project, "preventivo", new Date("2026-10-01T12:00:00Z"));
    expect(model.rows.map(row => [row.groupTitle??row.code, row.quantity])).toEqual([
      ["A-1",2],["Configurazione cliente",0],["FN81B16",3],["ACC",3],
      ["Configurazione senza base",0],["COMP",1]]);
    expect(model.totalE4).toBeNull();
    const html = buildDocumentHtml(model, true);
    expect(html).toContain("Da definire");
    expect(html).not.toMatch(/tq\.|item-uuid|secret-uuid|NOTA INTERNA/);
    expect(html).toContain("Azienda &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("uses the grouped material rows and completely omits money when prices are off", () => {
    const model = buildDocumentModel(project, "distinta");
    expect(model.rows.map(row => row.quantity)).toEqual([2, 6, 3]);
    expect(model.totalE4).toBeNull();
    const priced = buildDocumentHtml(model, true);
    expect(priced).toContain("Totale di listino");
    expect(priced).toContain("Da definire");
    const unpriced = buildDocumentHtml(model, false);
    expect(unpriced).not.toMatch(/Prezzo unitario|Totale di listino|Da definire|€|class="money"|class="totals"/);
    expect(unpriced).toContain("DISTINTA MATERIALI");
  });

  it("uses a self-contained text identity in quotations and material lists", () => {
    for (const kind of ["preventivo", "distinta"] as const) {
      const html = buildDocumentHtml(buildDocumentModel(project, kind), true);
      expect(html).toContain('<strong class="brand">LibreQuadri</strong>');
      expect(html).not.toMatch(/<img|data:image|logo\.png/);
    }
  });
});
