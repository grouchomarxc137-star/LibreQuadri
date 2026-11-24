import type Database from "better-sqlite3";
import { sieDescriptionParser } from "./parsers/sie-description.js";
import { SIE_FAMILY_PROFILES } from "./parsers/sie-families.js";

type Product = {id:number;code:string;description:string|null;family:string|null;familyName:string|null;issuer:string|null;category:string|null};
export interface SiemensFamilyCoverage {
  code:string; name:string|null; profile:string|null; products:number; kinds:Record<string,number>;
  supported:string[]; populated:Record<string,number>; ambiguous:Record<string,number>;
  withoutTechnicalValues:number; unresolvedKind:number; examples:string[];
}

/** Read-only report of persisted values, with parser ambiguity diagnostics from the same input context. */
export function siemensCoverage(database: Database.Database) {
  const products = database.prepare(`SELECT p.id,p.manufacturer_code AS code,p.short_description AS description,
    f.code AS family,f.description AS familyName,i.metel_sigla AS issuer,c.code AS category
    FROM cat_product p JOIN cat_brand b ON b.id=p.brand_id
    LEFT JOIN cat_metel_family f ON f.id=p.statistical_family_id AND f.brand_id=p.brand_id
      AND f.issuer_id=p.governing_issuer_id AND f.family_type='STATISTICA'
    LEFT JOIN cat_metel_issuer i ON i.id=f.issuer_id LEFT JOIN cat_category c ON c.id=p.category_id
    WHERE b.metel_marchio='SIE' AND p.import_removed=0 ORDER BY f.code,p.manufacturer_code`).all() as Product[];
  const stored = new Map<number,Map<string,string|number>>();
  for (const row of database.prepare(`SELECT pa.product_id AS id,a.code,COALESCE(o.value,pa.value_num) AS value
    FROM cat_product_attribute pa JOIN cat_attribute a ON a.id=pa.attribute_id AND a.active=1
    JOIN cat_product p ON p.id=pa.product_id JOIN cat_brand b ON b.id=p.brand_id
    LEFT JOIN cat_attribute_option o ON o.id=pa.option_id
    WHERE b.metel_marchio='SIE' AND p.import_removed=0 ORDER BY a.code`).all() as Array<{id:number;code:string;value:string|number}>) {
    const values=stored.get(row.id)??new Map(); values.set(row.code,row.value);stored.set(row.id,values);
  }
  const links=new Map<string,string[]>();
  for (const row of database.prepare(`SELECT c.code AS category,a.code FROM cat_category_attribute ca
    JOIN cat_category c ON c.id=ca.category_id AND c.active=1 JOIN cat_attribute a ON a.id=ca.attribute_id AND a.active=1
    WHERE ca.is_filterable=1 ORDER BY a.code`).all() as Array<{category:string;code:string}>) {
    const codes=links.get(row.category)??[];codes.push(row.code);links.set(row.category,codes);
  }
  const families=new Map<string,SiemensFamilyCoverage>();
  for (const p of products) {
    const code=p.family??"(missing)";
    const f=families.get(code)??{code,name:p.familyName,profile:SIE_FAMILY_PROFILES[code]??null,products:0,kinds:{},
      supported:[],populated:{},ambiguous:{},withoutTechnicalValues:0,unresolvedKind:0,examples:[]};
    families.set(code,f);f.products++;
    f.supported=[...new Set([...f.supported,...(links.get(p.category??"")??[])])].sort();
    const values=stored.get(p.id)??new Map();
    for(const key of values.keys())f.populated[key]=(f.populated[key]??0)+1;
    if(values.size===0 || (values.size===1 && values.has("article_kind")))f.withoutTechnicalValues++;
    const kind=values.get("article_kind");
    if(typeof kind==="string")f.kinds[kind]=(f.kinds[kind]??0)+1;else f.unresolvedKind++;
    if(f.examples.length<2)f.examples.push(`${p.code}: ${p.description??""}`);
    for(const key of sieDescriptionParser.parse({description:p.description??"",manufacturerCode:p.code,categoryCode:p.category,
      statisticalFamilyCode:p.family,statisticalFamilyIssuerSigla:p.issuer}).ambiguous) {
      if(f.supported.includes(key))f.ambiguous[key]=(f.ambiguous[key]??0)+1;
    }
  }
  return {parser:{code:sieDescriptionParser.code,version:sieDescriptionParser.version},products:products.length,families:[...families.values()]};
}

