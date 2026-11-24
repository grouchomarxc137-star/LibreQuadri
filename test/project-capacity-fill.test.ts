import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { decompose, freeRuns, planRun } from "../src/main/project/capacity-fill.js";
import { capacityFillerConfigurations } from "../src/main/catalogue/capacity-fillers.js";
import { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import { capacityFillFixture, type CapacityFillFixture } from "./helpers/capacity-fill-fixture.js";

describe("capacity fill planning (catalogue-free)", () => {
  it("finds every free run around occupied ranges, including leading, inner and trailing space", () => {
    expect(freeRuns(48, [])).toEqual([{ start: 0, length: 48 }]);
    expect(freeRuns(48, [{ start: 10, end: 16 }, { start: 0, end: 6 }])).toEqual([
      { start: 6, length: 4 }, { start: 16, length: 32 }]);
    expect(freeRuns(12, [{ start: 0, end: 6 }, { start: 6, end: 12 }])).toEqual([]);
    expect(freeRuns(12, [{ start: 2, end: 5 }, { start: 4, end: 8 }])).toEqual([{ start: 0, length: 2 }, { start: 8, length: 4 }]);
  });

  it("uses the fewest pieces, largest first, and refuses what cannot be closed exactly", () => {
    const din = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(decompose(48, din)).toEqual([20, 20, 8]);
    expect(decompose(1, din)).toEqual([1]);
    expect(decompose(20, din)).toEqual([20]);
    expect(decompose(41, din)).toEqual([20, 20, 1]);
    expect(decompose(8, [1, 2, 3, 4, 5])).toEqual([5, 3]);
    expect(decompose(7, [2, 4])).toBeNull();
    expect(decompose(6, [4, 3])).toEqual([3, 3]);
    expect(decompose(0, [1])).toEqual([]);
    expect(planRun({ start: 16, length: 8 }, [1, 2, 3, 4, 5])).toEqual([{ start: 16, amount: 5 }, { start: 21, amount: 3 }]);
  });
});

describe("capacity fill (generic designated fillers)", () => {
  let fx: CapacityFillFixture | undefined;
  afterEach(() => { fx?.close(); fx = undefined; });

  const dump = (fixture: CapacityFillFixture) => fixture.dump();
  const tree = async (options?: Parameters<typeof capacityFillFixture>[0]) => {
    fx = await capacityFillFixture(options);
    const { service, add } = fx;
    const frame = add(1), panel = add(2, 2), device = add(3, 2);
    const root = service.placeRoot({ itemUuid: frame, viewCode: "front", rootXMm: 0, rootYMm: 0 }).physicalNodes[0]!.uuid;
    const panelNode = service.placeChild({ itemUuid: panel, parentUuid: root, zoneNo: 0, startUnits: 0, viewCode: "front" })
      .physicalNodes[0]!.children[0]!.uuid;
    service.placeChild({ itemUuid: device, parentUuid: panelNode, zoneNo: 0, startUnits: 0, viewCode: "front" });
    service.placeChild({ itemUuid: device, parentUuid: panelNode, zoneNo: 0, startUnits: 10, viewCode: "front" });
    await service.save();
    return { frame, panel, device, root, panelNode };
  };
  const fillerNodes = (fixture: CapacityFillFixture, parentUuid: string) => {
    const blanks = new Set(fixture.service.current()!.configuredItems.filter(item => item.modelCode === "blank").map(item => item.uuid));
    return fixture.nodes().filter(node => node.parentUuid === parentUuid && blanks.has(node.itemUuid ?? ""))
      .map(node => node.startUnits).sort((a, b) => a! - b!);
  };

  it("discovers one complete configuration per width from the normalized designation only", async () => {
    fx = await capacityFillFixture();
    const found = capacityFillerConfigurations(fx.db, "din_rail");
    expect(found.map(row => row.amount)).toEqual([1, 2, 3, 4, 5]);
    expect(found.every(row => row.result.status === "complete" && row.result.bom.length === 1 &&
      row.result.bom[0]!.quantity === 1 && row.result.totalE4 === 60200)).toBe(true);
    expect(capacityFillerConfigurations(fx.db, "mccb_slot")).toEqual([]);
    fx.db.exec("DELETE FROM cat_config_capacity_filler");
    expect(capacityFillerConfigurations(fx.db, "din_rail")).toEqual([]);
  });

  it("fills every free run of a partly occupied Pannello exactly, as one undoable action", async () => {
    const t = await tree();
    const { service } = fx!;
    expect(service.current()!.dirty).toBe(false);
    const before = dump(fx!);
    const view = service.fillCapacity({ capacityKind: "din_rail" });
    expect(view.fillReport).toEqual({ inserted: 3, supports: 1, examined: 1, skipped: [] });
    expect(fillerNodes(fx!, t.panelNode)).toEqual([6, 16, 21]);
    // One configured item per width; identical pieces would share it. Q equals placed pieces.
    const blanks = view.configuredItems.filter(item => item.modelCode === "blank");
    expect(blanks.map(item => item.configLabel).sort()).toEqual(["Blank · 3 unità", "Blank · 4 unità", "Blank · 5 unità"]);
    expect(blanks.map(item => view.lines.find(line => line.itemUuid === item.uuid)!.quantity)).toEqual([1, 1, 1]);
    // 1 article per piece whatever its width: three BLANK in the Distinta.
    expect(view.distinta.find(row => row.manufacturerCode === "BLANK")).toMatchObject({ quantity: 3 });
    expect(view.dirty).toBe(true);
    expect(view.history).toEqual({ undoLabel: "Inserisci falsi poli DIN", redoLabel: null });
    const after = dump(fx!);

    const undone = service.undo();
    expect(dump(fx!)).toEqual(before);
    expect(undone.dirty).toBe(false);
    expect(undone.distinta.some(row => row.manufacturerCode === "BLANK")).toBe(false);
    expect(undone.history).toEqual({ undoLabel: "Posiziona", redoLabel: "Inserisci falsi poli DIN" });
    const redone = service.redo();
    expect(dump(fx!)).toEqual(after);
    expect(redone.dirty).toBe(true);
    expect(redone.history).toEqual({ undoLabel: "Inserisci falsi poli DIN", redoLabel: null });
  });

  it("is idempotent: a full Pannello or a repeated fill changes nothing and records nothing", async () => {
    await tree();
    const { service } = fx!;
    service.fillCapacity({ capacityKind: "din_rail" });
    await service.save();
    const saved = dump(fx!);
    const again = service.fillCapacity({ capacityKind: "din_rail" });
    expect(again.fillReport).toEqual({ inserted: 0, supports: 0, examined: 1, skipped: [] });
    expect(again.dirty).toBe(false);
    expect(again.history).toEqual({ undoLabel: "Inserisci falsi poli DIN", redoLabel: null });
    expect(dump(fx!)).toEqual(saved);
  });

  it("covers every placed Pannello of every Carpenteria and skips refused ones with reasons", async () => {
    const t = await tree();
    const { service, add } = fx!;
    const empty = service.placeChild({ itemUuid: t.panel, parentUuid: t.root, zoneNo: 0, startUnits: 100, viewCode: "front" })
      .physicalNodes[0]!.children.find(node => node.uuid !== t.panelNode)!.uuid;
    const blind = add(4);
    const blindNode = service.placeChild({ itemUuid: blind, parentUuid: t.root, zoneNo: 0, startUnits: 200, viewCode: "front" })
      .physicalNodes[0]!.children.find(node => node.itemUuid === blind)!.uuid;
    const bare = add(6), barePanel = add(2);
    const bareRoot = service.placeRoot({ itemUuid: bare, viewCode: "front", rootXMm: 600, rootYMm: 0 }).physicalNodes
      .find(node => node.itemUuid === bare)!.uuid;
    const bareNode = service.placeChild({ itemUuid: barePanel, parentUuid: bareRoot, zoneNo: 0, startUnits: 0, viewCode: "front" })
      .physicalNodes.find(node => node.uuid === bareRoot)!.children[0]!.uuid;
    // An unplaced Pannello in the pool is not part of the quadro.
    add(2);
    const view = service.fillCapacity({ capacityKind: "din_rail" });
    expect(view.fillReport!.inserted).toBe(3 + 5);
    expect(view.fillReport!.supports).toBe(2);
    expect(view.fillReport!.examined).toBe(4);
    expect(fillerNodes(fx!, empty)).toEqual([0, 5, 10, 15, 20]);
    expect(fillerNodes(fx!, blindNode)).toEqual([]);
    expect(fillerNodes(fx!, bareNode)).toEqual([]);
    expect(view.fillReport!.skipped.map(row => [row.supportUuid, row.code]).sort()).toEqual([
      [blindNode, "incompatible_parent"], [bareNode, "required_context_not_provided"]].sort());
    // Five-unit pieces of both Pannelli share one configured item: Q = P = 5.
    const five = view.configuredItems.find(item => item.modelCode === "blank" && item.configLabel.endsWith("5 unità"))!;
    expect(view.lines.find(line => line.itemUuid === five.uuid)!.quantity).toBe(5);
    expect(view.distinta.find(row => row.manufacturerCode === "BLANK")).toMatchObject({ quantity: 8 });
  });

  it("leaves existing fillers and pooled filler units untouched", async () => {
    const t = await tree();
    const { service, add } = fx!;
    const manual = add(5, 3, [4]);
    service.placeChild({ itemUuid: manual, parentUuid: t.panelNode, zoneNo: 0, startUnits: 6, viewCode: "front" });
    const placedManual = fx!.nodes().find(node => node.itemUuid === manual)!.uuid;
    const view = service.fillCapacity({ capacityKind: "din_rail" });
    expect(view.fillReport!.inserted).toBe(2);
    expect(fx!.nodes().find(node => node.uuid === placedManual)).toMatchObject({ startUnits: 6 });
    // The 4-unit gap was closed by hand; only the trailing run is filled. The pooled units (Q−P = 2) stay pooled.
    const manualLine = view.lines.find(line => line.itemUuid === manual)!;
    expect(manualLine.quantity).toBe(3);
    expect(fx!.nodes().filter(node => node.itemUuid === manual)).toHaveLength(1);
    expect(fillerNodes(fx!, t.panelNode)).toEqual([6, 16, 21]);
  });

  it("closes only exactly representable runs and reports the rest", async () => {
    const t = await tree({ fillerWidths: [2, 5] });
    const view = fx!.service.fillCapacity({ capacityKind: "din_rail" });
    // Run of 4 → 2+2; run of 8 → no exact sum of 2 and 5 is 8? 2+2+2+2 = 8, so fewest pieces: 4 × 2.
    expect(fillerNodes(fx!, t.panelNode)).toEqual([6, 8, 16, 18, 20, 22]);
    expect(view.fillReport!.skipped).toEqual([]);
    fx!.close();
    const u = await tree({ fillerWidths: [5] });
    const refused = fx!.service.fillCapacity({ capacityKind: "din_rail" });
    expect(refused.fillReport!.inserted).toBe(0);
    expect(refused.fillReport!.skipped.map(row => row.code)).toEqual(["gap_not_representable", "gap_not_representable"]);
    expect(refused.dirty).toBe(false);
    expect(fillerNodes(fx!, u.panelNode)).toEqual([]);
  });

  it("is atomic: a failing write leaves the project, history and dirty state unchanged", async () => {
    await tree();
    const { service, db } = fx!;
    // The project already holds BLANK at the old price; the catalogue price then changes.
    const blank = db.prepare("SELECT id FROM cat_product WHERE manufacturer_code='BLANK'").pluck().get() as number;
    service.addCatalogueProduct(blank, 1);
    await service.save();
    db.prepare("UPDATE com_product_price SET list_price_unit_e4=70000,list_price_e4=70000 WHERE product_id=?").run(blank);
    const before = dump(fx!);
    expect(() => service.fillCapacity({ capacityKind: "din_rail" })).toThrow(/prezzo o listino diverso/);
    expect(dump(fx!)).toEqual(before);
    expect(service.current()!.dirty).toBe(false);
    expect(service.current()!.history).toEqual({ undoLabel: null, redoLabel: null });
  });

  it("refuses without a catalogue or without designated fillers and changes nothing", async () => {
    await tree();
    const before = dump(fx!);
    fx!.db.exec("DELETE FROM cat_config_capacity_filler");
    expect(() => fx!.service.fillCapacity({ capacityKind: "din_rail" })).toThrow(/non contiene falsi poli/);
    fx!.unavailable();
    expect(() => fx!.service.fillCapacity({ capacityKind: "din_rail" })).toThrow(/Catalogo non disponibile/);
    expect(dump(fx!)).toEqual(before);
    expect(fx!.service.current()!.dirty).toBe(false);
  });

  it("skips a Pannello whose project engineering chain is stale", async () => {
    const t = await tree();
    const db = new Database(fx!.workingFile());
    db.prepare("UPDATE prj_item SET source_adapter_version='1' WHERE uuid=?").run(t.panel);
    db.close();
    const view = fx!.service.fillCapacity({ capacityKind: "din_rail" });
    expect(view.fillReport).toMatchObject({ inserted: 0, skipped: [{ supportUuid: t.panelNode, code: "project_engineering_stale" }] });
    expect(view.dirty).toBe(false);
  });

  it("persists fillers through save and an offline reopen", async () => {
    const t = await tree();
    const { service, serviceOptions, file } = fx!;
    const filled = service.fillCapacity({ capacityKind: "din_rail" });
    await service.save();
    service.close();
    const offline = new ProjectDocumentService({ ...serviceOptions, resolveConfiguration: undefined, designGuard: undefined,
      designItemGuard: undefined, capacityFillers: undefined, engineeringCatalogue: () => null });
    try {
      const reopened = offline.open(file);
      expect(reopened.distinta).toEqual(filled.distinta);
      expect(reopened.lines).toEqual(filled.lines);
      expect(reopened.history).toEqual({ undoLabel: null, redoLabel: null });
      const starts: number[] = [];
      const walk = (nodes: typeof reopened.physicalNodes) => { for (const node of nodes) {
        if (node.parentUuid === t.panelNode && node.itemUuid !== t.device) starts.push(node.startUnits!);
        walk(node.children);
      } };
      walk(reopened.physicalNodes);
      expect(starts.sort((a, b) => a - b)).toEqual([6, 16, 21]);
    } finally { offline.close(); }
  });
});
