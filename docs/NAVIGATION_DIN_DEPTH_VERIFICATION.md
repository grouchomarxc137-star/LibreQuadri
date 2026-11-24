# Catalogue navigation, physical-only DIN discovery and depth dimensions


Review branch: `codex/progettazione-catalogue-depth`.
Base: `origin/main` `28fa5de62269524f84346202f2c45ae6cae0f5d5`.
The supervisor confirmed that the catalogue hierarchy correction belongs in **Catalogo**;
DIN discovery remains in **Progettazione**. The separate Alpha branch was not merged or edited.

## Manual-acceptance follow-up — 2026-10-08

Catalogo passed manual acceptance and is byte-identical to review commit `450d4b0`.
This follow-up changes only DIN discovery, depth placement and their regressions/evidence.

### DIN root cause and corrected workflow

`MainDatabaseService.modelSummaries()` omitted `commercial_contribution` from its SQL projection.
The actual `designNavigation`/`designDiscover` candidate payload therefore lacked
`commercialContribution`, although its TypeScript assertion claimed a complete summary.
`DeviceDiscovery` correctly restricted the Solo ingombro shortcut to approved models with
`commercialContribution === "none"`; consequently the real compatible DIN model was excluded
from that shortcut. Search still matched its name/code in the approved hierarchy. Earlier renderer
fixtures and real tests used full model details, which supplied the missing field and masked the
production boundary defect. The correction includes the existing field in the summary projection;
compatibility queries and eligibility rules are unchanged.

The actual development catalogue and open working project were copied to disposable scratch files
for a service-level audit. Both placed **24 Moduli DIN 600x200mm 1/4 giro con guida DIN 35** panels
(`tq.pack.1234`) return 656 approved candidates, including model 1369 (`tq.pack.1778`) with
`commercialContribution: "none"`; Solo ingombro now contains that one model. **Cieco 600x50mm**
(`tq.pack.820`) returns no candidates, and the Megaswitch panel returns four commercial candidates
without DIN generico. No original catalogue or working-project data was changed.

The existing context selects the selected panel, the parent panel of a selected device, or the first
panel of the focused enclosure. That fallback can select the blind panel in this project. The screen
already identifies the context in **Compatibili con**. Empty or commercial-only compatible lists now
also explain that no physical-only device is available for the current panel and direct the user to
select a panel with a DIN rail in **Albero fisico**. Empty compatible lists render this guidance too;
unverified/stale contexts retain their existing alerts and expose no model.

Corrected workflow: **Progettazione → select a placed 24 Moduli DIN panel in Albero fisico → Struttura
→ Apparecchi → Solo ingombro → Din generico - Solo spazio → choose the DIN module count → Aggiungi
→ Da posizionare → place on an approved DIN rail**. Searching `generico`, `DIN` or `tq.pack.1778`
also searches only the current backend-approved hierarchy. Selecting a blind/incompatible panel
shows the explanation instead of making DIN generico selectable.

The real-data regressions now obtain navigation through **MainDatabaseService**. One renders that exact
payload through **DeviceDiscovery** with the hierarchy collapsed and asserts the visible shortcut.
The other proves blind-panel exclusion and refused insertion, then retains all existing physical-only,
capacity, empty-BOM/null-price/unchanged-Distinta, placement, Undo/Redo, filler and offline-reopen checks.
Renderer regressions cover both empty and commercial-only unavailable contexts.

Follow-up files: `src/main/database/database-service.ts`, `src/renderer/project/DeviceDiscovery.tsx`,
`src/renderer/project/StructuralWorkflow.tsx`, `src/drawing/front-geometry.ts`,
`test/catalogue-depth-real-data.test.ts`, `test/renderer/device-discovery.test.tsx`,
`test/renderer/front-depth.test.tsx`, this verification record and `STATUS.md`.

### Top-right depth evidence

The shared depth geometry starts to the right and above the enclosure's upper-right corner and runs
at 45° further up/right. Its complete line, arrow and rotated-label bounds are unioned into shared
content bounds; the same bounds feed the screen fit and PDF viewBox/page fit. Existing primitives,
`outerDepthMm`, Quote toggle, width/height and physical coordinates are unchanged. Regressions require
the complete depth bounds to lie right of the enclosure and above its top, cover all content-bound
sides at multiple screen scales, and retain shared screen/PDF markup and page-fit assertions.

