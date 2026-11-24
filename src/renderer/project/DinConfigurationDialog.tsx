import { useEffect, useRef, useState } from "react";
import type { ConfigurationApi } from "../../shared/configuration.js";
import type { ProjectApi, ProjectDocumentView, ProjectPhysicalNode } from "../../shared/project.js";
import { ShellDialog } from "../app/ShellDialogs.js";
import { useStatusActions } from "../app/status.js";
import { ConfigurationControls, ConfigurationResultPanel } from "../configuration/ConfigurationScreen.js";
import { useModelConfiguration } from "../configuration/model-configuration.js";
import { physicalOnlyDevices } from "./device-discovery.js";
import { navigationNotice, submitStructuralAdd, type StructuralNavigationState } from "./structural-navigation.js";

/** Discover approved physical-only models through backend compatibility, never source-specific IDs. */
export function DinConfigurationDialog({ project, api, configurationApi, panel, onProjectChange, onClose }: {
  project: ProjectDocumentView; api: ProjectApi; configurationApi: ConfigurationApi;
  panel?: ProjectPhysicalNode; onProjectChange: (project: ProjectDocumentView) => void; onClose: () => void;
}) {
  const [navigation, setNavigation] = useState<StructuralNavigationState>({ phase: "loading" });
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const { announce } = useStatusActions();
  useEffect(() => {
    let live = true;
    if (!panel) { setNavigation({ phase: "no_root" }); return; }
    api.designNavigation("device", panel.uuid).then(value => {
      if (live) setNavigation({ phase: "loaded", kind: "device", parentUuid: panel.uuid, navigation: value });
    }, () => { if (live) setNavigation({ phase: "error", message: "Riprova aprendo la configurazione." }); });
    return () => { live = false; };
  }, [api, panel?.uuid]);
  const candidates = navigation.phase === "loaded" && navigation.navigation.status === "ready"
    ? physicalOnlyDevices(navigation.navigation) : [];
  const modelId = candidates.find(model => model.id === selected)?.id ?? (candidates.length === 1 ? candidates[0]!.id : null);
  const { state, session } = useModelConfiguration(configurationApi, modelId);
  const current = state.modelId === modelId;
  const isDin = current && state.result?.physical?.demands.some(demand => demand.capacityKindCode === "din_rail");
  const notice = navigationNotice(navigation, "device");
  const close = () => { if (!pending.current) onClose(); };
  const add = async () => {
    const request = session.request();
    if (pending.current || !request || !panel || !isDin || state.result?.status !== "complete" || state.resolving) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const result = await submitStructuralAdd(api, project, "device", request, panel.uuid);
      onProjectChange(result.project); announce(result.message, "ok"); onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <ShellDialog id="din-configuration" title="DIN generico" onClose={close} actions={<>
    <button type="button" disabled={busy} onClick={close}>Chiudi</button>
    <button type="button" className="primary" disabled={busy || !isDin || state.result?.status !== "complete" || state.resolving}
      onClick={() => void add()}>Aggiungi</button>
  </>}>
    {panel ? <p className="hint">Compatibilità con il pannello selezionato nel disegno. Dopo l’aggiunta, trascina l’apparecchio da Da posizionare.</p>
      : <p className="hint">Seleziona un pannello con guida DIN nel disegno.</p>}
    {notice ? <p className={notice.tone === "alert" ? "error" : "hint"} role="status">{notice.text}</p> : null}
    {navigation.phase === "loaded" && navigation.navigation.status === "ready" && !candidates.length
      ? <p role="status">Nessun modello DIN di solo ingombro compatibile. Seleziona un pannello con guida DIN nel disegno.</p> : null}
    {candidates.length > 1 ? <label>Modello <select value={modelId ?? ""} disabled={busy}
      onChange={event => setSelected(Number(event.target.value))}>
      <option value="" disabled>Scegli un modello</option>
      {candidates.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
    </select></label> : null}
    {current && state.model ? <ConfigurationControls model={state.model} result={state.result} busy={busy || state.resolving}
      onChoice={(axisId, optionId) => session.choose(axisId, optionId)} /> : null}
    {current && state.result ? <ConfigurationResultPanel result={state.result} /> : null}
    {state.modelError || state.resolveError ? <p className="error" role="alert">Configurazione non disponibile. Chiudi e riprova.</p> : null}
    {error ? <p className="error" role="alert">{error}</p> : null}
  </ShellDialog>;
}
