import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, dialog } from "electron";
import type { DocumentPdfOptions, FrontPdfOptions, ProjectDocumentView } from "../../shared/project.js";
import { buildDocumentModel, type DocumentKind } from "./document-model.js";
import { buildFrontDocument } from "./front-document.js";
import type { FrontAssets } from "../../drawing/front-primitives.js";
import { buildDocumentHtml } from "./document-html.js";

export interface PdfWindowFactory {
  create(options: Electron.BrowserWindowConstructorOptions): BrowserWindow;
}

interface GeneratedPdf { bytes: Buffer; defaultName: string; }

/** The main process alone owns PDF bytes and destination paths. Tokens are short lived and opaque. */
export class ProjectPdfService {
  #generated = new Map<string, GeneratedPdf>();
  #preview: BrowserWindow | null = null;

  constructor(private readonly parent: () => BrowserWindow | undefined,
    private readonly windows: PdfWindowFactory = { create: options => new BrowserWindow(options) }) {}

  async preview(project: ProjectDocumentView, kind: DocumentKind, options: DocumentPdfOptions | boolean): Promise<string> {
    return this.openPreview(await this.generateDocument(project, kind, options));
  }

  async saveDocument(project: ProjectDocumentView, kind: DocumentKind, options: DocumentPdfOptions | boolean): Promise<boolean> {
    return this.saveGenerated(await this.generateDocument(project, kind, options));
  }

  private async generateDocument(project: ProjectDocumentView, kind: DocumentKind, options: DocumentPdfOptions | boolean): Promise<GeneratedPdf> {
    const model = buildDocumentModel(project, kind, new Date(), options);
    const html = buildDocumentHtml(model, options);
    return this.generateHtml(project, kind === "preventivo" ? "Preventivo" : "Distinta", html, {
      pageSize: "A4", printBackground: true, displayHeaderFooter: true,
      margins: { top: 0.65, bottom: 0.7, left: 0.62, right: 0.62 },
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;font:9px Arial,sans-serif;color:#806a52;text-align:right;padding-right:16px">Pagina <span class="pageNumber"></span> di <span class="totalPages"></span></div>`,
    });
  }

  async previewFront(project: ProjectDocumentView, assets: FrontAssets, options: FrontPdfOptions): Promise<string> {
    return this.openPreview(await this.generateFront(project, assets, options));
  }

  async saveFront(project: ProjectDocumentView, assets: FrontAssets, options: FrontPdfOptions): Promise<boolean> {
    return this.saveGenerated(await this.generateFront(project, assets, options));
  }

  private async generateFront(project: ProjectDocumentView, assets: FrontAssets, options: FrontPdfOptions): Promise<GeneratedPdf> {
    const { html, layout } = buildFrontDocument(project, assets, options);
    return this.generateHtml(project, "Fronte Quadro", html, {
      pageSize: "A4", landscape: layout.landscape, preferCSSPageSize: true,
      printBackground: true, displayHeaderFooter: false,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
  }

  private async generateHtml(project: ProjectDocumentView, prefix: string, html: string,
    options: Electron.PrintToPDFOptions): Promise<GeneratedPdf> {
    const generator = this.windows.create({ show: false, webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false,
    } });
    generator.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    generator.webContents.on("will-navigate", event => event.preventDefault());
    let bytes: Buffer;
    try {
      await generator.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      bytes = await generator.webContents.printToPDF(options);
    } finally {
      generator.destroy();
    }
    if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("Generazione PDF non riuscita.");
    const name = project.metadata.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").slice(0, 90) || "Progetto";
    const defaultName = `${prefix} - ${name}.pdf`;
    return { bytes, defaultName };
  }

  private async openPreview(generated: GeneratedPdf): Promise<string> {
    const { bytes, defaultName } = generated;
    const token = randomUUID();
    this.#generated.clear();
    this.#generated.set(token, generated);
    this.#preview?.destroy();
    const preview = this.windows.create({ width: 960, height: 850, title: defaultName, show: false,
      parent: this.parent(), webPreferences: { sandbox: true, contextIsolation: true,
        nodeIntegration: false, javascript: true } });
    this.#preview = preview;
    preview.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const pdfUrl = `data:application/pdf;base64,${bytes.toString("base64")}`;
    preview.webContents.on("will-navigate", (event, url) => { if (url !== pdfUrl) event.preventDefault(); });
    preview.on("closed", () => { if (this.#preview === preview) this.#preview = null; });
    try {
      await preview.loadURL(pdfUrl);
      preview.show();
    } catch (error) {
      preview.destroy();
      this.#generated.delete(token);
      throw error;
    }
    return token;
  }

  async save(token: string): Promise<boolean> {
    const generated = this.#generated.get(token);
    if (!generated) throw new Error("Anteprima PDF scaduta. Genera una nuova anteprima.");
    return this.saveGenerated(generated);
  }

  private async saveGenerated(generated: GeneratedPdf): Promise<boolean> {
    const options = { title: "Salva PDF", defaultPath: path.join(app.getPath("documents"), generated.defaultName),
      filters: [{ name: "PDF", extensions: ["pdf"] }] };
    const parent = this.parent();
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, generated.bytes);
    return true;
  }
}
