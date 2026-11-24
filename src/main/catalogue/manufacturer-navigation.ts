import type Database from "better-sqlite3";
import type { ManufacturerArticle, ManufacturerNode, ManufacturerPosition } from "../../shared/catalogue.js";
import { BROWSE_SCOPE_SQL, NAVIGATION_SCOPE_SQL } from "./browse-scope.js";

type NodeRow=Omit<ManufacturerNode,"source"|"articleCount"|"packageCount"> & {
  source:string; articleCount:number; packageCount:number;
};

type NavigationCache = { localChanges:number; dataVersion:number;
  byBrand:Map<string,ManufacturerNode[]> };
const navigationCache=new WeakMap<Database.Database,NavigationCache>();

/**
 * A configuration model selectable in Catalogo without a primary catalogue article
 * (alias `m`): active, not structural, and containing at least one linked article or technical article reference.
 * Missing METEL links remain visible for the explicit Fuori catalogo add flow.
 * The sets are uncorrelated, so SQLite builds each once per query, with or without ANALYZE statistics.
 */
export const SELECTABLE_PACKAGE_SQL=`m.active=1 AND m.obsolete=0
  AND m.brand_id IN (SELECT id FROM cat_brand WHERE active=1)
  AND m.commercial_contribution='articles'
  AND m.model_kind NOT IN ('enclosure','support')
  AND m.id NOT IN (SELECT model_id FROM cat_config_model_entry)
  AND m.id IN (SELECT model_id FROM cat_config_model_article WHERE product_id IS NOT NULL OR length(ref_manufacturer_code)>0
    UNION SELECT pr.model_id FROM cat_config_rule pr JOIN cat_config_rule_effect pf ON pf.rule_id=pr.id
      WHERE pf.effect_kind='article' AND (pf.product_id IS NOT NULL OR length(pf.ref_manufacturer_code)>0))`;

/** Visibility is derived from real article and selectable-package membership, then propagated to ancestors. */
export function browseManufacturerNodes(db:Database.Database,brandMarchio?:string):ManufacturerNode[] {
  // Browse checks navigation visibility on every request. The aggregate query is
  // shared until this connection writes or another connection commits a change.
  const localChanges=db.prepare("SELECT total_changes()").pluck().get() as number;
  const dataVersion=db.pragma("data_version",{simple:true}) as number;
  // A rollback does not undo total_changes(), so never cache a transactional view.
  let cache=db.inTransaction?undefined:navigationCache.get(db);
  if(!db.inTransaction&&(!cache||cache.localChanges!==localChanges||cache.dataVersion!==dataVersion)){
    cache={localChanges,dataVersion,byBrand:new Map()};
    navigationCache.set(db,cache);
  }
  const key=brandMarchio??"";
  const cached=cache?.byBrand.get(key);
  if(cached)return cached.map(node=>({...node}));
  const rows=db.prepare(`${NAVIGATION_SCOPE_SQL}, article_count AS (
      SELECT root_id,COUNT(*) AS article_count FROM member GROUP BY root_id
    ), package_member AS (
      SELECT DISTINCT t.root_id,m.id AS model_id FROM tree t
      JOIN cat_range_node_model nm ON nm.node_id=t.id
      JOIN cat_config_model m ON m.id=nm.model_id WHERE ${SELECTABLE_PACKAGE_SQL}
    ), package_count AS (
      SELECT root_id,COUNT(*) AS package_count FROM package_member GROUP BY root_id
    ) SELECT n.id,n.parent_id AS parentId,n.name,n.code,
      n.node_kind AS kind,n.level_code AS levelCode,l.label AS levelLabel,
      b.metel_marchio AS brandMarchio,n.source,n.sort_order AS sortOrder,
      COALESCE(a.article_count,0) AS articleCount,
      COALESCE(k.package_count,0) AS packageCount
    FROM cat_range_node n JOIN cat_brand b ON b.id=n.brand_id AND b.active=1
    LEFT JOIN cat_range_level l ON l.code=n.level_code
    LEFT JOIN article_count a ON a.root_id=n.id
    LEFT JOIN package_count k ON k.root_id=n.id
    WHERE n.active=1 AND n.navigable=1
      AND (? IS NULL OR b.metel_marchio=?)
    ORDER BY b.metel_marchio,CASE WHEN n.source='metel' THEN 1 ELSE 0 END,
      n.sort_order,n.name,n.id`)
    .all(brandMarchio??null,brandMarchio??null) as NodeRow[];
  const byId=new Map(rows.map(row=>[row.id,row]));
  const visible=new Set<number>();
  for(const row of rows){
    if(row.articleCount+row.packageCount===0)continue;
    const chain:NodeRow[]=[];
    let current:NodeRow|undefined=row;
    while(current){
      chain.push(current);
      if(current.parentId===null)break;
      current=byId.get(current.parentId);
    }
    if(chain.at(-1)?.parentId!==null)continue;
    for(const ancestor of chain)visible.add(ancestor.id);
  }
  const result=rows.filter(row=>visible.has(row.id)).map(row=>({...row,
    source:row.source as ManufacturerNode["source"]}));
  cache?.byBrand.set(key,result);
  return result.map(node=>({...node}));
}

