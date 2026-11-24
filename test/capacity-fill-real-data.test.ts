import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { resolveConfiguration } from "../src/main/catalogue/configuration-resolver.js";
import { getCatalogueProductSnapshot } from "../src/main/catalogue/catalogue-queries.js";
import { capacityFillerConfigurations } from "../src/main/catalogue/capacity-fillers.js";
import { guardConfiguredStructuralItem, guardDesignCandidate } from "../src/main/project/design-compatibility.js";
import { readEngineeringReadiness } from "../src/main/catalogue/engineering-readiness.js";
import { documentTables } from "../src/main/project/document-history.js";

/**
 * Real BTicino/TiQuadri acceptance of the automatic DIN fill. Runs only against an explicitly named,
 * current-adapter catalogue (a scratch reimport); the catalogue is copied again before use and never
 * modified. The TiQuadri pack codes below are test data, not runtime rules.
 */
const filename = process.env["LIBREQUADRI_CAPACITY_FILL_REAL_DB"] ?? process.env["LIBREQUADRI_REV83_REAL_DB"];
describe.runIf(!!filename && existsSync(filename))("real DIN fill with TiQuadri falsi poli (always scratch)", () => {
  it("resolves all 20 designated widths to one E80FP each", () => {
    const catalogue = new Database(filename!, { readonly: true });
    try {
      expect(readEngineeringReadiness(catalogue).sources.find(source => source.adapterCode === "tiquadri")?.status).toBe("ready");
      const found = capacityFillerConfigurations(catalogue, "din_rail");
      expect(found.map(row => row.amount)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
      for (const { amount, result } of found) {
        expect(result.model.code).toBe("tq.pack.1777");
        expect(result.physical!.views.find(view => view.code === "front")!.widthMm).toBe(9 * amount);
        expect(result.bom.map(row => [row.linkedManufacturerCode, row.quantity])).toEqual([["E80FP", 1]]);
        expect(result.totalE4).toBe(result.bom[0]!.unitPriceE4);
      }
    } finally { catalogue.close(); }
  });

  it("fills MDX800 Pannelli as one undoable action, skips refused ones and survives save/reopen", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), "librequadri-fill-real-")), source = new Database(filename!, { readonly: true });
    const scratch = path.join(folder, "catalogue.db"); source.prepare("VACUUM INTO ?").run(scratch); source.close();
    const catalogue = new Database(scratch, { readonly: true });
    const id = (code: string) => catalogue.prepare("SELECT id FROM cat_config_model WHERE code=?").pluck().get(code) as number;
    const options = { workingDirectory: path.join(folder, "w"), incomingDirectory: path.join(folder, "i"), backupDirectory: path.join(folder, "b"),
      migrationsFolder: path.resolve("db/migrations/project"), appVersion: "test", engineeringCatalogue: () => catalogue,
      resolveCatalogueProduct: (product: number) => getCatalogueProductSnapshot(catalogue, product),
      resolveConfiguration: (request: Parameters<typeof resolveConfiguration>[1]) => resolveConfiguration(catalogue, request),
      designGuard: (project: Database.Database, request: Parameters<typeof guardDesignCandidate>[2],
        configuration: Parameters<typeof resolveConfiguration>[1]) => guardDesignCandidate(catalogue, project, request, { mode: "add", configuration }),
      designItemGuard: (project: Database.Database, request: Parameters<typeof guardConfiguredStructuralItem>[2]) =>
        guardConfiguredStructuralItem(catalogue, project, request),
      capacityFillers: (kind: string) => capacityFillerConfigurations(catalogue, kind) };
    const service = new ProjectDocumentService(options);
    const dump = () => {
      const working = new Database(path.join(folder, "w", readdirSync(path.join(folder, "w")).find(name => name.endsWith(".lqp"))!), { readonly: true });
      try {
        return Object.fromEntries(documentTables(working).map(table => [table,
          working.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).raw().all()]));
      } finally { working.close(); }
    };
    try {
      const file = path.join(folder, "fill.lqp");
      await service.create({ destinationPath: file, title: "Falsi poli", description: "", notes: "", projectType: "civil", executor: "",
        date: "2026-10-06", companyName: "", companyDescription: "" });
      const add = (code: string, quantity = 1) => {
        const view = service.addConfiguredItem({ modelId: id(code), selectedOptionIds: [] }, quantity);
        return view.configuredItems.find(item => item.modelCode === code)!.uuid;
      };
      const placeSupport = (root: string, panel: string) => {
        const target = service.placementTargets({ parentUuid: root, itemUuid: panel }).targets[0];
        expect(target, panel).toBeDefined();
        const before = new Set(service.current()!.physicalNodes.flatMap(node => node.children.map(child => child.uuid)));
        return service.placeStructuralItem(target as never).physicalNodes.flatMap(node => node.children)
          .find(child => !before.has(child.uuid))!.uuid;
      };
      const mdx = add("tq.pack.343");
      const root = service.placeRoot({ itemUuid: mdx, viewCode: "front", rootXMm: 0, rootYMm: 0 }).physicalNodes[0]!.uuid;
      const partial = placeSupport(root, add("tq.pack.1234"));
      const empty = placeSupport(root, add("tq.pack.851"));
      const btdin = add("tq.pack.4395", 2);
      for (const start of [0, 10]) service.placeChild({ itemUuid: btdin, parentUuid: partial, zoneNo: 0, startUnits: start, viewCode: "front" });
      // A Pannello the falso polo cannot enter: the source enclosure-family list of pack 1777 excludes Plexo3.
      const plexo = add("tq.pack.5386");
      const plexoRoot = service.placeRoot({ itemUuid: plexo, viewCode: "front", rootXMm: 1000, rootYMm: 0 }).physicalNodes
        .find(node => node.itemUuid === plexo)!.uuid;
      const refused = placeSupport(plexoRoot, add("tq.pack.2193"));
      await service.save();
      const before = dump();

      const filled = service.fillCapacity({ capacityKind: "din_rail" });
      const report = filled.fillReport!;
      expect(report.skipped).toEqual([expect.objectContaining({ supportUuid: refused, code: "incompatible_ancestor",
        message: "La carpenteria non accetta i falsi poli." })]);
      const pieces = (parent: string) => {
        const nodes = filled.physicalNodes.flatMap(node => node.children).find(node => node.uuid === parent)!.children
          .filter(node => node.itemUuid !== btdin);
        const amount = (itemUuid: string) => filled.configuredItems.find(item => item.uuid === itemUuid)!.demands!
          .find(demand => demand.capacityKindCode === "din_rail")!.amount;
        return nodes.map(node => [node.startUnits, amount(node.itemUuid!)]).sort((a, b) => a[0]! - b[0]!);
      };
      // The default BTDIN60 occupies 4 half-modules: free runs [4,10) and [14,48) on 1234; all 48 on 851.
      expect(pieces(partial)).toEqual([[4, 6], [14, 20], [34, 14]]);
      expect(pieces(empty)).toEqual([[0, 20], [20, 20], [40, 8]]);
      expect(report).toMatchObject({ inserted: 6, supports: 2, examined: 3 });
      const fillers = filled.configuredItems.filter(item => item.modelCode === "tq.pack.1777");
      expect(fillers.map(item => item.configLabel).sort()).toEqual(["Falsi polo · 10 moduli", "Falsi polo · 3 moduli",
        "Falsi polo · 4 moduli", "Falsi polo · 7 moduli"]);
      expect(fillers.map(item => filled.lines.find(line => line.itemUuid === item.uuid)!.quantity).reduce((a, b) => a + b)).toBe(6);
      expect(filled.distinta.find(row => row.manufacturerCode === "E80FP")).toMatchObject({ quantity: 6 });
      expect(filled.history!.undoLabel).toBe("Inserisci falsi poli DIN");
      const after = dump();

      expect(service.fillCapacity({ capacityKind: "din_rail" }).fillReport).toMatchObject({ inserted: 0 });
      const undone = service.undo();
      expect(dump()).toEqual(before);
      expect(undone.dirty).toBe(false);
      expect(undone.distinta.some(row => row.manufacturerCode === "E80FP")).toBe(false);
      service.redo();
      expect(dump()).toEqual(after);
      await service.save();
      service.close();
      const offline = new ProjectDocumentService({ ...options, workingDirectory: path.join(folder, "offline"), engineeringCatalogue: () => null,
        resolveCatalogueProduct: () => { throw new Error("offline"); } });
      try {
        const reopened = offline.open(file);
        expect(reopened.distinta).toEqual(filled.distinta);
        expect(reopened.physicalNodes).toEqual(filled.physicalNodes);
      } finally { offline.close(); }
    } finally { service.close(); catalogue.close(); rmSync(folder, { recursive: true, force: true }); }
  }, 180_000);
});
