# Project engineering snapshot lifecycle / safe refresh


Implemented for review on `review/project-engineering-refresh`, from main `a1ca88f7fe8bbd4bd360cc495fb47cba87d78f68`. This branch is not merged. The installed adapter-staleness foundation is already merged at that base.

## Document contract

Current `.lqp` format is **10**. Migration `0009_engineering_provenance` is additive, with no catalogue reads and no engineering reinterpretation. Its four nullable TEXT fields are:

| Field | Meaning |
|---|---|
| `engineering_provenance` | NULL legacy unknown, `manual`, or `import` |
| `source_adapter_code` | Portable registered adapter code for an import |
| `source_adapter_version` | Canonical positive integer text, matching installed lifecycle semantics |
| `source_import_fingerprint` | Lowercase SHA-256 of the historical import generation |

NULL and manual require all source fields to be NULL. Import requires all three. SQL constraints and incoming validation reject incoherent/malformed provenance, even if a received file has bypassed its own CHECKs. Local `source_import_id` is never stored. Manifest is generated/checked with the existing project tooling. Older apps refuse unknown migration prefixes through the existing newer-version gate.

`resolveConfiguration` carries provenance from `modelEngineeringProvenance` and the existing `readEngineeringReadiness`/import metadata. The registered adapter descriptors remain the only version authority. Normal insertion, structural insertion and preset creation share `insertConfiguredItem`/`writeEngineeringSnapshot`; explicit reconfiguration uses the fresh result. Duplica copies provenance. Q22 fills NULL provenance only after existing semantic/context/commercial equality is established; non-NULL provenance is retained.

Opening, copying incoming data, migrating, displaying and saving continue to use project facts alone. Explicit catalogue-backed operations, including the separately approved Carpenteria Stage 2 reconfiguration, acquire an engineering catalogue connection. Opening does not create presets or change engineering facts.

TiQuadri adapter 10 adds explicit front view roles in the existing `symbol_kind` field, without a format change. Legacy views retain historical presentation until this explicit flow updates them. Changed roles appear in the existing `views` diff category; unchanged asset keys preserve embedded hashes. Model definition fingerprints, physical nodes, dimensions, zones, quantities and commerce remain unchanged by the presentation correction. See [adapter-10 lifecycle](ENGINEERING_ADAPTER_LIFECYCLE.md).

## Status

Each item has its own state; UI aggregation is an exact count per state, not a single optimistic status:

| State | Evidence |
|---|---|
| `unknown` | NULL legacy provenance |
| `manual` | Manual snapshot |
| `unknown_source` | Imported adapter has no running descriptor |
| `newer_adapter` | Project version exceeds the running declared version; refresh refuses downgrade |
| `older_adapter` | Project version precedes the running declared version |
| `catalogue_unavailable` | Same declared version, but catalogue/source is missing |
| `catalogue_stale` | Same declared version, but installed source is not ready |
| `current_generation` | Ready source, same adapter/version/fingerprint |
| `other_generation` | Ready source, same adapter/version, different fingerprint |

Version comparison uses arbitrary-precision integers after canonical-text validation. Version inequality is detectable without a catalogue. Unknown is never equated with current. Legacy verification requires a ready source and matching stable facts.

## Resolver and gates

`engineering-refresh-resolver.ts` uses `(brand_marchio, model_code)` and requires exactly one active, non-obsolete match of the same kind. Definition/source references and configuration fingerprints are evidence, not portable lookup keys.

Selections map by dimension/value codes. Root options require NULL parent; dependent options require a previously mapped parent. Exactly one complete mapping must exist. Missing/ambiguous choices refuse refresh. The resolver must produce the identical stable selection set, including defaults; a new required/default axis cannot silently alter it. Only `complete` and `price_incomplete` are accepted. Physical enclosure/support/device configurations require a valid profile of the same kind. Unknown engineering contexts are not safe refresh results.

