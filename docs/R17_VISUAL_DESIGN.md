# R-17 — Visual Design Specification (approved Direction A.1)


> Update 2026-10-16: the Catalogo right column again has the Scheda articolo above "Componenti del progetto" (all project
> lines with checkboxes, Seleziona tutti and quantity editing), superseding the X5 move of the lines to Preventivo for
> this column; Preventivo still lists and edits the lines. Progettazione's §4.3 right column is unchanged.

Status: **product-owner approved, 2026-09-28.** This document is the implementation reference
for R-17. It is self-contained: the concept mockups that produced it were temporary and are
not part of the repository. Where this document and the old UI disagree, this document wins
for *appearance*; the existing behaviour, IPC, backend and `.lqp` format win for *function*.

Baseline inspected: main `c353b042833a98097ee273259edf4aec6692e50d` (after R-18).

**Amended 2026-10-02:** the radius and motion rules below are superseded by §0 (UI modernization).

---

## 0. Amendment: UI modernization (product-owner approved, 2026-10-02)

Baseline inspected: main `2b7364ce31562a3a5aaaef34495c2a922e4634a9`. The product owner asked for a more modern
look (rounder surfaces and controls, clearer hierarchy, restrained motion) without losing density or engineering
workflows. The decisions below **supersede the parts of this document named in the "Superseded" list**; everything
else in this document still applies, including the semantic colour rules, the Fronte Quadro drawing and hit-testing
constraints (§2), the screen structures (§4) and the non-goals (§6).

### 0.1 Locked decisions

| Id | Decision |
|---|---|
| **O1 = C, hybrid surfaces** | Side docks (Struttura, Albero fisico, Da posizionare, Proprietà, and the Catalogo and Distinta panels) stay **flush, edge to edge**. Only the working area (Fronte Quadro toolbar plus canvas) gets the inset treatment: an inset rounded card on the application background. The application is **not** converted into floating cards. |
| **O2 = C for trees and lists** | Selected tree nodes and list rows (Struttura, Albero fisico, Catalogo navigation, Da posizionare) use an inset 6 px rounded tint plus a short, rounded accent bar. **Tables keep the A treatment**: full-width tint plus the left accent bar (Catalogo results, Distinta, Progetti recenti, Righe del progetto). |
| **O3 = A, colour** | The orange interaction accent stays with neutral surfaces. The interaction accent does **not** change to the former company palette, and no warm beige chrome is introduced. Orange = identity/active/selected, green = valid, amber = warning, red = error is unchanged. |
| **O11 = text identity** | LibreQuadri text identifies the application in the top bar, loading screen and documents. |

### 0.2 Superseded

- §1 "square" and "flat surfaces": controls and floating elements are rounded as below; docked panels, tables and the canvas wrapper stay square.
- §3.3 radii ("panels, toolbars, tables, viewport = 0; buttons, inputs, selects, tags, steppers = 3 px (tags 2 px); popovers/dialogs = 4 px"), replaced by the scale in §0.3. §3.3 "Shadows only on popovers, menus, dialogs, floating canvas chips and the drag ghost" still holds; the two shadow levels are in §0.3.
- §3.4 control radii (3 px / 2 px) follow the §0.3 scale. Control heights, hierarchy and colours are unchanged.
- §3.5 "Hover: ... no motion": hover, focus, selection and overlays may use the restrained transitions in §0.4.
- §3.5 selected row/tree node (full-width tint plus 2-3 px bar) now applies to **tables only**; trees and lists follow O2 above.

### 0.3 Token scale (defined in `styles.css` `:root`)

- Radius: `--r-0: 0` (docked panels, tables, canvas wrapper, all drawn geometry), `--r-xs: 3px` (tags, kbd, checkbox), `--r-sm: 6px` (buttons, inputs, selects, steppers, icon buttons, inset rows), `--r-md: 8px` (popovers, tooltips, floating chip, notices), `--r-lg: 10px` (dialogs, splash card, inset working area), `--r-dot: 50%`. Nothing rounder than 10 px; no pills.
- Spacing: `--sp-2xs … --sp-2xl` = 2, 4, 6, 8, 12, 16, 24 px.
- Typography: `--fs-caption` 11, `--fs-small` 12, `--fs-dense` 12.5, `--fs-body` 13, `--fs-title` 15, `--fs-display` 24 px (11 px is the floor); `--fw-regular/medium/semibold` = 400/500/600; matching `--lh-*`. System font stack unchanged.
- Motion: `--dur-fast` 100 ms, `--dur-base` 150 ms, `--dur-slow` 200 ms, `--ease-out` `cubic-bezier(.2,0,0,1)`, `--ease-standard` `cubic-bezier(.4,0,.2,1)`.
- Shadow: `--shadow-1` `0 2px 8px rgb(20 30 45 / .10)` (popovers, tooltips, chip), `--shadow-2` `0 8px 24px rgb(20 30 45 / .16)` (dialogs).
- Controls: `--control-sm/md/lg/xl` = 24/28/32/36 px.