export function siemensCoverageMarkdown(report: ReturnType<typeof siemensCoverage>): string {
  const esc=(value:string)=>value.replaceAll("|","/").replaceAll("\n"," ");
  const count=(values:Record<string,number>)=>Object.entries(values).map(([k,v])=>`${k}=${v}`).join(", ")||"none";
  const populated=report.families.reduce((sum,f)=>sum+Object.values(f.populated).reduce((a,b)=>a+b,0),0);
  const technical=report.products-report.families.reduce((sum,f)=>sum+f.withoutTechnicalValues,0);
  return `# Siemens imported-description filter coverage\n\nParser \`${report.parser.code}\` version ${report.parser.version}. ${report.families.length} imported statistical families, ${report.products} articles; ${populated} stored values, ${technical} articles with at least one technical/software value beyond article kind. Generated from a disposable catalogue; installed data is unchanged.\n\n`+
    `Every family is reviewed and mapped to a manufacturer-neutral technical category. The existing Siemens FST tree and public APIs are unchanged. A category is a broad applicability envelope, not proof that every article is a device. Article kind requires a reviewed leading noun, explicit software evidence, or a reviewed accessory/software family. Unrecognized kinds stay unset.\n\n`+
    `Counts below are actual persisted values (including protected manual/imported facts if present). Supported codes with zero population are listed under gaps. Missing values are not assumed to apply to every article: many articles are accessories or their short description omits the rating. Ambiguity counts are parser candidates withheld, not estimates.\n\n`+
    `Rules: decimal comma/dot; combined curve/current; Icn and Icu only when labelled; unlabelled kA stays declared capacity; multiple unlabelled capacities/voltages withheld. Current-setting ranges are separate from nominal current. Coil, auxiliary supply and PSU output voltage stay separate; I/O signal voltage is never inferred as supply. No electrical rating comes from product codes. Accessory target references are excluded. IP/axis-labelled dimensions may describe accessories themselves. Unnamed dimensions, short terminal unitless dimensions (pre-truncated Siemens fields), L without a reviewed H/L panel legend, transformer zero-padded power notation or powers inconsistent with the imported up-to-16-kVA family, incomplete units, unreviewed kind nouns, signal ranges, software service packs, implicit licences and ambiguous upgrade versions remain unresolved. AG/AS/AK residual subtypes are not collapsed into type A. Version enums contain explicit imported tokens; a future unknown token requires a reviewed seed/parser update.\n\n`+
    `Reproduce after building: \`node dist/scripts/siemens-filter-coverage.js /absolute/path/to/enriched-copy.db docs/SIEMENS_FILTER_COVERAGE.md\`. The command reads the database only. Startup and METEL refresh apply the same transactional classification/enrichment pass; fingerprints include category rules, attribute definitions and parser versions.\n\n`+
    report.families.map(f=>`## ${f.code} — ${esc(f.name??"No imported family label")}\n\n`+
      `${f.products} articles; profile \`${f.profile??"unreviewed"}\`; kinds: ${count(f.kinds)}; unresolved kind: ${f.unresolvedKind}; without technical/software values: ${f.withoutTechnicalValues}.\n\n`+
      `Populated filters: ${count(f.populated)}.\n\nSupported but unpopulated: ${f.supported.filter(c=>!f.populated[c]).join(", ")||"none"}. Ambiguous: ${count(f.ambiguous)}.\n\n`+
      `Imported examples: ${f.examples.map(e=>esc(e)).join("; ")}.\n`).join("\n");
}
