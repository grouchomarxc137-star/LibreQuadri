import Database from "better-sqlite3";
import type { AttributeParserRegistry } from "../catalogue/attribute-enrichment.js";
import { loadAttributeSeed, type AttributeSeed } from "../catalogue/attribute-seed.js";
import { loadCategorySeed, type CategorySeed } from "../catalogue/category-seed.js";
import type { ProductFamilyGrouperRegistry } from "../catalogue/family-grouping.js";
import { loadProductFamilySeed, synchronizeProductFamilySeed, type ProductFamilySeed } from "../catalogue/family-seed.js";
import { loadCapacityKindSeed, loadSourceBrandMapSeed, synchronizeCapacityKindSeed, synchronizeSourceBrandMapSeed, type CapacityKindSeed, type SourceBrandMapSeed } from "../catalogue/engineering-seed.js";
import { refreshEngineeringLinks } from "../sources/engineering-links.js";
import { engineeringVocabularyWarnings, type EngineeringVocabularyWarnings, type EngineeringVocabularySeed } from "../catalogue/engineering-vocabulary.js";
import { synchronizeDerivedCatalogue } from "../catalogue/derived-catalogue.js";
import { synchronizeFstNavigation } from "./fst-navigation.js";
import type { SiemensNavigationSeed } from "../catalogue/siemens-navigation.js";

import {
  assembleMetelDelivery,
  type AssembledMetelDelivery,
  type DeliveryPriceRow,
  type DeliverySourceHashes,
} from "./delivery.js";
import type { FamilyType } from "./parser.js";

export interface NormalizeMetelDeliveryOptions {
  /** Import orchestration may reject an outdated preview after acquiring the writer lock. */
  readonly beforeWrite?: () => void;
  readonly engineeringVocabularySeed?: EngineeringVocabularySeed;
  readonly siemensNavigationSeed?: SiemensNavigationSeed;
  readonly lqDatabase: Database.Database;
  readonly rawDatabase: Database.Database;
  readonly sources: DeliverySourceHashes;
  readonly acceptOlderDelivery?: boolean;
  readonly normalizedAt?: Date;
  readonly categorySeed?: CategorySeed;
  readonly attributeSeed?: AttributeSeed;
  readonly familySeed?: ProductFamilySeed;
  readonly capacityKindSeed?: CapacityKindSeed;
  readonly sourceBrandMapSeed?: SourceBrandMapSeed;
  /** Defaults to the production parser registry. */
  readonly attributeParsers?: AttributeParserRegistry;
  /** Defaults to the production family-grouper registry. */
  readonly familyGroupers?: ProductFamilyGrouperRegistry;
}

export interface DeliveryNormalizationSummary {
  readonly issuerSigla: string;
  readonly brandCount: number;
  readonly productCount: number;
  readonly listingCount: number;
  readonly priceCount: number;
  readonly knownFamilyCount: number;
  readonly unknownFamilyCount: number;
  readonly engineeringVocabularyWarnings?: EngineeringVocabularyWarnings;
}

export interface DeliveryNormalizationResult {
  readonly deliveryId: number;
  readonly fingerprint: string;
  readonly becameCurrent: boolean;
  readonly alreadyNormalized: boolean;
  readonly summary: DeliveryNormalizationSummary;
}

interface ExistingDeliveryRow {
  readonly id: number;
  readonly became_current: number;
  readonly summary_json: string;
}

interface IdRow {
  readonly id: number;
}

interface CurrentPriceListRow {
  readonly valid_from: string;
}

interface ProductIdentityRow {
  readonly id: number;
  readonly brand_id: number;
  readonly manufacturer_code: string;
}

interface GoverningListingRow {
  readonly issuer_id: number;
  readonly discount_family_id: number | null;
  readonly statistical_family_id: number | null;
  readonly lifecycle_status_code: string;
  readonly lead_time_code: string;
  readonly ean: string | null;
  readonly short_description: string;
  readonly unit_of_measure: string;
  readonly pack_qty: number;
  readonly min_order_qty: number;
  readonly order_multiple: number;
  readonly max_order_qty: number;
  readonly is_kit: number;
  readonly electrocod: string | null;
  readonly any_listed: number;
}