Q22 catalogue-backed additions matching an existing configuration check known older/newer adapter provenance before comparing snapshots or writing commerce. They refuse with `project_engineering_stale` / “Aggiorna i dati di ingegneria del progetto.” A difference only in `editableWhenPlaced` remains a `selections` engineering change and can be adopted only through explicit plan/apply. The refusal does not alter quantity, provenance, editability, physical nodes, dirty state or the saved file. After a safe explicit refresh, ordinary Q22 merging resumes. Unknown provenance still requires full semantic equality before it may be filled; duplication remains snapshot-only.

Commercial contribution must remain identical. BOM comparison uses linked product brand/article code, per-item engineering quantity and the same effective role serialization as initial insertion. Local product IDs and prices are not identity. Missing links, missing snapshot identity, changed quantity/composition/role or contribution block the project. Current prices may change or disappear: no price fields or commercial status are rewritten.

## Plan and transaction

`project:engineering-plan` requires a saved path and resolved recovery (Save As first for a recovered copy). An automatically repriced working copy can still be reviewed before saving. Other unsaved edits must be saved first.

Every item is unchanged, verify, refresh or blocked. The plan lists engineering categories, actual changed labels, calculated drawing-coordinate changes, item/global blockers and pre-existing issues resolved/remaining. View dimensions/assets/zones/slots are reported as rendering-related engineering changes even when stored node positions do not move.

Planning serializes the project into an isolated in-memory SQLite database. The serialized image already includes committed WAL pages; its SQLite header's journal-mode bytes are normalized for memory use only. The actual project is never written. A SHA-256 token binds the project image, project UUID/revision/changeVersion, preconditions, source readiness/generations, item targets, resolved facts and report. It therefore also detects edits outside the ordinary session API.

`project:engineering-apply` validates the token syntax and runs under the shared `ProjectLifecycleOperationGuard`. It reads each plan under one consistent catalogue read transaction and recomputes the plan inside one project transaction, requires token equality (`plan_outdated` otherwise), refuses any blocker, writes engineering facts in place and repeats the same complete physical/context assessment. Source generations are checked again after writes, before commit. Recovery bookkeeping and returned-view construction happen before commit. A failed write, assessment or bookkeeping restores the session's dirty/changeVersion and rolls back all SQLite writes. The saved file is never touched. Success marks the working copy dirty; the user chooses Save, Save As or discard. Existing save revisions/backups preserve the previous saved version.

## Write boundary

The shared writer updates these `prj_item` engineering fields: model name/definition fingerprint/source reference, configuration fingerprint/label, physical status, profile code/name, fit class code/label, depth/outer depth/usable depth, context policy, four provenance columns and snapshot timestamp. It rewrites engineering selections, demands, views, zones, zone slots, constraints, exclusions and contexts using the same serializer as initial insertion. Selection source is preserved per dimension. A view's embedded asset hash is retained only when its view code and asset key match; project assets are never deleted or imported by refresh.

It does **not** write item ID/UUID, model brand/code/kind, commercial contribution, primary snapshot ID, commercial configuration status, BOM/product snapshots/attributes, quotation lines, quantities/prices/discounts/labour/groups, user description overrides, project metadata, nodes/stored coordinates/slot assignments, annotations or project assets. Nodes are never recreated, moved, repacked, removed, unplaced or split. Preset relations are not instantiated during refresh.

## Physical assessment and mixed interpretation

`assessProjectPhysical` is read-only and reuses the existing placement engine: quantity/placed counts, cycles/depth, resolved physical kind/view, parent/ancestor classes, legitimate match-container bindings, exclusions, zones/orientations, slot existence/occupancy, linear/DIN capacity and half-module demand/pitch, stack fit/alignment/capacity, overlap, stored fixed/packed placement. It also checks enclosure → support → device containment and saved placed-support/root contexts.

Each node is also assessed independently of unrenderable ancestors, with positioning and compatibility rule families separated through the same engine. A pre-existing ancestor/binding/class failure cannot mask a new failure in a different rule family. Pre/post issue identity is node UUID + failure code: existing issues may remain, resolved issues are reported, and any new failure blocks apply. Geometry differences are reported without changing stored positions.

