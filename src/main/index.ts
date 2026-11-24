import path from "node:path";

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session } from "electron";

import { registerCatalogueIpc, type IpcHandlerRegistry } from "./catalogue/catalogue-ipc.js";
import { registerConfigurationIpc } from "./catalogue/configuration-ipc.js";
import { initializeCategorySeed } from "./catalogue/category-startup.js";
import { resolveFrontOptionLabels } from "./catalogue/front-option-labels.js";
import { APPLICATION_NAME, applicationPaths, configureApplicationDataPath } from "./data-paths.js";
import { MainDatabaseService } from "./database/database-service.js";
import {
  isTrustedRendererFrame,
  rendererLocation,
} from "./renderer-location.js";
import { createMainWindow } from "./window.js";
import {
  ProjectLifecycleBusyError,
  ProjectLifecycleOperationGuard,
  registerProjectIpc,
  requestProjectClose,
  sanitizeProjectFilename,
  type ProjectFileDialogs,
  type ProjectIpcRegistry,
} from "./project/project-ipc.js";
import { ProjectDocumentService } from "./project/project-document-service.js";
import { registerPdfIpc } from "./documents/pdf-ipc.js";
import { ProjectPdfService } from "./documents/pdf-service.js";
import { ApplicationController } from "./app/application-controller.js";
import { registerAppIpc } from "./app/app-ipc.js";
import { RecentProjectHandles } from "./app/recent-projects.js";
import { ALPHA_NAME, ALPHA1_NAME, ALPHA11_NAME, ALPHA_SEED_DIRECTORY, BETA1_NAME, BETA1_SEED_DIRECTORY,
  isAlpha0Build, isAlpha1Build, isAlpha11Build, isBeta1Build } from "./alpha/identity.js";
import { ALPHA1_PROFILE, ALPHA11_PROFILE, BETA1_PROFILE, provisionAlphaSeed } from "./alpha/seed.js";
import { MetelImportService } from "./metel/import-service.js";
import { registerMetelImportIpc } from "./metel/import-ipc.js";
import { registerBrandIpc } from "./metel/brand-ipc.js";
import { METEL_IMPORT_CHANNELS } from "../shared/metel-import.js";
import { APP_CHANNELS } from "../shared/app.js";
import { syncDevelopmentEngineering, needsDevelopmentEngineeringUpgrade } from "./development/engineering-sync.js";
import { describeEngineeringSyncError } from "./development/catalogue-exclusion.js";

const alpha0 = isAlpha0Build(app.isPackaged, app.getVersion());
const alpha1 = isAlpha1Build(app.isPackaged, app.getVersion());
const alpha11 = isAlpha11Build(app.isPackaged, app.getVersion());
const beta1 = isBeta1Build(app.isPackaged, app.getVersion());
const internalRelease = alpha0 || alpha1 || alpha11 || beta1;
const releaseName = beta1 ? BETA1_NAME : alpha11 ? ALPHA11_NAME : alpha1 ? ALPHA1_NAME : ALPHA_NAME;
configureApplicationDataPath(app, { alpha: internalRelease, alphaName: releaseName });
if (alpha0) nativeTheme.themeSource = "light";
if (internalRelease) app.setAboutPanelOptions({ applicationName: releaseName,
  applicationVersion: beta1 ? "Beta 1.0" : alpha11 ? "Alpha 1.1" : alpha1 ? "Alpha 1" : "Alpha 0", version: app.getVersion() });

let databaseService: MainDatabaseService | undefined;
let metelImporter: MetelImportService | undefined;
let mainWindow: BrowserWindow | undefined;
let projectService: ProjectDocumentService | undefined;
let projectDialogs: ProjectFileDialogs | undefined;
let controller: ApplicationController | undefined;
let allowWindowClose = false;
let windowClosePending = false;
let appQuitApproved = false;
let appQuitPending = false;
let engineeringSyncInProgress = false;
let quitAfterEngineeringSync = false;
const projectLifecycle = new ProjectLifecycleOperationGuard();
const lqMigrationsFolder = path.join(
  app.getAppPath(),
  "db",
  "migrations",
  "lq",
);
const location = rendererLocation(app.getAppPath());
const projectMigrationsFolder = path.join(app.getAppPath(), "db", "migrations", "project");

async function showLifecycleBusyMessage(action: "close" | "quit"): Promise<void> {
  const options = {
    type: "info" as const,
    title: "Operazione progetto in corso",
    message: "Attendi il completamento dell’operazione sul progetto.",
    detail: action === "quit"
      ? "L’applicazione non è stata chiusa. Riprova a uscire al termine dell’operazione."
      : "La finestra non è stata chiusa. Riprova al termine dell’operazione.",
    buttons: ["OK"],
  };
  if (mainWindow) await dialog.showMessageBox(mainWindow, options);
  else await dialog.showMessageBox(options);
}

