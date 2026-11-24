CREATE TABLE `app_recent_file` (
	`path` text PRIMARY KEY NOT NULL,
	`project_uuid` text NOT NULL,
	`title` text NOT NULL,
	`last_opened_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `app_recent_file_last_opened_idx` ON `app_recent_file` (`last_opened_at`);