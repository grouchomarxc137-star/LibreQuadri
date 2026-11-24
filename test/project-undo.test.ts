import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { captureDocument, DocumentHistory, HISTORY_ENTRY_LIMIT, restoreDocument } from "../src/main/project/document-history.js";
import { registerProjectIpc } from "../src/main/project/project-ipc.js";
import { PROJECT_CHANNELS } from "../src/shared/project.js";
import { capacityFillFixture, type CapacityFillFixture } from "./helpers/capacity-fill-fixture.js";

let fx: CapacityFillFixture | undefined;
afterEach(() => { fx?.close(); fx = undefined; });

/** Carpenteria → Pannello with one placed device (start 0); a second device unit stays in the pool. Saved, clean. */
async function placed() {
  fx = await capacityFillFixture();
  const { service, add } = fx;
  const frame = add(1), panel = add(2, 2), device = add(3, 2);
  const root = service.placeRoot({ itemUuid: frame, viewCode: "front", rootXMm: 0, rootYMm: 0 }).physicalNodes[0]!.uuid;
  const panelNode = service.placeChild({ itemUuid: panel, parentUuid: root, zoneNo: 0, startUnits: 0, viewCode: "front" })
    .physicalNodes[0]!.children[0]!.uuid;
  const deviceNode = service.placeChild({ itemUuid: device, parentUuid: panelNode, zoneNo: 0, startUnits: 0, viewCode: "front" })
    .physicalNodes[0]!.children[0]!.children[0]!.uuid;
  await service.save();
  return { frame, panel, device, root, panelNode, deviceNode };
}
const recovery = () => `${fx!.workingFile()}.recovery.json`;
const startOf = (uuid: string) => fx!.nodes().find(node => node.uuid === uuid)?.startUnits;

