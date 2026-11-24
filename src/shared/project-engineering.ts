export type ProjectEngineeringState = "current_generation" | "other_generation" | "older_adapter" | "newer_adapter" |
  "catalogue_unavailable" | "catalogue_stale" | "unknown_source" | "manual" | "unknown";
export interface ProjectEngineeringStatus {
  items:{itemUuid:string;modelCode:string;state:ProjectEngineeringState}[];
  counts:Record<ProjectEngineeringState,number>;
}
export interface EngineeringIssue { nodeUuid:string|null;code:string;message:string }
export interface EngineeringItemPlan {
  itemUuid:string;modelCode:string;modelName:string;state:ProjectEngineeringState;
  action:"unchanged"|"verify"|"refresh"|"blocked";
  changes:string[];blockers:string[];
  labelChanges:{field:string;before:string|null;after:string|null}[];
}
export interface ProjectEngineeringPlan {
  token:string;
  items:EngineeringItemPlan[];
  counts:Record<EngineeringItemPlan["action"],number>;
  blockers:string[];
  remainingIssues:EngineeringIssue[];
  resolvedIssues:EngineeringIssue[];
  newIssues:EngineeringIssue[];
  geometryChanges:{nodeUuid:string;before:{xMm:number|null;yMm:number|null};after:{xMm:number|null;yMm:number|null}}[];
  canApply:boolean;
}
