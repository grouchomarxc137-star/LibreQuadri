import { REVIEWED_EMPTY_BOM_PANELS, reviewedEmptyBomPanel } from "./empty-bom-panels.js";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import MDBReader from "mdb-reader";

import { loadCapacityKindSeed, loadSourceBrandMapSeed } from "../../catalogue/engineering-seed.js";
import { loadEngineeringVocabularySeed } from "../../catalogue/engineering-vocabulary.js";
import { loadCategorySeed } from "../../catalogue/category-seed.js";
import { loadAttributeSeed } from "../../catalogue/attribute-seed.js";
import { synchronizeDerivedCatalogue } from "../../catalogue/derived-catalogue.js";
import { loadSiemensNavigationSeed } from "../../catalogue/siemens-navigation.js";
import { loadProductFamilySeed, synchronizeProductFamilySeed } from "../../catalogue/family-seed.js";
import { loadRangeNavigationSeed, sourceLevelMap, synchronizeRangeNavigationSeed,
  type RangeGroupSeed, type RangeSourceLevel } from "../../catalogue/range-navigation-seed.js";
import { EngineeringDataWriter } from "../engineering-writer.js";
import { ENGINEERING_LINK_POLICY_VERSION } from "../engineering-links.js";
import { TIQUADRI_ENGINEERING_ADAPTER } from "./adapter.js";
import { enclosureProfileDeltas, placedAxisEditability } from "./enclosure-profile-deltas.js";
import { classifyPanelPresentation, loadPanelPresentationApprovals, type PanelPresentationApproval } from "./front-presentation.js";
import { readEngineeringReadiness } from "../../catalogue/engineering-readiness.js";
import type { PresetPlacementMode } from "../../../shared/configuration.js";
import { FRONT_PANEL_ROLES } from "../../../shared/front-presentation.js";
import { factoryPanelProfileSource, factoryPresetBlock, isMarinaAvanquadroWindow,
  reviewedFactoryChild, REVIEWED_FACTORY_PRESETS } from "./factory-presets.js";

interface ContributionApproval { sourceRef:string; commercialContribution:"none"; reviewedName:string }
function contributionApprovals(seedFolder?:string): ContributionApproval[] {
  const file=path.join(seedFolder??path.resolve("db/seed"),"tiquadri-commercial-contribution.json");
  const parsed:unknown=JSON.parse(readFileSync(file,"utf8"));
  if(!Array.isArray(parsed)||parsed.some(row=>!row||typeof row!=="object"||
    typeof row.sourceRef!=="string"||row.commercialContribution!=="none"||
    typeof row.reviewedName!=="string")||
    new Set(parsed.map(row=>row.sourceRef)).size!==parsed.length)
    throw new Error("Invalid reviewed TiQuadri contribution seed");
  return parsed as ContributionApproval[];
}

/**
 * Reviewed capacity-filler designation. TiQuadri identifies its falso-polo filler only through a
 * constant in the executable (ANA_MODALITA 13497, label 85); no source column states it, so the
 * designation is a reviewed seed that the import re-validates against the source on every run.
 */
export interface CapacityFillerApproval {
  sourceRef:string; reviewedName:string; sourceModalita:number; sourceLabel:number;
  capacityKind:string; evidence:string;
}
function capacityFillerApprovals(seedFolder?:string):CapacityFillerApproval[] {
  const file=path.join(seedFolder??path.resolve("db/seed"),"tiquadri-capacity-fillers.json");
  const parsed:unknown=JSON.parse(readFileSync(file,"utf8"));
  if(!Array.isArray(parsed)||parsed.some(row=>!row||typeof row!=="object"||
    typeof row.sourceRef!=="string"||!/^TiQuadri ANA_PACK \d+$/.test(row.sourceRef)||
    typeof row.reviewedName!=="string"||!Number.isSafeInteger(row.sourceModalita)||
    !Number.isSafeInteger(row.sourceLabel)||typeof row.capacityKind!=="string"||
    typeof row.evidence!=="string"||row.evidence.trim()==="")||
    new Set(parsed.map(row=>row.sourceRef)).size!==parsed.length)
    throw new Error("Invalid reviewed TiQuadri capacity-filler seed");
  return parsed as CapacityFillerApproval[];
}

export function classifyRawContribution(sourceRef:string,name:string,baseRows:number,
  modalityRows:number,approvals:readonly ContributionApproval[]):
  {commercialContribution:"articles"|"none";reviewCandidate:boolean;conflict:boolean} {
  const approval=approvals.find(row=>row.sourceRef===sourceRef);
  const articleFree=baseRows===0&&modalityRows===0;
  return {commercialContribution:articleFree&&approval?.reviewedName===name?"none":"articles",
    reviewCandidate:articleFree&&!approval,conflict:!!approval&&(!articleFree||approval.reviewedName!==name)};
}
type Row = Record<string, unknown>;
type Id = { id: number };

/**
 * A model's definition identity. Models without preset children keep exactly the identity they had
 * before preset semantics were imported, so projects that snapshotted them remain eligible for
 * catalogue-backed design operations after a re-import. Preset rows (order, child, mode, X/Y) are part
 * of a parent's definition: they change the parent's placement surface and what adding it creates.
 */
export function modelDefinitionFingerprint(definition:readonly unknown[],presets:readonly Row[]):string {
  return sha(JSON.stringify(presets.length?[...definition,{presets}]:definition));
}
type Skip = { count: number; sampleKeys: string[] };

export interface TiQuadriImportOptions {
  readonly database: Database.Database;
  readonly sourcePath: string;
  /** Optional read-only ListinoBT evidence for module-count conflicts. */
  readonly listinoPath?: string;
  readonly archiveDirectory: string;
  readonly backupDirectory: string;
  readonly seedFolder?: string;
  readonly importedAt?: Date;
}

export interface TiQuadriImportResult {
  readonly importId: number;
  readonly fingerprint: string;
  readonly alreadyImported: boolean;
  readonly summary: Record<string, unknown>;
}

const number = (row: Row, field: string): number => Number(row[field] ?? 0);
const string = (row: Row, field: string): string => String(row[field] ?? "").trim();
const bool = (row: Row, field: string): boolean => row[field] === true;
const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const rows = (reader: MDBReader, table: string, columns?: string[]): Row[] =>
  reader.getTable(table).getData(columns ? { columns } : undefined) as Row[];

export class Report {
  readonly skipped: Record<string, Skip> = {};
  readonly conflicts: Record<string, number> = {};
  readonly errors: string[] = [];
  skip(reason: string, key: string, amount = 1): void {
    const bucket = this.skipped[reason] ??= { count: 0, sampleKeys: [] };
    bucket.count += amount;
    if (bucket.sampleKeys.length < 8) bucket.sampleKeys.push(key);
  }
  conflict(topic: string): void { this.conflicts[topic] = (this.conflicts[topic] ?? 0) + 1; }
}

export function reportEngineeringVocabularyWarnings(report: Report,
  result: { readonly deferred: readonly string[]; readonly stale: readonly string[] }): void {
  for(const key of result.deferred)report.skip("engineering_vocabulary_deferred",key.replace("\0","/"));
  for(const key of result.stale)report.skip("engineering_vocabulary_stale",key.replace("\0","/"));
}

function group<T extends Row>(data: readonly T[], field: string): Map<number, T[]> {
  const result = new Map<number, T[]>();
  for (const row of data) {
    const key = number(row, field);
    const bucket = result.get(key);
    if (bucket) bucket.push(row);
    else result.set(key, [row]);
  }
  return result;
}

function sourceRef(table: string, key: number | string): string { return `TiQuadri ${table} ${key}`; }
function integer(value: number): number | null { return Number.isSafeInteger(value) ? value : null; }

function prepareBrandMap(database: Database.Database, seed: ReturnType<typeof loadSourceBrandMapSeed>): Map<string, string | null> {
  const result = new Map(seed.filter(x => x.adapterCode === "tiquadri")
    .map(x => [x.sourceBrandCode, x.brandMarchio]));
  const explicit = database.prepare(`SELECT m.source_brand_code AS prefix, b.metel_marchio AS marchio
    FROM cat_source_brand_map m LEFT JOIN cat_brand b ON b.id=m.brand_id
    WHERE m.adapter_code='tiquadri'`).all() as Array<{prefix: string; marchio: string | null}>;
  for (const row of explicit) result.set(row.prefix, row.marchio);
  return result;
}

function articleIdentity(brandMap: Map<string, string | null>, row: Row,
  report: Report, key: string): { marchio: string; code: string; prefix: string } | null {
  const prefix = string(row, "Marchio_Articolo");
  const code = string(row, "Cod_Art");
  if (!code || !prefix) { report.skip("article_missing_identity", key); return null; }
  const mapped = brandMap.get(prefix);
  if (!mapped) {
    report.skip("unmapped_brand_prefix", `${key} ${prefix}`);
    return { marchio: prefix, code, prefix };
  }
  return { marchio: mapped, code, prefix };
}

function conflict(writer: EngineeringDataWriter, importId: number, report: Report,
  subjectKind: "article" | "model" | "profile" | "brand", subjectKey: string,
  topic: string, a: string | null, sourceA: string, b: string | null, sourceB: string,
  notes?: string): void {
  writer.conflict({importId,subjectKind,subjectKey,topic,valueA:a,sourceA,valueB:b,sourceB,notes});
  report.conflict(topic);
}

function view(writer: EngineeringDataWriter, report: Report, profileId: number, code: string,
  width: number, height: number, dx: number, dy: number, symbol: string, asset: string): void {
  if (width <= 0 || height <= 0) { report.skip("view_without_dimensions", `${profileId}:${code}`); return; }
  writer.addView({profileId,code,width,height,dx,dy,symbol,asset:asset || null});
}

function parseList(...values: string[]): number[] {
  return [...new Set(values.flatMap(value => value.split("|").map(Number)
    .filter(x => Number.isSafeInteger(x) && x > 0)))].sort((a,b) => a-b);
}

function createAcceptSets(writer: EngineeringDataWriter) {
  const cache = new Map<string,number>();
  const classCache = new Map<string,number>();
  return (category: string, keys: number[], classPrefix: string): number | null => {
    if (!keys.length) return null;
    const code = `tq.accept.${category}.${sha(keys.join("|")).slice(0,24)}`;
    const cached = cache.get(code);
    if (cached !== undefined) return cached;
    const members:number[]=[];
    for (const key of keys) {
      const classCode = `${classPrefix}${key}`;
      let classId = classCache.get(classCode);
      if (classId === undefined) {
        classId = writer.upsertClass(classCode,classCode,sourceRef("compatibility",key));
        classCache.set(classCode,classId);
      }
      members.push(classId);
    }
    const setId=writer.upsertAcceptSet(code,members);
    cache.set(code,setId);
    return setId;
  };
}

interface PhysicalIndex {
  readonly devices: Map<number, number>;
  readonly supports: Map<number, number>;
  readonly enclosureRows: Map<number, Row>;
  readonly counts: Record<string, number>;
  readonly insertEnclosure: (packId: number, row: Row, modelClass: number, block: number) => number;
  readonly blockNames: Map<number,string>;
  readonly usedBlocks: Set<number>;
}

