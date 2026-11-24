# Catalogue filter visibility and Siemens presentation


Implemented 2026-10-27. This changes renderer presentation only; catalogue APIs, stored attributes, article details and result columns are unchanged.

The filter buttons stay on one horizontal row. An overflow track below the row appears only when its own strip is hovered, while dragging, or when focused from the keyboard. Its space remains reserved so revealing it does not shift the filters. It supports pointer dragging, track clicks, Left/Right and Home/End, without arrow buttons. Resize and scroll update its position.

Open checklists are portalled to `document.body`, anchored to the button, clamped to an 8 px window margin and opened above when that provides more space. Lists scroll internally. ResizeObserver, window resize and captured scroll events update positioning; completely hidden anchors close their checklist. Outside pointer clicks dismiss it. Tab/ArrowDown enter the checklist, Shift+Tab returns to the button, Escape closes it and restores focus.

Numeric options are sorted ascending, with individual checkboxes and counts. There are no range fields, jump controls or numeric group headings. Zero-count unselected options are omitted from every checklist (brand, configurability and technical values). Selected zero-count options stay visible and removable. Values reappear when their counts become positive.

The `SIE` presentation policy permits only:

- `rated_current`, `poles`, `trip_curve`, `rated_voltage`
- `declared_breaking_capacity`, `rated_short_circuit_capacity`, `rated_ultimate_breaking_capacity`
- `rated_residual_current`, `residual_current_type`, `trip_unit_type`, `coil_voltage`

The other 20 seeded technical attributes are hidden in Apparecchi Siemens and Famiglie statistiche → Siemens. Their selections remain in controller state, but are excluded from Siemens requests and active chips. Returning to BTicino restores them. Azzera filtri clears stored selections, including hidden ones. Shared search, brand, configurability and Solo a listino controls keep their existing behavior.

## Verification

- Renderer regressions enumerate all 11 permitted and 20 hidden attributes in both trees, switch brands, restore selections and clear them. Existing real-fixture Siemens filtering and result-column tests remain covered.
- Checkbox regressions cover numeric ordering, unavailable values and removal. Portal regressions cover checkbox interaction, focus, Escape and outside dismissal.
- Isolated Electron harness uses the production component and stylesheet with 31 filters and 80 values each, without loading installed application data. Evidence in ignored `build/filter-visibility/`: screenshots, `layout.json`, harness and capture script. Verified first/last buttons, the final list option, 420–1200 px window widths, 260–800 px heights, zoom 80%/100%/150%, opening above, resizing an open checklist, offscreen-anchor dismissal and real mouse dragging of the persistent track. Screenshots were visually inspected.
- Full suite: 139 files passed, 10 skipped; 1,768 tests passed, 75 skipped. Fixture catalogues are disposable; environment-dependent real-data tests without their configured sources remain skipped.
- Final renderer suite: 55 files passed, one conditional file skipped; 730 tests passed, three skipped. Typecheck, production build and diff checks passed.
- Source-enabled full suite: 146 files passed, four skipped; 1,821 tests passed, 23 conditional skips, zero failures. Evidence is recorded in STATUS.md and `build/filter-visibility/full-suite.log`. It uses a fresh copy of the earlier disposable installation and copied TiQuadri MDB sources.

Hover refinement verified in isolated Electron: opacity is zero away from the scrollbar and over filter buttons, one over the scrollbar strip, and zero after leaving. The production build and diff checks pass.

Installation and publishing status is recorded in the linked Alpha 1.1 release update.

To repeat the source-enabled suite with the local disposable fixtures:

```sh
LIBREQUADRI_REV83_REAL_DB="$PWD/build/filter-visibility/installation/data/lq.db" \
LIBREQUADRI_TIQUADRI_MDB="$PWD/build/siemens-navigation/sources/tiquadri/BTQUADRI.mdb" \
LIBREQUADRI_LISTINOBT_MDB="$PWD/build/siemens-navigation/sources/tiquadri/ListinoBT.mdb" npm test
```
