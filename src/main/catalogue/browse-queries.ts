import type Database from "better-sqlite3";

import {
  CATALOGUE_BROWSE_PACKAGE_LIMIT, type CatalogueBrowsePackage, type CatalogueBrowseRequest,
  type CatalogueBrowseFilterAttribute, type CatalogueBrowseResult, type CatalogueFilterValue,
  type ManufacturerNode,
} from "../../shared/catalogue.js";
import { allCategoryScope, filterableAttributes, InvalidCatalogueFilterError, productAttributes,
  resolveAttributeFilters, type FilterableAttribute } from "./attribute-queries.js";
import { escapeLike, parseSearchTerms, productFromRow, resolvePaging, textConditions,
  type SearchRow } from "./catalogue-queries.js";
import { browseManufacturerNodes, SELECTABLE_PACKAGE_SQL } from "./manufacturer-navigation.js";
import { BROWSE_SCOPE_SQL } from "./browse-scope.js";
import { readEngineeringReadiness } from "./engineering-readiness.js";
import type { ResolvedAttributeFilter } from "./attribute-queries.js";

export { BROWSE_SCOPE_SQL } from "./browse-scope.js";

type Params = Record<string, string | number | null>;

type FacetSummary = Pick<CatalogueBrowseResult, "facets" | "totalCount">;
interface BrowseCache {
  changes: number; version: number;
  metadata: Map<string, unknown>;
  summaries: Map<string, FacetSummary>;
}
const browseCaches = new WeakMap<Database.Database, BrowseCache>();
// A transaction can expose uncommitted/rolled-back values: never retain its view.
// total_changes does not rewind on rollback; data_version covers other connections.
function browseCache(database: Database.Database): BrowseCache | undefined {
  if (database.inTransaction) return undefined;
  const changes = database.prepare("SELECT total_changes()").pluck().get() as number;
  const version = database.pragma("data_version", { simple: true }) as number;
  let cache = browseCaches.get(database);
  if (!cache || cache.changes !== changes || cache.version !== version) {
    cache = { changes, version, metadata: new Map(), summaries: new Map() };
    browseCaches.set(database, cache);
  }
  return cache;
}
function remember<K, V>(map: Map<K, V>, key: K, value: V, limit: number): V {
  map.delete(key); map.set(key, value);
  if (map.size > limit) map.delete(map.keys().next().value!);
  return value;
}
function metadata<T>(cache: BrowseCache | undefined, key: string, read: () => T): T {
  if (!cache) return read();
  if (cache.metadata.has(key)) return remember(cache.metadata, key, cache.metadata.get(key), 128) as T;
  return remember(cache.metadata, key, read(), 128) as T;
}

const CONFIGURABLE = `EXISTS (SELECT 1 FROM cat_config_model_entry e
  JOIN cat_config_model m ON m.id=e.model_id WHERE e.product_id=p.id
  AND m.active=1 AND m.obsolete=0 AND m.brand_id IN (SELECT id FROM cat_brand WHERE active=1) AND m.commercial_contribution='articles'
  AND m.model_kind NOT IN ('enclosure','support'))`;

type BrowseRow = SearchRow & { readonly configurable: number };

type PackageOffer = { offerNo: number; status: "feasible" | "undecided"; values: Map<number, number> };
type ScopedPackage = PackageRow & { groupOrder: number; offers: PackageOffer[]; untrusted: boolean };

/**
 * Packages whose offers cannot be trusted: their engineering source is not current for the running
 * adapter, or their definition changed after the offers were computed. Read-only, so ordinary browsing
 * never fails on stale data; such packages simply have no technical matches or counts.
 */
function untrustedPackageModels(database: Database.Database): ReadonlySet<number> {
  const readiness = readEngineeringReadiness(database);
  const rows = database.prepare(`SELECT m.id,m.source,m.source_import_id AS sourceImportId,
      MAX(o.model_id IS NOT NULL AND o.definition_fingerprint<>m.definition_fingerprint) AS drifted
    FROM cat_config_model m LEFT JOIN cat_config_model_offer o ON o.model_id=m.id
    WHERE ${SELECTABLE_PACKAGE_SQL} GROUP BY m.id`).all() as
    Array<{ id: number; source: string; sourceImportId: number | null; drifted: number }>;
  return new Set(rows.filter(row => row.drifted || readiness.staleModel(row)).map(row => row.id));
}

