import type Database from "better-sqlite3";

import {
  CATALOGUE_SEARCH_DEFAULT_LIMIT,
  CATALOGUE_SEARCH_MAX_LIMIT,
  type CatalogueAttributeFilterOptions,
  type CatalogueAttributeFilterRequest,
  type CatalogueFilterAttribute,
  type CatalogueFilterValue,
  type CatalogueBrandOverview,
  type CatalogueOverview,
  type CataloguePriceListOverview,
  type CatalogueProduct,
  type CatalogueProductAttribute,
  type CatalogueSearchRequest,
  type CatalogueSearchResult,
  type UnclassifiedRequest,
  type UnclassifiedResult,
  type UnclassifiedFamily,
} from "../../shared/catalogue.js";
import type { CatalogueProductSnapshotSource } from "../../shared/project.js";
import { normalizeProductCode } from "../metel/catalogue-normalization.js";
import {
  categoryFilterConditions,
  filterableAttributes,
  InvalidCatalogueFilterError,
  productAttributes,
  resolveAttributeFilters,
  resolveCategoryScope,
} from "./attribute-queries.js";

/*
 * Catalogue query layer over lq.db. Search is deliberately isolated behind
 * searchCatalogue(): the approved long-term design is FTS5 (DATABASE_DESIGN §8)
 * and it must be possible to swap the matching strategy without touching the
 * IPC, service or renderer contracts.
 */

interface SearchTerm {
  /** The token as typed, matched against the description. */
  readonly text: string;
  /** Token reduced to [A-Z0-9], matched against code_norm. Empty when nothing is left. */
  readonly codeNorm: string;
}

export interface SearchTerms {
  readonly terms: readonly SearchTerm[];
  /** Code keys used for ranking: the whole query and every token, normalized. */
  readonly rankingCodes: readonly string[];
  /** Valid exact EAN tokens, excluding the all-zero METEL placeholder. */
  readonly exactEans: readonly string[];
}

/** Escapes LIKE wildcards so user input always matches literally (ESCAPE '\'). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function isSearchableEan(value: string): boolean {
  return /^\d{13}$/.test(value) && !/^0+$/.test(value);
}

/**
 * Splits a query into whitespace-separated tokens. Tokens without any letter
 * or digit (a lone "-" or "/") carry no search meaning and are dropped.
 * Returns null when nothing searchable remains.
 */
export function parseSearchTerms(query: string): SearchTerms | null {
  const terms = query
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token))
    .map((text) => ({ text, codeNorm: normalizeProductCode(text) }));

  if (terms.length === 0) {
    return null;
  }

  const rankingCodes = [
    ...new Set(
      [
        normalizeProductCode(terms.map((term) => term.text).join("")),
        ...terms.map((term) => term.codeNorm),
      ].filter((code) => code.length > 0),
    ),
  ];
  const exactEans = [
    ...new Set(
      terms.map((term) => term.text).filter((term) => isSearchableEan(term)),
    ),
  ];
  return { terms, rankingCodes, exactEans };
}

export interface SearchRow {
  readonly id: number;
  readonly brandMarchio: string;
  readonly brandName: string;
  readonly manufacturerCode: string;
  readonly description: string | null;
  readonly unitOfMeasure: string | null;
  readonly isListed: number;
  readonly categoryCode: string | null;
  readonly categoryName: string | null;
  readonly unitPriceE4: number | null;
  readonly listPriceE4: number | null;
  readonly priceMultiplier: number | null;
  readonly currency: string | null;
  readonly priceIssuerSigla: string | null;
}

const SEARCH_ORDER = "p.is_listed DESC, p.code_norm, p.manufacturer_code, p.id";

export function resolvePaging(request: UnclassifiedRequest): {
  readonly limit: number;
  readonly offset: number;
} {
  const limit = request.limit ?? CATALOGUE_SEARCH_DEFAULT_LIMIT;
  const offset = request.offset ?? 0;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > CATALOGUE_SEARCH_MAX_LIMIT
  ) {
    throw new RangeError(
      `Search limit must be an integer between 1 and ${CATALOGUE_SEARCH_MAX_LIMIT}`,
    );
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError("Search offset must be a non-negative integer");
  }
  return { limit, offset };
}

