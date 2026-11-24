# LibreQuadri Alpha 1 — internal macOS testing


This document describes the Alpha 1 packaging profile. See
[Alpha 1.1](ALPHA_1_1.md) and [Beta 1.0](BETA_1_0.md) for other profiles.

Alpha 1 packages the current application as `LibreQuadri Alpha 1.app`, version
`0.1.0-alpha.1`, with bundle ID `app.librequadri.alpha1`.
This is the baseline for testing before the production METEL importer is added.
It includes the current source checkout's application functionality and theme settings.

## Prepare and package

Use the private source layout in [EXTERNAL_DATA.md](EXTERNAL_DATA.md), with
complete BTI, SIE and SNR LSP/FSC/FST deliveries and the three TiQuadri MDBs.
Run on the target Mac:

```sh
npm run prepare:alpha1 -- "/absolute/path/to/private-source-root"
npm run package:alpha1
```

Preparation creates a fresh `build/alpha-1/bootstrap-*` catalogue using the
current migrations, seeds and engineering adapter. It validates the Alpha 1
inventory: 122,535 products, nine brands, 10,800 models (7,823 active and 2,977
obsolete), 4,120 referenced drawings and 4,098 resolved drawings. The existing
21 missing drawings and one invalid placeholder retain their fallback behavior.
Readiness, model provenance, SQLite integrity, migration history and every
bundled SVG are checked using the current application's own readers.

The closed seed is `build/alpha-1/alpha-seed/`. Packaging includes only compiled
application files, production dependencies, migrations, reference seeds, the
validated catalogue and its referenced normalized SVGs. Original sources, raw
METEL database, user projects and backups are excluded. SQLite's native module
is rebuilt in staging for the installed Electron version. `build-info.json`
records the source revision, changed tracked paths and build time.

Output on arm64:

```text
out/alpha-1/LibreQuadri Alpha 1-darwin-arm64/LibreQuadri Alpha 1.app
```

Copy the complete `.app` to the Desktop. Existing seed and package destinations
are refused; preserve previous outputs before intentionally rebuilding.
Alpha 0's frozen profile and output paths remain separate; see ALPHA_0.md.

## Application data and verification

Alpha 1 selects `~/Library/Application Support/LibreQuadri Alpha 1/` before
Electron is ready. Packaged environment overrides cannot redirect this root.
First launch validates and provisions its own catalogue and drawings. Relaunch
preserves an existing database; interrupted provisioning fails visibly instead
of replacing data. Project documents use the normal explicit Open/Save workflow.

Automated real-data acceptance can be run against the fresh bootstrap root:

```sh
LIBREQUADRI_ALPHA1_DATA_ROOT="/absolute/path/to/build/alpha-1/bootstrap-…" npm test -- test/alpha1-seed.test.ts test/data-paths.test.ts test/alpha-theme.test.ts test/alpha-seed.test.ts
```

Also run typecheck, build and the application test suite. Verify the actual
packaged executable launches, provisions the isolated root, displays the
catalogue and relaunches with its installed data. Manual testing should cover
creating/opening a project, catalogue browsing, Progettazione, quotation and PDFs.

This unsigned internal build targets the build Mac's architecture. Windows,
signing, notarization and external distribution are outside this milestone.
Bundled-data redistribution rights remain the existing open Q14 decision.
