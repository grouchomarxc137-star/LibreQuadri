# Siemens engineering integration


User-approved scope: full Siemens Apparecchi, accessories, Carpenterie and Pannelli
workflow in Distinta and Progettazione, delivered in verified stages. Mixed-brand
DIN placement is included only where mounting facts establish compatibility.
The implementation is authorized, including verification and local commits.
Push approval covered the preceding release checkpoint, not this branch.

## Release checkpoint completed

`41727e4` commits the existing second-instance window restoration fix. It and the
ten preceding commits were pushed to `origin/feature/metel-importer`.
The Desktop Beta was rebuilt from that clean revision before Siemens changes.
The exported seed has 122,535 products, 10,823 models and 4,098 resolved drawing
keys. Sixty-seven catalogue tables were compared with the installed catalogue;
eight browser preference files and installed database UI settings were retained.
Previous bundle, profile, package and seed are preserved under ignored
`build/beta-1.0/checkpoint-41727e4/`. Dev remains the source catalogue.
Provisioning acceptance: six tests passed, four environment-gated cases skipped.
Code signing verified and the packaged main/renderer processes started. Native
UI inspection failed, so visual startup/reopen acceptance is still outstanding.

## Stage 1 implementation

The streaming Windows-1252 reader identifies the supported integra5 text format,
hashes original bytes, preserves material object identities, inherited article
prefixes, graphical references and source line numbers, and distinguishes the
later selector namespace. It rejects the legacy binary converter source.

Mounting evidence follows graphical references without adding or selecting
multiple widths. Numeric mounting span is kept separate from body dimensions.
Project reference analysis separates drawing nodes from billable material codes
and aggregates material quantities. It does not import or price projects.

Run the read-only source report:

```sh
npm run build:main
node dist/scripts/analyse-sienergy.js /absolute/path/to/Sienergy_LITE514
```

Real-data validation is opt-in:

```sh
LIBREQUADRI_SIENERGY_ROOT=/absolute/path/to/Sienergy_LITE514 npm test -- test/sienergy-source.test.ts
```

The supplied source yields 387,973 objects. The checked 5ST3010, 5SL30257 and
5ST3053 records resolve respectively to 9, 18 and 27 mm profiles. Both supplied
SIVACON projects resolve all 153 references and respectively 35 and 40 distinct
material codes. Source-qualified identities such as IT2:8PQ40000BA86 remain raw
evidence for the later brand/identity resolver. These are source-reference results,
not verified live pricing.
LibreDWG 0.14 decoded Din-aut1.dwg; it includes INSERT, TEXT and ATTDEF entities.
The existing TiQuadri converter cannot represent this whole drawing unchanged.

## Stage 2 implementation

The `sienergy` engineering adapter now imports the verified single-component DIN
subset through EngineeringDataWriter. Migration 0019 permits its provenance.
An absent Siemens import does not make an existing BTicino catalogue stale;
once imported, normal version and generation checks apply to Siemens too.

The importer archives and verifies the master, backs up the catalogue before its
transaction, protects manual definitions, deactivates removed models, and repeats
without database writes. Cycles and repeated graphical occurrences are preserved
as failures/multiple-component evidence. Only the source's MODULARI profile group
qualifies for DIN conversion; prices and numbers in article descriptions are never
used to infer occupancy. Retired source branches are excluded. Non-integral 9 mm
spans and multi-component articles remain reported for later handling.

References link by exact manufacturer code within SIE. Punctuation is significant;
another brand's matching code cannot supply a price. Imported models enter the
existing Scheda/configuration/BOM/project-snapshot flow and attach to existing
Siemens commercial article nodes. Their separate design path is hidden from the
commercial tree. METEL categories, filters and pricing remain authoritative.

DWG preparation uses locally installed LibreDWG at catalogue preparation time.
The app consumes content-addressed inert SVG paths, with archived DWG provenance
and integrity checks. The converter expands owned blocks and transforms, handles
lines, constant-width/bulged polylines, circles/arcs/ellipses, solids, clipped polygon hatches and points,
respects visibility, and follows explicit model-space ownership. Unsupported
text/fonts, attributes and geometry are rejected rather than omitted from an
activated drawing. Cached decoder JSON is keyed by both source and decoder.
Missing installed artwork is repaired by a repeat import. The packaged app does
not need LibreDWG or the original Desktop folder.

