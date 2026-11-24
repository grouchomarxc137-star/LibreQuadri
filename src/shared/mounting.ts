/** Distances use the rail reference, independently of front artwork bounds or catalogue brand. */
export interface MountingFacts {
 system:string;basis:"source_rule"|"dimensions";evidence:string;
 installationDepthMm:number|null;apertureMm:number|null;aboveRailMm:number|null;belowRailMm:number|null;
}
export type MountingCheck={ok:true;qualified:boolean}|{ok:false;code:"mounting_data_unavailable"|"mounting_system_mismatch"|"mounting_clearance"};
export function parseMountingFacts(value:unknown):MountingFacts|null{
 if(value===null||value===undefined)return null;
 const row=typeof value==="string"?JSON.parse(value):value;
 if(!row||typeof row!=="object"||Array.isArray(row)||typeof row.system!=="string"||!row.system.trim()||row.system.length>100||
  !["source_rule","dimensions"].includes(row.basis)||typeof row.evidence!=="string"||!row.evidence.trim()||row.evidence.length>2000||
  ["installationDepthMm","apertureMm","aboveRailMm","belowRailMm"].some(k=>row[k]!==null&&(typeof row[k]!=="number"||!Number.isFinite(row[k])||row[k]<0||row[k]>100000)))throw new Error("Invalid mounting facts");
 return {system:row.system,basis:row.basis,evidence:row.evidence,installationDepthMm:row.installationDepthMm,apertureMm:row.apertureMm,aboveRailMm:row.aboveRailMm,belowRailMm:row.belowRailMm};
}
/** A source's own class rules remain authoritative; cross-brand placement requires complete dimensions. */
export function checkMountingFit(requirement:MountingFacts|null|undefined,capability:MountingFacts|null|undefined,mixedBrands:boolean):MountingCheck{
 if(!requirement&&!capability)return {ok:true,qualified:false}; // Legacy snapshots retain their existing class checks.
 if(!requirement||!capability)return mixedBrands?{ok:false,code:"mounting_data_unavailable"}:{ok:true,qualified:false};
 if(requirement.system!==capability.system)return {ok:false,code:"mounting_system_mismatch"};
 const dimensions=["installationDepthMm","apertureMm","aboveRailMm","belowRailMm"]as const;
 const complete=requirement.basis==="dimensions"&&capability.basis==="dimensions"&&dimensions.every(k=>requirement[k]!==null&&capability[k]!==null)&&requirement.installationDepthMm!>0&&requirement.apertureMm!>0&&capability.installationDepthMm!>0&&capability.apertureMm!>0&&requirement.aboveRailMm!+requirement.belowRailMm!>0&&capability.aboveRailMm!+capability.belowRailMm!>0;
 if(mixedBrands&&!complete)return {ok:false,code:"mounting_data_unavailable"};
 for(const k of dimensions)if(requirement[k]!==null&&capability[k]!==null&&requirement[k]!>capability[k]!+1e-8)return {ok:false,code:"mounting_clearance"};
 return {ok:true,qualified:complete};
}
