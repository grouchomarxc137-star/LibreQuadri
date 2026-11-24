import { useEffect, useRef, useState } from "react";
import type { ProjectApi, ProjectDocumentView } from "../../shared/project.js";
import { ProjectActionQueue } from "../catalogue/project-actions.js";
import { PreventivoWorkspace } from "../quotation/PreventivoWorkspace.js";
import { registerDocumentEditBlocker } from "./edit-commands.js";
import { DocumentPdfDialog } from "./DocumentPdfDialog.js";

export function DistintaDialog({ project, api, actionQueue, onProjectChange, onClose, onOpenLine, onBrowse }: {
  project: ProjectDocumentView; api: ProjectApi; actionQueue: ProjectActionQueue;
  onProjectChange: (project: ProjectDocumentView) => void;
  onClose: () => void; onOpenLine: (uuid: string) => void; onBrowse: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const busy = useRef(false);
  busy.current = editing || exporting;
  useEffect(() => registerDocumentEditBlocker(() => busy.current || actionQueue.busy), [actionQueue]);
  const leave = (action: () => void) => { if (!busy.current && !actionQueue.busy) action(); };
  const beforeExport = async () => {
    const invalid = document.getElementById("document-pdf-title")?.closest('[role="dialog"]')
      ?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (invalid) { invalid.focus(); throw new Error("Correggi i valori non validi prima di generare il PDF."); }
    await actionQueue.whenIdle();
  };
  return <DocumentPdfDialog api={api} onClose={onClose} blocked={editing}
    beforeExport={beforeExport} canClose={() => !actionQueue.busy} onBusyChange={setExporting}>
    <div className="distinta-editor">
      <PreventivoWorkspace project={project} api={api} actionQueue={actionQueue} onProjectChange={onProjectChange}
        hideDocuments disabled={exporting} onBusyChange={setEditing}
        onOpenLine={uuid => leave(() => onOpenLine(uuid))} onBrowse={() => leave(onBrowse)} />
    </div>
  </DocumentPdfDialog>;
}
