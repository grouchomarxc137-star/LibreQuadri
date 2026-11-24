CREATE TABLE `cat_config_capacity_filler` (
	`model_id` integer PRIMARY KEY NOT NULL,
	`capacity_kind_code` text NOT NULL,
	`source` text NOT NULL,
	`source_ref` text,
	FOREIGN KEY (`model_id`) REFERENCES `cat_config_model`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`capacity_kind_code`) REFERENCES `cat_capacity_kind`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_config_capacity_filler_source_check" CHECK("cat_config_capacity_filler"."source" in ('import','manual'))
);
--> statement-breakpoint
CREATE INDEX `cat_config_capacity_filler_kind_idx` ON `cat_config_capacity_filler` (`capacity_kind_code`);