`project_engineering_stale` protects relevant known older/newer adapter physical chains in design discovery/navigation, candidate/structural insertion, pooled-support targets/write (explicit and packed), and catalogue-assisted cross-root transfer (source and destination chains). Its message is “Aggiorna i dati di ingegneria del progetto.” Unknown provenance alone never triggers this guard. Snapshot-proven rendering/movement/editing continue to consume saved facts without catalogue checks.

On open, the main process automatically applies a verified engineering plan when all changes are limited to provenance and display labels, with fingerprint updates allowed alongside those changes. Geometry, fit rules, and blockers route the entire engineering plan to review. The renderer offers “Verifica…” and “Continua con dati salvati”. Progetto → “Verifica dati di ingegneria…” is always available for an open project. The dialog shows differences and placement conflicts before explicit apply.

A separate open-time pass updates eligible unlocked EUR list prices from the local catalogue. The notice shows the previous and updated quote totals. Both passes update only the working copy, and each pass can fail independently. Recovered sessions and repeated requests for the current session skip reconciliation.

## Validation and boundaries

Synthetic regression uses generic engineering models and commercial products: historical `match_container` support, previous adapter version, current binding `none`. It proves safe correction, UUID/placement/commerce preservation, newly allowed device placement, dirty-but-unsaved success and offline save/reopen. The equivalent genuine format-9 document migrates to unknown provenance without catalogue calls and is explicitly verified/refreshed.

Negative tests cover model/option identity/ambiguity, inactive models, changed selections/BOM/contribution, physical/context failures, current-source staleness, newer provenance, stale plans, dirty/recovered/absent-catalogue preconditions, transaction/bookkeeping failures, unchanged commercial tables, provenance copying/Q22 and malformed incoming format-10 data. Existing placement/configured-item/lifecycle/IPC/renderer/adapter suites remain part of validation.

Real-data acceptance is explicitly gated:

```sh
LIBREQUADRI_ENGINEERING_REFRESH_REAL_DB=/absolute/path/to/scratch/lq.db \
  npx vitest run test/project-engineering-refresh-real-data.test.ts
LIBREQUADRI_REV83_REAL_DB=/absolute/path/to/scratch/lq.db npm test
```

The refresh acceptance itself makes another scratch copy via a read-only source connection and `VACUUM INTO`. Cases: MW250 support 1240/device 1556; DIN support 1234 with Spia LED 8530, Falsi polo 1777 and active Centrale di misura F4N200 8848. Historical binding/provenance is synthesized only in scratch project snapshots. Model 1805 is retired and is deliberately not a production exception. No real project or installed catalogue is mutated by these tests.

Remaining OPEN work is unchanged: catalogue import/update orchestration and UI, backup pruning, source identity/rights, packaging and the other R-15 work in BACKLOG. No MyHome/composite, CEE insertion, Armadi_Compatibili/Incompatibilita, linker, variant discovery, preset removal, repricing, placed-item reconfiguration, undo/redo or broad UI changes are included. Live native UI interaction is not asserted by the automated renderer checks.

Validation on 2026-10-06: focused 12 files / 248 tests; isolated real refresh acceptance 4 tests; full suite with both real-data gates targeting a scratch adapter-8 catalogue 89 files / 1,188 tests, all passed and none skipped. Manifest generation/check, typecheck, build and diff checks passed. The existing multi-backup save/reopen test uses a 20-second timeout after a full-suite run exceeded its original 5 seconds; no assertion was relaxed.

Carpenteria Stage 2 uses this existing readiness/provenance and stable-code resolver to prove the old enclosure snapshot before an option change. It requires current known provenance throughout the affected subtree, preserves historical retained article commerce, and validates the entire subtree in one undoable transaction. This is a separate explicit operation; engineering refresh itself retains its frozen commerce/nodes contract. See [Stage 2](CARPENTERIA_RECONFIGURATION.md).
