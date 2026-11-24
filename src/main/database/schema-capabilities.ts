import type Database from "better-sqlite3";
const cache=new WeakMap<Database.Database,{version:number;tables:Map<string,Set<string>>}>();
/** Optional engineering columns remain readable in archived, read-only catalogues. */
export function hasDatabaseColumn(db:Database.Database,table:string,column:string):boolean{
 if(!/^[a-z_]+$/.test(table))throw new Error("Invalid catalogue table");
 const version=Number(db.pragma("schema_version",{simple:true}));let current=cache.get(db);
 if(!current||current.version!==version){current={version,tables:new Map()};cache.set(db,current);}
 if(!current.tables.has(table))current.tables.set(table,new Set((db.pragma(`table_info(${table})`)as{name:string}[]).map(row=>row.name)));
 return current.tables.get(table)!.has(column);
}
