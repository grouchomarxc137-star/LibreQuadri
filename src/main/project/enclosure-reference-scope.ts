import type Database from "better-sqlite3";

/** Explicit engineering-source policies; commercial-only or unverified manual models are excluded. */
export function enclosureReferenceScopeIds(db:Database.Database,navigableIds:readonly number[]):ReadonlySet<number> {
  return new Set(db.prepare(`SELECT m.id FROM json_each(?) ids JOIN cat_config_model m ON m.id=ids.value
    JOIN cat_brand b ON b.id=m.brand_id AND b.active=1
    JOIN app_source_import i ON i.id=m.source_import_id
    WHERE m.source='import' AND ((b.metel_marchio='BTI' AND i.adapter_code='tiquadri'
      AND m.source_ref LIKE 'TiQuadri ANA_PACK %') OR (b.metel_marchio='SIE' AND i.adapter_code='sienergy' AND m.code LIKE 'sie.%' AND EXISTS(SELECT 1 FROM cat_phys_view v WHERE v.profile_id=m.base_profile_id)))`).pluck().all(JSON.stringify(navigableIds)) as number[]);
}