Production `ProjectPdfService` generated Quote-on, Quote-off and missing-depth PDFs in isolated hidden,
sandboxed/JavaScript-disabled windows. Text extraction confirmed 161/230 mm only when applicable;
Poppler inspection confirmed both diagonals above/right and no clipping on the one-page A4 export.
Machine-local evidence: `$TMPDIR/lq-din-depth-correction-evidence/depth-on.pdf`, `depth-on.png`,
`geometry.json` and `pdf-result.json`; actual-project navigation audit:
`$TMPDIR/lq-din-depth-correction-user-project-audit.log`.

Final validation: focused **8 files / 59 passed**; full **105 files / 1,318 passed**, no failures/skips;
TypeScript, production build and `git diff --check` passed, with the same real catalogue/MDB/METEL
inputs listed below. Native-window manual reacceptance could not be performed because macOS
Computer Use permission was unavailable; the copied actual-project service audit, coupled real
payload/rendering regression and generated PDF inspection are the automated evidence.

## Initial implementation

- **Catalogo:** `showcase/catalogue-navigation.ts` adapts the supplied manufacturer tree at the UI boundary.
  The populated catalogue now has exactly two primary entries, in order: **Apparecchi BTicino** and
  **Famiglie statistiche**. The latter is a presentation-only expandable parent. Its negative UI ID never
  reaches a browse query. All nine original statistical roots (BCT, BTI, CAB, IMS, LEG, NTM, SIE, SNR, ZUC),
  their manufacturer/issuer names, IDs, individual article/package counts and descendant hierarchies remain.
  No synthetic aggregate count is advertised because summing overlapping memberships would not establish
  a unique product count. Family selection still sends the original node ID. Manufacturer filtering,
  selected-ancestor expansion, keyboard focus, catalogue text search and facets retain their existing paths.
  BTicino naming is confined to the showcase UI adapter; the generic catalogue engine and queries are unchanged.
- **DIN discovery:** the source model remains **TiQuadri ANA_PACK 1778**, `tq.pack.1778`,
  **Din generico - Solo spazio**, `commercial_contribution=none`. Its current source placement beneath
  nested Accessori branches made it difficult to find. Progettazione → Struttura → Apparecchi now has
  name/manufacturer/code search and **Solo ingombro** direct selection. Both consume only the current
  backend-approved device hierarchy. Search retains the source ancestors and opens matching paths;
  no compatible device is invented, and an unavailable model is not made selectable.
  The existing configuration, add-unplaced, Da posizionare and placement workflow is reused.
- **Depth:** `ANA_ARMADI.Profondita_reale` is imported into `cat_phys_profile.outer_depth_mm` in millimetres,
  snapshotted into `prj_item.outer_depth_mm`, and exposed as `ProjectConfiguredItem.outerDepthMm`.
  The enclosure's own drawable snapshot supplies this value. Only finite positive values are shown;
  missing/invalid outer depth is omitted, with no fallback to device depth, usable depth, commercial data
  or screen proportions. `.lqp` remains format 10, TiQuadri adapter remains 9, and no provenance is refreshed.
  Width/height formatting and primitives are retained. A schematic 45° depth line has two arrowheads and
  a measurement label; its presentation length allows the label to fit and does not alter physical geometry.
  The shared primitive model renders the same measurement on screen and in main-owned PDF serialization.
  Shared geometry reserves the line/arrow/rotated-label bounds at the maximum supported font size for
  PDF fit and screen zoom. No placement coordinates, sector layout, parent rectangles, hit tests or vectors change.

## Initial validation — 2026-10-08

- Focused: **14 files / 105 passed**; no failures or skips. Includes catalogue navigation and callback
  tests, DIN renderer tests, shared screen/PDF tests, existing front usability/SVG compatibility tests,
  the existing source-literal architecture guard, and populated-catalogue compatibility/refresh/filler suites.
