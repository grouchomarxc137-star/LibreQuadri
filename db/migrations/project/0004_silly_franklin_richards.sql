ALTER TABLE prj_item ADD COLUMN commercial_contribution TEXT NOT NULL DEFAULT 'articles' CHECK (commercial_contribution IN ('articles','none'));
