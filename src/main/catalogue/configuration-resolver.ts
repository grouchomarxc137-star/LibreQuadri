import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  BomArticle, ConfigurationIssue, ConfigurationRequest, ConfigurationResult, ConfigOption,
} from "../../shared/configuration.js";
import { modelEngineeringProvenance } from "./engineering-readiness.js";
import { getConfigurationModel, getModelEngineeringContext, getPhysicalProfile } from "./configuration-queries.js";

export const CONFIGURATION_RESOLVER_VERSION = "1";

interface RuleRow { id:number; optionId:number|null }
interface EffectRow {
  ruleId:number; seq:number; effectKind:string; productId:number|null;
  refBrandMarchio:string|null; refManufacturerCode:string|null; quantity:number|null;
  articleRole:string|null; intValue:number|null; capacityKindCode:string|null;
  budgetCode:string|null; profileId:number|null;
}
interface ArticleRow {productId:number|null;refBrandMarchio:string;
  refManufacturerCode:string;quantity:number;role:string}
interface PricedProduct {description:string|null;unitPriceE4:number|null;currency:string|null;
  priceIssuerSigla:string|null;priceListinoNumber:string|null;priceValidFrom:string|null;
  priceMultiplierOriginal:number|null;linkedBrandMarchio:string;linkedManufacturerCode:string}

interface DecimalQuantity { numerator:bigint; scale:bigint }
function decimalQuantity(value:number):DecimalQuantity {
  if(!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER)
    throw new Error("Invalid BOM quantity");
  const match=/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value.toString());
  if(!match)throw new Error("Invalid BOM quantity");
  const digits=BigInt(match[1]!+(match[2]??""));
  const places=(match[2]??"").length-Number(match[3]??0);
  return places>=0?{numerator:digits,scale:10n**BigInt(places)}
    :{numerator:digits*10n**BigInt(-places),scale:1n};
}
function addQuantity(a:DecimalQuantity,b:DecimalQuantity):DecimalQuantity {
  const scale=a.scale>b.scale?a.scale:b.scale;
  return {numerator:a.numerator*(scale/a.scale)+b.numerator*(scale/b.scale),scale};
}
/** Multiplication must produce an exact integer _e4 amount. No implicit monetary rounding. */
function exactRowE4(unit:number,quantity:DecimalQuantity):number|null {
  if(!Number.isSafeInteger(unit))return null;
  const total=BigInt(unit)*quantity.numerator;
  if(total%quantity.scale!==0n)return null;
  const value=total/quantity.scale;
  const limit=BigInt(Number.MAX_SAFE_INTEGER);
  return value<=limit&&value>=-limit?Number(value):null;
}

