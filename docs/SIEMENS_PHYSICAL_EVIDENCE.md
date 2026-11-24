# Siemens physical-data evidence audit


Audit date: 2026-11-04. **Evidence report only; no application integration.**

The public-source route supplies useful article-specific DIN width evidence, but
this pass does **not** establish complete manufacturer coverage. Every one of the
3,519 selected articles has a ledger row. Accepted, non-conflicting manufacturer
DIN module widths cover **554 articles**; another **five** have source-versus-
description conflicts. Actual width/height/depth are verified for only **eight**
articles. Do not confuse nominal mounting width with measured body dimensions.

## Baseline and scope

- Source-code baseline: `63fe2d1c5d3909f6aa9177b39b36a1718d879800`.
- Frozen database: `build/enclosure-review/verified.db` (119 MiB).
- Database SHA-256: `5bdb4c58382057a219c0ae853f08a872b104fa7c071915d59664c3ad517ce08c`.
- Opened using SQLite `mode=ro&immutable=1`; no sibling WAL exists. The file hash
  remained identical after extraction and validation.
- Snapshot population: 64,981 current, non-removed Siemens articles. This audit
  includes listed and delisted articles within that population.
- Cohort: **3,229** articles in `classified.sie.dispositivi_modulari.*`, plus
  **290** unclassified articles with explicit UM/U.M./MW notation before a
  PER/FOR/FUER/FUER-with-umlaut/X reference. These are disjoint sets.
- The current category tree is preserved. The cohort is fixed to this snapshot;
  these are not live installed-application counts.

The raw notation candidates include enclosure capacities, accessories and fit
references. Their inclusion is not an assertion of device occupancy. Nine cohort
EANs are all-zero placeholders and are unusable for identification; the remainder
pass the EAN-13 checksum. Product codes, not EAN placeholders, identify records.

## Retrieved sources and access limitations

Five complete official Siemens PDFs were downloaded, hashed, extracted locally
with Poppler and visually inspected. Dates below are the document editions, not
search-engine crawl dates. These historical editions are not represented as the
latest catalogue or current compatibility certification.

