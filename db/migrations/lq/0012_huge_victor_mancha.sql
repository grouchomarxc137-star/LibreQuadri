CREATE TABLE `cat_config_model_attribute` (
	`model_id` integer NOT NULL,
	`attribute_id` integer NOT NULL,
	`value_num` real,
	`option_id` integer,
	`source` text NOT NULL,
	PRIMARY KEY(`model_id`, `attribute_id`),
	FOREIGN KEY (`model_id`) REFERENCES `cat_config_model`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attribute_id`) REFERENCES `cat_attribute`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`option_id`) REFERENCES `cat_attribute_option`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_config_model_attribute_value_check" CHECK(("cat_config_model_attribute"."value_num" is null) <> ("cat_config_model_attribute"."option_id" is null)),
	CONSTRAINT "cat_config_model_attribute_source_check" CHECK("cat_config_model_attribute"."source" in ('seed','manual'))
);
--> statement-breakpoint
CREATE INDEX `cat_config_model_attribute_option_idx` ON `cat_config_model_attribute` (`attribute_id`,`option_id`);--> statement-breakpoint
CREATE INDEX `cat_config_model_attribute_number_idx` ON `cat_config_model_attribute` (`attribute_id`,`value_num`);--> statement-breakpoint
CREATE TABLE `cat_config_model_offer` (
	`model_id` integer NOT NULL,
	`offer_no` integer NOT NULL,
	`status` text NOT NULL,
	`undecided_reason` text,
	`definition_fingerprint` text NOT NULL,
	`config_fingerprint` text,
	PRIMARY KEY(`model_id`, `offer_no`),
	FOREIGN KEY (`model_id`) REFERENCES `cat_config_model`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cat_config_model_offer_status_check" CHECK("cat_config_model_offer"."status" in ('feasible','undecided')),
	CONSTRAINT "cat_config_model_offer_reason_check" CHECK("cat_config_model_offer"."undecided_reason" is null or "cat_config_model_offer"."undecided_reason" in ('search_bound','value_conflict')),
	CONSTRAINT "cat_config_model_offer_witness_check" CHECK(("cat_config_model_offer"."status" = 'feasible') = ("cat_config_model_offer"."config_fingerprint" is not null and "cat_config_model_offer"."undecided_reason" is null))
);
--> statement-breakpoint
CREATE TABLE `cat_config_model_offer_selection` (
	`model_id` integer NOT NULL,
	`offer_no` integer NOT NULL,
	`value_id` integer NOT NULL,
	`origin` text NOT NULL,
	PRIMARY KEY(`model_id`, `offer_no`, `value_id`),
	FOREIGN KEY (`value_id`) REFERENCES `cat_config_dimension_value`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`model_id`,`offer_no`) REFERENCES `cat_config_model_offer`(`model_id`,`offer_no`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cat_config_model_offer_selection_origin_check" CHECK("cat_config_model_offer_selection"."origin" in ('candidate','search','default'))
);
--> statement-breakpoint
CREATE TABLE `cat_config_model_offer_state` (
	`model_id` integer PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`candidates` integer NOT NULL,
	`feasible` integer NOT NULL,
	`infeasible` integer NOT NULL,
	`undecided` integer NOT NULL,
	`resolutions` integer NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `cat_config_model`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cat_config_model_offer_state_status_check" CHECK("cat_config_model_offer_state"."status" in ('complete','partial','none'))
);
--> statement-breakpoint
CREATE TABLE `cat_config_model_offer_value` (
	`model_id` integer NOT NULL,
	`offer_no` integer NOT NULL,
	`attribute_id` integer NOT NULL,
	`value_num` real,
	`option_id` integer,
	PRIMARY KEY(`model_id`, `offer_no`, `attribute_id`),
	FOREIGN KEY (`attribute_id`) REFERENCES `cat_attribute`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`option_id`) REFERENCES `cat_attribute_option`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`model_id`,`offer_no`) REFERENCES `cat_config_model_offer`(`model_id`,`offer_no`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cat_config_model_offer_value_check" CHECK(("cat_config_model_offer_value"."value_num" is null) <> ("cat_config_model_offer_value"."option_id" is null))
);
--> statement-breakpoint
CREATE INDEX `cat_config_model_offer_value_option_idx` ON `cat_config_model_offer_value` (`attribute_id`,`option_id`,`model_id`);--> statement-breakpoint
CREATE INDEX `cat_config_model_offer_value_number_idx` ON `cat_config_model_offer_value` (`attribute_id`,`value_num`,`model_id`);--> statement-breakpoint
CREATE TABLE `cat_config_value_attribute` (
	`value_id` integer NOT NULL,
	`attribute_id` integer NOT NULL,
	`value_num` real,
	`option_id` integer,
	`source` text NOT NULL,
	PRIMARY KEY(`value_id`, `attribute_id`),
	FOREIGN KEY (`value_id`) REFERENCES `cat_config_dimension_value`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attribute_id`) REFERENCES `cat_attribute`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`option_id`) REFERENCES `cat_attribute_option`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_config_value_attribute_value_check" CHECK(("cat_config_value_attribute"."value_num" is null) <> ("cat_config_value_attribute"."option_id" is null)),
	CONSTRAINT "cat_config_value_attribute_source_check" CHECK("cat_config_value_attribute"."source" in ('seed','manual'))
);
--> statement-breakpoint
CREATE INDEX `cat_config_value_attribute_option_idx` ON `cat_config_value_attribute` (`attribute_id`,`option_id`);--> statement-breakpoint
CREATE INDEX `cat_config_value_attribute_number_idx` ON `cat_config_value_attribute` (`attribute_id`,`value_num`);--> statement-breakpoint
CREATE TABLE `_stage_b_attribute_counts` (`source` text PRIMARY KEY, `count` integer NOT NULL);
--> statement-breakpoint
INSERT INTO `_stage_b_attribute_counts` SELECT `source`, COUNT(*) FROM `cat_product_attribute` GROUP BY `source`;
--> statement-breakpoint
CREATE TABLE `__new_cat_product_attribute` (
  `product_id` integer NOT NULL REFERENCES `cat_product`(`id`) ON DELETE CASCADE,
  `attribute_id` integer NOT NULL REFERENCES `cat_attribute`(`id`),
  `value_num` real,
  `option_id` integer REFERENCES `cat_attribute_option`(`id`),
  `value_bool` integer,
  `value_text` text,
  `source` text NOT NULL,
  `confidence` real,
  `source_import_id` integer REFERENCES `app_source_import`(`id`),
  `derivation_ref` text,
  PRIMARY KEY (`product_id`, `attribute_id`),
  CONSTRAINT `cat_product_attribute_one_value_check` CHECK ((`value_num` IS NOT NULL) + (`option_id` IS NOT NULL) + (`value_bool` IS NOT NULL) + (`value_text` IS NOT NULL) = 1),
  CONSTRAINT `cat_product_attribute_bool_check` CHECK (`value_bool` IS NULL OR `value_bool` IN (0,1)),
  CONSTRAINT `cat_product_attribute_source_check` CHECK (`source` IN ('parser','engineering','import_file','seed','manual')),
  CONSTRAINT `cat_product_attribute_provenance_check` CHECK ((`source` = 'engineering') = (`source_import_id` IS NOT NULL AND `derivation_ref` IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_cat_product_attribute`
  (`product_id`,`attribute_id`,`value_num`,`option_id`,`value_bool`,`value_text`,`source`,`confidence`,`source_import_id`,`derivation_ref`)
SELECT `product_id`,`attribute_id`,`value_num`,`option_id`,`value_bool`,`value_text`,`source`,`confidence`,NULL,NULL
FROM `cat_product_attribute`;
--> statement-breakpoint
CREATE TABLE `_stage_b_attribute_assert` (`ok` integer CHECK (`ok` = 1));
--> statement-breakpoint
INSERT INTO `_stage_b_attribute_assert` SELECT CASE WHEN
  (SELECT COUNT(*) FROM `cat_product_attribute`) = (SELECT COUNT(*) FROM `__new_cat_product_attribute`)
  AND NOT EXISTS (SELECT 1 FROM `_stage_b_attribute_counts` b
    WHERE b.count != (SELECT COUNT(*) FROM `__new_cat_product_attribute` n WHERE n.source=b.source))
  AND NOT EXISTS (SELECT 1 FROM `__new_cat_product_attribute` n
    WHERE NOT EXISTS (SELECT 1 FROM `_stage_b_attribute_counts` b WHERE b.source=n.source))
THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE `_stage_b_attribute_assert`;
--> statement-breakpoint
DROP TABLE `_stage_b_attribute_counts`;
--> statement-breakpoint
DROP TABLE `cat_product_attribute`;
--> statement-breakpoint
ALTER TABLE `__new_cat_product_attribute` RENAME TO `cat_product_attribute`;
--> statement-breakpoint
CREATE INDEX `cat_product_attribute_option_idx` ON `cat_product_attribute` (`attribute_id`,`option_id`,`product_id`);
--> statement-breakpoint
CREATE INDEX `cat_product_attribute_number_idx` ON `cat_product_attribute` (`attribute_id`,`value_num`,`product_id`);
--> statement-breakpoint
ALTER TABLE `cat_config_model` ADD COLUMN `category_source` text NOT NULL DEFAULT 'unmapped' CHECK (`category_source` IN ('unmapped','seed','manual'));
--> statement-breakpoint
ALTER TABLE `cat_product` ADD COLUMN `category_model_id` integer REFERENCES `cat_config_model`(`id`) ON DELETE SET NULL;
