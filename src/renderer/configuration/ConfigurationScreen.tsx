import { configurationCanBeAdded, isOutOfCatalogue } from "../../shared/out-of-catalogue.js";
import { confirmCatalogueAddition } from "./out-of-catalogue.js";
import { useEffect, useId, useState } from "react";
import type {
  ConfigurationApi, ConfigurationRequest, ConfigurationResult, ConfigModelDetail, ConfigModelSummary,
  ProductModelEntry, RangeNode,
} from "../../shared/configuration.js";
import { useModelConfiguration } from "./model-configuration.js";
import { demandText, issueText, modelKind, rangeChildren, rangePath, selectableOptions } from "./presentation.js";

export function ConfigurationAddAction({projectOpen,result,adding,error,request,onAdd,onAddingChange,onErrorChange}: {
  projectOpen:boolean;result:ConfigurationResult;adding:boolean;error:string|null;
  request:ConfigurationRequest;onAdd:(request:ConfigurationRequest)=>Promise<void>;
  onAddingChange:(adding:boolean)=>void;onErrorChange:(error:string|null)=>void;
}) {
  if (!projectOpen) return <p className="hint">Crea o apri un progetto per aggiungere questa configurazione.</p>;
  return <div className="config-card">
    <button type="button" className="primary" disabled={adding || !configurationCanBeAdded(result) ||
      !result.model.active || result.model.obsolete}
      onClick={async () => {
        onAddingChange(true);onErrorChange(null);
        try { const accepted=confirmCatalogueAddition(request,result); if(accepted) await onAdd(accepted); }
        catch (caught) { onErrorChange(caught instanceof Error ? caught.message : String(caught)); }
        finally { onAddingChange(false); }
      }}>
      {adding ? "Aggiunta in corso…" : "AGGIUNGI AL PROGETTO"}</button>
    {error ? <p className="error" role="alert">{error}</p> : null}
  </div>;
}

function ModelList({ models, onSelect }: {models: readonly ConfigModelSummary[]; onSelect: (model: ConfigModelSummary) => void}) {
  const [historical, setHistorical] = useState(false);
  const [query, setQuery] = useState("");
  const visible = models.filter(model => (historical || (model.active && !model.obsolete)) &&
    `${model.name} ${model.code} ${model.kind}`.toLocaleLowerCase("it").includes(query.trim().toLocaleLowerCase("it")));
  return <section className="config-model-list" aria-label="Modelli configurabili">
    <div className="config-list-tools"><label><input type="checkbox" checked={historical} onChange={event => setHistorical(event.target.checked)} /> Mostra modelli storici</label>
      <input type="search" aria-label="Filtra modelli" placeholder="Filtra modelli in questa gamma" value={query} onChange={event => setQuery(event.target.value)} /></div>
    {visible.length ? <ul>{visible.map(model => <li key={model.id}><button type="button" onClick={() => onSelect(model)}>
      <strong>{model.name}</strong><span>{modelKind(model.kind)} · {model.brandMarchio}</span>
      {model.obsolete || !model.active ? <em>Storico / non attivo</em> : null}
    </button></li>)}</ul> : <p className="hint">Nessun modello corrispondente. Puoi mostrare anche i modelli storici.</p>}
  </section>;
}

