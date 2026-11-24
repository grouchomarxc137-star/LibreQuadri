import type { CataloguePrice } from "../../shared/catalogue.js";
import { formatMoneyE4 } from "../../shared/money.js";

export interface PriceDisplay {
  /** Price of one unit, shown prominently, e.g. "12,34 €". */
  readonly primary: string;
  /** METEL's unit of measure code, shown next to the primary price. */
  readonly unitLabel: string | null;
  /** Price for the multiplier quantity, only when that quantity is not 1. */
  readonly secondary: string | null;
}

/**
 * Unit price is the primary price; the multiplier (pack) price is secondary
 * and only present when METEL prices a quantity other than one.
 */
export function priceDisplay(
  price: CataloguePrice,
  unitOfMeasure: string | null,
): PriceDisplay {
  const unit = unitOfMeasure?.trim() || null;
  const secondary =
    price.priceMultiplier > 1
      ? `${formatMoneyE4(price.listPriceE4, price.currency)} per ${
          price.priceMultiplier
        }${unit ? ` ${unit}` : ""}`
      : null;

  return {
    primary: formatMoneyE4(price.unitPriceE4, price.currency),
    unitLabel: unit,
    secondary,
  };
}

/** "2026-07-01" -> "01/07/2026". Pure string handling: no time zone involved. */
export function formatIsoDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : isoDate;
}

export function formatCount(count: number): string {
  return count.toLocaleString("it-IT");
}

const attributeNumber = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 });

/** One attribute value for display: "16 A", "4,5 kA", or an option label. */
export function formatAttributeValue(value: number | string | boolean, unit: string | null, label: string | null): string {
  if (typeof value === "number") return unit ? `${attributeNumber.format(value)} ${unit}` : attributeNumber.format(value);
  if (typeof value === "boolean") return value ? "Sì" : "No";
  return label ?? value;
}
