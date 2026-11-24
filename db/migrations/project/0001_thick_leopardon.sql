CREATE TABLE `prj_asset` (
	`sha256` text PRIMARY KEY NOT NULL,
	`media_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`data` blob NOT NULL,
	`origin` text NOT NULL,
	`license_code` text NOT NULL,
	`source_ref` text,
	CONSTRAINT "prj_asset_sha_check" CHECK(length("prj_asset"."sha256") = 64 and "prj_asset"."sha256" glob '[0-9a-f]*'),
	CONSTRAINT "prj_asset_size_check" CHECK("prj_asset"."byte_size" >= 0 and "prj_asset"."byte_size" = length("prj_asset"."data")),
	CONSTRAINT "prj_asset_origin_check" CHECK("prj_asset"."origin" in ('lq_authored','manufacturer','derived'))
);
--> statement-breakpoint
CREATE TABLE `prj_item` (
	`id` integer PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	`model_brand_marchio` text NOT NULL,
	`model_code` text NOT NULL,
	`model_name` text NOT NULL,
	`model_kind` text NOT NULL,
	`model_definition_fingerprint` text NOT NULL,
	`model_source_ref` text,
	`config_fingerprint` text NOT NULL,
	`config_label` text NOT NULL,
	`config_status` text NOT NULL,
	`primary_snapshot_id` integer,
	`phys_status` text NOT NULL,
	`profile_code` text,
	`profile_name` text,
	`fit_class_code` text,
	`depth_mm` real,
	`outer_depth_mm` real,
	`usable_depth_mm` real,
	`snapshot_taken_at` text NOT NULL,
	FOREIGN KEY (`primary_snapshot_id`) REFERENCES `prj_product_snapshot`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "prj_item_kind_check" CHECK("prj_item"."model_kind" in ('device','support','enclosure','accessory','kit')),
	CONSTRAINT "prj_item_phys_status_check" CHECK("prj_item"."phys_status" in ('resolved','no_profile','not_physical'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prj_item_uuid_unique` ON `prj_item` (`uuid`);--> statement-breakpoint
CREATE INDEX `prj_item_primary_snapshot_idx` ON `prj_item` (`primary_snapshot_id`);--> statement-breakpoint
CREATE TABLE `prj_item_bom` (
	`id` integer PRIMARY KEY NOT NULL,
	`item_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`snapshot_id` integer NOT NULL,
	`quantity_per_item` real NOT NULL,
	`role` text NOT NULL,
	`origin_dimension_code` text,
	`origin_value_code` text,
	`purchase_discount_chain` text,
	`purchase_discount_bp` integer,
	`net_cost_unit_e4` integer,
	`markup_bp` integer,
	`sale_price_unit_e4` integer,
	`price_locked` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `prj_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `prj_product_snapshot`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "prj_item_bom_quantity_check" CHECK(typeof("prj_item_bom"."quantity_per_item") in ('integer','real') and "prj_item_bom"."quantity_per_item" > 0),
	CONSTRAINT "prj_item_bom_role_check" CHECK("prj_item_bom"."role" in ('primary','component','accessory')),
	CONSTRAINT "prj_item_bom_money_check" CHECK(("prj_item_bom"."net_cost_unit_e4" is null or typeof("prj_item_bom"."net_cost_unit_e4") = 'integer') and ("prj_item_bom"."sale_price_unit_e4" is null or typeof("prj_item_bom"."sale_price_unit_e4") = 'integer')),
	CONSTRAINT "prj_item_bom_price_locked_check" CHECK("prj_item_bom"."price_locked" in (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prj_item_bom_seq_unique` ON `prj_item_bom` (`item_id`,`seq`);--> statement-breakpoint
CREATE INDEX `prj_item_bom_snapshot_idx` ON `prj_item_bom` (`snapshot_id`);--> statement-breakpoint
CREATE TABLE `prj_item_constraint` (
	`item_id` integer NOT NULL,
	`relation` text NOT NULL,
	`set_no` integer NOT NULL,
	`class_code` text NOT NULL,
	PRIMARY KEY(`item_id`, `relation`, `set_no`, `class_code`),
	FOREIGN KEY (`item_id`) REFERENCES `prj_item`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "prj_item_constraint_relation_check" CHECK("prj_item_constraint"."relation" in ('parent','ancestor'))
);
--> statement-breakpoint
CREATE TABLE `prj_item_demand` (
	`item_id` integer NOT NULL,
	`capacity_kind_code` text NOT NULL,
	`capacity_kind_label` text NOT NULL,
	`amount` integer NOT NULL,
	`display_divisor` integer NOT NULL,
	`nominal_pitch_mm` real,
	PRIMARY KEY(`item_id`, `capacity_kind_code`),
	FOREIGN KEY (`item_id`) REFERENCES `prj_item`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "prj_item_demand_amount_check" CHECK("prj_item_demand"."amount" >= 0 and typeof("prj_item_demand"."amount") = 'integer'),
	CONSTRAINT "prj_item_demand_divisor_check" CHECK("prj_item_demand"."display_divisor" > 0)
);
--> statement-breakpoint
CREATE TABLE `prj_item_exclusion` (
	`item_id` integer NOT NULL,
	`own_dimension_code` text NOT NULL,
	`own_value_code` text NOT NULL,
	`ancestor_dimension_code` text NOT NULL,
	`ancestor_value_code` text NOT NULL,
	PRIMARY KEY(`item_id`, `own_dimension_code`, `own_value_code`, `ancestor_dimension_code`, `ancestor_value_code`),
	FOREIGN KEY (`item_id`) REFERENCES `prj_item`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `prj_item_selection` (
	`item_id` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`dimension_code` text NOT NULL,
	`dimension_label` text NOT NULL,
	`value_code` text NOT NULL,
	`value_label` text NOT NULL,
	`selection_source` text NOT NULL,
	`binding` text NOT NULL,
	`editable_when_placed` integer NOT NULL,
	`visible` integer NOT NULL,
	PRIMARY KEY(`item_id`, `dimension_code`),
	FOREIGN KEY (`item_id`) REFERENCES `prj_item`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "prj_item_selection_source_check" CHECK("prj_item_selection"."selection_source" in ('user','default','inherited')),
	CONSTRAINT "prj_item_selection_binding_check" CHECK("prj_item_selection"."binding" in ('none','match_container','inherit_container')),
	CONSTRAINT "prj_item_selection_flags_check" CHECK("prj_item_selection"."editable_when_placed" in (0,1) and "prj_item_selection"."visible" in (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prj_item_selection_order_unique` ON `prj_item_selection` (`item_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `prj_item_view` (
	`item_id` integer NOT NULL,
	`view_code` text NOT NULL,
	`width_mm` real NOT NULL,
	`height_mm` real NOT NULL,
	`insert_dx_mm` real,
	`insert_dy_mm` real,
	`symbol_kind` text NOT NULL,
	`asset_key` text,
	`asset_sha256` text,
	PRIMARY KEY(`item_id`, `view_code`),
	FOREIGN KEY (`item_id`) REFERENCES `prj_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_sha256`) REFERENCES `prj_asset`(`sha256`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "prj_item_view_code_check" CHECK("prj_item_view"."view_code" in ('front','front_alt1','front_alt2')),
	CONSTRAINT "prj_item_view_size_check" CHECK("prj_item_view"."width_mm" > 0 and "prj_item_view"."height_mm" > 0)
);
--> statement-breakpoint
CREATE TABLE `prj_item_zone` (
	`item_id` integer NOT NULL,
	`zone_no` integer NOT NULL,
	`layout` text NOT NULL,
	`capacity_kind_code` text,
	`capacity_amount` integer,
	`origin_x_mm` real,
	`origin_y_mm` real,
	`length_mm` real,
	`breadth_mm` real,
	`direction` text,
	`pitch_mm` real,
	`required_view_code` text,
	PRIMARY KEY(`item_id`, `zone_no`),
	FOREIGN KEY (`item_id`) REFERENCES `prj_item`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "prj_item_zone_layout_check" CHECK("prj_item_zone"."layout" in ('linear','stack','slots')),
	CONSTRAINT "prj_item_zone_direction_check" CHECK("prj_item_zone"."direction" is null or "prj_item_zone"."direction" in ('horizontal','vertical')),
	CONSTRAINT "prj_item_zone_capacity_check" CHECK("prj_item_zone"."capacity_amount" is null or "prj_item_zone"."capacity_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE `prj_item_zone_slot` (
	`item_id` integer NOT NULL,
	`zone_no` integer NOT NULL,
	`slot_no` integer NOT NULL,
	`x_mm` real NOT NULL,
	`y_mm` real NOT NULL,
	PRIMARY KEY(`item_id`, `zone_no`, `slot_no`),
	FOREIGN KEY (`item_id`,`zone_no`) REFERENCES `prj_item_zone`(`item_id`,`zone_no`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prj_item_zone_slot_zone_idx` ON `prj_item_zone_slot` (`item_id`,`zone_no`);--> statement-breakpoint
CREATE TABLE `prj_node` (
	`id` integer PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	`parent_id` integer,
	`item_id` integer,
	`node_kind` text NOT NULL,
	`zone_no` integer,
	`start_units` integer,
	`slot_no` integer,
	`root_x_mm` real,
	`root_y_mm` real,
	`view_code` text,
	`sort_order` integer NOT NULL,
	`designation` text,
	`label_text` text,
	FOREIGN KEY (`parent_id`) REFERENCES `prj_node`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `prj_item`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "prj_node_kind_check" CHECK("prj_node"."node_kind" in ('enclosure','support','device','group')),
	CONSTRAINT "prj_node_item_check" CHECK("prj_node"."node_kind" = 'group' or "prj_node"."item_id" is not null),
	CONSTRAINT "prj_node_position_check" CHECK(("prj_node"."parent_id" is null and "prj_node"."zone_no" is null and "prj_node"."start_units" is null and "prj_node"."slot_no" is null and "prj_node"."root_x_mm" is not null and "prj_node"."root_y_mm" is not null) or ("prj_node"."parent_id" is not null and "prj_node"."zone_no" is not null and ((("prj_node"."start_units" is not null) + ("prj_node"."slot_no" is not null)) = 1) and "prj_node"."root_x_mm" is null and "prj_node"."root_y_mm" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prj_node_uuid_unique` ON `prj_node` (`uuid`);--> statement-breakpoint
CREATE INDEX `prj_node_parent_idx` ON `prj_node` (`parent_id`);--> statement-breakpoint
CREATE INDEX `prj_node_item_idx` ON `prj_node` (`item_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_prj_line` (
	`id` integer PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	`group_id` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`line_type` text NOT NULL,
	`snapshot_id` integer,
	`item_id` integer,
	`description_override` text,
	`quantity` real NOT NULL,
	`purchase_discount_chain` text,
	`purchase_discount_bp` integer,
	`net_cost_unit_e4` integer,
	`markup_bp` integer,
	`sale_price_unit_e4` integer,
	`line_discount_bp` integer DEFAULT 0 NOT NULL,
	`line_total_e4` integer,
	`price_locked` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `prj_group`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`snapshot_id`) REFERENCES `prj_product_snapshot`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `prj_item`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "prj_line_type_check" CHECK("__new_prj_line"."line_type" in ('product', 'item', 'free_text', 'labour', 'note')),
	CONSTRAINT "prj_line_product_snapshot_check" CHECK(("__new_prj_line"."line_type" = 'product') = ("__new_prj_line"."snapshot_id" is not null)),
	CONSTRAINT "prj_line_item_check" CHECK(("__new_prj_line"."line_type" = 'item') = ("__new_prj_line"."item_id" is not null)),
	CONSTRAINT "prj_line_item_cost_check" CHECK("__new_prj_line"."line_type" != 'item' or ("__new_prj_line"."purchase_discount_chain" is null and "__new_prj_line"."purchase_discount_bp" is null and "__new_prj_line"."net_cost_unit_e4" is null and "__new_prj_line"."markup_bp" is null)),
	CONSTRAINT "prj_line_quantity_check" CHECK(typeof("__new_prj_line"."quantity") in ('integer', 'real') and "__new_prj_line"."quantity" > 0),
	CONSTRAINT "prj_line_money_integer_check" CHECK(("__new_prj_line"."net_cost_unit_e4" is null or typeof("__new_prj_line"."net_cost_unit_e4") = 'integer') and ("__new_prj_line"."sale_price_unit_e4" is null or typeof("__new_prj_line"."sale_price_unit_e4") = 'integer') and ("__new_prj_line"."line_total_e4" is null or typeof("__new_prj_line"."line_total_e4") = 'integer')),
	CONSTRAINT "prj_line_basis_points_integer_check" CHECK(("__new_prj_line"."purchase_discount_bp" is null or typeof("__new_prj_line"."purchase_discount_bp") = 'integer') and ("__new_prj_line"."markup_bp" is null or typeof("__new_prj_line"."markup_bp") = 'integer') and typeof("__new_prj_line"."line_discount_bp") = 'integer'),
	CONSTRAINT "prj_line_price_locked_check" CHECK("__new_prj_line"."price_locked" in (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_prj_line`("id", "uuid", "group_id", "sort_order", "line_type", "snapshot_id", "item_id", "description_override", "quantity", "purchase_discount_chain", "purchase_discount_bp", "net_cost_unit_e4", "markup_bp", "sale_price_unit_e4", "line_discount_bp", "line_total_e4", "price_locked") SELECT "id", "uuid", "group_id", "sort_order", "line_type", "snapshot_id", NULL, "description_override", "quantity", "purchase_discount_chain", "purchase_discount_bp", "net_cost_unit_e4", "markup_bp", "sale_price_unit_e4", "line_discount_bp", "line_total_e4", "price_locked" FROM `prj_line`;--> statement-breakpoint
DROP TABLE `prj_line`;--> statement-breakpoint
ALTER TABLE `__new_prj_line` RENAME TO `prj_line`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `prj_line_uuid_unique` ON `prj_line` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `prj_line_group_sort_unique` ON `prj_line` (`group_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `prj_line_snapshot_idx` ON `prj_line` (`snapshot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `prj_line_item_unique` ON `prj_line` (`item_id`);
