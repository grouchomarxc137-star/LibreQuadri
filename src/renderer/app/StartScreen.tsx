import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";

import type { RecentProjectView } from "../../shared/app.js";
import type { CatalogueOverview } from "../../shared/catalogue.js";
import { Icon } from "../ui/icons.js";
import { formatLastOpened, shortcutLabel } from "./platform.js";
import { filterRecent, groupRecent, neighbourOf, selectedRecentIndex, visibleRecent, type RecentGroup } from "./recent-list.js";
import { StartCatalogue } from "./StartCatalogue.js";

export type RecentKeyAction =
  | { readonly type: "move"; readonly index: number }
  | { readonly type: "open" }
  | { readonly type: "forget" };

/** Keyboard behaviour of the recent list; null means the key is not handled. */
export function recentKeyAction(key: string, index: number, count: number): RecentKeyAction | null {
  if (count === 0) return null;
  const current = Math.min(Math.max(index, 0), count - 1);
  switch (key) {
    case "ArrowDown": return { type: "move", index: index < 0 ? 0 : Math.min(count - 1, current + 1) };
    case "ArrowUp": return { type: "move", index: index < 0 ? 0 : Math.max(0, current - 1) };
    case "Home": return { type: "move", index: 0 };
    case "End": return { type: "move", index: count - 1 };
    case "Enter": return index < 0 ? null : { type: "open" };
    case "Delete": case "Backspace": return index < 0 ? null : { type: "forget" };
    default: return null;
  }
}

export type RecentKeyOutcome =
  | { readonly type: "select"; readonly id: string }
  | { readonly type: "open"; readonly entry: RecentProjectView }
  | { readonly type: "forget"; readonly entry: RecentProjectView; readonly next: string | null };

/**
 * A key pressed in the recent table, resolved against the rows currently visible (filtered and
 * grouped): Enter and Delete act on the highlighted row, the arrows walk the visible rows.
 */
export function resolveRecentKey(visible: readonly RecentProjectView[], selectedId: string | null, key: string): RecentKeyOutcome | null {
  const index = selectedRecentIndex(visible, selectedId);
  const action = recentKeyAction(key, index, visible.length);
  if (!action) return null;
  if (action.type === "move") return { type: "select", id: visible[action.index]!.id };
  const entry = visible[index]!;
  return action.type === "open" ? { type: "open", entry } : { type: "forget", entry, next: neighbourOf(visible, entry.id) };
}

function RecentRow({ entry, selected, now, onSelect, onOpen }: {
  readonly entry: RecentProjectView;
  readonly selected: boolean;
  readonly now: Date;
  readonly onSelect: () => void;
  readonly onOpen: () => void;
}) {
  return <tr id={`recent-${entry.id}`} role="row" aria-selected={selected}
    className={entry.available ? undefined : "recent-missing"} onClick={onSelect} onDoubleClick={onOpen}>
    <td className="recent-title" title={entry.title}><Icon name="file" className="librequadri-icon-small" />{entry.title}</td>
    <td className="recent-file">
      <span className="recent-file-cell">
        <span className="recent-file-name" title={entry.documentName}>{entry.documentName}</span>
        {entry.available ? null : <span className="librequadri-tag" data-tone="warn">file non trovato</span>}
      </span>
    </td>
    <td className="recent-folder" title={entry.folderLabel}>{entry.folderLabel}</td>
    <td className="recent-date">{formatLastOpened(entry.lastOpenedAt, now)}</td>
  </tr>;
}

function RecentTable({ groups, selectedId, tableRef, busy, now, onSelect, onOpen, onKeyDown }: {
  readonly groups: readonly RecentGroup[];
  readonly selectedId: string | null;
  readonly tableRef: RefObject<HTMLTableElement | null>;
  readonly busy: boolean;
  readonly now: Date;
  readonly onSelect: (id: string) => void;
  readonly onOpen: (entry: RecentProjectView) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLTableElement>) => void;
}) {
  return <div className="recent-scroll">
    <table ref={tableRef} className="recent-table" role="grid" aria-label="Progetti recenti" tabIndex={0}
      aria-activedescendant={selectedId ? `recent-${selectedId}` : undefined} onKeyDown={onKeyDown}>
      <thead><tr>
        <th scope="col">Progetto</th><th scope="col">File</th><th scope="col">Cartella</th>
        <th scope="col" aria-sort="descending"><span className="recent-sorted">Aperto<Icon name="chevronDown" className="librequadri-icon-small" /></span></th>
      </tr></thead>
      {groups.map((group) => <tbody key={group.id} data-group={group.id}>
        <tr className="recent-group-row" role="row"><th scope="rowgroup" colSpan={4}>
          {group.label}<span className="recent-group-count">{group.entries.length}</span></th></tr>
        {group.entries.map((entry) => <RecentRow key={entry.id} entry={entry} selected={entry.id === selectedId} now={now}
          onSelect={() => onSelect(entry.id)} onOpen={() => { if (!busy) onOpen(entry); }} />)}
      </tbody>)}
    </table>
  </div>;
}

/**
 * Progetti recenti: a renderer-only filter over the entries the main process listed, date groups,
 * and the open / remove-from-list actions. Selection follows the row's id, so filtering never
 * moves it onto a different project unless the selected one is filtered out.
 */
