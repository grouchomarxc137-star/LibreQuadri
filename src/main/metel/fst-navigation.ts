import type Database from "better-sqlite3";
import { fstSegmentParser } from "./fst-parsers/index.js";

interface FamilyRow {
  id: number; issuer_id: number; brand_id: number; issuer_sigla: string;
  brand_marchio: string; code: string; description: string | null;
  delivery_id: number | null;
}

export interface FstSyncResult { nodes: number; protectedCollisions: string[] }

function synchronize(db: Database.Database, issuerId?: number): FstSyncResult {
  const families=db.prepare(`SELECT f.id,f.issuer_id,f.brand_id,i.metel_sigla AS issuer_sigla,
      b.metel_marchio AS brand_marchio,f.code,f.description,
      (SELECT MAX(d.id) FROM app_import_delivery d WHERE d.issuer_id=f.issuer_id
        AND d.became_current=1) AS delivery_id
    FROM cat_metel_family f JOIN cat_metel_issuer i ON i.id=f.issuer_id
    JOIN cat_brand b ON b.id=f.brand_id
    WHERE f.family_type='STATISTICA' AND (? IS NULL OR f.issuer_id=?)
      AND EXISTS(SELECT 1 FROM cat_product p WHERE p.statistical_family_id=f.id)
    ORDER BY f.issuer_id,f.brand_id,f.code`).all(issuerId??null,issuerId??null) as FamilyRow[];
  const issuers=issuerId===undefined?
    (db.prepare("SELECT id FROM cat_metel_issuer").pluck().all() as number[]):[issuerId];
  const deactivate=db.prepare(`UPDATE cat_range_node SET active=0 WHERE source='metel' AND code LIKE ?`);
  const clearLinks=db.prepare(`DELETE FROM cat_range_node_metel_family WHERE node_id IN
    (SELECT id FROM cat_range_node WHERE source='metel' AND code LIKE ?)`);
  for(const id of issuers){
    const prefix=`metel.${id}.%`;
    clearLinks.run(prefix);
    deactivate.run(prefix);
  }
  const upsert=db.prepare(`INSERT INTO cat_range_node
    (brand_id,parent_id,code,name,node_kind,navigable,level_code,source,
      source_delivery_id,source_ref,source_level)
    VALUES (@brandId,@parentId,@code,@name,@kind,1,@levelCode,'metel',
      @deliveryId,@sourceRef,@sourceLevel)
    ON CONFLICT(brand_id,code) DO UPDATE SET parent_id=excluded.parent_id,
      name=excluded.name,node_kind=excluded.node_kind,navigable=1,
      level_code=excluded.level_code,active=1,
      source_delivery_id=excluded.source_delivery_id,source_ref=excluded.source_ref,
      source_level=excluded.source_level
    WHERE cat_range_node.source='metel' RETURNING id`);
  const link=db.prepare(`INSERT OR IGNORE INTO cat_range_node_metel_family
    (node_id,metel_family_id) VALUES (?,?)`);
  const cached=new Map<string,number|null>();
  const collisions:string[]=[];
  const segmentNames=new Map<string,string>();
  const node=(row:FamilyRow,code:string,parentId:number|null,name:string,
    kind:string,levelCode:string|null,sourceLevel:string,sourceRef:string):number|null=>{
    const key=`${row.brand_id}:${code}`;
    if(cached.has(key))return cached.get(key)!;
    const result=upsert.get({brandId:row.brand_id,parentId,code,name,kind,levelCode,
      deliveryId:row.delivery_id,sourceLevel,sourceRef}) as {id:number}|undefined;
    if(!result)collisions.push(code);
    cached.set(key,result?.id??null);
    return result?.id??null;
  };
  for(const family of families){
    const root=node(family,`metel.${family.issuer_id}.${family.brand_id}.root`,null,
      `Famiglie statistiche · ${family.issuer_sigla} · ${family.brand_marchio}`,
      "section",null,"fst_root",`METEL ${family.issuer_sigla} FST`);
    if(root===null)continue;
    const segment=fstSegmentParser(family.issuer_sigla)?.(family.code,family.description);
    if(segment){
      const identity=`${family.issuer_id}:${family.brand_id}:${segment.code}`;
      const previous=segmentNames.get(identity);
      if(previous!==undefined&&previous!==segment.name)
        throw new Error(`Conflicting METEL FST segment labels for ${identity}: ${previous} / ${segment.name}`);
      segmentNames.set(identity,segment.name);
    }
    const parent=segment?node(family,
      `metel.${family.issuer_id}.${family.brand_id}.segment.${segment.code}`,
      root,segment.name,"level","segmento","fst_segment",
      `METEL ${family.issuer_sigla} FST segment ${segment.code}`):root;
    if(parent===null)continue;
    const leaf=node(family,`metel.${family.issuer_id}.${family.brand_id}.fst.${family.code}`,
      parent,family.description||family.code,"group","famiglia_statistica","fst_family",
      `METEL ${family.issuer_sigla} FST ${family.code}`);
    if(leaf!==null)link.run(leaf,family.id);
  }
  return {nodes:cached.size,protectedCollisions:collisions};
}

/** Replaces one issuer's derived tree atomically; safe to repeat after a delivery update. */
export function synchronizeFstNavigation(db: Database.Database, issuerId?: number): FstSyncResult {
  return db.inTransaction?synchronize(db,issuerId):db.transaction(()=>synchronize(db,issuerId))();
}
