import type {
  ConfigModelDetail, ConfigOption, ConfigurationIssue, ConfigurationRequest, ConfigurationResult, RangeNode,
} from "../../shared/configuration.js";

export function rangeChildren(nodes: readonly RangeNode[], parentId: number | null): RangeNode[] {
  const known = new Set(nodes.map(node => node.id));
  return nodes.filter(node => node.parentId === parentId ||
    (parentId === null && node.parentId !== null && !known.has(node.parentId)));
}

export function rangePath(nodes: readonly RangeNode[], nodeId: number | null): RangeNode[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const path: RangeNode[] = [];
  const seen = new Set<number>();
  let current = nodeId === null ? undefined : byId.get(nodeId);
  while (current && !seen.has(current.id)) {
    path.unshift(current);
    seen.add(current.id);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return path;
}

export function selectableOptions(options: readonly ConfigOption[], selected: readonly number[]): ConfigOption[] {
  const ids = new Set(selected);
  return options.filter(option => option.active && option.visible &&
    (option.parentOptionId === null || ids.has(option.parentOptionId)));
}

/** Keep explicit choices that still have a selected parent after a user edit.
 * The resolver decides defaults, availability, rules and the final configuration. */
export function changeChoice(model: ConfigModelDetail, explicit: readonly number[],
  selected: readonly number[], axisId: number, optionId: number | null): number[] {
  const options = model.axes.flatMap(axis => axis.options);
  const byId = new Map(options.map(option => [option.id, option]));
  const next = new Set(explicit.filter(id => byId.get(id)?.axisId !== axisId));
  if (optionId !== null) next.add(optionId);
  const previousSelected = new Set(selected);
  const oldOnAxis = model.axes.find(axis => axis.id === axisId)?.options.find(option => previousSelected.has(option.id));
  if (oldOnAxis && oldOnAxis.id !== optionId) {
    const descendants = new Set<number>([oldOnAxis.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const option of options) if (option.parentOptionId !== null && descendants.has(option.parentOptionId) && !descendants.has(option.id)) {
        descendants.add(option.id); changed = true;
      }
    }
    for (const id of descendants) next.delete(id);
  }
  return [...next];
}

export function configurationRequest(modelId: number, selectedOptionIds: readonly number[], productId?: number): ConfigurationRequest {
  return {modelId, selectedOptionIds: [...selectedOptionIds], ...(productId === undefined ? {} : {productId})};
}

const kindNames: Record<string, string> = {
  device: "Dispositivo", accessory: "Accessorio", support: "Supporto", enclosure: "Involucro",
};
export function modelKind(kind: string): string { return kindNames[kind] ?? kind; }

export function issueText(issue: ConfigurationIssue, result: ConfigurationResult): string {
  const axis = result.model.axes.find(item => item.id === issue.axisId);
  const option = result.model.axes.flatMap(item => item.options).find(item => item.id === issue.optionId);
  switch (issue.code) {
    case "missing_required": return `Scegli un valore per ${axis?.label ?? "un campo obbligatorio"}.`;
    case "ambiguous_default": return `Scegli un valore per ${axis?.label ?? "questa caratteristica"}: i dati di origine hanno più valori predefiniti.`;
    case "unavailable_option": return `${option?.label ?? "La scelta"} non è disponibile con le altre selezioni.`;
    case "multiple_on_axis": return `Scegli un solo valore per ${axis?.label ?? "questa caratteristica"}.`;
    case "inactive_model": return "Questo modello storico non è più attivo.";
    case "budget_exceeded": return "La configurazione supera un limite previsto dal modello.";
    case "unresolved_article": return "Un articolo della distinta non è collegato al catalogo.";
    case "missing_price": return "Manca un prezzo METEL corrente per un articolo.";
    case "inexact_price": return "Il prezzo di una quantità non può essere calcolato esattamente.";
    case "no_profile": return "Non è disponibile un profilo fisico per questa configurazione.";
    case "unresolved_binding": return "Questa caratteristica richiede il contesto di montaggio, non ancora disponibile.";
    case "bom_empty": return "La configurazione non produce articoli nella distinta.";
    case "ambiguous_profile": return "I dati fisici di questa configurazione sono in conflitto.";
    case "unsupported_currency": case "mixed_currency": return "La distinta contiene prezzi in valuta non supportata.";
    default: return "Verifica le selezioni e i dati di questa configurazione.";
  }
}

export function demandText(demand: {capacityKindCode: string; amount: number; unitLabel: string; displayDivisor: number}): string {
  const value = new Intl.NumberFormat("it-IT", {maximumFractionDigits: 2}).format(demand.amount / demand.displayDivisor);
  return demand.capacityKindCode === "din_rail"
    ? `${demand.amount} mezzi moduli da 9 mm = ${value} moduli DIN da 18 mm`
    : `${value} ${demand.unitLabel}`;
}
