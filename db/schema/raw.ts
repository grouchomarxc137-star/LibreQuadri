import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const rawFile = sqliteTable(
  "raw_file",
  {
    id: integer("id").primaryKey(),
    fileSha256: text("file_sha256").notNull(),
    fileType: text("file_type", { enum: ["LSP", "FSC", "FST"] }).notNull(),
    originalFileName: text("original_file_name").notNull(),
    archivedPath: text("archived_path"),
    issuerSigla: text("issuer_sigla").notNull(),
    issuerPiva: text("issuer_piva"),
    listinoNumber: text("listino_number"),
    validFrom: text("valid_from"),
    lastChangeDate: text("last_change_date"),
    headerDescription: text("header_description"),
    layoutVersion: text("layout_version", { enum: ["020", "021"] }).notNull(),
    parsedAt: text("parsed_at").notNull(),
    status: text("status", { enum: ["parsed", "failed", "pruned"] }).notNull(),
    rowCount: integer("row_count").notNull(),
    warningCount: integer("warning_count").notNull().default(0),
    reportJson: text("report_json").notNull().default("{}"),
  },
  (table) => [
    uniqueIndex("raw_file_file_sha256_unique").on(table.fileSha256),
    check("raw_file_sha256_length", sql`length(${table.fileSha256}) = 64`),
    check(
      "raw_file_file_type_check",
      sql`${table.fileType} in ('LSP', 'FSC', 'FST')`,
    ),
    check(
      "raw_file_layout_version_check",
      sql`${table.layoutVersion} in ('020', '021')`,
    ),
    check(
      "raw_file_status_check",
      sql`${table.status} in ('parsed', 'failed', 'pruned')`,
    ),
    check("raw_file_row_count_check", sql`${table.rowCount} >= 0`),
    check("raw_file_warning_count_check", sql`${table.warningCount} >= 0`),
    check("raw_file_report_json_check", sql`json_valid(${table.reportJson})`),
  ],
);

export const priceListRow = sqliteTable(
  "price_list_row",
  {
    rawFileId: integer("raw_file_id")
      .notNull()
      .references(() => rawFile.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    rawLine: text("raw_line").notNull(),
    marchio: text("marchio").notNull(),
    codice: text("codice").notNull(),
    ean: text("ean"),
    descrizione: text("descrizione").notNull(),
    qtaCartone: integer("qta_cartone").notNull(),
    qtaMultipla: integer("qta_multipla").notNull(),
    qtaMinima: integer("qta_minima").notNull(),
    qtaMassima: integer("qta_massima").notNull(),
    leadTimeCode: text("lead_time_code").notNull(),
    prezzoRivenditoreCents: integer("prezzo_rivenditore_cents").notNull(),
    prezzoPubblicoCents: integer("prezzo_pubblico_cents").notNull(),
    moltiplicatore: integer("moltiplicatore").notNull(),
    valuta: text("valuta").notNull(),
    um: text("um").notNull(),
    composto: integer("composto").notNull(),
    statoCode: text("stato_code").notNull(),
    dataVariazione: text("data_variazione").notNull(),
    famigliaSconto: text("famiglia_sconto"),
    famigliaStatistica: text("famiglia_statistica"),
    electrocod: text("electrocod"),
    extraV021: text("extra_v021"),
  },
  (table) => [
    primaryKey({ columns: [table.rawFileId, table.lineNo] }),
    index("price_list_row_file_brand_code_idx").on(
      table.rawFileId,
      table.marchio,
      table.codice,
    ),
    check("price_list_row_line_no_check", sql`${table.lineNo} > 1`),
    check("price_list_row_composto_check", sql`${table.composto} in (0, 1)`),
  ],
);

export const familyRow = sqliteTable(
  "family_row",
  {
    rawFileId: integer("raw_file_id")
      .notNull()
      .references(() => rawFile.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    rawLine: text("raw_line").notNull(),
    familyType: text("family_type", {
      enum: ["SCONTO", "STATISTICA"],
    }).notNull(),
    issuerSigla: text("issuer_sigla").notNull(),
    marchio: text("marchio").notNull(),
    code: text("code").notNull(),
    description: text("description").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.rawFileId, table.lineNo] }),
    index("family_row_file_brand_code_idx").on(
      table.rawFileId,
      table.marchio,
      table.code,
    ),
    check(
      "family_row_family_type_check",
      sql`${table.familyType} in ('SCONTO', 'STATISTICA')`,
    ),
    check("family_row_line_no_check", sql`${table.lineNo} > 1`),
  ],
);