### 0.4 Motion rules

- Hover and press states apply immediately; only the return fades ("snap in, ease out"). No transition may delay or block an action.
- Transitions are limited to `background-color`, `color`, `border-color`, `box-shadow` and `opacity` on leaf controls; `transform` only on non-ancestors of the drawing (chevrons, `::after` indicators, the dialog). No layout-property animation.
- Dialogs, popovers and the guidance chip have enter-only animation (no exit animation, no deferred unmount).
- **Never** animated: the Fronte Quadro `<svg>` and its descendants, drag targets, the drag ghost, zoom and pan. Keyboard focus rings are instant.
- `prefers-reduced-motion: reduce` sets every `--dur-*` token to `0ms`.
- The §2 constraints on drawing ancestors (no transform, filter, contain, container, will-change, perspective, backdrop-filter) are unchanged.

### 0.5 Implementation slices

Slices S0-S8 follow the audit order: S0 this amendment and baseline; S1 tokens only; S2 base elements; S3 overlays and surfaces; S4 lists, trees and tables; S5 legacy-generation cleanup; S6 shell and Start (no logo changes); S7 Fronte Quadro chrome only; S8 typography collapse and acceptance. §8 below remains the historical R-17 slice list.

S0-S2 are done. The remaining S3-S8 order is replaced by the Quiet Workbench slices in §0.6.

### 0.6 Quiet Workbench (product-owner approved direction, 2026-10-02)

Target: a restrained, dense engineering workstation in which chrome recedes and the Fronte Quadro
dominates. Hierarchy comes from surface steps and typography rather than from a box around every
region. The exploration mockups are the visual reference; they are not part of the repository.

- **Surfaces.** Top bar and primary content are white. Docked navigation and inspection sidebars
  use a tint (`--librequadri-sidebar`). The Progettazione working bed (`--librequadri-bed`) carries the Fronte Quadro
  toolbar and canvas as one inset card (O1 = C). Hover and press use neutral washes
  (`--librequadri-hover-wash`, `--librequadri-press-wash`), so they read on both white and tinted surfaces.
- **Panel chrome.** Panel titles are quiet inline section titles: no filled header strip and no
  rule beneath them. Decorative header icons that add no information are removed. Separators
  inside a region are hairlines; one stronger line marks a region boundary.
- **Top bar.** Shortcut hints are not shown in the workspace tabs; each shortcut stays in the
  tab's tooltip and in the native menu. This supersedes the visible hints in §3.7.
- **Approved visual changes for later slices.** Active facets and "nel progetto" tags are tinted
  orange (supersedes "active filter is neutral" in §3.4). Segmented controls use a raised thumb.
- **Preventivo.** It will become its own workspace (Catalogo · Progettazione · Preventivo ·
  Distinta) in a later structural slice.
- **Money.** Current monetary precision and formatting are unchanged.
- **BTicino front-view drawings: hard constraint.** Enclosure, panel and device drawings,
  manufacturer vector artwork, proportions, coordinates, linework, dimensions, DIN representation,
  engineering labels, placement, selection, hit-testing and drag geometry are approved as they
  are. They are never redesigned, rounded, shadowed, decorated or animated. Only the workspace
  chrome around the drawing is modernised: the bed, the canvas container, the toolbar, the side
  panels and the status and guidance chrome.
- **Slices.** X1 surfaces and chrome; X2 lists, trees, tables and controls; X3 overlays and
  motion; X4 Catalogo structure; X5 Preventivo workspace; X6 Start and dialogs; X7 cleanup and
  acceptance.

---

## 1. Objective

LibreQuadri becomes a modern (2026) professional **engineering desktop application**:

- white/light, compact, square, information-dense;
- an engineering workstation (docked panels, persistent status, dominant drawing), not a
  SaaS dashboard, not a web page, not 2007-era gray CAD;
- flat surfaces, crisp 1 px separators, restrained shadows (only for real layering);
- one identity colour (industrial orange), used sparingly; everything else neutral;
- the Fronte Quadro is the visual centre of Progettazione.

R-17 is a **visual and renderer-interaction** milestone. It does not change the backend,
IPC contracts, placement semantics, catalogue rules or the `.lqp` format.

---

## 2. Current renderer facts that constrain the implementation

- `src/renderer/styles.css` has two layers: legacy names (`--background`, `--surface`,
  `--accent`, 8–12 px radii, 15 px root font, rem sizing) and the shell `--librequadri-*` tokens
  (RAL 7035 chrome). R-17 replaces the token values and retires the legacy aliases.
