import type { CatalogueProduct } from "../../shared/catalogue.js";
import { formatAttributeValue, priceDisplay } from "./formatting.js";

function Characteristics({ product }: { readonly product: CatalogueProduct }) {
  if (product.attributes.length === 0) return <>—</>;
  return <>{product.attributes.map((attribute, index) => <span key={attribute.code} title={attribute.name}>
    {index > 0 ? " · " : null}{formatAttributeValue(attribute.value, attribute.unit, attribute.label)}
  </span>)}</>;
}

function PriceCell({ product }: { readonly product: CatalogueProduct }) {
  if (product.price === null) {
    return (
      <span className="price-missing">
        {product.isListed ? "Prezzo non disponibile" : "—"}
      </span>
    );
  }

  const display = priceDisplay(product.price, product.unitOfMeasure);
  return (
    <>
      <div className="price-primary">
        {display.primary}
        {display.unitLabel ? (
          <span className="price-unit"> / {display.unitLabel}</span>
        ) : null}
      </div>
      {display.secondary ? (
        <div className="price-secondary">{display.secondary}</div>
      ) : null}
    </>
  );
}

export function ProductTable({
  products,
  onAdd,
  onConfigure,
  addedQuantities,
}: {
  readonly products: readonly CatalogueProduct[];
  readonly onAdd?: (product: CatalogueProduct) => void;
  readonly onConfigure?: (product: CatalogueProduct) => void;
  readonly addedQuantities?: ReadonlyMap<number, number>;
}) {
  return (
    <div className="table-scroll">
      <table className="product-table">
        <thead>
          <tr>
            <th scope="col">Marca</th>
            <th scope="col">Codice</th>
            <th scope="col">Descrizione</th>
            <th scope="col">Caratteristiche</th>
            <th scope="col">Categoria</th>
            <th scope="col" className="numeric">
              Prezzo
            </th>
            {onAdd ? (
              <th scope="col" className="product-action">
                Preventivo
              </th>
            ) : null}
            {onConfigure ? <th scope="col" className="product-action">Configurazione</th> : null}
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr
              key={product.id}
              className={product.isListed ? undefined : "delisted"}
            >
              <td className="brand" title={product.brandName}>
                {product.brandMarchio}
              </td>
              <td className="code">
                {product.manufacturerCode}
                {product.isListed ? null : (
                  <span className="badge">Fuori listino</span>
                )}
              </td>
              <td className="description">{product.description ?? "—"}</td>
              <td className="characteristics">
                <Characteristics product={product} />
              </td>
              <td>{product.category?.name ?? "Da classificare"}</td>
              <td className="numeric">
                <PriceCell product={product} />
              </td>
              {onAdd ? (
                <td className="product-action">
                  <button
                    type="button"
                    className="add-product"
                    onClick={() => onAdd(product)}
                    aria-label={`Aggiungi ${product.manufacturerCode} al preventivo`}
                  >
                    {addedQuantities?.has(product.id)
                      ? "Aggiungi ancora"
                      : "Aggiungi"}
                  </button>
                  {addedQuantities?.has(product.id) ? (
                    <span className="added-count">
                      Nel preventivo: {addedQuantities.get(product.id)}
                    </span>
                  ) : null}
                </td>
              ) : null}
              {onConfigure ? <td className="product-action"><button type="button" onClick={() => onConfigure(product)}
                aria-label={`Configura ${product.manufacturerCode}`}>Configura</button></td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
