import { createHash } from "node:crypto";

import Database from "better-sqlite3";

import type { FamilyType, MetelFileType } from "./parser.js";
import type { MetelLayoutVersion } from "./layouts.js";

export interface DeliverySourceHashes {
  readonly LSP: string;
  readonly FSC?: string;
  readonly FST?: string;
}

export interface DeliverySourceFile {
  readonly fileType: MetelFileType;
  readonly fileSha256: string;
  readonly originalFileName: string;
  readonly issuerSigla: string;
  readonly layoutVersion: MetelLayoutVersion;
  readonly rowCount: number;
}

export interface DeliveryPriceRow {
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
  readonly electrocod: string | null;
}

export interface DeliveryFamilyRow {
  readonly familyType: FamilyType;
  readonly issuerSigla: string;
  readonly marchio: string;
  readonly code: string;
  readonly description: string;
}

export interface AssembledMetelDelivery {
  readonly fingerprint: string;
  readonly issuerSigla: string;
  readonly issuerPiva: string;
  readonly listinoNumber: string;
  readonly validFrom: string;
  readonly files: readonly DeliverySourceFile[];
  readonly priceRows: readonly DeliveryPriceRow[];
  readonly familyRows: readonly DeliveryFamilyRow[];
}

interface RawFileRow {
  readonly id: number;
  readonly file_sha256: string;
  readonly file_type: MetelFileType;
  readonly original_file_name: string;
  readonly issuer_sigla: string;
  readonly issuer_piva: string | null;
  readonly listino_number: string | null;
  readonly valid_from: string | null;
  readonly layout_version: MetelLayoutVersion;
  readonly status: "parsed" | "failed" | "pruned";
  readonly row_count: number;
}

interface RawPriceRow {
  readonly marchio: string;
  readonly codice: string;
  readonly ean: string | null;
  readonly descrizione: string;
  readonly qta_cartone: number;
  readonly qta_multipla: number;
  readonly qta_minima: number;
  readonly qta_massima: number;
  readonly lead_time_code: string;
  readonly prezzo_rivenditore_cents: number;
  readonly prezzo_pubblico_cents: number;
  readonly moltiplicatore: number;
  readonly valuta: string;
  readonly um: string;
  readonly composto: number;
  readonly stato_code: string;
  readonly data_variazione: string;
  readonly famiglia_sconto: string | null;
  readonly famiglia_statistica: string | null;
  readonly electrocod: string | null;
}

interface RawFamilyRow {
  readonly family_type: FamilyType;
  readonly issuer_sigla: string;
  readonly marchio: string;
  readonly code: string;
  readonly description: string;
}

export class MetelDeliveryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetelDeliveryValidationError";
  }
}

function assertSha256(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new MetelDeliveryValidationError(`${label} is not a SHA-256 hex digest`);
  }
}

export function deliveryFingerprint(sources: DeliverySourceHashes): string {
  assertSha256(sources.LSP, "LSP source identity");
  if (sources.FSC !== undefined) {
    assertSha256(sources.FSC, "FSC source identity");
  }
  if (sources.FST !== undefined) {
    assertSha256(sources.FST, "FST source identity");
  }
  const identity = `LSP:${sources.LSP}|FSC:${sources.FSC ?? "-"}|FST:${
    sources.FST ?? "-"
  }`;
  return createHash("sha256").update(identity).digest("hex");
}

function loadRawFile(
  database: Database.Database,
  expectedType: MetelFileType,
  fileSha256: string,
): RawFileRow {
  assertSha256(fileSha256, `${expectedType} source identity`);
  const row = database
    .prepare(`
      SELECT id, file_sha256, file_type, original_file_name, issuer_sigla,
             issuer_piva, listino_number, valid_from, layout_version, status,
             row_count
      FROM raw_file
      WHERE file_sha256 = ?
    `)
    .get(fileSha256) as RawFileRow | undefined;
  if (!row) {
    throw new MetelDeliveryValidationError(
      `${expectedType} source ${fileSha256} is not present in metel_raw.db`,
    );
  }
  if (row.file_type !== expectedType) {
    throw new MetelDeliveryValidationError(
      `Expected ${expectedType} source but ${fileSha256} is ${row.file_type}`,
    );
  }
  if (row.status !== "parsed") {
    throw new MetelDeliveryValidationError(
      `${expectedType} source ${fileSha256} is ${row.status}, not parsed`,
    );
  }
  return row;
}

function sourceFile(row: RawFileRow): DeliverySourceFile {
  return {
    fileType: row.file_type,
    fileSha256: row.file_sha256,
    originalFileName: row.original_file_name,
    issuerSigla: row.issuer_sigla,
    layoutVersion: row.layout_version,
    rowCount: row.row_count,
  };
}

