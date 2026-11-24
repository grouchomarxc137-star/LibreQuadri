CREATE TABLE `app_removed_brand_listing` (
	`brand_id` integer NOT NULL,
	`issuer_id` integer NOT NULL,
	PRIMARY KEY(`brand_id`, `issuer_id`),
	FOREIGN KEY (`brand_id`) REFERENCES `cat_brand`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issuer_id`) REFERENCES `cat_metel_issuer`(`id`) ON UPDATE no action ON DELETE no action
);