export function listManufacturerModels(db:Database.Database,nodeId:number) {
  if(!browseManufacturerNodes(db).some(node=>node.id===nodeId))return [];
  return db.prepare(`SELECT m.id,m.name,m.code,m.model_kind AS kind,
    b.metel_marchio AS brandMarchio
    FROM cat_range_node_model nm JOIN cat_config_model m ON m.id=nm.model_id
    JOIN cat_brand b ON b.id=m.brand_id AND b.active=1 JOIN cat_range_node n ON n.id=nm.node_id
    WHERE nm.node_id=? AND n.active=1 AND n.navigable=1
      AND m.active=1 AND m.obsolete=0 AND m.brand_id IN (SELECT id FROM cat_brand WHERE active=1)
      AND (EXISTS(SELECT 1 FROM cat_config_model_entry e WHERE e.model_id=m.id)
        OR (${SELECTABLE_PACKAGE_SQL}))
    ORDER BY nm.sort_order,m.name,m.id`).all(nodeId) as Array<{
      id:number;name:string;code:string;kind:string;brandMarchio:string}>;
}

export function listManufacturerArticles(db:Database.Database,
  request:{nodeId?:number;modelId?:number;offset?:number;limit?:number}):ManufacturerArticle[] {
  const offset=request.offset??0,limit=request.limit??100;
  type ArticleRow=Omit<ManufacturerArticle,"configurable"> & {configurable:number};
  const convert=(rows:ArticleRow[]):ManufacturerArticle[]=>rows.map(row=>({...row,
    configurable:row.configurable===1}));
  if(request.modelId!==undefined){
    const visible=new Set(browseManufacturerNodes(db).map(node=>node.id));
    const linked=db.prepare(`SELECT node_id AS nodeId FROM cat_range_node_model WHERE model_id=?`)
      .all(request.modelId) as Array<{nodeId:number}>;
    if(!linked.some(row=>visible.has(row.nodeId)))return [];
    return convert(db.prepare(`SELECT DISTINCT p.id,b.metel_marchio AS brandMarchio,
      p.manufacturer_code AS manufacturerCode,p.short_description AS description,
      1 AS configurable
      FROM cat_config_model_entry e JOIN cat_product p ON p.id=e.product_id
      JOIN cat_brand b ON b.id=p.brand_id AND b.active=1 AND p.import_removed=0 JOIN cat_config_model m ON m.id=e.model_id
      WHERE e.model_id=? AND m.active=1 AND m.obsolete=0 AND m.brand_id IN (SELECT id FROM cat_brand WHERE active=1)
        AND EXISTS(SELECT 1 FROM cat_range_node_model nm JOIN cat_range_node n
          ON n.id=nm.node_id WHERE nm.model_id=m.id AND n.active=1 AND n.navigable=1)
      ORDER BY p.manufacturer_code,b.metel_marchio,p.id LIMIT ? OFFSET ?`)
      .all(request.modelId,limit,offset) as ArticleRow[]);
  }
  if(request.nodeId===undefined||!browseManufacturerNodes(db).some(node=>node.id===request.nodeId))return [];
  return convert(db.prepare(`${BROWSE_SCOPE_SQL} SELECT p.id,b.metel_marchio AS brandMarchio,
      p.manufacturer_code AS manufacturerCode,p.short_description AS description,
      EXISTS(SELECT 1 FROM cat_config_model_entry e JOIN cat_config_model m
        ON m.id=e.model_id WHERE e.product_id=p.id AND m.active=1 AND m.obsolete=0 AND m.brand_id IN (SELECT id FROM cat_brand WHERE active=1))
        AS configurable
    FROM member JOIN cat_product p ON p.id=member.product_id
    JOIN cat_brand b ON b.id=p.brand_id AND b.active=1 AND p.import_removed=0 JOIN cat_range_node n ON n.id=@nodeId
    WHERE n.active=1 AND n.navigable=1
    ORDER BY p.manufacturer_code,b.metel_marchio,p.id LIMIT @limit OFFSET @offset`)
    .all({nodeId:request.nodeId,limit,offset}) as ArticleRow[]);
}

export function manufacturerPositions(db:Database.Database,productId:number):ManufacturerPosition[] {
  const visible=new Set(browseManufacturerNodes(db).map(node=>node.id));
  const engineering=db.prepare(`SELECT DISTINCT n.id AS nodeId,m.id AS modelId,'import' AS source
    FROM cat_config_model_entry e JOIN cat_config_model m ON m.id=e.model_id
    JOIN cat_range_node_model nm ON nm.model_id=m.id
    JOIN cat_range_node n ON n.id=nm.node_id
    WHERE e.product_id=? AND m.active=1 AND m.obsolete=0 AND m.brand_id IN (SELECT id FROM cat_brand WHERE active=1)
      AND n.active=1 AND n.navigable=1`).all(productId) as ManufacturerPosition[];
  const fst=db.prepare(`SELECT n.id AS nodeId,NULL AS modelId,'metel' AS source
    FROM cat_product p JOIN cat_range_node_metel_family nf
      ON nf.metel_family_id=p.statistical_family_id
    JOIN cat_range_node n ON n.id=nf.node_id
    WHERE p.id=? AND n.active=1 AND n.navigable=1`).all(productId) as ManufacturerPosition[];
  const validEngineering=engineering.filter(position=>visible.has(position.nodeId));
  const classified=db.prepare(`SELECT n.id AS nodeId,NULL AS modelId,'metel' AS source
    FROM cat_range_node_product np JOIN cat_range_node n ON n.id=np.node_id
    JOIN cat_product p ON p.id=np.product_id AND p.import_removed=0
    WHERE np.product_id=? AND n.active=1 AND n.navigable=1`).all(productId) as ManufacturerPosition[];
  return [...(validEngineering.length?validEngineering:fst.filter(position=>visible.has(position.nodeId))),
    ...classified.filter(position=>visible.has(position.nodeId))];
}