describe("document undo/redo of Progettazione actions", () => {
  it("undoes and redoes placement exactly, including the pool count", async () => {
    const t = await placed();
    const { service } = fx!;
    const before = fx!.dump();
    const view = service.placeChild({ itemUuid: t.device, parentUuid: t.panelNode, zoneNo: 0, startUnits: 12, viewCode: "front" });
    expect(view.history).toEqual({ undoLabel: "Posiziona", redoLabel: null });
    const after = fx!.dump();
    expect(fx!.nodes().filter(node => node.itemUuid === t.device)).toHaveLength(2);
    service.undo();
    expect(fx!.dump()).toEqual(before);
    expect(fx!.nodes().filter(node => node.itemUuid === t.device)).toHaveLength(1);
    service.redo();
    expect(fx!.dump()).toEqual(after);
  });

  it("undoes and redoes movement (explicit and packed) keeping node identity", async () => {
    const t = await placed();
    const { service } = fx!;
    service.moveNode(t.deviceNode, { itemUuid: t.device, parentUuid: t.panelNode, zoneNo: 0, startUnits: 9, viewCode: "front" });
    expect(startOf(t.deviceNode)).toBe(9);
    expect(service.current()!.history!.undoLabel).toBe("Sposta");
    service.undo();
    expect(startOf(t.deviceNode)).toBe(0);
    service.redo();
    expect(startOf(t.deviceNode)).toBe(9);
    service.movePackedNode(t.deviceNode, { parentUuid: t.panelNode, zoneNo: 0, index: 0, viewCode: "front" });
    expect(startOf(t.deviceNode)).toBe(0);
    service.undo();
    expect(startOf(t.deviceNode)).toBe(9);
  });

  it("undoes Rimuovi posizione, Pannello unplacement and Carpenteria removal with their quantities", async () => {
    const t = await placed();
    const { service } = fx!;
    const clean = fx!.dump();
    service.unplaceNode(t.deviceNode);
    expect(service.current()!.history!.undoLabel).toBe("Rimuovi posizione");
    service.undo();
    expect(fx!.dump()).toEqual(clean);
    expect(startOf(t.deviceNode)).toBe(0);

    service.unplaceSubtree(t.panelNode);
    expect(fx!.nodes()).toHaveLength(1);
    service.undo();
    expect(fx!.dump()).toEqual(clean);

    const removed = service.removePhysicalRoot(t.root, "remove-contents");
    expect(removed.history!.undoLabel).toBe("Rimuovi carpenteria");
    expect(removed.lines.find(line => line.itemUuid === t.frame)).toBeUndefined();
    expect(removed.lines.find(line => line.itemUuid === t.device)!.quantity).toBe(1);
    const restored = service.undo();
    expect(fx!.dump()).toEqual(clean);
    expect(restored.lines.find(line => line.itemUuid === t.device)!.quantity).toBe(2);
    expect(restored.dirty).toBe(false);
  });

  it("undoes structural adds and annotation edits", async () => {
    const t = await placed();
    const { service } = fx!;
    const clean = fx!.dump();
    const added = service.addStructural({ kind: "support", parentUuid: t.root, place: false, quantity: 3,
      configuration: { modelId: 2, selectedOptionIds: [] } });
    expect(added.history!.undoLabel).toBe("Aggiungi pannello");
    service.undo();
    expect(fx!.dump()).toEqual(clean);

    const note = service.addAnnotation({ text: "Nota", xMm: 10, yMm: 10, widthMm: 80, heightMm: 30 }).annotations[0]!.uuid;
    service.updateAnnotation(note, { text: "Nota modificata", xMm: 30 });
    expect(service.current()!.history).toEqual({ undoLabel: "Modifica testo", redoLabel: null });
    expect(service.undo().annotations[0]).toMatchObject({ text: "Nota", xMm: 10 });
    service.redo();
    service.removeAnnotation(note);
    expect(service.undo().annotations[0]).toMatchObject({ text: "Nota modificata", xMm: 30 });
    service.undo();
    service.undo();
    expect(fx!.dump()).toEqual(clean);
    expect(service.current()!.history).toEqual({ undoLabel: "Posiziona", redoLabel: "Aggiungi testo" });
  });

  it("undoes just the latest quick add and rejects a stale token after another edit", async () => {
    const { root } = await placed();
    const { service, db } = fx!;
    const productId = db.prepare("SELECT id FROM cat_product WHERE manufacturer_code = 'PART'").pluck().get() as number;
    const first = service.addCatalogueProduct(productId, 1, true);
    const second = service.addCatalogueProduct(productId, 1, true);
    expect(first.undoToken).toBeDefined();
    expect(second.undoToken).not.toBe(first.undoToken);
    expect(() => service.undo(first.undoToken)).toThrow(/non è più disponibile/);
    expect(service.undo(second.undoToken).lines.find(line => line.lineType === "product")?.quantity).toBe(1);

    const configured = service.addConfiguredItem({ modelId: 3, selectedOptionIds: [] }, 1, true);
    expect(configured.undoToken).toBeDefined();
    expect(service.undo(configured.undoToken).configuredItems).toEqual(first.configuredItems);
    const panel = service.addStructural({ kind: "support", parentUuid: root, place: false,
      configuration: { modelId: 2, selectedOptionIds: [] } });
    expect(panel.undoToken).toBeDefined();
    const edited = service.addAnnotation({ text: "Nota", xMm: 10, yMm: 10, widthMm: 80, heightMm: 30 });
    expect(() => service.undo(panel.undoToken)).toThrow(/non è più disponibile/);
    expect(service.current()?.annotations).toEqual(edited.annotations);
    expect(service.current()?.configuredItems).toEqual(panel.configuredItems);
  });

  it("a new action discards redo; non-Progettazione changes clear the whole history", async () => {
    const t = await placed();
    const { service } = fx!;
    service.unplaceNode(t.deviceNode);
    service.undo();
    expect(service.current()!.history!.redoLabel).toBe("Rimuovi posizione");
    service.moveNode(t.deviceNode, { itemUuid: t.device, parentUuid: t.panelNode, zoneNo: 0, startUnits: 3, viewCode: "front" });
    expect(service.current()!.history).toEqual({ undoLabel: "Sposta", redoLabel: null });
    const cleared = service.setGlobalDiscount(500);
    expect(cleared.history).toEqual({ undoLabel: null, redoLabel: null });
    expect(() => service.undo()).toThrow(/Nessuna operazione da annullare/);
    expect(() => service.redo()).toThrow(/Nessuna operazione da ripetere/);
    for (const barrier of [
      () => service.addConfiguredItem({ modelId: 3, selectedOptionIds: [] }),
      () => service.setQuantity(service.current()!.lines.find(line => line.itemUuid === t.device)!.uuid, 3),
      () => service.setLabourTotal(1000),
    ]) {
      service.moveNode(t.deviceNode, { itemUuid: t.device, parentUuid: t.panelNode, zoneNo: 0,
        startUnits: startOf(t.deviceNode) === 3 ? 4 : 3, viewCode: "front" });
      expect(service.current()!.history!.undoLabel).toBe("Sposta");
      expect(barrier().history).toEqual({ undoLabel: null, redoLabel: null });
    }
  });
});

