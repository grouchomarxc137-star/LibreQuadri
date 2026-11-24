import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";

import type { AppStateChange, RecentProjectView } from "../../shared/app.js";
import type { CatalogueOverview, LqApi } from "../../shared/catalogue.js";
import type { ProjectDocumentView } from "../../shared/project.js";
import { NewProjectDialog } from "../project/NewProjectDialog.js";
import { EngineeringDialog } from "./EngineeringDialog.js";
import { ProjectShell } from "./ProjectShell.js";
import { ProjectBar } from "./ProjectBar.js";
import { ListinoDialog, ProjectPropertiesDialog, UnclassifiedDialog } from "./ShellDialogs.js";
import { BrandManagementDialog } from "./BrandManagementDialog.js";
import { initialShellState, shellReducer, type ShellAction, type ShellState } from "./shell-state.js";
import { StartScreen } from "./StartScreen.js";
import { StatusProvider, useStatusActions } from "./status.js";
import { StatusBar } from "./StatusBar.js";
import { ProjectRequestCoordinator, showBrandedLoading, startInitialProjectLoad } from "./startup.js";
import { documentEditBlocked, editKeyCommand, editTarget, isMacPlatform, runDocumentEdit, type EditCommand } from "./edit-commands.js";
import { isTextEntryTarget } from "../project/design-selection.js";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error);
}

/** Status line for a change that happened outside a renderer request (native menu). */
export function stateChangeMessage(change: AppStateChange, project: ProjectDocumentView | null): string | null {
  switch (change.reason) {
    case "opened": return project ? `Aperto ${project.documentName}.` : null;
    case "saved": return project ? `Salvato ${project.documentName}.` : null;
    case "closed": return "Progetto chiuso.";
    case "recent": return null;
    case "catalogue": return "Catalogo aggiornato. I prezzi salvati nel progetto sono stati conservati.";
  }
}

/**
 * Presentational root: the start screen when no project is open, the project
 * shell otherwise, and the shell dialogs above either. The status message comes
 * from the surrounding StatusProvider.
 */
export function AppFrame({ api, project, shell, dispatch, overview, recent, busy, startError, catalogueRevision = 0,
  onProjectChange, onOpenProject, onOpenRecent, onForgetRecent, onCreated }: {
  readonly api: LqApi;
  readonly catalogueRevision?: number;
  readonly project: ProjectDocumentView | null;
  readonly shell: ShellState;
  readonly dispatch: (action: ShellAction) => void;
  readonly overview: CatalogueOverview | null;
  readonly recent: readonly RecentProjectView[] | null;
  readonly busy: boolean;
  readonly startError: string | null;
  readonly onProjectChange: (project: ProjectDocumentView) => void;
  readonly onOpenProject: () => void;
  readonly onOpenRecent: (entry: RecentProjectView) => void;
  readonly onForgetRecent: (entry: RecentProjectView) => void;
  readonly onCreated: (project: ProjectDocumentView) => void;
}) {
  const close = () => dispatch({ type: "close-dialog" });
  return <>
    {project ? <ProjectShell key={catalogueRevision} api={api} project={project} shell={shell} dispatch={dispatch}
      onProjectChange={onProjectChange} statusBar={<StatusBar overview={overview} source={shell.dialog === "distinta" ? "quotation" : "design"} />} />
      : <StartScreen recent={recent} overview={overview} busy={busy} error={startError}
        onNewProject={() => dispatch({ type: "open-dialog", dialog: "new-project" })}
        onOpenProject={onOpenProject} onOpenRecent={onOpenRecent} onForgetRecent={onForgetRecent}
        onUpdateListino={() => dispatch({ type: "open-dialog", dialog: "listino" })}
        onManageBrands={() => dispatch({ type: "open-dialog", dialog: "brands" })}
        onUnclassified={() => dispatch({ type: "open-dialog", dialog: "unclassified" })}
        topBar={<ProjectBar project={null} />}
        statusBar={<StatusBar overview={overview} showCatalogueSize />} />}
    {shell.dialog === "new-project" ? <NewProjectDialog api={api.project} onCancel={close} onCreated={onCreated} /> : null}
    {shell.dialog === "engineering" && project ? <EngineeringDialog api={api.project} onClose={close} onProjectChange={onProjectChange} /> : null}
    {shell.dialog === "properties" && project ? <ProjectPropertiesDialog project={project} onClose={close} /> : null}
    {shell.dialog === "listino" ? <ListinoDialog api={api.metel} overview={overview} onClose={close} /> : null}
    {shell.dialog === "brands" ? <BrandManagementDialog api={api.brands} metel={api.metel} onClose={close}
      onUpdate={()=>dispatch({type:"open-dialog",dialog:"listino"})}/> : null}
    {shell.dialog === "unclassified" ? <UnclassifiedDialog api={api.catalogue} onClose={close} /> : null}
  </>;
}

