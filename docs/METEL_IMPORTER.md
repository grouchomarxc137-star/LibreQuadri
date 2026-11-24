# In-app METEL importer


Installed brands can now be disabled, reactivated or removed through
[Gestisci marchi](BRAND_MANAGEMENT.md), with dependency checks, backups and
same-file restoration. Existing project snapshots are retained.

Open **Listino → Aggiorna listino…**, or use the Start screen's update button.
Click a **Sorgente** card to choose its file, or click a populated card to replace
that file without removing it first. Each card uses its own single-file picker;
the chosen file stays in that card even if earlier cards are empty. Cards are
native buttons and support keyboard activation. **Rimuovi** only removes that
card's file and does not open its picker. Canceling a picker keeps the prior file.
Use **Seleziona file…** to select three files together, drag them into the dialog,
or paste clipboard files where supported by the OS. The three file cards are
non-editable; typing and plain-text paste cannot create or change a source.
The original filename does not decide
the role: headers identify LSP (listino), FSC (discount families), and FST
(statistical families).

## Validation and preview

The application requires exactly one nonempty file of each role, all for the
same issuer. It uses the existing strict fixed-width 020/021 parser and checks
headers, row widths, dates, numeric fields, duplicate product/family identities,
positive multipliers and EUR currency. Original files are Windows-1252. The
dialog submits their original bytes without trimming, padding or text editing.
The underlying import service retains its tested text-encoding support, but
the user interface accepts files only. A source is limited to 64 MiB,
and a delivery to 128 MiB. Unsupported layouts and malformed files block the
whole delivery. Inputs are validated in main and checked again in the worker.

**Verifica fornitura** parses the complete set before creating temporary raw
state. The worker backs up the current catalogue into a private temporary
directory and rehearses the existing normalizer on another copy. The preview
compares the actual before/after databases: new articles and brands, changed
METEL product data and prices, changed families, reactivated issuer listings,
missing issuer listings and products becoming globally unlisted. Up to twenty
missing article identities are shown. Changes above 50% in unit price generate
a warning. Family references absent from the supplied family files remain
unknown with a visible warning, preserving the established normalization rule.

An LSP is treated as a **complete issuer listino**, not an incremental patch.
Syntactic validation cannot prove a file is complete when it ends on a valid
record boundary; confirmation explicitly requires the user to check completeness
and accept the displayed removals. Same-date revised deliveries are identified
by their content hashes and generate a warning. FSC/FST headers provide no
delivery date, so matching issuer identity cannot prove their release date.

Older deliveries require explicit confirmation for history-only normalization;
they do not replace the current listino or delist current articles. A repeated
delivery fingerprint is a no-op and cannot be applied from the preview UI.
Removing or replacing any source invalidates the displayed preview.

## Activation and recovery

Preview writes only temporary files. It does not change the installed catalogue,
installation `metel_raw.db`, archive or backup directories. A worker retains the
validated sources, parsed raw staging database, reference seeds and preview token.
The worker's persistent catalogue connection records SQLite `data_version`.
Changes by another connection invalidate the preview, including preference
writes; the user must verify again.

On confirmation, the worker checks the token and catalogue generation, creates
and verifies a SQLite catalogue backup under `backups/metel-*.db`, then archives
the original bytes and SHA-256 provenance under:

```text
imports/metel/<issuer>/<delivery-fingerprint>/
  LSP.txt
  FSC.txt
  FST.txt
  manifest.json
```

Archive publication uses a staging directory and rename; an existing archive
must match all three source hashes. The unchanged catalogue generation is
checked again **inside the normalizer's immediate writer transaction**, before
the first write. The existing normalizer owns the single `lq.db` transaction:
products, per-issuer listings, price history/current markers, families, links,
classification, enrichment, navigation and delivery provenance commit together.
Any failure rolls back that entire transaction. No transaction writes both
SQLite files. The application does not merge temporary raw rows into installed
`metel_raw.db`; original archived sources are sufficient for rebuilding them.
The existing developer CLI retains its own raw-database behavior.

