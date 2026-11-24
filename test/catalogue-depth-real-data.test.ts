import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import MDBReader from "mdb-reader";
import { describe, expect, it } from "vitest";
import { browseManufacturerNodes, SELECTABLE_PACKAGE_SQL } from "../src/main/catalogue/manufacturer-navigation.js";
import { browseCatalogue } from "../src/main/catalogue/browse-queries.js";
import { getConfigurationModel } from "../src/main/catalogue/configuration-queries.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";
import { getCatalogueProductSnapshot } from "../src/main/catalogue/catalogue-queries.js";
import { capacityFillerConfigurations } from "../src/main/catalogue/capacity-fillers.js";
import { discoverDesignRangeNodes, guardConfiguredStructuralItem, guardDesignCandidate } from "../src/main/project/design-compatibility.js";
import { MainDatabaseService } from "../src/main/database/database-service.js";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { showcaseNavigation, STATISTICAL_FAMILIES_GROUP } from "../src/renderer/showcase/catalogue-navigation.js";
import { filterDeviceNavigation, physicalOnlyDevices } from "../src/renderer/project/device-discovery.js";
import { combinedFrontGeometry, sectorDimensions } from "../src/drawing/front-geometry.js";
import { buildFrontDocument } from "../src/main/documents/front-document.js";
import type { ConfigurationRequest } from "../src/shared/configuration.js";

