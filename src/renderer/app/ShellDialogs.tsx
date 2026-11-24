import { useRef, useState, type ReactNode, type RefObject } from "react";

import type { CatalogueApi, CatalogueOverview } from "../../shared/catalogue.js";
import type { ProjectDocumentView } from "../../shared/project.js";
import { formatCount, formatIsoDate } from "../catalogue/formatting.js";
import { UnclassifiedPanel } from "../catalogue/UnclassifiedPanel.js";
import { useDialogFocus } from "../ui/dialog-focus.js";
import type { MetelImportApi } from "../../shared/metel-import.js";
import { MetelImportPanel } from "./MetelImportPanel.js";

/** Modal frame for shell dialogs: Esc closes it; focus starts on the specified control or Chiudi. */
export function ShellDialog({ id, title, wide = false, formWidth = false, onClose, children, actions, initialFocus }: {
  readonly id: string;
  readonly title: string;
  readonly wide?: boolean;
  readonly formWidth?: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
  readonly initialFocus?: RefObject<HTMLElement | null>;
}) {
  const dialog = useRef<HTMLElement>(null);
  useDialogFocus(dialog, initialFocus);
  return <div className="modal-backdrop" role="presentation" onKeyDown={(event) => {
    if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); onClose(); }
  }}>
    <section ref={dialog} className={`shell-dialog${wide ? " shell-dialog-wide" : ""}${formWidth ? " shell-dialog-form" : ""}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}>
      <header><h2 id={`${id}-title`}>{title}</h2></header>
      <div className="shell-dialog-body">{children}</div>
      <footer>{actions ?? <button type="button" onClick={onClose}>Chiudi</button>}</footer>
    </section>
  </div>;
}

export function ProjectPropertiesDialog({ project, onClose }: {
  readonly project: ProjectDocumentView;
  readonly onClose: () => void;
}) {
  const { metadata } = project;
  const rows: readonly (readonly [string, string])[] = [
    ["Nome progetto", metadata.title],
    ["Tipologia", `${metadata.projectType === "civil" ? "Norma civile" : "Norma industriale"}, ${metadata.normCode}`],
    ["Descrizione", metadata.description],
    ["Note", metadata.notes],
    ["Esecutore", metadata.executor],
    ["Data", new Date(`${metadata.date}T00:00:00`).toLocaleDateString("it-IT")],
    ["Azienda", metadata.companyName],
    ["Descrizione azienda", metadata.companyDescription],
    ["File", project.documentName],
    ["Revisione", String(project.revision)],
  ];
  return <ShellDialog id="project-properties" title="Proprietà progetto" onClose={onClose}>
    <dl className="properties-list">{rows.map(([label, value]) =>
      <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl>
    <p className="hint">La modifica dei dati di progetto non è ancora disponibile.</p>
  </ShellDialog>;
}

export function ListinoDialog({ api, overview, onClose }: {
  readonly api: MetelImportApi;
  readonly overview: CatalogueOverview | null;
  readonly onClose: () => void;
}) {
  const lists = overview?.currentPriceLists ?? [];
  const [busy,setBusy] = useState(false);
  const [progress,setProgress] = useState("");
  return <ShellDialog id="listino-update" title="Aggiorna listino METEL" wide onClose={()=>{if(!busy)onClose();}}
    actions={<>
      <div className="metel-operation" role="status" aria-live="polite" aria-atomic="true">
        {busy?<><span className="metel-operation-spinner" aria-hidden="true" /><span className="metel-operation-text">
          <strong>Elaborazione in corso</strong><span>{progress||"Preparazione dell’operazione…"}</span>
        </span></>:null}
      </div>
      <button type="button" disabled={busy} onClick={onClose}>Chiudi</button>
    </>}>
    <MetelImportPanel api={api} onBusy={setBusy} onProgress={setProgress} />
    <details><summary>Listini installati</summary>
    {lists.length === 0 ? <p className="hint">Nessun listino installato.</p> :
      <table className="listino-table"><caption>Listini installati</caption>
        <thead><tr><th scope="col">Emittente</th><th scope="col">Listino</th><th scope="col">Valido dal</th><th scope="col" className="numeric">Articoli a listino</th></tr></thead>
        <tbody>{lists.map((list) => <tr key={list.issuerSigla}>
          <td>{list.issuerSigla}</td><td>n. {list.listinoNumber}</td><td>{formatIsoDate(list.validFrom)}</td>
          <td className="numeric">{formatCount(list.listedProductCount)}</td>
        </tr>)}</tbody>
      </table>}</details>
  </ShellDialog>;
}

export function UnclassifiedDialog({ api, onClose }: {
  readonly api: CatalogueApi;
  readonly onClose: () => void;
}) {
  return <ShellDialog id="unclassified" title="Famiglie da classificare" wide onClose={onClose}>
    <UnclassifiedPanel api={api} />
  </ShellDialog>;
}
