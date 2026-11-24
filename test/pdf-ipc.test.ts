import { describe, expect, it, vi } from "vitest";
import { registerPdfIpc } from "../src/main/documents/pdf-ipc.js";
import { PROJECT_CHANNELS, type ProjectDocumentView } from "../src/shared/project.js";
import type { ProjectDocumentService } from "../src/main/project/project-document-service.js";
import type { ProjectPdfService } from "../src/main/documents/pdf-service.js";
import type { ProjectInvokeEvent, ProjectIpcRegistry } from "../src/main/project/project-ipc.js";

function setup(project: ProjectDocumentView | null = {} as ProjectDocumentView) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const current = vi.fn(() => project), frontAssets = vi.fn(() => ({ vector: {} }));
  const previewFront = vi.fn(async () => "token"), preview = vi.fn(async () => "commercial-token"), save = vi.fn();
  const saveDocument = vi.fn(async () => true), saveFront = vi.fn(async () => false);
  registerPdfIpc({ handle: (channel, handler) => { handlers.set(channel, handler as (...args: unknown[]) => unknown); } } as ProjectIpcRegistry,
    { current, frontAssets } as unknown as ProjectDocumentService,
    { previewFront, preview, save, saveDocument, saveFront } as unknown as ProjectPdfService, event => event.senderFrame === "trusted");
  return { handlers, current, frontAssets, previewFront, preview, save, saveDocument, saveFront,
    invokeArgs: (channel: string, args: unknown[], trusted = true) => handlers.get(channel)!(
      { senderFrame: trusted ? "trusted" : "foreign" } as ProjectInvokeEvent, ...args),
    invoke: (channel: string, value: unknown, trusted = true, extra?: unknown) => handlers.get(channel)!(
      { senderFrame: trusted ? "trusted" : "foreign" } as ProjectInvokeEvent, value, extra) };
}