export class OlderDeliveryConfirmationRequiredError extends Error {
  readonly issuerSigla: string;
  readonly deliveryValidFrom: string;
  readonly currentValidFrom: string;

  constructor(
    issuerSigla: string,
    deliveryValidFrom: string,
    currentValidFrom: string,
  ) {
    super(
      `Delivery ${issuerSigla}/${deliveryValidFrom} is older than current ${currentValidFrom} and requires explicit confirmation`,
    );
    this.name = "OlderDeliveryConfirmationRequiredError";
    this.issuerSigla = issuerSigla;
    this.deliveryValidFrom = deliveryValidFrom;
    this.currentValidFrom = currentValidFrom;
  }
}

export function normalizeProductCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function metelPriceToE4(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error(`Invalid METEL cents value ${String(cents)}`);
  }
  const result = cents * 100;
  if (!Number.isSafeInteger(result)) {
    throw new Error("METEL price exceeds the safe integer range");
  }
  return result;
}

export function unitPriceE4(listPriceE4: number, multiplier: number): number {
  if (!Number.isSafeInteger(multiplier) || multiplier <= 0) {
    throw new Error(`Invalid METEL price multiplier ${String(multiplier)}`);
  }
  return Math.floor((listPriceE4 + Math.floor(multiplier / 2)) / multiplier);
}

function existingDelivery(
  database: Database.Database,
  fingerprint: string,
): ExistingDeliveryRow | undefined {
  return database
    .prepare(
      "SELECT id, became_current, summary_json FROM app_import_delivery WHERE fingerprint = ?",
    )
    .get(fingerprint) as ExistingDeliveryRow | undefined;
}

function existingResult(
  fingerprint: string,
  row: ExistingDeliveryRow,
): DeliveryNormalizationResult {
  return {
    deliveryId: row.id,
    fingerprint,
    becameCurrent: row.became_current === 1,
    alreadyNormalized: true,
    summary: JSON.parse(row.summary_json) as DeliveryNormalizationSummary,
  };
}

function familyKey(
  issuerId: number,
  brandId: number,
  familyType: FamilyType,
  code: string,
): string {
  return `${issuerId}\0${brandId}\0${familyType}\0${code}`;
}

function listingValues(
  row: DeliveryPriceRow,
  discountFamilyId: number | null,
  statisticalFamilyId: number | null,
): Record<string, unknown> {
  return {
    discountFamilyId,
    statisticalFamilyId,
    lifecycleStatusCode: row.statoCode,
    leadTimeCode: row.leadTimeCode,
    ean: row.ean,
    shortDescription: row.descrizione,
    unitOfMeasure: row.um,
    packQty: row.qtaCartone,
    minOrderQty: row.qtaMinima,
    orderMultiple: row.qtaMultipla,
    maxOrderQty: row.qtaMassima,
    isKit: row.composto,
    electrocod: row.electrocod,
  };
}

function removedDeliveryBrands(database: Database.Database, delivery: AssembledMetelDelivery): Set<string> {
  return new Set((database.prepare(`SELECT b.metel_marchio AS code FROM app_removed_brand_listing r
    JOIN cat_brand b ON b.id=r.brand_id JOIN cat_metel_issuer i ON i.id=r.issuer_id
    WHERE i.metel_sigla=?`).all(delivery.issuerSigla) as Array<{code:string}>)
    .map(row=>row.code).filter(code=>delivery.priceRows.some(row=>row.marchio===code)));
}

