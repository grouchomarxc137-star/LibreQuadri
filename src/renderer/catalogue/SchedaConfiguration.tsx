import { isOutOfCatalogue } from "../../shared/out-of-catalogue.js";
import { useId, type ReactNode } from "react";
import type { ConfigModelDetail, ConfigurationResult, PhysicalResult } from "../../shared/configuration.js";
import type { ModelConfigurationState } from "../configuration/model-configuration.js";
import { demandText, issueText, selectableOptions } from "../configuration/presentation.js";
import { SchedaGrid, SchedaNotice, SchedaSection, SchedaTag, type SchedaRow } from "./Scheda.js";

/*
 * Configuration inside Scheda articolo: choices (label left, select right), completeness and
 * issues, the resolved articles without prices, and the physical facts of the resolution. It
 * reads only the shared model/resolve session; the standalone Configura screen and the
 * Progettazione structural workflow keep their own presentation.
 */

const decimal = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 4 });
const PRICE_ISSUES = new Set(["missing_price", "inexact_price", "unsupported_currency", "mixed_currency"]);
const DIN_KINDS = new Set(["din_rail", "din"]);

export function configurationStatus(result: ConfigurationResult): { tone: "ok" | "warn" | "error"; text: string } {
  if(isOutOfCatalogue(result))return {tone:"warn",text:"Fuori catalogo — articoli METEL mancanti; conferma richiesta per aggiungere"};
  switch (result.status) {
    case "complete": return { tone: "ok", text: "Configurazione completa" };
    case "incomplete": return { tone: "warn", text: "Completa le scelte obbligatorie" };
    case "invalid": case "budget_exceeded": return { tone: "error", text: "Configurazione da correggere" };
    default: return { tone: "warn", text: "Configurazione con dati mancanti" };
  }
}

/** Price issues explain a blocked Add; once the configuration is complete they are noise in Catalogo (R-02). */
export function visibleIssues(result: ConfigurationResult) {
  const seen = new Set<string>();
  return result.issues.filter(issue => result.status !== "complete" || !PRICE_ISSUES.has(issue.code))
    .map(issue => ({ issue, text: issueText(issue, result) }))
    .filter(({ text }) => { if (seen.has(text)) return false; seen.add(text); return true; });
}

/** "3 moduli DIN" for DIN rail demand (matching Righe del progetto), otherwise the capacity's own unit. */
export function demandShortText(demand: PhysicalResult["demands"][number]): string {
  const value = decimal.format(demand.amount / demand.displayDivisor);
  return DIN_KINDS.has(demand.capacityKindCode) ? `${value} moduli DIN` : `${value} ${demand.unitLabel}`;
}

function viewLabel(code: string): string {
  if (code === "front") return "Ingombro fronte";
  const alternative = /^front_alt(\d+)$/.exec(code);
  return alternative ? `Ingombro fronte alt. ${alternative[1]}` : `Ingombro ${code}`;
}

export function physicalRows(physical: PhysicalResult): SchedaRow[] {
  const rows: SchedaRow[] = physical.demands.filter(demand => demand.amount > 0 && demand.displayDivisor > 0)
    .map(demand => ["Occupazione", demandShortText(demand), demandText(demand)] as const);
  for (const view of physical.views) if (view.widthMm > 0 && view.heightMm > 0)
    rows.push([viewLabel(view.code), `${decimal.format(view.widthMm)} × ${decimal.format(view.heightMm)} mm`]);
  for (const [label, value] of [["Profondità", physical.depthMm], ["Profondità esterna", physical.outerDepthMm],
    ["Profondità utile", physical.usableDepthMm]] as const)
    if (value !== null) rows.push([label, `${decimal.format(value)} mm`]);
  return rows;
}

export function ConfigurationAxes({ model, result, busy, onChoice }: {
  model: ConfigModelDetail; result: ConfigurationResult | null; busy: boolean;
  onChoice: (axisId: number, optionId: number | null) => void;
}) {
  const prefix = useId();
  const selected = result?.selectedOptionIds ?? [];
  const visibleAxes = model.axes.filter(axis => axis.visibility === "visible");
  if (!visibleAxes.length) return <p className="scheda-hint">Questo modello non richiede scelte visibili.</p>;
  return <>{visibleAxes.map(axis => {
    const choices = selectableOptions(axis.options, selected);
    const current = axis.options.find(option => selected.includes(option.id) && option.visible && option.active);
    const value = current && choices.includes(current) ? current : null;
    const id = `${prefix}-axis-${axis.id}`;
    return <div className="scheda-field" key={axis.id}>
      <label htmlFor={id} title={axis.label}><span>{axis.label}</span>
        <small>{axis.requirement === "required" ? "Obbligatorio" : "Facoltativo"}</small></label>
      <select id={id} value={value?.id ?? ""} title={value?.label} disabled={busy || !result || choices.length === 0}
        onChange={event => onChoice(axis.id, event.target.value ? Number(event.target.value) : null)}>
        <option value="">{busy || !result ? "Risoluzione in corso…" :
          choices.length ? "Scegli…" : "Scegli prima un'altra caratteristica"}</option>
        {choices.map(option => <option key={option.id} value={option.id}>{option.label}{option.isDefault ? " (predefinito)" : ""}</option>)}
      </select>
    </div>;
  })}</>;
}

