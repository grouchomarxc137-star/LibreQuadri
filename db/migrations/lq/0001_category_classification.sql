CREATE TABLE `app_setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cat_category` (
	`id` integer PRIMARY KEY NOT NULL,
	`parent_id` integer,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `cat_category`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_category_active_check" CHECK("cat_category"."active" in (0, 1)),
	CONSTRAINT "cat_category_source_check" CHECK("cat_category"."source" in ('seed', 'manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_category_code_unique` ON `cat_category` (`code`);--> statement-breakpoint
CREATE INDEX `cat_category_parent_idx` ON `cat_category` (`parent_id`);--> statement-breakpoint
CREATE TABLE `cat_category_mapping` (
	`id` integer PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`brand_id` integer,
	`issuer_id` integer,
	`source_type` text NOT NULL,
	`match_mode` text NOT NULL,
	`match_value` text NOT NULL,
	`category_id` integer NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`source` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `cat_brand`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issuer_id`) REFERENCES `cat_metel_issuer`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `cat_category`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_category_mapping_type_check" CHECK("cat_category_mapping"."source_type" in ('STATISTICA', 'SCONTO', 'ELECTROCOD', 'CODE_PREFIX', 'DESCRIPTION')),
	CONSTRAINT "cat_category_mapping_mode_check" CHECK("cat_category_mapping"."match_mode" in ('exact', 'prefix', 'regex')),
	CONSTRAINT "cat_category_mapping_source_check" CHECK("cat_category_mapping"."source" in ('seed', 'manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_category_mapping_code_unique` ON `cat_category_mapping` (`code`);--> statement-breakpoint
-- Reviewed: additive changes preserve existing products, indexes and foreign keys.
ALTER TABLE `cat_product` ADD `category_id` integer REFERENCES cat_category(id);
--> statement-breakpoint
ALTER TABLE `cat_product` ADD `category_source` text DEFAULT 'unmapped' NOT NULL
  CONSTRAINT cat_product_category_source_check CHECK (category_source IN ('mapping', 'manual', 'unmapped'));
--> statement-breakpoint
ALTER TABLE `cat_product` ADD `category_mapping_id` integer REFERENCES cat_category_mapping(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `cat_product_category_listed_idx` ON `cat_product` (`category_id`,`is_listed`);
--> statement-breakpoint
CREATE INDEX `cat_product_review_group_idx` ON `cat_product` (`governing_issuer_id`,`brand_id`,`statistical_family_id`,`is_listed`);