export function ConfigurationResultPanel({ result }: {result: ConfigurationResult}) {
  const issues = result.issues.filter(issue => !["missing_price", "inexact_price", "unsupported_currency", "mixed_currency"]
    .includes(issue.code)).map(issue => ({issue, text: issueText(issue, result)}));
  const budgets = result.model.budgets.flatMap(definition => {
    const usage = result.budgets.find(budget => budget.code === definition.code);
    return usage ? [{code:definition.code,label:definition.label,used:usage.used,maxAmount:usage.maxAmount}] : [];
  });
  return <div className="config-results" aria-live="polite">
    <section className="config-card"><h3>Stato della configurazione</h3>
      <p>{isOutOfCatalogue(result) ? "Fuori catalogo — articoli METEL mancanti; conferma richiesta per aggiungere" : result.status === "complete" ? "Configurazione completa" : result.status === "incomplete" ? "Completa le scelte richieste" :
        result.status === "invalid" || result.status === "budget_exceeded" ? "Configurazione da correggere" :
        "Configurazione con dati mancanti"}</p>
      {issues.length ? <ul className="config-issues">{issues.map(({issue, text}, index) =>
        <li key={`${issue.code}-${index}`} className={issue.severity === "error" ? "error" : "config-warning"}>
          <strong>{issue.severity === "error" ? "Da correggere" : "Avviso"}:</strong> {text}
        </li>)}</ul> : null}
    </section>
    {budgets.length ? <section className="config-card"><h3>Limiti di configurazione</h3>
      <dl className="config-physical">{budgets.map(budget => <div key={budget.code}>
        <dt>{budget.label}</dt><dd>{budget.used} / {budget.maxAmount}</dd>
      </div>)}</dl>
    </section> : null}
    <section className="config-card"><h3>Distinta articoli</h3>
      {result.bom.length ? <div className="table-scroll"><table className="product-table config-bom"><thead><tr>
        <th>Marca / articolo</th><th>Descrizione</th><th className="numeric">Qtà</th>
      </tr></thead><tbody>{result.bom.map((row, index) => <tr key={`${row.brandMarchio}/${row.manufacturerCode}/${index}`}>
        <td><span className="brand">{row.brandMarchio}</span> <span className="code">{row.manufacturerCode}</span></td>
        <td>{row.description ?? "Descrizione non disponibile"}</td>
        <td className="numeric">{new Intl.NumberFormat("it-IT", {maximumFractionDigits: 4}).format(row.quantity)}</td>
      </tr>)}</tbody></table></div> : <p className="hint">{result.commercialContribution === "none"
        ? "Nessun articolo commerciale: la configurazione occupa solo spazio."
        : "Nessun articolo risolto per le scelte attuali."}</p>}
    </section>
    <section className="config-card"><h3>Dati fisici</h3>
      {result.physical ? <><p>{result.physical.name} · {result.physical.fitClass.name}</p>
        {result.physical.demands.length ? <ul>{result.physical.demands.map(demand => <li key={demand.capacityKindCode}>{demandText(demand)}</li>)}</ul> : null}
        <dl className="config-physical">{([
          ["Profondità", result.physical.depthMm], ["Profondità esterna", result.physical.outerDepthMm],
          ["Profondità utile", result.physical.usableDepthMm],
        ] as const).filter(([, value]) => value !== null).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value} mm</dd></div>)}
          {result.physical.views.filter(view => view.widthMm > 0 && view.heightMm > 0).map(view =>
            <div key={view.code}><dt>Ingombro {view.code}</dt><dd>{view.widthMm} × {view.heightMm} mm</dd></div>)}</dl>
      </> : <p className="hint">Profilo fisico non disponibile.</p>}
    </section>
  </div>;
}

export function ConfigurationControls({ model, result, busy, onChoice, title = "Scelte", lockedAxisIds = [] }: {
  model: ConfigModelDetail; result: ConfigurationResult | null; busy: boolean;
  onChoice: (axisId: number, optionId: number | null) => void;
  title?: string;
  lockedAxisIds?: readonly number[];
}) {
  const prefix = useId();
  const selected = result?.selectedOptionIds ?? [];
  const visibleAxes = model.axes.filter(axis => axis.visibility === "visible");
  return <section className="config-card config-controls"><h3>{title}</h3>
    {visibleAxes.length ? visibleAxes.map(axis => {
      const choices = selectableOptions(axis.options, selected);
      const current = axis.options.find(option => selected.includes(option.id) && option.visible && option.active);
      const locked = lockedAxisIds.includes(axis.id);
      const id = `${prefix}-config-axis-${axis.id}`;
      return <label key={axis.id} htmlFor={id}>
        <span>{axis.label} {locked ? <small>Bloccato dopo il posizionamento</small>
          : axis.requirement === "required" ? <small>Obbligatorio</small> : <small>Facoltativo</small>}</span>
        <select id={id} value={current && choices.includes(current) ? current.id : ""}
          disabled={busy || locked || !result || choices.length === 0}
          onChange={event => onChoice(axis.id, event.target.value ? Number(event.target.value) : null)}>
          <option value="">{busy || !result ? "Risoluzione in corso…" :
            choices.length ? "Scegli…" : "Scegli prima un'altra caratteristica"}</option>
          {choices.map(option => <option key={option.id} value={option.id}>{option.label}{option.isDefault ? " (predefinito)" : ""}</option>)}
        </select>
      </label>;
    }) : <p className="hint">Questo modello non richiede scelte visibili.</p>}
  </section>;
}