function scopedPackages(database: Database.Database, request: CatalogueBrowseRequest,
  search: ReturnType<typeof parseSearchTerms>, brandIds: readonly number[], configValues: readonly boolean[],
  untrusted: ReadonlySet<number>, excluded: "brand" | "configurability" | null = null): ScopedPackage[] {
  if (excluded !== "configurability" && configValues.length === 1 && !configValues[0]) return [];
  const params: Params = { nodeId: request.nodeId };
  const conditions = [SELECTABLE_PACKAGE_SQL];
  (search?.terms ?? []).forEach((term, index) => {
    params[`packageName${index}`] = `%${escapeLike(term.text)}%`;
    conditions.push(`m.name LIKE @packageName${index} ESCAPE '\\'`);
  });
  if (brandIds.length && excluded !== "brand") {
    params.packageBrands = JSON.stringify(brandIds);
    conditions.push("m.brand_id IN (SELECT value FROM json_each(@packageBrands))");
  }
  const placed = `${BROWSE_SCOPE_SQL}, placed AS (
    SELECT m.id AS modelId,n.id AS groupId,n.name AS groupName,n.sort_order AS groupOrder,
      nm.sort_order AS modelOrder,
      ROW_NUMBER() OVER (PARTITION BY m.id ORDER BY n.sort_order,n.name,n.id,nm.sort_order) AS position
    FROM tree t JOIN cat_range_node n ON n.id=t.id JOIN cat_range_node_model nm ON nm.node_id=n.id
    JOIN cat_config_model m ON m.id=nm.model_id WHERE ${conditions.join(" AND ")}
  )`;
  const rows = database.prepare(`${placed} SELECT m.id AS modelId,m.name,m.model_kind AS kind,
      b.metel_marchio AS brandMarchio,placed.groupId,placed.groupName,placed.groupOrder,placed.modelOrder
    FROM placed JOIN cat_config_model m ON m.id=placed.modelId JOIN cat_brand b ON b.id=m.brand_id
    WHERE placed.position=1
    ORDER BY placed.groupOrder,placed.groupName,placed.groupId,placed.modelOrder,m.name,m.id`)
    .all(params) as Array<PackageRow & { groupOrder: number }>;
  if (!rows.length) return [];
  // A stale engineering source cannot provide trusted technical matches or counts.
  const offerRows = database.prepare(`SELECT o.model_id AS modelId,o.offer_no AS offerNo,o.status,
    v.attribute_id AS attributeId,v.value_num AS valueNum,v.option_id AS optionId
    FROM cat_config_model_offer o LEFT JOIN cat_config_model_offer_value v
      ON v.model_id=o.model_id AND v.offer_no=o.offer_no
    WHERE o.model_id IN (SELECT value FROM json_each(?)) ORDER BY o.model_id,o.offer_no`)
    .all(JSON.stringify(rows.filter(row => !untrusted.has(row.modelId)).map(row => row.modelId))) as Array<{
      modelId: number; offerNo: number; status: "feasible" | "undecided";
      attributeId: number | null; valueNum: number | null; optionId: number | null }>;
  const offers = new Map<number, Map<number, PackageOffer>>();
  for (const row of offerRows) {
    const modelOffers = offers.get(row.modelId) ?? new Map<number, PackageOffer>();
    const offer = modelOffers.get(row.offerNo) ?? { offerNo: row.offerNo, status: row.status, values: new Map<number, number>() };
    if (row.attributeId !== null) offer.values.set(row.attributeId, row.optionId ?? row.valueNum!);
    modelOffers.set(row.offerNo, offer); offers.set(row.modelId, modelOffers);
  }
  return rows.map(row => ({ ...row, offers: [...(offers.get(row.modelId)?.values() ?? [])],
    untrusted: untrusted.has(row.modelId) }));
}

function matchesOffer(offer: PackageOffer, filters: readonly ResolvedAttributeFilter[], excludedAttribute?: number): boolean {
  return filters.every(filter => filter.attributeId === excludedAttribute ||
    (offer.values.has(filter.attributeId) && filter.values.includes(offer.values.get(filter.attributeId)!)));
}

function matchingOffer(row: ScopedPackage, filters: readonly ResolvedAttributeFilter[],
  status: PackageOffer["status"], excludedAttribute?: number): PackageOffer | undefined {
  return row.offers.find(offer => offer.status === status && matchesOffer(offer, filters, excludedAttribute));
}

