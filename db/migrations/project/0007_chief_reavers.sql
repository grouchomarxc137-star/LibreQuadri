ALTER TABLE prj_project ADD COLUMN labour_total_e4 INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE prj_item_bom ADD COLUMN line_discount_bp INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE prj_project SET global_discount_bp=0;
--> statement-breakpoint
UPDATE prj_line SET line_discount_bp=0;
