import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PreventivoContent, formatEditableDecimal, parseEditableDecimal } from "../../src/renderer/quotation/PreventivoWorkspace.js";
import { calculateCommercial } from "../../src/shared/commercial.js";
import { demoLineTotalE4, demoQuotationTotals } from "../../src/renderer/quotation/demo-quotation.js";
import type { ProjectConfiguredItem, ProjectPhysicalNode, ProjectQuotationLine } from "../../src/shared/project.js";
import { dinModulesPerUnit, projectArticleCount, projectDinModules, projectLineName } from "../../src/renderer/quotation/project-rows.js";

const pricedLine: ProjectQuotationLine = {
  lineType: "product", itemUuid: null,
  uuid: "10000000-0000-4000-8000-000000000001",
  snapshotUuid: "20000000-0000-4000-8000-000000000001",
  brandMarchio: "BTI", manufacturerCode: "FN81B16",
  description: "btdin60 - magnetot 1P curva B 16A", unitOfMeasure: "PCE",
  quantity: 2, unitListPriceE4: 508000, lineTotalE4: 1_016_000, currency: "EUR",
};
const unpricedLine: ProjectQuotationLine = {
  ...pricedLine,
  uuid: "10000000-0000-4000-8000-000000000002",
  snapshotUuid: "20000000-0000-4000-8000-000000000002",
  manufacturerCode: "NO-PRICE", description: "Prodotto senza prezzo corrente",
  quantity: 1, unitListPriceE4: null, lineTotalE4: null,
};

describe("persistent quotation calculations", () => {
  it("uses exact integer _e4 values restored from the project", () => {
    expect(demoLineTotalE4(pricedLine)).toBe(1_016_000);
    expect(demoQuotationTotals([pricedLine, unpricedLine])).toEqual({
      pricedTotalE4: 1_016_000, unpricedLineCount: 1, totalQuantity: 3,
    });
  });
});

describe("commercial editor scale", () => {
  it.each([
    ["0,00", 0], ["125,50", 1_255_000], ["200,00", 2_000_000], ["0,01", 100],
  ])("converts €%s to E4 %i and back", (display, e4) => {
    expect(parseEditableDecimal(display, "labour")).toBe(e4);
    expect(formatEditableDecimal(e4, "labour")).toBe(display);
  });

  it("accepts cents only, and keeps discounts in basis points", () => {
    expect(parseEditableDecimal("125,005", "labour")).toBeNull();
    expect(parseEditableDecimal("125,50", "discount")).toBeNull();
    expect(parseEditableDecimal("12,50", "discount")).toBe(1250);
    expect(formatEditableDecimal(1250, "discount")).toBe("12,50");
  });

  it("keeps commercial totals in E4 after editing labour", () => {
    const labourTotalE4 = parseEditableDecimal("125,50", "labour")!;
    const result = calculateCommercial({ lines: [], configuredItems: [], globalDiscountBp: 0, labourTotalE4 });
    expect(result.finalTotalE4).toBe(1_255_000);
    expect(calculateCommercial({ lines: [], configuredItems: [], globalDiscountBp: 0,
      labourTotalE4: parseEditableDecimal("200,00", "labour")! }).finalTotalE4).toBe(2_000_000);
  });
});