describe("PDF IPC boundary", () => {
  it("saves current Distinta without any preview, honoring price choices", async () => {
    const kind = "distinta";
    const state = setup();
    for (const showPrices of [true, false]) {
      await expect(state.invokeArgs(PROJECT_CHANNELS.saveDocumentPdf, [kind, { showPrices, showDiscounts: false, showLabour: false }])).resolves.toBe(true);
      expect(state.saveDocument).toHaveBeenLastCalledWith({}, kind, { showPrices, showDiscounts: false, showLabour: false });
    }
    expect(state.current).toHaveBeenCalledTimes(2);
    expect(state.preview).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
    expect(state.frontAssets).not.toHaveBeenCalled();
  });

  it("saves the current front with main-owned assets and current options, returning cancellation normally", async () => {
    const state = setup();
    for (const options of [{ labels: false, dimensions: true }, { labels: true, dimensions: false },
      { labels: true, dimensions: true, combinedWidths: true }]) {
      await expect(state.invokeArgs(PROJECT_CHANNELS.saveFrontPdf, [options])).resolves.toBe(false);
      expect(state.saveFront).toHaveBeenLastCalledWith({}, { vector: {} }, options);
    }
    expect(state.current).toHaveBeenCalledTimes(3);
    expect(state.frontAssets).toHaveBeenCalledTimes(3);
    expect(state.previewFront).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });

  it("rejects untrusted direct saves before reading the project or assets", () => {
    const state = setup();
    expect(() => state.invokeArgs(PROJECT_CHANNELS.saveDocumentPdf, ["preventivo", true], false)).toThrow("Untrusted");
    expect(() => state.invokeArgs(PROJECT_CHANNELS.saveFrontPdf, [{ labels: true, dimensions: false }], false)).toThrow("Untrusted");
    expect(state.current).not.toHaveBeenCalled();
    expect(state.frontAssets).not.toHaveBeenCalled();
    expect(state.saveDocument).not.toHaveBeenCalled();
    expect(state.saveFront).not.toHaveBeenCalled();
  });

  it("rejects malformed direct requests, paths, HTML, editor state and extra arguments", () => {
    const state = setup();
    for (const args of [[], ["preventivo"], ["fronte-quadro", true], ["distinta", "true"],
      ["preventivo", true, "/tmp/file.pdf"], ["/tmp/file.pdf", true], [{ html: "<script>" }, true]])
      expect(() => state.invokeArgs(PROJECT_CHANNELS.saveDocumentPdf, args)).toThrow("Opzioni PDF");
    for (const value of [undefined, null, [], {}, { labels: 1, dimensions: false }, { labels: false, dimensions: "true" },
      { labels: true, dimensions: true, combinedWidths: "true" },
      { labels: true, dimensions: false, filePath: "/tmp/file.pdf" }, { labels: true, dimensions: false, html: "<svg>" },
      { labels: true, dimensions: true, physicalNodes: [] }, { labels: true, dimensions: true, selectedUuid: "case" }])
      expect(() => state.invokeArgs(PROJECT_CHANNELS.saveFrontPdf, [value])).toThrow("Opzioni PDF");
    expect(() => state.invokeArgs(PROJECT_CHANNELS.saveFrontPdf, [{ labels: true, dimensions: false }, {}])).toThrow("Opzioni PDF");
    expect(state.current).not.toHaveBeenCalled();
    expect(state.frontAssets).not.toHaveBeenCalled();
    expect(state.saveDocument).not.toHaveBeenCalled();
    expect(state.saveFront).not.toHaveBeenCalled();
    const closed = setup(null);
    expect(() => closed.invokeArgs(PROJECT_CHANNELS.saveDocumentPdf, ["distinta", { showPrices: true, showDiscounts: false, showLabour: false }])).toThrow("Nessun progetto");
    expect(() => closed.invokeArgs(PROJECT_CHANNELS.saveFrontPdf, [{ labels: true, dimensions: false }])).toThrow("Nessun progetto");
    expect(closed.frontAssets).not.toHaveBeenCalled();
  });

  it("exports the current snapshot and resolved local vectors with only the two view choices", async () => {
    const state = setup();
    await expect(state.invoke(PROJECT_CHANNELS.previewFrontPdf, { labels: true, dimensions: false })).resolves.toBe("token");
    expect(state.current).toHaveBeenCalledOnce();
    expect(state.frontAssets).toHaveBeenCalledOnce();
    expect(state.previewFront).toHaveBeenCalledWith({}, { vector: {} }, { labels: true, dimensions: false });
  });

  it("rejects untrusted senders, missing projects, malformed options and arbitrary editor payloads", () => {
    const state = setup();
    expect(() => state.invoke(PROJECT_CHANNELS.previewFrontPdf, { labels: true, dimensions: true }, false)).toThrow("Untrusted");
    for (const value of [null, [], {}, { labels: "true", dimensions: false }, { labels: true, dimensions: true, html: "<script>" },
      { labels: true, dimensions: true, zoom: 4 }, { labels: true, dimensions: true, selectedUuid: "case" }])
      expect(() => state.invoke(PROJECT_CHANNELS.previewFrontPdf, value)).toThrow("Opzioni PDF");
    expect(state.previewFront).not.toHaveBeenCalled();
    expect(state.frontAssets).not.toHaveBeenCalled();
    expect(() => setup(null).invoke(PROJECT_CHANNELS.previewFrontPdf, { labels: true, dimensions: true })).toThrow("Nessun progetto");
  });

  it("validates Distinta options, clears dependent flags without prices and validates preview tokens", async () => {
    const state = setup();
    await expect(state.invokeArgs(PROJECT_CHANNELS.previewPdf, ["distinta", { showPrices: false, showDiscounts: true, showLabour: true }])).resolves.toBe("commercial-token");
    expect(state.preview).toHaveBeenCalledWith({}, "distinta", { showPrices: false, showDiscounts: false, showLabour: false });
    for (const options of [true, null, [], {}, { showPrices: true }, { showPrices: true, showDiscounts: false, showLabour: "true" },
      { showPrices: true, showDiscounts: false, showLabour: false, html: "bad" }]) {
      for (const channel of [PROJECT_CHANNELS.previewPdf, PROJECT_CHANNELS.saveDocumentPdf])
        expect(() => state.invokeArgs(channel, ["distinta", options])).toThrow("Opzioni PDF");
    }
    expect(() => state.invokeArgs(PROJECT_CHANNELS.previewPdf, ["preventivo", { showPrices: true, showDiscounts: false, showLabour: false }])).toThrow("Opzioni PDF");
    expect(() => state.invokeArgs(PROJECT_CHANNELS.previewPdf, ["distinta", { showPrices: true, showDiscounts: false, showLabour: false }, {}])).toThrow("Opzioni PDF");
    expect(() => state.invoke(PROJECT_CHANNELS.savePdf, "path.pdf")).toThrow("Anteprima PDF");
    expect(state.save).not.toHaveBeenCalled();
  });
});
