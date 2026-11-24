import { useEffect, useState } from "react";
import type { CatalogueApi, CatalogueSearchResult, UnclassifiedFamily, UnclassifiedResult } from "../../shared/catalogue.js";
import { ProductTable } from "./ProductTable.js";
import { formatCount } from "./formatting.js";

const PAGE_SIZE = 50;

export function UnclassifiedFamilyTable({ groups, onInspect }: {
  groups: readonly UnclassifiedFamily[];
  onInspect: (group: UnclassifiedFamily) => void;
}) {
  return <table className="product-table">
    <thead><tr><th>Emittente / Marca</th><th>Famiglia statistica</th><th>Da classificare</th><th>A listino / Totale</th><th>Esempi</th><th>Prodotti</th></tr></thead>
    <tbody>{groups.map(group => <tr key={`${group.issuerId}:${group.brandId}:${group.statisticalFamilyId}`}>
      <td>{group.issuerSigla ?? "—"} / {group.brandMarchio}</td>
      <td><strong>{group.familyCode ?? "Senza famiglia statistica"}</strong><br />{group.familyDescription ?? "Descrizione non disponibile"}</td>
      <td>{formatCount(group.unclassifiedCount)}</td>
      <td>{formatCount(group.listedCount)} / {formatCount(group.totalCount)}</td>
      <td>{group.examples.map((example, index) => <div key={index}>{example}</div>)}</td>
      <td><button type="button" onClick={() => onInspect(group)} aria-label={`Vedi prodotti ${group.issuerSigla ?? "senza emittente"} ${group.brandMarchio} ${group.familyCode ?? "senza famiglia"}`}>Vedi prodotti</button></td>
    </tr>)}</tbody>
  </table>;
}

export function UnclassifiedPanel({ api }: { api: CatalogueApi }) {
  const [listedOnly, setListedOnly] = useState(true);
  const [offset, setOffset] = useState(0);
  const [queue, setQueue] = useState<UnclassifiedResult | null>(null);
  const [selected, setSelected] = useState<UnclassifiedFamily | null>(null);
  const [productOffset, setProductOffset] = useState(0);
  const [products, setProducts] = useState<CatalogueSearchResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setQueue(null);
    setProducts(null);
    const request = selected ? api.search({ query: "", reviewGroup: {
      issuerId: selected.issuerId, brandId: selected.brandId, statisticalFamilyId: selected.statisticalFamilyId,
    }, listedOnly, offset: productOffset, limit: PAGE_SIZE }).then(result => { if (!cancelled) setProducts(result); })
      : api.unclassified({ listedOnly, offset, limit: PAGE_SIZE }).then(result => { if (!cancelled) setQueue(result); });
    request.catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [api, listedOnly, offset, selected, productOffset, retry]);

  const changeScope = (value: boolean) => {
    setListedOnly(value); setOffset(0); setSelected(null); setProductOffset(0);
  };
  const inspect = (group: UnclassifiedFamily) => { setProducts(null); setSelected(group); setProductOffset(0); };
  return <section aria-label="Da classificare" className="results">
    <h2>Da classificare</h2>
    <p>Prodotti senza categoria, raggruppati per emittente, marca e famiglia statistica. Consultazione in sola lettura.</p>
    <label><input type="checkbox" checked={listedOnly} onChange={event => changeScope(event.target.checked)} /> Solo prodotti a listino</label>
    {selected ? <div className="review-selection">
      <button type="button" onClick={() => { setSelected(null); setProducts(null); }}>Torna alle famiglie</button>
      <h3>{selected.issuerSigla ?? "—"} / {selected.brandMarchio} · {selected.familyCode ?? "Senza famiglia statistica"}</h3>
    </div> : null}
    <div aria-live="polite">
      {failed ? <p className="error">Impossibile caricare i dati. <button type="button" onClick={() => setRetry(n => n + 1)}>Riprova</button></p>
        : selected ? products ? <>
          {products.products.length ? <ProductTable products={products.products} /> : <p>Nessun prodotto da classificare.</p>}
          <PageButtons offset={productOffset} hasMore={products.hasMore} onPage={setProductOffset} />
        </> : <p>Caricamento prodotti…</p>
          : queue ? <>
            {queue.groups.length ? <UnclassifiedFamilyTable groups={queue.groups} onInspect={inspect} /> : <p>Nessuna famiglia da classificare.</p>}
            <PageButtons offset={offset} hasMore={queue.hasMore} onPage={setOffset} />
          </> : <p>Caricamento famiglie…</p>}
    </div>
  </section>;
}

function PageButtons({ offset, hasMore, onPage }: { offset: number; hasMore: boolean; onPage: (offset: number) => void }) {
  if (!offset && !hasMore) return null;
  return <nav className="catalogue-views" aria-label="Paginazione">
    <button type="button" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - PAGE_SIZE))}>Precedenti</button>
    <span>Pagina {Math.floor(offset / PAGE_SIZE) + 1}</span>
    <button type="button" disabled={!hasMore} onClick={() => onPage(offset + PAGE_SIZE)}>Successivi</button>
  </nav>;
}