- Full: **105 files / 1,315 passed**, **0 failed, 0 skipped**.
- `npm run typecheck`: passed (main/shared/test and renderer checks).
- `npm run build`: passed (TypeScript main and Vite production renderer).
- `git diff --check`: passed.
- Real tests used the existing current-adapter populated catalogue in read-only mode at
  `$TMPDIR/lq-bootstrap-validation-oROM8j/target/data/lq.db`. Project writes and all import tests
  used temporary working copies. `LIBREQUADRI_REV83_REAL_DB`, `LIBREQUADRI_ENGINEERING_REFRESH_REAL_DB` and
  `LIBREQUADRI_CAPACITY_FILL_REAL_DB` selected that catalogue. `LIBREQUADRI_LISTINOBT_MDB` selected the existing private
  ListinoBT file. A temporary, external-to-repository Downloads link made the existing relative-path
  METEL source tests runnable in the managed worktree; no test was disabled or weakened.
- The three new real-data tests establish:
  1. Every statistical family/descendant/count is preserved, with unchanged real browse/search results.
  2. Pack 1778 is discovered and selected; 2 modules demand 4 DIN half-modules and draw 36 mm.
     Add and placement are undoable/redoable. BOM is empty; price is null; Distinta is unchanged.
     Out-of-capacity placement remains refused. Falsi poli pack 1777 fills only the remaining 44 of 48
     half-modules, leaves the DIN node untouched, contributes its ordinary E80FP articles, and is itself
     undoable/redoable; repeated fill is a no-op. Save/offline reopen preserves the item, positions and Distinta.
     The commercial selectable-package predicate still excludes 1778.
  3. The private MDB's ANA_ARMADI rows and normalized/resolved/saved snapshots agree for packs 2886
     (**161 mm**) and 343 (**230 mm**). Offline PDF uses those snapshots, including after catalogue-free reopen.
- Built Electron/Chromium smoke: real catalogue/snapshot fixtures with an isolated temporary renderer
  bridge verified the two root labels, all nine statistical roots, family ID 625 reaching the browse callback
  (never the UI group ID), direct DIN selection using installation-local model ID 1369, the normal
  `addStructural` request with `place:false`, and both depth labels in the compiled renderer.
  Actual backend behavior is established separately by the real-data tests above.
- Actual PDF generation used the existing `ProjectPdfService` and native-save response stub, with hidden
  sandboxed/JavaScript-disabled generators. Quote on/off and missing-depth PDFs, plus Save PDF from the
  compiled UI, were generated. Poppler text extraction and page rendering confirmed 161/230 mm diagonal
  dimensions, preserved frontal dimensions and no clipping. Screenshots and the four PDFs are machine-local
  evidence under `$TMPDIR/lq-catalogue-depth-evidence`; no fixture bridge is part of the product.

No unresolved source-data or architecture issue was found within this scope. Physical native-dialog
interaction, Windows and packaged application acceptance were not performed. Alpha packaging, `.claude/`,
commercial calculations, normalized catalogue data, schemas/importers, `.lqp` format and imported vectors
are untouched. The branch is for supervisor review; no merge or main push is performed.

## Initial changed files

- `src/drawing/front-geometry.ts`
- `src/drawing/front-primitives.ts`
- `src/renderer/catalogue/CatalogueScreen.tsx`
- `src/renderer/showcase/catalogue-navigation.ts`
- `src/renderer/project/DeviceDiscovery.tsx`
- `src/renderer/project/device-discovery.ts`
- `src/renderer/project/StructuralWorkflow.tsx`
- `src/renderer/project/ProgettazioneScreen.tsx`
- `src/renderer/styles.css`
- `test/catalogue-depth-real-data.test.ts`
- `test/renderer/catalogue-discovery-actions.test.tsx`
- `test/renderer/catalogue-navigation-groups.test.tsx`
- `test/renderer/device-discovery.test.tsx`
- `test/renderer/front-depth.test.tsx`
- `test/renderer/catalogue-three-panel.test.tsx` (expected approved root label)
- `docs/NAVIGATION_DIN_DEPTH_VERIFICATION.md`
- `STATUS.md`
