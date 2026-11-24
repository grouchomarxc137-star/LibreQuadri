import { describe, expect, it } from "vitest";
import { buildDocumentModel } from "../src/main/documents/document-model.js";
import { buildDocumentHtml } from "../src/main/documents/document-html.js";
import { calculateCommercial } from "../src/shared/commercial.js";
import type { DocumentPdfOptions, ProjectDocumentView } from "../src/shared/project.js";

const project = {
  metadata: { title: "Quadro", date: "2026-10-01", companyName: "Cliente", companyDescription: "", description: "", normCode: "CEI", executor: "" },
  lines: [
    { uuid: "ordinary", lineType: "product", snapshotUuid: "shared", brandMarchio: "TEST", manufacturerCode: "A1", description: "Articolo", quantity: 2, unitListPriceE4: 100_000, lineDiscountBp: 1000 },
    { uuid: "configured", lineType: "item", itemUuid: "item", description: "Configurato", quantity: 3 },
    { uuid: "space", lineType: "item", itemUuid: "space-item", quantity: 1, commercialContribution: "none" },
  ],
  configuredItems: [{ uuid: "item", bom: [
    { seq: 0, snapshotUuid: "shared", brandMarchio: "TEST", manufacturerCode: "A1", description: "Articolo", quantityPerItem: 1, salePriceUnitE4: 100_000, lineDiscountBp: 2000 },
    { seq: 1, snapshotUuid: "accessory", brandMarchio: "TEST", manufacturerCode: "X", description: "Accessorio", quantityPerItem: 0.1, salePriceUnitE4: 15, lineDiscountBp: 0 },
  ] }, { uuid: "space-item", bom: [] }],
  distinta: [
    { snapshotUuid: "shared", brandMarchio: "TEST", manufacturerCode: "A1", description: "Articolo", quantity: 5, listPriceUnitE4: 100_000, listTotalE4: 500_000 },
    { snapshotUuid: "accessory", brandMarchio: "TEST", manufacturerCode: "X", description: "Accessorio", quantity: 0.3, listPriceUnitE4: 15, listTotalE4: 5 },
  ],
  globalDiscountBp: 1000, labourTotalE4: 200_000,
} as unknown as ProjectDocumentView;

const options = (showPrices: boolean, showDiscounts: boolean, showLabour: boolean): DocumentPdfOptions => ({ showPrices, showDiscounts, showLabour });
describe("Distinta optional commercial amounts", () => {
  it.each([
    [false, false, false, 500_005], [false, true, true, 500_005],
    [true, false, false, 500_005], [true, false, true, 700_005],
    [true, true, false, 378_004], [true, true, true, 578_004],
  ])("uses only checked amounts: prices %s discounts %s labour %s", (prices, discounts, labour, expected) => {
    const before = structuredClone(project), flags = options(prices as boolean, discounts as boolean, labour as boolean);
    const model = buildDocumentModel(project, "distinta", new Date("2026-10-26"), flags);
    expect(model.totalE4).toBe(expected);
    const html = buildDocumentHtml(model, flags);
    expect(html.includes("Prezzo unitario")).toBe(prices);
    expect(html.includes('class="discount"')).toBe(prices && discounts);
    expect(html.includes("Mano d'opera")).toBe(prices && labour);
    if (!prices) expect(html).not.toMatch(/€|Da definire|Sconto globale|TOTALE FINALE/);
    expect(project).toEqual(before);
  });
  it("splits identical articles by discount and matches the authoritative commercial total", () => {
    const model = buildDocumentModel(project, "distinta", new Date(), options(true, true, true));
    expect(model.rows.filter(row => row.code === "A1").map(row => [row.quantity, row.discountBp, row.totalE4]))
      .toEqual([[2, 1000, 180_000], [3, 2000, 240_000]]);
    expect(model.rows.some(row => row.code === "space")).toBe(false);
    expect(model.totalE4).toBe(calculateCommercial(project).finalTotalE4);
  });
  it("combines identical commercial terms, while keeping different prices separate", () => {
    const same = { ...project, lines: [...project.lines, { ...project.lines[0]!, uuid: "repeat" }] };
    const model = buildDocumentModel(same, "distinta", new Date(), options(true, true, false));
    expect(model.rows.find(row => row.discountBp === 1000)).toMatchObject({ quantity: 4, totalE4: 360_000 });
    const different = { ...same, lines: [...same.lines, { ...project.lines[0]!, uuid: "different-price", unitListPriceE4: 200_000 }] };
    expect(buildDocumentModel(different, "distinta", new Date(), options(true, true, false)).rows.filter(row => row.code === "A1")).toHaveLength(3);
  });
  it("keeps missing prices undefined with discounts and labour enabled", () => {
    const missing = { ...project, lines: project.lines.map(line => line.uuid === "ordinary" ? { ...line, unitListPriceE4: null } : line) };
    const model = buildDocumentModel(missing, "distinta", new Date(), options(true, true, true));
    expect(model.totalE4).toBeNull(); expect(buildDocumentHtml(model, options(true, true, true))).toContain("Da definire");
  });
});
