# Product and architecture

LibreQuadri is a local desktop application for multi-brand electrical-panel
configuration, quotations, material lists and PDF documents.

Electron owns the application lifecycle, local files, SQLite databases, imports
and PDF generation. A sandboxed preload exposes typed application APIs to the
React renderer. Shared TypeScript contracts and drawing primitives keep screen
and document behavior consistent.

Commercial METEL deliveries and engineering source data are separate inputs.
Manufacturer identities, price provenance, configuration models and physical
profiles qualify product choices and compatibility. Project files contain
snapshots so saved data and prices remain available independently of subsequent
catalogue updates.

Database migrations, `.lqp` format identifiers, persisted provenance codes and
preload API names are compatibility contracts. Preserve them when changing
presentation or adding migrations. User-interface preferences persist across
application updates.

See [README.md](README.md), [STATUS.md](STATUS.md),
[docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) and
[docs/EXTERNAL_DATA.md](docs/EXTERNAL_DATA.md).
