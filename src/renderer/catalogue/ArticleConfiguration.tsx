import { isOutOfCatalogue } from "../../shared/out-of-catalogue.js";
import { confirmCatalogueAddition } from "../configuration/out-of-catalogue.js";
import { useEffect, useState, type ReactNode } from "react";
import type { CatalogueBrowseProduct } from "../../shared/catalogue.js";
import type { ConfigModelSummary, ConfigurationApi, ConfigurationRequest } from "../../shared/configuration.js";
import type { ProjectConfiguredItem } from "../../shared/project.js";
import { configurationChanged, useModelConfiguration, type ModelConfigurationState } from "../configuration/model-configuration.js";
import { quantityAccepted, SchedaFooter, SchedaFrame, SchedaNotice, type SchedaQuantity } from "./Scheda.js";
import { configurationStatus, ConfigurationSections } from "./SchedaConfiguration.js";

interface SchedaSlots {
  /** Identity and article facts shown above the configuration. */
  lead: ReactNode;
  quantity: SchedaQuantity;
  /** Why the action is unavailable regardless of the configuration, e.g. a placed item. */
  blockedReason?: string | null;
}

function ActionButton({ replacing, enabled, onClick }: { replacing: boolean; enabled: boolean; onClick?: () => void }) {
  return <button type="button" className="primary" disabled={!enabled} onClick={onClick}>
    {replacing ? "Applica modifiche" : "Aggiungi al progetto"}</button>;
}

/** Saved choices that the current catalogue no longer offers: the item cannot be replaced from them. */
export function missingSavedChoices(state: ModelConfigurationState, item?: ProjectConfiguredItem) {
  const model = state.model;
  return model ? item?.selections.filter(saved => !model.axes.some(axis =>
    axis.dimensionCode === saved.dimensionCode && axis.options.some(option =>
      option.valueCode === saved.valueCode && option.active))) ?? [] : [];
}

/** Add/Applica follows the insertion rule: an active model with a complete resolution and a valid quantity. */
export function configurationApplicable(state: ModelConfigurationState, { canApply, busy, blockedReason, quantity, item,
  requireChange = false }: {
  canApply: boolean; busy: boolean; blockedReason?: string | null; quantity: SchedaQuantity; item?: ProjectConfiguredItem;
  /** Replacing an existing line: applying needs a genuine change of the choices, never catalogue drift alone. */
  requireChange?: boolean;
}): boolean {
  const result = state.result;
  return canApply && !busy && !state.resolving && !blockedReason && state.model !== null &&
    (!requireChange || configurationChanged(state)) &&
    missingSavedChoices(state, item).length === 0 && quantityAccepted(quantity) && result !== null &&
    (result.status === "complete" || !requireChange && isOutOfCatalogue(result)) && result.model.active && !result.model.obsolete;
}

export async function preferredArticleModel(models: readonly ConfigModelSummary[], productId?: number,
  branchModelIds?: (productId: number) => Promise<ReadonlySet<number>>) {
  const eligible = models.filter(model => model.active && !model.obsolete);
  if (productId !== undefined && branchModelIds && eligible.length > 1) {
    const inBranch = await branchModelIds(productId);
    const preferred = eligible.find(model => inBranch.has(model.id));
    if (preferred) return preferred;
  }
  return eligible[0];
}

export function articleModels(models: readonly ConfigModelSummary[]) {
  return models.filter(model => model.kind !== "enclosure" && model.kind !== "support");
}

export function ArticleConfigurationView({ state, item, replacing, busy, canApply, lead, quantity, blockedReason,
  modelPicker, onChoice, onApply, expanded = true, onConfigure }: SchedaSlots & {
  state: ModelConfigurationState; item?: ProjectConfiguredItem; replacing: boolean; busy: boolean; canApply: boolean;
  modelPicker?: ReactNode; onChoice: (axisId: number, optionId: number | null) => void; onApply: () => void;
  expanded?: boolean; onConfigure?: () => void;
}) {
  const missing = missingSavedChoices(state, item);
  const enabled = configurationApplicable(state, { canApply, busy, blockedReason, quantity, item, requireChange: replacing });
  const unchanged = replacing && !blockedReason && !!state.result && !state.resolving && !configurationChanged(state);
  return <SchedaFrame footer={<SchedaFooter quantity={quantity} busy={busy}
    notes={[blockedReason ?? null, unchanged ? "Modifica una scelta per applicare una nuova configurazione." : null]}
    action={<ActionButton replacing={replacing} enabled={enabled} onClick={onApply} />} />}>
    {lead}
    {state.modelError ? <SchedaNotice tone="error">Modello non disponibile nel catalogo corrente.</SchedaNotice>
      : !state.model ? <p className="scheda-hint">Caricamento configurazione…</p>
      : expanded ? <ConfigurationSections state={state} busy={busy} leading={modelPicker} onChoice={onChoice}
        bomTitle={item ? "Distinta proposta (configurazione corrente)" : undefined}
        notice={missing.length ? <SchedaNotice tone="error">
          Alcune scelte salvate non sono disponibili nel catalogo corrente. La configurazione non può essere sostituita.
        </SchedaNotice> : null} /> : state.result && !state.resolving ?
        <SchedaNotice tone={configurationStatus(state.result).tone}>{configurationStatus(state.result).text}</SchedaNotice> :
        <p className="scheda-hint">Risoluzione in corso…</p>}
    {!expanded && onConfigure ? <button type="button" disabled={busy} onClick={onConfigure}>Configura</button> : null}
  </SchedaFrame>;
}

