import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  type AnySQLiteColumn,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const metelIssuer = sqliteTable(
  "cat_metel_issuer",
  {
    id: integer("id").primaryKey(),
    metelSigla: text("metel_sigla").notNull(),
    piva: text("piva"),
    name: text("name"),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("cat_metel_issuer_sigla_unique").on(table.metelSigla),
  ],
);

export const manufacturer = sqliteTable(
  "cat_manufacturer",
  {
    id: integer("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    source: text("source", { enum: ["seed", "manual"] }).notNull(),
  },
  (table) => [
    uniqueIndex("cat_manufacturer_code_unique").on(table.code),
    check(
      "cat_manufacturer_source_check",
      sql`${table.source} in ('seed', 'manual')`,
    ),
  ],
);

export const brand = sqliteTable(
  "cat_brand",
  {
    id: integer("id").primaryKey(),
    metelMarchio: text("metel_marchio").notNull(),
    name: text("name").notNull(),
    active: integer("active").notNull().default(1),
    importRemoved: integer("import_removed").notNull().default(0),
    manufacturerId: integer("manufacturer_id").references(() => manufacturer.id),
    preferredIssuerId: integer("preferred_issuer_id").references(
      () => metelIssuer.id,
    ),
    source: text("source", {
      enum: ["import", "seed", "manual"],
    }).notNull(),
  },
  (table) => [
    uniqueIndex("cat_brand_metel_marchio_unique").on(table.metelMarchio),
    check("cat_brand_active_check", sql`${table.active} in (0, 1)`),
    check("cat_brand_import_removed_check", sql`${table.importRemoved} in (0, 1)`),
    check(
      "cat_brand_source_check",
      sql`${table.source} in ('import', 'seed', 'manual')`,
    ),
  ],
);

export const importDelivery = sqliteTable(
  "app_import_delivery",
  {
    id: integer("id").primaryKey(),
    issuerId: integer("issuer_id")
      .notNull()
      .references(() => metelIssuer.id),
    fingerprint: text("fingerprint").notNull(),
    listinoNumber: text("listino_number").notNull(),
    validFrom: text("valid_from").notNull(),
    becameCurrent: integer("became_current").notNull(),
    normalizedAt: text("normalized_at").notNull(),
    summaryJson: text("summary_json").notNull(),
  },
  (table) => [
    uniqueIndex("app_import_delivery_fingerprint_unique").on(table.fingerprint),
    index("app_import_delivery_issuer_valid_from_idx").on(
      table.issuerId,
      table.validFrom,
    ),
    check(
      "app_import_delivery_fingerprint_length",
      sql`length(${table.fingerprint}) = 64`,
    ),
    check(
      "app_import_delivery_current_check",
      sql`${table.becameCurrent} in (0, 1)`,
    ),
    check(
      "app_import_delivery_summary_json_check",
      sql`json_valid(${table.summaryJson})`,
    ),
  ],
);

/** Issuer/brand commercial data explicitly removed; enables same-file restoration. */
export const removedBrandListing = sqliteTable("app_removed_brand_listing", {
  brandId: integer("brand_id").notNull().references(() => brand.id),
  issuerId: integer("issuer_id").notNull().references(() => metelIssuer.id),
}, table => [primaryKey({columns:[table.brandId,table.issuerId]})]);

export const issuerBrand = sqliteTable(
  "cat_issuer_brand",
  {
    issuerId: integer("issuer_id")
      .notNull()
      .references(() => metelIssuer.id),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brand.id),
    firstSeenDeliveryId: integer("first_seen_delivery_id")
      .notNull()
      .references(() => importDelivery.id),
    lastSeenDeliveryId: integer("last_seen_delivery_id")
      .notNull()
      .references(() => importDelivery.id),
  },
  (table) => [primaryKey({ columns: [table.issuerId, table.brandId] })],
);

export const metelFamily = sqliteTable(
  "cat_metel_family",
  {
    id: integer("id").primaryKey(),
    issuerId: integer("issuer_id")
      .notNull()
      .references(() => metelIssuer.id),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brand.id),
    familyType: text("family_type", {
      enum: ["SCONTO", "STATISTICA"],
    }).notNull(),
    code: text("code").notNull(),
    description: text("description"),
    parentId: integer("parent_id").references(
      (): AnySQLiteColumn => metelFamily.id,
    ),
    isKnown: integer("is_known").notNull(),
  },
  (table) => [
    uniqueIndex("cat_metel_family_identity_unique").on(
      table.issuerId,
      table.brandId,
      table.familyType,
      table.code,
    ),
    index("cat_metel_family_brand_type_idx").on(
      table.brandId,
      table.familyType,
    ),
    check(
      "cat_metel_family_type_check",
      sql`${table.familyType} in ('SCONTO', 'STATISTICA')`,
    ),
    check("cat_metel_family_known_check", sql`${table.isKnown} in (0, 1)`),
  ],
);