function browsePackages(database: Database.Database, request: CatalogueBrowseRequest,
  rows: readonly ScopedPackage[], filters: readonly ResolvedAttributeFilter[], offset: number): Pick<CatalogueBrowseResult,
  "packages" | "packageCount" | "undecidedPackages" | "packageOffersStale"> {
  const active = filters.length > 0;
  const matches = rows.filter(row => !active || !!matchingOffer(row, filters, "feasible"));
  const undecided = active ? rows.filter(row => !matchingOffer(row, filters, "feasible") &&
    !!matchingOffer(row, filters, "undecided")) : [];
  const trail = nodeTrail(database, request.nodeId);
  const convert = (source: ScopedPackage[]) => source.map(row => ({ row, path: trail(row.groupId) }))
    .sort((a, b) => compareTrail(a.path, b.path) || (a.row.modelOrder ?? 0) - (b.row.modelOrder ?? 0) ||
      a.row.name.localeCompare(b.row.name, "it") || a.row.modelId - b.row.modelId)
    .map(({ row, path }): CatalogueBrowsePackage => ({ modelId: row.modelId, name: row.name, kind: row.kind,
      brandMarchio: row.brandMarchio, groupName: row.groupName, groupId: row.groupId,
      groupPath: path.map(node => node.name),
      ...(active && matchingOffer(row, filters, "feasible") ? { offerNo: matchingOffer(row, filters, "feasible")!.offerNo } : {}) }));
  return { packages: offset === 0 ? convert(matches).slice(0, CATALOGUE_BROWSE_PACKAGE_LIMIT) : [],
    packageCount: offset === 0 ? matches.length : 0,
    undecidedPackages: offset === 0 ? convert(undecided).slice(0, CATALOGUE_BROWSE_PACKAGE_LIMIT) : [],
    packageOffersStale: active && rows.some(row => row.untrusted) };
}

type PackageRow = Omit<CatalogueBrowsePackage, "groupPath"> & { readonly modelOrder: number | null };
type TrailNode = { readonly id: number; readonly name: string; readonly sortOrder: number };

/** Ancestors of a holding node below the browsed node, top first; reads only the navigation tree. */
function nodeTrail(database: Database.Database, browsedId: number): (nodeId: number) => readonly TrailNode[] {
  const lookup = database.prepare(`SELECT id,parent_id AS parentId,name,sort_order AS sortOrder
    FROM cat_range_node WHERE id=?`);
  const cache = new Map<number, readonly TrailNode[]>();
  return nodeId => {
    const cached = cache.get(nodeId);
    if (cached) return cached;
    const trail: TrailNode[] = [];
    const seen = new Set<number>();
    for (let id: number | null = nodeId; id !== null && id !== browsedId && !seen.has(id);) {
      seen.add(id);
      const node = lookup.get(id) as (TrailNode & { parentId: number | null }) | undefined;
      if (!node) break;
      trail.unshift({ id: node.id, name: node.name, sortOrder: node.sortOrder });
      id = node.parentId;
    }
    cache.set(nodeId, trail);
    return trail;
  };
}

/** Navigation tree order: each level by source order, then name and id. */
function compareTrail(a: readonly TrailNode[], b: readonly TrailNode[]): number {
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const left = a[index]!, right = b[index]!;
    const order = left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "it") || left.id - right.id;
    if (order) return order;
  }
  return a.length - b.length;
}

/**
 * Facets are stable along a branch: the tree root's population fixes which facets exist and which options
 * they offer, so descending never removes a facet the user saw above. Counts and availability come from
 * the browsed node's own population.
 */
function treeRootId(nodes: readonly ManufacturerNode[], nodeId: number): number {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const seen = new Set<number>();
  let current = byId.get(nodeId);
  while (current && current.parentId !== null && byId.has(current.parentId) && !seen.has(current.id)) {
    seen.add(current.id);
    current = byId.get(current.parentId);
  }
  return current?.id ?? nodeId;
}

