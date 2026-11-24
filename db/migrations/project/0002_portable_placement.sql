ALTER TABLE prj_item ADD COLUMN fit_class_label TEXT;--> statement-breakpoint
ALTER TABLE prj_item_zone ADD COLUMN capacity_kind_label TEXT;--> statement-breakpoint
ALTER TABLE prj_item_zone ADD COLUMN display_divisor INTEGER;--> statement-breakpoint
ALTER TABLE prj_item_zone ADD COLUMN nominal_pitch_mm REAL;
