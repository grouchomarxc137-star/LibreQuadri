import { sql } from "drizzle-orm";
import {
  check,
  blob,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

/** The portable project-document schema described by DATABASE_DESIGN §7. */
export const lqpMeta = sqliteTable("lqp_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const project = sqliteTable(
  "prj_project",
  {
    id: integer("id").primaryKey(),
    uuid: text("uuid").notNull(),
    number: text("number"),
    title: text("title").notNull(),
    description: text("description"),
    notes: text("notes"),
    projectType: text("project_type", { enum: ["civil", "industrial"] }).notNull(),
    normCode: text("norm_code").notNull(),
    executor: text("executor"),
    projectDate: text("project_date").notNull(),
    status: text("status", { enum: ["draft", "sent", "accepted", "lost", "archived"] })
      .notNull()
      .default("draft"),
    currency: text("currency").notNull().default("EUR"),
    globalDiscountBp: integer("global_discount_bp").notNull().default(0),
    labourTotalE4: integer("labour_total_e4").notNull().default(0),
    customerUuid: text("customer_uuid"),
    customerName: text("customer_name"),
    customerDescription: text("customer_description"),
    customerVat: text("customer_vat"),
    customerAddress: text("customer_address"),
    customerContacts: text("customer_contacts"),
  },
  (table) => [
    uniqueIndex("prj_project_uuid_unique").on(table.uuid),
    check("prj_project_singleton_check", sql`${table.id} = 1`),
    check("prj_project_status_check", sql`${table.status} in ('draft', 'sent', 'accepted', 'lost', 'archived')`),
    check("prj_project_type_norm_check", sql`(${table.projectType} = 'civil' and ${table.normCode} = 'CEI EN 60898') or (${table.projectType} = 'industrial' and ${table.normCode} = 'CEI EN 60947-2')`),
    check("prj_project_discount_integer_check", sql`typeof(${table.globalDiscountBp}) = 'integer'`),
  ],
);

export const productSnapshot = sqliteTable(
  "prj_product_snapshot",
  {
    id: integer("id").primaryKey(),
    uuid: text("uuid").notNull(),
    brandMarchio: text("brand_marchio").notNull(),
    brandName: text("brand_name").notNull(),
    manufacturerCode: text("manufacturer_code").notNull(),
    ean: text("ean"),
    shortDescription: text("short_description"),
    description: text("description"),
    unitOfMeasure: text("unit_of_measure"),
    categoryCode: text("category_code"),
    categoryPathLabel: text("category_path_label"),
    familyCode: text("family_code"),
    familyName: text("family_name"),
    priceIssuerSigla: text("price_issuer_sigla"),
    priceListinoNumber: text("price_listino_number"),
    priceValidFrom: text("price_valid_from"),
    listPriceUnitE4: integer("list_price_unit_e4"),
    priceMultiplierOriginal: integer("price_multiplier_original"),
    snapshotTakenAt: text("snapshot_taken_at").notNull(),
  },
  (table) => [
    uniqueIndex("prj_product_snapshot_uuid_unique").on(table.uuid),
    uniqueIndex("prj_product_snapshot_product_unique").on(table.brandMarchio, table.manufacturerCode),
    check("prj_product_snapshot_price_integer_check", sql`${table.listPriceUnitE4} is null or typeof(${table.listPriceUnitE4}) = 'integer'`),
    check("prj_product_snapshot_multiplier_check", sql`${table.priceMultiplierOriginal} is null or (typeof(${table.priceMultiplierOriginal}) = 'integer' and ${table.priceMultiplierOriginal} > 0)`),
  ],
);

export const productSnapshotAttribute = sqliteTable(
  "prj_product_snapshot_attribute",
  {
    snapshotId: integer("snapshot_id").notNull().references(() => productSnapshot.id, { onDelete: "cascade" }),
    attributeCode: text("attribute_code").notNull(),
    attributeName: text("attribute_name").notNull(),
    dataType: text("data_type", { enum: ["number", "enum", "boolean", "text"] }).notNull(),
    unit: text("unit"),
    valueNum: real("value_num"),
    optionValue: text("option_value"),
    optionLabel: text("option_label"),
    valueBool: integer("value_bool"),
    valueText: text("value_text"),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.attributeCode] }),
    check("prj_product_snapshot_attribute_type_check", sql`${table.dataType} in ('number', 'enum', 'boolean', 'text')`),
    check("prj_product_snapshot_attribute_one_value_check", sql`(${table.valueNum} is not null) + (${table.optionValue} is not null) + (${table.valueBool} is not null) + (${table.valueText} is not null) = 1`),
    check("prj_product_snapshot_attribute_bool_check", sql`${table.valueBool} is null or ${table.valueBool} in (0, 1)`),
  ],
);

