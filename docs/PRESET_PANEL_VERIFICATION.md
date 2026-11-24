# Preset-Pannelli candidate verification


Base `29381fafbc422eb2e876be1c53d838257bd6d222` (verified as `origin/main` before work).
Branch `claude/preset-panel-workflow`: the unreviewed Codex commit `9cb17b4` followed by
reviewed corrections. Review candidate; not merged. Every result below was re-run on the
corrected branch; statements of the earlier Codex version of this file were not reused.

## Audit of 9cb17b4 and corrections

| Area | Finding | Action |
|---|---|---|
| Migration `0010`, Drizzle schema/journal | Additive nullable `placement_mode`; no drift | Kept |
| Relation query/types, writer | Expose sequence and mode | Kept |
| Fixed slot zones on enclosure block variants | Exact source X/Y, slot N = occurrence N | Kept |
| Model definition fingerprint | Added adapter version and contribution to **every** model, changing all 10,800 identities; design guards compare identities, so existing project roots would become `container_unavailable` after re-import | **Corrected**: identity unchanged unless the pack has preset rows (only 345 parents change) |
| Relative rows → `packed` | Flatwall rows have offsets inside a parent panel; evidence supports `packed` only for offset-free rows | **Corrected**: offset rows are `NULL` (unknown) and reported |
| Per-occurrence withholding | Produced partial structures (SDX 428 got only its 50 mm blank panel) | **Corrected**: all-or-nothing per parent, one savepoint for the set |
| Physical-only seed (15) | Included 2195 (only obsolete users) and 1283 (only SDX sets that cannot complete) | **Corrected** to 13 (1778 + 12 windows) |
| Artless supports | Opaque fill hid the enclosure artwork's windows | **Corrected**: outline-only mounting area (physical rule) |
| Docs | Branch name, counts, fingerprint statement, Q18/§5.6 drift | **Corrected** |
| Renderer creation focus, notices, IPC, ordinary support lifecycle, offline snapshot use | Correct | Kept |

## Physical-only classification (15 vs 36 vs 13)

Every active `Pannello_centralino` support in v32 was classified (43 active):

- **Approved (12 + 1778):** DIN windows 2189–2194, 2196, 2898–2902 — no modality, no base or
  modality article rows, DIN zone, drawing `senza`, and each needed by an active enclosure
  whose complete preset set is creatable. Together: 55 enclosures (36 Linea
  SPACE/WALL/HABITA, 15 Idroboard, 4 Calotte).
- **Article-free but not needed / unsafe:** 2195 (preset only of obsolete enclosures);
  1283 (SDX blank, only in SDX sets that also need 1284–1286); 4591–4594 (no preset use).
- **Option-dependent commercial:** 1284–1286 (Tifast/communication options add articles).
- **Anomaly:** 3618–3625 (MARINA Avanquadro, overlapping source windows).
- **Nested/Flatwall:** 3833, 3844–3847.
- **Q20 socket semantics:** CEE/P17 4601–4607, 4697, 4698 — every active CEE/P17 set
  contains socket windows, so no set completes; their DIN windows are not needed.
- Obsolete: MARINA Precomposto windows 3524–3527 (not active).

Codex's 15 = the 13 above + 1283 + 2195.

## Commands and results

Scratch catalogue: SQLite `.backup` of the installed development `lq.db`/`metel_raw.db`
(adapter 6, migrations 0000–0009) into a scratch data root; the installed files were only read.

```sh
npm run import:tiquadri -- --data-dir <scratch>/review \
  --listino '$HOME/Desktop/Bticino/TiPre 2.0/dat/ListinoBT.mdb' \
  $HOME/Desktop/dat/Aggregati/BTQUADRI.mdb
```

Passed (adapter 7, errors `[]`); `integrity_check` ok, no foreign-key violations. Report
differences from the adapter-6 import: approved physical-only 1 → 13, review candidates
90 → 78, `preset_relative_offset_unresolved` 131, slots 1,726 → 2,777; nothing else.
Relations: 1,001 fixed, 93 packed, 131 `NULL`. Definition fingerprints vs adapter 6:
10,455 identical, 345 changed (exactly the preset parents); 343, 851, 4395, 1778 and 2902
unchanged.

| Command | Result |
|---|---|
| `npx vitest run test/project-structural-workflow.test.ts` | 10 passed |
| `npx vitest run test/tiquadri-preset-semantics.test.ts` | 2 passed |
| `LIBREQUADRI_REV83_REAL_DB=<scratch lq.db> npx vitest run test/tiquadri-real-data.test.ts` | 22 passed (fresh import from the source MDB; includes the 259-enclosure sweep) |
| `npx vitest run test/renderer` | 21 files, 330 passed |
| `LIBREQUADRI_REV83_REAL_DB=<scratch lq.db> npm test` | 71 files, 943 passed, 0 skipped |
| `npm run typecheck` | passed |
| `npm run build` | passed |
| `npm run db:check:project-manifest` | passed (format 5 unchanged) |
| `npm run db:generate:lq` and drizzle-kit for raw/project | no schema changes |
| `git diff --check` | clean |

