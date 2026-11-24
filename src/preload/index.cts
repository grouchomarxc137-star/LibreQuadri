import { contextBridge, ipcRenderer } from "electron";
import type {
  CATALOGUE_CHANNELS,
  LqApi,
} from "../shared/catalogue.js" with { "resolution-mode": "import" };
import type { PROJECT_CHANNELS } from "../shared/project.js" with { "resolution-mode": "import" };
import type { CONFIGURATION_CHANNELS } from "../shared/configuration.js" with { "resolution-mode": "import" };
import type { APP_CHANNELS, AppCommand, AppStateChange } from "../shared/app.js" with { "resolution-mode": "import" };
import type { METEL_IMPORT_CHANNELS } from "../shared/metel-import.js" with { "resolution-mode": "import" };
import type { BRAND_CHANNELS } from "../shared/brands.js" with { "resolution-mode": "import" };
const brandChannels:typeof BRAND_CHANNELS={list:"brands:list",setActive:"brands:set-active",previewRemoval:"brands:preview-removal",remove:"brands:remove"};
const metelChannels: typeof METEL_IMPORT_CHANNELS = {preview:"metel:preview",apply:"metel:apply",discard:"metel:discard",progress:"metel:progress"};

// A sandboxed preload can only require Electron modules, so it cannot import
// the runtime CATALOGUE_CHANNELS constant. The channel names are repeated here
// and typed against the shared constant: any drift is a compile error.
const searchChannel: typeof CATALOGUE_CHANNELS.search = "catalogue:search";
const overviewChannel: typeof CATALOGUE_CHANNELS.overview =
  "catalogue:overview";
const unclassifiedChannel: typeof CATALOGUE_CHANNELS.unclassified = "catalogue:unclassified";
const categoriesChannel: typeof CATALOGUE_CHANNELS.categories = "catalogue:categories";
const attributeFiltersChannel: typeof CATALOGUE_CHANNELS.attributeFilters = "catalogue:attribute-filters";
const manufacturerNodesChannel:typeof CATALOGUE_CHANNELS.manufacturerNodes="catalogue:manufacturer-nodes";
const manufacturerModelsChannel:typeof CATALOGUE_CHANNELS.manufacturerModels="catalogue:manufacturer-models";
const manufacturerArticlesChannel:typeof CATALOGUE_CHANNELS.manufacturerArticles="catalogue:manufacturer-articles";
const manufacturerPositionsChannel:typeof CATALOGUE_CHANNELS.manufacturerPositions="catalogue:manufacturer-positions";
const browseChannel:typeof CATALOGUE_CHANNELS.browse="catalogue:browse";
const configurationChannels: typeof CONFIGURATION_CHANNELS = {
  ranges:"configuration:ranges",nodeModels:"configuration:node-models",
  productModels:"configuration:product-models",model:"configuration:model",
  modelByCode:"configuration:model-by-code",
  resolve:"configuration:resolve",
  offerSelection:"configuration:offer-selection",
};
const projectChannels: typeof PROJECT_CHANNELS = {
  chooseDestination: "project:choose-destination",
  create: "project:create",
  open: "project:open",
  save: "project:save",
  saveAs: "project:save-as",
  close: "project:close",
  current: "project:current",
  engineeringStatus: "project:engineering-status",
  planEngineeringRefresh: "project:engineering-plan",
  applyEngineeringRefresh: "project:engineering-apply",
  addCatalogueProduct: "project:add-catalogue-product",
  addConfiguredItem: "project:add-configured-item",
  duplicateConfiguredItem: "project:duplicate-configured-item",
  replaceConfiguredItem: "project:replace-configured-item",
  reconfigureEnclosure: "project:reconfigure-enclosure",
  setQuantity: "project:set-quantity",
  setLineDiscount: "project:set-line-discount",
  setComponentDiscount: "project:set-component-discount",
  setGlobalDiscount: "project:set-global-discount",
  setLabourTotal: "project:set-labour-total",
  removeLine: "project:remove-line",
  removeLines: "project:remove-lines",
  checkPlacement: "project:check-placement",
  checkPackedChild: "project:check-packed-child",
  placementTargets: "project:placement-targets",
  autoPlaceItem: "project:auto-place-item",
  canDuplicatePlacedItem: "project:can-duplicate-placed-item",
  duplicatePlacedItem: "project:duplicate-placed-item",
  placeRoot: "project:place-root",
  placeChild: "project:place-child",
  moveNode: "project:move-node",
  unplaceNode: "project:unplace-node",
  unplaceSubtree: "project:unplace-subtree",
  addAnnotation: "project:add-annotation",
  updateAnnotation: "project:update-annotation",
  removeAnnotation: "project:remove-annotation",
  previewFrontPdf: "project:preview-front-pdf",
  previewPdf: "project:preview-pdf",
  savePdf: "project:save-pdf",
  saveDocumentPdf: "project:save-document-pdf",
  saveFrontPdf: "project:save-front-pdf",
  insertPackedChild: "project:insert-packed-child",
  reorderPackedNode: "project:reorder-packed-node",
  movePackedNode: "project:move-packed-node",
  removePackedNode: "project:remove-packed-node",
  removePhysicalRoot: "project:remove-physical-root",
  frontAssets: "project:front-assets",
  designDiscover: "project:design-discover",
  addStructural: "project:add-structural",
  designNavigation: "project:design-navigation",
  referenceDevices: "project:reference-devices",
  compatiblePanels: "project:compatible-panels",
  compatibleEnclosures: "project:compatible-enclosures",
  enclosureReferenceDevices: "project:enclosure-reference-devices",
  checkPanelReference: "project:check-panel-reference",
  placeStructuralItem: "project:place-structural-item",
  undo: "project:undo",
  redo: "project:redo",
  fillCapacity: "project:fill-capacity",
};

