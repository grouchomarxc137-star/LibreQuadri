import { useEffect, useRef, useState } from "react";
import type { ProjectConfiguredItem, ProjectDocumentView, ProjectQuotationLine } from "../../shared/project.js";
import { articleCode } from "../project/design-presentation.js";
import { placedCounts } from "../quotation/PreventivoWorkspace.js";
import { SchedaSection, SchedaTag } from "./Scheda.js";

export function quantityError(value: string, placed: number): string | null {
  const quantity = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(quantity) || quantity > 9_999)
    return "Inserisci una quantità intera da 1 a 9.999.";
  if (quantity < placed) return `La quantità non può essere inferiore alle ${placed} unità posizionate.`;
  return null;
}

function QuantityField({ line, name, placed, busy, onChange }: {
  line: ProjectQuotationLine; name: string; placed: number; busy: boolean;
  onChange: (line: ProjectQuotationLine, quantity: number) => Promise<void>;
}) {
  const [text, setText] = useState(String(line.quantity));
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  useEffect(() => { setText(String(line.quantity)); setError(null); }, [line.uuid, line.quantity]);
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    const reason = quantityError(text, placed);
    if (reason) { setError(reason); return; }
    setError(null);
    if (Number(text) !== line.quantity) void onChange(line, Number(text)).catch(caught => {
      // The project still holds the previous quantity: show that, not the rejected text.
      setText(String(line.quantity));
      setError(caught instanceof Error ? caught.message : String(caught));
    });
  };
  return <>
    <span className="project-component-quantity">
    <input aria-label={`Quantità ${name}`} type="number" min={Math.max(1, placed)} max={9999}
      step={1} value={text} disabled={busy} aria-invalid={!!error}
      onChange={event => { setText(event.target.value); setError(null); }} onBlur={commit}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === "Escape") { event.preventDefault(); setText(String(line.quantity)); setError(null);
          cancelled.current = true; event.currentTarget.blur(); cancelled.current = false; } }} />
    </span>
    {error ? <small className="project-component-error error" role="alert">{error}</small> : null}
  </>;
}

/**
 * Componenti del progetto (Catalogo, bottom right): every project line, placed or not. Opening a row shows
 * it in the Scheda above; the checkboxes are a separate selection used for Seleziona tutti and bulk removal.
 * Placed lines are never removable here: the backend refuses them and removal would break placement.
 */
