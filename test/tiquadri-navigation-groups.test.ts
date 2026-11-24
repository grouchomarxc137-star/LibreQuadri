import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { browseCatalogue } from "../src/main/catalogue/browse-queries.js";
import { getCatalogueProductSnapshot } from "../src/main/catalogue/catalogue-queries.js";
import { browseRangeNodes, getConfigurationModel } from "../src/main/catalogue/configuration-queries.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";
import { browseManufacturerNodes, listManufacturerArticles,
  listManufacturerModels } from "../src/main/catalogue/manufacturer-navigation.js";
import { loadRangeNavigationSeed } from "../src/main/catalogue/range-navigation-seed.js";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { importTiQuadri } from "../src/main/sources/tiquadri/import.js";
import { TIQUADRI_ENGINEERING_ADAPTER } from "../src/main/sources/tiquadri/adapter.js";
import { readEngineeringReadiness } from "../src/main/catalogue/engineering-readiness.js";
import type { ManufacturerNode } from "../src/shared/catalogue.js";
import { createCatalogueFixture, type CatalogueFixture } from "./helpers/catalogue-fixtures.js";

type Row = Record<string, unknown>;
const source = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }));
const adapterSetup=vi.hoisted(()=>({version:null as string|null}));
vi.mock("../src/main/sources/tiquadri/adapter.js",async importOriginal=>{
  const actual=await importOriginal<typeof import("../src/main/sources/tiquadri/adapter.js")>();
  return {TIQUADRI_ENGINEERING_ADAPTER:{code:actual.TIQUADRI_ENGINEERING_ADAPTER.code,
    get version(){return adapterSetup.version??actual.TIQUADRI_ENGINEERING_ADAPTER.version;}}};
});
vi.mock("mdb-reader", () => ({ default: class {
  getTable(name: string) {
    const data = source.tables[name] ?? [];
    return { rowCount: data.length, getData: () => data };
  }
} }));

/** Product-owner mapping of BTicino Apparecchi Gamme to project categories (2026-09-25, with M3-160 and Datacom). */
const APPROVED: Record<string, readonly string[]> = {
  "Interruttori scatolati": ["Dispositivi 800V", "Megabreak 6300", "Megatiker Elettronici M5-1600",
    "Megatiker Elettronici M5-800", "Megatiker Elettronici M4-630", "Megatiker Elettronici M4-400",
    "Megatiker Elettronici M3-250", "Megatiker Elettronici M2-250", "Megatiker M5-1600", "Megatiker M5-800",
    "Megatiker M4-630", "Megatiker M4-400", "Megatiker M3-250", "Megatiker M3-160", "Megatiker M3-125",
    "Megatiker M1-160 / M2-250", "Megatiker M2 Corrente Continua", "Megatiker DIN Elettronici M2-250",
    "Megatiker DIN M1-160 / M2-250", "Megatiker DIN M2 Corrente Continua"],
  "Sezionatori con maniglia": ["Megaswitch MW-1600", "Megaswitch MW-630", "Megaswitch MW-250",
    "Megaswitch MW-63 / MW-160"],
  "Dispositivi modulari": ["Btdin 500", "Btdin 250", "Btdin 160", "Btdin 100", "Btdin 60", "Btdin 45",
    "Btdin RS", "Btdin Stop Arc", "Btdin Corrente Continua", "Apparecchi Din", "Ausiliari Din", "Strumenti Din"],
  "Dispositivi a pannello": ["Strumenti da incasso"],
  "Supervisione impianto": ["Sistema di Supervisione EMS", "Sistema di Supervisione IME SX"],
  "Fusibili": ["Fusibili"],
  "Trasformatori non modulari": ["Trasformatori"],
  "Contattori non modulari": ["Contattori Legrand", "Contattori + Salvamotori Legrand", "Contattori",
    "Contattori con termico"],
  "Automazione": ["My Home", "Comunicazione", "Switch", "Sistema Automazione KNX", "Btdin Smart",
    "Apparecchi BTNET", "Apparecchi Datacom", "Apparecchi Flatwall"],
  "Prese industriali": ["Prese Incasso P17 Tempra PRO", "Prese Interbloccate P17 Tempra PRO"],
};

interface PackOption { readonly label: string; readonly isDefault?: boolean; readonly articles: readonly string[] }
interface Gamma {
  readonly system: number; readonly g1: number; readonly name: string; readonly copy?: string;
  readonly tipologia?: string; readonly article?: string; readonly prefix?: string;
  readonly description?: string; readonly obsolete?: boolean;
  /** A pack whose articles come only from its options, as TiQuadri option article rows. */
  readonly packName?: string; readonly options?: readonly PackOption[];
  /** Its article codes are absent from the METEL delivery. */
  readonly unlinked?: boolean;
}
const OPTION_ARTICLES: Record<string, string> = {
  "013325": "FUSIBILE CILINDRICO gG 10,3x38 25A", "013316": "FUSIBILE CILINDRICO gG 10,3x38 16A",
  "021400": "PORTAFUSIBILE SP38 10X38 1P+N",
};
const SYSTEMS: Record<number, string> = { 1: "Carpenterie", 3: "Apparecchi" };
const GAMMAS: readonly Gamma[] = [
  { system: 3, g1: 542, name: "Megatiker M3-250", tipologia: "Magnetotermici", article: "T3N250",
    description: "MEGATIKER M3 250 3P 250A 25KA" },
  // TiQuadri's label table and its GERARCHIA copy disagree for this Gamma.
  { system: 3, g1: 566, name: "Megatiker DIN M1-160", copy: "Megatiker DIN M1-160 / M2-250", article: "T1D160",
    description: "MEGATIKER DIN M1 160A" },
  { system: 3, g1: 590, name: "Megaswitch MW-1600", article: "T7814WF800B", description: "MEGASWITCH MW 800A" },
  { system: 3, g1: 599, name: "Btdin 60", article: "FN82C16", description: "BTDIN60 MAGNETOT. 2P C16" },
  { system: 3, g1: 631, name: "Btdin 60", article: "FN82C10", description: "BTDIN60 OLD C10", obsolete: true },
  { system: 3, g1: 691, name: "Strumenti da incasso", article: "F96A", description: "AMPEROMETRO DA INCASSO" },
  { system: 3, g1: 693, name: "Sistema di Supervisione EMS", article: "F80GTW", description: "EMS GATEWAY" },
  { system: 3, g1: 701, name: "Fusibili", tipologia: "Fusibili 10,3x38 mm", prefix: "LG-",
    packName: "Fusibili 10,3x38 mm - 1 Polo+N", options: [
      { label: "25 A - Tipo gG", isDefault: true, articles: ["013325", "021400"] },
      { label: "16 A - Tipo gG", articles: ["013316", "021400"] }] },
  // No TiQuadri article rows at all: a space placeholder, never a Catalogo package.
  { system: 3, g1: 721, name: "Contattori", packName: "Contattori 16-125A 2 Poli",
    options: [{ label: "125 A", isDefault: true, articles: [] }] },
  // Article references that the METEL delivery does not contain.
  { system: 3, g1: 803, name: "Apparecchi Datacom", prefix: "LG-", unlinked: true,
    packName: "STP - Gruppo di 6 connettori RJ45", options: [{ label: "RJ45", isDefault: true, articles: ["033775"] }] },
  { system: 3, g1: 711, name: "Trasformatori", article: "T4100", description: "TRASFORMATORE 100VA" },
  { system: 3, g1: 900, name: "Contattori Legrand", article: "416000", prefix: "LG-",
    description: "CONTATTORE CTX3 9A" },
  { system: 3, g1: 741, name: "My Home", article: "F411/4", description: "ATTUATORE 4 RELE" },
  { system: 3, g1: 961, name: "Prese Interbloccate P17 Tempra PRO", article: "PB32", description: "PRESA INTERBLOCCATA 32A" },
  { system: 3, g1: 544, name: "Megatiker M3-160", article: "T3N160", description: "MEGATIKER M3 160 3P" },
  { system: 3, g1: 999, name: "Gamma non classificata", article: "X999", description: "ARTICOLO NON CLASSIFICATO" },
  { system: 1, g1: 100, name: "Armadio HDX 4000", article: "HDX4000", description: "ARMADIO HDX 4000" },
];

