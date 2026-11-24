# Single-workspace project layout


Opening a project starts in **Apparecchi**. The design selector is ordered
**Apparecchi → Carpenterie → Pannelli**. The top bar retains project/document
identity and pins **Distinta** at the far right, after the document information, with no workspace tabs.

Apparecchi reuses catalogue navigation, search, facets, results, article/package
configuration and project components in the original Catalogo arrangement: the full
hierarchy on the left, search/filters/results in the centre, and the compact article
inspector plus project components on the right. Navigation and results are not stacked
in one sidebar. Selecting child categories continues browsing their original IDs with
the active filters. Catalogue side widths retain their original responsive defaults
and resize preferences; the design modes retain their separate preferences.

Fronte Quadro stays mounted but hidden in Apparecchi. It returns for Carpenterie/Pannelli,
with its selection/zoom intact, alongside the existing physical tree, placement list,
properties and structural configuration. Drawing selection/annotation keyboard actions
are suspended while Apparecchi is shown. The mode selector wraps safely in a narrow sidebar.

**DIN generico**, beside **Falsi poli DIN**, opens compatible physical-only model
configuration. Its context is the selected drawing panel, a selected device's
parent panel, or the existing first-panel fallback. Eligibility comes from backend
navigation and resolved DIN demand, without manufacturer names or model IDs in
selection logic. Added devices remain unplaced until dragged from Da posizionare.

## Distinta editing and PDF

Distinta opens a modal over the current view. It contains the existing project-line
and configured-component editors, quantities, discounts, global discount and labour.
Edits persist immediately through project commands. Opening a line returns to its
Apparecchi inspector. Closing the modal preserves completed edits. Drawing and
catalogue writes share the command queue; pending edits complete before export.
Invalid decimal drafts prevent export. Escape in a decimal editor resets that
field before Escape can close the modal.

Preview/save always use the current main-owned project and current export options:

| Prices | Discounts | Labour | Output |
| --- | --- | --- | --- |
| Off | Off | Off | Materials and quantities only |
| On | Off | Off | Grouped materials at saved list prices |
| On | On | Off | Row/component discounts, then global discount |
| On | Off | On | Saved list prices plus labour |
| On | On | On | Discounted materials plus labour |

Each opening defaults to prices on, discounts/labour off. Turning prices off
clears and disables both dependent choices; turning prices on leaves them off.
Options never change saved project amounts. Discounted materials split an article
where price or discount differs, and sum already-rounded source amounts. Missing
prices retain `Da definire`. The existing Distinta page layout, metadata and PDF
preview/printing flow remain. Preventivo is no longer a selectable export.

The public preview/save IPC accepts `distinta` and the typed
`{ showPrices, showDiscounts, showLabour }` object. Main validates sender, kind,
argument count and exact option shape, and clears dependent flags without prices.
Fronte Quadro export is unchanged. No project-format or database migration is needed.

## Verification

Renderer integration covers persistent browsing/drawing identity, sidebar modes,
Distinta editing/queueing, invalid drafts, PDF option reset and DIN insertion.
Document tests cover price/discount/labour combinations, different discounts/prices
for one article, shared components, missing prices and unchanged project snapshots.
Existing project persistence, compatibility, capacity and history regressions remain.

Desktop review used isolated Electron fixtures at 1440×1000 and 1000×760, including
both themes and the real stylesheet/components. Three PDFs generated through
`ProjectPdfService` were rendered with Poppler and inspected: list prices,
discounts plus labour, and no prices. Evidence is local under
`$TMPDIR/lq-redesign-review`; the original catalogue and projects were untouched.
Real-catalogue tests use a disposable migrated copy and the installed read-only
asset directory. Optional unavailable source inputs remain skipped.

## BTicino technical filter integration (2026-10-26)

Apparecchi uses the reviewed TiQuadri C–F classification and package-offer implementation from main. Facet definitions persist down the original hierarchy; applicable options and result counts include matching article identities and eligible package offers. Opening a filtered package restores its matching configuration. Brand activation/removal boundaries, stale-source exclusion and transactional derived refreshes also apply here. Stage D categories have reviewed classification only, without inferred technical facts.

The populated-catalogue regression requires all 2,273 Apparecchi primary articles, 1,299 classified models and 264 feasible offers, then verifies stable facet definitions throughout the tree and real matching rows at every applicable Apparecchi node. This prevents an empty but visually stable filter menu from satisfying the hierarchy regression.

## Catalogue usability update 2026-10-27

Apparecchi offers both BTicino and Siemens functional navigation plus the original
statistical families. Both Siemens routes show the 11 approved technical filters.
Checklists show selectable values and removable existing selections, use ascending
numeric checkboxes, and open within the window. The horizontal filter scrollbar
appears over its own hover strip or during keyboard/drag interaction. Closed lists
do not mount options; automatic requests coalesce and reuse bounded, invalidated
facet summaries. See [filter presentation](FILTER_VISIBILITY_SIEMENS.md) and
[measured performance](CATALOGUE_PERFORMANCE.md).

The lower-right Componenti del progetto panel uses a constrained flex column.
Its list scrolls independently while the header and selection controls stay visible;
the last of 80 components was verified in short windows and at 125% zoom.