function importPhysical(writer: EngineeringDataWriter, reader: MDBReader,
  importId: number, report: Report, presentationApprovals: readonly PanelPresentationApproval[],
  factoryChildren: ReadonlySet<number>, presetRows: readonly Row[]): PhysicalIndex {
  const devices = new Map<number, number>();
  const supports = new Map<number, number>();
  const enclosureRows = new Map<number, Row>();
  const counts: Record<string, number> = {};
  const bump = (key: string) => { counts[key] = (counts[key] ?? 0) + 1; };
  const acceptSet = createAcceptSets(writer);
  const deviceSet = writer.upsertProfileSet("tq.apparecchi","TiQuadri apparatus profiles");
  const supportSet = writer.upsertProfileSet("tq.pannelli","TiQuadri panel profiles");
  const panelDemand = new Map<number, Set<string>>();

  for (const row of rows(reader,"ASS_PANNELLI_QUADRI_APPARECCHI")) {
    const key = number(row,"Famiglia_Apparecchi");
    const id = writer.upsertProfile({
      code:`tq.app.${key}`,setId:deviceSet,key,kind:"device",
      name:string(row,"Descrizione_Apparecchi") || `Apparatus ${key}`,
      classId:writer.upsertClass(`tq.app.${key}`,`Apparatus ${key}`,sourceRef("ASS_PANNELLI_QUADRI_APPARECCHI",key)),
      depth:number(row,"Profondita") || null,outerDepth:null,usableDepth:null,
      importId,ref:sourceRef("ASS_PANNELLI_QUADRI_APPARECCHI",key),
    });
    if(id<0){devices.set(key,-id);report.skip("manual_profile_override",`tq.app.${key}`);continue;}
    devices.set(key,id); bump("deviceProfiles");
    const candidates: Array<[string,string]> = [
      ["Poli_Din","din_rail"],["Numero_Mega","mccb_slot"],
      ["Numero_Break","acb_slot"],["App_Interni_mm","internal_rail_mm"],
      ["Prese_CEE","socket_slot"],
    ];
    let kind: string | null = null;
    for (const [field,capacity] of candidates) {
      const amount = number(row,field);
      if (amount <= 0) continue;
      if (integer(amount) === null) { report.skip("noninteger_device_demand",`${key}:${field}`); continue; }
      writer.addDemand(id,capacity,amount);kind=capacity;
    }
    if (number(row,"Strumenti") > 0) report.skip("unknown_instrument_unit",String(key));
    const panels = parseList(...Array.from({length:7},(_,i)=>string(row,`Famiglia_Pannelli_${i+1}`)));
    const cabinets = parseList(string(row,"Famiglia_Armadi"),string(row,"Famiglia_Armadi_2"),string(row,"Famiglia_Armadi_3"));
    counts.devicePanelPairs=(counts.devicePanelPairs??0)+panels.length;
    counts.deviceEnclosurePairs=(counts.deviceEnclosurePairs??0)+cabinets.length;
    for (const panel of panels) {
      const kinds = panelDemand.get(panel) ?? new Set<string>();
      if (kind) kinds.add(kind);
      panelDemand.set(panel,kinds);
    }
    const parent = acceptSet("device_panel",panels,"tq.pan.");
    const ancestor = acceptSet("device_enclosure",cabinets,"tq.arm.");
    if (parent !== null) writer.addConstraint(id,"parent",parent);
    if (ancestor !== null) writer.addConstraint(id,"ancestor",ancestor);
    for (const [viewCode,suffix,assetField] of [
      ["front","Vert_X_Ruotato_0","File_blocco_Vert_Ruotato_0"],
      ["front_alt1","Orizz_X_Ruotato_1","File_blocco_Orizz_Ruotato_1"],
      ["front_alt2","Orizz_X_Ruotato_2","File_blocco_Orizz_Ruotato_2"],
    ] as const) {
      const file = string(row,assetField);
      if (file.toUpperCase()==="FINTO") continue;
      const base = suffix.startsWith("Vert") ? "Vert" : "Orizz";
      const rotation = suffix.slice(-1);
      view(writer,report,id,viewCode,
        number(row,`Dimensione_${base}_X_Ruotato_${rotation}`),
        number(row,`Dimensione_${base}_Y_Ruotato_${rotation}`),
        number(row,`Inserimento_${base}_X_Ruotato_${rotation}`),
        number(row,`Inserimento_${base}_Y_Ruotato_${rotation}`),
        kind === "din_rail" ? "modular_device" : "slot_device",file);
    }
  }

  const panelEnclosures = new Map<number,number[]>();
  for (const row of rows(reader,"ASS_PANNELLI_ARMADI")) {
    const key = number(row,"Famiglia_Pannelli");
    const bucket = panelEnclosures.get(key) ?? [];
    bucket.push(number(row,"Famiglia_Armadi"));
    panelEnclosures.set(key,bucket);
    bump("panelEnclosurePairs");
  }
  const presentationByFamily = new Map(presentationApprovals.map(approval => [approval.panelFamily, approval]));
  const presentationPacks = new Map(rows(reader,"ANA_PACK").map(pack => [number(pack,"ID_Pack"),pack]));
  // The Avanquadro artwork has positioning marks rather than complete window outlines.
  const factoryPresentations = new Map([...factoryChildren].map(packId => [
    number(presentationPacks.get(packId)!, "Famiglia_Pannelli"),
    isMarinaAvanquadroWindow(packId)
      ?FRONT_PANEL_ROLES.physical:FRONT_PANEL_ROLES.guide,
  ]));
  for (const row of rows(reader,"ANA_PANNELLI")) {
    const key = number(row,"Famiglia_pannelli");
    const id = writer.upsertProfile({
      code:`tq.pan.${key}`,setId:supportSet,key,kind:"support",name:`Panel ${key}`,
      classId:writer.upsertClass(`tq.pan.${key}`,`Panel ${key}`,sourceRef("ANA_PANNELLI",key)),
      depth:null,outerDepth:null,usableDepth:null,importId,ref:sourceRef("ANA_PANNELLI",key),
    });
    if(id<0){supports.set(key,-id);report.skip("manual_profile_override",`tq.pan.${key}`);continue;}
    supports.set(key,id);bump("supportProfiles");
    const approval = presentationByFamily.get(key);
    const presentation = classifyPanelPresentation(row, approval ? presentationPacks.get(approval.packId) : undefined, approval);
    if (presentation.conflict) conflict(writer,importId,report,"profile",`tq.pan.${key}`,"front_presentation",
      "mounting_guide","reviewed front presentation seed",JSON.stringify(row),sourceRef("ANA_PANNELLI",key),
      "Source no longer matches the reviewed mounting footprint; guide designation withheld.");
    view(writer,report,id,"front",number(row,"Larghezza"),number(row,"Altezza"),
      0,0,factoryPresentations.get(key)??presentation.symbol,string(row,"File_Blocco"));
    const parents=acceptSet("panel_enclosure",parseList(...(panelEnclosures.get(key)??[]).map(String)),"tq.arm.");
    if (parents!==null) writer.addConstraint(id,"parent",parents);
    const kinds=panelDemand.get(key)??new Set<string>();
    const capacity=number(row,"Capienza");
    const orientation=number(row,"Ruotato");
    const requiredView=orientation===1?"front_alt1":orientation===2?"front_alt2":"front";
    const x=number(row,"Inserimento_X1"),y=number(row,"Inserimento_Y1");
    if (bool(row,"Pannello_DIN")) {
      writer.addZone({profileId:id,layout:"linear",capacityKind:"din_rail",capacity,
        x,y,length:number(row,"Larghezza"),breadth:number(row,"Altezza"),
        direction:"horizontal",pitch:null,requiredView,mounting:{system:"din35",basis:"source_rule",evidence:sourceRef("ANA_PANNELLI",key),installationDepthMm:null,apertureMm:null,aboveRailMm:null,belowRailMm:null}});
      bump("dinZones");
    } else if (factoryPresentations.has(key) && (REVIEWED_FACTORY_PRESETS.p17SocketFamilies as readonly number[]).includes(key) &&
      capacity===1 && kinds.size===1 && kinds.has("mccb_slot") && x===0 && y===0) {
      // The v32 socket footprint and its accepted device drawings share the same origin.
      writer.addZone({profileId:id,layout:"slots",capacityKind:null,capacity:1,
        x:null,y:null,length:null,breadth:null,direction:null,pitch:null,requiredView});
      writer.addZoneSlot(id,1,0,0);
      bump("slotPanels");bump("slotZones");counts.slots=(counts.slots??0)+1;
    } else if (kinds.size===0) { bump("blindPanels"); }
    else if ([...kinds].every(k=>k==="mccb_slot"||k==="acb_slot")) {
      bump("slotPanels");
      const points:Array<[number,number]>=[];
      for(let n=1;n<=24;n++) {
        const sx=number(row,`Inserimento_X${n}`),sy=number(row,`Inserimento_Y${n}`);
        if(sx!==0||sy!==0) points.push([sx,sy]);
      }
      if(points.length===0) { report.skip("slot_panel_without_points",String(key));continue; }
      writer.addZone({profileId:id,layout:"slots",capacityKind:null,capacity:points.length,
        x:null,y:null,length:null,breadth:null,direction:null,pitch:null,requiredView});
      points.forEach(([sx,sy],i)=>writer.addZoneSlot(id,i+1,sx,sy));
      bump("slotZones");counts.slots=(counts.slots??0)+points.length;
    } else if(kinds.size===1&&kinds.has("internal_rail_mm")) {
      writer.addZone({profileId:id,layout:"linear",capacityKind:"internal_rail_mm",capacity,
        x,y,length:number(row,"Larghezza"),breadth:number(row,"Altezza"),
        direction:"horizontal",pitch:null,requiredView});
      bump("internalRailZones");
    } else { report.skip("mixed_panel_capacity_kinds",String(key)); }
  }

  const blockNames=new Map(rows(reader,"ASS_ARMADI_BLOCCO").map(row=>[number(row,"ID_Armadi_Blocco"),string(row,"File_blocco")]));
  const usedBlocks=new Set<number>();
  const presets=group(presetRows,"ID_Pack_Quadro");
  const enclosureData=rows(reader,"ANA_ARMADI");
  for(const row of enclosureData) enclosureRows.set(number(row,"Id_Pack"),row);
  const insertEnclosure=(packId:number,row:Row,modelClass:number,block:number):number=>{
    usedBlocks.add(block);
    const set=writer.upsertProfileSet(`tq.armadi.pack.${packId}`,`Enclosure pack ${packId}`);
    const id=writer.upsertProfile({
      code:`tq.armadi.pack.${packId}.block.${block}`,setId:set,key:block,kind:"enclosure",
      name:`Enclosure pack ${packId}, block ${block}`,classId:modelClass,
      depth:null,outerDepth:number(row,"Profondita_reale"),usableDepth:number(row,"Profondita_utile"),
      importId,ref:sourceRef("ANA_ARMADI",packId),
    });
    if(id<0){report.skip("manual_profile_override",`tq.armadi.pack.${packId}.block.${block}`);return -id;}
    view(writer,report,id,"front",number(row,"Larghezza_Reale"),number(row,"Altezza_reale"),
      0,0,"enclosure_frame",blockNames.get(block)??"");
    const fixed=presets.get(packId)??[];
    if(fixed.length>0&&fixed.every(row=>bool(row,"Pos_Pan_XY_assoluti"))) {
      writer.addZone({profileId:id,layout:"slots",capacityKind:null,capacity:fixed.length,
        x:null,y:null,length:null,breadth:null,direction:null,pitch:null,requiredView:"front"});
      fixed.forEach((row,i)=>writer.addZoneSlot(id,i+1,number(row,"Inserimento_X"),number(row,"Inserimento_Y")));
    } else writer.addZone({profileId:id,layout:"stack",capacityKind:"stack_mm",
      capacity:number(row,"Altezza_utile"),x:number(row,"Inserimento_X1"),
      y:number(row,"Inserimento_Y1"),length:number(row,"Altezza_utile"),
      breadth:number(row,"Larghezza_utile"),direction:"vertical",
      pitch:number(row,"Passo")||null,requiredView:null});
    bump("enclosureProfiles");
    return id;
  };
  return {devices,supports,enclosureRows,counts,
    // Variants use the same measured frame; only their keyed front asset changes.
    insertEnclosure,blockNames,usedBlocks};
}

