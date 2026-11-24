CREATE TABLE `cat_range_source_level_map` (
	`adapter_code` text NOT NULL,
	`system_id` integer NOT NULL,
	`source_level` text NOT NULL,
	`level_code` text,
	`catalogue_navigable` integer DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`adapter_code`, `system_id`, `source_level`),
	FOREIGN KEY (`level_code`) REFERENCES `cat_range_level`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_range_source_level_map_navigable_check" CHECK("cat_range_source_level_map"."catalogue_navigable" in (0,1)),
	CONSTRAINT "cat_range_source_level_map_source_check" CHECK("cat_range_source_level_map"."source" in ('seed','manual'))
);
--> statement-breakpoint
INSERT INTO `cat_range_source_level_map`
  (`adapter_code`,`system_id`,`source_level`,`level_code`,`catalogue_navigable`,`source`) VALUES
('tiquadri',1,'system',NULL,0,'seed'),('tiquadri',1,'g1','gamma',0,'seed'),
('tiquadri',1,'g2',NULL,0,'seed'),('tiquadri',1,'g3',NULL,0,'seed'),
('tiquadri',1,'class','famiglia',0,'seed'),
('tiquadri',2,'system',NULL,0,'seed'),('tiquadri',2,'g1','gamma',0,'seed'),
('tiquadri',2,'g2',NULL,0,'seed'),('tiquadri',2,'g3',NULL,0,'seed'),
('tiquadri',2,'class','famiglia',0,'seed'),
('tiquadri',3,'system',NULL,1,'seed'),('tiquadri',3,'g1','gamma',1,'seed'),
('tiquadri',3,'g2','tipologia',1,'seed'),('tiquadri',3,'g3','tipologia',1,'seed'),
('tiquadri',3,'class','famiglia',1,'seed');
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cat_range_node` (
	`id` integer PRIMARY KEY NOT NULL,
	`brand_id` integer NOT NULL,
	`parent_id` integer,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`node_kind` text NOT NULL,
	`source_level` text,
	`navigable` integer DEFAULT 1 NOT NULL,
	`level_code` text,
	`source_delivery_id` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	`source_import_id` integer,
	`source_ref` text,
	FOREIGN KEY (`brand_id`) REFERENCES `cat_brand`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `cat_range_node`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_code`) REFERENCES `cat_range_level`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_delivery_id`) REFERENCES `app_import_delivery`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_import_id`) REFERENCES `app_source_import`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cat_range_node_active_check" CHECK("__new_cat_range_node"."active" in (0,1)),
	CONSTRAINT "cat_range_node_navigable_check" CHECK("__new_cat_range_node"."navigable" in (0,1)),
	CONSTRAINT "cat_range_node_kind_check" CHECK("__new_cat_range_node"."node_kind" in ('section','level','group')),
	CONSTRAINT "cat_range_node_source_check" CHECK("__new_cat_range_node"."source" in ('import','metel','manual'))
);
--> statement-breakpoint
INSERT INTO `__new_cat_range_node`("id", "brand_id", "parent_id", "code", "name", "node_kind", "source_level", "navigable", "level_code", "source_delivery_id", "sort_order", "active", "source", "source_import_id", "source_ref")
SELECT old.id,old.brand_id,
  CASE WHEN old.node_kind='class' AND parent.node_kind='range' AND parent.parent_id IS NOT NULL
    THEN parent.parent_id ELSE old.parent_id END,
  old.code,old.name,
  CASE WHEN old.node_kind IN ('section','level','group') THEN old.node_kind
    WHEN old.node_kind='system' THEN 'section'
    WHEN old.node_kind='class' THEN 'group' ELSE 'level' END,
  CASE old.node_kind WHEN 'system' THEN 'system' WHEN 'level1' THEN 'g1'
    WHEN 'level2' THEN 'g2' WHEN 'level3' THEN 'g3'
    WHEN 'class' THEN 'class' WHEN 'range' THEN 'range' ELSE NULL END,
  CASE WHEN old.source='import' AND old.code LIKE 'tq.%' THEN
    CASE WHEN old.node_kind='range' OR old.code LIKE 'tq.orphan.%'
      OR parent.code LIKE 'tq.orphan.%' THEN 0
      WHEN EXISTS(SELECT 1 FROM cat_range_source_level_map sm
        WHERE sm.adapter_code='tiquadri' AND sm.source_level='system'
          AND sm.catalogue_navigable=0
          AND (COALESCE(parent.code,old.code)='tq.system.'||sm.system_id
            OR COALESCE(parent.code,old.code) LIKE 'tq.system.'||sm.system_id||'.%')) THEN 0
      ELSE 1 END ELSE old.navigable END,
  COALESCE(old.level_code,(SELECT sm.level_code FROM cat_range_source_level_map sm
    WHERE sm.adapter_code='tiquadri'
      AND sm.source_level=CASE old.node_kind
        WHEN 'system' THEN 'system' WHEN 'level1' THEN 'g1'
        WHEN 'level2' THEN 'g2' WHEN 'level3' THEN 'g3'
        WHEN 'class' THEN 'class' ELSE '' END
      AND (COALESCE(parent.code,old.code)='tq.system.'||sm.system_id
        OR COALESCE(parent.code,old.code) LIKE 'tq.system.'||sm.system_id||'.%')
    LIMIT 1)),
  old.source_delivery_id,old.sort_order,old.active,old.source,old.source_import_id,old.source_ref
FROM cat_range_node old LEFT JOIN cat_range_node parent ON parent.id=old.parent_id;--> statement-breakpoint
DROP TABLE `cat_range_node`;--> statement-breakpoint
ALTER TABLE `__new_cat_range_node` RENAME TO `cat_range_node`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `cat_range_node_brand_code_unique` ON `cat_range_node` (`brand_id`,`code`);--> statement-breakpoint
CREATE INDEX `cat_range_node_parent_idx` ON `cat_range_node` (`parent_id`);--> statement-breakpoint
CREATE TABLE `__new_cat_range_level` (
	`code` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer NOT NULL,
	`source` text NOT NULL,
	CONSTRAINT "cat_range_level_source_check" CHECK("__new_cat_range_level"."source" in ('seed','manual'))
);
--> statement-breakpoint
INSERT INTO `__new_cat_range_level`("code", "label", "sort_order", "source") SELECT "code", "label", "sort_order", "source" FROM `cat_range_level`;--> statement-breakpoint
DROP TABLE `cat_range_level`;--> statement-breakpoint
ALTER TABLE `__new_cat_range_level` RENAME TO `cat_range_level`;