function openMainWindow(): void {
  mainWindow = createMainWindow(location);
  controller?.attachWindow(mainWindow);
  allowWindowClose = false;
  mainWindow.on("close", (event) => {
    if (metelImporter?.busy) {
      event.preventDefault();
      void dialog.showMessageBox(mainWindow!, {type:"info",message:"Importazione METEL in corso. Attendi il completamento.",buttons:["OK"]});
      return;
    }
    if (allowWindowClose || !projectService?.current() || !projectDialogs) return;
    event.preventDefault();
    if (windowClosePending) return;
    windowClosePending = true;
    void projectLifecycle.run(() => requestProjectClose(projectService!, projectDialogs!)).then((remaining) => {
      if (remaining || !mainWindow) return;
      allowWindowClose = true;
      mainWindow.close();
    }).catch(async (error: unknown) => {
      if (error instanceof ProjectLifecycleBusyError) await showLifecycleBusyMessage("close");
      else console.error("Failed to close project", error);
    }).finally(() => {
      windowClosePending = false;
      controller?.refresh();
    });
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
    allowWindowClose = false;
  });
}

function createProjectDialogs(): ProjectFileDialogs {
  return {
    chooseDestination: async (title) => {
      const options = {
        title: "Salva nuovo progetto",
        defaultPath: path.join(app.getPath("documents"), sanitizeProjectFilename(title ?? "Nuovo progetto")),
        filters: [{ name: "Progetto LibreQuadri", extensions: ["lqp"] }],
      };
      const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
      return result.canceled ? null : result.filePath;
    },
    chooseSaveAsDestination: async (suggestedName) => {
      const options = {
        title: "Salva progetto con nome",
        defaultPath: path.join(app.getPath("documents"), sanitizeProjectFilename(suggestedName.replace(/\.lqp$/i, ""))),
        filters: [{ name: "Progetto LibreQuadri", extensions: ["lqp"] }],
      };
      const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
      return result.canceled ? null : result.filePath;
    },
    chooseProjectToOpen: async () => {
      const options = {
        title: "Apri progetto",
        properties: ["openFile"] as ("openFile")[],
        filters: [{ name: "Progetto LibreQuadri", extensions: ["lqp"] }],
      };
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    confirmDirtyClose: async (documentName) => {
      const result = await dialog.showMessageBox(mainWindow!, {
        type: "warning", title: "Modifiche non salvate",
        message: `Vuoi salvare le modifiche a “${documentName}”?`,
        detail: "Se scegli Non salvare, la copia di lavoro verrà eliminata.",
        buttons: ["Salva", "Non salvare", "Annulla"], defaultId: 0, cancelId: 2,
      });
      return (["save", "discard", "cancel"] as const)[result.response] ?? "cancel";
    },
    resolveSaveConflict: async (documentName) => {
      const result = await dialog.showMessageBox(mainWindow!, {
        type: "warning", title: "Conflitto di salvataggio",
        message: `“${documentName}” è stato modificato da un altro programma o utente.`,
        detail: "Puoi sovrascrivere preservando prima la versione corrente, scegliere un altro nome oppure annullare.",
        buttons: ["Sovrascrivi", "Salva con nome…", "Annulla"], defaultId: 1, cancelId: 2,
      });
      return (["overwrite", "save-as", "cancel"] as const)[result.response] ?? "cancel";
    },
    resolveSaveFailure: async (documentName, message) => {
      const result = await dialog.showMessageBox(mainWindow!, {
        type: "error", title: "Salvataggio non riuscito",
        message: `Non è stato possibile salvare “${documentName}”.`, detail: message,
        buttons: ["Riprova", "Salva con nome…", "Annulla"], defaultId: 0, cancelId: 2,
      });
      return (["retry", "save-as", "cancel"] as const)[result.response] ?? "cancel";
    },
  };
}

async function offerCrashRecovery(service: ProjectDocumentService): Promise<void> {
  for (const recovery of service.recoveries()) {
    const result = await dialog.showMessageBox({
      type: "warning", title: "Recupero progetto",
      message: `È disponibile una copia non salvata di “${recovery.documentName}”.`,
      detail: "Il progetto recuperato dovrà essere salvato con un nuovo nome e non sovrascriverà automaticamente l’originale.",
      buttons: ["Recupera", "Scarta", "Non ora"], defaultId: 0, cancelId: 2,
    });
    if (result.response === 0) {
      try { service.openRecovery(recovery.id); }
      catch (error) {
        dialog.showErrorBox("Recupero non riuscito", error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (result.response === 1) service.discardRecovery(recovery.id);
    else return;
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app
    .whenReady()
    .then(async () => {
      if (internalRelease) {
        const result = provisionAlphaSeed(path.join(process.resourcesPath, beta1 ? BETA1_SEED_DIRECTORY : ALPHA_SEED_DIRECTORY),
          app.getPath("userData"), lqMigrationsFolder, beta1 ? BETA1_PROFILE : alpha11 ? ALPHA11_PROFILE : alpha1 ? ALPHA1_PROFILE : undefined);
        console.info(`${releaseName} catalogue startup:`, result);
      }
      const userData = app.getPath("userData");
      const openDatabase = () => MainDatabaseService.initialize(userData, { migrationsFolder: lqMigrationsFolder });
      let service = openDatabase();
      if (!app.isPackaged && process.env.NODE_ENV !== "production" &&
        needsDevelopmentEngineeringUpgrade(service.engineeringSourceStatus())) {
        service.close();
        engineeringSyncInProgress = true;
        try {
          await syncDevelopmentEngineering({ dataRoot: userData, applicationRoot: app.getAppPath(), log: console.info });
        } catch (error) {
          const diagnostic = describeEngineeringSyncError(error);
          console.error("Automatic engineering catalogue update failed", diagnostic);
          const detail = /SQLITE_(BUSY|LOCKED)/.test(diagnostic)
            ? "Chiudi le altre applicazioni che usano il catalogo e riavvia LibreQuadri."
            : "Verifica che gli archivi originali TiQuadri, ListinoBT e dei disegni siano disponibili, poi riavvia LibreQuadri.";
          await dialog.showMessageBox({ type: "warning", title: "Catalogo di ingegneria",
            message: "Il catalogo di ingegneria non è stato aggiornato.", detail,
            buttons: ["Continua con dati salvati"] });
        } finally {
          engineeringSyncInProgress = false;
        }
        if (quitAfterEngineeringSync) {
          app.quit();
          return;
        }
        service = openDatabase();
      }
      try {
        const vocabularyWarnings = await initializeCategorySeed(
          applicationPaths(app.getPath("userData")).lqDatabase,
          path.join(app.getAppPath(), "db", "seed"),
        );
        if (vocabularyWarnings) console.warn("Engineering vocabulary seed warnings:", vocabularyWarnings);
      } catch (error) {
        service.close();
        throw error;
      }
      databaseService = service;
      const paths = applicationPaths(app.getPath("userData"));
      projectService = new ProjectDocumentService({
        workingDirectory: paths.working,
        incomingDirectory: paths.incoming,
        backupDirectory: paths.projectBackups,
        migrationsFolder: projectMigrationsFolder,
        appVersion: app.getVersion(),
        resolveCatalogueProduct: (id) => service.catalogueProductSnapshot(id),
        engineeringCatalogue: () => service.engineeringCatalogue(),
        reconcileOnOpen: true,
        resolveConfiguration: (request) => service.resolveConfiguration(request),
        designDiscover: (project,request) => service.designDiscover(project,request),
        designNavigation: (project,request) => service.designNavigation(project,request),
        referenceDevices: (project,parentUuid) => service.referenceDevices(project,parentUuid),
        compatiblePanels: (project,request) => service.compatiblePanels(project,request),
        checkPanelReference: (project,request) => service.checkPanelReference(project,request),
        designItemGuard: (project,request) => service.designItemGuard(project,request),
        designGuard: (project,request,configuration) => service.designGuard(project,request,configuration),
        resolveFrontAssets: (keys) => service.frontVectorAssets(keys),
        resolveFrontOptionLabels: (items, placed) => resolveFrontOptionLabels(service.engineeringCatalogue(), items, placed),
        capacityFillers: (capacityKind) => service.capacityFillers(capacityKind),
        onDocumentStored: (document) => service.recentProjects.touch(document),
      });
      projectDialogs = createProjectDialogs();
      const documents = projectService;
      const dialogs = projectDialogs;
      const applicationController = new ApplicationController({
        applicationName: internalRelease ? releaseName : APPLICATION_NAME,
        development: !app.isPackaged,
        lightOnly: alpha0,
        catalogueImporting:()=>metelImporter?.busy??false,
        service: documents,
        dialogs,
        lifecycle: projectLifecycle,
        settings: service.settings,
        recent: service.recentProjects,
        window: () => mainWindow,
      });
      controller = applicationController;
      applicationController.applyTheme();
      // Every project request may change the menu state (dirty, open, recents).
      const refreshingRegistry: ProjectIpcRegistry = {
        handle: (channel, listener) => ipcMain.handle(channel, async (event, ...args) => {
          if (metelImporter?.applying) throw new Error("Importazione METEL in corso. Attendi il completamento.");
          try { return await listener(event, ...args); } finally { applicationController.refresh(); }
        }),
        removeHandler: (channel) => ipcMain.removeHandler(channel),
      };
      const trustedProjectSender = (event: { readonly senderFrame: unknown }) =>
        isTrustedRendererFrame(event.senderFrame as Parameters<typeof isTrustedRendererFrame>[0], location.indexUrl);

      registerCatalogueIpc(ipcMain, service, (event) =>
        isTrustedRendererFrame(event.senderFrame, location.indexUrl),
      );
      const configurationRegistry: IpcHandlerRegistry = {
        handle:(channel,listener)=>ipcMain.handle(channel,(event,...args)=>{
          if(metelImporter?.applying)throw new Error("Importazione METEL in corso. Attendi il completamento.");
          return listener(event,...args);
        }),
        removeHandler:channel=>ipcMain.removeHandler(channel),
      };
      registerConfigurationIpc(configurationRegistry, service, (event) =>
        isTrustedRendererFrame(event.senderFrame, location.indexUrl),
      );
      registerProjectIpc(refreshingRegistry, documents, dialogs, trustedProjectSender, projectLifecycle);
      const pdf = new ProjectPdfService(() => mainWindow);
      registerPdfIpc(ipcMain, documents, pdf, trustedProjectSender);
      registerAppIpc(refreshingRegistry, {
        service: documents, dialogs, lifecycle: projectLifecycle, recent: service.recentProjects,
        handles: new RecentProjectHandles(), isTrustedSender: trustedProjectSender,
      });
      metelImporter = new MetelImportService({dataRoot:app.getPath("userData"),applicationRoot:app.getAppPath()},message=>{
        if(mainWindow && !mainWindow.isDestroyed())mainWindow.webContents.send(METEL_IMPORT_CHANNELS.progress,message);
      });
      registerMetelImportIpc(ipcMain,{
        preview:inputs=>metelImporter!.preview(inputs),
        apply:(token,acceptOlder)=>projectLifecycle.run(async()=>{
          const result=await metelImporter!.apply(token,acceptOlder);
          if(mainWindow && !mainWindow.isDestroyed())mainWindow.webContents.send(APP_CHANNELS.stateChanged,{reason:"catalogue"});
          return result;
        }),
        discard:()=>metelImporter!.discard(),
      },event=>isTrustedRendererFrame(event.senderFrame,location.indexUrl));
      const afterBrandChange=async(action:()=>Promise<void>)=>projectLifecycle.run(async()=>{
        await action();
        if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send(APP_CHANNELS.stateChanged,{reason:"catalogue"});
      });
      registerBrandIpc(ipcMain,{
        list:()=>metelImporter!.brandList(),
        previewRemoval:id=>metelImporter!.previewBrandRemoval(id),
        setActive:(brandId,active)=>afterBrandChange(()=>metelImporter!.mutateBrand("brand-active",{brandId,active})),
        remove:token=>afterBrandChange(()=>metelImporter!.mutateBrand("brand-remove",{token})),
      },event=>isTrustedRendererFrame(event.senderFrame,location.indexUrl));
      session.defaultSession.setPermissionRequestHandler(
        (_webContents, _permission, callback) => callback(false),
      );
      await offerCrashRecovery(projectService);
      applicationController.refresh();
      openMainWindow();
    })
    .catch((error: unknown) => {
      console.error("Failed to initialize LibreQuadri", error);
      if (internalRelease) dialog.showErrorBox(releaseName, error instanceof Error ? error.message : String(error));
      app.exit(1);
    });

  app.on("second-instance", () => {
    if (databaseService && !mainWindow) {
      openMainWindow();
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on("activate", () => {
    if (databaseService && !mainWindow) {
      openMainWindow();
    }
  });

  app.on("before-quit", (event) => {
    if (engineeringSyncInProgress) {
      event.preventDefault();
      quitAfterEngineeringSync = true;
      return;
    }
    if (metelImporter?.busy) {
      event.preventDefault();
      void dialog.showMessageBox({type:"info",message:"Importazione METEL in corso. Attendi il completamento.",buttons:["OK"]});
      return;
    }
    if (!appQuitApproved && projectService?.current() && projectDialogs) {
      event.preventDefault();
      if (appQuitPending) return;
      appQuitPending = true;
      void projectLifecycle.run(() => requestProjectClose(projectService!, projectDialogs!)).then((remaining) => {
        if (remaining) return;
        appQuitApproved = true;
        app.quit();
      }).catch(async (error: unknown) => {
        if (error instanceof ProjectLifecycleBusyError) await showLifecycleBusyMessage("quit");
        else console.error("Failed to quit safely", error);
      }).finally(() => {
        appQuitPending = false;
        if (!appQuitApproved) controller?.refresh();
      });
      return;
    }
    metelImporter?.close();
    metelImporter = undefined;
    projectService?.close();
    projectService = undefined;
    projectDialogs = undefined;
    databaseService?.close();
    databaseService = undefined;
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