export interface ModelIndex {
  readonly ids: Map<number,number>;
  readonly packs: Row[];
  readonly activeArticles: Map<string,{prefix:string;code:string}>;
  readonly obsoleteArticles: Map<string,{prefix:string;code:string}>;
  readonly counts: Record<string,number>;
  readonly frontLabelRows: ReadonlySet<number>;
}

function importModels(writer: EngineeringDataWriter, reader: MDBReader, importId: number,
  brandId: number, brandMap: Map<string,string|null>, physical: PhysicalIndex,
  report: Report,approvals:readonly ContributionApproval[],presetRows:readonly Row[]): ModelIndex {
  const packs=rows(reader,"ANA_PACK");
  const definitions=group(rows(reader,"ANA_MODALITA"),"Id_Modalita");
  const effects=group(rows(reader,"ANA_ART_MODALITA"),"Id_Index_Modalita");
  const baseArticles=group(rows(reader,"ANA_ART_PACK"),"Id_Pack");
  const presetDefinitions=group(presetRows,"ID_Pack_Quadro");
  const ids=new Map<number,number>();
  const activeArticles=new Map<string,{prefix:string;code:string}>();
  const obsoleteArticles=new Map<string,{prefix:string;code:string}>();
  const counts:Record<string,number>={};
  const frontLabelRows=new Set<number>();
  const bump=(key:string,n=1)=>{counts[key]=(counts[key]??0)+n;};
  const dimensionIds=new Map<number,number>();
  const valueIds=new Map<string,number>();
  const countDimension=new Set<number>(),countValue=new Set<number>();

  function dimension(labelId:number,label:string):number|null {
    if (!labelId) return null;
    const old=dimensionIds.get(labelId);if(old!==undefined)return old;
    const result=writer.upsertDimension(brandId,`tq.label.${labelId}`,
      label || `Label ${labelId}`,importId,sourceRef("ANA_MODALITA label",labelId));
    const id=result.id;
    if(result.manual)report.skip("manual_dimension_override",String(labelId));
    if(id===undefined)return null;
    dimensionIds.set(labelId,id);return id;
  }
  function value(labelId:number,label:string,valueId:number,valueLabel:string):number|null {
    const key=`${labelId}:${valueId}`;
    const old=valueIds.get(key);if(old!==undefined)return old;
    const dim=dimension(labelId,label);if(dim===null)return null;
    const result=writer.upsertValue(dim,`tq.value.${valueId}`,
      valueLabel || `Value ${valueId}`,valueId,sourceRef("ANA_MODALITA value",valueId));
    const id=result.id;
    if(result.manual)report.skip("manual_value_override",key);
    if(id===undefined)return null;
    valueIds.set(key,id);return id;
  }

  for(const pack of packs) {
    const packId=number(pack,"ID_Pack");
    const source=sourceRef("ANA_PACK",packId);
    const active=!bool(pack,"Obsoleto");
    const def=definitions.get(number(pack,"Id_Modalita"))??[];
    const fixed=baseArticles.get(packId)??[];
    const rawModalityRows=def.reduce((sum,row)=>sum+(effects.get(number(row,"Id_Index_Modalita"))?.length??0),0);
    const contribution=classifyRawContribution(source,string(pack,"Descri_Pack"),fixed.length,
      rawModalityRows,approvals);
    if(active&&fixed.length===0&&rawModalityRows===0)bump("sourceArticleFreePacks");
    if(active&&contribution.reviewCandidate){bump("contributionReviewCandidates");report.skip("commercial_contribution_review_candidate",String(packId));}
    if(active&&contribution.commercialContribution==="none")bump("approvedPhysicalOnlyModels");
    if(contribution.conflict){
      bump("contributionClassificationConflicts");
      conflict(writer,importId,report,"model",`tq.pack.${packId}`,
        "commercial_contribution","none","reviewed seed","articles","raw TiQuadri source",
        `ANA_ART_PACK=${fixed.length}; ANA_ART_MODALITA=${rawModalityRows}; name=${string(pack,"Descri_Pack")}`);
    }
    const familyApp=number(pack,"Famiglia_Apparecchi");
    const familyPanel=number(pack,"Famiglia_Pannelli");
    const familyCab=number(pack,"Famiglia_Armadi");
    const subCab=number(pack,"Sotto_Famiglia_Armadi");
    const kind=familyApp>0?"device":familyPanel>0?"support":subCab===99?"accessory":"enclosure";
    if(active){bump("activeModels");bump(`active_${kind}`);}
    else bump("obsoleteModels");
    let profile:number|null=familyApp>0?(physical.devices.get(familyApp)??null)
      :familyPanel>0?(physical.supports.get(familyPanel)??null):null;
    const cabinet=physical.enclosureRows.get(packId);
    if(kind==="enclosure"&&cabinet) {
      const classKey=familyCab*100+subCab;
      const classId=writer.upsertClass(`tq.arm.${classKey}`,`Enclosure class ${classKey}`,sourceRef("ANA_PACK",packId));
      const block=number(cabinet,"ID_Armadi_Blocco");
      profile=physical.insertEnclosure(packId,cabinet,classId,block);
      if(active)bump("activeEnclosuresWithGeometry");
      const deltas=new Set(def.map(r=>number(r,"Aumenta_Famiglia")).filter(x=>x!==0));
      const singleDeltas=new Set(deltas);
      for(const delta of enclosureProfileDeltas(def)) if(delta!==0)deltas.add(delta);
      for(const delta of deltas){
        const variant=block+delta;
        if(integer(variant)!==null&&physical.blockNames.has(variant)){
          physical.insertEnclosure(packId,cabinet,classId,variant);
          if(!singleDeltas.has(delta))bump("combinedEnclosureVariants");
        }
        else if(active)report.skip("enclosure_variant_without_block",`${packId}:${variant}`);
      }
    } else if(kind==="enclosure"&&active) {
      bump("activeEnclosuresWithoutGeometry");
      report.skip("enclosure_without_geometry",String(packId));
    }
    if((kind==="device"||kind==="support")&&profile===null&&active)
      report.skip("model_without_base_profile",String(packId));
    const fingerprint=modelDefinitionFingerprint([pack,def,fixed,def.map(r=>effects.get(number(r,"Id_Index_Modalita"))??[])],
      presetDefinitions.get(packId)??[]);
    const id=writer.upsertModel({brandId,code:`tq.pack.${packId}`,name:string(pack,"Descri_Pack"),kind,
      profile,maxQty:number(pack,"Qta_Max_Singolo_Inserimento")||null,fingerprint,
      active:active?1:0,obsolete:active?0:1,importId,ref:source,
      commercialContribution:contribution.commercialContribution});
    if(id===undefined){report.skip("manual_model_override",String(packId));continue;}
    ids.set(packId,id);
    writer.replaceModelChildren(id);
    const templates:Row[]=[];
    const aggregated=new Map<string,{marchio:string;code:string;prefix:string;quantity:number;order:number}>();
    fixed.forEach((row,i)=>{
      const identity=articleIdentity(brandMap,row,report,`ANA_ART_PACK ${packId}:${i}`);
      if(!identity)return;
      if(identity.code.includes("%1")){templates.push(row);return;}
      const key=`${identity.marchio}\0${identity.code}`;
      const prev=aggregated.get(key);
      if(prev)prev.quantity++;
      else aggregated.set(key,{...identity,quantity:1,order:i});
      (active?activeArticles:obsoleteArticles).set(`${identity.prefix}\0${identity.code}`,{prefix:identity.prefix,code:identity.code});
      if(active)bump("baseArticleSourceRows");
    });
    let baseSeq=0;
    for(const item of [...aggregated.values()].sort((a,b)=>a.order-b.order))
      writer.addBaseArticle(id,++baseSeq,item.marchio,item.code,item.quantity,
        baseSeq===1?"primary":"component");
    if(active)bump("baseArticlesAggregated",aggregated.size);
    const axisByLabel=new Map<number,{id:number;rootCount:number;rootDefault:boolean}>();
    const editability=placedAxisEditability(def);
    const optionByKey=new Map<string,number>();
    let axisOrder=0,optionOrder=0,ruleOrder=0,maxAux=0;
    for(const row of def){
      const rowKey=number(row,"Id_Index_Modalita");
      const label1=number(row,"ID_Label_Modalita_1"),value1=number(row,"ID_Valore_Modalita_1");
      const label2=number(row,"ID_Label_Modalita_2"),value2=number(row,"ID_Valore_Modalita_2");
      const templateEffects=(effects.get(rowKey)??[]).some(x=>string(x,"Cod_Art").startsWith("%1"));
      const ensureAxis=(labelId:number,label:string,visible:boolean,selectsPrimary:boolean,binding:string)=>{
        let item=axisByLabel.get(labelId);
        if(item)return item;
        const dim=dimension(labelId,label);if(dim===null)return null;
        const permission=editability.get(labelId)!;
        const editable=permission.locked===0;
        const axisId=writer.addAxis(id,dim,++axisOrder,label,visible,binding,selectsPrimary,editable);
        if(active){bump(editable?"editableAxes":"lockedAxes");bump(`${kind}_${editable?"editableAxes":"lockedAxes"}`);}
        if(permission.permitted>0&&permission.locked>0){
          if(active)bump("mixedEditableAxes");
          report.skip("axis_editability_mixed",`${packId}:${labelId}`);
          conflict(writer,importId,report,"model",`tq.pack.${packId}:tq.label.${labelId}`,
            "axis_editability","editable","TiQuadri modality rows","locked","TiQuadri modality rows",
            `${permission.permitted} permitting contributions; ${permission.locked} locked contributions; axis remains locked`);
        }
        item={id:axisId,rootCount:0,rootDefault:false};axisByLabel.set(labelId,item);
        return item;
      };
      const makeOption=(labelId:number,label:string,valId:number,valLabel:string,
        parent:number|null,isDefault:boolean,visible:boolean,primary:boolean,binding:string):number|null=>{
        if(!labelId||!valId)return null;
        const key=`${labelId}:${valId}:${parent??0}`;
        const old=optionByKey.get(key);if(old!==undefined)return old;
        const axis=ensureAxis(labelId,label,visible,primary,binding);if(!axis)return null;
        const val=value(labelId,label,valId,valLabel);if(val===null)return null;
        const optionId=writer.addOption(axis.id,val,parent,isDefault,visible,++optionOrder);
        optionByKey.set(key,optionId);
        if(parent===null){axis.rootCount++;axis.rootDefault ||= isDefault;}
        return optionId;
      };
      const first=makeOption(label1,string(row,"Label_Modalita_1"),value1,string(row,"Valore_Modalita_1"),
        null,bool(row,"Default_1"),!bool(row,"Modalita_1_Invisibile"),templateEffects||templates.length>0,
        // TiQuadri's content flag is reported below, not a child-placement equality rule.
        "none");
      const second=makeOption(label2,string(row,"Label_Modalita_2"),value2,string(row,"Valore_Modalita_2"),
        first,bool(row,"Default_2"),!bool(row,"Modalita_2_Invisibile"),false,"none");
      const ruleId=writer.addRule(id,++ruleOrder,kind==="support"&&
        reviewedEmptyBomPanel(packId,string(pack,"Descri_Pack"),fingerprint,rowKey,fixed.length,(effects.get(rowKey)??[]).length));
      if(first!==null)writer.addCondition(ruleId,first);
      if(second!==null)writer.addCondition(ruleId,second);
      const block=string(row,"Block");
      if(active&&kind==="enclosure"&&number(row,"Flag_Block")===1&&/^99_Testi[\\/].+/i.test(block)){
        const x=number(row,"Offset_block_X"), y=number(row,"Offset_block_Y");
        const w=number(row,"Dim_block_X"), h=number(row,"Dim_block_Y");
        if(first!==null&&(!label2||second!==null)&&[x,y,w,h].every(Number.isFinite)&&w>0&&h>0){
          writer.addFrontOptionLabel(ruleId,block,x,y,w,h);
          frontLabelRows.add(rowKey);
          bump("frontOptionLabels");
        } else report.skip("front_option_label_invalid",String(rowKey));
      }
      if(active){bump("rules");if(label1)countDimension.add(label1);if(label2)countDimension.add(label2);
        if(value1)countValue.add(value1);if(value2)countValue.add(value2);}
      const articles=effects.get(rowKey)??[];
      if(active)bump("articleEffectSourceRows",articles.length);
      const combined=new Map<string,{marchio:string;code:string;prefix:string;quantity:number;role:string}>();
      for(const [i,art] of articles.entries()) {
        const identity=articleIdentity(brandMap,art,report,`ANA_ART_MODALITA ${rowKey}:${i}`);
        if(!identity)continue;
        let code=identity.code,role="accessory";
        if(code.startsWith("%1")){
          if(templates.length!==1){
            report.skip("template_missing_or_ambiguous",`${packId}:${rowKey}:${code}`);
            conflict(writer,importId,report,"model",`tq.pack.${packId}`,"template",code,"TiQuadri option",
              templates.map(x=>string(x,"Cod_Art")).join("|"),"TiQuadri base");
            continue;
          }
          code=string(templates[0]!,"Cod_Art").replace("%1",code.slice(2));role="primary";
        }
        const key=`${identity.marchio}\0${code}\0${role}`;
        const old=combined.get(key);
        if(old)old.quantity++;
        else combined.set(key,{marchio:identity.marchio,code,prefix:identity.prefix,quantity:1,role});
        (active?activeArticles:obsoleteArticles).set(`${identity.prefix}\0${code}`,{prefix:identity.prefix,code});
      }
      let effectSeq=0;
      for(const item of combined.values())
        writer.addArticleEffect(ruleId,++effectSeq,item.marchio,item.code,item.quantity,item.role);
      if(active)bump("articleEffectsAggregated",combined.size);
      const delta=number(row,"Aumenta_Famiglia");
      if(delta!==0){
        if(integer(delta)!==null)writer.addProfileDelta(ruleId,++effectSeq,delta);
        else report.skip("noninteger_profile_delta",`${packId}:${rowKey}`);
      }
      maxAux=Math.max(maxAux,number(row,"Max_Aux"));
      const aux=number(row,"Valore_Aux");
      if(aux>0){
        if(integer(aux)!==null)writer.addBudgetUse(ruleId,++effectSeq,aux,"aux");
        else report.skip("noninteger_aux_use",`${packId}:${rowKey}`);
      }
    }
    if(maxAux>0&&integer(maxAux)!==null)writer.addBudget(id,"aux","Auxiliary positions",maxAux);
    for(const [label,item] of axisByLabel){
      if(item.rootCount>0&&!item.rootDefault){
        writer.setAxisOptional(item.id);
        if(active)report.skip("axis_without_source_default",`${packId}:${label}`);
      }
    }
    if(active){bump("axes",axisByLabel.size);bump("options",optionByKey.size);}
  }
  counts.activeDimensions=countDimension.size;
  counts.activeValues=countValue.size;
  for(const key of physical.enclosureRows.keys())
    if(!ids.has(key))report.skip("enclosure_geometry_without_pack",String(key));
  for(const key of physical.blockNames.keys())
    if(!physical.usedBlocks.has(key))report.skip("block_name_without_imported_profile",String(key));
  return {ids,packs,activeArticles,obsoleteArticles,counts,frontLabelRows};
}