- The workspace host scrolls as a page (`.workspace-host { overflow: auto }`); panes use
  `max-height: 65vh` / fixed heights. R-17 makes every workspace full-height with
  internally scrolling panels.
- Catalogo collapses under `max-width: 1120px`, pushing the inspector below the fold.
- Fronte Quadro: `.front-drawing` has `max-height: 650px`, a 1 px border on the `<svg>`
  itself and hard-coded fills (`#e6edf5`, `#b5d9ec`, `#f5bd76`, `#cfd9e3`).
- `clientToViewBox` (`project/placement-drag.ts`) assumes the `<svg>` bounding box equals its
  content box, `preserveAspectRatio` meet/centred, and no CSS transform. **Any border,
  padding or transform on the `<svg>` shifts drop hit-testing.**
- The drag ghost is `position: fixed`; no ancestor may get `transform`, `filter` or
  `contain`.
- Progettazione messages live in local state (`.design-message`, drag guidance under the
  drawing); the shell `StatusBar` only shows lifecycle and listino text.
- Renderer tests (`test/renderer/*.test.tsx`) assert static markup, including exact class
  names and tag strings. Class/markup changes must update those tests deliberately.
- CSP: `style-src 'self'; font-src 'self'; img-src 'self' data:`. Icons must be bundled
  inline SVG; no CDN fonts or icon fonts. React `style={}` attributes remain allowed.
- Window: 1280×800 default, 900×560 minimum, maximised at start; app zoom −2…+3 (×1.2 per
  step), so effective CSS width can drop to ~830 px.

---

## 3. Visual system

### 3.1 Colour tokens (light theme only)

Tokens are defined once on `:root` (names are normative, values are exact).

**Identity / active / selected (orange)**

| Token | Value | Use |
|---|---|---|
| `--librequadri-accent` | `#D96A00` | Active workspace tab underline and icon; selected-row left bar; selection outline and handles in the Fronte Quadro; active tool icon; focus ring; checked checkbox; sorted-column indicator; mark underline |
| `--librequadri-accent-strong` | `#BD5A00` | Filled primary button (white text, 4.54:1); label tag of the selected object in the drawing |
| `--librequadri-accent-hover` | `#A95000` | Primary button hover / pressed (white text 5.48:1) |
| `--librequadri-accent-ink` | `#8F4200` | Text of selected rows / nodes (6.48:1 on tint) |
| `--librequadri-accent-tint` | `#FFF2E6` | Background of selected row/node, active tool, drag-source pool row |
| `--librequadri-accent-line` | `#F2C49A` | Inset border of the active tool button |
| focus halo | `rgb(217 106 0 / 0.16)`, 3 px | Around a focused input/select, outside its 1 px `--librequadri-accent` border |
| selection fill (drawing) | `rgb(217 106 0 / 0.07)` | Fill inside the selected object's outline |

`--librequadri-accent` on white is 3.49:1: valid for UI components (≥3:1), **not** for 13 px text.
Never put white text on `--librequadri-accent`; use `--librequadri-accent-strong`.

**Semantic colours — never orange**

| Token | Value | Meaning |
|---|---|---|
| `--librequadri-ok` | `#16794A` | Valid placement target, drop preview, configuration complete, successful operation |
| `--librequadri-ok-tint` | `#E7F4EC` | Success tag background |
| `--librequadri-warn-bg` | `#FFF6D8` | Warning background (yellow-amber) |
| `--librequadri-warn-line` | `#EACB6E` | Warning border |
| `--librequadri-warn-icon` | `#B38600` | Warning icon |
| `--librequadri-warn-ink` | `#6E5200` | Warning text (6.77:1) |
| `--librequadri-error` | `#C42B1C` | Errors, backend refusals |

Semantic separation is mandatory: **orange = identity/active/selected; green = valid/success;
yellow-amber = warning; red = error.** Orange is never a warning. Warnings include "Prezzo
non disponibile" and "file non trovato". "Fuori listino" and "Configurabile" are neutral
tags, not warnings. The "Modificato" (dirty) indicator is **neutral** (`--librequadri-ink-2` dot +
text), because amber means warning.

**Neutrals**

| Token | Value | Use |
|---|---|---|
| `--librequadri-ink` | `#16191D` | Primary text |
| `--librequadri-ink-2` | `#4A515A` | Secondary text, panel icons |
| `--librequadri-ink-3` | `#6B737D` | Labels, counts, placeholders (4.80:1) |
| `--librequadri-surface-1` | `#FFFFFF` | Panels, tables, inspector, top bar |
| `--librequadri-surface-2` | `#F6F7F9` | Panel headers, table headers, status bar, sticky footers |
| `--librequadri-surface-3` | `#EEF0F3` | Hover, pressed neutral toggles, neutral tags |
| `--librequadri-app` | `#ECEEF1` | Application background |
| `--librequadri-canvas` | `#E4E7EB` | Fronte Quadro viewport background |
| `--librequadri-line` | `#E1E4E9` | 1 px separators inside panels |
| `--librequadri-line-strong` | `#C8CDD4` | Panel borders, control borders, column splits |

