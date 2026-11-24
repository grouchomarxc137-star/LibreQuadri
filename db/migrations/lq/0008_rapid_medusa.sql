CREATE TABLE `cat_config_context` (
  `id` integer PRIMARY KEY NOT NULL,
  `brand_id` integer NOT NULL REFERENCES `cat_brand`(`id`),
  `code` text NOT NULL,
  `name` text NOT NULL,
  `active` integer NOT NULL DEFAULT 1 CHECK (`active` IN (0,1)),
  `source` text NOT NULL CHECK (`source` IN ('import','manual')),
  `source_import_id` integer REFERENCES `app_source_import`(`id`),
  `source_ref` text
);--> statement-breakpoint
CREATE UNIQUE INDEX `cat_config_context_brand_code_unique` ON `cat_config_context` (`brand_id`,`code`);--> statement-breakpoint
CREATE TABLE `cat_config_model_context` (
  `model_id` integer NOT NULL REFERENCES `cat_config_model`(`id`) ON DELETE CASCADE,
  `context_id` integer NOT NULL REFERENCES `cat_config_context`(`id`),
  `role` text NOT NULL CHECK (`role` IN ('provides','accepts')),
  PRIMARY KEY (`model_id`,`role`,`context_id`)
);--> statement-breakpoint
CREATE INDEX `cat_config_model_context_context_role_model_idx` ON `cat_config_model_context` (`context_id`,`role`,`model_id`);--> statement-breakpoint
ALTER TABLE `cat_config_model` ADD COLUMN `context_policy` text NOT NULL DEFAULT 'unknown' CHECK (`context_policy` IN ('unknown','unrestricted','restricted'));--> statement-breakpoint
ALTER TABLE `cat_range_node` ADD COLUMN `design_navigable` integer NOT NULL DEFAULT 0 CHECK (`design_navigable` IN (0,1));