export function ConfigurationState({ state, notice }: { state: ModelConfigurationState; notice?: ReactNode }) {
  const { result } = state;
  const status = result ? configurationStatus(result) : null;
  const issues = result ? visibleIssues(result) : [];
  return <div className="catalogue-config-status" aria-live="polite">
    {notice}
    {state.resolveError ? <SchedaNotice tone="error">Impossibile risolvere la configurazione. Modifica una scelta per riprovare.</SchedaNotice>
      : !result || state.resolving ? <p className="scheda-hint">Risoluzione in corso…</p>
      : <SchedaNotice tone={status!.tone}>{status!.text}</SchedaNotice>}
    {!state.resolving && issues.length ? <ul className="scheda-issues">{issues.map(({ issue, text }, index) =>
      <li key={`${issue.code}-${index}`} data-tone={issue.severity === "error" ? "error" : "warn"}>{text}</li>)}</ul> : null}
  </div>;
}

const PENDING = <p className="scheda-hint">Risoluzione in corso…</p>;

/** Always mounted once the model is loaded, so a collapsed section stays collapsed across resolutions. */
export function ResolvedArticles({ bom, title = "Distinta articoli" }: { bom: ConfigurationResult["bom"] | null; title?: string }) {
  return <SchedaSection title={title} count={bom?.length ?? null}>
    {bom === null ? PENDING : bom.length ? <table className="scheda-bom">
      <thead><tr><th scope="col">Codice</th><th scope="col">Descrizione</th><th scope="col" className="numeric">Q.tà</th></tr></thead>
      <tbody>{bom.map((row, index) => {
        const code = `${row.linkedBrandMarchio ?? row.brandMarchio} · ${row.linkedManufacturerCode ?? row.manufacturerCode}`;
        const description = row.description ?? "Descrizione non disponibile";
        return <tr key={`${row.brandMarchio}/${row.manufacturerCode}/${index}`}>
          <td className="scheda-bom-code" title={code}>{code}</td>
          <td className="scheda-bom-description" title={description}><span>{description}</span>
            {row.productId === null ? <SchedaTag>Non a catalogo</SchedaTag> : null}
            {row.roles.includes("accessory") ? <SchedaTag>Accessorio</SchedaTag> : null}</td>
          <td className="numeric">{decimal.format(row.quantity)}</td>
        </tr>;
      })}</tbody>
    </table> : <p className="scheda-hint">Nessun articolo risolto per le scelte attuali.</p>}
  </SchedaSection>;
}

export function PhysicalFacts({ physical, pending = false }: { physical: PhysicalResult | null; pending?: boolean }) {
  const rows = physical ? physicalRows(physical) : [];
  return <SchedaSection title="Dati fisici">
    {pending ? PENDING : !physical ? <p className="scheda-hint">Profilo fisico non disponibile.</p>
      : rows.length ? <SchedaGrid rows={rows} /> : <p className="scheda-hint">Nessun dato dimensionale nel profilo.</p>}
  </SchedaSection>;
}

/** Configurazione (choices, limits, status), Distinta articoli and Dati fisici for the current resolution. */
export function ConfigurationSections({ state, busy, onChoice, leading, notice, bomTitle }: {
  state: ModelConfigurationState; busy: boolean; onChoice: (axisId: number, optionId: number | null) => void;
  leading?: ReactNode; notice?: ReactNode; bomTitle?: string;
}) {
  const { model, result } = state;
  if (!model) return null;
  const settled = result && !state.resolving ? result : null;
  const budgets = result ? model.budgets.flatMap(definition => {
    const usage = result.budgets.find(budget => budget.code === definition.code);
    return usage ? [[definition.label, `${usage.used} / ${usage.maxAmount}`] as const] : [];
  }) : [];
  return <>
    <SchedaSection title="Configurazione">
      <div className="scheda-fields">
        {leading}
        <ConfigurationAxes model={model} result={result} busy={busy || state.resolving} onChoice={onChoice} />
      </div>
      {budgets.length ? <SchedaGrid rows={budgets} /> : null}
      <ConfigurationState state={state} notice={notice} />
    </SchedaSection>
    <ResolvedArticles title={bomTitle} bom={settled?.bom ?? (state.resolveError ? [] : null)} />
    <PhysicalFacts physical={settled?.physical ?? null} pending={!settled && !state.resolveError} />
  </>;
}
