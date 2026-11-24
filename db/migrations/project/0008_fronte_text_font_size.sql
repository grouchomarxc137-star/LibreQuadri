-- Each Fronte Quadro text box gets its own text size in drawing millimetres (6-60). Every existing box was drawn at the
-- one fixed size of 12 mm, so the column default is exactly the migration: a function of nothing but the column.
ALTER TABLE prj_annotation ADD COLUMN font_size_mm REAL NOT NULL DEFAULT 12 CHECK (font_size_mm BETWEEN 6 AND 60);
