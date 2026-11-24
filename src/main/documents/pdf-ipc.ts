import { PROJECT_CHANNELS, normalizeDocumentPdfOptions, type DocumentPdfOptions, type FrontPdfOptions } from "../../shared/project.js";
import type { ProjectDocumentService } from "../project/project-document-service.js";
import type { ProjectInvokeEvent, ProjectIpcRegistry } from "../project/project-ipc.js";
import type { ProjectPdfService } from "./pdf-service.js";

export function frontPdfOptions(value: unknown): FrontPdfOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Opzioni PDF non valide.");
  const options = value as Record<string, unknown>;
  if (typeof options.labels !== "boolean" || typeof options.dimensions !== "boolean" ||
    ("combinedWidths" in options && typeof options.combinedWidths !== "boolean") ||
    Object.keys(options).some(key => key !== "labels" && key !== "dimensions" && key !== "combinedWidths"))
    throw new Error("Opzioni PDF non valide.");
  return { labels: options.labels, dimensions: options.dimensions,
    ...(typeof options.combinedWidths === "boolean" ? { combinedWidths: options.combinedWidths } : {}) };
}

export function documentPdfOptions(value: unknown): DocumentPdfOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Opzioni PDF non valide.");
  const options = value as Record<string, unknown>;
  if (Object.keys(options).length !== 3 ||
    ["showPrices", "showDiscounts", "showLabour"].some(key => typeof options[key] !== "boolean"))
    throw new Error("Opzioni PDF non valide.");
  return normalizeDocumentPdfOptions(options as unknown as DocumentPdfOptions);
}

export function registerPdfIpc(registry: ProjectIpcRegistry, documents: ProjectDocumentService, pdf: ProjectPdfService,
  isTrusted: (event: ProjectInvokeEvent) => boolean): void {
  const trusted = (event: ProjectInvokeEvent) => { if (!isTrusted(event)) throw new Error("Untrusted IPC sender"); };
  const current = () => {
    const project = documents.current();
    if (!project) throw new Error("Nessun progetto aperto.");
    return project;
  };
  registry.handle(PROJECT_CHANNELS.previewPdf, (event, ...args) => {
    trusted(event);
    const [kind, value] = args;
    if (args.length !== 2 || kind !== "distinta") throw new Error("Opzioni PDF non valide.");
    const options = documentPdfOptions(value);
    return pdf.preview(current(), kind, options);
  });
  registry.handle(PROJECT_CHANNELS.previewFrontPdf, (event, value) => {
    trusted(event);
    const options = frontPdfOptions(value);
    return pdf.previewFront(current(), documents.frontAssets(), options);
  });
  registry.handle(PROJECT_CHANNELS.savePdf, (event, token) => {
    trusted(event);
    if (typeof token !== "string" || !/^[0-9a-f-]{36}$/i.test(token)) throw new Error("Anteprima PDF non valida.");
    return pdf.save(token);
  });
  registry.handle(PROJECT_CHANNELS.saveDocumentPdf, (event, ...args) => {
    trusted(event);
    const [kind, value] = args;
    if (args.length !== 2 || kind !== "distinta") throw new Error("Opzioni PDF non valide.");
    const options = documentPdfOptions(value);
    return pdf.saveDocument(current(), kind, options);
  });
  registry.handle(PROJECT_CHANNELS.saveFrontPdf, (event, ...args) => {
    trusted(event);
    if (args.length !== 1) throw new Error("Opzioni PDF non valide.");
    const options = frontPdfOptions(args[0]);
    return pdf.saveFront(current(), documents.frontAssets(), options);
  });
}