export function RecentProjectsPanel({ recent, error, busy, onOpen, onForget, now, initialFilter = "", initialSelectedId = null }: {
  /** null while loading. */
  readonly recent: readonly RecentProjectView[] | null;
  readonly error: string | null;
  readonly busy: boolean;
  readonly onOpen: (entry: RecentProjectView) => void;
  readonly onForget: (entry: RecentProjectView) => void;
  readonly now?: Date;
  readonly initialFilter?: string;
  readonly initialSelectedId?: string | null;
}) {
  const [filter, setFilter] = useState(initialFilter);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const table = useRef<HTMLTableElement>(null);
  const entries = recent ?? [];
  const referenceTime = now ?? new Date();
  const groups = groupRecent(filterRecent(entries, filter), referenceTime);
  const visible = visibleRecent(groups);
  const index = selectedRecentIndex(visible, selectedId);
  const selected = visible[index];
  const activeId = selected?.id ?? null;
  const filtering = filter.trim() !== "";

  useEffect(() => {
    if (activeId) document.getElementById(`recent-${activeId}`)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const forget = (entry: RecentProjectView, next: string | null) => { setSelectedId(next); onForget(entry); };
  const keyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const outcome = resolveRecentKey(visible, activeId, event.key);
    if (!outcome) return;
    event.preventDefault();
    if (outcome.type === "select") setSelectedId(outcome.id);
    else if (!busy) (outcome.type === "open" ? onOpen(outcome.entry) : forget(outcome.entry, outcome.next));
  };
  const filterKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && visible.length > 0) { event.preventDefault(); table.current?.focus(); }
    else if (event.key === "Escape" && filter !== "") { event.preventDefault(); setFilter(""); }
  };

  return <section className="start-recent" aria-labelledby="recent-title">
    <header className="recent-toolbar">
      <h2 id="recent-title">Progetti recenti</h2>
      <span className="dock-count">{recent === null ? "" : filtering ? `${visible.length} di ${entries.length}` : entries.length}</span>
      <div className="recent-filter">
        <Icon name="search" className="librequadri-icon-small" />
        <input type="search" value={filter} disabled={recent === null} placeholder="Filtra per nome, file o cartella"
          aria-label="Filtra per nome, file o cartella" onChange={(event) => setFilter(event.target.value)} onKeyDown={filterKeyDown} />
        {filter === "" ? null : <button type="button" className="icon-button" aria-label="Cancella il filtro" title="Cancella il filtro"
          onClick={() => setFilter("")}><Icon name="x" className="librequadri-icon-small" /></button>}
      </div>
    </header>
    {error ? <p className="start-error" role="alert"><Icon name="alert" className="librequadri-icon-small" />{error}</p> : null}
    {recent === null ? <p className="recent-empty" aria-busy="true">Caricamento dei progetti recenti…</p>
      : entries.length === 0 ? <p className="recent-empty">Nessun progetto recente. I progetti che crei o apri compariranno qui.</p>
      : visible.length === 0 ? <p className="recent-empty">Nessun progetto corrisponde a «{filter.trim()}».</p>
      : <RecentTable groups={groups} selectedId={activeId} tableRef={table} busy={busy} now={referenceTime} onSelect={setSelectedId}
        onOpen={onOpen} onKeyDown={keyDown} />}
    <footer className="recent-footer">
      <button type="button" className="recent-open" disabled={!selected || busy} onClick={() => selected && onOpen(selected)}>Apri</button>
      <button type="button" disabled={!selected || busy}
        onClick={() => selected && forget(selected, neighbourOf(visible, selected.id))}>Rimuovi dall'elenco</button>
      {selected ? <span className="recent-summary" title={`${selected.documentName} · ${selected.folderLabel} · ${formatLastOpened(selected.lastOpenedAt, referenceTime)}`}>
        <b>{selected.documentName}</b><span className="recent-summary-folder">· {selected.folderLabel}</span>
        <span className="recent-summary-date">· {formatLastOpened(selected.lastOpenedAt, referenceTime)}</span></span> : null}
    </footer>
  </section>;
}

export function StartScreen({ recent, overview, busy, error, onNewProject, onOpenProject, onOpenRecent, onForgetRecent,
  onUpdateListino, onUnclassified, onManageBrands, now, topBar, statusBar }: {
  /** null while loading. */
  readonly recent: readonly RecentProjectView[] | null;
  /** null while loading or when the catalogue could not be read. */
  readonly overview: CatalogueOverview | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onNewProject: () => void;
  readonly onOpenProject: () => void;
  readonly onOpenRecent: (entry: RecentProjectView) => void;
  readonly onForgetRecent: (entry: RecentProjectView) => void;
  readonly onUpdateListino: () => void;
  readonly onUnclassified: () => void;
  readonly onManageBrands?: () => void;
  /** Reference time for the date groups; defaults to the current time. */
  readonly now?: Date;
  readonly topBar?: ReactNode;
  readonly statusBar: ReactNode;
}) {
  return <div className="app-frame start-screen">
    {topBar}
    <main className="start-main">
      <div className="start-band">
        <nav className="start-commands" aria-label="Progetto">
          <button type="button" className="primary" onClick={onNewProject} disabled={busy}>
            <Icon name="folderPlus" /><span>Nuovo progetto…</span><kbd>{shortcutLabel("N")}</kbd></button>
          <button type="button" onClick={onOpenProject} disabled={busy}>
            <Icon name="folderOpen" /><span>Apri…</span><kbd>{shortcutLabel("O")}</kbd></button>
        </nav>
      </div>
      <div className="start-body">
        <RecentProjectsPanel recent={recent} error={error} busy={busy} now={now} onOpen={onOpenRecent} onForget={onForgetRecent} />
        <StartCatalogue overview={overview} onUpdateListino={onUpdateListino} onUnclassified={onUnclassified} onManageBrands={onManageBrands} />
      </div>
    </main>
    {statusBar}
  </div>;
}
