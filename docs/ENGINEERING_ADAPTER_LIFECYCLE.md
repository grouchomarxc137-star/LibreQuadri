# Installed engineering adapter lifecycle


An engineering adapter version describes how an external source is interpreted. It is independent of SQLite schema migrations and the `.lqp` format version. TiQuadri's single authority is `TIQUADRI_ENGINEERING_ADAPTER` in `src/main/sources/tiquadri/adapter.ts`; the small `engineering-adapters.ts` list makes that descriptor available to generic readiness checks without loading the MDB importer.

The importer uses that same descriptor for its fingerprint, `app_source_import.adapter_version` and report. Readiness reads the normalized import metadata, not report JSON, raw source files, product codes or family names. `became_current = 1` identifies the installed generation; each import-owned model must reference its provenance row through `source_import_id`.

| Installed source metadata | Result |
|---|---|
| No source import exists | `missing` / `not_imported`; existing empty discovery and unavailable-container behaviour remain |
| Exactly one current import, canonical positive integer version equal to the declared version, valid lowercase SHA-256 fingerprint | Source `ready`, subject to existing model, physical, context and navigation checks |
| Older **or newer** version | `engineering_data_stale` / `version_mismatch` |
| Missing/malformed portable fingerprint | `engineering_data_stale` / `invalid_fingerprint` |
| Missing, null, empty or malformed version | `engineering_data_stale` / `invalid_version` |
| Imports exist but no current row, or multiple current rows | `engineering_data_stale` / `missing_current_import` or `ambiguous_current_import` |
| An imported model has no valid provenance row | `engineering_data_stale` / `missing_provenance` |
| A model references a historical generation while the source is current | `engineering_data_stale` / `noncurrent_import` |

Version equality is exact after validating the stored format (`^[1-9]\d*$`). No inequality or compatibility inference accepts a newer adapter. An adapter increment alone invalidates older imports; no version-specific runtime change is needed. Manual models keep their existing readiness rules. Other sources without a declared engineering adapter retain their existing rules; future engineering adapters must declare and register their version.

`readEngineeringReadiness` supplies the shared source and model check. `MainDatabaseService.engineeringSourceStatus()` exposes internal diagnostics: adapter code, installed and required versions, state, reason, import IDs and current import fingerprint. These are not a second UI status system: structural discovery and guards use the existing `engineering_data_stale` result and renderer notices. Configuration throws `EngineeringDataStaleError` with structured diagnostics and the existing user message, “I dati di ingegneria sono obsoleti: reimporta il catalogo.”

Protected catalogue-backed boundaries:

- `discoverDesignCandidates` / `discoverDesignRangeNodes`: Carpenteria discovery and Pannello/Apparecchio compatibility discovery return no partial candidates while a relevant imported source is stale.
- `guardDesignCandidate` / `guardConfiguredStructuralItem`: candidate add and already configured support eligibility both check the source and the destination root before using imported engineering facts.
- Configuration model lookup/detail and node/product model lists share `assertEngineeringModelCurrent` / `assertEngineeringModelsCurrent`. The configuration resolver reads through this boundary, protecting structural add, configured-item add and reconfiguration, including preset resolution.
- The existing `ProjectDocumentService.structuralPlacementGuard` uses the configured-item guard for pooled Pannelli `placementTargets` and `placeStructuralItem` (both explicit and packed insertion). Legacy cross-root transfers consulting live catalogue data cannot receive an accepting verdict from stale data.

Commercial METEL search/browse, price snapshots and ordinary article insertion do not call the engineering guard. Existing schema health, missing-container, context-staleness, navigation and import-error behaviour remain separate; a failed import rolls back the current marker and normalized data together.

Readiness is read for every operation, rather than cached at startup. A successful current-version reimport clears installed-source staleness without restarting. A matching fingerprint skips work only when its import is the sole current generation and its recorded version matches the descriptor. A historical fingerprint, ambiguous current marker or damaged version is reimported transactionally, reusing its provenance ID rather than merely switching the current marker; normalized facts are rebuilt.

## Explicit development synchronization

