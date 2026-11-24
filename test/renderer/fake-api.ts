import type { AppApi } from "../../src/shared/app.js";
import type { CatalogueApi, LqApi } from "../../src/shared/catalogue.js";
import type { ConfigurationApi } from "../../src/shared/configuration.js";
import type { ProjectApi, ProjectDocumentView } from "../../src/shared/project.js";

const unused = () => Promise.reject(new Error("not used"));

export function fakeCatalogueApi(): CatalogueApi {
  return {
    manufacturerNodes: async () => [], manufacturerModels: async () => [],
    manufacturerArticles: async () => [], manufacturerPositions: async () => [],
    browse: unused, unclassified: unused, search: unused, overview: unused, categories: unused, attributeFilters: unused,
  };
}

export function fakeProjectApi(): ProjectApi {
  return {
    engineeringStatus: unused, planEngineeringRefresh: unused, applyEngineeringRefresh: unused,
    previewFrontPdf: unused, previewPdf: unused, savePdf: unused, saveDocumentPdf: unused, saveFrontPdf: unused,
    frontAssets: async () => ({}),
    enclosureReferenceDevices: unused, compatibleEnclosures: unused,
    referenceDevices: unused, compatiblePanels: unused, checkPanelReference: unused,
    designDiscover: unused, addStructural: unused, designNavigation: unused, placeStructuralItem: unused,
    chooseDestination: () => Promise.resolve(null), create: unused, open: () => Promise.resolve(null),
    save: unused, saveAs: unused, close: () => Promise.resolve(null), current: () => Promise.resolve(null),
    addCatalogueProduct: unused, addConfiguredItem: unused, duplicateConfiguredItem: unused, replaceConfiguredItem: unused, reconfigureEnclosure: unused,
    setQuantity: unused, setLineDiscount: unused, setComponentDiscount: unused,
    setGlobalDiscount: unused, setLabourTotal: unused, removeLine: unused, removeLines: unused,
    checkPlacement: unused, checkPackedChild: unused, placementTargets: unused, autoPlaceItem: unused,
    canDuplicatePlacedItem: async () => false, duplicatePlacedItem: unused,
    placeRoot: unused, placeChild: unused, moveNode: unused, unplaceNode: unused, unplaceSubtree: unused,
    insertPackedChild: unused, reorderPackedNode: unused, movePackedNode: unused, removePackedNode: unused,
    removePhysicalRoot: unused, addAnnotation: unused, updateAnnotation: unused, removeAnnotation: unused,
    undo: unused, redo: unused, fillCapacity: unused,
  };
}

export function fakeConfigurationApi(): ConfigurationApi {
  return {
    ranges: async () => [], nodeModels: async () => [], productModels: async () => [], modelByCode: async () => null,
    model: async () => { throw new Error("not used"); }, resolve: async () => { throw new Error("not used"); },
  };
}

export function fakeAppApi(): AppApi {
  return {
    recentProjects: async () => [], openRecent: async () => null, forgetRecent: async () => [],
    onCommand: () => () => undefined, onStateChanged: () => () => undefined, nativeEdit: async () => undefined,
  };
}

export function fakeLqApi(): LqApi {
  return { catalogue: fakeCatalogueApi(), configuration: fakeConfigurationApi(), project: fakeProjectApi(), app: fakeAppApi(),
    brands:{list:async()=>[],setActive:unused,previewRemoval:unused,remove:unused},
    metel:{preview:unused,apply:unused,discard:async()=>undefined,onProgress:()=>()=>undefined} };
}

export const openProject: ProjectDocumentView = {
  documentName: "QG1 Rossi.lqp", revision: 4, dirty: true, lines: [], configuredItems: [], distinta: [], physicalNodes: [], annotations: [],
  metadata: {
    uuid: "10000000-0000-4000-8000-000000000001", title: "Quadro generale QG1", description: "", notes: "",
    projectType: "civil", normCode: "CEI EN 60898", executor: "M. Rossi", date: "2026-09-24",
    companyName: "Rossi Srl", companyDescription: "",
  },
};