describe("dirty state, Save and lifecycle", () => {
  it("is clean exactly when the content equals the saved file, across undo, redo and Save", async () => {
    const t = await placed();
    const { service } = fx!;
    expect(existsSync(recovery())).toBe(false);
    service.moveNode(t.deviceNode, { itemUuid: t.device, parentUuid: t.panelNode, zoneNo: 0, startUnits: 9, viewCode: "front" });
    expect(service.current()!.dirty).toBe(true);
    expect(existsSync(recovery())).toBe(true);
    expect(service.undo().dirty).toBe(false);
    expect(existsSync(recovery())).toBe(false);
    expect(service.redo().dirty).toBe(true);
    expect(existsSync(recovery())).toBe(true);
    await service.save();
    expect(service.current()!.dirty).toBe(false);
    // History survives Save; undoing past the saved state makes the document dirty again.
    expect(service.current()!.history!.undoLabel).toBe("Sposta");
    expect(service.undo().dirty).toBe(true);
    expect(service.redo().dirty).toBe(false);
  });

  it("keeps history across Save As and drops it on close and reopen", async () => {
    const t = await placed();
    const { service } = fx!;
    service.moveNode(t.deviceNode, { itemUuid: t.device, parentUuid: t.panelNode, zoneNo: 0, startUnits: 9, viewCode: "front" });
    const copy = path.join(fx!.root, "copy.lqp");
    const saved = await service.saveAs(copy);
    expect(saved.dirty).toBe(false);
    expect(saved.history!.undoLabel).toBe("Sposta");
    expect(service.undo().dirty).toBe(true);
    service.redo();
    service.close();
    const reopened = service.open(copy);
    expect(reopened.history).toEqual({ undoLabel: null, redoLabel: null });
    expect(reopened.dirty).toBe(false);
  });

  it("an edit made while a save is in flight keeps the document dirty, and undoing it makes it clean", async () => {
    const t = await placed();
    const { service } = fx!;
    service.moveNode(t.deviceNode, { itemUuid: t.device, parentUuid: t.panelNode, zoneNo: 0, startUnits: 9, viewCode: "front" });
    const saving = service.save();
    service.moveNode(t.deviceNode, { itemUuid: t.device, parentUuid: t.panelNode, zoneNo: 0, startUnits: 12, viewCode: "front" });
    await saving;
    expect(service.current()!.dirty).toBe(true);
    expect(service.undo().dirty).toBe(false);
    expect(startOf(t.deviceNode)).toBe(9);
  });
});

