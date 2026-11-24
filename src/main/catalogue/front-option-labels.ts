import type Database from "better-sqlite3";
import type { FrontOptionLabel, ProjectConfiguredItem } from "../../shared/project.js";

/** The project supplies stable choices, never catalogue row IDs or renderer state. */
export function resolveFrontOptionLabels(database: Database.Database | null | undefined,
  items: readonly ProjectConfiguredItem[], placed: ReadonlySet<string>): Map<string, FrontOptionLabel[]> {
  const matches = new Map<string, FrontOptionLabel[]>();
  if (!database || !placed.size || !database.prepare(
    "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='cat_config_rule_front_label'",
  ).get()) return matches;
  const query = database.prepare(`SELECT DISTINCT l.asset_key AS assetKey, l.x_mm AS xMm, l.y_mm AS yMm,
      l.width_mm AS widthMm, l.height_mm AS heightMm
    FROM cat_config_rule_front_label l JOIN cat_config_rule r ON r.id=l.rule_id
    JOIN cat_config_model m ON m.id=r.model_id JOIN cat_brand b ON b.id=m.brand_id
    JOIN app_source_import i ON i.id=m.source_import_id AND i.adapter_code='tiquadri' AND i.became_current=1
    WHERE b.metel_marchio=@brand AND m.code=@code AND m.definition_fingerprint=@fingerprint
      AND m.model_kind='enclosure' AND m.active=1 AND m.obsolete=0 AND m.source='import'
      AND NOT EXISTS (
        SELECT 1 FROM cat_config_rule_condition c JOIN cat_config_option o ON o.id=c.option_id
        JOIN cat_config_axis a ON a.id=o.axis_id JOIN cat_config_dimension d ON d.id=a.dimension_id
        JOIN cat_config_dimension_value v ON v.id=o.value_id
        WHERE c.rule_id=r.id AND NOT EXISTS (
          SELECT 1 FROM json_each(@choices) s
          WHERE s.key=d.code AND s.value=v.code
        )
      ) ORDER BY r.seq`);
  for (const item of items) {
    if (!placed.has(item.uuid) || item.modelKind !== "enclosure" || item.physStatus !== "resolved") continue;
    const labels = query.all({
      brand: item.modelBrandMarchio, code: item.modelCode, fingerprint: item.modelDefinitionFingerprint,
      choices: JSON.stringify(Object.fromEntries(item.selections.map(s => [s.dimensionCode, s.valueCode]))),
    }) as FrontOptionLabel[];
    if (labels.length) matches.set(item.uuid, labels);
  }
  return matches;
}