Backups and a fully archived source set may remain after a failed activation;
they are recovery evidence, not a partially active delivery. A committed
`app_import_delivery` row remains the authority for activation. Temporary-file
cleanup cannot turn a committed result into an error. A process crash leaves
SQLite to recover/roll back its transaction; a leftover private temporary
directory may remain. No automatic reset or backup restoration is attempted.

The worker keeps bulk work off the Electron main thread. During normalization,
engineering article links are refreshed through their existing row
primary keys, with unchanged links left untouched. This avoids rescanning the
engineering tables for every manufacturer article while preserving the same
identity resolution and transaction boundaries.

While verifying or applying, the dialog footer displays an animated loading indicator and the
current operation stage, outside the scrollable content. The same indication
appears immediately while reading selected files and clears on success or
failure. The spinner is static when reduced motion is requested; the status
text remains visible and is announced through a live region. No percentage is
invented. The dialog disables edits/close, application quit/window-close waits,
and native menu writes/dialog switches are withheld. Configuration requests and
project IPC are refused while applying, avoiding mixed catalogue generations.
Catalogue reads can continue against the installed SQLite WAL snapshot.

## Catalogue and project semantics

Absence from an issuer's newer/current LSP clears **only that issuer's listing**.
Another issuer's listing can keep the product listed. A product absent from all
issuer listings becomes fuori catalogo; its identity, history and project
references are retained. A returning article reuses its identity and is listed
again. METEL lifecycle status codes remain raw; listed does not prove orderability.

New METEL brands are created using the existing generic identity model. Their
commercial catalogue is available without a manufacturer-specific importer.
METEL alone does not provide the engineering models or drawings required for
panel configuration/placement. FSC supplies family codes/descriptions, not the
installation's negotiated discount percentages.

The importer never opens, reprices or rewrites `.lqp` project files or their
working copies. Existing project product/price/discount/engineering snapshots
remain authoritative. After success, an application event refreshes catalogue
overview and remounts catalogue-dependent project workspaces; temporary UI
selection/viewport state may reset. Explicit project repricing remains separate.

## Verification

`test/metel-import-session.test.ts` covers role detection, text encoding, missing
or duplicate roles, mixed issuers, malformed/empty lists, duplicate articles,
unsupported currency, a real rehearsal/apply, backups/archives, price changes,
new brands, multi-issuer delisting, reactivation, older deliveries, idempotence,
stale preview refusal, failed rehearsal, failure during live price insertion and
preservation of an open saved project's snapshots and file bytes.
IPC tests cover sender and payload validation; mounted renderer tests cover
confirmation, source changes, failure, busy/close behavior and stale-plan retry.

The initial real-file acceptance used an isolated clone of the Alpha 1 catalogue
and the local `SIELSP_20261001.txt` with FSC/FST. Its content header declares
`202601`, valid `2026-01-01` despite its filename. Preview: 68,382 articles,
265 additions, 9,609 changed product records, 2,835 changed prices, six changed
families, six unknown references, no delistings. Activation and same-delivery
repeat detection passed, with empty foreign-key checks and SQLite `quick_check=ok`.
Private evidence is under `build/metel-acceptance-vehTSw/acceptance.json`.

Native Electron UI acceptance used the isolated `build/metel-ui-AxsQQ7/` catalogue:
all three files were selected through the native chooser; one complete delivery
added brand ZZZ and two articles, and a second complete delivery retired one.
The overview refreshed to ten brands and one unlisted article. SQLite confirmed
the retained article listed and the missing article unlisted, with `quick_check=ok`.

The Desktop Alpha 1 executable remains the earlier baseline. Build the updated
checkout with `npm start` to test this importer. Packaged distribution acceptance,
archive/backup retention management, catalogue reset, engineering-source imports
and explicit project repricing are separate work.
