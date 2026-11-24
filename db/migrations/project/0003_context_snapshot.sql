ALTER TABLE prj_item ADD COLUMN context_policy TEXT CHECK (context_policy IS NULL OR context_policy IN ('unknown','unrestricted','restricted'));--> statement-breakpoint
CREATE TABLE `prj_item_context` (
	`item_id` integer NOT NULL,
	`role` text NOT NULL,
	`context_code` text NOT NULL,
	PRIMARY KEY(`item_id`, `role`, `context_code`),
	FOREIGN KEY (`item_id`) REFERENCES `prj_item`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "prj_item_context_role_check" CHECK("prj_item_context"."role" in ('provides','accepts'))
);