function loadPriceRows(
  database: Database.Database,
  rawFileId: number,
): DeliveryPriceRow[] {
  const rows = database
    .prepare(`
      SELECT marchio, codice, ean, descrizione, qta_cartone, qta_multipla,
             qta_minima, qta_massima, lead_time_code,
             prezzo_rivenditore_cents, prezzo_pubblico_cents, moltiplicatore,
             valuta, um, composto, stato_code, data_variazione,
             famiglia_sconto, famiglia_statistica, electrocod
      FROM price_list_row
      WHERE raw_file_id = ?
      ORDER BY line_no
    `)
    .all(rawFileId) as RawPriceRow[];
  return rows.map((row) => ({
    marchio: row.marchio,
    codice: row.codice,
    ean: row.ean,
    descrizione: row.descrizione,
    qtaCartone: row.qta_cartone,
    qtaMultipla: row.qta_multipla,
    qtaMinima: row.qta_minima,
    qtaMassima: row.qta_massima,
    leadTimeCode: row.lead_time_code,
    prezzoRivenditoreCents: row.prezzo_rivenditore_cents,
    prezzoPubblicoCents: row.prezzo_pubblico_cents,
    moltiplicatore: row.moltiplicatore,
    valuta: row.valuta,
    um: row.um,
    composto: row.composto,
    statoCode: row.stato_code,
    dataVariazione: row.data_variazione,
    famigliaSconto: row.famiglia_sconto,
    famigliaStatistica: row.famiglia_statistica,
    electrocod: row.electrocod,
  }));
}

function loadFamilyRows(
  database: Database.Database,
  rawFileId: number,
): DeliveryFamilyRow[] {
  const rows = database
    .prepare(`
      SELECT family_type, issuer_sigla, marchio, code, description
      FROM family_row
      WHERE raw_file_id = ?
      ORDER BY line_no
    `)
    .all(rawFileId) as RawFamilyRow[];
  return rows.map((row) => ({
    familyType: row.family_type,
    issuerSigla: row.issuer_sigla,
    marchio: row.marchio,
    code: row.code,
    description: row.description,
  }));
}

export function assertUniqueMetelDeliveryRows(
  priceRows: readonly DeliveryPriceRow[],
  familyRows: readonly DeliveryFamilyRow[],
): void {
  const productKeys = new Set<string>();
  for (const row of priceRows) {
    const key = `${row.marchio}\0${row.codice}`;
    if (productKeys.has(key)) {
      throw new MetelDeliveryValidationError(
        `Duplicate LSP product key ${row.marchio}/${row.codice}`,
      );
    }
    productKeys.add(key);
    if (row.moltiplicatore <= 0) {
      throw new MetelDeliveryValidationError(
        `Invalid price multiplier for ${row.marchio}/${row.codice}`,
      );
    }
  }

  const familyKeys = new Set<string>();
  for (const row of familyRows) {
    const key = `${row.issuerSigla}\0${row.marchio}\0${row.familyType}\0${row.code}`;
    if (familyKeys.has(key)) {
      throw new MetelDeliveryValidationError(
        `Duplicate family key ${row.issuerSigla}/${row.marchio}/${row.familyType}/${row.code}`,
      );
    }
    familyKeys.add(key);
  }
}

export function assembleMetelDelivery(
  database: Database.Database,
  sources: DeliverySourceHashes,
): AssembledMetelDelivery {
  const lsp = loadRawFile(database, "LSP", sources.LSP);
  const optionalFiles = [
    sources.FSC === undefined
      ? undefined
      : loadRawFile(database, "FSC", sources.FSC),
    sources.FST === undefined
      ? undefined
      : loadRawFile(database, "FST", sources.FST),
  ].filter((row): row is RawFileRow => row !== undefined);
  const rawFiles = [lsp, ...optionalFiles];

  for (const file of rawFiles) {
    if (file.issuer_sigla !== lsp.issuer_sigla) {
      throw new MetelDeliveryValidationError(
        `Delivery issuer mismatch: LSP is ${lsp.issuer_sigla}, ${file.file_type} is ${file.issuer_sigla}`,
      );
    }
  }
  if (!lsp.issuer_piva || !lsp.listino_number || !lsp.valid_from) {
    throw new MetelDeliveryValidationError(
      "LSP source is missing issuer P.IVA, listino number, or valid-from date",
    );
  }

  const priceRows = loadPriceRows(database, lsp.id);
  const familyRows = optionalFiles.flatMap((file) =>
    loadFamilyRows(database, file.id),
  );
  if (priceRows.length !== lsp.row_count) {
    throw new MetelDeliveryValidationError(
      `LSP row-count mismatch: metadata ${lsp.row_count}, stored ${priceRows.length}`,
    );
  }
  for (const file of optionalFiles) {
    const storedCount = familyRows.filter(
      (row) =>
        row.familyType === (file.file_type === "FSC" ? "SCONTO" : "STATISTICA"),
    ).length;
    if (storedCount !== file.row_count) {
      throw new MetelDeliveryValidationError(
        `${file.file_type} row-count mismatch: metadata ${file.row_count}, stored ${storedCount}`,
      );
    }
  }
  assertUniqueMetelDeliveryRows(priceRows, familyRows);

  return {
    fingerprint: deliveryFingerprint(sources),
    issuerSigla: lsp.issuer_sigla,
    issuerPiva: lsp.issuer_piva,
    listinoNumber: lsp.listino_number,
    validFrom: lsp.valid_from,
    files: rawFiles.map(sourceFile),
    priceRows,
    familyRows,
  };
}