export const group = sqliteTable(
  "prj_group",
  {
    id: integer("id").primaryKey(),
    uuid: text("uuid").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    uniqueIndex("prj_group_uuid_unique").on(table.uuid),
    uniqueIndex("prj_group_sort_order_unique").on(table.sortOrder),
  ],
);

/**
 * A free-text box on the Fronte Quadro (format 6; format 7 adds its size). Pure presentation: it is not a configured item,
 * a physical node or a quotation line, needs no catalogue and carries no manufacturer data.
 * Position and size are drawing millimetres of the combined Fronte Quadro (see Fronte Quadro navigation).
 */
export const annotation = sqliteTable(
  "prj_annotation",
  {
    id: integer("id").primaryKey(),
    uuid: text("uuid").notNull(),
    text: text("text").notNull(),
    xMm: real("x_mm").notNull(),
    yMm: real("y_mm").notNull(),
    /** Format 7: the text box's size in drawing millimetres (the position is its top-left corner). */
    widthMm: real("width_mm").notNull().default(240),
    heightMm: real("height_mm").notNull().default(40),
    /** Format 9: this box's text size in drawing millimetres (6–60); older boxes migrate to 12. */
    fontSizeMm: real("font_size_mm").notNull().default(12),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    uniqueIndex("prj_annotation_uuid_unique").on(table.uuid),
    uniqueIndex("prj_annotation_sort_order_unique").on(table.sortOrder),
    check("prj_annotation_text_check", sql`length(${table.text}) between 1 and 2000`),
    check("prj_annotation_size_check", sql`${table.widthMm} between 60 and 100000 and ${table.heightMm} between 24 and 100000`),
    check("prj_annotation_font_size_check", sql`${table.fontSizeMm} between 6 and 60`),
  ],
);