const filename = process.env["LIBREQUADRI_REV83_REAL_DB"];
const source = process.env["LIBREQUADRI_TIQUADRI_MDB"] ?? "";
describe.runIf(!!filename && existsSync(filename))("catalogue navigation, physical-only DIN and depth on populated catalogue", () => {
  it("retains every statistical family across manufacturers and unchanged browse/filter results", () => {
    const db = new Database(filename!, { readonly: true });
    try {
      const nodes = browseManufacturerNodes(db), presentation = showcaseNavigation(nodes);
      expect(presentation.filter(node => node.parentId === null).map(node => node.name))
        .toEqual(["Apparecchi BTicino", "Apparecchi Siemens", "Famiglie statistiche"]);
      const statistical = nodes.filter(node => node.parentId === null && node.source === "metel" && node.code.startsWith("metel."));
      expect(statistical.map(node => node.brandMarchio)).toEqual(expect.arrayContaining(["BTI", "SIE", "SNR", "LEG"]));
      expect(presentation.filter(node => node.parentId === STATISTICAL_FAMILIES_GROUP).map(node => node.id))
        .toEqual(statistical.map(node => node.id));
      for (const original of nodes) {
        const presented = presentation.find(node => node.id === original.id)!;
        expect([presented.articleCount, presented.packageCount]).toEqual([original.articleCount, original.packageCount]);
        if (original.parentId !== null) expect(presented).toEqual(original);
      }
      for (const root of [nodes.find(node => node.code === "tq.system.3")!, statistical.find(node => node.brandMarchio === "SIE")!]) {
        const request = { nodeId: root.id, query: "16", listedOnly: true, limit: 5 };
        const result = browseCatalogue(db, request);
        expect(browseCatalogue(db, { ...request, nodeId: presentation.find(node => node.id === root.id)!.id })).toEqual(result);
      }
      expect(browseManufacturerNodes(db)).toEqual(nodes);
    } finally { db.close(); }
  }, 30_000); // Siemens now computes technical facets across its full imported tree.

  it("inserts DIN generico, keeps capacity/history/persistence and fills only its remaining space", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), "librequadri-catalogue-depth-"));
    const db = new Database(filename!, { readonly: true });
    mkdirSync(path.join(folder, "installation/data"), { recursive: true });
    db.prepare("VACUUM INTO ?").run(path.join(folder, "installation/data/lq.db"));
    const main = MainDatabaseService.initialize(path.join(folder, "installation"), { migrationsFolder: path.resolve("db/migrations/lq") });
    const id = (code: string) => db.prepare("SELECT id FROM cat_config_model WHERE code=?").pluck().get(code) as number;
    const options = { workingDirectory: path.join(folder, "working"), incomingDirectory: path.join(folder, "incoming"),
      backupDirectory: path.join(folder, "backups"), migrationsFolder: path.resolve("db/migrations/project"), appVersion: "test",
      engineeringCatalogue: () => db,
      resolveConfiguration: (request: ConfigurationRequest) => resolveConfiguration(db, request),
      resolveCatalogueProduct: (productId: number) => getCatalogueProductSnapshot(db, productId),
      designNavigation: (project: Database.Database, request: Parameters<typeof discoverDesignRangeNodes>[2]) => {
        return main.designNavigation(project, request);
      },
      designGuard: (project: Database.Database, request: Parameters<typeof guardDesignCandidate>[2], configuration: ConfigurationRequest) =>
        guardDesignCandidate(db, project, request, { mode: "add", configuration }),
      designItemGuard: (project: Database.Database, request: Parameters<typeof guardConfiguredStructuralItem>[2]) =>
        guardConfiguredStructuralItem(db, project, request),
      capacityFillers: (kind: string) => capacityFillerConfigurations(db, kind),
    };
    const service = new ProjectDocumentService(options);
    try {
      const file = path.join(folder, "din.lqp");
      await service.create({ destinationPath: file, title: "DIN", description: "", notes: "", projectType: "civil", executor: "",
        date: "2026-10-08", companyName: "", companyDescription: "" });
      const add = (code: string) => service.addConfiguredItem({ modelId: id(code), selectedOptionIds: [] })
        .configuredItems.find(item => item.modelCode === code)!.uuid;
      const root = service.placeRoot({ itemUuid: add("tq.pack.343"), rootXMm: 0, rootYMm: 0, viewCode: "front" }).physicalNodes[0]!.uuid;
      const panel = service.placeChild({ itemUuid: add("tq.pack.4083"), parentUuid: root, zoneNo: 0, startUnits: 0,
        viewCode: "front" }).physicalNodes[0]!.children[0]!.uuid;
      const blindItem = add("tq.pack.820");
      const blind = service.placeChild({ itemUuid: blindItem, parentUuid: root, zoneNo: 0, startUnits: 350,
        viewCode: "front" }).physicalNodes[0]!.children.find(node => node.itemUuid === blindItem)!.uuid;
      const unavailable = service.designNavigation("device", blind);
      expect(unavailable.status).toBe("ready");
      expect(physicalOnlyDevices(unavailable)).toEqual([]);
      expect(unavailable.candidates.some(model => model.code === "tq.pack.1778")).toBe(false);
      const navigation = service.designNavigation("device", panel);
      expect(navigation.candidates.every(model => ["articles", "none"].includes(model.commercialContribution))).toBe(true);
      expect(navigation.status).toBe("ready");
      expect(physicalOnlyDevices(navigation).map(model => model.code)).toContain("tq.pack.1778");
      expect(filterDeviceNavigation(navigation, "generico").nodes.flatMap(node => node.modelIds)).toContain(id("tq.pack.1778"));
      const model = getConfigurationModel(db, id("tq.pack.1778"));
      const width = model.axes.flatMap(axis => axis.options).find(option => option.label === "2 moduli")!;
      const configuration = { modelId: model.id, selectedOptionIds: [width.id] };
      expect(() => service.addStructural({ configuration, kind: "device", parentUuid: blind, place: false })).toThrow();
      const before = service.current()!;
      const added = service.addStructural({ configuration, kind: "device", parentUuid: panel, place: false });
      const item = added.configuredItems.find(row => row.modelCode === model.code)!;
      expect(item).toMatchObject({ commercialContribution: "none", bom: [] });
      expect(item.demands.find(demand => demand.capacityKindCode === "din_rail")?.amount).toBe(4);
      expect(item.views.find(view => view.viewCode === "front")?.widthMm).toBe(36);
      expect(added.lines.find(line => line.itemUuid === item.uuid)).toMatchObject({ unitListPriceE4: null, lineTotalE4: null });
      expect(added.distinta).toEqual(before.distinta);
      expect(service.undo().configuredItems.some(row => row.uuid === item.uuid)).toBe(false);
      expect(service.redo().configuredItems.find(row => row.uuid === item.uuid)).toEqual(item);
      const target = service.placementTargets({ itemUuid: item.uuid, parentUuid: panel }).targets[0]!;
      expect(target.action).toBe("placeChild");
      if (target.action !== "placeChild") throw new Error("Expected a device placement target");
      const placed = service.placeChild(target.input);
      const dinNode = placed.physicalNodes[0]!.children[0]!.children[0]!;
      expect(dinNode).toMatchObject({ itemUuid: item.uuid, startUnits: 0, nodeKind: "device" });
      const denied = service.checkPlacement({ itemUuid: item.uuid, parentUuid: panel, zoneNo: 0, startUnits: 47, viewCode: "front" });
      expect(denied.ok).toBe(false);
      expect(service.undo().physicalNodes[0]!.children[0]!.children).toHaveLength(0);
      expect(service.redo().physicalNodes).toEqual(placed.physicalNodes);
      const filled = service.fillCapacity({ capacityKind: "din_rail" });
      expect(filled.fillReport!.inserted).toBeGreaterThan(0);
      const panelNodes = filled.physicalNodes[0]!.children[0]!.children;
      expect(panelNodes.find(node => node.uuid === dinNode.uuid)).toEqual(dinNode);
      const fillerNodes = panelNodes.filter(node => node.uuid !== dinNode.uuid);
      const fillers = fillerNodes.map(node => filled.configuredItems.find(row => row.uuid === node.itemUuid)!);
      expect(fillers.every(row => row.modelCode === "tq.pack.1777")).toBe(true);
      expect(fillers.reduce((sum, row) => sum + row.demands.find(demand => demand.capacityKindCode === "din_rail")!.amount, 4)).toBe(48);
      expect(fillerNodes.every(node => node.startUnits! >= 4)).toBe(true);
      expect(filled.distinta.find(row => row.manufacturerCode === "E80FP")?.quantity).toBe(fillerNodes.length);
      expect(service.fillCapacity({ capacityKind: "din_rail" }).fillReport?.inserted).toBe(0);
      expect(service.undo().physicalNodes).toEqual(placed.physicalNodes);
      expect(service.redo().physicalNodes).toEqual(filled.physicalNodes);
      expect(db.prepare(`SELECT COUNT(*) FROM cat_config_model m WHERE m.id=? AND ${SELECTABLE_PACKAGE_SQL}`).pluck().get(model.id)).toBe(0);
      await service.save(); service.close();
      const offline = new ProjectDocumentService({ ...options, engineeringCatalogue: () => null,
        resolveConfiguration: () => { throw new Error("offline"); }, resolveCatalogueProduct: () => { throw new Error("offline"); } });
      try {
        const reopened = offline.open(file)!;
        expect(reopened.physicalNodes).toEqual(filled.physicalNodes);
        expect(reopened.configuredItems.find(row => row.uuid === item.uuid)).toEqual(item);
        expect(reopened.distinta).toEqual(filled.distinta);
        expect(reopened.history?.undoLabel).toBeNull();
      } finally { offline.close(); }
    } finally { service.close(); main.close(); db.close(); rmSync(folder, { recursive: true, force: true }); }
  }, 120_000);

  it.runIf(existsSync(source))("matches ANA_ARMADI outer depth in mm for 161 and 230 mm, snapshots and offline PDF", async () => {
    const db = new Database(filename!, { readonly: true });
    const folder = mkdtempSync(path.join(tmpdir(), "librequadri-depth-source-"));
    const reader = new MDBReader(readFileSync(source));
    const rows = reader.getTable("ANA_ARMADI").getData();
    const service = new ProjectDocumentService({ workingDirectory: path.join(folder, "w"), incomingDirectory: path.join(folder, "i"),
      backupDirectory: path.join(folder, "b"), migrationsFolder: path.resolve("db/migrations/project"), appVersion: "test",
      resolveConfiguration: (request) => resolveConfiguration(db, request), resolveCatalogueProduct: id => getCatalogueProductSnapshot(db, id) });
    try {
      const file = path.join(folder, "depth.lqp");
      await service.create({ destinationPath: file, title: "Profondità", description: "", notes: "", projectType: "civil", executor: "",
        date: "2026-10-08", companyName: "", companyDescription: "" });
      for (const [pack, depth] of [[2886, 161], [343, 230]]) {
        const row = rows.find(row => Number(row["Id_Pack"]) === pack)!;
        expect(Number(row["Profondita_reale"])).toBe(depth);
        const modelId = db.prepare("SELECT id FROM cat_config_model WHERE code=?").pluck().get(`tq.pack.${pack}`) as number;
        const request = { modelId, selectedOptionIds: [] };
        expect(resolveConfiguration(db, request).physical?.outerDepthMm).toBe(depth);
        const item = service.addConfiguredItem(request).configuredItems.find(item => item.modelCode === `tq.pack.${pack}`)!;
        service.placeRoot({ itemUuid: item.uuid, rootXMm: pack, rootYMm: 0, viewCode: "front" });
      }
      await service.save(); service.close();
      const offline = new ProjectDocumentService({ workingDirectory: path.join(folder, "offline"), incomingDirectory: path.join(folder, "i"),
        backupDirectory: path.join(folder, "b"), migrationsFolder: path.resolve("db/migrations/project"), appVersion: "test",
        resolveCatalogueProduct: () => { throw new Error("offline"); } });
      try {
        const project = offline.open(file)!;
        const depths = combinedFrontGeometry(project.physicalNodes, project.configuredItems).sectors.map(sector => sectorDimensions(sector).depthMm);
        expect(depths.sort()).toEqual([161, 230]);
        const html = buildFrontDocument(project, {}, { labels: false, dimensions: true }).html;
        expect([...html.matchAll(/data-dimension="depth"[^>]*>([^<]+)</g)].map(match => match[1]).sort()).toEqual(["161 mm", "230 mm"]);
        expect(buildFrontDocument(project, {}, { labels: false, dimensions: false }).html).not.toContain('data-dimension="depth"');
      } finally { offline.close(); }
    } finally { service.close(); db.close(); rmSync(folder, { recursive: true, force: true }); }
  }, 30_000);
});