/** Application root: provides the renderer-only status line to everything below it. */
export function App({ api }: { readonly api: LqApi }) {
  return <StatusProvider><AppRoot api={api} /></StatusProvider>;
}

export function BrandedLoading() {
  return <div className="app-frame branded-loading" aria-busy="true">
    <div className="branded-splash-card">
      <h1>LibreQuadri</h1>
      <p>Configurazione e preventivazione di quadri elettrici</p>
      <span className="loading-indicator" role="status" aria-label="Caricamento in corso" />
      <small>LibreQuadri · Sviluppo in corso</small>
    </div>
  </div>;
}

/** Owns the open-project state and receives native-menu events. */
function AppRoot({ api }: { readonly api: LqApi }) {
  /** undefined until the main process has answered. */
  const [project, setProject] = useState<ProjectDocumentView | null | undefined>(undefined);
  const [shell, dispatch] = useReducer(shellReducer, initialShellState);
  const { announce } = useStatusActions();
  const [overview, setOverview] = useState<CatalogueOverview | null>(null);
  const [catalogueRevision, setCatalogueRevision] = useState(0);
  const [recent, setRecent] = useState<readonly RecentProjectView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [startupMinimumElapsed, setStartupMinimumElapsed] = useState(false);
  const [startupExpired, setStartupExpired] = useState(false);
  const projectRequests = useRef(new ProjectRequestCoordinator<ProjectDocumentView>());
  const newProjectAfterClose = useRef(false);
  const workspaceProjectKey = useRef<string | null | undefined>(undefined);
  const projectRef = useRef<ProjectDocumentView | null>(null);
  projectRef.current = project ?? null;

  const loadRecent = useCallback(() => {
    api.app.recentProjects().then(setRecent, (error: unknown) => { setRecent([]); setStartError(errorText(error)); });
  }, [api]);
  const adoptProject = useCallback((current: ProjectDocumentView) => {
    projectRequests.current.invalidate();
    setProject(current);
    setStartError(null);
  }, []);
  const reloadProject = useCallback(() => projectRequests.current.load(
    () => api.project.current(),
    current => { setProject(current); setStartError(null); },
    error => { setProject(null); setStartError(errorText(error)); }), [api]);

  useEffect(() => {
    const cancel = startInitialProjectLoad(projectRequests.current, () => api.project.current(),
      current => { setProject(current); setStartError(null); },
      error => { setProject(null); setStartError(errorText(error)); },
      () => setStartupMinimumElapsed(true),
      () => setStartupExpired(true));
    api.catalogue.overview().then(setOverview, () => undefined);
    return cancel;
  }, [api]);

  // Annulla / Ripeti: a focused text field keeps its own undo; otherwise the backend document history.
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const edit = useRef<(command: EditCommand) => void>(() => undefined);
  edit.current = (command) => {
    if (editTarget(document.activeElement) === "text") { void api.app.nativeEdit(command).catch(() => undefined); return; }
    if (shellRef.current.dialog !== null) return;
    void runDocumentEdit(command, { project: projectRef.current, api: api.project, adopt: adoptProject, announce });
  };
  useEffect(() => api.app.onCommand((command) => {
    if (command === "edit:undo" || command === "edit:redo") { edit.current(command === "edit:undo" ? "undo" : "redo"); return; }
    if ((command.startsWith("design:") || command === "document:distinta") && documentEditBlocked()) return;
    dispatch({ type: "command", command, projectOpen: projectRef.current !== null });
  }), [api]);
  // Windows/Linux keyboard path (on macOS the native menu accelerators deliver the same commands).
  useEffect(() => {
    const mac = isMacPlatform();
    const key = (event: KeyboardEvent) => {
      const command = editKeyCommand(event, mac);
      if (!command || event.defaultPrevented || isTextEntryTarget(event.target)) return;
      event.preventDefault();
      edit.current(command);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => api.app.onStateChanged((change) => {
    if (change.reason === "closed" && change.openNewProject) {
      projectRequests.current.invalidate();
      if (workspaceProjectKey.current !== null) newProjectAfterClose.current = true;
      else dispatch({ type: "project-closed", openNewProject: true });
      setProject(null);
      setStartError(null);
      announce("Progetto chiuso.", "ok");
      loadRecent();
      return;
    }
    if (change.reason === "catalogue") {
      api.catalogue.overview().then(setOverview,()=>undefined);
      setCatalogueRevision(value=>value+1);
      announce(stateChangeMessage(change,projectRef.current)!,"ok");
      return;
    }
    void reloadProject().then((current) => {
      if (current === undefined) return;
      const message = stateChangeMessage(change, current);
      if (message) announce(message, "ok");
    });
    loadRecent();
  }), [api, announce, loadRecent, reloadProject]);

  // Opening or closing a project resets the workspace; the start screen shows fresh recents.
  // Keyed on the project identity: Save As keeps the user where they are.
  const projectKey = project ? project.metadata.uuid : startupExpired ? null : project;
  useLayoutEffect(() => {
    if (projectKey === undefined) return;
    workspaceProjectKey.current = projectKey;
    dispatch(projectKey === null
      ? { type: "project-closed", openNewProject: newProjectAfterClose.current }
      : { type: "project-opened" });
    newProjectAfterClose.current = false;
    if (projectKey === null) loadRecent();
  }, [projectKey, loadRecent]);

  const runStartAction = async (action: () => Promise<ProjectDocumentView | null>) => {
    projectRequests.current.invalidate();
    setBusy(true); setStartError(null);
    try {
      const opened = await action();
      if (opened) { adoptProject(opened); announce(`Aperto ${opened.documentName}.`, "ok"); }
      else setProject(previous => previous === undefined ? null : previous);
    } catch (error) {
      setStartError(errorText(error));
      loadRecent();
    } finally { setBusy(false); }
  };

  if (showBrandedLoading(project !== undefined, startupMinimumElapsed, startupExpired)) return <BrandedLoading />;
  return <AppFrame api={api} project={project ?? null} shell={shell} dispatch={dispatch}
    catalogueRevision={catalogueRevision}
    overview={overview} recent={recent} busy={busy}
    startError={project === undefined ? startError ?? "L'avvio richiede più tempo del previsto. Puoi aprire o creare un progetto; il caricamento continua." : startError}
    onProjectChange={adoptProject}
    onOpenProject={() => void runStartAction(() => api.project.open())}
    onOpenRecent={(entry) => void runStartAction(() => api.app.openRecent(entry.id))}
    onForgetRecent={(entry) => {
      setStartError(null);
      api.app.forgetRecent(entry.id).then(setRecent, (error: unknown) => setStartError(errorText(error)));
    }}
    onCreated={(created) => { adoptProject(created); announce(`Creato ${created.documentName}.`, "ok"); dispatch({ type: "close-dialog" }); }} />;
}