`npm run sync:engineering -- [--check] [--data-dir <development-root>]` uses the
same importer fingerprint functions and existing readiness authority. Archived
MDB roles/hashes/sizes come from the sole current import metadata; missing,
corrupt, ambiguous or newer-adapter evidence refuses synchronization. It does not
migrate a catalogue, change readiness rules or refresh any `.lqp`. Engineering
and drawing work are independent; drawing identity is recomputed after engineering.
Historical drawing fingerprints are rebuilt transactionally rather than accepted
as the current asset generation. Current matching inputs do not create backups.
The sync preflight checks only active imported models: inactive historical
models legitimately retain older imports. Missing/dangling provenance and active
TiQuadri models bound to a noncurrent import refuse synchronization, including
while the current adapter is older. Existing runtime readiness checks are not
changed or bypassed.

The unchanged engineering fingerprint includes adapter code/version, master and
optional ListinoBT byte hashes, and hashes of the parsed seed data from exactly
`range-navigation.json`, `tiquadri-commercial-contribution.json`,
`tiquadri-capacity-fillers.json` and `tiquadri-front-presentation.json`.
`capacity-kinds.json` and `source-brand-map.json` also affect imports but are not
fingerprinted. Changes to those two alone can be missed by a matching import;
their coverage is an [OPEN compatibility issue](../BACKLOG.md#engineering-seed-fingerprint-coverage--open-compatibility-issue),
not a formula change in this correction. No second fingerprint authority exists.

Archive validation still verifies every byte's SHA-256 and recorded size. MDB
schema, nonempty row count and a readable first identity row are checked without
decoding the entire DXF memo column. The reader still requires full MDB buffers,
but the planner returns file paths and metadata rather than retaining the bytes.
Frozen files are copied into separate role directories under their recorded
original basenames and rehashed before any backup/import, preserving filenames
and detecting source changes during freezing. Previously overwritten filenames
are preserved as recorded; no original-name reconstruction is attempted.

The write path acquires SQLite `locking_mode=EXCLUSIVE` **before any query**, then
`BEGIN EXCLUSIVE; COMMIT` on an existing WAL catalogue. WAL connection locks
exclude already-open idle/read/write connections and remain held across commits,
asynchronous backup, engineering and drawing transactions until close. Acquiring
only a write transaction or checking Electron `SingletonLock` would not provide
this guarantee. Filesystem/release/alias checks fail closed before opening the
catalogue. No application runtime change is needed: SQLite itself excludes its
connections, including older development builds and the existing developer CLIs.
This covers cooperative SQLite access on a local filesystem, not external file
replacement or manual archive changes during maintenance.
The checker runs as a separate CLI process. Development startup closes its
catalogue connection before invoking the exclusive apply path, then reopens it
before project verification. Raw open/read/close in the lock holder
would cancel POSIX SQLite locks ([SQLite's documented restriction](https://sqlite.org/howtocorrupt.html#_posix_advisory_locks_canceled_by_a_separate_thread_doing_close_)).
The apply path never raw-reads the target DB; concurrency tests put existing
readers/writers in independent processes so hashing cannot disturb their locks.

`--check` inspects a verified private copy of DB/WAL and never opens SQLite on the
target, including when the target lacks WAL/SHM files. Development startup
attempts an upgrade only when it finds an older TiQuadri adapter. Each importer still owns its
transaction; an interrupted later phase is resumed by rerunning the command.
Private/source snapshot hashes are compared in bounded chunks rather than
retaining both database images in memory. Contention (`SQLITE_BUSY`/`SQLITE_LOCKED`,
including extended codes) is distinguished from corruption, I/O failures and
unsupported journal modes; cause chains remain available in CLI diagnostics.

The CLI catches `SIGINT`/`SIGTERM` by requesting interruption rather than closing
SQLite or deleting inputs from the handler. It waits for the current importer
and async backup to settle, observes interruption between phases, then closes
the connection and removes only its own temporary directory. The current import
may commit before interruption is observed. Repeated signals cannot force early
cleanup. Synchronous parsing/transactions delay signal dispatch; explicit
`setImmediate` checkpoints let pending signals run after settled phases,
including final drawings, while exclusion and frozen inputs are still held.
The CLI also yields/checks before reporting success and removing its handlers;
interruption reports exit 130 (`SIGINT`) or 143 (`SIGTERM`), without success JSON.
Completed phases are not rolled back. A crash, `SIGKILL` or power loss can leave temporary files; no automatic
stale-directory deletion is safe without knowing the owner has exited. SQLite's
OS exclusion is released by process exit; existing backup/transaction recovery
and an explicit rerun remain authoritative.
[Usage, refusal/recovery and platform limits](EXTERNAL_DATA.md#engineering-synchronization).

## Project snapshot lifecycle (format 10, explicit only)

The installed-source guard was merged at `a1ca88f`; it is not an unmerged candidate. The subsequent project milestone records portable historical provenance in `.lqp`, obtains the current fingerprint from this same readiness/import authority, and adds independent per-item/project status plus explicit safe verification/refresh. No second adapter-version or readiness authority exists.

Open/migration/view remain catalogue-free and never enrich snapshots. A separate renderer request can report older/newer/unknown provenance. Only the explicit plan/apply flow re-resolves stable model/selection codes against a ready source. It freezes commercial contribution, linked BOM identity, price snapshots and stored physical nodes/coordinates. Any blocker or newly introduced physical/context failure refuses the whole refresh. Success marks the working copy dirty without saving; failure rolls back. Newer project adapters cannot be downgraded. [Full project lifecycle](PROJECT_ENGINEERING_REFRESH.md), [database format and boundaries](DATABASE_DESIGN.md#712-project-engineering-snapshot-lifecycle-format-10).

Known older/newer project chains also refuse catalogue-backed design discovery/navigation, structural add, pooled-support placement and catalogue-assisted root-transfer checks with `project_engineering_stale` / “Aggiorna i dati di ingegneria del progetto.” Unknown provenance alone does not trigger this guard. Snapshot-only operations keep their saved-fact semantics.

**Adapter 9 (capacity fillers).** TiQuadri adapter 9 adds the reviewed capacity-filler designation: `db/seed/tiquadri-capacity-fillers.json` names pack 1777 "Falsi polo" (the executable's `ANA_MODALITA` 13497, label 85) as the `din_rail` filler. Each import re-validates the entry against the source (pack name, modalità, single label axis, active device, every option profile demanding only `din_rail`), writes `cat_config_capacity_filler`, reports `summary.capacityFillers` and records a `capacity_filler` conflict instead of designating on any mismatch. The seed is part of the import fingerprint. Model definition fingerprints are unchanged (10,800/10,800 identical between adapter 8 and 9 on the v32 source), so existing projects need only the explicit engineering verification (provenance) after the catalogue is reimported; until then catalogue-backed operations report `project_engineering_stale` as designed.

Remaining R-15 work is catalogue import orchestration/UI and maintenance, not project snapshot refresh. There is no importer/reset GUI or METEL refresh/repricing in the project milestone.

**Adapter 10 (front presentation).** The existing view `symbol_kind` now carries explicit `physical_panel` and `mounting_guide` roles. Ordinary physical panels retain their asset keys and vector artwork; unavailable artwork gets a solid printable fallback. Only the reviewed Idroboard profiles for packs 2898–2902 receive `mounting_guide`: transparent dashed editor footprints, omitted from PDF graphics. The adapter re-validates pack identity/name, panel family, centralino/DIN flags, `senza` and dimensions against `db/seed/tiquadri-front-presentation.json`. A mismatch records a `front_presentation` conflict and withholds the designation. Other `senza` families keep their legacy symbol kinds and print policy. The reviewed seed joins the existing source/import fingerprint inputs.

Reimport installed TiQuadri engineering under adapter 10; drawing assets need no reimport. All v32 model definition fingerprints remain identical to adapter 9, because geometry and configuration identities have not changed. Existing projects adopt changed view roles only through explicit engineering refresh (`views` changes); unaffected items need provenance verification. Retain asset keys so existing embedded hashes survive refresh. There is no schema or `.lqp` format change. Legacy/unclassified snapshots retain historical rendering, including dashed printable missing-artwork supports, until refreshed; opening, duplicating or exporting never consults the catalogue to reinterpret them. Earlier releases can read the storage but cannot provide adapter-10 rendering semantics.

Regression coverage lives in `engineering-adapter-lifecycle.test.ts` and `tiquadri-navigation-groups.test.ts`, including a declared-version increment against the same source bytes, changed fingerprint and restored readiness after actual reimport. Synthetic and licensed real-data import tests retain the regression that `Test_Compatibilita_Contenuto` never creates `match_container`; no product or family workaround is involved.

**Adapter 11 (Carpenteria reconfiguration, Stage 1 import foundation).** Enclosure drawing profiles now include achievable sums of `Aumenta_Famiglia` across independent axes, with one option per axis and the source's parent-option dependencies. Repeated matching source rules each contribute their delta; equal resulting keys are imported once. The original base and single-delta profiles retain their identities. A combined key is imported only when `ASS_ARMADI_BLOCCO` supplies that block; a missing block is reported as `enclosure_variant_without_block`, never synthesized from a neighbouring drawing. Every variant retains its enclosure's measured geometry, fit class, zones and preset semantics. No generic runtime manufacturer rule was added.

`Modalita_1_Modificabile_Nel_Pannello` and `Modalita_2_Modificabile_Nel_Pannello` now populate the existing generic `cat_config_axis.editable_when_placed`. Every contributing row for a model/label, in either slot, must explicitly permit modification. False, missing or unknown permission locks the axis. Mixed axes remain locked and produce `axis_editability_mixed` report entries and persisted `axis_editability` conflicts with permitting/locked contribution counts. `Test_Compatibilita_Contenuto`, `Segue_Modalita_Pannello` and the macrofamily flags keep their previous unapplied policies. Importing permission metadata does not implement any reconfiguration backend or UI.

Reimport installed TiQuadri engineering under adapter 11; adapter 10 is stale by the existing exact-version authority. Reimport drawings as well: the inventory of referenced keys has changed and participates in the drawing importer fingerprint. Projects stay at `.lqp` format 10 with unchanged persistence. All v32 model definition fingerprints remain identical to adapter 10; explicit engineering verification/refresh adopts the new axis facts and provenance for existing snapshots. Open/save/duplicate/export never reinterpret or unlock saved axes automatically. Snapshot-only operation boundaries remain unchanged.

Isolated v32 acceptance adds **144 profiles** across **48 HDX packs** (1,236 → 1,380 enclosure profiles, 9,432 → 9,576 total profiles), preserving all 9,432 old profile identities and all 10,800 model definition fingerprints. HDX pack 108 resolves all eight Frontale × Zoccolo variants, blocks **311–318**. Active axes: **9,505 editable / 1,264 locked**, including **16 mixed device axes**, all locked and reported; all 1,989 active enclosure axes are editable. The new profiles share **24 newly referenced drawing keys**, all resolving through the runtime asset reader after actual drawing reimport. Overall drawings: **4,098 / 4,120** resolved, with the unchanged 21 missing keys and one invalid `senza` placeholder. Primary source discrepancies and import errors are empty; historical article-link/module discrepancies remain reported.

Regression coverage adds `tiquadri-enclosure-profile-deltas.test.ts` (alternative choices, dependencies, repeated rules, negative/unconditional deltas and editability aggregation) and `tiquadri-carpenteria-stage1-real-data.test.ts`. The latter requires `LIBREQUADRI_CARPENTERIA_REAL_DB` pointing to an **adapter-10** baseline plus `LIBREQUADRI_TIQUADRI_MDB`, `LIBREQUADRI_LISTINOBT_MDB` and `LIBREQUADRI_TIQUADRI_DXF_MDB`. It makes a SQLite backup and copies all three source files into a private temporary directory before mutation. It checks every one of the 144 combined resolutions, old identities, every imported axis against all source contributions, readiness/idempotency and actual drawing conversion/runtime resolution. Never supply an adapter-11 catalogue as the baseline or relabel import metadata to bypass acceptance.

Some real-data suites default to the installed development catalogue. If that import is stale, the engineering guard must refuse those tests' configuration requests too. For current-data acceptance, reimport into a scratch catalogue and run `LIBREQUADRI_REV83_REAL_DB=/absolute/path/to/scratch/lq.db npm test`; never relabel an old import as current to get tests to pass. The installed development catalogue is not updated by validation.

Adapter-11 current-catalogue coverage also includes `tiquadri-enclosure-invariants-real-data.test.ts`, gated only by `LIBREQUADRI_REV83_REAL_DB`. It enumerates all physical-key-effect choices and their parent dependencies on every active, placeable enclosure, completes unaffected axes with valid representatives, and rejects any reachable `no_profile` issue even when a commercial status would mask it. Axes with no physical-key effects cannot change the profile; their Cartesian product need not be repeated. The nine source enclosures without geometry remain outside placement. This invariant is independent of the adapter-10 migration baseline and the source importer's delta helper.

Q22 additions matching a saved configuration inspect its known older/newer adapter provenance before engineering snapshot comparison, commercial checks or project writes. They report the established `project_engineering_stale` diagnostic. Editability remains in the `selections` engineering diff; only explicit project refresh adopts it. Unknown provenance keeps the existing semantic-equality gate and may be filled only after a proven match; snapshot-only duplication remains unchanged.

Alpha 0 preparation/packaging and its positive tests are frozen at **`dbc7243d8f011d2d317937e925c19cfdd17cce77`**, under that revision's actual adapter-10 code. The current `alpha-seed.test.ts` has no adapter mock: `LIBREQUADRI_ALPHA_FROZEN_DB` supplies a scratch adapter-10 catalogue solely for negative acceptance, while `LIBREQUADRI_REV83_REAL_DB` supplies current adapter 11. Neither catalogue can become an Alpha 0 seed under current code: the former fails readiness and the latter fails fixed inventory checks. Historical positive tests run in the historical checkout. No production readiness, inventory or runtime compatibility policy changed. See the [frozen build procedure and verification](ALPHA_0.md#build).

## Carpenteria Stage 2 consumer

The placed-enclosure backend now consumes adapter-11 combined profiles and generic axis editability. It reconfigures one physical node UUID, with no adapter increment, persistence change or manufacturer-specific runtime rule. Known stale project subtree provenance requires explicit verification/refresh; stale installed engineering requires reimport. Saved editability cannot be silently unlocked by reconfiguration. The complete affected subtree and unchanged calculated positions are validated transactionally, with historical retained article prices, current prices for new articles, Undo/Redo and offline Save/Reopen. [Contract and real HDX acceptance](CARPENTERIA_RECONFIGURATION.md).

## Reviewed configuration-level article contribution (2026-10-28)

Catalogue migration `0017_reviewed_panel_empty_bom` adds `cat_config_rule.empty_bom_allowed` (default false). The generic resolver can report an effective `commercialContribution: none` for a support configuration only when an explicitly approved rule matches and there are no resulting article contributions. Optional accessories and other executions continue to resolve as `articles`; missing article links, unknown empty BOMs, invalid choices and unavailable physical profiles retain their rejection paths.

The reviewed TiQuadri cases are packs **1284, 1285 and 1286**, source rows **13611, 13624 and 13638**: Cablaggio in cavo / Tutte le fasi has neither base nor modality articles. Permissions are bound to each complete raw-model fingerprint and precise source row, and future imports revalidate zero base/row article counts. Pack **1283**, the 515×50 blind strip used in the same SDX preset, has no axes or source articles and joins the existing whole-model physical-only approval seed. Other unreviewed article-free models remain commercial/review candidates.

This additive correction backfills the already installed version-11 interpretation only when brand, source, model fingerprint, name and normalized article/condition evidence agree. Adapter readiness remains unchanged; no global reimport is required to use a verified installed catalogue. Future import identity includes both approval policies, so updated imports cannot silently reuse a prior interpretation. Raw model definition fingerprints and billable configuration identities remain unchanged. Normal project refresh compares the effective contribution of the saved choices, rather than the model-wide commercial capability. No project-format migration, repricing or automatic regeneration of saved enclosure contents occurs.
