PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_app_source_import` (
	`id` integer PRIMARY KEY NOT NULL,
	`adapter_code` text NOT NULL,
	`adapter_version` text NOT NULL,
	`source_label` text NOT NULL,
	`fingerprint` text NOT NULL,
	`imported_at` text NOT NULL,
	`became_current` integer NOT NULL,
	`summary_json` text NOT NULL,
	CONSTRAINT "app_source_import_adapter_check" CHECK("__new_app_source_import"."adapter_code" in ('tiquadri','listino_bt','assets','sienergy')),
	CONSTRAINT "app_source_import_fingerprint_check" CHECK(length("__new_app_source_import"."fingerprint") = 64),
	CONSTRAINT "app_source_import_current_check" CHECK("__new_app_source_import"."became_current" in (0,1)),
	CONSTRAINT "app_source_import_summary_check" CHECK(json_valid("__new_app_source_import"."summary_json"))
);
--> statement-breakpoint
INSERT INTO `__new_app_source_import`("id", "adapter_code", "adapter_version", "source_label", "fingerprint", "imported_at", "became_current", "summary_json") SELECT "id", "adapter_code", "adapter_version", "source_label", "fingerprint", "imported_at", "became_current", "summary_json" FROM `app_source_import`;--> statement-breakpoint
DROP TABLE `app_source_import`;--> statement-breakpoint
ALTER TABLE `__new_app_source_import` RENAME TO `app_source_import`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `app_source_import_fingerprint_unique` ON `app_source_import` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `app_source_import_adapter_idx` ON `app_source_import` (`adapter_code`,`imported_at`);