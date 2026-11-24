import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { parseMetelSource, type ParsedMetelSource } from "./parser.js";

interface ExistingRawFile {
  readonly id: number;
  readonly status: "parsed" | "failed" | "pruned";
  readonly row_count: number;
}

export interface IngestMetelFileOptions {
  readonly database: Database.Database;
  readonly sourceBytes: Uint8Array;
  readonly originalFileName: string;
  readonly archivedPath?: string | null;
  readonly parsedAt?: Date;
}

export interface IngestMetelPathOptions {
  readonly database: Database.Database;
  readonly sourcePath: string;
  readonly archivedPath?: string | null;
  readonly parsedAt?: Date;
}

export interface RawIngestionResult {
  readonly rawFileId: number;
  readonly fileSha256: string;
  readonly fileType: "LSP" | "FSC" | "FST";
  readonly rowCount: number;
  readonly alreadyParsed: boolean;
}

export function metelSourceSha256(sourceBytes: Uint8Array): string {
  return createHash("sha256").update(sourceBytes).digest("hex");
}

function existingRawFile(
  database: Database.Database,
  fileSha256: string,
): ExistingRawFile | undefined {
  return database
    .prepare(
      "SELECT id, status, row_count FROM raw_file WHERE file_sha256 = ?",
    )
    .get(fileSha256) as ExistingRawFile | undefined;
}

function insertRows(
  database: Database.Database,
  rawFileId: number,
  parsed: ParsedMetelSource,
): void {
  if (parsed.metadata.fileType === "LSP") {
    const insert = database.prepare(`
      INSERT INTO price_list_row (
        raw_file_id, line_no, raw_line, marchio, codice, ean, descrizione,
        qta_cartone, qta_multipla, qta_minima, qta_massima, lead_time_code,
        prezzo_rivenditore_cents, prezzo_pubblico_cents, moltiplicatore,
        valuta, um, composto, stato_code, data_variazione, famiglia_sconto,
        famiglia_statistica, electrocod, extra_v021
      ) VALUES (
        @rawFileId, @lineNo, @rawLine, @marchio, @codice, @ean, @descrizione,
        @qtaCartone, @qtaMultipla, @qtaMinima, @qtaMassima, @leadTimeCode,
        @prezzoRivenditoreCents, @prezzoPubblicoCents, @moltiplicatore,
        @valuta, @um, @composto, @statoCode, @dataVariazione, @famigliaSconto,
        @famigliaStatistica, @electrocod, @extraV021
      )
    `);
    for (const row of parsed.priceListRows) {
      insert.run({ rawFileId, ...row });
    }
    return;
  }

  const insert = database.prepare(`
    INSERT INTO family_row (
      raw_file_id, line_no, raw_line, family_type, issuer_sigla,
      marchio, code, description
    ) VALUES (
      @rawFileId, @lineNo, @rawLine, @familyType, @issuerSigla,
      @marchio, @code, @description
    )
  `);
  for (const row of parsed.familyRows) {
    insert.run({ rawFileId, ...row });
  }
}

export function ingestMetelFile(
  options: IngestMetelFileOptions,
): RawIngestionResult {
  const fileSha256 = metelSourceSha256(options.sourceBytes);
  const existing = existingRawFile(options.database, fileSha256);
  if (existing?.status === "parsed") {
    const fileType = options.database
      .prepare("SELECT file_type FROM raw_file WHERE id = ?")
      .pluck()
      .get(existing.id) as "LSP" | "FSC" | "FST";
    return {
      rawFileId: existing.id,
      fileSha256,
      fileType,
      rowCount: existing.row_count,
      alreadyParsed: true,
    };
  }

  const parsed = parseMetelSource(options.sourceBytes);
  const rowCount =
    parsed.metadata.fileType === "LSP"
      ? parsed.priceListRows.length
      : parsed.familyRows.length;
  const parsedAt = (options.parsedAt ?? new Date()).toISOString();
  const reportJson = JSON.stringify({ warnings: [] });

  const persist = options.database.transaction((): RawIngestionResult => {
    const concurrent = existingRawFile(options.database, fileSha256);
    if (concurrent?.status === "parsed") {
      return {
        rawFileId: concurrent.id,
        fileSha256,
        fileType: parsed.metadata.fileType,
        rowCount: concurrent.row_count,
        alreadyParsed: true,
      };
    }

    let rawFileId: number;
    if (concurrent) {
      options.database
        .prepare("DELETE FROM price_list_row WHERE raw_file_id = ?")
        .run(concurrent.id);
      options.database
        .prepare("DELETE FROM family_row WHERE raw_file_id = ?")
        .run(concurrent.id);
      options.database
        .prepare(`
          UPDATE raw_file SET
            file_type = @fileType,
            original_file_name = @originalFileName,
            archived_path = @archivedPath,
            issuer_sigla = @issuerSigla,
            issuer_piva = @issuerPiva,
            listino_number = @listinoNumber,
            valid_from = @validFrom,
            last_change_date = @lastChangeDate,
            header_description = @headerDescription,
            layout_version = @layoutVersion,
            parsed_at = @parsedAt,
            status = 'parsed',
            row_count = @rowCount,
            warning_count = 0,
            report_json = @reportJson
          WHERE id = @id
        `)
        .run({
          id: concurrent.id,
          ...parsed.metadata,
          originalFileName: options.originalFileName,
          archivedPath: options.archivedPath ?? null,
          parsedAt,
          rowCount,
          reportJson,
        });
      rawFileId = concurrent.id;
    } else {
      const inserted = options.database
        .prepare(`
          INSERT INTO raw_file (
            file_sha256, file_type, original_file_name, archived_path,
            issuer_sigla, issuer_piva, listino_number, valid_from,
            last_change_date, header_description, layout_version, parsed_at,
            status, row_count, warning_count, report_json
          ) VALUES (
            @fileSha256, @fileType, @originalFileName, @archivedPath,
            @issuerSigla, @issuerPiva, @listinoNumber, @validFrom,
            @lastChangeDate, @headerDescription, @layoutVersion, @parsedAt,
            'parsed', @rowCount, 0, @reportJson
          )
        `)
        .run({
          fileSha256,
          ...parsed.metadata,
          originalFileName: options.originalFileName,
          archivedPath: options.archivedPath ?? null,
          parsedAt,
          rowCount,
          reportJson,
        });
      rawFileId = Number(inserted.lastInsertRowid);
    }

    insertRows(options.database, rawFileId, parsed);
    return {
      rawFileId,
      fileSha256,
      fileType: parsed.metadata.fileType,
      rowCount,
      alreadyParsed: false,
    };
  });

  return persist();
}

export function ingestMetelFileFromPath(
  options: IngestMetelPathOptions,
): RawIngestionResult {
  return ingestMetelFile({
    database: options.database,
    sourceBytes: readFileSync(options.sourcePath),
    originalFileName: path.basename(options.sourcePath),
    archivedPath: options.archivedPath,
    parsedAt: options.parsedAt,
  });
}