**Fronte Quadro drawing tokens** (replace hard-coded fills; drawings stay line art, vector
assets keep `currentColor`):

| Token | Value |
|---|---|
| `--fq-ink` (outlines, vector `currentColor`) | `#2B3139` |
| `--fq-ink-soft` (guides, rail detail) | `#8A929C` |
| `--fq-enclosure` fill | `#FBFBFC` |
| `--fq-support` fill | `#F3F5F7` |
| `--fq-opening` fill | `#E9ECF0` |
| `--fq-device` fill | `#FFFFFF` |
| `--fq-grid-minor` / `--fq-grid-major` (10 / 100 mm) | `#DDE1E6` / `#CFD4DA` |
| `--fq-dimension` | `#5B6470` |
| `--fq-hover` (neutral pre-highlight) | `#5B6470`, 1.2 px |

Drag-and-drop overlay colours keep the existing R-16/R-18 green family:
parent `stroke #16794A, 1.6 px, dash 7 4, fill rgb(22 121 74 / .05)`; target preview fill
`rgb(22 121 74 / .22)`; target outline and vector preview `#0E5F38`, 2.2 px.

### 3.2 Typography

- UI face: system stack `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`.
- Codes, coordinates: `ui-monospace, "SF Mono", Menlo, Consolas, monospace`, 12 px.
- Numbers: `font-variant-numeric: tabular-nums` wherever values align.
- Barlow Semi Condensed is no longer used for workspace UI (it may be removed or kept for
  a future document/print style; decide in slice R17-7).
- Scale (px, line-height): 11/14 labels and tags · 12/16 secondary, panel titles, status
  bar · **13/18 default** (root font 13 px) · 12.5 dense rows and property grids ·
  15/20 inspector identity · 21/26 Start product name only.
- Sentence case everywhere; no uppercase eyebrows, no large page headings inside workspaces.

### 3.3 Geometry, spacing, surfaces

- Base spacing 4 px (2, 4, 6, 8, 10, 12, 16, 20). Retire `--librequadri-unit: 9px`.
- Radii: panels, toolbars, tables, viewport = **0**; buttons, inputs, selects, tags,
  steppers = **3 px** (tags 2 px); popovers/dialogs = 4 px. No pills.
- Panels meet edge to edge; separation is a 1 px `--librequadri-line-strong` border, not gutters.
- Panel header: 30 px, `--librequadri-surface-2`, 1 px bottom `--librequadri-line`, 16 px icon (`--librequadri-ink-2`),
  12 px/600 title, optional count (11.5 px `--librequadri-ink-3`), right-aligned 24 px icon buttons.
- Sections inside a panel: 28 px header (12 px/600, 12 px chevron), top border `--librequadri-line`,
  no fill. Property grids: label column 118–134 px (`--librequadri-ink-3`), 22 px rows, values
  truncated with ellipsis.
- Shadows only on popovers, menus, dialogs, floating canvas chips and the drag ghost:
  `0 2px 8px rgb(20 30 45 / .10)` plus a 1 px border.

### 3.4 Controls

| Control | Size / style |
|---|---|
| Button sm (toolbars, rows) | 24 px |
| Button default | 28 px, padding 0 11 px, 12.5 px/500 |
| Button md (footers, inspector action) | 32 px, 13 px |
| Button lg (Start only) | 36 px, 13.5 px |
| Primary | `--librequadri-accent-strong` fill, white 600 text, hover `--librequadri-accent-hover`; **one per screen region** |
| Secondary | white fill, 1 px `--librequadri-line-strong`; hover `--librequadri-surface-2` |
| Emphasised secondary (e.g. Start "Apri" in the recent footer) | secondary with `#8E969F` border, 600 text |
| Ghost | no border; `--librequadri-ink-2`; hover `--librequadri-surface-3` |
| Disabled | `#9AA1AA` text, `--librequadri-surface-2` fill, `--librequadri-line` border |
| Icon button | 24×24 (26 in dense toolbars), 3 px radius |
| Active tool (Seleziona, Pan) | `--librequadri-accent-tint` fill, `--librequadri-accent-strong` icon, inset 1 px `--librequadri-accent-line` |
| Pressed view toggle (Griglia/Etichette/Quote) | **neutral**: `--librequadri-surface-3` fill, `--librequadri-ink` icon, inset 1 px `--librequadri-line-strong` |
| Input / select / search | 28 px (search 30 px), 1 px `--librequadri-line-strong`, 3 px radius; custom chevron (inline SVG) |
| Segmented control | 26 px, bordered; active segment white, 600, 2 px inset bottom bar `--librequadri-accent`, accent icon |
| Checkbox | 14 px, 2 px radius; checked `--librequadri-accent` fill with white tick |
| Number stepper | 24 px (28 in inspector footer), bordered group − value + |
| Tag | 18 px, 11 px/600, 2 px radius; neutral `--librequadri-surface-3`/`--librequadri-ink-2`; ok, warn, accent variants |
| Filter dropdown button | 24 px; active filter is **neutral** (`--librequadri-surface-3`, `#9AA2AC` border, 600 text) |
| Keyboard hint (`kbd`) | 11 px, 1 px border + 2 px bottom border |

