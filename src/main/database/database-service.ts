import { mkdirSync } from "node:fs";
import path from "node:path";

import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";

import * as lqSchema from "../../../db/schema/lq.js";
import type {
  CatalogueAttributeFilterOptions,
  CatalogueAttributeFilterRequest,
  CatalogueCategory,
  CatalogueOverview,
  CatalogueSearchRequest,
  CatalogueSearchResult,
  UnclassifiedRequest,
  UnclassifiedResult,
  ManufacturerNode,ManufacturerModel,ManufacturerArticle,ManufacturerArticleRequest,
  ManufacturerPosition,
  CatalogueBrowseRequest, CatalogueBrowseResult,
} from "../../shared/catalogue.js";
import type { CatalogueProductSnapshotSource, StructuralDesignKind, StructuralDiscovery, StructuralNavigation } from "../../shared/project.js";
import type { FrontVectorAsset } from "../../shared/project.js";
import { capacityFillerConfigurations, type CapacityFillerConfiguration } from "../catalogue/capacity-fillers.js";
import { readFrontVectorAssets } from "../catalogue/vector-assets.js";
import type { ConfigurationRequest, ConfigurationResult, ConfigModelDetail, ConfigModelSummary,
  ProductModelEntry, RangeNode } from "../../shared/configuration.js";
import { browseRangeNodes, findConfigurationModel, getConfigurationModel, listNodeModels, listProductModels } from "../catalogue/configuration-queries.js";
import { resolveConfiguration } from "../catalogue/configuration-resolver.js";
import { offerSelection } from "../catalogue/package-offers.js";
import { discoverDesignCandidates, discoverDesignRangeNodes, guardConfiguredStructuralItem,
  discoverReferenceDevices, discoverCompatiblePanels, checkConfiguredPanelReference,
  guardDesignCandidate, type ConfiguredItemGuardRequest, type DesignGuardRequest,
  type DesignGuardResult } from "../project/design-compatibility.js";
import { listCategories } from "../catalogue/attribute-queries.js";
import {
  getAttributeFilterOptions,
  getCatalogueOverview,
  getCatalogueProductSnapshot,
  searchCatalogue,
  getUnclassifiedFamilies,
} from "../catalogue/catalogue-queries.js";
import { applicationPaths, type ApplicationPaths } from "../data-paths.js";
import { closeConfiguredDatabase } from "./sqlite-connection.js";
import { openMigratedLqDatabase } from "./lq-migrations.js";
import { synchronizeFstNavigation } from "../metel/fst-navigation.js";
import { browseManufacturerNodes,listManufacturerModels,listManufacturerArticles,
  manufacturerPositions } from "../catalogue/manufacturer-navigation.js";
import { browseCatalogue } from "../catalogue/browse-queries.js";
import { AppSettingsStore } from "../app/app-settings.js";
import { RecentProjectStore } from "../app/recent-projects.js";
import { readEngineeringReadiness, type EngineeringSourceReadiness } from "../catalogue/engineering-readiness.js";

export interface DatabaseHealth {
  readonly catalogue: "ok";
}

export interface MainDatabaseServiceOptions {
  readonly migrationsFolder?: string;
}

export const DEFAULT_LQ_MIGRATIONS_FOLDER = path.resolve(
  "db",
  "migrations",
  "lq",
);

/**
 * Main-process ownership boundary for application databases.
 * Renderer code reaches it only through the typed, validated IPC handlers.
 */
export class MainDatabaseService {
  readonly #paths: ApplicationPaths;
  readonly #sqlite;
  readonly #catalogue: BetterSQLite3Database<typeof lqSchema>;
  /** Application preferences and the "Recenti" list, stored in lq.db (DATABASE_DESIGN §6). */
  readonly settings: AppSettingsStore;
  readonly recentProjects: RecentProjectStore;
  #closed = false;