/**
 * Absolute source positions are fixed anchors. A relative occurrence without an offset is stacked in
 * source order (packed). A relative occurrence with an offset is positioned inside its parent by
 * semantics the application does not model yet, so it stays unknown (null) and can never be instantiated.
 */
export function presetPlacementMode(row:Row):"fixed"|"packed"|null {
  if(bool(row,"Pos_Pan_XY_assoluti"))return "fixed";
  return number(row,"Inserimento_X")===0&&number(row,"Inserimento_Y")===0?"packed":null;
}

function importRelations(writer: EngineeringDataWriter, presetRows: readonly Row[], models: ModelIndex,
  physical: PhysicalIndex, report: Report, factoryModels: ReadonlyMap<number,number>,
  reviewedMaster: boolean): Record<string,number> {
  writer.clearRelations("tq.pack.");
  const counts:Record<string,number>={};
  const add=(from:number,to:number,relation:string,seq:number,x:number|null,y:number|null,key:string,mode:PresetPlacementMode=null)=>{
    const fromId=models.ids.get(from);
    const factoryId=reviewedMaster&&relation==="preset_child"&&mode==="fixed"&&reviewedFactoryChild(from,to)
      ?factoryModels.get(to):undefined;
    const toId=factoryId??models.ids.get(to);
    if(fromId===undefined||toId===undefined){report.skip("relation_missing_pack",key);return;}
    writer.addRelation(fromId,relation,seq,toId,1,x,y,factoryId===undefined?mode:"factory_fixed");
    counts[relation]=(counts[relation]??0)+1;
  };
  for(const [pack,row] of physical.enclosureRows){
    for(const [field,relation] of [["ID_Pack_Kit","join_kit"],["ID_Pack_Laterali","side_panel"]] as const){
      const to=number(row,field);
      if(to>0)add(pack,to,relation,1,null,null,`${pack}:${field}:${to}`);
    }
  }
  const sequence=new Map<number,number>();
  for(const row of presetRows){
    const from=number(row,"ID_Pack_Quadro"),to=number(row,"ID_Pack_Pannello");
    const seq=(sequence.get(from)??0)+1;sequence.set(from,seq);
    const mode=(reviewedMaster?factoryPresetBlock(from):null)??presetPlacementMode(row);
    if(mode===null)report.skip("preset_relative_offset_unresolved",`${from}:${to}:${seq}`);
    add(from,to,"preset_child",seq,number(row,"Inserimento_X"),number(row,"Inserimento_Y"),
      `${from}:${to}:${seq}`,mode);
  }
  return counts;
}

function importFactoryModels(writer:EngineeringDataWriter, models:ModelIndex, physical:PhysicalIndex,
  brandId:number, importId:number, factoryChildren:ReadonlySet<number>): Map<number,number> {
  const imported=new Map<number,number>();
  const packsById=new Map(models.packs.map(pack=>[number(pack,"ID_Pack"),pack]));
  for(const pack of models.packs){
    const packId=number(pack,"ID_Pack");
    if(!factoryChildren.has(packId))continue;
    const profilePack=packsById.get(factoryPanelProfileSource(packId));
    const profile=profilePack&&physical.supports.get(number(profilePack,"Famiglia_Pannelli"));
    if(profile===undefined)continue;
    const id=writer.upsertModel({brandId,code:`tq.pack.factory.${packId}`,name:string(pack,"Descri_Pack"),kind:"support",
      profile,maxQty:null,fingerprint:sha(JSON.stringify([REVIEWED_FACTORY_PRESETS.masterSha256,"factory",pack])),
      active:1,obsolete:0,importId,ref:sourceRef("ANA_PACK",packId),commercialContribution:"none"});
    if(id===undefined)continue;
    writer.replaceModelChildren(id);
    // The fixed parent relation and the raw physical class constrain these models.
    writer.setModelContextPolicy(id,"unrestricted");
    imported.set(packId,id);
  }
  return imported;
}

function importExclusions(writer: EngineeringDataWriter, reader: MDBReader,
  report: Report): number {
  writer.clearExclusions("tq.label.");
  let count=0;
  for(const row of rows(reader,"Incompatibilita")){
    const a=writer.valueId(`tq.label.${number(row,"ID_Label_Modalita_Carpenteria")}`,
      `tq.value.${number(row,"ID_Valore_Modalita_Carpenteria")}`);
    const b=writer.valueId(`tq.label.${number(row,"ID_Label_Modalita_Pannello")}`,
      `tq.value.${number(row,"ID_Valore_Modalita_Pannello")}`);
    if(a===undefined||b===undefined){report.skip("exclusion_missing_value",string(row,"ID_Gruppo_Compatibilita"));continue;}
    count+=writer.addExclusion(a,b);
  }
  return count;
}

