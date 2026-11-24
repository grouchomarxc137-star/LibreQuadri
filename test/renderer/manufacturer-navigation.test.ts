import { describe,expect,it } from "vitest";
import type { ManufacturerNode } from "../../src/shared/catalogue.js";
import { manufacturerChildren,manufacturerNodeLabel } from "../../src/renderer/catalogue/ManufacturerNavigation.js";

const node=(id:number,parentId:number|null,name:string,levelLabel:string|null,
  brandMarchio="BTI"):ManufacturerNode=>({id,parentId,name,levelLabel,
    levelCode:null,brandMarchio,code:String(id),kind:"level",source:"import",
    sortOrder:0,articleCount:1,packageCount:0});

describe("manufacturer navigation presentation",()=>{
  it("shows hierarchy names without level prefixes and keeps same-named siblings distinct",()=>{
    const rows=[node(1,null,"Apparecchi",null),node(2,1,"Btdin 60","Gamma"),
      node(3,2,"Magnetotermici","Tipologia"),node(4,3,'Curva "C"',"Famiglia"),
      node(5,null,"Pannelli",null),node(6,5,"Larghezza 850 mm",null),
      node(7,6,"Per Btdin",null),node(8,6,"Per Btdin",null),
      node(9,null,"Famiglie statistiche",null,"LEG")];
    expect(manufacturerChildren(rows,null,"BTI").map(row=>row.id)).toEqual([1,5]);
    expect(manufacturerChildren(rows,6).map(row=>row.id)).toEqual([7,8]);
    expect(manufacturerNodeLabel(rows[1]!)).toBe("Btdin 60");
    expect(manufacturerNodeLabel(rows[2]!)).toBe("Magnetotermici");
    expect(manufacturerNodeLabel(rows[3]!)).toBe('Curva "C"');
    expect(manufacturerNodeLabel(rows[5]!)).toBe("Larghezza 850 mm");
  });
});
