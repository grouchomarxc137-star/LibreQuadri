import { readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

export interface RangeLevelSeed { code:string; label:string; sortOrder:number }
export interface RangeSourceLevelSeed {
  adapterCode:string;systemId:number;sourceLevel:string;
  levelCode:string|null;catalogueNavigable:boolean;
}
/** Project-maintained grouping of one source level's nodes, identified by source ID; names are checked against the source. */
export interface RangeGroupSeed {
  adapterCode:string;systemId:number;sourceLevel:string;
  code:string;name:string;sortOrder:number;
  members:Array<{name:string;sourceIds:number[]}>;
}
export interface RangeNavigationSeed {
  levels:RangeLevelSeed[];mappings:RangeSourceLevelSeed[];groups:RangeGroupSeed[];
}
export interface RangeSourceLevel {
  levelCode:string|null;catalogueNavigable:boolean;
}

export function loadRangeNavigationSeed(folder=path.resolve("db","seed")):RangeNavigationSeed {
  const value=JSON.parse(readFileSync(path.join(folder,"range-navigation.json"),"utf8")) as RangeNavigationSeed;
  if(!value||!Array.isArray(value.levels)||!Array.isArray(value.mappings)||!Array.isArray(value.groups))
    throw new Error("Invalid range navigation seed");
  const levels=new Set<string>();
  for(const row of value.levels){
    if(!/^[a-z][a-z0-9_]*$/.test(row.code)||!row.label?.trim()||
      !Number.isSafeInteger(row.sortOrder)||levels.has(row.code))
      throw new Error(`Invalid range level ${String(row.code)}`);
    levels.add(row.code);
  }
  const keys=new Set<string>();
  for(const row of value.mappings){
    const key=`${row.adapterCode}:${row.systemId}:${row.sourceLevel}`;
    if(!/^[a-z][a-z0-9_]*$/.test(row.adapterCode)||!Number.isSafeInteger(row.systemId)||
      row.systemId<=0||!row.sourceLevel?.trim()||typeof row.catalogueNavigable!=="boolean"||
      (row.levelCode!==null&&!levels.has(row.levelCode))||keys.has(key))
      throw new Error(`Invalid source range level ${key}`);
    keys.add(key);
  }
  const groupCodes=new Set<string>(),memberNames=new Set<string>(),memberIds=new Set<string>();
  for(const row of value.groups){
    const scope=`${row.adapterCode}:${row.systemId}:${row.sourceLevel}`;
    if(!keys.has(scope)||!/^[a-z][a-z0-9_]*$/.test(row.code)||!row.name?.trim()||
      !Number.isSafeInteger(row.sortOrder)||!Array.isArray(row.members)||!row.members.length||
      groupCodes.has(`${row.adapterCode}:${row.systemId}:${row.code}`))
      throw new Error(`Invalid range group ${scope}:${String(row.code)}`);
    groupCodes.add(`${row.adapterCode}:${row.systemId}:${row.code}`);
    for(const member of row.members){
      if(!member.name?.trim()||memberNames.has(`${scope}:${member.name}`)||
        !Array.isArray(member.sourceIds)||!member.sourceIds.length)
        throw new Error(`Invalid range group member ${scope}:${String(member.name)}`);
      memberNames.add(`${scope}:${member.name}`);
      for(const id of member.sourceIds){
        if(!Number.isSafeInteger(id)||id<=0||memberIds.has(`${scope}:${id}`))
          throw new Error(`Invalid range group source ID ${scope}:${String(id)}`);
        memberIds.add(`${scope}:${id}`);
      }
    }
  }
  return value;
}

export function synchronizeRangeNavigationSeed(db:Database.Database,seed=loadRangeNavigationSeed()):void {
  const level=db.prepare(`INSERT INTO cat_range_level(code,label,sort_order,source)
    VALUES(?,?,?,'seed') ON CONFLICT(code) DO UPDATE SET label=excluded.label,
      sort_order=excluded.sort_order WHERE cat_range_level.source='seed'`);
  const map=db.prepare(`INSERT INTO cat_range_source_level_map
    (adapter_code,system_id,source_level,level_code,catalogue_navigable,source)
    VALUES(?,?,?,?,?,'seed') ON CONFLICT(adapter_code,system_id,source_level) DO UPDATE SET
      level_code=excluded.level_code,catalogue_navigable=excluded.catalogue_navigable
      WHERE cat_range_source_level_map.source='seed'`);
  const run=()=>{
    for(const row of seed.levels)level.run(row.code,row.label,row.sortOrder);
    for(const row of seed.mappings)map.run(row.adapterCode,row.systemId,row.sourceLevel,
      row.levelCode,row.catalogueNavigable?1:0);
  };
  if(db.inTransaction)run();else db.transaction(run)();
}

export function sourceLevelMap(db:Database.Database,adapterCode:string):Map<string,RangeSourceLevel> {
  const rows=db.prepare(`SELECT system_id AS systemId,source_level AS sourceLevel,
    level_code AS levelCode,catalogue_navigable AS catalogueNavigable
    FROM cat_range_source_level_map WHERE adapter_code=?`).all(adapterCode) as Array<{
      systemId:number;sourceLevel:string;levelCode:string|null;catalogueNavigable:number}>;
  return new Map(rows.map(row=>[`${row.systemId}:${row.sourceLevel}`,
    {levelCode:row.levelCode,catalogueNavigable:row.catalogueNavigable===1}]));
}
