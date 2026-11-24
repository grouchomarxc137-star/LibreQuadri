import { useEffect, useRef, useState, type Ref } from "react";
import type { ConfigurationApi, ConfigurationRequest } from "../../shared/configuration.js";
import type { ProjectApi, ProjectConfiguredItem, ProjectDocumentView } from "../../shared/project.js";
import { ConfigurationControls, ConfigurationResultPanel } from "../configuration/ConfigurationScreen.js";
import { restoredOptionIds, useModelConfiguration, type ModelConfigurationState } from "../configuration/model-configuration.js";
import { useDialogFocus } from "../ui/dialog-focus.js";

/** One backend operation by physical identity; the returned view refreshes every workspace. */
export async function submitEnclosureConfiguration(api: Pick<ProjectApi, "reconfigureEnclosure">,
  project: ProjectDocumentView, nodeUuid: string, request: ConfigurationRequest) {
  const itemAt = (view: ProjectDocumentView) => view.configuredItems.find(item =>
    item.uuid === view.physicalNodes.find(node => node.uuid === nodeUuid)?.itemUuid);
  const before = itemAt(project)?.configFingerprint;
  const updated = await api.reconfigureEnclosure(nodeUuid, request);
  return { project: updated, message: itemAt(updated)?.configFingerprint === before
    ? "Nessuna modifica alla configurazione salvata."
    : "Carpenteria modificata. Salva il progetto per conservare le modifiche." };
}

/** Presentation permission only. Effective changes and engineering safety are validated by the backend. */
export function placedLockedAxes(state: ModelConfigurationState, item: ProjectConfiguredItem): number[] {
  return state.model?.axes.filter(axis => !axis.editableWhenPlaced ||
    item.selections.some(saved => saved.dimensionCode === axis.dimensionCode && !saved.editableWhenPlaced))
    .map(axis => axis.id) ?? [];
}

export function enclosureConfigurationBlockedReason(state: ModelConfigurationState, item: ProjectConfiguredItem, busy: boolean): string | null {
  const { model, result } = state;
  if (busy) return "Modifica in corso. Attendi l'esito prima di applicare altre scelte.";
  if (state.modelError) return "Modello non disponibile. Verifica il catalogo di ingegneria e riprova.";
  if (!model) return "Attendi il caricamento della configurazione.";
  if (!model.active) return "Il modello non è attivo nel catalogo corrente. Verifica i dati di ingegneria del progetto e il catalogo.";
  if (model.obsolete) return "Il modello è obsoleto nel catalogo corrente. Verifica i dati di ingegneria del progetto e il catalogo.";
  // Missing/ambiguous saved choices must never turn into an unnoticed default configuration.
  if (restoredOptionIds(model, item.selections).length !== item.selections.length)
    return "Alcune scelte salvate non sono disponibili o sono ambigue. Usa Progetto → Verifica dati di ingegneria prima di modificare la carpenteria.";
  if (state.resolving) return "Risoluzione in corso. Attendi prima di applicare le modifiche.";
  if (state.resolveError) return "Configurazione non risolta. Usa Riprova configurazione.";
  if (!result) return "La configurazione non è ancora risolta. Attendi la risoluzione prima di applicare le modifiche.";
  switch (result.status) {
    case "complete": case "price_incomplete": return null;
    case "invalid": case "budget_exceeded": return "Configurazione non valida. Correggi le scelte e verifica le segnalazioni nella configurazione.";
    case "incomplete": return "Completa le scelte obbligatorie prima di applicare le modifiche.";
    case "bom_incomplete": return "Distinta incompleta. Verifica le segnalazioni e importa gli articoli richiesti nel catalogo.";
    case "no_profile": return "Profilo fisico non disponibile. Scegli opzioni con un profilo valido o verifica il catalogo di ingegneria.";
  }
}

export function enclosureConfigurationApplicable(state: ModelConfigurationState, item: ProjectConfiguredItem, busy: boolean): boolean {
  return enclosureConfigurationBlockedReason(state, item, busy) === null;
}

export function handleEnclosureDialogKey(event: Pick<KeyboardEvent, "key" | "repeat" | "preventDefault" | "stopPropagation">,
  busy: boolean, onCancel: () => void): void {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) onCancel(); }
  // Native Enter activates only the focused button; repeated Enter must not resubmit.
  if (event.key === "Enter" && event.repeat) event.preventDefault();
}

