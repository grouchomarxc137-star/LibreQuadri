import {
  FAMILY_HEADERS,
  FAMILY_LAYOUT,
  PRICE_LIST_HEADER_FIELDS,
  PRICE_LIST_LAYOUTS,
  type FixedWidthField,
  type MetelLayoutVersion,
  type PriceListFieldName,
} from "./layouts.js";

export type MetelFileType = "LSP" | "FSC" | "FST";
export type FamilyType = "SCONTO" | "STATISTICA";

export interface MetelSourceMetadata {
  readonly fileType: MetelFileType;
  readonly issuerSigla: string;
  readonly issuerPiva: string | null;
  readonly listinoNumber: string | null;
  readonly validFrom: string | null;
  readonly lastChangeDate: string | null;
  readonly headerDescription: string | null;
  readonly layoutVersion: MetelLayoutVersion;
}

export interface ParsedPriceListRow {
  readonly lineNo: number;
  readonly rawLine: string;
  readonly marchio: string;
  readonly codice: string;
  readonly ean: string | null;
  readonly descrizione: string;
  readonly qtaCartone: number;
  readonly qtaMultipla: number;
  readonly qtaMinima: number;
  readonly qtaMassima: number;
  readonly leadTimeCode: string;
  readonly prezzoRivenditoreCents: number;
  readonly prezzoPubblicoCents: number;
  readonly moltiplicatore: number;
  readonly valuta: string;
  readonly um: string;
  readonly composto: number;
  readonly statoCode: string;
  readonly dataVariazione: string;
  readonly famigliaSconto: string | null;
  readonly famigliaStatistica: string | null;
  /** Reserved until the official v021 trailing-field layout is confirmed. */
  readonly electrocod: null;
  /** The complete, padding-preserving v021 trailing area. */
  readonly extraV021: string | null;
}

export interface ParsedFamilyRow {
  readonly lineNo: number;
  readonly rawLine: string;
  readonly familyType: FamilyType;
  readonly issuerSigla: string;
  readonly marchio: string;
  readonly code: string;
  readonly description: string;
}

export type ParsedMetelSource =
  | {
      readonly metadata: MetelSourceMetadata & { readonly fileType: "LSP" };
      readonly priceListRows: readonly ParsedPriceListRow[];
      readonly familyRows: readonly [];
    }
  | {
      readonly metadata: MetelSourceMetadata & {
        readonly fileType: "FSC" | "FST";
      };
      readonly priceListRows: readonly [];
      readonly familyRows: readonly ParsedFamilyRow[];
    };

export class MetelParseError extends Error {
  readonly lineNo?: number;
  readonly field?: string;

  constructor(
    message: string,
    options: { readonly lineNo?: number; readonly field?: string } = {},
  ) {
    const location = [
      options.lineNo === undefined ? undefined : `line ${options.lineNo}`,
      options.field === undefined ? undefined : `field ${options.field}`,
    ]
      .filter(Boolean)
      .join(", ");
    super(location ? `${message} (${location})` : message);
    this.name = "MetelParseError";
    this.lineNo = options.lineNo;
    this.field = options.field;
  }
}

// Explicit C1 mapping: some Node/ICU builds label the decoder windows-1252
// but return Latin-1 controls for 0x80–0x9f. Fixed-width bytes must stay stable.
export const WINDOWS_1252_C1 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
const SIGLA_PATTERN = /^[A-Z0-9]{3}$/;

export function decodeMetelSource(sourceBytes: Uint8Array): string {
  return Buffer.from(sourceBytes).toString("latin1")
    .replace(/[\x80-\x9f]/g, character => WINDOWS_1252_C1[character.charCodeAt(0)-0x80]!)
    .replace(/\r\n?/g, "\n");
}

function sourceLines(sourceBytes: Uint8Array): string[] {
  const normalized = decodeMetelSource(sourceBytes);
  const lines = normalized.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  if (lines.length === 0 || lines[0] === "") {
    throw new MetelParseError("METEL source file is empty or has no header");
  }
  return lines;
}