describe("atomicity of history operations", () => {
  it("a failing action leaves the document, history and dirty flag unchanged", async () => {
    const t = await placed();
    const { service } = fx!;
    const clean = fx!.dump();
    const history = service.current()!.history;
    expect(history!.undoLabel).toBe("Posiziona");
    mkdirSync(recovery());
    try {
      expect(() => service.moveNode(t.deviceNode, { itemUuid: t.device, parentUuid: t.panelNode, zoneNo: 0, startUnits: 9,
        viewCode: "front" })).toThrow();
    } finally { rmSync(recovery(), { recursive: true }); }
    expect(fx!.dump()).toEqual(clean);
    expect(service.current()!.dirty).toBe(false);
    expect(service.current()!.history).toEqual(history);
    // A placement-rule refusal is equally invisible to the history.
    expect(() => service.placeChild({ itemUuid: t.device, parentUuid: t.panelNode, zoneNo: 0, startUnits: 2, viewCode: "front" }))
      .toThrow(/sovrappone/);
    expect(service.current()!.history).toEqual(history);
    expect(fx!.dump()).toEqual(clean);
  });

  it("a failing undo or redo leaves the document, history and dirty flag unchanged", async () => {
    const t = await placed();
    const { service } = fx!;
    service.moveNode(t.deviceNode, { itemUuid: t.device, parentUuid: t.panelNode, zoneNo: 0, startUnits: 9, viewCode: "front" });
    await service.save();
    service.moveNode(t.deviceNode, { itemUuid: t.device, parentUuid: t.panelNode, zoneNo: 0, startUnits: 12, viewCode: "front" });
    const moved = fx!.dump();
    // Undoing to the saved state needs no recovery record; undoing once more does, and that write fails.
    service.undo();
    mkdirSync(recovery());
    const saved = fx!.dump();
    try {
      expect(() => service.undo()).toThrow();
      expect(fx!.dump()).toEqual(saved);
      expect(service.current()!.dirty).toBe(false);
      expect(service.current()!.history).toEqual({ undoLabel: "Sposta", redoLabel: "Sposta" });
      expect(() => service.redo()).toThrow();
      expect(fx!.dump()).toEqual(saved);
      expect(service.current()!.history).toEqual({ undoLabel: "Sposta", redoLabel: "Sposta" });
    } finally { rmSync(recovery(), { recursive: true }); }
    service.redo();
    expect(fx!.dump()).toEqual(moved);
  });

  it("restores every document table in one transaction and rolls back when the bookkeeping fails", async () => {
    await placed();
    const db = new Database(fx!.workingFile());
    try {
      db.pragma("foreign_keys = ON");
      const revision = db.prepare("SELECT value FROM lqp_meta WHERE key='revision'").pluck().get();
      const image = captureDocument(db);
      const before = fx!.dump();
      db.exec(`DELETE FROM prj_node; DELETE FROM prj_annotation; UPDATE prj_project SET labour_total_e4=99;
        UPDATE lqp_meta SET value='77' WHERE key='revision'`);
      const changed = fx!.dump();
      expect(() => restoreDocument(db, image, () => { throw new Error("bookkeeping"); })).toThrow("bookkeeping");
      expect(fx!.dump()).toEqual(changed);
      restoreDocument(db, image);
      expect(fx!.dump()).toEqual(before);
      expect(db.pragma("foreign_key_check")).toEqual([]);
      // Save bookkeeping is not document content: restoring never rewinds it.
      expect(db.prepare("SELECT value FROM lqp_meta WHERE key='revision'").pluck().get()).toBe("77");
      expect(revision).toBe("2");
    } finally { db.close(); }
  });

  it("bounds the history by entries", () => {
    const history = new DocumentHistory();
    const image = Buffer.alloc(8);
    for (let index = 0; index < HISTORY_ENTRY_LIMIT + 5; index++) history.record({ label: `#${index}`, image, stateId: index });
    expect(history.state().undoLabel).toBe(`#${HISTORY_ENTRY_LIMIT + 4}`);
    let count = 0;
    while (history.peekUndo()) { history.undone({ label: "x", image, stateId: 0 }); count++; if (count > 1000) break; }
    expect(count).toBeLessThanOrEqual(HISTORY_ENTRY_LIMIT);
  });
});

describe("undo/redo IPC", () => {
  it("routes trusted undo, redo and fill requests and validates the fill request", async () => {
    const t = await placed();
    const handlers = new Map<string, (event: { senderFrame: unknown }, ...args: unknown[]) => unknown>();
    registerProjectIpc({ handle: (channel, listener) => handlers.set(channel, listener), removeHandler: () => undefined },
      fx!.service, {} as never, () => true, {} as never);
    const event = { senderFrame: {} };
    const moved = fx!.service.moveNode(t.deviceNode, { itemUuid: t.device, parentUuid: t.panelNode, zoneNo: 0, startUnits: 9, viewCode: "front" });
    const undo = handlers.get(PROJECT_CHANNELS.undo)!;
    expect(() => undo(event, null)).toThrow(/non valida/);
    expect(() => undo(event, "old token")).toThrow(/non è più disponibile/);
    undo(event, moved.undoToken);
    expect(startOf(t.deviceNode)).toBe(0);
    handlers.get(PROJECT_CHANNELS.redo)!(event);
    expect(startOf(t.deviceNode)).toBe(9);
    expect(() => handlers.get(PROJECT_CHANNELS.fillCapacity)!(event, { capacityKind: "mccb_slot" })).toThrow(/non valida/);
    expect(() => handlers.get(PROJECT_CHANNELS.fillCapacity)!(event, { capacityKind: "din_rail", extra: 1 })).toThrow(/non valida/);
    const filled = handlers.get(PROJECT_CHANNELS.fillCapacity)!(event, { capacityKind: "din_rail" }) as { fillReport: { inserted: number } };
    expect(filled.fillReport.inserted).toBeGreaterThan(0);
  });
});
