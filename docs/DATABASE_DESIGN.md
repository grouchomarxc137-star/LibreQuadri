# LibreQuadri: Database Architecture & METEL Import Pipeline


Status: **Revision 8 remains the current architecture. `.lqp` format 5 (physical-only configured items, R-19a) is merged. Format 6 added `prj_annotation` for Fronte Quadro text annotations. Format 7 (annotation box size) merged on main at `ff6676076768e47e706ff5e0b3803966f2468224`. Format 4 added engineering-context snapshots on top of format 3 (portable placement metadata and a generic physical placement core). A first technical Progettazione screen and a first parametric Fronte Quadro are implemented. The article-first catalogue browse API and three-panel Catalogo are also merged (see STATUS.md).**

Review candidate format 8 adds project-owned commercial settings only: `prj_item_bom.line_discount_bp` for each configured component (keyed by its item and ordered BOM sequence), `prj_project.labour_total_e4`, and active use of existing `prj_line.line_discount_bp` for ordinary product rows and `prj_project.global_discount_bp`. Format-7 migration initializes all discounts and labour to zero without a catalogue. Percentages are integer basis points, 0–10000; labour is nonnegative integer E4. Per-row gross is rounded half up to E4 for fractional quantities, then the line discount amount is rounded half up to E4. The global discount is rounded half up on the sum of net rows, then labour is added. Configured rows stay contextual in Preventivo while the Distinta material aggregation remains unchanged.

Format 9 adds `prj_annotation.font_size_mm` (REAL, default 12, CHECK 6–60): the text size of each Fronte Quadro text box in drawing millimetres. Format-8 boxes migrate to 12 without a catalogue. Current project format is 10; engineering provenance and explicit safe refresh are described in §7.12.
Date: 2026-09-25

- Decisions **D1–D11** were confirmed by the product owner (§16).
- Revision 5 received independent **supervisor approval on 2026-09-21** (§16). Revision 4 went through supervisor review; Revision 5 corrects the four findings of that review and changes nothing else, except where a correction directly required it.
- Revision 6 records the **supervisor-confirmed Step-6 product-family architecture** (2026-09-22, §5.5, §16). It changes only what the family model directly requires.
- Revision 8 records the configured-item architecture that the supervisor requested on 2026-09-23 after reviewing the architecture proposal of that day, including the **product-owner correction** of the same day: the full supported BTicino dataset is imported, and there is no scope-limited importer (§9.3, §15, §16). Open points are listed in §16.

Revision history:

- **Rev 1:** conceptual model (raw METEL → normalized catalogue → enrichment → commercial → quotes).
- **Rev 2:** physical design for a local Electron + React + TypeScript + SQLite desktop app (macOS + Windows). PostgreSQL, JSONB and `pg_trgm` were removed.
- **Rev 3:** portable project files.
- **Rev 4:** decisions D1–D11 applied (§16):
  - pure document model for projects (`.lqp` file = the project, with no project library in `lq.db`),
  - Drizzle ORM,
  - `lq.db` independent of raw METEL IDs,
  - `LOCALAPPDATA` on Windows,
  - visible numbering independent of the installation.

  Contradictions between revisions 1–3 were resolved.
- **Rev 5:** supervisor review corrections (details at the end of §16):
  1. METEL **delivery** identity is separated from **source-file** identity.
  2. METEL **issuer** is separated from **manufacturer/brand ownership**.
  3. The `.lqp` save procedure now preserves the previous version *before* replacement.
  4. The `.lqp` untrusted-file schema validation is defined precisely.
- **Rev 6:** Step-6 configurable product families (details at the end of §16):
  1. Family definitions are seed/manual, brand-scoped, and a compatibility contract.
  2. Product membership moves from `cat_product` columns to a separate singular assignment relation with automatic, manual, excluded and absent states.
  3. Variant values come from `cat_product_attribute`; axis tuples are unique across all members; resolution works on actual members only.
  4. Family conflicts are derived, not review rows. Brand logic lives behind a generic grouper interface.
  5. The first slice is the verified 10-family / 520-product BTI MCB set (§5.5, §15).
- **Rev 7:** Step 7A project creation and minimal persistent quotation slice:
  1. `prj_project` gains the confirmed project description, project type, derived norm code, executor, project date and company description fields.
  2. The two initial project types and their norm-code mapping are a document constraint as well as application validation.
  3. The first `.lqp` migration and the New/Open/Save snapshot quotation flow implement the existing pure-document architecture without adding a project library to `lq.db`.
  4. Native paths remain in the main process; the renderer receives only a one-use destination token and a safe display name.
  5. Incoming format `k` is validated against manifest `k`, copied into a schema built with migrations `1..k`, then migrated to the current format.
- **Rev 8:** configured items, physical containment and BTicino engineering data (details at the end of §16):
  1. Generic configuration models (`cat_config_*`) sit beside the unchanged product families. Accessories that change the BOM or the physical state are configuration options (§5.6).
  2. Physical state belongs to the configured item. Integer capacity kinds, zones, fit classes and accept sets express carpenteria/support/device compatibility (§5.8).
  3. Drawings live in a licensed asset store addressed by logical keys; parametric rendering is the baseline (§5.9).
  4. Engineering-source import design covers the full supported dataset, with provenance, conflicts and an explicit skipped-record report (§5.10, §9.3). The TiQuadri import is implemented; the optional ListinoBT input currently provides module-count comparison, while its article-physical adapter remains deferred.
  5. `.lqp` format 2 adds configured items, recursive `prj_node` containment, `item` quotation lines and `prj_asset`. The `prj_panel*` placeholder is withdrawn (§7.6, §7.11).
- **Rev 8.1:** manufacturer catalogue navigation (§5.11; details at the end of §16):
  1. For BTicino Apparecchi the catalogue follows TiQuadri: Gamma → Tipologia → Famiglia → Modello → Articolo. The UI "Famiglia" is the TiQuadri class level, not `cat_product_family`.
  2. The TiQuadri browse-tree import is corrected: no duplicated leaf level, and orphan and internal ranges are handled explicitly.
  3. Articles outside TiQuadri are navigated by METEL statistical family. The storage direction is approved (Q27) and merged on main.
- **Rev 8.2:** LibreQuadri Apparecchi categories and Catalogo selectable packages (§5.11; details at the end of §16):
  1. Ten Project-maintained categories group the BTicino Apparecchi Gamme. The approved mapping is seed data applied by the TiQuadri adapter; the UI shows hierarchy names without level prefixes.
  2. The article-first Catalogo boundary is amended. A configuration model without a primary article is a selectable package when it resolves to linked catalogue articles. It is configured inline in the Catalogo inspector through the generic resolver and added through configured-item insertion. No article identity or price is invented.
- **Rev 8.3:** engineering context and Progettazione discovery foundation (details at the end of §16). A separate context vocabulary filters structural candidates alongside physical class compatibility. The structural root alone provides context; project files and Catalogo behavior are unchanged.
- **Rev 8.4 (APPROVED architecture, supervisor review 2026-10-19):** Stage A was merged to `main` at `0e049e3`; Stage B is implemented on `review/tiquadri-stage-b-foundation` pending supervisor merge approval; Stages C–F are not implemented. TiQuadri engineering-derived classification and technical filters are specified at the end of §16.
  1. Reviewed vocabulary seed: what each value means, and facts and contributed category per model.
  2. An engineering classification tier.
  3. Generic derivation of article attributes from each article's own selecting option and its model facts.
  4. One filtering contract for articles and selectable packages.
  5. Explicit Icn/Icu, In/Im and poles semantics.

  Schema impact: two vocabulary tables and four package-offer tables created in Stage B, two additive columns (Stage B), and one Stage B rebuild of the leaf table `cat_product_attribute` to add the `engineering` source and its provenance. Stage F will compute and filter package offers using the existing tables. Corrected 2026-10-19: attribute ownership, persistent number options, feasible package offers.

This document sets out:

- how raw METEL files are stored,
- how they become one normalized, multi-brand catalogue,
- how we enrich that catalogue with data METEL does not provide,
- how prices and projects/quotations sit on top of it,
- how projects live as portable document files,
- how everything is physically stored, migrated, backed up and accessed in a local Electron app on macOS and Windows.

It is based on the real files we received, not on the METEL spec alone. See §1.

---

## 0. Guiding decisions

### Conceptual

1. **Layers, strictly one-directional:**
   `RAW (metel)` → `CATALOGUE (normalized + enriched)` → `COMMERCIAL` → `PROJECT DOCUMENTS` (quotation + later panel configuration).
   Raw data is never edited by hand, and normalized data is never written back into raw tables.
2. **Nothing brand-specific in the schema.** Brand knowledge lives in *data*, in three forms:
   - version-controlled seed files and mapping rows,
   - small per-brand "description parser" modules in the enrichment step,
   - per-source import adapters that turn manufacturer engineering data into generic rows (§9.3). The configuration engine, placement, rendering and UI contain no brand or SKU rules.
3. **Imports never destroy manual work.** Every enriched value records its `source`. Re-imports only overwrite values that were themselves imported.
4. **Catalogue products are never hard-deleted.** Price history, relations and re-resolution of opened projects rely on them. Products that disappear from a listino are marked as no longer listed.
5. **Projects snapshot everything they need.** A project copies product, price and configuration data at the moment of use. It remains valid on any installation, with any listino version, or with no catalogue at all (§7).
6. **Projects are documents, catalogues are local.**
   - Each installation has its own local catalogue.
   - A project is a `.lqp` file that the user creates, opens, saves, "saves as", closes and sends, like a Word/Excel file.
   - Inside a project, identity uses UUIDs and natural keys, never local database IDs.

### Physical

7. **SQLite, embedded, local, single user per installation.**
   - The Electron **main process** owns all database connections, plus a worker thread for imports.
   - The React renderer never touches SQLite. It calls a typed IPC API.
8. **Three kinds of SQLite files** (§3.1):
   - `lq.db`: normalized + enriched catalogue, commercial conditions, app settings. It must be fully usable on its own.
   - `metel_raw.db`: raw METEL source files (parsed rows). Used only by the import pipeline.
   - `*.lqp`: one project per file, a user document.
9. **Table-name prefixes instead of schemas:**
   - `lq.db` uses `cat_`, `com_` and `app_`.
   - `.lqp` files use `prj_` and `lqp_meta`.
   - `metel_raw.db` tables are addressed as `metel.<table>` when attached during imports.
10. **Relational over JSON.** Anything filtered, joined or validated (conditions, mappings, attributes) uses normal columns and foreign keys. JSON (`TEXT` + JSON1) is used only for opaque blobs such as import summaries.
11. **Search uses SQLite FTS5** (bundled): a word index for descriptions, a trigram index for partial codes, and a normalized code column for exact/prefix lookup.
12. **Tooling:**
    - **better-sqlite3** driver (D1).
    - **Drizzle ORM** for normal typed access, with **drizzle-kit** SQL migrations (D2).
    - **Direct SQL is allowed where appropriate:** FTS5 tables/triggers/queries, bulk import statements, cross-database (`ATTACH`) queries, and backup/maintenance pragmas.

---

## 1. What the actual METEL files look like (findings)

Files analysed: BTicino (`BTI*`), Siemens (`SIE*`), and also Schneider (`SNR*`), which was in the same folder and is a useful third test case.

| File set | Records | Tracciato version | Brands (marchi) inside the listino | Trailing v021 fields |
|---|---|---|---|---|
| BTILSP021 + BTIFSC + BTIFST | 24,676 | **021** (234 chars) | BTI 9,439 · LEG 9,542 · IMS 4,567 · ZUC 560 · CAB 556 · NTM 12 | populated |
| SIELSP_20260701 + SIEFSC + SIEFST | 68,117 | **020** (178 chars) | SIE 64,981 · BCT 3,136 | absent |
| SNRLSP021 + SNRFSC + SNRFST | 29,742 | **021** (234 chars) | SNR 29,742 | mostly populated |

Format facts that shape the design:

- **Fixed-width text, CRLF, Latin-1 encoded.** `SIEFST.TXT` contains non-ASCII bytes.
  - Decode as Windows-1252 (`TextDecoder('windows-1252')`).
  - Normalize line endings.
- **Two layout versions exist at the same time** (020 and 021). The parser reads the version from the header and chooses the layout.
- **One file ≠ one brand.** A file is issued by a *company* (header sigla + P.IVA) and contains products of several *marchi*: BTicino ships Legrand, Zucchini, Cablofil, etc.; Siemens ships `BCT`.
  - Product identity is **(marchio, codice prodotto)**.
  - **The issuer is not necessarily the owner of the brands it lists.**
    - BTicino's file carries Legrand-group marchi.
    - A distributor or group company could issue a listino for third-party brands.
    - The same marchio could appear in listini of more than one issuer.

    The schema therefore keeps **issuer**, **brand** and **manufacturer** separate (§5.1).
- **Family files are keyed `issuer(3) + marchio(3) + family code`.** The listino row stores only the bare family code. The join is `(issuer, product marchio, code)`.
- **Family codes are opaque and each brand has its own style:**
  - BTicino statistical: `CIV.-108-112-427`, hierarchical, with a two-level description
  - Siemens: `R711 I33A`
  - Schneider: `AUTPELHMIACC`, the same code in both files
- **Current family references resolve completely.** With the complete 18-character family code, all BTicino LSP statistical- and discount-family references resolve against the supplied `BTIFST`/`BTIFSC` files. The `(issuer, marchio, family type, code)` identity is unique in every supplied BTI, SIE and SNR family file. Imports must still tolerate genuinely unknown codes in future deliveries.
- **Prices:** 11 digits with 2 implied decimals, i.e. integer cents.
  - The price applies to the **moltiplicatore** quantity (`1`, `100`, `1000`).
  - The two price fields (rivenditore / pubblico) are identical in all three files.
- **Unit of measure:** `PCE`, `LM`, `BRD`.
- **Descriptions are only 43 characters.** They are abbreviated and follow brand conventions: BTicino writes `btdin60 - magnetot 1P curva B 10A 6kA`, Siemens writes abbreviated uppercase. They are the main and least reliable source of derived attributes.
- **Product codes are stored without separators.** Siemens `3RH21222KM400LA0` is written `3RH2122-2KM40-0LA0` in catalogues, so search must normalize codes (§8).
- `Prodotto composto` = 1 only for 463 Schneider products (kits).
- **Stato prodotto and lead time are single-character codes.** Store them raw and decode them through a lookup table from the official spec.
- **v021 trailing area (cols 178+):** a numeric code (e.g. `1611`, `20220`), presumably **Electrocod**, sometimes followed by a GS1/barcode block.
  - It is the only cross-brand classification METEL gives us, and Siemens (v020) lacks it.
  - *To be confirmed against the official tracciato.*

### Record layout used by the parser (1-based columns)

| Cols | Field | Notes |
|---|---|---|
| 1–3 | Marchio | brand sigla |
| 4–19 | Codice prodotto | right-trim |
| 20–32 | EAN | |
| 33–75 | Descrizione | 43 chars |
| 76–80 / 81–85 / 86–90 / 91–96 | Qtà cartone / multipla / minima / massima | |
| 97 | Lead time code | |
| 98–108 | Prezzo rivenditore | integer cents |
| 109–119 | Prezzo pubblico | integer cents |
| 120–125 | Moltiplicatore prezzo | |
| 126–128 | Valuta | |
| 129–131 | Unità di misura | |
| 132 | Prodotto composto | |
| 133 | Stato prodotto | |
| 134–141 | Data variazione | YYYYMMDD |
| 142–159 | Famiglia di sconto | |
| 160–177 | Famiglia statistica | |
| 178–234 | v021 only: Electrocod + barcode fields | |

Header: `LISTINO METEL` (1–20), issuer sigla (21–23), P.IVA (24–34), numero listino (35–40), data decorrenza (41–48), data ultima variazione (49–56), descrizione (57–86), version.

Family files: header (`FAMIGLIE DI SCONTO  020` / `FAMIGLIE STATISTICHE020`), then issuer (1–3), marchio (4–6), code (7–24, 18 characters), description (25–~94). The observed 18-character width is required by the supplied files; its exact official definition remains open pending the METEL tracciato.

The layouts for 020 and 021 are defined **as data** (a TypeScript constant: field name, start, length, type), so a future version (022…) is a small addition.

### BTicino engineering sources (findings, revision 8)

These files were analysed read-only on 2026-09-23:

- `BTQUADRI.mdb`: TiQuadri master data "Aggregati Quadri", version 32, 2025-05-28;
- `BTQuadriDXF.mdb`;
- `ListinoBT.mdb`: TiPre, "BTICINO 2025 RR - 01 OTT 25";
- the TiQuadri `wmfwhite` / `wmfblack` drawing folders;
- a TiQuadri project file, `PrjQuadri.mdb`.

| Source | Content relevant to LibreQuadri |
|---|---|
| `BTQUADRI.mdb` | 10,800 packs (`ANA_PACK`, 7,823 active)<br>49,706 option rows (`ANA_MODALITA`) in 2,667 definitions<br>76,757 option → article rows (`ANA_ART_MODALITA`)<br>14,855 base-article rows (`ANA_ART_PACK`)<br>6,507 apparatus profiles (`ASS_PANNELLI_QUADRI_APPARECCHI`)<br>1,689 panels (`ANA_PANNELLI`)<br>758 enclosures (`ANA_ARMADI`)<br>6,576 panel ↔ enclosure links (`ASS_PANNELLI_ARMADI`)<br>a 532-node browse hierarchy (`GERARCHIA`, `ANA_CLASSE`, `ASS_GERARCHIA_CLASSE_PACK`)<br>thermal, TiSystem and wizard tables |
| `BTQuadriDXF.mdb` | 4,532 DXF R12 drawing blocks, named like the WMF files |
| `ListinoBT.mdb` | 23,587 articles, with prices older than METEL's<br>`ANA_ART_MONTAGGIO`: assembly times and `POLI_DIN` in modules |
| WMF folders | 4,520 drawings per colour theme<br>vector extents are normalized: the longest side is always 8,191 units at 1,000 units/inch |

Facts that shape the design:

- **Every active pack is exactly one kind:**
  - 1,299 devices (`Famiglia_Apparecchi`);
  - 1,270 supports/panels (`Famiglia_Pannelli`);
  - 604 enclosures (`Famiglia_Armadi`, sub-family ≠ 99);
  - 4,650 enclosure-range accessories (sub-family 99: fixed BOM, no options).
- **Configuration is data.**
  - Axes and values are identified by global IDs: 157 axes and 1,041 values are used by active packs, shared by devices, panels and enclosures. Identity is the ID, not the text.
  - 6,938 option rows are two-dimensional: dependent values with a default per parent value.
  - Options also carry visibility, defaults, an auxiliary budget (`Max_Aux` / `Valore_Aux`) and container-linkage flags. The semantics of those flags are not all established (§16 Q13).
- **Options add real articles.**
  - One option, or option pair, can add several articles. Quantity is expressed by repeated rows.
  - Base articles can be templates: `FN82C%1` + Taratura fragment `%116` → `FN82C16`. A pack has at most one template axis.
  - 3,335 of the 3,338 template expansions exist in the METEL BTI listino of 2026-07-01.
- **`Aumenta_Famiglia` is an additive offset on the physical key, at every level:**
  - apparatus: 16400 (2P) + auxiliary contact `F80RC` (+2) → 16402, i.e. 4 → 6 poli and 36 → 54 mm. Adding Stop&Go (+30) and two auxiliaries gives 16434 (12 poli);
  - panel: 6311 → 6312–6319, with the same geometry but a different drawing and a different compatibility key;
  - enclosure: drawing block 1751 → 1752 / 1753, depending on the Frontale choice.

  Every default configuration of every active pack reaches an existing profile; 76 single-option deviations do not. **Physical state therefore belongs to the configured item, not to the base SKU.**
- **Poli are 9 mm.** `Poli_Din` counts 9 mm poli (2 poli = 1 DIN module = 18 mm). ListinoBT `ANA_ART_MONTAGGIO.POLI_DIN` counts modules.
- **One demand kind per apparatus profile:**

  | Demand kind | Profiles | Value |
  |---|---:|---|
  | DIN poli | 4,734 | poli |
  | Megatiker slots | 1,378 | always 1 |
  | internal-rail mm | 357 | mm |
  | Megabreak slots | 36 | always 1 |
  | instruments | 2 | 75, unit not established |
  | CEE sockets | 0 | – |

  Each profile also has up to three orientation views (vertical and two horizontal), a depth, and lists of accepted panels (7 columns) and enclosures (3 columns).
- **Enclosures** have:
  - real and usable width/height/depth;
  - a vertical pitch (`Passo` 50, 44 or 150 mm);
  - the origin of the usable area;
  - a drawing block, a join kit and side panels.

  No enclosure uses a second insertion column. Example: MDX800 600×1200×230 (pack 343) is 705×1295×230 real and 600×1200×164 usable, with pitch 50 and origin (52.5, 45).
- **Panels:** the capacity unit depends on the panel type:
  - 220 DIN panels: a single rail, capacity in poli. The 24-module 600×200 panel holds 48 poli, with the rail origin at (84, 78);
  - 1,052 slot panels: capacity = number of insertion points;
  - 36 internal-rail panels: capacity in mm;
  - 367 blind panels.

  328 panels require a rotated device orientation.
- **Compatibility is enumerated:**
  - apparatus → panel: 479,707 pairs in 380 distinct lists;
  - apparatus → enclosure: 173,829 pairs in 53 lists;
  - panel → enclosure: 6,576 pairs in 59 lists.

  Enclosure keys are `Famiglia_Armadi × 100 + Sotto_Famiglia_Armadi` (MDX800 quadro 600 wide = 5002).
- **Brands:**
  - TiQuadri article prefixes (`BT-`, `LG-`, `IM-`, `CT-`, `HW-`, `NV-`) are not METEL marchi.
  - `IM-` codes appear in METEL under `IMS`, although ListinoBT names the brand `IME`.
  - Ten codes exist only under another marchio.
- **Module counts.** Comparing TiQuadri's effective profile with ListinoBT:
  - they agree for 1,188 single-article configurations and disagree for 17;
  - in 426 packs the default configuration already contains several articles, so the TiQuadri profile describes the assembly, not the article;
  - `FN881C16` is one module in both sources (§16 Q9).
- **Prices.** TiQuadri has none. ListinoBT prices are older than METEL's (`FN82C16`: €83.13 vs €92.17). Only METEL prices are used (§6).
- **TiQuadri projects** store a recursive group tree: enclosure → panels → apparatus, with unplaced items in a root pool. Each instance keeps a snapshot of its resolved articles, selected options and effective physical data.
- **Rights.** The redistribution rights for the drawings (WMF/DXF) and the terms for using the master data inside LibreQuadri are not established (§16 Q14).

---

## 2. What METEL gives us vs. what we must build

| Need | From METEL directly | Must derive / enrich ourselves |
|---|---|---|
| Brand | Marchio sigla (`LEG`, `SIE`) | Display name, logo, owning manufacturer |
| SKU / code | ✅ codice prodotto, EAN | Normalized search code |
| Description | ✅ 43-char short text | Long description, cleaned text, search keywords |
| List price | ✅ price, multiplier, currency, UM, validity date | Per-unit price (computed), price history |
| Purchase discount | ⚠️ only the *discount family code* | **Our actual discount % per family** (supplier agreement), entered by us |
| Order data | ✅ qty per carton, min / multiple / max, lead-time code | Decoded labels |
| Lifecycle | ✅ stato prodotto code, data variazione | Decoded labels; "no longer listed" flag (computed across imports) |
| Manufacturer category | ✅ famiglia statistica + famiglia di sconto (codes + descriptions) | Hierarchy parsing where useful (BTicino codes) |
| Standardized category | ❌ (Electrocod partially, v021 only) | **Mapping** manufacturer families / Electrocod → our category tree |
| Technical attributes for filters | ❌ | Description parsing, manual entry, later manufacturer technical data (ETIM/BMEcat, Excel) |
| Product families & variants (tarature) | ❌ | Grouping + variant axes (poles, curve, In, Icn…) |
| Accessories / compatibility | ❌ (only "prodotto composto" flag) | Configuration models with option → article rules; for BTicino, imported from TiQuadri (§5.6, §9.3) |
| Panel / projection metadata | ❌ | Physical profiles, capacities, carpenteria/support geometry and compatibility; for BTicino, imported from TiQuadri, with article-level modules from ListinoBT (§5.8) |
| Sales prices / markup | ❌ | Our pricing rules |

In short, METEL gives us **identity, price, logistics and the manufacturer's own classification**. Everything that makes the catalogue searchable, configurable and placeable in a panel is our enrichment.

---

## 3. Physical storage on SQLite

### 3.1 Files

| File | Contains | Size estimate | Backup |
|---|---|---|---|
| `lq.db` | `cat_*` catalogue + enrichment (including configuration models and physical profiles, §5.6–§5.10), `com_*` commercial conditions, `app_*` (settings, installation identity, customer register, recent files, import history of deliveries, engineering-source imports and their source files) | ~150–300 MB with 3 brands, plus tens of MB for the full TiQuadri dataset | **Yes**: holds manual enrichment and our discount conditions |
| `metel_raw.db` | raw METEL source files (one parsed record set per distinct file content) | ~60 MB per full delivery of 3 brands; bounded by pruning | No: rebuildable from archived original files |
| `*.lqp` | exactly one project (§7) | KB to a few MB | User's document; plus automatic preservation of previous versions on save (§7.3, §11.2) |

**`lq.db` is independent of `metel_raw.db` (D3):**

- Once a delivery is normalized, everything the application needs is in `lq.db`: product data, family descriptions, Electrocod, prices, and the import history (`app_import_delivery`, `app_import_file`).
- `lq.db` **never stores raw row IDs or raw file IDs.** Identities are defined as follows (§9.1):
  - a **source file** is identified by the **SHA-256** of its bytes;
  - a **delivery** (normalization event) is identified by its `lq.db` ID, and its content by a **fingerprint** derived from its files' SHA-256s.
- If `metel_raw.db` is pruned, deleted or rebuilt (which gives new raw IDs), nothing in `lq.db` is affected. Raw data and `lq.db` are matched **only by file SHA-256**.
- The raw database is only `ATTACH`ed as `metel` inside the import worker. The normal app never opens it.
- **The same rule holds for engineering sources** (TiQuadri, ListinoBT, §9.3):
  - their files are identified by SHA-256 (`app_source_import_file`) and archived under `imports/<adapter>/`;
  - `lq.db` stores only normalized rows and provenance;
  - no application function reads the source files after import.

The temporary `import:metel` developer command currently does not archive its
input files. Preserve the original METEL deliveries separately until the
production import/archive flow described in §9 is implemented.

**Transactions across files:** in WAL mode a transaction writing to two attached files is not atomic across them. Every pipeline step writes to **only one** file (§9.2).

### 3.2 Connection settings

