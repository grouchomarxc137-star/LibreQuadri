import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { MetelInput, MetelImportPreview, MetelImportResult } from "../../shared/metel-import.js";
import { applicationPaths } from "../data-paths.js";
import { assertCompatibleMigrationHistory } from "../database/lq-migrations.js";
import { openMigratedRawDatabase } from "../database/raw-migrations.js";
import { applyConnectionPragmas, assertQuickCheck } from "../database/sqlite-connection.js";
import { loadAttributeSeed } from "../catalogue/attribute-seed.js";
import { loadCategorySeed } from "../catalogue/category-seed.js";
import { loadProductFamilySeed } from "../catalogue/family-seed.js";
import { loadCapacityKindSeed, loadSourceBrandMapSeed } from "../catalogue/engineering-seed.js";
import { loadEngineeringVocabularySeed } from "../catalogue/engineering-vocabulary.js";
import { normalizeMetelDelivery, type NormalizeMetelDeliveryOptions } from "./catalogue-normalization.js";
import { assembleMetelDelivery, type DeliverySourceHashes } from "./delivery.js";
import { ingestMetelFile, metelSourceSha256 } from "./raw-ingestion.js";
import { parseCompleteMetelDelivery, type ValidatedMetelSource } from "./import-input.js";
import { BrandManagement } from "./brand-management.js";
import { loadSiemensNavigationSeed } from "../catalogue/siemens-navigation.js";

export interface MetelSessionOptions { readonly dataRoot: string; readonly applicationRoot: string }
interface Plan {
  directory: string;
  raw: Database.Database;
  sources: ValidatedMetelSource[];
  hashes: DeliverySourceHashes;
  dataVersion: number;
  preview: MetelImportPreview;
  seeds: Pick<NormalizeMetelDeliveryOptions, "attributeSeed" | "categorySeed" | "familySeed" | "capacityKindSeed" | "sourceBrandMapSeed" | "engineeringVocabularySeed" | "siemensNavigationSeed">;
}

/** Runs only in the import worker. No installed source/raw/catalogue writes during preview. */
export class MetelImportSession {
  private database: Database.Database | undefined;
  private plan: Plan | undefined;
  private brandManager: BrandManagement | undefined;
  constructor(private readonly options: MetelSessionOptions, private readonly progress: (message: string) => void = () => undefined) {}

  brands(): BrandManagement {
    this.discard();
    return this.brandManager ??= new BrandManagement(this.openCatalogue(),applicationPaths(this.options.dataRoot).backups,this.progress,
      loadSiemensNavigationSeed(path.join(this.options.applicationRoot,"db/seed")));
  }

  private openCatalogue(): Database.Database {
    if (this.database) return this.database;
    const db = new Database(applicationPaths(this.options.dataRoot).lqDatabase, {fileMustExist:true});
    try {
      db.pragma("busy_timeout = 5000"); db.pragma("foreign_keys = ON");
      const migrations = readMigrationFiles({migrationsFolder:path.join(this.options.applicationRoot,"db/migrations/lq")});
      assertCompatibleMigrationHistory(db,migrations);
      if (db.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get() !== migrations.length) throw new Error("Il catalogo deve essere aggiornato dall’app prima dell’importazione.");
      assertQuickCheck(db);
      this.database = db;
      return db;
    } catch (error) { db.close(); throw error; }
  }

  private dataVersion(): number { return this.openCatalogue().pragma("data_version",{simple:true}) as number; }
  private assertUnchanged(version: number): void {
    if (version !== this.dataVersion()) throw new Error("Il catalogo è cambiato dopo l’anteprima. Ripeti Verifica fornitura prima di importare.");
  }