export function ProjectComponents({ project, activeUuid, checked, busy, onActive, onChecked, onQuantity,
  onRemove }: {
  project: ProjectDocumentView; activeUuid: string | null; checked: ReadonlySet<string>; busy: boolean;
  onActive: (uuid: string) => void; onChecked: (checked: ReadonlySet<string>) => void;
  onQuantity: (line: ProjectQuotationLine, quantity: number) => Promise<void>;
  onRemove: (lineUuids: readonly string[]) => void;
}) {
  const items = new Map(project.configuredItems.map(item => [item.uuid, item]));
  const placed = placedCounts(project.physicalNodes);
  const placedOf = (line: ProjectQuotationLine) => line.itemUuid ? placed.get(line.itemUuid) ?? 0 : 0;
  const all = project.lines.length > 0 && project.lines.every(line => checked.has(line.uuid));
  const removable = project.lines.filter(line => checked.has(line.uuid) && placedOf(line) === 0);
  const blocked = project.lines.filter(line => checked.has(line.uuid) && placedOf(line) > 0).length;
  return <section className="catalogue-pane project-components" aria-labelledby="project-components-title">
    <header><h2 id="project-components-title">Componenti del progetto</h2>
      <span className="project-components-count">{project.lines.length}</span></header>
    <div className="project-components-toolbar">
      <label className="project-components-all"><input type="checkbox" checked={all} disabled={!project.lines.length}
        onChange={event => onChecked(event.target.checked ? new Set(project.lines.map(line => line.uuid)) : new Set())} />
        Seleziona tutti</label>
      {checked.size ? <button type="button" className="danger" disabled={busy || removable.length === 0}
        title={removable.length === 0 ? "Le righe posizionate si rimuovono dopo aver tolto la posizione in Progettazione" : undefined}
        onClick={() => onRemove(removable.map(line => line.uuid))}>Rimuovi selezionati ({removable.length})</button> : null}
    </div>
    {blocked ? <p className="project-components-note">{blocked === 1 ? "1 riga posizionata non verrà rimossa" :
      `${blocked} righe posizionate non verranno rimosse`}: rimuovi prima la posizione in Progettazione.</p> : null}
    <div className="project-components-body">
      <ul className="project-components-list">{project.lines.map(line => {
        const item = line.itemUuid ? items.get(line.itemUuid) : undefined;
        const count = placedOf(line);
        const name = item?.modelName ?? line.description ?? line.manufacturerCode;
        const code = item ? articleCode(item) : line.manufacturerCode;
        return <li key={line.uuid} className="project-component-row" data-active={activeUuid === line.uuid}>
          <input type="checkbox" aria-label={`Seleziona ${name}`} checked={checked.has(line.uuid)}
            onChange={event => { const next = new Set(checked); if (event.target.checked) next.add(line.uuid);
              else next.delete(line.uuid); onChecked(next); }} />
          <button type="button" className="project-component-open" aria-current={activeUuid === line.uuid ? "true" : undefined}
            onClick={() => onActive(line.uuid)} title={`${name} · ${code}`}>
            <strong>{name}</strong><small className="code">{code}</small>
            {count ? <small>{count >= line.quantity ? "Posizionato" : `${count} di ${line.quantity} posizionati`}</small> : null}
          </button>
          <QuantityField line={line} name={name} placed={count} busy={busy} onChange={onQuantity} />
        </li>;
      })}</ul>
      {!project.lines.length ? <p className="scheda-hint">Nessun componente nel progetto.</p> : null}
    </div>
  </section>;
}

/**
 * The project snapshot of a configured item: its saved choices and its saved BOM (accessories included).
 * It reads only the stored item, never the catalogue, so it stays accurate when the model is gone or changed.
 * The current catalogue's resolution is a separate "Distinta proposta".
 */
export function SavedItemSnapshot({ item }: { item: ProjectConfiguredItem }) {
  const visible = item.selections.filter(choice => choice.visible);
  return <div className="saved-item-snapshot">
    <SchedaSection title="Configurazione salvata (progetto)" count={visible.length}>
      {visible.length ? <dl className="scheda-grid">{visible.map(choice => <div key={choice.dimensionCode}>
        <dt title={choice.dimensionLabel}>{choice.dimensionLabel}</dt>
        <dd title={choice.valueLabel}>{choice.valueLabel}</dd></div>)}</dl>
        : <p className="scheda-hint">Nessuna scelta visibile salvata.</p>}
    </SchedaSection>
    <SchedaSection title="Distinta/accessori salvati (progetto)" count={item.bom.length}>
      {item.bom.length ? <table className="scheda-bom">
        <thead><tr><th scope="col">Codice</th><th scope="col">Descrizione</th><th scope="col" className="numeric">Q.tà</th></tr></thead>
        <tbody>{item.bom.map(part => <tr key={part.seq}>
          <td className="scheda-bom-code" title={`${part.brandMarchio} · ${part.manufacturerCode}`}>{part.brandMarchio} · {part.manufacturerCode}</td>
          <td className="scheda-bom-description" title={part.description ?? undefined}><span>{part.description ?? "Descrizione non disponibile"}</span>
            {part.role === "accessory" ? <SchedaTag>Accessorio</SchedaTag> : null}</td>
          <td className="numeric">{part.quantityPerItem}</td>
        </tr>)}</tbody>
      </table> : <p className="scheda-hint">Nessun articolo salvato.</p>}
    </SchedaSection>
  </div>;
}
