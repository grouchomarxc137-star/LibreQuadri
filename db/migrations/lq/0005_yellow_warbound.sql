CREATE TABLE `cat_range_level` (
	`code` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cat_range_node_metel_family` (
	`node_id` integer NOT NULL,
	`metel_family_id` integer NOT NULL,
	PRIMARY KEY(`node_id`, `metel_family_id`),
	FOREIGN KEY (`node_id`) REFERENCES `cat_range_node`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`metel_family_id`) REFERENCES `cat_metel_family`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cat_range_node_metel_family_family_idx` ON `cat_range_node_metel_family` (`metel_family_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cat_range_node` (
	`id` integer PRIMARY KEY NOT NULL,
	`brand_id` integer NOT NULL,
	`parent_id` integer,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`node_kind` text NOT NULL,
	`navigable` integer DEFAULT 1 NOT NULL,
	`level_code` text,
	`source_delivery_id` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	`source_import_id` integer,
	`source_ref` text,
	FOREIGN KEY (`brand_id`) REFERENCES `cat_brand`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `cat_range_node`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_code`) REFERENCES `cat_range_level`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_delivery_id`) REFERENCES `app_import_delivery`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_import_id`) REFERENCES `app_source_import`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_range_node_active_check" CHECK("__new_cat_range_node"."active" in (0,1)),
	CONSTRAINT "cat_range_node_navigable_check" CHECK("__new_cat_range_node"."navigable" in (0,1)),
	CONSTRAINT "cat_range_node_source_check" CHECK("__new_cat_range_node"."source" in ('import','metel','manual'))
);
--> statement-breakpoint
INSERT INTO `__new_cat_range_node`("id", "brand_id", "parent_id", "code", "name", "node_kind", "navigable", "level_code", "source_delivery_id", "sort_order", "active", "source", "source_import_id", "source_ref") SELECT "id", "brand_id", "parent_id", "code", "name", "node_kind", 1, NULL, NULL, "sort_order", "active", "source", "source_import_id", "source_ref" FROM `cat_range_node`;--> statement-breakpoint
DROP TABLE `cat_range_node`;--> statement-breakpoint
ALTER TABLE `__new_cat_range_node` RENAME TO `cat_range_node`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `cat_range_node_brand_code_unique` ON `cat_range_node` (`brand_id`,`code`);--> statement-breakpoint
CREATE INDEX `cat_range_node_parent_idx` ON `cat_range_node` (`parent_id`);--> statement-breakpoint
INSERT INTO `cat_range_level` (`code`,`label`,`sort_order`,`source`) VALUES
('gamma','Gamma',10,'seed'),('tipologia','Tipologia',20,'seed'),
('famiglia','Famiglia',30,'seed'),('segmento','Segmento',40,'seed'),
('famiglia_statistica','Famiglia statistica',50,'seed');--> statement-breakpoint
UPDATE `cat_range_node` SET `navigable`=0
WHERE `source`='import' AND `code` LIKE 'tq.%';