Commands:

```sh
npm run prepare:sienergy-drawings -- /absolute/path/to/Sienergy_LITE514 /prepared/drawings
npm run import:sienergy -- --data-dir /isolated/profile --drawings /prepared/drawings /absolute/path/to/Sienergy_LITE514/lib/bd/Siemens.bd
```

Acceptance against a fresh copy of running Dev:

- 5,525 active Siemens models, 148 physical profiles.
- All 3,699 METEL-linked models resolve completely with catalogue prices.
- 1,826 missing METEL identities resolve as explicitly unpriced/Fuori catalogo.
- 105 drawings prepared; 103 belong to active imported profiles. Unsupported
  drawings are listed in the preparation manifest. No placeholder artwork is used.
- 5,362 active models have converted fronts. Din-aut1 was rendered and visually
  checked; exhaustive visual verification remains outstanding.
- Product, listing, family, attribute, price and commercial navigation data and
  database UI preferences remain equal to the pre-import catalogue.
- Import repeatability, rollback, protected manual facts, exact brand identity,
  artifact integrity/repair and offline project save/reopen have targeted tests.
- The complete suite has the same 13 failing tests as the committed baseline;
  the added migration's three count assertions were updated and pass. The baseline
  failures include shutdown mocks, UI expectations and BTicino navigation checks.

## Completed selector, composition and structural integration (2026-11-24)

The current Siemens adapter is version 4; drawing preparation uses manifest version
3. Selector namespaces 10 and 11 remain separate. The structural compiler follows
aliases, evaluates supported choice/range/exclusion conditions, rejects dynamic or
unknown encodings, and derives compatibility contexts from the evaluated routes.
Declared fixed compositions expand recursively into their component bills with
cycle, quantity and unresolved-reference checks. An aggregate is not a separately
priced article. Its bill uses component roles, so opening a METEL article selects
the base device and its composition menu rather than a synthetic aggregate model.

The supplied current source activates:

- 5,525 standalone modular equipment models, with DIN demand from numeric source
  geometry and the MODULARI taxonomy; 5,418 have prepared fronts.
- 19,420 declared component bills, including 16,304 modular combinations offered
  through composition choices on 1,728 base devices. Their summed source component
  spans supply DIN demand; component order alone does not qualify a front layout.
- 906 structural models: 880 enclosure/context models and 26 support groups,
  offering 2,840 source executions. These are ordinary configuration models with
  execution-dependent bills, profiles, zones and restricted receiving contexts.
- 6,324 models with a front on their base profile (standalone devices and qualified
  structures); execution overrides retain their own geometry. Structural navigation
  is available in Progettazione while the existing commercial tree stays intact.