/** A licensed, embedded rendering asset. Article snapshots remain asset-free. */
export const asset = sqliteTable("prj_asset", {
  sha256: text("sha256").primaryKey(),
  mediaType: text("media_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  data: blob("data", { mode: "buffer" }).notNull(),
  origin: text("origin", { enum: ["lq_authored", "manufacturer", "derived"] }).notNull(),
  licenseCode: text("license_code").notNull(),
  sourceRef: text("source_ref"),
}, (table) => [
  check("prj_asset_sha_check", sql`length(${table.sha256}) = 64 and ${table.sha256} glob '[0-9a-f]*'`),
  check("prj_asset_size_check", sql`${table.byteSize} >= 0 and ${table.byteSize} = length(${table.data})`),
  check("prj_asset_origin_check", sql`${table.origin} in ('lq_authored','manufacturer','derived')`),
]);

export const item = sqliteTable("prj_item", {
  mountingJson: text("mounting_json"),
  id: integer("id").primaryKey(),
  uuid: text("uuid").notNull(),
  modelBrandMarchio: text("model_brand_marchio").notNull(),
  modelCode: text("model_code").notNull(),
  modelName: text("model_name").notNull(),
  modelKind: text("model_kind", { enum: ["device", "support", "enclosure", "accessory", "kit"] }).notNull(),
  commercialContribution: text("commercial_contribution", { enum: ["articles", "none"] }).notNull().default("articles"),
  modelDefinitionFingerprint: text("model_definition_fingerprint").notNull(),
  modelSourceRef: text("model_source_ref"),
  configFingerprint: text("config_fingerprint").notNull(),
  configLabel: text("config_label").notNull(),
  configStatus: text("config_status").notNull(),
  primarySnapshotId: integer("primary_snapshot_id").references(() => productSnapshot.id),
  physStatus: text("phys_status", { enum: ["resolved", "no_profile", "not_physical"] }).notNull(),
  profileCode: text("profile_code"),
  profileName: text("profile_name"),
  fitClassCode: text("fit_class_code"),
  fitClassLabel: text("fit_class_label"),
  /** NULL: context facts were never snapshotted (legacy). */
  contextPolicy: text("context_policy", { enum: ["unknown", "unrestricted", "restricted"] }),
  depthMm: real("depth_mm"),
  outerDepthMm: real("outer_depth_mm"),
  usableDepthMm: real("usable_depth_mm"),
  snapshotTakenAt: text("snapshot_taken_at").notNull(),
  engineeringProvenance: text("engineering_provenance", { enum: ["import", "manual"] }),
  sourceAdapterCode: text("source_adapter_code"),
  sourceAdapterVersion: text("source_adapter_version"),
  sourceImportFingerprint: text("source_import_fingerprint"),
}, (table) => [
  uniqueIndex("prj_item_uuid_unique").on(table.uuid),
  index("prj_item_primary_snapshot_idx").on(table.primarySnapshotId),
  check("prj_item_provenance_check", sql`coalesce(
    (${table.engineeringProvenance} is null and ${table.sourceAdapterCode} is null and ${table.sourceAdapterVersion} is null and ${table.sourceImportFingerprint} is null)
    or (${table.engineeringProvenance} = 'manual' and ${table.sourceAdapterCode} is null and ${table.sourceAdapterVersion} is null and ${table.sourceImportFingerprint} is null)
    or (${table.engineeringProvenance} = 'import' and length(trim(${table.sourceAdapterCode})) > 0
      and ${table.sourceAdapterVersion} glob '[1-9]*' and ${table.sourceAdapterVersion} not glob '*[^0-9]*'
      and length(${table.sourceImportFingerprint}) = 64 and ${table.sourceImportFingerprint} not glob '*[^0-9a-f]*'), 0)`),
  check("prj_item_kind_check", sql`${table.modelKind} in ('device','support','enclosure','accessory','kit')`),
  check("prj_item_commercial_contribution_check", sql`${table.commercialContribution} in ('articles','none')`),
  check("prj_item_phys_status_check", sql`${table.physStatus} in ('resolved','no_profile','not_physical')`),
]);

export const itemSelection = sqliteTable("prj_item_selection", {
  itemId: integer("item_id").notNull().references(() => item.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull(),
  dimensionCode: text("dimension_code").notNull(),
  dimensionLabel: text("dimension_label").notNull(),
  valueCode: text("value_code").notNull(),
  valueLabel: text("value_label").notNull(),
  selectionSource: text("selection_source", { enum: ["user", "default", "inherited"] }).notNull(),
  binding: text("binding", { enum: ["none", "match_container", "inherit_container"] }).notNull(),
  editableWhenPlaced: integer("editable_when_placed").notNull(),
  visible: integer("visible").notNull(),
}, (table) => [
  primaryKey({ columns: [table.itemId, table.dimensionCode] }),
  uniqueIndex("prj_item_selection_order_unique").on(table.itemId, table.sortOrder),
  check("prj_item_selection_source_check", sql`${table.selectionSource} in ('user','default','inherited')`),
  check("prj_item_selection_binding_check", sql`${table.binding} in ('none','match_container','inherit_container')`),
  check("prj_item_selection_flags_check", sql`${table.editableWhenPlaced} in (0,1) and ${table.visible} in (0,1)`),
]);

export const itemBom = sqliteTable("prj_item_bom", {
  id: integer("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => item.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  snapshotId: integer("snapshot_id").notNull().references(() => productSnapshot.id),
  quantityPerItem: real("quantity_per_item").notNull(),
  role: text("role", { enum: ["primary", "component", "accessory"] }).notNull(),
  originDimensionCode: text("origin_dimension_code"),
  originValueCode: text("origin_value_code"),
  purchaseDiscountChain: text("purchase_discount_chain"),
  purchaseDiscountBp: integer("purchase_discount_bp"),
  netCostUnitE4: integer("net_cost_unit_e4"),
  markupBp: integer("markup_bp"),
  salePriceUnitE4: integer("sale_price_unit_e4"),
  lineDiscountBp: integer("line_discount_bp").notNull().default(0),
  priceLocked: integer("price_locked").notNull().default(0),
}, (table) => [
  uniqueIndex("prj_item_bom_seq_unique").on(table.itemId, table.seq),
  index("prj_item_bom_snapshot_idx").on(table.snapshotId),
  check("prj_item_bom_quantity_check", sql`typeof(${table.quantityPerItem}) in ('integer','real') and ${table.quantityPerItem} > 0`),
  check("prj_item_bom_role_check", sql`${table.role} in ('primary','component','accessory')`),
  check("prj_item_bom_money_check", sql`(${table.netCostUnitE4} is null or typeof(${table.netCostUnitE4}) = 'integer') and (${table.salePriceUnitE4} is null or typeof(${table.salePriceUnitE4}) = 'integer')`),
  check("prj_item_bom_price_locked_check", sql`${table.priceLocked} in (0,1)`),
]);

export const itemDemand = sqliteTable("prj_item_demand", {
  itemId: integer("item_id").notNull().references(() => item.id, { onDelete: "cascade" }),
  capacityKindCode: text("capacity_kind_code").notNull(),
  capacityKindLabel: text("capacity_kind_label").notNull(),
  amount: integer("amount").notNull(),
  displayDivisor: integer("display_divisor").notNull(),
  nominalPitchMm: real("nominal_pitch_mm"),
}, (table) => [
  primaryKey({ columns: [table.itemId, table.capacityKindCode] }),
  check("prj_item_demand_amount_check", sql`${table.amount} >= 0 and typeof(${table.amount}) = 'integer'`),
  check("prj_item_demand_divisor_check", sql`${table.displayDivisor} > 0`),
]);

export const itemView = sqliteTable("prj_item_view", {
  itemId: integer("item_id").notNull().references(() => item.id, { onDelete: "cascade" }),
  viewCode: text("view_code", { enum: ["front", "front_alt1", "front_alt2"] }).notNull(),
  widthMm: real("width_mm").notNull(),
  heightMm: real("height_mm").notNull(),
  insertDxMm: real("insert_dx_mm"),
  insertDyMm: real("insert_dy_mm"),
  symbolKind: text("symbol_kind").notNull(),
  assetKey: text("asset_key"),
  assetSha256: text("asset_sha256").references(() => asset.sha256),
}, (table) => [
  primaryKey({ columns: [table.itemId, table.viewCode] }),
  check("prj_item_view_code_check", sql`${table.viewCode} in ('front','front_alt1','front_alt2')`),
  check("prj_item_view_size_check", sql`${table.widthMm} > 0 and ${table.heightMm} > 0`),
]);

export const itemZone = sqliteTable("prj_item_zone", {
  mountingJson: text("mounting_json"),
  itemId: integer("item_id").notNull().references(() => item.id, { onDelete: "cascade" }),
  zoneNo: integer("zone_no").notNull(),
  layout: text("layout", { enum: ["linear", "stack", "slots"] }).notNull(),
  capacityKindCode: text("capacity_kind_code"),
  capacityKindLabel: text("capacity_kind_label"),
  displayDivisor: integer("display_divisor"),
  nominalPitchMm: real("nominal_pitch_mm"),
  capacityAmount: integer("capacity_amount"),
  originXMm: real("origin_x_mm"),
  originYMm: real("origin_y_mm"),
  lengthMm: real("length_mm"),
  breadthMm: real("breadth_mm"),
  direction: text("direction", { enum: ["horizontal", "vertical"] }),
  pitchMm: real("pitch_mm"),
  requiredViewCode: text("required_view_code"),
}, (table) => [
  primaryKey({ columns: [table.itemId, table.zoneNo] }),
  check("prj_item_zone_layout_check", sql`${table.layout} in ('linear','stack','slots')`),
  check("prj_item_zone_direction_check", sql`${table.direction} is null or ${table.direction} in ('horizontal','vertical')`),
  check("prj_item_zone_capacity_check", sql`${table.capacityAmount} is null or ${table.capacityAmount} >= 0`),
]);

export const itemZoneSlot = sqliteTable("prj_item_zone_slot", {
  itemId: integer("item_id").notNull(),
  zoneNo: integer("zone_no").notNull(),
  slotNo: integer("slot_no").notNull(),
  xMm: real("x_mm").notNull(),
  yMm: real("y_mm").notNull(),
}, (table) => [
  primaryKey({ columns: [table.itemId, table.zoneNo, table.slotNo] }),
  index("prj_item_zone_slot_zone_idx").on(table.itemId, table.zoneNo),
  foreignKey({ columns: [table.itemId, table.zoneNo], foreignColumns: [itemZone.itemId, itemZone.zoneNo] }).onDelete("cascade"),
]);

export const itemConstraint = sqliteTable("prj_item_constraint", {
  itemId: integer("item_id").notNull().references(() => item.id, { onDelete: "cascade" }),
  relation: text("relation", { enum: ["parent", "ancestor"] }).notNull(),
  setNo: integer("set_no").notNull(),
  classCode: text("class_code").notNull(),
}, (table) => [
  primaryKey({ columns: [table.itemId, table.relation, table.setNo, table.classCode] }),
  check("prj_item_constraint_relation_check", sql`${table.relation} in ('parent','ancestor')`),
]);

/** Engineering-context facts of a structural item: an enclosure's provided and a support's accepted context codes. */
export const itemContext = sqliteTable("prj_item_context", {
  itemId: integer("item_id").notNull().references(() => item.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["provides", "accepts"] }).notNull(),
  contextCode: text("context_code").notNull(),
}, (table) => [
  primaryKey({ columns: [table.itemId, table.role, table.contextCode] }),
  check("prj_item_context_role_check", sql`${table.role} in ('provides','accepts')`),
]);

export const itemExclusion = sqliteTable("prj_item_exclusion", {
  itemId: integer("item_id").notNull().references(() => item.id, { onDelete: "cascade" }),
  ownDimensionCode: text("own_dimension_code").notNull(),
  ownValueCode: text("own_value_code").notNull(),
  ancestorDimensionCode: text("ancestor_dimension_code").notNull(),
  ancestorValueCode: text("ancestor_value_code").notNull(),
}, (table) => [
  primaryKey({ columns: [table.itemId, table.ownDimensionCode, table.ownValueCode, table.ancestorDimensionCode, table.ancestorValueCode] }),
]);

/** Physical containment is independent of prj_group's quotation organization. */
export const node = sqliteTable("prj_node", {
  id: integer("id").primaryKey(),
  uuid: text("uuid").notNull(),
  parentId: integer("parent_id").references((): AnySQLiteColumn => node.id),
  itemId: integer("item_id").references(() => item.id),
  nodeKind: text("node_kind", { enum: ["enclosure", "support", "device", "group"] }).notNull(),
  zoneNo: integer("zone_no"),
  startUnits: integer("start_units"),
  slotNo: integer("slot_no"),
  rootXMm: real("root_x_mm"),
  rootYMm: real("root_y_mm"),
  viewCode: text("view_code"),
  sortOrder: integer("sort_order").notNull(),
  designation: text("designation"),
  labelText: text("label_text"),
}, (table) => [
  uniqueIndex("prj_node_uuid_unique").on(table.uuid),
  index("prj_node_parent_idx").on(table.parentId),
  index("prj_node_item_idx").on(table.itemId),
  check("prj_node_kind_check", sql`${table.nodeKind} in ('enclosure','support','device','group')`),
  check("prj_node_item_check", sql`${table.nodeKind} = 'group' or ${table.itemId} is not null`),
  check("prj_node_position_check", sql`(${table.parentId} is null and ${table.zoneNo} is null and ${table.startUnits} is null and ${table.slotNo} is null and ${table.rootXMm} is not null and ${table.rootYMm} is not null) or (${table.parentId} is not null and ${table.zoneNo} is not null and (((${table.startUnits} is not null) + (${table.slotNo} is not null)) = 1) and ${table.rootXMm} is null and ${table.rootYMm} is null)`),
]);

export const line = sqliteTable(
  "prj_line",
  {
    id: integer("id").primaryKey(),
    uuid: text("uuid").notNull(),
    groupId: integer("group_id").notNull().references(() => group.id),
    sortOrder: integer("sort_order").notNull(),
    lineType: text("line_type", { enum: ["product", "item", "free_text", "labour", "note"] }).notNull(),
    snapshotId: integer("snapshot_id").references(() => productSnapshot.id),
    itemId: integer("item_id").references(() => item.id),
    descriptionOverride: text("description_override"),
    quantity: real("quantity").notNull(),
    purchaseDiscountChain: text("purchase_discount_chain"),
    purchaseDiscountBp: integer("purchase_discount_bp"),
    netCostUnitE4: integer("net_cost_unit_e4"),
    markupBp: integer("markup_bp"),
    salePriceUnitE4: integer("sale_price_unit_e4"),
    lineDiscountBp: integer("line_discount_bp").notNull().default(0),
    lineTotalE4: integer("line_total_e4"),
    priceLocked: integer("price_locked").notNull().default(0),
  },
  (table) => [
    uniqueIndex("prj_line_uuid_unique").on(table.uuid),
    uniqueIndex("prj_line_group_sort_unique").on(table.groupId, table.sortOrder),
    index("prj_line_snapshot_idx").on(table.snapshotId),
    uniqueIndex("prj_line_item_unique").on(table.itemId),
    check("prj_line_type_check", sql`${table.lineType} in ('product', 'item', 'free_text', 'labour', 'note')`),
    check("prj_line_product_snapshot_check", sql`(${table.lineType} = 'product') = (${table.snapshotId} is not null)`),
    check("prj_line_item_check", sql`(${table.lineType} = 'item') = (${table.itemId} is not null)`),
    check("prj_line_item_cost_check", sql`${table.lineType} != 'item' or (${table.purchaseDiscountChain} is null and ${table.purchaseDiscountBp} is null and ${table.netCostUnitE4} is null and ${table.markupBp} is null)`),
    check("prj_line_quantity_check", sql`typeof(${table.quantity}) in ('integer', 'real') and ${table.quantity} > 0`),
    check("prj_line_money_integer_check", sql`(${table.netCostUnitE4} is null or typeof(${table.netCostUnitE4}) = 'integer') and (${table.salePriceUnitE4} is null or typeof(${table.salePriceUnitE4}) = 'integer') and (${table.lineTotalE4} is null or typeof(${table.lineTotalE4}) = 'integer')`),
    check("prj_line_basis_points_integer_check", sql`(${table.purchaseDiscountBp} is null or typeof(${table.purchaseDiscountBp}) = 'integer') and (${table.markupBp} is null or typeof(${table.markupBp}) = 'integer') and typeof(${table.lineDiscountBp}) = 'integer'`),
    check("prj_line_price_locked_check", sql`${table.priceLocked} in (0, 1)`),
  ],
);