function importHierarchy(writer: EngineeringDataWriter, reader: MDBReader, importId: number,
  brandId: number, models: ModelIndex, report: Report,
  levelMap:Map<string,RangeSourceLevel>,groups:readonly RangeGroupSeed[]): Record<string,number> {
  writer.clearRangeMembership("tq.");
  const cache=new Map<string,{id:number;parent:number|null}>();
  const labelTables=([1,2,3] as const).map(level=>new Map(rows(reader,`ANA_GERARCHIA_${level}`)
    .map(row=>[number(row,`Id_Gerarchia_${level}`),string(row,`Descri_Gerarchia_${level}`)])));
  const usedLabels=([1,2,3] as const).map(()=>new Set<number>());
  const node=(code:string,name:string,kind:string,sourceLevel:string,parent:number|null,
    order:number,ref:string,levelCode:string|null,navigable:boolean,
    designNavigable=false):number|null=>{
    const old=cache.get(code);
    if(old){
      if(old.parent!==parent){
        report.conflict("hierarchy_parent_conflict");
        report.skip("hierarchy_parent_conflict",`${code}:${old.parent}->${parent}`);
        return null;
      }
      return old.id;
    }
    const id=writer.upsertRangeNode(brandId,parent,code,name,kind,order,importId,ref,
      sourceLevel,levelCode,navigable,designNavigable);
    if(id===undefined){report.skip("manual_range_override",code);return null;}
    cache.set(code,{id,parent});return id;
  };
  const hierarchyRows=rows(reader,"GERARCHIA").sort((a,b)=>
    Number(number(a,"ID_Gerarchia")===99999)-Number(number(b,"ID_Gerarchia")===99999));
  // Project-maintained groups: a member applies only when its source ID carries the approved name here.
  const g1Names=new Map<string,Set<string>>();
  for(const row of hierarchyRows){
    const value=number(row,"ID_Gerarchia_1");
    if(!value)continue;
    const key=`${number(row,"ID_Sistema")}:${value}`;
    const names=g1Names.get(key)??new Set([labelTables[0]!.get(value)??""]);
    names.add(string(row,"Descri_Gerarchia_1"));
    g1Names.set(key,names);
  }
  const groupOf=new Map<string,RangeGroupSeed>();
  for(const group of groups){
    if(group.sourceLevel!=="g1")throw new Error(`Unsupported TiQuadri range group level: ${group.sourceLevel}`);
    for(const member of group.members)for(const id of member.sourceIds){
      const key=`${group.systemId}:${id}`;
      const names=g1Names.get(key);
      if(!names){report.skip("navigation_group_member_missing",`${group.code}:${key}`);continue;}
      if(!names.has(member.name)){
        report.conflict("navigation_group_member_name_disagrees");
        report.skip("navigation_group_member_name_disagrees",`${group.code}:${key}`);
        continue;
      }
      groupOf.set(key,group);
    }
  }
  const groupedSystems=new Set(groups.map(group=>group.systemId));
  for(const key of g1Names.keys())
    if(groupedSystems.has(Number(key.split(":")[0]))&&!groupOf.has(key))
      report.skip("navigation_group_unmapped",key);
  const hierarchies=new Map<number,number>();
  const hierarchyNames=new Map<number,string>();
  const rangeSystems=new Map<number,number>();
  const systems=new Map<number,number>();
  for(const row of hierarchyRows){
    let parent:number|null=null;
    const system=number(row,"ID_Sistema");
    const range=number(row,"ID_Gerarchia");
    if(number(row,"ID_Macrofamiglia_Armadi"))report.skip("context_macrofamiglia_armadi_unapplied",String(range));
    const levels=[
      ["ID_Sistema","Descri_Sistema","section","system","GERARCHIA Sistema"],
      ["ID_Gerarchia_1","Descri_Gerarchia_1","level","g1","ANA_GERARCHIA_1"],
      ["ID_Gerarchia_2","Descri_Gerarchia_2","level","g2","ANA_GERARCHIA_2"],
      ["ID_Gerarchia_3","Descri_Gerarchia_3","level","g3","ANA_GERARCHIA_3"],
    ] as const;
    for(const [idField,nameField,kind,sourceLevel,sourceTable] of levels){
      const value=number(row,idField);
      if(!value)continue;
      const code=`tq.${sourceLevel}.${value}`;
      const level=sourceLevel==="g1"?0:sourceLevel==="g2"?1:sourceLevel==="g3"?2:null;
      if(level!==null)usedLabels[level]!.add(value);
      const name=(level===null?null:labelTables[level]!.get(value))
        ||string(row,nameField)||`${kind} ${value}`;
      if(level!==null&&labelTables[level]!.get(value)&&
        labelTables[level]!.get(value)!==string(row,nameField))
        report.conflict("hierarchy_label_copy_disagrees");
      const mapping=levelMap.get(`${system}:${sourceLevel}`);
      if(!mapping)throw new Error(`Missing TiQuadri range-level map: ${system}:${sourceLevel}`);
      const group=sourceLevel==="g1"?groupOf.get(`${system}:${value}`):undefined;
      if(group){
        parent=node(`tq.group.${system}.${group.code}`,group.name,"level","lq_group",parent,
          group.sortOrder,`LQ range-navigation seed group ${group.code}`,null,
          mapping.catalogueNavigable,range!==99999);
        if(parent===null)break;
      }
      parent=node(code,name,kind,sourceLevel,parent,
        number(row,"Ordine"),sourceRef(sourceTable,value),
        mapping.levelCode,mapping.catalogueNavigable,range!==99999);
      if(parent===null)break;
      if(sourceLevel==="system")systems.set(value,parent);
    }
    if(parent!==null){
      hierarchies.set(range,parent);
      hierarchyNames.set(range,String(row["Descri_Gerarchia"]??""));
      rangeSystems.set(range,system);
    }
  }
  labelTables.forEach((table,level)=>{
    for(const key of table.keys())if(!usedLabels[level]!.has(key))
      report.skip("hierarchy_label_without_range",`ANA_GERARCHIA_${level+1}:${key}`);
  });
  const sourceHierarchyIds=new Set(hierarchies.keys());
  const classes=new Map(rows(reader,"ANA_CLASSE").map(row=>[number(row,"Id_Classe"),row]));
  for(const [id,row] of classes)
    if(!bool(row,"Classe_Visibile_Senza_Struttura"))
      report.skip("context_class_without_structure_unapplied",String(id));
  const orphanSystems=new Map(rows(reader,"ANA_SISTEMA")
    .map(row=>[number(row,"Id_Gerarchia"),row]));
  let assigned=0;
  for(const row of rows(reader,"ASS_GERARCHIA_CLASSE_PACK")){
    const range=number(row,"ID_Gerarchia"),classKey=number(row,"ID_Classe"),pack=number(row,"ID_Pack");
    let parent=hierarchies.get(range);
    if(parent===undefined){
      const source=orphanSystems.get(range);
      parent=node(`tq.orphan.range.${range}`,
        (source?string(source,"Descri_Gerarchia"):string(row,"Descri_Gerarchia"))||`Range ${range}`,
        "level","orphan",source?systems.get(number(source,"Id_Sistema"))??null:null,
        number(row,"Ordine"),source?sourceRef("ANA_SISTEMA",range):
          sourceRef("ASS_GERARCHIA_CLASSE_PACK",range),null,false)??undefined;
      if(parent!==undefined){hierarchies.set(range,parent);report.skip("range_without_hierarchy_parent",String(range));}
    }
    const model=models.ids.get(pack),classRow=classes.get(classKey);
    const copiedName=String(row["Descri_Gerarchia"]??"");
    const hierarchyName=hierarchyNames.get(range);
    if(hierarchyName!==undefined&&hierarchyName!==copiedName)
      report.conflict("range_name_copy_disagrees");
    const orphanName=orphanSystems.get(range)?.["Descri_Gerarchia"];
    if(hierarchyName===undefined&&orphanName!==undefined&&String(orphanName??"")!==copiedName)
      report.conflict("orphan_range_name_copy_disagrees");
    if(classRow&&string(classRow,"Descri_Classe")!==string(row,"Descri_Classe"))
      report.conflict("class_name_copy_disagrees");
    if(parent===undefined||model===undefined){report.skip("range_missing_reference",`${range}:${classKey}:${pack}`);continue;}
    const system=rangeSystems.get(range)??(orphanSystems.get(range)?number(orphanSystems.get(range)!,"Id_Sistema"):null);
    const classMapping=system===null?null:levelMap.get(`${system}:class`);
    if(system!==null&&!classMapping)throw new Error(`Missing TiQuadri class map: ${system}`);
    const classNode=node(`tq.range.${range}.class.${classKey}`,
      classRow?string(classRow,"Descri_Classe"):string(row,"Descri_Classe"),
      "group","class",parent,classRow?number(classRow,"Ordine"):number(row,"Ordine"),
      sourceRef("ANA_CLASSE",classKey),classMapping?.levelCode??null,
      sourceHierarchyIds.has(range)&&(classMapping?.catalogueNavigable??false),
      sourceHierarchyIds.has(range)&&range!==99999);
    if(classNode!==null)assigned+=writer.addRangeModel(classNode,model,number(row,"Ordine"));
  }
  return {hierarchies:hierarchies.size,nodes:cache.size,assignments:assigned,groupedNodes:groupOf.size};
}

function importContexts(writer: EngineeringDataWriter, reader: MDBReader, importId: number,
  brandId: number, models: ModelIndex): Record<string,number> {
  const acceptedByPack=new Map<number,Set<number>>();
  const branches=new Map(rows(reader,"GERARCHIA")
    .filter(row=>number(row,"ID_Gerarchia")!==99999)
    .map(row=>[number(row,"ID_Gerarchia"),parseList(string(row,"Armadi_Compatibili"))]));
  for(const row of rows(reader,"ASS_GERARCHIA_CLASSE_PACK")){
    const pack=number(row,"ID_Pack"),range=number(row,"ID_Gerarchia");
    const contexts=branches.get(range);
    if(!contexts)continue;
    const accepted=acceptedByPack.get(pack)??new Set<number>();
    for(const context of contexts)accepted.add(context);
    acceptedByPack.set(pack,accepted);
  }
  const used=new Set<number>();
  for(const pack of models.packs){
    const packId=number(pack,"ID_Pack");
    if(number(pack,"Famiglia_Apparecchi")===0&&number(pack,"Famiglia_Pannelli")===0&&
      number(pack,"Sotto_Famiglia_Armadi")!==99)
      used.add(number(pack,"Famiglia_Armadi"));
    else for(const context of acceptedByPack.get(packId)??[])used.add(context);
  }
  const contextIds=new Map<number,number>();
  for(const context of used)if(context>0)contextIds.set(context,writer.upsertContext(
    brandId,`tq.ctx.${context}`,`Enclosure context ${context}`,importId,
    sourceRef("GERARCHIA/ANA_PACK context",context)));
  let providers=0,acceptors=0,acceptedRows=0;
  const provided=new Set<number>();
  for(const pack of models.packs){
    const packId=number(pack,"ID_Pack"),modelId=models.ids.get(packId);
    if(modelId===undefined)continue;
    const enclosure=number(pack,"Famiglia_Apparecchi")===0&&
      number(pack,"Famiglia_Pannelli")===0&&number(pack,"Sotto_Famiglia_Armadi")!==99;
    if(enclosure){
      const context=number(pack,"Famiglia_Armadi");
      const contextId=contextIds.get(context);
      writer.replaceModelContexts(modelId,"provides",contextId===undefined?[]:[contextId]);
      writer.replaceModelContexts(modelId,"accepts",[]);
      writer.setModelContextPolicy(modelId,"unrestricted");
      if(contextId!==undefined){providers++;provided.add(context);}
    }else{
      const contexts=[...(acceptedByPack.get(packId)??[])].map(code=>contextIds.get(code))
        .filter((id):id is number=>id!==undefined);
      writer.replaceModelContexts(modelId,"provides",[]);
      writer.replaceModelContexts(modelId,"accepts",contexts);
      writer.setModelContextPolicy(modelId,"restricted");
      if(contexts.length){acceptors++;acceptedRows+=contexts.length;}
    }
  }
  writer.deactivateAbsentContexts(importId,brandId,"tq.ctx.");
  return {classes:contextIds.size,classesWithoutProvider:[...contextIds.keys()]
    .filter(code=>!provided.has(code)).length,providingEnclosures:providers,
    acceptingModels:acceptors,acceptedRows};
}