SIVACON frames use their numeric outer and usable dimensions, source mounting
origins and a 25 mm stack pitch. The pitch is corroborated by Siemens LV 10/2018,
chapter 16, page 16/9 (PDF page 13):
[manufacturer catalogue](https://cache.industry.siemens.com/dl/files/655/109750655/att_959108/v1/LV10_042018_Chap16_EN_web_201808061246189251.pdf).
Frame viewports follow physical source dimensions, clipping CAD construction marks
instead of treating them as cabinet size. DIN panel rows use the source row count,
rail span, pitch and origins. Widths and context choices prevent a B800 panel from
being offered for a B600 source context despite their shared physical class.
Enclosure execution changes use the existing guarded reconfiguration/Undo path.

Artwork preparation additionally supports planar SAT boundaries and outlined CAD
text. The preparation font and its SHA are recorded; source font substitutions are
listed per drawing. The checked local preparation used Arial. It produced 3,067
inert SVG fronts and rejected 463 unsupported or inconsistent drawing profiles;
these figures cover the preparation inventory, including inactive source records.
The runtime needs the installed derived assets, not LibreDWG, a font file or the
original Sienergy installation. TiQuadri artwork refreshes exclude foreign-owned
profiles even if normalized drawing filenames collide.

For font-aware preparation:

```sh
npm run prepare:sienergy-drawings -- /absolute/path/to/Sienergy_LITE514 /prepared/drawings /absolute/path/to/outline-font.ttf
```

## Mounting facts and portable projects

Catalogue migration 0020 and additive project migration 0010 (format 11) store
mounting facts on equipment and receiving zones. These facts distinguish a source
compatibility rule from complete dimension evidence. Mixed-brand qualification
requires matching rail systems and complete, sufficient depth, aperture and
above/below-rail clearance dimensions. Discovery, inverse device/panel/enclosure
search, placement, moves and explicit refresh use the same checks. Verified DIN
evidence bridges the parent rail class while ancestor restrictions and source
contexts stay enforced. Known clearance
conflicts are rejected for either brand relationship. Legacy projects without facts
retain their existing class rules until an explicit engineering refresh.

TiQuadri adapter 14 records the reviewed ANA_PANNELLI DIN receiver rule. Neither
local source supplies all dimensions needed to certify a real mixed-brand pair.
Accordingly no mixed-brand installation is presented as verified by this import.
Complete-dimension positive and missing/conflicting-dimension negative paths have
integration coverage. Project refresh adopts facts explicitly and preserves saved
commercial values; existing projects are not automatically converted or repriced.

## Verification and Dev activation

The source-specific and shared project/migration checks passed: 199 focused tests,
plus the real Siemens workflow and document/export checks. The full default suite
has 1,869 passing tests and the same 13 pre-existing failures as the checkpoint;
111 environment-dependent cases were skipped. The earlier sandbox-only SQLite
open failures were excluded by rerunning with normal shared-memory access.
Type checking, main/renderer builds and the project migration manifest check pass.

Real acceptance starts with a configured Siemens reference device, discovers its
compatible enclosures/panels, rejects an incompatible width context, and checks:
configuration, exact METEL bills/prices, two DIN rows, placement, capacity refusal,
move, duplication, Undo/Redo, cabinet transfer, enclosure execution change,
save/reopen without catalogue access, and Fronte Quadro/Distinta generation.
The actual Electron PDF engine generated both documents and both were rendered
and visually reviewed. The example cabinet measures 600 × 2000 × 400 mm and its
bill includes the frame, execution-specific mounting parts, panel kit and devices.
The updated app also reached its usable start screen against the isolated profile.

Run the opt-in workflow against a prepared scratch profile:

```sh
LIBREQUADRI_SIENERGY_REAL_PROFILE=/isolated/profile npm test -- test/sienergy-design-real.test.ts
```

Real BTicino enclosure reconfiguration passed all eight tested door/plinth
combinations at quantities 1 and 3 with installed artwork. The remaining catalogue
regressions passed their 33 cases; the two artwork-dependent cases were rerun
successfully after copying the existing local artwork into the isolated profile.
The configured insertion sweep inserted every one of 26,067 complete default
resolutions without a rejection. Its timeout accommodates the expanded inventory.

Dev was closed through its normal Quit flow, and its complete profile was backed
up under ignored `build/sienergy-activation-2026-11-24/profile-before/`. Dev now has
Siemens adapter 4 and TiQuadri adapter 14, both ready. Twenty commercial/catalogue
and recent-file tables retain their semantic values. Attribute provenance IDs and
four derived catalogue fingerprints advance to the new import. Database user
settings and all twelve browser storage files matched the pre-update profile.
After restart the browser data and database preferences still matched; only the
Chromium diagnostic LOG files changed. SQLite quick_check passes and
foreign_key_check is empty. Separate evidence lives
in that activation folder; the acceptance project and visually checked PDFs are
under ignored `build/sienergy-design-acceptance/`.

## Source coverage limits

The software workflows above are implemented; full Sienergy catalogue/geometry
coverage is not claimed. Unsupported records remain reported and fail closed:

- Fixed bills without verified component placement can be quoted and have known
  modular demand, but cannot be placed as a fabricated assembly front.
- Compound frame transforms, inconsistent panel dimensions, unavailable artwork,
  unresolved bills and dynamic selector expressions do not activate physical
  definitions. The preparation/import reports retain the specific reasons.
- Missing exact SIE METEL identities remain explicitly unpriced; another brand or
  a punctuation-insensitive code match never supplies their price.
- Real mixed-brand mounting awaits complete manufacturer clearance evidence.

The installed Beta remains the requested pre-Siemens release checkpoint. The new
Siemens commits are local on `codex/siemens-engineering`; push approval covered the
preceding release checkpoint only. Unrelated `.claude/` and `.worktrees/` content
is retained.
