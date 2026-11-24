import { configurationCanBeAdded } from "../../shared/out-of-catalogue.js";
import { confirmCatalogueAddition } from "../configuration/out-of-catalogue.js";
import type { CatalogueBrowsePackage } from "../../shared/catalogue.js";
import type { ConfigurationApi, ConfigurationRequest } from "../../shared/configuration.js";
import { useEffect, useState } from "react";
import { useModelConfiguration, type ModelConfigurationState } from "../configuration/model-configuration.js";
import { validQuantity } from "./browse-state.js";
import { SchedaFooter, SchedaFrame, SchedaIdentity, SchedaNotice, SchedaTag } from "./Scheda.js";
import { ConfigurationSections } from "./SchedaConfiguration.js";

/** Add follows the insertion rule: only an active model with a complete resolution. */
export function packageAddable(state: ModelConfigurationState, projectOpen: boolean, busy: boolean,
  quantity: string): boolean {
  const result = state.result;
  return projectOpen && !busy && !state.resolving && result !== null && configurationCanBeAdded(result) &&
    result.model.active && !result.model.obsolete && validQuantity(quantity) !== null;
}

/**
 * A package has no article code or price of its own: its identity is the model name and brand,
 * placed by its authoritative navigation path (e.g. Gamma › Tipologia › Famiglia).
 */
export function PackageInspectorView({ item, state, projectOpen, busy, quantity, onQuantity, onChoice, onAdd,
  offerStale = false, undecided = false }: {
  item: CatalogueBrowsePackage; state: ModelConfigurationState; projectOpen: boolean; busy: boolean;
  quantity: string; onQuantity: (value: string) => void;
  onChoice: (axisId: number, optionId: number | null) => void; onAdd: () => void;
  offerStale?: boolean; undecided?: boolean;
}) {
  const loaded = !state.modelError && state.model !== null;
  return <SchedaFrame label="Configurazione pacchetto" footer={<SchedaFooter
    quantity={{ kind: "new", value: quantity, onChange: onQuantity }} busy={busy}
    notes={[projectOpen ? null : "Crea o apri un progetto per aggiungere questa configurazione."]}
    action={loaded ? <button type="button" className="primary" disabled={!packageAddable(state, projectOpen, busy, quantity)}
      onClick={onAdd}>Aggiungi al progetto</button> : null} />}>
    <SchedaIdentity code={item.brandMarchio} title={item.name} meta={item.groupPath.join(" › ") || null}
      tags={<SchedaTag>Pacchetto</SchedaTag>} />
    {offerStale ? <SchedaNotice tone="warn">La configurazione filtrata non è più disponibile; ricaricare il catalogo.</SchedaNotice> : null}
    {undecided ? <SchedaNotice tone="warn">Questo pacchetto non è valutabile con i filtri attivi. Si apre dalla configurazione predefinita.</SchedaNotice> : null}
    {state.modelError ? <SchedaNotice tone="error">Impossibile leggere questo pacchetto.</SchedaNotice> :
      !state.model ? <p className="scheda-hint">Caricamento del pacchetto…</p> :
      <ConfigurationSections state={state} busy={busy} onChoice={onChoice} />}
  </SchedaFrame>;
}

export function PackageInspector({ api, item, projectOpen, busy, quantity, onQuantity, onAdd,
  undecided = false }: {
  api: Pick<ConfigurationApi, "model" | "resolve"> & Partial<Pick<ConfigurationApi, "offerSelection">>;
  item: CatalogueBrowsePackage; projectOpen: boolean; busy: boolean; undecided?: boolean;
  quantity: string; onQuantity: (value: string) => void; onAdd: (request: ConfigurationRequest) => void;
}) {
  const [witness, setWitness] = useState<{ ids?: number[]; stale: boolean; loading: boolean }>(
    { loading: item.offerNo !== undefined, stale: false });
  useEffect(() => {
    let live = true;
    if (item.offerNo === undefined || !api.offerSelection) {
      setWitness({ loading: false, stale: item.offerNo !== undefined });
      return () => { live = false; };
    }
    setWitness({ loading: true, stale: false });
    void api.offerSelection(item.modelId, item.offerNo).then(result => {
      if (live) setWitness(result.status === "ready" ? { ids: result.selectedOptionIds, loading: false, stale: false } :
        { loading: false, stale: true });
    }, () => { if (live) setWitness({ loading: false, stale: true }); });
    return () => { live = false; };
  }, [api, item.modelId, item.offerNo]);
  const { state, session } = useModelConfiguration(api, witness.loading ? null : item.modelId,
    undefined, [], witness.ids);
  return <PackageInspectorView item={item} state={state} projectOpen={projectOpen} busy={busy} quantity={quantity}
    offerStale={witness.stale} undecided={undecided}
    onQuantity={onQuantity} onChoice={(axisId, optionId) => session.choose(axisId, optionId)}
    onAdd={() => { const request = session.request(); if (request && state.result) { const accepted=confirmCatalogueAddition(request,state.result); if(accepted)onAdd(accepted); } }} />;
}
