import type { CatalogueOverview } from "../../shared/catalogue.js";
import { formatCount, formatIsoDate } from "./formatting.js";

export function CatalogueOverviewPanel({
  overview,
}: {
  readonly overview: CatalogueOverview;
}) {
  if (overview.productCount === 0) {
    return (
      <p className="overview overview-empty">
        Il catalogo è vuoto: nessun listino METEL è stato ancora importato.
      </p>
    );
  }

  return (
    <div className="overview">
      <p>
        <strong>{formatCount(overview.productCount)}</strong> prodotti ·{" "}
        {formatCount(overview.listedProductCount)} a listino ·{" "}
        {formatCount(overview.delistedProductCount)} fuori listino ·{" "}
        {formatCount(overview.brands.length)} marchi
      </p>
      <ul className="price-lists">
        <li>
          Classificazione a listino: {formatCount(overview.listedClassifiedProductCount)} classificati ·{" "}
          {formatCount(overview.listedUnclassifiedProductCount)} da classificare
          {" "}(totale catalogo: {formatCount(overview.classifiedProductCount)} classificati ·{" "}
          {formatCount(overview.unclassifiedProductCount)} da classificare)
        </li>
        {overview.currentPriceLists.map((priceList) => (
          <li key={priceList.issuerSigla}>
            Listino <strong>{priceList.issuerSigla}</strong> n.{" "}
            {priceList.listinoNumber}, valido dal{" "}
            {formatIsoDate(priceList.validFrom)} ·{" "}
            {formatCount(priceList.listedProductCount)} prodotti
          </li>
        ))}
      </ul>
    </div>
  );
}
