// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentPdfDialog } from "../../src/renderer/app/DocumentPdfDialog.js";
import { fakeProjectApi } from "./fake-api.js";

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const button = (label: string) => [...host.querySelectorAll("button")].find(button => button.textContent === label)!;
const check = (label: string) => [...host.querySelectorAll("label")].find(node => node.textContent?.includes(label))!.querySelector("input")!;
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
function setup() {
  return { ...fakeProjectApi(), previewPdf: vi.fn(async () => "token"), saveDocumentPdf: vi.fn(async () => true),
    previewFrontPdf: vi.fn(async () => "front-token"), saveFrontPdf: vi.fn(async () => true) };
}

describe("Distinta PDF choices", () => {
  it("saves without preview and clears dependent choices when prices are switched off and on", async () => {
    const api = setup();
    await act(async () => root.render(<DocumentPdfDialog api={api} onClose={() => undefined} />));
    expect(check("Mostra prezzi").checked).toBe(true);
    expect(check("Mostra sconti").checked).toBe(false);
    expect(check("Mostra mano").checked).toBe(false);
    await click(button("Salva PDF"));
    expect(api.saveDocumentPdf).toHaveBeenLastCalledWith("distinta", { showPrices: true, showDiscounts: false, showLabour: false });
    await click(check("Mostra sconti")); await click(check("Mostra mano"));
    await click(button("Anteprima PDF"));
    expect(api.previewPdf).toHaveBeenLastCalledWith("distinta", { showPrices: true, showDiscounts: true, showLabour: true });
    await click(check("Mostra prezzi"));
    for (const label of ["Mostra sconti", "Mostra mano"]) {
      expect(check(label).checked).toBe(false); expect(check(label).disabled).toBe(true);
    }
    await click(button("Salva PDF"));
    expect(api.saveDocumentPdf).toHaveBeenLastCalledWith("distinta", { showPrices: false, showDiscounts: false, showLabour: false });
    await click(check("Mostra prezzi"));
    expect(check("Mostra sconti").checked).toBe(false); expect(check("Mostra mano").checked).toBe(false);
  });
  it("waits for pending edits, disables closing and exports current options rather than a preview token", async () => {
    const api = setup(), close = vi.fn(); let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await act(async () => root.render(<DocumentPdfDialog api={api} onClose={close} beforeExport={() => pending} />));
    await click(button("Salva PDF"));
    expect(api.saveDocumentPdf).not.toHaveBeenCalled();
    expect(button("Chiudi").disabled).toBe(true); expect(button("Anteprima PDF").disabled).toBe(true);
    await act(async () => { release(); await pending; });
    expect(api.saveDocumentPdf).toHaveBeenCalledOnce();
    await click(button("Chiudi")); expect(close).toHaveBeenCalledOnce();
  });
  it("reports preview/save failures and native save cancellation", async () => {
    const api = setup(); api.previewPdf.mockRejectedValueOnce(new Error("Anteprima fallita"));
    await act(async () => root.render(<DocumentPdfDialog api={api} onClose={() => undefined} />));
    await click(button("Anteprima PDF")); expect(host.textContent).toContain("Anteprima fallita");
    api.saveDocumentPdf.mockRejectedValueOnce(new Error("Error invoking remote method 'project:save-document-pdf': Error: Scrittura fallita"));
    await click(button("Salva PDF")); expect(host.textContent).toContain("Scrittura fallita");
    await click(button("Salva PDF")); expect(host.textContent).toContain("PDF salvato.");
    api.saveDocumentPdf.mockResolvedValueOnce(false);
    await click(button("Salva PDF")); expect(host.textContent).not.toContain("PDF salvato.");
  });
  it("preserves the front export and printing flow", async () => {
    const api = setup();
    await act(async () => root.render(<DocumentPdfDialog api={api} initialKind="fronte-quadro"
      frontOptions={{ labels: false, dimensions: true }} onClose={() => undefined} />));
    await click(button("Anteprima PDF")); await click(button("Salva PDF"));
    expect(api.previewFrontPdf).toHaveBeenCalledWith({ labels: false, dimensions: true });
    expect(api.saveFrontPdf).toHaveBeenCalledWith({ labels: false, dimensions: true });
    expect(api.previewPdf).not.toHaveBeenCalled(); expect(api.saveDocumentPdf).not.toHaveBeenCalled();
  });
});
