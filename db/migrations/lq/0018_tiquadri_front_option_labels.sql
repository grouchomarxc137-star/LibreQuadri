CREATE TABLE `cat_config_rule_front_label` (
	`rule_id` integer PRIMARY KEY NOT NULL,
	`asset_key` text NOT NULL,
	`x_mm` real NOT NULL,
	`y_mm` real NOT NULL,
	`width_mm` real NOT NULL,
	`height_mm` real NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `cat_config_rule`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cat_config_rule_front_label_size_check" CHECK("cat_config_rule_front_label"."width_mm">0 and "cat_config_rule_front_label"."height_mm">0)
);