function isoDate(raw: string, lineNo: number, field: string): string {
  if (!/^\d{8}$/.test(raw)) {
    throw new MetelParseError(`Malformed METEL date ${JSON.stringify(raw)}`, {
      lineNo,
      field,
    });
  }

  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new MetelParseError(`Invalid METEL date ${JSON.stringify(raw)}`, {
      lineNo,
      field,
    });
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function requiredSigla(value: string, lineNo: number, field: string): string {
  if (!SIGLA_PATTERN.test(value)) {
    throw new MetelParseError(`Malformed METEL sigla ${JSON.stringify(value)}`, {
      lineNo,
      field,
    });
  }
  return value;
}

function parseInteger(raw: string, lineNo: number, field: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new MetelParseError(
      `Malformed numeric value ${JSON.stringify(raw)}`,
      { lineNo, field },
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new MetelParseError(`Numeric value is outside the safe integer range`, {
      lineNo,
      field,
    });
  }
  return value;
}

function fieldValue(
  line: string,
  field: FixedWidthField,
  lineNo: number,
): string | number | null {
  const raw = line.slice(field.start, field.start + field.length);
  if (field.type === "raw") {
    return raw;
  }
  if (field.type === "integer") {
    return parseInteger(raw, lineNo, field.name);
  }
  if (field.type === "date") {
    return isoDate(raw, lineNo, field.name);
  }

  const value = raw.trimEnd();
  if (field.required && value.length === 0) {
    throw new MetelParseError("Required METEL field is blank", {
      lineNo,
      field: field.name,
    });
  }
  return value.length === 0 ? null : value;
}

function parsePriceListHeader(header: string): MetelSourceMetadata & {
  readonly fileType: "LSP";
} {
  if (header.slice(0, 20).trimEnd() !== "LISTINO METEL") {
    throw new MetelParseError("Malformed LSP header label", { lineNo: 1 });
  }
  if (header.length < 128) {
    throw new MetelParseError(`Malformed LSP header length ${header.length}`, {
      lineNo: 1,
    });
  }

  const values: Record<string, string> = {};
  for (const field of PRICE_LIST_HEADER_FIELDS) {
    const raw = header.slice(field.start, field.start + field.length);
    if (field.type === "date") {
      values[field.name] = isoDate(raw, 1, field.name);
    } else {
      values[field.name] = raw.trimEnd();
    }
  }

  const version = values.layoutVersion;
  if (version !== "020" && version !== "021") {
    throw new MetelParseError(
      `Unsupported LSP layout version ${JSON.stringify(version)}`,
      { lineNo: 1, field: "layoutVersion" },
    );
  }
  const expectedLength = PRICE_LIST_LAYOUTS[version].lineLength;
  if (header.length !== expectedLength) {
    throw new MetelParseError(
      `Invalid LSP header length ${header.length}; expected ${expectedLength} for version ${version}`,
      { lineNo: 1 },
    );
  }

  const issuerSigla = requiredSigla(values.issuerSigla ?? "", 1, "issuerSigla");
  const issuerPiva = values.issuerPiva ?? "";
  if (!/^\d{11}$/.test(issuerPiva)) {
    throw new MetelParseError(
      `Malformed issuer P.IVA ${JSON.stringify(issuerPiva)}`,
      { lineNo: 1, field: "issuerPiva" },
    );
  }
  if (!(values.listinoNumber ?? "")) {
    throw new MetelParseError("Listino number is blank", {
      lineNo: 1,
      field: "listinoNumber",
    });
  }

  return {
    fileType: "LSP",
    issuerSigla,
    issuerPiva,
    listinoNumber: values.listinoNumber ?? null,
    validFrom: values.validFrom ?? null,
    lastChangeDate: values.lastChangeDate ?? null,
    headerDescription: values.headerDescription || null,
    layoutVersion: version,
  };
}

function parsePriceListRows(
  lines: readonly string[],
  version: MetelLayoutVersion,
): ParsedPriceListRow[] {
  const layout = PRICE_LIST_LAYOUTS[version];
  return lines.slice(1).map((line, rowIndex) => {
    const lineNo = rowIndex + 2;
    if (line.length !== layout.lineLength) {
      throw new MetelParseError(
        `Invalid LSP line length ${line.length}; expected ${layout.lineLength}`,
        { lineNo },
      );
    }

    const values = {} as Record<PriceListFieldName, string | number | null>;
    for (const field of layout.fields) {
      values[field.name] = fieldValue(line, field, lineNo);
    }
    const marchio = requiredSigla(String(values.marchio ?? ""), lineNo, "marchio");
    const composto = Number(values.composto);
    if (composto !== 0 && composto !== 1) {
      throw new MetelParseError("Prodotto composto must be 0 or 1", {
        lineNo,
        field: "composto",
      });
    }

    return {
      lineNo,
      rawLine: line,
      marchio,
      codice: String(values.codice),
      ean: values.ean === null ? null : String(values.ean),
      descrizione: String(values.descrizione),
      qtaCartone: Number(values.qtaCartone),
      qtaMultipla: Number(values.qtaMultipla),
      qtaMinima: Number(values.qtaMinima),
      qtaMassima: Number(values.qtaMassima),
      leadTimeCode: String(values.leadTimeCode),
      prezzoRivenditoreCents: Number(values.prezzoRivenditoreCents),
      prezzoPubblicoCents: Number(values.prezzoPubblicoCents),
      moltiplicatore: Number(values.moltiplicatore),
      valuta: String(values.valuta),
      um: String(values.um),
      composto,
      statoCode: String(values.statoCode),
      dataVariazione: String(values.dataVariazione),
      famigliaSconto:
        values.famigliaSconto === null ? null : String(values.famigliaSconto),
      famigliaStatistica:
        values.famigliaStatistica === null
          ? null
          : String(values.famigliaStatistica),
      electrocod: null,
      extraV021:
        values.extraV021 === undefined ? null : String(values.extraV021),
    };
  });
}

function familyFileType(header: string): "FSC" | "FST" | null {
  if (header.startsWith(FAMILY_HEADERS.FSC)) {
    return "FSC";
  }
  if (header.startsWith(FAMILY_HEADERS.FST)) {
    return "FST";
  }
  return null;
}

function parseFamilySource(
  lines: readonly string[],
  fileType: "FSC" | "FST",
): ParsedMetelSource {
  const header = lines[0]!;
  if (header !== FAMILY_HEADERS[fileType].padEnd(FAMILY_LAYOUT.lineLength, " ")) {
    throw new MetelParseError(`Malformed ${fileType} header`, { lineNo: 1 });
  }
  if (lines.length === 1) {
    throw new MetelParseError(`${fileType} file has no family rows`);
  }

  const familyType: FamilyType = fileType === "FSC" ? "SCONTO" : "STATISTICA";
  let issuerSigla: string | undefined;
  const firstLineByFamilyKey = new Map<string, number>();
  const familyRows = lines.slice(1).map((line, rowIndex): ParsedFamilyRow => {
    const lineNo = rowIndex + 2;
    if (line.length !== FAMILY_LAYOUT.lineLength) {
      throw new MetelParseError(
        `Invalid ${fileType} line length ${line.length}; expected ${FAMILY_LAYOUT.lineLength}`,
        { lineNo },
      );
    }
    const slice = (field: { readonly start: number; readonly length: number }) =>
      line.slice(field.start, field.start + field.length).trimEnd();
    const rowIssuer = requiredSigla(
      slice(FAMILY_LAYOUT.fields.issuerSigla),
      lineNo,
      "issuerSigla",
    );
    if (issuerSigla !== undefined && issuerSigla !== rowIssuer) {
      throw new MetelParseError(
        `Family-file issuer ${rowIssuer} differs from ${issuerSigla}`,
        { lineNo, field: "issuerSigla" },
      );
    }
    issuerSigla = rowIssuer;
    const marchio = requiredSigla(
      slice(FAMILY_LAYOUT.fields.marchio),
      lineNo,
      "marchio",
    );
    const code = slice(FAMILY_LAYOUT.fields.code);
    if (!code) {
      throw new MetelParseError("Family code is blank", {
        lineNo,
        field: "code",
      });
    }
    const familyKey = `${rowIssuer}\0${marchio}\0${familyType}\0${code}`;
    const firstLine = firstLineByFamilyKey.get(familyKey);
    if (firstLine !== undefined) {
      throw new MetelParseError(
        `Duplicate family key first seen on line ${firstLine}: ${rowIssuer}/${marchio}/${familyType}/${code}`,
        { lineNo, field: "code" },
      );
    }
    firstLineByFamilyKey.set(familyKey, lineNo);

    return {
      lineNo,
      rawLine: line,
      familyType,
      issuerSigla: rowIssuer,
      marchio,
      code,
      description: slice(FAMILY_LAYOUT.fields.description),
    };
  });

  return {
    metadata: {
      fileType,
      issuerSigla: issuerSigla!,
      issuerPiva: null,
      listinoNumber: null,
      validFrom: null,
      lastChangeDate: null,
      headerDescription: null,
      layoutVersion: "020",
    },
    priceListRows: [],
    familyRows,
  };
}

export function parseMetelSource(sourceBytes: Uint8Array): ParsedMetelSource {
  const lines = sourceLines(sourceBytes);
  const header = lines[0]!;
  if (header.slice(0, 20).trimEnd() === "LISTINO METEL") {
    const metadata = parsePriceListHeader(header);
    return {
      metadata,
      priceListRows: parsePriceListRows(lines, metadata.layoutVersion),
      familyRows: [],
    };
  }

  const type = familyFileType(header);
  if (type !== null) {
    return parseFamilySource(lines, type);
  }
  throw new MetelParseError("Unrecognized or malformed METEL header", {
    lineNo: 1,
  });
}
