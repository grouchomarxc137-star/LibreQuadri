CREATE TABLE `cat_range_node_product` (
	`product_id` integer NOT NULL,
	`classification_code` text NOT NULL,
	`node_id` integer NOT NULL,
	`rule_code` text NOT NULL,
	`rule_version` text NOT NULL,
	`taxonomy_fingerprint` text NOT NULL,
	`article_fingerprint` text NOT NULL,
	`unresolved_reason` text,
	PRIMARY KEY(`product_id`, `classification_code`),
	FOREIGN KEY (`product_id`) REFERENCES `cat_product`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `cat_range_node`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cat_range_node_product_node_idx` ON `cat_range_node_product` (`node_id`,`product_id`);