import {hasDatabaseColumn} from "../database/schema-capabilities.js";
import {parseMountingFacts} from "../../shared/mounting.js";
import type Database from "better-sqlite3";
import { assertEngineeringModelCurrent, assertEngineeringModelsCurrent } from "./engineering-readiness.js";
import type {
  ConfigAxis, ConfigModelDetail, ConfigModelSummary, ConfigOption, ProductModelEntry, RangeNode,
  PhysicalResult, ModelEngineeringContext,
} from "../../shared/configuration.js";

type ModelRow = Omit<ConfigModelSummary, "active" | "obsolete"> & {
  active: number; obsolete: number; definitionFingerprint: string;
  baseProfileId: number | null; maxInsertQty: number | null; sourceRef: string | null;
};
const MODEL_SELECT = `SELECT m.id,m.code,m.name,m.model_kind AS kind,b.metel_marchio AS brandMarchio,
  m.active,m.obsolete,m.commercial_contribution AS commercialContribution,m.definition_fingerprint AS definitionFingerprint,
  m.base_profile_id AS baseProfileId,m.max_insert_qty AS maxInsertQty,m.source_ref AS sourceRef
  FROM cat_config_model m JOIN cat_brand b ON b.id=m.brand_id AND b.active=1`;
function summary(row: ModelRow): ConfigModelSummary {
  return {id:row.id,code:row.code,name:row.name,kind:row.kind,
    brandMarchio:row.brandMarchio,active:row.active===1,obsolete:row.obsolete===1,
    commercialContribution:row.commercialContribution};
}