function ConfigurationEditor({ api, modelId, productId, item, onApply, ...view }: SchedaSlots & {
  api: ConfigurationApi; modelId: number; productId?: number; item?: ProjectConfiguredItem;
  replacing: boolean; busy: boolean; canApply: boolean; onApply: (request: ConfigurationRequest) => void;
  modelPicker: ReactNode; expanded?: boolean; onConfigure?: () => void;
}) {
  const { state, session } = useModelConfiguration(api, modelId, productId, item?.selections);
  return <ArticleConfigurationView {...view} state={state} item={item}
    onChoice={(axisId, optionId) => session.choose(axisId, optionId)}
    onApply={() => { const request = session.request(); if (request && state.result) { const accepted=view.replacing ? request : confirmCatalogueAddition(request,state.result); if(accepted)onApply(accepted); } }} />;
}

/**
 * Configuration of a known article, or of an existing configured project line, inside Scheda
 * articolo. It loads the article's linked models; the standalone range browser is unchanged.
 */
export function ArticleConfiguration({ api, product, item, replacing = false, busy, canApply, onApply, lead, quantity,
  blockedReason = null, expanded = true, onConfigure, branchModelIds }: SchedaSlots & {
  api: ConfigurationApi; product?: CatalogueBrowseProduct; item?: ProjectConfiguredItem;
  replacing?: boolean; busy: boolean; canApply: boolean; onApply: (request: ConfigurationRequest) => void;
  expanded?: boolean; onConfigure?: () => void;
  branchModelIds?: (productId: number) => Promise<ReadonlySet<number>>;
}) {
  const [models, setModels] = useState<ConfigModelSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [modelId, setModelId] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setModels(null); setFailed(false); setModelId(null);
    const pending = product ? api.productModels(product.id) : item ? api.modelByCode(item.modelBrandMarchio,
      item.modelCode).then(model => model ? [model] : []) : Promise.resolve([]);
    pending.then(async found => {
      if (!live) return;
      // Browsing an article never offers Pannelli/Carpenterie (they are added by Progettazione's structural
      // workflow). An existing project item is edited as itself, whatever its kind; placement safeguards
      // (blockedReason, the backend's refusal of placed lines, the placement-time catalogue guard) still apply.
      const applicable = item ? found : articleModels(found);
      const preferred = await preferredArticleModel(applicable, product?.id, branchModelIds) ?? applicable[0];
      if (!live) return;
      setModels(applicable);
      setModelId(preferred?.id ?? null);
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [api, product?.id, item?.modelBrandMarchio, item?.modelCode, branchModelIds]);
  if (failed || models === null || !models.length || modelId === null) return <SchedaFrame
    footer={<SchedaFooter quantity={quantity} busy={busy} notes={[blockedReason]}
      action={<ActionButton replacing={replacing} enabled={false} />} />}>
    {lead}
    {failed ? <SchedaNotice tone="error">Impossibile caricare i modelli dell’articolo.</SchedaNotice>
      : models === null ? <p className="scheda-hint">Ricerca della configurazione…</p>
      : <SchedaNotice tone="warn">Nessun modello configurabile disponibile nel catalogo corrente.</SchedaNotice>}
    {!expanded && onConfigure ? <button type="button" disabled={busy} onClick={onConfigure}>Configura</button> : null}
  </SchedaFrame>;
  const modelPicker = models.length > 1 ? <div className="scheda-field inspector-model">
    <label htmlFor="scheda-model"><span>Modello</span></label>
    <select id="scheda-model" value={modelId} disabled={busy}
      title={models.find(model => model.id === modelId)?.name}
      onChange={event => setModelId(Number(event.target.value))}>
      {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
    </select></div> : null;
  return <ConfigurationEditor key={modelId} api={api} modelId={modelId} productId={product?.id} item={item}
    replacing={replacing} busy={busy} canApply={canApply} onApply={onApply} lead={lead} quantity={quantity}
    blockedReason={blockedReason} modelPicker={modelPicker} expanded={expanded} onConfigure={onConfigure} />;
}
