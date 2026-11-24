# TiQuadri factory Pannelli audit


Adapter 12 restored 75 factory panel sets in the reviewed TiQuadri v32 master. Adapter 13 adds 12 sets and 28 positions. The import is bound to the reviewed master SHA-256. Factory-only models enter a project through a fixed preset relation to the exact parent model.

## Verified placement

| Gamma | Repaired enclosure packs | Factory positions |
| --- | --- | --- |
| MARINA Precomposto | 13470–13474, 13477 | DIN windows 3524–3527, at the fixed anchors from `ASS_MACRO_CENTRALINI`. The enclosure drawings already show the DIN openings. |
| MARINA Avanquadro | 13613–13614, 13616–13617 | Windows 3624 and 3625. The Megatiker and relay positions are horizontally separate in the 800 mm variant. Both footprints remain printable because the cabinet artwork supplies only positioning marks. |
| MARINA Avanquadro | 13610–13612, 13615 | Both fixed windows are created. Each accepts its source-matched Apparecchi. The placement engine checks device rectangles across the two windows and rejects a collision in either order. |
| Centralini prese P17 Tempra PRO | 34575–34577, 34611–34642 except 34621 and 34624, 34665–34696 | DIN windows 4601–4603 and socket windows 4604–4607, 4697, 4698. The sockets use their source parent-family and ancestor-class matches at the window origin. |
| Centralini prese P17 Tempra PRO | 34621, 34624 | Window 4606 uses (150, 281) mm, the origin of the 105 mm socket opening in both source drawings. The other windows use their original anchors. |
| Centralini › Plexo3 per fotovoltaico | 5385, 5386, 5388–5391 | Windows 2901 and 2902 use the equivalent 12- and 18-module profiles from 2193 and 2194 for class 28004. The respective device-family lists are identical for this class, and all 13 anchors align with the source artwork. |

The 604-model audit used the adapter 12 reimport of a private development catalogue and an in-memory project per cabinet. Each offered model was tested with a representative configuration. The audit found 296 models with a manual Pannello drop, 151 with device placement on a factory Pannello, 47 with neither placement route, and 110 unavailable in Progettazione.

For the repaired sets, the audit checked every one of the 314 factory anchors against the source and exercised a compatible and an incompatible Apparecchio at each position. The factory set did not change Distinta. The preset sweep also covered models outside Progettazione with preset relations and found 151 complete sets, 20 withheld sets, 88 unaddable models, and zero partial sets.

The adapter 13 scratch reimport verified the 28 additional positions, Auto placement in all 12 enclosures, incompatible-device rejection, MARINA overlap rejection in both orders, Undo/Redo, save and reopen, and Distinta. The repeated 259-model preset sweep found 163 complete sets, 8 withheld QDSA sets, 88 unaddable models, and zero partial sets.

## Remaining placement exceptions

Numbers below are TiQuadri pack IDs, stored as `tq.pack.<ID>`.

| Gamma or subcategory | Packs | Blocking evidence |
| --- | --- | --- |
| Centralini › Linea SPACE QDSA | 8050–8053 | Three DIN windows are specified, but the panel-to-enclosure and device-to-enclosure compatibility records omit class `16005`. |
| Centralini › Linea HABITA QDSA | 8054–8057 | Same class `16005` gap as SPACE QDSA. |
| Flatwall › nested Pannelli | 3796, 3798–3804, 3806, 3808–3826, 3828, 3830–3832 | The 131 source occurrences belong to Pannelli and use nonzero relative offsets. They require panel-level mounting semantics. All six Flatwall Carpenterie accepted a manually dropped Pannello. |
| Armadio MARINA | 13452–13460 | No factory relation or compatible manual Pannello was offered. |
| Armadio HDX 4000 | 14, 19, 45, 50, 76, 81, 107, 112, 134, 139, 161, 166 | No factory relation or compatible manual Pannello was offered. |
| Armadio MDX 800 | 188, 193, 198, 203 | No factory relation or compatible manual Pannello was offered. |
| Armadio LDX 800 | 237, 242, 247, 252 | No factory relation or compatible manual Pannello was offered. |
| Armadio LDX400 | 304, 309, 314, 319 | No factory relation or compatible manual Pannello was offered. |

The 110 models outside Progettazione lack an eligible navigation path. Nine BtNet wall racks also lack a base physical profile (`3196–3199`, `3254–3255`, `3310–3312`). The other packs are the legacy CEE enclosures (`4575–4576`, `4611–4696`), the older server rack models (`18000–18003`, `18016–18017`, `18300–18303`, `18316–18317`), and MiniCube Adv `18500`.

## Rollout

Reimport the licensed TiQuadri source into the target catalogue before adding Carpenterie. The corrected sets are created when a new Carpenteria is added. Opening an existing project continues to use its saved engineering snapshot.