function sourceTables(): Record<string, Row[]> {
  const tables: Record<string, Row[]> = { ANA_DB: [{ KEY: "TIPRE", IsQuadri: true, Descri: "Fixture",
    Versione: "1", Data: "2026-09-25" }], ANA_GERARCHIA_1: [], ANA_GERARCHIA_2: [], ANA_GERARCHIA_3: [],
    GERARCHIA: [], ANA_CLASSE: [], ANA_PACK: [], ANA_ART_PACK: [], ASS_GERARCHIA_CLASSE_PACK: [],
    ANA_MODALITA: [], ANA_ART_MODALITA: [],
    ASS_PANNELLI_QUADRI_APPARECCHI: [{ Famiglia_Apparecchi: 1, Descrizione_Apparecchi: "Apparecchio fixture",
      Profondita: 70, Poli_Din: 2, Dimensione_Vert_X_Ruotato_0: 36, Dimensione_Vert_Y_Ruotato_0: 80 }] };
  GAMMAS.forEach((gamma, index) => {
    const g2 = gamma.g1 * 10 + 1, klass = gamma.g1 * 100 + 11, pack = 1000 + index;
    const tipologia = gamma.tipologia ?? `Tipologia ${gamma.g1}`, famiglia = `Famiglia ${gamma.g1}`;
    tables.ANA_GERARCHIA_1!.push({ Id_Gerarchia_1: gamma.g1, Descri_Gerarchia_1: gamma.name });
    tables.ANA_GERARCHIA_2!.push({ Id_Gerarchia_2: g2, Descri_Gerarchia_2: tipologia });
    tables.GERARCHIA!.push({ ID_Sistema: gamma.system, Descri_Sistema: SYSTEMS[gamma.system],
      ID_Gerarchia_1: gamma.g1, Descri_Gerarchia_1: gamma.copy ?? gamma.name, ID_Gerarchia_2: g2,
      Descri_Gerarchia_2: tipologia, ID_Gerarchia_3: 0, ID_Gerarchia: g2, Descri_Gerarchia: tipologia,
      Armadi_Compatibili: gamma.system===3?(gamma.g1===542?"|40|":"|50|"):"",
      Ordine: 263 + index });
    tables.ANA_CLASSE!.push({ Id_Classe: klass, Descri_Classe: famiglia, Ordine: 1,
      Classe_Visibile_Senza_Struttura: true });
    tables.ANA_PACK!.push({ ID_Pack: pack, Descri_Pack: gamma.packName ?? `${gamma.name} modello`,
      Obsoleto: gamma.obsolete === true, Id_Modalita: gamma.options ? pack : 0,
      Famiglia_Apparecchi: gamma.system === 3 ? 1 : 0, Famiglia_Pannelli: 0,
      Famiglia_Armadi: gamma.system===1?50:0, Sotto_Famiglia_Armadi: 0 });
    if (gamma.article)
      tables.ANA_ART_PACK!.push({ Id_Pack: pack, Marchio_Articolo: gamma.prefix ?? "BT-", Cod_Art: gamma.article });
    gamma.options?.forEach((option, row) => {
      const key = pack * 10 + row;
      tables.ANA_MODALITA!.push({ Id_Modalita: pack, Id_Index_Modalita: key, ID_Label_Modalita_1: pack,
        Label_Modalita_1: "Taratura", ID_Valore_Modalita_1: key, Valore_Modalita_1: option.label,
        Default_1: option.isDefault === true, Modalita_1_Invisibile: false, ID_Label_Modalita_2: 0, ID_Valore_Modalita_2: 0 });
      for (const code of option.articles)
        tables.ANA_ART_MODALITA!.push({ Id_Index_Modalita: key, Marchio_Articolo: gamma.prefix ?? "BT-", Cod_Art: code });
    });
    tables.ASS_GERARCHIA_CLASSE_PACK!.push({ ID_Gerarchia: g2, ID_Classe: klass, ID_Pack: pack,
      Descri_Gerarchia: tipologia, Descri_Classe: famiglia, Ordine: 1 });
  });
  return tables;
}

