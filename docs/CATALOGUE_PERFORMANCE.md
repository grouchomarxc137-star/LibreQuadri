# Catalogue navigation and filter performance


Implemented 2026-10-27; measurements taken on macOS with Node v25.2.1. Automatic updates and the existing catalogue API, schema, project format, result ordering and filter semantics are preserved. Installation and publishing status is recorded in the linked Alpha 1.1 release update.

## Changes

- Unselected technical attributes share one grouped count query over the matching population. Selected attributes retain their own count query excluding their own selection. Package-offer contributions use the existing feasibility and trust rules.
- Per-connection LRU caches retain at most 128 metadata entries (root definitions/universes, applicability and reference data) and 32 criteria summaries (facets and totals). Summary keys include node, search, listing, brands, configurability and selected attributes, excluding pagination. Products and prices are still fetched for each page.
- Both caches invalidate on `total_changes()` or `PRAGMA data_version` changes. Transactional reads bypass caches, preventing rolled-back views from entering them. Stored/returned facet summaries are cloned to prevent caller mutation from poisoning later responses.
- Closed filter dropdowns mount no checkbox lists. Only the open checklist renders options. Presented facets, numeric sorting and navigation indexes are memoized; the navigation component skips unrelated controller renders. Scrollbar and popover measurements coalesce to one animation frame, and unchanged scrollbar dimensions do not trigger state updates.
- Each browse session allows one request in flight and replaces pending requests with the newest complete criteria. There is no added debounce or Apply button. Superseded results/errors cannot replace the current state. Paging, retry, clearing, disposal and StrictMode effect replay are covered.

## Measurements

Measured with the same disposable catalogue, Node/SQLite connection settings and before/after request corpus. The catalogue includes 64,981 Siemens products and both Siemens navigation trees. Ten warm repetitions follow the first request. Values below are median milliseconds; these repeated requests benefit from the new bounded summary cache.

| Request | Before | After | Reduction |
|---|---:|---:|---:|
| Apparecchi Siemens root | 1,124 | 41 | 96% |
| Siemens statistical root | 1,203 | 43 | 96% |
| BTicino root | 109 | 20 | 82% |
| Narrow Siemens category | 90 | 15 | 83% |
| Siemens current filter | 1,197 | 49 | 96% |
| Siemens current + poles | 1,267 | 49 | 96% |
| BTicino search, listed only | 112 | 19 | 83% |
| Siemens next page | 1,143 | 41 | 96% |

A separate paired benchmark uses **ten distinct, previously unseen current/listing combinations per Siemens tree**, so it does not rely on summary-cache hits:

| Tree | Before median | After median | Reduction |
|---|---:|---:|---:|
| Apparecchi Siemens | 1,227 ms | 213 ms | 83% |
| Siemens statistical families | 1,287 ms | 222 ms | 83% |

Both exceed the 70% improvement target and meet the warm-median target below 300 ms. First root visits still take approximately 0.53–0.55 seconds; first unique filter requests in the original corpus took 214–235 ms. Repeated Siemens requests had a maximum/p95 of approximately 42–50 ms. These are local fixture measurements, not a guarantee for every machine or catalogue.

All **28 complete response comparisons** (eight standard requests and twenty fresh combinations) match the pre-change implementation, including product details/prices, counts, ordering, package data and selected facet values. Before measurements used an archived copy of the pre-change compiled modules, not a separately implemented query oracle.

## Validation and reproduction

- Cache regressions cover same-criteria local/external updates, transactional definition/count changes and rollback, response mutation isolation, paging reuse, criteria separation and LRU eviction. Existing package and attribute tests verify numeric/enum values and disjunctive counts.
- Renderer regressions cover lazy mounting, unavailable and selected-zero-count values, numeric ordering, focus/Escape/outside dismissal, brand navigation and latest-request handling. Dedicated tests exercise rapid selections, stale failures, retries, clearing, disposal/StrictMode reselection and synchronous failures.
- Isolated Electron mounts the actual ProjectShell in StrictMode, using real readonly catalogue queries through a test IPC bridge. First Siemens root load took 547 ms; current 16 A returned exactly 420 articles. A four-switch burst issued only the first and final queries and ended at Siemens with 64,981 articles. No checkbox options were mounted for closed facets; the open current menu mounted 107 options. Hover-scrollbar and 80-component list reachability checks passed; screenshot visually inspected.
- The Electron bridge runs the Node-built SQLite module in a separate process for the harness only. Production query execution remains synchronous; this change does not claim to remove every possible main-process stall.
- Full suite results and final typecheck/build checks are recorded in STATUS.md. No installed catalogue or project files were changed.

Local evidence is in ignored `build/catalogue-performance/`: archived `baseline-dist/`, before/after JSON responses and logs, paired fresh-filter measurements, Electron fixture/bridge/capture, screenshot, and full-suite log. The benchmark scripts open only the disposable catalogue at `build/filter-visibility/installation/data/lq.db`.

```sh
# Requires the local archived baseline and disposable fixture described above.
node build/catalogue-performance/benchmark.mjs before
node build/catalogue-performance/benchmark.mjs after
node build/catalogue-performance/fresh-filters.mjs

LIBREQUADRI_REV83_REAL_DB="$PWD/build/filter-visibility/installation/data/lq.db" \
LIBREQUADRI_TIQUADRI_MDB="$PWD/build/siemens-navigation/sources/tiquadri/BTQUADRI.mdb" \
LIBREQUADRI_LISTINOBT_MDB="$PWD/build/siemens-navigation/sources/tiquadri/ListinoBT.mdb" npm test
```
