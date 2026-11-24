ALTER TABLE `cat_brand` ADD `import_removed` integer DEFAULT 0 NOT NULL CONSTRAINT `cat_brand_import_removed_check` CHECK (`import_removed` in (0, 1));