export const category = sqliteTable("cat_category", {
  id: integer("id").primaryKey(),
  parentId: integer("parent_id").references((): AnySQLiteColumn => category.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active").notNull().default(1),
  source: text("source", { enum: ["seed", "manual"] }).notNull(),
}, (table) => [
  uniqueIndex("cat_category_code_unique").on(table.code),
  index("cat_category_parent_idx").on(table.parentId),
  check("cat_category_active_check", sql`${table.active} in (0, 1)`),
  check("cat_category_source_check", sql`${table.source} in ('seed', 'manual')`),
]);

export const categoryMapping = sqliteTable("cat_category_mapping", {
  id: integer("id").primaryKey(),
  code: text("code").notNull(),
  brandId: integer("brand_id").references(() => brand.id),
  issuerId: integer("issuer_id").references(() => metelIssuer.id),
  sourceType: text("source_type", {
    enum: ["STATISTICA", "SCONTO", "ELECTROCOD", "CODE_PREFIX", "DESCRIPTION"],
  }).notNull(),
  matchMode: text("match_mode", { enum: ["exact", "prefix", "regex"] }).notNull(),
  matchValue: text("match_value").notNull(),
  categoryId: integer("category_id").notNull().references(() => category.id),
  priority: integer("priority").notNull().default(0),
  notes: text("notes"),
  source: text("source", { enum: ["seed", "manual"] }).notNull(),
}, (table) => [
  uniqueIndex("cat_category_mapping_code_unique").on(table.code),
  check("cat_category_mapping_type_check", sql`${table.sourceType} in ('STATISTICA', 'SCONTO', 'ELECTROCOD', 'CODE_PREFIX', 'DESCRIPTION')`),
  check("cat_category_mapping_mode_check", sql`${table.matchMode} in ('exact', 'prefix', 'regex')`),
  check("cat_category_mapping_source_check", sql`${table.source} in ('seed', 'manual')`),
]);

export const appSetting = sqliteTable("app_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** "Recenti" list of project documents (DATABASE_DESIGN §6); not a project library. */
export const appRecentFile = sqliteTable(
  "app_recent_file",
  {
    path: text("path").primaryKey(),
    projectUuid: text("project_uuid").notNull(),
    title: text("title").notNull(),
    lastOpenedAt: text("last_opened_at").notNull(),
  },
  (table) => [index("app_recent_file_last_opened_idx").on(table.lastOpenedAt)],
);

export const product = sqliteTable(
  "cat_product",
  {
    id: integer("id").primaryKey(),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brand.id),
    manufacturerCode: text("manufacturer_code").notNull(),
    codeNorm: text("code_norm").notNull(),
    importRemoved: integer("import_removed").notNull().default(0),
    governingIssuerId: integer("governing_issuer_id").references(
      () => metelIssuer.id,
    ),
    ean: text("ean"),
    shortDescription: text("short_description"),
    unitOfMeasure: text("unit_of_measure"),
    packQty: integer("pack_qty"),
    minOrderQty: integer("min_order_qty"),
    orderMultiple: integer("order_multiple"),
    maxOrderQty: integer("max_order_qty"),
    leadTimeCode: text("lead_time_code"),
    lifecycleStatusCode: text("lifecycle_status_code"),
    isKit: integer("is_kit"),
    electrocod: text("electrocod"),
    discountFamilyId: integer("discount_family_id").references(
      () => metelFamily.id,
    ),
    statisticalFamilyId: integer("statistical_family_id").references(
      () => metelFamily.id,
    ),
    description: text("description"),
    searchText: text("search_text"),
    categoryId: integer("category_id").references(() => category.id),
    categorySource: text("category_source", { enum: ["mapping", "manual", "unmapped"] }).notNull().default("unmapped"),
    categoryMappingId: integer("category_mapping_id").references(() => categoryMapping.id, { onDelete: "set null" }),
    categoryModelId: integer("category_model_id").references(() => configModel.id, { onDelete: "set null" }),
    isListed: integer("is_listed").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("cat_product_brand_code_unique").on(
      table.brandId,
      table.manufacturerCode,
    ),
    index("cat_product_code_norm_idx").on(table.codeNorm),
    index("cat_product_ean_idx").on(table.ean),
    index("cat_product_category_listed_idx").on(table.categoryId, table.isListed),
    index("cat_product_review_group_idx").on(table.governingIssuerId, table.brandId, table.statisticalFamilyId, table.isListed),
    check("cat_product_category_source_check", sql`${table.categorySource} in ('mapping', 'manual', 'unmapped')`),
    index("cat_product_brand_listed_idx").on(table.brandId, table.isListed),
    index("cat_product_statistical_family_idx").on(table.statisticalFamilyId),
    index("cat_product_discount_family_idx").on(table.discountFamilyId),
    check("cat_product_is_kit_check", sql`${table.isKit} is null or ${table.isKit} in (0, 1)`),
    check("cat_product_is_listed_check", sql`${table.isListed} in (0, 1)`),
    check("cat_product_import_removed_check", sql`${table.importRemoved} in (0, 1)`),
  ],
);

export const productListing = sqliteTable(
  "cat_product_listing",
  {
    productId: integer("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    issuerId: integer("issuer_id")
      .notNull()
      .references(() => metelIssuer.id),
    discountFamilyId: integer("discount_family_id").references(
      () => metelFamily.id,
    ),
    statisticalFamilyId: integer("statistical_family_id").references(
      () => metelFamily.id,
    ),
    lifecycleStatusCode: text("lifecycle_status_code").notNull(),
    leadTimeCode: text("lead_time_code").notNull(),
    ean: text("ean"),
    shortDescription: text("short_description").notNull(),
    unitOfMeasure: text("unit_of_measure").notNull(),
    packQty: integer("pack_qty").notNull(),
    minOrderQty: integer("min_order_qty").notNull(),
    orderMultiple: integer("order_multiple").notNull(),
    maxOrderQty: integer("max_order_qty").notNull(),
    isKit: integer("is_kit").notNull(),
    electrocod: text("electrocod"),
    isListed: integer("is_listed").notNull(),
    firstSeenDeliveryId: integer("first_seen_delivery_id")
      .notNull()
      .references(() => importDelivery.id),
    lastSeenDeliveryId: integer("last_seen_delivery_id")
      .notNull()
      .references(() => importDelivery.id),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.issuerId] }),
    index("cat_product_listing_issuer_listed_idx").on(
      table.issuerId,
      table.isListed,
    ),
    check("cat_product_listing_kit_check", sql`${table.isKit} in (0, 1)`),
    check("cat_product_listing_listed_check", sql`${table.isListed} in (0, 1)`),
  ],
);

export const priceList = sqliteTable(
  "com_price_list",
  {
    id: integer("id").primaryKey(),
    issuerId: integer("issuer_id")
      .notNull()
      .references(() => metelIssuer.id),
    deliveryId: integer("delivery_id")
      .notNull()
      .references(() => importDelivery.id),
    listinoNumber: text("listino_number").notNull(),
    validFrom: text("valid_from").notNull(),
    isCurrent: integer("is_current").notNull(),
  },
  (table) => [
    uniqueIndex("com_price_list_delivery_unique").on(table.deliveryId),
    uniqueIndex("com_price_list_one_current_per_issuer")
      .on(table.issuerId)
      .where(sql`${table.isCurrent} = 1`),
    check("com_price_list_current_check", sql`${table.isCurrent} in (0, 1)`),
  ],
);

export const productPrice = sqliteTable(
  "com_product_price",
  {
    productId: integer("product_id")
      .notNull()
      .references(() => product.id),
    priceListId: integer("price_list_id")
      .notNull()
      .references(() => priceList.id, { onDelete: "cascade" }),
    listPriceE4: integer("list_price_e4").notNull(),
    priceMultiplier: integer("price_multiplier").notNull(),
    currency: text("currency").notNull(),
    listPriceUnitE4: integer("list_price_unit_e4").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.priceListId] }),
    check(
      "com_product_price_list_price_integer",
      sql`typeof(${table.listPriceE4}) = 'integer'`,
    ),
    check(
      "com_product_price_unit_price_integer",
      sql`typeof(${table.listPriceUnitE4}) = 'integer'`,
    ),
    check(
      "com_product_price_multiplier_check",
      sql`typeof(${table.priceMultiplier}) = 'integer' and ${table.priceMultiplier} > 0`,
    ),
  ],
);

export const importFile = sqliteTable(
  "app_import_file",
  {
    deliveryId: integer("delivery_id")
      .notNull()
      .references(() => importDelivery.id, { onDelete: "cascade" }),
    fileType: text("file_type", { enum: ["LSP", "FSC", "FST"] }).notNull(),
    fileSha256: text("file_sha256").notNull(),
    originalFileName: text("original_file_name").notNull(),
    layoutVersion: text("layout_version", { enum: ["020", "021"] }).notNull(),
    rowCount: integer("row_count").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.deliveryId, table.fileType] }),
    index("app_import_file_sha256_idx").on(table.fileSha256),
    check(
      "app_import_file_type_check",
      sql`${table.fileType} in ('LSP', 'FSC', 'FST')`,
    ),
    check(
      "app_import_file_layout_check",
      sql`${table.layoutVersion} in ('020', '021')`,
    ),
    check(
      "app_import_file_sha256_length",
      sql`length(${table.fileSha256}) = 64`,
    ),
    check("app_import_file_row_count_check", sql`${table.rowCount} >= 0`),
  ],
);

// Technical attributes (DATABASE_DESIGN §5.4). Definitions, options and
// category applicability are seed/manual reference data; retired codes become
// inactive and are never reused.
export const attribute = sqliteTable("cat_attribute", {
  id: integer("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  dataType: text("data_type", { enum: ["number", "enum", "boolean", "text"] }).notNull(),
  unit: text("unit"),
  etimFeatureCode: text("etim_feature_code"),
  active: integer("active").notNull().default(1),
  source: text("source", { enum: ["seed", "manual"] }).notNull(),
}, (table) => [
  uniqueIndex("cat_attribute_code_unique").on(table.code),
  check("cat_attribute_data_type_check", sql`${table.dataType} in ('number', 'enum', 'boolean', 'text')`),
  check("cat_attribute_unit_check", sql`${table.unit} is null or ${table.dataType} = 'number'`),
  check("cat_attribute_active_check", sql`${table.active} in (0, 1)`),
  check("cat_attribute_source_check", sql`${table.source} in ('seed', 'manual')`),
]);

export const attributeOption = sqliteTable("cat_attribute_option", {
  id: integer("id").primaryKey(),
  attributeId: integer("attribute_id").notNull().references(() => attribute.id),
  value: text("value").notNull(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active").notNull().default(1),
  source: text("source", { enum: ["seed", "manual"] }).notNull(),
}, (table) => [
  uniqueIndex("cat_attribute_option_value_unique").on(table.attributeId, table.value),
  check("cat_attribute_option_active_check", sql`${table.active} in (0, 1)`),
  check("cat_attribute_option_source_check", sql`${table.source} in ('seed', 'manual')`),
]);

export const categoryAttribute = sqliteTable("cat_category_attribute", {
  categoryId: integer("category_id").notNull().references(() => category.id),
  attributeId: integer("attribute_id").notNull().references(() => attribute.id),
  isFilterable: integer("is_filterable").notNull().default(1),
  isRequired: integer("is_required").notNull().default(0),
  filterWidget: text("filter_widget", { enum: ["range", "checkbox", "select"] }).notNull().default("checkbox"),
  sortOrder: integer("sort_order").notNull().default(0),
  source: text("source", { enum: ["seed", "manual"] }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.categoryId, table.attributeId] }),
  index("cat_category_attribute_attribute_idx").on(table.attributeId),
  check("cat_category_attribute_filterable_check", sql`${table.isFilterable} in (0, 1)`),
  check("cat_category_attribute_required_check", sql`${table.isRequired} in (0, 1)`),
  check("cat_category_attribute_widget_check", sql`${table.filterWidget} in ('range', 'checkbox', 'select')`),
  check("cat_category_attribute_source_check", sql`${table.source} in ('seed', 'manual')`),
]);

