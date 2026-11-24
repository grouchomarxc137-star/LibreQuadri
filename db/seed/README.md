# Catalogue reference data

> Current Desktop release and verification (2026-10-27): [Alpha 1.1 update](../../docs/ALPHA_1_1.md#desktop-update-2026-10-27).

`categories.json` (the category tree) and every `category-mappings/*.json` file
(mapping rules) are applied transactionally by `synchronizeCategorySeed`. Application startup runs this after migrations in a
worker, before opening the catalogue window. Delivery normalization also runs it
after issuer/brand creation and governing-listing updates, inside the delivery
transaction. Identical delivery imports retain their existing no-op semantics.

## Mapping files

`category-mappings/` holds one JSON array of rules per file, conventionally one file
per METEL issuer (`bti.json` and `sie.json` currently). The loader reads every `*.json`
file in code-unit filename order and concatenates them; other files are ignored.
File names carry no meaning: each rule's scope comes only from its own
`issuerSigla`/`brandMarchio`. Rule codes must be unique across all files, and the
conflict checks apply across files. Splitting, merging or renaming files does not
change the fingerprint or trigger reclassification. The folder must exist; an empty
folder means no rules.

## Stable codes and lifecycle

- Category codes are lowercase dotted paths, e.g. `protezione.differenziali_puri`.
  Mapping codes identify a rule, e.g. `bti.bti.statistica.ind-112-5-24`.
  Codes must match `[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*`. Neither display names nor
  database IDs are stable identities. Never rename or repurpose a category code.
- Keep retired category entries with `active: false`. Omitted seed categories
  also become inactive, retaining their IDs and references. Retired codes are
  remembered in `app_setting` and cannot be reactivated/reused by a later seed.
- Seed rows use `source='seed'`. Existing `source='manual'` category and mapping
  rows are protected, including inactive categories. Product decisions with
  `category_source='manual'`, including a null category, are always preserved.
- Removed seed mapping rows are deleted; product provenance uses `ON DELETE SET
  NULL`. The same transaction reevaluates automatic decisions. Protected manual
  mappings remain even if omitted from the seed.
- `issuerSigla` and `brandMarchio` are mandatory keys. Explicit `null` means any;
  omitted/empty/invalid scope is an error. A named scope whose database row does
  not exist is deferred, never widened to null. Normalization retries materialization.
- Validation rejects duplicate/invalid stable codes, missing parents, parent
  cycles (including cycles involving manual overrides), unknown targets, invalid
  match modes/regexes, and identical conflicting rules, including overlapping
  equal-specificity scopes. General regex intersections are handled at runtime.

## Deterministic classification

Precedence follows DATABASE_DESIGN §5.3: manual product decision; statistical
exact; statistical prefix; code prefix/regex or description regex; discount;
unmapped. The schema reserves `ELECTROCOD`, but it is neither extracted nor read
by the classifier in this milestone, and Electrocod seed rules are rejected.

Within a precedence tier: more bound scope fields first; longer literal prefixes
first; higher numeric priority first. Issuer-only and brand-only rules are equally
specific. Regex text length is not treated as specificity. At equal precedence,
different target categories leave the product unmapped, with null provenance.
Agreeing rules use the lexicographically smallest stable rule code for provenance.
Rules targeting inactive categories are ignored. Matching is case-sensitive;
exact family codes are opaque values, with no SQL wildcard or description fallback.

The SHA-256 fingerprint in `app_setting.catalogue.category_classifier_fingerprint`
includes the canonical seed, classifier version, and effective categories/mappings
(including local IDs and manual overrides). Array/key ordering in seed JSON does
not affect it. A changed fingerprint reclassifies all non-manual products; otherwise
normalization reclassifies affected products only. Fingerprint, seeds and product
changes commit or roll back together. Increment `CLASSIFIER_VERSION` when changing
classification semantics. Bulk startup work runs outside the Electron main thread.

## Verified BTI mappings

Rules: `category-mappings/bti.json`. Verified on 2026-09-21 against the supplied
`BTILSP021.txt` and `BTIFST.txt`, using
issuer **BTI**, brand **BTI**, `STATISTICA`, `exact` exclusively:

| Category suffix | Statistical families | Products |
| --- | --- | ---: |
| interruttori_automatici | IND.-112-5-11, IND.-110-2-71, IND.-112-5-19, IND.-112-5-15, IND.-112-5-22, IND.-115-20-124 | 554 |
| magnetotermici_differenziali | IND.-112-5-12, IND.-112-5-16, IND.-110-2-72, IND.-110-2-82 | 136 |
| differenziali_puri | IND.-112-5-24, IND.-110-2-73, IND.-110-2-83 | 107 |
| blocchi_differenziali | IND.-112-5-25 | 71 |
| rilevatori_arco | IND.-110-2-89 | 4 |

Total: **872**, all BTI. The automatic-breaker group includes 14 DC products.
Mixed SPD/fuse/fuse-holder/DIN auxiliary families remain unmapped. No rule applies
to LEG/IMS/ZUC/CAB/NTM, SIE/BCT or SNR, even when a family code is identical.

## Read-only queue

The queue is derived from `lq.db` and groups products with null category by governing
issuer, brand and statistical family. Default scope is listed products. Its
unclassified count and up to three code-ordered examples follow the selected scope;
listed/total counts describe the entire group, including classified products.
Null issuer/family groups are retained. Pages have deterministic ordering and a
bounded size. Inspecting a group shows only its unclassified products with the same
listed/all scope. No review rows, assignments or category edits are created.

The generated `0001_category_classification.sql` was reviewed and simplified to
additive `ALTER TABLE` statements, retaining the generated snapshot and CHECK/FK
semantics. It does not rebuild `cat_product` or alter the shipped migration.
Ship `db/seed/` beside `db/migrations/` when adding distributable packaging.

## Revision 8 engineering reference data (Step 9.1)

`capacity-kinds.json` defines the stable integer units used by physical demand
and zone capacity. `din_rail` stores **9 mm half-modules**; its display divisor
is 2, so a stored demand of 4 appears as 2 modules. The remaining slot kinds
and millimetre kinds have divisor 1. Other kind codes remain in the database
if a later seed omits them, preserving references. The DIN kind is mandatory;
manual kind rows are protected.

`source-brand-map.json` maps an adapter's source brand code to a METEL marchio.
Mappings to brands not yet present are deferred until a delivery creates the
brand. Explicit `null` mappings stay unmapped; `CT-`, `HW-` and `NV-` have no
established identity. Manual map rows, including manual `null` overrides, are
protected. Both files synchronize at startup and during METEL normalization.

## Technical attributes (roadmap step 5A)

`attributes.json` defines the standardized attributes and their enum options;
`category-attributes.json` links them to categories (applicability). Both are
brand-neutral and are applied by `synchronizeAttributeSeed` right after category
synchronization, at startup (in the same worker transaction) and inside every
delivery normalization transaction. Links are validated against `categories.json`.

| Attribute | Type | Unit | Options |
| --- | --- | --- | --- |
| `poles` | enum | — | `1p` 1P, `1p_n` 1P+N, `2p`, `3p`, `3p_n` 3P+N, `4p` |
| `rated_current` | number | A | — |
| `trip_curve` | enum | — | `b c d k z` |
| `declared_breaking_capacity` | number | kA | — ("Potere di interruzione (dichiarato)": the listino value, which may be Icn or Icu) |
| `rated_residual_current` | number | mA | — |
| `residual_current_type` | enum | — | `ac a f b` |

Applicability: interruttori_automatici = poles, rated_current, trip_curve,
declared_breaking_capacity; magnetotermici_differenziali and rilevatori_arco = all
six; differenziali_puri and blocchi_differenziali = poles, rated_current,
rated_residual_current, residual_current_type.

### Codes and lifecycle

- Attribute codes follow the category code pattern; option values match
  `[a-z0-9]+(_[a-z0-9]+)*` (e.g. `1p_n`). Both are a compatibility contract
  (projects will reference them): never rename or repurpose them.
- Only `number` attributes have a unit; stored numbers are in that unit. An
  existing attribute's data type and unit cannot change.
- `enum` attributes require options; other types have none. Supported widgets:
  `checkbox`, `select`, `range` (the step-5A UI renders checkboxes).
- Omitted or `active: false` attributes and options become inactive, are never
  deleted, and their codes are remembered in `app_setting` and cannot be reused.
  Omitted seed links are deleted. Rows with `source='manual'` are never
  overwritten. A link to a category not yet in the database is deferred.

### Enrichment and provenance

`cat_product_attribute` holds one typed value per (product, attribute) with a
`source`: `manual` > `seed` > `import_file` > `parser`. The generic engine
(`src/main/catalogue/attribute-enrichment.ts`) runs the parser registered for
the product's brand (`src/main/catalogue/parsers/`), keeps only attributes
applicable to the product's current active category, drops invalid values
(wrong type, unknown/inactive option, non-positive number) and never stores
ambiguous ones (more than one distinct candidate). It inserts, updates and
deletes only `parser` rows; products outside applicable categories lose their
stale parser rows. Brands without a parser get no parser values.

`app_setting.catalogue.attribute_enrichment_fingerprint` covers the engine
version, each parser's code and version, the canonical attribute seed, the
effective attribute/option/link rows (including manual overrides) and the
category classification fingerprint. A changed fingerprint re-enriches every
product; otherwise normalization re-enriches only the delivery's affected
products. Unchanged state is a no-op. Increment a parser's `version` whenever
its rules change.

### BTI description parser (`bti.description`, version 1)

Verified on 2026-09-21 against the 872 classified BTI products of `BTILSP021.txt`:
poles 872, rated_current 844, trip_curve 524, declared_breaking_capacity 680,
rated_residual_current 308, residual_current_type 303 (A 135, AC 117, F 43,
B 8); 3,531 values, none ambiguous or invalid. Rules (tokens, case-insensitive,
decimal comma): `1P`, `1P+N`, `1PN`, `2P`–`4P`; `curva X` or a joined `C10`
(curve + current); `nnA` with 1–3 digits; `n kA`, `4500A`/`6000A` (as kA), and a
bare `4500` only as the last token of a full 43-character description;
`30mA`/`300ma`/`30mA?`; `AC`, `A`, `F`, `B`, `A-S`/`AS` (= `a`), never the letter
after `curva`. Current is skipped for `solo magn…` (magnetic-only). Not parsed:
product codes, DIN modules, voltage, DC type, Im, selectivity, adjustable/HPI
features, series.

### Siemens description parser (`sie.description`, version 1)

`category-mappings/sie.json` scopes 212 exact statistical-family rules to issuer
and brand SIE, covering 64,981 imported articles. The 21 additive industrial
categories are applicability envelopes for mixed devices/accessories/software;
they preserve existing category identities and the Siemens FST navigation.
`parsers/sie-families.ts` records each reviewed family profile. The parser input
now optionally includes manufacturer code, category and issuer-qualified family
context; the BTI parser still accepts description-only calls unchanged.

The parser uses description evidence for article kind, electrical ratings,
current-setting ranges, I/O counts, labelled dimensions, IP and explicit
software/licence tokens. Icn, Icu and unlabelled declared capacity are distinct;
coil, auxiliary supply and PSU output voltage are distinct. Signal voltage is
not supply voltage. No rating is decoded from a product code. Accessory target
references, ambiguous values, IPXX and undocumented encodings stay unset.

The shared transactional startup/METEL pass handles refresh, manual protection
and fingerprint invalidation (engine version 3). Increment the Siemens parser
version when changing rules or its family profiles. The existing number/enum
menus, row columns, ranges and persistent navigation selections need no new API.
The full per-family counts, supported filters, examples and remaining gaps are
in [SIEMENS_FILTER_COVERAGE.md](../../docs/SIEMENS_FILTER_COVERAGE.md). Rebuild and
run `node dist/scripts/siemens-filter-coverage.js <enriched-copy.db> <report.md>`
to reproduce that report without writing to the catalogue.

## TiQuadri engineering vocabulary, Stages C–E (development seed)

`engineering-vocabulary/tiquadri.json` keeps Stage B's 171 reviewed Taratura
values and adds a category, and the article-true facts where there is evidence,
for every active TiQuadri Apparecchi device model. Each model is keyed by a
stable `tq.pack.*` code, checked against its reviewed TiQuadri name, and carries
its source pack, historical grouping and Tipologia in `evidence`.
The literal `LQ group` in inherited evidence is retained as source provenance,
not product identity; changing it would alter the reviewed reference dataset.

- **Stage C:** 819 protection/switching models. Facts are poles, Icu, modular Icn,
  curve and fixed residual characteristics. Seven residual-type values come from
  `tq.label.152`.
- **Stage D:** the remaining 480 models, classified by the function of their
  selected primary. These categories carry no technical facts.
- **Stage E:** `trip_unit_type` on MCCBs. It comes from pack-name evidence, or for
  names that state no function, from METEL "magnetotermico" text on every
  selected article. Air circuit breakers ("Mgt") get no value.

Every other option value used by these models is an explicit per-value
`notApplicable` record with a reviewed reason (accessory/execution choice,
assembly component, current-transformer primary, motor setting range, contactor
operational current, or an electrical value without an approved attribute).
There is no dimension-wide or wildcard rule.

`scripts/development/generate-tiquadri-engineering-vocabulary.py` is a proposal
generator, not an application import path. Run it against a read-only, fully
imported v32 Stage B development catalogue (a delete-journal copy; SQLite cannot
open a WAL database read-only without its `-shm` file):

```sh
python3 scripts/development/generate-tiquadri-engineering-vocabulary.py /path/to/lq.db \
  --output /tmp/tiquadri-vocabulary-proposal.json
```

The output path must not exist. The script:

- refuses a catalogue with seeded model categories;
- reports source-hierarchy and primary-category conflicts;
- stops on an option dimension used only by Stage D models that has no reviewed
  reason;
- never writes the input database.

Run against the committed seed, it reproduces it exactly. Review the proposed
model names, attributes and exclusions against the source before changing the
committed JSON.

Runtime vocabulary sync uses exact stable codes and reviewed-name checks; changed
source names are reported as stale instead of silently applying old facts.
Category applicability remains the only gate for parser candidates, so:

- SPD discharge current is not breaker In/Icn;
- modular Icn is not MCCB Icu;
- motor setting ranges are not nominal In;
- contactor operational current is not In.

## Configurable product families (roadmap step 6A)

`product-families.json` contains only stable family definitions and their ordered
variant axes. Product membership is deliberately not seed data. Definitions are
keyed by `(brandMarchio, code)` and are deferred until the named brand, active
category, active enum/number attributes and category-attribute links all exist.
Manual definitions are protected. Omitted seed definitions become inactive;
retired codes cannot be reused. A materialized category and the shipped axis
contract cannot be silently changed. Retirement of an existing seed definition
is applied even when missing dependencies defer creation or axis materialization.

After category classification and attribute enrichment, the generic grouping
engine calls the grouper registered for each product's METEL marchio. A grouper
can propose zero or one existing brand-local code and receives no listing-state
input. Only automatic (`grouper`) rows are recomputed; `manual` and
`manual_excluded` rows survive startup synchronization and METEL imports. The
grouping fingerprint covers the engine and grouper versions, all effective
family/axis rows (including manual rows), and the attribute-enrichment
fingerprint.

The Step-6A BTI grouper is `bti.mcb` version 2. It uses anchored product-code
structures plus the target category, exact statistical family, exact declared
family issuer (`BTI`), exact declared breaking capacity and any specific BTDIN
series present in the description. A
specific contradictory series rejects the proposal; generic/absent series text
is tolerated. It excludes magnetic-only `FV8[23]SM…`, DC `F82N…FV1/FV2`, other
protection categories, physical metadata and all other brands.


## Preset support contribution review (adapter 7)

`tiquadri-commercial-contribution.json` is a reviewed identity list, never a
name-pattern or article-absence heuristic. Besides 1778 it approves exactly the
twelve DIN windows needed by enclosure-level preset sets that can be created
completely: 2189–2194, 2196 and 2898–2902.

Each approved window in supplied v32 is an ordinary centralino support
(`Pannello_centralino`) with a DIN rail zone, no modality definition, no base
article rows, no modality article rows and no drawing (`senza`); it is a window in
the enclosure front whose article is the enclosure's own article. Together they
make the complete preset sets of 55 active enclosures creatable (36 Linea
SPACE/WALL/HABITA, 15 Idroboard, 4 Calotte).

Article-free centralino supports deliberately left `articles` (review candidates):
- 2195: used as a preset only by obsolete enclosures;
- 1283 (SDX blank 50 mm): its SDX preset sets also need 1284–1286, whose default
  configuration is commercially unresolved, so approving it alone would only
  produce partial SDX structures;
- 3618–3625: MARINA Avanquadro relay/Megatiker windows (overlapping source
  windows; MARINA anomalies are out of scope);
- 3833, 3844–3847: Flatwall sub-panels (nested presets are out of scope);
- 4601–4603 and 4604–4607, 4697, 4698: CEE/P17 windows; every active CEE/P17
  preset set includes socket windows (Q20), so none can be completed;
- 4591–4594: not referenced by any preset.

SDX 1284–1286 have option-dependent articles and are never physical-only.
Any newly present base/modality article row or a changed reviewed name is a
classification conflict: the model stays commercial and requires a new review.