const roots: string[] = [];
const fixtures: CatalogueFixture[] = [];
afterEach(() => {
  adapterSetup.version=null;
  for (const fixture of fixtures.splice(0)) fixture.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function imported(seedFolder = path.resolve("db/seed"),alterTables?:(tables:Record<string,Row[]>)=>void) {
  const root = mkdtempSync(path.join(tmpdir(), "librequadri-navigation-groups-"));
  roots.push(root);
  const data = createCatalogueFixture();
  fixtures.push(data);
  const products = new Map<string, { marchio: string; code: string; description: string; statisticalFamily: string }>();
  for (const gamma of GAMMAS) {
    if (gamma.unlinked) continue;
    const marchio = gamma.prefix === "LG-" ? "LEG" : "BTI";
    const statisticalFamily = gamma.prefix === "LG-" ? "IND.-120-1-1" : "IND.-112-37-147";
    if (gamma.article) products.set(gamma.article, { marchio, code: gamma.article,
      description: gamma.description ?? gamma.article, statisticalFamily });
    for (const code of gamma.options?.flatMap(option => option.articles) ?? [])
      products.set(code, { marchio, code, description: OPTION_ARTICLES[code] ?? code, statisticalFamily });
  }
  data.importDelivery({ issuer: "BTI", listino: "2126", validFrom: "2026-04-01", products: [...products.values()] });
  data.importDelivery({ issuer: "SIE", listino: "7", validFrom: "2026-04-01", products: [
    { marchio: "SIE", code: "5SY6116", description: "SIEMENS MCB C16", statisticalFamily: "R711 I33A" }] });
  const others = () => browseManufacturerNodes(data.lq).filter(node => node.brandMarchio !== "BTI"
    || node.source === "metel");
  const before = others();
  source.tables = sourceTables();
  alterTables?.(source.tables);
  const master = path.join(root, "BTQUADRI.mdb");
  writeFileSync(master, `fixture ${root}`);
  const result = await importTiQuadri({ database: data.lq, sourcePath: master,
    archiveDirectory: path.join(root, "archive"), backupDirectory: path.join(root, "backups"), seedFolder });
  return { db: data.lq, result, master, root, before, after: others(), nodes: browseManufacturerNodes(data.lq),
    modelId: (name: string) => data.lq.prepare("SELECT id FROM cat_config_model WHERE name=?").pluck().get(name) as number };
}

describe("reviewed TiQuadri commercial contribution",()=>{
  const addPhysicalOnly=(tables:Record<string,Row[]>)=>{
    tables.ANA_PACK!.push({ID_Pack:1778,Descri_Pack:"Din generico - Solo spazio",
      Obsoleto:false,Id_Modalita:0,Famiglia_Apparecchi:1,Famiglia_Pannelli:0,
      Famiglia_Armadi:0,Sotto_Famiglia_Armadi:0});
    tables.ANA_PACK!.push({ID_Pack:9999,Descri_Pack:"Unreviewed space",
      Obsoleto:false,Id_Modalita:0,Famiglia_Apparecchi:1,Famiglia_Pannelli:0,
      Famiglia_Armadi:0,Sotto_Famiglia_Armadi:0});
  };
  it("imports only the reviewed raw article-free pack as none",async()=>{
    const {db,result}=await imported(path.resolve("db/seed"),addPhysicalOnly);
    expect(result.summary.counts).toMatchObject({sourceArticleFreePacks:3,
      approvedPhysicalOnlyModels:1,contributionReviewCandidates:2});
    expect(db.prepare("SELECT commercial_contribution FROM cat_config_model WHERE code='tq.pack.1778'")
      .pluck().get()).toBe("none");
    expect(db.prepare("SELECT commercial_contribution FROM cat_config_model WHERE code='tq.pack.9999'")
      .pluck().get()).toBe("articles");
  });
  it("reports a conflict when a raw article row is dropped during normalization",async()=>{
    const {db,result}=await imported(path.resolve("db/seed"),tables=>{
      addPhysicalOnly(tables);
      tables.ANA_ART_PACK!.push({Id_Pack:1778,Marchio_Articolo:"BT-",Cod_Art:""});
    });
    expect(result.summary.counts).toMatchObject({sourceArticleFreePacks:2,
      contributionReviewCandidates:2,contributionClassificationConflicts:1});
    expect(result.summary.conflicts).toMatchObject({commercial_contribution:1});
    expect(db.prepare("SELECT commercial_contribution FROM cat_config_model WHERE code='tq.pack.1778'")
      .pluck().get()).toBe("articles");
    expect(db.prepare(`SELECT COUNT(*) FROM cat_config_model_article a JOIN cat_config_model m
      ON m.id=a.model_id WHERE m.code='tq.pack.1778'`).pluck().get()).toBe(0);
  });
});

describe("TiQuadri content compatibility flag",()=>{
  it("reports the source flag without turning a model axis into a placement binding",async()=>{
    const {db,result}=await imported(path.resolve("db/seed"),tables=>{
      tables.ANA_MODALITA![0]!.Test_Compatibilita_Contenuto=true;
    });
    expect((result.summary.skipped as Record<string,{count:number;sampleKeys:string[]}>))
      .toMatchObject({content_compatibility_flag_unapplied:{count:1}});
    expect(db.prepare(`SELECT COUNT(*) FROM cat_config_axis a JOIN cat_config_model m ON m.id=a.model_id
      WHERE m.code LIKE 'tq.pack.%' AND a.binding='match_container'`).pluck().get()).toBe(0);
    expect(db.prepare(`SELECT binding FROM cat_config_axis a JOIN cat_config_model m ON m.id=a.model_id
      WHERE m.code='tq.pack.1007'`).pluck().get()).toBe("none");
    expect(result.summary.source).toMatchObject({adapterVersion:TIQUADRI_ENGINEERING_ADAPTER.version});
  });
});

describe("TiQuadri adapter reimport lifecycle",()=>{
  it("imports combined source-backed enclosure drawings and conservatively aggregates axis permissions",async()=>{
    const {db,result}=await imported(undefined,tables=>{
      tables.ANA_PACK!.push({ID_Pack:60000,Descri_Pack:"Synthetic enclosure",Id_Modalita:60000,
        Famiglia_Armadi:10,Sotto_Famiglia_Armadi:2});
      tables.ANA_ARMADI=[{Id_Pack:60000,ID_Armadi_Blocco:311,Larghezza_Reale:600,
        Altezza_reale:1800,Profondita_reale:600,Profondita_utile:550,
        Altezza_utile:1700,Larghezza_utile:500}];
      tables.ASS_ARMADI_BLOCCO=Array.from({length:10},(_,i)=>({ID_Armadi_Blocco:311+i,File_blocco:`case-${311+i}`}));
      const options=[[1,1,0,true],[1,2,1,true],[1,3,2,true],[1,4,3,true],
        [2,1,0,true],[2,2,4,false],[3,1,0,false]];
      tables.ANA_MODALITA!.push(...options.map(([label,value,delta,editable],i)=>({
        Id_Modalita:60000,Id_Index_Modalita:60000+i,ID_Label_Modalita_1:label,
        ID_Valore_Modalita_1:value,Aumenta_Famiglia:delta,Default_1:value===1,
        Modalita_1_Modificabile_Nel_Pannello:editable,
      })));
    });
    expect(db.prepare("SELECT profile_key FROM cat_phys_profile WHERE code LIKE 'tq.armadi.pack.60000.%' ORDER BY profile_key")
      .pluck().all()).toEqual([311,312,313,314,315,316,317,318]);
    expect(db.prepare(`SELECT d.code,a.editable_when_placed FROM cat_config_axis a
      JOIN cat_config_dimension d ON d.id=a.dimension_id JOIN cat_config_model m ON m.id=a.model_id
      WHERE m.code='tq.pack.60000' ORDER BY d.code`).all()).toEqual([
      {code:"tq.label.1",editable_when_placed:1},{code:"tq.label.2",editable_when_placed:0},
      {code:"tq.label.3",editable_when_placed:0}]);
    expect(result.summary.counts).toMatchObject({combinedEnclosureVariants:3,mixedEditableAxes:1});
    expect(result.summary.skipped).toMatchObject({axis_editability_mixed:{count:1,sampleKeys:["60000:2"]}});
    expect(result.summary.conflicts).toMatchObject({axis_editability:1});
  });
  it("includes reviewed presentation metadata in the same-source import fingerprint",async()=>{
    const {db,result,master,root}=await imported();
    const seedFolder=path.join(root,"presentation-seed");cpSync(path.resolve("db/seed"),seedFolder,{recursive:true});
    const file=path.join(seedFolder,"tiquadri-front-presentation.json");
    const seed=JSON.parse(readFileSync(file,"utf8"));seed[0].evidence+="; reviewed again";
    writeFileSync(file,JSON.stringify(seed));
    const definitions=db.prepare("SELECT code,definition_fingerprint FROM cat_config_model ORDER BY code").all();
    const refreshed=await importTiQuadri({database:db,sourcePath:master,archiveDirectory:path.join(root,"archive"),
      backupDirectory:path.join(root,"backups"),seedFolder});
    expect(refreshed.alreadyImported).toBe(false);expect(refreshed.fingerprint).not.toBe(result.fingerprint);
    expect(db.prepare("SELECT code,definition_fingerprint FROM cat_config_model ORDER BY code").all()).toEqual(definitions);
    expect(readEngineeringReadiness(db).sources[0]).toMatchObject({status:"ready",importFingerprint:refreshed.fingerprint});
    expect(await importTiQuadri({database:db,sourcePath:master,archiveDirectory:path.join(root,"archive"),
      backupDirectory:path.join(root,"backups"),seedFolder})).toMatchObject({alreadyImported:true,importId:refreshed.importId});
  });
  it.each([false,true])("validates source evidence at import and withholds a mismatched guide (%s)",async changed=>{
    const {db,result}=await imported(undefined,tables=>{
      tables["ANA_PACK"]!.push({ID_Pack:2898,Descri_Pack:"Finestra 4 moduli DIN",Famiglia_Pannelli:2309});
      (tables["ANA_PANNELLI"]??=[]).push({Famiglia_pannelli:2309,Pannello_centralino:true,Pannello_DIN:true,
        File_Blocco:"senza",Larghezza:changed?83:82,Altezza:55});
    });
    expect(db.prepare("SELECT symbol_kind FROM cat_phys_view v JOIN cat_phys_profile p ON p.id=v.profile_id WHERE p.code='tq.pan.2309'")
      .pluck().get()).toBe(changed?"din_panel":"mounting_guide");
    expect((result.summary.conflicts as Record<string,number>)["front_presentation"]).toBe(changed?1:undefined);
  });
  it("a future declared version invalidates the old import and changes the same-source fingerprint automatically",async()=>{
    const {db,result,master,root}=await imported();
    const installed=TIQUADRI_ENGINEERING_ADAPTER.version;
    const model=db.prepare("SELECT id FROM cat_config_model WHERE source='import' LIMIT 1").pluck().get() as number;
    expect(getConfigurationModel(db,model)).toBeDefined();
    adapterSetup.version=String(BigInt(installed)+1n);
    expect(readEngineeringReadiness(db).sources[0]).toMatchObject({status:"engineering_data_stale",
      installedVersion:installed,requiredVersion:adapterSetup.version});
    expect(()=>getConfigurationModel(db,model)).toThrow("I dati di ingegneria sono obsoleti");
    const refreshed=await importTiQuadri({database:db,sourcePath:master,
      archiveDirectory:path.join(root,"archive"),backupDirectory:path.join(root,"backups"),seedFolder:path.resolve("db/seed")});
    expect(refreshed.alreadyImported).toBe(false);
    expect(refreshed.fingerprint).not.toBe(result.fingerprint);
    expect(readEngineeringReadiness(db).sources[0]).toMatchObject({status:"ready",
      installedVersion:adapterSetup.version,requiredVersion:adapterSetup.version,importIds:[refreshed.importId]});
    expect(getConfigurationModel(db,model)).toBeDefined();
  });
  it.each(["older import","damaged version","historical fingerprint","ambiguous current marker"])("restores readiness after %s",async scenario=>{
    const {db,result,master,root}=await imported();
    const adapter=TIQUADRI_ENGINEERING_ADAPTER;
    if(scenario==="older import")db.prepare("UPDATE app_source_import SET adapter_version=?,fingerprint=? WHERE id=?")
      .run(String(BigInt(adapter.version)-1n),"d".repeat(64),result.importId);
    else if(scenario==="damaged version")db.prepare("UPDATE app_source_import SET adapter_version='' WHERE id=?").run(result.importId);
    else if(scenario==="historical fingerprint")db.prepare("UPDATE app_source_import SET became_current=0 WHERE id=?").run(result.importId);
    else db.prepare(`INSERT INTO app_source_import(adapter_code,adapter_version,source_label,fingerprint,imported_at,became_current,summary_json)
      VALUES(?,?,'Duplicate marker',?,'2026-10-06',1,'{}')`).run(adapter.code,adapter.version,"e".repeat(64));
    expect(readEngineeringReadiness(db).sources[0]?.status).toBe("engineering_data_stale");
    const reimport=()=>importTiQuadri({database:db,sourcePath:master,
      archiveDirectory:path.join(root,"archive"),backupDirectory:path.join(root,"backups"),seedFolder:path.resolve("db/seed")});
    const refreshed=await reimport();
    expect(refreshed.alreadyImported).toBe(false);
    expect(readEngineeringReadiness(db).sources[0]).toMatchObject({status:"ready",installedVersion:adapter.version,
      requiredVersion:adapter.version,importIds:[refreshed.importId]});
    expect(db.prepare("SELECT COUNT(*) FROM cat_config_model WHERE source='import' AND source_import_id<>?")
      .pluck().get(refreshed.importId)).toBe(0);
    expect(await reimport()).toMatchObject({alreadyImported:true,importId:refreshed.importId,fingerprint:refreshed.fingerprint});
    expect(db.prepare("SELECT COUNT(*) FROM app_source_import WHERE adapter_code=?").pluck().get(adapter.code))
      .toBe(scenario==="older import"||scenario==="ambiguous current marker"?2:1);
  });
});

const named = (nodes: readonly ManufacturerNode[], name: string, parentId?: number | null) =>
  nodes.filter(node => node.name === name && (parentId === undefined || node.parentId === parentId));
const childNames = (nodes: readonly ManufacturerNode[], parentId: number) =>
  nodes.filter(node => node.parentId === parentId).map(node => node.name);
function pathOf(nodes: readonly ManufacturerNode[], node: ManufacturerNode): string[] {
  const byId = new Map(nodes.map(row => [row.id, row]));
  const result: string[] = [];
  for (let current: ManufacturerNode | undefined = node; current;
    current = current.parentId === null ? undefined : byId.get(current.parentId)) result.unshift(current.name);
  return result;
}

describe("Catalogue categories in the BTicino Apparecchi navigation", () => {
  it("imports opaque provider and accepted contexts with a separate design navigation flag",async()=>{
    const {db,result,modelId}=await imported();
    expect(result.summary.contexts).toMatchObject({classes:2,classesWithoutProvider:1,
      classesWithoutActiveProvider:1,classesWithObsoleteProvidersOnly:0,
      providingEnclosures:1,acceptingModels:16,acceptedRows:16});
    const context=(name:string)=>db.prepare(`SELECT m.context_policy AS policy,c.code,c.active,mc.role
      FROM cat_config_model m LEFT JOIN cat_config_model_context mc ON mc.model_id=m.id
      LEFT JOIN cat_config_context c ON c.id=mc.context_id WHERE m.id=?`).all(modelId(name));
    expect(context("Armadio HDX 4000 modello")).toMatchObject([
      {policy:"unrestricted",code:"tq.ctx.50",role:"provides"}]);
    expect(context("Megatiker M3-250 modello")).toMatchObject([
      {policy:"restricted",code:"tq.ctx.40",role:"accepts"}]);
    expect(db.prepare(`SELECT design_navigable FROM cat_range_node WHERE code='tq.g1.542'`)
      .pluck().get()).toBe(1);
    expect(db.prepare(`SELECT COUNT(*) FROM cat_config_model_context mc
      JOIN cat_config_model m ON m.id=mc.model_id WHERE mc.role='provides' AND m.model_kind!='enclosure'`)
      .pluck().get()).toBe(0);
  });
  it("replaces imported context links, deactivates absent codes and retains manual ownership",async()=>{
    const first=await imported();
    const {db,master,root,modelId}=first;
    const manualModel=modelId("Megatiker M3-250 modello");
    db.exec(`UPDATE cat_config_context SET source='manual',name='Manual 40'
      WHERE code='tq.ctx.40';`);
    db.prepare("UPDATE cat_config_model SET source='manual' WHERE id=?").run(manualModel);
    const changed=sourceTables();
    for(const row of changed.GERARCHIA??[])if(row.ID_Gerarchia_1===590||row.ID_Gerarchia_1===542)
      row.Armadi_Compatibili="|60|";
    for(const row of changed.ANA_PACK??[])if(row.Famiglia_Armadi===50)row.Famiglia_Armadi=70;
    source.tables=changed;
    writeFileSync(master,"fixture second revision");
    const second=await importTiQuadri({database:db,sourcePath:master,
      archiveDirectory:path.join(root,"archive"),backupDirectory:path.join(root,"backups")});
    expect(second.alreadyImported).toBe(false);
    expect(db.prepare(`SELECT c.code FROM cat_config_model_context mc
      JOIN cat_config_context c ON c.id=mc.context_id
      WHERE mc.model_id=? AND mc.role='accepts'`).pluck().all(modelId("Megaswitch MW-1600 modello")))
      .toEqual(["tq.ctx.60"]);
    expect(db.prepare(`SELECT c.code FROM cat_config_model_context mc
      JOIN cat_config_context c ON c.id=mc.context_id
      WHERE mc.model_id=? AND mc.role='provides'`).pluck().all(modelId("Armadio HDX 4000 modello")))
      .toEqual(["tq.ctx.70"]);
    expect(db.prepare(`SELECT c.name FROM cat_config_context c WHERE c.code='tq.ctx.40'`)
      .pluck().get()).toBe("Manual 40");
    expect(db.prepare(`SELECT c.code FROM cat_config_model_context mc
      JOIN cat_config_context c ON c.id=mc.context_id
      WHERE mc.model_id=?`).pluck().all(manualModel)).toEqual(["tq.ctx.40"]);
    source.tables=sourceTables();
    writeFileSync(master,"fixture third revision");
    await importTiQuadri({database:db,sourcePath:master,
      archiveDirectory:path.join(root,"archive"),backupDirectory:path.join(root,"backups")});
    expect(db.prepare(`SELECT code,active FROM cat_config_context
      WHERE code IN ('tq.ctx.60','tq.ctx.70') ORDER BY code`).all())
      .toEqual([{code:"tq.ctx.60",active:0},{code:"tq.ctx.70",active:0}]);
    expect(db.prepare(`SELECT source,active FROM cat_config_context WHERE code='tq.ctx.40'`).get())
      .toEqual({source:"manual",active:1});
    expect(db.prepare(`SELECT source,context_policy AS policy FROM cat_config_model WHERE id=?`)
      .get(manualModel)).toEqual({source:"manual",policy:"restricted"});
  });
  it("keeps the approved mapping in the TiQuadri seed exactly as supplied", () => {
    const seed = loadRangeNavigationSeed();
    expect(seed.groups.every(group => group.adapterCode === "tiquadri" && group.systemId === 3 &&
      group.sourceLevel === "g1")).toBe(true);
    expect(Object.fromEntries([...seed.groups].sort((a, b) => a.sortOrder - b.sortOrder)
      .map(group => [group.name, group.members.map(member => member.name)]))).toEqual(APPROVED);
    expect(Object.keys(Object.fromEntries([...seed.groups].sort((a, b) => a.sortOrder - b.sortOrder)
      .map(group => [group.name, 0])))).toEqual(Object.keys(APPROVED));
  });

  it("rejects a seed that assigns one source node to two categories", () => {
    const folder = mkdtempSync(path.join(tmpdir(), "librequadri-navigation-seed-"));
    roots.push(folder);
    const seed = JSON.parse(readFileSync(path.resolve("db/seed/range-navigation.json"), "utf8"));
    seed.groups[1].members[0].sourceIds.push(seed.groups[0].members[0].sourceIds[0]);
    writeFileSync(path.join(folder, "range-navigation.json"), JSON.stringify(seed));
    expect(() => loadRangeNavigationSeed(folder)).toThrow(/Invalid range group source ID tiquadri:3:g1:505/);
  });

  it("adds the ten approved categories between Apparecchi and its Gamme, without level labels", async () => {
    const { nodes } = await imported();
    const apparecchi = named(nodes, "Apparecchi", null)[0]!;
    expect(childNames(nodes, apparecchi.id)).toEqual([...Object.keys(APPROVED), "Gamma non classificata"]);
    const groups = nodes.filter(node => node.parentId === apparecchi.id && node.name !== "Gamma non classificata");
    expect(groups.every(group => group.kind === "level" && group.levelCode === null &&
      group.levelLabel === null && group.source === "import" && group.brandMarchio === "BTI")).toBe(true);
  });

  it("places each supplied Gamma under its approved category only", async () => {
    const { db, nodes } = await imported();
    const apparecchi = named(nodes, "Apparecchi", null)[0]!;
    const byCategory = Object.fromEntries(nodes.filter(node => node.parentId === apparecchi.id)
      .map(node => [node.name, childNames(nodes, node.id)]));
    expect(byCategory).toEqual({
      "Interruttori scatolati": ["Megatiker M3-250", "Megatiker DIN M1-160", "Megatiker M3-160"],
      "Sezionatori con maniglia": ["Megaswitch MW-1600"],
      "Dispositivi modulari": ["Btdin 60"],
      "Dispositivi a pannello": ["Strumenti da incasso"],
      "Supervisione impianto": ["Sistema di Supervisione EMS"],
      "Fusibili": ["Fusibili"],
      "Trasformatori non modulari": ["Trasformatori"],
      "Contattori non modulari": ["Contattori Legrand"],
      "Automazione": ["My Home"],
      "Prese industriali": ["Prese Interbloccate P17 Tempra PRO"],
      "Gamma non classificata": ["Tipologia 999"],
    });
    for (const gamma of ["Megatiker M3-250", "Btdin 60", "My Home", "Megaswitch MW-1600"])
      expect(named(nodes, gamma).length).toBe(1);
    const parentOf = (code: string) => db.prepare(`SELECT p.code FROM cat_range_node n
      JOIN cat_range_node p ON p.id=n.parent_id WHERE n.code=?`).pluck().get(code);
    expect(parentOf("tq.g1.599")).toBe("tq.group.3.dispositivi_modulari");
    // The obsolete same-named Btdin 60 is grouped too and stays hidden: it has no active model.
    expect(parentOf("tq.g1.631")).toBe("tq.group.3.dispositivi_modulari");
    expect(parentOf("tq.g1.544")).toBe("tq.group.3.interruttori_scatolati");
    expect(parentOf("tq.g1.999")).toBe("tq.system.3");
    expect(parentOf("tq.group.3.interruttori_scatolati")).toBe("tq.system.3");
  });

  it("keeps the TiQuadri levels, models, articles and browse behavior beneath a category", async () => {
    const { db, nodes } = await imported();
    const famiglia = named(nodes, "Famiglia 542")[0]!;
    expect(pathOf(nodes, famiglia)).toEqual(["Apparecchi", "Interruttori scatolati", "Megatiker M3-250",
      "Magnetotermici", "Famiglia 542"]);
    expect(["Megatiker M3-250", "Magnetotermici", "Famiglia 542"].map(name => named(nodes, name)[0]?.levelLabel))
      .toEqual(["Gamma", "Tipologia", "Famiglia"]);
    const [model] = listManufacturerModels(db, famiglia.id);
    expect(model?.name).toBe("Megatiker M3-250 modello");
    expect(listManufacturerArticles(db, { modelId: model!.id }).map(article => article.manufacturerCode))
      .toEqual(["T3N250"]);
    const category = named(nodes, "Interruttori scatolati")[0]!;
    const browsed = browseCatalogue(db, { nodeId: category.id });
    expect(browsed.products.map(product => [product.manufacturerCode, product.description, product.configurable]))
      .toEqual([["T1D160", "MEGATIKER DIN M1 160A", true], ["T3N160", "MEGATIKER M3 160 3P", true],
        ["T3N250", "MEGATIKER M3 250 3P 250A 25KA", true]]);
    expect(browseCatalogue(db, { nodeId: category.id, query: "T3N" }).products
      .map(product => product.manufacturerCode)).toEqual(["T3N160", "T3N250"]);
    expect(browseCatalogue(db, { nodeId: category.id, query: "DIN M1" }).products
      .map(product => product.manufacturerCode)).toEqual(["T1D160"]);
    const apparecchi = named(nodes, "Apparecchi", null)[0]!;
    expect(browseCatalogue(db, { nodeId: apparecchi.id })).toMatchObject({ totalCount: 12, packageCount: 1 });
    expect(browseRangeNodes(db).some(node => node.code === "tq.group.3.interruttori_scatolati")).toBe(true);
  });

  it("leaves other manufacturers, FST trees and Carpenterie out of the grouping", async () => {
    const { db, nodes, before, after } = await imported();
    expect(after).toEqual(before);
    expect(before.some(node => node.brandMarchio === "SIE")).toBe(true);
    expect(nodes.filter(node => node.parentId === null).map(node => node.name)).toEqual([
      "Apparecchi", "Famiglie statistiche · BTI · BTI", "Famiglie statistiche · BTI · LEG",
      "Famiglie statistiche · SIE · SIE", "Apparecchi Siemens"]);
    expect(nodes.some(node => ["Carpenterie", "Armadio HDX 4000"].includes(node.name))).toBe(false);
    expect(db.prepare(`SELECT COUNT(*) FROM cat_range_node g JOIN cat_range_node p ON p.id=g.parent_id
      WHERE g.source_level='lq_group' AND p.code<>'tq.system.3'`).pluck().get()).toBe(0);
    expect(browseRangeNodes(db).filter(node => node.parentId === null).map(node => node.name))
      .toEqual(["Apparecchi", "Carpenterie"]);
  });

  it("reports unmapped Gamme and never applies a member whose source name disagrees", async () => {
    const first = await imported();
    const skipped = first.result.summary.skipped as Record<string, { count: number; sampleKeys: string[] }>;
    expect(skipped.navigation_group_unmapped).toEqual({ count: 1, sampleKeys: ["3:999"] });
    expect(skipped.navigation_group_member_missing?.count).toBe(60 - 15);
    expect(first.result.summary.conflicts).not.toHaveProperty("navigation_group_member_name_disagrees");
    expect(first.result.summary.hierarchy).toMatchObject({ groupedNodes: 15 });

    const seedFolder = path.join(first.root, "seed");
    cpSync(path.resolve("db/seed"), seedFolder, { recursive: true });
    const seed = JSON.parse(readFileSync(path.join(seedFolder, "range-navigation.json"), "utf8"));
    seed.groups[1].members[0].name = "Megaswitch MW-1600 renamed";
    writeFileSync(path.join(seedFolder, "range-navigation.json"), JSON.stringify(seed));
    const second = await imported(seedFolder);
    expect(second.result.fingerprint).not.toBe(first.result.fingerprint);
    expect(second.result.summary.conflicts).toMatchObject({ navigation_group_member_name_disagrees: 1 });
    const apparecchi = named(second.nodes, "Apparecchi", null)[0]!;
    expect(childNames(second.nodes, apparecchi.id)).not.toContain("Sezionatori con maniglia");
    expect(named(second.nodes, "Megaswitch MW-1600")[0]?.parentId).toBe(apparecchi.id);
  });
});

describe("selectable configuration packages in Catalogo", () => {
  const FUSE = "Fusibili 10,3x38 mm - 1 Polo+N";
  const codes = (result: { bom: readonly { linkedManufacturerCode: string | null }[] }) =>
    result.bom.map(row => row.linkedManufacturerCode).sort();

  it("lists an option-only pack in its category and keeps packs without linked articles out", async () => {
    const { db, nodes, modelId } = await imported();
    const apparecchi = named(nodes, "Apparecchi", null)[0]!;
    const category = named(nodes, "Fusibili", apparecchi.id)[0]!;
    const famiglia = named(nodes, "Famiglia 701")[0]!;
    expect(pathOf(nodes, famiglia)).toEqual(["Apparecchi", "Fusibili", "Fusibili", "Fusibili 10,3x38 mm", "Famiglia 701"]);
    expect(famiglia).toMatchObject({ articleCount: 0, packageCount: 1 });
    const browsed = browseCatalogue(db, { nodeId: category.id });
    expect(browsed).toMatchObject({ products: [], totalCount: 0, packageCount: 1 });
    expect(browsed.packages).toEqual([{ modelId: modelId(FUSE), name: FUSE, kind: "device", brandMarchio: "BTI",
      groupName: "Famiglia 701", groupId: famiglia.id, groupPath: ["Fusibili", "Fusibili 10,3x38 mm", "Famiglia 701"] }]);
    expect(listManufacturerModels(db, famiglia.id).map(model => model.name)).toEqual([FUSE]);
    expect(browseCatalogue(db, { nodeId: apparecchi.id }).packages.map(item => item.name)).toEqual([FUSE]);
    // No linked article: neither the placeholder (C) nor the unlinked references (D) reach Catalogo.
    expect(nodes.some(node => ["Contattori", "Apparecchi Datacom"].includes(node.name))).toBe(false);
    expect(browseRangeNodes(db).filter(node => ["Contattori", "Apparecchi Datacom"].includes(node.name))
      .map(node => node.name)).toEqual(["Contattori", "Apparecchi Datacom"]);
    // A structural model is never a Catalogo package, even with linked articles in a navigable node.
    const supportId = Number(db.prepare(`INSERT INTO cat_config_model(brand_id,code,name,model_kind,
      definition_fingerprint,source) SELECT brand_id,'test.support','Supporto di prova','support','f','manual'
      FROM cat_config_model WHERE id=?`).run(modelId(FUSE)).lastInsertRowid);
    db.prepare(`INSERT INTO cat_range_node_model(node_id,model_id) SELECT node_id,? FROM cat_range_node_model
      WHERE model_id=?`).run(supportId, modelId(FUSE));
    db.prepare(`INSERT INTO cat_config_model_article(model_id,seq,product_id,ref_brand_marchio,ref_manufacturer_code,
      quantity,role) SELECT ?,1,id,'LEG',manufacturer_code,1,'component' FROM cat_product WHERE manufacturer_code='021400'`)
      .run(supportId);
    expect(browseCatalogue(db, { nodeId: category.id }).packages.map(item => item.name)).toEqual([FUSE]);
  });

  it("applies text, brand and configurability filters to packages without changing article paging", async () => {
    const { db, nodes } = await imported();
    const apparecchi = named(nodes, "Apparecchi", null)[0]!;
    const count = (request: Omit<Parameters<typeof browseCatalogue>[1], "nodeId">) =>
      browseCatalogue(db, { nodeId: apparecchi.id, ...request }).packages.length;
    expect(count({ query: "Polo+N" })).toBe(1);
    expect(count({ query: "Megatiker" })).toBe(0);
    expect(count({ brandMarchio: ["BTI"] })).toBe(1);
    expect(count({ brandMarchio: ["LEG"] })).toBe(0);
    expect(count({ configurable: [true] })).toBe(1);
    expect(count({ configurable: [false] })).toBe(0);
    const all = browseCatalogue(db, { nodeId: apparecchi.id });
    const paged = [0, 5, 10].map(offset => browseCatalogue(db, { nodeId: apparecchi.id, limit: 5, offset }));
    expect(paged.flatMap(page => page.products.map(product => product.id))).toEqual(all.products.map(product => product.id));
    expect(paged.map(page => [page.totalCount, page.packages.length])).toEqual([[12, 1], [12, 0], [12, 0]]);
    expect(browseCatalogue(db, { nodeId: apparecchi.id, query: "T3N" }).products
      .map(product => product.manufacturerCode)).toEqual(["T3N160", "T3N250"]);
  });

  it("resolves the package defaults and option changes through the generic resolver", async () => {
    const { db, modelId } = await imported();
    const model = getConfigurationModel(db, modelId(FUSE));
    expect(model.axes.map(axis => [axis.label, axis.options.map(option => [option.label, option.isDefault])]))
      .toEqual([["Taratura", [["25 A - Tipo gG", true], ["16 A - Tipo gG", false]]]]);
    const defaults = resolveConfiguration(db, { modelId: model.id, selectedOptionIds: [] });
    expect(defaults.status).toBe("complete");
    expect(codes(defaults)).toEqual(["013325", "021400"]);
    expect(defaults.bom.every(row => row.unitPriceE4 !== null)).toBe(true);
    // METEL articles carry only a short description; the BOM shows it.
    expect(defaults.bom.map(row => row.description).sort()).toEqual(["FUSIBILE CILINDRICO gG 10,3x38 25A",
      "PORTAFUSIBILE SP38 10X38 1P+N"]);
    expect(defaults.totalE4).toBe(defaults.bom.reduce((sum, row) => sum + row.rowTotalE4!, 0));
    const sixteen = model.axes[0]!.options[1]!.id;
    expect(codes(resolveConfiguration(db, { modelId: model.id, selectedOptionIds: [sixteen] })))
      .toEqual(["013316", "021400"]);
    expect(resolveConfiguration(db, { modelId: modelId("STP - Gruppo di 6 connettori RJ45"), selectedOptionIds: [] }).status)
      .toBe("bom_incomplete");
    expect(resolveConfiguration(db, { modelId: modelId("Contattori 16-125A 2 Poli"), selectedOptionIds: [] }).status)
      .toBe("invalid");
  });

  it("adds packages through configured-item insertion, merges quantity and reopens without a catalogue", async () => {
    const { db, root, modelId } = await imported();
    const filename = path.join(root, "packages.lqp");
    const service = (catalogue: boolean) => new ProjectDocumentService({
      workingDirectory: path.join(root, `working-${catalogue}`), incomingDirectory: path.join(root, `incoming-${catalogue}`),
      backupDirectory: path.join(root, "project-backups"), migrationsFolder: path.resolve("db/migrations/project"),
      appVersion: "test",
      resolveCatalogueProduct: catalogue ? id => getCatalogueProductSnapshot(db, id) : () => { throw new Error("no catalogue"); },
      resolveConfiguration: catalogue ? request => resolveConfiguration(db, request) : () => { throw new Error("no catalogue"); },
    });
    const writer = service(true);
    await writer.create({ destinationPath: filename, title: "Pacchetti", description: "", notes: "",
      projectType: "industrial", executor: "", date: "2026-09-25", companyName: "Cliente", companyDescription: "" });
    const fuse = modelId(FUSE);
    const resolved = resolveConfiguration(db, { modelId: fuse, selectedOptionIds: [] });
    const added = writer.addConfiguredItem({ modelId: fuse, selectedOptionIds: [] }, 2);
    expect(added.configuredItems).toHaveLength(1);
    expect(added.configuredItems[0]!.bom.map(row => row.manufacturerCode).sort()).toEqual(["013325", "021400"]);
    expect(added.lines).toEqual([expect.objectContaining({ lineType: "item", quantity: 2,
      lineTotalE4: resolved.totalE4! * 2 })]);
    const merged = writer.addConfiguredItem({ modelId: fuse, selectedOptionIds: [] }, 1);
    expect(merged.configuredItems).toHaveLength(1);
    expect(merged.lines[0]).toMatchObject({ quantity: 3 });
    const sixteen = getConfigurationModel(db, fuse).axes[0]!.options[1]!.id;
    const both = writer.addConfiguredItem({ modelId: fuse, selectedOptionIds: [sixteen] });
    expect(both.configuredItems).toHaveLength(2);
    for (const name of ["STP - Gruppo di 6 connettori RJ45", "Contattori 16-125A 2 Poli"])
      expect(() => writer.addConfiguredItem({ modelId: modelId(name), selectedOptionIds: [] }))
        .toThrow("Solo una configurazione completa e attiva può essere aggiunta al progetto.");
    expect(writer.current()!.lines).toEqual(both.lines);
    await writer.save(); writer.close();
    const reopened = service(false).open(filename);
    expect(reopened.configuredItems).toEqual(both.configuredItems);
    expect(reopened.lines).toEqual(both.lines);
    expect(reopened.distinta).toEqual(both.distinta);
  });

  it("keeps the generic Catalogo and configuration renderer free of manufacturer or source literals", () => {
    for (const folder of ["src/renderer/catalogue", "src/renderer/configuration"]) for (const file of readdirSync(folder)) {
      const text = readFileSync(path.join(folder, file), "utf8");
      expect(text, file).not.toMatch(/BTicino|\bBTI\b|TiQuadri|Fusibil|\btq\./i);
    }
  });
});
