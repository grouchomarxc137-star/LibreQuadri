import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { openMigratedLqDatabase } from "../src/main/database/lq-migrations.js";
import { openMigratedRawDatabase } from "../src/main/database/raw-migrations.js";
import { closeConfiguredDatabase } from "../src/main/database/sqlite-connection.js";
import {
  normalizeMetelDelivery,
  OlderDeliveryConfirmationRequiredError,
} from "../src/main/metel/catalogue-normalization.js";
import {
  deliveryFingerprint,
  MetelDeliveryValidationError,
  type DeliverySourceHashes,
} from "../src/main/metel/delivery.js";
import { ingestMetelFileFromPath } from "../src/main/metel/raw-ingestion.js";
import { getCatalogueOverview, getUnclassifiedFamilies, searchCatalogue } from "../src/main/catalogue/catalogue-queries.js";

const temporaryDirectories: string[] = [];
const openDatabases: Database.Database[] = [];
const lqMigrations = path.resolve("db", "migrations", "lq");
const rawMigrations = path.resolve("db", "migrations", "raw");

interface FixtureProduct {
  readonly marchio: string;
  readonly code: string;
  readonly description?: string;
  readonly priceCents?: number;
  readonly multiplier?: number;
  readonly discountFamily?: string | null;
  readonly statisticalFamily?: string | null;
}

