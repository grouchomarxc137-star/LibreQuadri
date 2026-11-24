import type { ReactNode } from "react";

import type { CatalogueOverview } from "../../shared/catalogue.js";
import { formatCount, formatIsoDate } from "../catalogue/formatting.js";

function Section({ title, count, children }: {
  readonly title: string;
  readonly count?: number;
  readonly children: ReactNode;
}) {
  return <section className="start-section">
    <header className="dock-header"><h3>{title}</h3>
      {count === undefined ? null : <span className="dock-count">{formatCount(count)}</span>}</header>
    {children}
  </section>;
}

/** The brand's display name, or null when it only repeats the marchio (names are not enriched yet). */
function distinctBrandName(marchio: string, name: string): string | null {
  return name.trim() === "" || name.trim().toLowerCase() === marchio.trim().toLowerCase() ? null : name;
}

/**
 * Right column of the start screen (docs/R17_VISUAL_DESIGN.md §4.1): what the local catalogue
 * holds, from the CatalogueOverview the shell already loads. No new query, no path.
 */
export function StartCatalogue({ overview, onUpdateListino, onUnclassified, onManageBrands }: {
  /** null while loading or when the catalogue could not be read. */
  readonly overview: CatalogueOverview | null;
  readonly onUpdateListino: () => void;
  readonly onUnclassified: () => void;
  readonly onManageBrands?: () => void;
}) {
  const lists = overview?.currentPriceLists ?? [];
  const brands = overview?.brands ?? [];
  return <aside className="start-side" aria-label="Catalogo">
    <div className="start-side-scroll">
      <Section title="Catalogo locale">
        {overview ? <dl className="start-grid">
          <div><dt>Articoli</dt><dd>{formatCount(overview.productCount)}</dd></div>
          <div><dt>A listino</dt><dd>{formatCount(overview.listedProductCount)}</dd></div>
          <div><dt>Fuori listino</dt><dd>{formatCount(overview.delistedProductCount)}</dd></div>
          <div><dt>Da classificare</dt><dd>{formatCount(overview.unclassifiedProductCount)}</dd></div>
        </dl> : <p className="start-note">Dati del catalogo non disponibili.</p>}
      </Section>
      <Section title="Listini installati" count={lists.length}>
        {lists.length === 0 ? <p className="start-note">{overview ? "Nessun listino installato." : "Dati del catalogo non disponibili."}</p>
          : <table className="start-table start-lists" aria-label="Listini installati">
            <thead><tr><th scope="col">Emittente</th><th scope="col">Listino</th><th scope="col">Valido dal</th><th scope="col" className="numeric">Articoli</th></tr></thead>
            <tbody>{lists.map((list) => <tr key={`${list.issuerSigla}-${list.listinoNumber}`}>
              <td className="start-code" title={list.issuerSigla}>{list.issuerSigla}</td>
              <td title={`n. ${list.listinoNumber}`}>n. {list.listinoNumber}</td>
              <td>{formatIsoDate(list.validFrom)}</td>
              <td className="numeric">{formatCount(list.listedProductCount)}</td>
            </tr>)}</tbody>
          </table>}
        <div className="start-actions">
          <button type="button" onClick={onUpdateListino}>Aggiorna listino…</button>
          <button type="button" onClick={onUnclassified}>Famiglie da classificare…</button>
        </div>
      </Section>
      <Section title="Marchi nel catalogo" count={overview ? brands.length : undefined}>
        {onManageBrands?<div className="start-actions"><button type="button" onClick={onManageBrands}>Gestisci marchi…</button></div>:null}
        {brands.length === 0 ? <p className="start-note">{overview ? "Nessun marchio nel catalogo." : "Dati del catalogo non disponibili."}</p>
          : <table className="start-table start-brands" aria-label="Marchi nel catalogo">
            <thead><tr><th scope="col">Marchio</th><th scope="col">Nome</th><th scope="col" className="numeric">Articoli</th><th scope="col" className="numeric">A listino</th></tr></thead>
            <tbody>{brands.map((brand) => {
              const name = distinctBrandName(brand.marchio, brand.name);
              return <tr key={brand.marchio}>
                <td className="start-code" title={brand.marchio}>{brand.marchio}</td>
                <td className={name ? undefined : "start-muted"} title={name ?? undefined}>{name ?? "—"}</td>
                <td className="numeric">{formatCount(brand.productCount)}</td>
                <td className="numeric">{formatCount(brand.listedProductCount)}</td>
              </tr>;
            })}</tbody>
          </table>}
      </Section>
    </div>
    <p className="start-hints">
      <span><kbd>↑</kbd><kbd>↓</kbd> seleziona</span>
      <span><kbd>Invio</kbd> apre</span>
      <span><kbd>Canc</kbd> rimuove dall'elenco</span>
    </p>
  </aside>;
}
