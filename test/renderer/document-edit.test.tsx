import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { documentEditBlocked, editKeyCommand, editTarget, isMacPlatform, registerDocumentEditBlocker,
  runDocumentEdit } from "../../src/renderer/app/edit-commands.js";
import { fillReportMessage } from "../../src/renderer/project/design-presentation.js";
import { ProgettazioneScreen } from "../../src/renderer/project/ProgettazioneScreen.js";
import type { ProjectApi, ProjectConfiguredItem, ProjectDocumentView, ProjectPhysicalNode } from "../../src/shared/project.js";

const key = (key: string, modifiers: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) =>
  ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers });

describe("Annulla / Ripeti routing", () => {
  it("lets the macOS menu own Cmd+Z and maps Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z elsewhere", () => {
    expect(isMacPlatform("MacIntel")).toBe(true);
    expect(isMacPlatform("Win32")).toBe(false);
    expect(editKeyCommand(key("z", { metaKey: true }), true)).toBeNull();
    expect(editKeyCommand(key("z", { ctrlKey: true }), true)).toBeNull();
    expect(editKeyCommand(key("z", { ctrlKey: true }), false)).toBe("undo");
    expect(editKeyCommand(key("Z", { ctrlKey: true, shiftKey: true }), false)).toBe("redo");
    expect(editKeyCommand(key("y", { ctrlKey: true }), false)).toBe("redo");
    expect(editKeyCommand(key("y", { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(editKeyCommand(key("z", { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(editKeyCommand(key("z"), false)).toBeNull();
  });

  it("sends menu commands aimed at a text field to its native undo", () => {
    expect(editTarget({ tagName: "TEXTAREA" })).toBe("text");
    expect(editTarget({ tagName: "INPUT", type: "search" })).toBe("text");
    expect(editTarget({ tagName: "INPUT", type: "checkbox" })).toBe("document");
    expect(editTarget({ tagName: "svg" })).toBe("document");
    expect(editTarget(null)).toBe("document");
  });

  const view = (history: ProjectDocumentView["history"]) => ({ history } as ProjectDocumentView);
  let unregister: (() => void) | undefined;
  afterEach(() => { unregister?.(); unregister = undefined; });

  it("runs the backend undo/redo only when there is one, adopts the result and announces it", async () => {
    const undone = view({ undoLabel: null, redoLabel: "Sposta" });
    const api = { undo: vi.fn(async () => undone), redo: vi.fn(async () => undone) };
    const adopt = vi.fn(), announce = vi.fn();
    expect(await runDocumentEdit("undo", { project: view({ undoLabel: null, redoLabel: null }), api, adopt, announce })).toBeNull();
    expect(await runDocumentEdit("undo", { project: null, api, adopt, announce })).toBeNull();
    expect(api.undo).not.toHaveBeenCalled();
    expect(await runDocumentEdit("undo", { project: view({ undoLabel: "Sposta", redoLabel: null }), api, adopt, announce })).toBe("Sposta");
    expect(adopt).toHaveBeenCalledWith(undone);
    expect(announce).toHaveBeenCalledWith("Annullato: Sposta.", "ok");
    expect(await runDocumentEdit("redo", { project: undone, api, adopt, announce })).toBe("Sposta");
    expect(announce).toHaveBeenLastCalledWith("Ripetuto: Sposta.", "ok");
  });

  it("never changes the document while an interaction holds it, and drops repeats while one is in flight", async () => {
    let release!: (value: ProjectDocumentView) => void;
    const api = { undo: vi.fn(() => new Promise<ProjectDocumentView>(resolve => { release = resolve; })), redo: vi.fn() };
    const context = { project: view({ undoLabel: "Posiziona", redoLabel: null }), api, adopt: vi.fn(), announce: vi.fn() };
    let blocked = true;
    unregister = registerDocumentEditBlocker(() => blocked);
    expect(documentEditBlocked()).toBe(true);
    expect(await runDocumentEdit("undo", context)).toBeNull();
    blocked = false;
    const first = runDocumentEdit("undo", context);
    expect(await runDocumentEdit("undo", context)).toBeNull();
    release(view({ undoLabel: null, redoLabel: "Posiziona" }));
    expect(await first).toBe("Posiziona");
    expect(api.undo).toHaveBeenCalledTimes(1);
  });

  it("reports a refused undo without adopting anything", async () => {
    const api = { undo: vi.fn(async () => { throw new Error("Lo stato salvato nella cronologia non corrisponde"); }), redo: vi.fn() };
    const adopt = vi.fn(), announce = vi.fn();
    expect(await runDocumentEdit("undo", { project: view({ undoLabel: "Sposta", redoLabel: null }), api, adopt, announce })).toBeNull();
    expect(adopt).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith("Lo stato salvato nella cronologia non corrisponde");
  });
});

describe("Progettazione edit toolbar", () => {
  const item = (uuid: string, kind: "enclosure" | "support", width: number, height: number) => ({
    uuid, modelKind: kind, modelName: uuid, modelCode: uuid, modelBrandMarchio: "TEST", configLabel: uuid, physStatus: "resolved",
    bom: [], views: [{ viewCode: "front", widthMm: width, heightMm: height }], zones: [],
  } as unknown as ProjectConfiguredItem);
  const root: ProjectPhysicalNode = { uuid: "root", itemUuid: "box", nodeKind: "enclosure", xMm: 0, yMm: 0, viewCode: "front",
    children: [], parentUuid: null, zoneNo: null, startUnits: null, slotNo: null, rootXMm: 0, rootYMm: 0, sortOrder: 0, positionIssue: null };
  const render = (history?: ProjectDocumentView["history"], roots: ProjectPhysicalNode[] = [root]) =>
    renderToStaticMarkup(<ProgettazioneScreen api={{} as ProjectApi} onProjectChange={() => undefined}
      project={{ configuredItems: [item("box", "enclosure", 400, 600)], physicalNodes: roots, lines: [], annotations: [],
        ...(history ? { history } : {}) } as unknown as ProjectDocumentView} />);
  const group = (html: string) => html.match(/<div class="front-edit-controls" role="group" aria-label="Modifica">([\s\S]*?)<\/div>/)![1]!;

  it("shows Annulla / Ripeti named after the document actions, enabled only when available", () => {
    const [undo, redo] = isMacPlatform() ? ["⌘Z", "⇧⌘Z"] : ["Ctrl+Z", "Ctrl+Y"];
    const idle = group(render());
    expect(idle).toContain(`<button type="button" class="icon-button" aria-label="Annulla" title="Annulla (${undo})" disabled="">`);
    expect(idle).toContain(`aria-label="Ripeti" title="Ripeti (${redo})" disabled=""`);
    const ready = group(render({ undoLabel: "Inserisci falsi poli DIN", redoLabel: "Sposta" }));
    expect(ready).toContain(`aria-label="Annulla Inserisci falsi poli DIN" title="Annulla Inserisci falsi poli DIN (${undo})">`);
    expect(ready).toContain(`aria-label="Ripeti Sposta" title="Ripeti Sposta (${redo})">`);
  });

  it("offers Falsi poli DIN when a Carpenteria is placed", () => {
    expect(group(render())).toMatch(/<button type="button" class="toolbar-button" title="Inserisci falsi poli DIN[^"]*">.*Falsi poli DIN<\/button>/);
    expect(group(render(undefined, []))).toMatch(/<button type="button" class="toolbar-button" disabled="" title="Inserisci falsi poli DIN/);
  });

  it("summarizes a fill in plain words", () => {
    expect(fillReportMessage({ inserted: 7, supports: 3, examined: 4, skipped: [
      { supportUuid: "a", zoneNo: 0, code: "incompatible_parent", message: "" }] }))
      .toBe("Inseriti 7 falsi poli DIN in 3 pannelli. 1 pannello non compatibile con i falsi poli.");
    expect(fillReportMessage({ inserted: 1, supports: 1, examined: 1, skipped: [] })).toBe("Inseriti 1 falso polo DIN in 1 pannello.");
    expect(fillReportMessage({ inserted: 0, supports: 0, examined: 2, skipped: [] })).toBe("Nessuno spazio DIN libero da riempire.");
    expect(fillReportMessage({ inserted: 0, supports: 0, examined: 0, skipped: [] })).toBe("Nessun pannello DIN posizionato.");
    expect(fillReportMessage({ inserted: 0, supports: 0, examined: 1, skipped: [
      { supportUuid: "a", zoneNo: 0, code: "gap_not_representable", message: "" }] }))
      .toBe("Nessuno spazio DIN libero da riempire. 1 spazio non riempibile esattamente.");
  });
});