type UniverseValue = { readonly value: string | number; readonly label: string | null };
interface FacetUniverse {
  readonly brands: readonly string[];
  readonly configurable: readonly boolean[];
  readonly attributes: ReadonlyMap<number, readonly UniverseValue[]>;
}
/** The values present anywhere in the tree root's population, regardless of query, listing or selections. */
function facetUniverse(database: Database.Database, rootId: number,
  attributes: readonly FilterableAttribute[], untrusted: ReadonlySet<number>): FacetUniverse {
  const cache = browseCache(database);
  const key = `universe:${rootId}:${attributes.map(a => a.id).join(",")}`;
  const cached = cache?.metadata.get(key) as FacetUniverse | undefined;
  if (cached) return remember(cache!.metadata, key, cached, 128) as FacetUniverse;
  const params: Params = { nodeId: rootId };
  const brands = (database.prepare(`${BROWSE_SCOPE_SQL} SELECT DISTINCT b.metel_marchio
    FROM cat_product p JOIN cat_brand b ON b.id=p.brand_id AND b.active=1 AND p.import_removed=0
    WHERE p.id IN (SELECT product_id FROM member) ORDER BY b.metel_marchio`).pluck().all(params) as string[]);
  const configurable = (database.prepare(`${BROWSE_SCOPE_SQL} SELECT DISTINCT ${CONFIGURABLE} AS value
    FROM cat_product p WHERE p.id IN (SELECT product_id FROM member) ORDER BY value`).pluck().all(params) as number[])
    .map(value => value === 1);
  const packageBrands = database.prepare(`${BROWSE_SCOPE_SQL} SELECT DISTINCT b.metel_marchio
    FROM tree t JOIN cat_range_node_model nm ON nm.node_id=t.id
    JOIN cat_config_model m ON m.id=nm.model_id JOIN cat_brand b ON b.id=m.brand_id
    WHERE ${SELECTABLE_PACKAGE_SQL}`).pluck().all(params) as string[];
  for (const brand of packageBrands) if (!brands.includes(brand)) brands.push(brand);
  brands.sort();
  if (packageBrands.length && !configurable.includes(true)) configurable.push(true);
  const byAttribute = new Map<number, UniverseValue[]>();
  if (attributes.length) {
    const kinds = new Map(attributes.map(attribute => [attribute.id, attribute.dataType]));
    const rows = database.prepare(`${BROWSE_SCOPE_SQL} SELECT pa.attribute_id AS attributeId,o.value AS optionValue,
      o.label AS label,pa.value_num AS num
      FROM (SELECT DISTINCT product_id FROM member) scoped
      JOIN cat_product_attribute pa ON pa.product_id=scoped.product_id
      LEFT JOIN cat_attribute_option o ON o.id=pa.option_id AND o.active=1
      WHERE pa.attribute_id IN (SELECT value FROM json_each(@attributeIds))
      GROUP BY pa.attribute_id,o.id,pa.value_num
      ORDER BY pa.attribute_id,o.sort_order,o.value,pa.value_num`)
      .all({ ...params, attributeIds: JSON.stringify(attributes.map(attribute => attribute.id)) }) as Array<{
        attributeId: number; optionValue: string | null; label: string | null; num: number | null }>;
    for (const row of rows) {
      const isNumber = kinds.get(row.attributeId) === "number";
      const value = isNumber ? row.num : row.optionValue;
      if (value === null) continue;
      const list = byAttribute.get(row.attributeId) ?? [];
      list.push({ value, label: isNumber ? null : row.label });
      byAttribute.set(row.attributeId, list);
    }
    const offerRows = database.prepare(`${BROWSE_SCOPE_SQL} SELECT DISTINCT v.attribute_id AS attributeId,
      o.value AS optionValue,o.label,v.value_num AS num
      FROM tree t JOIN cat_range_node_model nm ON nm.node_id=t.id
      JOIN cat_config_model m ON m.id=nm.model_id
      JOIN cat_config_model_offer f ON f.model_id=m.id AND f.status='feasible'
      JOIN cat_config_model_offer_value v ON v.model_id=f.model_id AND v.offer_no=f.offer_no
      LEFT JOIN cat_attribute_option o ON o.id=v.option_id AND o.active=1
      WHERE ${SELECTABLE_PACKAGE_SQL} AND v.attribute_id IN (SELECT value FROM json_each(@attributeIds))
        AND m.id NOT IN (SELECT value FROM json_each(@untrusted))`)
      .all({ ...params, attributeIds: JSON.stringify(attributes.map(attribute => attribute.id)),
        untrusted: JSON.stringify([...untrusted]) }) as Array<{
        attributeId: number; optionValue: string | null; label: string | null; num: number | null }>;
    for (const row of offerRows) {
      const isNumber = kinds.get(row.attributeId) === "number";
      const value = isNumber ? row.num : row.optionValue;
      if (value === null) continue;
      const list = byAttribute.get(row.attributeId) ?? [];
      if (!list.some(entry => entry.value === value)) list.push({ value, label: isNumber ? null : row.label });
      byAttribute.set(row.attributeId, list);
    }
    for (const attribute of attributes) if (attribute.dataType === "number")
      byAttribute.get(attribute.id)?.sort((a, b) => Number(a.value) - Number(b.value));
  }
  const result={ brands, configurable, attributes: byAttribute };
  if (cache) remember(cache.metadata, key, result, 128);
  return result;
}

