import { describe, expect, it } from "vitest";
import { calculateCommercial, discountAmountE4, grossAmountE4 } from "../src/shared/commercial.js";
import { buildDocumentHtml } from "../src/main/documents/document-html.js";
import { buildDocumentModel } from "../src/main/documents/document-model.js";
import type { ProjectDocumentView } from "../src/shared/project.js";

const fixture={
  metadata:{title:"Quadro",description:"",date:"2026-10-02",companyName:"",companyDescription:"",
    normCode:"CEI EN 60898",executor:""},
  lines:[
    {uuid:"A",lineType:"item",itemUuid:"item-A",description:"Prodotto A",quantity:2,commercialContribution:"articles"},
    {uuid:"B",lineType:"item",itemUuid:"item-B",description:"Prodotto B",quantity:3,commercialContribution:"articles"},
    {uuid:"physical",lineType:"item",itemUuid:"item-physical",description:"Solo spazio",quantity:4,commercialContribution:"none"},
  ],
  configuredItems:[
    {uuid:"item-A",bom:[
      {seq:0,manufacturerCode:"P-A",description:"Prodotto A",quantityPerItem:1,salePriceUnitE4:100_000,lineDiscountBp:0},
      {seq:1,manufacturerCode:"X",description:"Accessorio X",quantityPerItem:1,salePriceUnitE4:33_333,lineDiscountBp:500},
      {seq:2,manufacturerCode:"Y",description:"Accessorio Y",quantityPerItem:1,salePriceUnitE4:50_000,lineDiscountBp:10_000}]},
    {uuid:"item-B",bom:[
      {seq:0,manufacturerCode:"P-B",description:"Prodotto B",quantityPerItem:1,salePriceUnitE4:100_000,lineDiscountBp:0},
      {seq:1,manufacturerCode:"X",description:"Accessorio X",quantityPerItem:2,salePriceUnitE4:33_333,lineDiscountBp:2500},
      {seq:2,manufacturerCode:"Z",description:"Accessorio Z",quantityPerItem:1,salePriceUnitE4:10_000,lineDiscountBp:0}]},
    {uuid:"item-physical",bom:[]},
  ],
  distinta:[{manufacturerCode:"X",description:"Accessorio X",quantity:8,listPriceUnitE4:33_333,listTotalE4:266_664}],
  globalDiscountBp:1000,labourTotalE4:2_000_000,
} as unknown as ProjectDocumentView;

describe("commercial calculation",()=>{
  it("keeps Siemens internal composition references out of quotations and PDFs",()=>{
    const project={...fixture,lines:[{...fixture.lines[0]!,description:"sie.assembly.internal"}],configuredItems:[{
      ...fixture.configuredItems[0]!,modelName:"Composizione Siemens",configLabel:"Apparecchio con accessori",
      bom:[{seq:0,manufacturerCode:"sie.assembly.internal",description:"sie.internal",quantityPerItem:1,salePriceUnitE4:100_000,lineDiscountBp:0}]}]} as unknown as ProjectDocumentView;
    const result=calculateCommercial(project);
    expect(result.groups[0]!.title).toBe("Apparecchio con accessori");
    expect(result.groups[0]!.rows[0]!.code).toBe("—");
    expect(buildDocumentHtml(buildDocumentModel(project,"preventivo"),true)).not.toContain("sie.");
  });
  it("keeps configured parents and repeated accessories separate, with quantity and per-component discount",()=>{
    const result=calculateCommercial(fixture);
    expect(result.groups.map(group=>group.title)).toEqual(["Prodotto A","Prodotto B"]);
    expect(result.groups[0]!.rows.map(row=>[row.code,row.quantity,row.discountBp,row.netE4]))
      .toEqual([["P-A",2,0,200_000],["X",2,500,63_333],["Y",2,10_000,0]]);
    expect(result.groups[1]!.rows.map(row=>[row.code,row.quantity,row.discountBp,row.netE4]))
      .toEqual([["P-B",3,0,300_000],["X",6,2500,149_998],["Z",3,0,30_000]]);
    expect(result.materialsSubtotalE4).toBe(743_331);
    expect(result.globalDiscountE4).toBe(74_333);
    expect(result.materialsAfterGlobalE4).toBe(668_998);
    expect(result.finalTotalE4).toBe(2_668_998);
    expect(fixture.distinta).toMatchObject([{manufacturerCode:"X",quantity:8}]);
  });

  it("rounds each discount half up at E4 and applies the global percentage after line discounts",()=>{
    expect(grossAmountE4(7,1)).toBe(7);
    expect(discountAmountE4(7,2000)).toBe(1);
    const project={...fixture,lines:[{...fixture.lines[0]!,quantity:1}],configuredItems:[{
      uuid:"item-A",bom:[{seq:0,manufacturerCode:"C",description:"C",quantityPerItem:1,salePriceUnitE4:7,lineDiscountBp:2000}]}],
      globalDiscountBp:5000,labourTotalE4:7} as unknown as ProjectDocumentView;
    const result=calculateCommercial(project);
    expect(result.groups[0]!.rows[0]!.netE4).toBe(6);
    expect(result.globalDiscountE4).toBe(3);
    expect(result.finalTotalE4).toBe(10);
    expect(grossAmountE4(15,0.5)).toBe(8);
    expect(grossAmountE4(15,0.1,3)).toBe(5);
    expect(discountAmountE4(1,5000)).toBe(1);
    expect(discountAmountE4(1,0)).toBe(0);
    expect(discountAmountE4(1,10_000)).toBe(1);
  });

  it("retains Da definire with missing component pricing and hides all commercial values when prices are off",()=>{
    const unpriced={...fixture,configuredItems:fixture.configuredItems.map(item=>item.uuid==="item-B"?
      {...item,bom:item.bom.map((row,index)=>index===1?{...row,salePriceUnitE4:null}:row)}:item)} as ProjectDocumentView;
    const result=calculateCommercial(unpriced);
    expect(result.materialsSubtotalE4).toBeNull();
    expect(result.globalDiscountE4).toBeNull();
    expect(result.finalTotalE4).toBeNull();
    const model=buildDocumentModel(unpriced,"preventivo");
    const priced=buildDocumentHtml(model,true);
    expect(priced).toContain("Da definire");
    expect(priced).toContain("Mano d'opera");
    const noPrices=buildDocumentHtml(model,false);
    expect(noPrices).not.toMatch(/€|Da definire|Sconto|Mano d|Totale|Prezzo unitario/);
    expect(noPrices).toContain("Prodotto A");
    expect(noPrices).toContain("Prodotto B");
  });

  it("renders a long hierarchical Preventivo without internal identifiers",()=>{
    const many={...fixture,lines:Array.from({length:90},(_,index)=>({
      ...fixture.lines[0]!,uuid:`A-${index}`,description:`Prodotto ${index}`}))} as ProjectDocumentView;
    const html=buildDocumentHtml(buildDocumentModel(many,"preventivo"),true);
    expect((html.match(/class="product-group"/g)??[])).toHaveLength(90);
    expect((html.match(/class="configured-child"/g)??[])).toHaveLength(270);
    expect(html).not.toMatch(/tq\.pack|item-A|item-B|item-physical/);
    expect(html).toContain("page-break-inside:avoid");
  });
});
