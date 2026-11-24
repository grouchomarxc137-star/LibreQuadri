ALTER TABLE prj_annotation ADD COLUMN width_mm REAL NOT NULL DEFAULT 240 CHECK (width_mm BETWEEN 60 AND 100000);--> statement-breakpoint
ALTER TABLE prj_annotation ADD COLUMN height_mm REAL NOT NULL DEFAULT 40 CHECK (height_mm BETWEEN 24 AND 100000);--> statement-breakpoint
-- Format-6 notes were single points. Each becomes a 240 mm wide box tall enough for its text at the box font
-- (16 mm per line, 32 characters per wrapped line, 8 mm padding), never below 40 mm: a function of the text only.
UPDATE prj_annotation SET height_mm = MAX(40.0, ((length(text) - length(replace(text, char(10), ''))) + 1 + length(text) / 32) * 16.0 + 8.0);