export function ConfigurationScreen({ api, productId, projectOpen, onAdd }: {
  api: ConfigurationApi; productId?: number; projectOpen: boolean;
  onAdd: (request: ConfigurationRequest) => Promise<void>;
}) {
  const [ranges, setRanges] = useState<RangeNode[] | null>(null);
  const [rangesError, setRangesError] = useState(false);
  const [nodeId, setNodeId] = useState<number | null>(null);
  const [nodeModels, setNodeModels] = useState<ConfigModelSummary[] | null>(null);
  const [nodeError, setNodeError] = useState(false);
  const [entries, setEntries] = useState<ProductModelEntry[] | null>(null);
  const [entryError, setEntryError] = useState(false);
  const [modelId, setModelId] = useState<number | null>(null);
  const [entryProductId, setEntryProductId] = useState<number | undefined>();
  const { state: configuration, session } = useModelConfiguration(api, modelId, entryProductId);
  const { model, modelError, result, resolveError, resolving } = configuration;
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => { let cancelled = false; api.ranges().then(value => { if (!cancelled) setRanges(value); },
    () => { if (!cancelled) setRangesError(true); }); return () => { cancelled = true; }; }, [api]);
  useEffect(() => { if (productId === undefined) return; let cancelled = false;
    api.productModels(productId).then(value => { if (!cancelled) setEntries(value); },
      () => { if (!cancelled) setEntryError(true); }); return () => { cancelled = true; }; }, [api, productId]);
  useEffect(() => { if (nodeId === null) return; let cancelled = false;
    api.nodeModels(nodeId).then(value => { if (!cancelled) setNodeModels(value); },
      () => { if (!cancelled) setNodeError(true); }); return () => { cancelled = true; }; }, [api, nodeId]);

  const selectModel = (chosen: ConfigModelSummary, fromProduct = false) => {
    setModelId(chosen.id); setEntryProductId(fromProduct ? productId : undefined); setAddError(null);
  };
  const selectNode = (id: number | null) => { setNodeId(id); setNodeModels(null); setNodeError(false); };
  const path = rangePath(ranges ?? [], nodeId);
  const children = rangeChildren(ranges ?? [], nodeId);
  return <div className="configurator">
    <div className="config-browser">
      <section className="config-card"><h3>Gamme e strutture</h3>
        {rangesError ? <p className="error" role="alert">Impossibile caricare la struttura tecnica.</p> :
          ranges === null ? <p className="hint">Caricamento della struttura tecnica…</p> :
          ranges.length === 0 ? <p className="hint">Nessuna gamma importata. Importa i dati di ingegneria per iniziare.</p> : <>
            <nav className="config-path" aria-label="Percorso gamma"><button type="button" onClick={() => selectNode(null)}>Tutte le gamme</button>
              {path.map(node => <button type="button" key={node.id} onClick={() => selectNode(node.id)}>{node.name}</button>)}</nav>
            {children.length ? <ul className="config-nodes">{children.map(node => <li key={node.id}>
              <button type="button" onClick={() => selectNode(node.id)}>{node.name}
                <span>{node.brandMarchio}{node.active ? "" : " · Storica"} →</span></button></li>)}</ul> :
              nodeId === null ? <p className="hint">Nessuna gamma disponibile.</p> : null}
          </>}
      </section>
      {productId !== undefined ? <section className="config-card"><h3>Modelli del prodotto selezionato</h3>
        {entryError ? <p className="error">Impossibile caricare i modelli del prodotto.</p> : entries === null ? <p className="hint">Ricerca dei modelli…</p> :
          entries.length ? <ModelList models={entries} onSelect={chosen => selectModel(chosen, true)} /> :
            <p className="hint">Questo articolo non ha un modello di configurazione collegato. Sfoglia le gamme per scegliere un modello.</p>}
      </section> : null}
      {nodeId !== null ? <section className="config-card"><h3>Modelli in questa gamma</h3>
        {nodeError ? <p className="error">Impossibile caricare i modelli.</p> : nodeModels === null ? <p className="hint">Caricamento modelli…</p> :
          nodeModels.length ? <ModelList models={nodeModels} onSelect={chosen => selectModel(chosen)} /> :
            <p className="hint">Nessun modello associato a questo livello. Apri una sottogamma.</p>}
      </section> : null}
    </div>
    <div className="config-detail">
      {modelError ? <p className="error" role="alert">Impossibile leggere questo modello.</p> :
        modelId !== null && !model ? <p className="hint">Caricamento del modello…</p> :
        model ? <><header className="config-heading"><p className="eyebrow">{model.brandMarchio} · {modelKind(model.kind)} · {model.code}</p>
          <h2>{model.name}</h2>{!model.active || model.obsolete ? <span className="badge">Modello storico / non attivo</span> : null}</header>
          <ConfigurationControls model={model} result={result} busy={resolving} onChoice={(axisId, optionId) => {
            setAddError(null); session.choose(axisId, optionId);
          }} />
          {resolveError ? <p className="error" role="alert">Impossibile risolvere la configurazione. Modifica una scelta per riprovare.</p> :
            resolving || !result ? <p className="hint">Risoluzione in corso…</p> : <>
              <ConfigurationResultPanel result={result} />
              <ConfigurationAddAction projectOpen={projectOpen} result={result} adding={adding}
                error={addError} request={session.request()!}
                onAdd={onAdd} onAddingChange={setAdding} onErrorChange={setAddError} />
            </>}
        </> : <section className="config-card"><h2>Configura un modello</h2>
          <p className="hint">Apri una gamma e scegli un modello, oppure configura un articolo dalla ricerca nel catalogo.</p></section>}
    </div>
  </div>;
}
