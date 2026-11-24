// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CatalogueScreen } from "../../src/renderer/catalogue/CatalogueScreen.js";
import { browseCatalogue } from "../../src/main/catalogue/browse-queries.js";
import { browseManufacturerNodes } from "../../src/main/catalogue/manufacturer-navigation.js";
import { createCatalogueFixture } from "../helpers/catalogue-fixtures.js";
import { fakeCatalogueApi, fakeConfigurationApi, fakeProjectApi, openProject } from "./fake-api.js";
import type { CatalogueBrowseRequest } from "../../src/shared/catalogue.js";

it("hides unapproved Siemens filters while preserving real result columns and navigation",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  const fixture=createCatalogueFixture();
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    fixture.importDelivery({issuer:"SIE",listino:"1",validFrom:"2026-01-01",products:[
      ...Array.from({length:64},(_,i)=>({marchio:"SIE",code:`DRIVE${String(i).padStart(3,"0")}`,statisticalFamily:"R220 I66X",description:`G120X IP20 400V ${(i+1)/10}KW`})),
      {marchio:"SIE",code:"COVER",statisticalFamily:"R220 I659",description:"COPERTURA PER SINAMICS 400V 2.2KW"},
    ]});
    const db=fixture.lq;const brand=db.prepare("SELECT id FROM cat_brand WHERE metel_marchio='SIE'").pluck().get();
    db.prepare(`INSERT INTO cat_range_node(id,brand_id,parent_id,code,name,node_kind,source,navigable) VALUES
      (100,?,NULL,'sie.root','Siemens','section','metel',1),(101,?,100,'sie.drives','Azionamenti','group','metel',1),
      (102,?,100,'sie.aux','Accessori','group','metel',1)`).run(brand,brand,brand);
    db.exec(`INSERT INTO cat_range_node_metel_family SELECT 101,id FROM cat_metel_family WHERE code='R220 I66X';
      INSERT INTO cat_range_node_metel_family SELECT 102,id FROM cat_metel_family WHERE code='R220 I659'`);
    const requests:CatalogueBrowseRequest[]=[];
    const api={...fakeCatalogueApi(),manufacturerNodes:async()=>browseManufacturerNodes(db),browse:async(request:CatalogueBrowseRequest)=>{requests.push(request);return browseCatalogue(db,request);}};
    const flush=async()=>act(async()=>{for(let i=0;i<8;i++)await Promise.resolve();});
    const click=async(button:HTMLElement)=>{await act(async()=>button.click());await flush();};
    const choose=async(id:number)=>click(host.querySelector<HTMLButtonElement>(`.tree-node-label[data-node-id="${id}"]`)!);
    await act(async()=>root.render(<CatalogueScreen api={api} configurationApi={fakeConfigurationApi()} projectApi={fakeProjectApi()}
      project={openProject} onProjectChange={()=>{}} view="manufacturer" onViewChange={()=>{}}/>));await flush();
    await click(host.querySelector<HTMLButtonElement>('[aria-label="Espandi Famiglie statistiche"]')!);
    await choose(100);
    expect(host.querySelectorAll(".catalogue-article")).toHaveLength(50);
    await click([...host.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent==="Mostra altri")!);
    expect(host.querySelectorAll(".catalogue-article")).toHaveLength(65);
    expect([...host.querySelectorAll(".catalogue-facets summary")].map(s=>s.textContent)).not.toContain("Potenza nominale");
    expect(host.querySelector(".catalogue-result-head")?.textContent).toContain("Potenza nominale");
    await choose(101);
    expect(requests.at(-1)?.attributeFilters).toEqual([]);
    await choose(102);
    expect(host.querySelectorAll(".catalogue-article")).toHaveLength(1);
    await choose(100);expect(host.querySelector(".catalogue-results-count")?.textContent).toContain("65 articoli");
  }finally{act(()=>root.unmount());host.remove();fixture.close();vi.unstubAllGlobals();}
});
