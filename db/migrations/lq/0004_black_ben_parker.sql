CREATE TABLE `cat_asset` (
	`id` integer PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`media_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`rel_path` text NOT NULL,
	`origin` text NOT NULL,
	`derived_from_asset_id` integer,
	`license_code` text NOT NULL,
	`source_import_id` integer,
	`source_ref` text,
	FOREIGN KEY (`derived_from_asset_id`) REFERENCES `cat_asset`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`license_code`) REFERENCES `cat_asset_license`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_import_id`) REFERENCES `app_source_import`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_asset_sha_check" CHECK(length("cat_asset"."sha256") = 64),
	CONSTRAINT "cat_asset_size_check" CHECK("cat_asset"."byte_size" >= 0),
	CONSTRAINT "cat_asset_origin_check" CHECK("cat_asset"."origin" in ('lq_authored','manufacturer','derived')),
	CONSTRAINT "cat_asset_derivation_check" CHECK("cat_asset"."origin" != 'derived' or "cat_asset"."derived_from_asset_id" is not null),
	CONSTRAINT "cat_asset_path_check" CHECK("cat_asset"."rel_path" not like '/%' and "cat_asset"."rel_path" not like '../%' and "cat_asset"."rel_path" not like '%/../%')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_asset_sha256_unique` ON `cat_asset` (`sha256`);--> statement-breakpoint
CREATE INDEX `cat_asset_license_idx` ON `cat_asset` (`license_code`);--> statement-breakpoint
CREATE TABLE `cat_asset_license` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`may_display` integer NOT NULL,
	`may_embed_in_project` integer NOT NULL,
	`notes` text,
	CONSTRAINT "cat_asset_license_display_check" CHECK("cat_asset_license"."may_display" in (0,1)),
	CONSTRAINT "cat_asset_license_embed_check" CHECK("cat_asset_license"."may_embed_in_project" in (0,1))
);
--> statement-breakpoint
CREATE TABLE `cat_asset_variant` (
	`asset_key` text NOT NULL,
	`variant` text NOT NULL,
	`asset_id` integer NOT NULL,
	PRIMARY KEY(`asset_key`, `variant`),
	FOREIGN KEY (`asset_id`) REFERENCES `cat_asset`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_asset_variant_kind_check" CHECK("cat_asset_variant"."variant" in ('front_light','front_dark','cad'))
);
--> statement-breakpoint
CREATE INDEX `cat_asset_variant_asset_idx` ON `cat_asset_variant` (`asset_id`);--> statement-breakpoint
CREATE TABLE `cat_capacity_kind` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`unit_label` text NOT NULL,
	`display_divisor` integer NOT NULL,
	`nominal_pitch_mm` real,
	`source` text NOT NULL,
	CONSTRAINT "cat_capacity_kind_divisor_check" CHECK(typeof("cat_capacity_kind"."display_divisor") = 'integer' and "cat_capacity_kind"."display_divisor" > 0),
	CONSTRAINT "cat_capacity_kind_pitch_check" CHECK("cat_capacity_kind"."nominal_pitch_mm" is null or "cat_capacity_kind"."nominal_pitch_mm" > 0),
	CONSTRAINT "cat_capacity_kind_source_check" CHECK("cat_capacity_kind"."source" in ('seed','manual'))
);
--> statement-breakpoint
CREATE TABLE `cat_config_axis` (
	`id` integer PRIMARY KEY NOT NULL,
	`model_id` integer NOT NULL,
	`dimension_id` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`label` text NOT NULL,
	`visibility` text NOT NULL,
	`requirement` text NOT NULL,
	`binding` text NOT NULL,
	`editable_when_placed` integer DEFAULT 0 NOT NULL,
	`selects_primary` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `cat_config_model`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dimension_id`) REFERENCES `cat_config_dimension`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_config_axis_visibility_check" CHECK("cat_config_axis"."visibility" in ('visible','hidden')),
	CONSTRAINT "cat_config_axis_requirement_check" CHECK("cat_config_axis"."requirement" in ('required','optional')),
	CONSTRAINT "cat_config_axis_binding_check" CHECK("cat_config_axis"."binding" in ('none','match_container','inherit_container')),
	CONSTRAINT "cat_config_axis_editable_check" CHECK("cat_config_axis"."editable_when_placed" in (0,1)),
	CONSTRAINT "cat_config_axis_primary_check" CHECK("cat_config_axis"."selects_primary" in (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_config_axis_model_dimension_unique` ON `cat_config_axis` (`model_id`,`dimension_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cat_config_axis_model_order_unique` ON `cat_config_axis` (`model_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `cat_config_axis_dimension_idx` ON `cat_config_axis` (`dimension_id`);--> statement-breakpoint
CREATE TABLE `cat_config_budget` (
	`model_id` integer NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`max_amount` integer NOT NULL,
	PRIMARY KEY(`model_id`, `code`),
	FOREIGN KEY (`model_id`) REFERENCES `cat_config_model`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cat_config_budget_amount_check" CHECK(typeof("cat_config_budget"."max_amount") = 'integer' and "cat_config_budget"."max_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE `cat_config_dimension` (
	`id` integer PRIMARY KEY NOT NULL,
	`brand_id` integer NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`attribute_id` integer,
	`active` integer DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	`source_import_id` integer,
	`source_ref` text,
	FOREIGN KEY (`brand_id`) REFERENCES `cat_brand`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attribute_id`) REFERENCES `cat_attribute`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_import_id`) REFERENCES `app_source_import`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_config_dimension_active_check" CHECK("cat_config_dimension"."active" in (0,1)),
	CONSTRAINT "cat_config_dimension_source_check" CHECK("cat_config_dimension"."source" in ('seed','manual','import'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_config_dimension_brand_code_unique` ON `cat_config_dimension` (`brand_id`,`code`);--> statement-breakpoint
CREATE INDEX `cat_config_dimension_attribute_idx` ON `cat_config_dimension` (`attribute_id`);--> statement-breakpoint
CREATE TABLE `cat_config_dimension_value` (
	`id` integer PRIMARY KEY NOT NULL,
	`dimension_id` integer NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`attribute_option_id` integer,
	`value_num` real,
	`active` integer DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	`source_ref` text,
	FOREIGN KEY (`dimension_id`) REFERENCES `cat_config_dimension`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attribute_option_id`) REFERENCES `cat_attribute_option`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_config_dimension_value_active_check" CHECK("cat_config_dimension_value"."active" in (0,1)),
	CONSTRAINT "cat_config_dimension_value_source_check" CHECK("cat_config_dimension_value"."source" in ('seed','manual','import')),
	CONSTRAINT "cat_config_dimension_value_number_option_check" CHECK("cat_config_dimension_value"."attribute_option_id" is null or "cat_config_dimension_value"."value_num" is null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_config_dimension_value_code_unique` ON `cat_config_dimension_value` (`dimension_id`,`code`);--> statement-breakpoint
CREATE INDEX `cat_config_dimension_value_attribute_option_idx` ON `cat_config_dimension_value` (`attribute_option_id`);--> statement-breakpoint
CREATE TABLE `cat_config_exclusion` (
	`container_value_id` integer NOT NULL,
	`content_value_id` integer NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`container_value_id`, `content_value_id`),
	FOREIGN KEY (`container_value_id`) REFERENCES `cat_config_dimension_value`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`content_value_id`) REFERENCES `cat_config_dimension_value`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_config_exclusion_source_check" CHECK("cat_config_exclusion"."source" in ('import','manual'))
);
--> statement-breakpoint
CREATE INDEX `cat_config_exclusion_content_idx` ON `cat_config_exclusion` (`content_value_id`);--> statement-breakpoint
CREATE TABLE `cat_config_model` (
	`id` integer PRIMARY KEY NOT NULL,
	`brand_id` integer NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`model_kind` text NOT NULL,
	`category_id` integer,
	`base_profile_id` integer,
	`max_insert_qty` integer,
	`definition_fingerprint` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`obsolete` integer DEFAULT 0 NOT NULL,
	`source` text NOT NULL,
	`source_import_id` integer,
	`source_ref` text,
	FOREIGN KEY (`brand_id`) REFERENCES `cat_brand`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `cat_category`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`base_profile_id`) REFERENCES `cat_phys_profile`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_import_id`) REFERENCES `app_source_import`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_config_model_kind_check" CHECK("cat_config_model"."model_kind" in ('device','support','enclosure','accessory','kit')),
	CONSTRAINT "cat_config_model_active_check" CHECK("cat_config_model"."active" in (0,1)),
	CONSTRAINT "cat_config_model_obsolete_check" CHECK("cat_config_model"."obsolete" in (0,1)),
	CONSTRAINT "cat_config_model_source_check" CHECK("cat_config_model"."source" in ('import','manual')),
	CONSTRAINT "cat_config_model_max_insert_check" CHECK("cat_config_model"."max_insert_qty" is null or "cat_config_model"."max_insert_qty" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_config_model_brand_code_unique` ON `cat_config_model` (`brand_id`,`code`);--> statement-breakpoint
CREATE INDEX `cat_config_model_category_idx` ON `cat_config_model` (`category_id`);--> statement-breakpoint
CREATE INDEX `cat_config_model_profile_idx` ON `cat_config_model` (`base_profile_id`);--> statement-breakpoint
CREATE TABLE `cat_config_model_article` (
	`model_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`product_id` integer,
	`ref_brand_marchio` text NOT NULL,
	`ref_manufacturer_code` text NOT NULL,
	`quantity` real NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`model_id`, `seq`),
	FOREIGN KEY (`model_id`) REFERENCES `cat_config_model`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `cat_product`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_config_model_article_quantity_check" CHECK("cat_config_model_article"."quantity" > 0),
	CONSTRAINT "cat_config_model_article_role_check" CHECK("cat_config_model_article"."role" in ('primary','component'))
);
--> statement-breakpoint
CREATE INDEX `cat_config_model_article_product_idx` ON `cat_config_model_article` (`product_id`);--> statement-breakpoint
CREATE TABLE `cat_config_model_entry` (
	`product_id` integer NOT NULL,
	`model_id` integer NOT NULL,
	`option_id` integer,
	PRIMARY KEY(`product_id`, `model_id`),
	FOREIGN KEY (`product_id`) REFERENCES `cat_product`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `cat_config_model`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`option_id`) REFERENCES `cat_config_option`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cat_config_model_entry_model_idx` ON `cat_config_model_entry` (`model_id`);--> statement-breakpoint
CREATE INDEX `cat_config_model_entry_option_idx` ON `cat_config_model_entry` (`option_id`);--> statement-breakpoint
CREATE TABLE `cat_config_model_relation` (
	`from_model_id` integer NOT NULL,
	`relation` text NOT NULL,
	`seq` integer NOT NULL,
	`to_model_id` integer NOT NULL,
	`quantity` real NOT NULL,
	`position_x_mm` real,
	`position_y_mm` real,
	`source` text NOT NULL,
	PRIMARY KEY(`from_model_id`, `relation`, `seq`),
	FOREIGN KEY (`from_model_id`) REFERENCES `cat_config_model`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_model_id`) REFERENCES `cat_config_model`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_config_model_relation_kind_check" CHECK("cat_config_model_relation"."relation" in ('join_kit','side_panel','preset_child')),
	CONSTRAINT "cat_config_model_relation_quantity_check" CHECK("cat_config_model_relation"."quantity" > 0),
	CONSTRAINT "cat_config_model_relation_source_check" CHECK("cat_config_model_relation"."source" in ('import','manual'))
);
--> statement-breakpoint
CREATE INDEX `cat_config_model_relation_to_idx` ON `cat_config_model_relation` (`to_model_id`);--> statement-breakpoint
CREATE TABLE `cat_config_option` (
	`id` integer PRIMARY KEY NOT NULL,
	`axis_id` integer NOT NULL,
	`value_id` integer NOT NULL,
	`parent_option_id` integer,
	`is_default` integer DEFAULT 0 NOT NULL,
	`visible` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`axis_id`) REFERENCES `cat_config_axis`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`value_id`) REFERENCES `cat_config_dimension_value`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_option_id`) REFERENCES `cat_config_option`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_config_option_default_check" CHECK("cat_config_option"."is_default" in (0,1)),
	CONSTRAINT "cat_config_option_visible_check" CHECK("cat_config_option"."visible" in (0,1)),
	CONSTRAINT "cat_config_option_active_check" CHECK("cat_config_option"."active" in (0,1))
);
--> statement-breakpoint
CREATE INDEX `cat_config_option_axis_order_idx` ON `cat_config_option` (`axis_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `cat_config_option_value_idx` ON `cat_config_option` (`value_id`);--> statement-breakpoint
CREATE INDEX `cat_config_option_parent_idx` ON `cat_config_option` (`parent_option_id`);--> statement-breakpoint
CREATE TABLE `cat_config_rule` (
	`id` integer PRIMARY KEY NOT NULL,
	`model_id` integer NOT NULL,
	`seq` integer NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `cat_config_model`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_config_rule_model_seq_unique` ON `cat_config_rule` (`model_id`,`seq`);--> statement-breakpoint
CREATE TABLE `cat_config_rule_condition` (
	`rule_id` integer NOT NULL,
	`option_id` integer NOT NULL,
	PRIMARY KEY(`rule_id`, `option_id`),
	FOREIGN KEY (`rule_id`) REFERENCES `cat_config_rule`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`option_id`) REFERENCES `cat_config_option`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cat_config_rule_condition_option_idx` ON `cat_config_rule_condition` (`option_id`);--> statement-breakpoint
CREATE TABLE `cat_config_rule_effect` (
	`rule_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`effect_kind` text NOT NULL,
	`product_id` integer,
	`ref_brand_marchio` text,
	`ref_manufacturer_code` text,
	`quantity` real,
	`article_role` text,
	`int_value` integer,
	`capacity_kind_code` text,
	`budget_code` text,
	`profile_id` integer,
	PRIMARY KEY(`rule_id`, `seq`),
	FOREIGN KEY (`rule_id`) REFERENCES `cat_config_rule`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `cat_product`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`capacity_kind_code`) REFERENCES `cat_capacity_kind`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`profile_id`) REFERENCES `cat_phys_profile`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_config_rule_effect_kind_check" CHECK("cat_config_rule_effect"."effect_kind" in ('article','profile_key_delta','profile_override','demand_delta','budget_use')),
	CONSTRAINT "cat_config_rule_effect_role_check" CHECK("cat_config_rule_effect"."article_role" is null or "cat_config_rule_effect"."article_role" in ('primary','component','accessory')),
	CONSTRAINT "cat_config_rule_effect_integer_check" CHECK("cat_config_rule_effect"."int_value" is null or typeof("cat_config_rule_effect"."int_value") = 'integer'),
	CONSTRAINT "cat_config_rule_effect_shape_check" CHECK((
    "cat_config_rule_effect"."effect_kind" = 'article' and "cat_config_rule_effect"."ref_brand_marchio" is not null and "cat_config_rule_effect"."ref_manufacturer_code" is not null and "cat_config_rule_effect"."quantity" is not null and "cat_config_rule_effect"."quantity" > 0 and "cat_config_rule_effect"."article_role" is not null and "cat_config_rule_effect"."int_value" is null and "cat_config_rule_effect"."capacity_kind_code" is null and "cat_config_rule_effect"."budget_code" is null and "cat_config_rule_effect"."profile_id" is null
  ) or (
    "cat_config_rule_effect"."effect_kind" = 'profile_key_delta' and "cat_config_rule_effect"."int_value" is not null and "cat_config_rule_effect"."product_id" is null and "cat_config_rule_effect"."ref_brand_marchio" is null and "cat_config_rule_effect"."ref_manufacturer_code" is null and "cat_config_rule_effect"."quantity" is null and "cat_config_rule_effect"."article_role" is null and "cat_config_rule_effect"."capacity_kind_code" is null and "cat_config_rule_effect"."budget_code" is null and "cat_config_rule_effect"."profile_id" is null
  ) or (
    "cat_config_rule_effect"."effect_kind" = 'profile_override' and "cat_config_rule_effect"."profile_id" is not null and "cat_config_rule_effect"."product_id" is null and "cat_config_rule_effect"."ref_brand_marchio" is null and "cat_config_rule_effect"."ref_manufacturer_code" is null and "cat_config_rule_effect"."quantity" is null and "cat_config_rule_effect"."article_role" is null and "cat_config_rule_effect"."int_value" is null and "cat_config_rule_effect"."capacity_kind_code" is null and "cat_config_rule_effect"."budget_code" is null
  ) or (
    "cat_config_rule_effect"."effect_kind" = 'demand_delta' and "cat_config_rule_effect"."int_value" is not null and "cat_config_rule_effect"."capacity_kind_code" is not null and "cat_config_rule_effect"."product_id" is null and "cat_config_rule_effect"."ref_brand_marchio" is null and "cat_config_rule_effect"."ref_manufacturer_code" is null and "cat_config_rule_effect"."quantity" is null and "cat_config_rule_effect"."article_role" is null and "cat_config_rule_effect"."budget_code" is null and "cat_config_rule_effect"."profile_id" is null
  ) or (
    "cat_config_rule_effect"."effect_kind" = 'budget_use' and "cat_config_rule_effect"."int_value" is not null and "cat_config_rule_effect"."int_value" > 0 and "cat_config_rule_effect"."budget_code" is not null and "cat_config_rule_effect"."product_id" is null and "cat_config_rule_effect"."ref_brand_marchio" is null and "cat_config_rule_effect"."ref_manufacturer_code" is null and "cat_config_rule_effect"."quantity" is null and "cat_config_rule_effect"."article_role" is null and "cat_config_rule_effect"."capacity_kind_code" is null and "cat_config_rule_effect"."profile_id" is null
  ))
);
--> statement-breakpoint
CREATE INDEX `cat_config_rule_effect_product_idx` ON `cat_config_rule_effect` (`product_id`);--> statement-breakpoint
CREATE INDEX `cat_config_rule_effect_profile_idx` ON `cat_config_rule_effect` (`profile_id`);--> statement-breakpoint
CREATE INDEX `cat_config_rule_effect_kind_idx` ON `cat_config_rule_effect` (`effect_kind`);--> statement-breakpoint
CREATE TABLE `cat_phys_accept_set` (
	`id` integer PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`source` text NOT NULL,
	CONSTRAINT "cat_phys_accept_set_source_check" CHECK("cat_phys_accept_set"."source" in ('import','manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_phys_accept_set_code_unique` ON `cat_phys_accept_set` (`code`);--> statement-breakpoint
CREATE TABLE `cat_phys_accept_set_member` (
	`set_id` integer NOT NULL,
	`class_id` integer NOT NULL,
	PRIMARY KEY(`set_id`, `class_id`),
	FOREIGN KEY (`set_id`) REFERENCES `cat_phys_accept_set`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `cat_phys_class`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cat_phys_accept_set_member_class_idx` ON `cat_phys_accept_set_member` (`class_id`);--> statement-breakpoint
CREATE TABLE `cat_phys_class` (
	`id` integer PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	`source_ref` text,
	CONSTRAINT "cat_phys_class_source_check" CHECK("cat_phys_class"."source" in ('import','manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_phys_class_code_unique` ON `cat_phys_class` (`code`);--> statement-breakpoint
CREATE TABLE `cat_phys_constraint` (
	`profile_id` integer NOT NULL,
	`relation` text NOT NULL,
	`accept_set_id` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `relation`, `accept_set_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `cat_phys_profile`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`accept_set_id`) REFERENCES `cat_phys_accept_set`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_phys_constraint_relation_check" CHECK("cat_phys_constraint"."relation" in ('parent','ancestor'))
);
--> statement-breakpoint
CREATE INDEX `cat_phys_constraint_set_idx` ON `cat_phys_constraint` (`accept_set_id`);--> statement-breakpoint
CREATE TABLE `cat_phys_profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`profile_set_id` integer NOT NULL,
	`profile_key` integer,
	`profile_kind` text NOT NULL,
	`name` text NOT NULL,
	`fit_class_id` integer NOT NULL,
	`depth_mm` real,
	`outer_depth_mm` real,
	`usable_depth_mm` real,
	`active` integer DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	`source_import_id` integer,
	`source_ref` text,
	FOREIGN KEY (`profile_set_id`) REFERENCES `cat_phys_profile_set`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fit_class_id`) REFERENCES `cat_phys_class`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_import_id`) REFERENCES `app_source_import`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_phys_profile_kind_check" CHECK("cat_phys_profile"."profile_kind" in ('device','support','enclosure')),
	CONSTRAINT "cat_phys_profile_active_check" CHECK("cat_phys_profile"."active" in (0,1)),
	CONSTRAINT "cat_phys_profile_source_check" CHECK("cat_phys_profile"."source" in ('import','manual')),
	CONSTRAINT "cat_phys_profile_depth_check" CHECK(("cat_phys_profile"."depth_mm" is null or "cat_phys_profile"."depth_mm" >= 0) and ("cat_phys_profile"."outer_depth_mm" is null or "cat_phys_profile"."outer_depth_mm" >= 0) and ("cat_phys_profile"."usable_depth_mm" is null or "cat_phys_profile"."usable_depth_mm" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_phys_profile_code_unique` ON `cat_phys_profile` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `cat_phys_profile_set_key_unique` ON `cat_phys_profile` (`profile_set_id`,`profile_key`);--> statement-breakpoint
CREATE INDEX `cat_phys_profile_class_idx` ON `cat_phys_profile` (`fit_class_id`);--> statement-breakpoint
CREATE TABLE `cat_phys_profile_demand` (
	`profile_id` integer NOT NULL,
	`capacity_kind_code` text NOT NULL,
	`amount` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `capacity_kind_code`),
	FOREIGN KEY (`profile_id`) REFERENCES `cat_phys_profile`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`capacity_kind_code`) REFERENCES `cat_capacity_kind`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_phys_profile_demand_amount_check" CHECK(typeof("cat_phys_profile_demand"."amount") = 'integer' and "cat_phys_profile_demand"."amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `cat_phys_profile_demand_kind_idx` ON `cat_phys_profile_demand` (`capacity_kind_code`);--> statement-breakpoint
CREATE TABLE `cat_phys_profile_set` (
	`id` integer PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	CONSTRAINT "cat_phys_profile_set_source_check" CHECK("cat_phys_profile_set"."source" in ('import','manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_phys_profile_set_code_unique` ON `cat_phys_profile_set` (`code`);--> statement-breakpoint
CREATE TABLE `cat_phys_view` (
	`profile_id` integer NOT NULL,
	`view_code` text NOT NULL,
	`width_mm` real NOT NULL,
	`height_mm` real NOT NULL,
	`insert_dx_mm` real,
	`insert_dy_mm` real,
	`symbol_kind` text NOT NULL,
	`asset_key` text,
	PRIMARY KEY(`profile_id`, `view_code`),
	FOREIGN KEY (`profile_id`) REFERENCES `cat_phys_profile`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cat_phys_view_code_check" CHECK("cat_phys_view"."view_code" in ('front','front_alt1','front_alt2')),
	CONSTRAINT "cat_phys_view_size_check" CHECK("cat_phys_view"."width_mm" > 0 and "cat_phys_view"."height_mm" > 0)
);
--> statement-breakpoint
CREATE TABLE `cat_phys_zone` (
	`profile_id` integer NOT NULL,
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
	PRIMARY KEY(`profile_id`, `zone_no`),
	FOREIGN KEY (`profile_id`) REFERENCES `cat_phys_profile`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`capacity_kind_code`) REFERENCES `cat_capacity_kind`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_phys_zone_no_check" CHECK("cat_phys_zone"."zone_no" >= 0),
	CONSTRAINT "cat_phys_zone_layout_check" CHECK("cat_phys_zone"."layout" in ('linear','stack','slots')),
	CONSTRAINT "cat_phys_zone_direction_check" CHECK("cat_phys_zone"."direction" is null or "cat_phys_zone"."direction" in ('horizontal','vertical')),
	CONSTRAINT "cat_phys_zone_view_check" CHECK("cat_phys_zone"."required_view_code" is null or "cat_phys_zone"."required_view_code" in ('front','front_alt1','front_alt2')),
	CONSTRAINT "cat_phys_zone_capacity_check" CHECK("cat_phys_zone"."capacity_amount" is null or (typeof("cat_phys_zone"."capacity_amount") = 'integer' and "cat_phys_zone"."capacity_amount" >= 0)),
	CONSTRAINT "cat_phys_zone_pitch_check" CHECK("cat_phys_zone"."pitch_mm" is null or "cat_phys_zone"."pitch_mm" > 0)
);
--> statement-breakpoint
CREATE INDEX `cat_phys_zone_kind_idx` ON `cat_phys_zone` (`capacity_kind_code`);--> statement-breakpoint
CREATE TABLE `cat_phys_zone_slot` (
	`profile_id` integer NOT NULL,
	`zone_no` integer NOT NULL,
	`slot_no` integer NOT NULL,
	`x_mm` real NOT NULL,
	`y_mm` real NOT NULL,
	PRIMARY KEY(`profile_id`, `zone_no`, `slot_no`),
	FOREIGN KEY (`profile_id`,`zone_no`) REFERENCES `cat_phys_zone`(`profile_id`,`zone_no`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cat_phys_zone_slot_no_check" CHECK("cat_phys_zone_slot"."slot_no" >= 0)
);
--> statement-breakpoint
CREATE TABLE `cat_product_physical` (
	`product_id` integer PRIMARY KEY NOT NULL,
	`din_half_modules` integer,
	`width_mm` real,
	`height_mm` real,
	`depth_mm` real,
	`weight_g` real,
	`source` text NOT NULL,
	`source_import_id` integer,
	FOREIGN KEY (`product_id`) REFERENCES `cat_product`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_import_id`) REFERENCES `app_source_import`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_product_physical_source_check" CHECK("cat_product_physical"."source" in ('import_file','manual')),
	CONSTRAINT "cat_product_physical_din_check" CHECK("cat_product_physical"."din_half_modules" is null or (typeof("cat_product_physical"."din_half_modules") = 'integer' and "cat_product_physical"."din_half_modules" >= 0)),
	CONSTRAINT "cat_product_physical_measure_check" CHECK(("cat_product_physical"."width_mm" is null or "cat_product_physical"."width_mm" >= 0) and ("cat_product_physical"."height_mm" is null or "cat_product_physical"."height_mm" >= 0) and ("cat_product_physical"."depth_mm" is null or "cat_product_physical"."depth_mm" >= 0) and ("cat_product_physical"."weight_g" is null or "cat_product_physical"."weight_g" >= 0))
);
--> statement-breakpoint
CREATE TABLE `cat_range_node` (
	`id` integer PRIMARY KEY NOT NULL,
	`brand_id` integer NOT NULL,
	`parent_id` integer,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`node_kind` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	`source_import_id` integer,
	`source_ref` text,
	FOREIGN KEY (`brand_id`) REFERENCES `cat_brand`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `cat_range_node`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_import_id`) REFERENCES `app_source_import`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_range_node_active_check" CHECK("cat_range_node"."active" in (0,1)),
	CONSTRAINT "cat_range_node_source_check" CHECK("cat_range_node"."source" in ('import','manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_range_node_brand_code_unique` ON `cat_range_node` (`brand_id`,`code`);--> statement-breakpoint
CREATE INDEX `cat_range_node_parent_idx` ON `cat_range_node` (`parent_id`);--> statement-breakpoint
CREATE TABLE `cat_range_node_model` (
	`node_id` integer NOT NULL,
	`model_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`node_id`, `model_id`),
	FOREIGN KEY (`node_id`) REFERENCES `cat_range_node`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `cat_config_model`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cat_range_node_model_model_idx` ON `cat_range_node_model` (`model_id`);--> statement-breakpoint
CREATE TABLE `cat_source_brand_map` (
	`adapter_code` text NOT NULL,
	`source_brand_code` text NOT NULL,
	`brand_id` integer,
	`source` text NOT NULL,
	PRIMARY KEY(`adapter_code`, `source_brand_code`),
	FOREIGN KEY (`brand_id`) REFERENCES `cat_brand`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_source_brand_map_source_check" CHECK("cat_source_brand_map"."source" in ('seed','manual'))
);
--> statement-breakpoint
CREATE INDEX `cat_source_brand_map_brand_idx` ON `cat_source_brand_map` (`brand_id`);--> statement-breakpoint
CREATE TABLE `cat_source_conflict` (
	`id` integer PRIMARY KEY NOT NULL,
	`import_id` integer NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_key` text NOT NULL,
	`topic` text NOT NULL,
	`value_a` text,
	`source_a` text,
	`value_b` text,
	`source_b` text,
	`resolution` text DEFAULT 'unresolved' NOT NULL,
	`resolved_value` text,
	`notes` text,
	FOREIGN KEY (`import_id`) REFERENCES `app_source_import`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_source_conflict_subject_check" CHECK("cat_source_conflict"."subject_kind" in ('article','model','profile','brand')),
	CONSTRAINT "cat_source_conflict_resolution_check" CHECK("cat_source_conflict"."resolution" in ('unresolved','prefer_a','prefer_b','manual'))
);
--> statement-breakpoint
CREATE INDEX `cat_source_conflict_import_idx` ON `cat_source_conflict` (`import_id`);--> statement-breakpoint
CREATE INDEX `cat_source_conflict_subject_idx` ON `cat_source_conflict` (`subject_kind`,`subject_key`,`topic`);--> statement-breakpoint
CREATE TABLE `app_source_import` (
	`id` integer PRIMARY KEY NOT NULL,
	`adapter_code` text NOT NULL,
	`adapter_version` text NOT NULL,
	`source_label` text NOT NULL,
	`fingerprint` text NOT NULL,
	`imported_at` text NOT NULL,
	`became_current` integer NOT NULL,
	`summary_json` text NOT NULL,
	CONSTRAINT "app_source_import_adapter_check" CHECK("app_source_import"."adapter_code" in ('tiquadri','listino_bt','assets')),
	CONSTRAINT "app_source_import_fingerprint_check" CHECK(length("app_source_import"."fingerprint") = 64),
	CONSTRAINT "app_source_import_current_check" CHECK("app_source_import"."became_current" in (0,1)),
	CONSTRAINT "app_source_import_summary_check" CHECK(json_valid("app_source_import"."summary_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_source_import_fingerprint_unique` ON `app_source_import` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `app_source_import_adapter_idx` ON `app_source_import` (`adapter_code`,`imported_at`);--> statement-breakpoint
CREATE TABLE `app_source_import_file` (
	`import_id` integer NOT NULL,
	`role` text NOT NULL,
	`file_sha256` text NOT NULL,
	`original_file_name` text NOT NULL,
	`byte_size` integer NOT NULL,
	PRIMARY KEY(`import_id`, `role`),
	FOREIGN KEY (`import_id`) REFERENCES `app_source_import`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "app_source_import_file_role_check" CHECK("app_source_import_file"."role" in ('master','dxf','listino','assets')),
	CONSTRAINT "app_source_import_file_sha_check" CHECK(length("app_source_import_file"."file_sha256") = 64),
	CONSTRAINT "app_source_import_file_size_check" CHECK("app_source_import_file"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE INDEX `app_source_import_file_sha_idx` ON `app_source_import_file` (`file_sha256`);