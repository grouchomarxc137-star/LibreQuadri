# LibreQuadri — Backlog

> Current Desktop release and verification (2026-10-27): [Alpha 1.1 update](docs/ALPHA_1_1.md#desktop-update-2026-10-27).

Catalogue responsiveness and current filter usability were delivered on 2026-10-27:
see [performance verification](docs/CATALOGUE_PERFORMANCE.md) and
[Siemens filter presentation](docs/FILTER_VISIBILITY_SIEMENS.md).
The deferred items below retain their existing approval status.

Open: placed Pannelli/Apparecchi still need a dedicated safe reconfiguration operation (`replaceConfiguredItem`
deletes and recreates the item and is refused for placed nodes). The Catalogo project-component list therefore
shows placed lines read-only for configuration; quantity edits use `setQuantity` and placed lines are never bulk-removed.

Consolidated 2026-10-01; Preventivo + Distinta PDF milestone closure recorded against `main` at `48192a1948b2114a492fa87f08a647ac109b8725` (see STATUS).

## Policy

- This file lists work that is **not the current approved milestone**: open investigations, proposed capabilities and deliberately postponed work. Current work and delivered history live in [STATUS.md](STATUS.md); stable decisions live in [PROJECT.md](PROJECT.md) and [docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) ("DD").
- **OPEN** — an investigation or a decision is still required before anything can be designed.
- **PROPOSED** — a future direction has been suggested but is not approved for implementation. Nothing here fixes a schema, an API or an architecture.
- **DEFERRED** — known work, intentionally postponed; the scope is understood.
- When an item becomes an active milestone it moves into the normal PROJECT/STATUS workflow and is removed from here. Completed or superseded work does not stay here.
- Repository evidence overrides old chat or history descriptions. Where the repository cannot establish a fact, the item says what evidence is missing instead of guessing.
- New items deliberately carry no milestone numbers. Old `R-xx` / `Qxx` labels are kept only where the repository defines them (DD §16 for Q, STATUS for R).

---

## 1. Progettazione / Fronte Quadro

### Incompatibility guidance in Progettazione (R-12; device side of R-13) — OPEN
- **Problem:** Struttura offers only candidates the backend accepts. `StructuralDiscovery` carries `candidates` and a count of withheld context data, but no list of rejected candidates, so incompatible Pannelli cannot be shown greyed out with a reason. STATUS records this for Pannelli as open ("the discovery API does not expose them").
- **Evidence:** `src/shared/project.ts` (`StructuralDiscovery`); STATUS "V1 refinement" section. Apparecchi discovery is likewise "the backend decides which devices are offered" (STATUS R-19b); drops are rejected with the backend reason only after the user drags.
- **To decide:** whether users need to see excluded Pannelli/Apparecchi and the reason (e.g. `required_context_not_provided`), and what the discovery API may expose without leaking manufacturer source ids.
- **Boundary:** backend `placementTargets` stays the authority for what can be dropped.

### macOS system shortcuts vs Ctrl + arrows — OPEN
- The drawing pans with Ctrl + arrows (and Cmd + arrows) while it has focus. On macOS, Ctrl + Left/Right/Up are Mission Control / Spaces shortcuts by default and may be consumed by the system before the app sees them; the app cannot override that. Verified only with synthesized key events (CDP), not the physical key chord. Cmd + arrows work as the alternative.

### Keyboard operation in Progettazione — DEFERRED
- Placement is drag-only; there is no keyboard alternative (STATUS R-16 "Known limitations"). Keyboard selection/navigation in the drawing was out of scope for R-17c, and "keyboard placement" is a listed R-17 non-goal.
- **To decide:** whether a keyboard path is required (accessibility, productivity) and how it would use the backend `placementTargets`.

### Printable technical drawing sheet — PROPOSED
- The basic Fronte Quadro PDF review candidate is recorded in STATUS: one complete fitted A4 front using shared screen geometry, current labels/dimensions, annotations and a small project heading. The expanded sheet described below remains future work.
- R-17 recorded "Direction C" as the future printable Fronte Quadro/Distinta document: drawing sheet with double border and zone markers, overall and panel dimension lines, P1…Pn callouts, a title block from project metadata ([docs/R17_VISUAL_DESIGN.md](docs/R17_VISUAL_DESIGN.md) §7). Optional rulers and cursor X/Y readout are also mentioned there.
- **Depends on:** the completed Distinta/Preventivo PDF milestone (STATUS) and Q14 (drawing redistribution rights, §2). Not an editing workspace.

### Electrical nameplate / ratings in Fronte Quadro — DEFERRED (no implementation approved)
- **Trigger:** TiQuadri's Fronte Quadro can show a label such as "Icc<=10kA - Imax<=125A". A read-only investigation (2026-10-08, on `466af67`) found it is **not a calculated or stored rating**.
- **Finding:** the label is static manufacturer artwork: a stroked-line text block `99_Testi\Centr_*A` (WMF files and same-named `DXF_BLOCK` rows in `BTQuadriDXF.mdb`), attached to a front option through `ANA_MODALITA.Block`, `Flag_Block`, `Dim_block_X/Y` and `Offset_block_X/Y`. Five historical variants exist: Imax ≤ 32, 40, 63, 90 and 125 A, all with Icc ≤ 10 kA. The only surviving use is one option row in a sample project snapshot (`Q.E. Demo KNX Backup.mhq`: pack 2891, "Frontale = Portello fumè", `Centr_125A`).
- **Current catalogue:** BTQUADRI v32 references none of these blocks (0 of 2,074 `99_Testi` overlay references are `Centr_*`; the matching option row has `Block='Null'`), and holds no enclosure-level Icc or rated-current field. Every `Icc <= …` value in it is an SPD upstream-protection option. LibreQuadri already reports the overlay fields as `drawing_overlay_deferred` and the thermal tables as `thermal_deferred` (`src/main/sources/tiquadri/import.ts`; DD "Skipped or deferred"); the seed attributes cover protective devices only.
- **Artwork vs ratings:** the label is manufacturer artwork. A verified assembly rating (rated current InA, short-circuit withstand / conditional current, Ipk) is a declaration by the party that builds and verifies the complete assembly, depending on the actual incoming device, busbars and design verification. It cannot be inferred from an enclosure, panel or Gamma. TiQuadri keeps assembly data separately and user-entered (project table `DELTAT`: `Icc`, `Corrente`, `Norma`, `NORMA_61439`; form `frmTemp61439`), and it is empty in both sample projects.
- **Standards context (unverified against full text):** 32–125 A with 10 kA matches the scope limits of CEI 23-51 (2016): incoming current ≤ 125 A, prospective short-circuit current ≤ 10 kA (15 kA peak with current limiters). **Unresolved:** CEI 23-51:2025 replaces it, with the 2016 edition applicable until 2026-07-31; whether the 2025 text keeps 10 kA / 125 A is not confirmed (only a 2024 public-enquiry draft was seen). IEC 61439-3 (DBO) covers outgoing circuits ≤ 125 A and an assembly rating ≤ 250 A; its short-circuit requirements were not checked against the standard text. Verify against the published CEI/IEC texts before any claim.
- **Possible future option, not approved:** explicit user-entered nameplate data (rated current, short-circuit rating, applicable standard) on a Carpenteria or the project, empty by default, shown on the Fronte Quadro and PDF as the user's own declaration, never inferred or defaulted from the catalogue. Importing the `Block` overlays (§2 Q14) would only be worthwhile if a future catalogue references them again. Until then, Fronte Quadro text boxes can carry any wording the user declares.
- **To decide:** whether the product should include nameplate or declaration data in LibreQuadri at all, and under which standard it would be stated; evidence needed first: the published CEI 23-51:2025 and IEC 61439-3 texts.

---

## 2. Engineering data / TiQuadri investigations

### Preset supports: remaining Flatwall and other cases — OPEN
- The Idrobox/implicit-Pannello investigation is answered: source presets create ordinary Pannelli under Carpenterie; Apparecchi still belong to Pannelli; enclosure compatibility is an ancestor constraint. The generic enclosure-level workflow is a review candidate in STATUS (acceptance example Idroboard 2890; 55 of 259 active preset enclosures get complete sets).
- **SDX resolved:** pack 428 creates all five preset positions. Packs 1283–1286 can resolve to physical-only defaults and the reviewed billable options retain their articles. See [adapter lifecycle](docs/ENGINEERING_ADAPTER_LIFECYCLE.md#reviewed-configuration-level-article-contribution-2026-10-28).
- Still withheld: Flatwall panel-level presets with relative offsets, CEE/P17 socket windows (Q20), QDSA (16005) and Plexo3 compatibility, and MARINA Precomposto and Avanquadro panel issues.
- Removing a preset Carpenteria with `keep-contents` returns its physical-only windows to the pool (TiQuadri deletes Carpenteria and Pannelli but keeps Apparecchi); a generic "remove structure, keep Apparecchi" mode is a possible follow-up.
- Join kits and side panels are not mounting surfaces and stay data-only.

### "Articoli sciolti" — OPEN (investigation)
- **Question:** what TiQuadri means by "Articoli sciolti": how they are selected/added; whether they belong to configuration models; whether they have physical placement; whether they affect the Distinta and the Preventivo/pricing; how they are persisted; what equivalent, if any, LibreQuadri needs.
- **Evidence in the repository:** none — the term does not occur in code, docs or history. Possible lead, not verified here: an earlier investigation (kept outside the repository) found that TiQuadri builds its article list from `ANA_ART_PACK`, `ANA_ART_MODALITA` plus a table `ART_FREE`; LibreQuadri does not import `ART_FREE` (no occurrence in `src/`). TiQuadri project files (`PrjQuadri.mdb`) were examined only as read-only source analysis.
- **Boundary:** no implementation until the semantics are established. Today ordinary articles are added to a project as catalogue lines (not placed).

### Engineering-data lifecycle (R-15, remaining import orchestration/maintenance) — OPEN
- **Installed-source foundation merged:** `a1ca88f` adds declared-adapter versus current-import readiness and fail-closed catalogue boundaries; a current reimport clears it ([lifecycle](docs/ENGINEERING_ADAPTER_LIFECYCLE.md)).
- **Project snapshot foundation merged:** main `920925a` adds format 10 portable provenance, separate status, explicit atomic engineering plan/apply, preserved commerce/positions, and the mixed-interpretation guard ([STATUS](STATUS.md), [architecture](docs/PROJECT_ENGINEERING_REFRESH.md)). Legacy facts/provenance remain unknown on migration and can be explicitly verified with a ready catalogue. Manual acceptance on 2026-10-06 confirmed the real legacy MW250 project path: 28 items resolved (25 verified, 3 refreshed, 0 blocked) and the formerly rejected MW250 placement succeeded in the existing Pannello after refresh.
- **Development synchronization (review candidate, 2026-10-15):** explicit `sync:engineering` reuses verified archived MDBs, detects the existing engineering/drawing fingerprints, and holds SQLite WAL exclusion across the authoritative importers. `prestart` is advisory/read-only. This closes only the approved development orchestration slice; production release installation, general archive/asset repair, GUI and retention remain open. See [README](README.md#synchronize-existing-development-engineering) and STATUS for verification/platform limits.
- **Remaining scope:** production engineering import/update and catalogue release architecture; engineering imports are still developer CLIs. Local commercial METEL delivery import now has a validated application workflow ([contract](docs/METEL_IMPORTER.md)); it does not settle central distribution. Investigate central or administrative ingestion of manufacturer METEL/TiQuadri/source files into validated, versioned normalized catalogue/engineering releases that desktop installations can obtain. Coordinate METEL delivery/pricing with §4 and initial provisioning with §6; this distribution direction is not an approved architecture.
- **Safe release installation — design questions:** download/distribution mechanism (including offline provisioning), staging and any worker orchestration, validation/checksums/authenticity, application/schema/declared-adapter compatibility, atomic activation/switching, rollback, interrupted-update recovery, release retention and update UI. Include installation-local TiQuadri/drawing assets and their consistency with the activated catalogue: drawings are currently not embedded in `.lqp`. Decide how releases preserve manual overrides, commercial conditions and settings in the installation's `lq.db`.
- **Compatibility questions:** what happens when a received project was created against newer catalogue/engineering data; distinguish newer `.lqp` formats, newer adapter interpretations and different source generations. The existing exact declared-adapter readiness checks, no project-adapter downgrade and snapshot-only operation boundaries remain authoritative ([lifecycle](docs/ENGINEERING_ADAPTER_LIFECYCLE.md)). Source identity stability (Q15) and redistribution rights (Q14 below) remain prerequisites where applicable.
- **Maintenance:** backup retention/pruning (`lq.db` still backs up on every open) and packaging remain open. None of this scope is marked complete by project refresh or the development bootstrap.
- **Boundary:** project engineering refresh never reprices or rewrites BOM composition. Project price refresh is a separate open capability (§4). The METEL import GUI updates only the installation's commercial catalogue; engineering import/reset GUI remains open. The old recommendation for staged catalogue generations with an atomic pointer switch remains a recommendation, not an approved design.
- **Local operation:** distribution may supply releases, but ordinary application use must remain local/offline-capable, with installation-local catalogue data and portable project documents. No web-application redesign or live database server is proposed.

### Independent application and catalogue releases — PROPOSED
- Version application releases and catalogue-data releases independently, so a new METEL/listino does not inherently require a new application build. Compatibility still depends on the application's supported schema, seeds and declared engineering adapters; independent versioning does not bypass the installed-source readiness rules.
- Installing a catalogue release must not silently mutate existing `.lqp` product/price/configuration/engineering snapshots. Explicit project engineering verification/refresh remains authoritative; explicit price refresh is separate (§4). Release installation design questions belong to R-15 above, not to a second update pipeline.

### Remaining article-free TiQuadri packs — OPEN
- **State:** R-19a classified only `tq.pack.1778` ("Din generico - Solo spazio") as `commercial_contribution = none`, because both raw article tables have no rows for it. The preset candidate adds 12 reviewed DIN windows (2189–2194, 2196, 2898–2902); the remaining **78 active source-article-free packs** stay `articles`, are reported as review candidates, and still fail empty-BOM resolution. There is no source flag that states intent.
- **Groups to classify (from the 2026-09-30 investigation on `ed6c685`; counts are not re-derived in this consolidation):**
  - generic Contattori and Contattori con termico (11) — real electrical equipment with no BTicino article; whether "none" or an article-like contribution is correct is undecided;
  - "Apparati di Terze Parti" (third-party equipment, 30);
  - Finestre / Cieco and centralino preset panels (40; 36 are centralino presets);
  - rack-space models "Spazio N unità" (8);
  - one kit (387) referenced by four enclosures;
  - other ambiguous models found when reviewing the adapter report.
- **To decide:** per group whether it is physical-only, needs a real article/price, or must stay unavailable; whether approval stays a seed-approved list or needs another mechanism; how each appears in Progettazione and in a printed document.
- **Boundary:** no remaining model is to be classified `none` implicitly. Catalogo continues to exclude article-free models.

### TiQuadri linkage and context flags (Q13, remainder of Q25) — OPEN
- Adapter 8 reports `Test_Compatibilita_Contenuto` as known but unapplied; its former provisional `match_container` mapping caused incorrect placement rejection. Carpenteria Stage 1 / adapter 11 imports `Modalita_x_Modificabile_Nel_Pannello` as generic axis editability only when every contributing row permits it; mixed axes remain locked and reported. Still not applied: `Segue_Modalita_Pannello`, `ID_Macrofamiglia_Armadi_1..5`, `GERARCHIA.ID_Macrofamiglia_Armadi`, `ANA_CLASSE.Classe_Visibile_Senza_Struttura`; `inherit_container` (automatic Easy Tifast/comb BOM on devices) stays unsupported.
- To close: black-box tests in TiQuadri or BTicino documentation (DD §16 Q13, Q25; §9.3 skipped-data table). Related: the in-panel resize flag found for pack 1778.

### Level labels outside Apparecchi (Q26) — OPEN
- DD §16 Q26: labels for the Sezione level, Carpenterie/Pannelli G2/G3 (height, depth, panel type) and whether "Gamma" suits Pannelli G1 (a width, e.g. "Larghezza 850 mm"). Until decided, Progettazione shows node names without level labels (the renderer has no level labels today).

### Cross-brand Gamme in the engineering tree (Q29) — OPEN
- DD §16 Q29: Legrand (KNX, CTX3, racks), IME and Cablofil articles are primaries of BTicino-tree models (291 LEG, 88 IMS, 3 CAB). Show them with their own brand (proposed) or filter them out of the engineering tree (Apparecchi tree and Progettazione)? Catalogo is unaffected (those articles are always reachable via FST).

### Application of model relations — DEFERRED
- Join kits and side panels remain data-only. Generic enclosure-level presets are the active candidate; unresolved commercial and nested-support cases remain above (DD §16 Q18).

### Other unresolved source semantics — OPEN
- Q15 stability of TiQuadri IDs across releases; Q16 rotation/stacking semantics (`Ruotato_1/2`, stack margins); Q17 brand prefix mapping (`IM-`→IMS vs IME; `CT-`, `HW-`, `NV-` unmapped); Q19 module-count disagreements between TiQuadri and ListinoBT (the real v32 import reports 18, DD says 17); Q20 unresolved units/panels (the "Strumenti" demand unit, 14 mixed-kind panels, 6 slot panels without insertion points); Q24 depth check and `QUADRI_WARNING` project warnings; `Compatibilita_Profondita_Armadi` enclosure-depth substitution.

### Linker false matches — known BTicino and Legrand cases corrected

BTicino references now require a unique exact code, including punctuation. The current BTicino listino contains both correct articles. The 29 reviewed Legrand exceptions are limited to their TiQuadri packs. Each exact code is identified as Legrand in ListinoBT `ANA_ART` and its product description agrees with the TiQuadri model and rating. Existing `.lqp` files retain their saved parts and prices. When reviewing a project created before the fix, check the selected configuration and its saved BOM against these affected models:

| Source reference | Previous link | Affected TiQuadri pack IDs |
| --- | --- | --- |
| `BTI/T/16` | `BTI/T1/6` (6 A) | 2022–2026 |
| `BTI/C9250F/6` | `BTI/C9250F6` (fibre breakout kit) | 3218, 3274, 3331, 24119, 24219, 24319, 24419, 24519, 24619, 24719, 24814, 24914, 59622, 59722 |
| `BTI/349311–349313` | LEG floor cable channels in Axolute video-display options | 3836 |

Reviewed aliases retained: `028500–028508` and `028510–028518` for DMX3 packs 12800–12803, and `414244`, `414246`, `414281–414283`, `414446–414451` for the 1000 V DC packs 5873–5875. Legrand references `646010`, `646020`, and `646200` now require an exact Legrand match. Saved quotes with the suspect Cablofil articles in the six reviewed TiQuadri models show a review notice and keep their saved prices.

### Source-data rights and drawings (Q14) — OPEN
- Whether TiQuadri/ListinoBT data (including showing their navigation names and labels) and the WMF/DXF drawings may be used, converted, redistributed or embedded in `.lqp`. Meanwhile drawings are local, display-only and never embedded; an installation imports from user-supplied files.
- **Release prerequisite:** establish source-data rights before redistributing normalized engineering data or source/derived drawings through initial provisioning (§6) or centrally/admin-built catalogue releases (R-15 above). Neither the development bootstrap nor this future distribution direction establishes redistribution approval.
- **Drawing leftovers (DEFERRED):** 22 of 4,096 referenced drawing keys do not resolve (21 have no source block; the `Senza` block is a zero-extent POINT and was rejected). One resolved block used unsupported POLYLINE flags, so only its other geometry converted; one VIEWPORT entity sits in an unreferenced block. Drawing overlays (`Block`, `Flag_Block`, `Dim_block_*`, `Offset_block_*`) are not imported.

### ListinoBT article-physical adapter — DEFERRED
- `ANA_ART` + `ANA_ART_MONTAGGIO` → `cat_product_physical` (`din_half_modules` = `POLI_DIN` × 2, weight). ListinoBT is currently used for conflict evidence only.

### Out of scope until semantics exist — DEFERRED
- Thermal calculation data and TiSystem (DD §9.3 skipped-data table).

### Large engineering constraint payload — OPEN
- The project view eagerly returns physical constraints; about 200 BTDIN60 items would carry ~2.8 MB of constraint rows (STATUS "Known issues"). Selective loading was named "a later optimization"; not yet measured on real projects.

---

## 3. Catalogue / configuration

### Reconfiguring placed quantities and splitting units (Q22 follow-up) — PARTIAL
- **Carpenteria Stage 2 backend:** one physical enclosure is reconfigured by node UUID without recreation. Q>1 separates only that unit into an independent Q=1 configuration; the remaining units keep their identities, children and saved configuration. Historical retained article prices and matched commercial metadata are preserved; new articles use current catalogue snapshots, conflicts refuse atomically. Complete subtree validation, Undo/Redo and offline Save/Reopen are covered. [Contract and acceptance](docs/CARPENTERIA_RECONFIGURATION.md).
- **Carpenteria Stage 3 UI:** selected physical enclosure → Proprietà → Modifica carpenteria; saved choices, placed-axis locks, dependent/default resolution, single-unit Q>1 explanation and actionable backend errors. Success adopts the shared project view for drawing, selection, quotation and Distinta; ordinary Undo/Redo and Save remain available. See the Stage 3 review entry in STATUS.
- **Still open:** enclosure model/depth replacement, general splitting and reconfiguration for other placed kinds. The existing Scheda replacement operation still refuses placed items. Q22 merging/quantity rules remain unchanged.

### Standalone Configura screen / `configuration:node-models` cleanup — DEFERRED
- `ConfigurationScreen` is no longer reachable: the shell action `configure` exists in `shell-state.ts` but nothing dispatches it. The range browser it serves (`configuration:node-models` → `listNodeModels`) still lists `none` (physical-only) models and its only consumer is that screen. R-19b did not clean this up. R-17 deliberately neither restyled nor revived it.
- **To decide:** retire the screen, its IPC channel and `listNodeModels` consumers, or give it a product role. The configuration components shared with Scheda/Progettazione stay.

### Model-only and non-standard configuration presentation — OPEN
- 34 Apparecchi `device` models without a primary article are not Catalogo packages: 12 with no source article rows and 22 whose references are absent from METEL; seven selectable packages resolve `bom_incomplete` (Add disabled). With Configura unreachable, these have no user-visible entry point (DD §5.11 / STATUS "LibreQuadri Apparecchi categories").
- Also open: whether fixed-BOM `accessory` models (no axes) should offer Configura from Catalogo (STATUS "Catalogo browse boundary").
- **Depends on:** the article-free pack classification (§2) and the Configura decision above.

### Technical filters in broad families — IN FINAL REVIEW (Stages C–F implemented together on `review/tiquadri-cdef-integrated`)
- The product owner approved the complete stable category-code tree recorded in DATABASE_DESIGN Rev 8.4 §A.7: existing `protezione.*` codes stay unchanged; Stage C adds the listed `protezione.*` and `manovra.*` codes; `comando`, `misura`, `alimentazione`, `accessori`, `supervisione`, `automazione` and `prese` codes are reserved for Stage D only. Modular and non-modular contactors share `comando.contattori_rele`; Q30 names remain OPEN. The verified v32 Stage C target is 1,938 unique primary products. The earlier 1,934 planning estimate excluded the three fuse holders shared with Prese and the F32 Prese primary.
- Stage B foundation is merged into `main` by `3f4a3d5`. Stages C–F are implemented as one feature on `review/tiquadri-cdef-integrated` (DATABASE_DESIGN Rev 8.4 §A.9), pending final review; the reserved Stage D codes are now seeded. §16 Q30 Italian display names remain OPEN.
- Remaining follow-ups after this feature:
  - Datasheet-backed trip units for ACBs (Megabreak, DMX3) and the three M1-160E "Differenziale" packs. They currently have no value, because TiQuadri and METEL give no adequate evidence.
  - Root-scoped facet noise as more attributes exist: the Apparecchi root now shows eight technical facets.
- Stage A architecture (2026-10-16, docs-only branch `review/tiquadri-technical-filters-architecture`, APPROVED by supervisor review 2026-10-19): DATABASE_DESIGN "Revision 8.4". It defines a reviewed TiQuadri engineering vocabulary seed, an engineering classification tier, generic attribute derivation, and one article + package filter contract, delivered in Stages B–F. Corrected 2026-10-19: `engineering` attribute source with row provenance; persistent greyed numeric options with banded presentation (Q31 answered); feasible-offer package filtering with reproducible witnesses and a visible undecided group; explicit conflict/parser transitions. Product decision: §16 Q30 (category names). It supersedes the decision between enrichment and a new facet source recorded below.
- Update (feature/catalogue-persistent-facets): parent facets now persist down the tree and greyed "non applicabile" facets mark branches without data; the data gap below is unchanged. Open follow-ups: facets are scoped to the tree root, so a root that mixes many unrelated categories will list all their attributes greyed (consider per-category grouping or collapsing fully inapplicable facets when more attributes are seeded); the root population is recomputed per request (cache per root if catalogue size grows).
- Technical attributes exist for 6 seeded attribute kinds (~870 products); nodes such as "Interruttori scatolati" (1,000 articles) have no attribute facets. The configuration-dimension ↔ attribute and range-node ↔ category seeds of DD §12.2 are not implemented (0 of 169 dimensions mapped). A product decision is needed between that enrichment work and a new facet source.

### Search and catalogue infrastructure — DEFERRED
- Search is interim `LIKE`; FTS5 tables/triggers do not exist and `search_text` is never written (DD §8). Package text search matches package names, not BOM article codes; a browse lists at most 200 packages.
- DD tables not yet in the schema: `cat_search_synonym`, `cat_metel_code`, `cat_review_item`, `cat_relation_type`, `cat_product_relation`. Brand display names are not enriched (`cat_brand.name` equals the METEL sigla). Q23 configurator UX (family navigation vs the model's primary-selecting axis) is undecided.

---

## 4. Commercial / Distinta / Preventivo

### METEL price refresh and repricing architecture — OPEN
- Opening a saved project refreshes eligible unlocked EUR list prices in the working copy and reports the previous and new quote totals. An explicit per-line repricing command (DD §7.7) remains open.
- **To decide:** where refresh ends and engineering-snapshot refresh (§2) begins, how placed items are repriced, and how mixed-listino snapshots in one project are shown. Related: open-time resolution statuses below.
- **Catalogue release coordination:** R-15 (§2) investigates central/admin ingestion and distribution of validated METEL/catalogue releases. Installing a catalogue leaves open projects as they are. Reopening a saved project checks eligible prices against the local catalogue.

### Discounts and markup — DEFERRED
- `com_purchase_discount` / `com_pricing_rule` are not in the schema; Distinta and Preventivo are list-price only, with no discount or markup. The form in which purchase discounts arrive is undecided (DD §16 Q2); per-BOM-row discounts depend on it.

### On-screen Preventivo redesign — DEFERRED
- The merged PDF milestone provides a customer-facing document without changing the on-screen `DemoQuotationPanel` workflow. A broader on-screen redesign remains undecided. Listino provenance remains unavailable on `ProjectDistintaRow`, so the PDF does not claim a source listino.

---

## 5. Project lifecycle / compatibility

### Cross-installation `.lqp` portability and different-catalogue acceptance — OPEN
- **Confirmed goal; acceptance/gap analysis still open:** [PROJECT.md](PROJECT.md#data-sharing--project-documents-confirmed) already requires save on computer A → transfer to B → open/edit/save on B → transfer back → reopen on A. Prove this end to end across independent installations/catalogues (macOS and Windows), recording evidence and remaining gaps; existing snapshot/offline tests do not establish the complete round trip.
- **Acceptance matrix:** different METEL/listino/catalogue versions, missing brands/products and delisted products; mixed-listino content added on B; current/older/newer/unknown engineering provenance; installation-local drawing assets present, different or absent. Existing content must remain usable from saved snapshots without the originating `lq.db`: open, display/print/price, supported snapshot-only edits, save and reopen must preserve commercial/configuration/physical content and portable provenance. Drawings are not embedded; verify parametric fallback without changing saved engineering facts or positions (DD §5.9).
- **Catalogue boundary:** adding/reconfiguring products and other catalogue-backed engineering operations may legitimately require the receiving installation's catalogue and readiness checks. Acceptance must distinguish these operations from snapshot-only edits and preserve explicit verification/refresh; no enrichment or repricing on open. Newer file formats retain the existing application-version refusal (DD §7.9); newer engineering provenance must not be downgraded ([lifecycle](docs/ENGINEERING_ADAPTER_LIFECYCLE.md)).
- **Existing diagnostic gap retained:** DD §7.7 describes informational commercial resolution statuses (`match`, `price_differs`, `local_delisted`, `not_in_catalogue`) and configured-model diagnostics (`definition_changed`). These proposed receiving-installation diagnostics and the "successor" suggestion (`replaced_by`, product relations not in the schema) remain missing; the document opens/renders from snapshots. Format-10 engineering provenance status is separate and already delivered (§2); document open itself remains catalogue-free.
- **Divergent copies:** investigate user-facing conflict/divergence semantics when two copies with the same project UUID are independently edited and returned. DD §7.10 currently specifies plain file exchange, no merge and only the save-time "changed on disk" check; do not reinstate superseded revision/base-revision merge architecture. No real-time collaboration or automatic SQLite merging is proposed; any further direction needs later evidence and a decision.
- Related: engineering lifecycle/release compatibility (§2), price refresh (§4), and second-machine/platform acceptance (§6).

### Exporting a copy without costs — DEFERRED
- "Esporta copia senza costi…" (DD §7.8, decision D10) is specified but not implemented. Project files currently carry the full commercial data.

### Project metadata and numbering — DEFERRED
- "Proprietà progetto" is read-only (no metadata-update API). User-defined numbering conventions (DD §16 Q4) are not implemented; the visible number is free text.
- "Duplica come nuovo progetto" (new UUID, cleared number) does not exist.

---

## 6. Platform / packaging

### Production packaging and `.lqp` file association — DEFERRED
- Internal macOS **Alpha 0** has a plain Electron Packager `.app` and first-run normalized testing snapshot ([Alpha instructions](docs/ALPHA_0.md), STATUS). This does not settle production installers/distribution, signing/notarization, Windows packaging or updates. `.lqp` file association remains unimplemented (declared as intended in DD §13); Open inside the app retains the document workflow.

### Production installer and initial catalogue provisioning — OPEN
- Decide what a production installer contains and how a fresh installation receives an immediately usable initial normalized catalogue/engineering dataset, including the installation-local TiQuadri/drawing assets where rights permit. The reproducible development bootstrap in [README](README.md#bootstrap-a-full-development-catalogue) requires privately supplied original sources and developer tooling; it does not settle production provisioning.
- Preserve the separation between the application, installation-local `lq.db`/catalogue assets and portable `.lqp` documents, with `metel_raw.db` used only by imports. Do not decide that the mutable development `lq.db` itself is embedded in the application bundle; investigate how a validated initial release is provisioned into local data storage and works offline after provisioning.
- Consolidate release building, safe installation and compatibility with R-15 (§2), and independent application/data versioning with the PROPOSED item there. Source rights/Q14 (§2) must be established for any normalized engineering-data/drawing redistribution. Packaging/file association above remains DEFERRED; provisioning choices remain OPEN.

### Windows runtime verification — OPEN
- Windows must be supported (PROJECT.md) but the runtime is unverified (STATUS; DD §13): packaged `mdb-reader` use (Q21 is answered for the supplied Jet4 files, packaged Windows still needs verification), the `better-sqlite3` prebuilt binary, the `%LOCALAPPDATA%` data folder and any future import worker. A Windows 11 ARM VM was available but its encrypted guest could not be opened (STATUS R17-8).

### Windows / Segoe UI visual and font-metric verification — OPEN
- R-17 acceptance was macOS only; Segoe UI metrics for Start, Catalogo, Progettazione, Distinta and dialogs are unverified.

### Cross-machine and GUI acceptance — OPEN
- Manual GUI acceptance on a second Mac was never recorded (STATUS 2026-09-24 audit; README transfer boundary). Dark theme was explicitly not redesigned or verified in R-17.
- The independent-installation `.lqp` round-trip matrix and gap analysis are consolidated in §5; this entry retains the GUI/platform acceptance work.

### Developer tooling and CI — DEFERRED
- No CI configuration. METEL import and engineering imports are developer CLIs (see lifecycle, §2). The reproducible development bootstrap is a review candidate ([STATUS](STATUS.md), [workflow](README.md#bootstrap-a-full-development-catalogue)); it also fixes `dev-import.ts` to honor the explicit `seedFolder` for `familySeed`. It does not close production import orchestration/update work. Migration `0003_conscious_mole_man` was replaced by `0003_talented_silver_sable` (`e044449`); any database that applied the old one is refused — no build has been distributed.

---

## 7. Unresolved historical roadmap items

The repository defines **R-02, R-03, R-12, R-15, R-16, R-17, R-18, R-19** and **Q1–Q29** (DD §16). The labels below are not defined anywhere in the repository or its git history (all branches searched); their original scope **could not be established**, so they are kept as identifiers only. Where the request that created this backlog described them, the description is noted, together with what repository evidence says about that behaviour.

| Label | Description supplied with this consolidation | Repository evidence | Remaining work |
|---|---|---|---|
| R-08 | stale engineering-data behaviour | `engineering_data_stale` blocks structural choices (DD 8.3, M3A) | the lifecycle/refresh part is in §2 "Engineering-data lifecycle"; nothing else identifiable |
| R-11 | remaining Apparecchi drag/drop | delivered by R-16e, R-18, R-19b | keyboard alternative only (§1) |
| R-13 | device compatibility/placement | backend `placementTargets`, device discovery by Pannello (R-16/R-18/R-19b) | incompatibility guidance (§1); original scope otherwise unknown |
| R-14 | compact "Posiziona su pannello" palette | the palette existed in the V1 refinement and was superseded by the unified pool in R-16e (STATUS) | none; the link between the label "R-14" and that palette cannot be proved from the repository |
| R-01, R-04 – R-07, R-09, R-10 | — | no mention anywhere | none known |

### Legacy DD open questions (not blocking; kept for completeness)
- Q1/Q8 lifecycle-code and lead-time decode tables (raw codes stored; availability never claims confirmed orderability); Q5 METEL marchio sigla uniqueness; Q6 confirm `better-sqlite3` defensive mode; Q7 official FSC/FST family-code width; Q10 product succession inside a family (`manual_excluded` / `replaced_by`); Q12 format of family successor relationships. Q2 (purchase discounts) and Q4 (numbering) have homes in §4 and §5.
- Q3 installed-brand activation is implemented through Gestisci marchi, alongside dependency-checked commercial-data removal and reinstallation ([contract](docs/BRAND_MANAGEMENT.md)). Engineering-source removal, source-archive/backup retention and catalogue reset remain separate work.

---

## Reconciliation notes (found complete or superseded; not backlog)

- **Delivered:** capacity-kind and source-brand mapping seeds participate in TiQuadri import identity. The existing development sync detects changes to either seed and preserves manual overrides.

- **Delivered:** Quote shows a combined width by default for multiple measurable Carpenterie, excluding visual gaps. Larghezze combinate switches between total and individual widths in the drawing and PDF.
- **Declined:** anchoring Fronte Quadro text boxes to Carpenterie and changing how boxes handle overflow. Per-box font size is already available.
- **Done:** the quit lifecycle failure was verified on baseline `21cadc5`: the approved re-entrant `before-quit` pass closed `lq.db` before the original promise's unconditional menu refresh. The correction skips only that post-approval refresh, preserves cancelled/failed refreshes and the existing dirty-project decision flow, and passed isolated native macOS no-project, repeated-request, cancel and save-and-quit acceptance. Full evidence is in STATUS "Application shutdown".
- **Done:** R-16 (grouped navigation, pool, backend `placementTargets`, drag/drop; live accepted 2026-09-28), R-18 (free positioning), R-17a–d5/R17-8 (visual redesign), R-17b.1 (multi-Carpenteria), R-17c (selection, Proprietà, `removePhysicalRoot`/`unplaceSubtree`), R-19a/R-19b (Din generico), R-02/R-03 (hidden browse prices, `Fuori listino`), Q22 core, Q27, M1–M4.
- **Q25:** the model-context foundation is Revision 8.3 and the structural picker is M3A; only the unapplied fields in §2 remain. **Q28:** answered — orphan ranges and range 99999 have `design_navigable=0` and are excluded from structural discovery (DD §16 Q28).
- **Superseded wording:** the V1-refinement "Posiziona su pannello" palette and renderer-generated zone targets (replaced by R-16e); the R-16 "known limitation" that a direct API call could move a support without the context check (closed by the shared move path in R-17b.1).

### Documentation drift observed (not corrected here)
- DD §16 Q25 still says "The Progettazione picker UI is still pending" (M3A implemented it) and Revision 8.1 item 6 says context fields "are not applied" (Revision 8.3 applies `Armadi_Compatibili`).
- STATUS "Next work" still says R-17d2 "is on review, and later R-17d slices are pending" (all of R-17 is merged); "Current baseline" still names `1e2df64`.
