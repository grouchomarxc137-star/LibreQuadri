import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProjectDocumentService } from "../../src/main/project/project-document-service.js";
import { resolveConfiguration } from "../../src/main/catalogue/configuration-resolver.js";
import { getCatalogueProductSnapshot } from "../../src/main/catalogue/catalogue-queries.js";
import { getConfigurationModel } from "../../src/main/catalogue/configuration-queries.js";
import { readFrontVectorAssets } from "../../src/main/catalogue/vector-assets.js";
import { ModelConfigurationSession } from "../../src/renderer/configuration/model-configuration.js";
import { submitEnclosureConfiguration, enclosureFailureMessage, EnclosureConfigurationFields } from "../../src/renderer/project/EnclosureConfigurationDialog.js";
import { describeSelection } from "../../src/renderer/project/design-selection.js";
import { FronteQuadro } from "../../src/renderer/project/ProgettazioneScreen.js";
import { runDocumentEdit } from "../../src/renderer/app/edit-commands.js";
import { fakeProjectApi } from "./fake-api.js";
import type { ConfigurationRequest } from "../../src/shared/configuration.js";
import type { ProjectDocumentView } from "../../src/shared/project.js";

const cataloguePath = process.env.LIBREQUADRI_REV83_REAL_DB;
describe.runIf(!!cataloguePath && existsSync(cataloguePath))("renderer → approved backend, actual HDX catalogue (scratch project)", () => {
  it.each([1, 3])("Q=%i: saved choices, no-op, selected-unit refresh, errors, Undo/Redo and portable Save", async quantity => {
    const folder = mkdtempSync(path.join(tmpdir(), "librequadri-enclosure-ui-"));
    const catalogue = new Database(cataloguePath!, { readonly: true });
    const modelId = catalogue.prepare("SELECT id FROM cat_config_model WHERE code='tq.pack.108'").pluck().get() as number;
    const model = getConfigurationModel(catalogue, modelId);
    const service = new ProjectDocumentService({ workingDirectory: path.join(folder, "w"), incomingDirectory: path.join(folder, "i"),
      backupDirectory: path.join(folder, "b"), migrationsFolder: path.resolve("db/migrations/project"), appVersion: "test",
      engineeringCatalogue: () => catalogue, resolveConfiguration: request => resolveConfiguration(catalogue, request),
      resolveCatalogueProduct: id => getCatalogueProductSnapshot(catalogue, id) });
    const session = new ModelConfigurationSession({ model: async () => model,
      resolve: async request => resolveConfiguration(catalogue, request) }, () => undefined);
    const file = path.join(folder, "HDX.lqp");
    try {
      await service.create({ destinationPath: file, title: "UI HDX", description: "", notes: "", projectType: "civil", executor: "",
        date: "2026-10-09", companyName: "", companyDescription: "" });
      const item = service.addConfiguredItem({ modelId, selectedOptionIds: [] }, quantity).configuredItems[0]!;
      service.placeRoot({ itemUuid: item.uuid, viewCode: "front", rootXMm: 0, rootYMm: 0 });
      if (quantity > 1) service.placeRoot({ itemUuid: item.uuid, viewCode: "front", rootXMm: 1000, rootYMm: 0 });
      await service.save();
      let project = service.current()!;
      const before = project, bytes = readFileSync(file);
      // Deliberately select the SECOND physical unit when Q>1: line/item identity cannot identify this unit.
      const nodeUuid = project.physicalNodes.at(-1)!.uuid;
      const selection = describeSelection(project, nodeUuid)!;
      session.select(modelId, undefined, selection.item!.selections);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(session.state.result?.status).toBe("complete");
      const api = { ...fakeProjectApi(),
        reconfigureEnclosure: vi.fn(async (uuid: string, request: ConfigurationRequest) => service.reconfigureEnclosure(uuid, request)),
        undo: async () => service.undo(), redo: async () => service.redo() };
      const unchanged = await submitEnclosureConfiguration(api, project, nodeUuid, session.request()!);
      expect(unchanged.project).toEqual(before);
      expect(unchanged.message).toContain("Nessuna modifica");
      expect(unchanged.project.history).toEqual(before.history);
      const axis = model.axes.find(row => row.dimensionCode === "tq.label.1")!;
      const door = axis.options.find(row => row.valueCode === "tq.value.4")!;
      session.choose(axis.id, door.id);
      await new Promise(resolve => setTimeout(resolve, 0));
      const preview = renderToStaticMarkup(<EnclosureConfigurationFields state={session.state} item={selection.item!}
        busy={false} onChoice={() => undefined} onRetry={() => undefined} />);
      expect(preview).toContain(door.label);
      const response = await submitEnclosureConfiguration(api, project, nodeUuid, session.request()!);
      expect(api.reconfigureEnclosure).toHaveBeenLastCalledWith(nodeUuid, session.request());
      project = response.project;
      expect(response.message).toContain("Carpenteria modificata");
      expect(project.revision).toBe(before.revision); // Revision advances on Save, not on this action.
      const refreshed = describeSelection(project, nodeUuid)!;
      expect(refreshed.node.uuid).toBe(nodeUuid);
      expect(refreshed.item!.selections.find(row => row.dimensionCode === axis.dimensionCode)?.valueCode).toBe(door.valueCode);
      expect(refreshed.quantity).toBe(1);
      expect(refreshed.item!.profileCode).toBe("tq.armadi.pack.108.block.312");
      if (quantity > 1) {
        expect(project.physicalNodes[0]).toEqual(before.physicalNodes[0]);
        expect(project.lines.find(row => row.itemUuid === item.uuid)?.quantity).toBe(quantity - 1);
        expect(refreshed.item!.uuid).not.toBe(item.uuid);
      } else expect(refreshed.item!.uuid).toBe(item.uuid);
      expect(project.lines).not.toEqual(before.lines);
      expect(project.distinta).not.toEqual(before.distinta);
      const assetRoot = process.env.LIBREQUADRI_REV83_REAL_ASSETS ?? path.resolve(path.dirname(cataloguePath!), "../assets");
      const keys = [...before.configuredItems, ...project.configuredItems].flatMap(row => row.views.flatMap(view => view.assetKey ? [view.assetKey] : []));
      const assets = readFrontVectorAssets(catalogue, assetRoot, keys);
      const drawing = renderToStaticMarkup(<FronteQuadro roots={project.physicalNodes} items={project.configuredItems} selectedUuid={nodeUuid} assets={assets} />);
      expect(drawing).toContain(`data-selection-uuid="${nodeUuid}"`);
      expect(assets[refreshed.item!.views[0]!.assetKey!]).toBeDefined();
      expect(drawing).toContain("front-vector");
      expect(drawing).not.toBe(renderToStaticMarkup(<FronteQuadro roots={before.physicalNodes} items={before.configuredItems} selectedUuid={nodeUuid} assets={assets} />));
      expect(project.history?.undoLabel).toBe("Modifica carpenteria");
      const adopt = (view: ProjectDocumentView) => { project = view; };
      await runDocumentEdit("undo", { project, api, adopt, announce: vi.fn() });
      expect(project.configuredItems).toEqual(before.configuredItems);
      expect(project.physicalNodes).toEqual(before.physicalNodes);
      expect(project.distinta).toEqual(before.distinta);
      await runDocumentEdit("redo", { project, api, adopt, announce: vi.fn() });
      expect(project.configuredItems).toEqual(response.project.configuredItems);
      expect(project.physicalNodes).toEqual(response.project.physicalNodes);
      expect(project.lines).toEqual(response.project.lines);
      expect(readFileSync(file)).toEqual(bytes);
      // A real backend refusal propagates intact and the shared view remains untouched.
      const snapshot = project;
      await expect(submitEnclosureConfiguration(api, project, "00000000-0000-4000-8000-000000000000", session.request()!))
        .rejects.toThrow("Seleziona una carpenteria fisica");
      expect(service.current()!.configuredItems).toEqual(snapshot.configuredItems);
      expect(enclosureFailureMessage(new Error("Aggiorna i dati di ingegneria del progetto."))).toContain("Aggiorna");
      await service.save();
      expect(service.current()!.history).toEqual(project.history);
      service.close();
      const offline = new ProjectDocumentService({ workingDirectory: path.join(folder, "offline"), incomingDirectory: path.join(folder, "oi"),
        backupDirectory: path.join(folder, "b"), migrationsFolder: path.resolve("db/migrations/project"), appVersion: "test",
        resolveCatalogueProduct: () => { throw new Error("offline"); } });
      try {
        expect(offline.open(file)).toMatchObject({ configuredItems: project.configuredItems, physicalNodes: project.physicalNodes,
          lines: project.lines, distinta: project.distinta, dirty: false });
      } finally { offline.close(); }
    } finally { session.dispose(); service.close(); catalogue.close(); rmSync(folder, { recursive: true, force: true }); }
  });
});
