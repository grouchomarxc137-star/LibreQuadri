# LibreQuadri (LQ)

LibreQuadri (LQ) is a desktop application for configuring multi-brand electrical
panels, preparing quotations and material lists, and generating PDF documents.
A local commercial catalogue and manufacturer engineering models support
product selection, technical configuration and a visual panel workspace.

## Functionality

- **Multi-brand catalogue:** manufacturer management, product status, price
  provenance and catalogue updates.
- **METEL imports:** LSP price lists, FSC discount families and FST statistical
  families/navigation, with preview, validation and import history.
- **Advanced search:** manufacturer codes, descriptions, EAN, product families,
  category navigation and technical-attribute filters.
- **Technical configuration:** selectable model dimensions, resolved component
  bills of materials, accessory constraints and source-readiness diagnostics.
- **Carpenteria:** enclosure and support configuration, multiple enclosures,
  mounting checks, physical placement, reconfiguration and DIN capacity fill.
- **Fronte Quadro:** interactive front views, component geometry, labels,
  dimensions, annotations and shared SVG representation for screen and PDF.
- **Quotations and material lists:** product/configured-item lines, quantities,
  list prices, discounts, labour and grouped material totals.
- **Project documents:** local `.lqp` files with saved snapshots, migrations,
  recovery, recent projects and undo/redo.
- **PDF documents:** Distinta and Fronte Quadro preview/save with document-specific
  display options. An internal quotation template is also implemented and tested;
  it is not a separate choice in the current export dialog.

BTicino/TiQuadri and Siemens/Sienergy engineering importers are available.
METEL imports support multiple issuers, including BTicino, Siemens and Schneider.
Engineering coverage depends on the source generation and imported data;
compatibility follows source-defined constraints.

## Architecture

The application uses Electron, React, TypeScript, Vite and SQLite.
`better-sqlite3` handles database access, Drizzle defines schemas/migrations,
`mdb-reader` reads Access inputs, and Vitest/jsdom run automated tests.

| Directory | Responsibility |
| --- | --- |
| `src/main` | Application lifecycle, databases, catalogues, importers, project operations and PDF generation. |
| `src/preload` | Sandboxed bridge exposing typed application APIs. |
| `src/renderer` | React interface and local workspace state. |
| `src/shared` | Contracts and shared domain types. |
| `src/drawing` | Geometry and SVG primitives shared by screen/document rendering. |
| `db` | Schemas, migrations and reference mappings. |
| `scripts` | Import, development and packaging commands. |
| `test` | Synthetic tests and optional external-data acceptance tests. |

Node, filesystem and SQLite access remain in the main process. The renderer
runs with sandboxing and context isolation. Project snapshots preserve saved
configuration and prices independently of later catalogue updates.

## Installation

Install Git, Node.js and npm. Verification uses Node.js 25.2.1 and npm 11.6.2.
Native dependencies may require compiler tools. macOS packaging and text-icon
generation require Apple's Command Line Tools; Linux requires Electron's
system libraries and a graphical display.

```sh
git clone git@github.com:grouchomarxc137-star/LibreQuadri.git LibreQuadri
cd LibreQuadri
npm ci
npm start
```

`npm start` builds the main process and renderer before launching Electron.
Dependency installation and Electron's first runtime download may require
network access. Normal application use is local.

The application can launch with an empty catalogue. Use the import interface
to add authorized METEL data, or the developer commands below.

## Local data

The source-mode profile is named `LibreQuadri Development`. On macOS it
lives under `~/Library/Application Support`; Windows uses `%LOCALAPPDATA%`,
and Linux uses the Electron app-data root. To use a separate development or
test profile:

```sh
LIBREQUADRI_DATA_DIR="$PWD/build/local-profile" npm start
```

Packaged release profiles ignore this development override. Keep applied
migrations, database identifiers, `.lqp` formats, persisted provenance codes
and preload API names compatible when developing changes.

## External catalogue and engineering inputs

Obtain manufacturer data separately: METEL LSP/FSC/FST deliveries,
TiQuadri/BTicino Access sources, Siemens/Sienergy engineering inputs and any
optional drawings. Private catalogues, customer projects, raw deliveries,
manufacturer programs, manuals and artwork are not included.

```sh
npm run import:metel -- <LSP> [FSC] [FST]
npm run import:tiquadri -- --listino <ListinoBT.mdb> <BTQUADRI.mdb>
npm run import:tiquadri-drawings -- <BTQuadriDXF.mdb>
npm run import:sienergy -- <Siemens.bd>
npm run sync:engineering -- --check
```

See [docs/EXTERNAL_DATA.md](docs/EXTERNAL_DATA.md) for source roles, bootstrap
layout, drawing preparation and optional acceptance-test variables.

## Development and verification

```sh
npm run typecheck
npm test
npm run build
npm run db:check:project-manifest
npm run audit:publication
```

The complete test command discovers synthetic and optional external-data cases.
Cases requiring external files skip when their `LIBREQUADRI_*` inputs are
absent. Standard source tests use synthetic data. Current results and known
failures are recorded in [docs/VERIFICATION.md](docs/VERIFICATION.md).

Packaging commands include `prepare:alpha*`, `prepare:beta1` and `package:*`.
They require matching validated catalogue profiles. See
[docs/BETA_1_0.md](docs/BETA_1_0.md) for the Beta workflow. Generated seeds,
application bundles, local profiles and build outputs stay outside Git.

## Development status

Catalogue import/search, product configuration, physical panel workflows,
local projects and document export are implemented. Broader engineering
coverage, catalogue distribution/updates and configurable automatic numbering
remain planned. See [STATUS.md](STATUS.md) and [BACKLOG.md](BACKLOG.md).

## Contributing and notices

Follow [CONTRIBUTING.md](CONTRIBUTING.md), use synthetic fixtures and run the
relevant checks. Keep credentials, real customer records and private source
data out of contributions.

Third-party component licences and attribution notices are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
