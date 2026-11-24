import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type Database from "better-sqlite3";
import type { AttributeParserRegistry } from "../../src/main/catalogue/attribute-enrichment.js";
import type { AttributeSeed } from "../../src/main/catalogue/attribute-seed.js";
import type { CategorySeed } from "../../src/main/catalogue/category-seed.js";
import type { ProductFamilyGrouperRegistry } from "../../src/main/catalogue/family-grouping.js";
import type { ProductFamilySeed } from "../../src/main/catalogue/family-seed.js";

import { openMigratedLqDatabase } from "../../src/main/database/lq-migrations.js";
import { openMigratedRawDatabase } from "../../src/main/database/raw-migrations.js";
import { closeConfiguredDatabase } from "../../src/main/database/sqlite-connection.js";
import {
  normalizeMetelDelivery,
  type DeliveryNormalizationResult,
} from "../../src/main/metel/catalogue-normalization.js";

export interface FixtureProduct {
  readonly marchio: string;
  readonly code: string;
  readonly ean?: string;
  readonly description?: string;
  readonly priceCents?: number;
  readonly multiplier?: number;
  readonly um?: string;
  readonly statisticalFamily?: string;
  readonly discountFamily?: string;
}

export interface FixtureDelivery {
  readonly issuer: string;
  readonly listino: string;
  readonly validFrom: string;
  readonly products: readonly FixtureProduct[];
  readonly acceptOlderDelivery?: boolean;
}

export interface FixtureAttributes {
  readonly seed?: AttributeSeed;
  readonly parsers?: AttributeParserRegistry;
  readonly familySeed?: ProductFamilySeed;
  readonly familyGroupers?: ProductFamilyGrouperRegistry;
}

export interface CatalogueFixture {
  readonly lq: Database.Database;
  readonly raw: Database.Database;
  /** Runs a delivery through the real normalization pipeline into lq.db. */
  importDelivery(delivery: FixtureDelivery, categorySeed?: CategorySeed, attributes?: FixtureAttributes): DeliveryNormalizationResult;
  close(): void;
}

export function createCatalogueFixture(): CatalogueFixture {
  const root = mkdtempSync(path.join(tmpdir(), "librequadri-catalogue-test-"));
  const raw = openMigratedRawDatabase({
    databaseFilename: path.join(root, "metel_raw.db"),
    migrationsFolder: path.resolve("db", "migrations", "raw"),
  });
  const lq = openMigratedLqDatabase({
    databaseFilename: path.join(root, "lq.db"),
    backupDirectory: path.join(root, "backups"),
    migrationsFolder: path.resolve("db", "migrations", "lq"),
  });

  return {
    lq,
    raw,
    importDelivery(delivery, categorySeed, attributes) {
      const fileSha256 = insertRawPriceList(raw, delivery);
      return normalizeMetelDelivery({
        lqDatabase: lq,
        rawDatabase: raw,
        sources: { LSP: fileSha256 },
        acceptOlderDelivery: delivery.acceptOlderDelivery,
        categorySeed,
        attributeSeed: attributes?.seed,
        attributeParsers: attributes?.parsers,
        familySeed: attributes?.familySeed,
        familyGroupers: attributes?.familyGroupers,
      });
    },
    close() {
      closeConfiguredDatabase(lq);
      closeConfiguredDatabase(raw);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function insertRawPriceList(
  database: Database.Database,
  delivery: FixtureDelivery,
): string {
  const fileSha256 = createHash("sha256")
    .update(JSON.stringify(delivery))
    .digest("hex");
  const rawFileId = Number(
    database
      .prepare(
        `
        INSERT INTO raw_file (
          file_sha256, file_type, original_file_name, issuer_sigla, issuer_piva,
          listino_number, valid_from, last_change_date, header_description,
          layout_version, parsed_at, status, row_count, warning_count, report_json
        ) VALUES (?, 'LSP', ?, ?, '00000000000', ?, ?, ?, 'Fixture', '020', ?,
                  'parsed', ?, 0, '{}')
      `,
      )
      .run(
        fileSha256,
        `${delivery.issuer}-listino.txt`,
        delivery.issuer,
        delivery.listino,
        delivery.validFrom,
        delivery.validFrom,
        "2026-09-21T00:00:00.000Z",
        delivery.products.length,
      ).lastInsertRowid,
  );

  const insertRow = database.prepare(`
    INSERT INTO price_list_row (
      raw_file_id, line_no, raw_line, marchio, codice, ean, descrizione,
      qta_cartone, qta_multipla, qta_minima, qta_massima, lead_time_code,
      prezzo_rivenditore_cents, prezzo_pubblico_cents, moltiplicatore,
      valuta, um, composto, stato_code, data_variazione, famiglia_sconto,
      famiglia_statistica, electrocod, extra_v021
    ) VALUES (
      @rawFileId, @lineNo, 'fixture', @marchio, @code, @ean, @description,
      1, 1, 1, 999999, '1', @priceCents, @priceCents, @multiplier,
      'EUR', @um, 0, '1', @validFrom, @discountFamily, @statisticalFamily, NULL, NULL
    )
  `);
  delivery.products.forEach((product, index) => {
    insertRow.run({
      rawFileId,
      lineNo: index + 2,
      marchio: product.marchio,
      code: product.code,
      ean: product.ean ?? null,
      description: product.description ?? `${product.marchio} ${product.code}`,
      priceCents: product.priceCents ?? 100,
      multiplier: product.multiplier ?? 1,
      um: product.um ?? "PCE",
      statisticalFamily: product.statisticalFamily ?? null,
      discountFamily: product.discountFamily ?? null,
      validFrom: delivery.validFrom,
    });
  });
  return fileSha256;
}
