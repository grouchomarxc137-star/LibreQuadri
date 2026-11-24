import { PRICE_LIST_LAYOUTS } from "../../src/main/metel/layouts.js";

export interface MetelFileProduct {
  readonly marchio: string;
  readonly code: string;
  readonly description: string;
  readonly priceCents: number;
  readonly multiplier?: number;
  readonly um?: string;
  readonly discountFamily?: string;
  readonly statisticalFamily?: string;
}

function setRange(target: string[], start: number, length: number, value: string): void {
  target.splice(start, length, ...value.padEnd(length, " ").slice(0, length));
}

/** A real v020 fixed-width LSP file, as the parser reads it. */
export function metelLspFile(options: {
  readonly issuer: string;
  readonly validFrom: string;
  readonly listino?: string;
  readonly products: readonly MetelFileProduct[];
}): Buffer {
  const header = Array<string>(177).fill(" ");
  setRange(header, 0, 20, "LISTINO METEL");
  setRange(header, 20, 3, options.issuer);
  setRange(header, 23, 11, "12345678901");
  setRange(header, 34, 6, options.listino ?? "000001");
  setRange(header, 40, 8, options.validFrom.replaceAll("-", ""));
  setRange(header, 48, 8, options.validFrom.replaceAll("-", ""));
  setRange(header, 56, 30, "Fixture listino");
  setRange(header, 125, 3, "020");

  const lines = options.products.map((product) => {
    const row = Array<string>(PRICE_LIST_LAYOUTS["020"].lineLength).fill(" ");
    setRange(row, 0, 3, product.marchio);
    setRange(row, 3, 16, product.code);
    setRange(row, 32, 43, product.description);
    setRange(row, 75, 5, "00001");
    setRange(row, 80, 5, "00001");
    setRange(row, 85, 5, "00001");
    setRange(row, 90, 6, "999999");
    setRange(row, 96, 1, "1");
    const cents = String(product.priceCents).padStart(11, "0");
    setRange(row, 97, 11, cents);
    setRange(row, 108, 11, cents);
    setRange(row, 119, 6, String(product.multiplier ?? 1).padStart(6, "0"));
    setRange(row, 125, 3, "EUR");
    setRange(row, 128, 3, product.um ?? "PCE");
    setRange(row, 131, 1, "0");
    setRange(row, 132, 1, "1");
    setRange(row, 133, 8, options.validFrom.replaceAll("-", ""));
    setRange(row, 141, 18, product.discountFamily ?? "");
    setRange(row, 159, 18, product.statisticalFamily ?? "");
    return row.join("");
  });

  return Buffer.from([header.join(""), ...lines].join("\r\n") + "\r\n", "ascii");
}

/** A real v020 family file (FSC = discount families, FST = statistical). */
export function metelFamilyFile(options: {
  readonly type: "FSC" | "FST";
  readonly issuer: string;
  readonly families: readonly {
    readonly marchio: string;
    readonly code: string;
    readonly description: string;
  }[];
}): Buffer {
  const header = (
    options.type === "FSC" ? "FAMIGLIE DI SCONTO  020" : "FAMIGLIE STATISTICHE020"
  ).padEnd(94, " ");
  const rows = options.families.map(
    (family) =>
      `${options.issuer}${family.marchio}${family.code.padEnd(18, " ")}${family.description.padEnd(70, " ")}`,
  );
  return Buffer.from([header, ...rows].join("\r\n") + "\r\n", "ascii");
}
