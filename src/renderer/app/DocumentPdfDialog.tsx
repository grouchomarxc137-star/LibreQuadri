import { useRef, useState, type ReactNode } from "react";
import { DEFAULT_DOCUMENT_PDF_OPTIONS, normalizeDocumentPdfOptions, type FrontPdfOptions, type ProjectApi } from "../../shared/project.js";
import { ShellDialog } from "./ShellDialogs.js";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error);
}

/** Each export generates the current project with the options selected for this opening. */
export function DocumentPdfDialog({ api, onClose, initialKind = "distinta", frontOptions, children,
  blocked = false, beforeExport, canClose, onBusyChange }: {
  readonly api: ProjectApi; readonly onClose: () => void; readonly initialKind?: "distinta" | "fronte-quadro";
  readonly frontOptions?: FrontPdfOptions;
  readonly children?: ReactNode;
  readonly blocked?: boolean;
  readonly beforeExport?: () => Promise<void>;
  readonly canClose?: () => boolean;
  readonly onBusyChange?: (busy: boolean) => void;
}) {
  const [options, setOptions] = useState(DEFAULT_DOCUMENT_PDF_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const running = useRef(false);
  const front = initialKind === "fronte-quadro";
  const close = () => { if (!running.current && !blocked && (canClose?.() ?? true)) onClose(); };
  const generate = async (preview: boolean) => {
    if (running.current) return;
    running.current = true; setBusy(true); onBusyChange?.(true); setMessage("");
    try {
      await beforeExport?.();
      if (preview) {
        await (front ? api.previewFrontPdf(frontOptions ?? { labels: true, dimensions: false })
          : api.previewPdf("distinta", options));
      } else {
        const saved = await (front ? api.saveFrontPdf(frontOptions ?? { labels: true, dimensions: false })
          : api.saveDocumentPdf("distinta", options));
        if (saved) setMessage("PDF salvato.");
      }
    } catch (error) { setMessage(errorText(error)); }
    finally { running.current = false; setBusy(false); onBusyChange?.(false); }
  };
  return <ShellDialog id="document-pdf" title={front ? "Fronte Quadro PDF" : "Distinta"}
    wide={!!children} onClose={close} actions={<>
      <button type="button" disabled={busy || blocked} onClick={close}>Chiudi</button>
      <button type="button" disabled={busy} onClick={() => void generate(true)}>Anteprima PDF</button>
      <button type="button" disabled={busy} onClick={() => void generate(false)}>Salva PDF</button>
    </>}>
    {children}
    {front ? <p className="hint">Il fronte completo viene adattato a una pagina A4, con etichette e quote secondo la vista corrente. Puoi stampare dal visualizzatore dell’anteprima.</p> :
      <fieldset className="document-pdf-options" disabled={busy || blocked}>
        <legend>Documento Distinta</legend>
        <label><input type="checkbox" checked={options.showPrices}
          onChange={event => setOptions(normalizeDocumentPdfOptions({ ...options, showPrices: event.target.checked }))} /> Mostra prezzi</label>
        <label><input type="checkbox" checked={options.showDiscounts} disabled={!options.showPrices}
          onChange={event => setOptions({ ...options, showDiscounts: event.target.checked })} /> Mostra sconti</label>
        <label><input type="checkbox" checked={options.showLabour} disabled={!options.showPrices}
          onChange={event => setOptions({ ...options, showLabour: event.target.checked })} /> Mostra mano d’opera</label>
      </fieldset>}
    <p className="hint">L’anteprima è facoltativa. Salva PDF genera il documento con le opzioni correnti. Puoi stampare dal visualizzatore dell’anteprima.</p>
    {message ? <p role="status">{message}</p> : null}
  </ShellDialog>;
}