/** Attributes with at least one stored value on an article of the browsed subtree. */
function applicableAttributeIds(database: Database.Database, nodeId: number,
  attributes: readonly FilterableAttribute[], untrusted: ReadonlySet<number>): Set<number> {
  if (attributes.length === 0) return new Set();
  const found = new Set(database.prepare(`${BROWSE_SCOPE_SQL} SELECT DISTINCT pa.attribute_id
    FROM (SELECT DISTINCT product_id FROM member) scoped
    JOIN cat_product_attribute pa ON pa.product_id=scoped.product_id
    LEFT JOIN cat_attribute_option o ON o.id=pa.option_id AND o.active=1
    WHERE pa.attribute_id IN (SELECT value FROM json_each(@attributeIds))
      AND (o.id IS NOT NULL OR pa.value_num IS NOT NULL)`).pluck()
    .all({ nodeId, attributeIds: JSON.stringify(attributes.map(attribute => attribute.id)) }) as number[]);
  const offerIds = database.prepare(`${BROWSE_SCOPE_SQL} SELECT DISTINCT v.attribute_id
    FROM tree t JOIN cat_range_node_model nm ON nm.node_id=t.id
    JOIN cat_config_model m ON m.id=nm.model_id
    JOIN cat_config_model_offer f ON f.model_id=m.id AND f.status='feasible'
    JOIN cat_config_model_offer_value v ON v.model_id=f.model_id AND v.offer_no=f.offer_no
    WHERE ${SELECTABLE_PACKAGE_SQL} AND v.attribute_id IN (SELECT value FROM json_each(@attributeIds))
      AND m.id NOT IN (SELECT value FROM json_each(@untrusted))`)
    .pluck().all({ nodeId, attributeIds: JSON.stringify(attributes.map(attribute => attribute.id)),
      untrusted: JSON.stringify([...untrusted]) }) as number[];
  for (const id of offerIds) found.add(id);
  return found;
}

