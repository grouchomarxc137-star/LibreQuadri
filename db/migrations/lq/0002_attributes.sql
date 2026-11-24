CREATE TABLE `cat_attribute` (
	`id` integer PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`data_type` text NOT NULL,
	`unit` text,
	`etim_feature_code` text,
	`active` integer DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	CONSTRAINT "cat_attribute_data_type_check" CHECK("cat_attribute"."data_type" in ('number', 'enum', 'boolean', 'text')),
	CONSTRAINT "cat_attribute_unit_check" CHECK("cat_attribute"."unit" is null or "cat_attribute"."data_type" = 'number'),
	CONSTRAINT "cat_attribute_active_check" CHECK("cat_attribute"."active" in (0, 1)),
	CONSTRAINT "cat_attribute_source_check" CHECK("cat_attribute"."source" in ('seed', 'manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_attribute_code_unique` ON `cat_attribute` (`code`);--> statement-breakpoint
CREATE TABLE `cat_attribute_option` (
	`id` integer PRIMARY KEY NOT NULL,
	`attribute_id` integer NOT NULL,
	`value` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`attribute_id`) REFERENCES `cat_attribute`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_attribute_option_active_check" CHECK("cat_attribute_option"."active" in (0, 1)),
	CONSTRAINT "cat_attribute_option_source_check" CHECK("cat_attribute_option"."source" in ('seed', 'manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_attribute_option_value_unique` ON `cat_attribute_option` (`attribute_id`,`value`);--> statement-breakpoint
CREATE TABLE `cat_category_attribute` (
	`category_id` integer NOT NULL,
	`attribute_id` integer NOT NULL,
	`is_filterable` integer DEFAULT 1 NOT NULL,
	`is_required` integer DEFAULT 0 NOT NULL,
	`filter_widget` text DEFAULT 'checkbox' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`category_id`, `attribute_id`),
	FOREIGN KEY (`category_id`) REFERENCES `cat_category`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attribute_id`) REFERENCES `cat_attribute`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_category_attribute_filterable_check" CHECK("cat_category_attribute"."is_filterable" in (0, 1)),
	CONSTRAINT "cat_category_attribute_required_check" CHECK("cat_category_attribute"."is_required" in (0, 1)),
	CONSTRAINT "cat_category_attribute_widget_check" CHECK("cat_category_attribute"."filter_widget" in ('range', 'checkbox', 'select')),
	CONSTRAINT "cat_category_attribute_source_check" CHECK("cat_category_attribute"."source" in ('seed', 'manual'))
);
--> statement-breakpoint
CREATE INDEX `cat_category_attribute_attribute_idx` ON `cat_category_attribute` (`attribute_id`);--> statement-breakpoint
CREATE TABLE `cat_product_attribute` (
	`product_id` integer NOT NULL,
	`attribute_id` integer NOT NULL,
	`value_num` real,
	`option_id` integer,
	`value_bool` integer,
	`value_text` text,
	`source` text NOT NULL,
	`confidence` real,
	PRIMARY KEY(`product_id`, `attribute_id`),
	FOREIGN KEY (`product_id`) REFERENCES `cat_product`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attribute_id`) REFERENCES `cat_attribute`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`option_id`) REFERENCES `cat_attribute_option`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_product_attribute_one_value_check" CHECK(("cat_product_attribute"."value_num" is not null) + ("cat_product_attribute"."option_id" is not null) + ("cat_product_attribute"."value_bool" is not null) + ("cat_product_attribute"."value_text" is not null) = 1),
	CONSTRAINT "cat_product_attribute_bool_check" CHECK("cat_product_attribute"."value_bool" is null or "cat_product_attribute"."value_bool" in (0, 1)),
	CONSTRAINT "cat_product_attribute_source_check" CHECK("cat_product_attribute"."source" in ('parser', 'import_file', 'seed', 'manual'))
);
--> statement-breakpoint
CREATE INDEX `cat_product_attribute_option_idx` ON `cat_product_attribute` (`attribute_id`,`option_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `cat_product_attribute_number_idx` ON `cat_product_attribute` (`attribute_id`,`value_num`,`product_id`);