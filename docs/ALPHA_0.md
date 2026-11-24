# Alpha 0 compatibility profile

Alpha 0 uses application name `LibreQuadri Alpha 0`, package version
`0.1.0-alpha.0` and bundle identifier `app.librequadri.alpha`.
The profile pins its catalogue inventory and engineering readiness checks.
It forces the native light theme while retaining saved preferences.

The current engineering adapter may reject an Alpha 0 dataset. Do not bypass
readiness validation, relabel an adapter or change fixed counts to package an
incompatible seed. Prefer the [Beta 1.0 preparation workflow](BETA_1_0.md) for
current development and use only matching validated external data.

The commands remain `prepare:alpha` and `package:alpha`. Preparation requires
complete METEL deliveries and the TiQuadri source roles described in
[EXTERNAL_DATA.md](EXTERNAL_DATA.md). Generated seeds live in
`build/alpha/alpha-seed`; application output lives in `out/alpha-0`.
Neither generated catalogue data nor application output belongs in Git.

The packager includes compiled code, migrations, reference seeds, production
dependencies and the validated catalogue/SVG seed. Raw source files, customer
projects and backups are excluded. The macOS icon is generated from the `LQ`
text monogram with native AppKit/Swift and `iconutil`.

First launch provisions the Alpha profile. Subsequent launches preserve its
catalogue, projects and preferences. Runtime profile location on macOS:
`~/Library/Application Support/LibreQuadri Alpha 0`.
