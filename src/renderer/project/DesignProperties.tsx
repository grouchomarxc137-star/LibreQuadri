import { useEffect, useRef, type ReactNode } from "react";
import type { ProjectRootRemoval } from "../../shared/project.js";
import { Icon, type IconName } from "../ui/icons.js";
import { useDialogFocus } from "../ui/dialog-focus.js";
import { articleCode, countText, nodeStartText, occupancyText, positionText, viewSizeText } from "./design-presentation.js";
import { unplaceBlockReason, type SelectableKind, type SelectedObject } from "./design-selection.js";
import type { PoolEntry } from "./placement-workflow.js";
import { previewView, SubjectPreview, type FrontAssets } from "./FrontShape.js";

const KIND: Readonly<Record<SelectableKind, { label: string; icon: IconName }>> = {
  enclosure: { label: "Carpenteria", icon: "box" },
  support: { label: "Pannello", icon: "panel" },
  device: { label: "Apparecchio", icon: "device" },
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd title={typeof children === "string" ? children : undefined}>{children}</dd></div>;
}

/** "Carpenteria" and "Pannello" rows name a container by its model; the node is not otherwise identifiable. */
function containerName(item: SelectedObject["item"]): string { return item?.modelName ?? "Non disponibile"; }

/**
 * "Proprietà" (docs/R17_VISUAL_DESIGN.md §4.3, §4.5): the persistently selected Carpenteria,
 * Pannello or Apparecchio, read only from the loaded project view (configured-item snapshot and
 * physical node). Its footer holds the physical actions: "Rimuovi posizione" returns a Pannello
 * or Apparecchio to the pool, keeping its configured item; a Carpenteria is removed as a whole
 * after an explicit choice about its contents.
 */