  private constructor(
    paths: ApplicationPaths,
    options: MainDatabaseServiceOptions,
  ) {
    this.#paths = paths;
    mkdirSync(paths.data, { recursive: true });
    this.#sqlite = openMigratedLqDatabase({
      databaseFilename: paths.lqDatabase,
      backupDirectory: paths.backups,
      migrationsFolder:
        options.migrationsFolder ?? DEFAULT_LQ_MIGRATIONS_FOLDER,
    });
    if (this.#sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cat_range_source_level_map'").get() &&
        this.#sqlite.prepare("SELECT 1 FROM cat_metel_family WHERE family_type='STATISTICA' LIMIT 1").get() &&
        !this.#sqlite.prepare("SELECT 1 FROM cat_range_node WHERE source='metel' AND active=1 AND source_level='fst_family' LIMIT 1").get()) {
      try {
        const result=synchronizeFstNavigation(this.#sqlite);
        if(result.protectedCollisions.length)console.warn("Protected FST navigation nodes:",result.protectedCollisions);
      } catch(error) {
        console.error("FST navigation backfill failed; catalogue database remains available",error);
      }
    }
    this.#catalogue = drizzle(this.#sqlite, { schema: lqSchema });
    this.settings = new AppSettingsStore(this.#sqlite);
    this.recentProjects = new RecentProjectStore(this.#sqlite);
  }

  static initialize(
    userDataPath: string,
    options: MainDatabaseServiceOptions = {},
  ): MainDatabaseService {
    return new MainDatabaseService(applicationPaths(userDataPath), options);
  }

  healthCheck(): DatabaseHealth {
    this.assertOpen();
    const result = this.#sqlite.pragma("quick_check", { simple: true });
    if (result !== "ok") {
      throw new Error(`SQLite quick_check failed: ${String(result)}`);
    }
    return { catalogue: "ok" };
  }

  searchCatalogue(request: CatalogueSearchRequest): CatalogueSearchResult {
    this.assertOpen();
    return searchCatalogue(this.#sqlite, request);
  }

  browse(request: CatalogueBrowseRequest): CatalogueBrowseResult {
    this.assertOpen();
    return browseCatalogue(this.#sqlite, request);
  }

  catalogueOverview(): CatalogueOverview {
    this.assertOpen();
    return getCatalogueOverview(this.#sqlite);
  }

  /** Source-level diagnostics; schema health and commercial METEL readiness are independent. */
  engineeringSourceStatus():readonly EngineeringSourceReadiness[] {
    this.assertOpen();return readEngineeringReadiness(this.#sqlite).sources;
  }

  unclassifiedFamilies(request: UnclassifiedRequest): UnclassifiedResult {
    this.assertOpen();
    return getUnclassifiedFamilies(this.#sqlite, request);
  }

  catalogueCategories(): readonly CatalogueCategory[] {
    this.assertOpen();
    return listCategories(this.#sqlite);
  }

  attributeFilterOptions(request: CatalogueAttributeFilterRequest): CatalogueAttributeFilterOptions {
    this.assertOpen();
    return getAttributeFilterOptions(this.#sqlite, request);
  }

  manufacturerNodes(brandMarchio?:string):ManufacturerNode[] {
    this.assertOpen();return browseManufacturerNodes(this.#sqlite,brandMarchio);
  }
  manufacturerModels(nodeId:number):ManufacturerModel[] {
    this.assertOpen();return listManufacturerModels(this.#sqlite,nodeId);
  }
  manufacturerArticles(request:ManufacturerArticleRequest):ManufacturerArticle[] {
    this.assertOpen();return listManufacturerArticles(this.#sqlite,request);
  }
  manufacturerPositions(productId:number):ManufacturerPosition[] {
    this.assertOpen();return manufacturerPositions(this.#sqlite,productId);
  }

  catalogueProductSnapshot(productId: number): CatalogueProductSnapshotSource {
    this.assertOpen();
    return getCatalogueProductSnapshot(this.#sqlite, productId);
  }

  frontVectorAssets(keys: readonly string[]): Record<string,FrontVectorAsset> {
    this.assertOpen();
    return readFrontVectorAssets(this.#sqlite,this.#paths.assets,keys);
  }

  browseRanges(brandMarchio?:string):RangeNode[] {
    this.assertOpen();return browseRangeNodes(this.#sqlite,brandMarchio);
  }
  nodeModels(nodeId:number):ConfigModelSummary[] {
    this.assertOpen();return listNodeModels(this.#sqlite,nodeId);
  }
  productModels(productId:number):ProductModelEntry[] {
    this.assertOpen();return listProductModels(this.#sqlite,productId);
  }
  modelByCode(brandMarchio:string,modelCode:string):ConfigModelSummary|null {
    this.assertOpen();return findConfigurationModel(this.#sqlite,brandMarchio,modelCode);
  }
  configurationModel(modelId:number):ConfigModelDetail {
    this.assertOpen();return getConfigurationModel(this.#sqlite,modelId);
  }
  resolveConfiguration(request:ConfigurationRequest):ConfigurationResult {
    this.assertOpen();return resolveConfiguration(this.#sqlite,request);
  }
  offerSelection(modelId:number,offerNo:number) {
    this.assertOpen();return offerSelection(this.#sqlite,modelId,offerNo);
  }
  private modelSummaries(ids:readonly number[]):ConfigModelSummary[] {
    const lookup=this.#sqlite.prepare(`SELECT m.id,m.code,m.name,m.model_kind AS kind,
      b.metel_marchio AS brandMarchio,m.active,m.obsolete,
      m.commercial_contribution AS commercialContribution FROM cat_config_model m
      JOIN cat_brand b ON b.id=m.brand_id WHERE m.id=?`);
    return ids.map(id=>{
      const row=lookup.get(id) as Omit<ConfigModelSummary,"active"|"obsolete"> & {active:number;obsolete:number};
      return {...row,active:row.active===1,obsolete:row.obsolete===1};
    });
  }
  designDiscover(project:Database.Database,request:{kind:StructuralDesignKind;parentUuid?:string}):StructuralDiscovery {
    this.assertOpen();
    const result=discoverDesignCandidates(this.#sqlite,project,request);
    return {...result,candidates:this.modelSummaries(result.candidates)};
  }
  /** Eligible hierarchy for the renderer: local ids and display names only, no source codes. */
  designNavigation(project:Database.Database,request:{kind:StructuralDesignKind;parentUuid?:string}):StructuralNavigation {
    this.assertOpen();
    const result=discoverDesignRangeNodes(this.#sqlite,project,request);
    return {...result,candidates:this.modelSummaries(result.candidates),
      nodes:result.nodes.map(({id,parentId,name,kind,sortOrder,modelIds})=>
        ({id,parentId,name,kind,sortOrder,modelIds}))};
  }
  referenceDevices(project:Database.Database,parentUuid:string):StructuralNavigation {
    this.assertOpen();return this.navigationView(discoverReferenceDevices(this.#sqlite,project,parentUuid));
  }
  private navigationView(result:ReturnType<typeof discoverDesignRangeNodes>):StructuralNavigation {
    return {...result,candidates:this.modelSummaries(result.candidates),
      nodes:result.nodes.map(({id,parentId,name,kind,sortOrder,modelIds})=>({id,parentId,name,kind,sortOrder,modelIds}))};
  }
  compatiblePanels(project:Database.Database,request:import("../../shared/project.js").CompatiblePanelsRequest) {
    this.assertOpen();const result=discoverCompatiblePanels(this.#sqlite,project,request);
    return {...result,navigation:this.navigationView(result.navigation)};
  }
  checkPanelReference(project:Database.Database,request:import("../../shared/project.js").PanelReferenceCheckRequest) {
    this.assertOpen();return checkConfiguredPanelReference(this.#sqlite,project,request);
  }
  /** Filler configurations the catalogue designates for a capacity kind (generic; see capacity-fillers.ts). */
  capacityFillers(capacityKind:string):CapacityFillerConfiguration[] {
    this.assertOpen();return capacityFillerConfigurations(this.#sqlite,capacityKind);
  }
  /** Main-process only; project open never calls this. */
  engineeringCatalogue():Database.Database { return this.#sqlite; }

  designItemGuard(project:Database.Database,request:ConfiguredItemGuardRequest):DesignGuardResult {
    this.assertOpen();return guardConfiguredStructuralItem(this.#sqlite,project,request);
  }
  designGuard(project:Database.Database,request:DesignGuardRequest,
    configuration:ConfigurationRequest):DesignGuardResult {
    this.assertOpen();return guardDesignCandidate(this.#sqlite,project,request,{mode:"add",configuration});
  }

  close(): void {
    if (this.#closed) {
      return;
    }

    closeConfiguredDatabase(this.#sqlite);
    this.#closed = true;
  }

  private assertOpen(): void {
    if (this.#closed) {
      throw new Error("Database service is closed");
    }
  }
}
