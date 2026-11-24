import type { ReactElement } from "react";

/*
 * Stroke icons of the R-17 interface (docs/R17_VISUAL_DESIGN.md §3.6): original paths on a
 * 24-unit grid, drawn in currentColor. Only the glyphs the renderer uses are defined here;
 * later R-17 slices add theirs.
 */
const PATHS = {
  /** Catalogo */
  book: <><path d="M4.5 4.5h10.5a3 3 0 0 1 3 3v13H7.5a3 3 0 0 1-3-3z" /><path d="M4.5 17.5a3 3 0 0 1 3-3H18" /></>,
  /** Progettazione */
  design: <><rect x="4.5" y="3" width="15" height="18" rx="1" /><path d="M4.5 8.5h15M4.5 14.5h15M8 11.5h3M8 17.5h5" /></>,
  /** Preventivo: a priced list */
  receipt: <><path d="M6 3h12v18l-2.4-1.5L13.2 21 12 20.2 10.8 21l-2.4-1.5L6 21z" /><path d="M9 8h6M9 11.5h6M9 15h3.5" /></>,
  /** Distinta */
  table: <><rect x="3.5" y="4.5" width="17" height="15" rx="1" /><path d="M3.5 9.5h17M3.5 14.5h17M9 9.5v10" /></>,
  /** Filtra */
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  /** Nuovo progetto */
  folderPlus: <><path d="M3.5 18V6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z" /><path d="M12 11v5M9.5 13.5h5" /></>,
  /** Apri */
  folderOpen: <><path d="M3.5 18.5V6a1 1 0 0 1 1-1h4.2l2 2.5h7.3a1 1 0 0 1 1 1V10" /><path d="M3.5 18.5L6 11h15.5l-2.5 7.5z" /></>,
  file: <><path d="M6 2.8h8l4.5 4.5v13.9H6z" /><path d="M14 2.8v4.5h4.5" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  x: <path d="M7 7l10 10M17 7L7 17" />,
  /** Adatta vista */
  fit: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  /** Esporta PDF */
  download: <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />,
  refresh: <><path d="M19.5 12A7.5 7.5 0 1 1 12 4.5" /><path d="M9.5 2l2.5 2.5L9.5 7" /></>,
  /** Etichette */
  tag: <><path d="M3.5 12.5v-8h8l9 9-8 8z" /><circle cx="8" cy="9" r="1.2" /></>,
  alert: <><path d="M12 3.8l8.8 15.7H3.2z" /><path d="M12 10v4.2M12 17.2v.1" /></>,
  /** Rimuovi posizione / Rimuovi carpenteria */
  trash: <><path d="M4.5 6.5h15M9.5 6.5V4h5v2.5" /><path d="M6.5 6.5l1 14h9l1-14M10.5 10.5v6.5M13.5 10.5v6.5" /></>,
  /** Struttura */
  layers: <><path d="M12 4l8.5 4.5L12 13 3.5 8.5z" /><path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5" /></>,
  /** Albero fisico */
  outliner: <path d="M4.5 5.5h7M8.5 11.5h11M8.5 17.5h11M6.5 5.5v12h2M6.5 11.5h2" />,
  /** Da posizionare */
  package: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>,
  /** Proprietà */
  properties: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  /** Carpenteria */
  box: <><rect x="4.5" y="3" width="15" height="18" rx="1" /><rect x="7.5" y="6" width="9" height="12" /></>,
  /** Pannello */
  panel: <><rect x="3.5" y="7" width="17" height="10" rx="1" /><path d="M3.5 12h17" /></>,
  /** Apparecchio */
  device: <><rect x="7.5" y="3.5" width="9" height="17" rx="1" /><path d="M12 8v4.5" /></>,
  /** Overall dimensions */
  dimension: <><path d="M4 7.5v9M20 7.5v9M4 12h16M7.5 9.5L4 12l3.5 2.5M16.5 9.5L20 12l-3.5 2.5" /></>,
  /** Duplica */
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="1.5" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></>,
  /** Apri altrove (nella scheda del Catalogo) */
  open: <><path d="M13.5 4.5h6v6M19.5 4.5l-8 8" /><path d="M17.5 13.5v5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1h5" /></>,
  /** Free-text note */
  text: <path d="M5 6.5V5h14v1.5M12 5v14M9 19h6" />,
  /** Annulla */
  undo: <><path d="M9 14.5L4.5 10 9 5.5" /><path d="M4.5 10h10a5 5 0 0 1 0 10H11" /></>,
  /** Ripeti */
  redo: <><path d="M15 14.5l4.5-4.5L15 5.5" /><path d="M19.5 10h-10a5 5 0 0 0 0 10H13" /></>,
  /** Falsi poli DIN: a rail with blank modules closing the gaps */
  fill: <><path d="M3.5 7.5h17M3.5 16.5h17" /><rect x="5" y="9.5" width="4" height="5" /><path d="M11 9.5h3.5v5H11zM16.5 9.5H19v5h-2.5zM11 12l3.5-2.5M11 14.5l3.5-2.5M16.5 12l2.5-2" /></>,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { readonly name: IconName; readonly className?: string }) {
  return <svg className={className ? `librequadri-icon ${className}` : "librequadri-icon"} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false">{PATHS[name]}</svg>;
}