function normalizeTransaction(
  database: Database.Database,
  delivery: AssembledMetelDelivery,
  options: NormalizeMetelDeliveryOptions,
  normalizedAt: string,
): DeliveryNormalizationResult {
  const concurrent = existingDelivery(database, delivery.fingerprint);
  const restoring = concurrent ? removedDeliveryBrands(database,delivery) : new Set<string>();
  if (concurrent && !restoring.size) {
    return existingResult(delivery.fingerprint, concurrent);
  }
  if(concurrent) {
    const current=database.prepare("SELECT is_current FROM com_price_list WHERE delivery_id=?").pluck().get(concurrent.id);
    if(current!==1)throw new Error("Per reinstallare il marchio usa la fornitura attualmente installata dell’emittente, oppure una nuova fornitura completa.");
    // A repeated multi-brand delivery restores only removed issuer/brand data.
    delivery={...delivery,priceRows:delivery.priceRows.filter(row=>restoring.has(row.marchio)),
      familyRows:delivery.familyRows.filter(row=>restoring.has(row.marchio))};
  }

  let issuer = database
    .prepare("SELECT id FROM cat_metel_issuer WHERE metel_sigla = ?")
    .get(delivery.issuerSigla) as IdRow | undefined;
  if (!issuer) {
    const inserted = database
      .prepare(
        "INSERT INTO cat_metel_issuer (metel_sigla, piva) VALUES (?, ?)",
      )
      .run(delivery.issuerSigla, delivery.issuerPiva);
    issuer = { id: Number(inserted.lastInsertRowid) };
  }
  const issuerId = issuer.id;

  const currentPriceList = database
    .prepare(
      "SELECT valid_from FROM com_price_list WHERE issuer_id = ? AND is_current = 1",
    )
    .get(issuerId) as CurrentPriceListRow | undefined;
  const becameCurrent =
    currentPriceList === undefined ||
    delivery.validFrom >= currentPriceList.valid_from;
  if (
    !becameCurrent &&
    options.acceptOlderDelivery !== true &&
    currentPriceList !== undefined
  ) {
    throw new OlderDeliveryConfirmationRequiredError(
      delivery.issuerSigla,
      delivery.validFrom,
      currentPriceList.valid_from,
    );
  }
  if (becameCurrent) {
    database
      .prepare("UPDATE cat_metel_issuer SET piva = ? WHERE id = ?")
      .run(delivery.issuerPiva, issuerId);
  }

  const deliveryInsert = concurrent ? null : database
    .prepare(`
      INSERT INTO app_import_delivery (
        issuer_id, fingerprint, listino_number, valid_from, became_current,
        normalized_at, summary_json
      ) VALUES (?, ?, ?, ?, ?, ?, '{}')
    `)
    .run(
      issuerId,
      delivery.fingerprint,
      delivery.listinoNumber,
      delivery.validFrom,
      becameCurrent ? 1 : 0,
      normalizedAt,
    );
  const deliveryId = concurrent?.id ?? Number(deliveryInsert!.lastInsertRowid);

  const insertImportFile = database.prepare(`
    INSERT INTO app_import_file (
      delivery_id, file_type, file_sha256, original_file_name,
      layout_version, row_count
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const file of concurrent ? [] : delivery.files) {
    insertImportFile.run(
      deliveryId,
      file.fileType,
      file.fileSha256,
      file.originalFileName,
      file.layoutVersion,
      file.rowCount,
    );
  }

  const observedMarchi = new Set(delivery.priceRows.map((row) => row.marchio));
  for (const row of delivery.familyRows) {
    observedMarchi.add(row.marchio);
  }
  const insertBrand = database.prepare(`
    INSERT INTO cat_brand (metel_marchio, name, active, source)
    VALUES (?, ?, 1, 'import')
    ON CONFLICT(metel_marchio) DO NOTHING
  `);
  for (const marchio of observedMarchi) {
    insertBrand.run(marchio, marchio);
  }
  const restoreBrand=database.prepare("UPDATE cat_brand SET active=1,import_removed=0 WHERE metel_marchio=? AND import_removed=1");
  for(const marchio of new Set(delivery.priceRows.map(row=>row.marchio))) {
    restoreBrand.run(marchio);
    database.prepare(`DELETE FROM app_removed_brand_listing WHERE brand_id=(SELECT id FROM cat_brand WHERE metel_marchio=?)
      AND issuer_id=?`).run(marchio,issuerId);
  }
  const brandRows = database
    .prepare("SELECT id, metel_marchio FROM cat_brand")
    .all() as Array<{ readonly id: number; readonly metel_marchio: string }>;
  const brandIds = new Map(
    brandRows.map((row) => [row.metel_marchio, row.id] as const),
  );

  const observeBrand = database.prepare(
    becameCurrent
      ? `
        INSERT INTO cat_issuer_brand (
          issuer_id, brand_id, first_seen_delivery_id, last_seen_delivery_id
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(issuer_id, brand_id) DO UPDATE SET
          last_seen_delivery_id = excluded.last_seen_delivery_id
      `
      : `
        INSERT INTO cat_issuer_brand (
          issuer_id, brand_id, first_seen_delivery_id, last_seen_delivery_id
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(issuer_id, brand_id) DO NOTHING
      `,
  );
  for (const marchio of observedMarchi) {
    observeBrand.run(issuerId, brandIds.get(marchio)!, deliveryId, deliveryId);
  }

  const upsertKnownFamily = database.prepare(
    becameCurrent
      ? `
        INSERT INTO cat_metel_family (
          issuer_id, brand_id, family_type, code, description, is_known
        ) VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT(issuer_id, brand_id, family_type, code) DO UPDATE SET
          description = excluded.description,
          is_known = 1
      `
      : `
        INSERT INTO cat_metel_family (
          issuer_id, brand_id, family_type, code, description, is_known
        ) VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT(issuer_id, brand_id, family_type, code) DO NOTHING
      `,
  );
  for (const row of delivery.familyRows) {
    upsertKnownFamily.run(
      issuerId,
      brandIds.get(row.marchio)!,
      row.familyType,
      row.code,
      row.description,
    );
  }

  const insertUnknownFamily = database.prepare(`
    INSERT INTO cat_metel_family (
      issuer_id, brand_id, family_type, code, description, is_known
    ) VALUES (?, ?, ?, ?, NULL, 0)
    ON CONFLICT(issuer_id, brand_id, family_type, code) DO NOTHING
  `);
  let unknownFamilyCount = 0;
  for (const row of delivery.priceRows) {
    const brandId = brandIds.get(row.marchio)!;
    if (row.famigliaSconto) {
      unknownFamilyCount += insertUnknownFamily.run(
        issuerId,
        brandId,
        "SCONTO",
        row.famigliaSconto,
      ).changes;
    }
    if (row.famigliaStatistica) {
      unknownFamilyCount += insertUnknownFamily.run(
        issuerId,
        brandId,
        "STATISTICA",
        row.famigliaStatistica,
      ).changes;
    }
  }

  const familyRows = database
    .prepare(`
      SELECT id, issuer_id, brand_id, family_type, code
      FROM cat_metel_family
      WHERE issuer_id = ?
    `)
    .all(issuerId) as Array<{
    readonly id: number;
    readonly issuer_id: number;
    readonly brand_id: number;
    readonly family_type: FamilyType;
    readonly code: string;
  }>;
  const familyIds = new Map(
    familyRows.map(
      (row) => [
        familyKey(
          row.issuer_id,
          row.brand_id,
          row.family_type,
          row.code,
        ),
        row.id,
      ] as const,
    ),
  );

  if (becameCurrent && !concurrent) {
    database
      .prepare("UPDATE com_price_list SET is_current = 0 WHERE issuer_id = ?")
      .run(issuerId);
  }
  const priceListInsert = concurrent ? null : database
    .prepare(`
      INSERT INTO com_price_list (
        issuer_id, delivery_id, listino_number, valid_from, is_current
      ) VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      issuerId,
      deliveryId,
      delivery.listinoNumber,
      delivery.validFrom,
      becameCurrent ? 1 : 0,
    );
  const priceListId = concurrent
    ? database.prepare("SELECT id FROM com_price_list WHERE delivery_id=?").pluck().get(deliveryId) as number
    : Number(priceListInsert!.lastInsertRowid);

  const affectedProductIds = new Set<number>();
  if (becameCurrent) {
    const previouslyListed = database
      .prepare(
        `SELECT product_id FROM cat_product_listing WHERE issuer_id = ? AND is_listed = 1
          ${concurrent ? "AND product_id IN (SELECT p.id FROM cat_product p JOIN cat_brand b ON b.id=p.brand_id WHERE b.metel_marchio IN (SELECT value FROM json_each(?)))" : ""}`,
      )
      .all(...(concurrent ? [issuerId,JSON.stringify([...restoring])] : [issuerId])) as Array<{ readonly product_id: number }>;
    for (const row of previouslyListed) {
      affectedProductIds.add(row.product_id);
    }
    database
      .prepare(
        `UPDATE cat_product_listing SET is_listed = 0 WHERE issuer_id = ? AND is_listed = 1
          ${concurrent ? "AND product_id IN (SELECT p.id FROM cat_product p JOIN cat_brand b ON b.id=p.brand_id WHERE b.metel_marchio IN (SELECT value FROM json_each(?)))" : ""}`,
      )
      .run(...(concurrent ? [issuerId,JSON.stringify([...restoring])] : [issuerId]));
  }

  const productRows = database
    .prepare("SELECT id, brand_id, manufacturer_code FROM cat_product")
    .all() as ProductIdentityRow[];
  const productIds = new Map<string, number>(
    productRows.map(
      (row) => [`${row.brand_id}\0${row.manufacturer_code}`, row.id] as const),
  );
  const insertProduct = database.prepare(`
    INSERT INTO cat_product (
      brand_id, manufacturer_code, code_norm, is_listed, updated_at
    ) VALUES (?, ?, ?, 0, ?)
  `);
  const upsertCurrentListing = database.prepare(`
    INSERT INTO cat_product_listing (
      product_id, issuer_id, discount_family_id, statistical_family_id,
      lifecycle_status_code, lead_time_code, ean, short_description,
      unit_of_measure, pack_qty, min_order_qty, order_multiple, max_order_qty,
      is_kit, electrocod, is_listed, first_seen_delivery_id,
      last_seen_delivery_id
    ) VALUES (
      @productId, @issuerId, @discountFamilyId, @statisticalFamilyId,
      @lifecycleStatusCode, @leadTimeCode, @ean, @shortDescription,
      @unitOfMeasure, @packQty, @minOrderQty, @orderMultiple, @maxOrderQty,
      @isKit, @electrocod, 1, @deliveryId, @deliveryId
    )
    ON CONFLICT(product_id, issuer_id) DO UPDATE SET
      discount_family_id = excluded.discount_family_id,
      statistical_family_id = excluded.statistical_family_id,
      lifecycle_status_code = excluded.lifecycle_status_code,
      lead_time_code = excluded.lead_time_code,
      ean = excluded.ean,
      short_description = excluded.short_description,
      unit_of_measure = excluded.unit_of_measure,
      pack_qty = excluded.pack_qty,
      min_order_qty = excluded.min_order_qty,
      order_multiple = excluded.order_multiple,
      max_order_qty = excluded.max_order_qty,
      is_kit = excluded.is_kit,
      electrocod = excluded.electrocod,
      is_listed = 1,
      last_seen_delivery_id = excluded.last_seen_delivery_id
  `);
  const insertHistoricalListing = database.prepare(`
    INSERT INTO cat_product_listing (
      product_id, issuer_id, discount_family_id, statistical_family_id,
      lifecycle_status_code, lead_time_code, ean, short_description,
      unit_of_measure, pack_qty, min_order_qty, order_multiple, max_order_qty,
      is_kit, electrocod, is_listed, first_seen_delivery_id,
      last_seen_delivery_id
    ) VALUES (
      @productId, @issuerId, @discountFamilyId, @statisticalFamilyId,
      @lifecycleStatusCode, @leadTimeCode, @ean, @shortDescription,
      @unitOfMeasure, @packQty, @minOrderQty, @orderMultiple, @maxOrderQty,
      @isKit, @electrocod, 0, @deliveryId, @deliveryId
    )
    ON CONFLICT(product_id, issuer_id) DO NOTHING
  `);
  const insertPrice = database.prepare(`
    INSERT INTO com_product_price (
      product_id, price_list_id, list_price_e4, price_multiplier, currency,
      list_price_unit_e4
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const restoreProduct=database.prepare("UPDATE cat_product SET import_removed=0 WHERE id=? AND import_removed=1");

  for (const row of delivery.priceRows) {
    const brandId = brandIds.get(row.marchio)!;
    const productKey = `${brandId}\0${row.codice}`;
    let productId = productIds.get(productKey);
    if (productId === undefined) {
      const codeNorm = normalizeProductCode(row.codice);
      if (!codeNorm) {
        throw new Error(`Product code ${row.codice} has an empty normalized form`);
      }
      productId = Number(
        insertProduct.run(brandId, row.codice, codeNorm, normalizedAt)
          .lastInsertRowid,
      );
      productIds.set(productKey, productId);
      affectedProductIds.add(productId);
    }

    restoreProduct.run(productId);

    const discountFamilyId = row.famigliaSconto
      ? (familyIds.get(
          familyKey(
            issuerId,
            brandId,
            "SCONTO",
            row.famigliaSconto,
          ),
        ) ?? null)
      : null;
    const statisticalFamilyId = row.famigliaStatistica
      ? (familyIds.get(
          familyKey(
            issuerId,
            brandId,
            "STATISTICA",
            row.famigliaStatistica,
          ),
        ) ?? null)
      : null;
    const values = {
      productId,
      issuerId,
      deliveryId,
      ...listingValues(row, discountFamilyId, statisticalFamilyId),
    };
    if (becameCurrent) {
      upsertCurrentListing.run(values);
      affectedProductIds.add(productId);
    } else {
      insertHistoricalListing.run(values);
    }

    const listPriceE4 = metelPriceToE4(row.prezzoPubblicoCents);
    insertPrice.run(
      productId,
      priceListId,
      listPriceE4,
      row.moltiplicatore,
      row.valuta,
      unitPriceE4(listPriceE4, row.moltiplicatore),
    );
  }

  if (becameCurrent) {
    const governingListing = database.prepare(`
      SELECT l.issuer_id, l.discount_family_id, l.statistical_family_id,
             l.lifecycle_status_code, l.lead_time_code, l.ean,
             l.short_description, l.unit_of_measure, l.pack_qty,
             l.min_order_qty, l.order_multiple, l.max_order_qty, l.is_kit,
             l.electrocod,
             EXISTS(
               SELECT 1 FROM cat_product_listing listed
               WHERE listed.product_id = l.product_id AND listed.is_listed = 1
             ) AS any_listed
      FROM cat_product_listing l
      JOIN cat_product p ON p.id = l.product_id
      JOIN cat_brand b ON b.id = p.brand_id
      JOIN app_import_delivery d ON d.id = l.last_seen_delivery_id
      WHERE l.product_id = ?
      ORDER BY
        CASE
          WHEN l.is_listed = 1 AND l.issuer_id = b.preferred_issuer_id THEN 0
          WHEN l.is_listed = 1 THEN 1
          ELSE 2
        END,
        CASE WHEN l.is_listed = 1 THEN d.valid_from END DESC,
        CASE WHEN l.is_listed = 1 THEN d.normalized_at END DESC,
        CASE WHEN l.is_listed = 1 THEN d.id END DESC,
        CASE WHEN l.is_listed = 0 THEN d.normalized_at END DESC,
        CASE WHEN l.is_listed = 0 THEN d.id END DESC
      LIMIT 1
    `);
    const updateProduct = database.prepare(`
      UPDATE cat_product SET
        governing_issuer_id = @issuerId,
        ean = @ean,
        short_description = @shortDescription,
        unit_of_measure = @unitOfMeasure,
        pack_qty = @packQty,
        min_order_qty = @minOrderQty,
        order_multiple = @orderMultiple,
        max_order_qty = @maxOrderQty,
        lead_time_code = @leadTimeCode,
        lifecycle_status_code = @lifecycleStatusCode,
        is_kit = @isKit,
        electrocod = @electrocod,
        discount_family_id = @discountFamilyId,
        statistical_family_id = @statisticalFamilyId,
        is_listed = @isListed,
        updated_at = @updatedAt
      WHERE id = @productId
    `);
    for (const productId of affectedProductIds) {
      const listing = governingListing.get(productId) as GoverningListingRow;
      updateProduct.run({
        productId,
        issuerId: listing.issuer_id,
        ean: listing.ean,
        shortDescription: listing.short_description,
        unitOfMeasure: listing.unit_of_measure,
        packQty: listing.pack_qty,
        minOrderQty: listing.min_order_qty,
        orderMultiple: listing.order_multiple,
        maxOrderQty: listing.max_order_qty,
        leadTimeCode: listing.lead_time_code,
        lifecycleStatusCode: listing.lifecycle_status_code,
        isKit: listing.is_kit,
        electrocod: listing.electrocod,
        discountFamilyId: listing.discount_family_id,
        statisticalFamilyId: listing.statistical_family_id,
        isListed: listing.any_listed,
        updatedAt: normalizedAt,
      });
    }
  }

  refreshEngineeringLinks(database);
  synchronizeCapacityKindSeed(database, options.capacityKindSeed ?? loadCapacityKindSeed());
  synchronizeSourceBrandMapSeed(database, options.sourceBrandMapSeed ?? loadSourceBrandMapSeed());
  const vocabularyWarnings = engineeringVocabularyWarnings(synchronizeDerivedCatalogue(database, {
    categorySeed: options.categorySeed ?? loadCategorySeed(),
    attributeSeed: options.attributeSeed ?? loadAttributeSeed(),
    engineeringVocabulary: options.engineeringVocabularySeed,
    siemensNavigationSeed: options.siemensNavigationSeed,
    affectedIds: affectedProductIds,
    ...(options.attributeParsers === undefined ? {} : { attributeParsers: options.attributeParsers }),
  }));
  // Family definitions and grouping follow both classification and attributes.
  synchronizeProductFamilySeed(database, options.familySeed ?? loadProductFamilySeed(), {
    affectedIds: affectedProductIds,
    ...(options.familyGroupers === undefined ? {} : { groupers: options.familyGroupers }),
  });
  if (becameCurrent) synchronizeFstNavigation(database,issuerId);

  const summary: DeliveryNormalizationSummary = {
    issuerSigla: delivery.issuerSigla,
    brandCount: observedMarchi.size,
    productCount: delivery.priceRows.length,
    listingCount: delivery.priceRows.length,
    priceCount: delivery.priceRows.length,
    knownFamilyCount: delivery.familyRows.length,
    unknownFamilyCount,
    ...(vocabularyWarnings ? { engineeringVocabularyWarnings: vocabularyWarnings } : {}),
  };
  if(!concurrent) database
    .prepare("UPDATE app_import_delivery SET summary_json = ? WHERE id = ?")
    .run(JSON.stringify(summary), deliveryId);

  return {
    deliveryId,
    fingerprint: delivery.fingerprint,
    becameCurrent,
    alreadyNormalized: false,
    summary,
  };
}

export function normalizeMetelDelivery(
  options: NormalizeMetelDeliveryOptions,
): DeliveryNormalizationResult {
  const delivery = assembleMetelDelivery(options.rawDatabase, options.sources);
  const existing = existingDelivery(options.lqDatabase, delivery.fingerprint);
  if (existing && !removedDeliveryBrands(options.lqDatabase,delivery).size) {
    return existingResult(delivery.fingerprint, existing);
  }
  if (options.lqDatabase.inTransaction) {
    throw new Error("Cannot normalize a METEL delivery inside another transaction");
  }
  const normalizedAt = (options.normalizedAt ?? new Date()).toISOString();
  const transaction = options.lqDatabase.transaction(() => {
    options.beforeWrite?.();
    return normalizeTransaction(options.lqDatabase, delivery, options, normalizedAt);
  });
  return transaction.immediate();
}