  async preview(inputs: readonly MetelInput[]): Promise<MetelImportPreview> {
    this.discard();
    this.progress("Validazione completa dei tre file…");
    const sources = parseCompleteMetelDelivery(inputs);
    const db = this.openCatalogue();
    const dataVersion = this.dataVersion();
    const directory = mkdtempSync(path.join(tmpdir(),"librequadri-metel-preview-"));
    let raw: Database.Database | undefined;
    try {
      raw = openMigratedRawDatabase({databaseFilename:path.join(directory,"raw.db"),migrationsFolder:path.join(this.options.applicationRoot,"db/migrations/raw")});
      const hashes: Partial<Record<"LSP" | "FSC" | "FST", string>> = {};
      for (const source of sources) {
        const result = ingestMetelFile({database:raw,sourceBytes:source.bytes,originalFileName:source.name});
        hashes[result.fileType] = result.fileSha256;
      }
      const completeHashes = hashes as Required<DeliverySourceHashes>;
      const delivery = assembleMetelDelivery(raw,completeHashes);
      const seedFolder = path.join(this.options.applicationRoot,"db/seed");
      const seeds = {categorySeed:loadCategorySeed(seedFolder),attributeSeed:loadAttributeSeed(seedFolder),familySeed:loadProductFamilySeed(seedFolder),
        capacityKindSeed:loadCapacityKindSeed(seedFolder),sourceBrandMapSeed:loadSourceBrandMapSeed(seedFolder),engineeringVocabularySeed:loadEngineeringVocabularySeed(seedFolder),
        siemensNavigationSeed:loadSiemensNavigationSeed(seedFolder)};
      this.progress("Preparazione dell’anteprima su una copia del catalogo…");
      const baseline = path.join(directory,"baseline.db");
      await db.backup(baseline);
      this.assertUnchanged(dataVersion);
      // The backup is closed before copying; neither side depends on WAL/SHM files.
      const closed = new Database(baseline);
      try { closed.pragma("journal_mode = DELETE"); } finally { closed.close(); }
      const candidatePath = path.join(directory,"candidate.db");
      copyFileSync(baseline,candidatePath);
      const candidate = new Database(candidatePath);
      let preview: MetelImportPreview;
      try {
        applyConnectionPragmas(candidate,"lq");
        this.progress("Simulazione aggiornamento prezzi, articoli e famiglie…");
        const result = normalizeMetelDelivery({lqDatabase:candidate,rawDatabase:raw,sources:completeHashes,acceptOlderDelivery:true,...seeds});
        candidate.prepare("ATTACH DATABASE ? AS previous").run(baseline);
        const count = (sql: string) => candidate.prepare(sql).pluck().get() as number;
        const issuerId = candidate.prepare("SELECT id FROM cat_metel_issuer WHERE metel_sigla=?").pluck().get(delivery.issuerSigla) as number;
        const delisted = `FROM previous.cat_product_listing old JOIN cat_product_listing next ON next.product_id=old.product_id AND next.issuer_id=old.issuer_id
          WHERE old.issuer_id=${issuerId} AND old.is_listed=1 AND next.is_listed=0`;
        const productColumns = ["ean","short_description","unit_of_measure","pack_qty","min_order_qty","order_multiple","max_order_qty","lead_time_code","lifecycle_status_code","is_kit","discount_family_id","statistical_family_id"];
        const warnings: string[] = [];
        const currentDate = candidate.prepare("SELECT valid_from FROM previous.com_price_list WHERE issuer_id=? AND is_current=1").pluck().get(issuerId) as string | undefined;
        const older = !!currentDate && delivery.validFrom < currentDate;
        if (older) warnings.push("Fornitura più vecchia del listino corrente: verrà importata solo nello storico prezzi, senza sostituire il listino corrente.");
        if (!result.alreadyNormalized && currentDate === delivery.validFrom) warnings.push("Stessa decorrenza del listino corrente: questa fornitura ne sostituirà la versione corrente.");
        if (result.summary.unknownFamilyCount) warnings.push(`${result.summary.unknownFamilyCount} riferimenti a famiglie non presenti in FSC/FST: saranno conservati come famiglie sconosciute.`);
        if (result.summary.engineeringVocabularyWarnings) warnings.push("Alcune associazioni degli attributi tecnici richiedono revisione; i dettagli sono conservati nel rapporto della fornitura.");
        const largePriceChanges=count(`SELECT count(*) FROM com_product_price next JOIN com_price_list nl ON nl.id=next.price_list_id AND nl.is_current=1
          JOIN previous.com_price_list ol ON ol.issuer_id=nl.issuer_id AND ol.is_current=1
          JOIN previous.com_product_price old ON old.price_list_id=ol.id AND old.product_id=next.product_id
          WHERE abs(next.list_price_unit_e4-old.list_price_unit_e4)*100 > old.list_price_unit_e4*50`);
        if(largePriceChanges)warnings.push(`${largePriceChanges} prezzi unitari variano di oltre il 50% rispetto al listino corrente (inclusi i prezzi prima a zero). Verifica la fornitura prima di confermare.`);
        preview = {
          token:randomUUID(),issuer:delivery.issuerSigla,listino:delivery.listinoNumber,validFrom:delivery.validFrom,older,alreadyImported:result.alreadyNormalized,
          files:sources.map(s=>({name:s.name,type:s.parsed.metadata.fileType,version:s.parsed.metadata.layoutVersion,rows:s.parsed.priceListRows.length+s.parsed.familyRows.length})),
          brands:[...new Set(delivery.priceRows.map(r=>r.marchio))].sort(),
          addedProducts:count("SELECT count(*) FROM cat_product next LEFT JOIN previous.cat_product old ON old.id=next.id WHERE old.id IS NULL"),
          updatedProducts:count(`SELECT count(*) FROM cat_product next JOIN previous.cat_product old ON old.id=next.id WHERE ${productColumns.map(c=>`next.${c} IS NOT old.${c}`).join(" OR ")}`),
          changedPrices:count(`SELECT count(*) FROM com_product_price next JOIN com_price_list nl ON nl.id=next.price_list_id AND nl.is_current=1
            JOIN previous.com_price_list ol ON ol.issuer_id=nl.issuer_id AND ol.is_current=1
            JOIN previous.com_product_price old ON old.price_list_id=ol.id AND old.product_id=next.product_id
            WHERE next.list_price_e4!=old.list_price_e4 OR next.price_multiplier!=old.price_multiplier OR next.currency!=old.currency`),
          delistedListings:count(`SELECT count(*) ${delisted}`),
          newlyUnlistedProducts:count("SELECT count(*) FROM cat_product next JOIN previous.cat_product old ON old.id=next.id WHERE old.is_listed=1 AND next.is_listed=0"),
          reactivatedListings:count(`SELECT count(*) FROM cat_product_listing next JOIN previous.cat_product_listing old ON old.product_id=next.product_id AND old.issuer_id=next.issuer_id WHERE old.is_listed=0 AND next.is_listed=1`),
          newBrands:count("SELECT count(*) FROM cat_brand next LEFT JOIN previous.cat_brand old ON old.id=next.id WHERE old.id IS NULL"),
          changedFamilies:count("SELECT count(*) FROM cat_metel_family next LEFT JOIN previous.cat_metel_family old ON old.id=next.id WHERE old.id IS NULL OR next.description IS NOT old.description OR next.is_known!=old.is_known"),
          unknownFamilies:result.summary.unknownFamilyCount,
          delistedExamples:(candidate.prepare(`SELECT b.metel_marchio||' / '||p.manufacturer_code AS code FROM previous.cat_product p
            JOIN previous.cat_brand b ON b.id=p.brand_id WHERE p.id IN (SELECT old.product_id ${delisted}) ORDER BY code LIMIT 20`).all() as {code:string}[]).map(r=>r.code),
          warnings,
        };
        if (preview.delistedListings) warnings.push(`${preview.delistedListings} ${preview.delistedListings===1?"articolo non compare":"articoli non compaiono"} nel nuovo LSP dell’emittente. Verifica che il listino sia completo, non un estratto o un aggiornamento parziale.`);
      } finally { candidate.close(); }
      this.assertUnchanged(dataVersion);
      this.plan = {directory,raw,sources,hashes:completeHashes,dataVersion,preview,seeds};
      return preview;
    } catch (error) { raw?.close(); rmSync(directory,{recursive:true,force:true}); throw error; }
  }