`lq.db` and `metel_raw.db` (and a project's *working copy*, §7.3), on every open:

```sql
PRAGMA journal_mode = WAL;        -- readers don't block the writer
PRAGMA synchronous = NORMAL;      -- safe with WAL; fast imports
PRAGMA foreign_keys = ON;         -- OFF by default in SQLite. Must be set per connection!
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -65536;       -- ~64 MB (lq.db only; small for project files)
-- on close / after imports:
PRAGMA optimize;
```

Saved `.lqp` files themselves are written with `journal_mode = DELETE`, so each is a single file with no `-wal`/`-shm` companions (§7.3).

### 3.3 Column conventions

| Concept | Convention |
|---|---|
| Type safety | Drizzle column types in TypeScript + SQL `CHECK` constraints where it matters, e.g. `CHECK (typeof(price_e4) = 'integer')` on money columns. **No `STRICT` tables and no `WITHOUT ROWID`**, because Drizzle does not generate them and its table-rebuild migrations would silently drop them. |
| IDs | `INTEGER PRIMARY KEY`. Local IDs never leave their database file. |
| Stable identities | `uuid TEXT` for everything in a project file (project, groups, lines, snapshots, placements) and for installation and customers. Natural keys for catalogue objects referenced from projects (§7.5). |
| Enums | `TEXT` + `CHECK (x IN (...))` for **fixed** sets. For **extensible** sets (relation types, capacity kinds), a small lookup table + FK. |
| Booleans | `INTEGER NOT NULL CHECK (x IN (0,1))` (Drizzle `integer({ mode: 'boolean' })`) |
| Dates | `TEXT` ISO-8601: `'2026-07-01'` for dates, `'2026-07-01T09:12:00Z'` (UTC) for timestamps |
| **Money (D4)** | **`INTEGER` in 1/10,000 EUR**, column suffix `_e4`, everywhere in `lq.db` and `.lqp`. Example: €50.80 = `508000`. METEL cents × 100 is exact. Per-unit prices from multiplier 1000 are rounded half-up to 4 decimals. **Only `metel_raw.db` keeps METEL's original cents**, because raw stays raw. No floating point for money. |
| Percentages | `INTEGER` basis points, suffix `_bp`: 57.25 % = `5725` |
| JSON | `TEXT CHECK (json_valid(x))`, only for non-queried blobs |
| Case-insensitive search | normalized helper columns (`code_norm`) + FTS5. `COLLATE NOCASE` is ASCII-only and is not relied on. Italian sort order is done with `Intl.Collator('it')` in TS. |

---

## 4. RAW layer (`metel_raw.db`)

A faithful, immutable, re-processable copy of each **source file**. It is used only by the import pipeline.

**The raw layer knows files, not deliveries.** A delivery is an `lq.db` concept (§6, §9.1). One raw file can be part of several deliveries, e.g. an unchanged FSC file delivered with two successive listini.

```
raw_file                          -- identity of one SOURCE FILE content
  id, file_sha256 UNIQUE, file_type CHECK IN ('LSP','FSC','FST'),
  original_file_name, archived_path,              -- imports/<issuer>/<sha256>.<type>.txt
  issuer_sigla,                   -- LSP: header; FSC/FST: row prefix (must be identical on all rows)
  issuer_piva, listino_number, valid_from, last_change_date, header_description,   -- LSP only
  layout_version CHECK IN ('020','021'),
  parsed_at, status CHECK IN ('parsed','failed','pruned'),
  row_count, warning_count, report_json

price_list_row                    -- one row per LSP line
  raw_file_id → raw_file ON DELETE CASCADE, line_no, raw_line NOT NULL,
  marchio, codice, ean, descrizione,
  qta_cartone, qta_multipla, qta_minima, qta_massima, lead_time_code,
  prezzo_rivenditore_cents, prezzo_pubblico_cents, moltiplicatore,
  valuta, um, composto, stato_code, data_variazione,
  famiglia_sconto, famiglia_statistica, electrocod, extra_v021
  PRIMARY KEY (raw_file_id, line_no); INDEX (raw_file_id, marchio, codice)

family_row                        -- FSC and FST share one table
  raw_file_id → raw_file ON DELETE CASCADE, line_no, raw_line,
  family_type CHECK IN ('SCONTO','STATISTICA'),
  issuer_sigla, marchio, code, description
  PRIMARY KEY (raw_file_id, line_no)
```

- **Parsing is idempotent per file:** a SHA-256 already present with `status='parsed'` is never parsed again.
- **Archiving is content-addressed** (`<sha256>` in the archive name), so identical content is stored once.
- **There is no "normalized" status in the raw layer.** Whether a delivery was normalized is known only from `lq.db` (§9.2).
- **Retention:**
  - keep the parsed rows of files that belong to the **last 3 deliveries per issuer**. The worker reads that list from `lq.db` (`app_import_file.file_sha256`);
  - rows of other files are deleted (`status='pruned'`);
  - originals stay archived under `imports/`, so any file can be re-parsed.
- The METEL code decode tables (stato, lead time) are seed data in `lq.db` (`cat_metel_code`, §5.7), because the app displays them. They are not kept in the raw database.

---

## 5. CATALOGUE layer (`lq.db`, `cat_*` tables)

Tables are shown as column sketches. The exact definitions will be the Drizzle schema.

### 5.1 Issuers, brands, manufacturers, METEL families

Three distinct roles, which are never inferred from one another:

| Role | Meaning | Source |
|---|---|---|
| **Issuer** | The company that *issues* METEL files: header sigla + P.IVA, e.g. `BTI`, `SIE`, `SNR` | METEL header, created automatically on import |
| **Brand** | A METEL *marchio* on product rows, e.g. `BTI`, `LEG`, `ZUC`, `BCT` | METEL rows, created automatically on import |
| **Manufacturer** | The company that *owns/produces* a brand | Seed data (D7) or manual. **Never inferred from the issuer** |

```
cat_metel_issuer
  id, metel_sigla UNIQUE, piva, name, notes

cat_manufacturer
  id, code UNIQUE (stable slug, e.g. 'legrand', 'siemens'), name, source CHECK IN ('seed','manual')

cat_brand
  id, metel_marchio UNIQUE, name, active,
  manufacturer_id → cat_manufacturer (nullable: ownership unknown until enriched),
  preferred_issuer_id → cat_metel_issuer (nullable; see "governing listing", §5.2),
  source

cat_issuer_brand                  -- observed fact: this issuer's deliveries contain this marchio
  issuer_id → cat_metel_issuer, brand_id → cat_brand,
  first_seen_delivery_id → app_import_delivery, last_seen_delivery_id → app_import_delivery
  PRIMARY KEY (issuer_id, brand_id)

cat_metel_family                  -- rev 4 name: cat_manufacturer_category
  id, issuer_id → cat_metel_issuer, brand_id → cat_brand,
  family_type CHECK IN ('SCONTO','STATISTICA'),
  code, description, parent_id → self (nullable), is_known (0/1)
  UNIQUE (issuer_id, brand_id, family_type, code)
```

Rules:

- **Brands on import:** an import creates the issuer and any new brands. New brands get `manufacturer_id = NULL`. No part of the pipeline, pricing, search or projects requires `manufacturer_id`. It is enrichment used for display and filtering.
- **Family scope:** METEL family codes are defined by the **issuer**, as its commercial and statistical classification. They are therefore scoped by `(issuer, marchio, code)`, exactly as the family files key them. In the UI they are still shown as the "manufacturer category" (famiglia METEL).
- **Marchio uniqueness:** METEL marchio sigle are treated as globally unique (a METEL registry code). The same marchio listed by two issuers is the same brand.

### 5.2 Products (one row = one orderable SKU) and listings per issuer

```
cat_product
  id, brand_id → cat_brand NOT NULL,
  manufacturer_code NOT NULL,                -- exactly as METEL
  code_norm NOT NULL,                        -- uppercase, only [A-Z0-9]: search key
  -- METEL-owned columns, copied from the product's GOVERNING listing (below):
  governing_issuer_id → cat_metel_issuer,
  ean, short_description,
  unit_of_measure, pack_qty, min_order_qty, order_multiple, max_order_qty,
  lead_time_code, lifecycle_status_code, is_kit, electrocod,
  discount_family_id    → cat_metel_family,
  statistical_family_id → cat_metel_family,
  -- ours:
  description,                               -- enrichment
  search_text,                               -- generated: synonyms, series, attribute labels
  category_id → cat_category, category_source CHECK IN ('mapping','manual','unmapped'),
  -- family membership is NOT a cat_product column: see cat_product_family_assignment (§5.5)
  is_listed,                                 -- denormalized: 1 if at least one listing is listed
  updated_at
  UNIQUE (brand_id, manufacturer_code)

cat_product_listing                          -- one row per (product, issuer) that has ever listed it
  product_id → cat_product ON DELETE CASCADE, issuer_id → cat_metel_issuer,
  discount_family_id → cat_metel_family, statistical_family_id → cat_metel_family,
  lifecycle_status_code, lead_time_code,
  is_listed,
  first_seen_delivery_id → app_import_delivery NOT NULL,
  last_seen_delivery_id  → app_import_delivery NOT NULL
  PRIMARY KEY (product_id, issuer_id)
```

- **First/last seen is per issuer**, on the listing. It always refers to a **delivery**, never to a file.
- **Delisting is per issuer.** When a delivery of issuer X becomes current (§9.1), X's listings that are absent from its LSP get `is_listed = 0`. Listings of other issuers are untouched. `cat_product.is_listed` is then recomputed for the affected products.
- **`is_listed` means current catalogue presence, not proven orderability.** A listed product may still carry a lifecycle code (e.g. `9`, present on 234 products of the supplied BTI delivery, including two Step-6A family members, `FA881B1` and `FA881B20`) whose meaning is unknown until the official decode table exists (§16, open question 1). No code is given semantics before then, and no feature may present "listed" as "confirmed orderable".
- **Governing listing.** This decides which listing supplies the METEL-owned product columns and which issuer's price and discounts apply. The first rule that yields a listing wins:
  1. the listing of `cat_brand.preferred_issuer_id`, if it is listed;
  2. otherwise the listed listing whose last-seen delivery has the latest `valid_from`;
  3. otherwise the most recently seen listing.

  It is recomputed for affected products in every normalization. In today's data every product has exactly one listing, so the rule is trivial.

Indexes:

- `(code_norm)`
- `(ean)`
- `(category_id, is_listed)`
- `(brand_id, is_listed)`
- `(statistical_family_id)`
- `(discount_family_id)`
- `cat_product_listing(issuer_id, is_listed)`

### 5.3 Standardized categories and mapping

```
cat_category
  id, parent_id → self, code UNIQUE (stable slug, e.g. 'protezione.magnetotermici'),
  name, sort_order, active, source CHECK IN ('seed','manual')

cat_category_mapping
  id, brand_id → cat_brand (nullable = any brand),
  issuer_id → cat_metel_issuer (nullable = any issuer; relevant for STATISTICA/SCONTO,
                                because family codes are issuer-scoped),
  source_type CHECK IN ('STATISTICA','SCONTO','ELECTROCOD','CODE_PREFIX','DESCRIPTION'),
  match_mode  CHECK IN ('exact','prefix','regex'),
  match_value, category_id → cat_category, priority, notes, source CHECK IN ('seed','manual')
```

- **Subtree queries** use a recursive CTE.
- **Mapping is evaluated in TypeScript**, because SQLite has no `REGEXP` and there are only hundreds of rules. It uses the families of the product's governing listing. Precedence:
  1. manual product override
  2. `STATISTICA` exact → prefix
  3. engineering model contribution (unanimous among selecting active device models)
  4. `CODE_PREFIX` / `DESCRIPTION` regex
  5. `SCONTO`
  6. `ELECTROCOD` (reserved; no matcher in Stage B)
  7. `unmapped`

  The revision 8.4 **engineering tier** is implemented in Stage B. An article gets the reviewed category contributed by its selecting engineering models only when all of them agree. Its provenance is the additive `cat_product.category_model_id`. A matching `STATISTICA` rule remains authoritative; conflicting equal-precedence `STATISTICA` rules leave the article unmapped rather than falling through. `STATISTICA` rules are never created for families that mix functions (8 of the 32 families of TiQuadri device primaries in v32). Stage C–D reviewed model-category coverage is still pending.

### 5.4 Technical attributes and category-specific filters

```
cat_attribute
  id, code UNIQUE ('rated_current','poles','trip_curve','breaking_capacity','din_modules', ...),
  name, data_type CHECK IN ('number','enum','boolean','text'), unit, etim_feature_code, source

cat_attribute_option
  id, attribute_id → cat_attribute, value, label, sort_order, source
  UNIQUE (attribute_id, value)

cat_category_attribute
  category_id → cat_category, attribute_id → cat_attribute,
  is_filterable, is_required, filter_widget CHECK IN ('range','checkbox','select'), sort_order, source
  PRIMARY KEY (category_id, attribute_id)

cat_product_attribute
  product_id → cat_product ON DELETE CASCADE, attribute_id → cat_attribute,
  value_num REAL, option_id → cat_attribute_option, value_bool, value_text,
  source CHECK IN ('parser','engineering','import_file','seed','manual'), confidence REAL,
  source_import_id → app_source_import (nullable), derivation_ref TEXT (nullable)
  PRIMARY KEY (product_id, attribute_id)
  CHECK (exactly one of value_num / option_id / value_bool / value_text is not null)
```

- Filter indexes:
  - `(attribute_id, option_id, product_id)`
  - `(attribute_id, value_num, product_id)`
- Filters are ANDed `product_id IN (…)` subqueries.
- Facet counts use `GROUP BY` over the current result set.
- **Revision 8.4 stages:**
  - **Stage B implemented for review:** engineering-derived values from reviewed TiQuadri vocabulary use `engineering` with provenance. Precedence is manual > seed > import_file > engineering > parser. `import_file` stays reserved and protected. `rated_ultimate_breaking_capacity` is defined without Stage C facts or category links.
  - **Stages C and E pending:** Icu facts for MCCB/ACB and the later `trip_unit_type`; `declared_breaking_capacity` has the modular Icn meaning.
  - **Stage F pending:** selectable packages take part in filtering through their feasible offers.
  - See "Revision 8.4" at the end of §16.
- `value_num` is REAL. That is fine for physical quantities, unlike money.

### 5.5 Product families and variants (tarature)

A **configurable family** is a stable, brand-owned configuration namespace. It groups SKUs of one brand and one standardized category that differ only in their declared **variant axes** (e.g. poles, trip curve, rated current). Choosing one value per axis identifies exactly one member SKU. Anything not expressed as an axis is assumed to be the same for all members, or irrelevant to the choice. If a property varies independently of the axes, the family must be split, or the property made an axis through a deliberate new family definition.

```
cat_product_family                     -- definitions: seed or manual only
  id, brand_id → cat_brand NOT NULL, code NOT NULL (stable slug within brand),
  category_id → cat_category NOT NULL, name, series, description,
  active, source CHECK IN ('seed','manual')
  UNIQUE (brand_id, code)

cat_family_variant_axis
  family_id → cat_product_family, attribute_id → cat_attribute, sort_order
  PRIMARY KEY (family_id, attribute_id), UNIQUE (family_id, sort_order)

cat_product_family_assignment          -- at most one row per product; no row = unassigned
  product_id PK → cat_product ON DELETE CASCADE,
  family_id → cat_product_family (NULL only for 'manual_excluded'),
  state CHECK IN ('grouper','manual','manual_excluded'),
  grouper_code, grouper_version        -- set for 'grouper' only
  CHECK ((state = 'manual_excluded') = (family_id IS NULL))
  INDEX (family_id)
```

**Identity**

- Internal identity is `UNIQUE (brand_id, code)`. The portable identity in project files is `(brand_marchio, family_code)` (§7.5).
- **Definitions are seed/manual only** (§12.2). A grouper assigns products to existing active families. It never creates, renames or deletes a family definition.
- A seed family is materialized only once its brand, category and axis attributes exist in `lq.db`. Until then it is deferred, never widened (the same rule as mapping scopes).
- **Compatibility contract.** A shipped family code, and its set of axes, are never silently repurposed. A change in meaning (a different axis set, merging or splitting families) means a new family code, with the old family retired (`active = 0`). A retired code is never reused.

**Axes and values**

- An axis references an existing `cat_attribute`. For Step 6A it must be active, of type `enum` or `number`, and linked to the family's category in `cat_category_attribute`. Otherwise attribute enrichment never stores values for it (§5.4).
- **Variant values are the members' existing `cat_product_attribute` values.** They are not copied into family tables. A value's own `source` (`parser`, `manual`, …) still governs how it changes.
- `sort_order` is presentation order only. Resolution does not depend on the order in which values are chosen.

**Assignment states**

| State | Meaning | Changed by the grouper? |
|---|---|---|
| no row | unassigned | yes: may create a `grouper` row |
| `grouper` | automatic membership | yes: re-evaluated; removed when no longer proposed |
| `manual` | protected manual membership | never |
| `manual_excluded` | protected: never assign this product to any family automatically | never |

- A product belongs to **at most one current configurable family** (the primary key).
- Manual membership and manual exclusion survive regrouping, seed changes and every import.
- A manual assignment must name a family of the product's own brand.
- **Delisting never deletes membership.** Groupers must not use listing state as a criterion.

**Groupers (per-brand, generic interface)**

- Brand-specific grouping logic lives in a **grouper** module registered by METEL marchio, like the description parsers (§5.4, §14). A grouper has a stable `code` and a `version`.
- For one product, it proposes zero or one family code of that brand. Its decision depends only on that product's own data (code, description, category, governing-listing METEL families, attribute values) and on reference data, never on other products. This keeps "regroup affected products only" correct.
- It must use anchored rules. There is no fuzzy or similarity grouping, and an uncertain case gets no proposal.
- The generic engine applies proposals only to products whose assignment is absent or `grouper`. It rejects a proposal for an unknown or inactive family, or for one whose category differs from the product's category.
- **Recomputation** follows the category/attribute pattern (`db/seed/README.md`). A fingerprint covers:
  - the engine version and each grouper's code and version;
  - the effective family and axis rows, including manual ones;
  - the attribute-enrichment fingerprint, which itself covers classification.

  If the fingerprint changes, every non-manual product is regrouped. Otherwise normalization regroups only the delivery's affected products. Grouping runs after attribute enrichment, in the same transaction (§9.1).

**Validation (derived, read-only)**

Current family conflicts are computed by a read-only query over the current rows, like the "Da classificare" queue. They are not stored as review rows. The conflicts are:

- a member without exactly one value for every declared axis;
- two or more members sharing the same complete axis tuple. Uniqueness is checked **across all members, including delisted ones**;
- a member whose brand or category differs from the family's;
- a member whose axis value uses an inactive option;
- a member of an inactive family.

A delivery may record conflict counts in its `summary_json`.

**Resolution**

Resolution works against the family's **actual members**, never a generated Cartesian product of axis values. Sparse grids are normal: in the BTI slice, `btdin100` has 129 members against 280 conceivable combinations.

- **Available values** for an axis, given the values already chosen on the other axes, are the values present among members that match those choices. Members that are not listed are shown as such, never silently hidden or offered as orderable.
- **Resolving a complete selection** gives one of:
  - `resolved`: exactly one conflict-free member has that tuple;
  - `not_offered`: no member has that tuple;
  - `conflict`: the tuple, or the member, is in a validation conflict. Resolution never picks between conflicting members.
- **Incomplete selection:** not every axis has a value.
- **Availability is reported, not decided.** A resolved member carries its `is_listed` and raw lifecycle code. `is_listed = 1` means present in the current catalogue, not confirmed orderable (§5.2). Unknown lifecycle codes are displayed raw and never equated with confirmed orderability. A resolved member that is not listed is reported as unavailable locally.
- Changing one axis never silently changes another axis's value to reach a SKU. If the new tuple is not offered, the user is shown the available values.
- Example: `btdin60` with 1P / curve B / 16A resolves to `FN81B16`.

**Retirement, split and merge**

- A retired family stops being configurable. Its `grouper` assignments are removed at the next regroup. `manual` assignments to it remain, and are reported by validation.
- Successor relationships (split, merge, retirement) may be recorded as data. Step 6A does not need them.
- **Existing `.lqp` snapshots are never silently rewritten** (§7.5). Reconfiguring a project line starts from the local product's current family.

**Step 6A slice (BTI, verified 2026-09-21 against `BTILSP021` + `BTIFST` + `BTIFSC`)**

- **Scope:** category `protezione.interruttori_automatici`, brand `BTI`, axes `poles` → `trip_curve` → `rated_current`.
- **Result:** 520 products in 10 families. Every member has all three axis values, and no complete tuple is duplicated.
- **Grouper rules:** end-anchored product-code patterns, corroborated by:
  - the product's category;
  - its BTI statistical family;
  - the family's expected `declared_breaking_capacity`;
  - the description series when present. A contradiction means no proposal; absence is tolerated, because 6 members carry no series in their description.

| Family code | Products | Stat. family | kA | Members |
|---|---|---|---:|---:|
| `btdin45` | `FA8…` except `FA881…`: 1P, 1P+N (`FA81N…`), 2P, 3P, 4P | IND.-112-5-11 | 4.5 | 42 |
| `btdin45_1pn_881` | `FA881…` 1P+N | IND.-112-5-11 | 4.5 | 25 |
| `btdin60` | `FN8…` except `FN881…`: 1P, 1P+N (`FN81N…`), 2P, 3P, 4P | IND.-112-5-15 | 6 | 129 |
| `btdin60_1pn_881` | `FN881…` 1P+N | IND.-112-5-15 | 6 | 12 |
| `btdin100` | `FH8…` | IND.-112-5-19 | 10 | 129 |
| `btdin160` | `FT8…` | IND.-112-5-22 | 16 | 79 |
| `btdin250` | `FV8…` except `FV8…SM…` | IND.-112-5-22 | 25 | 59 |
| `btdin500` | `FX8…` | IND.-112-5-22 | 50 | 26 |
| `btdin_rs` | `FC810N…` 1P+N, `FC820…` 2P | IND.-110-2-71 | 4.5 | 12 |
| `btdin_rs_1pn_881` | `FC881…` 1P+N | IND.-110-2-71 | 4.5 | 7 |

- **The `_1pn_881` families are separate on purpose.** With the three 6A axes, merging them with their standard series would produce 20 duplicate tuples (for example `FN81NC16` and `FN881C16` are both 1P+N / C / 16A).
- **Their codes are deliberately neutral.** The supplied data does not verify that `FA881…`/`FN881…` are one-module devices. Only the BTDIN-RS descriptions state `1m`/`2m`.
- **Future changes:** if physical metadata (§5.8) later justifies modelling the difference as an axis, that is a deliberate family migration (new codes, old ones retired), never a silent change of these families' meaning.
- **Not in 6A:**
  - the other 34 products of the category: 20 magnetic-only `FV8[23]SM…` and 14 DC `F82N…FV1/FV2`;
  - RCBO / RCCB / blocchi differenziali / AFDD categories, including `FC881C…ARC`;
  - accessories and relations (§5.6);
  - `din_modules` and all physical modelling (§5.8);
  - other brands.

**Revision 8 notes**

- The BTicino engineering sources answer Q9: `FN881C16` is one module in ListinoBT and in TiQuadri (profile "1P+N 1Mod"). The `_1pn_881` families are physically justified, so no family migration is needed.
- Families remain the catalogue's variant navigator ("which article"). From an article, the user enters a configuration model (§5.6) through `cat_config_model_entry`. A family axis change resolves here to another article, then re-enters the matching model.
- Physical data is modelled on configured items (§5.8), not on families and not on articles.

### 5.6 Configuration models, options, accessories and BOM (revision 8)

A **configuration model** is a brand-scoped definition of something that can be configured and priced, and, when it has a physical profile, placed. It can be a device, a support (panel, plate, rail), an enclosure, an accessory or a kit.

A model turns a catalogue article into a **configured item**. Product families (§5.5) remain the catalogue's variant navigator ("which article"). Configuration models describe "how an article is built into a configured item": its options, accessories, resulting BOM and physical state. The two layers coexist and neither replaces the other.

```
cat_config_dimension               -- brand-scoped configuration vocabulary
  id, brand_id → cat_brand NOT NULL, code, name,
  attribute_id → cat_attribute (nullable: same meaning as a technical attribute),
  active, source CHECK IN ('seed','manual','import'),
  source_import_id → app_source_import (nullable), source_ref
  UNIQUE (brand_id, code)

cat_config_dimension_value
  id, dimension_id → cat_config_dimension, code, label, sort_order,
  attribute_option_id → cat_attribute_option (nullable), value_num REAL (nullable),
  active, source, source_ref
  UNIQUE (dimension_id, code)

cat_config_model
  id, brand_id → cat_brand NOT NULL, code, name,
  model_kind CHECK IN ('device','support','enclosure','accessory','kit'),
  category_id → cat_category (nullable), base_profile_id → cat_phys_profile (nullable),
  max_insert_qty (nullable), definition_fingerprint,
  commercial_contribution CHECK IN ('articles','none') NOT NULL DEFAULT 'articles',
  active, obsolete, source CHECK IN ('import','manual'), source_import_id, source_ref
  UNIQUE (brand_id, code)

cat_config_capacity_filler         -- lq migration 0011: generic capacity-filler designation
  model_id → cat_config_model ON DELETE CASCADE PRIMARY KEY,
  capacity_kind_code → cat_capacity_kind NOT NULL,
  source CHECK IN ('import','manual'), source_ref
  -- The model's configurations are blank parts that close free capacity of that kind
  -- (TiQuadri: "Falsi polo"). Written by an engineering adapter from reviewed source
  -- evidence; not part of definition_fingerprint, never snapshotted into .lqp.

cat_config_model_article           -- fixed base BOM
  model_id → cat_config_model ON DELETE CASCADE, seq,
  product_id → cat_product (nullable until resolved),
  ref_brand_marchio NOT NULL, ref_manufacturer_code NOT NULL,
  quantity REAL CHECK (quantity > 0), role CHECK IN ('primary','component')
  PRIMARY KEY (model_id, seq)

cat_config_axis
  id, model_id → cat_config_model ON DELETE CASCADE, dimension_id → cat_config_dimension,
  sort_order, label,
  visibility CHECK IN ('visible','hidden'), requirement CHECK IN ('required','optional'),
  binding CHECK IN ('none','match_container','inherit_container'),
  editable_when_placed, selects_primary
  UNIQUE (model_id, dimension_id), UNIQUE (model_id, sort_order)

cat_config_option
  id, axis_id → cat_config_axis ON DELETE CASCADE, value_id → cat_config_dimension_value,
  parent_option_id → cat_config_option (nullable: dependent value),
  is_default,                        -- default per axis and parent option
  visible, sort_order, active

cat_config_rule                    -- AND of options → effects
  id, model_id → cat_config_model ON DELETE CASCADE, seq
  empty_bom_allowed DEFAULT 0 CHECK IN (0,1)  -- explicit reviewed configuration permission
  UNIQUE (model_id, seq)

cat_config_rule_condition
  rule_id → cat_config_rule ON DELETE CASCADE, option_id → cat_config_option
  PRIMARY KEY (rule_id, option_id)

cat_config_rule_effect
  rule_id → cat_config_rule ON DELETE CASCADE, seq,
  effect_kind CHECK IN ('article','profile_key_delta','profile_override','demand_delta','budget_use'),
  product_id → cat_product (nullable), ref_brand_marchio, ref_manufacturer_code,
  quantity, article_role CHECK IN ('primary','component','accessory'),
  int_value, capacity_kind_code → cat_capacity_kind, budget_code, profile_id → cat_phys_profile
  PRIMARY KEY (rule_id, seq)       -- per-kind CHECKs on which columns are set

cat_config_budget                  -- shared resources, e.g. auxiliary positions
  model_id → cat_config_model ON DELETE CASCADE, code, label, max_amount INTEGER
  PRIMARY KEY (model_id, code)

cat_config_model_entry             -- derived: article → models it can be the primary of
  product_id → cat_product, model_id → cat_config_model,
  option_id → cat_config_option (nullable: option to preselect)
  PRIMARY KEY (product_id, model_id)

cat_config_exclusion               -- a container value and a content value that must not meet
  container_value_id → cat_config_dimension_value, content_value_id → cat_config_dimension_value, source
  PRIMARY KEY (container_value_id, content_value_id)

cat_config_model_relation          -- normalized model relations; presets applied on structural creation
  from_model_id → cat_config_model, relation CHECK IN ('join_kit','side_panel','preset_child'), seq,
  to_model_id → cat_config_model, quantity, position_x_mm, position_y_mm (nullable),
  placement_mode (nullable: fixed / packed; null = unknown), source
  PRIMARY KEY (from_model_id, relation, seq)

cat_range_node                     -- manufacturer browse tree (generic, any brand); navigation rules §5.11
  id, brand_id → cat_brand, parent_id → cat_range_node (nullable), code, name,
  node_kind, sort_order, active, source, source_import_id, source_ref
  UNIQUE (brand_id, code)

cat_range_node_model
  node_id → cat_range_node, model_id → cat_config_model, sort_order
  PRIMARY KEY (node_id, model_id)
```

**Rules**

- **Effects hang on rules, not on options.** Sources attach articles and physical offsets to option *pairs* (TiQuadri: "Easy Tifast 125" × "L2-N" → `FENAL2` + `FENAN`). A rule applies when all its conditions are selected.
- **Articles are real catalogue products.**
  - An article reference is stored as `(ref_brand_marchio, ref_manufacturer_code)` with a nullable `product_id`. It is resolved again after every METEL normalization (deferred resolution, like seed families).
  - A configuration whose BOM contains an unresolved reference has status `bom_incomplete`. It is priced for the resolved rows only and never presented as complete.
- **Several articles from one choice** are several `article` effects on one rule. Quantities are explicit.
- **No SKU building at runtime.** The importer expands source templates (TiQuadri `%1`) into `article` effects with role `primary`. Runtime and UI code contain no brand SKU rules.
- **Which option selects an article.** Only `cat_config_model_entry.option_id` says which option selected an article. `cat_config_axis.selects_primary` is set by the TiQuadri adapter on every axis of a templated pack, and must not be read as "this axis selects the article" (3,979 device axes in v32). Revision 8.4 Stage B leaves `cat_config_dimension.attribute_id` and the value columns `attribute_option_id`/`value_num` NULL, uses `cat_config_value_attribute` instead, and gives `cat_config_model.category_id` a seed/manual provenance column. See "Revision 8.4" at the end of §16.
- **Budgets** limit shared resources. TiQuadri, for example, allows at most 3 auxiliary positions, and "Salvavita Connesso" uses all 3.
- **Accessories.**
  - Accessories that change the BOM or the physical state are configuration options of the model they attach to.
  - Accessories sold on their own (e.g. enclosure-range accessories) are `accessory` models with a fixed BOM. They are reached from their articles through `cat_config_model_entry` and from the Configura view. The engineering ranges that hold them (TiQuadri Carpenterie) are not browsed in Catalogo (§5.11). `accessory` models have no physical profile and are not structural picker objects in Progettazione.
  - This replaces the family-relation sketch of revision 7 (`cat_family_relation`, `cat_family_relation_condition`) and answers §16 Q11.
- **Entry from the catalogue.** `cat_config_model_entry` maps an article to every model where it can be the primary, with the primary option preselected. For example, `FN82C16` maps to the BTDIN60 2P curve C MCB model and to the MCB + RCD-block models. The table is derived: it is rebuilt after engineering imports, and after each METEL normalization for the affected products.
  - Catalogo uses only entries to active, non-obsolete models whose `model_kind` is not `enclosure` or `support`. Enclosure and support models never make an article configurable from Catalogo; Progettazione selects them as models (§5.11, "Catalogo and Progettazione").
- **Families and models together.** A family axis change (poles, curve, In) resolves to another article (§5.5) and re-enters the matching model. Selections are carried over by dimension/value code; those that do not carry over are shown, never silently changed.
- **Model relations:** `join_kit` and `side_panel` are imported as data; their Progettazione behaviour is deferred (§16 Q18). `preset_child` carries a placement mode and is applied once when its structural parent is added (§16, "Generic preset supports").
- **Container binding.** `match_container` and `inherit_container` let a container's value for a dimension constrain its contents. These remain generic capabilities; the TiQuadri adapter does not derive either binding from `Test_Compatibilita_Contenuto`.
  - `inherit_container` stays unused until the source semantics are verified (§16 Q13).

**Resolution of a configured item**

```
resolveConfiguration(model, requested, context)
  for each axis in sort order:
    candidates = active options whose parent option (if any) is selected
    inherit_container and a context value exists → use it, else context_conflict
    a requested value exists → use it if it is a candidate, else report 'unavailable'
                               (never replace a user's choice)
    otherwise → the default for the selected parent, or 'missing' if the axis is required
  match_container axes: value must equal the container's value      else context_conflict
  rules   = rules whose conditions are all selected
  budgets : Σ budget_use per budget ≤ max_amount                    else budget_exceeded
  bom     = base articles + article effects, not empty              else bom_empty
  status  = complete | incomplete | invalid | context_conflict | budget_exceeded | bom_incomplete
  config_fingerprint = sha256(canonical { brand, model code, definition_fingerprint,
                                          sorted (dimension code, value code) })
```

- Hidden axes are resolved and snapshotted like visible ones.
- **The configuration fingerprint is the effective configuration identity.** Two configured items with the same fingerprint are the same configuration.
- **Pricing.**
  - Every BOM article is priced through §6: the governing issuer's current list.
  - Arithmetic uses `_e4` integers (D4).
  - Item unit price = Σ (article sale unit price × quantity). Discounts and markup apply per article, because discount families can differ inside one item.

**Product-level relations (kept from revision 7, not yet implemented)**

```
cat_relation_type        code PK ('compatible_with','requires','kit_component','replaced_by'), label

cat_product_relation
  id, from_product_id → cat_product, to_product_id → cat_product,
  relation_type → cat_relation_type, quantity, source, notes
  UNIQUE (from_product_id, to_product_id, relation_type)
```

These relations cover plain articles outside configuration models: succession (`replaced_by`, §7.7, Q10), METEL kits and simple compatibility notes. They are not the accessory mechanism.

### 5.7 Enrichment support tables

```
cat_search_synonym   term, expansion, brand_id (nullable), source     -- 'magnetot' → 'magnetotermico'
cat_metel_code       field ('stato'|'lead_time'|'um'), code, label, source   PRIMARY KEY (field, code)
cat_review_item      id, kind ('unmapped_category','unknown_family','price_jump', ...),
                     product_id, delivery_id → app_import_delivery, message, resolved_at
```

Family/variant conflicts are **not** review items. They are derived by a read-only validation query (§5.5). Engineering-source conflicts are stored in `cat_source_conflict` (§5.10); they are not review items either.

### 5.8 Physical profiles, carpenteria, supports and compatibility (revision 8)

The physical state that placement uses belongs to the **configured item**, not to the base article. Options change size, capacity demand, drawing and compatibility. In TiQuadri, for example, an auxiliary contact turns a 2-module MCB into a 3-module assembly, and a panel's wiring option changes the panel's compatibility key.

Revision 8 therefore replaces the revision-7 sketch: `cat_mounting_type`, `cat_product_physical` as the placement source, `cat_product_asset`, and the rule "`din_modules` per product, never per family".

```
cat_capacity_kind                  -- seed
  code PK, name, unit_label, display_divisor, nominal_pitch_mm (nullable), source
  -- 'din_rail'          half-module units (nominal 9 mm), displayed ÷ 2 as "moduli"
  -- 'mccb_slot', 'acb_slot', 'socket_slot'   one unit per slot
  -- 'internal_rail_mm'  millimetres of internal rail
  -- 'stack_mm'          millimetres along an enclosure's mounting face

cat_phys_class                     -- compatibility identity of a profile
  id, code UNIQUE, name, source, source_ref

cat_phys_profile_set               -- namespace of keyed profile variants
  id, code UNIQUE, name, source

cat_phys_profile
  id, code UNIQUE, profile_set_id → cat_phys_profile_set, profile_key INTEGER (nullable),
  profile_kind CHECK IN ('device','support','enclosure'), name,
  fit_class_id → cat_phys_class,
  depth_mm, outer_depth_mm, usable_depth_mm (nullable),
  active, source, source_import_id, source_ref
  UNIQUE (profile_set_id, profile_key)

cat_phys_profile_demand
  profile_id → cat_phys_profile ON DELETE CASCADE, capacity_kind_code → cat_capacity_kind,
  amount INTEGER CHECK (amount >= 0)
  PRIMARY KEY (profile_id, capacity_kind_code)

cat_phys_view                      -- one row per orientation
  profile_id → cat_phys_profile ON DELETE CASCADE,
  view_code CHECK IN ('front','front_alt1','front_alt2'),
  width_mm, height_mm, insert_dx_mm, insert_dy_mm, symbol_kind, asset_key (nullable)
  PRIMARY KEY (profile_id, view_code)

cat_phys_zone                      -- where contents go (containers only)
  profile_id → cat_phys_profile ON DELETE CASCADE, zone_no,
  layout CHECK IN ('linear','stack','slots'),
  capacity_kind_code → cat_capacity_kind, capacity_amount INTEGER,
  origin_x_mm, origin_y_mm, length_mm, breadth_mm,
  direction CHECK IN ('horizontal','vertical'), pitch_mm (nullable), required_view_code
  PRIMARY KEY (profile_id, zone_no)

cat_phys_zone_slot
  profile_id, zone_no, slot_no, x_mm, y_mm
  PRIMARY KEY (profile_id, zone_no, slot_no)

cat_phys_accept_set                -- deduplicated sets of classes
  id, code UNIQUE, source

cat_phys_accept_set_member
  set_id → cat_phys_accept_set ON DELETE CASCADE, class_id → cat_phys_class
  PRIMARY KEY (set_id, class_id)

cat_phys_constraint                -- every constraint of a profile must hold
  profile_id → cat_phys_profile ON DELETE CASCADE,
  relation CHECK IN ('parent','ancestor'), accept_set_id → cat_phys_accept_set
  PRIMARY KEY (profile_id, relation, accept_set_id)

cat_product_physical               -- article-level facts only
  product_id PK → cat_product, din_half_modules INTEGER, width_mm, height_mm, depth_mm, weight_g,
  source CHECK IN ('import_file','manual'), source_import_id
```

**Rules**

- **Capacities are integers** in the kind's base unit. Capacity checks never compare floats, and TiQuadri poli (9 mm) and ListinoBT modules (× 2) meet in one unit. Lengths are REAL millimetres, which §5.4 allows for physical quantities.
- **Configuration-dependent physics.** A model names a base profile, and rule effects then modify it:
  - `profile_key_delta` adds to the base key inside the base profile's set;
  - `profile_override` replaces the profile;
  - `demand_delta` adjusts demand, for sources that describe accessories additively.

  If the resulting key has no profile, the configuration is **quotable but not placeable** (`no_profile`). It is never silently mapped to a neighbouring profile.
- **Real vs usable geometry.** An enclosure's `front` view is its real frame. Its zone is the usable area, with origin and pitch. Outer and usable depth are profile columns.
- **Zones:**
  - `linear`: a DIN or internal rail (capacity kind, capacity, origin, direction);
  - `stack`: an enclosure's mounting face (length, breadth, pitch);
  - `slots`: fixed insertion points, one unit each.

  A container without a zone (e.g. a blind panel) accepts nothing.
- **Orientation.** `front` is the upright view; `front_alt1` / `front_alt2` are the source's two alternative orientations. A zone that requires an orientation accepts only contents that have that view. The rotation direction affects only symbol drawing (§16 Q16).
- **Compatibility is data.**
  - Every profile has one fit class.
  - A `parent` constraint requires the direct container's class to be in the set. An `ancestor` constraint requires some ancestor's class to be in it.
  - Identical source lists are stored once.
  - Cross-object option exclusions use `cat_config_exclusion` (§5.6).
- **Article-level physical data** (ListinoBT modules, weight) is stored in `cat_product_physical`, for catalogue display and as conflict evidence. It never overrides a configured item's profile.
- Brand-specific geometry exists only in imported rows and in the adapters (§9.3, §14).

**Placement validation** (configured item → container zone)

```
canPlace(item, container, zone, position, view)              -- snapshot data only (§7.11)
  the zone exists                                            else no_zone
  every 'parent' set contains the container's fit class      else incompatible_parent
  every 'ancestor' set contains some ancestor's fit class    else incompatible_ancestor
  the item has the zone's required view                      else no_view_for_orientation
  linear: the item has a demand of the zone's kind           else capacity_kind_mismatch
          0 ≤ start and start + demand ≤ capacity            else over_capacity
          no overlap with siblings                           else overlap
  stack:  view width ≤ breadth                               else too_wide
          start is a multiple of the pitch                   else misaligned
          start + view height ≤ length                       else over_capacity
          no overlap with siblings                           else overlap
  slots:  the slot exists and is free                        else slot_unavailable
  match_container dimensions agree                           else context_mismatch
  no cat_config_exclusion pair along the ancestor path       else excluded_combination
```

**Examples (real data)**

- A BTDIN60 2P MCB with one auxiliary contact (profile 16402, 6 half-modules) fits at 0 on a 24-module 600×200 DIN panel (capacity 48): three of 24 modules are used.
- That panel fits at 0 mm in the MDX800 600×1200 enclosure (class 5002, pitch 50).
- A 36-module 850 mm panel is rejected there (`incompatible_parent`, `too_wide`).
- With 46 of 48 half-modules used, a 2P MCB (4 half-modules) is rejected (`over_capacity`).

### 5.9 Assets and licensing (revision 8)

Drawings are referenced by **logical asset key** only. Engineering data never depends on an asset: removing every manufacturer drawing changes appearance, never behaviour.

```
cat_asset_license                  -- seed
  code PK ('lq_own','manufacturer_unverified','manufacturer_licensed'), name,
  may_display, may_embed_in_project, notes

cat_asset
  id, sha256 UNIQUE, media_type, byte_size, rel_path (under assets/),
  origin CHECK IN ('lq_authored','manufacturer','derived'), derived_from_asset_id (nullable),
  license_code → cat_asset_license, source_import_id, source_ref

cat_asset_variant
  asset_key, variant ('front_light','front_dark','cad'), asset_id → cat_asset
  PRIMARY KEY (asset_key, variant)
```

- **Parametric symbols are the baseline.** Every view has a `symbol_kind`, which LibreQuadri renders from the profile's dimensions: enclosure frame, DIN panel with rail opening, modular device, slot device, blind panel. This rendering is always available and license-free.
- **Size comes from the profile, never from the file.** An asset is stretched to the view's W×H. Source vector extents are normalized (TiQuadri WMF: longest side 8,191 units), so they are never used as dimensions.
- A derived asset keeps the license of its source. The local TiQuadri DXF import below records the MDB as a manufacturer asset and each converted SVG as a derived asset linked to it.
- `.lqp` files embed asset bytes only if `may_embed_in_project = 1` (§7.6). M2 does not embed imported drawings or alter format 3.
- M2 permits local display of drawings imported from an installation supplied by the user. The import uses `manufacturer_unverified` with `may_display=1` and `may_embed_in_project=0`; redistribution/licensing remains open under §16 Q14.

**M2 local vector pipeline.** After the engineering master import has populated `cat_phys_view.asset_key`, run `npm run import:tiquadri-drawings -- [--data-dir <app-data-root>] <BTQuadriDXF.mdb>`. The TiQuadri adapter reads `DXF_BLOCK`, matches a view key's final path component case insensitively to `NOME`, and converts supported R12 LINE, SOLID, ARC, CIRCLE, POINT and POLYLINE geometry to restricted path-only SVG. DXF y coordinates are inverted; the SVG viewBox is the geometry extent. Source geometry is at 1 DXF unit = 10 mm, while the existing view width, height and insertion offset remain authoritative for placement. Unsupported entity types are reported, and malformed or degenerate blocks are left without a variant. The importer is fingerprinted by source SHA-256, adapter version and referenced key set; it backs up `lq.db`, records `app_source_import` provenance, stores the source MDB and SVGs under the installation's `assets/`, and maps original full `asset_key` values to `front_light` variants. Converted assets have `currentColor` geometry, so one variant serves either theme. Re-import replaces import-owned variants while preserving LibreQuadri-authored variants.

At runtime the main process reads only keys for views selected by placed project nodes. The generic asset reader checks the display license, relative path, byte count, SHA-256 and restricted SVG vocabulary before returning path data over IPC. Fronte Quadro draws that data inside a nested SVG at the node's existing M1 `xMm`/`yMm` and view `widthMm`/`heightMm`. Any missing, invalid or unreadable asset uses the parametric symbol for that node. The project continues to carry only its existing `asset_key` snapshot; asset availability is installation-local and can differ between machines.

### 5.10 Engineering-source provenance and conflicts (revision 8)

```
cat_source_brand_map               -- seed/manual: source brand code → METEL brand
  adapter_code, source_brand_code, brand_id → cat_brand (NULL = unmapped), source
  PRIMARY KEY (adapter_code, source_brand_code)

cat_source_conflict                -- disagreements observed during import
  id, import_id → app_source_import,
  subject_kind CHECK IN ('article','model','profile','brand'), subject_key,
  topic,                             -- 'din_modules', 'brand', 'missing_article', 'template', 'unreachable_profile', …
  value_a, source_a, value_b, source_b,
  resolution CHECK IN ('unresolved','prefer_a','prefer_b','manual') DEFAULT 'unresolved',
  resolved_value, notes
```

- **Provenance.** Each import is recorded in `app_source_import` / `app_source_import_file` (§6), and imported rows carry `source_import_id` and `source_ref`. `source_ref` is a human-readable pointer (e.g. `TiQuadri ANA_PACK 4395`), never a key that the application depends on.
- **Conflicts are stored** because the raw sources are not kept in `lq.db`. Manual resolutions survive re-imports.

**Precedence**

| Fact | Precedence |
|---|---|
| Price | METEL governing issuer only (§6). ListinoBT and TiQuadri prices are ignored |
| Article identity, descriptions | METEL (+ LibreQuadri enrichment). Source texts only name models and options |
| Placement of a configured item (demand, size, class) | manual override > imported effective profile |
| Article modules shown in the catalogue | manual > ListinoBT > TiQuadri single-article profile. Disagreements → `din_modules` conflict |
| Brand of a source code | `cat_source_brand_map`. A unique match under another marchio is accepted and recorded as a `brand` conflict |

### 5.11 Manufacturer catalogue navigation (revision 8.1)

This section defines how the catalogue exposes a manufacturer's own navigation. It rests on a read-only analysis of the supplied `BTQUADRI.mdb` v32, `ListinoBT.mdb` and the METEL BTI delivery of 2026-07-01 (evidence at the end of this section). It does not change product families (§5.5), configuration models (§5.6) or physical data (§5.8).

Markers:

- **CONFIRMED:** product-owner direction of 2026-09-23, or an established source fact.
- **PROPOSED:** a design choice still awaiting a decision. Q27's storage direction is approved and merged on main.
- **OPEN:** listed in §16.

**Distinct concepts (CONFIRMED)**

| Concept | Storage | Purpose | UI name |
|---|---|---|---|
| Standard category | `cat_category` (§5.3) | Brand-neutral taxonomy for filters and attributes | Categoria |
| Manufacturer navigation | `cat_range_node` and its membership tables | The manufacturer's own browse structure | Its levels: Gamma, Tipologia, Famiglia (below) |
| Product family | `cat_product_family` (§5.5) | Variant navigator: which article (poles, curve, In) | Never a bare "Famiglia" |
| Configuration model | `cat_config_model` (§5.6) | What is configured: options, BOM, physical state | Modello |
| Article | `cat_product` | The orderable METEL SKU | Articolo |

- The TiQuadri *pacchetto* is `cat_config_model`, one row per `ANA_PACK`. There is no second model concept.
- In the UI, a bare **"Famiglia" is the navigation level that holds TiQuadri classes** (`ANA_CLASSE`).
  - It is not `cat_product_family`. For example, the 129 members of product family `btdin60` all sit in Gamma "Btdin 60", but they span 2 Tipologie, 6 Famiglie and 33 Modelli. The Gamma also holds articles outside that family, such as the `btdin60_1pn_881` family and the monoblocco RCBOs.
  - METEL families keep their qualified names, "Famiglia statistica" and "Famiglia di sconto", as in the "Da classificare" queue.
  - When `cat_product_family` is shown in the UI, it gets a distinct label (§16 Q23).

**BTicino Apparecchi navigation (CONFIRMED)**

```
Sezione        TiQuadri Sistema (GERARCHIA.ID_Sistema)             "Apparecchi"
 └ Gamma        GERARCHIA.ID_Gerarchia_1 (ANA_GERARCHIA_1)          "Btdin 60"
   └ Tipologia   ID_Gerarchia_2, nested ID_Gerarchia_3 (ANA_GERARCHIA_2/3)   "Magnetotermici"
     └ Famiglia   ANA_CLASSE via ASS_GERARCHIA_CLASSE_PACK            "Curva "C""
       └ Modello   ANA_PACK = cat_config_model                        4395 "Btdin 60 Magnetot. "C" - 2 Poli (0,5-63A)"
         └ Articolo  cat_product, via cat_config_model_entry          FN82C16 (Taratura 16 A)
```

Traced records:

| Gamma (G1) | Tipologia (G2) | Famiglia (class) | Modello (pack) | Articoli |
|---|---|---|---|---|
| 599 Btdin 60 | 5991 Magnetotermici | 59911 Curva "C" | 4395, template `FN82C%1` | `FN82C05` … `FN82C63` (14 Tarature) |
| 530 Megatiker M5-800 | 5301 Magnetotermici | 53011 M5 1600N - 50kA | 31411, `T754N%1` | `T754N800`, `T754N630` |
| 590 Megaswitch MW-1600 | 5901 Sezionatori | 59012 Versione accessoriabile | 1550 / 1551, `T7814WF%1` / `T7813WF%1` | `T7814WF800B` … `T7813WF1600B` (8) |
| 741 My Home | 7411 Automazione | 74112 Attuatori | 2356 | `F411/4` (single-article model) |

- The Sezione level has no level label; the section name is shown.
- No Apparecchi row of v32 uses G3. The level is kept for nested Tipologie in later releases.

**LibreQuadri Apparecchi categories (revision 8.2, CONFIRMED by the product owner on 2026-09-25)**

LibreQuadri inserts its own category level between the section and the Gammas: Sezione → Categoria → Gamma → Tipologia → Famiglia → Modello → Articolo. For example, Apparecchi → Interruttori scatolati → Megatiker M5-800 → Magnetotermici → M5 1600N - 50kA → T754N800.

- The ten categories are Interruttori scatolati, Sezionatori con maniglia, Dispositivi modulari, Dispositivi a pannello, Supervisione impianto, Fusibili, Trasformatori non modulari, Contattori non modulari, Automazione and Prese industriali.
- The mapping lives in the seed `db/seed/range-navigation.json` (`groups`). Each approved name is keyed by adapter, section, source level and G1 source ID; the approved name is kept for verification. It is never inferred.
- The TiQuadri adapter inserts one `level` node per category (`tq.group.<section>.<code>`, `source_level = 'lq_group'`, no `level_code`) between the section and its G1 nodes.
  - A member applies only when its source ID carries the approved name in `ANA_GERARCHIA_1` or in a GERARCHIA copy. G1 566, "Megatiker DIN M1-160 / M2-250", matches through its GERARCHIA copy; the node keeps the label-table name "Megatiker DIN M1-160".
  - Otherwise the member is reported (`navigation_group_member_missing`, `navigation_group_member_name_disagrees`) and the Gamma stays under its section.
  - Gammas outside the mapping stay under the section and are reported (`navigation_group_unmapped`). In v32 these are 18 obsolete Gammas; obsolete Gammas with the same name as an active one (Btdin 250/100/60/45, Apparecchi BTNET) are grouped with it and stay hidden.
- The navigation seed is part of the TiQuadri import fingerprint (currently adapter version 5), so a mapping change applies on the next import.
- Display levels (`level_code`) remain data. The UI shows node names directly and never renders a "Gamma:", "Tipologia:" or "Famiglia:" prefix.

**Carpenterie and Pannelli (CONFIRMED)**

- Their G2 and G3 hold dimensions and context, not types:
  - Carpenterie: `Armadio HDX 4000 → Altezza 1800-2000mm → Profondità 600 mm`;
  - Pannelli: `Larghezza 850 mm → Per apparecchi in verticale → Per Megatiker Fissi Att. Ant.`.
- The stored hierarchy keeps every source level as it is.
- The UI labels a level only where a display level is assigned (below). It never labels every second level "Tipologia". Their labels are OPEN (§16 Q26).

**Membership (CONFIRMED)**

- **Derived, never assigned SKU by SKU.** An article is under a Famiglia node when it is the primary article (`cat_config_model_entry`) of an active model linked to that node (`cat_range_node_model`).
- **An article may have several positions.** They are all shown; no "primary position" is chosen.
  - In v32, 1,673 of the 3,069 positioned articles have exactly one position.
  - `FN82C16` is under Magnetotermici / Curva "C" (pack 4395) and under Magnetotermici differenziali / Curva "C" - Diff. (pack 4462).
- **Configuration-only articles have no tree position.** These are articles that occur only as option effects or base components of active models, never as a primary article: 1,299 articles. Examples are `F80RC`, `M7X01` and all 71 RCD blocks (FST `IND.-112-5-25`).
  - They are shown as accessories or components of their models, derived from `cat_config_rule_effect` and `cat_config_model_article`.
  - They also appear in the FST view (below).
- **No inference.** An article is never placed in a TiQuadri node because another article with the same statistical family, the same description pattern or the same template prefix is there. Two examples show why:
  - FST `IME-102-43-124` has 715 current transformers, of which only 7 are positioned under "Strumenti Din";
  - 73 METEL codes match a TiQuadri `%1` template without being listed by TiQuadri, and several are wrong (`F%1` matches `F460`, an MH server).
- **Manual membership** (`source = 'manual'`) is a protected exception, never the primary mechanism.

**Corrections to the TiQuadri import (CONFIRMED requirements; Q27 storage approved)**

The Step 9.2 import has two defects:

- It writes every GERARCHIA level and then a synthetic `range` node for `ID_Gerarchia`, so every leaf appears twice (`level2` "Magnetotermici" → `range` "Magnetotermici").
- The 44 ranges used by `ASS_GERARCHIA_CLASSE_PACK` but absent from GERARCHIA become flat root nodes. Configura's root therefore lists 47 entries, several of them named "Profondità 1000 mm".

The corrected projection:

1. **One node per source level and ID:** Sistema, G1, G2, and G3 when it is non-zero.
   - Node codes carry the level and the source ID. IDs are unique within a level but not across levels: G2 5155 (Apparecchi, obsolete) is also G3 5155 (Pannelli).
   - Names come from the master label tables `ANA_GERARCHIA_1..3` and `ANA_CLASSE`.
   - Disagreeing copies are reported, not used. Examples: G1 566 appears as "Megatiker DIN M1-160 / M2-250" on GERARCHIA rows but as "Megatiker DIN M1-160" in the label table; `ASS_GERARCHIA_CLASSE_PACK` has 256 raw differing GERARCHIA range-name rows (26 differ only in whitespace), 190 differing orphan range-name rows against `ANA_SISTEMA`, and 62 differing class-name rows.
2. **The leaf is the deepest non-zero level of its GERARCHIA row.** There is no synthetic `range` node.
   - A class assignment attaches to the leaf of the GERARCHIA row whose `ID_Gerarchia` matches it. It is never attached by ID equality with a G2 or G3.
   - Example: the row with G2 5155 has leaf 5156, while `ID_Gerarchia` 5155 is a Pannelli leaf.
3. **One `group` node per (leaf, class).** All 23 classes that appear under two ranges also appear under range 99999.
4. **Obsolete branches** are imported for provenance and hidden by the visibility rule below.
   - In Apparecchi, 23 of 78 G1 nodes and 107 of 321 leaves have no active pack.
   - The obsolete "Btdin 45/60/100/250" G1 nodes have the same names as the active ones.
5. **Orphan ranges.** The 43 ranges that `ANA_SISTEMA` names are attached under their Sistema node, keep their source names, and are **non-navigable**.
   - By section: Carpenterie 31 ranges with 1,054 active packs; Pannelli 11 with 2; Apparecchi 1 with 0.
   - `ANA_SISTEMA` gives only the section. Parents are never guessed from ID arithmetic (e.g. 19011 → G1 190).
   - TiQuadri itself cannot browse these ranges, because its tree is built from GERARCHIA. Normal Progettazione structural discovery excludes them (§16 Q28).
   - Their models stay reachable from their articles and through their relations.
6. **Range 99999 is internal.** It holds 38 active packs (join kits and side panels) and has no `ANA_SISTEMA` row.
   - It is kept as a non-navigable node for provenance.
   - Its models stay reachable through `cat_config_model_relation`.
7. **Provenance.** Every node keeps `source_import_id` and a `source_ref` that names the table and the ID (e.g. `TiQuadri GERARCHIA 5991`, `TiQuadri ANA_CLASSE 59911`).
   - Nodes of the old projection become `active = 0` on re-import. They are never deleted or reused.
   - No `.lqp` document references range nodes.
8. **Revision 8.3 context:** `GERARCHIA.Armadi_Compatibili` is imported as accepted generic contexts for assigned non-enclosure models; enclosure models provide `ANA_PACK.Famiglia_Armadi`. `GERARCHIA.ID_Macrofamiglia_Armadi` and `ANA_CLASSE.Classe_Visibile_Senza_Struttura` remain unapplied (§16 Q25).
9. **TiQuadri stays an import source only.** Navigation reads `lq.db` (D3).

**Visibility (Q27 implementation)**

- A node is browsable when it is active, navigable, and its subtree has at least one member:
  - an active model with at least one resolved primary article (engineering trees),
  - a selectable package (revision 8.2, below), or
  - a METEL family with at least one product (FST trees).
- This is computed by query; nothing is stored.
- **Apparecchi:** with obsolete-only branches hidden, the v32 tree has no same-named siblings, except one class duplicated in the source (leaf 9008, classes 90082 and 90083).
- **Carpenterie and Pannelli:** their engineering navigation is not shown in Catalogo. This is a product-owner decision (2026-09-24), independent of Q25: these objects belong to Progettazione. The nodes are retained for Configura, Progettazione and provenance. Their METEL articles remain in Catalogo through the FST tree (below). Pannelli has 3 G1, 10 G2 and 12 G3 groups of same-named siblings (e.g. 2054/3054/4054 "Per Btdin / Megatiker M1-M2"). They differ only in `Armadi_Compatibili` and are not merged; how Progettazione presents them is Q25.

**FST navigation for articles outside TiQuadri (CONFIRMED need; Q27 storage approved)**

Coverage of the METEL BTI delivery (24,676 products):

| Articles | Count |
|---|---:|
| Positioned in the active TiQuadri tree | 3,069 |
| With any TiQuadri relation | 4,533 |
| With no TiQuadri relation | 20,143 |
| of which in statistical families with no positioned article (civil series, door entry, cable management, IME meters, Zucchini, UPS) | 17,741 |
| Classified by a METEL statistical family (FST) | 24,676 |

ListinoBT's `COD_SERIE` is the same FST code, from an older snapshot (1,049 products have since been reclassified). It adds no link to TiQuadri.

The FST codes have a usable structure, but only for this issuer:

- All 503 statistical codes of the BTI issuer, across all its marchi, have four parts (`IND.-112-37-147`) and a description of the form "SEGMENT - SERIE" ("SISTEMA QUADRO - MEGATIKER M5").
- The segment identity is the first two code components (`IND.-112`), and its label is consistent within that identity. The first component alone mixes unrelated segments.
- METEL gives the middle part (`IND.-112-37`) no label. Only ListinoBT `ANA_FAMIGLIA` names it ("INTERRUTTORI SCATOLATI").
- Other issuers use flat codes (`R711 I33A`, `AUTPELHMIACC`, §1).

`cat_metel_family` alone cannot carry this navigation cleanly:

- It holds METEL's own families as delivered, keyed `(issuer, brand, family_type, code)`. Segment and middle levels are not METEL families.
- Synthetic parent rows would mix LibreQuadri-derived data into METEL-owned rows, and would overload `is_known`, where 0 means "referenced but not delivered".
- Its `parent_id` is unused, and would need parent rows that METEL never sends.
- Parsing codes at query time would put a BTicino code format into generic runtime code (§14).

A small schema change is therefore justified. The supervisor approved Q27's generic manufacturer-navigation storage; migration 0006 implements it on main:

```
cat_range_node (migration 0006 additions)
  node_kind  CHECK IN ('section','level','group')         -- structural only; no source vocabulary
  navigable  0/1, default 1                               -- 0 = not browsed in Catalogo (kept for Configura, Progettazione, provenance)
  level_code → cat_range_level (nullable)                 -- display level; NULL = no level label
  source     CHECK IN ('import','metel','manual')         -- 'metel' = derived from METEL families during normalization
  source_delivery_id → app_import_delivery (nullable)     -- provenance of 'metel' nodes
  source_level text (nullable)                            -- source hierarchy identity

cat_range_level (seed)                                    -- LibreQuadri display levels
  code PK ('gamma','tipologia','famiglia','segmento', …), label, sort_order, source

cat_range_source_level_map (seed)                          -- adapter/section/source-level → display and visibility
  (adapter_code, system_id, source_level) PK, level_code, catalogue_navigable, source

cat_range_node_metel_family                               -- FST leaf node ↔ METEL family
  node_id → cat_range_node ON DELETE CASCADE, metel_family_id → cat_metel_family
  PRIMARY KEY (node_id, metel_family_id)
```

- **FST tree.** A per-issuer family-hierarchy parser (the optional per-brand function of §14) runs during METEL normalization and builds the tree Segmento → Famiglia statistica.
  - The leaf is the METEL family itself. Issuers without a parser get one flat level of families.
  - The unlabelled middle level is added only if its labels become available (ListinoBT; §16 Q14, Q27).
  - Products belong to a leaf through the `statistical_family_id` of their governing listing. Nothing is assigned per SKU.
- **Display levels.** The adapter or parser sets `level_code` from a seed map keyed by source, section and depth:
  - TiQuadri G1 → `gamma` in every section;
  - G2/G3 → `tipologia` in Apparecchi only;
  - class → `famiglia`;
  - Carpenterie and Pannelli G2/G3 → none until §16 Q26 is decided;
  - BTI FST segment → `segmento`. The FST leaf keeps the qualified name "Famiglia statistica".

**Precedence and fallback (Q27 implementation)**

An article's catalogue position (the breadcrumb in search results, the product detail, "show in catalogue") is:

1. all its positions in engineering-source trees (TiQuadri), when it has at least one;
2. otherwise its FST position, from the statistical family of its governing listing;
3. nothing in between: no rule turns an FST neighbour into an engineering position.

- Both trees are browsable: the engineering tree first, then the FST tree ("Famiglie statistiche").
- The FST tree is complete: every article appears once. Positioned articles therefore appear in both views, each labelled with its source. "Articles outside TiQuadri" is a filter, not a separate structure.
- `cat_category` does not take part in this precedence and is unchanged.

**Catalogo and Progettazione (CONFIRMED, product owner 2026-09-24)**

Catalogo and Progettazione obtain their objects independently. No article-level structural classification exists or is needed.

- **Catalogo is the complete article catalogue.**
  - Browse results are articles (`cat_product`) and, since revision 8.2, selectable packages (below). Every METEL article stays reachable through the FST tree. No article is classified or removed because it looks structural.
  - Engineering navigation is shown only where it is catalogue-navigable (`navigable = 1`); Carpenterie and Pannelli navigation is not.
  - Configurability comes from `cat_config_model_entry`, restricted to active, non-obsolete models whose `model_kind` is not `enclosure` or `support` (§5.6).
  - The merged browse API uses those nodes for subtree-scoped article search, listed-only and dynamic brand/configurability/technical facets with disjunctive counts, deterministic bounded paging and current-list-price display. It synthesizes no article for a model-only engineering row and required no migration. The three-panel renderer consumes this API and presents an explicit quantity Add or Configura beside current project lines; ordinary Add is atomic, defaults to one and accepts 1–9,999.

**Selectable packages (revision 8.2, CONFIRMED by the product owner on 2026-09-25)**

This amends the 2026-09-24 rule that configuration models without a primary article are not browse rows. Catalogo behaves like the TiQuadri Apparecchi workflow: a selection is either an article or a package.

- **Eligibility** (one shared predicate, `SELECTABLE_PACKAGE_SQL`): an active, non-obsolete configuration model that
  - is not `enclosure` or `support`;
  - is linked to a catalogue-navigable node;
  - has no `cat_config_model_entry`;
  - has at least one fixed article or rule article effect linked to a `cat_product`.

  Runtime code tests only these generic facts.
- **Why such models exist.** The TiQuadri adapter marks a rule article `primary` only when it expands a `%1` template. Packs whose options select complete article codes therefore have no primary article; examples are fuses, transformers, CTX3 contactors, surge protection packs and P17 sockets.
- **v32 evidence.** Of 1,299 active Apparecchi models:
  - 1,105 have a primary article;
  - 160 are packages (153 resolve `complete` with default options);
  - 12 have no article rows even in TiQuadri (placeholders such as the generic Contattori);
  - 22 reference codes absent from the METEL delivery (Apparecchi Datacom and others).

  The last two groups are excluded from Catalogo. They remain in Configura and in the reports.
- **Browse.** Packages are returned beside the article page, never mixed into it; article results, totals, facets and paging are unchanged.
  - Packages come with the first page only, up to 200, with their total.
  - The text query (package name), the brand filter and the configurability filter apply.
  - A technical attribute filter excludes packages. Listed-only applies to articles.
  - A package row shows the model name as its identity, with brand and node name. It has no article code and no price.
- **Inline configuration.** Selecting a package opens it in the Catalogo inspector, with the same generic configuration components as Configura:
  - only the model's visible axes and active options, with their defaults;
  - the resolver's status and issues, BOM, list prices and physical data;
  - a quantity and Add.

  Add uses configured-item insertion. Main re-runs the resolution and accepts only a complete, active configuration; Q22 quantity semantics apply. The price is the resolved BOM's list total; no package price is stored.
- Articles with a primary entry keep the existing article selection and Configura flow. Articles used only by packages remain ordinary articles in the FST tree.
- **Progettazione selects configuration models, not arbitrary METEL articles.** A METEL article existing in Catalogo does not make it usable in Progettazione. Its supported engineering objects are the models produced by the source adapters (currently the TiQuadri import):

  | `model_kind` | Role in Progettazione | Normalized data |
  |---|---|---|
  | `enclosure` | Structural root | Active, non-obsolete; `base_profile_id` → profile of kind `enclosure` with a `stack` zone and no constraints. Models without a profile are quotable, not placeable |
  | `support` | Panel or support placed in a compatible enclosure | Profile of kind `support`; its `parent` constraint accept set contains the enclosure's fit class |
  | `device` | Apparecchi placed by physical compatibility | Profile of kind `device`; `parent` (support) and `ancestor` (enclosure) constraint accept sets |
  | `accessory` | Not a structural picker object | No physical profile |

  - Compatibility filtering uses `cat_phys_constraint` / `cat_phys_accept_set_member` against the base profile's fit class. The final decision is always resolution plus placement validation on the configured snapshot (§5.8), because options can change the profile.
  - Primary articles (`cat_config_model_entry`) are shown for information and never used as the selection key; some models, including panels, have no primary article.
  - `cat_range_node` / `cat_range_node_model` may group models for display. Contextual filtering by enclosure is §16 Q25.
- Runtime code tests only `model_kind`, profiles, constraints and navigation flags, never a source, manufacturer, ID or SKU pattern.

**Multi-brand rules (CONFIRMED)**

- Runtime code, queries and UI use only the generic structure: node kinds, `navigable`, `active`, `level_code` and the membership tables. They never test TiQuadri IDs, `tq.` code prefixes, FST code formats or SKU patterns.
- Source knowledge lives in source adapters (TiQuadri), per-issuer parsers (FST) and seed maps. A future manufacturer supplies its tree through its own adapter or parser, without catalogue changes.
- A tree belongs to the brand that publishes it (`cat_range_node.brand_id`). Articles keep their own METEL brand.
  - The BTicino TiQuadri tree has LEG (291), IMS (88) and CAB (3) primary articles: KNX, CTX3, Legrand racks and IME meters.
  - How those Gamme are presented is OPEN (§16 Q29).

**Evidence**

Sources: `BTQUADRI.mdb` v32, SHA-256 `6d691676879d267549c0733a85302ba687e4f31d103c2650cc1f8c3b9a803320`; `ListinoBT.mdb`, SHA-256 `bdfbe3eec3c4e85d901aa2619a305a16c9770cb4914d8f00f64b5394e6d418de`; METEL `BTILSP021` of 2026-07-01.

- GERARCHIA has 532 rows, one per leaf: Carpenterie 58, Pannelli 153, Apparecchi 321. The G1 counts are 27, 30 and 78.
- The leaf is G3 when present, otherwise G2, with one exception (5155/5156). Three leaves are empty.
- All 2,137 `ANA_CLASSE` rows are used. `ASS_GERARCHIA_CLASSE_PACK` has 10,800 rows, exactly one per pack.
- 44 ranges are outside GERARCHIA: 1,834 packs, 1,094 of them active.
- `ART_TISYSTEM` adds no article that the packs do not already reference.

---

## 6. COMMERCIAL layer (`lq.db`, `com_*` tables)

```
com_price_list
  id, issuer_id → cat_metel_issuer,
  delivery_id → app_import_delivery UNIQUE,     -- provenance: the delivery that created it
  listino_number, valid_from, is_current
  UNIQUE INDEX (issuer_id) WHERE is_current = 1

com_product_price
  product_id → cat_product, price_list_id → com_price_list ON DELETE CASCADE,
  list_price_e4,                     -- METEL price for the multiplier quantity (cents × 100)
  price_multiplier, currency,
  list_price_unit_e4                 -- per unit, computed
  PRIMARY KEY (product_id, price_list_id)

com_purchase_discount                -- OUR conditions with an issuer, not in METEL
  id, issuer_id → cat_metel_issuer NOT NULL,
  brand_id → cat_brand (nullable), discount_family_id → cat_metel_family (nullable),
  discount_chain ('50+10+5'), discount_effective_bp, valid_from, valid_to, notes
  -- resolution: family > brand > issuer default

com_pricing_rule
  id, scope CHECK IN ('default','brand','category','discount_family'), scope_id, markup_bp, valid_from
  -- 'discount_family' scope refers to cat_metel_family
```

- **Price provenance:**
  - A price list belongs to an **issuer** (not a manufacturer) and to exactly **one delivery**.
  - The prices come from that delivery's single LSP file (`app_import_file` row with `file_type='LSP'`).
  - `(issuer, listino_number, valid_from)` is *descriptive*, not unique: a corrected re-issue of the same listino (different file bytes) is a new delivery and a new price list, and triggers a warning.
- **Which price applies:** the current price list of the product's **governing issuer** (§5.2). Discounts are looked up for the same issuer.
- Net cost = list unit × (1 − effective discount).
- Sale price = net cost × (1 + markup).
- All arithmetic is done in one shared TypeScript money module, on integers, with explicit rounding.

### Application tables (`app_*`)

```
app_installation   singleton: uuid, display_name            -- metadata only, never in visible numbers
app_setting        key PK, value
app_customer       id, uuid UNIQUE, name, vat, address, contacts, notes   -- convenience register
app_recent_file    path, project_uuid, title, last_opened_at             -- "Recenti" menu, not a library

app_import_delivery                  -- one METEL DELIVERY = one committed normalization event
  id, issuer_id → cat_metel_issuer,
  fingerprint UNIQUE,                -- SHA-256 of 'LSP:<sha256>|FSC:<sha256 or ->|FST:<sha256 or ->'
  listino_number, valid_from,        -- from the LSP header
  became_current (0/1),              -- 0 for an out-of-order (older) delivery, §9.1
  normalized_at, summary_json

app_import_file                      -- the SOURCE FILES that made up a delivery
  delivery_id → app_import_delivery ON DELETE CASCADE,
  file_type CHECK IN ('LSP','FSC','FST'),
  file_sha256, original_file_name, layout_version, row_count
  PRIMARY KEY (delivery_id, file_type)          -- at most one file of each type per delivery
  INDEX (file_sha256)                           -- NOT unique: one file can belong to many deliveries

app_source_import                    -- one engineering-source import (rev 8, §9.3)
  id, adapter_code ('tiquadri','listino_bt','assets'), adapter_version, source_label,
  fingerprint UNIQUE,                -- SHA-256 of adapter code + version + member file SHA-256s
  imported_at, became_current (0/1), summary_json

app_source_import_file
  import_id → app_source_import ON DELETE CASCADE,
  role ('master','dxf','listino','assets'), file_sha256, original_file_name, byte_size
  PRIMARY KEY (import_id, role)
```

---

## 7. Project documents (`.lqp`)

The merged Preventivo + Distinta PDF milestone derives both documents from the current `ProjectDocumentView` without storing PDF preferences or modifying `.lqp`. Preventivo prints commercial quotation lines (one configured row per item; primary commercial article code or neutral dash); Distinta prints the existing grouped article totals. Both use the same escaped HTML and LibreQuadri styling; Electron's main process prints A4 from a sandboxed, JavaScript-disabled generator window and owns PDF bytes, preview and native save. The preview viewer enables JavaScript while remaining sandboxed, context-isolated, Node-disabled and preload-free. Missing prices make the document total indeterminate. The option to omit all monetary columns is per preview and is not project data. This milestone makes no database design change.

The Fronte Quadro PDF review candidate uses the same approach without changing project storage: the main process reads the current project and installation-local vector assets, then serializes the shared `src/drawing/` pure TypeScript geometry, object/dimension/caption primitives and annotation box content as escaped SVG/HTML. A restricted tag/attribute vocabulary and the existing document escaping helper generate markup; main does not load React or ReactDOM. Progettazione consumes the same primitive model through a thin React adapter. Its separate IPC accepts only label/dimension booleans; no engineering coordinates, editor state or HTML cross that boundary. One A4 sheet uniformly fits the complete combined drawing, choosing the best-fitting orientation deterministically. Existing PDF preview/save ownership and commercial document behavior are retained. This first drawing export does not implement the future R-17 §7 technical-sheet system.


### 7.1 Requirement

- There is no shared live database, no real-time collaboration and no cloud sync.
- A project/preventivo (later including its panel configuration) is a **file**. A user can send it to another LibreQuadri user on another computer (macOS or Windows), who can open it, edit it, save it and send it back.
- A project must **not break** when the receiving computer has a different METEL listino version, a different enrichment state, missing brands, or delisted products.

### 7.2 Document model (D8)

- The `.lqp` file **is** the project. Commands: **Nuovo, Apri…, Salva, Salva con nome…, Chiudi**, plus **Recenti** and **Esporta copia senza costi…** (§7.8).
- **There is no project library in `lq.db`.** `lq.db` knows only a "recent files" list (paths may become stale if the user moves files).
- One window per open project. Several projects can be open at the same time.
- Opening the same *path* twice focuses the existing window.
- Double-clicking a `.lqp` file opens it. The extension is registered on both OSes:
  - macOS: the `open-file` event,
  - Windows: file path in `argv`, forwarded through the single-instance lock.

### 7.3 Editing lifecycle: working copy + atomic save

The app never keeps a SQLite connection open on the user's file. The file may be on a USB stick, a synced folder (OneDrive/iCloud/Dropbox), a network share, or an e-mail attachment in a temp folder, and SQLite must not hold locks or create journal files there.

**1. Open**

1. Copy the user file's bytes (plain read) to `working/incoming/<session-uuid>.lqp`. If a `-journal` or `-wal` file exists next to the user file, it was not closed cleanly, so refuse with a message.
2. Validate the incoming copy (§7.9, steps 1–8).
3. Build the working copy `working/<session-uuid>.lqp` from **our own** schema, load the data into it (§7.9 step 9), and migrate it to the current format.
4. Delete the incoming copy.
5. Record the **baseline** of the user file: size, mtime, and the SHA-256 of the bytes read in step 1.

**2. Edit**

Every user action is a short transaction on the working copy, so a crash never loses more than the last action. The window shows "modificato" relative to the file on disk.

**Undo / Redo (document history, in memory only).** The Progettazione actions — placement, movement, Rimuovi posizione, Pannello subtree unplacement, Carpenteria removal (both modes), structural add, placed Carpenteria option reconfiguration, Fronte Quadro text add/edit/remove and Inserisci falsi poli DIN — are recorded by `ProjectDocumentService`. Before such an action the service captures an image of the working copy (`serialize`); the action, its history entry and the dirty/recovery bookkeeping commit in one transaction or not at all, and an action that changes nothing records nothing. Annulla/Ripeti restore a recorded image in one transaction: every document table is replaced with the image's rows (row ids and storage classes kept, foreign keys checked at commit); `lqp_meta` (save bookkeeping) and the migration journal are never restored. A restore therefore returns exactly a state the document already had — quantities, placements, snapshots, provenance, BOM and annotations — and needs no catalogue. Every other change (Catalogo/Preventivo edits, quantities, discounts, labour, line removal, engineering refresh) clears the history, because restoring an older image would silently revert it. A new action clears Ripeti. History is bounded (100 steps, 64 MB of images), is never written to the file, survives Salva and Salva con nome, and is discarded on close, reopen, discard and recovery.

**Dirty state with history.** Every committed content change gets a fresh content id; Annulla/Ripeti return to the id of the state they restore, and a successful save records the id of the content it wrote. "Modificato" is exactly *current id ≠ saved id*: undoing back to the saved content makes the document clean again (its recovery record is removed), and undoing past it makes it dirty. A recovered working copy has no saved id until it is saved. `changeVersion` still advances on every change, including Annulla/Ripeti, so prepared saves and engineering-refresh plans see them.

**3. Salva** (target = the document's path; Save As uses the same procedure with a new target)

1. **Conflict check.** If the target exists and its size/mtime differ from the baseline, compute its SHA-256. If that differs too, warn "Il file è stato modificato da un altro programma o utente", with the choices: overwrite / Salva con nome / Annulla.
2. **Prepare the new version in a temp file in the target's folder**, which is required so that the final rename stays on one volume: `<dir>/.~<name>.<random>.lqp.tmp`.
   1. Copy the working copy with the SQLite backup API.
   2. In the temp file, set `lqp_meta.revision` = working revision + 1, and set `saved_at` and `saved_by_*`.
   3. Set `journal_mode=DELETE` and run `VACUUM`.
   4. Close and fsync the file.
3. **Verify the temp file.** Reopen it read-only, run `integrity_check`, apply schema validation (§7.9 steps 2–8), and check that `project_uuid` matches. On any failure, delete the temp file and abort; the working copy is untouched.
4. **Preserve the previous version** (only if the target exists), *before* anything replaces it.
   1. Read the current target and copy it to `backups/projects/<project_uuid>/<timestamp>_rev<n>.lqp.part`.
   2. fsync, and check that the copy's SHA-256 equals that of the bytes read from the target.
   3. Rename `.part` → `.lqp`.

   The target is **copied, not moved**, so the target path is never missing or partial.
   - **Target changed during the save:** if its size/mtime changed between step 1 and now, go back to step 1.
   - **Preservation fails** (disk full, permission): abort the save, delete the temp file, and keep the document "modificato". Offer "Salva con nome…". **A save never proceeds without a preserved previous version.**
   - **The overwritten file is not a valid project, or has a different UUID** (e.g. Save As over another file): it is preserved in `backups/projects/_overwritten/<timestamp>_<name>`.
5. **Atomic replace:** `rename(temp → target)`.
   - macOS: POSIX `rename(2)` replaces atomically on the same volume. Then fsync the directory.
   - Windows: Node's `fs.rename` uses `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` on the same volume, a single-step replacement. Readers see either the old or the new file.
6. **If the replace fails**, which is expected occasionally on Windows (`EPERM`/`EBUSY`/`EACCES` from antivirus, a sync client or Explorer preview holding the target):
   1. Retry with back-off, up to ~5 attempts over ~3 s.
   2. If it still fails: **never** delete, truncate or copy over the target (no non-atomic fallback). The target keeps the intact previous version, which is also preserved from step 4.
   3. The new version stays in the temp file, and the user is offered:
      - **Riprova**,
      - **Salva con nome…** (the temp file is renamed or copied to the chosen path),
      - **Annulla** (the temp file is deleted).
   4. The document stays "modificato" until a save succeeds.

   The same handling applies on macOS.
7. **Commit in the app, only after a successful replace:**
   - write the same `revision`/`saved_at` into the working copy,
   - update the baseline (size, mtime, SHA-256 of the new file),
   - clear "modificato",
   - update Recenti,
   - prune `backups/projects/<uuid>/` to the last 20 versions.

   Leftover `.~*.lqp.tmp` files older than 24 h in a folder are removed on the next save to that folder.

- **Target does not exist yet:** step 4 is skipped, and step 5 creates the target atomically.

**4. Salva con nome**

The same procedure, with the new target. The project **keeps its UUID** (same project, new location, like Word). The new path becomes the window's document.

**5. Chiudi** with unsaved changes

**Salva / Non salvare / Annulla**. "Non salvare" discards the working copy.

**6. Crash recovery**

Working copies left in `working/` at startup are offered for recovery ("Recupera progetto non salvato"), then saved via Salva con nome or discarded. Leftover `working/incoming/` files are deleted.

The implementation provides this contract. A dirty close or failed save leaves the working
database and its recovery metadata in application-owned storage, and an explicit discard removes
them. The application offers:

- the startup recovery offer: Recupera / Scarta / Non ora;
- the dirty-close confirmation: Salva / Non salvare / Annulla;
- the save-conflict choice: Sovrascrivi / Salva con nome… / Annulla;
- the save-failure choice: Riprova / Salva con nome… / Annulla;
- Salva con nome.

Recenti is implemented with `app_recent_file` (§6, lq migration 0007): successful create, open, save and Save As record the document path, at most 15 entries, and forgetting an entry never touches the file. "Duplica come nuovo progetto" is not implemented.

### 7.4 Identity and numbering (D11)

- **`project_uuid`** is the technical identity of a project. It is created by **Nuovo** and preserved by Save, Save As, sending and receiving. Two files with the same UUID are copies/versions of the same project.
- **"Duplica come nuovo progetto"** (a separate command) creates a new UUID and clears the visible number. It is used to start a new preventivo from an existing one.
- **The visible number** (`prj_project.number`) is a plain text field.
  - It is **not** derived from the installation, and not required to be unique by the database.
  - User-defined numbering conventions will be implemented later as a small, separate numbering function. The schema doesn't constrain it.
- The installation UUID and user display name are recorded only as **metadata** (`created_by_*`, `saved_by_*`), for the "Proprietà" dialog.
- Nothing in the app is keyed on `project_uuid` alone. Open documents and working copies are keyed by session, so two copies of the same project can be open side by side. An information banner warns: "Un'altra copia di questo progetto è aperta (rev. X)".

### 7.5 Core rule: the project is self-contained

A project never depends on the local catalogue to open, display, print or price. The local catalogue is used only to:

- **add** products,
- **reconfigure** variants,
- **explicitly refresh** prices/data.

Cross-installation references use **stable keys only**:

| Object | Key stored in the project |
|---|---|
| Product | `(brand_marchio, manufacturer_code)`, e.g. `('BTI','FN81B16')` |
| Category, attribute, option | seed `code` (D7), plus the label as displayed at snapshot time |
| Family | `(brand_marchio, family_code)` |
| Price list | `(issuer_sigla, listino_number, valid_from)` |
| Configuration model (rev 8) | `(brand_marchio, model_code)`, plus the model's `definition_fingerprint` at snapshot time |
| Configuration dimension and value, capacity kind, fit class, physical profile (rev 8) | seed/import `code`, plus the label displayed at snapshot time |
| Project, groups, lines, configured items, containment nodes | `uuid` |

The link from a snapshot to a local `cat_product` is computed **in memory** when the project is opened. It is never stored in the file, because it would be wrong on another computer.

The snapshot's `(brand_marchio, family_code)` records the family at snapshot time, for display. It is never rewritten when a family is retired, split or merged locally. Reconfiguring a line starts from the **local** product's current family assignment (§5.5). If that family differs from the snapshot's, the difference is shown, not silently reconciled.

### 7.6 File schema

One project per file. The same Drizzle schema is used for saved files and working copies.

```
lqp_meta                           key PK, value
  format_version, app_version_saved, project_uuid, revision,
  created_at, created_by_name, created_by_installation_uuid,
  saved_at, saved_by_name, saved_by_installation_uuid,
  contains_costs (1/0)

prj_project                        singleton (CHECK id = 1)
  uuid, number, title, status CHECK IN ('draft','sent','accepted','lost','archived'),
  description, notes,
  project_type CHECK IN ('civil','industrial'), norm_code,
  executor, project_date,
  currency, global_discount_bp,
  customer_uuid, customer_name, customer_description,
  customer_vat, customer_address, customer_contacts  -- snapshot

prj_product_snapshot               one row per distinct product used
  id, uuid,
  brand_marchio, brand_name, manufacturer_code, ean,
  short_description, description, unit_of_measure,
  category_code, category_path_label,
  family_code, family_name,
  price_issuer_sigla, price_listino_number, price_valid_from,
  list_price_unit_e4, price_multiplier_original,
  snapshot_taken_at
  UNIQUE (brand_marchio, manufacturer_code)
  -- rev 8: no physical or asset columns; physical state belongs to prj_item*

prj_product_snapshot_attribute
  snapshot_id → prj_product_snapshot ON DELETE CASCADE,
  attribute_code, attribute_name, data_type, unit,
  value_num, option_value, option_label, value_bool, value_text
  PRIMARY KEY (snapshot_id, attribute_code)

prj_group                          quotation/preventivo organisation of lines only; never a physical container
  id, uuid, name, sort_order

prj_line                           (format 2 rebuilds it: 'item' type and item_id)
  id, uuid, group_id → prj_group, sort_order,
  line_type CHECK IN ('product','item','free_text','labour','note'),
  snapshot_id → prj_product_snapshot (set exactly for 'product'),
  item_id → prj_item (set exactly for 'item'; UNIQUE),
  description_override, quantity REAL,
  purchase_discount_chain, purchase_discount_bp, net_cost_unit_e4,     -- internal costs (§7.8); NULL on 'item' lines
  markup_bp, sale_price_unit_e4, line_discount_bp, line_total_e4,
  price_locked                    -- user-overridden price, never auto-refreshed

-- format 2 (revision 8): configured items, containment and assets (§7.11)
prj_item                           one homogeneous configured item; its quantity is its line's quantity
  id, uuid,
  model_brand_marchio, model_code, model_name, model_kind,
  commercial_contribution CHECK IN ('articles','none') NOT NULL DEFAULT 'articles' (format 5),
  model_definition_fingerprint, model_source_ref,
  config_fingerprint, config_label, config_status,
  primary_snapshot_id → prj_product_snapshot (nullable),
  phys_status CHECK IN ('resolved','no_profile','not_physical'),
  profile_code, profile_name, fit_class_code, fit_class_label,
  depth_mm, outer_depth_mm, usable_depth_mm,
  snapshot_taken_at

prj_item_selection                 every resolved axis, visible or hidden
  item_id → prj_item ON DELETE CASCADE, sort_order,
  dimension_code, dimension_label, value_code, value_label,
  selection_source CHECK IN ('user','default','inherited'), binding, editable_when_placed, visible
  PRIMARY KEY (item_id, dimension_code)

prj_item_bom                       resolved BOM, with commercial terms per article
  id, item_id → prj_item ON DELETE CASCADE, seq,
  snapshot_id → prj_product_snapshot NOT NULL, quantity_per_item REAL,
  role, origin_dimension_code, origin_value_code,
  purchase_discount_chain, purchase_discount_bp, net_cost_unit_e4, markup_bp,
  sale_price_unit_e4, price_locked
  UNIQUE (item_id, seq)

prj_item_demand                    item_id, capacity_kind_code, capacity_kind_label, amount,
                                   display_divisor, nominal_pitch_mm
prj_item_view                      item_id, view_code, width_mm, height_mm, insert_dx_mm, insert_dy_mm,
                                   symbol_kind, asset_key, asset_sha256 → prj_asset (nullable)
prj_item_zone                      item_id, zone_no, layout, capacity_kind_code, capacity_amount,
                                   capacity_kind_label, display_divisor, nominal_pitch_mm,
                                   origin_x_mm, origin_y_mm, length_mm, breadth_mm, direction,
                                   pitch_mm, required_view_code
prj_item_zone_slot                 item_id, zone_no, slot_no, x_mm, y_mm
prj_item_constraint                item_id, relation ('parent','ancestor'), set_no, class_code
                                   -- flattened accept sets: each set_no is one OR-set, all sets must hold
prj_item_exclusion                 item_id, own_dimension_code, own_value_code,
                                   ancestor_dimension_code, ancestor_value_code
prj_item_context                   item_id, role ('provides','accepts'), context_code
                                   -- format 4: an enclosure's active provided contexts, a support's accepted ones
                                   -- prj_item.context_policy (format 4): NULL legacy / 'unknown' / 'unrestricted' / 'restricted'

prj_annotation                     id, uuid (unique), text (1..2000 chars), x_mm, y_mm, width_mm, height_mm, sort_order (unique)
                                   -- format 6: Fronte Quadro free-text notes; format 7 adds the box size (width 60..100000,
                                   -- height 24..100000 mm; x/y is the top-left corner). Project presentation data only,
                                   -- coordinates in the combined drawing's millimetres, no catalogue or item reference.
                                   -- Format-6 notes migrate to 240 mm wide boxes, max(40, (lines + length/32) * 16 + 8) mm tall.

prj_node                           recursive physical containment and placement, independent of prj_group
  id, uuid,
  parent_id → prj_node (nullable = root of the physical hierarchy),
  item_id → prj_item (nullable only for node_kind 'group'),
  node_kind CHECK IN ('enclosure','support','device','group'),
  zone_no, start_units, slot_no,      -- position inside the parent's zone (exactly one mode)
  root_x_mm, root_y_mm,               -- roots only
  view_code, sort_order, designation, label_text

prj_asset                          only assets whose license allows embedding (§5.9)
  sha256 PK, media_type, byte_size, data BLOB, origin, license_code, source_ref
```

Article snapshots are per product, shared by product lines and configured-item BOM rows. Physical and rendering state is per configured item, never per article snapshot. Commercial decisions are per product line and, for configured items, per BOM row, because discount families can differ inside one item.

`prj_group` organises quotation lines only. Physical containment is owned by `prj_node`, independently of `prj_group`: a `prj_item` is quoted through its `prj_line` and placed through its `prj_node` rows (Progettazione, Fronte Quadro).

For Step 7A, the confirmed type/norm mapping is fixed and validated in both the application and the document schema:

| `project_type` | Display label | `norm_code` |
|---|---|---|
| `civil` | Norma civile | `CEI EN 60898` |
| `industrial` | Norma industriale | `CEI EN 60947-2` |

`description`, `notes`, `executor` and `project_date` are document snapshots entered during
creation. In the Step-7A form, **Azienda means the customer/client company** and **Descrizione
azienda means the customer/client company description**; they are stored respectively as
`customer_name` and `customer_description`. The chosen filesystem
path is deliberately absent from `prj_project`: it is the location of the document, not project
metadata. The type and resulting norm code are both stored so the file preserves the creation-time
business selection.

Format 1 (Step 7A) materializes the metadata, portable product/attribute snapshots, one default
quotation group and quotation lines.

**Format 2** (revision 8, one project migration):

- adds `prj_item*`, `prj_node` and `prj_asset`;
- rebuilds `prj_line` to add the `item` line type and `item_id`. Nothing references `prj_line`, so the rebuild is local.

Format-1 files load at format 1 and migrate to 2 in the working copy (§7.9). The physical and asset
columns once planned on `prj_product_snapshot` are withdrawn.

### 7.7 Opening on an installation with a different catalogue

The document service opens and migrates entirely without catalogue access. The commercial matching statuses below describe planned receiving-installation UI enrichment, not a catalogue read during open. Engineering provenance status is a separate renderer request after open (§7.12). Nothing in the project changes automatically.

| Status | Meaning | What the user can do |
|---|---|---|
| `match` | Found locally, same price list | everything |
| `price_differs` | Found, different current local price | everything; "Aggiorna prezzi" offered |
| `local_delisted` | Found but no longer listed locally | edit qty/discounts; a successor is suggested if a `replaced_by` relation exists |
| `not_in_catalogue` | Brand/product not imported on this PC | edit qty, discounts, markup, text; move/delete lines; panel placements still render from the snapshot. Variant reconfiguration is unavailable for this product |

- **"Aggiorna prezzi al listino locale"** is explicit: it shows old vs new per line, skips `price_locked` lines, and changes snapshots only after confirmation.
- **Products added on the receiving PC** are snapshotted from *its* catalogue. A project may therefore contain snapshots from different listini, and each records its own price source.
- **Purchase discounts** are snapshotted per line. The local discount table is used only when adding products or on an explicit refresh.
- **Unknown category/attribute codes** (e.g. the sender has newer seed data) are displayed using the labels stored in the snapshot.
- **Unknown or different family codes** are handled the same way. Variant reconfiguration is available only when the local product has a current, active family (§5.5). The sender's family code is never used to find local variants.
- **Configured items (format 2, proposed reconfiguration diagnostics).** An explicit catalogue-backed check can compare `prj_item` with the local model `(brand_marchio, model_code)`; opening itself does not do this:

  | Status | Meaning |
  |---|---|
  | `match` | The model is present locally with the same `definition_fingerprint` |
  | `definition_changed` | The model is present, but its definition changed after the snapshot. Reconfiguration starts from the snapshot's selections and shows every difference |
  | `not_in_catalogue` | The model is absent locally. The item still renders, prices, moves between compatible containers and changes quantity from the snapshot; reconfiguration is unavailable |

  Nothing in the project changes automatically. Reconfiguration and container-bound re-resolution need the local model.

### 7.8 Commercial data in files (D10)

- Project files contain the **complete commercial data** by default: list price, purchase discount, net cost, markup and sale price.
- **"Esporta copia senza costi…"** writes a *separate* file:
  - it clears `purchase_discount_*`, `net_cost_unit_e4` and `markup_bp` on all lines and on all configured-item BOM rows (`prj_item_bom`),
  - it keeps list and sale prices,
  - it sets `contains_costs = 0`,
  - it keeps the same `project_uuid`, because it is a copy of the same project.
  The open document is not modified.
- When a file with `contains_costs = 0` is opened, costs show as "non disponibili". Products added locally get costs from the local catalogue. On save, `contains_costs` is recomputed (1 if any line has cost data).

### 7.9 Format versioning and untrusted-file validation

**Format versioning**

- `format_version` N is the number of bundled project migrations (`db/migrations/project/`) applied to a file. It changes rarely and deliberately.
  - The app opens any **older** format: it loads the file at format N, then migrates the *working copy*. The file on disk is upgraded only when the user saves.
  - A **newer** format is refused: "Questo progetto è stato creato con una versione più recente di LibreQuadri. Aggiorna l'applicazione."
  - Colleagues exchanging files must therefore keep reasonably aligned app versions. This is acceptable for an internal tool.
- **Every `.lqp` file carries `PRAGMA application_id` = a fixed LQP constant** (e.g. `0x4C515031`, "LQP1"). The document service sets it on every working copy, and the backup API carries it into saved files.

**Schema manifest**

- `db/migrations/project/manifest.json` is generated deterministically by
  `npm run db:manifest:project`, applying project migrations `1..N` to an empty database for every
  N. `npm run db:check:project-manifest` and the repository test fail when the committed manifest is
  stale; CI can invoke the same check without maintaining separate schema knowledge.
- For each N it records:
  - every table, with its columns from `PRAGMA table_xinfo`: name, declared type, notnull, pk;
  - every user-defined index: name, table, unique, and columns from `PRAGMA index_xinfo`.
- **Project-schema rule:** the `.lqp` schema must never use views, triggers, virtual tables or `AUTOINCREMENT`.

**Validation of an incoming file**

The validation runs on the `working/incoming/` copy. Any failure rejects the file with a clear message, and nothing is loaded. Names are compared case-insensitively.

1. **File checks:**
   - size ≤ limit (default 200 MB);
   - the first 16 bytes are `SQLite format 3\0`;
   - `application_id` (header offset 68) equals the LQP constant.
2. **Open and check integrity:**
   - open read-only (`readonly: true`) with no extension loading;
   - SQLite defensive mode on (a better-sqlite3 default, to be verified during implementation);
   - `PRAGMA integrity_check` returns `ok`.
3. **Structural preflight before application data:** classify `sqlite_schema` first. Reject views,
   triggers, virtual tables and unsupported object types. Expected application objects and
   `__drizzle_migrations` must be actual tables, not views. Before querying migration rows,
   `PRAGMA table_xinfo('__drizzle_migrations')` must report exactly `id`, `hash`, `created_at`.
4. **Drizzle metadata → N:**
   - `__drizzle_migrations` must exist with exactly the columns `id`, `hash`, `created_at`.
   - Its rows, ordered by `id`, must equal the **first k entries** of the bundled project journal. Drizzle's hash is the SHA-256 of each migration's SQL.
   - Hashes beyond the bundled journal, with a consistent prefix → "newer version" message.
   - Any other mismatch → reject as damaged or foreign.
   - Then N = k.
5. **Classify every row of `sqlite_schema` (type, name, tbl_name, sql)** against manifest(N):

   | Object | Rule |
   |---|---|
   | `type='table'`, name in manifest(N) | allowed; its `table_xinfo` columns must equal the manifest's exactly |
   | `type='table'`, name `__drizzle_migrations` | allowed (Drizzle metadata; checked in step 3) |
   | `type='index'`, name in manifest(N), same `tbl_name` | allowed; uniqueness and columns must match |
   | `type='index'`, name `sqlite_autoindex_<table>_<n>`, `sql IS NULL`, `tbl_name` an allowed table | allowed (created by SQLite for PRIMARY KEY/UNIQUE) |
   | `type='table'`, name `sqlite_stat1` / `sqlite_stat4` | tolerated (created by `ANALYZE`/`PRAGMA optimize`); ignored and never loaded |
   | `type='table'`, name `sqlite_sequence` | allowed only if manifest(N) contains it (never, given the rule above) |
   | any `type='view'` or `type='trigger'` | **reject** |
   | any table whose `sql` starts with `CREATE VIRTUAL TABLE`, any other `sqlite_%` name, any unknown table or index | **reject** |
6. **Completeness:** every table and index in manifest(N) is present.
7. **Metadata:**
   - `lqp_meta` contains all required keys;
   - `format_version` = N;
   - `project_uuid` is a valid UUID;
   - `revision` is a non-negative safe integer and `contains_costs` is exactly `0` or `1`;
   - required timestamps are valid canonical ISO timestamps;
   - `prj_project` has exactly one row.
8. **Limits:** row counts per table and BLOB sizes (e.g. ≤ 20 MB per asset) are within configured limits. Format 2 adds:
   - limits for `prj_item*`, `prj_node` and `prj_asset`;
   - structural checks: `prj_node` is acyclic and depth-bounded; every `prj_item` is referenced by exactly one `item` line; every item line has at least one BOM row; placement fields match the layout of the parent's zone.
9. **Load into a fresh working copy. The incoming file's own schema SQL is never reused.**
   1. Create `working/<session-uuid>.lqp` and set `application_id`.
   2. Apply bundled project migrations **1..N**. The migration wrapper passes Drizzle a journal subset (§12.1).
   3. `ATTACH` the incoming copy read-only as `src`.
   4. In one transaction with `foreign_keys = ON`, for each manifest table run `INSERT INTO main.<t> (<cols>) SELECT <cols> FROM src.<t>`, with **explicit column lists from the manifest** (never `SELECT *`). Our own `NOT NULL`/`CHECK`/FK constraints validate every row. `__drizzle_migrations` and `sqlite_stat*` are not copied.
   5. `PRAGMA foreign_key_check`, then `DETACH`.
   6. Migrate N → current.

   A tampered `CHECK`, `DEFAULT` or other SQL text inside a received file therefore never becomes part of the working copy.

The same checks (steps 2–8) verify every temp file before it replaces a saved file (§7.3, Salva step 3).

### 7.10 Exchanging files

Exchange is plain file handling, like Word documents. There is no merge, and no conflict detection beyond the "changed on disk" check at save time.

- `revision`, `saved_at` and `saved_by_name` are visible in "Proprietà" and in the title bar tooltip, so users can see which copy is newer.
- The per-save backups (§11.2) protect against accidentally overwriting a newer copy.

### 7.11 Configured items, containment, placement and Fronte Quadro (format 2, revision 8)

**Items and lines**

- A configured item (`prj_item`) is one homogeneous configuration. Its quantity is the quantity of its `item` line.
- Adding an item whose `config_fingerprint` equals that of an existing item in the same group increases that line's quantity. Otherwise, a new item and a new line are created.
- Plain catalogue products keep the format-1 behaviour: one `product` line per snapshot.
- **The Distinta is derived, not stored.** It is the sum of the `product` line quantities and of `prj_item_bom.quantity_per_item` × line quantity, grouped by article snapshot.

**Containment ("Progettazione")**

- `prj_node` is the recursive physical hierarchy, independent of the quotation's `prj_group`s: enclosure → support → device, with optional `group` nodes, at any depth. Roots are enclosures or groups, positioned by `root_x_mm` / `root_y_mm`.
- In the current placement core, multiple enclosure roots are allowed without a separate quadro/assembly table. Physical `group` is reserved: commands create only enclosure roots and support/device descendants. `prj_group` remains quotation organization only.
- **Placed nodes consume quantity.** Each placed node uses one unit of its item's line quantity, so an item never has more nodes than its line quantity. Unplaced units are simply not in the tree.
- **Validation works offline.** Placement validation (§5.8) uses only snapshot data: `prj_item_zone`, `prj_item_demand`, `prj_item_view`, `prj_item_constraint`, `prj_item_exclusion` and the ancestors' selections. Moving nodes between compatible containers therefore works without the catalogue.
- **Ordered packing is local to one parent zone.** Append and insertion at a zero-based index place a child in the zone's order; reorder and leaf removal repack the remaining children atomically. Linear zones accumulate capacity demand, stack zones accumulate rendered view height, and slot zones assign the lowest numbered available slots in order. These operations run the same offline physical validators as explicit placement and preserve `prj_node` identities and format-3 snapshots. Empty space is left empty unless the user runs the automatic capacity fill (below).
- **Automatic capacity fill ("Inserisci falsi poli DIN").** `fillCapacity({capacityKind})` (only `din_rail` is offered) examines every linear zone of that capacity kind on every placed Pannello of every Carpenteria (pooled Pannelli excluded). The free runs are the complement of the snapshotted occupants' `[start_units, start_units + demand)` in `[0, capacity)`. Each run is closed exactly with the fewest pieces of the filler widths the catalogue designates for the kind (`cat_config_capacity_filler`; one complete configuration per closed amount), largest piece first; a run that no combination closes exactly stays empty and is reported. Existing occupants, earlier fillers included, are never moved, merged or removed, so a repeated fill finds nothing. Each Pannello is checked with the same catalogue design guard as an added Apparecchio (physical class of Pannello and Carpenteria, context, navigation, staleness); refused or unverifiable zones are skipped with their reason. Pieces of one width are inserted as one configured item through the normal insertion (identical snapshots merge, Q rises by the number of pieces) and each piece is placed with `placeChild`, so every write runs the ordinary validators. The whole fill is one transaction and one undoable action; a fill with nothing to place writes nothing and does not dirty the document. Commercial semantics are the source's: each piece is a configured item whose BOM is whatever its configuration resolves to (TiQuadri: 1 × BTI E80FP per piece, whatever the width); no strip-consumption aggregation is made. Generated fillers are ordinary items and nodes: no `.lqp` change.
- Format 3 adds nullable `prj_item.fit_class_label` and `prj_item_zone.capacity_kind_label`, `display_divisor`, `nominal_pitch_mm`. Insertion snapshots these from the engineering catalogue. Migration from older formats leaves unavailable values NULL. A placement that needs missing zone metadata is refused with a diagnostic; the current catalogue is never consulted to fill it. Existing physical trees remain readable with null calculated positions and an issue when the snapshot cannot establish positions.
- **Format 4 — engineering-context snapshot.** Migration `0003_context_snapshot` adds nullable `prj_item.context_policy` and `prj_item_context(item_id, role, context_code)`. Insertion of an enclosure snapshots its policy and its *active provided* context codes; insertion of a support snapshots its policy and its *active accepted* codes; devices get nothing. `NULL` policy means a legacy item whose context facts were never snapshotted; `unknown` means the catalogue had no context data when it was added. Navigation data (range nodes, `design_navigable`), active/obsolete flags, context names, inactive contexts and source ids are deliberately not snapshotted: they decide whether a model may be discovered or added, not whether an item already in the project fits another container. The semantic snapshot comparison includes the context facts, so re-adding the same configuration with different facts is refused, and re-adding it to a legacy item completes its snapshot while merging the quantity. Opening or migrating a project never queries the catalogue and never fills legacy items.
- **Configuration-level contribution correction (2026-10-28).** Catalogue migration 0017 adds an explicit `cat_config_rule.empty_bom_allowed` boolean. A reviewed matching support rule with no resulting articles may resolve as physical-only even when the model offers other billable configurations. Project snapshots keep the existing `articles`/`none` format-5 invariant for the effective selected configuration. Unknown empty BOMs remain invalid. See [source approval and installed upgrade rules](ENGINEERING_ADAPTER_LIFECYCLE.md#reviewed-configuration-level-article-contribution-2026-10-28).

- **Format 5 — proposed R-19a commercial contribution snapshot.** `cat_config_model.commercial_contribution` and `prj_item.commercial_contribution` distinguish ordinary article-contributing configurations (`articles`, the migration default) from reviewed physical-only configurations (`none`). `articles` still requires a nonempty resolved BOM; unresolved references are incomplete. `none` requires no base or selected rule article effects, resolves with an empty BOM and `NULL` commercial price, and retains its physical profile and configuration fingerprint. An article effect on `none` is an explicit classification conflict. Offline validation requires `none` items to have zero BOM rows, `NULL` primary article and `NULL` line unit/total prices; `articles` items retain their nonempty BOM requirement. The semantic merge comparison includes the contribution value. Distinta remains BOM-derived, and quotation price coverage excludes `none` lines while item quantity remains counted. Catalogue continues to expose only commercial articles and linked packages; Progettazione discovery can offer approved physical-only devices using normalized facts. The TiQuadri adapter applies a reviewed source-specific seed only when raw `ANA_ART_PACK` and all relevant `ANA_ART_MODALITA` rows are absent; article-free unapproved packs remain `articles` and review candidates. The initial seed contains only pack 1778, "Din generico - Solo spazio". This review branch does not implement the final device picker UI or printed Preventivo.
- **Moving an existing support to another enclosure root** is decided by the generic placement engine from the project alone, for both `placementTargets` and the writes (`moveNode`, `movePackedNode`). With facts on the support and on the destination root: an `unknown` policy on either side is refused (`context_data_unavailable`); an `unrestricted` support passes; a `restricted` support needs an accepted context that the destination provides (`required_context_not_provided`). The physical class, `match_container`, exclusion and complete-subtree validation then run as usual; the subtree keeps its UUIDs and internal positions and moves in one transaction. When the snapshot cannot decide (facts NULL or `unknown` on the support or the destination root) and a catalogue guard can judge, `ProjectDocumentService` asks the same guard used for first placement about that destination and passes the verdict to the engine as an explicit `rootTransfer` input; an accepting verdict lets the physical and complete-subtree validation continue, a refusing one refuses. This is one shared helper for `placementTargets`, `checkPlacement`, `moveNode` and `movePackedNode`, it is not consulted when the snapshot already decides, and nothing is written back to the snapshot. When the catalogue cannot judge (no guard, or the model, root or engineering data is unavailable) only a destination root with the same snapshotted brand, model code and definition fingerprint as the current root is provable; anything else is refused (`root_context_unverified`). A properly snapshotted move needs no catalogue, so a compatible Pannello can move between different Carpenteria models in a project reopened with no catalogue. First placement of a pooled Pannello still uses the catalogue guard (eligibility to add); a catalogue-free way to give legacy items facts is left to the engineering-data lifecycle work (R-15).
- A placed node consumes one unit of an integer configured-item quotation quantity. The quantity rules are confirmed by §16 Q22 (answered) and implemented. Unplacement is leaf-only.
- **Removing a whole physical root (R-17c).** `removePhysicalRoot(nodeUuid, contents)` is the one exception to leaf-only removal and accepts only a root. In one transaction it deletes the root and its subtree (deepest nodes first) and then adjusts quantities by Q22 units: the root's own unit always leaves the project (its line quantity drops by one; at zero the line and item are removed exactly as `removeLine` removes them). `keep-contents` leaves every contained item's quantity unchanged, so its placed units simply become unplaced (P falls, Q − P rises). `remove-contents` also takes out, per item, the units that were placed in that subtree; units of the same item placed elsewhere or unplaced are untouched. Removal never goes below the units still placed, and any failure rolls the whole operation back.
- **Unplacing a contained subtree (R-17c).** `unplaceSubtree(nodeUuid)` unplaces a non-root node together with everything placed in it (a Pannello with its Apparecchi), deepest nodes first, in one transaction. Every removed node was one placed unit, so only P changes: quantities, configured items and quotation lines are untouched, as are nodes of the same items elsewhere, and siblings keep their positions (no repack). A root is refused (a Carpenteria is removed with `removePhysicalRoot`). `unplaceNode` keeps its leaf-only contract and is still used for Apparecchi; both root removal and subtree unplacement share one subtree-deletion routine.
- For a container selection bound as `match_container`, placement requires the child to have the same dimension and value. Missing comparison data is refused. `inherit_container` remains unsupported; Q13 is still open.
- **Every item stays homogeneous.** If placing a unit would change its configuration (a `match_container` dimension, or later an `inherit_container` one), that unit is split into its own item and line. The split needs the local model.

**Fronte Quadro**

- `renderFront(project) → SVG` is a pure, deterministic function of the `.lqp` content, tested against golden files.
- Coordinates:
  - units are millimetres (one SVG user unit = 1 mm);
  - the origin is the top-left of the first root's outer frame;
  - y points downwards.
- Position of a node in zone `z` of its parent `P`: the zone or slot gives an insertion **anchor**, and the rendered top-left subtracts the selected view's insertion offset.
  - linear horizontal: `x = P.x + z.origin_x + start × pitch(kind) − view.dx`, `y = P.y + z.origin_y − view.dy` (vertical zones apply the start term to `y`);
  - stack: `x = P.x + z.origin_x − view.dx`, `y = P.y + z.origin_y + start − view.dy`;
  - slots: `x = P.x + slot.x − view.dx`, `y = P.y + slot.y − view.dy`.
- `internal_rail_mm` has a 1 mm nominal pitch in the supported TiQuadri source data. The capacity seed supplies that generic unit conversion for new snapshots; older format-3 documents keep their existing snapshot values.
- Drawing:
  - a node is drawn with its embedded, displayable asset stretched to the view's W×H;
  - otherwise, with the parametric symbol for its `symbol_kind`;
  - labels show the node's designation and configuration label;
  - layers: enclosure → supports → devices → labels.
- Example: an MCB at start 0 on a panel at 0 mm in the MDX800 600×1200 is drawn at (136.5, 123) mm, with a size of 54 × 45 mm.

---

### 7.12 Project engineering snapshot lifecycle (format 10)

Migration `0009_engineering_provenance` adds four nullable TEXT columns to `prj_item`: `engineering_provenance`, `source_adapter_code`, `source_adapter_version`, `source_import_fingerprint`. NULL denotes unknown legacy facts, `manual` has NULL source fields, `import` requires nonempty adapter code, canonical positive integer text (`^[1-9]\d*$`) and lowercase 64-digit SHA-256. SQL and incoming-file validation enforce the combinations; no local import ID is portable. Legacy migration is purely additive and reads no catalogue. Manifest includes all ten migration prefixes; newer format handling is unchanged.

Configuration resolution obtains generation provenance from the existing readiness/import authority. Every initial insertion (including structural and presets) uses the shared engineering writer. Reconfiguration writes the new generation; Duplica copies the saved one. Q22 fills only NULL provenance after the existing complete semantic/commercial equality checks, and never overwrites non-NULL provenance.

Status is per item and counted by state, without treating unknown as current: `current_generation`, `other_generation`, `older_adapter`, `newer_adapter`, `catalogue_unavailable`, `catalogue_stale`, `unknown_source`, `manual`, `unknown`. Adapter comparisons use the registered descriptor; same version/fingerprint with a ready source proves current generation. Missing/stale source and unknown adapter are distinct. A newer project is never downgraded.

The explicit two-stage refresh requires a saved, clean, resolved document and ready required sources. Matching uses `(brand_marchio, model_code)` and unchanged kind, then dimension/value codes with already-mapped parents. Required/default axes cannot change the stable selection set. Only `complete` and `price_incomplete` resolutions are accepted, with a valid physical profile, verifiable context and unchanged commercial contribution/linked BOM identity. Prices are ignored. Inactive/obsolete models, ambiguous/missing models/options and unsafe resolutions block the entire project.

Planning writes only to an isolated in-memory SQLite image and compares complete pre/post physical assessments. The existing placement engine is reused, with independent assessments of each node/rule family so old unrenderable ancestors do not mask new failures; placed support/root context is independently checked. Old failures may remain; resolved/new failures and geometry/label differences are reported. The opaque SHA-256 token binds project image, UUID/revision/changeVersion/preconditions, source generations, item targets and re-resolved facts/report.

Apply recomputes the plan, requires token equality (`plan_outdated` otherwise), and runs engineering writes and the same physical assessment in one project transaction under `ProjectLifecycleOperationGuard`. Item IDs/UUIDs and node identities/stored placement never change. The writer updates engineering item fields and selections/context/physical tables only, retaining `selection_source` by dimension and a view's `asset_sha256` only for the same view code/asset key. BOM rows, product snapshots, lines, commercial values, project metadata/groups/user text/annotations/assets are never rewritten. Failed writes/validation/recovery bookkeeping roll back and restore session dirty/changeVersion. Successful apply marks dirty, does not save and leaves the original file to the normal Save/Save As/discard/backup lifecycle.

Known older/newer adapter items in relevant physical chains block catalogue-backed discovery/navigation, structural add, pooled-support placement and catalogue-assisted root transfer (`project_engineering_stale`). Unknown provenance gets a notice but does not trigger this guard. Snapshot-proven render/move/edit operations remain available. The minimal renderer notice, Progetto menu and plan dialog perform no automatic refresh. See [implementation and safety details](PROJECT_ENGINEERING_REFRESH.md).

### 7.13 Placed Carpenteria reconfiguration (Stage 2, format 10)

`reconfigureEnclosure(nodeUuid, ConfigurationRequest)` re-resolves one existing physical enclosure through the generic catalogue resolver. Editable changed axes, same brand/model and unchanged depths are required. The old snapshot must be semantically verified against a ready catalogue; stale provenance in the affected subtree requires the explicit engineering lifecycle. Q=1 updates the existing item/line; Q>1 copies one saved unit to a separate Q=1 configuration, decrements the original Q, and changes only the selected node's item association. Nodes and children are never recreated or presets rebuilt. Identical configurations remain independent.

Retained articles reuse their historical product snapshots and sale prices; unique same-role components retain their complete commercial metadata. New articles use current catalogue snapshots through the existing price-conflict policy. Removed articles cease contributing to BOM/Distinta. After BOM/primary references are updated, former BOM and primary snapshot candidates are deleted only when unreferenced by `prj_line.snapshot_id`, `prj_item_bom.snapshot_id` and `prj_item.primary_snapshot_id`, using the same policy as quotation removal. Shared references, including the Q>1 original item, preserve historical snapshots. A returning unused article takes the current listino; a conflicting snapshot still used elsewhere refuses. Derived line totals, quotation discounts and article quantities remain consistent. Complete affected-subtree compatibility and calculated positions must pass before one undoable document transaction commits; snapshot cleanup, writes, derived views and recovery/history bookkeeping roll back together. Save/Reopen remains catalogue-free and format 10 is unchanged. Stage 3 exposes this operation in Progettazione through the existing generic configuration controls and resolver; no renderer rules, model/depth replacement, schema or transaction change. See [full contract, diagnostics and acceptance](CARPENTERIA_RECONFIGURATION.md).

## 8. Product search (in `lq.db`)

| Query looks like | Mechanism | Example |
|---|---|---|
| Exact code / EAN | `code_norm = ?` / `ean = ?` (B-tree) | `3RH2122-2KM40-0LA0` → `3RH21222KM400LA0` |
| Code prefix | `code_norm GLOB 'FN81B*'` (index-assisted) | `FN81B` |
| Code fragment | FTS5 **trigram** on `code_norm`, `ean` (≥ 3 chars) | `81B16` |
| Words | FTS5 **unicode61** (`remove_diacritics 2`, prefix indexes) on `short_description`, `description`, `search_text`, `bm25()` ranking | `magnetot 16A curva C` |

The first catalogue slice temporarily uses prepared, parameterized `LIKE` queries. Representative searches are currently within the interactive target on the ~122k-product catalogue. FTS5 remains the **CONFIRMED** long-term architecture below; the current catalogue query/API boundary is intentionally replaceable by the FTS5 implementation later.

```sql
CREATE VIRTUAL TABLE cat_product_fts USING fts5(
  short_description, description, search_text,
  content='cat_product', content_rowid='id',
  tokenize="unicode61 remove_diacritics 2", prefix='2 3');

CREATE VIRTUAL TABLE cat_product_code_fts USING fts5(
  code_norm, ean, content='cat_product', content_rowid='id', tokenize='trigram');
```

- **Written by hand:** the FTS tables and their `AFTER INSERT/UPDATE/DELETE` sync triggers are hand-written SQL in a **custom Drizzle migration**. FTS search queries are direct SQL (D2).
- **Drift recovery:** `INSERT INTO cat_product_fts(cat_product_fts) VALUES('rebuild')`.
- **Typo tolerance** comes from prefix matching, trigram code matching and the generated `search_text` (expanded abbreviations via `cat_search_synonym`, series, family, category and attribute labels). There is no Levenshtein.
- **Filters** (brand, category subtree, listed-only, attributes) are ordinary SQL conditions. Results are paginated and returned by one IPC call per search.

---

## 9. Import pipeline

### 9.1 Identities, steps and ordering

**Definitions**

- **Source file:** one LSP, FSC or FST file. Its identity is the **SHA-256 of its bytes**, both in the raw layer (`raw_file.file_sha256 UNIQUE`) and in `lq.db` (`app_import_file.file_sha256`, indexed but not unique).
- **Delivery:** the files that the user imports together for **one issuer**: exactly **one LSP**, plus optionally one FSC and one FST.
  - It is the **unit of normalization**, and its identity is `app_import_delivery.id`.
  - Its **content identity** is the fingerprint: SHA-256 of `'LSP:<sha>|FSC:<sha or ->|FST:<sha or ->'`, unique in `lq.db`.
  - Everything that records provenance references the **delivery**: first/last seen on listings (§5.2), issuer↔brand observations, price lists (§6), review items and summaries. Individual files are reachable through `app_import_file`.

**Delivery rules**

- All files of a delivery must carry the same issuer sigla (LSP header; FSC/FST row prefix), otherwise the delivery is rejected before anything is written.
- If FSC or FST is missing, existing family descriptions of that issuer are kept. Unknown codes get `is_known = 0`.
- Re-importing the same LSP with a new FSC/FST is a **new delivery** (a different fingerprint). It updates family descriptions, and its prices are identical.
- **Ordering:** a delivery becomes current (`became_current = 1`) if its `valid_from` is ≥ that of the issuer's current price list; ties go to the later import. An **older** delivery requires explicit confirmation and is stored as **price history only**:
  - its price list is not current,
  - no delisting or governing-listing changes are made,
  - first-seen values may still be set for newly appearing listings.

**Steps**

```
 per file:     1 INGEST ─► 2 PARSE (raw db, idempotent by SHA-256)
 per delivery: 3 VALIDATE ─► 4 IDEMPOTENCY CHECK ─► 5 NORMALIZE + CLASSIFY + ENRICH + REPORT (one lq.db transaction)
```

1. **Ingest (per file)**
   - Compute the SHA-256.
   - Archive the file as `imports/<issuer>/<sha256>.<type>.txt` if it is not already there.
   - Detect the type from the header (not the file name).
   - Decode Windows-1252.
2. **Parse (per file):** skip if `raw_file` already has that SHA-256 with `status='parsed'`. Otherwise use the version-specific fixed-width layout to write to `metel_raw.db`.
3. **Validate (per delivery):**
   - exactly one LSP and at most one FSC/FST,
   - the same issuer on all files,
   - line length, numeric fields and duplicates, including explicit rejection of duplicate `(issuer, marchio, family type, code)` rows within one family source,
   - unknown families/marchi,
   - price jumps vs. the issuer's current price list,
   - an out-of-order `valid_from` (confirmation required).
4. **Idempotency check:** if the fingerprint already exists in `app_import_delivery`, show "Questa fornitura è già stata importata" and do nothing.
5. **Normalize + Classify + Enrich + Report (one `lq.db` transaction):**
   1. Insert `app_import_delivery` + its `app_import_file` rows.
   2. Upsert `cat_metel_issuer`, `cat_brand` (new brands with `manufacturer_id = NULL`) and `cat_issuer_brand`.
   3. Upsert `cat_metel_family` (scoped by issuer + brand) from FSC/FST.
   4. Upsert `cat_product` identities and this issuer's `cat_product_listing` rows:
      - `first_seen_delivery_id` on new listings,
      - `last_seen_delivery_id` = this delivery,
      - listing fields from the LSP.
   5. If the delivery becomes current: set `is_listed = 0` on this issuer's listings that are absent from the LSP, then recompute the governing listing, the METEL-owned product columns and `cat_product.is_listed` for affected products.
   6. Create `com_price_list` (`delivery_id`) + prices (cents → `_e4`). If current, flip `is_current` for this issuer.
   7. Classify non-manual products using category mappings and unanimous current engineering model contributions (§5.3).
   8. Enrich in one pass: brand parsers propose attributes (`source='parser'`), and applicable agreeing engineering values take `source='engineering'`; protected `manual`, `seed` and `import_file` rows are never overwritten. Rebuild `search_text`.
   9. Group: brand groupers propose family assignments (state `grouper`) for existing active families. They never overwrite `manual` or `manual_excluded` assignments, and never create family definitions (§5.5).
   10. Report: `summary_json` + `cat_review_item` rows (with `delivery_id`). Family conflicts are derived (§5.5) and appear at most as counts in `summary_json`.

Source precedence for enriched attribute values: `manual` > `seed` > `import_file` > `engineering` > `parser`. Category mapping has its separate precedence in §5.3. Family assignment uses its own states: `manual` and `manual_excluded` are protected; `grouper` rows are recomputed.

### 9.2 Transactions and idempotency

- **Where it runs:** in a `worker_thread` with its own better-sqlite3 connection: `lq.db` + `ATTACH metel_raw.db AS metel`. Reading raw rows across the attachment and bulk upserts are **direct SQL** with prepared statements (D2).
- **Raw transactions:** one per **source file** (parse). Each writes only `metel_raw.db`.
- **`lq.db` transaction:** **one per delivery** (step 5). It writes only `lq.db`. Consequences:
  - **An `app_import_delivery` row exists if and only if that delivery's normalization committed.** "Is this delivery imported?" means "does its fingerprint exist?". There is no normalized/failed status to keep in sync.
  - **On failure:** rollback. No delivery row and no catalogue change. The error is written to `logs/import.log` and shown to the user. Parsed raw files stay available for a retry.
  - **On a crash** between parse and normalize: re-running the delivery skips parsing (by SHA-256) and normalizes, because the fingerprint is absent.
- **During the few-second commit,** other writes to `lq.db` wait. Catalogue-editing actions show "Importazione in corso". Searches continue (WAL). **Project editing is unaffected**, because projects live in their own working-copy files.
- **Safety:** automatic `lq.db` backup before every delivery is normalized.
- **Afterwards:** `PRAGMA optimize`; `wal_checkpoint(TRUNCATE)`. Raw retention pruning (§4) runs after a successful delivery.

### 9.2A Implemented application METEL orchestration (2026-10-23)

The application importer strengthens the developer delivery policy to exactly
one nonempty LSP, FSC and FST from one issuer. It parses before staging, rehearses
normalization on a temporary catalogue copy, and compares actual before/after
facts for the user preview. Unknown family references remain warnings. Original
Windows-1252 bytes are archived; pasted text preserves widths through explicit
encoding. Only EUR is accepted by this UI.

The worker retains the sources, reference seeds and parsed temporary raw DB.
It does not write installation `metel_raw.db`. Before confirmation there are no
installed catalogue/archive/backup writes. Apply creates a verified SQLite backup
and publishes a hash-verified source archive, then invokes the existing normalizer
in one immediate `lq.db` transaction. SQLite `data_version` on the retained
connection is compared with the preview both before backup and inside the writer
transaction; a concurrent catalogue change refuses activation. Failed activation
may leave backup/source evidence but no partial catalogue delivery. No atomic
write across attached WAL databases is assumed. Existing developer CLI input and
raw-state behavior remain available.

Project snapshots are never repriced or refreshed. Generic multi-brand identity,
issuer-scoped delisting and protected enrichment retain §§5/7 semantics. See
[the implemented workflow, limits and verification](METEL_IMPORTER.md).

### 9.3 Engineering-data imports: TiQuadri, ListinoBT (revision 8)

**Principles**

- **The importer ingests the full supported dataset**: every source record that the generic model of §5.6–§5.10 understands.
  - There is no scope-limited import, no special demo database and no hard-coded article.
  - Records the model does not understand are skipped **with an explicit reason** and counted.
- **Adapters** are per-source modules behind one interface (`src/main/sources/<adapter>/`: read → normalized records → generic writer), like the METEL parsers and groupers (§14). The generic writer and the runtime know nothing about TiQuadri.
- **Adapter lifecycle.** An adapter version identifies the interpretation of its external engineering source, independently of schema migrations. A single source descriptor supplies import identity and runtime readiness. The installed generation (`app_source_import.became_current=1`) must record a well-formed `adapter_version` exactly equal to the descriptor; older/newer versions and missing/malformed provenance fail closed through existing `engineering_data_stale` guards. A current-version reimport rebuilds normalized facts and clears this condition. Commercial-only METEL operations are independent. Existing `.lqp` snapshots remain independent of installed data and are refreshed only by the explicit format-10 project plan/apply flow (§7.12); snapshot-only offline operations retain their existing behaviour. Remaining import orchestration/maintenance work stays OPEN in R-15. See [installed adapter lifecycle and protected boundaries](ENGINEERING_ADAPTER_LIFECYCLE.md).
- **Source files** are identified by SHA-256 and archived under `imports/<adapter>/<sha256>.<ext>`. The archived file is the raw layer. `lq.db` stores only normalized rows and provenance, and no application function reads the source files after import (D3).
- **MDB files** are read by a pure-JS reader in the import worker, so that imports run on macOS and Windows without external tools (§16 Q21).
- **Transactions.** One `lq.db` transaction per import, preceded by the automatic `lq.db` backup. Imports are idempotent by `app_source_import.fingerprint` (the §9.2 pattern).
- **Order.** METEL deliveries come first, because they provide the articles and prices. Engineering imports may still run before METEL: unresolved article references are resolved after every METEL normalization, which also rebuilds `cat_config_model_entry` for the affected products.
- **Re-import.**
  - Import-owned rows are upserted by stable code.
  - Rows absent from the new source become `active = 0`; they are never deleted or reused.
  - `manual` rows are protected.

**TiQuadri adapter: what is imported**

| Source | Becomes |
|---|---|
| `ANA_PACK` (all; obsolete → `obsolete = 1`, `active = 0`) | `cat_config_model`, code `tq.pack.<ID_Pack>`. The kind comes from `Famiglia_Apparecchi` / `Famiglia_Pannelli` / `Famiglia_Armadi` / sub-family 99 |
| `ANA_ART_PACK`, non-template rows (repeats → quantity) | `cat_config_model_article`; the first row is `primary` |
| label and value IDs of `ANA_MODALITA` | `cat_config_dimension` `tq.label.<id>` and `cat_config_dimension_value` `tq.value.<id>` |
| `ANA_MODALITA` rows | Axes and options: two-dimensional rows become parent/child options, with per-parent defaults and visibility. One rule per row |
| `ANA_ART_MODALITA` (repeats → quantity; `%1` fragments expanded into the pack's base template) | `article` effects; template expansions get role `primary` |
| `Aumenta_Famiglia` | `profile_key_delta` |
| `Modalita_1_Modificabile_Nel_Pannello`, `Modalita_2_Modificabile_Nel_Pannello` | Adapter 11: existing axis `editable_when_placed`, true only when every contributing source row in either slot permits it; mixed axes stay locked and are reported |
| `Max_Aux`, `Valore_Aux` | `cat_config_budget` `aux`, and `budget_use` |
| `Test_Compatibilita_Contenuto` on a modality row | Known but unapplied; counted in the import report, never mapped to `match_container` (§16 Q13) |
| `ASS_PANNELLI_QUADRI_APPARECCHI` | Device profiles: set `tq.apparecchi`, key and class `tq.app.<n>`. Details below |
| `ANA_PANNELLI` | Support profiles: set `tq.pannelli`, class `tq.pan.<n>`, front view, zone (see the next table), `Ruotato` → required view. The parent accept set comes from `ASS_PANNELLI_ARMADI` |
| `ANA_ARMADI` + `ASS_ARMADI_BLOCCO` | Enclosure profiles: one set per pack, keyed by drawing block, including achievable combined option deltas under adapter 11 when the resulting source block exists. Real frame, `stack` zone (usable W×H, origin, `Passo`), depths, class `tq.arm.<Famiglia_Armadi×100+Sotto_Famiglia_Armadi>`; fixed presets use their existing slots semantics |
| `ID_Pack_Kit`, `ID_Pack_Laterali`, `ASS_MACRO_CENTRALINI` | `cat_config_model_relation` (`join_kit`, `side_panel` as data only; `preset_child` with sequence, X/Y and fixed/packed placement mode) |
| `Incompatibilita` | `cat_config_exclusion` |
| `GERARCHIA`, `ANA_GERARCHIA_1..3`, `ANA_CLASSE`, `ASS_GERARCHIA_CLASSE_PACK`, `ANA_SISTEMA` | `cat_range_node`, `cat_range_node_model`. Revision 8.1 (§5.11): one node per source level, classes as `group` nodes on their leaf, orphan ranges under their `ANA_SISTEMA` section, and orphan and internal (99999) ranges non-navigable |
| `File_blocco*` names | `asset_key` on views; the separate M2 drawing command resolves these against `DXF_BLOCK` (§5.9) |

Device profiles (from `ASS_PANNELLI_QUADRI_APPARECCHI`):

- **Demand**, one kind per profile:

  | Source column | Capacity kind |
  |---|---|
  | `Poli_Din` | `din_rail`, 1:1 |
  | `Numero_Mega` | `mccb_slot` |
  | `Numero_Break` | `acb_slot` |
  | `App_Interni_mm` | `internal_rail_mm` |
  | `Prese_CEE` | `socket_slot` |

- **Views:** `Ruotato_0` / `_1` / `_2` → `front` / `front_alt1` / `front_alt2`; `FINTO` → no view.
- **Also:** depth, and the parent and ancestor accept sets.

Panel zones are derived from the panel type and from the demand kinds of the device profiles that accept the panel:

| Panel | Zone | Count (v32) |
|---|---|---:|
| `Pannello_DIN` set | One `linear` `din_rail` zone: capacity `Capienza` poli, origin `Inserimento_X1/Y1` | 220 |
| Accepts only Megatiker or Megabreak profiles | `slots` zone, one slot per insertion point (`Capienza` = number of points) | 1,052 |
| Accepts only internal-rail profiles | `linear` `internal_rail_mm` zone, capacity `Capienza` mm | 36 |
| Accepts nothing | No zone (blind) | 367 |
| Mixed kinds without the DIN flag | No zone; skipped with reason | 14 |

**Skipped or deferred** (the reason is recorded in the report)

| Source data | Reason |
|---|---|
| Thermal data: `POWER_WATT`, `K_RIDUZ`, `POWER_WATT_RIDUZ`, `Potenza_aggiunta`, `POTENZE`, `COEFF_DICH`, `QUADRI_MULTI`, `ANA_CURVE_TEMP`, `PESO_CIRCUITI_COEFF` | Thermal calculation is deferred |
| `ART_TISYSTEM`, `Mod_x_MOD_Tisys`, `Accessori_Tisys` | TiSystem is out of scope |
| `ID_Macrofamiglia_Armadi_1..5` | Semantics not established (§16 Q13). Options are not context-restricted; the report counts the options that would be |
| `Segue_Modalita_Pannello` | Semantics not established (§16 Q13) |
| `QUADRI_WARNING` | Project warnings are deferred (§16 Q24) |
| `Compatibilita_Profondita_Armadi` | Enclosure-depth substitution is deferred |
| `Block`, `Flag_Block`, `Dim_block_*`, `Offset_block_*`, `Num_Blocco_AUX` | Drawing overlays; assets are deferred (§16 Q14) |
| `Label_Stampa`, `Wizard`, `Categoria_pacchetto`, `Visualizza_articoli_doppio_click`, `Numero`, `ANA_DESCRI_CLASSE_MEMO` | No LibreQuadri meaning established |
| `GERARCHIA.Armadi_Compatibili`, `GERARCHIA.ID_Macrofamiglia_Armadi`, `ANA_CLASSE.Classe_Visibile_Senza_Struttura` | Revision 8.3 applies `Armadi_Compatibili` as accepted model contexts for design discovery. The other two fields remain unapplied (§16 Q25) |
| Enclosure packs without `ANA_ARMADI` geometry (9) | Imported as models without a physical profile: quotable, not placeable |
| Slot panels without insertion points (6), mixed-kind panels (14) | Zone skipped. The panel stays quotable and placeable, but accepts nothing |
| "Strumenti" demand (2 profiles, value 75) | Unit not established; the profile has no placeable demand |
| Option combinations whose profile key has no profile (76 single-option deviations) | `no_profile` at resolution |
| Articles not found in `cat_product` | Kept as unresolved references |

**Import report** (`app_source_import.summary_json`, also printed by the developer command)

The report must reconcile with the source and list:

- source identity: file SHA-256, `ANA_DB` version and date, adapter version;
- models imported, by kind, active and obsolete;
- dimensions, values, axes, options and rules;
- base-article and article-effect counts, both source rows and aggregated rows;
- physical profiles by kind; enclosures; panels/supports by zone type; views; zones; slots;
- compatibility: classes, accept sets, constraint rows, and the pairs they represent;
- unresolved product references: distinct codes, by source brand prefix, active vs obsolete;
- conflicts by topic: brand, `din_modules`, missing template expansion, unreachable profile, orphan enclosure keys;
- errors;
- skipped records by reason, with counts and sample keys.

**Reference counts** for the supplied v32 file, from the source analysis of 2026-09-23. The first import must reconcile with them or explain every difference.

| Measure | Reference |
|---|---:|
| Models (active / obsolete) | 7,823 / 2,977 |
| – devices / supports / enclosures / enclosure-range accessories (active) | 1,299 / 1,270 / 604 / 4,650 |
| Dimensions / values used by active models | 157 / 1,041 |
| Axes / options / rules (active models) | 10,769 / 51,307 / 48,609 |
| Article-effect source rows → aggregated effects (active) | 90,950 → 60,830 |
| Fixed base-article rows → aggregated (active, non-template) | 10,714 → 8,923 |
| Device / support profiles | 6,507 / 1,689 |
| Enclosure models with / without geometry (active) | 595 / 9 |
| Accept sets: device → panel / device → enclosure / panel → enclosure (pairs) | 380 (479,707) / 53 (173,829) / 59 (6,576) |
| Distinct concrete articles referenced by active models | 4,718 |
| Unresolved against METEL BTI 2026-07-01, by prefix, before cross-brand matching | BT- 145, LG- 181, IM- 3, CT- 9, HW- 2 |
| Default configurations reaching a profile (devices, supports, enclosures with geometry) | 100 % |
| Single-option deviations without a profile | 76 |

**ListinoBT use and deferred adapter**

- **Implemented:** the optional `--listino` input to `import:tiquadri` reads ListinoBT for module-count comparisons with TiQuadri profiles and records `din_modules` conflicts. It does not populate `cat_product_physical`.
- **Deferred adapter:** `ANA_ART` + `ANA_ART_MONTAGGIO` → `cat_product_physical`: `din_half_modules` = `POLI_DIN` × 2 when > 0, and weight. The brand would be mapped through `ANA_MARCHIO` and `cat_source_brand_map`.
- **Out of scope for that adapter:** ListinoBT prices, descriptions and other METEL-owned fields; assembly and wiring times have no current LibreQuadri consumer.

---

## 10. Electron process model and concurrency

```
 Renderer windows (React, one per open project + catalogue/admin views)
      │  typed IPC (contextBridge), coarse-grained calls
      ▼
 Main process
   ├─ Catalogue service: Drizzle over better-sqlite3 → lq.db
   ├─ Document service: one connection per open project working copy (working/*.lqp)
   └─ Import worker (worker_thread): own connection to lq.db + attached metel_raw.db;
                                     also runs engineering-source imports (§9.3)
```

- **Single app instance** (`requestSingleInstanceLock`). A second launch passes its file argument to the running instance, which opens it in a new window.
- **Single user, local disk:** `lq.db`, `metel_raw.db` and working copies must be on a local disk, never on a network share or synced folder. Saved `.lqp` files can live anywhere, because they are closed single files written atomically.
- **Synchronous driver:** interactive queries must be indexed and paginated (target < 50 ms). Anything long runs in the worker: imports, bulk re-classification, VACUUM, large backups.
- The renderer runs with `contextIsolation: true` and `nodeIntegration: false`. It never receives file paths to database files, only document handles.

---

## 11. Local file location, backup and recovery

### 11.1 Location (D6)

| OS | App data folder |
|---|---|
| macOS | `~/Library/Application Support/LibreQuadri/` (Electron default) |
| Windows | **`%LOCALAPPDATA%\LibreQuadri\`**. Set with `app.setPath('userData', …)` at startup, before `app.ready`, since Electron's default is Roaming `%APPDATA%` |

```
LibreQuadri/
  data/lq.db (+ -wal, -shm)
  data/metel_raw.db (+ -wal, -shm)
  working/                    working copies of open projects (+ crash recovery)
  working/incoming/           temporary copies of files being validated on open
  imports/<issuer>/...        original METEL files
  imports/<adapter>/...       archived engineering sources (TiQuadri, ListinoBT), by SHA-256
  assets/...                  asset store (§5.9): licensed drawings, images, datasheets
  backups/                    lq.db backups
  backups/projects/<project_uuid>/   previous versions of saved project files (+ _overwritten/)
  logs/
```

- Project files (`.lqp`) are user documents saved wherever the user chooses. The default suggestion is `Documents/LibreQuadri/`.
- Development and tests use a separate data folder, so developers and AI agents never touch real data.
- Internal packaged Alpha 0 uses `~/Library/Application Support/LibreQuadri Alpha 0/`. Its validated read-only testing snapshot is provisioned there only when `data/lq.db` is absent; normalized engineering/provenance stays in `lq.db`, and display SVGs keep the existing `assets/` store. Raw databases/source archives are omitted. This is an internal testing exception, not the production catalogue-distribution architecture or a Q14 rights decision. See [Alpha 0](ALPHA_0.md).
- All paths are built with `path`/Electron APIs.

### 11.2 Backup

- **`lq.db`:**
  - backed up with the SQLite online backup API (`db.backup()`) or `VACUUM INTO`, **never** by copying the live file;
  - automatically at startup (at most daily), before migrations and before imports;
  - retention: last 10 + weekly for 8 weeks;
  - manual "Esporta backup catalogo" writes a zip (optionally with `imports/` and `assets/`).
- **Projects:**
  - on every Save, the *previous* version of the target file is copied and verified in `backups/projects/<uuid>/<timestamp>_rev<n>.lqp` **before** the target is replaced (§7.3 Salva step 4), keeping the last 20 per project;
  - otherwise project files are user documents, backed up like any other document.
- **`metel_raw.db`:** not backed up. It can be rebuilt from `imports/`.

### 11.3 Recovery

- **At startup:** `PRAGMA quick_check` on `lq.db`.
  - On failure: open nothing for writing, and offer "Ripristina dall'ultimo backup".
- **Restore procedure:**
  1. close the connections,
  2. move the damaged files to `backups/corrupt_<timestamp>/`,
  3. copy the backup in,
  4. run the migrations,
  5. reopen.
  Projects are unaffected, because they are separate files.
- **Raw DB damaged or deleted:** recreate it empty. Re-parse from `imports/` only if needed. The app keeps working without it (D3).
- **Downgrade protection:** if `lq.db` has migrations the app doesn't know, refuse to open and ask the user to update. The same applies to `.lqp` `format_version` (§7.9).

---

## 12. Migrations and seed data

### 12.1 Migrations (D2)

- **Three Drizzle schemas, three migration folders**, all bundled with the app:
  ```
  db/schema/lq.ts        → db/migrations/lq/
  db/schema/raw.ts       → db/migrations/raw/
  db/schema/project.ts   → db/migrations/project/     (.lqp format)
  ```
- **Generation:** migrations are generated by `drizzle-kit generate` as SQL files, **reviewed and committed**. Anything Drizzle can't express goes into hand-written **custom migrations** (`drizzle-kit generate --custom`):
  - FTS5 virtual tables and their triggers,
  - `CHECK (typeof(...))` guards if not expressible,
  - data fixes.
- **Applying (our wrapper around Drizzle's `migrate()`), at startup / document open:**
  1. back up (`lq.db`) or work on the working copy (`.lqp`),
  2. **downgrade check:** refuse if the database has applied migrations that are not in the bundled journal,
  3. `PRAGMA foreign_keys = OFF` *outside* any transaction. Drizzle's SQLite table-rebuild migrations need this, because the pragma is ignored inside a transaction,
  4. `migrate()`,
  5. `PRAGMA foreign_key_check` (abort and restore the backup on violations),
  6. `PRAGMA foreign_keys = ON`,
  7. for `.lqp`: set `lqp_meta.format_version`.
- **Partial application (`.lqp` only):** loading a format-N file needs migrations **1..N** applied to a fresh working copy (§7.9 step 9). The wrapper does this by giving Drizzle's migrator a journal containing only the first N entries. The manifest check applies every prefix, and the project-document integration test exercises `1..N` followed by `N+1..latest`.
- **Schema manifest:** `db/migrations/project/manifest.json` is generated with
  `npm run db:manifest:project` and checked with `npm run db:check:project-manifest` plus the
  repository test (§7.9). The `.lqp` schema must not use views, triggers, virtual tables or
  `AUTOINCREMENT`.
- **Rules for Claude Code / Codex:**
  - never edit a shipped migration;
  - review every generated table rebuild, and make sure the FTS triggers are recreated if `cat_product` is rebuilt;
  - every migration is tested in CI against a realistic fixture database built from the sample METEL files, and against sample `.lqp` files of every earlier format.
- **Packaging:** the migration folders are shipped as Electron `extraResources`, readable at runtime on both OSes.

### 12.2 Seed (reference) data (D7)

The following are **version-controlled seed files** in the repository (`db/seed/*.json|csv`):

- category tree, attributes, options, category↔attribute links,
- mapping rules, synonyms,
- METEL code decode tables,
- product relation types (§5.6),
- configurable product family definitions and their variant axes (§5.5). **Product membership is not seed data in Step 6A.**
- rev 8: capacity kinds (`cat_capacity_kind`), asset licenses (`cat_asset_license`) and source brand maps (`cat_source_brand_map`). The earlier source ↔ LibreQuadri configuration-dimension and range-node maps were proposed but never implemented; revision 8.4 replaces that proposal.
- rev 8.1 (Q27 approved and merged, §5.11): navigation display levels (`cat_range_level`), and the source-level map (`cat_range_source_level_map`).
- rev 8.4 Stage B (implemented on the review branch): `engineering-vocabulary/tiquadri.json`. Its current reviewed content is the Taratura value → attribute map and explicit "not applicable" decisions (112 mapped values, 59 not applicable); it has no model fact or contributed-category rows yet. The same stable-code schema accepts the reviewed model facts and categories planned for Stages C–E. The Stage F offer computation remains pending. It supersedes the never-implemented "configuration dimension ↔ attribute" and "range node ↔ category" maps above.

**Imported engineering data is not seed data.** Configuration models, dimensions, profiles, classes and browse nodes come from source imports with `source = 'import'` (§9.3). `manual` rows override them and are never overwritten.

- They are applied at startup after migrations: upserted by stable `code` with `source='seed'`. Families are keyed by `(brand marchio, code)`, and are deferred until their brand exists.
- Rows with `source='manual'` (**protected manual overrides**) are never overwritten.
- Seed codes are a **compatibility contract**, because project files reference them (§7.5). Codes are never renamed or reused. A retired code is marked `active = 0`.
- A later "export manual overrides to seed format" function lets improvements made in the app be committed to the repo.

---

## 13. macOS / Windows portability

- **better-sqlite3** (D1):
  - it bundles its own SQLite with FTS5 and JSON1, so features are identical on both OSes;
  - it is a native module, but since v13 it is a **Node-API** addon shipping prebuilt binaries for macOS and Windows (arm64 + x64). Node-API is ABI-stable, so the same per-platform binary loads in plain Node and in Electron: no `@electron/rebuild` step is needed (verified on macOS with better-sqlite3 13.0.3 in Node 25 and Electron 44, 2026-09-21; Windows runtime is not yet verified);
  - the packaging step must still include the correct per-platform prebuild for each target OS (macOS arm64 + x64 or universal; Windows x64), and verify it loads on that OS.
- **METEL files:** CRLF + Windows-1252 on every OS, handled explicitly. Exported CSVs are UTF-8 with BOM.
- **Paths:** always via `path`/Electron APIs. Windows data goes in `%LOCALAPPDATA%`, set before app ready.
- **`.lqp` association (intended, not implemented):** future packaging/file handlers must cover `open-file` (macOS) and `second-instance` argv (Windows). Alpha 0's Electron Packager build uses the existing in-app Open workflow; it does not add file association or Windows packaging.
- **Atomic save on Windows:** replacement is a same-volume `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`. When antivirus or a sync client holds the target, the app retries with back-off, then keeps the temp file and offers Riprova / Salva con nome / Annulla. It never falls back to a non-atomic overwrite, and the previous version is always preserved first (§7.3).
- **Money and locale:** integers formatted with `Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })`.

---

## 14. What is brand-specific, and where it lives

| Brand-specific thing | Where it lives |
|---|---|
| Family code formats, hierarchy parsing | small per-brand TS function in the enrichment layer (optional) |
| Family → standard category | `cat_category_mapping` (seed files + manual overrides) |
| Description → attributes | per-brand parser module + `cat_search_synonym` |
| Family definitions + variant axes | seed files (manual additions protected) |
| Family grouping rules | per-brand **grouper** module behind a generic interface; manual assignment/exclusion |
| Discounts | `com_purchase_discount` rows (per issuer) |
| Configuration models, options, option → article rules | rows imported into `cat_config_*` by a per-source adapter (`src/main/sources/tiquadri/`, §9.3) |
| Physical profiles, capacities, carpenteria/support geometry, compatibility | rows imported into `cat_phys_*` by the same adapter |
| Source brand codes → METEL brands | `cat_source_brand_map` (seed + manual) |
| Article-level modules and weights | `cat_product_physical`, planned for the deferred ListinoBT adapter |
| Drawings | licensed asset store (`cat_asset*`); parametric symbols otherwise |
| Manufacturer navigation trees | `cat_range_node`: engineering trees from the source adapter, FST trees from an optional per-issuer family-hierarchy parser; display levels from seed (§5.11) |
| Meaning of engineering configuration values and model facts (rev 8.4 Stage B Taratura map implemented for review; model facts and categories in C–E) | `engineering-vocabulary/tiquadri.json` seed → `cat_config_value_attribute`; the same seed contract will populate `cat_config_model_attribute` and `cat_config_model.category_id`; the planned generator remains development-only; derivation and classification are generic |

The raw layer, the normalized schema and the project file format contain **no** brand-specific logic. Source adapters are the only code that knows a source's structure. The configuration engine, placement, rendering and UI never contain brand or SKU rules.

---

## 15. Suggested delivery order

1. **Foundation:**
   - Electron main-process DB service (better-sqlite3 + Drizzle),
   - pragmas,
   - migration wrapper with backup/downgrade checks,
   - `LOCALAPPDATA`/dev data folders,
   - seed loader.
2. **Raw layer + METEL parser** (020/021) in the import worker, with delivery assembly, fingerprints, `app_import_delivery`/`app_import_file` and the report. Verify the counts in §1.
3. **Catalogue core:** issuers, brands, METEL families, products + listings (governing listing), price lists per issuer (`_e4`), FTS5 search.
4. **Category seed + mapping + "Da classificare" queue.** BTicino DIN protection first.
5. **Attributes + filters** for 2–3 categories, with the BTicino description parser and synonyms.
6. **Families/variants:**
   - **6A:** the verified BTI MCB slice of §5.5 (10 families, 520 products). It includes the family seed, the assignment relation, the generic grouper engine plus the BTI grouper, derived validation and resolution. Implemented.
   - **Later:** other categories/brands. Revision 8 delivers accessories and physical data through configuration models and physical profiles (step 9), not as family relations.
7. **Purchase discounts + project documents:**
   - `.lqp` schema,
   - New/Open (validation + fresh-copy load)/Save (preserve-then-replace)/Save As/Close,
   - working copies + crash recovery,
   - snapshots,
   - quotation lines.
   - **7A:** project creation, persistent quotation and the document lifecycle. Implemented; purchase discounts are not.
8. **Cross-installation behaviour:** resolution statuses, "Aggiorna prezzi", "Esporta copia senza costi", per-save backups.
9. **Configured items and Progettazione (revision 8)**, on the full supported BTicino dataset, in this order:
   1. **Schema:** `lq.db` migration(s) for §5.6, §5.8, §5.10 and `app_source_import*`, plus the seeds `cat_capacity_kind` and `cat_source_brand_map`.
   2. **TiQuadri adapter and full import** (§9.3), developer command first, with the complete import report. Real-data tests reconcile the §9.3 reference counts and check sample facts:
      - pack 4395 has its Taratura values;
      - `FN82C16` has an entry in `cat_config_model_entry`;
      - 16400 + auxiliary contact → 16402 = 6 half-modules;
      - the geometry of MDX800 pack 343;
      - panel 6311 has capacity 48;
      - panel 8311 is not accepted in 5002.
   3. **Resolution engine**: configuration, BOM, pricing, physics and placement validation, plus IPC. No brand logic.
   4. **`.lqp` format 2** (§7.6, §7.11): project migration, manifest, validation, a format-1 → 2 fixture test, and opening with an empty catalogue.
   5. **Document commands**: add/reconfigure/remove configured items; place/move/remove nodes; split on context change; derived Distinta.
   6. **UI**:
      - catalogue entry ("Configura") and the browse tree. Revision 8.1 catalogue navigation is merged on main after Q27 approval. The acceptance scenario enters through catalogue search and does not depend on it;
      - the configurator;
      - **Progettazione**: containment tree, placement with reasons, parametric Fronte Quadro;
      - Distinta/Preventivo.
   7. **End-to-end acceptance** on the full dataset (below).
   8. **After acceptance:**
      - the ListinoBT adapter and conflict review;
      - application of model relations (join kits, side panels, centralino presets);
      - `inherit_container` and context availability, once §16 Q13 is settled;
      - assets, once Q14 is settled;
      - the production import UI/worker;
      - purchase discounts per BOM row.

**Product-owner correction (2026-09-23)**

- **Friday is the deadline, not a scope limit.** Friday 2026-09-25 is the deadline for the full end-to-end demonstration, not a reason to build a reduced-data prototype.
- **Full data.** The normalized database contains the full supported BTicino dataset. The MDX800 + BTDIN workflow is the acceptance scenario, not the boundary of the imported data.
- **No shortcuts:** no scope-limited importer, no special demo database, no hard-coded demo articles. Architectural corners are not cut to meet the date.
- **Still deferred:** functionality that the workflow does not require, or whose semantics are not established: thermal calculation, TiSystem, unverified flags, and use of licensed WMF/DXF drawings.

**End-to-end acceptance (step 9.7)**

On an `lq.db` holding the METEL BTI delivery and the full TiQuadri import:

| Step | Expected |
|---|---|
| Catalogue → `FN82C16` → Configura | The entry index offers the BTDIN60 2P curve C models, with Taratura 16 A preselected |
| Configure | Real axes and defaults from the import (Taratura, auxiliary contacts, coils, motor/Stop&Go); hidden axes are resolved |
| Accessory | Auxiliary contact `F80RC`: BOM `FN82C16` + `F80RC`; profile 16402 (3 modules, 54 × 45 mm); auxiliary budget 1/3 |
| BOM / pricing | METEL list prices (2026-07-01: €92.17 + €71.99 = €164.16) |
| Carpenteria | MDX800 600×1200×230 with the default glass door: `92663` + `93000FM` + `92660V` |
| Pannelli | A 24-module DIN 600×200 panel is accepted in the enclosure at 0 mm |
| Placement | The MCB at 0 occupies modules 1–3 of 24. An 850 mm panel is rejected (`incompatible_parent`). A 2P MCB on a rail with 1 free module is rejected (`over_capacity`) |
| Fronte Quadro | Parametric drawing at real millimetre positions |
| Distinta / Preventivo | Aggregated articles, quantities and prices |
| Save / close / reopen | Selections, BOM, physical state and positions are identical. The file also opens, renders and prices with an empty catalogue (automated test) |

---

## 16. Decision log

Decisions D1–D11 were **confirmed by the product owner** on 2026-09-21. Revision 5 of the architecture received **independent supervisor approval on 2026-09-21**. Revisions 5–8 do not change any of these decisions.

| # | Decision |
|---|---|
| D1 | SQLite driver: **better-sqlite3** |
| D2 | **Drizzle ORM** for normal typed access + drizzle-kit migrations. **Direct SQL** allowed where appropriate (FTS5, imports, cross-DB queries, maintenance) |
| D3 | Two local databases, **`lq.db` + `metel_raw.db`**. `lq.db` is independently usable after normalization, and no application functionality depends on raw METEL row or batch IDs |
| D4 | Money stored as **INTEGER 1/10,000 EUR** (`_e4`). Percentages as basis points (`_bp`) |
| D5 | **Local single-user installation**, with no shared live DB and no sync. Projects travel as portable files |
| D6 | Windows data folder: **`%LOCALAPPDATA%`** |
| D7 | Reference data is **version-controlled seed data** in the repository, with protected manual overrides |
| D8 | **Pure document model:** the `.lqp` file is the project (New/Open/Save/Save As/Close). No project library |
| D9 | `.lqp` format is **SQLite** |
| D10 | Project files carry **complete commercial data**; a **sanitized copy without internal costs** can be exported |
| D11 | **Visible project number is independent of installation identity.** UUID provides technical uniqueness. User-defined numbering conventions comes later |

### Contradictions from revisions 1–3 resolved in revision 4

(Historical. `app_import_log` was replaced by `app_import_delivery` + `app_import_file` in revision 5.)

- `STRICT` / `WITHOUT ROWID` tables (rev 2) are not generated by Drizzle (D2) → replaced by `CHECK` constraints.
- A `PRAGMA user_version` migration runner (rev 2) conflicts with Drizzle's migrator → Drizzle `migrate()` inside our wrapper (backup, FK handling, downgrade check).
- `lq.db` stored raw batch IDs (`first_seen_batch_id`, `com_price_list.metel_batch_id`, `cat_review_item.batch_id`) and METEL decode tables lived in the raw DB. Both conflict with D3 → `app_import_log` keyed by file SHA-256, and decode tables moved to `cat_metel_code`.
- `com_product_price.list_price_cents` conflicts with D4 → `list_price_e4`. Only the raw DB keeps cents.
- Local project library, `prj_project_history`, the revision/base-revision round-trip merge prompts and installation-prefixed numbers (rev 3) conflict with D8/D11 → document model with working copies, atomic save, "changed on disk" check, per-save backups, and a free-text number.
- `local_product_id` stored in project snapshots (rev 3) would be wrong on another PC → resolved in memory on open.
- Rev 2 described `lq.db` as holding quotes → projects are now only in `.lqp` files.

### Revision 5: supervisor review corrections

1. **Delivery vs. source file:**
   - New `app_import_delivery` (normalization event, content fingerprint) and `app_import_file` (member files by SHA-256, not unique across deliveries) replace `app_import_log`.
   - Raw `import_batch` becomes `raw_file` (file-only; no delivery or "normalized" status).
   - First/last seen, price lists and review items reference deliveries.
   - One raw transaction per file and one `lq.db` transaction per delivery; a delivery row exists if and only if it committed.
   - Out-of-order deliveries are defined. (§3.1, §4, §5.2, §6, §9)
2. **Issuer vs. ownership:**
   - `cat_metel_issuer` is new. `cat_manufacturer` now means owner only, and is seed/manual.
   - `cat_brand.manufacturer_id` is nullable and never inferred.
   - `cat_issuer_brand` records observations.
   - `cat_manufacturer_category` becomes `cat_metel_family`, scoped by issuer + brand.
   - `cat_product_listing` holds per-issuer listing state, with a governing-listing rule.
   - Price lists and purchase discounts belong to issuers.
   - Category mapping can be issuer-scoped. (§1, §5.1–5.3, §6, §14)
3. **Atomic save:**
   - temp file in the target folder, verified before use;
   - the previous target is **copied and verified into backups before** the atomic rename, and a save never proceeds without it;
   - same-volume atomic rename on both OSes;
   - Windows retry, then Riprova / Salva con nome / Annulla, never a non-atomic fallback;
   - app state is updated only after success. (§7.3, §11.2, §13)
4. **Untrusted `.lqp` validation:**
   - `application_id`;
   - Drizzle `__drizzle_migrations` verified against the bundled journal to determine N;
   - an exact `sqlite_schema` allowlist from a CI-generated manifest, including SQLite internal objects (`sqlite_autoindex_*`, `sqlite_stat*`, `sqlite_sequence`);
   - rejection of views, triggers, virtual tables and unknown objects;
   - data loaded into a fresh working copy built from our own migrations 1..N, using explicit column lists. (§7.3, §7.9, §12.1)

### Revision 6: Step-6 configurable families (supervisor-confirmed 2026-09-22)

This revision reconciles the Step-6 investigation with an independent architecture review. Supervisor decisions (§5.5):

1. **First slice:** the verified 10-family / 520-product BTI MCB slice (`protezione.interruttori_automatici`; axes `poles`, `trip_curve`, `rated_current`).
2. **Identity:**
   - families are stable, brand-owned configuration namespaces;
   - internal `UNIQUE (brand_id, code)`, portable `(brand_marchio, family_code)`;
   - definitions are seed/manual only, and groupers never create them;
   - a shipped family code and its axis set are a compatibility contract, never silently repurposed.
3. **Membership:**
   - a separate singular relation `cat_product_family_assignment` replaces `cat_product.family_id`/`family_source`;
   - at most one current family per product;
   - states: `grouper`, protected `manual`, protected `manual_excluded`, and absent (unassigned);
   - delisting never deletes membership; manual states survive regrouping and imports.
4. **Values and uniqueness:**
   - axes reference `cat_attribute`, and values come from `cat_product_attribute` without duplication;
   - every member has one value per axis;
   - complete tuples are unique across all members, including delisted ones.
5. **Resolution:**
   - works on actual members only, never a Cartesian product, so sparse grids are supported;
   - availability is reported, not decided;
   - `is_listed` means current catalogue presence, not proven orderability, and unknown lifecycle codes (e.g. `9`) are given no semantics.
6. **Validation:** derived and read-only, with no persistent review rows (the `variant_conflict` review kind is removed).
7. **Mechanism:** a per-brand **grouper** behind a generic interface, with deterministic, anchored rules and product-local decisions.
8. **Lifecycle of families:** retired/split/merged relationships may be recorded; existing `.lqp` snapshots are never silently rewritten.
9. **The compact 1P+N BTI groups** (`FA881…`, `FN881…`, `FC881…`) are separate 6A families with neutral codes (`…_1pn_881`). Their one-module width is **not** claimed as verified. A future physical model may justify a deliberate family migration.
10. **6A excludes:** DC products, magnetic-only products, RCBO/RCCB/BDA/AFDD, accessories, and `din_modules`/physical modelling.

Superseded: the rev-5 sketch of `cat_product.family_id`/`family_source`, `cat_product_family.source = 'parser'`, and "conflicts go into the review queue".

### Revision 7: Step 7A project metadata and persistent quotation (2026-09-22)

Step 7A materializes the first `.lqp` format without changing D8–D11. The additive
`prj_project` fields and type/norm constraint are defined in §7.6. Creation uses a
native destination chooser retained by main; the renderer receives a one-use opaque
token and a display-only filename. Editing occurs in an application-owned working copy;
Save writes and validates a closed single-file SQLite document; Open validates the
application id, migration prefix, metadata and generated schema manifest before copying rows
with explicit columns into a fresh `1..k` working schema and migrating it to current. Catalogue additions persist a
portable `(brand_marchio, manufacturer_code)` snapshot and never persist
`cat_product.id`. Dirty close and save-conflict paths preserve the working copy plus recovery
metadata and support explicit discard. The startup recovery offer, dirty-close confirmation and
Save As are implemented (§7.3). Recenti, duplication, numbering and advanced customer management
remain deferred with the later Step-7 features listed in §15.

### Revision 8: configured items, physical containment and BTicino engineering data (2026-09-23)

The supervisor requested this revision after reviewing the architecture proposal of 2026-09-23. It incorporates the product-owner correction of the same day. It rests on a read-only analysis of the full supplied BTicino sources (§1, §9.3).

1. **Configuration models** (`cat_config_*`, §5.6) are a generic layer beside the unchanged product families.
   - Effects hang on rules (AND of options): articles, profile-key deltas, profile overrides, demand deltas, budget use.
   - Source templates are expanded at import.
   - Article references are resolved against `cat_product` after every METEL import.
   - The configuration fingerprint is the effective configuration identity.
2. **Accessories.**
   - Accessories that change the BOM or the physical state are configuration options.
   - Stand-alone accessories are `accessory` models.
   - The revision-7 family-relation sketch (`cat_family_relation`, `cat_family_relation_condition`) is withdrawn as the accessory mechanism; product-level relations remain for succession and kits (answers Q11).
3. **Physical state belongs to the configured item** (§5.8).
   - It is described by physical profiles with integer capacity kinds (DIN in half-modules), orientation views, zones (`linear`, `stack`, `slots`), fit classes and parent/ancestor accept sets.
   - `cat_product_physical` is article-level only.
   - The revision-7 sketch (`cat_mounting_type`, `cat_product_asset`, `din_modules` "per product, never per family" as the placement rule) is withdrawn.
4. **Assets** (§5.9).
   - They are addressed by logical key in a licensed store; parametric rendering is the baseline.
   - `.lqp` files embed only assets whose license allows it.
   - Use of BTicino drawings waits for Q14.
5. **Engineering-source imports** (§5.10, §9.3).
   - They ingest the full supported dataset, with provenance, conflicts and an explicit skipped-record report.
   - The archived source file is the raw layer, and `lq.db` stays independent of it (D3).
   - Prices come only from METEL.
6. **`.lqp` format 2** (§7.6, §7.11).
   - It adds `prj_item*`, a recursive `prj_node` tree, `item` quotation lines (with `prj_line` rebuilt) and `prj_asset`.
   - `prj_product_snapshot` is unchanged and remains one row per article; its planned physical/asset columns are withdrawn.
   - `prj_panel`, `prj_panel_row` and `prj_placement` are withdrawn in favour of recursive containment. TiQuadri's own project files use a recursive group tree too (§1).
7. **Container binding**: `match_container` remains available in the generic model; the TiQuadri adapter does not emit it from `Test_Compatibilita_Contenuto` (Q13).
8. **Product-owner correction** (§15):
   - no scope-limited import, no demo database, no hard-coded articles;
   - Friday 2026-09-25 is the deadline for the full end-to-end workflow on the full supported dataset;
   - thermal calculation, TiSystem, unverified semantics and licensed drawings stay deferred.

Superseded:

- the revision-7 family relations as the accessory engine (§5.6);
- the revision-7 physical/asset sketch (§5.8);
- the `prj_product_snapshot` physical/asset columns and the `prj_panel*` placeholder of revision-7 §7.6;
- step 9 "panel metadata for the BTicino demo range" of revision-7 §15.

### Revision 8.1: manufacturer catalogue navigation (2026-09-23)

This amendment follows the product owner's direction of 2026-09-23, which was given after a read-only investigation of the TiQuadri, ListinoBT and METEL taxonomies (§5.11). It adds §5.11 and amends the browse-tree rows of §5.6 and §9.3. It also adds one line each to §12.2, §14 and §15, and extends Q14. Nothing else in revision 8 changes.

**Confirmed:**

1. **Navigation source.** For BTicino, the catalogue exposes TiQuadri's navigation where TiQuadri provides it. For Apparecchi: Gamma → Tipologia → Famiglia → Modello → Articolo.
2. **Terminology:**
   - G1 → Gamma;
   - Apparecchi G2/G3 → Tipologia;
   - TiQuadri class → "Famiglia", in the UI only;
   - pacchetto → Modello (`cat_config_model`, no duplicate concept);
   - SKU → Articolo.

   `cat_product_family` is unchanged and is not the UI "Famiglia".
3. **Articles outside TiQuadri** are navigated by METEL statistical family. The rules:
   - no inference from FST neighbours;
   - no SKU-by-SKU classification as the primary solution;
   - an article may have several positions;
   - configuration-only accessories stay with their models.
4. **Corrected TiQuadri browse-tree import** (§5.11):
   - no duplicated leaf level; one node per source level;
   - obsolete branches hidden;
   - orphan ranges resolved through `ANA_SISTEMA` and non-navigable;
   - range 99999 internal;
   - provenance kept;
   - no runtime dependency on TiQuadri.
5. **Carpenterie and Pannelli** keep their own level semantics (dimensions and context in G2/G3). The UI does not label them "Tipologia".
6. **Context fields** (`Armadi_Compatibili` and related) are not applied (Q25).

**Q27 storage approved and merged on main:**

- structural node kinds, `navigable`, and `level_code` with a seed vocabulary;
- METEL-derived FST nodes linked to `cat_metel_family`;
- the visibility and precedence rules of §5.11.

Migration 0006 adds this storage. `cat_metel_family` alone was assessed and rejected as the navigation store (§5.11).

Superseded: the Step 9.2 browse-tree projection, i.e. the synthetic `range` node per leaf and orphan ranges at the root.

**Product-owner clarification (2026-09-24):** Catalogo remains the complete article catalogue, and Carpenterie/Pannelli engineering navigation is not shown in it, independently of Q25. Progettazione selects `enclosure`, `support` and `device` models from the normalized engineering model, not METEL articles. Enclosure and support models do not make an article configurable from Catalogo. No article-level catalogue classification is introduced (§5.6, §5.11). Q25, Q26 and Q28 are re-scoped to Progettazione.

### Revision 8.2: LibreQuadri Apparecchi categories and Catalogo selectable packages (2026-09-25)

This amendment follows the product owner's decisions of 2026-09-25. It amends §5.11 only.

**Confirmed:**

1. **LibreQuadri categories.** Ten Project-maintained categories group the BTicino Apparecchi Gammas, as approved by the product owner. The approved additions after the audit are Megatiker M3-160 → Interruttori scatolati and Apparecchi Datacom → Automazione.
   - The mapping is seed data consumed by the TiQuadri adapter, and every member is verified against the source.
   - Generic runtime code has no manufacturer logic.
2. **Presentation.**
   - Hierarchy names are shown without level prefixes.
   - Article rows show the description as primary text and the brand/code as secondary text.
   - Package rows show the model name.
3. **Selectable packages.** Catalogo exposes normalized configuration models without a primary article when they resolve to linked catalogue articles.
   - They are configured inline in the Catalogo inspector with the generic resolver and added through configured-item insertion.
   - No primary article, article identity or package price is invented.
   - Models without source article rows, or whose references cannot be linked to METEL, are not selectable packages.

Superseded: "configuration models without a primary article are not synthesized into browse rows" (Catalogo boundary of 2026-09-24).

### Open questions (not blocking the start of implementation)

1. Confirm the v021 trailing-field layout (Electrocod?) and obtain the official decode tables for stato prodotto / lead time. Until then, codes are stored raw. Needed before step 4 uses Electrocod mapping.
2. The form in which purchase discount conditions arrive. Needed at step 7; manual entry works regardless.
3. Whether Legrand, Zucchini, Cablofil and IMS (inside the BTicino file) are active brands from day one. This is a data flag and can be changed at any time.
4. User-defined project numbering conventions. Needed only when numbering is automated; the field is free text until then.
5. Confirm with the METEL specification that marchio sigle are globally unique, as assumed in §5.1 (`cat_brand.metel_marchio UNIQUE`).
6. Verify during implementation that better-sqlite3 enables SQLite defensive mode by default (§7.9 step 2). If it does not, enable it explicitly.
7. Confirm the exact official FSC/FST family-code field width against the METEL tracciato. The supplied BTI, SIE and SNR files require columns 7–24 (18 characters), and the parser follows those observed files until the official definition is available.
8. **Lifecycle code semantics** (part of question 1), e.g. `9`, which is present on two Step-6A members. Until decoded, family availability reports the raw code and never claims confirmed orderability.
9. **Physical nature of the BTI `…881` 1P+N products** (`FA881…`, `FN881…`): are they one-module devices? **Answered (rev 8):** yes. `FN881C16` is 1 module in ListinoBT, and TiQuadri's profile "1P+N 1Mod" is 2 poli. No family migration is needed.
10. **Product succession inside a family.** Tuples are unique across delisted members too. A manufacturer re-coding a variant with identical axis values therefore makes a conflict that must be resolved explicitly (e.g. `manual_excluded` on the old SKU, or a `replaced_by` relation). The preferred procedure is to be decided when the first real succession occurs.
11. **Accessory compatibility scope** (§5.6) versus configurable-family granularity. **Answered (rev 8):** the scope is the configuration model. Accessories are options of the model they attach to; `cat_family_relation` is withdrawn.
12. **Format of recorded family successor relationships** (retire/split/merge), if and when they are needed.

Added by revision 8:

13. **TiQuadri linkage and context flags.**
    - The flags are `Test_Compatibilita_Contenuto`, `Segue_Modalita_Pannello`, `Modalita_x_Modificabile_Nel_Pannello` and `ID_Macrofamiglia_Armadi_1..5`. The TiQuadri adapter reports `Test_Compatibilita_Contenuto` as known but unapplied: the source executable's sole field reference appears beside text about preventing modification of a characteristic, not a placement rejection. Adapter version 8 removes its provisional `match_container` mapping. The approved Carpenteria Stage 1 / adapter 11 imports the two `Modificabile_Nel_Pannello` fields into the existing generic axis editability, requiring permission from all contributing rows; mixed axes remain locked and are recorded as conflicts. This is import metadata only, with no reconfiguration backend/UI or persistence change. The other flags remain unapplied. See [adapter lifecycle](ENGINEERING_ADAPTER_LIFECYCLE.md).
    - Needed before `inherit_container` (automatic Easy Tifast / comb BOM on devices) and context availability are enabled.
    - To close it: black-box tests in TiQuadri, or BTicino documentation.
14. **Rights.** Can the TiQuadri/ListinoBT data be used inside LibreQuadri, and can the WMF/DXF drawings be displayed, converted or embedded? The design keeps imports per installation, from user-supplied files, and keeps drawings optional. Revision 8.1: this also covers showing TiQuadri's navigation names and structure, and ListinoBT's family labels, in LibreQuadri's catalogue (§5.11).
15. **Stability of TiQuadri IDs** (pack, label, value, family, block) across releases. The `tq.*` codes are compatibility contracts. To verify with a second TiQuadri release; meanwhile `definition_fingerprint` exposes any drift.
16. **Orientation and stacking semantics**: the rotation direction of `Ruotato_1/2` and the symbol orientation; stack margins and alignment rules beyond `Passo`.
17. **Brand prefix mapping.**
    - `IM-` → METEL `IMS`, although ListinoBT says `IME`.
    - `CT-`, `HW-` and `NV-` are unmapped.
    - 10 codes are found only under another marchio.
18. **Model relations:** join kits and side panels remain data-only. Preset containment is confirmed: enclosure → ordinary support → device; device-to-enclosure compatibility is an ancestor constraint. Before adapter 7, `ASS_MACRO_CENTRALINI` X/Y was imported but `Pos_Pan_XY_assoluti` was discarded (the former Q18 wording incorrectly implied otherwise). Adapter 7 preserves that distinction as fixed/packed, and leaves relative rows with an offset (panel-level Flatwall presets) unknown. See the candidate architecture below; unresolved SDX commercial choices and Flatwall nesting remain deferred.
19. **The 17 module-count disagreements** between TiQuadri effective profiles and ListinoBT: which source is right?
20. **Unresolved source semantics:**
    - the unit of the "Strumenti" demand (value 75 on 2 profiles);
    - the 14 mixed-kind panels;
    - the 6 slot panels without insertion points.
21. **MDB reader.** Choice and verification of a pure-JS reader: Jet4 booleans stored as −1, memo fields, the 45 MB file, speed. Also needs dependency approval.
22. **Quantity model. ANSWERED / CONFIRMED by the product owner (2026-09-24); implemented.**
    - One configured item (`prj_item`) has exactly one quotation line (`prj_line`, type `item`) with an integer quantity Q.
    - The BOM stays per unit in the configured snapshot (`prj_item_bom.quantity_per_item`); the quotation and the Distinta multiply by Q.
    - Physical `prj_node` instances are individual placements. The number of placed nodes P must satisfy P ≤ Q. The Q − P unplaced units are not materialized separately.
    - Decreasing the quantity below P is refused. Removing a configured line with placed instances is refused.
    - Adding an identical configuration increases the existing line's quantity instead of duplicating the configured snapshot. A genuinely different configuration (a different fingerprint) remains a separate item and line.
    - Reconfiguring already placed quantities remains a later question.
23. **Configurator UX**: family navigation (poles/curve/In) vs the model's primary-selecting axis.
24. **Deferred checks:**
    - the depth check between device depth and enclosure usable depth: the depths are imported, but the rule is not established;
    - the TiQuadri project warnings (`QUADRI_WARNING`): not imported.

Added by revision 8.1 (§5.11):

25. **Context behaviour of the TiQuadri browse tree (Progettazione).**
    - The fields: `GERARCHIA.Armadi_Compatibili` (the enclosure families for which a node is shown), `GERARCHIA.ID_Macrofamiglia_Armadi`, and `ANA_CLASSE.Classe_Visibile_Senza_Struttura`. The last is 0 for 371 Carpenterie classes and all 525 Pannelli classes, which TiQuadri shows only when a structure is in context.
    - Revision 8.3 resolves the model-context foundation: `Armadi_Compatibili` is imported as accepted contexts, and enclosure `Famiglia_Armadi` as provided context. `ID_Macrofamiglia_Armadi` and `Classe_Visibile_Senza_Struttura` remain unapplied. The Progettazione picker UI is still pending.
    - Apparecchi can be browsed without context. Pannelli cannot: 25 groups of same-named siblings differ only in `Armadi_Compatibili`.
    - Carpenterie/Pannelli navigation is not shown in Catalogo. Q25 concerns Progettazione discovery. Physical compatibility alone offers 210 supports for MDX800 pack 343; physical plus root context offers 114. Packs 848, 851 and 854 share `tq.pan.6311`, but only 851 accepts MDX800's context 50. Pack 848 has a different BOM and is rejected with `required_context_not_provided`.
26. **Level labels outside Apparecchi (Progettazione).** This covers:
    - the Sezione level;
    - Carpenterie and Pannelli G2/G3 (height, depth, panel type);
    - whether "Gamma" suits Pannelli G1, which is a width (e.g. "Larghezza 850 mm").

    These levels are not shown in Catalogo; the question applies where Progettazione displays the engineering tree. Until decided, those levels show node names without a level label.
27. **Answered and approved: storage for the navigation amendment.** This covers:
    - the structural `cat_range_node` changes, `cat_range_level`, `cat_range_source_level_map` and `cat_range_node_metel_family`;
    - the provenance of METEL-derived nodes;
    - where the source-level → display-level map lives;
    - the FST middle level remains absent because its label depends on Q14 and the deferred ListinoBT adapter.

    Supervisor approval was given; migration 0006 and the source-level seed are merged on main. Q25 and Q28 are resolved for the Revision 8.3 foundation; Q26 and Q29 remain open.
28. **Orphan ranges (Progettazione): answered for normal structural discovery.** The 43 `ANA_SISTEMA` ranges are retained for provenance but have `design_navigable=0`, as do their orphan class nodes and range 99999. Normal structural discovery does not expose them. Carpenterie includes 31 orphan ranges and 1,054 active packs; this decision does not delete those models or change standalone Configura.
29. **Cross-brand Gamme in the BTicino engineering tree.** Legrand (KNX, CTX3, cabling racks), IME and Cablofil articles are primary articles of BTicino-tree models. Where the engineering tree is presented (the catalogue-navigable Apparecchi tree and Progettazione), should those Gamme be shown with their own brand, as proposed, or filtered out? This does not decide whether those brands' METEL articles appear in Catalogo: they always do, through the FST tree. Revision 8.4 classifies and filters these articles like any other TiQuadri primary, whatever Q29 decides about presentation.
30. **Revision 8.4 category display names (product decision).** The proposed new category codes are listed in revision 8.4 §A.7, derived from TiQuadri Tipologie and BTicino catalogue terms. The product owner confirms their Italian display names and whether any should be merged. Codes are a compatibility contract once shipped.
31. **Revision 8.4 number-facet presentation: answered (supervisor, 2026-10-19).** Filter definitions and options stay visible through the hierarchy; unavailable options are greyed, never removed. Revision 8.4 §A.5 keeps this behaviour and adds only a banded, scrollable presentation with "Vai a…" and a range helper. No product decision remains open.

### Revision 8.3: engineering context foundation (2026-09-25)

- Migration 0008 adds `cat_config_context` (`brand_id`, opaque `code`, `name`, `active`, `source`, optional import provenance, unique brand/code), `cat_config_model_context` (model, role `provides`/`accepts`, context, indexed by context/role/model), `cat_config_model.context_policy` (`unknown`, `unrestricted`, `restricted`; default `unknown`) and `cat_range_node.design_navigable` (default 0). Existing models and nodes keep those defaults until re-import. The context vocabulary is separate from physical fit classes.
- Only the root enclosure model of a `prj_node` containment tree provides applicable contexts. Intermediate models' `provides` rows are ignored. A restricted candidate requires an intersection between its `accepts` rows and the root's `provides` rows; unrestricted candidates have no context limit; a root candidate has no context check. Physical profile constraints are checked independently against the direct container and ancestor class snapshots, with one shared pure predicate used by placement and design guards. Offer mode checks the base profile; add mode checks the resolved option profile.
- TiQuadri adapter version 5 imports enclosure `Famiglia_Armadi` as opaque `tq.ctx.<n>` provider codes and the union of `GERARCHIA.Armadi_Compatibili` for real assignments as accepted codes on non-enclosures. Empty, orphan-only and 99999 non-enclosure assignments remain restricted with zero accepts. Imported context rows and links are replaced or deactivated on re-import; manual models and vocabulary rows are protected. The model definition fingerprint formula is unchanged. `EngineeringDataWriter.finishImport` rejects an upserted import model left at `unknown`; adapters without contexts must explicitly set `unrestricted`.
- An imported `unknown` root or physically eligible candidate makes design discovery return `engineering_data_stale` with relevant import IDs and no partial candidates. A manual `unknown` root makes the container unavailable; a manual `unknown` candidate is withheld and counted. Only the root needs a matching local model and definition fingerprint. Intermediate project models may be absent locally because their snapshotted physical classes are authoritative.
- Genuine GERARCHIA paths have `design_navigable=1`; orphan and internal paths, FST nodes and migration defaults have 0. This does not change Catalogo `navigable` or standalone Configura. No IPC or renderer picker is included. Context is local discovery/add-time data; `.lqp` format, manifest and offline placement/move/render behavior are unchanged.
- **v32 acceptance:** 44 context classes; **3 with no provider at all** (`tq.ctx.110`, `.130`, `.150`); **8 with no active provider**. The other five (`tq.ctx.200`, `.220`, `.460`, `.461`, `.494`) have providers, but every provider model is obsolete. There are 801 providing enclosure packs, 8,470 accepting packs and 44,157 accepted-context rows. MDX800 pack 343 has 210 physically compatible supports and 114 after context; shared profile `tq.pan.6311` yields only pack 851. Pack 848 is rejected with `required_context_not_provided`.


### Generic preset supports — candidate architecture (2026-10-01)

- **Containment is unchanged.** TiQuadri creates the supports listed for a parent pack (`ASS_MACRO_CENTRALINI`) as ordinary Pannelli: enclosure → support → device. There is no device → enclosure placement; device-to-enclosure compatibility stays an `ancestor` constraint. Presets carry no per-instance ownership, lock or `.lqp` state (verified against TiQuadri's executable: only the panel model's centralino flag and order-bound drawing differ).
- **Normalized relation.** Additive catalogue migration `0010_high_maginty` adds nullable `cat_config_model_relation.placement_mode` (`fixed` / `packed`). Parent and child model, sequence, quantity and X/Y are kept. `NULL` means unknown semantics (including pre-migration rows) and never creates anything. Non-preset relations have no mode.
- **Adapter 7** numbers occurrences per parent in source `Ordine` order. An absolute source row (`Pos_Pan_XY_assoluti`) is `fixed`. A relative row without offset is `packed` (enclosure-level SDX rows: X = Y = 0, heights filling the usable height). A relative row with an offset is positioned inside a parent panel (Flatwall) by semantics LibreQuadri does not model: it stays `NULL` and is reported as `preset_relative_offset_unresolved` (131 in v32). v32: 1,225 occurrences = 1,001 fixed + 93 packed + 131 unknown.
- **Fixed geometry.** For an enclosure whose presets are all fixed, every imported block variant gets a `slots` zone instead of its stack zone: slot N is the anchor of occurrence N, with the exact source X/Y measured from the enclosure frame's top-left (the drawing's window openings coincide with these anchors). A child is positioned as `parent + slot − view insertion offset`, as for any slot zone. Packed enclosures keep their stack zone.
- **Definition identity.** A model's definition fingerprint is unchanged unless the pack has preset rows; for preset parents the ordered source rows are appended. Projects that snapshotted any other model (e.g. MDX800 343) therefore keep a matching identity after re-import and stay eligible for catalogue-backed discovery under existing roots. Preset parents change identity because their placement surface and creation behaviour changed (345 parents in v32). Re-import is required; nothing is enriched on open.
- **Creation.** `addStructural` for an enclosure applies its preset relations inside the same project transaction, in sequence order, all or nothing. Every occurrence is first checked: supported mode and quantity, a complete default configuration of an active support (no default is invented), no nested presets, the ordinary design guard (physical class, context, navigation), matching slot/stack geometry and view. Only if every occurrence passes are the children created — fixed ones with `placeChild` on slot N, packed ones with `insertPackedChild` — inside one savepoint; an expected placement refusal discards every child, quantity and snapshot. Otherwise the parent is added alone. Unexpected failures roll back the parent as well. Identical children share one configured item whose quantity counts the occurrences (Q22); nodes have distinct UUIDs.
- **Diagnostics.** The creation response (`presetDiagnostics`, not persisted) lists every occurrence: `instantiated` with its node UUID, or `withheld` with a specific code (`unsupported_preset_semantics`, `preset_configuration_unresolved` with resolver issues, `nested_presets_unsupported`, a guard code such as `incompatible_parent`, `preset_geometry_unresolved`, `preset_view_unavailable`) or `preset_set_incomplete` for an otherwise valid occurrence of an incomplete set.
- **v32 outcome** over all 259 active preset enclosures: 55 complete sets (Linea SPACE/WALL/HABITA, Idroboard, Calotte), 116 enclosures added without presets (SDX/P17/MARINA defaults unresolved, QDSA/Plexo3 class anomalies), 88 orphan CEE enclosures not addable because they resolve `bom_incomplete` exactly as before; no partial structure.
- **Physical-only classification.** The reviewed seed approves, besides 1778, exactly twelve DIN windows (2189–2194, 2196, 2898–2902): centralino supports with a DIN zone, no modality definition, no base or modality article rows and no drawing, needed by the complete sets above. Article-free 1283 and 2195 and all other windows stay `articles` (see `db/seed/README.md`). Raw article rows or a renamed identity are a classification conflict.
- **Project and lifecycle.** `.lqp` format 5 already snapshots slots, zones, views, configurations, context and nodes; there is no project migration, format bump or ownership column. Opening, saving and parent reconfiguration never create or rebuild presets. Preset supports follow ordinary support operations (unplace, move, removal with the root).
- **Rendering and Distinta.** Progettazione shows the returned tree and focuses the new enclosure while keeping the Carpenterie tab selected for ordinary cabinet additions; device discovery derives the Pannello as before. Explicit `symbol_kind='mounting_guide'` views draw transparent dashed editor footprints and omit their graphics from PDF; `physical_panel` views retain their vector artwork or use solid printable fallbacks. Geometry and support descendants remain unchanged. Other/legacy symbol kinds retain historical missing-artwork rendering until explicit engineering refresh. TiQuadri adapter 10 designates only the reviewed Idroboard guides; neither missing artwork, DIN type nor commercial contribution alone designates a guide. `none` supports have no articles, BOM rows, prices or Distinta rows; commercial children keep their articles.

### Revision 8.4 (APPROVED, Stage A): TiQuadri engineering-derived classification and technical filters (2026-10-16)

**Status: Stage A approved and merged to `main` at `0e049e3`; Stage B is in `main` at `3f4a3d5`. Stages C, D, E and F are implemented together on the integration branch `review/tiquadri-cdef-integrated` (from the supervisor-reviewed Stage C commit `45ebdf9`, with Stage F `42c780c` merged and corrected), pending final review; see A.9. §16 Q30 (Italian category names) OPEN.** Stage B adds the A.3 foundation migration, including the four package-offer tables, reviewed Taratura seed, generic classification and derivation, provenance, diagnostics and lifecycle synchronization. Package-offer computation and filtering, the remaining model facts and technical-filter UI are future stages. There is no `.lqp` format change. The scope is the supported BTicino TiQuadri Apparecchi catalogue only; no other manufacturer is implemented. Generic classification and enrichment remain source-neutral; BTicino knowledge lives in the TiQuadri adapter and reviewed seed.

#### A.1 Evidence base

Read-only analysis on main `d55e07b`: a copy of the Development `lq.db` (TiQuadri adapter 11, BTQUADRI v32 dated 2025-05-28), a scratch SQLite conversion of `BTQUADRI.mdb`, static strings of `Tiquadri.exe`, and BTicino catalogue datasheets. TiQuadri's UI was not driven interactively.

- **Catalogue shape.**
  - The 10 LibreQuadri Apparecchi groups hold 1,299 active device models and **2,273 distinct primary articles**.
  - Of the 193 active model-only device models, **160 are Catalogo selectable packages**: Fusibili 45, Prese industriali 39, Dispositivi modulari 42, Contattori 18, Automazione 8, Interruttori scatolati 3, Trasformatori 3, Dispositivi a pannello 2.
  - At the Stage A audit, 872 products carried a category, all through 13 verified METEL `STATISTICA` rules. 784 of the 2,273 had attributes (Btdin ranges only). Every other group had 0 categories and 0 attributes. The facets of `browseCatalogue` were therefore greyed with zero counts.
- **How an article is selected.** `cat_config_model_entry` is the only article ↔ model ↔ option relationship.
  - Taratura (`tq.label.51`) selects 3,166 entries (1,943 articles, 714 models).
  - 368 models have a single fixed primary (276 articles, `option_id` NULL).
  - Six other dimensions select 73 entries.
  - `cat_config_axis.selects_primary` is **not** this relationship. The adapter sets it on every axis of a templated pack (`tiquadri/import.ts`, `makeOption`). 3,979 device axes carry it without selecting any entry.
- **Independent check.** `ART_TISYSTEM` (article code → pack and option value) agrees with 2,454 of 2,466 overlapping entries, and with 96/96 for the M2-250 Magnetotermici regression example.
- **Structured characteristics.**
  - TiQuadri stores no structured poles, breaking capacity, curve, Idn, Ics, Icw or trip-unit data. `ANA_PACK` has no electrical columns, and `Help_modalita_*` is the placeholder "Help".
  - The only structured electrical value is the selecting option value. Its labels are not uniform: Taratura has 171 values, 139 of them used by active devices.
    - 56 are single-number "n A" (1,733 historical article links); 12 of these occur only in contactor packages and represent operational current, not In. Of the remaining 44, some stable values are also reused by contactors and are gated by category applicability.
    - 47 combine In and residual type, e.g. "40 A - Tipo "A"" (237 articles). AC, A and F values coexist in one pack: pack "Differenziale puro 30mA - 2 Poli" selects G723A25, G723AC25 and G723F63.
    - 37 are motor setting ranges: 22 "S:"/"H:" values (22 active article links) and 15 bare ranges such as "1 - 1,6 A" (obsolete Salvamotore pack 1720, no active article links). The earlier count of 71 plain values incorrectly included these 15 bare ranges.
    - 21 are fuse ratings "n A - Tipo gG" (packages only).
    - 10 are magnetic thresholds "Magn.800A" (no articles).
    - Contactor packages use the same plain values for operational current (pack 2298 "Contattori 16-125A 2 Poli").
- **Name-encoded characteristics.** Pack names encode poles, kA, curve and Idn in one TiQuadri-wide vocabulary.
  - A generic probe yields one value per article for:
    - poles: 1,944;
    - In: 1,915, plus 6 conflicts;
    - kA: 968;
    - curve: 536;
    - Idn: 239;
    - residual type: 237.
  - Where the verified `bti.description` parser also has a value, they agree **without exception**: poles 784/784, In 756/756, curve 522/522, Idn 230/230, type 221/221.
  - Pack-name poles agree with `Descri_Modalita` and the apparatus-profile description for 454 of 457 scatolati packs. The 3 exceptions are DC "2P CC" switch-disconnectors built on 4P frames.
  - "kA" means Icn in modular names (Stop Arc 4.5/6 kA) and Icu in MCCB/ACB names.
- **Assemblies.** Some packs describe a configured assembly, not their primary article.
  - Btdin "Magnetot. Diff." packs (e.g. pack 4379) select a plain MCB (FH84C10) and add the residual block through the non-selecting `Modulo Diff.` axis.
  - M4 "Magnetot. Diff." packs select T744F250 plus a module.
  - M1-160 "Differenziale" packs select an article with integrated residual protection (T714B100D).
  - 357 modular MCBs and 50 MCCBs are reached through both a plain and a residual Tipologia.
- **Source defects.**
  - Packs 20210–20212 ("M3-160…", Taratura "160 A") expand to T7304x125, giving 6 In conflicts.
  - Pack 20212 (H, 70 kA) sits in class "M3-160F 36kA". The adapter already reports 62 class-name copy disagreements.
  - 319 article references are not in METEL.
  - "320mA" in KNX power-supply names (003506/003507) is output current, not Idn.
- **Manufacturer datasheets** (catalogo.bticino.it, CEI EN 60947-2 or 60898/61009). In and breaking capacity agree with TiQuadri for:
  - T724B40E: 4P / 40 A / Icu 25 kA;
  - T724F160E: 4P / 160 A / Icu 36 kA;
  - T723H250MT: 3P / 250 A / Icu 70 kA;
  - T744F250: 4P / 250 A / Icu 36 kA;
  - T804B1000: 4P / 1000 A / Icu 42 kA;
  - T714B100D: 100 A / Icu 25 kA, "Poli 3P+N/2", Idn 0.03–0.3–1–3 A;
  - T7MP23F100: In 100 A, "Ii=1000-1600A";
  - T723S250 (switch-disconnector): "In=250A";
  - GN8843A16: 4P / 16 A / **Icn** 6 kA / type A / Idn 30 mA / curve C.

  BTicino labels modular devices "Potere di interruzione Icn" and MCCB/ACB "Potere di interruzione Icu".

#### A.2 Decisions

1. **Safe article classification (mixed METEL families).**
   - **Evidence.** 8 of the 32 METEL statistical families that hold TiQuadri device primaries mix product functions:
     - Megatiker M1–M5 (IND.-112-37-143…147): breakers, integrated-residual breakers, magnetic-only breakers and switch-disconnectors;
     - Megabreak (IND.-112-36-140): breakers and switch-disconnectors;
     - both Stop Arc families: AFDD+MCB and AFDD+RCBO.

     A naive Tipologia → category map leaves 413 articles with conflicting categories. Letting assembly models contribute only their primary's category leaves **0 conflicts**: 1,928 articles get one category, and existing METEL categories agree for 780/784. The 4 differences are Stop Arc, where METEL's AFDD category is more specific.
   - **Decision.**
     - `STATISTICA` rules are created only for families verified to hold one function. No rule is added for the 8 mixed families.
     - Engineering models get a reviewed **contributed category**: the category of the articles a model selects, or of the package itself for a model-only package. Assembly models contribute their primary's category, never the assembly's.
     - The classifier gains an **engineering tier** after `STATISTICA` exact/prefix and before `CODE_PREFIX`/`DESCRIPTION` and `SCONTO`. An article gets the engineering category only when **every** active device model selecting it contributes the same category. Otherwise the tier is silent and a diagnostic is recorded.
     - A disagreement with a higher METEL tier keeps METEL and records a diagnostic. After review, the 4 Stop Arc models contribute `rilevatori_arco`, so 0 disagreements are expected.
     - Manual product decisions stay first.
2. **Reusing the existing configuration-attribute columns.**
   - **`cat_config_dimension.attribute_id`, `cat_config_dimension_value.attribute_option_id` / `value_num`: not reused (left NULL, documented as superseded).** Three reasons:
     1. A dimension does not have one meaning. Taratura carries In, In + residual type, motor setting ranges, magnetic thresholds and fuse ratings.
     2. One value can carry two attributes (47 values, 237 articles), and the type cannot come from the pack, because AC, A and F coexist in one pack.
     3. The columns sit on adapter-owned `source='import'` rows and have no provenance of their own. A protected manual mapping would require turning the whole imported row `manual`, which freezes its imported name and activity on reimport (`engineering-writer.ts`, `upsertDimension`/`upsertValue`).
   - **`cat_config_model.category_id`: reused** for the contributed category. The adapter never writes it: `upsertModel` updates every other column and keeps the row ID by `(brand_id, code)`. It gains one additive column, `category_source` (`unmapped`/`seed`/`manual`), so manual decisions are protected.
   - **New tables are required for the two relations that have no home.** A value can mean several attribute values (`cat_config_value_attribute`). A model can hold several facts that are true of every article it selects (`cat_config_model_attribute`). Both carry their own `source`, are keyed to IDs that survive reimport, and are never written by the adapter.
3. **One filtering contract for articles and packages (corrected 2026-10-19: feasible configurations only).**
   - **Result items** are articles (`cat_product`) and selectable packages (the existing `SELECTABLE_PACKAGE_SQL` set).
     - An article's category is `cat_product.category_id`. Its values are the single stored values in `cat_product_attribute`.
     - A package's category is `cat_config_model.category_id`. Its values are **feasible offers**. An offer is the complete set of attribute values produced by **one** configuration that the existing add predicate accepts (A.4 "Package offers"). Values from different axes are never combined unless one resolved, addable configuration produced them together.
   - **Filters** are OR within an attribute and AND across attributes.
     - An article matches when its stored value is selected.
     - A package matches when **at least one feasible offer satisfies every active attribute filter at once**.
     - A package without a proven-feasible offer for the filtered values never matches an attribute filter. This covers no feasible offer at all and feasibility that cannot be decided within the bound. Such a package is still listed when no attribute filter is active, as today.
     - Impossible or unproven combinations are never counted.
     - A package whose undecided candidate could satisfy the active filters is not silently dropped. It is listed in a separate "Non valutabili con questi filtri" group (A.5), outside the matches and the counts.
   - **Facet counts** count result items: matching articles plus matching packages.
     - For a package, the count of value *v* of attribute *X* includes it when one offer has *X = v* and satisfies all other active filters. This is the same disjunctive rule as for articles.
     - The browse result keeps `totalCount` (articles) and `packageCount` (packages). `packageCount` is now filtered by attributes too, instead of being dropped whenever an attribute filter is set.
   - **Applicability and universe** follow the existing persistent-facet rules (definitions and options stay visible through the hierarchy; unavailable options are greyed), extended to include package offers.
   - Brand, text search and configurability semantics are unchanged.
4. **Article-intrinsic vs assembly-dependent characteristics.**
   - An article receives only:
     1. the mapped values of **its own entry option** (`cat_config_model_entry.option_id`, never the `selects_primary` flag);
     2. the facts of the selecting model, each of which must be true of every article that model can select.
   - Values of non-selecting axes (`Modulo Diff.`, `Tipo differenziale`, `Toroide`, `Con T.A.`, coils, contacts) describe the configured item. They never reach an article; they appear only as package offers. Example: FH84C10 is reached through a Btdin residual pack but gets no residual values.
   - Model facts of assembly packs are reviewed to exclude assembly characteristics. The generator flags any model whose non-selecting axes add articles.
5. **Electrical semantics.** See A.6. Summary:
   - poles: `4p` for 4-pole MCCB/ACB, including "N/2" neutrals. `1p_n`/`3p_n` keep the modular "protected poles + switched neutral" meaning.
   - `rated_current` is the catalogued In, never Im/Ii, a setting range or a contactor operational current.
   - Icn stays `declared_breaking_capacity` (modular only). Icu is the new `rated_ultimate_breaking_capacity` (MCCB/ACB), at the AC reference voltage of the manufacturer's designation (BTicino 400/415 V). Neither is filled for DC devices without DC-specific evidence.
   - Ics, Icw, Ue, Ii and adjustable Idn are not modelled: there is no TiQuadri source.
6. **Synchronization, protected overrides, conflicts and reimport.** See A.4. Summary:
   - The seed is resolved by stable source codes, with exact reviewed-name checks.
   - Derivation runs after every engineering import or sync, inside its transaction.
   - Ownership (corrected 2026-10-19):
     - The adapter owns imported definitions.
     - Seed sync owns `source='seed'` vocabulary rows and `category_source='seed'`.
     - Engineering derivation owns **only** `cat_product_attribute` rows whose own `source` is the new value `engineering`. Each carries its provenance (engineering import, derivation reference). The existing parser step keeps owning `parser` rows.
     - `import_file`, `seed` and `manual` rows are never written, updated or deleted by derivation, reimport, seed removal or conflict handling.
     - Precedence: manual > seed > import_file > engineering > parser.
   - A conflict stores no value for that product/attribute.
     - It removes the **engine-owned** row there, `engineering` or `parser`, so no parser fallback survives.
     - It never touches an `import_file`, `seed` or `manual` row.
     - It is recorded in `cat_source_conflict`.
     - The exact transitions are in A.4.
   - Package offers are derived catalogue data, owned and replaced wholesale by the offer computation.
   - Projects keep their add-time attribute snapshots (`prj_product_snapshot_attribute`) and are never refreshed on open.
7. **TiQuadri-wide coverage.** Every TiQuadri device primary article and selectable package is classified, unless it is on an explicit reviewed exclusion list with reasons. Technical attributes are stored only where evidence exists. Low-data categories get a category and no technical facets (A.7).

#### A.3 Schema contract (Stage B tables implemented for review; Stage F offer computation and filtering pending)

```
ALTER TABLE cat_config_model ADD category_source TEXT NOT NULL DEFAULT 'unmapped'
  CHECK (category_source IN ('unmapped','seed','manual'));
  -- category_id (existing, never written by adapters) = contributed category:
  -- the category of the articles the model selects, or of the package itself if model-only.

ALTER TABLE cat_product ADD category_model_id INTEGER
  REFERENCES cat_config_model(id) ON DELETE SET NULL;
  -- provenance of an engineering-tier decision (category_source stays 'mapping' = automatic);
  -- exactly one of category_mapping_id / category_model_id is set for an automatic decision;
  -- agreeing models: the smallest model code is recorded (same rule as agreeing mapping rules).

CREATE TABLE cat_config_value_attribute (           -- what a configuration value means
  value_id     INTEGER NOT NULL REFERENCES cat_config_dimension_value(id) ON DELETE CASCADE,
  attribute_id INTEGER NOT NULL REFERENCES cat_attribute(id),
  value_num REAL, option_id INTEGER REFERENCES cat_attribute_option(id),
  source TEXT NOT NULL CHECK (source IN ('seed','manual')),
  PRIMARY KEY (value_id, attribute_id),
  CHECK ((value_num IS NULL) <> (option_id IS NULL)));

CREATE TABLE cat_config_model_attribute (           -- true of every article the model selects
  model_id     INTEGER NOT NULL REFERENCES cat_config_model(id) ON DELETE CASCADE,
  attribute_id INTEGER NOT NULL REFERENCES cat_attribute(id),
  value_num REAL, option_id INTEGER REFERENCES cat_attribute_option(id),
  source TEXT NOT NULL CHECK (source IN ('seed','manual')),
  PRIMARY KEY (model_id, attribute_id),
  CHECK ((value_num IS NULL) <> (option_id IS NULL)));
-- indexes: (attribute_id, option_id), (attribute_id, value_num) on both tables for package filtering

-- Attribute provenance (corrected 2026-10-19). The only Stage B table rebuild.
-- cat_product_attribute is a leaf table: no table references it; v32 copy: 3,531 rows, all 'parser'.
cat_product_attribute                                  -- columns, PK and value CHECKs unchanged, plus:
  source CHECK IN ('parser','engineering','import_file','seed','manual'),
  source_import_id INTEGER REFERENCES app_source_import(id),  -- engineering: import it was derived from
  derivation_ref TEXT,                                 -- engineering: smallest agreeing '<model code>/<value code>'
  CHECK ((source = 'engineering') = (source_import_id IS NOT NULL AND derivation_ref IS NOT NULL))

-- Package-offer tables created in Stage B; Stage F will compute and filter their rows.
-- Corrected 2026-10-19: witness and undecided rows are part of the contract.
-- Installation-local derived data: never written to .lqp; replaced wholesale on recomputation.
CREATE TABLE cat_config_model_offer (
  model_id INTEGER NOT NULL REFERENCES cat_config_model(id) ON DELETE CASCADE,
  offer_no INTEGER NOT NULL,                           -- deterministic candidate order (A.4)
  status TEXT NOT NULL CHECK (status IN ('feasible','undecided')),
  undecided_reason TEXT CHECK (undecided_reason IN ('search_bound','value_conflict')),
  definition_fingerprint TEXT NOT NULL,                -- model definition at computation
  config_fingerprint TEXT,                             -- resolver fingerprint of the witness; feasible only
  PRIMARY KEY (model_id, offer_no),
  CHECK ((status = 'feasible') = (config_fingerprint IS NOT NULL AND undecided_reason IS NULL)));
CREATE TABLE cat_config_model_offer_selection (       -- the witness: the complete effective selection
  model_id INTEGER NOT NULL, offer_no INTEGER NOT NULL,
  value_id INTEGER NOT NULL REFERENCES cat_config_dimension_value(id),  -- stable across reimport
  origin TEXT NOT NULL CHECK (origin IN ('candidate','search','default')),
  PRIMARY KEY (model_id, offer_no, value_id),
  FOREIGN KEY (model_id, offer_no) REFERENCES cat_config_model_offer(model_id, offer_no) ON DELETE CASCADE);
  -- feasible: every option of resolver selectedOptionIds (explicit, searched and defaulted, incl. hidden);
  -- undecided: the candidate's own options only.
CREATE TABLE cat_config_model_offer_value (
  model_id INTEGER NOT NULL, offer_no INTEGER NOT NULL,
  attribute_id INTEGER NOT NULL REFERENCES cat_attribute(id),
  value_num REAL, option_id INTEGER REFERENCES cat_attribute_option(id),
  PRIMARY KEY (model_id, offer_no, attribute_id),
  FOREIGN KEY (model_id, offer_no) REFERENCES cat_config_model_offer(model_id, offer_no) ON DELETE CASCADE,
  CHECK ((value_num IS NULL) <> (option_id IS NULL)));
CREATE TABLE cat_config_model_offer_state (
  model_id INTEGER PRIMARY KEY REFERENCES cat_config_model(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('complete','partial','none')),
    -- complete: every candidate decided and at least one feasible; partial: at least one undecided;
    -- none: every candidate proven infeasible
  candidates INTEGER NOT NULL, feasible INTEGER NOT NULL, infeasible INTEGER NOT NULL,
  undecided INTEGER NOT NULL, resolutions INTEGER NOT NULL);
-- indexes: (attribute_id, option_id, model_id), (attribute_id, value_num, model_id) on cat_config_model_offer_value
-- app_setting 'catalogue.package_offer_fingerprint' = run fingerprint (A.4 "Recomputation")
```

- **Why a new source value, not `import_file`.** `import_file` is reserved for imported attribute files. The current engine protects it (`attribute-enrichment.ts`: "Manual, seed and import_file values are never touched"). Reusing it would let derivation delete or overwrite values another importer wrote.
- **Why the provenance is on the row, not in a side table.** A separate ownership-claim table can drift from the row it describes: another writer may replace the value while the claim survives, and the next derivation would then erase data it does not own. A `source` stored on the row changes atomically with the value.
- **The rebuild** copies every existing row unchanged: same values, `source`, `confidence`. Existing rows get NULL provenance. The migration asserts row counts and per-source counts before and after. `.lqp` snapshots (`prj_product_snapshot_attribute`) carry no source, so there is no project format change.
- `cat_source_conflict` (`subject_kind` article/model, `import_id` = current engineering import) holds derivation, offer and classification diagnostics. Topics are prefixed `derived.` and replaced on every run. Other topics, written by the adapter, are never touched.
- New seed attributes: `rated_ultimate_breaking_capacity` (number, kA, Stage B) and `trip_unit_type` (enum, Stage E). Category additions are listed in A.7. Attribute codes are a `.lqp` compatibility contract (snapshotted per item), so they are never renamed.

#### A.4 Seed and processing contract

- **Seed file** `db/seed/engineering-vocabulary/tiquadri.json`. It is reviewed, version-controlled and keyed by adapter code plus stable source codes, never by database IDs.
  - `values[]`: `{dimension:"tq.label.51", value:"tq.value.146", reviewedLabel:"100 A", attributes:[{attribute:"rated_current", number:100}]}`. A combined value lists several attributes.
  - `models[]`: `{model:"tq.pack.4251", reviewedName:"M2-250B - Elettronico 3P 25kA", category:"protezione.interruttori_scatolati", attributes:[{attribute:"poles", option:"3p"}, {attribute:"rated_ultimate_breaking_capacity", number:25}], evidence:"…"}`.
  - `notApplicable[]`: values and models reviewed as carrying no attribute or category, with a reason, e.g. "Magn.800A" (Im), "S: 1-1,6 A" (setting range). Every value used by an active device entry or package option must appear in `values` or `notApplicable`. This makes coverage checkable.
- **Generator (development only, not shipped).** It proposes rows from the adapter's tables and the TiQuadri source, using the TiQuadri-wide token vocabulary and per-value label classes. It cross-checks against `Descri_Modalita`, the profile description, `ART_TISYSTEM`, the `bti.description` parser and the existing categories. It flags:
  - assembly models (non-selecting axes that add articles);
  - packs whose class membership disagrees;
  - articles with conflicting candidates.

  People review the report before the seed is committed. The generator never runs in the application.
- **Validation (startup error).** Unknown attribute, category or option codes; type mismatches; duplicate keys; a value both mapped and `notApplicable`; a category or attribute that is not linked (a model attribute must be applicable to the model's category).
- **Synchronization (`synchronizeEngineeringVocabulary`).** Runs:
  - in the startup seed worker after migrations;
  - after `refreshEngineeringLinks` inside every engineering import/sync transaction;
  - inside METEL normalization when products change.

  For each seed row it resolves the model or value by code:
  - absent → `deferred`, reported, not an error (another catalogue version);
  - inactive → ignored;
  - reviewed name/label differs → `stale`, reported, not applied.

  Otherwise it upserts `source='seed'` rows and sets `category_id`/`category_source='seed'` unless `category_source='manual'`. Seed rows no longer in the file are deleted. Manual rows are never read for deletion or written.
- **Reimport safety (verified).**
  - Model, dimension and value IDs persist across reimport (`ON CONFLICT … DO UPDATE` by code).
  - Options, axes, rules and entries are rebuilt per model (`replaceModelChildren`, `refreshEngineeringLinks`). Derivation therefore uses entries and values, never option IDs, and always runs after link refresh.
  - The adapter writes none of the seed-owned columns or tables.
- **Classification** runs next, with the engineering tier in A.2.1. `CLASSIFIER_VERSION` is incremented; the classifier fingerprint adds the contributed categories and the current engineering import fingerprint.
- **Derivation (generic, in `attribute-enrichment`).** For each product, take every active, non-obsolete device model with `commercial_contribution='articles'` that selects it through `cat_config_model_entry`. Candidates are that model's facts plus the value attributes of the entry's own option.
  - Only attributes applicable to the product's current category are kept. This gate blocks contactor operational currents and the KNX "320mA".
  - **Single decision per (product, attribute)** (corrected 2026-10-19).
    - Engineering derivation and the parser are evaluated together by one engine pass that owns `engineering` and `parser` rows. The existing parser-only loop is replaced by this pass, so the two never write in sequence or over each other.
    - The pass reads three inputs:
      - **R**, the existing row: none, `parser`, `engineering`, or protected (`import_file`/`seed`/`manual`);
      - **E**, the engineering outcome: *agree(v)* when all candidates give *v*, *conflict* when candidates disagree, *none* when there is no candidate;
      - **P**, the parser outcome: *p*, or none when there is no value or the value is ambiguous.
    - Both E and P are computed only when the attribute is applicable to the product's current category. Otherwise E = P = none.

    | R (existing row) | E | Resulting stored row | Diagnostic |
    |---|---|---|---|
    | protected | any | **unchanged** (byte-identical) | `derived.shadowed` if *agree(v)* and *v* ≠ stored; `derived.conflict` if *conflict* |
    | none / `parser` / `engineering` | *agree(v)* | `engineering` *v* (insert, or update value, source and provenance) | `derived.parser_disagrees` if P = *p* ≠ *v* |
    | none / `parser` / `engineering` | *conflict* | **none** (delete the `parser` or `engineering` row) | `derived.conflict` with every candidate and any removed parser value |
    | none / `parser` / `engineering` | *none* | `parser` *p* if P = *p*, else none (an `engineering` row is deleted) | — |

  - **The five transitions requested in review.**
    1. A `parser` row with agreeing engineering candidates becomes an `engineering` row with the engineering value and provenance. A differing parser value is reported, not kept.
    2. A `parser` row with conflicting engineering candidates is deleted. No value is stored.
    3. An `engineering` row hit by an engineering conflict is deleted. The parser is not consulted, so no value is stored.
    4. An `engineering` row with no remaining evidence is deleted, and the parser decides: a `parser` row if it proposes a valid value, otherwise none.
    5. A protected `import_file`, `seed` or `manual` row is never changed by any input. Only diagnostics are written.

    This matches the precedence (manual > seed > import_file > engineering > parser) and the conflict policy (contradictory engineering evidence suppresses the lower-precedence parser value).
  - **v32 impact.** The 6 In conflicts (T7304F125, T7304F125D, T7304H125, T7304L125, T7304N125, T7304N125D) have no category and therefore no parser row today, so no existing parser value is removed. Parser/engineering disagreement on overlapping articles is 0.
  - **What can remove a value.**
    - Seed removal, a stale or deferred seed row, an inactive model, a reimport that drops an entry, a lost category link, or a new conflict changes **only** engine-owned rows, following the table.
    - An unchanged value whose import changed only has its provenance (`source_import_id`) updated in place.
    - The engine never deletes by `source_import_id`, so an older import's rows are recomputed, never bulk-erased.
  - `ENRICHMENT_VERSION` is incremented. Its fingerprint adds the engineering vocabulary state and the current engineering import fingerprint.
- **Package offers (generic; corrected 2026-10-19; eligibility made precise 2026-10-21).** Offers are computed for every selectable package whose category has at least one applicable attribute **and** that can carry a value for one: an applicable model fact, or an option value on one of the package's own axes (hidden axes included) mapped to an applicable attribute. A mapping on another model's values never makes a package eligible. Packages in attribute-less categories are not evaluated, get no offer state, are listed unfiltered and never match an attribute filter.
  - **Add predicate.** A configuration is *addable* exactly when `insertConfiguredItem` would accept it. The witness for a feasible configuration is the resolver's output for it.
    - `resolveConfiguration` status `complete`;
    - a fingerprint;
    - a priced, non-empty BOM;
    - an active, non-obsolete model;
    - no issue with error severity;
    - a physical profile for a device.
  - **Relevant axes.** Visible axes with at least one active option whose value has a `cat_config_value_attribute` row for an attribute applicable to the package category. Hidden axes always take the resolver's defaults.
  - **Candidates.** The cartesian product of the relevant axes' eligible options, respecting dependent options: a child option is a candidate only together with its parent. Model facts belong to every candidate. A package with no relevant axis has exactly one candidate (all defaults).
    - *Superseded (Stage A, pre-vocabulary):* "749 candidates over all 193 model-only device models, at most 28 per model" counted every model, before the eligibility rule above applied. The current v32 figures are in A.9.
  - **Decision for each candidate**, in deterministic order (axis `sort_order`, option `sort_order`):
    1. Resolve the candidate's options explicitly, with every other axis left to the resolver's unique eligible default. This is the state the Catalogo inline configurator starts from.
    2. If that configuration is not addable, run a bounded completion search: enumerate alternative options on the other visible axes in deterministic order and stop at the first addable configuration.
       - The budget is 4,096 resolutions per package.
       - In v32, 187 of the 193 model-only models have at most 4,096 complete configurations, so the search is exhaustive for them.
       - The six larger ones are two "M2 - Sezionatore 2P CC" and four type-B RCCB packages, at 5,400–41,472.
    3. Classify the candidate:
       - addable → **feasible** (see the witness below);
       - search exhausted without an addable configuration → **proven infeasible**, not stored, counted in the offer state;
       - budget reached → **undecided**: stored with `status='undecided'`, `undecided_reason='search_bound'`, the candidate's own selection and its candidate values (its mapped option values plus the model facts). Offer state `partial` and a `derived.offer_undecided` diagnostic.
  - **Witness and effective values** of a feasible offer.
    - The witness is the resolver's complete effective selection, `selectedOptionIds`: explicit, searched and defaulted options, hidden axes included. It is stored as dimension-value IDs in `cat_config_model_offer_selection`, with `origin` candidate, search or default.
    - Option IDs are **never** stored, because the adapter rebuilds options on every reimport. Dimension and value IDs are upserted by code and survive reimport (`upsertDimension`/`upsertValue`), and a model has one axis per dimension (`UNIQUE(model_id, dimension_id)`).
    - The offer values are computed from that **effective** selection: the `cat_config_value_attribute` rows of every selected value, including defaults and hidden defaults, plus the model facts, restricted to the category's applicable attributes. They are not computed from the candidate alone.
    - If two selected values, or a value and a model fact, give different values for one attribute, the offer is stored as `undecided` with `undecided_reason='value_conflict'` and a `derived.offer_value_conflict` diagnostic. It never matches. The vocabulary review gate requires 0 of these.
    - Feasible offers with identical value sets are deduplicated. The lowest `offer_no` keeps its witness.
    - The run stores `config_fingerprint` (the resolver fingerprint: brand, model code, definition fingerprint and sorted dimension/value codes) and the model's `definition_fingerprint`.
  - **Reconstruction.** A stored witness is mapped back to current option IDs by the existing stable-code mapping that projects already use: `mapSelections` in `engineering-refresh-resolver.ts`, promoted to a shared catalogue helper. It maps dimension/value codes to options, assigning dependent options only after their parent, and requires **exactly one** complete mapping.
    - The mapped IDs are passed as explicit `selectedOptionIds` to `resolveConfiguration`.
    - The witness is valid only when the mapping is unique, the result passes the add predicate, its fingerprint equals `config_fingerprint`, and the model's `definition_fingerprint` is unchanged. Otherwise it is `offer_stale`.
  - **Opening a matching package.**
    - With attribute filters active, the browse result returns for each listed package the lowest `offer_no` of a feasible offer that satisfies them.
    - Opening the package in the Catalogo inspector asks the main process for that offer's reconstructed `selectedOptionIds` (a new read-only IPC, `configuration.offerSelection(modelId, offerNo)`). The inspector starts the shared configuration session from them instead of from defaults. They become the session's baseline for the existing genuine-change rule, and the resolved configuration is exactly the witness.
    - An `offer_stale` reply opens the package from defaults with a visible notice ("La configurazione filtrata non è più disponibile; ricaricare il catalogo"). Offers are recomputed transactionally with their sources, so a stale witness indicates an interrupted or inconsistent catalogue and is never silently replaced by another configuration.
    - Without attribute filters, opening a package is unchanged.
  - **Constraints covered** by the add predicate and the resolver:
    - option dependencies, required axes, unique defaults (`ambiguous_default` is infeasible unless the option is explicit), active and inactive options;
    - budgets (`budget_exceeded`);
    - profile reachability (`no_profile`);
    - article resolution and prices (`bom_incomplete`, `price_incomplete`);
    - commercial contribution.
  - **Constraints not covered, by design.** These belong to placement, not to adding an unplaced item from Catalogo, which the existing add flow permits; they are checked when the item is placed:
    - container/content exclusions (`cat_config_exclusion`);
    - TiQuadri `Incompatibilita`, carpenteria ↔ pannello options;
    - physical fit and accept sets;
    - engineering context.
  - **Safe fallback (mandatory behaviour).**
    - Only `feasible` offers produce matches and facet counts.
    - Proven-infeasible candidates are not stored.
    - `undecided` offers are stored only to keep their packages **visible as unresolved**.
      - When an undecided offer's candidate values satisfy every active attribute filter and the package has no feasible match, browse returns the package in `undecidedPackages`, outside `packages` and every count.
      - Catalogo shows these packages in a separate, collapsed-by-default group "Non valutabili con questi filtri (N)". Each row is explained and opens from defaults.
    - They are never presented as matches and never silently dropped as non-matches.
    - Every undecided offer has exactly one `derived.offer_undecided` or `derived.offer_value_conflict` diagnostic.
  - **v32 evidence.**
    - *Superseded (supervisor decision 2026-10-21).* The Stage A probe, run before any category link or vocabulary existed, treated Taratura and residual axes as attribute-carrying in every category and counted all 160 selectable Apparecchi packages: 395 candidates, 388 addable at defaults, 7 proven infeasible, 0 undecided. Those figures contradict the eligibility rule above (contactor Taratura is operational current, A.2.5 and A.7) and are not an acceptance target.
    - **Current, under the eligibility rule:** 52 packages evaluated (Fusibili 45, type-B RCCB 4, "M2 – Sezionatore 2P CC" 3); 264 candidates, 264 feasible at defaults, 0 infeasible, 0 undecided, 264 resolutions. The other 108 selectable packages are not evaluated: 106 are in attribute-less categories, and the two fuse-holder packages 1788 and 1802 (`protezione.portafusibili`, poles only) carry no poles value or fact.
    - The 7 known `bom_incomplete` packages with `unresolved_article` (Flatwall 3834, 3835, 3837; ammeters 8783, 8784, 8793, 8794) are in attribute-less categories. They are not evaluated, have no offer state, stay listed without filters and keep Add disabled through the resolver. The proven-infeasible path (offer state `none`) is covered by fixtures.
    - **The six models above the search bound are all selectable packages:**
      - packs 4580 and 4581 "M2 - Sezionatore 2P CC" (41,472 and 10,368 complete configurations), under "M2 - Sezionatore CC";
      - packs 14754–14757, type-B RCCBs (5,400 and 16,200 each).
      - The third "M2 - Sezionatore 2P CC" pack, 4582, has 3,840 configurations: it is under the bound and its search is exhaustive.
      - Their only attribute-carrying axis is Taratura (2 values each). Every candidate is addable at defaults (e.g. 4580: `complete`, total €1,946.50), so none reaches the bound.
    - The bound therefore produces no undecided package in v32. The undecided path exists for later catalogue versions and is covered by fixtures.
  - **Recomputation and invalidation.**
    - Offers, witnesses and states are replaced wholesale in the derivation transaction after engineering import/sync, vocabulary sync and METEL normalization: addability depends on resolved products and current prices.
    - The run fingerprint (`catalogue.package_offer_fingerprint`) covers the resolver version, the offer algorithm version and bound, the vocabulary state, the engineering import fingerprint, and the current price list identities.
    - An unchanged fingerprint is a no-op. A changed one recomputes every package, which costs under a second in v32.
    - A reimport that rebuilds options cannot invalidate a witness silently. Witnesses hold value IDs, and recomputation runs in the same transaction as the reimport.
- **Ordering and atomicity.** Adapter import → link refresh → vocabulary sync → classification → derivation → family grouping, all in one transaction. A failure rolls everything back, and the installed adapter-version gate is unchanged. An unchanged fingerprint is a no-op.

#### A.5 Filtering contract (implementation notes)

- **Packages.** `browsePackages` stops returning `[]` when attribute filters are present. A package matches when one row of `cat_config_model_offer` has, for every active attribute filter, a `cat_config_model_offer_value` whose value is selected. This is one `EXISTS` over offers per package, not a separate check per attribute. Offer values are restricted to the package category's applicable attributes. Facet counts for packages use the same per-offer test with the counted attribute excluded. Only `status='feasible'` offers take part.
  - The browse response gains `undecidedPackages`, packages whose `undecided` offer satisfies the filters and that have no feasible match. They are rendered in the separate group defined in A.4 and are excluded from `packageCount` and facet counts.
  - Each listed matching package carries its matching `offerNo`, used to open it on its witness (A.4 "Opening a matching package").
- **Counts and applicability.**
  - Facet counts add matching packages to matching articles.
  - `applicable` is true when the browsed subtree has a stored article value or a package offer.
  - The universe still comes from the tree root, now including package offers.
- **Option persistence (confirmed requirement; the earlier number-facet reduction is withdrawn).** Every facet definition and option offered at the tree root stays visible at every descendant, for number and enum attributes alike. Unavailable options are greyed and disabled with count 0. Selected options always stay enabled and removable. The browse contract is unchanged: every universe value is returned with its branch count.
  - Size in v32 after Stages C–D: 41 article In values (0.5–6,300 A) plus package offers; Icu 8 values; Icn 6; Idn 5 (the KNX "320/640 mA" values are excluded by the category gate).
- **Scalable presentation, without changing those semantics** (Stage F; renderer only, generic by data type and option count, no brand logic):
  - Number options are sorted ascending with their unit ("0,5 A … 6300 A"), never by availability. A value never moves when counts change.
  - Above 12 options, the list sits in a bounded scrolling area of `FacetGroup`, divided into fixed **magnitude bands**: decades of the attribute's unit (< 1, 1–10, 10–100, 100–1,000, ≥ 1,000).
    - Bands are computed from the root universe only, so band membership never changes while navigating.
    - Each band header shows "available / total" for the browsed branch.
    - All bands stay expanded. Headers are sticky labels, not filters.
  - A **"Vai a…"** field scrolls to and focuses the nearest value. It highlights; it never hides options.
  - A **range helper** ("da … a …") adds every *available* value in the inclusive range to the selection. This is still OR within the attribute; greyed values are not added. Chips and the existing selected count summarise the selection, and each selected value stays listed in place.
  - Keyboard order, the exclusive disclosure, Escape handling and the greyed-but-openable behaviour of a fully unavailable facet are unchanged.

#### A.6 Attribute semantics

| Attribute | Status | Meaning in LibreQuadri | TiQuadri source |
|---|---|---|---|
| `poles` | existing enum | Number of main poles. `1p_n`/`3p_n` = protected poles + switched unprotected neutral (modular "1P+N", "3P+N"). Four-pole devices whose neutral is protected (fully, "N/2" or adjustable) are `4p` | Pack name |
| `rated_current` (A) | existing | Catalogued "Corrente In": breaker or trip-unit rating, RCCB or switch-disconnector rating, fuse-link rating. Not Im/Ii, not a setting range, not a contactor operational current | Entry option value; package option values |
| `declared_breaking_capacity` (kA) | existing | Modular devices only (MCB, RCBO, AFDD): BTicino's declared Icn | `bti.description` parser; pack name for Stop Arc |
| `rated_ultimate_breaking_capacity` (kA) | **new** | Icu per IEC 60947-2 for MCCB and ACB, at the AC reference voltage of the manufacturer's designation (BTicino 400/415 V AC). Not filled for DC devices without DC evidence | Pack name (reviewed) |
| `rated_residual_current` (mA) | existing | Fixed Idn of an article-integrated residual device. Adjustable Idn is not stored | Pack name; parser |
| `residual_current_type` | existing enum | AC, A, F, B. "AS", "A-S" and "HPI" → `a`, as in `bti.description` v1 | Combined option value; parser |
| `trip_curve` | existing enum | B/C/D/K/Z for modular devices only | Pack name; parser |
| `trip_unit_type` | **new** (Stage E) | thermomagnetic, magnetic_only, electronic_li, electronic_lsi, electronic_lsig, electronic (protection functions unspecified) | Pack name / Tipologia (reviewed per pack) |

The four-pole decision follows TiQuadri ("4P" for T724/T714) and the BTicino "Poli 4P" sheets. BTicino also writes "3P+N/2" (T714B100D) and METEL writes "3P+N/2". In MCCBs that notation means a protected neutral at 50%, which is not the modular `3p_n`.

#### A.7 Coverage and acceptance

| Group | Articles / packages | Contributed categories | Technical attributes expected |
|---|---|---|---|
| Interruttori scatolati | 1,000 / 3 | `interruttori_scatolati`, `interruttori_scatolati_differenziali`, `interruttori_aperti` (Megabreak, DMX3), `sezionatori`, `sezionatori_differenziali`, `sezionatori_fusibili` (SPX3), `rele_differenziali` | poles 999, In 990 − 6 conflicts, Icu ≈ 944 (switch-disconnectors have none); trip unit (Stage E) |
| Sezionatori con maniglia | 44 / 0 | `sezionatori` | poles 44, In 44 |
| Dispositivi modulari | 1,102 / 42 | existing MCB/RCBO/RCCB/AFDD/blocchi; `sezionatori`, `salvamotori`, `limitatori_sovratensione`, `portafusibili`, `rele_differenziali`, and low-data categories (contattori/relè, interruttori orari/temporizzatori, comandi, strumenti di misura, contatori di energia, segnalazione, alimentatori/trasformatori, accessori) | Btdin unchanged or a superset; Stop Arc LEG and DC gain values; salvamotori get no In (setting ranges); low-data categories none |
| Supervisione impianto | 56 / 0 | `supervisione` | none |
| Automazione | 79 / 8 | `automazione` (domotica, KNX, cablaggio/datacom) | none; "320mA" never Idn |
| Prese industriali | 4 / 39 | `prese_industriali` | none in Stage C; package offers optional (Stage F) |
| Fusibili | 0 / 45 | `fusibili` | package In offers from "n A - Tipo gG" (Stage F) |
| Contattori non modulari | 1 / 18 | `contattori` | none: Taratura there is operational current |
| Trasformatori, Dispositivi a pannello | 0 / 5 | `trasformatori`, `strumenti_di_misura` | none |

Category codes are lowercase and stable. The product owner approved the complete stable code tree below for Stage C and reserved Stage D. The shorthand category names in the coverage table above are historical proposals; the fully qualified codes below govern implementation. The existing codes remain unchanged. Stage C seeds only the existing and new Stage C codes. Stage D codes are reserved here and are not yet seeded. Modular and non-modular contactors share `comando.contattori_rele`. Italian display names remain OPEN under §16 Q30; Stage C seed names are provisional.

```text
protezione                         [existing parent]
  protezione.interruttori_automatici                 [existing]
  protezione.magnetotermici_differenziali            [existing]
  protezione.differenziali_puri                      [existing]
  protezione.blocchi_differenziali                   [existing]
  protezione.rilevatori_arco                         [existing]
  protezione.interruttori_scatolati                  [Stage C]
  protezione.interruttori_scatolati_differenziali    [Stage C]
  protezione.interruttori_aperti                     [Stage C]
  protezione.salvamotori                             [Stage C]
  protezione.portafusibili                           [Stage C]
  protezione.fusibili                                [Stage C]
  protezione.limitatori_sovratensione                [Stage C]
  protezione.rele_differenziali                      [Stage C]
manovra                            [Stage C parent]
  manovra.sezionatori                                [Stage C]
  manovra.sezionatori_differenziali                  [Stage C]
  manovra.sezionatori_fusibili                       [Stage C]
comando                            [reserved Stage D parent]
  comando.contattori_rele                            [reserved Stage D]
  comando.interruttori_orari_temporizzatori          [reserved Stage D]
  comando.apparecchi_di_comando                      [reserved Stage D]
  comando.segnalazione                               [reserved Stage D]
misura                             [reserved Stage D parent]
  misura.contatori_energia                           [reserved Stage D]
  misura.strumenti_di_misura                         [reserved Stage D]
alimentazione                      [reserved Stage D parent]
  alimentazione.alimentatori_trasformatori           [reserved Stage D]
accessori                          [reserved Stage D parent]
  accessori.accessori_quadro                         [reserved Stage D]
supervisione                       [reserved Stage D parent]
  supervisione.supervisione_impianto                 [reserved Stage D]
automazione                        [reserved Stage D parent]
  automazione.sistemi_edificio                       [reserved Stage D]
prese                              [reserved Stage D parent]
  prese.prese_industriali                            [reserved Stage D]
```

The four "Interbl. Standard – Con Fusibili" entry assemblies (source hierarchy: LibreQuadri group Prese industriali, Tipologia Interbloccate Standard) belong to Stage C by primary article. `tq.pack.14744`–`14746` select fuse holders BTI:F322, F323 and F323N and use `protezione.portafusibili`. `tq.pack.14747` selects fuse-link BTI:F32 and uses `protezione.fusibili`. The socket, its IP option and the fixed fuse or holder rows are non-entry BOM rows, and these four models have no model facts.

`protezione.portafusibili` exposes **poles only**. A fuse holder's own rating and the Taratura of a Portafusibili package are not the same quantity. Packs 1788 "Portafusibile 4A F313N" and 1802 "Portafusibile 20A F323N" select the rating of the fuse-link they add. Neither is stored or filtered as `rated_current`. `protezione.fusibili` carries `rated_current` as the fuse-link rating (A.6). Category applicability is the gate: a Taratura value mapped to `rated_current` contributes nothing to a Portafusibili article or, in Stage F, to a Portafusibili package offer.

Residual switch-disconnectors are split by primary article. The "M1-160 / M2-250 Sezionatore Differenziale 4P" packs (`tq.pack.4244`, `4245`, `4302`, `4303`) select BTI:T714S160DB and BTI:T724S250D, described by METEL as "interr. manovra + diff". With BTI:T7304S125D and BTI:T734S250D they are `manovra.sezionatori_differenziali`. The "MS4 630 Sezionatore Diff." assemblies select plain switches (BTI:T744S400, BTI:T744S630) and add the Modulo Diff. axis, so their primaries are `manovra.sezionatori`.

**Stage C article-count reconciliation (real TiQuadri v32 catalogue).** The selected models yield primary memberships of 1,000 `Interruttori scatolati`, 44 `Sezionatori con maniglia`, 894 protection/switching `Dispositivi modulari` and four Prese industriali "Con Fusibili" assemblies: 1,942 source-group memberships in all. Their union is **1,938 distinct `cat_product.id` values and 1,938 distinct brand-qualified manufacturer codes**. Four identities occur in two groups: `3746 / BTI:G701N` (scatolati and modulari), plus `2768 / BTI:F322`, `2769 / BTI:F323` and `2770 / BTI:F323N` (modulari and Prese). `2765 / BTI:F32` is the one additional unique Prese primary. The first three groups alone therefore have 1,938 memberships and 1,937 unique primaries; adding Prese gives 1,942 memberships and 1,938 unique primaries. The model set equals the planning probe's 815 protection/switching models plus the four Prese assemblies. The planning estimate of 1,934 counted only the articles reached exclusively by those 815 models. It assigned F322, F323 and F323N to a shared C/D bucket and F32 to Stage D. 1,934 + 3 + 1 = 1,938. The verified Stage C acceptance count is therefore 1,938. No article is excluded to force a target count.

**Global acceptance:**
- Every device primary article and selectable package is classified, or on the reviewed exclusion list.
- Every value used by an active entry or package option is in `values` or `notApplicable`.
- 0 unreviewed generator conflicts; 0 METEL disagreements; 0 changed values on the 784 parser-attributed articles. The engineering value equals the parser value wherever both exist.
- Diagnostics list exactly the known source defects.

**Real-article checks** (values to be confirmed by the reviewed seed):
- FH84C10 = 4p / 10 A / C / declared 10 kA, with no residual values.
- GN8843A16 = 4p / 16 A / A / 30 mA / declared 6 kA.
- G723AC40 = 2p / 40 A / AC / 30 mA; G723F63 = type F.
- 415920 (LEG Stop Arc) = `rilevatori_arco` / 1p_n / 10 A / B / declared 6 kA.
- F82N16FV1 = 2p / 16 A, with no breaking capacity.
- 417305 (MPX salvamotore) = `salvamotori` / 3p / no In.
- T723B100E = 3p / 100 A / Icu 25.
- T724B40E = 4p / 40 A / Icu 25.
- T744F250 = `interruttori_scatolati` (not differenziali) / 4p / 250 A / Icu 36.
- T714B100D = `interruttori_scatolati_differenziali` / 4p / 100 A / Icu 25, with no Idn.
- T804B1000 = `interruttori_aperti` / 4p / 1000 A / Icu 42.
- T7234WF/250 and T723S250 = `sezionatori` / 250 A / no Icu.
- T7304F125: no In (conflict diagnostic), but poles 4p and Icu 36.
- 003506: no Idn.

**Facet checks:**
- Node "Megatiker DIN Elettronici M2-250 › Magnetotermici": 3P 48 / 4P 48; In 40/100/160/250 = 24 each; Icu 25/36/70 = 32 each.
- 3P ∧ 100 A ∧ Icu 25 → T723B100E, T723B100M, T723B100T, T723B100MT.
- Interruttori scatolati: 4P ∧ 250 A ∧ Icu 36 → 14 articles (T724F250…, T734F250…, T744F250, T744F250EB).
- Dispositivi modulari: 2P ∧ AC ∧ 30 mA ∧ 40 A → G723AC40, G723AC40H, GC723AC40, GN823AC40.
- Fusibili (Stage F): In 16 A matches package 2244 "Fusibili 10,3x38 mm - 1 Polo".

These counts come from the unreviewed probe; each stage confirms them from the reviewed seed.

#### A.8 Stages (each a separate review branch)

Stage A and Stage B are merged into `main` at `3f4a3d5`. By product-owner request, Stages C–F are delivered as one feature on `review/tiquadri-cdef-integrated` (A.9) instead of four review branches; the stage definitions and gates below still apply. Q30 stays OPEN.

- **B — foundation.**
  - The migration in A.3.
  - Vocabulary seed sync, engineering classification tier, generic derivation, diagnostics and fingerprints.
  - The `rated_ultimate_breaking_capacity` attribute.
  - The Taratura value map: 91 genuine In-bearing values and 21 gG fuse-rating values mapped; 59 values marked `notApplicable` (37 motor ranges, 10 magnetic thresholds and 12 contactor-only operational-current values). The 171-value v32 source inventory and all shared-code meanings are reviewed; category applicability keeps operational contactor current out of article In.
  - The `cat_product_attribute` provenance rebuild (A.3).
  - Gate:
    - the rebuild preserves all 3,531 existing rows byte-for-byte;
    - the 784 Btdin articles unchanged;
    - engineering conflicts reported in categorized fixtures; the six uncategorized T7304x125 real articles are deferred to Stage C classification;
    - a reimport round-trip leaves the derived state byte-identical;
    - fixture `import_file`, `seed` and `manual` rows survive derivation, reimport, seed removal and a forced conflict unchanged (only engine-owned rows change).
  - **Mandatory transition tests** (fixture catalogue; each also re-run to prove idempotence):
    - **B-T1:** a `parser` row plus agreeing engineering with the same value → `engineering` row, same value, `source_import_id` and `derivation_ref` set; the second run is a no-op.
    - **B-T2:** a `parser` row plus agreeing engineering with a different value → `engineering` row with the engineering value; one `derived.parser_disagrees` diagnostic.
    - **B-T3:** a `parser` row plus conflicting engineering → no row; one `derived.conflict` holding both candidates and the removed parser value.
    - **B-T4:** an `engineering` row, then a seed change that adds a contradicting model fact → no row, even though the parser proposes a value; `derived.conflict`.
    - **B-T5:** an `engineering` row, then its evidence removed. Separate cases: seed row deleted, model deactivated, entry dropped by reimport, category link removed. → The `engineering` row is deleted; a `parser` row appears only where the parser proposes a valid value and the attribute is still applicable.
    - **B-T6:** a protected `manual`, `seed` or `import_file` row × E in {agree same, agree different, conflict, none} → the row is byte-identical; `derived.shadowed` only for agree-different, `derived.conflict` only for conflict.
    - **B-T7:** a conflict that later disappears → the `engineering` row is restored with the agreed value.
    - **B-T8:** a reimport with a new import ID and identical values → only `source_import_id` changes; with the same import → byte-identical.
    - **B-T9:** a failure injected after derivation starts → every `cat_product_attribute` row and diagnostic is unchanged (rollback).
    - **B-T10:** categorized fixture built from TiQuadri value/entry evidence → six T7304x125 conflict cases each have no In row and one `derived.conflict`; on the unmodified v32 copy, those six have no parser row to remove. The six real-article diagnostics are validated after Stage C classification, because their current `category_id` is NULL and the A.4 applicability gate remains unchanged.
- **C — classification and facts for protection and switching devices.**
  - Generator plus reviewed seed for every model in Interruttori scatolati, Sezionatori con maniglia and the protection/switching Tipologie of Dispositivi modulari: contributed categories plus poles, Icu/Icn, curve, Idn.
  - The category-attribute links.
  - Gate: the A.7 article and facet checks for these groups, including one real-data `derived.conflict` and no In row for each of the six T7304x125 articles after category classification.
- **D — classification of all remaining TiQuadri groups.** Low-data categories, packages, the exclusion list. Gate: global classification acceptance.
- **E — `trip_unit_type`** for MCCB/ACB. Gate: T744F250 thermomagnetic, MP… magnetic-only, M4/M5 Li/Lsi/Lsig as in pack names.
- **F — package offers and long-list presentation.**
  - Feasible offers (A.4) and the package filter and count contract (A.2.3).
  - The A.5 banded presentation; Fusibili In offers.
  - Gate:
    - every stored feasible witness reconstructs through the shared mapping to exactly one option set, re-resolves as addable, and yields the stored `config_fingerprint` and the stored offer values (defaults included);
    - after a reimport that rebuilds every option ID, the same check passes with new option IDs;
    - opening a matching package in Catalogo with filters active shows exactly the witness configuration, and Apply/Add uses it;
    - a fixture witness made stale (definition fingerprint changed without recomputation) opens from defaults with the notice and never claims a match;
    - fixtures prove that a dependent option without its parent, a budget-exceeding pair, an unpriced article and a `no_profile` combination never match;
    - a fixture with a search bound of 1 produces `undecided` offers: they are absent from matches and counts, present in `undecidedPackages` and the "Non valutabili con questi filtri" group, and each has one diagnostic;
    - real data (corrected 2026-10-21; the former "160 packages, 7 offer states `none`" target is superseded, A.4): 52 packages evaluated with 264 feasible candidates, **0 infeasible, 0 undecided**; the 108 ineligible selectable packages have no offer state and no offer, stay listed without filters and never match; the seven known `bom_incomplete` packages stay unaddable; the six above-bound packages (4580, 4581, 14754–14757), plus 4582, are decided with feasible offers for both Taratura values;
    - a fixture proves that an attribute mapping on another model's values never makes a package eligible;
    - real-data `undecided` totals equal the diagnostics;
    - the Apparecchi root and every descendant return identical option lists, with unavailable values greyed;
    - the Fusibili check.

Stage B supplies the implemented foundation. Stages C–F are implemented together (A.9).

#### A.9 Integrated C–F implementation (2026-10-21, `review/tiquadri-cdef-integrated`)

Built from the supervisor-reviewed Stage C commit `45ebdf9`; Stage F `42c780c` merged (tree identical to the original `b8bb498`) and corrected. Real-data numbers are from the TiQuadri v32 master, ListinoBT and the BTI METEL delivery.

- **Coverage.** One reviewed seed covers every active Apparecchi device model: 1,299 = 819 Stage C + 480 Stage D. Every one of the 2,273 primary articles has exactly one category (0 `derived.category_conflict`), and all 160 selectable packages are classified: Fusibili 45 `protezione.fusibili`, Prese 39 `prese.prese_industriali`, SPD 30, contactors 18, measurement 8, automation 8, type-B RCCB 4, DC switch-disconnectors 3, transformers 3, fuse-holder packages 2. The 784 METEL-categorized articles all agree. The only derivation diagnostics are the six known T7304x125 In conflicts.
- **Stage D decisions.**
  - The reserved codes are used exactly.
  - Models follow the function of their selected primary. The six energy meters shared by Dispositivi modulari and Supervisione → `misura.contatori_energia`; F4N200 and MFD4421 → `misura.strumenti_di_misura`; the pulse concentrators F4CON12 and IF4C001 → `supervisione.supervisione_impianto`. CTX3 + MPX assemblies → `protezione.salvamotori` (their MPX primary). "Temporizz." relays → `comando.interruttori_orari_temporizzatori`.
  - Stage D categories link no technical attribute and store no technical value.
  - Every option value used only by Stage D models (425) is an explicit `notApplicable` record with a reviewed reason. An unreviewed dimension stops the generator.
- **Stage E decisions.**
  - `trip_unit_type` applies to the three MCCB/ACB categories.
  - Values come from the pack name ("Elettr Li/Lsi/Lsig", "Solo magnetico" or "Elettr SM", "Elettronico", "Magnetot."). A name that states no function needs METEL "magnetotermico" (TM/MT) text on every selected article.
  - ACB "Mgt", DMX3, Tipologia names and abbreviations such as "magn+diff" are not evidence. The three M1-160E "Differenziale" packs and every air circuit breaker therefore have no value.
  - Real v32: thermomagnetic 386, electronic 160, magnetic-only 110, LI 50, LSI 38, LSIG 38 articles; 0 article conflicts.
- **Stage F offers on real data.**
  - Offers are computed for the eligible packages (A.4): 52 packages (Fusibili 45, type-B RCCB 4, "M2 – Sezionatore 2P CC" 3). Eligibility uses only the package's own option values and its applicable facts (corrected 2026-10-21; previously any catalogue value mapped to an applicable attribute counted).
  - Candidates are 264, all feasible at defaults, with 0 infeasible, 0 undecided and 264 resolutions.
  - The other 108 packages have no offer state and are listed unfiltered as before. By supervisor decision (2026-10-21) the Stage A expectation of 395 candidates and seven `none` states is superseded: attribute-less packages are not evaluated just to produce empty offers. The seven `bom_incomplete` packages remain unaddable.
  - All 264 witnesses reconstruct through stable codes to one addable configuration, also after a reimport that rebuilds every option ID.
- **Stale engineering data fails closed (correction to Stage F).**
  - Offer derivation checks `readEngineeringReadiness().staleModel()` per package and never resolves a stale model. Its offers are removed with the wholesale replacement, and one `derived.offers_unavailable` diagnostic per package records the readiness reason and the required adapter version.
  - The derivation completes, so METEL normalization, startup and reimport succeed. Any other resolver or write failure still rolls the whole transaction back.
  - Browsing never throws. Untrusted packages (stale source or changed definition) have no technical matches, counts or facet values, and `packageOffersStale` makes Catalogo explain why. Unfiltered browsing is unchanged.
  - `configuration.offerSelection` answers `offer_stale`.
- **Offer fingerprint (correction to Stage F).** The run fingerprint includes each running adapter's required version, the installed version and the readiness state. An application upgrade that changes the required version therefore invalidates every offer, even when no catalogue row changes.
- No `.lqp` format change. Offers are installation-local derived data, and adding a package uses the unchanged project path.
