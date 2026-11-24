import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CatalogueOverviewPanel } from "../../src/renderer/catalogue/CatalogueOverviewPanel.js";
import { CatalogueScreen } from "../../src/renderer/catalogue/CatalogueScreen.js";
import { activeSelections, AttributeFilterPanel, CategorySelect } from "../../src/renderer/catalogue/CategoryFilters.js";
import { ProductTable } from "../../src/renderer/catalogue/ProductTable.js";
import { UnclassifiedFamilyTable, UnclassifiedPanel } from "../../src/renderer/catalogue/UnclassifiedPanel.js";
import type {
  CatalogueApi,
  CatalogueProduct,
} from "../../src/shared/catalogue.js";
import { fakeCatalogueApi, fakeConfigurationApi, fakeProjectApi, openProject } from "./fake-api.js";

const listed: CatalogueProduct = {
  id: 1,
  brandMarchio: "BTI",
  brandName: "BTicino",
  manufacturerCode: "FN81B16",
  description: "btdin60 - magnetot 1P curva B 16A",
  unitOfMeasure: "PCE",
  isListed: true,
  category: { code: "protezione.interruttori_automatici", name: "Interruttori automatici" },
  attributes: [],
  price: {
    unitPriceE4: 508000,
    listPriceE4: 508000,
    priceMultiplier: 1,
    currency: "EUR",
    issuerSigla: "BTI",
  },
};

