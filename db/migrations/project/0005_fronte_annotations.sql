CREATE TABLE `prj_annotation` (
	`id` integer PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	`text` text NOT NULL,
	`x_mm` real NOT NULL,
	`y_mm` real NOT NULL,
	`sort_order` integer NOT NULL,
	CONSTRAINT "prj_annotation_text_check" CHECK(length("prj_annotation"."text") between 1 and 2000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prj_annotation_uuid_unique` ON `prj_annotation` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `prj_annotation_sort_order_unique` ON `prj_annotation` (`sort_order`);