| Cached source | Edition | Official source |
| --- | --- | --- |
| `rcd-2023.pdf` | LV 10 04/2023 | [Residual-current protective devices and AFDDs](https://cache.industry.siemens.com/dl/files/639/109750639/att_1144045/v1/04_ResidualCurrentProtectiveDevices_LV10_042023_EN_202306011610411215.pdf) |
| `switching-2023.pdf` | LV 10 04/2023 | [Switching devices](https://cache.industry.siemens.com/dl/files/645/109750645/att_1144050/v1/05_SwitchingDevices_LV10_042023_EN_202306011752530970.pdf) |
| `transformers-2023.pdf` | LV 10 04/2023 | [Transformers, power supplies and socket outlets](https://cache.industry.siemens.com/dl/files/646/109750646/att_1144202/v1/12_Transformers_LV10_042023_EN_202306050945131542.pdf?download=true) |
| `boards-2023.pdf` | LV 10 04/2023 | [Distribution boards](https://cache.industry.siemens.com/dl/files/658/109750658/att_1144521/v1/15_DistributionBoards_LV10_042023_EN_202306071322302373.pdf) |
| `spd-2017.pdf` | 2017-03-30 | [5SD7412-2 datasheet](https://cache.industry.siemens.com/dl/files/713/109746713/att_917217/v1/5SD7412-2_Datenblatt_2017-03-30_201704121539225173.pdf) |

The final source manifest also records **15 unsuccessful source routes**:
403 responses from the MCB attachment and five required individual datasheets;
404 responses from indexed MCB/cache/2025 chapter links; and non-PDF responses
from five alternative Industry Mall datasheet requests. Each route has its URL,
attempt time and outcome. These are source-route failures, not 15 missing products.

Consequently the `5SL3025-7` one-module check remains **description-only** in this
report. Earlier search snippets are not admitted as verification. No full crawl of
3,519 individual datasheet endpoints is claimed: repeated failures of the shared
service were not multiplied into thousands of redundant requests.

## Reconciliation method

1. Match complete printed article codes after removing only whitespace and
   hyphens and uppercasing. The selected Siemens identities have no collision
   under that normalization. Preserve suffixes; never match another brand,
   a similar description or a product-code prefix as if it were the exact article.
2. Extract explicit row mounting widths. For selected 5SU/5SV ordering grids,
   accept exact printed codes only when all width-column headers agree. Stop
   before accessory, mounting-concept and further-specification regions.
3. Review transformer/PSU ordering cards explicitly, including continuation-page
   headers. Keep adapter selection, busbar coverage, wall-mounted timer variants
   and socket-lid fit widths out of consumed DIN occupancy.
4. Accept mechanical dimensions only from labelled fields or exact rows with
   three explicit external dimensions. Do not fill merged cells or infer body
   width from MW, module count from poles, or modules by dividing millimetres by 18.
5. Compare each field independently with explicit description notation or existing
   `sie.description v1` parser dimensions. Existing parser facts remain
   description-only. Unclassified products can receive physical facts without
   being assigned a new category.

States are **corroborated**, **manufacturer-only**, **description-only**,
**conflicting**, **unknown**, or **not applicable**. A conflicting field has no
accepted value: both source evidence and description value remain in the ledger.
Enclosure module notation is recorded as capacity/fit evidence, not rail occupancy.
For unclassified articles of unresolved role, notation is retained separately
without asserting occupancy. Overall and installation depth remain separate.

Each manufacturer fact includes the exact code match, value/unit, source URL,
source SHA-256, document edition, one-based PDF page, table/field and raw context.
Description evidence identifies the snapshot hash, product ID and input/parser.
PDF page numbers below include cover pages; printed chapter pages are also given
for the principal examples. No information is taken from packaging dimensions.

## Coverage

Each row below totals 3,519. Manufacturer counts exclude unresolved conflicts.

| Field | Corroborated | Manufacturer-only | Description-only | Conflicting | Unknown | Not applicable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| DIN modules | 219 | 335 | 329 | 5 | 2,587 | 44 |
| Width, mm | 0 | 8 | 11 | 0 | 3,500 | 0 |
| Height, mm | 0 | 8 | 8 | 0 | 3,503 | 0 |
| Overall depth, mm | 0 | 8 | 0 | 0 | 3,511 | 0 |
| Installation depth, mm | 0 | 0 | 0 | 0 | 3,519 | 0 |
| Mounting method | 0 | 8 | 0 | 0 | 3,511 | 0 |
| Capacity/fit modules | 0 | 0 | 44 | 0 | 3,475 | 0 |

**567 distinct articles** have at least one manufacturer fact, including the five
unresolved DIN conflicts. Seven small distribution boards and one historical SPD
supply the eight complete external dimension sets. Counts overlap across fields.

| Existing branch | Cohort articles | Any manufacturer evidence, including conflicts | Accepted manufacturer DIN widths |
| --- | ---: | ---: | ---: |
| Accessori modulari | 50 | 20 | 20 |
| Alimentatori modulari | 1 | 1 | 1 |
| Contattori modulari | 65 | 64 | 64 |
| Differenziali puri | 230 | 0 | 0 |
| Magnetotermici | 2,224 | 0 | 0 |
| Magnetotermici differenziali | 449 | 226 | 226 |
| Portafusibili modulari | 26 | 0 | 0 |
| Rele modulari | 158 | 105 | 100 |
| Sovratensione | 18 | 0 | 0 |
| Trasformatori modulari | 8 | 8 | 8 |
| Unclassified notation cohort | 290 | 143 | 135 |
| **Total** | **3,519** | **567** | **554** |

Zero coverage is not evidence that manufacturer data is absent. This is a
conservative extraction pass, not exhaustive extraction of every table or drawing
in the downloaded chapters. In particular, exact mentions without a supported
physical-field layout are retained for further review; RCCB and mixed-width
layouts need additional work. MCB and fuse coverage also needs accessible sources.

## Required examples and disagreements

| Article | Evidence result | Locator |
| --- | --- | --- |
| `5SL3025-7` | Imported `1UM`; official download blocked, so not manufacturer-verified | Ledger `5SL30257`; failed routes in manifest |
| `5ST3010` | **0.5 MW**, manufacturer-only | RCD PDF page 62, printed 4/58, exact accessory row |
| `5ST3053` | **1.5 MW**, corroborates imported `1,5 UM` | RCD PDF page 70, printed 4/66, remote-control table |
| `5SD7412-2` | **35.6 W x 89.8 H x 77.5 D mm**, DIN rail 35 mm; historical revision | SPD PDF page 1, 2017-03-30 |
| `8GB1371-3` | **410 W x 285 H x 140 D mm**, surface mounting | Boards PDF page 215, printed 15/211 |

The SPD's imported **2UM** remains a description candidate, not a measurement of
36 mm. Its historical 89.8 mm height is not silently replaced with 89.9 mm from an
unretrieved newer search result. Installation depth is not asserted from overall
depth, mounting illustrations or dimensions of packaging.

**Five unresolved disagreements:** `5TT4204-0`, `-1`, `-2`, `-3`, `-4`.
The switching catalogue's exact rows say **1 MW**; the imported descriptions say
**2 UM**. All five rows were visually checked on PDF page 32, printed 5/28.
The evidence does not decide whether this is a catalogue error, description error
or revision difference. Obtain a current article-specific source before adoption.

## Category review candidates

Only two narrowly evidenced corrections are proposed in this pass; neither is
applied and neither requires a new branch:

- `5ST3053` -> `dispositivi_modulari.accessori`: its exact row appears under
  electrical accessories / remote-control mechanisms (RCD PDF 70 / 4/66).
- `5SD74122` -> `dispositivi_modulari.sovratensione`: the exact historical
  datasheet identifies T1/T2 protection, DIN mounting and surge-current data.
  Confirm against a current revision before adoption.

Other unclassified products retain their current status. Nominal module width is
not sufficient to establish a device type, and these physical facts do not create
engineering profiles or prove fit in any BTicino panel.

## Validation and local artifacts

All artifacts are under ignored `build/siemens-physical-evidence/`:

- `ledger.json` and `ledger.csv`: complete 3,519-article results and evidence.
- `source-manifest.json`: retrieved PDF hashes, source URLs and failure outcomes.
- `summary.json`, `layouts.json`, `validation.json`: coverage, accepted layouts,
  representative records for all ten existing branches, and checks.
- `sources/`: original PDFs and extracted text. `captures/`: individual page PNGs
  and contact sheets; 36 pages inspected, 34 used in final accepted extraction.
- `fetch.py`, `analyse.py`, `render.py`, `validate.py`: reproducibility helpers.

Validation passed: exact cohort/identity and CSV counts; complete per-field state
partitions; PDF and baseline hashes; suffix preservation; half/fractional modules;
all-zero EAN rejection; five unresolved disagreements; body width kept separate
from occupancy; and enclosure capacity/busbar-reference exclusions. The busbar
`5ST37703`, whose notation occurs after a reference, is excluded from the cohort.
Wall-mounted timer rows and lid-fit tables are excluded from DIN extraction.

All accepted table families and conflict rows were reviewed in rendered PDF
pages. Branch samples with no accepted fact are explicitly pending; their source
checks do not become successful merely because the inventory is complete. The
required one-module MCB manufacturer check remains blocked. The application test
suite was not rerun for this documentation-only delivery.

Offline reproduction from repository root (Python with PyMuPDF/Pillow, Poppler):

```sh
python3 build/siemens-physical-evidence/analyse.py
python3 build/siemens-physical-evidence/render.py
python3 build/siemens-physical-evidence/validate.py
```

These commands read the frozen snapshot and cached PDFs and rewrite only ignored
audit artifacts. Keep the original snapshot and cache to reproduce this result;
they are not available from Git alone. `fetch.py` is optional network acquisition,
not part of deterministic offline reproduction; its outcomes can change over time.

The next data work is to obtain accessible MCB/fuse sources and current datasheets,
expand reviewed RCCB/mixed-table layouts, and resolve the five discrepancies.
Application integration, catalogue changes, project changes, installers and push
are outside this delivery. Only this report is intended for the local Git commit.