describe("project selected-products UI", () => {
  it("exposes contextual component, global and labour editors with the calculated total",()=>{
    const itemLine={...pricedLine,lineType:"item" as const,itemUuid:"30000000-0000-4000-8000-000000000001",
      snapshotUuid:null,manufacturerCode:"tq.pack.1",description:"Configurazione A",quantity:2};
    const item={uuid:itemLine.itemUuid,modelName:"Configurazione A",configLabel:"Configurazione A",
      modelKind:"device",physStatus:"not_physical",demands:[],bom:[
        {seq:0,manufacturerCode:"MAIN",description:"Prodotto base",quantityPerItem:1,salePriceUnitE4:100_000,lineDiscountBp:0},
        {seq:1,manufacturerCode:"ACC",description:"Accessorio",quantityPerItem:2,salePriceUnitE4:50_000,lineDiscountBp:2500},
      ]} as unknown as ProjectConfiguredItem;
    const html=renderToStaticMarkup(<PreventivoContent project={{ lines: [itemLine], configuredItems: [item], physicalNodes: [], globalDiscountBp: 1000, labourTotalE4: 200_000 }}
      onQuantityChange={()=>undefined} onRemove={()=>undefined} onRemoveMany={()=>undefined}
      onOpenLine={()=>undefined} onComponentDiscount={()=>undefined} onGlobalDiscount={()=>undefined}
      onLabourTotal={()=>undefined}/>);
    expect(html).toContain('aria-label="Sconto Accessorio Configurazione A"');
    expect(html).toContain('aria-label="Sconto globale progetto"');
    expect(html).toContain('aria-label="Mano d&#x27;opera totale in euro"');
    expect(html).toMatch(/aria-label="Mano d&#x27;opera totale in euro"[^>]*value="20,00"/);
    expect(html).toContain("Importo sconto globale");
    expect(html).toContain("Totale progetto");
    expect(html).not.toContain("tq.pack.1");
  });
  it("shows compact project rows and quantity controls with prices in its own workspace and without project identity", () => {
    const html = renderToStaticMarkup(<PreventivoContent project={{ lines: [pricedLine, unpricedLine], configuredItems: [], physicalNodes: [], globalDiscountBp: 0, labourTotalE4: 0 }} onQuantityChange={() => undefined} onRemove={() => undefined}
      onRemoveMany={() => undefined} onOpenLine={() => undefined} />);
    expect(html).not.toContain("Quadro uffici");
    expect(html).not.toContain("Modificato");
    expect(html).not.toContain("PROGETTO .LQP");
    expect(html).toContain("btdin60 - magnetot 1P curva B 16A");
    expect(html).toContain('aria-label="Quantità btdin60 - magnetot 1P curva B 16A"');
    expect(html).toContain('aria-label="Seleziona btdin60 - magnetot 1P curva B 16A per la rimozione"');
    expect(html).toContain('aria-label="Rimuovi btdin60 - magnetot 1P curva B 16A dal progetto"');
    expect(html).toContain("50,80 €");
    expect(html).toContain("101,60 €");
    expect(html).not.toContain("Totale preventivo");
    expect(html).not.toContain("Distinta ·");
    expect(html).toContain("Prodotto senza prezzo corrente");
    expect(html).toContain("3 articoli");
    expect(html).toContain('aria-label="Riga 1"');
    expect(html).toContain('aria-label="Riga 2"');
    expect(projectArticleCount([pricedLine,unpricedLine])).toBe(3);
  });

  it("explains an empty project quotation", () => {
    const html = renderToStaticMarkup(<PreventivoContent project={{ lines: [], configuredItems: [], physicalNodes: [], globalDiscountBp: 0, labourTotalE4: 0 }}
      onQuantityChange={() => undefined} onRemove={() => undefined} onRemoveMany={() => undefined}
      onOpenLine={() => undefined} />);
    expect(html).toContain("Nessun prodotto nel progetto");
    expect(html).not.toContain("Distinta");
    expect(html).toContain("0,00 €");
  });

  it("shows the saved model name and its authoritative DIN demand", () => {
    const itemLine: ProjectQuotationLine = {...pricedLine,lineType:"item",snapshotUuid:null,
      itemUuid:"30000000-0000-4000-8000-000000000001",quantity:3,
      manufacturerCode:"tq.pack.internal",description:"tq.pack.internal"};
    const item = { uuid: itemLine.itemUuid, modelName: "Btdin 500 Magnetotermico", modelKind: "device",
      physStatus: "resolved", bom: [], demands: [{capacityKindCode:"din_rail",capacityKindLabel:"moduli",
        amount:3,displayDivisor:2,nominalPitchMm:9}] } as unknown as ProjectConfiguredItem;
    const html=renderToStaticMarkup(<PreventivoContent project={{ lines: [itemLine], configuredItems: [item], physicalNodes: [], globalDiscountBp: 0, labourTotalE4: 0 }} onQuantityChange={() => undefined} onRemove={() => undefined}
      onRemoveMany={() => undefined} onOpenLine={() => undefined} onDuplicate={() => undefined} />);
    expect(html).toContain("Btdin 500 Magnetotermico");
    expect(html).toContain("4,5 moduli DIN");
    expect(html).not.toContain("tq.pack.internal");
    expect(html).toContain('aria-label="Quantità Btdin 500 Magnetotermico"');
    expect(html).toContain('aria-label="Duplica Btdin 500 Magnetotermico"');
    expect(html).toContain("3 articoli");
    expect(html).toContain('aria-label="Riga 1"');
    const copyLine = {...itemLine,uuid:"10000000-0000-4000-8000-000000000003",
      itemUuid:"30000000-0000-4000-8000-000000000002",quantity:1};
    const copy = {...item,uuid:copyLine.itemUuid};
    const withCopy = renderToStaticMarkup(<PreventivoContent project={{ lines: [itemLine,copyLine], configuredItems: [item,copy], physicalNodes: [], globalDiscountBp: 0, labourTotalE4: 0 }} onQuantityChange={()=>undefined}
      onRemove={()=>undefined} onRemoveMany={()=>undefined} onOpenLine={()=>undefined} onDuplicate={()=>undefined} />);
    expect(withCopy).toContain("4 articoli");
    expect(withCopy).toContain('aria-label="Riga 2"');
    expect((withCopy.match(/aria-label="Duplica Btdin 500 Magnetotermico"/g)??[])).toHaveLength(2);
    expect(dinModulesPerUnit(item)).toBe(1.5);
    expect(projectDinModules([itemLine], [item])).toBe(4.5);
    expect(projectLineName(itemLine, item)).toBe(item.modelName);
    expect(projectDinModules([pricedLine], [item])).toBeNull();
    expect(dinModulesPerUnit({ ...item, modelKind: "support" })).toBeNull();
    expect(dinModulesPerUnit({ ...item, physStatus: "not_physical" })).toBeNull();
    expect(dinModulesPerUnit({ ...item, demands: [{ ...item.demands[0]!, capacityKindCode: "mccb_slot" }] })).toBeNull();
    expect(dinModulesPerUnit({ ...item, demands: [{ ...item.demands[0]!, displayDivisor: 0 }] })).toBeNull();
    const placed = { itemUuid: item.uuid, children: [] } as unknown as ProjectPhysicalNode;
    const blocked = renderToStaticMarkup(<PreventivoContent project={{ lines: [itemLine], configuredItems: [item], physicalNodes: [placed], globalDiscountBp: 0, labourTotalE4: 0 }} onQuantityChange={() => undefined} onRemove={() => undefined}
      onRemoveMany={() => undefined} onOpenLine={() => undefined} />);
    expect(blocked).toContain("Rimuovi prima la posizione in Progettazione");
    expect(blocked).toMatch(/class="icon-button remove-line" disabled=""[^>]*aria-label="Rimuovi Btdin 500 Magnetotermico dal progetto"/);
  });
});