export const productAttribute = sqliteTable("cat_product_attribute", {
  productId: integer("product_id").notNull().references(() => product.id, { onDelete: "cascade" }),
  attributeId: integer("attribute_id").notNull().references(() => attribute.id),
  valueNum: real("value_num"),
  optionId: integer("option_id").references(() => attributeOption.id),
  valueBool: integer("value_bool"),
  valueText: text("value_text"),
  source: text("source", { enum: ["parser", "engineering", "import_file", "seed", "manual"] }).notNull(),
  confidence: real("confidence"),
  sourceImportId: integer("source_import_id").references(() => sourceImport.id),
  derivationRef: text("derivation_ref"),
}, (table) => [
  primaryKey({ columns: [table.productId, table.attributeId] }),
  index("cat_product_attribute_option_idx").on(table.attributeId, table.optionId, table.productId),
  index("cat_product_attribute_number_idx").on(table.attributeId, table.valueNum, table.productId),
  check("cat_product_attribute_one_value_check", sql`(${table.valueNum} is not null) + (${table.optionId} is not null) + (${table.valueBool} is not null) + (${table.valueText} is not null) = 1`),
  check("cat_product_attribute_bool_check", sql`${table.valueBool} is null or ${table.valueBool} in (0, 1)`),
  check("cat_product_attribute_source_check", sql`${table.source} in ('parser', 'engineering', 'import_file', 'seed', 'manual')`),
  check("cat_product_attribute_provenance_check", sql`(${table.source} = 'engineering') = (${table.sourceImportId} is not null and ${table.derivationRef} is not null)`),
]);

// Configurable product families (DATABASE_DESIGN Revision 6, §5.5).
// Membership deliberately remains outside cat_product: no assignment row means
// unassigned, while manual states are protected from automatic regrouping.
export const productFamily = sqliteTable("cat_product_family", {
  id: integer("id").primaryKey(),
  brandId: integer("brand_id").notNull().references(() => brand.id),
  code: text("code").notNull(),
  categoryId: integer("category_id").notNull().references(() => category.id),
  name: text("name").notNull(),
  series: text("series"),
  description: text("description"),
  active: integer("active").notNull().default(1),
  source: text("source", { enum: ["seed", "manual"] }).notNull(),
}, (table) => [
  uniqueIndex("cat_product_family_brand_code_unique").on(table.brandId, table.code),
  check("cat_product_family_active_check", sql`${table.active} in (0, 1)`),
  check("cat_product_family_source_check", sql`${table.source} in ('seed', 'manual')`),
]);

export const familyVariantAxis = sqliteTable("cat_family_variant_axis", {
  familyId: integer("family_id").notNull().references(() => productFamily.id, { onDelete: "cascade" }),
  attributeId: integer("attribute_id").notNull().references(() => attribute.id),
  sortOrder: integer("sort_order").notNull(),
}, (table) => [
  primaryKey({ columns: [table.familyId, table.attributeId] }),
  uniqueIndex("cat_family_variant_axis_order_unique").on(table.familyId, table.sortOrder),
]);

export const productFamilyAssignment = sqliteTable("cat_product_family_assignment", {
  productId: integer("product_id").primaryKey().references(() => product.id, { onDelete: "cascade" }),
  familyId: integer("family_id").references(() => productFamily.id),
  state: text("state", { enum: ["grouper", "manual", "manual_excluded"] }).notNull(),
  grouperCode: text("grouper_code"),
  grouperVersion: text("grouper_version"),
}, (table) => [
  index("cat_product_family_assignment_family_idx").on(table.familyId),
  check("cat_product_family_assignment_state_check", sql`${table.state} in ('grouper', 'manual', 'manual_excluded')`),
  check("cat_product_family_assignment_family_check", sql`(${table.state} = 'manual_excluded') = (${table.familyId} is null)`),
  check("cat_product_family_assignment_grouper_check", sql`(
    ${table.state} = 'grouper' and ${table.grouperCode} is not null and ${table.grouperVersion} is not null
  ) or (
    ${table.state} in ('manual', 'manual_excluded') and ${table.grouperCode} is null and ${table.grouperVersion} is null
  )`),
]);

// Revision 8 catalogue engineering data. The definitions are additive: products
// and product families retain their existing identity and ownership.
export const sourceImport = sqliteTable("app_source_import", {
  id: integer("id").primaryKey(),
  adapterCode: text("adapter_code", { enum: ["tiquadri", "listino_bt", "assets", "sienergy"] }).notNull(),
  adapterVersion: text("adapter_version").notNull(),
  sourceLabel: text("source_label").notNull(),
  fingerprint: text("fingerprint").notNull(),
  importedAt: text("imported_at").notNull(),
  becameCurrent: integer("became_current").notNull(),
  summaryJson: text("summary_json").notNull(),
}, t => [
  uniqueIndex("app_source_import_fingerprint_unique").on(t.fingerprint),
  index("app_source_import_adapter_idx").on(t.adapterCode, t.importedAt),
  check("app_source_import_adapter_check", sql`${t.adapterCode} in ('tiquadri','listino_bt','assets','sienergy')`),
  check("app_source_import_fingerprint_check", sql`length(${t.fingerprint}) = 64`),
  check("app_source_import_current_check", sql`${t.becameCurrent} in (0,1)`),
  check("app_source_import_summary_check", sql`json_valid(${t.summaryJson})`),
]);

export const sourceImportFile = sqliteTable("app_source_import_file", {
  importId: integer("import_id").notNull().references(() => sourceImport.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["master", "dxf", "listino", "assets"] }).notNull(),
  fileSha256: text("file_sha256").notNull(),
  originalFileName: text("original_file_name").notNull(),
  byteSize: integer("byte_size").notNull(),
}, t => [
  primaryKey({ columns: [t.importId, t.role] }),
  index("app_source_import_file_sha_idx").on(t.fileSha256),
  check("app_source_import_file_role_check", sql`${t.role} in ('master','dxf','listino','assets')`),
  check("app_source_import_file_sha_check", sql`length(${t.fileSha256}) = 64`),
  check("app_source_import_file_size_check", sql`${t.byteSize} >= 0`),
]);

export const capacityKind = sqliteTable("cat_capacity_kind", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  unitLabel: text("unit_label").notNull(),
  displayDivisor: integer("display_divisor").notNull(),
  nominalPitchMm: real("nominal_pitch_mm"),
  source: text("source", { enum: ["seed", "manual"] }).notNull(),
}, t => [
  check("cat_capacity_kind_divisor_check", sql`typeof(${t.displayDivisor}) = 'integer' and ${t.displayDivisor} > 0`),
  check("cat_capacity_kind_pitch_check", sql`${t.nominalPitchMm} is null or ${t.nominalPitchMm} > 0`),
  check("cat_capacity_kind_source_check", sql`${t.source} in ('seed','manual')`),
]);