/**
 * Ranks by how the query relates to the product code (0 exact, 1 prefix,
 * 2 contains) and then, at 3, everything that matched only through the
 * description or through several separate tokens.
 */
function rankExpression(
  rankingCodes: readonly string[],
  exactEans: readonly string[],
  parameters: Record<string, string | number | null>,
): string {
  if (rankingCodes.length === 0) {
    return "3";
  }

  const indexes = rankingCodes.map((_, index) => index);
  rankingCodes.forEach((code, index) => {
    parameters[`rank${index}`] = code;
    parameters[`rankPrefix${index}`] = `${code}*`;
    parameters[`rankContains${index}`] = `%${code}%`;
  });
  exactEans.forEach((ean, index) => {
    parameters[`rankEan${index}`] = ean;
  });
  const anyOf = (predicate: (index: number) => string): string =>
    indexes.map(predicate).join(" OR ");
  const exactIdentifiers = [
    anyOf((i) => `p.code_norm = @rank${i}`),
    ...exactEans.map((_, index) => `p.ean = @rankEan${index}`),
  ].join(" OR ");

  return `CASE
    WHEN ${exactIdentifiers} THEN 0
    WHEN ${anyOf((i) => `p.code_norm GLOB @rankPrefix${i}`)} THEN 1
    WHEN ${anyOf((i) => `p.code_norm LIKE @rankContains${i}`)} THEN 2
    ELSE 3
  END`;
}

const LISTED_CONDITION = "p.is_listed = 1";

/**
 * One condition on `p` per search term: each token must be found in the code,
 * the description or (for a complete EAN) the EAN. Shared by search and facets.
 */
export function textConditions(
  search: SearchTerms | null,
  parameters: Record<string, string | number | null>,
): string[] {
  return (search?.terms ?? []).map((term, index) => {
    parameters[`description${index}`] = `%${escapeLike(term.text)}%`;
    const inDescription = `p.short_description LIKE @description${index} ESCAPE '\\'`;
    if (term.codeNorm.length === 0) {
      return inDescription;
    }
    parameters[`code${index}`] = `%${term.codeNorm}%`;
    const matches = [`p.code_norm LIKE @code${index}`, inDescription];
    if (isSearchableEan(term.text)) {
      parameters[`ean${index}`] = term.text;
      matches.push(`p.ean = @ean${index}`);
    }
    return `(${matches.join(" OR ")})`;
  });
}

/**
 * Tokenized AND search over the normalized product code and the METEL short
 * description. Each token must be found in the code or in the description.
 * No total count is computed: one extra row tells whether more pages exist.
 *
 * Matching is case-insensitive for ASCII (SQLite LIKE); accented capitals are
 * only matched exactly until FTS5 replaces this.
 *
 * The price is the current price of the product's governing issuer, and only
 * while that issuer still lists the product. There is no fallback to another
 * issuer or to an older price list.
 */