/** Lightweight summaries for an already validated engineering discovery; no axes or BOM queries. */
export function configurationModelSummaries(db:Database.Database,ids:readonly number[]):ConfigModelSummary[] {
  const rows=db.prepare(`${MODEL_SELECT} WHERE m.id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(ids)) as ModelRow[];
  const byId=new Map(rows.map(row=>[row.id,summary(row)]));
  return ids.flatMap(id=>byId.has(id)?[byId.get(id)!]:[]);
}

// Read-only tools may inspect an older catalogue without running migrations. Such
// catalogues have no permissions: retain the conservative empty-BOM rejection.
const rulePermissionSchemas=new WeakMap<Database.Database,{version:number;available:boolean}>();
function emptyBomPermissions(db:Database.Database,modelId:number):number[] {
  const version=db.pragma("schema_version",{simple:true}) as number;
  let schema=rulePermissionSchemas.get(db);
  if(!schema||schema.version!==version){
    schema={version,available:(db.pragma("table_info(cat_config_rule)") as {name:string}[]).some(column=>column.name==="empty_bom_allowed")};
    rulePermissionSchemas.set(db,schema);
  }
  return schema.available?db.prepare("SELECT id FROM cat_config_rule WHERE model_id=? AND empty_bom_allowed=1 ORDER BY id").pluck().all(modelId) as number[]:[];
}

export function browseRangeNodes(db: Database.Database, brandMarchio?: string): RangeNode[] {
  const rows=db.prepare(`SELECT n.id,b.metel_marchio AS brandMarchio,n.parent_id AS parentId,
      n.code,n.name,n.node_kind AS kind,n.sort_order AS sortOrder,n.active,
      EXISTS(SELECT 1 FROM cat_range_node_model nm JOIN cat_config_model m
        ON m.id=nm.model_id WHERE nm.node_id=n.id AND m.active=1 AND m.obsolete=0)
        AS hasActiveModel
    FROM cat_range_node n JOIN cat_brand b ON b.id=n.brand_id AND b.active=1
    WHERE n.source IN ('import','manual') AND n.active=1
      AND (? IS NULL OR b.metel_marchio=?)
    ORDER BY b.metel_marchio,n.sort_order,n.name,n.id`)
    .all(brandMarchio??null,brandMarchio??null) as Array<RangeNode & {hasActiveModel:number}>;
  const byId=new Map(rows.map(row=>[row.id,row]));
  const visible=new Set<number>();
  for(const row of rows){
    if(!row.hasActiveModel)continue;
    let current:typeof row|undefined=row;
    while(current&&!visible.has(current.id)){
      visible.add(current.id);
      current=current.parentId===null?undefined:byId.get(current.parentId);
    }
  }
  return rows.filter(row=>visible.has(row.id)).map(row=>({id:row.id,
    brandMarchio:row.brandMarchio,parentId:row.parentId,code:row.code,name:row.name,
    kind:row.kind,sortOrder:row.sortOrder,active:true}));
}
export function listNodeModels(db: Database.Database, nodeId:number): ConfigModelSummary[] {
  const rows=db.prepare(`${MODEL_SELECT} JOIN cat_range_node_model nm ON nm.model_id=m.id
    WHERE nm.node_id=? AND nm.node_id IN (SELECT n.id FROM cat_range_node n JOIN cat_brand b ON b.id=n.brand_id WHERE b.active=1)
    ORDER BY nm.sort_order,m.name,m.id`).all(nodeId) as ModelRow[];
  assertEngineeringModelsCurrent(db,rows.map(row=>row.id));
  return rows.map(summary);
}
export function listProductModels(db: Database.Database, productId:number): ProductModelEntry[] {
  const rows=db.prepare(`SELECT m.id,m.code,m.name,m.model_kind AS kind,b.metel_marchio AS brandMarchio,
    m.active,m.obsolete,m.commercial_contribution AS commercialContribution,m.definition_fingerprint AS definitionFingerprint,
    m.base_profile_id AS baseProfileId,m.max_insert_qty AS maxInsertQty,
    e.option_id AS preselectedOptionId
    FROM cat_config_model m JOIN cat_brand b ON b.id=m.brand_id AND b.active=1
    JOIN cat_config_model_entry e ON e.model_id=m.id
    WHERE e.product_id=? AND e.product_id IN (SELECT p.id FROM cat_product p JOIN cat_brand b ON b.id=p.brand_id WHERE b.active=1 AND p.import_removed=0) ORDER BY m.name,m.id`).all(productId) as Array<ModelRow & {preselectedOptionId:number|null}>;
  assertEngineeringModelsCurrent(db,rows.map(row=>row.id));
  return rows.map(row=>({...summary(row),preselectedOptionId:row.preselectedOptionId}));
}

export function findConfigurationModel(db: Database.Database, brandMarchio: string,
  modelCode: string): ConfigModelSummary | null {
  const row = db.prepare(`${MODEL_SELECT} WHERE b.metel_marchio=? AND m.code=?`)
    .get(brandMarchio, modelCode) as ModelRow | undefined;
  if(row)assertEngineeringModelCurrent(db,row.id);
  return row ? summary(row) : null;
}

export function getConfigurationModel(db: Database.Database, modelId:number): ConfigModelDetail {
  assertEngineeringModelCurrent(db,modelId);
  const row=db.prepare(`${MODEL_SELECT} WHERE m.id=?`).get(modelId) as ModelRow|undefined;
  if(!row)throw new Error("Configuration model not found");
  const axes=db.prepare(`SELECT a.id,d.code AS dimensionCode,a.label,a.sort_order AS sortOrder,
    a.visibility,a.requirement,a.binding,a.editable_when_placed AS editableWhenPlaced,
    a.selects_primary AS selectsPrimary FROM cat_config_axis a
    JOIN cat_config_dimension d ON d.id=a.dimension_id WHERE a.model_id=?
    ORDER BY a.sort_order,a.id`).all(modelId) as Array<Omit<ConfigAxis,"options"|"editableWhenPlaced"|"selectsPrimary"> & {
      editableWhenPlaced:number; selectsPrimary:number}>;
  const options=db.prepare(`SELECT o.id,o.axis_id AS axisId,o.value_id AS valueId,
    v.code AS valueCode,v.label,o.parent_option_id AS parentOptionId,
    o.is_default AS isDefault,o.visible,
    CASE WHEN o.active=1 AND v.active=1 AND d.active=1 THEN 1 ELSE 0 END AS active,
    o.sort_order AS sortOrder
    FROM cat_config_option o JOIN cat_config_axis a ON a.id=o.axis_id
    JOIN cat_config_dimension d ON d.id=a.dimension_id
    JOIN cat_config_dimension_value v ON v.id=o.value_id WHERE a.model_id=?
    ORDER BY a.sort_order,o.sort_order,o.id`).all(modelId) as Array<Omit<ConfigOption,"isDefault"|"visible"|"active"> & {
      isDefault:number; visible:number; active:number}>;
  const byAxis=new Map<number,ConfigOption[]>();
  for(const option of options){
    const list=byAxis.get(option.axisId)??[];
    list.push({...option,isDefault:option.isDefault===1,visible:option.visible===1,active:option.active===1});
    byAxis.set(option.axisId,list);
  }
  const budgets=db.prepare(`SELECT code,label,max_amount AS maxAmount FROM cat_config_budget
    WHERE model_id=? ORDER BY code`).all(modelId) as ConfigModelDetail["budgets"];
  const relations=db.prepare(`SELECT r.seq,r.placement_mode AS placementMode,r.relation,r.to_model_id AS toModelId,m.code AS toModelCode,
    r.quantity,r.position_x_mm AS positionXMm,r.position_y_mm AS positionYMm
    FROM cat_config_model_relation r JOIN cat_config_model m ON m.id=r.to_model_id
    WHERE r.from_model_id=? ORDER BY r.relation,r.seq`).all(modelId) as ConfigModelDetail["relations"];
  return {...summary(row),definitionFingerprint:row.definitionFingerprint,
    sourceRef:row.sourceRef,baseProfileId:row.baseProfileId,maxInsertQty:row.maxInsertQty,
    ...(row.kind==="support"&&db.prepare(`SELECT 1 FROM cat_config_model_relation
      WHERE to_model_id=? AND relation='preset_child' AND placement_mode='factory_fixed' LIMIT 1`)
      .get(modelId)?{factoryPresetOnly:true}:{}),
    emptyBomRuleIds:emptyBomPermissions(db,modelId),
    axes:axes.map(axis=>({...axis,editableWhenPlaced:axis.editableWhenPlaced===1,
      selectsPrimary:axis.selectsPrimary===1,options:byAxis.get(axis.id)??[]})),budgets,relations};
}

/** Context policy and active context codes of an enclosure (provided) or support (accepted); null for other kinds. */
export function getModelEngineeringContext(db:Database.Database,modelId:number,kind:string):ModelEngineeringContext|null {
  if(kind!=="enclosure"&&kind!=="support")return null;
  const role=kind==="enclosure"?"provides":"accepts";
  const policy=db.prepare("SELECT context_policy FROM cat_config_model WHERE id=?").pluck().get(modelId) as
    ModelEngineeringContext["policy"]|undefined;
  if(policy===undefined)return null;
  const codes=db.prepare(`SELECT c.code FROM cat_config_model_context link
    JOIN cat_config_context c ON c.id=link.context_id AND c.active=1
    WHERE link.model_id=? AND link.role=? ORDER BY c.code`).pluck().all(modelId,role) as string[];
  return {policy,role,codes};
}

export function getPhysicalProfile(db:Database.Database, profileId:number):PhysicalResult|null {
  const profile=db.prepare(`SELECT p.id,p.code,p.name,p.profile_kind AS kind,p.profile_key AS profileKey,${hasDatabaseColumn(db,"cat_phys_profile","mounting_json")?"p.mounting_json":"NULL"} AS mountingJson,
    p.depth_mm AS depthMm,p.outer_depth_mm AS outerDepthMm,p.usable_depth_mm AS usableDepthMm,
    c.id AS classId,c.code AS classCode,c.name AS className
    FROM cat_phys_profile p JOIN cat_phys_class c ON c.id=p.fit_class_id WHERE p.id=? AND p.active=1`)
    .get(profileId) as {id:number;code:string;name:string;kind:string;profileKey:number|null;
      depthMm:number|null;outerDepthMm:number|null;usableDepthMm:number|null;
      classId:number;classCode:string;className:string;mountingJson:string|null}|undefined;
  if(!profile)return null;
  const demands=db.prepare(`SELECT d.capacity_kind_code AS capacityKindCode,d.amount,
    k.unit_label AS unitLabel,k.display_divisor AS displayDivisor,k.nominal_pitch_mm AS nominalPitchMm
    FROM cat_phys_profile_demand d JOIN cat_capacity_kind k ON k.code=d.capacity_kind_code
    WHERE d.profile_id=? ORDER BY d.capacity_kind_code`).all(profileId) as PhysicalResult["demands"];
  const views=db.prepare(`SELECT view_code AS code,width_mm AS widthMm,height_mm AS heightMm,
    insert_dx_mm AS insertDxMm,insert_dy_mm AS insertDyMm,symbol_kind AS symbolKind,asset_key AS assetKey
    FROM cat_phys_view WHERE profile_id=? ORDER BY view_code`).all(profileId) as PhysicalResult["views"];
  const zones=db.prepare(`SELECT z.zone_no AS zoneNo,z.layout,z.capacity_kind_code AS capacityKindCode,${hasDatabaseColumn(db,"cat_phys_zone","mounting_json")?"z.mounting_json":"NULL"} AS mountingJson,
    k.unit_label AS capacityKindLabel,k.display_divisor AS displayDivisor,
    k.nominal_pitch_mm AS nominalPitchMm,
    capacity_amount AS capacityAmount,origin_x_mm AS originXMm,origin_y_mm AS originYMm,
    length_mm AS lengthMm,breadth_mm AS breadthMm,direction,pitch_mm AS pitchMm,
    required_view_code AS requiredViewCode FROM cat_phys_zone z
    LEFT JOIN cat_capacity_kind k ON k.code=z.capacity_kind_code
    WHERE z.profile_id=? ORDER BY z.zone_no`)
    .all(profileId) as Array<PhysicalResult["zones"][number]&{mountingJson:string|null}>;
  const mountedZones=zones.map(({mountingJson,...zone})=>({...zone,...(mountingJson?{mounting:parseMountingFacts(mountingJson)}:{})}));
  const slots=db.prepare(`SELECT zone_no AS zoneNo,slot_no AS slotNo,x_mm AS xMm,y_mm AS yMm
    FROM cat_phys_zone_slot WHERE profile_id=? ORDER BY zone_no,slot_no`).all(profileId) as PhysicalResult["slots"];
  const constraints=db.prepare(`SELECT c.relation,s.code AS acceptSetCode,k.code AS classCode
    FROM cat_phys_constraint c JOIN cat_phys_accept_set s ON s.id=c.accept_set_id
    LEFT JOIN cat_phys_accept_set_member sm ON sm.set_id=s.id
    LEFT JOIN cat_phys_class k ON k.id=sm.class_id WHERE c.profile_id=?
    ORDER BY c.relation,s.code,k.code`).all(profileId) as Array<{relation:string;acceptSetCode:string;classCode:string|null}>;
  const grouped=new Map<string,PhysicalResult["constraints"][number]>();
  for(const row of constraints){
    const key=`${row.relation}\0${row.acceptSetCode}`;
    let item=grouped.get(key);
    if(!item){item={relation:row.relation,acceptSetCode:row.acceptSetCode,classCodes:[]};grouped.set(key,item);}
    if(row.classCode)item.classCodes.push(row.classCode);
  }
  return {...(profile.mountingJson?{mounting:parseMountingFacts(profile.mountingJson)}:{}),id:profile.id,code:profile.code,name:profile.name,kind:profile.kind,
    profileKey:profile.profileKey,fitClass:{id:profile.classId,code:profile.classCode,name:profile.className},
    depthMm:profile.depthMm,outerDepthMm:profile.outerDepthMm,usableDepthMm:profile.usableDepthMm,
    demands,views,zones:mountedZones,slots,constraints:[...grouped.values()]};
}
