export type MetelLayoutVersion = "020" | "021";

export type PriceListFieldName =
  | "marchio"
  | "codice"
  | "ean"
  | "descrizione"
  | "qtaCartone"
  | "qtaMultipla"
  | "qtaMinima"
  | "qtaMassima"
  | "leadTimeCode"
  | "prezzoRivenditoreCents"
  | "prezzoPubblicoCents"
  | "moltiplicatore"
  | "valuta"
  | "um"
  | "composto"
  | "statoCode"
  | "dataVariazione"
  | "famigliaSconto"
  | "famigliaStatistica"
  | "extraV021";

export interface FixedWidthField {
  readonly name: PriceListFieldName;
  /** Zero-based character offset after Windows-1252 decoding. */
  readonly start: number;
  readonly length: number;
  readonly type: "text" | "integer" | "date" | "raw";
  readonly required?: boolean;
}

export interface PriceListLayout {
  readonly version: MetelLayoutVersion;
  readonly lineLength: number;
  readonly fields: readonly FixedWidthField[];
}

const COMMON_PRICE_LIST_FIELDS = [
  { name: "marchio", start: 0, length: 3, type: "text", required: true },
  { name: "codice", start: 3, length: 16, type: "text", required: true },
  { name: "ean", start: 19, length: 13, type: "text" },
  { name: "descrizione", start: 32, length: 43, type: "text", required: true },
  { name: "qtaCartone", start: 75, length: 5, type: "integer" },
  { name: "qtaMultipla", start: 80, length: 5, type: "integer" },
  { name: "qtaMinima", start: 85, length: 5, type: "integer" },
  { name: "qtaMassima", start: 90, length: 6, type: "integer" },
  { name: "leadTimeCode", start: 96, length: 1, type: "text", required: true },
  {
    name: "prezzoRivenditoreCents",
    start: 97,
    length: 11,
    type: "integer",
  },
  {
    name: "prezzoPubblicoCents",
    start: 108,
    length: 11,
    type: "integer",
  },
  { name: "moltiplicatore", start: 119, length: 6, type: "integer" },
  { name: "valuta", start: 125, length: 3, type: "text", required: true },
  { name: "um", start: 128, length: 3, type: "text", required: true },
  { name: "composto", start: 131, length: 1, type: "integer" },
  { name: "statoCode", start: 132, length: 1, type: "text", required: true },
  { name: "dataVariazione", start: 133, length: 8, type: "date" },
  { name: "famigliaSconto", start: 141, length: 18, type: "text" },
  { name: "famigliaStatistica", start: 159, length: 18, type: "text" },
] as const satisfies readonly FixedWidthField[];

/**
 * Layout lengths are verified against the supplied files. In particular, the
 * observed v021 record is 233 characters: 177 common characters followed by
 * one unconfirmed 56-character area. That area remains a single raw value.
 */
export const PRICE_LIST_LAYOUTS: Readonly<
  Record<MetelLayoutVersion, PriceListLayout>
> = {
  "020": {
    version: "020",
    lineLength: 177,
    fields: COMMON_PRICE_LIST_FIELDS,
  },
  "021": {
    version: "021",
    lineLength: 233,
    fields: [
      ...COMMON_PRICE_LIST_FIELDS,
      { name: "extraV021", start: 177, length: 56, type: "raw" },
    ],
  },
};

export interface HeaderField {
  readonly name:
    | "issuerSigla"
    | "issuerPiva"
    | "listinoNumber"
    | "validFrom"
    | "lastChangeDate"
    | "headerDescription"
    | "layoutVersion";
  readonly start: number;
  readonly length: number;
  readonly type: "text" | "date" | "version";
}

export const PRICE_LIST_HEADER_FIELDS = [
  { name: "issuerSigla", start: 20, length: 3, type: "text" },
  { name: "issuerPiva", start: 23, length: 11, type: "text" },
  { name: "listinoNumber", start: 34, length: 6, type: "text" },
  { name: "validFrom", start: 40, length: 8, type: "date" },
  { name: "lastChangeDate", start: 48, length: 8, type: "date" },
  { name: "headerDescription", start: 56, length: 30, type: "text" },
  { name: "layoutVersion", start: 125, length: 3, type: "version" },
] as const satisfies readonly HeaderField[];

export const FAMILY_LAYOUT = {
  lineLength: 94,
  fields: {
    issuerSigla: { start: 0, length: 3 },
    marchio: { start: 3, length: 3 },
    code: { start: 6, length: 18 },
    description: { start: 24, length: 70 },
  },
} as const;

export const FAMILY_HEADERS = {
  FSC: "FAMIGLIE DI SCONTO  020",
  FST: "FAMIGLIE STATISTICHE020",
} as const;