export function searchCatalogue(
  database: Database.Database,
  request: CatalogueSearchRequest,
): CatalogueSearchResult {
  const { limit, offset } = resolvePaging(request);
  const search = parseSearchTerms(request.query);
  if (request.attributeFilters?.length && request.categoryCode === undefined) {
    throw new InvalidCatalogueFilterError("attribute filters require a category");
  }
  if (search === null && !request.reviewGroup && request.categoryCode === undefined) {
    return { products: [], offset, hasMore: false };
  }

  const parameters: Record<string, string | number | null> = {
    limit: limit + 1,
    offset,
  };
  const conditions = ["p.import_removed=0 AND p.brand_id IN (SELECT id FROM cat_brand WHERE active=1)", ...textConditions(search, parameters)];
  const rank = search ? rankExpression(search.rankingCodes, search.exactEans, parameters) : "3";
  if (request.reviewGroup) {
    parameters.issuerId = request.reviewGroup.issuerId;
    parameters.brandId = request.reviewGroup.brandId;
    parameters.familyId = request.reviewGroup.statisticalFamilyId;
    conditions.push("p.governing_issuer_id IS @issuerId", "p.brand_id = @brandId",
      "p.statistical_family_id IS @familyId", "p.category_id IS NULL");
  }
  if (request.categoryCode !== undefined) {
    const scope = resolveCategoryScope(database, request.categoryCode);
    conditions.push(...categoryFilterConditions(scope,
      resolveAttributeFilters(database, scope, request.attributeFilters ?? []), parameters));
  }
  if (request.listedOnly === true || (request.reviewGroup && request.listedOnly !== false)) {
    conditions.push(LISTED_CONDITION);
  }

  // The inner query ranks and pages ids only, so prices are resolved just for
  // the rows that are returned.
  const rows = database
    .prepare(
      `
      WITH page AS (
        SELECT p.id AS id, ${rank} AS match_rank
        FROM cat_product p
        WHERE ${conditions.join(" AND ")}
        ORDER BY match_rank, ${SEARCH_ORDER}
        LIMIT @limit OFFSET @offset
      )
      SELECT
        p.id AS id,
        b.metel_marchio AS brandMarchio,
        b.name AS brandName,
        p.manufacturer_code AS manufacturerCode,
        p.short_description AS description,
        p.unit_of_measure AS unitOfMeasure,
        p.is_listed AS isListed,
        c.code AS categoryCode,
        c.name AS categoryName,
        pr.list_price_unit_e4 AS unitPriceE4,
        pr.list_price_e4 AS listPriceE4,
        pr.price_multiplier AS priceMultiplier,
        pr.currency AS currency,
        i.metel_sigla AS priceIssuerSigla
      FROM page
      JOIN cat_product p ON p.id = page.id
      JOIN cat_brand b ON b.id = p.brand_id AND b.active=1 AND p.import_removed=0
      LEFT JOIN cat_category c ON c.id = p.category_id
      LEFT JOIN cat_product_listing governing
        ON governing.product_id = p.id
       AND governing.issuer_id = p.governing_issuer_id
       AND governing.is_listed = 1
      LEFT JOIN com_price_list pl
        ON pl.issuer_id = governing.issuer_id AND pl.is_current = 1
      LEFT JOIN com_product_price pr
        ON pr.product_id = p.id AND pr.price_list_id = pl.id
      LEFT JOIN cat_metel_issuer i ON i.id = pl.issuer_id
      ORDER BY page.match_rank, ${SEARCH_ORDER}
    `,
    )
    .all(parameters) as SearchRow[];

  const pageRows = rows.slice(0, limit);
  const attributes = productAttributes(database, pageRows.map(row => row.id));
  return {
    products: pageRows.map(row => productFromRow(row, attributes.get(row.id) ?? [])),
    offset,
    hasMore: rows.length > limit,
  };
}

/** Resolves the complete portable snapshot source for one local catalogue id. */
export function getCatalogueProductSnapshot(
  database: Database.Database,
  productId: number,
): CatalogueProductSnapshotSource {
  const row = database.prepare(`
    SELECT b.metel_marchio AS brandMarchio, b.name AS brandName,
      p.manufacturer_code AS manufacturerCode, p.ean AS ean,
      p.short_description AS shortDescription, p.description AS description,
      p.unit_of_measure AS unitOfMeasure, c.code AS categoryCode,
      c.name AS categoryPathLabel, f.code AS familyCode, f.name AS familyName,
      issuer.metel_sigla AS priceIssuerSigla, pl.listino_number AS priceListinoNumber,
      pl.valid_from AS priceValidFrom, price.list_price_unit_e4 AS listPriceUnitE4,
      price.currency AS priceCurrency,
      price.price_multiplier AS priceMultiplierOriginal
    FROM cat_product p
    JOIN cat_brand b ON b.id = p.brand_id AND b.active=1 AND p.import_removed=0
    LEFT JOIN cat_category c ON c.id = p.category_id
    LEFT JOIN cat_product_family_assignment assignment ON assignment.product_id = p.id
    LEFT JOIN cat_product_family f ON f.id = assignment.family_id AND f.active = 1
    LEFT JOIN cat_product_listing listing
      ON listing.product_id = p.id AND listing.issuer_id = p.governing_issuer_id AND listing.is_listed = 1
    LEFT JOIN com_price_list pl ON pl.issuer_id = listing.issuer_id AND pl.is_current = 1
    LEFT JOIN com_product_price price ON price.product_id = p.id AND price.price_list_id = pl.id
    LEFT JOIN cat_metel_issuer issuer ON issuer.id = pl.issuer_id
    WHERE p.id = ?
  `).get(productId) as Omit<CatalogueProductSnapshotSource, "attributes"> | undefined;
  if (!row) throw new Error("Il prodotto selezionato non esiste nel catalogo locale.");
  return { ...row, attributes: productAttributes(database, [productId]).get(productId) ?? [] };
}

