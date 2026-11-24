# External data and optional acceptance tests

The application includes importers and reference mappings. Obtain authorized
source data separately. Raw manufacturer catalogues, Access databases, Sienergy
installation files, drawings and customer projects are not included.

## Input roles

| Integration | Required external input | Purpose |
| --- | --- | --- |
| METEL | LSP, FSC, FST deliveries for each issuer | Products/prices, discount-family classification and statistical navigation. These files are not customer discount agreements. |
| TiQuadri / BTicino | `BTQUADRI.mdb`, optionally `ListinoBT.mdb` as required for commercial resolution | Source-qualified engineering configuration and assembly data. |
| TiQuadri drawings | `BTQuadriDXF.mdb` | Local normalized SVG front drawings with source provenance. |
| Sienergy / Siemens | `lib/bd/Siemens.bd` from an authorized compatible installation | Engineering source records and selectors. |
| Sienergy drawings | Source `lib/quadrisi/*.dwg`; prepared output manifest | Optional vectors. Preparation calls external `dwgread` and may take an explicitly supplied outline font. |

Do not redistribute fonts, source DWGs, normalized vectors or binaries without
permission. The drawing importers retain `manufacturer_unverified` metadata
with project embedding disabled. Keep these restrictions intact. Display flags
in a database are application policy, not a grant from the manufacturer.

For an individual import, use the commands listed in the README, selecting
`--data-dir` where that command supports it or `LIBREQUADRI_DATA_DIR` to target
a dedicated development profile. Close Electron before engineering sync.

The optional full bootstrap expects a private root with:

```text
<private-source-root>/
  metel/                 # one LSP/FSC/FST delivery for each required issuer
  tiquadri/
    BTQUADRI.mdb
    ListinoBT.mdb
    BTQuadriDXF.mdb
```

```sh
npm run bootstrap:dev -- --data-dir <development-profile> <private-source-root>
npm run prepare:sienergy-drawings -- <Sienergy-root> <prepared-output> [outline-font]
npm run import:sienergy -- --data-dir <development-profile> --drawings <prepared-output> <Siemens.bd>
```

The full bootstrap validates BTI, SIE and SNR deliveries. The regular
in-app METEL importer does not impose this bootstrap profile on all users.

## Optional real-data verification

No test should implicitly read an original application profile or a private
Downloads/Desktop directory. Set only the variables relevant to the intended
suite and use disposable copies for catalogues/profiles:

| Variables | Input |
| --- | --- |
| `LIBREQUADRI_METEL_DIR` | Historical acceptance delivery tree; individual filenames are nested as `<name>/<name>` in these tests. Exact generations/counts are pinned by the suites. |
| `LIBREQUADRI_TIQUADRI_MDB`, `LIBREQUADRI_LISTINOBT_MDB`, `LIBREQUADRI_TIQUADRI_DXF_MDB` | Authorized TiQuadri source files. |
| `LIBREQUADRI_REV83_REAL_DB`, `LIBREQUADRI_REV83_REAL_ASSETS` | Reviewed populated catalogue and its related assets. |
| `LIBREQUADRI_CARPENTERIA_REAL_DB`, `LIBREQUADRI_CAPACITY_FILL_REAL_DB` | Specific historical baselines used by acceptance cases. |
| `LIBREQUADRI_ENGINEERING_REFRESH_REAL_DB`, `LIBREQUADRI_COMPATIBLE_PANELS_REAL_DB` | Baselines for engineering refresh or compatibility tests. |
| `LIBREQUADRI_ALPHA_FROZEN_DB`, `LIBREQUADRI_ALPHA1_DATA_ROOT`, `LIBREQUADRI_BETA1_DATA_ROOT` | Exact historical release profiles for seed checks. |
| `LIBREQUADRI_SIENERGY_ROOT`, `LIBREQUADRI_SIENERGY_REAL_PROFILE` | Authorized Sienergy installation / disposable imported profile. |

Optional evidence destinations include `LIBREQUADRI_PANEL_PRESET_EVIDENCE`,
`LIBREQUADRI_COMPATIBLE_PANELS_EVIDENCE` and
`LIBREQUADRI_SIENERGY_ACCEPTANCE_OUTPUT`. Keep outputs outside tracked source.
The installer cache override is `LIBREQUADRI_ELECTRON_ZIP_DIR`.
Absence of external inputs produces explicit skipped cases in the complete
suite. Do not invent substitute results or weaken pinned acceptance expectations.

## Engineering synchronization

Use `npm run sync:engineering -- --check` to inspect a development catalogue.
Close Electron, then run `npm run sync:engineering` to update it. Both commands
accept `--data-dir <development-profile>`; otherwise they use the configured
LibreQuadri development profile.

Validation uses filesystem locations and structure, not application-name
matching. Standard operating-system application-data directories are protected:
only the application's managed development and test subtrees are eligible there.
Other profiles remain protected regardless of their product or folder names.
Explicit custom development roots outside those locations are accepted after
catalogue, alias and local-filesystem checks. A data-dir environment override
cannot add a production profile to the managed development allowlist.

Production execution, `.app` bundle ancestry and seed trees with an ancestor
`manifest.json` are refused. Symlinks cannot make a production profile eligible
by pointing a development directory at it. Catalogue/sidecar aliases, hard links
and unsupported filesystems are also refused before synchronization.

Synchronization preserves manual overrides and uses backups and exclusive
catalogue access. Keep the catalogue's source archives available. If refused,
correct the reported input/locking/readiness problem before retrying; do not
edit migration history or bypass the guard.
