CREATE TABLE `prj_group` (
	`id` integer PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prj_group_uuid_unique` ON `prj_group` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `prj_group_sort_order_unique` ON `prj_group` (`sort_order`);--> statement-breakpoint
CREATE TABLE `prj_line` (
	`id` integer PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	`group_id` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`line_type` text NOT NULL,
	`snapshot_id` integer,
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
	CONSTRAINT "prj_line_type_check" CHECK("prj_line"."line_type" in ('product', 'free_text', 'labour', 'note')),
	CONSTRAINT "prj_line_product_snapshot_check" CHECK(("prj_line"."line_type" = 'product') = ("prj_line"."snapshot_id" is not null)),
	CONSTRAINT "prj_line_quantity_check" CHECK(typeof("prj_line"."quantity") in ('integer', 'real') and "prj_line"."quantity" > 0),
	CONSTRAINT "prj_line_money_integer_check" CHECK(("prj_line"."net_cost_unit_e4" is null or typeof("prj_line"."net_cost_unit_e4") = 'integer') and ("prj_line"."sale_price_unit_e4" is null or typeof("prj_line"."sale_price_unit_e4") = 'integer') and ("prj_line"."line_total_e4" is null or typeof("prj_line"."line_total_e4") = 'integer')),
	CONSTRAINT "prj_line_basis_points_integer_check" CHECK(("prj_line"."purchase_discount_bp" is null or typeof("prj_line"."purchase_discount_bp") = 'integer') and ("prj_line"."markup_bp" is null or typeof("prj_line"."markup_bp") = 'integer') and typeof("prj_line"."line_discount_bp") = 'integer'),
	CONSTRAINT "prj_line_price_locked_check" CHECK("prj_line"."price_locked" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prj_line_uuid_unique` ON `prj_line` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `prj_line_group_sort_unique` ON `prj_line` (`group_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `prj_line_snapshot_idx` ON `prj_line` (`snapshot_id`);--> statement-breakpoint
CREATE TABLE `lqp_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prj_product_snapshot` (
	`id` integer PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	`brand_marchio` text NOT NULL,
	`brand_name` text NOT NULL,
	`manufacturer_code` text NOT NULL,
	`ean` text,
	`short_description` text,
	`description` text,
	`unit_of_measure` text,
	`category_code` text,
	`category_path_label` text,
	`family_code` text,
	`family_name` text,
	`price_issuer_sigla` text,
	`price_listino_number` text,
	`price_valid_from` text,
	`list_price_unit_e4` integer,
	`price_multiplier_original` integer,
	`snapshot_taken_at` text NOT NULL,
	CONSTRAINT "prj_product_snapshot_price_integer_check" CHECK("prj_product_snapshot"."list_price_unit_e4" is null or typeof("prj_product_snapshot"."list_price_unit_e4") = 'integer'),
	CONSTRAINT "prj_product_snapshot_multiplier_check" CHECK("prj_product_snapshot"."price_multiplier_original" is null or (typeof("prj_product_snapshot"."price_multiplier_original") = 'integer' and "prj_product_snapshot"."price_multiplier_original" > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prj_product_snapshot_uuid_unique` ON `prj_product_snapshot` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `prj_product_snapshot_product_unique` ON `prj_product_snapshot` (`brand_marchio`,`manufacturer_code`);--> statement-breakpoint
CREATE TABLE `prj_product_snapshot_attribute` (
	`snapshot_id` integer NOT NULL,
	`attribute_code` text NOT NULL,
	`attribute_name` text NOT NULL,
	`data_type` text NOT NULL,
	`unit` text,
	`value_num` real,
	`option_value` text,
	`option_label` text,
	`value_bool` integer,
	`value_text` text,
	PRIMARY KEY(`snapshot_id`, `attribute_code`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `prj_product_snapshot`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "prj_product_snapshot_attribute_type_check" CHECK("prj_product_snapshot_attribute"."data_type" in ('number', 'enum', 'boolean', 'text')),
	CONSTRAINT "prj_product_snapshot_attribute_one_value_check" CHECK(("prj_product_snapshot_attribute"."value_num" is not null) + ("prj_product_snapshot_attribute"."option_value" is not null) + ("prj_product_snapshot_attribute"."value_bool" is not null) + ("prj_product_snapshot_attribute"."value_text" is not null) = 1),
	CONSTRAINT "prj_product_snapshot_attribute_bool_check" CHECK("prj_product_snapshot_attribute"."value_bool" is null or "prj_product_snapshot_attribute"."value_bool" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `prj_project` (
	`id` integer PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	`number` text,
	`title` text NOT NULL,
	`description` text,
	`notes` text,
	`project_type` text NOT NULL,
	`norm_code` text NOT NULL,
	`executor` text,
	`project_date` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`global_discount_bp` integer DEFAULT 0 NOT NULL,
	`customer_uuid` text,
	`customer_name` text,
	`customer_description` text,
	`customer_vat` text,
	`customer_address` text,
	`customer_contacts` text,
	CONSTRAINT "prj_project_singleton_check" CHECK("prj_project"."id" = 1),
	CONSTRAINT "prj_project_status_check" CHECK("prj_project"."status" in ('draft', 'sent', 'accepted', 'lost', 'archived')),
	CONSTRAINT "prj_project_type_norm_check" CHECK(("prj_project"."project_type" = 'civil' and "prj_project"."norm_code" = 'CEI EN 60898') or ("prj_project"."project_type" = 'industrial' and "prj_project"."norm_code" = 'CEI EN 60947-2')),
	CONSTRAINT "prj_project_discount_integer_check" CHECK(typeof("prj_project"."global_discount_bp") = 'integer')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prj_project_uuid_unique` ON `prj_project` (`uuid`);