import { useRef, useState, type FormEvent } from "react";

import { PROJECT_TYPES, type CreateProjectRequest, type ProjectApi, type ProjectType } from "../../shared/project.js";
import { ShellDialog } from "../app/ShellDialogs.js";

function today(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

const initialForm: CreateProjectRequest = {
  title: "", destinationToken: "", description: "", notes: "", projectType: "civil",
  executor: "", date: today(), companyName: "", companyDescription: "",
};

export function NewProjectDialog({ api, onCancel, onCreated }: {
  readonly api: ProjectApi;
  readonly onCancel: () => void;
  readonly onCreated: (project: Awaited<ReturnType<ProjectApi["create"]>>) => void;
}) {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [destinationName, setDestinationName] = useState("");
  const [busy, setBusy] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof CreateProjectRequest>(key: K, value: CreateProjectRequest[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const browse = async () => {
    setError(null);
    try {
      const selected = await api.chooseDestination(form.title);
      if (selected) {
        set("destinationToken", selected.token);
        setDestinationName(selected.displayName);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { onCreated(await api.create(form)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); setBusy(false); }
  };

  return <ShellDialog id="new-project" title="Nuovo progetto" formWidth onClose={() => { if (!busy) onCancel(); }} initialFocus={titleInput}
    actions={<><button type="button" onClick={onCancel} disabled={busy}>Annulla</button>
      <button className="primary" type="submit" form="new-project-form" disabled={busy}>{busy ? "Creazione…" : "Crea progetto"}</button></>}>
      <form id="new-project-form" className="project-form" onSubmit={submit}>
        <label>Nome progetto<input ref={titleInput} required value={form.title} onChange={(event) => set("title", event.target.value)} /></label>
        <label>Percorso salvataggio<span className="path-picker"><input required readOnly value={destinationName} placeholder="Scegli il file .lqp" /><button type="button" onClick={browse}>Sfoglia…</button></span></label>
        <label>Descrizione<textarea value={form.description} onChange={(event) => set("description", event.target.value)} /></label>
        <label>Note<textarea value={form.notes} onChange={(event) => set("notes", event.target.value)} /></label>
        <div className="project-fields-row">
          <label>Tipologia<select value={form.projectType} onChange={(event) => set("projectType", event.target.value as ProjectType)}>
            {Object.entries(PROJECT_TYPES).map(([value, item]) => <option value={value} key={value}>{item.label}</option>)}
          </select></label>
          <label>Esecutore<input value={form.executor} onChange={(event) => set("executor", event.target.value)} /></label>
          <label>Data<input required type="date" value={form.date} onChange={(event) => set("date", event.target.value)} /></label>
        </div>
        <div className="norm-code"><span>Codice norma selezionato</span><strong>{PROJECT_TYPES[form.projectType].normCode}</strong></div>
        <label>Azienda<input value={form.companyName} onChange={(event) => set("companyName", event.target.value)} /></label>
        <label>Descrizione azienda<textarea value={form.companyDescription} onChange={(event) => set("companyDescription", event.target.value)} /></label>
        {error ? <p className="error" role="alert">{error}</p> : null}
      </form>
  </ShellDialog>;
}