function reportDeferred(reader: MDBReader, report: Report, frontLabelRows: ReadonlySet<number>): void {
  for(const [table,reason] of [
    ["POTENZE","thermal_deferred"],["COEFF_DICH","thermal_deferred"],
    ["QUADRI_MULTI","thermal_deferred"],["ANA_CURVE_TEMP","thermal_deferred"],
    ["ART_TISYSTEM","tisystem_deferred"],
    ["QUADRI_WARNING","project_warnings_deferred"],
    ["Compatibilita_Profondita_Armadi","depth_substitution_deferred"],
    ["ANA_DESCRI_CLASSE_MEMO","class_memo_semantics_unknown"],
  ]) report.skip(reason,table,reader.getTable(table).rowCount);
  const fields=[
    ["ID_Macrofamiglia_Armadi_1","context_flags_unverified"],
    ["ID_Macrofamiglia_Armadi_2","context_flags_unverified"],
    ["ID_Macrofamiglia_Armadi_3","context_flags_unverified"],
    ["ID_Macrofamiglia_Armadi_4","context_flags_unverified"],
    ["ID_Macrofamiglia_Armadi_5","context_flags_unverified"],
    ["Segue_Modalita_Pannello","linkage_flags_unverified"],
    ["Test_Compatibilita_Contenuto","content_compatibility_flag_unapplied"],
    ["Block","drawing_overlay_deferred"],["Flag_Block","drawing_overlay_deferred"],
    ["Dim_block_X","drawing_overlay_deferred"],["Dim_block_Y","drawing_overlay_deferred"],
    ["Offset_block_X","drawing_overlay_deferred"],["Offset_block_Y","drawing_overlay_deferred"],
    ["Num_Blocco_AUX","drawing_overlay_deferred"],
    ["POWER_WATT","thermal_deferred"],["K_RIDUZ","thermal_deferred"],
    ["POWER_WATT_RIDUZ","thermal_deferred"],["Potenza_aggiunta","thermal_deferred"],
    ["Mod_1_MOD_Tisys","tisystem_deferred"],["Mod_2_MOD_Tisys","tisystem_deferred"],
    ["Accessori_Tisys","tisystem_deferred"],
    ["Label_Stampa","presentation_metadata_unmapped"],
  ] as const;
  for(const row of rows(reader,"ANA_MODALITA",["Id_Index_Modalita",...fields.map(([field])=>field)])){
    for(const [field,reason] of fields){
      if(reason==="drawing_overlay_deferred"&&field!=="Num_Blocco_AUX"&&frontLabelRows.has(number(row,"Id_Index_Modalita")))continue;
      const value=row[field];
      if(value!==null&&value!==undefined&&value!==false&&value!==0&&value!=="")
        report.skip(reason,`${number(row,"Id_Index_Modalita")}:${field}`);
    }
  }
  for(const row of rows(reader,"ANA_PACK",["ID_Pack","Categoria_pacchetto",
    "Visualizza_articoli_doppio_click","Numero"])){
    const key=String(number(row,"ID_Pack"));
    if(number(row,"Categoria_pacchetto")!==0)report.skip("presentation_metadata_unmapped",`${key}:Categoria_pacchetto`);
    if(bool(row,"Visualizza_articoli_doppio_click"))report.skip("presentation_metadata_unmapped",`${key}:Visualizza_articoli_doppio_click`);
    if(bool(row,"Numero"))report.skip("presentation_metadata_unmapped",`${key}:Numero`);
  }
  for(const row of rows(reader,"ANA_ARMADI",["Id_Pack","Wizard"]))
    if(bool(row,"Wizard"))report.skip("presentation_metadata_unmapped",`${number(row,"Id_Pack")}:Wizard`);
  for(const row of rows(reader,"ASS_PANNELLI_QUADRI_APPARECCHI",["Famiglia_Apparecchi","PESO_CIRCUITI_COEFF"]))
    if(number(row,"PESO_CIRCUITI_COEFF")!==0)
      report.skip("thermal_deferred",`${number(row,"Famiglia_Apparecchi")}:PESO_CIRCUITI_COEFF`);
}

function compareListinoModules(database: Database.Database, writer: EngineeringDataWriter, reader: MDBReader,
  importId: number, report: Report): Record<string,unknown> {
  const modules=new Map<string,number>();
  for(const row of rows(reader,"ANA_ART_MONTAGGIO",["ART_COD","POLI_DIN"])){
    const value=number(row,"POLI_DIN");
    if(value>0)modules.set(string(row,"ART_COD").toUpperCase().replace(/[^A-Z0-9]/g,""),value*2);
  }
  const models=database.prepare(`SELECT id,base_profile_id FROM cat_config_model
    WHERE source='import' AND active=1 AND model_kind='device' AND base_profile_id IS NOT NULL`)
    .all() as Array<{id:number;base_profile_id:number}>;
  const opts=database.prepare(`SELECT o.id,o.parent_option_id FROM cat_config_option o
    JOIN cat_config_axis a ON a.id=o.axis_id WHERE a.model_id=? AND o.is_default=1`);
  const rules=database.prepare(`SELECT id FROM cat_config_rule WHERE model_id=?`);
  const conditions=database.prepare(`SELECT option_id FROM cat_config_rule_condition WHERE rule_id=?`).pluck();
  const effects=database.prepare(`SELECT effect_kind,ref_manufacturer_code AS code,quantity,int_value
    FROM cat_config_rule_effect WHERE rule_id=?`);
  const fixed=database.prepare(`SELECT ref_manufacturer_code AS code,quantity
    FROM cat_config_model_article WHERE model_id=?`);
  const base=database.prepare(`SELECT profile_set_id,profile_key FROM cat_phys_profile WHERE id=?`);
  const variant=database.prepare(`SELECT id FROM cat_phys_profile WHERE profile_set_id=? AND profile_key=?`);
  const demand=database.prepare(`SELECT amount FROM cat_phys_profile_demand
    WHERE profile_id=? AND capacity_kind_code='din_rail'`);
  const counts={singleArticleCompared:0,assemblyOrUnresolved:0,missingListino:0,
    missingProfile:0,dinModuleConflicts:0,primaryVariantsCompared:0};
  const reportedConflicts=new Set<string>();
  const samples:Record<string,string[]>={assemblyOrUnresolved:[],missingListino:[],missingProfile:[],dinModuleConflicts:[]};
  const sample=(key:string,value:string)=>{if(samples[key]!.length<40)samples[key]!.push(value);};
  for(const model of models){
    const defaults=opts.all(model.id) as Array<{id:number;parent_option_id:number|null}>;
    const selected=new Set(defaults.filter(x=>x.parent_option_id===null).map(x=>x.id));
    for(const item of defaults)if(item.parent_option_id!==null&&selected.has(item.parent_option_id))selected.add(item.id);
    const bom=new Map<string,number>();
    const add=(code:string,quantity:number)=>bom.set(code,(bom.get(code)??0)+quantity);
    for(const row of fixed.all(model.id) as Array<{code:string;quantity:number}>)add(row.code,row.quantity);
    let delta=0;
    for(const rule of rules.all(model.id) as Id[]){
      const needed=conditions.all(rule.id) as number[];
      if(!needed.every(id=>selected.has(id)))continue;
      for(const effect of effects.all(rule.id) as Array<{
        effect_kind:string;code:string|null;quantity:number|null;int_value:number|null
      }>){
        if(effect.effect_kind==="article"&&effect.code&&effect.quantity)add(effect.code,effect.quantity);
        if(effect.effect_kind==="profile_key_delta")delta+=effect.int_value??0;
      }
    }
    const articles=[...bom.entries()].filter(([,qty])=>qty>0);
    if(articles.length!==1||articles[0]![1]!==1){
      counts.assemblyOrUnresolved++;sample("assemblyOrUnresolved",`${model.id}: ${JSON.stringify(articles).slice(0,180)}`);continue;
    }
    const code=articles[0]![0].toUpperCase().replace(/[^A-Z0-9]/g,"");
    const listino=modules.get(code);
    if(listino===undefined){counts.missingListino++;sample("missingListino",`${model.id}:${code}`);continue;}
    const initial=base.get(model.base_profile_id) as {profile_set_id:number;profile_key:number};
    const effective=variant.get(initial.profile_set_id,initial.profile_key+delta) as Id|undefined;
    const amount=effective?(demand.get(effective.id) as {amount:number}|undefined)?.amount:undefined;
    if(amount===undefined){counts.missingProfile++;sample("missingProfile",`${model.id}:${code}`);continue;}
    counts.singleArticleCompared++;
    if(amount!==listino){
      counts.dinModuleConflicts++;
      reportedConflicts.add(`${code}:${amount}:${listino}`);
      sample("dinModuleConflicts",`${model.id}:${code}:${amount}/${listino}`);
      conflict(writer,importId,report,"article",articles[0]![0],"din_modules",
        String(amount),"TiQuadri half-modules",String(listino),"ListinoBT modules × 2");
    }
  }
  const allOptions=database.prepare(`SELECT o.id,o.axis_id,o.parent_option_id,o.is_default,
    a.selects_primary FROM cat_config_option o JOIN cat_config_axis a ON a.id=o.axis_id
    WHERE a.model_id=?`);
  const comparedCandidates=new Set<string>();
  for(const model of models){
    const initial=base.get(model.base_profile_id) as {profile_set_id:number;profile_key:number};
    const options=allOptions.all(model.id) as Array<{
      id:number;axis_id:number;parent_option_id:number|null;is_default:number;selects_primary:number
    }>;
    const primary=options.filter(x=>x.selects_primary===1&&x.parent_option_id===null);
    for(const chosen of primary){
      const selected=new Set(options.filter(x=>x.parent_option_id===null&&x.is_default===1
        &&x.axis_id!==chosen.axis_id).map(x=>x.id));
      selected.add(chosen.id);
      for(const option of options)if(option.is_default===1&&option.parent_option_id!==null
        &&selected.has(option.parent_option_id))selected.add(option.id);
      const bom=new Map<string,number>();
      for(const row of fixed.all(model.id) as Array<{code:string;quantity:number}>)
        bom.set(row.code,(bom.get(row.code)??0)+row.quantity);
      let delta=0;
      for(const rule of rules.all(model.id) as Id[]){
        const needed=conditions.all(rule.id) as number[];
        if(!needed.every(id=>selected.has(id)))continue;
        for(const effect of effects.all(rule.id) as Array<{
          effect_kind:string;code:string|null;quantity:number|null;int_value:number|null
        }>){
          if(effect.effect_kind==="article"&&effect.code&&effect.quantity)
            bom.set(effect.code,(bom.get(effect.code)??0)+effect.quantity);
          if(effect.effect_kind==="profile_key_delta")delta+=effect.int_value??0;
        }
      }
      const articles=[...bom.entries()].filter(([,qty])=>qty>0);
      if(articles.length!==1||articles[0]![1]!==1)continue;
      const code=articles[0]![0].toUpperCase().replace(/[^A-Z0-9]/g,"");
      const listino=modules.get(code);
      if(listino===undefined)continue;
      const profile=variant.get(initial.profile_set_id,initial.profile_key+delta) as Id|undefined;
      const amount=profile?(demand.get(profile.id) as {amount:number}|undefined)?.amount:undefined;
      if(amount===undefined)continue;
      const identity=`${model.id}:${code}:${initial.profile_key+delta}:${amount}:${listino}`;
      if(comparedCandidates.has(identity))continue;
      comparedCandidates.add(identity);counts.primaryVariantsCompared++;
      const conflictKey=`${code}:${amount}:${listino}`;
      if(amount!==listino&&!reportedConflicts.has(conflictKey)){
        reportedConflicts.add(conflictKey);counts.dinModuleConflicts++;
        sample("dinModuleConflicts",`${model.id}:${code}:${amount}/${listino}`);
        conflict(writer,importId,report,"article",articles[0]![0],"din_modules",
          String(amount),"TiQuadri half-modules",String(listino),"ListinoBT modules × 2");
      }
    }
  }
  return {...counts,samples};
}