  apply(token: string, acceptOlder: boolean): MetelImportResult {
    const plan = this.plan;
    if (!plan || token !== plan.preview.token) throw new Error("Anteprima assente o scaduta. Ripeti Verifica fornitura.");
    if (plan.preview.older && !acceptOlder) throw new Error("Conferma esplicitamente l’importazione del solo storico prezzi.");
    const db = this.openCatalogue();
    try {
      this.assertUnchanged(plan.dataVersion);
      if (plan.preview.alreadyImported) return {
        deliveryId:db.prepare("SELECT id FROM app_import_delivery WHERE fingerprint=?").pluck().get(assembleMetelDelivery(plan.raw,plan.hashes).fingerprint) as number,
        alreadyImported:true,becameCurrent:false,productCount:0,warnings:[],
      };
      this.progress("Creazione backup del catalogo…");
      const paths = applicationPaths(this.options.dataRoot);
      mkdirSync(paths.backups,{recursive:true});
      const backup = path.join(paths.backups,`metel-${Date.now()}-${randomUUID()}.db`);
      db.prepare("VACUUM INTO ?").run(backup);
      const saved = new Database(backup,{readonly:true});
      try { assertQuickCheck(saved); } finally { saved.close(); }
      this.assertUnchanged(plan.dataVersion);
      this.progress("Archiviazione delle sorgenti originali…");
      this.archive(plan);
      this.progress("Applicazione completa della fornitura…");
      const result = normalizeMetelDelivery({lqDatabase:db,rawDatabase:plan.raw,sources:plan.hashes,...plan.seeds,
        acceptOlderDelivery:acceptOlder,beforeWrite:()=>this.assertUnchanged(plan.dataVersion)});
      return {deliveryId:result.deliveryId,alreadyImported:result.alreadyNormalized,becameCurrent:result.becameCurrent,
        productCount:result.summary.productCount,warnings:plan.preview.warnings};
    } finally { this.discard(); }
  }

