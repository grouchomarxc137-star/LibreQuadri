import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MainDatabaseService } from "../../src/main/database/database-service.js";
import { ProjectDocumentService } from "../../src/main/project/project-document-service.js";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StructuralNavigation } from "../../src/shared/project.js";
import { filterDeviceNavigation, physicalOnlyDevices } from "../../src/renderer/project/device-discovery.js";
import { StructuralNavigator } from "../../src/renderer/project/StructuralWorkflow.js";
import { DeviceDiscovery } from "../../src/renderer/project/DeviceDiscovery.js";
const navigation: StructuralNavigation = {
  status: "ready", staleImportIds: [], contextDataUnavailable: 0,
  candidates: [
    { id: 1, code: "space", name: "Din generico - Solo spazio", kind: "device", brandMarchio: "GEN",
      commercialContribution: "none", active: true, obsolete: false },
    { id: 2, code: "breaker", name: "Interruttore", kind: "device", brandMarchio: "ALT",
      commercialContribution: "articles", active: true, obsolete: false },
    { id: 3, code: "not-in-tree", name: "Solo spazio assente", kind: "device", brandMarchio: "GEN",
      commercialContribution: "none", active: true, obsolete: false },
  ],
  nodes: [
    { id: 10, parentId: null, name: "Apparecchi", kind: "section", sortOrder: 0, modelIds: [] },
    { id: 11, parentId: 10, name: "Accessori", kind: "group", sortOrder: 0, modelIds: [] },
    { id: 12, parentId: 11, name: "Accessori", kind: "group", sortOrder: 0, modelIds: [1] },
    { id: 13, parentId: 10, name: "Protezione", kind: "group", sortOrder: 1, modelIds: [2] },
  ],
};
describe("device discovery within approved engineering navigation", () => {
  const catalogueFile = process.env["LIBREQUADRI_REV83_REAL_DB"];
  it.runIf(!!catalogueFile && existsSync(catalogueFile))("renders the actual backend summary as a direct DIN shortcut on a compatible panel", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), "librequadri-device-discovery-"));
    const source = new Database(catalogueFile!, { readonly: true });
    mkdirSync(path.join(folder, "installation/data"), { recursive: true });
    source.prepare("VACUUM INTO ?").run(path.join(folder, "installation/data/lq.db"));
    const main = MainDatabaseService.initialize(path.join(folder, "installation"));
    const service = new ProjectDocumentService({ workingDirectory: path.join(folder, "working"),
      incomingDirectory: path.join(folder, "incoming"), backupDirectory: path.join(folder, "backup"),
      migrationsFolder: path.resolve("db/migrations/project"), appVersion: "test",
      resolveConfiguration: request => main.resolveConfiguration(request),
      resolveCatalogueProduct: id => main.catalogueProductSnapshot(id),
      designNavigation: (project, request) => main.designNavigation(project, request) });
    try {
      await service.create({ destinationPath: path.join(folder, "project.lqp"), title: "Discovery", description: "", notes: "",
        projectType: "civil", executor: "", date: "2026-10-08", companyName: "", companyDescription: "" });
      const add = (code: string) => service.addConfiguredItem({ modelId: main.modelByCode("BTI", code)!.id, selectedOptionIds: [] })
        .configuredItems.find(item => item.modelCode === code)!.uuid;
      const root = service.placeRoot({ itemUuid: add("tq.pack.343"), rootXMm: 0, rootYMm: 0, viewCode: "front" }).physicalNodes[0]!.uuid;
      const panel = service.placeChild({ itemUuid: add("tq.pack.4083"), parentUuid: root, zoneNo: 0, startUnits: 0,
        viewCode: "front" }).physicalNodes[0]!.children[0]!.uuid;
      const actualNavigation = service.designNavigation("device", panel);
      const html = renderToStaticMarkup(<DeviceDiscovery navigation={actualNavigation} expanded={new Set()}
        onToggle={() => undefined} modelId={null} onSelect={() => undefined} />);
      expect(html).toContain('aria-label="Solo ingombro"');
      expect(html).toContain('aria-pressed="false">Din generico - Solo spazio</button>');
    } finally { service.close(); main.close(); source.close(); rmSync(folder, { recursive: true, force: true }); }
  }, 30_000);
  it.each([{ candidates: [] }, { candidates: [navigation.candidates[1]!] }])("explains the absent physical-only models without offering incompatible DIN for $candidates", ({ candidates }) => {
    const unavailable = { ...navigation, candidates, nodes: candidates.length ? [{ ...navigation.nodes[0]!, modelIds: [2] }] : [] };
    const html = renderToStaticMarkup(<StructuralNavigator kind="device"
      state={{ phase: "loaded", kind: "device", parentUuid: "blind-panel", navigation: unavailable }}
      expanded={new Set()} onToggle={() => undefined} modelId={null} onSelect={() => undefined} />);
    expect(html).toContain("Nessun apparecchio di solo ingombro è disponibile per il pannello corrente");
    expect(html).toContain("seleziona un pannello con guida DIN");
    expect(html).not.toContain('aria-label="Solo ingombro"');
    expect(html).not.toContain("Din generico - Solo spazio</button>");
  });
  it("exposes existing physical-only devices directly even when their source branch is collapsed", () => {
    expect(physicalOnlyDevices(navigation).map(model => model.id)).toEqual([1]);
    const html = renderToStaticMarkup(<DeviceDiscovery navigation={navigation} expanded={new Set([10])}
      onToggle={() => undefined} modelId={1} onSelect={vi.fn()} />);
    expect(html).toContain("Cerca apparecchi");
    expect(html).toContain('aria-label="Solo ingombro"');
    expect(html).toContain('aria-pressed="true">Din generico - Solo spazio</button>');
    expect(html).not.toContain("Solo spazio assente");
  });
  it("finds name, manufacturer and code without dropping ancestors or admitting unavailable models", () => {
    const before = structuredClone(navigation);
    for (const query of [" GENERICO ", "space", "GEN"]) {
      const result = filterDeviceNavigation(navigation, query);
      expect(result.nodes.map(node => node.id)).toEqual([10, 11, 12]);
      expect(result.nodes.flatMap(node => node.modelIds)).toEqual([1]);
      expect(physicalOnlyDevices(result).map(model => model.id)).toEqual([1]);
    }
    expect(filterDeviceNavigation(navigation, "breaker").nodes.map(node => node.id)).toEqual([10, 13]);
    expect(filterDeviceNavigation(navigation, "unavailable").nodes).toEqual([]);
    expect(filterDeviceNavigation(navigation, "  ")).toBe(navigation);
    expect(navigation).toEqual(before);
  });
});
