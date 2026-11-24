CREATE TABLE `cat_family_variant_axis` (
	`family_id` integer NOT NULL,
	`attribute_id` integer NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`family_id`, `attribute_id`),
	FOREIGN KEY (`family_id`) REFERENCES `cat_product_family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attribute_id`) REFERENCES `cat_attribute`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_family_variant_axis_order_unique` ON `cat_family_variant_axis` (`family_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `cat_product_family` (
	`id` integer PRIMARY KEY NOT NULL,
	`brand_id` integer NOT NULL,
	`code` text NOT NULL,
	`category_id` integer NOT NULL,
	`name` text NOT NULL,
	`series` text,
	`description` text,
	`active` integer DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `cat_brand`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `cat_category`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_product_family_active_check" CHECK("cat_product_family"."active" in (0, 1)),
	CONSTRAINT "cat_product_family_source_check" CHECK("cat_product_family"."source" in ('seed', 'manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_product_family_brand_code_unique` ON `cat_product_family` (`brand_id`,`code`);--> statement-breakpoint
CREATE TABLE `cat_product_family_assignment` (
	`product_id` integer PRIMARY KEY NOT NULL,
	`family_id` integer,
	`state` text NOT NULL,
	`grouper_code` text,
	`grouper_version` text,
	FOREIGN KEY (`product_id`) REFERENCES `cat_product`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `cat_product_family`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_product_family_assignment_state_check" CHECK("cat_product_family_assignment"."state" in ('grouper', 'manual', 'manual_excluded')),
	CONSTRAINT "cat_product_family_assignment_family_check" CHECK(("cat_product_family_assignment"."state" = 'manual_excluded') = ("cat_product_family_assignment"."family_id" is null)),
	CONSTRAINT "cat_product_family_assignment_grouper_check" CHECK((
    "cat_product_family_assignment"."state" = 'grouper' and "cat_product_family_assignment"."grouper_code" is not null and "cat_product_family_assignment"."grouper_version" is not null
  ) or (
    "cat_product_family_assignment"."state" in ('manual', 'manual_excluded') and "cat_product_family_assignment"."grouper_code" is null and "cat_product_family_assignment"."grouper_version" is null
  ))
);
--> statement-breakpoint
CREATE INDEX `cat_product_family_assignment_family_idx` ON `cat_product_family_assignment` (`family_id`);