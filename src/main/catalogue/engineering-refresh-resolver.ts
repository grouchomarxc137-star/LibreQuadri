import { isOutOfCatalogue } from "../../shared/out-of-catalogue.js";
import type Database from "better-sqlite3";
import type { ConfigurationResult } from "../../shared/configuration.js";
import type { ProjectConfiguredItem } from "../../shared/project.js";
import { getConfigurationModel } from "./configuration-queries.js";
import { resolveConfiguration } from "./configuration-resolver.js";
import { EngineeringDataStaleError } from "./engineering-readiness.js";
import { mapStableSelections } from "./stable-selections.js";

export type RefreshResolution = {ok:true;result:ConfigurationResult} | {ok:false;code:string};
const canonical=(rows:unknown[][])=>rows.map(row=>JSON.stringify(row)).sort();
export const bomRole=(roles:readonly string[])=>roles.includes("primary")?"primary":roles.includes("accessory")?"accessory":"component";

/** Read-only generic refresh resolver. Prices are ignored; only linked portable BOM identity is compared. */
export function resolveEngineeringRefresh(catalogue:Database.Database,item:ProjectConfiguredItem):RefreshResolution {
  const models=catalogue.prepare(`SELECT m.id,m.model_kind AS kind,m.active,m.obsolete FROM cat_config_model m
    JOIN cat_brand b ON b.id=m.brand_id WHERE b.metel_marchio=? AND m.code=?`)
    .all(item.modelBrandMarchio,item.modelCode) as {id:number;kind:string;active:number;obsolete:number}[];
  if(!models.length)return {ok:false,code:"model_unavailable"};
  if(models.length!==1)return {ok:false,code:"model_ambiguous"};
  const model=models[0]!;
  if(model.kind!==item.modelKind)return {ok:false,code:"model_kind_changed"};
  if(model.active!==1||model.obsolete===1)return {ok:false,code:"model_inactive"};
  try{
    const detail=getConfigurationModel(catalogue,model.id);
    const selected=mapStableSelections(detail,item.selections);
    if(!selected.ok)return {ok:false,code:selected.code};
    const result=resolveConfiguration(catalogue,{modelId:model.id,selectedOptionIds:selected.optionIds});
    if(result.commercialContribution!==item.commercialContribution)return {ok:false,code:"commercial_contribution_changed"};
    const incoming=canonical(result.model.axes.flatMap(axis=>axis.options.filter(option=>result.selectedOptionIds.includes(option.id))
      .map(option=>[axis.dimensionCode,option.valueCode])));
    if(JSON.stringify(incoming)!==JSON.stringify(canonical(item.selections.map(row=>[row.dimensionCode,row.valueCode]))))
      return {ok:false,code:"configuration_changed"};
    const outside=item.configStatus==="bom_incomplete"&&isOutOfCatalogue(result);
    if(result.status!=="complete"&&result.status!=="price_incomplete"&&!outside)return {ok:false,code:`resolution_${result.status}`};
    if(["device","support","enclosure"].includes(item.modelKind)&&(!result.physical||result.physical.kind!==item.modelKind))
      return {ok:false,code:"physical_data_unavailable"};
    if(result.context?.policy==="unknown")return {ok:false,code:"context_data_unavailable"};
    if(result.bom.some(row=>(row.productId===null||!row.linkedBrandMarchio||!row.linkedManufacturerCode)&&!outside)||
       item.bom.some(row=>!row.brandMarchio||!row.manufacturerCode)||
       item.commercialContribution==="articles"&&!item.bom.length)return {ok:false,code:"bom_unverifiable"};
    const before=canonical(item.bom.map(row=>[row.brandMarchio,row.manufacturerCode,row.quantityPerItem,row.role]));
    const after=canonical(result.bom.map(row=>[row.linkedBrandMarchio??row.brandMarchio,row.linkedManufacturerCode??row.manufacturerCode,row.quantity,bomRole(row.roles)]));
    if(JSON.stringify(before)!==JSON.stringify(after))return {ok:false,code:"bom_changed"};
    return {ok:true,result};
  }catch(error){
    if(error instanceof EngineeringDataStaleError)return {ok:false,code:"catalogue_stale"};
    throw error;
  }
}