const appChannels: typeof APP_CHANNELS = {
  recentProjects: "app:recent-projects",
  openRecent: "app:open-recent",
  forgetRecent: "app:forget-recent",
  command: "app:command",
  stateChanged: "app:state-changed",
  nativeEdit: "app:native-edit",
};

/** Main → renderer events. Only the payload is forwarded, never the Electron event object. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); };
}

const api: LqApi = {
  brands: {
    list:()=>ipcRenderer.invoke(brandChannels.list),
    setActive:(id,active)=>ipcRenderer.invoke(brandChannels.setActive,id,active),
    previewRemoval:id=>ipcRenderer.invoke(brandChannels.previewRemoval,id),
    remove:token=>ipcRenderer.invoke(brandChannels.remove,token),
  },
  metel: {
    preview: inputs => ipcRenderer.invoke(metelChannels.preview,inputs),
    apply: (token,acceptOlder) => ipcRenderer.invoke(metelChannels.apply,token,acceptOlder),
    discard: () => ipcRenderer.invoke(metelChannels.discard),
    onProgress: listener => subscribe<string>(metelChannels.progress,listener),
  },
  catalogue: {
    browse: (request) => ipcRenderer.invoke(browseChannel, request),
    search: (request) => ipcRenderer.invoke(searchChannel, request),
    overview: () => ipcRenderer.invoke(overviewChannel),
    unclassified: (request) => ipcRenderer.invoke(unclassifiedChannel, request),
    categories: () => ipcRenderer.invoke(categoriesChannel),
    attributeFilters: (request) => ipcRenderer.invoke(attributeFiltersChannel, request),
    manufacturerNodes:(brandMarchio)=>ipcRenderer.invoke(manufacturerNodesChannel,brandMarchio),
    manufacturerModels:(nodeId)=>ipcRenderer.invoke(manufacturerModelsChannel,nodeId),
    manufacturerArticles:(request)=>ipcRenderer.invoke(manufacturerArticlesChannel,request),
    manufacturerPositions:(productId)=>ipcRenderer.invoke(manufacturerPositionsChannel,productId),
  },
  configuration: {
    ranges:(brandMarchio)=>ipcRenderer.invoke(configurationChannels.ranges,brandMarchio),
    nodeModels:(nodeId)=>ipcRenderer.invoke(configurationChannels.nodeModels,nodeId),
    productModels:(productId)=>ipcRenderer.invoke(configurationChannels.productModels,productId),
    modelByCode:(brand,code)=>ipcRenderer.invoke(configurationChannels.modelByCode,brand,code),
    model:(modelId)=>ipcRenderer.invoke(configurationChannels.model,modelId),
    resolve:(request)=>ipcRenderer.invoke(configurationChannels.resolve,request),
    offerSelection:(modelId,offerNo)=>ipcRenderer.invoke(configurationChannels.offerSelection,modelId,offerNo),
  },
  project: {
    engineeringStatus: () => ipcRenderer.invoke(projectChannels.engineeringStatus),
    planEngineeringRefresh: () => ipcRenderer.invoke(projectChannels.planEngineeringRefresh),
    applyEngineeringRefresh: (token) => ipcRenderer.invoke(projectChannels.applyEngineeringRefresh,token),
    previewFrontPdf: (options) => ipcRenderer.invoke(projectChannels.previewFrontPdf, options),
    previewPdf: (kind, options) => ipcRenderer.invoke(projectChannels.previewPdf, kind, options),
    savePdf: (token) => ipcRenderer.invoke(projectChannels.savePdf, token),
    saveDocumentPdf: (kind, options) => ipcRenderer.invoke(projectChannels.saveDocumentPdf, kind, options),
    saveFrontPdf: (options) => ipcRenderer.invoke(projectChannels.saveFrontPdf, options),
    designDiscover: (kind,parentUuid) => ipcRenderer.invoke(projectChannels.designDiscover,kind,parentUuid),
    addStructural: (request) => ipcRenderer.invoke(projectChannels.addStructural,request),
    designNavigation: (kind,parentUuid) => ipcRenderer.invoke(projectChannels.designNavigation,kind,parentUuid),
    referenceDevices: parentUuid => ipcRenderer.invoke(projectChannels.referenceDevices,parentUuid),
    enclosureReferenceDevices: () => ipcRenderer.invoke(projectChannels.enclosureReferenceDevices),
    compatibleEnclosures: request => ipcRenderer.invoke(projectChannels.compatibleEnclosures,request),
    compatiblePanels: request => ipcRenderer.invoke(projectChannels.compatiblePanels,request),
    checkPanelReference: request => ipcRenderer.invoke(projectChannels.checkPanelReference,request),
    placeStructuralItem: (request) => ipcRenderer.invoke(projectChannels.placeStructuralItem,request),
    frontAssets: () => ipcRenderer.invoke(projectChannels.frontAssets),
    chooseDestination: (title) => ipcRenderer.invoke(projectChannels.chooseDestination, title),
    create: (request) => ipcRenderer.invoke(projectChannels.create, request),
    open: () => ipcRenderer.invoke(projectChannels.open),
    save: () => ipcRenderer.invoke(projectChannels.save),
    saveAs: () => ipcRenderer.invoke(projectChannels.saveAs),
    close: () => ipcRenderer.invoke(projectChannels.close),
    current: () => ipcRenderer.invoke(projectChannels.current),
    addCatalogueProduct: (...args) => ipcRenderer.invoke(projectChannels.addCatalogueProduct, ...args),
    addConfiguredItem: (...args) => ipcRenderer.invoke(projectChannels.addConfiguredItem, ...args),
    duplicateConfiguredItem: (uuid) => ipcRenderer.invoke(projectChannels.duplicateConfiguredItem, uuid),
    replaceConfiguredItem: (uuid, request) => ipcRenderer.invoke(projectChannels.replaceConfiguredItem, uuid, request),
    reconfigureEnclosure: (uuid, request) => ipcRenderer.invoke(projectChannels.reconfigureEnclosure, uuid, request),
    setQuantity: (uuid, quantity) => ipcRenderer.invoke(projectChannels.setQuantity, uuid, quantity),
    setLineDiscount: (uuid, discountBp) => ipcRenderer.invoke(projectChannels.setLineDiscount, uuid, discountBp),
    setComponentDiscount: (itemUuid, seq, discountBp) => ipcRenderer.invoke(projectChannels.setComponentDiscount, itemUuid, seq, discountBp),
    setGlobalDiscount: (discountBp) => ipcRenderer.invoke(projectChannels.setGlobalDiscount, discountBp),
    setLabourTotal: (amountE4) => ipcRenderer.invoke(projectChannels.setLabourTotal, amountE4),
    removeLine: (uuid) => ipcRenderer.invoke(projectChannels.removeLine, uuid),
    removeLines: (uuids) => ipcRenderer.invoke(projectChannels.removeLines, uuids),
    checkPlacement: (input, movingUuid) => ipcRenderer.invoke(projectChannels.checkPlacement,input,movingUuid),
    checkPackedChild: (input) => ipcRenderer.invoke(projectChannels.checkPackedChild,input),
    placementTargets: (request) => ipcRenderer.invoke(projectChannels.placementTargets,request),
    autoPlaceItem: (subject) => ipcRenderer.invoke(projectChannels.autoPlaceItem,subject),
    canDuplicatePlacedItem: (uuid) => ipcRenderer.invoke(projectChannels.canDuplicatePlacedItem,uuid),
    duplicatePlacedItem: (uuid) => ipcRenderer.invoke(projectChannels.duplicatePlacedItem,uuid),
    placeRoot: (input) => ipcRenderer.invoke(projectChannels.placeRoot,input),
    placeChild: (input) => ipcRenderer.invoke(projectChannels.placeChild,input),
    moveNode: (uuid,input) => ipcRenderer.invoke(projectChannels.moveNode,uuid,input),
    unplaceNode: (uuid) => ipcRenderer.invoke(projectChannels.unplaceNode,uuid),
    unplaceSubtree: (uuid) => ipcRenderer.invoke(projectChannels.unplaceSubtree,uuid),
    insertPackedChild: (input,index) => ipcRenderer.invoke(projectChannels.insertPackedChild,input,index),
    reorderPackedNode: (uuid,index) => ipcRenderer.invoke(projectChannels.reorderPackedNode,uuid,index),
    movePackedNode: (uuid,input) => ipcRenderer.invoke(projectChannels.movePackedNode,uuid,input),
    removePackedNode: (uuid) => ipcRenderer.invoke(projectChannels.removePackedNode,uuid),
    removePhysicalRoot: (uuid,contents) => ipcRenderer.invoke(projectChannels.removePhysicalRoot,uuid,contents),
    addAnnotation: (input) => ipcRenderer.invoke(projectChannels.addAnnotation,input),
    updateAnnotation: (uuid,patch) => ipcRenderer.invoke(projectChannels.updateAnnotation,uuid,patch),
    removeAnnotation: (uuid) => ipcRenderer.invoke(projectChannels.removeAnnotation,uuid),
    undo: (...args) => ipcRenderer.invoke(projectChannels.undo, ...args),
    redo: () => ipcRenderer.invoke(projectChannels.redo),
    fillCapacity: (request) => ipcRenderer.invoke(projectChannels.fillCapacity,request),
  },
  app: {
    recentProjects: () => ipcRenderer.invoke(appChannels.recentProjects),
    openRecent: (id) => ipcRenderer.invoke(appChannels.openRecent, id),
    forgetRecent: (id) => ipcRenderer.invoke(appChannels.forgetRecent, id),
    onCommand: (listener) => subscribe<AppCommand>(appChannels.command, listener),
    onStateChanged: (listener) => subscribe<AppStateChange>(appChannels.stateChanged, listener),
    nativeEdit: (command) => ipcRenderer.invoke(appChannels.nativeEdit, command),
  },
};

contextBridge.exposeInMainWorld("lq", api);