function reconcile(actual: Record<string,number>): Record<string,{actual:number;reference:number;difference:number}> {
  const reference:Record<string,number>={
    activeModels:7823,obsoleteModels:2977,active_device:1299,active_support:1270,
    active_enclosure:604,active_accessory:4650,activeDimensions:157,activeValues:1041,
    axes:10769,options:51307,rules:48609,articleEffectSourceRows:90950,
    articleEffectsAggregated:60830,baseArticleSourceRows:10714,baseArticlesAggregated:8923,
    deviceProfiles:6507,supportProfiles:1689,activeEnclosuresWithGeometry:595,
    activeEnclosuresWithoutGeometry:9,acceptSets:492,
    devicePanelAcceptSets:380,deviceEnclosureAcceptSets:53,panelEnclosureAcceptSets:59,
    distinctConcreteArticles:4718,
  };
  return Object.fromEntries(Object.entries(reference).map(([key,value])=>[
    key,{actual:actual[key]??0,reference:value,difference:(actual[key]??0)-value},
  ]));
}

function inspectReferences(database: Database.Database, writer: EngineeringDataWriter, importId: number,
  models: ModelIndex, brandMap: Map<string,string|null>, report: Report) {
  const products=database.prepare(`SELECT p.id,p.code_norm,b.metel_marchio AS marchio
    FROM cat_product p JOIN cat_brand b ON b.id=p.brand_id`).all() as
    Array<{id:number;code_norm:string;marchio:string}>;
  const byIdentity=new Map(products.map(p=>[`${p.marchio}\0${p.code_norm}`,p.id]));
  const byCode=new Map<string,Array<{id:number;marchio:string}>>();
  for(const product of products){
    const bucket=byCode.get(product.code_norm)??[];
    bucket.push({id:product.id,marchio:product.marchio});byCode.set(product.code_norm,bucket);
  }
  const unresolved:Record<string,number>={};
  const unresolvedBeforeCrossBrand:Record<string,number>={};
  const unresolvedObsolete:Record<string,number>={};
  const matchedOtherBrand:Record<string,number>={};
  const matchedOtherBrandKeys:string[]=[];
  for(const {prefix,code} of models.activeArticles.values()){
    const marchio=brandMap.get(prefix);
    const normalized=code.toUpperCase().replace(/[^A-Z0-9]/g,"");
    if(marchio&&byIdentity.has(`${marchio}\0${normalized}`))continue;
    unresolvedBeforeCrossBrand[prefix]=(unresolvedBeforeCrossBrand[prefix]??0)+1;
    const elsewhere=marchio?byCode.get(normalized):undefined;
    if(marchio&&elsewhere?.length===1){
      matchedOtherBrand[prefix]=(matchedOtherBrand[prefix]??0)+1;
      matchedOtherBrandKeys.push(`${prefix}${code} -> ${elsewhere[0]!.marchio}`);
      conflict(writer,importId,report,"brand",`${prefix}${code}`,"brand",marchio,
        "cat_source_brand_map",elsewhere[0]!.marchio,"METEL", "Unique code under another METEL marchio");
      continue;
    }
    unresolved[prefix]=(unresolved[prefix]??0)+1;
    conflict(writer,importId,report,"article",`${prefix}${code}`,
      marchio?"missing_article":"unmapped_brand",code,"TiQuadri",marchio??null,"METEL mapping");
  }
  for(const {prefix,code} of models.obsoleteArticles.values()){
    const marchio=brandMap.get(prefix);
    const normalized=code.toUpperCase().replace(/[^A-Z0-9]/g,"");
    if(marchio&&byIdentity.has(`${marchio}\0${normalized}`))continue;
    if(marchio&&byCode.get(normalized)?.length===1)continue;
    unresolvedObsolete[prefix]=(unresolvedObsolete[prefix]??0)+1;
  }
  return {unresolvedActiveByPrefix:unresolved,unresolvedBeforeCrossBrandByPrefix:unresolvedBeforeCrossBrand,
    unresolvedObsoleteByPrefix:unresolvedObsolete,matchedOtherBrand,matchedOtherBrandKeys};
}

function auditPhysicalReferences(database: Database.Database, writer: EngineeringDataWriter, importId: number,
  report: Report): Record<string,number> {
  const missing=database.prepare(`SELECT m.code AS model_code,b.profile_key AS base_key,
    e.int_value AS delta FROM cat_config_model m
    JOIN cat_phys_profile b ON b.id=m.base_profile_id
    JOIN cat_config_rule r ON r.model_id=m.id
    JOIN cat_config_rule_effect e ON e.rule_id=r.id AND e.effect_kind='profile_key_delta'
    LEFT JOIN cat_phys_profile p ON p.profile_set_id=b.profile_set_id
      AND p.profile_key=b.profile_key+e.int_value
    WHERE m.active=1 AND p.id IS NULL`).all() as
    Array<{model_code:string;base_key:number;delta:number}>;
  for(const row of missing)conflict(writer,importId,report,"profile",row.model_code,
    "unreachable_profile",String(row.base_key+row.delta),"TiQuadri option",
    null,"TiQuadri physical profiles",`Single-option delta ${row.delta}`);
  const orphan=database.prepare(`SELECT c.code FROM cat_phys_class c WHERE c.code LIKE 'tq.arm.%'
    AND NOT EXISTS(SELECT 1 FROM cat_phys_profile p WHERE p.fit_class_id=c.id)`)
    .all() as Array<{code:string}>;
  for(const row of orphan)conflict(writer,importId,report,"profile",row.code,
    "orphan_enclosure_key",row.code,"TiQuadri compatibility",null,"TiQuadri enclosure profiles");
  const count=(table:string)=>database.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;
  return {singleOptionNoProfile:missing.length,orphanEnclosureClasses:orphan.length,
    classes:count("cat_phys_class"),constraintRows:count("cat_phys_constraint"),
    acceptSetMembers:count("cat_phys_accept_set_member"),views:count("cat_phys_view"),
    zones:count("cat_phys_zone"),slots:count("cat_phys_zone_slot")};
}

/**
 * Writes the normalized capacity-filler designation (cat_config_capacity_filler) for each reviewed seed
 * entry whose source still matches: same pack name, the executable's modalità and single label axis, an
 * active device model, and every option's physical profile demanding only the declared capacity kind.
 * A mismatch is a recorded conflict and designates nothing; import-owned designations are rebuilt.
 */
export function importCapacityFillers(database:Database.Database,writer:EngineeringDataWriter,reader:MDBReader,
  importId:number,brandId:number,models:ModelIndex,report:Report,approvals:readonly CapacityFillerApproval[]):
  {designated:number;rejected:number;widths:Record<string,number[]>} {
  database.prepare(`DELETE FROM cat_config_capacity_filler WHERE source='import' AND model_id IN
    (SELECT id FROM cat_config_model WHERE brand_id=? AND code LIKE 'tq.pack.%')`).run(brandId);
  const packs=new Map(models.packs.map(pack=>[number(pack,"ID_Pack"),pack]));
  const definitions=group(rows(reader,"ANA_MODALITA"),"Id_Modalita");
  const widths:Record<string,number[]>={};
  let designated=0,rejected=0;
  for(const approval of approvals){
    const packId=Number(approval.sourceRef.split(" ").at(-1));
    const pack=packs.get(packId),modelId=models.ids.get(packId);
    const refuse=(reason:string)=>{
      rejected++;
      conflict(writer,importId,report,"model",`tq.pack.${packId}`,"capacity_filler",approval.capacityKind,
        "reviewed seed",null,"raw TiQuadri source",reason);
    };
    if(!pack||modelId===undefined){refuse("pack not imported");continue;}
    if(string(pack,"Descri_Pack")!==approval.reviewedName){refuse(`name ${string(pack,"Descri_Pack")}`);continue;}
    if(number(pack,"Id_Modalita")!==approval.sourceModalita){refuse(`Id_Modalita ${number(pack,"Id_Modalita")}`);continue;}
    const definition=definitions.get(approval.sourceModalita)??[];
    if(!definition.length||definition.some(row=>number(row,"ID_Label_Modalita_1")!==approval.sourceLabel||
      number(row,"ID_Label_Modalita_2")!==0)){refuse("modalità axis differs");continue;}
    const model=database.prepare(`SELECT m.model_kind AS kind,m.active,m.obsolete,b.profile_set_id AS setId,
      b.profile_key AS baseKey FROM cat_config_model m JOIN cat_phys_profile b ON b.id=m.base_profile_id
      WHERE m.id=?`).get(modelId) as {kind:string;active:number;obsolete:number;setId:number;baseKey:number}|undefined;
    if(!model||model.kind!=="device"||model.active!==1||model.obsolete!==0){refuse("not an active device with a profile");continue;}
    const deltas=new Set(definition.map(row=>number(row,"Aumenta_Famiglia")));
    const amounts:number[]=[];
    let valid=true;
    for(const delta of deltas){
      const profile=database.prepare(`SELECT id FROM cat_phys_profile WHERE profile_set_id=? AND profile_key=?
        AND active=1`).get(model.setId,model.baseKey+delta) as {id:number}|undefined;
      const demands=profile?database.prepare(`SELECT capacity_kind_code AS kind,amount FROM cat_phys_profile_demand
        WHERE profile_id=? AND amount>0`).all(profile.id) as {kind:string;amount:number}[]:[];
      if(demands.length!==1||demands[0]!.kind!==approval.capacityKind){valid=false;break;}
      amounts.push(demands[0]!.amount);
    }
    if(!valid){refuse(`an option profile does not demand only ${approval.capacityKind}`);continue;}
    database.prepare(`INSERT INTO cat_config_capacity_filler(model_id,capacity_kind_code,source,source_ref)
      VALUES (?,?,'import',?)`).run(modelId,approval.capacityKind,approval.sourceRef);
    widths[`tq.pack.${packId}`]=[...new Set(amounts)].sort((a,b)=>a-b);
    designated++;
  }
  return {designated,rejected,widths};
}

/** Shared read-only identity validation for the importer and developer bootstrap preflight. */
export function readTiQuadriMasterSource(buffer: Buffer): {reader: MDBReader; metadata: Row} {
  const reader = new MDBReader(buffer);
  const metadata = rows(reader,"ANA_DB")[0];
  if(!metadata||string(metadata,"KEY")!=="TIPRE"||!bool(metadata,"IsQuadri"))
    throw new Error("Source is not a TiQuadri master MDB");
  return {reader,metadata};
}