interface FixtureFamily {
  readonly marchio: string;
  readonly code: string;
  readonly description: string;
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "librequadri-normalization-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function databases(): {
  readonly lq: Database.Database;
  readonly raw: Database.Database;
} {
  const root = temporaryDirectory();
  const raw = openMigratedRawDatabase({
    databaseFilename: path.join(root, "metel_raw.db"),
    migrationsFolder: rawMigrations,
  });
  const lq = openMigratedLqDatabase({
    databaseFilename: path.join(root, "lq.db"),
    backupDirectory: path.join(root, "backups"),
    migrationsFolder: lqMigrations,
  });
  openDatabases.push(lq, raw);
  return { lq, raw };
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function insertLsp(
  database: Database.Database,
  options: {
    readonly issuer: string;
    readonly piva: string;
    readonly listino: string;
    readonly validFrom: string;
    readonly products: readonly FixtureProduct[];
    readonly identity?: string;
  },
): string {
  const identity =
    options.identity ??
    JSON.stringify({
      type: "LSP",
      ...options,
    });
  const fileSha256 = sha(identity);
  const inserted = database
    .prepare(`
      INSERT INTO raw_file (
        file_sha256, file_type, original_file_name, issuer_sigla, issuer_piva,
        listino_number, valid_from, last_change_date, header_description,
        layout_version, parsed_at, status, row_count, warning_count, report_json
      ) VALUES (?, 'LSP', ?, ?, ?, ?, ?, ?, 'Fixture', '020', ?, 'parsed', ?, 0, '{}')
    `)
    .run(
      fileSha256,
      `${options.issuer}-listino.txt`,
      options.issuer,
      options.piva,
      options.listino,
      options.validFrom,
      options.validFrom,
      "2026-09-21T00:00:00.000Z",
      options.products.length,
    );
  const rawFileId = Number(inserted.lastInsertRowid);
  const insertRow = database.prepare(`
    INSERT INTO price_list_row (
      raw_file_id, line_no, raw_line, marchio, codice, ean, descrizione,
      qta_cartone, qta_multipla, qta_minima, qta_massima, lead_time_code,
      prezzo_rivenditore_cents, prezzo_pubblico_cents, moltiplicatore,
      valuta, um, composto, stato_code, data_variazione, famiglia_sconto,
      famiglia_statistica, electrocod, extra_v021
    ) VALUES (
      @rawFileId, @lineNo, 'fixture', @marchio, @code, NULL, @description,
      1, 1, 1, 999999, '1', @priceCents, @priceCents, @multiplier,
      'EUR', 'PCE', 0, '1', @validFrom, @discountFamily,
      @statisticalFamily, NULL, NULL
    )
  `);
  options.products.forEach((product, index) => {
    insertRow.run({
      rawFileId,
      lineNo: index + 2,
      marchio: product.marchio,
      code: product.code,
      description: product.description ?? `${product.marchio} ${product.code}`,
      priceCents: product.priceCents ?? 100,
      multiplier: product.multiplier ?? 1,
      validFrom: options.validFrom,
      discountFamily: product.discountFamily ?? null,
      statisticalFamily: product.statisticalFamily ?? null,
    });
  });
  return fileSha256;
}

function insertFamilyFile(
  database: Database.Database,
  options: {
    readonly issuer: string;
    readonly type: "FSC" | "FST";
    readonly families: readonly FixtureFamily[];
    readonly identity?: string;
  },
): string {
  const fileSha256 = sha(
    options.identity ?? JSON.stringify(options),
  );
  const inserted = database
    .prepare(`
      INSERT INTO raw_file (
        file_sha256, file_type, original_file_name, issuer_sigla,
        layout_version, parsed_at, status, row_count, warning_count, report_json
      ) VALUES (?, ?, ?, ?, '020', ?, 'parsed', ?, 0, '{}')
    `)
    .run(
      fileSha256,
      options.type,
      `${options.issuer}-${options.type}.txt`,
      options.issuer,
      "2026-09-21T00:00:00.000Z",
      options.families.length,
    );
  const rawFileId = Number(inserted.lastInsertRowid);
  const insertRow = database.prepare(`
    INSERT INTO family_row (
      raw_file_id, line_no, raw_line, family_type, issuer_sigla,
      marchio, code, description
    ) VALUES (?, ?, 'fixture', ?, ?, ?, ?, ?)
  `);
  options.families.forEach((family, index) => {
    insertRow.run(
      rawFileId,
      index + 2,
      options.type === "FSC" ? "SCONTO" : "STATISTICA",
      options.issuer,
      family.marchio,
      family.code,
      family.description,
    );
  });
  return fileSha256;
}

function count(database: Database.Database, table: string): number {
  return (
    database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      readonly count: number;
    }
  ).count;
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    closeConfiguredDatabase(database);
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("METEL delivery assembly and catalogue normalization", () => {
  it("keeps issuer, brand and manufacturer separate and keys products by brand plus code", () => {
    const { lq, raw } = databases();
    const firstLsp = insertLsp(raw, {
      issuer: "ONE",
      piva: "11111111111",
      listino: "ONE001",
      validFrom: "2026-01-01",
      products: [
        { marchio: "AAA", code: "SAME", priceCents: 12_345, multiplier: 1_000 },
        { marchio: "BBB", code: "SAME" },
      ],
    });
    const first = normalizeMetelDelivery({
      lqDatabase: lq,
      rawDatabase: raw,
      sources: { LSP: firstLsp },
      normalizedAt: new Date("2026-01-02T00:00:00Z"),
    });
    const brandId = lq.prepare("SELECT id FROM cat_brand WHERE metel_marchio='AAA'").pluck().get() as number;
    const dimension = lq.prepare(`INSERT INTO cat_config_dimension(brand_id,code,name,source)
      VALUES(?,'tq.label.51','Taratura','manual')`).run(brandId);
    lq.prepare(`INSERT INTO cat_config_dimension_value(dimension_id,code,label,source)
      VALUES(?,'tq.value.146','Changed','manual')`).run(Number(dimension.lastInsertRowid));
    const secondLsp = insertLsp(raw, {
      issuer: "TWO",
      piva: "22222222222",
      listino: "TWO001",
      validFrom: "2026-02-01",
      products: [{ marchio: "AAA", code: "SAME", description: "Issuer two" }],
    });
    const second = normalizeMetelDelivery({
      lqDatabase: lq,
      rawDatabase: raw,
      sources: { LSP: secondLsp },
      normalizedAt: new Date("2026-02-02T00:00:00Z"),
    });

    expect(first.summary).toMatchObject({ brandCount: 2, productCount: 2 });
    expect(first.summary.engineeringVocabularyWarnings?.deferred.count).toBeGreaterThanOrEqual(171);
    expect(first.summary.engineeringVocabularyWarnings?.stale.count).toBe(0);
    expect(second.summary.engineeringVocabularyWarnings?.stale).toEqual({count:1,sampleKeys:["tq.label.51/tq.value.146"]});
    expect(JSON.parse(lq.prepare("SELECT summary_json FROM app_import_delivery WHERE id=?").pluck().get(first.deliveryId) as string))
      .toMatchObject({engineeringVocabularyWarnings:first.summary.engineeringVocabularyWarnings});
    expect(count(lq, "cat_metel_issuer")).toBe(2);
    expect(count(lq, "cat_brand")).toBe(2);
    expect(count(lq, "cat_manufacturer")).toBe(0);
    expect(count(lq, "cat_product")).toBe(2);
    expect(count(lq, "cat_product_listing")).toBe(3);
    expect(count(lq, "cat_issuer_brand")).toBe(3);
    expect(
      lq
        .prepare("SELECT COUNT(*) FROM cat_brand WHERE manufacturer_id IS NULL")
        .pluck()
        .get(),
    ).toBe(2);
    expect(
      lq
        .prepare(`
          SELECT i.metel_sigla
          FROM cat_product p
          JOIN cat_brand b ON b.id = p.brand_id
          JOIN cat_metel_issuer i ON i.id = p.governing_issuer_id
          WHERE b.metel_marchio = 'AAA' AND p.manufacturer_code = 'SAME'
        `)
        .pluck()
        .get(),
    ).toBe("TWO");
    expect(
      lq
        .prepare(`
          SELECT list_price_e4, list_price_unit_e4
          FROM com_product_price ORDER BY price_list_id LIMIT 1
        `)
        .get(),
    ).toEqual({ list_price_e4: 1_234_500, list_price_unit_e4: 1_235 });
  });

  it("fingerprints member SHA identities and treats changed family files as new deliveries", () => {
    const { lq, raw } = databases();
    const lsp = insertLsp(raw, {
      issuer: "ONE",
      piva: "11111111111",
      listino: "ONE001",
      validFrom: "2026-01-01",
      products: [{ marchio: "AAA", code: "P1", discountFamily: "D1" }],
    });
    const fscOne = insertFamilyFile(raw, {
      issuer: "ONE",
      type: "FSC",
      identity: "family-v1",
      families: [{ marchio: "AAA", code: "D1", description: "First" }],
    });
    const fscTwo = insertFamilyFile(raw, {
      issuer: "ONE",
      type: "FSC",
      identity: "family-v2",
      families: [{ marchio: "AAA", code: "D1", description: "Second" }],
    });
    const firstSources: DeliverySourceHashes = { LSP: lsp, FSC: fscOne };
    const secondSources: DeliverySourceHashes = { LSP: lsp, FSC: fscTwo };
    expect(deliveryFingerprint(firstSources)).not.toBe(
      deliveryFingerprint(secondSources),
    );

    const first = normalizeMetelDelivery({
      lqDatabase: lq,
      rawDatabase: raw,
      sources: firstSources,
    });
    const repeated = normalizeMetelDelivery({
      lqDatabase: lq,
      rawDatabase: raw,
      sources: firstSources,
    });
    const second = normalizeMetelDelivery({
      lqDatabase: lq,
      rawDatabase: raw,
      sources: secondSources,
    });

    expect(repeated).toMatchObject({
      deliveryId: first.deliveryId,
      alreadyNormalized: true,
    });
    expect(second.deliveryId).not.toBe(first.deliveryId);
    expect(second.becameCurrent).toBe(true);
    expect(count(lq, "app_import_delivery")).toBe(2);
    expect(
      lq.prepare("SELECT COUNT(*) FROM com_price_list WHERE is_current = 1").pluck().get(),
    ).toBe(1);
    expect(
      lq
        .prepare("SELECT COUNT(*) FROM app_import_file WHERE file_sha256 = ?")
        .pluck()
        .get(lsp),
    ).toBe(2);
    expect(
      lq.prepare("SELECT description FROM cat_metel_family").pluck().get(),
    ).toBe("Second");
  });

  it("rejects mixed-issuer deliveries and duplicate LSP product identities", () => {
    const { lq, raw } = databases();
    const lsp = insertLsp(raw, {
      issuer: "ONE",
      piva: "11111111111",
      listino: "ONE001",
      validFrom: "2026-01-01",
      products: [{ marchio: "AAA", code: "P1" }],
    });
    const wrongIssuerFamily = insertFamilyFile(raw, {
      issuer: "TWO",
      type: "FSC",
      families: [{ marchio: "AAA", code: "D1", description: "Wrong issuer" }],
    });
    expect(() =>
      normalizeMetelDelivery({
        lqDatabase: lq,
        rawDatabase: raw,
        sources: { LSP: lsp, FSC: wrongIssuerFamily },
      }),
    ).toThrow(/Delivery issuer mismatch/);

    const duplicateLsp = insertLsp(raw, {
      issuer: "DUP",
      piva: "33333333333",
      listino: "DUP001",
      validFrom: "2026-01-01",
      products: [
        { marchio: "AAA", code: "P1" },
        { marchio: "AAA", code: "P1" },
      ],
    });
    expect(() =>
      normalizeMetelDelivery({
        lqDatabase: lq,
        rawDatabase: raw,
        sources: { LSP: duplicateLsp },
      }),
    ).toThrow(MetelDeliveryValidationError);
    expect(count(lq, "app_import_delivery")).toBe(0);
  });

  it("stores unknown family references without inventing descriptions", () => {
    const { lq, raw } = databases();
    const lsp = insertLsp(raw, {
      issuer: "ONE",
      piva: "11111111111",
      listino: "ONE001",
      validFrom: "2026-01-01",
      products: [
        {
          marchio: "AAA",
          code: "P1",
          discountFamily: "UNKNOWN-D",
          statisticalFamily: "UNKNOWN-S",
        },
      ],
    });
    const result = normalizeMetelDelivery({
      lqDatabase: lq,
      rawDatabase: raw,
      sources: { LSP: lsp },
    });

    expect(result.summary.unknownFamilyCount).toBe(2);
    expect(
      lq
        .prepare(
          "SELECT code, description, is_known FROM cat_metel_family ORDER BY code",
        )
        .all(),
    ).toEqual([
      { code: "UNKNOWN-D", description: null, is_known: 0 },
      { code: "UNKNOWN-S", description: null, is_known: 0 },
    ]);
  });

  it("requires confirmation for older deliveries and never lets them delist or govern", () => {
    const { lq, raw } = databases();
    const current = insertLsp(raw, {
      issuer: "ONE",
      piva: "11111111111",
      listino: "CUR001",
      validFrom: "2026-01-01",
      products: [
        {
          marchio: "AAA",
          code: "A",
          description: "A current",
          discountFamily: "D1",
        },
        { marchio: "AAA", code: "B", description: "B current" },
      ],
    });
    const currentFamilies = insertFamilyFile(raw, {
      issuer: "ONE",
      type: "FSC",
      families: [{ marchio: "AAA", code: "D1", description: "Current family" }],
    });
    normalizeMetelDelivery({
      lqDatabase: lq,
      rawDatabase: raw,
      sources: { LSP: current, FSC: currentFamilies },
    });
    const older = insertLsp(raw, {
      issuer: "ONE",
      piva: "11111111111",
      listino: "OLD001",
      validFrom: "2025-01-01",
      products: [
        {
          marchio: "AAA",
          code: "A",
          description: "A old",
          discountFamily: "D1",
        },
        { marchio: "AAA", code: "C", description: "C old" },
      ],
    });
    const olderFamilies = insertFamilyFile(raw, {
      issuer: "ONE",
      type: "FSC",
      identity: "older-families",
      families: [{ marchio: "AAA", code: "D1", description: "Older family" }],
    });

    expect(() =>
      normalizeMetelDelivery({
        lqDatabase: lq,
        rawDatabase: raw,
        sources: { LSP: older, FSC: olderFamilies },
      }),
    ).toThrow(OlderDeliveryConfirmationRequiredError);
    expect(count(lq, "app_import_delivery")).toBe(1);

    const accepted = normalizeMetelDelivery({
      lqDatabase: lq,
      rawDatabase: raw,
      sources: { LSP: older, FSC: olderFamilies },
      acceptOlderDelivery: true,
    });
    expect(accepted.becameCurrent).toBe(false);
    expect(
      lq
        .prepare(
          "SELECT manufacturer_code, short_description, is_listed FROM cat_product ORDER BY manufacturer_code",
        )
        .all(),
    ).toEqual([
      { manufacturer_code: "A", short_description: "A current", is_listed: 1 },
      { manufacturer_code: "B", short_description: "B current", is_listed: 1 },
      { manufacturer_code: "C", short_description: null, is_listed: 0 },
    ]);
    expect(
      lq
        .prepare("SELECT listino_number FROM com_price_list WHERE is_current = 1")
        .pluck()
        .get(),
    ).toBe("CUR001");
    expect(
      lq.prepare("SELECT description FROM cat_metel_family").pluck().get(),
    ).toBe("Current family");

    const newer = insertLsp(raw, {
      issuer: "ONE",
      piva: "11111111111",
      listino: "NEW001",
      validFrom: "2027-01-01",
      products: [{ marchio: "AAA", code: "A", description: "A new" }],
    });
    normalizeMetelDelivery({
      lqDatabase: lq,
      rawDatabase: raw,
      sources: { LSP: newer },
    });
    expect(
      lq
        .prepare(
          "SELECT manufacturer_code, is_listed FROM cat_product ORDER BY manufacturer_code",
        )
        .all(),
    ).toEqual([
      { manufacturer_code: "A", is_listed: 1 },
      { manufacturer_code: "B", is_listed: 0 },
      { manufacturer_code: "C", is_listed: 0 },
    ]);
  });

  it("applies preferred, latest-listed and fallback governing-listing rules", () => {
    const { lq, raw } = databases();
    const issuerOne = insertLsp(raw, {
      issuer: "ONE",
      piva: "11111111111",
      listino: "ONE001",
      validFrom: "2026-01-01",
      products: [{ marchio: "AAA", code: "P1", description: "From one" }],
    });
    normalizeMetelDelivery({
      lqDatabase: lq,
      rawDatabase: raw,
      sources: { LSP: issuerOne },
      normalizedAt: new Date("2026-01-02T00:00:00Z"),
    });
    const issuerTwo = insertLsp(raw, {
      issuer: "TWO",
      piva: "22222222222",
      listino: "TWO001",
      validFrom: "2027-01-01",
      products: [{ marchio: "AAA", code: "P1", description: "From two" }],
    });
    normalizeMetelDelivery({
      lqDatabase: lq,
      rawDatabase: raw,
      sources: { LSP: issuerTwo },
      normalizedAt: new Date("2027-01-02T00:00:00Z"),
    });
    expect(
      lq.prepare("SELECT short_description FROM cat_product").pluck().get(),
    ).toBe("From two");

    lq.exec(`
      UPDATE cat_brand
      SET preferred_issuer_id = (
        SELECT id FROM cat_metel_issuer WHERE metel_sigla = 'ONE'
      )
    `);
    const issuerTwoRefresh = insertLsp(raw, {
      issuer: "TWO",
      piva: "22222222222",
      listino: "TWO002",
      validFrom: "2028-01-01",
      products: [{ marchio: "AAA", code: "P1", description: "From two newer" }],
    });
    normalizeMetelDelivery({
      lqDatabase: lq,
      rawDatabase: raw,
      sources: { LSP: issuerTwoRefresh },
    });
    expect(
      lq.prepare("SELECT short_description FROM cat_product").pluck().get(),
    ).toBe("From one");

    const issuerOneWithoutProduct = insertLsp(raw, {
      issuer: "ONE",
      piva: "11111111111",
      listino: "ONE002",
      validFrom: "2029-01-01",
      products: [{ marchio: "AAA", code: "OTHER" }],
    });
    normalizeMetelDelivery({
      lqDatabase: lq,
      rawDatabase: raw,
      sources: { LSP: issuerOneWithoutProduct },
    });
    expect(
      lq
        .prepare(`
          SELECT p.short_description, i.metel_sigla
          FROM cat_product p
          JOIN cat_metel_issuer i ON i.id = p.governing_issuer_id
          WHERE p.manufacturer_code = 'P1'
        `)
        .get(),
    ).toEqual({ short_description: "From two newer", metel_sigla: "TWO" });

    const issuerTwoWithoutProduct = insertLsp(raw, {
      issuer: "TWO",
      piva: "22222222222",
      listino: "TWO003",
      validFrom: "2030-01-01",
      products: [{ marchio: "AAA", code: "OTHER-TWO" }],
    });
    normalizeMetelDelivery({
      lqDatabase: lq,
      rawDatabase: raw,
      sources: { LSP: issuerTwoWithoutProduct },
    });
    expect(
      lq
        .prepare(`
          SELECT p.short_description, p.is_listed, i.metel_sigla
          FROM cat_product p
          JOIN cat_metel_issuer i ON i.id = p.governing_issuer_id
          WHERE p.manufacturer_code = 'P1'
        `)
        .get(),
    ).toEqual({
      short_description: "From two newer",
      is_listed: 0,
      metel_sigla: "TWO",
    });
  });

  it("rolls back every lq.db change when normalization fails", () => {
    const { lq, raw } = databases();
    const lsp = insertLsp(raw, {
      issuer: "ONE",
      piva: "11111111111",
      listino: "ONE001",
      validFrom: "2026-01-01",
      products: [{ marchio: "AAA", code: "P1" }],
    });
    lq.exec(`
      CREATE TRIGGER fail_price BEFORE INSERT ON com_product_price
      BEGIN SELECT RAISE(ABORT, 'forced normalization failure'); END;
    `);

    expect(() =>
      normalizeMetelDelivery({
        lqDatabase: lq,
        rawDatabase: raw,
        sources: { LSP: lsp },
      }),
    ).toThrow("forced normalization failure");
    expect(count(lq, "app_import_delivery")).toBe(0);
    expect(count(lq, "cat_metel_issuer")).toBe(0);
    expect(count(lq, "cat_product")).toBe(0);
    expect(count(raw, "raw_file")).toBe(1);
  });

  it("resolves a deferred engineering brand mapping in the delivery that creates its METEL brand", () => {
    const { lq, raw } = databases();
    const firstLsp = insertLsp(raw, {
      issuer: "ONE", piva: "11111111111", listino: "ONE001", validFrom: "2026-01-01",
      products: [{ marchio: "AAA", code: "P1" }],
    });
    normalizeMetelDelivery({ lqDatabase: lq, rawDatabase: raw, sources: { LSP: firstLsp } });
    expect(count(lq, "cat_capacity_kind")).toBe(6);
    expect(lq.prepare("SELECT display_divisor FROM cat_capacity_kind WHERE code='din_rail'").pluck().get()).toBe(2);
    expect(lq.prepare("SELECT brand_id FROM cat_source_brand_map WHERE source_brand_code='BT-'").get()).toBeUndefined();
    expect(lq.prepare("SELECT brand_id FROM cat_source_brand_map WHERE source_brand_code='CT-'").pluck().get()).toBeNull();

    const secondLsp = insertLsp(raw, {
      issuer: "ONE", piva: "11111111111", listino: "ONE002", validFrom: "2026-02-01",
      products: [{ marchio: "BTI", code: "FN82C16" }],
    });
    const result = normalizeMetelDelivery({ lqDatabase: lq, rawDatabase: raw, sources: { LSP: secondLsp } });
    expect(result.alreadyNormalized).toBe(false);
    expect(lq.prepare(`SELECT m.brand_id FROM cat_source_brand_map m
      JOIN cat_brand b ON b.id=m.brand_id
      WHERE m.adapter_code='tiquadri' AND m.source_brand_code='BT-' AND b.metel_marchio='BTI'`).pluck().get())
      .toBe(lq.prepare("SELECT id FROM cat_brand WHERE metel_marchio='BTI'").pluck().get());
    expect(count(lq, "cat_capacity_kind")).toBe(6);
    expect(count(lq, "app_import_delivery")).toBe(2);
    expect(count(lq, "cat_product")).toBe(2);
  });

  it("rolls back engineering seeds and the delivery when a later catalogue seed fails", () => {
    const { lq, raw } = databases();
    const lsp = insertLsp(raw, {
      issuer: "ONE", piva: "11111111111", listino: "ONE001", validFrom: "2026-01-01",
      products: [{ marchio: "BTI", code: "FN82C16" }],
    });
    lq.exec(`CREATE TRIGGER fail_category_seed BEFORE INSERT ON cat_category
      BEGIN SELECT RAISE(ABORT, 'forced catalogue seed failure'); END;`);
    expect(() => normalizeMetelDelivery({ lqDatabase: lq, rawDatabase: raw, sources: { LSP: lsp } }))
      .toThrow("forced catalogue seed failure");
    expect(count(lq, "cat_capacity_kind")).toBe(0);
    expect(count(lq, "cat_source_brand_map")).toBe(0);
    expect(count(lq, "cat_brand")).toBe(0);
    expect(count(lq, "cat_product")).toBe(0);
    expect(count(lq, "app_import_delivery")).toBe(0);
    expect(count(raw, "raw_file")).toBe(1);
    expect(lq.pragma("foreign_key_check")).toEqual([]);
  });

  it("uses source SHA identities and remains independent of rebuilt raw row IDs", () => {
    const first = databases();
    const sources = {
      LSP: insertLsp(first.raw, {
        issuer: "ONE",
        piva: "11111111111",
        listino: "ONE001",
        validFrom: "2026-01-01",
        products: [{ marchio: "AAA", code: "P1" }],
        identity: "stable-lsp",
      }),
    };
    normalizeMetelDelivery({
      lqDatabase: first.lq,
      rawDatabase: first.raw,
      sources,
    });
    const originalRawId = first.raw
      .prepare("SELECT id FROM raw_file WHERE file_sha256 = ?")
      .pluck()
      .get(sources.LSP);

    const rebuiltRoot = temporaryDirectory();
    const rebuilt = openMigratedRawDatabase({
      databaseFilename: path.join(rebuiltRoot, "metel_raw.db"),
      migrationsFolder: rawMigrations,
    });
    openDatabases.push(rebuilt);
    insertFamilyFile(rebuilt, {
      issuer: "ZZZ",
      type: "FSC",
      families: [{ marchio: "ZZZ", code: "DUMMY", description: "Dummy" }],
    });
    const rebuiltSha = insertLsp(rebuilt, {
      issuer: "ONE",
      piva: "11111111111",
      listino: "ONE001",
      validFrom: "2026-01-01",
      products: [{ marchio: "AAA", code: "P1" }],
      identity: "stable-lsp",
    });
    const rebuiltRawId = rebuilt
      .prepare("SELECT id FROM raw_file WHERE file_sha256 = ?")
      .pluck()
      .get(rebuiltSha);
    expect(rebuiltRawId).not.toBe(originalRawId);

    const repeated = normalizeMetelDelivery({
      lqDatabase: first.lq,
      rawDatabase: rebuilt,
      sources: { LSP: rebuiltSha },
    });
    expect(repeated.alreadyNormalized).toBe(true);
    expect(
      first.lq
        .prepare("SELECT file_sha256 FROM app_import_file")
        .pluck()
        .get(),
    ).toBe(sources.LSP);
    expect(
      first.lq
        .prepare("PRAGMA table_info(app_import_file)")
        .all()
        .some((column) =>
          String((column as { readonly name: string }).name).includes("raw_file"),
        ),
    ).toBe(false);
  });
});

const sampleRoot = process.env["LIBREQUADRI_METEL_DIR"] ?? "";
const realSampleSets = [
  {
    issuer: "BTI",
    LSP: path.join(sampleRoot, "BTILSP021.txt", "BTILSP021.txt"),
    FSC: path.join(sampleRoot, "BTIFSC.txt", "BTIFSC.txt"),
    FST: path.join(sampleRoot, "BTIFST.txt", "BTIFST.txt"),
  },
  {
    issuer: "SIE",
    LSP: path.join(sampleRoot, "SIELSP_20260701.txt", "SIELSP_20260701.txt"),
    FSC: path.join(sampleRoot, "SIEFSC.TXT", "SIEFSC.TXT"),
    FST: path.join(sampleRoot, "SIEFST.TXT", "SIEFST.TXT"),
  },
  {
    issuer: "SNR",
    LSP: path.join(sampleRoot, "SNRLSP021.txt", "SNRLSP021.txt"),
    FSC: path.join(sampleRoot, "SNRFSC.txt", "SNRFSC.txt"),
    FST: path.join(sampleRoot, "SNRFST.txt", "SNRFST.txt"),
  },
] as const;
const realSamplesAvailable = realSampleSets.every((set) =>
  [set.LSP, set.FSC, set.FST].every(existsSync),
);

describe.runIf(realSamplesAvailable)("real METEL catalogue normalization", () => {
  it(
    "normalizes BTI, SIE and SNR into one independent multi-brand catalogue",
    { timeout: 120_000 },
    () => {
      const { lq, raw } = databases();
      for (const [index, sample] of realSampleSets.entries()) {
        const lsp = ingestMetelFileFromPath({
          database: raw,
          sourcePath: sample.LSP,
        });
        const fsc = ingestMetelFileFromPath({
          database: raw,
          sourcePath: sample.FSC,
        });
        const fst = ingestMetelFileFromPath({
          database: raw,
          sourcePath: sample.FST,
        });
        const result = normalizeMetelDelivery({
          lqDatabase: lq,
          rawDatabase: raw,
          sources: {
            LSP: lsp.fileSha256,
            FSC: fsc.fileSha256,
            FST: fst.fileSha256,
          },
          normalizedAt: new Date(`2026-09-21T0${index}:00:00Z`),
        });
        expect(result.summary.unknownFamilyCount).toBe(0);
      }

      expect(count(lq, "cat_metel_issuer")).toBe(3);
      expect(count(lq, "cat_brand")).toBe(9);
      expect(count(lq, "cat_manufacturer")).toBe(0);
      expect(count(lq, "cat_issuer_brand")).toBe(9);
      expect(count(lq, "cat_metel_family")).toBe(1_114);
      expect(count(lq, "cat_product")).toBe(122_535);
      const categoryCounts = lq.prepare(`SELECT c.code, COUNT(*) AS count FROM cat_product p
        JOIN cat_category c ON c.id = p.category_id JOIN cat_brand b ON b.id=p.brand_id
        WHERE b.metel_marchio='BTI' GROUP BY c.code ORDER BY c.code`).all();
      expect(categoryCounts).toEqual([
        { code: "protezione.blocchi_differenziali", count: 71 },
        { code: "protezione.differenziali_puri", count: 107 },
        { code: "protezione.interruttori_automatici", count: 554 },
        { code: "protezione.magnetotermici_differenziali", count: 136 },
        { code: "protezione.rilevatori_arco", count: 4 },
      ]);
      expect(lq.prepare(`SELECT b.metel_marchio AS brand, COUNT(*) AS count FROM cat_product p
        JOIN cat_brand b ON b.id = p.brand_id WHERE p.category_id IS NOT NULL GROUP BY b.id ORDER BY brand`).all()).toEqual([{ brand: "BTI", count: 872 }, { brand: "SIE", count: 64981 }]);
      expect(lq.prepare(`SELECT COUNT(*) FROM cat_product WHERE category_id IS NOT NULL
        AND (category_source <> 'mapping' OR category_mapping_id IS NULL)`).pluck().get()).toBe(0);
      for (const [code, expected] of [
        ["FN81C63", "interruttori_automatici"], ["FV82SM125", "interruttori_automatici"],
        ["GN8813A16", "magnetotermici_differenziali"], ["G723B40", "differenziali_puri"],
        ["G23A32", "blocchi_differenziali"], ["FC881C10ARC", "rilevatori_arco"],
        ["AM5206S", null], ["F10A", null],
      ] as const) {
        const product = searchCatalogue(lq, { query: code }).products.find(p => p.brandMarchio === "BTI" && p.manufacturerCode === code);
        expect(product, code).toBeDefined();
        expect(product!.category?.code ?? null, code).toBe(expected === null ? null : `protezione.${expected}`);
      }
      expect(getCatalogueOverview(lq)).toMatchObject({ classifiedProductCount: 65853, unclassifiedProductCount: 56682, listedUnclassifiedProductCount: 56682 });
      let unclassified = 0;
      for (let offset = 0; ; offset += 200) {
        const page = getUnclassifiedFamilies(lq, { limit: 200, offset });
        unclassified += page.groups.reduce((sum, group) => sum + group.unclassifiedCount, 0);
        if (!page.hasMore) break;
      }
      expect(unclassified).toBe(56682);
      expect(count(lq, "cat_product_listing")).toBe(122_535);
      expect(count(lq, "com_product_price")).toBe(122_535);
      expect(count(lq, "com_price_list")).toBe(3);
      expect(count(lq, "app_import_delivery")).toBe(3);
      expect(count(lq, "app_import_file")).toBe(9);
      expect(
        lq
          .prepare(`
            SELECT i.metel_sigla AS issuer, COUNT(*) AS brands
            FROM cat_issuer_brand ib
            JOIN cat_metel_issuer i ON i.id = ib.issuer_id
            GROUP BY i.metel_sigla ORDER BY i.metel_sigla
          `)
          .all(),
      ).toEqual([
        { issuer: "BTI", brands: 6 },
        { issuer: "SIE", brands: 2 },
        { issuer: "SNR", brands: 1 },
      ]);
      expect(
        lq
          .prepare(`
            SELECT i.metel_sigla AS issuer, COUNT(*) AS listings
            FROM cat_product_listing l
            JOIN cat_metel_issuer i ON i.id = l.issuer_id
            GROUP BY i.metel_sigla ORDER BY i.metel_sigla
          `)
          .all(),
      ).toEqual([
        { issuer: "BTI", listings: 24_676 },
        { issuer: "SIE", listings: 68_117 },
        { issuer: "SNR", listings: 29_742 },
      ]);
      expect(
        lq
          .prepare(`
            SELECT i.metel_sigla AS issuer, COUNT(*) AS families
            FROM cat_metel_family f
            JOIN cat_metel_issuer i ON i.id = f.issuer_id
            GROUP BY i.metel_sigla ORDER BY i.metel_sigla
          `)
          .all(),
      ).toEqual([
        { issuer: "BTI", families: 569 },
        { issuer: "SIE", families: 362 },
        { issuer: "SNR", families: 183 },
      ]);
      expect(
        lq
          .prepare(`
            SELECT i.metel_sigla AS issuer, COUNT(*) AS prices
            FROM com_product_price p
            JOIN com_price_list pl ON pl.id = p.price_list_id
            JOIN cat_metel_issuer i ON i.id = pl.issuer_id
            GROUP BY i.metel_sigla ORDER BY i.metel_sigla
          `)
          .all(),
      ).toEqual([
        { issuer: "BTI", prices: 24_676 },
        { issuer: "SIE", prices: 68_117 },
        { issuer: "SNR", prices: 29_742 },
      ]);
      expect(
        lq.prepare("SELECT COUNT(*) FROM cat_product WHERE is_listed = 1").pluck().get(),
      ).toBe(122_535);
      expect(
        lq.prepare("SELECT COUNT(*) FROM cat_metel_family WHERE is_known = 0").pluck().get(),
      ).toBe(0);
      expect(
        lq.prepare("SELECT COUNT(*) FROM cat_product WHERE electrocod IS NOT NULL").pluck().get(),
      ).toBe(0);
    },
  );
});
