import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ProjectApi, ProjectDocumentView } from "../../shared/project.js";
import type { ProjectActionQueue } from "../catalogue/project-actions.js";
import { Icon } from "../ui/icons.js";
import { useStatusActions } from "./status.js";

const UNDO_WINDOW_MS = 3000;
const FAILURE_NOTICE_MS = 2250;
const addFailureMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const clean = message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")
    .replace(/^(?:PlacementError|Error):\s*/, "");
  const gamma = clean.match(/Puoi affiancare solo carpenterie della stessa gamma\. (.+?) non può essere affiancata a (.+)\./);
  return gamma ? `Carpenteria non aggiunta. Scegli la stessa gamma del quadro: ${gamma[2]}.`
    : clean || "Aggiunta non riuscita. Verifica la configurazione e riprova.";
};
type QuickAddAction = (api: ProjectApi, project: ProjectDocumentView) => Promise<ProjectDocumentView | null>;
type QuickAdd = (label: string, action: QuickAddAction) => void;
const QuickAddContext = createContext<{ run: QuickAdd; showFailure: (error: unknown) => void } | null>(null);

export function useQuickAdd() {
  return useContext(QuickAddContext)?.run;
}

export function useAddFailureNotice() {
  return useContext(QuickAddContext)?.showFailure;
}

export function QuickAddProvider({ api, project, queue, onProjectChange, children }: {
  api: ProjectApi; project: ProjectDocumentView; queue: ProjectActionQueue;
  onProjectChange: (project: ProjectDocumentView) => void; children: ReactNode;
}) {
  const { announce } = useStatusActions();
  const projectRef = useRef(project);
  const generation = useRef(0);
  const active = useRef(true);
  const [notice, setNotice] = useState<{ label: string; token?: string; deadline: number; placement?: ProjectDocumentView["autoPlacement"] } | null>(null);
  const failureId = useRef(0);
  const [failure, setFailure] = useState<{ id: number; message: string } | null>(null);
  const visible = notice && notice.token === project.undoToken ? notice : null;
  projectRef.current = project;

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; generation.current++; };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(current => current === notice ? null : current),
      Math.max(0, notice.deadline - performance.now()));
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!failure) return;
    const timer = window.setTimeout(() => setFailure(current => current === failure ? null : current), FAILURE_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [failure]);

  const showFailure = useCallback((error: unknown) => {
    if (!active.current) return;
    setFailure({ id: ++failureId.current, message: addFailureMessage(error) });
  }, []);

  const adopt = useCallback((updated: ProjectDocumentView) => {
    if (!active.current) return;
    projectRef.current = updated;
    onProjectChange(updated);
  }, [onProjectChange]);
  const run = useCallback<QuickAdd>((label, action) => {
    const attempt = ++generation.current;
    setNotice(null);
    void queue.enqueue(async () => {
      if (!active.current) return null;
      const updated = await action(api, projectRef.current);
      if (updated && active.current && attempt === generation.current)
        setNotice({ label, token: updated.undoToken, deadline: performance.now() + UNDO_WINDOW_MS, placement: updated.autoPlacement });
      return updated;
    }, adopt, message => {
      if (attempt === generation.current) showFailure(message);
    });
  }, [adopt, api, queue, showFailure]);

  const undo = () => {
    if (!visible?.token || performance.now() >= visible.deadline) return;
    const token = visible.token;
    ++generation.current;
    setNotice(null);
    void queue.enqueue(() => api.undo(token), updated => {
      adopt(updated);
      announce("Aggiunta annullata.", "ok");
    }, message => announce(message));
  };

  return <QuickAddContext.Provider value={{ run, showFailure }}>
    {children}
    {failure ? <div key={failure.id} className="quick-add-notice quick-add-error" role="alert">
      <Icon name="alert" />
      <span>{failure.message}</span>
    </div> : null}
    {visible ? <div className="quick-add-notice">
      <span role="status"><Icon name="check" /> {visible.placement === "placed" ? "Aggiunto e posizionato" : "Aggiunto al progetto"}
        {" · "}<strong>{visible.label}</strong>{visible.placement === "unplaced" ? " · Da posizionare" : null}</span>
      {visible.token ? <button type="button" onClick={undo}>Annulla</button> : null}
    </div> : null}
  </QuickAddContext.Provider>;
}