export function productFromRow(row: SearchRow, attributes: readonly CatalogueProductAttribute[]): CatalogueProduct {
  const hasPrice =
    row.unitPriceE4 !== null &&
    row.listPriceE4 !== null &&
    row.priceMultiplier !== null &&
    row.currency !== null &&
    row.priceIssuerSigla !== null;

  return {
    id: row.id,
    brandMarchio: row.brandMarchio,
    brandName: row.brandName,
    manufacturerCode: row.manufacturerCode,
    description: row.description,
    unitOfMeasure: row.unitOfMeasure,
    isListed: row.isListed === 1,
    category: row.categoryCode === null ? null : { code: row.categoryCode, name: row.categoryName! },
    attributes,
    price: hasPrice
      ? {
          unitPriceE4: row.unitPriceE4!,
          listPriceE4: row.listPriceE4!,
          priceMultiplier: row.priceMultiplier!,
          currency: row.currency!,
          issuerSigla: row.priceIssuerSigla!,
        }
      : null,
  };
}

export function getCatalogueOverview(
  database: Database.Database,
): CatalogueOverview {
  const totals = database
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(is_listed), 0) AS listed,
        COUNT(category_id) AS classified,
        COALESCE(SUM(category_id IS NOT NULL AND is_listed = 1), 0) AS listedClassified FROM cat_product WHERE import_removed=0 AND brand_id IN (SELECT id FROM cat_brand WHERE active=1)`,
    )
    .get() as { total: number; listed: number; classified: number; listedClassified: number };

  const brands = database
    .prepare(
      `
      SELECT b.metel_marchio AS marchio, b.name AS name,
             COUNT(*) AS productCount,
             COALESCE(SUM(p.is_listed), 0) AS listedProductCount
      FROM cat_brand b
      JOIN cat_product p ON p.brand_id = b.id AND b.active=1 AND p.import_removed=0
      GROUP BY b.id
      ORDER BY b.metel_marchio
    `,
    )
    .all() as CatalogueBrandOverview[];

  const currentPriceLists = database
    .prepare(
      `
      SELECT i.metel_sigla AS issuerSigla,
             pl.listino_number AS listinoNumber,
             pl.valid_from AS validFrom,
             d.normalized_at AS importedAt,
             (SELECT COUNT(*) FROM cat_product_listing l
               WHERE l.issuer_id = pl.issuer_id AND l.is_listed = 1 AND l.product_id IN (SELECT p.id FROM cat_product p JOIN cat_brand b ON b.id=p.brand_id WHERE b.active=1 AND p.import_removed=0)
             ) AS listedProductCount
      FROM com_price_list pl
      JOIN cat_metel_issuer i ON i.id = pl.issuer_id
      JOIN app_import_delivery d ON d.id = pl.delivery_id
      WHERE pl.is_current = 1 AND EXISTS(SELECT 1 FROM cat_product_listing l JOIN cat_product p ON p.id=l.product_id JOIN cat_brand b ON b.id=p.brand_id WHERE l.issuer_id=pl.issuer_id AND b.active=1)
      ORDER BY i.metel_sigla
    `,
    )
    .all() as CataloguePriceListOverview[];

  return {
    productCount: totals.total,
    listedProductCount: totals.listed,
    delistedProductCount: totals.total - totals.listed,
    classifiedProductCount: totals.classified,
    unclassifiedProductCount: totals.total - totals.classified,
    listedClassifiedProductCount: totals.listedClassified,
    listedUnclassifiedProductCount: totals.listed - totals.listedClassified,
    brands,
    currentPriceLists,
  };
}

/** Derived from the normalized catalogue only; no persistent per-product review rows. */
export function getUnclassifiedFamilies(database: Database.Database, request: UnclassifiedRequest = {}): UnclassifiedResult {
  const { limit, offset } = resolvePaging(request);
  const listedOnly = request.listedOnly !== false;
  const groups = database.prepare(`
    SELECT p.governing_issuer_id AS issuerId, p.brand_id AS brandId,
      p.statistical_family_id AS statisticalFamilyId, i.metel_sigla AS issuerSigla,
      b.metel_marchio AS brandMarchio, f.code AS familyCode, f.description AS familyDescription,
      SUM(p.category_id IS NULL ${listedOnly ? "AND p.is_listed = 1" : ""}) AS unclassifiedCount,
      COUNT(*) AS totalCount, SUM(p.is_listed) AS listedCount
    FROM cat_product p
    JOIN cat_brand b ON b.id = p.brand_id AND b.active=1 AND p.import_removed=0
    LEFT JOIN cat_metel_issuer i ON i.id = p.governing_issuer_id
    LEFT JOIN cat_metel_family f ON f.id = p.statistical_family_id
    GROUP BY p.governing_issuer_id, p.brand_id, p.statistical_family_id
    HAVING unclassifiedCount > 0
    ORDER BY i.metel_sigla, b.metel_marchio, f.code, p.governing_issuer_id, p.brand_id, p.statistical_family_id
    LIMIT ? OFFSET ?
  `).all(limit + 1, offset) as Array<Omit<UnclassifiedFamily, "examples">>;
  const examples = database.prepare(`
    SELECT COALESCE(short_description, manufacturer_code) AS description FROM cat_product
    WHERE governing_issuer_id IS ? AND brand_id = ? AND statistical_family_id IS ?
      AND category_id IS NULL ${listedOnly ? "AND is_listed = 1" : ""}
    ORDER BY code_norm, manufacturer_code, id LIMIT 3
  `);
  return { offset, hasMore: groups.length > limit, groups: groups.slice(0, limit).map(group => ({
    ...group, examples: (examples.all(group.issuerId, group.brandId, group.statisticalFamilyId) as Array<{ description: string }>).map(p => p.description),
  })) };
}

interface FacetValueRow {
  readonly attributeId: number;
  readonly optionId: number | null;
  readonly valueNum: number | null;
  readonly optionValue: string | null;
  readonly optionLabel: string | null;
  readonly optionOrder: number | null;
}

/**
 * Filter panel data for a category, with disjunctive counts.
 *
 * Offered values are those present among the category scope's products
 * (listed only, if requested), plus every selected value. Each value's count
 * uses the same conditions as `searchCatalogue` (category subtree, listed
 * scope, text query, attribute filters) except the filter of its own
 * attribute, so alternatives stay visible and meaningful. `totalCount` applies
 * every filter. Codes are validated exactly as in search.
 */
export function getAttributeFilterOptions(
  database: Database.Database,
  request: CatalogueAttributeFilterRequest,
): CatalogueAttributeFilterOptions {
  const scope = resolveCategoryScope(database, request.categoryCode);
  const attributes = filterableAttributes(database, scope);
  const filters = resolveAttributeFilters(database, scope, request.attributeFilters ?? []);
  const search = parseSearchTerms(request.query ?? "");
  const listed = request.listedOnly === true;

  /** Search conditions with every attribute filter except `excludedAttributeId`'s. */
  const conditions = (parameters: Record<string, string | number | null>, excludedAttributeId: number | null) => [
    "p.import_removed=0 AND p.brand_id IN (SELECT id FROM cat_brand WHERE active=1)",
    ...textConditions(search, parameters),
    ...categoryFilterConditions(scope, filters.filter(f => f.attributeId !== excludedAttributeId), parameters),
    ...(listed ? [LISTED_CONDITION] : []),
  ].join(" AND ");

  const totalParameters: Record<string, string | number | null> = {};
  const totalCount = database.prepare(`SELECT COUNT(*) FROM cat_product p WHERE ${conditions(totalParameters, null)}`)
    .pluck().get(totalParameters) as number;

  const domain = database.prepare(`
    SELECT DISTINCT pa.attribute_id AS attributeId, pa.option_id AS optionId, pa.value_num AS valueNum,
      o.value AS optionValue, o.label AS optionLabel, o.sort_order AS optionOrder
    FROM cat_product_attribute pa
    JOIN cat_product p ON p.id = pa.product_id
    LEFT JOIN cat_attribute_option o ON o.id = pa.option_id
    WHERE p.category_id IN (SELECT value FROM json_each(@scope))
      AND p.import_removed=0 AND p.brand_id IN (SELECT id FROM cat_brand WHERE active=1)
      AND pa.attribute_id IN (SELECT value FROM json_each(@attributes))
      ${listed ? `AND ${LISTED_CONDITION}` : ""}
      AND (pa.value_num IS NOT NULL OR o.active = 1)
  `).all({ scope: JSON.stringify(scope), attributes: JSON.stringify(attributes.map(a => a.id)) }) as FacetValueRow[];
  const selectedOption = database.prepare(`SELECT attribute_id AS attributeId, id AS optionId, NULL AS valueNum,
    value AS optionValue, label AS optionLabel, sort_order AS optionOrder FROM cat_attribute_option WHERE id = ?`);

  const result: CatalogueFilterAttribute[] = [];
  for (const attribute of attributes) {
    const isNumber = attribute.dataType === "number";
    const key = (row: { optionId: number | null; valueNum: number | null }) => isNumber ? row.valueNum : row.optionId;
    const values = new Map<number | null, FacetValueRow>();
    for (const row of domain) if (row.attributeId === attribute.id) values.set(key(row), row);
    const selected = new Set(filters.find(f => f.attributeId === attribute.id)?.values ?? []);
    for (const value of selected) {
      if (values.has(value)) continue;
      values.set(value, isNumber
        ? { attributeId: attribute.id, optionId: null, valueNum: value, optionValue: null, optionLabel: null, optionOrder: null }
        : selectedOption.get(value) as FacetValueRow);
    }
    if (values.size === 0) continue;

    const parameters: Record<string, string | number | null> = { facet: attribute.id };
    const counts = new Map((database.prepare(`
      SELECT ${isNumber ? "pa.value_num" : "pa.option_id"} AS value, COUNT(*) AS count
      FROM cat_product p JOIN cat_product_attribute pa ON pa.product_id = p.id AND pa.attribute_id = @facet
      WHERE ${conditions(parameters, attribute.id)}
      GROUP BY 1
    `).all(parameters) as Array<{ value: number; count: number }>).map(row => [row.value, row.count]));

    const rows = [...values.values()].sort(isNumber
      ? (a, b) => a.valueNum! - b.valueNum!
      : (a, b) => a.optionOrder! - b.optionOrder! || (a.optionValue! < b.optionValue! ? -1 : a.optionValue! > b.optionValue! ? 1 : 0));
    result.push({
      code: attribute.code, name: attribute.name, dataType: attribute.dataType, unit: attribute.unit,
      values: rows.map((row): CatalogueFilterValue => ({
        value: isNumber ? row.valueNum! : row.optionValue!,
        label: isNumber ? null : row.optionLabel,
        count: counts.get(key(row)!) ?? 0,
        selected: selected.has(key(row)!),
      })),
    });
  }
  return { categoryCode: request.categoryCode, totalCount, attributes: result };
}