### 3.5 States

- **Hover:** row/control background `--librequadri-surface-2` (rows) or `--librequadri-surface-3` (icon buttons);
  no motion. In the drawing: neutral outline `--fq-hover`.
- **Selected row / tree node / table row:** `--librequadri-accent-tint` background, 2–3 px inset left
  bar `--librequadri-accent`, label `--librequadri-accent-ink` 600, node icon `--librequadri-accent`.
- **Selected object in the drawing:** 2 px `--librequadri-accent` outline 1.5 mm outside the object,
  `selection fill`, four 4.4 mm white handles with accent border, and a label tag above the
  object (`--librequadri-accent-strong` fill, white 10 px screen-size text with the article code).
  The tag and text keep constant on-screen size at every zoom.
- **Focus:** 2 px `--librequadri-accent` ring (inside dense rows offset −2 px); inputs use accent border
  + 3 px halo. Only one element focused per screen.
- **Disabled / exhausted:** 50 % opacity for exhausted pool items; reason as secondary text.
- **Drag:** see §4.4. The drag source row in the pool uses the selected-row treatment.
- **Warning / error:** §3.1 semantic tokens, inline next to the cause.

### 3.6 Icons

About 30 Lucide-style stroke icons (ISC licence; keep the notice), vendored as TSX path
components in `src/renderer/ui/icons.tsx`: 16 px (14 px in dense rows), stroke 1.6,
`currentColor`. Icons accompany text except standard toolbar glyphs, which have
`aria-label` and tooltip. Required set: search, chevron right/down, x, plus, minus, fit,
pointer, pan, grid, tag, ruler, folder-plus, folder-open, file, book (Catalogo), design
(Progettazione), table (Distinta), box (Carpenteria), panel (Pannello), device
(Apparecchio), alert, check, check-circle, trash, sliders, filter, package, layers,
outliner, properties, sort, more, download, refresh, info, crosshair.

### 3.7 Application shell

- **Top bar, 40 px, white, 1 px bottom `--librequadri-line-strong`,** in three zones:
  - left: compact LibreQuadri text identity, project title 13/600, norm code
    12 px `--librequadri-ink-2`, divider, neutral "Modificato" dot + text;
  - centre: workspace tabs Catalogo ⌘1 · Progettazione ⌘2 · Distinta ⌘3 (icon + label + kbd
    hint), active tab ink 600 with 2 px `--librequadri-accent` underline and accent icon. Keyboard
    arrow behaviour of `ProjectBar` is kept. Distinta stays reachable as today (⌘3 / toggle);
    it is presented as the third tab;
  - right: file icon, document name, "rev. N" in `--librequadri-ink-3`.
  Lifecycle commands stay in the native menu.
- **Status bar, 24 px, `--librequadri-surface-2`, 1 px top `--librequadri-line-strong`, 12 px**: segments
  separated by 1 px `--librequadri-line`. First segment flexes and carries the single
  `role=status` live region (last operation or drag guidance, with a green check / green dot
  for success/valid). Following segments are workspace context (below) and, where space
  allows, the current listino ("Listino BTI n. 21 · valido dal 01/07/2026"). Values in
  segments are 600 `--librequadri-ink`. Implement through a renderer `StatusProvider` context; no
  backend change. Errors needing action remain beside their control.
- Workspaces fill the space between bars; they never scroll as a page. Catalogo and
  Progettazione stay mounted-but-hidden as today.

---

## 4. Approved screen structures (1440×900 reference)

### 4.1 Start (no project open)

1. Top bar: LibreQuadri text + "Nessun progetto aperto" (`--librequadri-ink-2`); the three workspace tabs are
   visible but **disabled** (mirrors the native menu).
2. **Identity band** (white, ~76 px, bottom border): LibreQuadri text identity,
   "LibreQuadri" 21/650, subtitle 12.5 px "Configurazione, progettazione e preventivazione
   di quadri elettrici · LibreQuadri". Right: **Nuovo progetto… ⌘N** (primary,
   lg) and **Apri… ⌘O** (secondary, lg). This is the only filled primary on the screen.
