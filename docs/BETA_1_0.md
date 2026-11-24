# LibreQuadri Beta 1.0


This is the local macOS test build (`1.0.0-beta.1`). The Desktop app uses
`~/Library/Application Support/LibreQuadri Beta 1.0/` for its catalogue,
working copies, backups, and preferences. Open existing `.lqp` documents from
their saved locations. Alpha profiles and project files are independent of
the Desktop app bundles.

Prepare the seed from an isolated, synchronized catalogue with the current
BTicino link policy. The seed includes the normalized catalogue and verified
SVG drawings and database UI preferences (including zoom and theme). It
excludes recent-project entries, raw inputs, and project files. For a fresh
local Dev-to-Beta export, also copy Dev's `Local Storage`, `Preferences`, and
`Local State` into the new Beta profile while both apps are closed; panel
widths live in local storage. Keep the old Beta profile as a rollback backup
and preserve its project recovery data. Later version updates must retain
the installed preferences unless the user explicitly requests otherwise.

```sh
npm run prepare:beta1 -- /absolute/path/to/validated-data-root
npm run package:beta1
```

The packager builds for the current Mac architecture and writes the app
under `out/beta-1.0/`. `LIBREQUADRI_ELECTRON_ZIP_DIR` can point to a directory with
the locked Electron distribution ZIP for an offline package build.

First launch provisions a validated catalogue into the Beta profile.
Subsequent launches retain the installed catalogue. The bundle is signed
ad hoc for local testing. External distribution, TiQuadri comparison, and
acceptance on a second Mac are separate release gates.

## Catalogue profile

The Beta profile validates 10,823 models (7,846 active), including factory
mounting-panel models. Keep the adapter and seed synchronized before packaging.
Current source verification is recorded in [VERIFICATION.md](VERIFICATION.md).