  private archive(plan: Plan): void {
    const delivery = assembleMetelDelivery(plan.raw,plan.hashes);
    const root = path.join(applicationPaths(this.options.dataRoot).imports,"metel",delivery.issuerSigla);
    mkdirSync(root,{recursive:true});
    const final = path.join(root,delivery.fingerprint);
    const files = plan.sources.map(source => ({source,file:`${source.parsed.metadata.fileType}.txt`,sha256:metelSourceSha256(source.bytes)}));
    if (existsSync(final)) {
      for (const file of files) if (metelSourceSha256(readFileSync(path.join(final,file.file))) !== file.sha256) throw new Error("Archivio sorgenti esistente non valido. Nessun aggiornamento applicato.");
      return;
    }
    const staging = mkdtempSync(path.join(root,".staging-"));
    try {
      for (const file of files) writeFileSync(path.join(staging,file.file),file.source.bytes,{flag:"wx"});
      writeFileSync(path.join(staging,"manifest.json"),JSON.stringify({fingerprint:delivery.fingerprint,files:files.map(f=>({file:f.file,originalName:f.source.name,sha256:f.sha256}))},null,2),{flag:"wx"});
      renameSync(staging,final);
    } finally { rmSync(staging,{recursive:true,force:true}); }
  }

  discard(): void {
    const plan=this.plan;this.plan=undefined;
    if(!plan)return;
    // Cleanup cannot turn a committed import into a reported failure.
    try { plan.raw.close(); }
    catch(error){console.warn("METEL staging close failed",error);}
    try { rmSync(plan.directory,{recursive:true,force:true}); }
    catch(error){console.warn("METEL temporary files retained",{directory:plan.directory,error});}
  }
  close(): void { this.discard(); this.database?.close(); this.database=undefined; }
}
