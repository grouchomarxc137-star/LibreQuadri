CREATE TABLE `family_row` (
	`raw_file_id` integer NOT NULL,
	`line_no` integer NOT NULL,
	`raw_line` text NOT NULL,
	`family_type` text NOT NULL,
	`issuer_sigla` text NOT NULL,
	`marchio` text NOT NULL,
	`code` text NOT NULL,
	`description` text NOT NULL,
	PRIMARY KEY(`raw_file_id`, `line_no`),
	FOREIGN KEY (`raw_file_id`) REFERENCES `raw_file`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "family_row_family_type_check" CHECK("family_row"."family_type" in ('SCONTO', 'STATISTICA')),
	CONSTRAINT "family_row_line_no_check" CHECK("family_row"."line_no" > 1)
);
--> statement-breakpoint
CREATE INDEX `family_row_file_brand_code_idx` ON `family_row` (`raw_file_id`,`marchio`,`code`);--> statement-breakpoint
CREATE TABLE `price_list_row` (
	`raw_file_id` integer NOT NULL,
	`line_no` integer NOT NULL,
	`raw_line` text NOT NULL,
	`marchio` text NOT NULL,
	`codice` text NOT NULL,
	`ean` text,
	`descrizione` text NOT NULL,
	`qta_cartone` integer NOT NULL,
	`qta_multipla` integer NOT NULL,
	`qta_minima` integer NOT NULL,
	`qta_massima` integer NOT NULL,
	`lead_time_code` text NOT NULL,
	`prezzo_rivenditore_cents` integer NOT NULL,
	`prezzo_pubblico_cents` integer NOT NULL,
	`moltiplicatore` integer NOT NULL,
	`valuta` text NOT NULL,
	`um` text NOT NULL,
	`composto` integer NOT NULL,
	`stato_code` text NOT NULL,
	`data_variazione` text NOT NULL,
	`famiglia_sconto` text,
	`famiglia_statistica` text,
	`electrocod` text,
	`extra_v021` text,
	PRIMARY KEY(`raw_file_id`, `line_no`),
	FOREIGN KEY (`raw_file_id`) REFERENCES `raw_file`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "price_list_row_line_no_check" CHECK("price_list_row"."line_no" > 1),
	CONSTRAINT "price_list_row_composto_check" CHECK("price_list_row"."composto" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `price_list_row_file_brand_code_idx` ON `price_list_row` (`raw_file_id`,`marchio`,`codice`);--> statement-breakpoint
CREATE TABLE `raw_file` (
	`id` integer PRIMARY KEY NOT NULL,
	`file_sha256` text NOT NULL,
	`file_type` text NOT NULL,
	`original_file_name` text NOT NULL,
	`archived_path` text,
	`issuer_sigla` text NOT NULL,
	`issuer_piva` text,
	`listino_number` text,
	`valid_from` text,
	`last_change_date` text,
	`header_description` text,
	`layout_version` text NOT NULL,
	`parsed_at` text NOT NULL,
	`status` text NOT NULL,
	`row_count` integer NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`report_json` text DEFAULT '{}' NOT NULL,
	CONSTRAINT "raw_file_sha256_length" CHECK(length("raw_file"."file_sha256") = 64),
	CONSTRAINT "raw_file_file_type_check" CHECK("raw_file"."file_type" in ('LSP', 'FSC', 'FST')),
	CONSTRAINT "raw_file_layout_version_check" CHECK("raw_file"."layout_version" in ('020', '021')),
	CONSTRAINT "raw_file_status_check" CHECK("raw_file"."status" in ('parsed', 'failed', 'pruned')),
	CONSTRAINT "raw_file_row_count_check" CHECK("raw_file"."row_count" >= 0),
	CONSTRAINT "raw_file_warning_count_check" CHECK("raw_file"."warning_count" >= 0),
	CONSTRAINT "raw_file_report_json_check" CHECK(json_valid("raw_file"."report_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_file_file_sha256_unique` ON `raw_file` (`file_sha256`);