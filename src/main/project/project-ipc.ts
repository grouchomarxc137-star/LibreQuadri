import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseConfigurationRequest } from "../catalogue/configuration-ipc.js";

import {
  FILLABLE_CAPACITY_KINDS,
  PROJECT_CHANNELS,
  STRUCTURAL_ADD_QUANTITY_MAX,
  STRUCTURAL_ADD_QUANTITY_MIN,
  type CreateProjectRequest,
  type ProjectAnnotationInput,
  type ProjectAnnotationPatch,
  type ProjectDocumentView,
  type ProjectPlacementInput,
  type ProjectPackedChildInput,
  type ProjectPackedMoveInput,
  type ProjectPlacementTargetRequest,
  type ProjectStructuralPlacement,
  type ProjectFillRequest,
} from "../../shared/project.js";
import {
  ProjectSaveError,
  validateProjectMetadata,
  type ProjectDocumentService,
} from "./project-document-service.js";

export interface ProjectInvokeEvent { readonly senderFrame: unknown; }
export interface ProjectIpcRegistry {
  handle(channel: string, listener: (event: ProjectInvokeEvent, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}
export interface ProjectFileDialogs {
  chooseDestination(suggestedTitle?: string): Promise<string | null>;
  chooseSaveAsDestination(suggestedName: string): Promise<string | null>;
  chooseProjectToOpen(): Promise<string | null>;
  confirmDirtyClose(documentName: string): Promise<"save" | "discard" | "cancel">;
  resolveSaveConflict(documentName: string): Promise<"overwrite" | "save-as" | "cancel">;
  resolveSaveFailure(documentName: string, message: string): Promise<"retry" | "save-as" | "cancel">;
}

interface SaveInteractionResult {
  readonly completed: boolean;
  readonly view: ProjectDocumentView;
}

export class ProjectLifecycleOperationGuard {
  #active: Promise<unknown> | null = null;

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#active) return Promise.reject(new ProjectLifecycleBusyError());
    const running = Promise.resolve().then(operation);
    this.#active = running;
    return running.finally(() => {
      if (this.#active === running) this.#active = null;
    });
  }
}

export class ProjectLifecycleBusyError extends Error {
  constructor() {
    super("Un'altra operazione sul progetto è già in corso.");
    this.name = "ProjectLifecycleBusyError";
  }
}

function referenceDevice(value:unknown):import("../../shared/project.js").ReferenceDevice {
  const row=annotationFields(value,["configuration","definitionFingerprint"]);
  if(typeof row.definitionFingerprint!=="string"||!row.definitionFingerprint||row.definitionFingerprint.length>256)
    throw new Error("Identità della definizione non valida.");
  return {configuration:parseConfigurationRequest(row.configuration),definitionFingerprint:row.definitionFingerprint};
}
function panelReference(value:unknown):import("../../shared/project.js").CompatiblePanelsRequest {
  const row=annotationFields(value,["parentUuid","device"]);
  return {parentUuid:lineUuid(row.parentUuid),device:referenceDevice(row.device)};
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label} non valido.`);
  return value as number;
}

function lineUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new Error("UUID riga non valido.");
  return value;
}

/** Plain objects with exactly the allowed fields; the service validates the values. */
function annotationFields(value:unknown,allowed:readonly string[]):Record<string,unknown> {
  if(!value || typeof value!=="object" || Array.isArray(value))throw new Error("Annotazione non valida.");
  const source=value as Record<string,unknown>;
  if(Object.keys(source).some(key=>!allowed.includes(key)))throw new Error("L'annotazione contiene campi inattesi.");
  return source;
}
function annotationInput(value:unknown):ProjectAnnotationInput {
  const source=annotationFields(value,["text","xMm","yMm","widthMm","heightMm","fontSizeMm"]);
  return {text:source["text"] as string,xMm:source["xMm"] as number,yMm:source["yMm"] as number,
    widthMm:source["widthMm"] as number,heightMm:source["heightMm"] as number,
    ...("fontSizeMm" in source?{fontSizeMm:source["fontSizeMm"] as number}:{})};
}
function annotationPatch(value:unknown):ProjectAnnotationPatch {
  const source=annotationFields(value,["text","xMm","yMm","widthMm","heightMm","fontSizeMm"]);
  const pick=<K extends keyof ProjectAnnotationInput>(key:K):Partial<Pick<ProjectAnnotationInput,K>> =>
    key in source?{[key]:source[key]} as Pick<ProjectAnnotationInput,K>:{};
  return {...pick("text"),...pick("xMm"),...pick("yMm"),...pick("widthMm"),...pick("heightMm"),...pick("fontSizeMm")};
}

function placementInput(value:unknown):ProjectPlacementInput {
  if(!value || typeof value!=="object" || Array.isArray(value))throw new Error("Posizione fisica non valida.");
  const row=value as Record<string,unknown>;
  const allowed=["itemUuid","parentUuid","zoneNo","startUnits","slotNo","rootXMm","rootYMm","viewCode"];
  if(Object.keys(row).some(key=>!allowed.includes(key)))throw new Error("Posizione fisica non valida.");
  lineUuid(row.itemUuid);
  if(row.parentUuid!==undefined)lineUuid(row.parentUuid);
  if(typeof row.viewCode!=="string" || !["front","front_alt1","front_alt2"].includes(row.viewCode))
    throw new Error("Vista fisica non valida.");
  for(const key of ["zoneNo","startUnits","slotNo"])
    if(row[key]!==undefined && (!Number.isSafeInteger(row[key]) || (row[key] as number)<0))
      throw new Error("Posizione fisica non valida.");
  for(const key of ["rootXMm","rootYMm"])
    if(row[key]!==undefined && (typeof row[key]!=="number" || !Number.isFinite(row[key])))
      throw new Error("Coordinate fisiche non valide.");
  return row as unknown as ProjectPlacementInput;
}
function packedChildInput(value:unknown):ProjectPackedChildInput {
  if(!value || typeof value!=="object" || Array.isArray(value))throw new Error("Posizione fisica non valida.");
  const row=value as Record<string,unknown>;
  if(Object.keys(row).some(key=>!["itemUuid","parentUuid","zoneNo","viewCode"].includes(key)))
    throw new Error("Posizione fisica non valida.");
  lineUuid(row.itemUuid);lineUuid(row.parentUuid);
  if(!Number.isSafeInteger(row.zoneNo) || (row.zoneNo as number)<0 ||
    typeof row.viewCode!=="string" || !["front","front_alt1","front_alt2"].includes(row.viewCode))
    throw new Error("Posizione fisica non valida.");
  return row as unknown as ProjectPackedChildInput;
}
function fillRequest(value:unknown):ProjectFillRequest {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Richiesta di riempimento non valida.");
  const row=value as Record<string,unknown>;
  if(Object.keys(row).some(key=>key!=="capacityKind")||
    !(FILLABLE_CAPACITY_KINDS as readonly unknown[]).includes(row.capacityKind))
    throw new Error("Richiesta di riempimento non valida.");
  return {capacityKind:row.capacityKind as ProjectFillRequest["capacityKind"]};
}
function packedIndex(value:unknown):number {
  if(!Number.isSafeInteger(value) || (value as number)<0)throw new Error("Indice della zona non valido.");
  return value as number;
}
function placementTargetRequest(value:unknown):ProjectPlacementTargetRequest {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Richiesta di posizionamento non valida.");
  const row=value as Record<string,unknown>;
  if(Object.keys(row).some(key=>!["parentUuid","itemUuid","nodeUuid","reflow"].includes(key))||
    ("reflow" in row&&(row.reflow!==true||!("nodeUuid" in row)))||
    ("itemUuid" in row)===("nodeUuid" in row))throw new Error("Richiesta di posizionamento non valida.");
  lineUuid(row.parentUuid);
  if("itemUuid" in row){lineUuid(row.itemUuid);return {parentUuid:row.parentUuid as string,itemUuid:row.itemUuid as string};}
  lineUuid(row.nodeUuid);
  return {parentUuid:row.parentUuid as string,nodeUuid:row.nodeUuid as string,...(row.reflow===true?{reflow:true}:{})};
}
function structuralPlacement(value:unknown):ProjectStructuralPlacement {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Posizionamento strutturale non valido.");
  const row=value as Record<string,unknown>;
  if(Object.keys(row).some(key=>!["action","input","index"].includes(key)))
    throw new Error("Posizionamento strutturale non valido.");
  if(row.action==="placeChild"){
    if("index" in row)throw new Error("Posizionamento strutturale non valido.");
    const input=placementInput(row.input);
    if(input.parentUuid===undefined)throw new Error("Posizionamento strutturale non valido.");
    return {action:"placeChild",input};
  }
  if(row.action==="insertPackedChild")
    return {action:"insertPackedChild",input:packedChildInput(row.input),
      ...("index" in row?{index:packedIndex(row.index)}:{})};
  throw new Error("Posizionamento strutturale non valido.");
}
function packedMoveInput(value:unknown):ProjectPackedMoveInput {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Spostamento fisico non valido.");
  const row=value as Record<string,unknown>;
  lineUuid(row.parentUuid);
  if(!Number.isSafeInteger(row.zoneNo)||(row.zoneNo as number)<0||
    typeof row.viewCode!=="string"||!["front","front_alt1","front_alt2"].includes(row.viewCode))
    throw new Error("Spostamento fisico non valido.");
  if("anchorUuid" in row){
    lineUuid(row.anchorUuid);
    if(Object.keys(row).length!==5||Object.keys(row).some(key=>
      !["parentUuid","zoneNo","viewCode","anchorUuid","direction"].includes(key))||
      (row.direction!=="forward"&&row.direction!=="backward"))
      throw new Error("Spostamento fisico non valido.");
  }else if(Object.keys(row).length!==4||Object.keys(row).some(key=>
    !["parentUuid","zoneNo","viewCode","index","startUnits"].includes(key))||
    ("index" in row)===("startUnits" in row)||
    ("index" in row&&(!Number.isSafeInteger(row.index)||(row.index as number)<0))||
    ("startUnits" in row&&(!Number.isSafeInteger(row.startUnits)||(row.startUnits as number)<0)))
    throw new Error("Spostamento fisico non valido.");
  return row as unknown as ProjectPackedMoveInput;
}

export function sanitizeProjectFilename(title: string): string {
  const sanitized = title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "");
  return `${sanitized || "Nuovo progetto"}.lqp`;
}

function lqpPath(selectedPath: string): string {
  return path.extname(selectedPath).toLowerCase() === ".lqp" ? selectedPath : `${selectedPath}.lqp`;
}

async function chooseSaveAs(service: ProjectDocumentService, dialogs: ProjectFileDialogs): Promise<string | null> {
  const current = service.current();
  if (!current) throw new Error("Nessun progetto aperto.");
  const selected = await dialogs.chooseSaveAsDestination(current.documentName);
  return selected ? lqpPath(selected) : null;
}

export async function saveProjectWithDialogs(
  service: ProjectDocumentService,
  dialogs: ProjectFileDialogs,
  saveAsInitially = false,
): Promise<SaveInteractionResult> {
  let saveAsPath = saveAsInitially ? await chooseSaveAs(service, dialogs) : null;
  if (saveAsInitially && !saveAsPath) return { completed: false, view: service.current()! };
  let retryPending = false;
  let overwriteConflict = false;

  for (;;) {
    try {
      const allowOverwrite = overwriteConflict;
      overwriteConflict = false;
      const view = retryPending
        ? await service.retryPendingSave()
        : saveAsPath
          ? await service.saveAs(saveAsPath, allowOverwrite)
          : await service.save(allowOverwrite);
      return { completed: true, view };
    } catch (error) {
      if (error instanceof ProjectSaveError && error.kind === "save-as-required") {
        saveAsPath = await chooseSaveAs(service, dialogs);
        if (!saveAsPath) return { completed: false, view: service.current()! };
        retryPending = false;
        overwriteConflict = false;
        continue;
      }

      const current = service.current();
      if (!current) throw error;
      if (error instanceof ProjectSaveError && error.kind === "conflict") {
        const choice = await dialogs.resolveSaveConflict(current.documentName);
        if (choice === "cancel") {
          service.cancelPendingSave();
          return { completed: false, view: current };
        }
        if (choice === "save-as") {
          saveAsPath = await chooseSaveAs(service, dialogs);
          if (!saveAsPath) return { completed: false, view: current };
          retryPending = false;
          overwriteConflict = false;
        } else {
          service.cancelPendingSave();
          retryPending = false;
          overwriteConflict = true;
        }
        continue;
      }

      const message = error instanceof Error ? error.message : "Salvataggio non riuscito.";
      const choice = await dialogs.resolveSaveFailure(current.documentName, message);
      if (choice === "cancel") {
        service.cancelPendingSave();
        return { completed: false, view: current };
      }
      if (choice === "save-as") {
        saveAsPath = await chooseSaveAs(service, dialogs);
        if (!saveAsPath) return { completed: false, view: current };
        retryPending = false;
        overwriteConflict = false;
      } else {
        retryPending = error instanceof ProjectSaveError && error.kind === "replace-failed";
      }
    }
  }
}

export async function requestProjectClose(
  service: ProjectDocumentService,
  dialogs: ProjectFileDialogs,
): Promise<ProjectDocumentView | null> {
  const current = service.current();
  if (!current) return null;
  if (!current.dirty) {
    service.closeCurrent();
    return null;
  }
  const choice = await dialogs.confirmDirtyClose(current.documentName);
  if (choice === "cancel") return current;
  if (choice === "discard") {
    service.discardCurrent();
    return null;
  }
  const saved = await saveProjectWithDialogs(service, dialogs);
  if (!saved.completed) return saved.view;
  if (saved.view.dirty) return saved.view;
  service.closeCurrent();
  return null;
}

/**
 * Makes room for another document. A modified project goes through the normal
 * close confirmation (Salva / Non salvare / Annulla); an unmodified one stays
 * open and is replaced only when the next document is ready. Returns false
 * when the user kept the current project.
 */
export async function prepareProjectReplacement(
  service: ProjectDocumentService,
  dialogs: ProjectFileDialogs,
): Promise<boolean> {
  if (!service.current()?.dirty) return true;
  return await requestProjectClose(service, dialogs) === null;
}

/**
 * Open from the native menu or the recent list: the file is chosen first, so
 * cancelling the picker never closes the current project. Opening the file
 * that is already open keeps the current document.
 */
export async function openProjectInteractive(
  service: ProjectDocumentService,
  dialogs: ProjectFileDialogs,
  filename?: string,
): Promise<ProjectDocumentView | null> {
  const selected = filename ?? await dialogs.chooseProjectToOpen();
  if (!selected) return null;
  const current = service.current();
  if (current && service.currentTargetPath() === path.resolve(selected)) return current;
  if (!await prepareProjectReplacement(service, dialogs)) return null;
  return service.open(selected);
}

export function registerProjectIpc(
  registry: ProjectIpcRegistry,
  service: ProjectDocumentService,
  dialogs: ProjectFileDialogs,
  isTrustedSender: (event: ProjectInvokeEvent) => boolean,
  lifecycle: ProjectLifecycleOperationGuard,
): () => void {
  const destinations = new Map<string, string>();
  const trusted = (event: ProjectInvokeEvent): void => {
    if (!isTrustedSender(event)) throw new Error("Untrusted IPC sender");
  };
  registry.handle(PROJECT_CHANNELS.chooseDestination, async (event, title) => {
    trusted(event);
    service.assertReplacementAllowed();
    if (title !== undefined && (typeof title !== "string" || title.length > 200)) throw new Error("Nome progetto non valido.");
    const selectedPath = await dialogs.chooseDestination(title as string | undefined);
    if (!selectedPath) return null;
    const destinationPath = lqpPath(selectedPath);
    const token = randomUUID();
    destinations.set(token, destinationPath);
    return { token, displayName: path.basename(destinationPath) };
  });
  registry.handle(PROJECT_CHANNELS.create, (event, payload) => {
    trusted(event);
    const request = validateCreateRequest(payload);
    return lifecycle.run(() => {
      const destinationPath = destinations.get(request.destinationToken);
      if (!destinationPath) throw new Error("La destinazione selezionata non è più valida. Sceglila di nuovo.");
      destinations.delete(request.destinationToken);
      const { destinationToken: _destinationToken, ...metadata } = request;
      return service.create({ ...validateProjectMetadata(metadata), destinationPath });
    });
  });
  registry.handle(PROJECT_CHANNELS.open, (event) => {
    trusted(event);
    return lifecycle.run(async () => {
      service.assertReplacementAllowed();
      const filename = await dialogs.chooseProjectToOpen();
      return filename ? service.open(filename) : null;
    });
  });
  registry.handle(PROJECT_CHANNELS.save, (event) => {
    trusted(event); return lifecycle.run(() => saveProjectWithDialogs(service, dialogs).then((result) => result.view));
  });
  registry.handle(PROJECT_CHANNELS.saveAs, (event) => {
    trusted(event); return lifecycle.run(() => saveProjectWithDialogs(service, dialogs, true).then((result) => result.view));
  });
  registry.handle(PROJECT_CHANNELS.close, (event) => {
    trusted(event); return lifecycle.run(() => requestProjectClose(service, dialogs));
  });
  registry.handle(PROJECT_CHANNELS.engineeringStatus,(event)=>{trusted(event);return service.engineeringStatus();});
  registry.handle(PROJECT_CHANNELS.planEngineeringRefresh,(event)=>{
    trusted(event);return lifecycle.run(async()=>service.planEngineeringRefresh());
  });
  registry.handle(PROJECT_CHANNELS.applyEngineeringRefresh,(event,token)=>{
    trusted(event);
    if(typeof token!=="string"||!/^[0-9a-f]{64}$/.test(token))throw new Error("Token del piano non valido.");
    return lifecycle.run(async()=>service.applyEngineeringRefresh(token));
  });
  registry.handle(PROJECT_CHANNELS.current, (event) => { trusted(event); return service.current(); });
  registry.handle(PROJECT_CHANNELS.frontAssets, (event) => { trusted(event); return service.frontAssets(); });
  registry.handle(PROJECT_CHANNELS.designDiscover,(event,kind,parentUuid)=>{
    trusted(event);
    if(kind!=="enclosure"&&kind!=="support"&&kind!=="device")throw new Error("Tipo strutturale non valido.");
    return service.designDiscover(kind,parentUuid===undefined?undefined:lineUuid(parentUuid));
  });
  registry.handle(PROJECT_CHANNELS.designNavigation,(event,kind,parentUuid)=>{
    trusted(event);
    if(kind!=="enclosure"&&kind!=="support"&&kind!=="device")throw new Error("Tipo strutturale non valido.");
    return service.designNavigation(kind,parentUuid===undefined?undefined:lineUuid(parentUuid));
  });
  registry.handle(PROJECT_CHANNELS.referenceDevices,(event,parentUuid)=>{
    trusted(event);return service.referenceDevices(lineUuid(parentUuid));
  });
  registry.handle(PROJECT_CHANNELS.enclosureReferenceDevices,event=>{
    trusted(event);return service.enclosureReferenceDevices();
  });
  registry.handle(PROJECT_CHANNELS.compatibleEnclosures,(event,value)=>{
    trusted(event);const row=annotationFields(value,["device","enclosure"]);
    return service.compatibleEnclosures({device:referenceDevice(row.device),
      ...(row.enclosure===undefined?{}:{enclosure:parseConfigurationRequest(row.enclosure)})});
  });
  registry.handle(PROJECT_CHANNELS.compatiblePanels,(event,value)=>{
    trusted(event);return service.compatiblePanels(panelReference(value));
  });
  registry.handle(PROJECT_CHANNELS.checkPanelReference,(event,value)=>{
    trusted(event);const row=annotationFields(value,["parentUuid","device","panel"]);
    return service.checkPanelReference({...panelReference({parentUuid:row.parentUuid,device:row.device}),
      panel:parseConfigurationRequest(row.panel)});
  });
  registry.handle(PROJECT_CHANNELS.addStructural,(event,value)=>{
    trusted(event);
    if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Struttura non valida.");
    const row=value as Record<string,unknown>;
    if(Object.keys(row).some(key=>!["configuration","kind","parentUuid","zoneNo","place","quantity","referenceDevice","autoPlace"].includes(key))||
      (row.kind!=="enclosure"&&row.kind!=="support"&&row.kind!=="device")||
      (row.zoneNo!==undefined&&(!Number.isSafeInteger(row.zoneNo)||(row.zoneNo as number)<0))||
      (row.place!==undefined&&typeof row.place!=="boolean")||
      (row.autoPlace!==undefined&&typeof row.autoPlace!=="boolean")||
      (row.quantity!==undefined&&(!Number.isSafeInteger(row.quantity)||(row.quantity as number)<STRUCTURAL_ADD_QUANTITY_MIN||
        (row.quantity as number)>STRUCTURAL_ADD_QUANTITY_MAX)))
      throw new Error("Struttura non valida.");
    if(row.referenceDevice!==undefined&&(row.kind!=="enclosure"&&(row.kind!=="support"||row.place!==false||row.parentUuid===undefined)))
      throw new Error("Filtro apparecchio non valido.");
    return service.addStructural({...(row.referenceDevice===undefined?{}:{referenceDevice:referenceDevice(row.referenceDevice)}),configuration:parseConfigurationRequest(row.configuration),kind:row.kind,
      ...(row.parentUuid===undefined?{}:{parentUuid:lineUuid(row.parentUuid)}),
      ...(row.zoneNo===undefined?{}:{zoneNo:row.zoneNo as number}),
      ...(row.place===undefined?{}:{place:row.place}),
      ...(row.autoPlace===undefined?{}:{autoPlace:row.autoPlace}),
      ...(row.quantity===undefined?{}:{quantity:row.quantity as number})});
  });
  registry.handle(PROJECT_CHANNELS.placeStructuralItem,(event,value)=>{
    trusted(event);return service.placeStructuralItem(structuralPlacement(value));
  });
  registry.handle(PROJECT_CHANNELS.addCatalogueProduct, (event, id, quantity, undoable) => {
    trusted(event);
    const parsedQuantity = quantity === undefined ? 1 : quantity;
    if (!Number.isSafeInteger(parsedQuantity) || (parsedQuantity as number) < 1 ||
        (parsedQuantity as number) > 9_999) throw new Error("Quantità non valida.");
    const productId = positiveInteger(id, "Identificativo prodotto");
    return undoable === true ? service.addCatalogueProduct(productId, parsedQuantity as number, true) :
      service.addCatalogueProduct(productId, parsedQuantity as number);
  });
  registry.handle(PROJECT_CHANNELS.addConfiguredItem, (event, request, quantity, undoable, autoPlace) => {
    trusted(event);
    const parsedQuantity = quantity === undefined ? 1 : quantity;
    if (!Number.isSafeInteger(parsedQuantity) || (parsedQuantity as number) < 1 ||
        (parsedQuantity as number) > 9_999) throw new Error("Quantità non valida.");
    const configuration = parseConfigurationRequest(request);
    if (autoPlace !== undefined && typeof autoPlace !== "boolean") throw new Error("Modalità di posizionamento non valida.");
    if (autoPlace === true) return service.addConfiguredItem(configuration, parsedQuantity as number, true, true);
    return undoable === true ? service.addConfiguredItem(configuration, parsedQuantity as number, true) :
      service.addConfiguredItem(configuration, parsedQuantity as number);
  });
  registry.handle(PROJECT_CHANNELS.duplicateConfiguredItem, (event, uuid) => {
    trusted(event);
    return service.duplicateConfiguredItem(lineUuid(uuid));
  });
  registry.handle(PROJECT_CHANNELS.replaceConfiguredItem, (event, uuid, request) => {
    trusted(event);
    return service.replaceConfiguredItem(lineUuid(uuid), parseConfigurationRequest(request));
  });
  registry.handle(PROJECT_CHANNELS.reconfigureEnclosure, (event, uuid, request) => {
    trusted(event);
    const nodeUuid = lineUuid(uuid), configuration = parseConfigurationRequest(request);
    return lifecycle.run(async () => service.reconfigureEnclosure(nodeUuid,configuration));
  });
  registry.handle(PROJECT_CHANNELS.setQuantity, (event, uuid, quantity) => {
    trusted(event); return service.setQuantity(lineUuid(uuid), positiveInteger(quantity, "Quantità"));
  });
  registry.handle(PROJECT_CHANNELS.setLineDiscount,(event,uuid,bp)=>{
    trusted(event);return service.setLineDiscount(lineUuid(uuid),bp as number);
  });
  registry.handle(PROJECT_CHANNELS.setComponentDiscount,(event,uuid,seq,bp)=>{
    trusted(event);return service.setComponentDiscount(lineUuid(uuid),seq as number,bp as number);
  });
  registry.handle(PROJECT_CHANNELS.setGlobalDiscount,(event,bp)=>{
    trusted(event);return service.setGlobalDiscount(bp as number);
  });
  registry.handle(PROJECT_CHANNELS.setLabourTotal,(event,amount)=>{
    trusted(event);return service.setLabourTotal(amount as number);
  });
  registry.handle(PROJECT_CHANNELS.removeLine, (event, uuid) => {
    trusted(event); return service.removeLine(lineUuid(uuid));
  });
  registry.handle(PROJECT_CHANNELS.removeLines, (event, uuids) => {
    trusted(event);
    if (!Array.isArray(uuids) || uuids.length === 0 || uuids.length > 10_000)
      throw new Error("Righe del preventivo non valide.");
    const parsed = uuids.map(uuid => lineUuid(uuid));
    if (new Set(parsed).size !== parsed.length) throw new Error("Righe del preventivo non valide.");
    return service.removeLines(parsed);
  });
  registry.handle(PROJECT_CHANNELS.checkPlacement,(event,input,movingUuid)=>{
    trusted(event);return service.checkPlacement(placementInput(input),
      movingUuid===undefined?undefined:lineUuid(movingUuid));
  });
  registry.handle(PROJECT_CHANNELS.checkPackedChild,(event,input)=>{
    trusted(event);return service.checkPackedChild(packedChildInput(input));
  });
  registry.handle(PROJECT_CHANNELS.placementTargets,(event,request)=>{
    trusted(event);return service.placementTargets(placementTargetRequest(request));
  });
  registry.handle(PROJECT_CHANNELS.autoPlaceItem,(event,value)=>{
    trusted(event);
    if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Richiesta di posizionamento non valida.");
    const row=value as Record<string,unknown>;
    const keys=Object.keys(row);
    if(keys.length!==1)throw new Error("Richiesta di posizionamento non valida.");
    if(keys[0]==="itemUuid")return service.autoPlaceItem({itemUuid:lineUuid(row.itemUuid)});
    if(keys[0]==="nodeUuid")return service.autoPlaceItem({nodeUuid:lineUuid(row.nodeUuid)});
    throw new Error("Richiesta di posizionamento non valida.");
  });
  registry.handle(PROJECT_CHANNELS.canDuplicatePlacedItem,(event,uuid)=>{
    trusted(event);return service.canDuplicatePlacedItem(lineUuid(uuid));
  });
  registry.handle(PROJECT_CHANNELS.duplicatePlacedItem,(event,uuid)=>{
    trusted(event);return service.duplicatePlacedItem(lineUuid(uuid));
  });
  registry.handle(PROJECT_CHANNELS.placeRoot,(event,input)=>{
    trusted(event);return service.placeRoot(placementInput(input));
  });
  registry.handle(PROJECT_CHANNELS.placeChild,(event,input)=>{
    trusted(event);return service.placeChild(placementInput(input));
  });
  registry.handle(PROJECT_CHANNELS.moveNode,(event,uuid,input)=>{
    trusted(event);return service.moveNode(lineUuid(uuid),placementInput(input));
  });
  registry.handle(PROJECT_CHANNELS.unplaceNode,(event,uuid)=>{
    trusted(event);return service.unplaceNode(lineUuid(uuid));
  });
  registry.handle(PROJECT_CHANNELS.unplaceSubtree,(event,uuid)=>{
    trusted(event);return service.unplaceSubtree(lineUuid(uuid));
  });
  registry.handle(PROJECT_CHANNELS.insertPackedChild,(event,input,index)=>{
    trusted(event);return service.insertPackedChild(packedChildInput(input),
      index===undefined?undefined:packedIndex(index));
  });
  registry.handle(PROJECT_CHANNELS.reorderPackedNode,(event,uuid,index)=>{
    trusted(event);return service.reorderPackedNode(lineUuid(uuid),packedIndex(index));
  });
  registry.handle(PROJECT_CHANNELS.movePackedNode,(event,uuid,input)=>{
    trusted(event);return service.movePackedNode(lineUuid(uuid),packedMoveInput(input));
  });
  registry.handle(PROJECT_CHANNELS.removePackedNode,(event,uuid)=>{
    trusted(event);return service.removePackedNode(lineUuid(uuid));
  });
  registry.handle(PROJECT_CHANNELS.removePhysicalRoot,(event,uuid,contents)=>{
    trusted(event);
    if(contents!=="keep-contents"&&contents!=="remove-contents")throw new Error("Modalità di rimozione non valida.");
    return service.removePhysicalRoot(lineUuid(uuid),contents);
  });
  registry.handle(PROJECT_CHANNELS.addAnnotation,(event,input)=>{
    trusted(event);return service.addAnnotation(annotationInput(input));
  });
  registry.handle(PROJECT_CHANNELS.updateAnnotation,(event,uuid,patch)=>{
    trusted(event);return service.updateAnnotation(lineUuid(uuid),annotationPatch(patch));
  });
  registry.handle(PROJECT_CHANNELS.removeAnnotation,(event,uuid)=>{
    trusted(event);return service.removeAnnotation(lineUuid(uuid));
  });
  registry.handle(PROJECT_CHANNELS.undo,(event,token)=>{
    trusted(event);
    if(token!==undefined&&typeof token!=="string")throw new Error("Operazione da annullare non valida.");
    return service.undo(token);
  });
  registry.handle(PROJECT_CHANNELS.redo,(event)=>{trusted(event);return service.redo();});
  registry.handle(PROJECT_CHANNELS.fillCapacity,(event,request)=>{
    trusted(event);return service.fillCapacity(fillRequest(request));
  });
  return () => {
    destinations.clear();
    for (const channel of Object.values(PROJECT_CHANNELS)) registry.removeHandler(channel);
  };
}

function validateCreateRequest(payload: unknown): CreateProjectRequest {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Dati progetto non validi.");
  const source = payload as Record<string, unknown>;
  const allowed = ["title", "destinationToken", "description", "notes", "projectType", "executor", "date", "companyName", "companyDescription"];
  if (Object.keys(source).some((key) => !allowed.includes(key))) throw new Error("Il progetto contiene campi inattesi.");
  if (typeof source.destinationToken !== "string" || !/^[0-9a-f-]{36}$/i.test(source.destinationToken)) {
    throw new Error("Destinazione progetto non valida.");
  }
  return source as unknown as CreateProjectRequest;
}