export function DesignProperties({ selection, poolSelection, assets, busy, onUnplace, onRemoveRoot, onReconfigure,
  canDuplicate = false, onDuplicate }: {
  poolSelection?: PoolEntry | null;
  selection: SelectedObject | null; assets: FrontAssets; busy: boolean;
  onUnplace: (selection: SelectedObject) => void; onRemoveRoot: (selection: SelectedObject) => void;
  onReconfigure?: (selection: SelectedObject) => void;
  canDuplicate?: boolean; onDuplicate?: () => void;
}) {
  return <section className="dock-panel design-properties" aria-labelledby="design-properties-title">
    <header className="dock-header"><h3 id="design-properties-title">Proprietà</h3></header>
    {poolSelection ? <PoolProperties entry={poolSelection} assets={assets}/> : selection ? <SelectionProperties selection={selection} assets={assets} busy={busy} onUnplace={onUnplace}
      onRemoveRoot={onRemoveRoot} onReconfigure={onReconfigure} canDuplicate={canDuplicate} onDuplicate={onDuplicate}/>
      : <div className="dock-body"><p className="dock-hint">Nessun oggetto selezionato. Seleziona una carpenteria, un pannello
        o un apparecchio in Da posizionare, nel Fronte Quadro o nell'Albero fisico.</p></div>}
  </section>;
}

function ItemIdentity({ item, kind, view, assets }: Pick<SelectedObject, "item" | "kind" | "view"> & { assets: FrontAssets }) {
  const code = item ? articleCode(item) : "Codice non disponibile";
  return <div className="properties-identity">
    <span className="properties-thumb"><SubjectPreview view={view} assets={assets} label={`Anteprima ${item?.modelName ?? KIND[kind].label}`}/></span>
    <div className="properties-names">
      <span className="properties-kind"><Icon name={KIND[kind].icon} className="librequadri-icon-small"/>{KIND[kind].label}</span>
      <strong title={item?.modelName}>{item?.modelName ?? KIND[kind].label}</strong>
      <span className="code" title={item ? `${item.modelBrandMarchio} · ${code}` : undefined}>
        {item ? `${item.modelBrandMarchio} · ${code}` : code}</span>
    </div>
  </div>;
}

function ItemConfiguration({ item }: Pick<SelectedObject, "item">) {
  const choices = item?.selections.filter(choice => choice.visible) ?? [];
  return <>
    {item?.configStatus === "bom_incomplete" ? <p className="properties-issue">Fuori catalogo — articoli METEL mancanti. Prezzo e totale non disponibili.</p> : null}
    <h4 className="properties-section">Configurazione</h4>
    <dl className="properties-grid">
      {item ? <Row label="Modello">{`${item.modelBrandMarchio} / ${item.modelCode}`}</Row> : null}
      {choices.map(choice => <Row key={choice.dimensionCode} label={choice.dimensionLabel}>{choice.valueLabel}</Row>)}
      {item && choices.length === 0 ? <Row label="Scelte">Nessuna scelta visibile</Row> : null}
    </dl>
  </>;
}

/** A list entry describes a configured article, independent of any placed physical instance. */
function PoolProperties({ entry, assets }: { entry: PoolEntry; assets: FrontAssets }) {
  const { item, quantity, placed, available } = entry;
  const kind = item.modelKind === "support" ? "support" : "device";
  const view = previewView(item);
  const size = viewSizeText(view);
  const occupancy = kind === "device" ? occupancyText(item) : null;
  return <div className="dock-body properties-body" data-kind={kind}>
    <ItemIdentity item={item} kind={kind} view={view} assets={assets}/>
    <p className="properties-tags">
      <span className="properties-tag" data-tone="project">Posizionati {placed} di {quantity}</span>
      <span className="properties-tag">Da posizionare {available}</span>
      {occupancy ? <span className="properties-tag">{occupancy}</span> : null}
    </p>
    {size ? <dl className="properties-grid"><Row label="Ingombro">{size}</Row></dl> : null}
    {item.physStatus !== "resolved" ? <p className="properties-issue">Profilo fisico non disponibile</p> : null}
    <ItemConfiguration item={item}/>
  </div>;
}

function SelectionProperties({ selection, assets, busy, onUnplace, onRemoveRoot, onReconfigure, canDuplicate, onDuplicate }: {
  selection: SelectedObject; assets: FrontAssets; busy: boolean;
  onUnplace: (selection: SelectedObject) => void; onRemoveRoot: (selection: SelectedObject) => void;
  onReconfigure?: (selection: SelectedObject) => void;
  canDuplicate: boolean; onDuplicate?: () => void;
}) {
  const { kind, node, item, view } = selection;
  const occupancy = kind === "device" && item ? occupancyText(item) : null;
  const start = nodeStartText(node, selection.parentItem);
  const position = positionText(node);
  const size = viewSizeText(view);
  const blocked = unplaceBlockReason(selection);
  const withContents = kind === "support" && selection.devices > 0;
  return <>
    <div className="dock-body properties-body" data-kind={kind}>
      <ItemIdentity item={item} kind={kind} view={view} assets={assets}/>
      <p className="properties-tags">
        <span className="properties-tag" data-tone="project">Posizionati {selection.placed} di {selection.quantity}</span>
        {occupancy ? <span className="properties-tag">{occupancy}</span> : null}
      </p>
      <h4 className="properties-section">Posizione</h4>
      <dl className="properties-grid">
        {kind === "device" ? <Row label="Pannello">{containerName(selection.parentItem)}</Row> : null}
        {kind !== "enclosure" ? <Row label="Carpenteria">{containerName(selection.rootItem)}</Row> : null}
        {kind !== "enclosure" && node.zoneNo !== null ? <Row label="Zona">{String(node.zoneNo)}</Row> : null}
        {start ? <Row label="Inizio">{start}</Row> : null}
        <Row label="X · Y">{position ?? "Non determinabile"}</Row>
        {size ? <Row label="Ingombro">{size}</Row> : null}
        {kind === "enclosure" ? <Row label="Contenuto">{`${countText(selection.supports, "pannello", "pannelli")} · ${
          countText(selection.devices, "apparecchio", "apparecchi")}`}</Row> : null}
        {kind === "support" ? <Row label="Contenuto">{countText(selection.devices, "apparecchio", "apparecchi")}</Row> : null}
      </dl>
      {node.positionIssue ? <p className="properties-issue" role="note"><Icon name="alert" className="librequadri-icon-small"/>{node.positionIssue}</p> : null}
      <ItemConfiguration item={item}/>
    </div>
    <footer className="dock-footer properties-footer">
      {kind === "enclosure" && onReconfigure ? <button type="button" disabled={busy || !item}
        onClick={() => onReconfigure(selection)}>Modifica carpenteria</button> : null}
      {kind === "enclosure"
        ? <button type="button" disabled={busy} onClick={() => onRemoveRoot(selection)}
          title="Rimuove la carpenteria dal progetto: scegli poi cosa fare del contenuto">
          <Icon name="trash" className="librequadri-icon-small"/>Rimuovi carpenteria…</button>
        : <div className="properties-placement-actions">
          <button type="button" disabled={busy || blocked !== null} onClick={() => onUnplace(selection)}
            title={withContents ? `Il pannello e i suoi ${countText(selection.devices, "apparecchio", "apparecchi")} tornano tra gli elementi da posizionare; restano nel progetto`
              : "Torna tra gli elementi da posizionare; l'articolo resta nel progetto"}>
            <Icon name="trash" className="librequadri-icon-small"/>Rimuovi posizione</button>
          <button type="button" disabled={busy || !canDuplicate || !onDuplicate} onClick={onDuplicate}
            title="Copia nella prossima posizione compatibile e aggiungi alla Distinta">
            <Icon name="copy" className="librequadri-icon-small"/>Duplica</button>
        </div>}
      <p className="properties-hint">{kind === "enclosure" ? <>Anche con <kbd>Canc</kbd>. Chiede cosa fare del contenuto.</>
        : withContents ? <>Anche {selection.devices === 1 ? "l'apparecchio" : `i ${selection.devices} apparecchi`} del pannello
          {selection.devices === 1 ? " torna" : " tornano"} tra gli elementi da posizionare. <kbd>Canc</kbd> fa lo stesso.</>
        : <>Trascina nel disegno per spostare. <kbd>Canc</kbd> rimuove la posizione.</>}</p>
    </footer>
  </>;
}

/**
 * What a key does while the Carpenteria-removal dialog is open. Esc cancels. Enter confirms only the
 * unambiguous empty-Carpenteria removal, and only when no button has the focus (a focused button
 * keeps its own Enter, so Annulla still cancels); with contents there are two different destructive
 * choices, so Enter never picks one. A held-down Enter (auto-repeat) is swallowed, so the key that
 * opened the dialog can never also confirm it.
 */
export type RemoveRootKeyAction = "cancel" | "confirm" | "ignore-repeat" | null;
export function removeRootDialogKey(event: { key: string; repeat?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean;
  shiftKey?: boolean }, state: { empty: boolean; busy: boolean; onButton: boolean }): RemoveRootKeyAction {
  if (event.key === "Escape") return state.busy ? null : "cancel";
  if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  if (event.repeat) return "ignore-repeat";
  return state.empty && !state.busy && !state.onButton ? "confirm" : null;
}

/**
 * Confirmation before removing a whole Carpenteria. The backend removes it in one transaction;
 * the choice only says what happens to the Pannelli and Apparecchi placed in it. For an empty
 * Carpenteria the single "Rimuovi carpenteria" button is the default (initial focus, so Enter
 * confirms); with contents Annulla keeps the initial focus and Enter picks nothing. Esc and
 * Annulla change nothing.
 */
export function RemoveCarpenteriaDialog({ name, supports, devices, busy, error, onChoose, onCancel }: {
  name: string; supports: number; devices: number; busy: boolean; error: string | null;
  onChoose: (contents: ProjectRootRemoval) => void; onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const empty = supports + devices === 0;
  useDialogFocus(dialog, empty ? confirm : cancel);
  // The keys are handled for as long as this dialog is open, wherever the focus is (a click on the dialog's text
  // leaves it on the page body): Esc anywhere, Enter only on the dialog or the bare page, never on another control.
  const latest = useRef({ empty, busy, onChoose, onCancel });
  latest.current = { empty, busy, onChoose, onCancel };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const { empty: isEmpty, busy: isBusy, onChoose: choose, onCancel: close } = latest.current;
      const target = event.target as Node | null;
      const bare = target === document.body || target === document.documentElement || target === document;
      const inside = target !== null && dialog.current?.contains(target) === true;
      if (event.key === "Enter" && !bare && !inside) return;
      const action = removeRootDialogKey(event, { empty: isEmpty, busy: isBusy,
        onButton: target instanceof Element && target.closest("button") !== null });
      if (action === null) return;
      event.preventDefault();
      if (action === "ignore-repeat") return;
      event.stopPropagation();
      if (action === "cancel") close(); else choose("keep-contents");
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, []);
  const contents = `${countText(supports, "pannello", "pannelli")} e ${countText(devices, "apparecchio", "apparecchi")}`;
  return <div className="modal-backdrop" role="presentation">
    <section ref={dialog} className="shell-dialog remove-root-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-root-title"
      aria-describedby="remove-root-description" tabIndex={-1}>
      <header><h2 id="remove-root-title">Rimuovi carpenteria</h2></header>
      <div className="shell-dialog-body">
        <p id="remove-root-description">{empty ? <>La carpenteria <strong>{name}</strong> è vuota e sarà rimossa dal progetto.</>
          : <>La carpenteria <strong>{name}</strong> contiene {contents}. Scegli cosa fare del contenuto.</>}</p>
        <div className="remove-root-choices">
          <button type="button" ref={confirm} className="remove-root-choice" disabled={busy} onClick={() => onChoose("keep-contents")}>
            <strong>{empty ? "Rimuovi carpenteria" : "Rimuovi la carpenteria, conserva il contenuto"}</strong>
            {empty ? null : <span>Pannelli e apparecchi restano nel progetto e tornano tra gli elementi da posizionare.</span>}
          </button>
          {empty ? null : <button type="button" className="remove-root-choice" data-tone="danger" disabled={busy}
            onClick={() => onChoose("remove-contents")}>
            <strong>Rimuovi la carpenteria e il suo contenuto</strong>
            <span>Solo {contents} posizionati in questa carpenteria sono tolti dal progetto e dal preventivo (le
              quantità scendono di altrettanto). Le altre unità degli stessi articoli, posizionate altrove o ancora da
              posizionare, restano.</span>
          </button>}
        </div>
        <p className="remove-root-note">In ogni caso la carpenteria esce dal preventivo. Salva il progetto per conservare le modifiche.</p>
        {error ? <p className="error" role="alert">{error}</p> : null}
      </div>
      <footer><button type="button" ref={cancel} disabled={busy} onClick={onCancel}>Annulla</button></footer>
    </section>
  </div>;
}
