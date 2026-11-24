import type Database from "better-sqlite3";
import {parseMountingFacts,type MountingFacts} from "../../shared/mounting.js";
/** Legacy read-only guard fixtures and pre-format-11 snapshots have no mounting columns. */
export function projectMountingCapabilities(db:Database.Database,itemId:number):Array<MountingFacts|null>{
 const columns=db.pragma("table_info(prj_item_zone)") as {name:string}[];
 if(!columns.some(column=>column.name==="mounting_json"))return [];
 return (db.prepare("SELECT mounting_json AS facts FROM prj_item_zone WHERE item_id=?").all(itemId)as{facts:string|null}[]).map(row=>parseMountingFacts(row.facts));
}
