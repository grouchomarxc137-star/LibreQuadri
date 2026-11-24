import {parseMountingFacts,type MountingFacts} from "../../shared/mounting.js";
import type Database from "better-sqlite3";

import {
  synchronizeCapacityKindSeed, synchronizeSourceBrandMapSeed,
  type CapacityKindSeed, type SourceBrandMapSeed,
} from "../catalogue/engineering-seed.js";
import { refreshEngineeringLinks } from "./engineering-links.js";

type Id = { id: number };

/** Source adapters submit these source-independent records one at a time. */
export interface EngineeringProfile {
  mounting?:MountingFacts|null;
  code: string;
  setId: number;
  key: number;
  kind: string;
  name: string;
  classId: number;
  depth: number | null;
  outerDepth: number | null;
  usableDepth: number | null;
  importId: number;
  ref: string;
}

export interface EngineeringModel {
  brandId: number;
  code: string;
  name: string;
  kind: string;
  profile: number | null;
  maxQty: number | null;
  fingerprint: string;
  active: number;
  obsolete: number;
  importId: number;
  ref: string;
  commercialContribution?: "articles" | "none";
}

export type ContextPolicy = "unknown" | "unrestricted" | "restricted";

export interface EngineeringView {
  profileId: number;
  code: string;
  width: number;
  height: number;
  dx: number;
  dy: number;
  symbol: string;
  asset: string | null;
}

export interface EngineeringZone {
  mounting?:MountingFacts|null;zoneNo?:number;
  profileId: number;
  layout: string;
  capacityKind: string | null;
  capacity: number;
  x: number | null;
  y: number | null;
  length: number | null;
  breadth: number | null;
  direction: string | null;
  pitch: number | null;
  requiredView: string | null;
}

export interface EngineeringConflict {
  importId: number;
  subjectKind: "article" | "model" | "profile" | "brand";
  subjectKey: string;
  topic: string;
  valueA: string | null;
  sourceA: string;
  valueB: string | null;
  sourceB: string;
  notes?: string;
}

/** Owns Revision-8 engineering persistence; adapters own source interpretation. */
export class EngineeringDataWriter {
  constructor(private readonly database: Database.Database) {}

  assertOutsideTransaction(): void {
    if (this.database.inTransaction) throw new Error("Engineering import needs its own transaction");
  }

  transaction<T>(write: () => T): T {
    this.assertOutsideTransaction();
    return this.database.transaction(() => {
      this.database.exec("PRAGMA defer_foreign_keys = ON");
      return write();
    })();
  }

  findImport(fingerprint: string): { id: number; summary_json: string; became_current:number; adapter_version:string } | undefined {
    return this.database.prepare("SELECT id,summary_json,became_current,adapter_version FROM app_source_import WHERE fingerprint=?")
      .get(fingerprint) as { id: number; summary_json: string; became_current:number; adapter_version:string } | undefined;
  }

  beginImport(record: {
    adapterCode: string; adapterVersion: string; sourceLabel: string;
    fingerprint: string; importedAt: string;
    files: readonly { role: string; sha256: string; name: string; byteSize: number }[];
  }): number {
    this.database.prepare("UPDATE app_source_import SET became_current=0 WHERE adapter_code=? AND became_current=1")
      .run(record.adapterCode);
    const id = (this.database.prepare(`INSERT INTO app_source_import
      (adapter_code,adapter_version,source_label,fingerprint,imported_at,became_current,summary_json)
      VALUES(?,?,?,?,?,1,'{}') ON CONFLICT(fingerprint) DO UPDATE SET
        adapter_code=excluded.adapter_code,adapter_version=excluded.adapter_version,
        source_label=excluded.source_label,imported_at=excluded.imported_at,
        became_current=1,summary_json='{}' RETURNING id`).get(
      record.adapterCode, record.adapterVersion, record.sourceLabel, record.fingerprint, record.importedAt,
    ) as Id).id;
    const file = this.database.prepare(`INSERT INTO app_source_import_file
      (import_id,role,file_sha256,original_file_name,byte_size) VALUES(?,?,?,?,?)
      ON CONFLICT(import_id,role) DO UPDATE SET file_sha256=excluded.file_sha256,
        original_file_name=excluded.original_file_name,byte_size=excluded.byte_size`);
    for (const item of record.files) file.run(id,item.role,item.sha256,item.name,item.byteSize);
    return id;
  }