3. Below, two columns:
   - **Progetti recenti** (flexible, white): 40 px toolbar (title, count, filter field
     "Filtra per nome, file o cartella" — renderer-only filter); table with columns
     Progetto (file icon + title, 500) · File (mono) · Cartella · Aperto (sort chevron);
     30 px rows; **group rows by date** (Oggi, Ieri, Ultimi 7 giorni, Precedenti — 26 px,
     11.5 px/600 `--librequadri-ink-3` with count), computed from `lastOpenedAt`; selected row uses
     the selected-row treatment; missing file shows a warning tag "file non trovato";
     footer (`--librequadri-surface-2`): **Apri** (emphasised secondary), **Rimuovi dall'elenco**,
     right-aligned selected-entry summary (file · folder label · opened). Keyboard
     behaviour (`recentKeyAction`) is unchanged. Renderer never receives paths; only the
     existing folder label.
   - **Right column, 336 px**: "Catalogo locale" property grid (Articoli, A listino, Fuori
     listino, Da classificare) · "Listini installati" table (Emittente, Listino, Valido dal,
     Articoli) with **Aggiorna listino…** and **Famiglie da classificare…** · "Marchi nel
     catalogo" table (marchio, name, articoli, a listino) from `CatalogueOverview.brands` ·
     keyboard hints at the bottom (↑↓ seleziona, Invio apre, Canc rimuove dall'elenco).
4. Status bar: "Pronto." · Catalogo: N articoli · listino.

### 4.2 Catalogo + Scheda articolo

Columns: **272 px** navigation · flexible results · **404 px** inspector column.

- **Navigation** — header "Produttori" with compact brand select; one-line path bar
  (Apparecchi › Magnetotermici › **BTDIN60**); expandable tree (24 px rows, 12.5 px, 14 px
  indent, 1 px indent guides, right-aligned counts, package count with package icon;
  "Famiglie statistiche METEL" as second root). Selected node: selected-row treatment. The
  tree presents the existing `manufacturerNodes` data; no API change.
- **Results** — header "Articoli" + "86 di 486"; toolbar with 30 px search (⌘F hint) and
  "Solo a listino" checkbox; facet strip of dropdown filter buttons (Marchio,
  Configurabilità, Poli, Curva, Corrente nominale, Potere di interruzione — from the
  dynamic facets, checkbox popovers with counts); active-filter tag row with removable tags
  and "Azzera filtri"; **dense results table**: Articolo (description 500 + mono
  "BTI · code" second line) · attribute columns from the product attributes (e.g. Poli,
  Curva, In, Icn) · Stato (neutral tags "Configurabile", "Fuori listino"); 40 px rows,
  sticky 28 px header, delisted rows in `--librequadri-ink-3`; footer "Mostrati X di Y" + "Mostra
  altri". Packages keep a labelled group at the top of the list.
- **Inspector column** — top part (≈ 60 %): "Scheda articolo" with identity block (mono
  brand · code · A listino; 15/20 description; neutral tags; right-aligned list price as
  today), collapsible "Attributi tecnici", "Configurazione" (label-left 128 px / select-right
  axes with Obbligatorio/Facoltativo, green "Configurazione completa", BOM table code /
  description / qty **without prices**, Ingombro fronte and Occupazione), and a **sticky
  footer**: Quantità stepper + primary **Aggiungi al progetto** (or Configura / Salva
  configurazione per existing logic). Bottom part: "Righe del progetto" (count, "Rimuovi
  selezionati (n)"), 44 px rows: checkbox, description, mono code + "Configurato" tag +
  selections summary, stepper, delete icon.
- Only one selection context at a time, as today: selecting a browse row clears the active
  project line (existing `CatalogueScreen` behaviour).
- Between 1100 and 1279 px the inspector column switches to tabs (Scheda | Progetto (n))
  instead of dropping below the results.

### 4.3 Progettazione — normal (selected device)

Columns: **280 px** left · **flexible Fronte Quadro (≈ 870 px at 1440)** · **288 px** right.
No page heading.

- **Left, top — "Struttura"**: header with reload icon; segmented control
  Carpenterie | Pannelli; context line "Compatibili con <Carpenteria>"; the existing
  `HierarchyTree` restyled (24 px rows, chevrons, panel icons, counts); "Configurazione"
  section for the selected model (green status, property grid Scelte / Articolo /
  Ingombro, primary **Aggiungi** / "Aggiungi e posiziona carpenteria"). Existing
  `StructuralWorkflow` behaviour is unchanged.
- **Left, bottom — "Albero fisico"** (outliner): header with "5 pannelli · 15 apparecchi";
  rows: root carpenteria → pannelli (child count in muted parentheses when collapsed) →
  apparecchi (mono article code); right-aligned mm coordinates; the selected object uses
  the selected-row treatment. "Rimuovi posizione" moves to Proprietà.
- **Centre — Fronte Quadro**
  - 32 px viewport toolbar (white): ~~Carpenteria select (when more than one root)~~ (removed in
    R-17c live acceptance: every Carpenteria is drawn at once since R-17b.1, and the Albero fisico
    sets the internal focus); active
    tools Seleziona/sposta and Pan (active tool = orange); neutral view toggles Griglia,
    Etichette, Quote; right: − / zoom % / + / Adatta vista.
  - Canvas `--librequadri-canvas` with optional 10/100 mm grid; drawing fills all remaining height
    (no `max-height`); border is on the wrapper, **never on the `<svg>`**.
  - Drawing: line art with `--fq-*` tokens; real M2 vectors keep `currentColor = --fq-ink`.
  - Optional overlays (renderer-only, derived from snapshot data): overall and panel-stack
    dimensions; short device labels (e.g. `C16`, `30 mA`) above devices at constant
    on-screen size.
  - Selected device: orange selection per §3.5. Hovered device: neutral outline.
- **Right, top — "Da posizionare"**: header with total available count and filter icon;
  groups Pannelli / Apparecchi (26 px group rows with "N disponibili"); 38 px rows: 28×30
  thumbnail (existing `SubjectPreview`), model name, secondary "code · N moduli" or panel
  size, right-aligned **available / Q**; exhausted rows at 50 %; unresolved profile shows a
  warning icon + "Profilo fisico non disponibile".
- **Right, bottom — "Proprietà"** (NEW, see §4.5): identity (thumbnail, model name, mono
  code, tags "Posizionati P di Q", "N moduli"); "Posizione" (Pannello, Zona, Inizio in
  display units, X · Y mm, Ingombro); "Configurazione" (visible selections); footer with
  **Rimuovi posizione** (existing unplacement) and hint "Trascina nel disegno per spostare".
- Status bar: operation message · orange-square "Selezione: <code> · pannello n° · inizio"
  · "Da posizionare: N pannelli · M apparecchi" · Zoom % · listino.

### 4.4 Progettazione — drag state

Behaviour is exactly the accepted R-16/R-18 behaviour; only presentation is restyled.

- Targets come from `placementTargets`; the drop runs the encoded mutation; the backend
  revalidates. No snapping to distant targets; no arbitrary positions.
- Valid parent Pannelli: green dashed outline + faint green fill. Hovered exact target:
  green preview fill + green vector preview of the device + green outline.
- Optional (renderer-only): half-module tick scale along the hovered panel's rail
  (0 … 24 moduli) while dragging a device.
- Drag ghost at the pointer (existing `SubjectPreview`, 28 % opacity while over a target).
- Floating guidance chip, bottom-left of the canvas (white, border, small shadow): green dot,
  "Rilascia per posizionare qui." (600), target description, `Esc` annulla. Guidance text
  comes from the existing `dragGuidance`.
- Status bar mirrors guidance: green dot + message · "Trascinamento: <code> · n moduli" ·
  "Destinazione: <pannello> · inizio n moduli" · pool counts · zoom.
- The pool source row shows the selected-row treatment; an existing selection stays
  visible (orange) while a different item is dragged (green).

### 4.5 Selection + Proprietà — new R-17 renderer interaction

This does **not** exist today (pointer-down on a placed node starts a drag). R-17 adds:

- Click (pointer up without exceeding the existing 4 px drag threshold) on a placed support
  or device selects it; clicking empty canvas or pressing Esc (when not dragging) clears
  it; selecting a row in Albero fisico selects the same node.
- Selection is renderer state keyed by node UUID; it is cleared when the node disappears.
- Proprietà reads only the project view already loaded (configured-item snapshot + node).
- The drag interaction, target loading and drop semantics must remain unchanged. Note that
  pointer-down currently starts target loading immediately; the implementation must keep
  drag start latency and R-18 behaviour identical.

### 4.6 Distinta

Columns: flexible table · **320 px** Riepilogo.

- Header "Distinta materiali" + "N articoli · M pezzi"; toolbar: filter field (renderer-only),
  note "Prezzi di listino, senza sconti né ricarichi", disabled **Esporta PDF** (PDF not yet
  available).
- Table: # · Marca · Codice (mono; sortable, sorted column 600 with accent indicator) ·
  Descrizione · UM · Quantità · Prezzo di listino · Totale di listino (600); 30 px rows,
  sticky header and **sticky footer total row**; selected row = selected-row treatment;
  missing price = warning tag "Prezzo non disponibile" and a faint warning row tint.
- Riepilogo: "Totale di listino" (24 px/600 tabular), "k di N articoli con prezzo · listino";
  warning box when prices are missing; "Origine delle righe" (righe preventivo,
  configurate, ordinarie — from `project.lines`); "Progetto" metadata; bottom note that the
  printable document/PDF is not yet available.
- Status bar: message · articoli/pezzi · totale di listino · listino. (A total in the status
  bar is shown only in Distinta, where prices are already visible.)

---

## 5. Sizing, responsiveness and platform checks

- Implementation must be verified in live Electron at **1440×900 and 1280×800**, light
  theme, at app zoom 0 and +1/+2, on macOS; Windows (Segoe UI metrics) must be checked or
  explicitly recorded as unverified.
- Below ~1280 px effective width: Progettazione side columns may reduce to 260/260;
  Catalogo inspector column switches to tabs; below ~1100 px the Catalogo navigation and
  the Progettazione Struttura panel may become collapsible (overlay) while the pool stays
  docked as the drag source. No workspace may scroll as a page.
- Technical names (model names, codes, folders) **truncate with ellipsis and show the full
  text in a tooltip** (`title`); never wrap into multi-line rows in trees and lists.
- Device labels in the drawing **hide automatically when the device is narrower on screen
  than the label** (or below ~14 px per module); dimension text keeps constant screen size.
- Fronte Quadro hit-testing must be re-verified after layout changes (drop exactly on
  highlighted targets at 100 %, 150 %, 200 % zoom).

---

## 6. Non-goals (R-17)

- Dark mode (the existing dark variables may remain functional but are not redesigned or
  verified in R-17).
- Any backend, IPC, schema, `.lqp` or placement-semantics change; arbitrary/off-grid
  placement; keyboard placement.
- Rulers and cursor X/Y engineering readout (future, optional).
- A resizable/persisted panel system, unless implementation evidence shows it is required.
- Direction B legacy-CAD chrome (gray editor headers, vertical workspace rail).
- Direction C drawing sheet as the normal editing workspace.
- Technical drawing / print / PDF presentation implementation.
- New features beyond the listed renderer interactions (selection + Proprietà, filters of
  lists already loaded, status provider, view toggles, pan).

---

## 7. Future direction (not R-17): technical drawing sheet

Direction C is recorded for the future printable Fronte Quadro / Distinta document: white
drawing sheet with double border and zone markers (1–8, A–F), overall and panel dimension
lines, P1…Pn panel callouts, a leader callout for a highlighted device, and a title block
filled from project metadata (Progetto, Norma, Vista, Carpenteria, Esecutore, Data, File,
Revisione), set in a condensed technical face (e.g. the bundled Barlow Semi Condensed). It
depends on the pending PDF/document milestone and on Q14 (drawing redistribution rights).

---

## 8. Proposed implementation slices (not authorised by this document)

Each slice: typecheck, focused renderer tests (updating markup assertions deliberately),
full `npm test` (report pre-existing failures), build, and live Electron check at 1440×900
and 1280×800. Slices are small and sequential.

1. **R17-1 Tokens and base styles.** New §3.1 token values on `:root`; legacy aliases
   re-pointed; root 13 px; base button/input/select/table/checkbox styles; Fronte Quadro
   `--fq-*` fills replacing hard-coded colours; warning colours to yellow-amber. CSS-only;
   no markup changes.
2. **R17-2 UI primitives and icons.** `src/renderer/ui/` (Icon set, Button, IconButton,
   Panel/PanelHeader, Section, PropertyGrid, Tag, Stepper, SegmentedControl, Tabs,
   DataTable styles, Tooltip-by-title, InlineMessage) with unit tests; not yet adopted.
3. **R17-3 Shell.** Top bar, full-height non-scrolling workspace host, `StatusProvider` and
   segmented status bar; update `app-shell` tests.
4. **R17-4 Progettazione layout.** Three-area layout (280 / flex / 288), viewport toolbar,
   canvas fill with border on wrapper, restyled Struttura / Albero fisico / pool, drag
   guidance chip and status mirroring. Behaviour unchanged; re-run the R-16/R-18 live
   acceptance checklist.
5. **R17-5 Selection + Proprietà.** Renderer selection state, canvas and outliner
   selection, Proprietà panel, Rimuovi posizione moved there; label auto-hide; tests for
   click-vs-drag threshold and unchanged drop routing.
6. **R17-6 Catalogo + Scheda articolo.** Tree, facet dropdown strip, dense results table,
   inspector sections and sticky footer, project lines, 1100–1279 px tabbed column.
   Shared configuration components also affect Progettazione: re-check it.
7. **R17-7 Start and Distinta.** Start identity band, grouped recents, right column;
   Distinta table/footer/Riepilogo; dialogs (`NewProjectDialog`, Proprietà progetto,
   Listino, Famiglie da classificare) on the new primitives; decide the fate of Barlow.
8. **R17-8 Cleanup and acceptance.** Remove dead CSS and legacy aliases, verify
   1440×900 / 1280×800 / zoom / Windows notes, update STATUS.md.

Open item to confirm during planning (not a design question): the standalone Configura
range browser (`ConfigurationScreen`) has no UI entry point today; R-17 does not restyle or
revive it unless the product owner decides otherwise.