/** Exact importer identity, also used by the read-only development sync planner. */
export function tiQuadriImportIdentity(fileSha: string, listinoSha: string | null, seedFolder?: string) {
  const navigationSeed=loadRangeNavigationSeed(seedFolder);
  const approvals=contributionApprovals(seedFolder);
  const fillerApprovals=capacityFillerApprovals(seedFolder);
  const presentationApprovals=loadPanelPresentationApprovals(seedFolder);
  const capacityKinds=loadCapacityKindSeed(seedFolder);
  const sourceBrandMap=loadSourceBrandMapSeed(seedFolder);
  const adapter=TIQUADRI_ENGINEERING_ADAPTER;
  const seedHashes=[navigationSeed,approvals,fillerApprovals,presentationApprovals,REVIEWED_EMPTY_BOM_PANELS,REVIEWED_FACTORY_PRESETS,
    capacityKinds,sourceBrandMap].map(value=>sha(JSON.stringify(value)));
  // This presentation import adds catalogue artwork without changing engineering snapshot compatibility.
  const fingerprint=sha([adapter.code,adapter.version,fileSha,listinoSha??"",...seedHashes,
    ENGINEERING_LINK_POLICY_VERSION,"front-option-labels-v1"].join(":"));
  return { fingerprint, navigationSeed, approvals, fillerApprovals, presentationApprovals, capacityKinds, sourceBrandMap };
}

/** Reads a user-supplied master MDB and commits one complete normalized source import. */
export async function importTiQuadri(options: TiQuadriImportOptions): Promise<TiQuadriImportResult> {
  const database=options.database;
  const writer=new EngineeringDataWriter(database);
  writer.assertOutsideTransaction();
  const sourcePath=path.resolve(options.sourcePath);
  const buffer=readFileSync(sourcePath);
  const fileSha=sha(buffer);
  const listinoBuffer=options.listinoPath?readFileSync(path.resolve(options.listinoPath)):null;
  const listinoSha=listinoBuffer?sha(listinoBuffer):null;
  const adapter=TIQUADRI_ENGINEERING_ADAPTER;
  const {fingerprint,navigationSeed,approvals,fillerApprovals,presentationApprovals,capacityKinds,sourceBrandMap}=
    tiQuadriImportIdentity(fileSha,listinoSha,options.seedFolder);
  const existing=writer.findImport(fingerprint);
  const readiness=readEngineeringReadiness(database).sources.find(row=>row.adapterCode===adapter.code);
  if(existing?.became_current===1&&existing.adapter_version===adapter.version&&readiness?.status==="ready")return {importId:existing.id,fingerprint,alreadyImported:true,
    summary:JSON.parse(existing.summary_json) as Record<string,unknown>};
  const {reader,metadata}=readTiQuadriMasterSource(buffer);
  const reviewedMaster=fileSha===REVIEWED_FACTORY_PRESETS.masterSha256;
  const presetRows=rows(reader,"ASS_MACRO_CENTRALINI").sort((a,b)=>number(a,"Ordine")-number(b,"Ordine")).map(row=>{
    const correctedP17=(REVIEWED_FACTORY_PRESETS.p17SocketAnchorCorrection as readonly number[])
      .includes(number(row,"ID_Pack_Quadro"));
    // The 105 mm opening in both DXF blocks starts at (150, 281).
    return reviewedMaster&&correctedP17&&number(row,"ID_Pack_Pannello")===4606&&
      bool(row,"Pos_Pan_XY_assoluti")&&number(row,"Inserimento_X")===155&&number(row,"Inserimento_Y")===281
      ?{...row,Inserimento_X:150}:row;
  });
  const factoryChildren=new Set<number>();
  if(reviewedMaster){
    const articlePacks=new Set(rows(reader,"ANA_ART_PACK").map(row=>number(row,"Id_Pack")));
    const articleFree=new Set(rows(reader,"ANA_PACK").filter(row=>
      number(row,"Famiglia_Pannelli")>0 && number(row,"Id_Modalita")===0 && !articlePacks.has(number(row,"ID_Pack")))
      .map(row=>number(row,"ID_Pack")));
    for(const row of presetRows){
      const parent=number(row,"ID_Pack_Quadro"),child=number(row,"ID_Pack_Pannello");
      if(presetPlacementMode(row)==="fixed"&&articleFree.has(child)&&reviewedFactoryChild(parent,child))
        factoryChildren.add(child);
    }
  }
  mkdirSync(options.archiveDirectory,{recursive:true});
  const archived=path.join(options.archiveDirectory,`${fileSha}.mdb`);
  if(existsSync(archived)){
    if(sha(readFileSync(archived))!==fileSha)throw new Error(`Archived source hash mismatch: ${archived}`);
  }else writeFileSync(archived,buffer,{flag:"wx"});
  if(listinoBuffer&&listinoSha){
    const archivedListino=path.join(options.archiveDirectory,`${listinoSha}.mdb`);
    if(existsSync(archivedListino)){
      if(sha(readFileSync(archivedListino))!==listinoSha)throw new Error(`Archived source hash mismatch: ${archivedListino}`);
    }else writeFileSync(archivedListino,listinoBuffer,{flag:"wx"});
  }
  mkdirSync(options.backupDirectory,{recursive:true});
  const backup=path.join(options.backupDirectory,`librequadri-pre-tiquadri-${Date.now()}.db`);
  await database.backup(backup);

  const result=writer.transaction(():TiQuadriImportResult=>{
    const report=new Report();
    const now=(options.importedAt??new Date()).toISOString();
    const importId=writer.beginImport({adapterCode:adapter.code,adapterVersion:adapter.version,
      sourceLabel:string(metadata,"Descri"),fingerprint,importedAt:now,
      files:[
        {role:"master",sha256:fileSha,name:path.basename(sourcePath),byteSize:buffer.length},
        ...(listinoBuffer&&listinoSha?[{role:"listino",sha256:listinoSha,
          name:path.basename(options.listinoPath!),byteSize:listinoBuffer.length}]:[]),
      ]});
    const seedFolder=options.seedFolder;
    writer.prepareSeeds(capacityKinds,sourceBrandMap);
    synchronizeRangeNavigationSeed(database,navigationSeed);
    const navigationLevels=sourceLevelMap(database,"tiquadri");
    const brandId=writer.ensureBrand("BTI","BTicino");
    const brandMap=prepareBrandMap(database,sourceBrandMap);
    const physical=importPhysical(writer,reader,importId,report,presentationApprovals,factoryChildren,presetRows);
    const models=importModels(writer,reader,importId,brandId,brandMap,physical,report,approvals,presetRows);
    const factoryModels=importFactoryModels(writer,models,physical,brandId,importId,factoryChildren);
    const relations=importRelations(writer,presetRows,models,physical,report,factoryModels,reviewedMaster);
    const exclusions=importExclusions(writer,reader,report);
    const hierarchy=importHierarchy(writer,reader,importId,brandId,models,report,navigationLevels,
      navigationSeed.groups.filter(group=>group.adapterCode==="tiquadri"));
    const contexts=importContexts(writer,reader,importId,brandId,models);
    const capacityFillers=importCapacityFillers(database,writer,reader,importId,brandId,models,report,fillerApprovals);
    reportDeferred(reader,report,models.frontLabelRows);
    writer.deactivateAbsent(importId,brandId,"tq.pack.","tq.","tq.label.","tq.");
    contexts.classesWithoutActiveProvider=Number(database.prepare(`SELECT COUNT(*)
      FROM cat_config_context c WHERE c.brand_id=? AND c.code LIKE 'tq.ctx.%' AND c.active=1
      AND NOT EXISTS (SELECT 1 FROM cat_config_model_context mc
        JOIN cat_config_model m ON m.id=mc.model_id
        WHERE mc.context_id=c.id AND mc.role='provides' AND m.active=1 AND m.obsolete=0)`)
      .pluck().get(brandId));
    contexts.classesWithObsoleteProvidersOnly=
      contexts.classesWithoutActiveProvider-contexts.classesWithoutProvider;
    writer.refreshLinks();
    const vocabulary=synchronizeDerivedCatalogue(database,{categorySeed:loadCategorySeed(seedFolder),
      attributeSeed:loadAttributeSeed(seedFolder),engineeringVocabulary:loadEngineeringVocabularySeed(seedFolder),
      siemensNavigationSeed:loadSiemensNavigationSeed(seedFolder)});
    reportEngineeringVocabularyWarnings(report,vocabulary);
    synchronizeProductFamilySeed(database,loadProductFamilySeed(seedFolder));
    const references=inspectReferences(database,writer,importId,models,brandMap,report);
    const physicalAudit=auditPhysicalReferences(database,writer,importId,report);
    const moduleComparison=listinoBuffer
      ?compareListinoModules(database,writer,new MDBReader(listinoBuffer),importId,report)
      :null;
    if(!moduleComparison)report.skip("module_comparison_requires_listino","ListinoBT.mdb");
    const actual={...physical.counts,...models.counts,
      acceptSets:writer.acceptSetCount("tq.accept."),
      devicePanelAcceptSets:writer.acceptSetCount("tq.accept.device_panel."),
      deviceEnclosureAcceptSets:writer.acceptSetCount("tq.accept.device_enclosure."),
      panelEnclosureAcceptSets:writer.acceptSetCount("tq.accept.panel_enclosure."),
      distinctConcreteArticles:models.activeArticles.size};
    const comparison=reconcile(actual);
    const discrepancies=Object.entries(comparison).filter(([,row])=>row.difference!==0)
      .map(([key,row])=>({measure:key,...row}));
    const referenceBT=references.unresolvedBeforeCrossBrandByPrefix["BT-"]??0;
    const crossBrand=Object.values(references.matchedOtherBrand).reduce((sum,n)=>sum+n,0);
    const secondaryDiscrepancies=[
      {measure:"unresolvedBTBeforeCrossBrand",actual:referenceBT,reference:145,
        explanation:"The current METEL BTI delivery has 29 more BT- codes outside BTI than the DD reference; the additional codes resolve uniquely under LEG and are listed in matchedOtherBrandKeys."},
      {measure:"crossBrandCodes",actual:crossBrand,reference:10,
        explanation:"39 unique source codes resolve under another METEL marchio; 29 more are BT- codes found under LEG than the DD source analysis counted."},
      ...(moduleComparison?[{measure:"dinModuleConflicts",actual:Number(moduleComparison.dinModuleConflicts),reference:17,
        explanation:"Complete default and primary-option comparisons produce one additional disagreement; all are retained as unresolved evidence pending source eligibility review."}]:[]),
    ].filter(x=>x.actual!==x.reference);
    const summary:Record<string,unknown>={
      source:{sha256:fileSha,version:string(metadata,"Versione"),
        date:metadata.Data instanceof Date?metadata.Data.toISOString():String(metadata.Data),
        byteSize:buffer.length,adapterVersion:adapter.version,backup},
      counts:actual,referenceComparison:comparison,discrepancies,secondaryDiscrepancies,
      relations,factoryPresetModels:factoryModels.size,exclusions,hierarchy,contexts,capacityFillers,references,physicalAudit,moduleComparison,
      skipped:report.skipped,conflicts:report.conflicts,errors:report.errors,
    };
    writer.finishImport(importId,summary);
    return {importId,fingerprint,alreadyImported:false,summary};
  });
  return result;
}
