CREATE TABLE `cat_brand` (
	`id` integer PRIMARY KEY NOT NULL,
	`metel_marchio` text NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`manufacturer_id` integer,
	`preferred_issuer_id` integer,
	`source` text NOT NULL,
	FOREIGN KEY (`manufacturer_id`) REFERENCES `cat_manufacturer`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preferred_issuer_id`) REFERENCES `cat_metel_issuer`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_brand_active_check" CHECK("cat_brand"."active" in (0, 1)),
	CONSTRAINT "cat_brand_source_check" CHECK("cat_brand"."source" in ('import', 'seed', 'manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_brand_metel_marchio_unique` ON `cat_brand` (`metel_marchio`);--> statement-breakpoint
CREATE TABLE `app_import_delivery` (
	`id` integer PRIMARY KEY NOT NULL,
	`issuer_id` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`listino_number` text NOT NULL,
	`valid_from` text NOT NULL,
	`became_current` integer NOT NULL,
	`normalized_at` text NOT NULL,
	`summary_json` text NOT NULL,
	FOREIGN KEY (`issuer_id`) REFERENCES `cat_metel_issuer`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "app_import_delivery_fingerprint_length" CHECK(length("app_import_delivery"."fingerprint") = 64),
	CONSTRAINT "app_import_delivery_current_check" CHECK("app_import_delivery"."became_current" in (0, 1)),
	CONSTRAINT "app_import_delivery_summary_json_check" CHECK(json_valid("app_import_delivery"."summary_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_import_delivery_fingerprint_unique` ON `app_import_delivery` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `app_import_delivery_issuer_valid_from_idx` ON `app_import_delivery` (`issuer_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `app_import_file` (
	`delivery_id` integer NOT NULL,
	`file_type` text NOT NULL,
	`file_sha256` text NOT NULL,
	`original_file_name` text NOT NULL,
	`layout_version` text NOT NULL,
	`row_count` integer NOT NULL,
	PRIMARY KEY(`delivery_id`, `file_type`),
	FOREIGN KEY (`delivery_id`) REFERENCES `app_import_delivery`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "app_import_file_type_check" CHECK("app_import_file"."file_type" in ('LSP', 'FSC', 'FST')),
	CONSTRAINT "app_import_file_layout_check" CHECK("app_import_file"."layout_version" in ('020', '021')),
	CONSTRAINT "app_import_file_sha256_length" CHECK(length("app_import_file"."file_sha256") = 64),
	CONSTRAINT "app_import_file_row_count_check" CHECK("app_import_file"."row_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `app_import_file_sha256_idx` ON `app_import_file` (`file_sha256`);--> statement-breakpoint
CREATE TABLE `cat_issuer_brand` (
	`issuer_id` integer NOT NULL,
	`brand_id` integer NOT NULL,
	`first_seen_delivery_id` integer NOT NULL,
	`last_seen_delivery_id` integer NOT NULL,
	PRIMARY KEY(`issuer_id`, `brand_id`),
	FOREIGN KEY (`issuer_id`) REFERENCES `cat_metel_issuer`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brand_id`) REFERENCES `cat_brand`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`first_seen_delivery_id`) REFERENCES `app_import_delivery`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_seen_delivery_id`) REFERENCES `app_import_delivery`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cat_manufacturer` (
	`id` integer PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	CONSTRAINT "cat_manufacturer_source_check" CHECK("cat_manufacturer"."source" in ('seed', 'manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_manufacturer_code_unique` ON `cat_manufacturer` (`code`);--> statement-breakpoint
CREATE TABLE `cat_metel_family` (
	`id` integer PRIMARY KEY NOT NULL,
	`issuer_id` integer NOT NULL,
	`brand_id` integer NOT NULL,
	`family_type` text NOT NULL,
	`code` text NOT NULL,
	`description` text,
	`parent_id` integer,
	`is_known` integer NOT NULL,
	FOREIGN KEY (`issuer_id`) REFERENCES `cat_metel_issuer`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brand_id`) REFERENCES `cat_brand`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `cat_metel_family`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_metel_family_type_check" CHECK("cat_metel_family"."family_type" in ('SCONTO', 'STATISTICA')),
	CONSTRAINT "cat_metel_family_known_check" CHECK("cat_metel_family"."is_known" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_metel_family_identity_unique` ON `cat_metel_family` (`issuer_id`,`brand_id`,`family_type`,`code`);--> statement-breakpoint
CREATE INDEX `cat_metel_family_brand_type_idx` ON `cat_metel_family` (`brand_id`,`family_type`);--> statement-breakpoint
CREATE TABLE `cat_metel_issuer` (
	`id` integer PRIMARY KEY NOT NULL,
	`metel_sigla` text NOT NULL,
	`piva` text,
	`name` text,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_metel_issuer_sigla_unique` ON `cat_metel_issuer` (`metel_sigla`);--> statement-breakpoint
CREATE TABLE `com_price_list` (
	`id` integer PRIMARY KEY NOT NULL,
	`issuer_id` integer NOT NULL,
	`delivery_id` integer NOT NULL,
	`listino_number` text NOT NULL,
	`valid_from` text NOT NULL,
	`is_current` integer NOT NULL,
	FOREIGN KEY (`issuer_id`) REFERENCES `cat_metel_issuer`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`delivery_id`) REFERENCES `app_import_delivery`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "com_price_list_current_check" CHECK("com_price_list"."is_current" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `com_price_list_delivery_unique` ON `com_price_list` (`delivery_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `com_price_list_one_current_per_issuer` ON `com_price_list` (`issuer_id`) WHERE "com_price_list"."is_current" = 1;--> statement-breakpoint
CREATE TABLE `cat_product` (
	`id` integer PRIMARY KEY NOT NULL,
	`brand_id` integer NOT NULL,
	`manufacturer_code` text NOT NULL,
	`code_norm` text NOT NULL,
	`governing_issuer_id` integer,
	`ean` text,
	`short_description` text,
	`unit_of_measure` text,
	`pack_qty` integer,
	`min_order_qty` integer,
	`order_multiple` integer,
	`max_order_qty` integer,
	`lead_time_code` text,
	`lifecycle_status_code` text,
	`is_kit` integer,
	`electrocod` text,
	`discount_family_id` integer,
	`statistical_family_id` integer,
	`description` text,
	`search_text` text,
	`is_listed` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `cat_brand`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`governing_issuer_id`) REFERENCES `cat_metel_issuer`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`discount_family_id`) REFERENCES `cat_metel_family`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`statistical_family_id`) REFERENCES `cat_metel_family`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_product_is_kit_check" CHECK("cat_product"."is_kit" is null or "cat_product"."is_kit" in (0, 1)),
	CONSTRAINT "cat_product_is_listed_check" CHECK("cat_product"."is_listed" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_product_brand_code_unique` ON `cat_product` (`brand_id`,`manufacturer_code`);--> statement-breakpoint
CREATE INDEX `cat_product_code_norm_idx` ON `cat_product` (`code_norm`);--> statement-breakpoint
CREATE INDEX `cat_product_ean_idx` ON `cat_product` (`ean`);--> statement-breakpoint
CREATE INDEX `cat_product_brand_listed_idx` ON `cat_product` (`brand_id`,`is_listed`);--> statement-breakpoint
CREATE INDEX `cat_product_statistical_family_idx` ON `cat_product` (`statistical_family_id`);--> statement-breakpoint
CREATE INDEX `cat_product_discount_family_idx` ON `cat_product` (`discount_family_id`);--> statement-breakpoint
CREATE TABLE `cat_product_listing` (
	`product_id` integer NOT NULL,
	`issuer_id` integer NOT NULL,
	`discount_family_id` integer,
	`statistical_family_id` integer,
	`lifecycle_status_code` text NOT NULL,
	`lead_time_code` text NOT NULL,
	`ean` text,
	`short_description` text NOT NULL,
	`unit_of_measure` text NOT NULL,
	`pack_qty` integer NOT NULL,
	`min_order_qty` integer NOT NULL,
	`order_multiple` integer NOT NULL,
	`max_order_qty` integer NOT NULL,
	`is_kit` integer NOT NULL,
	`electrocod` text,
	`is_listed` integer NOT NULL,
	`first_seen_delivery_id` integer NOT NULL,
	`last_seen_delivery_id` integer NOT NULL,
	PRIMARY KEY(`product_id`, `issuer_id`),
	FOREIGN KEY (`product_id`) REFERENCES `cat_product`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issuer_id`) REFERENCES `cat_metel_issuer`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`discount_family_id`) REFERENCES `cat_metel_family`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`statistical_family_id`) REFERENCES `cat_metel_family`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`first_seen_delivery_id`) REFERENCES `app_import_delivery`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_seen_delivery_id`) REFERENCES `app_import_delivery`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_product_listing_kit_check" CHECK("cat_product_listing"."is_kit" in (0, 1)),
	CONSTRAINT "cat_product_listing_listed_check" CHECK("cat_product_listing"."is_listed" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `cat_product_listing_issuer_listed_idx` ON `cat_product_listing` (`issuer_id`,`is_listed`);--> statement-breakpoint
CREATE TABLE `com_product_price` (
	`product_id` integer NOT NULL,
	`price_list_id` integer NOT NULL,
	`list_price_e4` integer NOT NULL,
	`price_multiplier` integer NOT NULL,
	`currency` text NOT NULL,
	`list_price_unit_e4` integer NOT NULL,
	PRIMARY KEY(`product_id`, `price_list_id`),
	FOREIGN KEY (`product_id`) REFERENCES `cat_product`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`price_list_id`) REFERENCES `com_price_list`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "com_product_price_list_price_integer" CHECK(typeof("com_product_price"."list_price_e4") = 'integer'),
	CONSTRAINT "com_product_price_unit_price_integer" CHECK(typeof("com_product_price"."list_price_unit_e4") = 'integer'),
	CONSTRAINT "com_product_price_multiplier_check" CHECK(typeof("com_product_price"."price_multiplier") = 'integer' and "com_product_price"."price_multiplier" > 0)
);