export const physicalClass = sqliteTable("cat_phys_class", {
  id: integer("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  source: text("source", { enum: ["import", "manual"] }).notNull(),
  sourceRef: text("source_ref"),
}, t => [
  uniqueIndex("cat_phys_class_code_unique").on(t.code),
  check("cat_phys_class_source_check", sql`${t.source} in ('import','manual')`),
]);

export const physicalProfileSet = sqliteTable("cat_phys_profile_set", {
  id: integer("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  source: text("source", { enum: ["import", "manual"] }).notNull(),
}, t => [
  uniqueIndex("cat_phys_profile_set_code_unique").on(t.code),
  check("cat_phys_profile_set_source_check", sql`${t.source} in ('import','manual')`),
]);

export const physicalProfile = sqliteTable("cat_phys_profile", {
  id: integer("id").primaryKey(),
  code: text("code").notNull(),
  profileSetId: integer("profile_set_id").notNull().references(() => physicalProfileSet.id),
  profileKey: integer("profile_key"),
  profileKind: text("profile_kind", { enum: ["device", "support", "enclosure"] }).notNull(),
  name: text("name").notNull(),
  mountingJson: text("mounting_json"),
  fitClassId: integer("fit_class_id").notNull().references(() => physicalClass.id),
  depthMm: real("depth_mm"),
  outerDepthMm: real("outer_depth_mm"),
  usableDepthMm: real("usable_depth_mm"),
  active: integer("active").notNull().default(1),
  source: text("source", { enum: ["import", "manual"] }).notNull(),
  sourceImportId: integer("source_import_id").references(() => sourceImport.id),
  sourceRef: text("source_ref"),
}, t => [
  uniqueIndex("cat_phys_profile_code_unique").on(t.code),
  uniqueIndex("cat_phys_profile_set_key_unique").on(t.profileSetId, t.profileKey),
  index("cat_phys_profile_class_idx").on(t.fitClassId),
  check("cat_phys_profile_kind_check", sql`${t.profileKind} in ('device','support','enclosure')`),
  check("cat_phys_profile_active_check", sql`${t.active} in (0,1)`),
  check("cat_phys_profile_source_check", sql`${t.source} in ('import','manual')`),
  check("cat_phys_profile_depth_check", sql`(${t.depthMm} is null or ${t.depthMm} >= 0) and (${t.outerDepthMm} is null or ${t.outerDepthMm} >= 0) and (${t.usableDepthMm} is null or ${t.usableDepthMm} >= 0)`),
]);

export const physicalProfileDemand = sqliteTable("cat_phys_profile_demand", {
  profileId: integer("profile_id").notNull().references(() => physicalProfile.id, { onDelete: "cascade" }),
  capacityKindCode: text("capacity_kind_code").notNull().references(() => capacityKind.code),
  amount: integer("amount").notNull(),
}, t => [
  primaryKey({ columns: [t.profileId, t.capacityKindCode] }),
  index("cat_phys_profile_demand_kind_idx").on(t.capacityKindCode),
  check("cat_phys_profile_demand_amount_check", sql`typeof(${t.amount}) = 'integer' and ${t.amount} >= 0`),
]);

export const physicalView = sqliteTable("cat_phys_view", {
  profileId: integer("profile_id").notNull().references(() => physicalProfile.id, { onDelete: "cascade" }),
  viewCode: text("view_code", { enum: ["front", "front_alt1", "front_alt2"] }).notNull(),
  widthMm: real("width_mm").notNull(),
  heightMm: real("height_mm").notNull(),
  insertDxMm: real("insert_dx_mm"),
  insertDyMm: real("insert_dy_mm"),
  symbolKind: text("symbol_kind").notNull(),
  assetKey: text("asset_key"),
}, t => [
  primaryKey({ columns: [t.profileId, t.viewCode] }),
  check("cat_phys_view_code_check", sql`${t.viewCode} in ('front','front_alt1','front_alt2')`),
  check("cat_phys_view_size_check", sql`${t.widthMm} > 0 and ${t.heightMm} > 0`),
]);

export const physicalZone = sqliteTable("cat_phys_zone", {
  mountingJson: text("mounting_json"),
  profileId: integer("profile_id").notNull().references(() => physicalProfile.id, { onDelete: "cascade" }),
  zoneNo: integer("zone_no").notNull(),
  layout: text("layout", { enum: ["linear", "stack", "slots"] }).notNull(),
  capacityKindCode: text("capacity_kind_code").references(() => capacityKind.code),
  capacityAmount: integer("capacity_amount"),
  originXMm: real("origin_x_mm"),
  originYMm: real("origin_y_mm"),
  lengthMm: real("length_mm"),
  breadthMm: real("breadth_mm"),
  direction: text("direction", { enum: ["horizontal", "vertical"] }),
  pitchMm: real("pitch_mm"),
  requiredViewCode: text("required_view_code", { enum: ["front", "front_alt1", "front_alt2"] }),
}, t => [
  primaryKey({ columns: [t.profileId, t.zoneNo] }),
  index("cat_phys_zone_kind_idx").on(t.capacityKindCode),
  check("cat_phys_zone_no_check", sql`${t.zoneNo} >= 0`),
  check("cat_phys_zone_layout_check", sql`${t.layout} in ('linear','stack','slots')`),
  check("cat_phys_zone_direction_check", sql`${t.direction} is null or ${t.direction} in ('horizontal','vertical')`),
  check("cat_phys_zone_view_check", sql`${t.requiredViewCode} is null or ${t.requiredViewCode} in ('front','front_alt1','front_alt2')`),
  check("cat_phys_zone_capacity_check", sql`${t.capacityAmount} is null or (typeof(${t.capacityAmount}) = 'integer' and ${t.capacityAmount} >= 0)`),
  check("cat_phys_zone_pitch_check", sql`${t.pitchMm} is null or ${t.pitchMm} > 0`),
]);

export const physicalZoneSlot = sqliteTable("cat_phys_zone_slot", {
  profileId: integer("profile_id").notNull(),
  zoneNo: integer("zone_no").notNull(),
  slotNo: integer("slot_no").notNull(),
  xMm: real("x_mm").notNull(),
  yMm: real("y_mm").notNull(),
}, t => [
  primaryKey({ columns: [t.profileId, t.zoneNo, t.slotNo] }),
  foreignKey({ columns: [t.profileId, t.zoneNo], foreignColumns: [physicalZone.profileId, physicalZone.zoneNo] }).onDelete("cascade"),
  check("cat_phys_zone_slot_no_check", sql`${t.slotNo} >= 0`),
]);

export const physicalAcceptSet = sqliteTable("cat_phys_accept_set", {
  id: integer("id").primaryKey(),
  code: text("code").notNull(),
  source: text("source", { enum: ["import", "manual"] }).notNull(),
}, t => [
  uniqueIndex("cat_phys_accept_set_code_unique").on(t.code),
  check("cat_phys_accept_set_source_check", sql`${t.source} in ('import','manual')`),
]);

export const physicalAcceptSetMember = sqliteTable("cat_phys_accept_set_member", {
  setId: integer("set_id").notNull().references(() => physicalAcceptSet.id, { onDelete: "cascade" }),
  classId: integer("class_id").notNull().references(() => physicalClass.id),
}, t => [
  primaryKey({ columns: [t.setId, t.classId] }),
  index("cat_phys_accept_set_member_class_idx").on(t.classId),
]);

export const physicalConstraint = sqliteTable("cat_phys_constraint", {
  profileId: integer("profile_id").notNull().references(() => physicalProfile.id, { onDelete: "cascade" }),
  relation: text("relation", { enum: ["parent", "ancestor"] }).notNull(),
  acceptSetId: integer("accept_set_id").notNull().references(() => physicalAcceptSet.id),
}, t => [
  primaryKey({ columns: [t.profileId, t.relation, t.acceptSetId] }),
  index("cat_phys_constraint_set_idx").on(t.acceptSetId),
  check("cat_phys_constraint_relation_check", sql`${t.relation} in ('parent','ancestor')`),
]);

export const productPhysical = sqliteTable("cat_product_physical", {
  productId: integer("product_id").primaryKey().references(() => product.id, { onDelete: "cascade" }),
  dinHalfModules: integer("din_half_modules"),
  widthMm: real("width_mm"),
  heightMm: real("height_mm"),
  depthMm: real("depth_mm"),
  weightG: real("weight_g"),
  source: text("source", { enum: ["import_file", "manual"] }).notNull(),
  sourceImportId: integer("source_import_id").references(() => sourceImport.id),
}, t => [
  check("cat_product_physical_source_check", sql`${t.source} in ('import_file','manual')`),
  check("cat_product_physical_din_check", sql`${t.dinHalfModules} is null or (typeof(${t.dinHalfModules}) = 'integer' and ${t.dinHalfModules} >= 0)`),
  check("cat_product_physical_measure_check", sql`(${t.widthMm} is null or ${t.widthMm} >= 0) and (${t.heightMm} is null or ${t.heightMm} >= 0) and (${t.depthMm} is null or ${t.depthMm} >= 0) and (${t.weightG} is null or ${t.weightG} >= 0)`),
]);

export const configDimension = sqliteTable("cat_config_dimension", {
  id: integer("id").primaryKey(),
  brandId: integer("brand_id").notNull().references(() => brand.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  attributeId: integer("attribute_id").references(() => attribute.id),
  active: integer("active").notNull().default(1),
  source: text("source", { enum: ["seed", "manual", "import"] }).notNull(),
  sourceImportId: integer("source_import_id").references(() => sourceImport.id),
  sourceRef: text("source_ref"),
}, t => [
  uniqueIndex("cat_config_dimension_brand_code_unique").on(t.brandId, t.code),
  index("cat_config_dimension_attribute_idx").on(t.attributeId),
  check("cat_config_dimension_active_check", sql`${t.active} in (0,1)`),
  check("cat_config_dimension_source_check", sql`${t.source} in ('seed','manual','import')`),
]);

export const configDimensionValue = sqliteTable("cat_config_dimension_value", {
  id: integer("id").primaryKey(),
  dimensionId: integer("dimension_id").notNull().references(() => configDimension.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  attributeOptionId: integer("attribute_option_id").references(() => attributeOption.id),
  valueNum: real("value_num"),
  active: integer("active").notNull().default(1),
  source: text("source", { enum: ["seed", "manual", "import"] }).notNull(),
  sourceRef: text("source_ref"),
}, t => [
  uniqueIndex("cat_config_dimension_value_code_unique").on(t.dimensionId, t.code),
  index("cat_config_dimension_value_attribute_option_idx").on(t.attributeOptionId),
  check("cat_config_dimension_value_active_check", sql`${t.active} in (0,1)`),
  check("cat_config_dimension_value_source_check", sql`${t.source} in ('seed','manual','import')`),
  check("cat_config_dimension_value_number_option_check", sql`${t.attributeOptionId} is null or ${t.valueNum} is null`),
]);

export const configValueAttribute = sqliteTable("cat_config_value_attribute", {
  valueId: integer("value_id").notNull().references(() => configDimensionValue.id, { onDelete: "cascade" }),
  attributeId: integer("attribute_id").notNull().references(() => attribute.id),
  valueNum: real("value_num"),
  optionId: integer("option_id").references(() => attributeOption.id),
  source: text("source", { enum: ["seed", "manual"] }).notNull(),
}, t => [
  primaryKey({ columns: [t.valueId, t.attributeId] }),
  index("cat_config_value_attribute_option_idx").on(t.attributeId, t.optionId),
  index("cat_config_value_attribute_number_idx").on(t.attributeId, t.valueNum),
  check("cat_config_value_attribute_value_check", sql`(${t.valueNum} is null) <> (${t.optionId} is null)`),
  check("cat_config_value_attribute_source_check", sql`${t.source} in ('seed','manual')`),
]);

export const configModel = sqliteTable("cat_config_model", {
  id: integer("id").primaryKey(),
  brandId: integer("brand_id").notNull().references(() => brand.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  modelKind: text("model_kind", { enum: ["device", "support", "enclosure", "accessory", "kit"] }).notNull(),
  categoryId: integer("category_id").references(() => category.id),
  categorySource: text("category_source", { enum: ["unmapped", "seed", "manual"] }).notNull().default("unmapped"),
  baseProfileId: integer("base_profile_id").references(() => physicalProfile.id),
  maxInsertQty: integer("max_insert_qty"),
  definitionFingerprint: text("definition_fingerprint").notNull(),
  active: integer("active").notNull().default(1),
  obsolete: integer("obsolete").notNull().default(0),
  source: text("source", { enum: ["import", "manual"] }).notNull(),
  sourceImportId: integer("source_import_id").references(() => sourceImport.id),
  sourceRef: text("source_ref"),
  contextPolicy: text("context_policy", { enum: ["unknown", "unrestricted", "restricted"] }).notNull().default("unknown"),
  commercialContribution: text("commercial_contribution", { enum: ["articles", "none"] }).notNull().default("articles"),
}, t => [
  uniqueIndex("cat_config_model_brand_code_unique").on(t.brandId, t.code),
  index("cat_config_model_category_idx").on(t.categoryId),
  index("cat_config_model_profile_idx").on(t.baseProfileId),
  check("cat_config_model_kind_check", sql`${t.modelKind} in ('device','support','enclosure','accessory','kit')`),
  check("cat_config_model_category_source_check", sql`${t.categorySource} in ('unmapped','seed','manual')`),
  check("cat_config_model_active_check", sql`${t.active} in (0,1)`),
  check("cat_config_model_obsolete_check", sql`${t.obsolete} in (0,1)`),
  check("cat_config_model_source_check", sql`${t.source} in ('import','manual')`),
  check("cat_config_model_max_insert_check", sql`${t.maxInsertQty} is null or ${t.maxInsertQty} > 0`),
  check("cat_config_model_context_policy_check", sql`${t.contextPolicy} in ('unknown','unrestricted','restricted')`),
  check("cat_config_model_commercial_contribution_check", sql`${t.commercialContribution} in ('articles','none')`),
]);

export const configModelAttribute = sqliteTable("cat_config_model_attribute", {
  modelId: integer("model_id").notNull().references(() => configModel.id, { onDelete: "cascade" }),
  attributeId: integer("attribute_id").notNull().references(() => attribute.id),
  valueNum: real("value_num"),
  optionId: integer("option_id").references(() => attributeOption.id),
  source: text("source", { enum: ["seed", "manual"] }).notNull(),
}, t => [
  primaryKey({ columns: [t.modelId, t.attributeId] }),
  index("cat_config_model_attribute_option_idx").on(t.attributeId, t.optionId),
  index("cat_config_model_attribute_number_idx").on(t.attributeId, t.valueNum),
  check("cat_config_model_attribute_value_check", sql`(${t.valueNum} is null) <> (${t.optionId} is null)`),
  check("cat_config_model_attribute_source_check", sql`${t.source} in ('seed','manual')`),
]);

/**
 * Generic capacity-filler designation: a model whose configurations are blank parts that close free
 * capacity of one kind (e.g. DIN-rail falsi poli). Written by an engineering adapter from reviewed
 * source evidence; runtime fill logic only reads this normalized fact and never names products.
 * Not part of the model definition fingerprint, so configured project items are unaffected.
 */
export const configCapacityFiller = sqliteTable("cat_config_capacity_filler", {
  modelId: integer("model_id").primaryKey().references(() => configModel.id, { onDelete: "cascade" }),
  capacityKindCode: text("capacity_kind_code").notNull().references(() => capacityKind.code),
  source: text("source", { enum: ["import", "manual"] }).notNull(),
  sourceRef: text("source_ref"),
}, t => [
  index("cat_config_capacity_filler_kind_idx").on(t.capacityKindCode),
  check("cat_config_capacity_filler_source_check", sql`${t.source} in ('import','manual')`),
]);

export const configContext = sqliteTable("cat_config_context", {
  id: integer("id").primaryKey(),
  brandId: integer("brand_id").notNull().references(() => brand.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  active: integer("active").notNull().default(1),
  source: text("source", { enum: ["import", "manual"] }).notNull(),
  sourceImportId: integer("source_import_id").references(() => sourceImport.id),
  sourceRef: text("source_ref"),
}, t => [
  uniqueIndex("cat_config_context_brand_code_unique").on(t.brandId, t.code),
  check("cat_config_context_active_check", sql`${t.active} in (0,1)`),
  check("cat_config_context_source_check", sql`${t.source} in ('import','manual')`),
]);

export const configModelContext = sqliteTable("cat_config_model_context", {
  modelId: integer("model_id").notNull().references(() => configModel.id, { onDelete: "cascade" }),
  contextId: integer("context_id").notNull().references(() => configContext.id),
  role: text("role", { enum: ["provides", "accepts"] }).notNull(),
}, t => [
  primaryKey({ columns: [t.modelId, t.role, t.contextId] }),
  index("cat_config_model_context_context_role_model_idx").on(t.contextId, t.role, t.modelId),
  check("cat_config_model_context_role_check", sql`${t.role} in ('provides','accepts')`),
]);

export const configModelArticle = sqliteTable("cat_config_model_article", {
  modelId: integer("model_id").notNull().references(() => configModel.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  productId: integer("product_id").references(() => product.id),
  refBrandMarchio: text("ref_brand_marchio").notNull(),
  refManufacturerCode: text("ref_manufacturer_code").notNull(),
  quantity: real("quantity").notNull(),
  role: text("role", { enum: ["primary", "component"] }).notNull(),
}, t => [
  primaryKey({ columns: [t.modelId, t.seq] }),
  index("cat_config_model_article_product_idx").on(t.productId),
  check("cat_config_model_article_quantity_check", sql`${t.quantity} > 0`),
  check("cat_config_model_article_role_check", sql`${t.role} in ('primary','component')`),
]);

export const configAxis = sqliteTable("cat_config_axis", {
  id: integer("id").primaryKey(),
  modelId: integer("model_id").notNull().references(() => configModel.id, { onDelete: "cascade" }),
  dimensionId: integer("dimension_id").notNull().references(() => configDimension.id),
  sortOrder: integer("sort_order").notNull(),
  label: text("label").notNull(),
  visibility: text("visibility", { enum: ["visible", "hidden"] }).notNull(),
  requirement: text("requirement", { enum: ["required", "optional"] }).notNull(),
  binding: text("binding", { enum: ["none", "match_container", "inherit_container"] }).notNull(),
  editableWhenPlaced: integer("editable_when_placed").notNull().default(0),
  selectsPrimary: integer("selects_primary").notNull().default(0),
}, t => [
  uniqueIndex("cat_config_axis_model_dimension_unique").on(t.modelId, t.dimensionId),
  uniqueIndex("cat_config_axis_model_order_unique").on(t.modelId, t.sortOrder),
  index("cat_config_axis_dimension_idx").on(t.dimensionId),
  check("cat_config_axis_visibility_check", sql`${t.visibility} in ('visible','hidden')`),
  check("cat_config_axis_requirement_check", sql`${t.requirement} in ('required','optional')`),
  check("cat_config_axis_binding_check", sql`${t.binding} in ('none','match_container','inherit_container')`),
  check("cat_config_axis_editable_check", sql`${t.editableWhenPlaced} in (0,1)`),
  check("cat_config_axis_primary_check", sql`${t.selectsPrimary} in (0,1)`),
]);

export const configOption = sqliteTable("cat_config_option", {
  id: integer("id").primaryKey(),
  axisId: integer("axis_id").notNull().references(() => configAxis.id, { onDelete: "cascade" }),
  valueId: integer("value_id").notNull().references(() => configDimensionValue.id),
  parentOptionId: integer("parent_option_id").references((): AnySQLiteColumn => configOption.id),
  isDefault: integer("is_default").notNull().default(0),
  visible: integer("visible").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active").notNull().default(1),
}, t => [
  index("cat_config_option_axis_order_idx").on(t.axisId, t.sortOrder),
  index("cat_config_option_value_idx").on(t.valueId),
  index("cat_config_option_parent_idx").on(t.parentOptionId),
  check("cat_config_option_default_check", sql`${t.isDefault} in (0,1)`),
  check("cat_config_option_visible_check", sql`${t.visible} in (0,1)`),
  check("cat_config_option_active_check", sql`${t.active} in (0,1)`),
]);

export const configRule = sqliteTable("cat_config_rule", {
  id: integer("id").primaryKey(),
  modelId: integer("model_id").notNull().references(() => configModel.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  emptyBomAllowed: integer("empty_bom_allowed").notNull().default(0),
}, t => [uniqueIndex("cat_config_rule_model_seq_unique").on(t.modelId, t.seq),
  check("cat_config_rule_empty_bom_check", sql`${t.emptyBomAllowed} in (0,1)`)]);

export const configRuleCondition = sqliteTable("cat_config_rule_condition", {
  ruleId: integer("rule_id").notNull().references(() => configRule.id, { onDelete: "cascade" }),
  optionId: integer("option_id").notNull().references(() => configOption.id),
}, t => [
  primaryKey({ columns: [t.ruleId, t.optionId] }),
  index("cat_config_rule_condition_option_idx").on(t.optionId),
]);

export const configRuleFrontLabel = sqliteTable("cat_config_rule_front_label", {
  ruleId: integer("rule_id").primaryKey().references(() => configRule.id, { onDelete: "cascade" }),
  assetKey: text("asset_key").notNull(),
  xMm: real("x_mm").notNull(),
  yMm: real("y_mm").notNull(),
  widthMm: real("width_mm").notNull(),
  heightMm: real("height_mm").notNull(),
}, t => [check("cat_config_rule_front_label_size_check", sql`${t.widthMm}>0 and ${t.heightMm}>0`)]);

export const configBudget = sqliteTable("cat_config_budget", {
  modelId: integer("model_id").notNull().references(() => configModel.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  label: text("label").notNull(),
  maxAmount: integer("max_amount").notNull(),
}, t => [
  primaryKey({ columns: [t.modelId, t.code] }),
  check("cat_config_budget_amount_check", sql`typeof(${t.maxAmount}) = 'integer' and ${t.maxAmount} >= 0`),
]);

export const configRuleEffect = sqliteTable("cat_config_rule_effect", {
  ruleId: integer("rule_id").notNull().references(() => configRule.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  effectKind: text("effect_kind", { enum: ["article", "profile_key_delta", "profile_override", "demand_delta", "budget_use"] }).notNull(),
  productId: integer("product_id").references(() => product.id),
  refBrandMarchio: text("ref_brand_marchio"),
  refManufacturerCode: text("ref_manufacturer_code"),
  quantity: real("quantity"),
  articleRole: text("article_role", { enum: ["primary", "component", "accessory"] }),
  intValue: integer("int_value"),
  capacityKindCode: text("capacity_kind_code").references(() => capacityKind.code),
  budgetCode: text("budget_code"),
  profileId: integer("profile_id").references(() => physicalProfile.id),
}, t => [
  primaryKey({ columns: [t.ruleId, t.seq] }),
  index("cat_config_rule_effect_product_idx").on(t.productId),
  index("cat_config_rule_effect_profile_idx").on(t.profileId),
  index("cat_config_rule_effect_kind_idx").on(t.effectKind),
  check("cat_config_rule_effect_kind_check", sql`${t.effectKind} in ('article','profile_key_delta','profile_override','demand_delta','budget_use')`),
  check("cat_config_rule_effect_role_check", sql`${t.articleRole} is null or ${t.articleRole} in ('primary','component','accessory')`),
  check("cat_config_rule_effect_integer_check", sql`${t.intValue} is null or typeof(${t.intValue}) = 'integer'`),
  check("cat_config_rule_effect_shape_check", sql`(
    ${t.effectKind} = 'article' and ${t.refBrandMarchio} is not null and ${t.refManufacturerCode} is not null and ${t.quantity} is not null and ${t.quantity} > 0 and ${t.articleRole} is not null and ${t.intValue} is null and ${t.capacityKindCode} is null and ${t.budgetCode} is null and ${t.profileId} is null
  ) or (
    ${t.effectKind} = 'profile_key_delta' and ${t.intValue} is not null and ${t.productId} is null and ${t.refBrandMarchio} is null and ${t.refManufacturerCode} is null and ${t.quantity} is null and ${t.articleRole} is null and ${t.capacityKindCode} is null and ${t.budgetCode} is null and ${t.profileId} is null
  ) or (
    ${t.effectKind} = 'profile_override' and ${t.profileId} is not null and ${t.productId} is null and ${t.refBrandMarchio} is null and ${t.refManufacturerCode} is null and ${t.quantity} is null and ${t.articleRole} is null and ${t.intValue} is null and ${t.capacityKindCode} is null and ${t.budgetCode} is null
  ) or (
    ${t.effectKind} = 'demand_delta' and ${t.intValue} is not null and ${t.capacityKindCode} is not null and ${t.productId} is null and ${t.refBrandMarchio} is null and ${t.refManufacturerCode} is null and ${t.quantity} is null and ${t.articleRole} is null and ${t.budgetCode} is null and ${t.profileId} is null
  ) or (
    ${t.effectKind} = 'budget_use' and ${t.intValue} is not null and ${t.intValue} > 0 and ${t.budgetCode} is not null and ${t.productId} is null and ${t.refBrandMarchio} is null and ${t.refManufacturerCode} is null and ${t.quantity} is null and ${t.articleRole} is null and ${t.capacityKindCode} is null and ${t.profileId} is null
  )`),
]);

export const configModelEntry = sqliteTable("cat_config_model_entry", {
  productId: integer("product_id").notNull().references(() => product.id, { onDelete: "cascade" }),
  modelId: integer("model_id").notNull().references(() => configModel.id, { onDelete: "cascade" }),
  optionId: integer("option_id").references(() => configOption.id),
}, t => [
  primaryKey({ columns: [t.productId, t.modelId] }),
  index("cat_config_model_entry_model_idx").on(t.modelId),
  index("cat_config_model_entry_option_idx").on(t.optionId),
]);

export const configModelOffer = sqliteTable("cat_config_model_offer", {
  modelId: integer("model_id").notNull().references(() => configModel.id, { onDelete: "cascade" }),
  offerNo: integer("offer_no").notNull(),
  status: text("status", { enum: ["feasible", "undecided"] }).notNull(),
  undecidedReason: text("undecided_reason", { enum: ["search_bound", "value_conflict"] }),
  definitionFingerprint: text("definition_fingerprint").notNull(),
  configFingerprint: text("config_fingerprint"),
}, t => [
  primaryKey({ columns: [t.modelId, t.offerNo] }),
  check("cat_config_model_offer_status_check", sql`${t.status} in ('feasible','undecided')`),
  check("cat_config_model_offer_reason_check", sql`${t.undecidedReason} is null or ${t.undecidedReason} in ('search_bound','value_conflict')`),
  check("cat_config_model_offer_witness_check", sql`(${t.status} = 'feasible') = (${t.configFingerprint} is not null and ${t.undecidedReason} is null)`),
]);

export const configModelOfferSelection = sqliteTable("cat_config_model_offer_selection", {
  modelId: integer("model_id").notNull(),
  offerNo: integer("offer_no").notNull(),
  valueId: integer("value_id").notNull().references(() => configDimensionValue.id),
  origin: text("origin", { enum: ["candidate", "search", "default"] }).notNull(),
}, t => [
  primaryKey({ columns: [t.modelId, t.offerNo, t.valueId] }),
  foreignKey({ columns: [t.modelId, t.offerNo], foreignColumns: [configModelOffer.modelId, configModelOffer.offerNo] }).onDelete("cascade"),
  check("cat_config_model_offer_selection_origin_check", sql`${t.origin} in ('candidate','search','default')`),
]);

export const configModelOfferValue = sqliteTable("cat_config_model_offer_value", {
  modelId: integer("model_id").notNull(),
  offerNo: integer("offer_no").notNull(),
  attributeId: integer("attribute_id").notNull().references(() => attribute.id),
  valueNum: real("value_num"),
  optionId: integer("option_id").references(() => attributeOption.id),
}, t => [
  primaryKey({ columns: [t.modelId, t.offerNo, t.attributeId] }),
  foreignKey({ columns: [t.modelId, t.offerNo], foreignColumns: [configModelOffer.modelId, configModelOffer.offerNo] }).onDelete("cascade"),
  index("cat_config_model_offer_value_option_idx").on(t.attributeId, t.optionId, t.modelId),
  index("cat_config_model_offer_value_number_idx").on(t.attributeId, t.valueNum, t.modelId),
  check("cat_config_model_offer_value_check", sql`(${t.valueNum} is null) <> (${t.optionId} is null)`),
]);

export const configModelOfferState = sqliteTable("cat_config_model_offer_state", {
  modelId: integer("model_id").primaryKey().references(() => configModel.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["complete", "partial", "none"] }).notNull(),
  candidates: integer("candidates").notNull(),
  feasible: integer("feasible").notNull(),
  infeasible: integer("infeasible").notNull(),
  undecided: integer("undecided").notNull(),
  resolutions: integer("resolutions").notNull(),
}, t => [check("cat_config_model_offer_state_status_check", sql`${t.status} in ('complete','partial','none')`)]);

export const configExclusion = sqliteTable("cat_config_exclusion", {
  containerValueId: integer("container_value_id").notNull().references(() => configDimensionValue.id),
  contentValueId: integer("content_value_id").notNull().references(() => configDimensionValue.id),
  source: text("source", { enum: ["import", "manual"] }).notNull(),
}, t => [
  primaryKey({ columns: [t.containerValueId, t.contentValueId] }),
  index("cat_config_exclusion_content_idx").on(t.contentValueId),
  check("cat_config_exclusion_source_check", sql`${t.source} in ('import','manual')`),
]);

export const configModelRelation = sqliteTable("cat_config_model_relation", {
  fromModelId: integer("from_model_id").notNull().references(() => configModel.id),
  relation: text("relation", { enum: ["join_kit", "side_panel", "preset_child"] }).notNull(),
  seq: integer("seq").notNull(),
  toModelId: integer("to_model_id").notNull().references(() => configModel.id),
  quantity: real("quantity").notNull(),
  placementMode: text("placement_mode", { enum: ["fixed", "packed"] }),
  positionXMm: real("position_x_mm"),
  positionYMm: real("position_y_mm"),
  source: text("source", { enum: ["import", "manual"] }).notNull(),
}, t => [
  primaryKey({ columns: [t.fromModelId, t.relation, t.seq] }),
  index("cat_config_model_relation_to_idx").on(t.toModelId),
  check("cat_config_model_relation_kind_check", sql`${t.relation} in ('join_kit','side_panel','preset_child')`),
  check("cat_config_model_relation_quantity_check", sql`${t.quantity} > 0`),
  check("cat_config_model_relation_source_check", sql`${t.source} in ('import','manual')`),
]);

export const rangeNode = sqliteTable("cat_range_node", {
  id: integer("id").primaryKey(),
  brandId: integer("brand_id").notNull().references(() => brand.id),
  parentId: integer("parent_id").references((): AnySQLiteColumn => rangeNode.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  nodeKind: text("node_kind").notNull(),
  sourceLevel: text("source_level"),
  navigable: integer("navigable").notNull().default(1),
  designNavigable: integer("design_navigable").notNull().default(0),
  levelCode: text("level_code").references(() => rangeLevel.code),
  sourceDeliveryId: integer("source_delivery_id").references(() => importDelivery.id),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active").notNull().default(1),
  source: text("source", { enum: ["import", "metel", "manual"] }).notNull(),
  sourceImportId: integer("source_import_id").references(() => sourceImport.id),
  sourceRef: text("source_ref"),
}, t => [
  uniqueIndex("cat_range_node_brand_code_unique").on(t.brandId, t.code),
  index("cat_range_node_parent_idx").on(t.parentId),
  check("cat_range_node_active_check", sql`${t.active} in (0,1)`),
  check("cat_range_node_navigable_check", sql`${t.navigable} in (0,1)`),
  check("cat_range_node_design_navigable_check", sql`${t.designNavigable} in (0,1)`),
  check("cat_range_node_kind_check", sql`${t.nodeKind} in ('section','level','group')`),
  check("cat_range_node_source_check", sql`${t.source} in ('import','metel','manual')`),
]);

export const rangeLevel = sqliteTable("cat_range_level", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull(),
  source: text("source", { enum: ["seed", "manual"] }).notNull(),
}, t => [check("cat_range_level_source_check", sql`${t.source} in ('seed','manual')`)]);

export const rangeSourceLevelMap = sqliteTable("cat_range_source_level_map", {
  adapterCode: text("adapter_code").notNull(),
  systemId: integer("system_id").notNull(),
  sourceLevel: text("source_level").notNull(),
  levelCode: text("level_code").references(() => rangeLevel.code),
  catalogueNavigable: integer("catalogue_navigable").notNull().default(1),
  source: text("source", { enum: ["seed", "manual"] }).notNull(),
}, t => [primaryKey({columns:[t.adapterCode,t.systemId,t.sourceLevel]}),
  check("cat_range_source_level_map_navigable_check", sql`${t.catalogueNavigable} in (0,1)`),
  check("cat_range_source_level_map_source_check", sql`${t.source} in ('seed','manual')`)]);

export const rangeNodeMetelFamily = sqliteTable("cat_range_node_metel_family", {
  nodeId: integer("node_id").notNull().references(() => rangeNode.id, { onDelete: "cascade" }),
  metelFamilyId: integer("metel_family_id").notNull().references(() => metelFamily.id),
}, t => [primaryKey({ columns: [t.nodeId, t.metelFamilyId] }),
  index("cat_range_node_metel_family_family_idx").on(t.metelFamilyId)]);

/** Derived article navigation; a classifier assigns each article to one leaf. */
export const rangeNodeProduct = sqliteTable("cat_range_node_product", {
  productId: integer("product_id").notNull().references(() => product.id, { onDelete: "cascade" }),
  classificationCode: text("classification_code").notNull(),
  nodeId: integer("node_id").notNull().references(() => rangeNode.id, { onDelete: "cascade" }),
  ruleCode: text("rule_code").notNull(),
  ruleVersion: text("rule_version").notNull(),
  taxonomyFingerprint: text("taxonomy_fingerprint").notNull(),
  articleFingerprint: text("article_fingerprint").notNull(),
  unresolvedReason: text("unresolved_reason"),
}, t => [primaryKey({ columns: [t.productId, t.classificationCode] }),
  index("cat_range_node_product_node_idx").on(t.nodeId, t.productId)]);

export const rangeNodeModel = sqliteTable("cat_range_node_model", {
  nodeId: integer("node_id").notNull().references(() => rangeNode.id, { onDelete: "cascade" }),
  modelId: integer("model_id").notNull().references(() => configModel.id),
  sortOrder: integer("sort_order").notNull().default(0),
}, t => [
  primaryKey({ columns: [t.nodeId, t.modelId] }),
  index("cat_range_node_model_model_idx").on(t.modelId),
]);

export const assetLicense = sqliteTable("cat_asset_license", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  mayDisplay: integer("may_display").notNull(),
  mayEmbedInProject: integer("may_embed_in_project").notNull(),
  notes: text("notes"),
}, t => [
  check("cat_asset_license_display_check", sql`${t.mayDisplay} in (0,1)`),
  check("cat_asset_license_embed_check", sql`${t.mayEmbedInProject} in (0,1)`),
]);

export const asset = sqliteTable("cat_asset", {
  id: integer("id").primaryKey(),
  sha256: text("sha256").notNull(),
  mediaType: text("media_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  relPath: text("rel_path").notNull(),
  origin: text("origin", { enum: ["lq_authored", "manufacturer", "derived"] }).notNull(),
  derivedFromAssetId: integer("derived_from_asset_id").references((): AnySQLiteColumn => asset.id),
  licenseCode: text("license_code").notNull().references(() => assetLicense.code),
  sourceImportId: integer("source_import_id").references(() => sourceImport.id),
  sourceRef: text("source_ref"),
}, t => [
  uniqueIndex("cat_asset_sha256_unique").on(t.sha256),
  index("cat_asset_license_idx").on(t.licenseCode),
  check("cat_asset_sha_check", sql`length(${t.sha256}) = 64`),
  check("cat_asset_size_check", sql`${t.byteSize} >= 0`),
  check("cat_asset_origin_check", sql`${t.origin} in ('lq_authored','manufacturer','derived')`),
  check("cat_asset_derivation_check", sql`${t.origin} != 'derived' or ${t.derivedFromAssetId} is not null`),
  check("cat_asset_path_check", sql`${t.relPath} not like '/%' and ${t.relPath} not like '../%' and ${t.relPath} not like '%/../%'`),
]);

export const assetVariant = sqliteTable("cat_asset_variant", {
  assetKey: text("asset_key").notNull(),
  variant: text("variant", { enum: ["front_light", "front_dark", "cad"] }).notNull(),
  assetId: integer("asset_id").notNull().references(() => asset.id),
}, t => [
  primaryKey({ columns: [t.assetKey, t.variant] }),
  index("cat_asset_variant_asset_idx").on(t.assetId),
  check("cat_asset_variant_kind_check", sql`${t.variant} in ('front_light','front_dark','cad')`),
]);

export const sourceBrandMap = sqliteTable("cat_source_brand_map", {
  adapterCode: text("adapter_code").notNull(),
  sourceBrandCode: text("source_brand_code").notNull(),
  brandId: integer("brand_id").references(() => brand.id),
  source: text("source", { enum: ["seed", "manual"] }).notNull(),
}, t => [
  primaryKey({ columns: [t.adapterCode, t.sourceBrandCode] }),
  index("cat_source_brand_map_brand_idx").on(t.brandId),
  check("cat_source_brand_map_source_check", sql`${t.source} in ('seed','manual')`),
]);

export const sourceConflict = sqliteTable("cat_source_conflict", {
  id: integer("id").primaryKey(),
  importId: integer("import_id").notNull().references(() => sourceImport.id),
  subjectKind: text("subject_kind", { enum: ["article", "model", "profile", "brand"] }).notNull(),
  subjectKey: text("subject_key").notNull(),
  topic: text("topic").notNull(),
  valueA: text("value_a"),
  sourceA: text("source_a"),
  valueB: text("value_b"),
  sourceB: text("source_b"),
  resolution: text("resolution", { enum: ["unresolved", "prefer_a", "prefer_b", "manual"] }).notNull().default("unresolved"),
  resolvedValue: text("resolved_value"),
  notes: text("notes"),
}, t => [
  index("cat_source_conflict_import_idx").on(t.importId),
  index("cat_source_conflict_subject_idx").on(t.subjectKind, t.subjectKey, t.topic),
  check("cat_source_conflict_subject_check", sql`${t.subjectKind} in ('article','model','profile','brand')`),
  check("cat_source_conflict_resolution_check", sql`${t.resolution} in ('unresolved','prefer_a','prefer_b','manual')`),
]);
