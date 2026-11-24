# LibreQuadri Alpha 1.1 — internal macOS testing


Alpha 1.1 includes the atomic METEL importer, file-only source cards, per-card
selection, persistent loading feedback, unrestricted file pickers and the
engineering-link performance optimization. It replaces the Desktop Alpha 1
executable for current testing.

The current checkout also includes [brand management](BRAND_MANAGEMENT.md):
activation, impact previews, atomic commercial-data removal and reinstallation.
Existing Alpha 1.1 catalogues receive additive migrations with the normal
pre-migration backup; source archives, projects and settings are retained.

Light (Chiaro) is the default theme. Explicit saved choices under Vista → Tema
remain respected, including dark and system themes.

- App: `LibreQuadri Alpha 1.1.app`
- Version: `0.1.0-alpha.1.1`
- Bundle ID: `app.librequadri.alpha11`
- Isolated data: `~/Library/Application Support/LibreQuadri Alpha 1.1/`
- Package command: `npm run package:alpha11`
- Output: `out/alpha-1.1/LibreQuadri Alpha 1.1-darwin-arm64/LibreQuadri Alpha 1.1.app`

The initial seed reuses the validated Alpha 1 bootstrap catalogue and drawings,
copied and validated with the Alpha 1.1 profile. Future seed preparation from
private sources uses `npm run prepare:alpha11 -- /absolute/path/to/source-root`.
Alpha 0 and Alpha 1 commands, profiles and output directories remain available.
Packaging refuses an existing output; archive it deliberately before rebuilding.

Removing the old Desktop `.app` does not remove Alpha 1's application data or
project documents. Alpha 1.1 starts with its own fresh catalogue; previous
testing imports are not copied automatically. Open existing `.lqp` documents
explicitly. Project snapshots remain authoritative and are not repriced by
catalogue imports.

Manual acceptance: launch and inspect the catalogue; open Aggiorna listino;
check bulk and per-source file pickers, loading feedback and validation;
import a complete LSP/FSC/FST delivery; check prices/new brands and missing
articles; quit and relaunch to verify installed-data preservation. See
[the importer contract](METEL_IMPORTER.md) for recovery and validation details.

This unsigned internal build targets the build Mac's architecture. Signing,
notarization, Windows and external distribution remain outside this milestone.
`build-info.json` records the source revision and tracked local differences;
the pre-existing second-instance/window-reopening edit remains outside release
commits and is recorded as a local difference in this build.

## Desktop update 2026-10-27

Code baseline: `c36d2d7` on `feature/metel-importer`. This update includes Siemens
functional navigation and description-based enrichment, the 11 approved technical
filters in both Siemens trees, selectable-value-only checklists, checkbox-only
numeric filters, window-bounded dropdowns, the hover-only horizontal filter track,
and lower-right component scrolling. Automatic navigation/filtering now batches
counts, caches bounded summaries with write/transaction invalidation, lazily mounts
options and keeps only the newest pending request.

Fresh Siemens filter combinations improved from roughly 1.2 seconds to 213–222 ms;
repeated requests take 41–49 ms on the verified disposable catalogue. Full source-enabled
verification: **1,827 passed, 23 conditional skips, zero failures**; typecheck,
production build and isolated Electron checks pass.

The update is installed at `~/Desktop/LibreQuadri Alpha 1.1.app` and retains
`~/Library/Application Support/LibreQuadri Alpha 1.1/`, user settings and saved
projects. The previous application, coherent catalogue/raw backups and working-copy
backup are retained under ignored `build/alpha11-update-2026-10-27/`. Startup applies
the normal additive migration/seed reconciliation to the existing catalogue; it
does not replace that catalogue with the bundled fresh-install seed.

The fresh-install seed is validated against all 17 catalogue migrations, 122,535
products, nine brands, 10,800 models and 4,098 resolved drawings. Local build metadata
continues to record the pre-existing uncommitted second-instance/window-reopening
change in `src/main/index.ts`; that edit remains outside release commits.

Filter and performance details are in
[FILTER_VISIBILITY_SIEMENS.md](FILTER_VISIBILITY_SIEMENS.md) and
[CATALOGUE_PERFORMANCE.md](CATALOGUE_PERFORMANCE.md).

### Installed acceptance

Installed and launched on 2026-10-27. Packaged source revision:
`3f74775cd878fd9feba6a10d5584e5e5d59b2b64` (code baseline `c36d2d7`),
Electron 44.4.3 arm64. All **7,956 bundle entries** match the validated output,
including file modes and symlink targets. The old Desktop bundle is retained as
`build/alpha11-update-2026-10-27/previous-installed.app`.

Native packaged validation rehearsed the existing-profile update and preserved
30 checked catalogue/engineering tables. Real installed-profile verification
preserves the same data and UI preferences; the recent-project timestamp changed
normally when reopening the existing demo project, while its identity and saved
`.lqp` bytes remain unchanged. Integrity check is `ok`, foreign-key violations are
zero, all 17 migrations are applied, and the installed catalogue retains 122,535
products.

Native UI acceptance confirmed both functional brand roots, 11 Siemens technical
filters, 16 A → 420 articles, clearing → 64,981 Siemens articles, and scrolling to
the final rows of the 18-component saved project. Its engineering-staleness banner
was acknowledged with **Continua con dati salvati**; no refresh or save was performed.
The updated application remains open. Local evidence is retained under
`build/alpha11-update-2026-10-27/` (before/installation/packaged/installed reports).

All 26 tracked Markdown files were reviewed: 24 received current-release links
and applicable content updates; the two generated Siemens reports were regenerated
and verified byte-for-byte unchanged. Historical technical acceptance records are
retained. Publication branch:
the METEL import workflow described in [METEL_IMPORTER.md](METEL_IMPORTER.md).