  finishImport(importId: number, summary: Record<string, unknown>): void {
    const unresolved=this.database.prepare(`SELECT code FROM cat_config_model
      WHERE source='import' AND source_import_id=? AND context_policy='unknown' LIMIT 1`)
      .get(importId) as {code:string}|undefined;
    if(unresolved)throw new Error(`Engineering import left model ${unresolved.code} with unknown context policy`);
    this.database.prepare("UPDATE app_source_import SET summary_json=? WHERE id=?")
      .run(JSON.stringify(summary),importId);
  }

  prepareSeeds(capacity: CapacityKindSeed, brands: SourceBrandMapSeed): void {
    synchronizeCapacityKindSeed(this.database,capacity);
    synchronizeSourceBrandMapSeed(this.database,brands);
  }

  ensureBrand(marchio: string, name: string): number {
    this.database.prepare(`INSERT INTO cat_brand(metel_marchio,name,source)
      VALUES(?,?,'import') ON CONFLICT(metel_marchio) DO NOTHING`).run(marchio,name);
    return (this.database.prepare("SELECT id FROM cat_brand WHERE metel_marchio=?")
      .get(marchio) as Id).id;
  }

  conflict(record: EngineeringConflict): void {
    const previous = this.database.prepare(`SELECT resolution,resolved_value,notes FROM cat_source_conflict
      WHERE subject_kind=? AND subject_key=? AND topic=? AND resolution!='unresolved'
      ORDER BY id DESC LIMIT 1`).get(record.subjectKind,record.subjectKey,record.topic) as
      { resolution: string; resolved_value: string | null; notes: string | null } | undefined;
    this.database.prepare(`INSERT INTO cat_source_conflict(import_id,subject_kind,subject_key,topic,
      value_a,source_a,value_b,source_b,resolution,resolved_value,notes)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      record.importId,record.subjectKind,record.subjectKey,record.topic,
      record.valueA,record.sourceA,record.valueB,record.sourceB,
      previous?.resolution ?? "unresolved",previous?.resolved_value ?? null,
      previous?.notes ?? record.notes ?? null,
    );
  }

  upsertClass(code: string, name: string, ref: string): number {
    this.database.prepare(`INSERT INTO cat_phys_class(code,name,source,source_ref) VALUES(?,?,'import',?)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name,source_ref=excluded.source_ref
      WHERE cat_phys_class.source='import'`).run(code,name,ref);
    return (this.database.prepare("SELECT id FROM cat_phys_class WHERE code=?").get(code) as Id).id;
  }

  upsertProfileSet(code: string, name: string): number {
    this.database.prepare(`INSERT INTO cat_phys_profile_set(code,name,source) VALUES(?,?,'import')
      ON CONFLICT(code) DO UPDATE SET name=excluded.name WHERE cat_phys_profile_set.source='import'`)
      .run(code,name);
    return (this.database.prepare("SELECT id FROM cat_phys_profile_set WHERE code=?").get(code) as Id).id;
  }

  /** A negative ID means a manual profile was retained; no imported children are replaced. */
  upsertProfile(values: EngineeringProfile): number {
    const existing=this.database.prepare("SELECT id,source FROM cat_phys_profile WHERE code=?")
      .get(values.code) as {id:number;source:string}|undefined;
    if(existing?.source==="manual")return -existing.id;
    this.database.prepare(`INSERT INTO cat_phys_profile(code,profile_set_id,profile_key,profile_kind,name,
      fit_class_id,depth_mm,outer_depth_mm,usable_depth_mm,mounting_json,active,source,source_import_id,source_ref)
      VALUES(@code,@setId,@key,@kind,@name,@classId,@depth,@outerDepth,@usableDepth,@mountingJson,1,'import',@importId,@ref)
      ON CONFLICT(code) DO UPDATE SET profile_set_id=excluded.profile_set_id,
        profile_key=excluded.profile_key,profile_kind=excluded.profile_kind,name=excluded.name,
        fit_class_id=excluded.fit_class_id,depth_mm=excluded.depth_mm,
        outer_depth_mm=excluded.outer_depth_mm,usable_depth_mm=excluded.usable_depth_mm,
        mounting_json=excluded.mounting_json,active=1,source_import_id=excluded.source_import_id,source_ref=excluded.source_ref
      WHERE cat_phys_profile.source='import'`).run({...values,mountingJson:values.mounting?JSON.stringify(parseMountingFacts(values.mounting)):null});
    const id=(this.database.prepare("SELECT id FROM cat_phys_profile WHERE code=?")
      .get(values.code) as Id).id;
    for(const table of ["cat_phys_profile_demand","cat_phys_constraint","cat_phys_zone","cat_phys_view"])
      this.database.prepare(`DELETE FROM ${table} WHERE profile_id=?`).run(id);
    return id;
  }

  addView(view: EngineeringView): void {
    this.database.prepare(`INSERT INTO cat_phys_view(profile_id,view_code,width_mm,height_mm,
      insert_dx_mm,insert_dy_mm,symbol_kind,asset_key) VALUES(?,?,?,?,?,?,?,?)`)
      .run(view.profileId,view.code,view.width,view.height,view.dx,view.dy,view.symbol,view.asset);
  }

  addDemand(profileId: number, kind: string, amount: number): void {
    this.database.prepare(`INSERT INTO cat_phys_profile_demand(profile_id,capacity_kind_code,amount)
      VALUES(?,?,?)`).run(profileId,kind,amount);
  }

  upsertAcceptSet(code: string, memberClasses: readonly number[]): number {
    this.database.prepare("INSERT INTO cat_phys_accept_set(code,source) VALUES(?,'import') ON CONFLICT(code) DO NOTHING")
      .run(code);
    const id=(this.database.prepare("SELECT id FROM cat_phys_accept_set WHERE code=?").get(code) as Id).id;
    const member=this.database.prepare("INSERT OR IGNORE INTO cat_phys_accept_set_member(set_id,class_id) VALUES(?,?)");
    for(const classId of memberClasses)member.run(id,classId);
    return id;
  }

  addConstraint(profileId: number, relation: string, acceptSetId: number): void {
    this.database.prepare(`INSERT OR IGNORE INTO cat_phys_constraint(profile_id,relation,accept_set_id)
      VALUES(?,?,?)`).run(profileId,relation,acceptSetId);
  }

  addZone(zone: EngineeringZone): void {
    this.database.prepare(`INSERT INTO cat_phys_zone(profile_id,zone_no,layout,capacity_kind_code,
      capacity_amount,origin_x_mm,origin_y_mm,length_mm,breadth_mm,direction,pitch_mm,required_view_code,mounting_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(zone.profileId,zone.zoneNo??0,zone.layout,zone.capacityKind,
        zone.capacity,zone.x,zone.y,zone.length,zone.breadth,zone.direction,zone.pitch,zone.requiredView,zone.mounting?JSON.stringify(parseMountingFacts(zone.mounting)):null);
  }

  addZoneSlot(profileId: number, slotNo: number, x: number, y: number): void {
    this.database.prepare(`INSERT INTO cat_phys_zone_slot(profile_id,zone_no,slot_no,x_mm,y_mm)
      VALUES(?,0,?,?,?)`).run(profileId,slotNo,x,y);
  }

  /** A missing ID means a manual model was retained. */
  upsertModel(values: EngineeringModel): number | undefined {
    return (this.database.prepare(`INSERT INTO cat_config_model(brand_id,code,name,model_kind,
      base_profile_id,max_insert_qty,definition_fingerprint,active,obsolete,source,source_import_id,source_ref,commercial_contribution)
      VALUES(@brandId,@code,@name,@kind,@profile,@maxQty,@fingerprint,@active,@obsolete,'import',@importId,@ref,@commercialContribution)
      ON CONFLICT(brand_id,code) DO UPDATE SET name=excluded.name,model_kind=excluded.model_kind,
        base_profile_id=excluded.base_profile_id,max_insert_qty=excluded.max_insert_qty,
        definition_fingerprint=excluded.definition_fingerprint,active=excluded.active,
        obsolete=excluded.obsolete,source_import_id=excluded.source_import_id,source_ref=excluded.source_ref,
        context_policy='unknown',commercial_contribution=excluded.commercial_contribution
      WHERE cat_config_model.source='import' RETURNING id`).get({...values,
        commercialContribution:values.commercialContribution??"articles"}) as Id|undefined)?.id;
  }

  setModelContextPolicy(modelId: number, policy: Exclude<ContextPolicy,"unknown">): void {
    this.database.prepare(`UPDATE cat_config_model SET context_policy=? WHERE id=? AND source='import'`)
      .run(policy,modelId);
  }

  upsertContext(brandId: number, code: string, name: string, importId: number, ref: string): number {
    this.database.prepare(`INSERT INTO cat_config_context
      (brand_id,code,name,active,source,source_import_id,source_ref)
      VALUES(?,?,?,1,'import',?,?) ON CONFLICT(brand_id,code) DO UPDATE SET
        name=excluded.name,active=1,source_import_id=excluded.source_import_id,
        source_ref=excluded.source_ref WHERE cat_config_context.source='import'`)
      .run(brandId,code,name,importId,ref);
    return (this.database.prepare(`SELECT id FROM cat_config_context WHERE brand_id=? AND code=?`)
      .get(brandId,code) as Id).id;
  }

  replaceModelContexts(modelId: number, role: "provides"|"accepts", contextIds: readonly number[]): void {
    const owned=this.database.prepare(`SELECT 1 FROM cat_config_model WHERE id=? AND source='import'`)
      .get(modelId);
    if(!owned)throw new Error("Cannot replace context links on a manual model");
    this.database.prepare(`DELETE FROM cat_config_model_context WHERE model_id=? AND role=?`)
      .run(modelId,role);
    const insert=this.database.prepare(`INSERT INTO cat_config_model_context(model_id,role,context_id)
      VALUES(?,?,?)`);
    for(const contextId of new Set(contextIds))insert.run(modelId,role,contextId);
  }

  deactivateAbsentContexts(importId: number, brandId: number, codePrefix: string): void {
    this.database.prepare(`UPDATE cat_config_context SET active=0 WHERE source='import'
      AND brand_id=? AND code LIKE ? AND source_import_id<>?`)
      .run(brandId,`${codePrefix}%`,importId);
  }

  replaceModelChildren(modelId: number): void {
    this.database.prepare("DELETE FROM cat_config_model_entry WHERE model_id=?").run(modelId);
    this.database.prepare(`DELETE FROM cat_config_rule_condition WHERE rule_id IN
      (SELECT id FROM cat_config_rule WHERE model_id=?)`).run(modelId);
    this.database.prepare(`DELETE FROM cat_config_rule_effect WHERE rule_id IN
      (SELECT id FROM cat_config_rule WHERE model_id=?)`).run(modelId);
    this.database.prepare("DELETE FROM cat_config_rule WHERE model_id=?").run(modelId);
    this.database.prepare(`DELETE FROM cat_config_option WHERE axis_id IN
      (SELECT id FROM cat_config_axis WHERE model_id=?)`).run(modelId);
    this.database.prepare("DELETE FROM cat_config_axis WHERE model_id=?").run(modelId);
    this.database.prepare("DELETE FROM cat_config_model_article WHERE model_id=?").run(modelId);
    this.database.prepare("DELETE FROM cat_config_budget WHERE model_id=?").run(modelId);
  }

  upsertDimension(brandId: number, code: string, name: string, importId: number, ref: string):
    { id: number | undefined; manual: boolean } {
    const id=(this.database.prepare(`INSERT INTO cat_config_dimension(brand_id,code,name,active,source,source_import_id,source_ref)
      VALUES(?,?,?,1,'import',?,?) ON CONFLICT(brand_id,code) DO UPDATE SET
        name=excluded.name,active=1,source_import_id=excluded.source_import_id,source_ref=excluded.source_ref
      WHERE cat_config_dimension.source='import' RETURNING id`).get(brandId,code,name,importId,ref) as Id|undefined)?.id;
    return id!==undefined?{id,manual:false}:{id:(this.database.prepare(
      "SELECT id FROM cat_config_dimension WHERE brand_id=? AND code=?",
    ).get(brandId,code) as Id|undefined)?.id,manual:true};
  }

  upsertValue(dimensionId: number, code: string, label: string, order: number, ref: string):
    { id: number | undefined; manual: boolean } {
    const id=(this.database.prepare(`INSERT INTO cat_config_dimension_value(dimension_id,code,label,sort_order,active,source,source_ref)
      VALUES(?,?,?,?,1,'import',?) ON CONFLICT(dimension_id,code) DO UPDATE SET
        label=excluded.label,active=1,source_ref=excluded.source_ref
      WHERE cat_config_dimension_value.source='import' RETURNING id`).get(
        dimensionId,code,label,order,ref,
      ) as Id|undefined)?.id;
    return id!==undefined?{id,manual:false}:{id:(this.database.prepare(
      "SELECT id FROM cat_config_dimension_value WHERE dimension_id=? AND code=?",
    ).get(dimensionId,code) as Id|undefined)?.id,manual:true};
  }

  addAxis(modelId: number, dimensionId: number, order: number, label: string,
    visible: boolean, binding: string, selectsPrimary: boolean, editableWhenPlaced = false): number {
    return (this.database.prepare(`INSERT INTO cat_config_axis(model_id,dimension_id,sort_order,label,
      visibility,requirement,binding,editable_when_placed,selects_primary)
      VALUES(?,?,?,?,?,'required',?,?,?) RETURNING id`).get(modelId,dimensionId,order,label,
        visible?"visible":"hidden",binding,editableWhenPlaced?1:0,selectsPrimary?1:0) as Id).id;
  }

  setAxisOptional(axisId: number): void {
    this.database.prepare("UPDATE cat_config_axis SET requirement='optional' WHERE id=?").run(axisId);
  }

  addOption(axisId: number, valueId: number, parentId: number | null,
    isDefault: boolean, visible: boolean, order: number): number {
    return (this.database.prepare(`INSERT INTO cat_config_option(axis_id,value_id,parent_option_id,
      is_default,visible,sort_order,active) VALUES(?,?,?,?,?,?,1) RETURNING id`)
      .get(axisId,valueId,parentId,isDefault?1:0,visible?1:0,order) as Id).id;
  }

  addRule(modelId: number, seq: number, emptyBomAllowed=false): number {
    return (this.database.prepare("INSERT INTO cat_config_rule(model_id,seq,empty_bom_allowed) VALUES(?,?,?) RETURNING id")
      .get(modelId,seq,emptyBomAllowed?1:0) as Id).id;
  }

  addCondition(ruleId: number, optionId: number): void {
    this.database.prepare("INSERT OR IGNORE INTO cat_config_rule_condition(rule_id,option_id) VALUES(?,?)")
      .run(ruleId,optionId);
  }

  addFrontOptionLabel(ruleId: number, assetKey: string, xMm: number, yMm: number, widthMm: number, heightMm: number): void {
    this.database.prepare(`INSERT INTO cat_config_rule_front_label(rule_id,asset_key,x_mm,y_mm,width_mm,height_mm)
      VALUES(?,?,?,?,?,?)`).run(ruleId,assetKey,xMm,yMm,widthMm,heightMm);
  }

  addBaseArticle(modelId: number, seq: number, marchio: string, code: string,
    quantity: number, role: string): void {
    this.database.prepare(`INSERT INTO cat_config_model_article(model_id,seq,product_id,
      ref_brand_marchio,ref_manufacturer_code,quantity,role) VALUES(?,?,NULL,?,?,?,?)`)
      .run(modelId,seq,marchio,code,quantity,role);
  }

  addArticleEffect(ruleId: number, seq: number, marchio: string, code: string,
    quantity: number, role: string): void {
    this.database.prepare(`INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,
      ref_brand_marchio,ref_manufacturer_code,quantity,article_role)
      VALUES(?,?,'article',?,?,?,?)`).run(ruleId,seq,marchio,code,quantity,role);
  }

  addProfileOverride(ruleId:number,seq:number,profileId:number):void {
    this.database.prepare("INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,profile_id) VALUES(?,?,'profile_override',?)").run(ruleId,seq,profileId);
  }

  addProfileDelta(ruleId: number, seq: number, delta: number): void {
    this.database.prepare(`INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,int_value)
      VALUES(?,?,'profile_key_delta',?)`).run(ruleId,seq,delta);
  }

  addBudget(modelId: number, code: string, label: string, max: number): void {
    this.database.prepare("INSERT INTO cat_config_budget(model_id,code,label,max_amount) VALUES(?,?,?,?)")
      .run(modelId,code,label,max);
  }

  addBudgetUse(ruleId: number, seq: number, amount: number, budgetCode: string): void {
    this.database.prepare(`INSERT INTO cat_config_rule_effect(rule_id,seq,effect_kind,int_value,budget_code)
      VALUES(?,?,'budget_use',?,?)`).run(ruleId,seq,amount,budgetCode);
  }

  clearRelations(modelCodePrefix: string): void {
    this.database.prepare(`DELETE FROM cat_config_model_relation WHERE source='import'
      AND from_model_id IN (SELECT id FROM cat_config_model WHERE code LIKE ?)`)
      .run(`${modelCodePrefix}%`);
  }

  addRelation(fromId: number, relation: string, seq: number, toId: number,
    quantity: number, x: number | null, y: number | null,
    placementMode: import("../../shared/configuration.js").PresetPlacementMode = null): void {
    this.database.prepare(`INSERT OR REPLACE INTO cat_config_model_relation
      (from_model_id,relation,seq,to_model_id,quantity,position_x_mm,position_y_mm,placement_mode,source)
      VALUES(?,?,?,?,?,?,?,?,'import')`).run(fromId,relation,seq,toId,quantity,x,y,placementMode);
  }

  clearExclusions(dimensionCodePrefix: string): void {
    this.database.prepare(`DELETE FROM cat_config_exclusion WHERE source='import'
      AND (container_value_id IN (
        SELECT v.id FROM cat_config_dimension_value v
        JOIN cat_config_dimension d ON d.id=v.dimension_id WHERE d.code LIKE ?
      ) OR content_value_id IN (
        SELECT v.id FROM cat_config_dimension_value v
        JOIN cat_config_dimension d ON d.id=v.dimension_id WHERE d.code LIKE ?
      ))`).run(`${dimensionCodePrefix}%`,`${dimensionCodePrefix}%`);
  }

  valueId(dimensionCode: string, valueCode: string): number | undefined {
    return (this.database.prepare(`SELECT v.id FROM cat_config_dimension_value v
      JOIN cat_config_dimension d ON d.id=v.dimension_id WHERE d.code=? AND v.code=?`)
      .get(dimensionCode,valueCode) as Id|undefined)?.id;
  }

  addExclusion(containerValueId: number, contentValueId: number): number {
    return this.database.prepare(`INSERT OR IGNORE INTO cat_config_exclusion
      (container_value_id,content_value_id,source) VALUES(?,?,'import')`)
      .run(containerValueId,contentValueId).changes;
  }

  clearRangeMembership(nodeCodePrefix: string): void {
    this.database.prepare(`DELETE FROM cat_range_node_model WHERE node_id IN
      (SELECT id FROM cat_range_node WHERE source='import' AND code LIKE ?)`)
      .run(`${nodeCodePrefix}%`);
  }

  upsertRangeNode(brandId: number, parentId: number | null, code: string, name: string,
    kind: string, order: number, importId: number, ref: string,
    sourceLevel: string, levelCode: string | null, navigable: boolean,
    designNavigable = false): number | undefined {
    return (this.database.prepare(`INSERT INTO cat_range_node(brand_id,parent_id,code,name,node_kind,
      sort_order,active,source,source_import_id,source_ref,source_level,level_code,navigable,design_navigable)
      VALUES(?,?,?,?,?,?,1,'import',?,?,?,?,?,?) ON CONFLICT(brand_id,code) DO UPDATE SET
        parent_id=excluded.parent_id,name=excluded.name,node_kind=excluded.node_kind,
        sort_order=excluded.sort_order,active=1,source_import_id=excluded.source_import_id,
        source_ref=excluded.source_ref,source_level=excluded.source_level,
        level_code=excluded.level_code,
        navigable=excluded.navigable,design_navigable=excluded.design_navigable
      WHERE cat_range_node.source='import' RETURNING id`)
      .get(brandId,parentId,code,name,kind,order,importId,ref,sourceLevel,
        levelCode,navigable?1:0,designNavigable?1:0) as Id|undefined)?.id;
  }

  addRangeModel(nodeId: number, modelId: number, order: number): number {
    return this.database.prepare(`INSERT OR IGNORE INTO cat_range_node_model(node_id,model_id,sort_order)
      VALUES(?,?,?)`).run(nodeId,modelId,order).changes;
  }

  deactivateAbsent(importId: number, brandId: number, modelPrefix: string,
    profilePrefix: string, dimensionPrefix: string, rangePrefix: string): void {
    this.database.prepare(`UPDATE cat_config_model SET active=0 WHERE source='import'
      AND brand_id=? AND code LIKE ? AND source_import_id<>?`)
      .run(brandId,`${modelPrefix}%`,importId);
    this.database.prepare(`UPDATE cat_phys_profile SET active=0 WHERE source='import'
      AND code LIKE ? AND source_import_id<>?`).run(`${profilePrefix}%`,importId);
    this.database.prepare(`UPDATE cat_config_dimension SET active=0 WHERE source='import'
      AND brand_id=? AND code LIKE ? AND source_import_id<>?`)
      .run(brandId,`${dimensionPrefix}%`,importId);
    this.database.prepare(`UPDATE cat_range_node SET active=0 WHERE source='import'
      AND brand_id=? AND code LIKE ? AND source_import_id<>?`)
      .run(brandId,`${rangePrefix}%`,importId);
  }

  refreshLinks(): void { refreshEngineeringLinks(this.database); }

  acceptSetCount(prefix: string): number {
    return this.database.prepare("SELECT COUNT(*) FROM cat_phys_accept_set WHERE code LIKE ?")
      .pluck().get(`${prefix}%`) as number;
  }
}