/** The same choices/results as structural insertion, with the saved selections kept visible for comparison. */
export function EnclosureConfigurationFields({ state, item, busy, onChoice, onRetry }: {
  state: ModelConfigurationState; item: ProjectConfiguredItem; busy: boolean;
  onChoice: (axisId: number, optionId: number | null) => void; onRetry: () => void;
}) {
  const locked = placedLockedAxes(state, item);
  const missing = state.model && restoredOptionIds(state.model, item.selections).length !== item.selections.length;
  const changes = state.result?.model.axes.flatMap(axis => {
    const saved = item.selections.find(row => row.dimensionCode === axis.dimensionCode);
    const current = axis.options.find(option => state.result!.selectedOptionIds.includes(option.id));
    return (saved?.valueCode ?? null) === (current?.valueCode ?? null) ? [] : [{ axis, saved, current }];
  }) ?? [];
  return <>
    <section className="config-card"><h3>Scelte salvate</h3>
      <dl className="config-physical">{item.selections.filter(row => row.visible).map(row =>
        <div key={row.dimensionCode}><dt>{row.dimensionLabel}</dt><dd>{row.valueLabel}</dd></div>)}</dl>
      {!item.selections.some(row => row.visible) ? <p className="hint">Nessuna scelta visibile salvata.</p> : null}
    </section>
    {state.modelError ? <p role="alert" className="error">Modello non disponibile. Verifica il catalogo di ingegneria e riprova.</p>
      : !state.model ? <p role="status">Caricamento configurazione…</p> : <>
        <ConfigurationControls model={state.model} result={state.result} busy={busy || state.resolving}
          lockedAxisIds={locked} onChoice={(axisId, optionId) => { if (!busy && !state.resolving && !locked.includes(axisId)) onChoice(axisId, optionId); }} />
        {missing ? <p role="alert" className="error">Alcune scelte salvate non sono disponibili o sono ambigue nel catalogo corrente.
          Usa Progetto → Verifica dati di ingegneria prima di modificare la carpenteria.</p> : null}
        {state.resolveError ? <p role="alert" className="error">Impossibile risolvere la configurazione. Riprova.</p>
          : state.resolving || !state.result ? <p role="status">Risoluzione in corso…</p> : <>
            <section className="config-card" aria-live="polite"><h3>Modifiche alle scelte</h3>
              {changes.length ? <ul>{changes.map(({ axis, saved, current }) => <li key={axis.id}>
                {axis.label}: {saved?.valueLabel ?? "Nessuna scelta"} → {current?.label ?? "Nessuna scelta"}
                {current && state.result!.defaultedOptionIds.includes(current.id) ? " (predefinito)" : ""}
                {locked.includes(axis.id) ? " — caratteristica bloccata; scegli opzioni compatibili con il valore salvato" : ""}
              </li>)}</ul> : <p className="hint">Nessuna modifica alle scelte salvate.</p>}
            </section>
            <ConfigurationResultPanel result={state.result} />
          </>}
      </>}
    {state.modelError || state.resolveError ? <button type="button" disabled={busy} onClick={onRetry}>Riprova configurazione</button> : null}
  </>;
}

