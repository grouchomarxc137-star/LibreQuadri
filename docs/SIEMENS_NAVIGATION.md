# Apparecchi Siemens functional navigation


The catalogue presents **Apparecchi Siemens** beside **Apparecchi BTicino**. Its functional categories follow the reviewed TiQuadri Apparecchi category names and ordering, without BTicino series, models or configuration-specific subdivisions. Empty branches are hidden; **Non classificati** is last. Original Siemens FST roots remain under **Famiglie statistiche**.

The reviewed SIE delivery contains **64,981 articles in 212 statistical families**. Version 1.0.0 assigns **7,665** to reviewed functional types and **57,316** to **Non classificati**, with zero missing or duplicate assignments. The [family-by-family report](SIEMENS_NAVIGATION_REVIEW.md) records counts, destination branches, rule references, unresolved reasons and imported examples. The [versioned seed](../db/seed/siemens-navigation.json) contains the taxonomy, article rules and review decisions for all 212 families.

## Classification contract

- Each current, non-removed SIE article receives exactly one membership. An article needs its own positive description evidence and a reviewed SIE-issued statistical-family context. Reviewed manufacturer-code prefixes identify product types; they never supply electrical ratings.
- Mixed families are evaluated article by article. Leading accessory nouns and references after PER/FOR/X prevent classification as the referenced device. Reviewed modular fuse bases are identified explicitly as holders; an NH handle never becomes an NH fuse. Differential blocks remain separate from assembled differential breakers.
- Multiple matching rules, missing descriptions/family references, foreign or new families and products without a reviewed applicable type fall back explicitly. There is no catch-all assignment from a statistical-family title, a broad technical category or a stored filter value.
- Unclassified articles are grouped by the original family identity and imported label. Missing references use **Senza famiglia statistica**. Nodes retain their IDs when hidden or restored.
- Navigation classification and technical attribute enrichment are independent. A classified accessory may have no technical values; a PLC with valid I/O counts may have no applicable TiQuadri navigation type.
- As in the existing catalogue, delisted articles retain their identity and browse membership; `listedOnly` controls their visibility in results. Removed products and inactive brands contribute no memberships/counts. Brand removal deletes memberships, and reimporting the current delivery recreates them under the same retained article/node IDs. Disabling and re-enabling a brand also reconciles memberships immediately.

## Storage and synchronization

Migration **0016_outstanding_millenium_guard** adds `cat_range_node_product`, keyed by `(product_id, classification_code)` with an index on `(node_id, product_id)` and cascading foreign keys. Rows store the destination, rule code/version, taxonomy/rules fingerprint, article-input fingerprint and unresolved reason. The Siemens classifier uses `classified.sie`; its nodes use `classified.sie.*`, `source='metel'`, `source_level='classified'`. FST nodes retain `metel.*` and their original family links.

The shared recursive membership SQL includes direct article memberships alongside FST and engineering entries, deduplicating within each selected subtree. Browsing, node counts, facets, search, paging and article listing therefore use the same population. Article positions include both the functional leaf and original FST leaf. Both routes read the same `cat_product` and commercial price records through unchanged public API shapes.

The shared derived-catalogue pass reconciles Siemens navigation after attribute enrichment during startup, METEL normalization and engineering reimport. The application seed folder is passed explicitly by startup/import workers. Reconciliation fingerprints taxonomy/rules and article description/code/family context, updates changed assignments, removes stale memberships, and hides retired nodes. An unchanged repeat makes no navigation writes. Synchronization owns a transaction/savepoint and participates in the enclosing import/startup transaction: a failure rolls back assignments, navigation nodes and all enclosing derived/import writes together.

This feature creates no products, synthetic METEL families, configuration models, technical category replacements or engineering capabilities. Siemens series and manual classification editing remain deferred. Installation and publishing are separate tasks.

## Verification

Validation uses disposable catalogue, source and asset copies under `build/siemens-navigation/`; installed Development/Desktop data and projects are untouched. Preservation hashes match all **69 pre-existing tables** (excluding migration history and newly derived nodes), including products, prices, listings, categories, technical attributes, brands, FST memberships and engineering definitions. SQLite integrity and foreign-key checks pass.

Automated checks cover mixed families; MT/MTD/pure differentials; cylindrical/NH links versus modular and Class J holders; NH handles and auxiliary contacts; conflicting rules; missing/foreign family context; every functional ancestor's actual population/count; all Siemens levels' facet counts; combined filters, text and paging; equal article identity/price through both trees; mounted UI filter persistence and clearing; startup reconciliation; unchanged repeats; description/rule/taxonomy changes; delisting/removal; brand disable/restore and same-delivery reinstall; and forced import/standalone synchronization rollback. BTicino/TiQuadri regressions retain their existing engineering behavior.

Final source-enabled full suite (2026-10-27): **1,819 passed, 23 conditional skips, zero failures**; 144 files passed and four skipped. This includes the complete Siemens import and all 37 source-enabled TiQuadri checks. Typecheck, production build, project-manifest check and diff checks pass. The generated report reproduces byte-for-byte. Packaged native-app installation is outside this delivery.

Reproduce the report after migration/startup synchronization:

```sh
npm run build:main
node dist/scripts/siemens-navigation-report.js /absolute/path/to/disposable/data/lq.db output.md
```

The report command opens the catalogue read-only. Full-suite real-data execution requires `LIBREQUADRI_REV83_REAL_DB` pointing to a migrated disposable `data/lq.db` with its copied sibling `assets/`, plus `LIBREQUADRI_TIQUADRI_MDB` and `LIBREQUADRI_LISTINOBT_MDB` pointing to the copied source MDBs. Additional historical fixtures remain conditional.