export function resolveConfiguration(db:Database.Database,request:ConfigurationRequest):ConfigurationResult {
  const model=getConfigurationModel(db,request.modelId);
  const issues:ConfigurationIssue[]=[];
  const warningCodes=new Set(["no_profile","unresolved_article","missing_price",
    "inexact_price","unsupported_currency"]);
  const invalid=(code:string,message:string,optionId?:number,axisId?:number)=>{
    if(issues.some(issue=>issue.code===code&&issue.message===message&&
      issue.optionId===optionId&&issue.axisId===axisId))return;
    issues.push({severity:warningCodes.has(code)?"warning":"error",code,message,
      ...(optionId===undefined?{}:{optionId}),...(axisId===undefined?{}:{axisId})});
  };
  const options=new Map<number,ConfigOption>();
  for(const axis of model.axes)for(const option of axis.options)options.set(option.id,option);
  const requested=new Set<number>();
  for(const id of request.selectedOptionIds){
    if(requested.has(id))invalid("duplicate_option",`Option ${id} is repeated`,id);
    requested.add(id);
    if(!options.has(id))invalid("foreign_option",`Option ${id} does not belong to this model`,id);
  }
  if(request.productId!==undefined){
    const entry=db.prepare(`SELECT option_id AS optionId FROM cat_config_model_entry
      WHERE product_id=? AND model_id=?`).get(request.productId,model.id) as {optionId:number|null}|undefined;
    if(!entry)invalid("invalid_entry","Product does not enter this model");
    else if(entry.optionId!==null){
      const pre=options.get(entry.optionId);
      if(!pre)invalid("invalid_entry","Entry option does not belong to this model",entry.optionId);
      else if(![...requested].some(id=>options.get(id)?.axisId===pre.axisId))requested.add(entry.optionId);
    }
  }
  if(!model.active)invalid("inactive_model","Model is inactive");
  const selected=new Set<number>();
  const defaulted:number[]=[];
  // Iterate to allow a dependent axis to precede its parent in source ordering.
  for(let pass=0;pass<=model.axes.length;pass++){
    let changed=false;
    for(const axis of model.axes){
      if([...selected].some(id=>options.get(id)?.axisId===axis.id))continue;
      const explicit=axis.options.filter(o=>requested.has(o.id));
      if(explicit.length>1){invalid("multiple_on_axis",`Multiple choices on axis ${axis.label}`,undefined,axis.id);continue;}
      const candidates=axis.options.filter(o=>o.active&&
        (o.parentOptionId===null||selected.has(o.parentOptionId)));
      if(explicit.length===1){
        const choice=explicit[0]!;
        if(candidates.includes(choice)){selected.add(choice.id);changed=true;}
        continue;
      }
      const defaults=candidates.filter(o=>o.isDefault);
      if(defaults.length>1){invalid("ambiguous_default",`Multiple defaults on axis ${axis.label}`,undefined,axis.id);continue;}
      if(defaults.length===1){selected.add(defaults[0]!.id);defaulted.push(defaults[0]!.id);changed=true;}
    }
    if(!changed)break;
  }
  for(const id of requested){
    const option=options.get(id);
    if(option&&!selected.has(id))invalid("unavailable_option",`Option ${id} is inactive or its parent is not selected`,id,option.axisId);
  }
  for(const axis of model.axes){
    if(axis.requirement==="required"&&!axis.options.some(o=>selected.has(o.id)))
      invalid("missing_required",`Required axis ${axis.label} has no selection`,undefined,axis.id);
    if(axis.binding==="inherit_container")
      invalid("unresolved_binding",`Container inheritance is not established for axis ${axis.label}`,undefined,axis.id);
  }
  const rules=db.prepare(`SELECT r.id,c.option_id AS optionId FROM cat_config_rule r
    LEFT JOIN cat_config_rule_condition c ON c.rule_id=r.id
    WHERE r.model_id=? ORDER BY r.seq,r.id,c.option_id`).all(model.id) as RuleRow[];
  const conditions=new Map<number,number[]>();
  for(const row of rules){const list=conditions.get(row.id)??[];
    if(row.optionId!==null)list.push(row.optionId);conditions.set(row.id,list);}
  const matchingRuleIds=[...conditions].filter(([,ids])=>ids.every(id=>selected.has(id))).map(([id])=>id);
  const effects=db.prepare(`SELECT e.rule_id AS ruleId,e.seq,e.effect_kind AS effectKind,
    e.product_id AS productId,e.ref_brand_marchio AS refBrandMarchio,
    e.ref_manufacturer_code AS refManufacturerCode,e.quantity,e.article_role AS articleRole,
    e.int_value AS intValue,e.capacity_kind_code AS capacityKindCode,
    e.budget_code AS budgetCode,e.profile_id AS profileId
    FROM cat_config_rule_effect e JOIN cat_config_rule r ON r.id=e.rule_id
    WHERE r.model_id=? ORDER BY r.seq,e.seq`).all(model.id) as EffectRow[];
  const matched=new Set(matchingRuleIds);
  const articles=db.prepare(`SELECT product_id AS productId,ref_brand_marchio AS refBrandMarchio,
    ref_manufacturer_code AS refManufacturerCode,quantity,role
    FROM cat_config_model_article WHERE model_id=? ORDER BY seq`).all(model.id) as ArticleRow[];
  let delta=0;const overrides=new Set<number>();
  const demandDeltas=new Map<string,number>();
  const budgetUses=new Map<string,number>();
  for(const effect of effects){
    if(!matched.has(effect.ruleId))continue;
    if(effect.effectKind==="article")articles.push({productId:effect.productId,
      refBrandMarchio:effect.refBrandMarchio!,refManufacturerCode:effect.refManufacturerCode!,
      quantity:effect.quantity!,role:effect.articleRole!});
    else if(effect.effectKind==="profile_key_delta")delta+=effect.intValue!;
    else if(effect.effectKind==="profile_override")overrides.add(effect.profileId!);
    else if(effect.effectKind==="demand_delta")demandDeltas.set(effect.capacityKindCode!,
      (demandDeltas.get(effect.capacityKindCode!)??0)+effect.intValue!);
    else if(effect.effectKind==="budget_use")budgetUses.set(effect.budgetCode!,
      (budgetUses.get(effect.budgetCode!)??0)+effect.intValue!);
  }
  const budgets=model.budgets.map(b=>({code:b.code,used:budgetUses.get(b.code)??0,maxAmount:b.maxAmount}));
  for(const [code] of budgetUses)if(!budgets.some(b=>b.code===code))
    invalid("unknown_budget",`Rule uses an undefined budget ${code}`);
  for(const budget of budgets)if(budget.used>budget.maxAmount)
    invalid("budget_exceeded",`Budget ${budget.code} uses ${budget.used} of ${budget.maxAmount}`);
  if(overrides.size>1||(overrides.size>0&&delta!==0))
    invalid("ambiguous_profile","Profile override and key effects conflict");
  let profileId=overrides.size===1?[...overrides][0]!:model.baseProfileId;
  if(delta!==0){
    const base=profileId===null?undefined:db.prepare(`SELECT profile_set_id AS setId,profile_key AS profileKey
      FROM cat_phys_profile WHERE id=?`).get(profileId) as {setId:number;profileKey:number|null}|undefined;
    if(!base||base.profileKey===null)invalid("no_profile","Key delta has no keyed base profile");
    else profileId=(db.prepare(`SELECT id FROM cat_phys_profile WHERE profile_set_id=? AND profile_key=? AND active=1`)
      .pluck().get(base.setId,base.profileKey+delta) as number|undefined)??null;
  }
  const physical=profileId===null?null:getPhysicalProfile(db,profileId);
  if(profileId===null&&["device","support","enclosure"].includes(model.kind))
    invalid("no_profile","Model has no established physical profile");
  if(profileId!==null&&!physical)invalid("no_profile","No effective physical profile exists");
  for(const [kind,amount] of demandDeltas){
    if(!physical){invalid("no_profile",`Demand delta ${kind} has no physical profile`);continue;}
    const demand=physical.demands.find(d=>d.capacityKindCode===kind);
    if(demand)demand.amount+=amount;
    else {
      const meta=db.prepare(`SELECT unit_label AS unitLabel,display_divisor AS displayDivisor,
        nominal_pitch_mm AS nominalPitchMm
        FROM cat_capacity_kind WHERE code=?`).get(kind) as {unitLabel:string;displayDivisor:number;nominalPitchMm:number|null}|undefined;
      if(meta)physical.demands.push({capacityKindCode:kind,amount,...meta});
      else invalid("unknown_capacity_kind",`Unknown capacity kind ${kind}`);
    }
    if(physical.demands.some(d=>d.capacityKindCode===kind&&d.amount<0))
      invalid("negative_demand",`Negative demand for ${kind}`);
  }
  const aggregate=new Map<string,BomArticle>();
  const quantities=new Map<string,DecimalQuantity>();
  for(const article of articles){
    const key=article.productId===null
      ?`ref:${article.refBrandMarchio}\0${article.refManufacturerCode}`
      :`product:${article.productId}`;
    let row=aggregate.get(key);
    if(!row){row={brandMarchio:article.refBrandMarchio,manufacturerCode:article.refManufacturerCode,
      productId:article.productId,linkedBrandMarchio:null,linkedManufacturerCode:null,
      quantity:0,roles:[],description:null,unitPriceE4:null,
      rowTotalE4:null,currency:null,priceIssuerSigla:null,priceListinoNumber:null,
      priceValidFrom:null,priceMultiplierOriginal:null};aggregate.set(key,row);}
    const quantity=addQuantity(quantities.get(key)??{numerator:0n,scale:1n},
      decimalQuantity(article.quantity));
    quantities.set(key,quantity);
    row.quantity=Number(quantity.numerator)/Number(quantity.scale);
    if(!row.roles.includes(article.role))row.roles.push(article.role);
    if(row.productId!==article.productId)invalid("inconsistent_article_link",`Conflicting product links for ${key}`);
  }
  if(model.commercialContribution==="none"&&articles.length>0)
    invalid("commercial_contribution_conflict","Physical-only model produced article contributions");
  const approvedEmptyBom=model.kind==="support"&&model.emptyBomRuleIds?.some(id=>matched.has(id))===true;
  const commercialContribution=aggregate.size===0&&approvedEmptyBom?"none":model.commercialContribution;
  if(commercialContribution==="articles"&&aggregate.size===0)
    invalid("bom_empty","Configuration has no BOM articles");
  const price=db.prepare(`SELECT COALESCE(p.description,p.short_description) AS description,
    price.list_price_unit_e4 AS unitPriceE4,
    price.currency,issuer.metel_sigla AS priceIssuerSigla,
    pl.listino_number AS priceListinoNumber,pl.valid_from AS priceValidFrom,
    price.price_multiplier AS priceMultiplierOriginal,
    brand.metel_marchio AS linkedBrandMarchio,p.manufacturer_code AS linkedManufacturerCode,brand.active AS brandActive
    FROM cat_product p JOIN cat_brand brand ON brand.id=p.brand_id
    LEFT JOIN cat_product_listing listing
      ON listing.product_id=p.id AND listing.issuer_id=p.governing_issuer_id AND listing.is_listed=1
    LEFT JOIN com_price_list pl ON pl.issuer_id=listing.issuer_id AND pl.is_current=1
    LEFT JOIN com_product_price price ON price.product_id=p.id AND price.price_list_id=pl.id
    LEFT JOIN cat_metel_issuer issuer ON issuer.id=pl.issuer_id WHERE p.id=?`);
  let pricedSubtotalE4=0,allPriced=true;
  const currencies=new Set<string>();
  for(const row of aggregate.values()){
    if(row.productId===null){invalid("unresolved_article",`Unresolved article ${row.brandMarchio}/${row.manufacturerCode}`);allPriced=false;continue;}
    const priced=price.get(row.productId) as PricedProduct|undefined;
    if(!priced){invalid("unresolved_article",`Missing product ${row.productId}`);allPriced=false;continue;}
    if((priced as PricedProduct & {brandActive:number}).brandActive!==1) {
      invalid("inactive_brand",`Il marchio ${priced.linkedBrandMarchio} è disattivato.`);allPriced=false;continue;
    }
    row.description=priced.description;row.unitPriceE4=priced.unitPriceE4;
    row.currency=priced.currency;row.priceIssuerSigla=priced.priceIssuerSigla;
    row.priceListinoNumber=priced.priceListinoNumber;row.priceValidFrom=priced.priceValidFrom;
    row.priceMultiplierOriginal=priced.priceMultiplierOriginal;
    row.linkedBrandMarchio=priced.linkedBrandMarchio;
    row.linkedManufacturerCode=priced.linkedManufacturerCode;
    if(priced.currency)currencies.add(priced.currency);
    if(priced.currency!==null&&priced.currency!=="EUR"){
      invalid("unsupported_currency",`Non-EUR METEL price for ${row.manufacturerCode}`);
      allPriced=false;
    }
    if(priced.unitPriceE4===null){invalid("missing_price",`No current METEL price for ${row.brandMarchio}/${row.manufacturerCode}`);allPriced=false;continue;}
    const key=row.productId===null?`ref:${row.brandMarchio}\0${row.manufacturerCode}`:`product:${row.productId}`;
    row.rowTotalE4=exactRowE4(priced.unitPriceE4,quantities.get(key)!);
    if(row.rowTotalE4===null){invalid("inexact_price",`Quantity cannot be priced exactly for ${row.manufacturerCode}`);allPriced=false;continue;}
    pricedSubtotalE4+=row.rowTotalE4;
    if(!Number.isSafeInteger(pricedSubtotalE4))throw new Error("Configuration price exceeds safe _e4 range");
  }
  if(currencies.size>1){invalid("mixed_currency","BOM prices use different currencies");allPriced=false;}
  const invalidCodes=new Set(["duplicate_option","foreign_option","invalid_entry","inactive_model",
    "multiple_on_axis","ambiguous_default","unavailable_option","unresolved_binding",
    "unknown_budget","ambiguous_profile","unknown_capacity_kind","negative_demand",
    "inconsistent_article_link","bom_empty","mixed_currency","commercial_contribution_conflict","inactive_brand"]);
  const status=issues.some(i=>invalidCodes.has(i.code))?"invalid"
    :issues.some(i=>i.code==="budget_exceeded")?"budget_exceeded"
    :issues.some(i=>i.code==="missing_required")?"incomplete"
    :issues.some(i=>i.code==="unresolved_article")?"bom_incomplete"
    :issues.some(i=>i.code==="no_profile")?"no_profile"
    :commercialContribution==="none"?"complete"
    :!allPriced?"price_incomplete":"complete";
  const chosen=model.axes.flatMap(axis=>axis.options.filter(o=>selected.has(o.id))
    .map(o=>[axis.dimensionCode,o.valueCode] as const))
    .sort(([a,av],[b,bv])=>a.localeCompare(b)||av.localeCompare(bv));
  const fingerprint=status==="invalid"||status==="incomplete"?null:createHash("sha256")
    .update(JSON.stringify({brand:model.brandMarchio,model:model.code,
      definition:model.definitionFingerprint,values:chosen})).digest("hex");
  const exclusions=selected.size===0?[]:db.prepare(`SELECT DISTINCT content_dim.code AS ownDimensionCode,
      content_value.code AS ownValueCode,container_dim.code AS ancestorDimensionCode,
      container_value.code AS ancestorValueCode
    FROM cat_config_exclusion exclusion
    JOIN cat_config_dimension_value content_value ON content_value.id=exclusion.content_value_id
    JOIN cat_config_dimension content_dim ON content_dim.id=content_value.dimension_id
    JOIN cat_config_dimension_value container_value ON container_value.id=exclusion.container_value_id
    JOIN cat_config_dimension container_dim ON container_dim.id=container_value.dimension_id
    JOIN cat_config_option option ON option.value_id=content_value.id
    WHERE option.id IN (${[...selected].map(()=>"?").join(",")})
    ORDER BY ownDimensionCode,ownValueCode,ancestorDimensionCode,ancestorValueCode`)
    .all(...selected) as ConfigurationResult["exclusions"];
  return {model,provenance:modelEngineeringProvenance(db,model.id),selectedOptionIds:[...selected],defaultedOptionIds:defaulted,
    commercialContribution,
    matchingRuleIds,fingerprint,status,issues,bom:[...aggregate.values()],
    totalE4:commercialContribution==="none"?null:allPriced?pricedSubtotalE4:null,pricedSubtotalE4,budgets,physical,exclusions,
    context:getModelEngineeringContext(db,model.id,model.kind)};
}