describe("product table", () => {
  it("shows brand, manufacturer code, description and the exact unit price", () => {
    const html = renderToStaticMarkup(<ProductTable products={[listed]} />);
    expect(html).toContain("BTI");
    expect(html).toContain("FN81B16");
    expect(html).toContain("btdin60 - magnetot 1P curva B 16A");
    expect(html).toContain("50,80 €");
    expect(html).toContain("Interruttori automatici");
    expect(html).toContain("/ PCE");
    expect(html).not.toContain("Fuori listino");
    expect(html).not.toContain("delisted");
  });

  it("shows stored characteristics compactly with Italian number formatting", () => {
    const html = renderToStaticMarkup(<ProductTable products={[{ ...listed, attributes: [
      { code: "poles", name: "Poli", dataType: "enum", unit: null, value: "1p_n", label: "1P+N" },
      { code: "rated_current", name: "Corrente nominale", dataType: "number", unit: "A", value: 0.5, label: null },
      { code: "declared_breaking_capacity", name: "Potere di interruzione (dichiarato)", dataType: "number", unit: "kA", value: 4.5, label: null },
    ] }]} />);
    expect(html).toContain("Caratteristiche");
    expect(html).toContain("1P+N");
    expect(html).toContain("0,5 A");
    expect(html).toContain("4,5 kA");
    expect(html).toContain('title="Potere di interruzione (dichiarato)"');
    expect(renderToStaticMarkup(<ProductTable products={[listed]} />)).toContain('<td class="characteristics">—</td>');
  });

  it("labels products without category as Da classificare", () => {
    expect(renderToStaticMarkup(<ProductTable products={[{ ...listed, category: null }]} />)).toContain("Da classificare");
  });

  it("shows the pack price as secondary when the multiplier is not one", () => {
    const html = renderToStaticMarkup(
      <ProductTable
        products={[
          {
            ...listed,
            price: {
              ...listed.price!,
              unitPriceE4: 12345,
              listPriceE4: 1234500,
              priceMultiplier: 100,
            },
          },
        ]}
      />,
    );
    expect(html).toContain("1,2345 €");
    expect(html).toContain("123,45 € per 100 PCE");
  });

  it("visibly marks delisted products and shows no price for them", () => {
    const html = renderToStaticMarkup(
      <ProductTable products={[{ ...listed, isListed: false, price: null }]} />,
    );
    expect(html).toContain("Fuori listino");
    expect(html).toContain('class="delisted"');
    expect(html).not.toContain("€");
    expect(html).not.toContain("Prezzo non disponibile");
  });

  it("distinguishes a listed product without a price", () => {
    const html = renderToStaticMarkup(
      <ProductTable products={[{ ...listed, price: null }]} />,
    );
    expect(html).toContain("Prezzo non disponibile");
    expect(html).not.toContain("Fuori listino");
  });

  it("escapes catalogue text", () => {
    const html = renderToStaticMarkup(
      <ProductTable
        products={[{ ...listed, description: "<img src=x onerror=alert(1)>" }]}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("offers a clear add-to-preventivo action and shows the current quantity", () => {
    const html = renderToStaticMarkup(
      <ProductTable
        products={[listed]}
        onAdd={() => undefined}
        addedQuantities={new Map([[listed.id, 2]])}
      />,
    );
    expect(html).toContain("Preventivo");
    expect(html).toContain("Aggiungi ancora");
    expect(html).toContain("Nel preventivo: 2");
    expect(html).toContain(
      'aria-label="Aggiungi FN81B16 al preventivo"',
    );
  });

  it("offers configuration from catalogue products", () => {
    const html = renderToStaticMarkup(<ProductTable products={[listed]} onConfigure={() => undefined} />);
    expect(html).toContain("Configurazione");
    expect(html).toContain('aria-label="Configura FN81B16"');
  });
});

describe("catalogue overview panel", () => {
  it("explains an empty catalogue", () => {
    const html = renderToStaticMarkup(
      <CatalogueOverviewPanel
        overview={{
          productCount: 0,
          listedProductCount: 0,
          delistedProductCount: 0,
          classifiedProductCount: 0, unclassifiedProductCount: 0,
          listedClassifiedProductCount: 0, listedUnclassifiedProductCount: 0,
          brands: [],
          currentPriceLists: [],
        }}
      />,
    );
    expect(html).toContain("Il catalogo è vuoto");
  });

  it("summarizes counts and each current price list", () => {
    const html = renderToStaticMarkup(
      <CatalogueOverviewPanel
        overview={{
          productCount: 24676,
          listedProductCount: 24000,
          delistedProductCount: 676,
          classifiedProductCount: 872, unclassifiedProductCount: 23804,
          listedClassifiedProductCount: 872, listedUnclassifiedProductCount: 23128,
          brands: [
            { marchio: "BTI", name: "BTI", productCount: 9439, listedProductCount: 9000 },
          ],
          currentPriceLists: [
            {
              issuerSigla: "BTI",
              listinoNumber: "021",
              validFrom: "2026-07-01",
              importedAt: "2026-09-21T10:00:00.000Z",
              listedProductCount: 24000,
            },
          ],
        }}
      />,
    );
    expect(html).toContain("24.676");
    expect(html).toContain("872 classificati");
    expect(html).toContain("23.128 da classificare");
    expect(html).toContain("676");
    expect(html).toContain("fuori listino");
    expect(html).toContain("01/07/2026");
    expect(html).toContain("<strong>BTI</strong>");
  });
});

describe("catalogue screen", () => {
  it("hosts only catalogue content: no project lifecycle, review queue or Progettazione views", () => {
    const html = renderToStaticMarkup(<CatalogueScreen api={fakeCatalogueApi()} configurationApi={fakeConfigurationApi()}
      projectApi={fakeProjectApi()} project={openProject} onProjectChange={() => undefined}
      view="manufacturer" onViewChange={() => undefined} />);
    expect(html).toContain('aria-label="Navigazione produttore"');
    expect(html).toContain('aria-label="Articoli catalogo"');
    expect(html).toContain('aria-label="Scheda articolo"');
    // Project lines are the Preventivo workspace's (Quiet Workbench X5), not a Catalogo panel.
    expect(html).not.toContain('aria-label="Righe del progetto"');
    expect(html).toContain("Caricamento navigazione");
    expect(html).not.toContain("Da classificare");
    expect(html).not.toContain(">Progettazione<");
    expect(html).not.toContain("Nuovo progetto");
    expect(html).not.toContain(">Salva<");
  });

  it("shows the view chosen by the shell", () => {
    const html = renderToStaticMarkup(<CatalogueScreen api={fakeCatalogueApi()} configurationApi={fakeConfigurationApi()}
      projectApi={fakeProjectApi()} project={openProject} onProjectChange={() => undefined}
      view="configuration" onViewChange={() => undefined} />);
    expect(html).toContain("Torna al Catalogo");
    expect(html).toContain("Configura un modello");
  });
});

describe("category filters", () => {
  it("lists categories indented with subtree counts", () => {
    const html = renderToStaticMarkup(<CategorySelect value="protezione.differenziali_puri" onChange={() => undefined} categories={[
      { code: "protezione", name: "Protezione", parentCode: null, depth: 0, productCount: 872, listedProductCount: 872 },
      { code: "protezione.differenziali_puri", name: "Differenziali puri", parentCode: "protezione", depth: 1, productCount: 107, listedProductCount: 107 },
    ]} />);
    expect(html).toContain("Tutte le categorie");
    expect(html).toContain("Protezione (872)");
    expect(html).toContain("\u00a0\u00a0Differenziali puri (107)");
  });

  it("shows applicable attributes as checkboxes with selected values and reset", () => {
    const html = renderToStaticMarkup(<AttributeFilterPanel listedOnly selected={{ poles: ["2p"] }}
      onToggle={() => undefined} onReset={() => undefined} onListedOnlyChange={() => undefined}
      options={{ categoryCode: "x", totalCount: 3, attributes: [
        { code: "poles", name: "Poli", dataType: "enum", unit: null, values: [{ value: "1p", label: "1P", count: 2, selected: false },
          { value: "2p", label: "2P", count: 3, selected: true }] },
        { code: "rated_residual_current", name: "Corrente differenziale", dataType: "number", unit: "mA", values: [{ value: 30, label: null, count: 3, selected: false }] },
      ] }} />);
    expect(html).toContain("<legend>Poli</legend>");
    expect(html).toContain("30 mA");
    expect(html.match(/checked=""/g)).toHaveLength(2); // listed-only + 2P
    expect(html).toContain("Solo prodotti a listino");
    expect(html).toMatch(/<button type="button">Azzera filtri<\/button>/);
    expect(renderToStaticMarkup(<AttributeFilterPanel listedOnly={false} selected={{}} options={null}
      onToggle={() => undefined} onReset={() => undefined} onListedOnlyChange={() => undefined} />))
      .toMatch(/disabled="">Azzera filtri/);
  });
});

describe("faceted filters", () => {
  const options = { categoryCode: "x", totalCount: 0, attributes: [
    { code: "poles", name: "Poli", dataType: "enum" as const, unit: null, values: [
      { value: "1p", label: "1P", count: 12, selected: false }, { value: "2p", label: "2P", count: 0, selected: false },
      { value: "4p", label: "4P", count: 0, selected: true }] },
    { code: "rated_current", name: "Corrente nominale", dataType: "number" as const, unit: "A", values: [
      { value: 0.5, label: null, count: 1234, selected: false }] },
  ] };
  const render = (selected: Record<string, readonly (string | number)[]>) => renderToStaticMarkup(<AttributeFilterPanel options={options}
    selected={selected} listedOnly onToggle={() => undefined} onReset={() => undefined} onListedOnlyChange={() => undefined} />);

  it("shows every value with its count and disables unselected zero-count values only", () => {
    const html = render({ poles: ["4p"] });
    expect(html).toContain("1P <span class=\"facet-count\">(12)</span>");
    expect(html).toContain("0,5 A <span class=\"facet-count\">(1234)</span>");
    expect(html).toMatch(/<label class="facet-value unavailable"><input type="checkbox" disabled=""\/> 2P/);
    expect(html).toMatch(/<label class="facet-value"><input type="checkbox" checked=""\/> 4P <span class="facet-count">\(0\)/);
    expect(html).toContain("0 prodotti");
  });

  it("lists active selections as removable chips with reset", () => {
    const html = render({ poles: ["4p"], rated_current: [0.5] });
    expect(html).toContain("Filtri attivi:");
    expect(html).toContain('aria-label="Rimuovi filtro Poli: 4P"');
    expect(html).toContain("Corrente nominale: 0,5 A ✕");
    expect(html).toMatch(/<button type="button">Azzera filtri<\/button>/);
    expect(render({})).not.toContain("Filtri attivi");
    expect(activeSelections({ poles: ["4p"], trip_curve: ["c"] }, null).map(a => a.text)).toEqual(["poles: 4p", "trip_curve: c"]);
  });
});

describe("read-only review queue", () => {
  const api: CatalogueApi = {
    browse: async () => { throw new Error("not used"); },
    manufacturerNodes: async () => [], manufacturerModels: async () => [],
    manufacturerArticles: async () => [], manufacturerPositions: async () => [],
    search: async () => ({ products: [], offset: 0, hasMore: false }),
    overview: async () => { throw new Error("not used"); },
    unclassified: async () => ({ groups: [], offset: 0, hasMore: false }),
    categories: async () => [],
    attributeFilters: async () => { throw new Error("not used"); },
  };
  it("defaults to listed products and explains read-only grouped review", () => {
    const html = renderToStaticMarkup(<UnclassifiedPanel api={api} />);
    expect(html).toContain('type="checkbox" checked=""');
    expect(html).toContain("Consultazione in sola lettura");
    expect(html).toContain("Caricamento famiglie");
  });
  it("shows family scope, counts, examples and a product inspection action", () => {
    const html = renderToStaticMarkup(<UnclassifiedFamilyTable groups={[{
      issuerId: 1, brandId: 2, statisticalFamilyId: 3, issuerSigla: "BTI", brandMarchio: "LEG",
      familyCode: "MIX", familyDescription: "Famiglia mista", unclassifiedCount: 12, listedCount: 14, totalCount: 20,
      examples: ["Prodotto <sicuro>"],
    }]} onInspect={() => undefined} />);
    expect(html).toContain("BTI / LEG");
    expect(html).toContain("14 / 20");
    expect(html).toContain("Famiglia mista");
    expect(html).toContain("Prodotto &lt;sicuro&gt;");
    expect(html).toContain("Vedi prodotti BTI LEG MIX");
    expect(html).not.toContain("Assegna");
  });
});