export function EnclosureConfigurationDialog({ api, item, quantity, busy, error, onApply, onCancel }: {
  api: ConfigurationApi; item: ProjectConfiguredItem; quantity: number; busy: boolean; error: string | null;
  onApply: (request: ConfigurationRequest) => void; onCancel: () => void;
}) {
  const [lookup, setLookup] = useState<{ id: number | null; error: string | null }>({ id: null, error: null });
  const [reload, setReload] = useState(0);
  const dialog = useRef<HTMLElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useDialogFocus(dialog, cancel);
  const { state, session } = useModelConfiguration(api, lookup.id, undefined, item.selections);
  useEffect(() => {
    let live = true;
    setLookup({ id: null, error: null });
    api.modelByCode(item.modelBrandMarchio, item.modelCode).then(model => {
      if (live) setLookup(model?.kind === "enclosure" ? { id: model.id, error: null }
        : { id: null, error: "Modello di carpenteria assente nel catalogo corrente. Importa il catalogo di ingegneria richiesto e riprova." });
    }, caught => { if (live) setLookup({ id: null, error: enclosureFailureMessage(caught) }); });
    return () => { live = false; };
  }, [api, item.modelBrandMarchio, item.modelCode, reload]);
  const locked = placedLockedAxes(state, item);
  return <div className="modal-backdrop" role="presentation">
    <section ref={dialog} className="shell-dialog enclosure-configuration-dialog" role="dialog" aria-modal="true"
      aria-labelledby="enclosure-configuration-title" aria-describedby="enclosure-configuration-description" tabIndex={-1}
      aria-busy={busy} onKeyDown={event => handleEnclosureDialogKey(event, busy, onCancel)}>
      <header><h2 id="enclosure-configuration-title">Modifica carpenteria</h2></header>
      <div className="shell-dialog-body">
        <p id="enclosure-configuration-description"><strong>{item.modelName}</strong> · {item.modelBrandMarchio} / {item.modelCode}.
          {quantity > 1 ? ` Quantità ${quantity}: cambia solo l'unità fisica selezionata, che diventa una configurazione indipendente di quantità 1. Le altre unità conservano le scelte salvate.`
            : " Cambia l'unità fisica selezionata."} Modello e profondità restano gli stessi.</p>
        {lookup.error ? <><p className="error" role="alert">{lookup.error}</p>
          <button type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>Riprova configurazione</button></>
          : <EnclosureConfigurationFields state={state} item={item} busy={busy}
            onChoice={(axisId, optionId) => { if (!locked.includes(axisId)) session.choose(axisId, optionId); }}
            onRetry={() => session.select(lookup.id, undefined, item.selections)} />}
        <p className="hint">Dopo la modifica puoi usare Annulla / Ripeti. Salva il progetto per conservarla.</p>
      </div>
      <EnclosureConfigurationFooter state={state} item={item} busy={busy} error={error} lookupError={lookup.error}
        cancelRef={cancel} onCancel={onCancel}
        onApply={() => { const request = session.request(); if (request) onApply(request); }} />
    </section>
  </div>;
}

/** Errors/reasons are beside the action, outside the independently scrolling configuration body. */
export function EnclosureConfigurationFooter({ state, item, busy, error, lookupError, cancelRef, onApply, onCancel }: {
  state: ModelConfigurationState; item: ProjectConfiguredItem; busy: boolean; error: string | null;
  lookupError?: string | null; cancelRef?: Ref<HTMLButtonElement>; onApply: () => void; onCancel: () => void;
}) {
  const reason = lookupError ? "Configurazione non disponibile. Verifica il catalogo di ingegneria e riprova."
    : enclosureConfigurationBlockedReason(state, item, busy);
  return <footer>
    {error ? <p className="error enclosure-apply-error" role="alert" aria-atomic="true" tabIndex={0}>Modifica non eseguita. {enclosureFailureMessage(error)}</p> : null}
    {reason ? <p id="enclosure-apply-reason" className="hint enclosure-apply-reason" role="status">{reason}</p> : null}
    <div className="enclosure-dialog-actions">
      <button type="button" ref={cancelRef} disabled={busy} onClick={onCancel}>Annulla</button>
      <button type="button" className="primary" disabled={reason !== null} aria-describedby={reason ? "enclosure-apply-reason" : undefined}
        onClick={() => { if (reason === null) onApply(); }}>{busy ? "Modifica in corso…" : "Applica modifiche"}</button>
    </div>
  </footer>;
}

/** Strip transport/known exception wrappers only at the start; diagnostic text and UUIDs stay intact. */
export function enclosureFailureMessage(caught: unknown): string {
  let message = caught instanceof Error ? caught.message : String(caught);
  const exception = /^(?:Error|TypeError|RangeError|EnclosureReconfigurationError|EngineeringDataStaleError|ProjectLifecycleBusyError|ConfiguredPriceSnapshotError|PlacementError|ProjectSaveError|ProjectEngineeringRefreshError|InvalidCatalogueFilterError|InvalidCataloguePayloadError):\s*/;
  const invocation = /^Error invoking remote method (?:'[^']*'|"[^"]*"):\s*/;
  for (;;) {
    const unwrapped = message.replace(invocation, "").replace(exception, "");
    if (unwrapped === message) break;
    message = unwrapped;
  }
  return message || "Impossibile modificare la carpenteria. Riprova.";
}