The 88 orphan CEE enclosures that cannot be added resolve `bom_incomplete` identically with
the base commit's resolver on the adapter-6 catalogue (base worktree at `29381fa`).

## Real-data acceptance (v32)

1. Idroboard 2890 resolves `complete`, BOM `F107N54D`, class `tq.arm.18004`, one slots zone.
2. Adding it creates exactly three `tq.pack.2902` occurrences, diagnostics `instantiated` 1–3.
3. Nodes: slots 1/2/3 at (57,127), (57,277), (57,427) mm from the enclosure frame origin.
4. Ordinary `support` nodes of one configured item, quantity 3.
5. `none`, empty BOM, line unit/total price `NULL`; Distinta = `F107N54D` only.
6. Device discovery on a Finestra includes 1778 and BTDIN60 4395.
7. 1778 and 4395 are added unplaced and placed via backend `placementTargets`.
8. Save + reopen with no catalogue callbacks: nodes, items, lines, Distinta identical.
9. Distinta changes only by the 4395 articles.
10. MDX800 343: no diagnostics, no children; Pannelli discovery still offers 851.
11. SDX 428: added alone; all five packed occurrences withheld (`bom_empty`).
12–13. Existing R-18 placement and R-19 Din generico tests pass in the full suite.

Sweep of all 259 active preset enclosures: 55 complete, 116 added without presets
(422 unresolved occurrences, 37 `incompatible_parent`), 88 not addable, 0 partial.

## Live Electron verification

Built app launched from the repository against the scratch data root
(`LIBREQUADRI_DATA_DIR`), driven through the real window with Chrome DevTools Protocol
(DOM clicks and real mouse drag events; only the native save dialog was stubbed in the
running main process to return a scratch path):

- New project created from the start screen dialog.
- Struttura › Carpenterie › Centralini › Idroboard › Da parete › Struttura › F107 3×18 →
  "Aggiungi e posiziona carpenteria": three Finestre at (57,127/277/427), Struttura
  switched to Apparecchi ("Compatibili con Finestra 18 moduli DIN per M125"); the dashed
  Finestre coincide with the windows of the enclosure's own drawing.
- Din generico added from Ausiliari Din › Accessori and dragged onto Finestra 1 → (62,132).
- MDX800 343 added beside it (x = 498): no Pannelli; Pannelli picker "Compatibili con
  Quadro MDX800" offers the ordinary 600 mm ranges.
- Distinta: 92660V, 92663, 93000FM, F107N54D only.
- Saved `.lqp`: format 5; nodes slot 1/2/3; `prj_item_zone_slot` anchors (57,127/277/427);
  Finestra item `none`, quantity 3, 0 BOM rows.

## Front presentation correction — adapter 10

The earlier artless-support rendering rule and “coincide” observation above describe historical behavior. A failed artwork load alone cannot establish that a support is a mounting guide. Explicit portable view roles now distinguish physical panel artwork from reviewed editor footprints; legacy snapshots retain the old behavior until explicit engineering refresh.

Reviewed v32 Idroboard packs **2898–2902** map to panel families **2309–2313**, respectively, with widths **82/118/154/226/334 mm**, height **55 mm**, centralino/DIN flags and intentional `File_Blocco=senza`. The source placeholder drawing is degenerate, rather than a physical panel vector. Original Idroboard enclosure DXFs contain the solid DIN openings. In **2890**, three 2902 footprints at **(57,127), (57,277), (57,427)** are **334 × 55 mm**; the physical openings are **324 × 45 mm**, inset **5 mm** on each side. They are not coincident rectangles.

Direct TiQuadri PDF evidence: the examined `Q.E. Demo KNX/03_Preventivo/Fronti/Fronte.pdf` represents **2891** with four **2902** supports; physical openings remain visible but mounting footprints are omitted. This supports the approved Idroboard correction. Classification of the other reviewed Idroboard widths uses the same verified source footprint structure; independent TiQuadri PDFs for every variant have not been examined.

Ordinary DIN **851/1234** retain `16_Pan_din\11-9531-24` / `16_Pan_din\41-9531-24Q`; blind **820** retains `11-Pan_ciechi\1-9527`. Their available vectors remain unchanged; missing artwork uses solid printable fallback rectangles. SDX **1283/1284** also have real artwork despite their centralino flag. DIN type, commercial contribution and preset containment do not designate a guide.

`db/seed/tiquadri-front-presentation.json` holds the five reviewed designations and evidence, is fingerprinted with the import inputs, and is revalidated at import. Generic rendering contains no source identities. PDF omits guide graphics only, preserving physical nodes, descendants, geometry, dimensions and placement. SPACE/WALL/HABITA, Calotte, MARINA and Flatwall placeholders retain their historical policy pending separate evidence. See [adapter lifecycle](ENGINEERING_ADAPTER_LIFECYCLE.md).

## Remaining scope (historical preset review)

SDX commercial defaults, Flatwall nested supports, Q20 socket windows, QDSA/Plexo3 and
MARINA anomalies, join kits and side panels. No manufacturer/pack runtime branch, fake
article or zero price was added. `.claude/` was not modified.
