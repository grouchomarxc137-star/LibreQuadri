ALTER TABLE cat_config_model ADD COLUMN commercial_contribution TEXT NOT NULL DEFAULT 'articles' CHECK (commercial_contribution IN ('articles','none'));