/** One SQL population definition is used by results, totals, and every facet. */
export function browseCatalogue(database: Database.Database, request: CatalogueBrowseRequest): CatalogueBrowseResult {
  const { limit, offset } = resolvePaging(request);
  const navigation = browseManufacturerNodes(database);
  if (!navigation.some(node => node.id === request.nodeId)) {
    return { products: [], offset, hasMore: false, totalCount: 0, packages: [], packageCount: 0, undecidedPackages: [], packageOffersStale: false,
      facets: { brand: null, configurability: null, attributes: [] } };
  }

  const cache = browseCache(database);
  const scopeParams: Params = { nodeId: request.nodeId };
  const rootId = treeRootId(navigation, request.nodeId);
  const definitions = metadata(cache, `definitions:${rootId}`, () => {
    const rootCategories = (database.prepare(`${BROWSE_SCOPE_SQL} SELECT DISTINCT id FROM (
      SELECT p.category_id AS id FROM member JOIN cat_product p ON p.id=member.product_id WHERE p.category_id IS NOT NULL
      UNION SELECT m.category_id AS id FROM tree t JOIN cat_range_node_model nm ON nm.node_id=t.id
        JOIN cat_config_model m ON m.id=nm.model_id WHERE ${SELECTABLE_PACKAGE_SQL} AND m.category_id IS NOT NULL)`)
      .all({ nodeId: rootId }) as { id: number }[]).map(row => row.id);
    return filterableAttributes(database, rootCategories);
  });
  // A selection survives navigation to a branch that does not define its attribute: it still filters
  // (the branch then has no match) and is reported. Only a code that exists nowhere is rejected.
  const categories = metadata(cache, "categories", () => allCategoryScope(database));
  const everyAttribute = metadata(cache, "attributes", () => new Map(filterableAttributes(database, categories)
    .map(attribute => [attribute.code, attribute])));
  const filters = resolveAttributeFilters(database, categories, request.attributeFilters ?? []);
  const brandCodes = request.brandMarchio ?? [];
  if (new Set(brandCodes).size !== brandCodes.length) throw new InvalidCatalogueFilterError("duplicate brand");
  const brandIds = brandCodes.map(code => {
    const id = database.prepare("SELECT id FROM cat_brand WHERE metel_marchio=?").pluck().get(code) as number | undefined;
    if (id === undefined) throw new InvalidCatalogueFilterError(`unknown brand "${code}"`);
    return id;
  });
  const configValues = request.configurable ?? [];
  if (new Set(configValues).size !== configValues.length) throw new InvalidCatalogueFilterError("duplicate configurability value");
  const search = parseSearchTerms(request.query ?? "");
  // Offer trust is evaluated once per browse and applied to matches, counts and the facet universe.
  const untrusted = metadata(cache, "untrusted", () => untrustedPackageModels(database));
  const scoped = scopedPackages(database, request, search, brandIds, configValues, untrusted);

  const population = (excluded: string | null, params: Params): string => {
    // `member` already excludes disabled brands and removed identities. Keeping
    // this scope as the driver avoids a full-brand scan for each narrow facet.
    const conditions = ["p.id IN (SELECT product_id FROM member)", ...textConditions(search, params)];
    if (request.listedOnly === true) conditions.push("p.is_listed=1");
    if (excluded !== "brand" && brandIds.length) {
      params.brands = JSON.stringify(brandIds);
      conditions.push("p.brand_id IN (SELECT value FROM json_each(@brands))");
    }
    if (excluded !== "configurability" && configValues.length === 1) {
      conditions.push(configValues[0] ? CONFIGURABLE : `NOT ${CONFIGURABLE}`);
    }
    for (const filter of filters) {
      if (excluded === `attribute:${filter.attributeId}`) continue;
      params[`attribute_${filter.attributeId}`] = filter.attributeId;
      params[`values_${filter.attributeId}`] = JSON.stringify(filter.values);
      conditions.push(`EXISTS (SELECT 1 FROM cat_product_attribute pa
        WHERE pa.product_id=p.id AND pa.attribute_id=@attribute_${filter.attributeId}
        AND pa.${filter.column} IN (SELECT value FROM json_each(@values_${filter.attributeId})))`);
    }
    return conditions.join(" AND ");
  };
  const params: Params = { ...scopeParams };
  const where = population(null, params);
  const summaryKey = JSON.stringify({ nodeId: request.nodeId, query: request.query ?? "", listedOnly: request.listedOnly === true,
    brands: brandCodes, configurability: configValues, attributes: request.attributeFilters ?? [] });
  const cachedSummary = cache?.summaries.get(summaryKey);
  if (cachedSummary) remember(cache!.summaries, summaryKey, cachedSummary, 32);
  const totalCount = cachedSummary?.totalCount ?? database.prepare(`${BROWSE_SCOPE_SQL} SELECT COUNT(*) FROM cat_product p WHERE ${where}`)
    .pluck().get(params) as number;
  const pageParams: Params = { ...params, limit: limit + 1, offset };
  const rows = database.prepare(`${BROWSE_SCOPE_SQL}, page AS (
    SELECT p.id FROM cat_product p WHERE ${where}
    ORDER BY p.is_listed DESC,p.code_norm,p.manufacturer_code,p.id
    LIMIT @limit OFFSET @offset
  ) SELECT p.id,${CONFIGURABLE} AS configurable,
    b.metel_marchio AS brandMarchio,b.name AS brandName,
    p.manufacturer_code AS manufacturerCode,p.short_description AS description,
    p.unit_of_measure AS unitOfMeasure,p.is_listed AS isListed,
    c.code AS categoryCode,c.name AS categoryName,
    pr.list_price_unit_e4 AS unitPriceE4,pr.list_price_e4 AS listPriceE4,
    pr.price_multiplier AS priceMultiplier,pr.currency,
    i.metel_sigla AS priceIssuerSigla
    FROM page JOIN cat_product p ON p.id=page.id JOIN cat_brand b ON b.id=p.brand_id AND b.active=1 AND p.import_removed=0
    LEFT JOIN cat_category c ON c.id=p.category_id
    LEFT JOIN cat_product_listing governing ON governing.product_id=p.id
      AND governing.issuer_id=p.governing_issuer_id AND governing.is_listed=1
    LEFT JOIN com_price_list pl ON pl.issuer_id=governing.issuer_id AND pl.is_current=1
    LEFT JOIN com_product_price pr ON pr.product_id=p.id AND pr.price_list_id=pl.id
    LEFT JOIN cat_metel_issuer i ON i.id=pl.issuer_id
    ORDER BY p.is_listed DESC,p.code_norm,p.manufacturer_code,p.id`)
    .all(pageParams) as BrowseRow[];
  const page = rows.slice(0, limit);
  const pageAttributes = productAttributes(database, page.map(row => row.id));
  const products = page.map(row => ({ ...productFromRow(row, pageAttributes.get(row.id) ?? []), configurable: row.configurable === 1 }));
  const packages = browsePackages(database, request, scoped, filters, offset);
  if (cachedSummary) return { products, offset, hasMore: rows.length > limit, ...packages, ...structuredClone(cachedSummary) };

  const facetParams = (excluded: string): { params: Params; where: string } => {
    const values: Params = { ...scopeParams };
    return { params: values, where: population(excluded, values) };
  };
  const universe = facetUniverse(database, rootId, definitions, untrusted);
  const applicable = metadata(cache, `applicable:${request.nodeId}`, () =>
    applicableAttributeIds(database, request.nodeId, definitions, untrusted));

  const brandPopulation = facetParams("brand");
  const brandCounts = new Map((database.prepare(`${BROWSE_SCOPE_SQL} SELECT b.metel_marchio AS value,COUNT(*) AS count
    FROM cat_product p JOIN cat_brand b ON b.id=p.brand_id AND b.active=1 AND p.import_removed=0
    WHERE ${brandPopulation.where} GROUP BY b.id`)
    .all(brandPopulation.params) as { value: string; count: number }[]).map(row => [row.value, row.count]));
  const brandPackages = brandIds.length
    ? scopedPackages(database, request, search, brandIds, configValues, untrusted, "brand") : scoped;
  for (const row of brandPackages) {
    if (filters.length && !matchingOffer(row, filters, "feasible")) continue;
    brandCounts.set(row.brandMarchio, (brandCounts.get(row.brandMarchio) ?? 0) + 1);
  }
  const brandValues = [...universe.brands, ...brandCodes.filter(code => !universe.brands.includes(code))];
  const brand = brandValues.length > 1 || brandCodes.length ? { values: brandValues.map(value => ({
    value, count: brandCounts.get(value) ?? 0, selected: brandCodes.includes(value) })) } : null;

  const configPopulation = facetParams("configurability");
  const configCounts = new Map((database.prepare(`${BROWSE_SCOPE_SQL} SELECT ${CONFIGURABLE} AS value,COUNT(*) AS count
    FROM cat_product p WHERE ${configPopulation.where} GROUP BY value`)
    .all(configPopulation.params) as { value: number; count: number }[]).map(row => [row.value, row.count]));
  const configPackages = configValues.length === 1
    ? scopedPackages(database, request, search, brandIds, configValues, untrusted, "configurability") : scoped;
  const packageConfigCount = configPackages
    .filter(row => !filters.length || !!matchingOffer(row, filters, "feasible")).length;
  configCounts.set(1, (configCounts.get(1) ?? 0) + packageConfigCount);
  const configOffered = [false, true].filter(value => universe.configurable.includes(value) || configValues.includes(value));
  const configurability = configOffered.length > 1 || configValues.length ? { values: configOffered.map(value => ({
    value, count: configCounts.get(Number(value)) ?? 0, selected: configValues.includes(value) })) } : null;

  const selectedValues = (code: string) => (request.attributeFilters ?? []).find(f => f.attributeCode === code)?.values ?? [];
  const optionLabel = (attributeId: number, value: string | number, isNumber: boolean): string | null => isNumber ? null :
    (database.prepare("SELECT label FROM cat_attribute_option WHERE attribute_id=? AND value=?")
      .pluck().get(attributeId, value) as string | undefined ?? null);
  const technical: CatalogueBrowseFilterAttribute[] = [];
  const unselected = definitions.filter(attribute => applicable.has(attribute.id) && selectedValues(attribute.code).length === 0 &&
    (universe.attributes.get(attribute.id)?.length ?? 0) >= 2);
  const grouped = new Map<number, Map<string | number, number>>();
  if (unselected.length) {
    const groupedRows = database.prepare(`${BROWSE_SCOPE_SQL}, matches AS MATERIALIZED (
      SELECT p.id FROM cat_product p WHERE ${where}
    ) SELECT pa.attribute_id AS attributeId,
      CASE WHEN a.data_type='number' THEN pa.value_num ELSE o.value END AS value,
      COUNT(DISTINCT pa.product_id) AS count
      FROM matches JOIN cat_product_attribute pa ON pa.product_id=matches.id
      JOIN cat_attribute a ON a.id=pa.attribute_id
      LEFT JOIN cat_attribute_option o ON o.id=pa.option_id
      WHERE pa.attribute_id IN (SELECT value FROM json_each(@facetIds))
        AND ((a.data_type='number' AND pa.value_num IS NOT NULL) OR (a.data_type='enum' AND o.active=1))
      GROUP BY pa.attribute_id,CASE WHEN a.data_type='number' THEN pa.value_num ELSE o.value END`)
      .all({ ...params, facetIds: JSON.stringify(unselected.map(attribute => attribute.id)) }) as
      Array<{ attributeId: number; value: string | number; count: number }>;
    for (const row of groupedRows) {
      const values = grouped.get(row.attributeId) ?? new Map<string | number, number>();
      values.set(row.value, row.count); grouped.set(row.attributeId, values);
    }
  }
  for (const attribute of definitions) {
    const selected = selectedValues(attribute.code);
    const offered = universe.attributes.get(attribute.id) ?? [];
    if (offered.length < 2 && selected.length === 0) continue;
    const isNumber = attribute.dataType === "number";
    const isApplicable = applicable.has(attribute.id);
    // Without any stored value in the subtree every count is 0: skip the scan.
    const counts = new Map(grouped.get(attribute.id));
    if (isApplicable) {
      if (selected.length) {
        const facet = facetParams(`attribute:${attribute.id}`);
        const rows = database.prepare(`${BROWSE_SCOPE_SQL} SELECT ${isNumber ? "pa.value_num" : "o.value"} AS value,
          COUNT(DISTINCT p.id) AS count
          FROM cat_product p JOIN cat_product_attribute pa ON pa.product_id=p.id AND pa.attribute_id=@facetId
          LEFT JOIN cat_attribute_option o ON o.id=pa.option_id
          WHERE ${facet.where} AND ${isNumber ? "pa.value_num IS NOT NULL" : "o.active=1"}
          GROUP BY ${isNumber ? "pa.value_num" : "o.value"}`)
          .all({ ...facet.params, facetId: attribute.id }) as Array<{ value: string | number; count: number }>;
        for (const row of rows) counts.set(row.value, row.count);
      }
      for (const row of scoped) {
        const values = new Set<number>();
        for (const offer of row.offers) if (offer.status === "feasible" && matchesOffer(offer, filters, attribute.id)) {
          const value = offer.values.get(attribute.id);
          if (value !== undefined) values.add(value);
        }
        for (const value of values) {
          const displayed = isNumber ? value : database.prepare("SELECT value FROM cat_attribute_option WHERE id=?")
            .pluck().get(value) as string | undefined;
          if (displayed !== undefined) counts.set(displayed, (counts.get(displayed) ?? 0) + 1);
        }
      }
    }
    const values: CatalogueFilterValue[] = offered.map(entry => ({
      value: entry.value, label: entry.label, count: counts.get(entry.value) ?? 0, selected: selected.includes(entry.value),
    }));
    for (const value of selected) {
      if (values.some(row => row.value === value)) continue;
      values.push({ value, label: optionLabel(attribute.id, value, isNumber), count: 0, selected: true });
    }
    technical.push({ code: attribute.code, name: attribute.name, dataType: attribute.dataType,
      unit: attribute.unit, values, applicable: isApplicable });
  }
  // Selections whose attribute this branch does not define stay visible and removable.
  for (const filter of request.attributeFilters ?? []) {
    if (definitions.some(attribute => attribute.code === filter.attributeCode)) continue;
    const attribute = everyAttribute.get(filter.attributeCode)!;
    const isNumber = attribute.dataType === "number";
    technical.push({ code: attribute.code, name: attribute.name, dataType: attribute.dataType, unit: attribute.unit,
      values: filter.values.map(value => ({ value, label: optionLabel(attribute.id, value, isNumber), count: 0, selected: true })),
      applicable: false });
  }
  const facets = { brand, configurability, attributes: technical };
  if (cache) remember(cache.summaries, summaryKey, structuredClone({ facets, totalCount }), 32);
  return { products, offset, hasMore: rows.length > limit, totalCount, ...packages, facets };
}
