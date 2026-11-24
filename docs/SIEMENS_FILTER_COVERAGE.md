# Siemens imported-description filter coverage


Parser `sie.description` version 1. 212 imported statistical families, 64981 articles; 101474 stored values, 25839 articles with at least one technical/software value beyond article kind. Generated from a disposable catalogue; installed data is unchanged.

Every family is reviewed and mapped to a manufacturer-neutral technical category. The existing Siemens FST tree and public APIs are unchanged. A category is a broad applicability envelope, not proof that every article is a device. Article kind requires a reviewed leading noun, explicit software evidence, or a reviewed accessory/software family. Unrecognized kinds stay unset.

Counts below are actual persisted values (including protected manual/imported facts if present). Supported codes with zero population are listed under gaps. Missing values are not assumed to apply to every article: many articles are accessories or their short description omits the rating. Ambiguity counts are parser candidates withheld, not estimates.

Rules: decimal comma/dot; combined curve/current; Icn and Icu only when labelled; unlabelled kA stays declared capacity; multiple unlabelled capacities/voltages withheld. Current-setting ranges are separate from nominal current. Coil, auxiliary supply and PSU output voltage stay separate; I/O signal voltage is never inferred as supply. No electrical rating comes from product codes. Accessory target references are excluded. IP/axis-labelled dimensions may describe accessories themselves. Unnamed dimensions, short terminal unitless dimensions (pre-truncated Siemens fields), L without a reviewed H/L panel legend, transformer zero-padded power notation or powers inconsistent with the imported up-to-16-kVA family, incomplete units, unreviewed kind nouns, signal ranges, software service packs, implicit licences and ambiguous upgrade versions remain unresolved. AG/AS/AK residual subtypes are not collapsed into type A. Version enums contain explicit imported tokens; a future unknown token requires a reviewed seed/parser update.

Reproduce after building: `node dist/scripts/siemens-filter-coverage.js /absolute/path/to/enriched-copy.db docs/SIEMENS_FILTER_COVERAGE.md`. The command reads the database only. Startup and METEL refresh apply the same transactional classification/enrichment pass; fingerprints include category rules, attribute definitions and parser versions.

## P230 I745 — INTER. APERTI 3WL 3P

1 articles; profile `software`; kinds: software=1; unresolved kind: 0; without technical/software values: 1.

Populated filters: article_kind=1.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 3ZS27911CC110YG0: LIBRERIE PAC3200 PER WINCC EN+AS-RT.

## P230 I852 — ACCESSORI 3NJ6

16 articles; profile `accessories`; kinds: accessory=16; unresolved kind: 0; without technical/software values: 15.

Populated filters: article_kind=16, ip_rating=1.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3NJ69004CB00: COPERTURA CIECA 50MM IP41 PER 3NJ62; 3NJ69203BD21: TA TORO 21MM 100/5A CL 1 2,5VA X 3NJ6.

## P230 I85F — SEZIONATORI 3KA7

1 articles; profile `accessories`; kinds: accessory=1; unresolved kind: 0; without technical/software values: 1.

Populated filters: article_kind=1.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3KX71318AF00: CALOTTE 3 POLI X 3KL718 SPEC..

## P230 I887 — INT PRINC E DI EMERG

2 articles; profile `switching`; kinds: device=2; unresolved kind: 0; without technical/software values: 2.

Populated filters: article_kind=2.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, poles, rated_current, rated_voltage, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 3LD20150TK51: INT.PRINC.3X16A FIX FONDO BLP SPEC.; 3LD20150TK53: INT.EMER.3X16A FIX FONDO BLP SPEC..

## P310 I210 — VALVOLE NEOZED

83 articles; profile `fuses`; kinds: device=30, accessory=27; unresolved kind: 26; without technical/software values: 53.

Populated filters: article_kind=57, rated_current=27, poles=8.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_voltage, software_delivery, software_version, width. Ambiguous: rated_voltage=22, rated_current=3.

Imported examples: 5SE1310: FUS. NEOZED GR D01 10A 250VCC 400VCA; 5SE1316: FUS. NEOZED GR D01 16A 250VCC 400VCA.

## P310 I211 — VALVOLE DIAZED

98 articles; profile `fuses`; kinds: device=48, accessory=15; unresolved kind: 35; without technical/software values: 50.

Populated filters: article_kind=63, rated_current=48, rated_voltage=28, poles=9.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, software_delivery, software_version, width. Ambiguous: rated_voltage=10.

Imported examples: 5SA211: FUS. DIAZED TNDZ E16 2A RIT. 500VCA/CC; 5SA221: FUS. DIAZED TNDZ E16 4A RIT. 500VCA/CC.

## P310 I212 — VALVOLE DIAZED

10 articles; profile `fuses`; kinds: accessory=8; unresolved kind: 2; without technical/software values: 10.

Populated filters: article_kind=8.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, poles, rated_current, rated_voltage, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 3NX1015: MANIGLIA PER FUS. NH GR.00 - 3; 3NX1016: MANIGLIA PER FUS. NH GR00 - 3 PROTETT..

## P310 I213 — VALVOLE NH

444 articles; profile `fuses`; kinds: device=382, accessory=43; unresolved kind: 19; without technical/software values: 63.

Populated filters: article_kind=425, rated_current=378, rated_voltage=378, poles=3.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 3NA3001: FUS. NH GL/GG GR.0 500VCA 6A; 3NA3003: FUS. NH GL/GG GR.0 500VCA 10A.

## P310 I215 — INTERR.DIFFERENZIALI

475 articles; profile `protection`; kinds: device=457, accessory=1; unresolved kind: 17; without technical/software values: 18.

Populated filters: article_kind=458, poles=457, rated_current=455, rated_residual_current=455, residual_current_type=408, trip_curve=449, rated_short_circuit_capacity=7, rated_ultimate_breaking_capacity=7, declared_breaking_capacity=180, rated_voltage=2.

Supported but unpopulated: coil_voltage, depth, diameter, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, trip_unit_type, width. Ambiguous: declared_breaking_capacity=262, rated_current=2.

Imported examples: 5SM23270: BLOCCO DIFF. 2P 100A 30MA TIPO AC X 5SP4; 5SM23276: BLOCCO DIFF. 2P 100A 30MA TIPO A X 5SP4.

## P310 I216 — DIFF. PURI

15 articles; profile `protection`; kinds: device=12; unresolved kind: 3; without technical/software values: 0.

Populated filters: article_kind=12, poles=12, rated_current=12, rated_residual_current=12, residual_current_type=12, ip_rating=3.

Supported but unpopulated: coil_voltage, declared_breaking_capacity, depth, diameter, height, licence_type, rated_short_circuit_capacity, rated_ultimate_breaking_capacity, rated_voltage, software_delivery, software_version, supply_voltage, trip_curve, trip_unit_type, width. Ambiguous: none.

Imported examples: 5SM33150KK: DIFF. 2P 125A 30MA TIPO AC, 2UM; 5SM33156KK: DIFF. 2P 125A 30MA TIPO A 2UM.

## P310 I217 — APP.NON AUT.SIST.N

531 articles; profile `control`; kinds: accessory=10, device=357; unresolved kind: 164; without technical/software values: 257.

Populated filters: article_kind=367, poles=57, rated_current=268, ip_rating=1.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 4AC2402: ALIMENT.ELETTR.85-265VCA-85-300VCC/24VCC; 4AC32080: TRASFXCAMP.8VA SEC.8VCA 50HZ PTC 2UM.

## P310 I21A — INTERUTTORI AUTOMATI

40 articles; profile `protection`; kinds: device=40; unresolved kind: 0; without technical/software values: 0.

Populated filters: article_kind=40, declared_breaking_capacity=32, poles=40, rated_current=40, trip_curve=40, rated_short_circuit_capacity=8, rated_ultimate_breaking_capacity=8.

Supported but unpopulated: coil_voltage, depth, diameter, height, ip_rating, licence_type, rated_residual_current, rated_voltage, residual_current_type, software_delivery, software_version, supply_voltage, trip_unit_type, width. Ambiguous: none.

Imported examples: 5SP41806: INT. MT 10KA 1P B 80A 1,5UM; 5SP41807: INT. MT 10KA 1P C 80A 1,5UM.

## P310 I21B — BASI E FUSIBILI CILI

200 articles; profile `fuses`; kinds: device=55, accessory=61; unresolved kind: 84; without technical/software values: 148.

Populated filters: article_kind=116, rated_voltage=50, rated_current=7, poles=2.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 3NW10060HG: FUS. 10X38 CC UL248-4 RIT.0,6 A 600 VCA; 3NW10080HG: FUS. 10X38 CC UL248-4 RIT.0,8 A 600 VCA.

## P310 I21C — INT. MAGNETOTERMICI

1 articles; profile `protection`; kinds: device=1; unresolved kind: 0; without technical/software values: 0.

Populated filters: article_kind=1, poles=1, rated_current=1, rated_short_circuit_capacity=1, rated_ultimate_breaking_capacity=1, trip_curve=1.

Supported but unpopulated: coil_voltage, declared_breaking_capacity, depth, diameter, height, ip_rating, licence_type, rated_residual_current, rated_voltage, residual_current_type, software_delivery, software_version, supply_voltage, trip_unit_type, width. Ambiguous: none.

Imported examples: 5SY62087: INT MT 2P C8 ICN 6KA ICU 15KA.

## P310 I21E — SCARICATORI

55 articles; profile `protection`; kinds: device=13; unresolved kind: 42; without technical/software values: 46.

Populated filters: article_kind=13, poles=9.

Supported but unpopulated: coil_voltage, declared_breaking_capacity, depth, diameter, height, ip_rating, licence_type, rated_current, rated_residual_current, rated_short_circuit_capacity, rated_ultimate_breaking_capacity, rated_voltage, residual_current_type, software_delivery, software_version, supply_voltage, trip_curve, trip_unit_type, width. Ambiguous: none.

Imported examples: 5SD74011: SPD 1P T1+T2 N-PE UC 255V 100KA CS 2UM; 5SD74112: SCAR.T1 1P UC800VCA RETI 2 FILI L/PEN CS.

## P310 I21F — FUS. EXTRARAP.SITOR

376 articles; profile `fuses`; kinds: device=352, accessory=4; unresolved kind: 20; without technical/software values: 54.

Populated filters: article_kind=356, rated_current=320, rated_voltage=148.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, poles, software_delivery, software_version, width. Ambiguous: rated_voltage=193.

Imported examples: 3NB10151KK10: FUS.SITOR 32A AR 600VCC/900V VSI; 3NB10171KK10: FUS.SITOR 40A AR 600VCC/900V VSI.

## P310 I21G — FUS. EXTRARAP.SITOR

181 articles; profile `fuses`; kinds: device=180; unresolved kind: 1; without technical/software values: 1.

Populated filters: article_kind=180, rated_current=174, rated_voltage=180.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, poles, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 3NC24230C: FUS.SITOR GR 150A/500V GR3 M10 110MM HH; 3NC24233C: FUS.SITOR GR 150A/500V GR3 M10 110MM CH.

## P310 I225 — INTERR.AUTOM. 4,5 KA

66 articles; profile `protection`; kinds: device=66; unresolved kind: 0; without technical/software values: 0.

Populated filters: article_kind=66, declared_breaking_capacity=66, poles=66, rated_current=66, trip_curve=66.

Supported but unpopulated: coil_voltage, depth, diameter, height, ip_rating, licence_type, rated_residual_current, rated_short_circuit_capacity, rated_ultimate_breaking_capacity, rated_voltage, residual_current_type, software_delivery, software_version, supply_voltage, trip_unit_type, width. Ambiguous: none.

Imported examples: 5SL30027: INT MT 1P+N C2 4500A 1UM NEW; 5SL30047: INT MT 1P+N C4 4500A 1UM NEW.

## P310 I227 — INT.AUT. 6KA 5SX

71 articles; profile `protection`; kinds: accessory=6, device=56; unresolved kind: 9; without technical/software values: 15.

Populated filters: article_kind=62, poles=56, rated_current=56, rated_voltage=56, trip_curve=56.

Supported but unpopulated: coil_voltage, declared_breaking_capacity, depth, diameter, height, ip_rating, licence_type, rated_residual_current, rated_short_circuit_capacity, rated_ultimate_breaking_capacity, residual_current_type, software_delivery, software_version, supply_voltage, trip_unit_type, width. Ambiguous: declared_breaking_capacity=56.

Imported examples: 5ST1141: GUIDA PROFILATA 2 METRI; 5ST2134: SUPPORTI ISOLANTI.

## P310 I22M — BLOCCHI DIFF. AC

442 articles; profile `protection`; kinds: device=256, accessory=19; unresolved kind: 167; without technical/software values: 203.

Populated filters: article_kind=275, poles=239, rated_current=218, rated_residual_current=202, residual_current_type=216, declared_breaking_capacity=16, trip_curve=2, rated_voltage=11.

Supported but unpopulated: coil_voltage, depth, diameter, height, ip_rating, licence_type, rated_short_circuit_capacity, rated_ultimate_breaking_capacity, software_delivery, software_version, supply_voltage, trip_unit_type, width. Ambiguous: rated_voltage=8, rated_residual_current=34, rated_current=5.

Imported examples: 5SM23220: BLOCCO DIFF. 2P 40A 30MA TIPO AC X 5SY; 5SM23230: BLOCCO DIFF. 2P 40A 30MA TIPO AC X 5SL.

## P310 I22N — BLOCCHI DIFF. A

58 articles; profile `protection`; kinds: device=36; unresolved kind: 22; without technical/software values: 22.

Populated filters: article_kind=36, poles=36, rated_current=34, rated_residual_current=36, residual_current_type=28, declared_breaking_capacity=6.

Supported but unpopulated: coil_voltage, depth, diameter, height, ip_rating, licence_type, rated_short_circuit_capacity, rated_ultimate_breaking_capacity, rated_voltage, software_delivery, software_version, supply_voltage, trip_curve, trip_unit_type, width. Ambiguous: none.

Imported examples: 5SM21210: BLOCCO DIFF. 2P 16A 10MA TIPO AC X 5SY; 5SM21216: BLOCCO DIFF. 2P 16A 10MA TIPO A X 5SY.

## P310 I22R — INT.AUT. 25KA  5SY8.

336 articles; profile `protection`; kinds: device=333; unresolved kind: 3; without technical/software values: 3.

Populated filters: article_kind=333, declared_breaking_capacity=315, poles=333, rated_current=309, rated_voltage=132, trip_curve=306.

Supported but unpopulated: coil_voltage, depth, diameter, height, ip_rating, licence_type, rated_residual_current, rated_short_circuit_capacity, rated_ultimate_breaking_capacity, residual_current_type, software_delivery, software_version, supply_voltage, trip_unit_type, width. Ambiguous: declared_breaking_capacity=18.

Imported examples: 5SJ41017HG42: INT. MT UL489 480Y/277VAC 10KA 1P C1; 5SJ41018HG42: INT. MT UL489 480Y/277VAC 10KA 1P D1.

## P310 I22Y — INT. AUT. 6/10/15 KA

1831 articles; profile `protection`; kinds: device=1743, accessory=30; unresolved kind: 58; without technical/software values: 94.

Populated filters: article_kind=1773, declared_breaking_capacity=308, poles=1734, rated_current=1730, rated_voltage=97, trip_curve=1686, rated_short_circuit_capacity=1394, rated_ultimate_breaking_capacity=973, ip_rating=3.

Supported but unpopulated: coil_voltage, depth, diameter, height, licence_type, rated_residual_current, residual_current_type, software_delivery, software_version, supply_voltage, trip_unit_type, width. Ambiguous: declared_breaking_capacity=16.

Imported examples: 5SJ41017HG40: INT. MT UL489 1P C 1A 15KA 240VCA; 5SJ41017HG41: INT. MT UL489 OPP.POL.1P C 1A 14KA.

## P310 I22Z — INT. AUT. 6KA 1/3P 5

52 articles; profile `protection`; kinds: device=52; unresolved kind: 0; without technical/software values: 0.

Populated filters: article_kind=52, poles=52, rated_current=52, rated_short_circuit_capacity=52, rated_ultimate_breaking_capacity=52, trip_curve=52.

Supported but unpopulated: coil_voltage, declared_breaking_capacity, depth, diameter, height, ip_rating, licence_type, rated_residual_current, rated_voltage, residual_current_type, software_delivery, software_version, supply_voltage, trip_unit_type, width. Ambiguous: none.

Imported examples: 5SY61017: INT MT 1P C1 ICN 6KA ICU 30KA; 5SY61037: INT MT 1P C3 ICN 6KA ICU 30KA.

## P310 I430 — OROLOGI INTERRUTTORI

47 articles; profile `control`; kinds: device=20, accessory=1; unresolved kind: 26; without technical/software values: 46.

Populated filters: article_kind=21, ip_rating=1.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, licence_type, poles, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 7KT5500: CONTAORE 48X48MM 10-80V CC; 7KT5501: CONTAORE 48X48MM 115V CA 50HZ.

## P310 I769 — SIVACON S4 SCIOLTO

2067 articles; profile `enclosures`; kinds: accessory=691, device=733; unresolved kind: 643; without technical/software values: 761.

Populated filters: article_kind=1424, height=889, width=929, depth=1079, ip_rating=909.

Supported but unpopulated: diameter, licence_type, software_delivery, software_version. Ambiguous: ip_rating=7.

Imported examples: 8MF10002AA020: PIASTRA MONTAGGIO H1000 L1000; 8MF10002AA120: PIASTRA MONTAGGIO FORATA H1000 L1000.

## P311 I217 — APP.NON AUT.SIST.N

1 articles; profile `control`; kinds: none; unresolved kind: 1; without technical/software values: 1.

Populated filters: none.

Supported but unpopulated: analog_inputs, analog_outputs, article_kind, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, poles, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 5TG80581: LED ROSSO 230 VCA X 5TE48-5TE58.

## P320 I222 — STAB/SIKUS SCIOLTO

3 articles; profile `accessories`; kinds: accessory=3; unresolved kind: 0; without technical/software values: 3.

Populated filters: article_kind=3.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 8GD9084: MARCHIO SIEMENS DI ALLUMINIO; 8GD9132: TASCA PORTASCHEMI.

## P320 I22C — STAB UNIVERSAL SCIOL

9 articles; profile `accessories`; kinds: accessory=9; unresolved kind: 0; without technical/software values: 9.

Populated filters: article_kind=9.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 8GF9657: GUIDA PER SUPP.SBARRE H1400(COPPIA); 8GF96701: ADATTATORE DA 55 A 70MM TRANCIABILE.

## P320 I22G — QUADRI E CENTR. SPOR

26 articles; profile `enclosures`; kinds: device=16, accessory=7; unresolved kind: 3; without technical/software values: 10.

Populated filters: article_kind=23, ip_rating=16.

Supported but unpopulated: depth, diameter, height, licence_type, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 8GB11311BB00: SIMBOX SE INC. IP40 8 U.M. P.TRASP.; 8GB11312BB00: SIMBOX SE INC. IP40 12 U.M. P.TRASP..

## P320 I22H — ALPHA SCIOLTO STEP3

208 articles; profile `enclosures`; kinds: device=10, accessory=77; unresolved kind: 121; without technical/software values: 6.

Populated filters: article_kind=87, depth=19, height=200, width=135, ip_rating=54.

Supported but unpopulated: diameter, licence_type, software_delivery, software_version. Ambiguous: depth=19, ip_rating=15, width=36.

Imported examples: 8GK20420KL21: ALPHA SP.IP43COMPL.P.LAM.B600 H400 P140; 8GK20420KM21: ALPHA SP.IP43 COMPL.P.TR.B600 H400 P140.

## P320 I22T — ALPHA 125 SCIOLTO

9 articles; profile `enclosures`; kinds: accessory=7; unresolved kind: 2; without technical/software values: 7.

Populated filters: article_kind=7, width=2.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, software_delivery, software_version. Ambiguous: none.

Imported examples: 8GK95073KK20: PORTA TRASP.CORNICE PER INC.B600 H400; 8GK95074KK20: PORTA TRASP.CORNICE PER INC.B600 H600.

## P320 I22U — ALPHA 630 SCIOLTO

334 articles; profile `enclosures`; kinds: accessory=87; unresolved kind: 247; without technical/software values: 74.

Populated filters: article_kind=87, ip_rating=59, width=196, height=220, depth=41.

Supported but unpopulated: diameter, licence_type, software_delivery, software_version. Ambiguous: ip_rating=7, height=3.

Imported examples: 8GF4317: GUARNIZIONE DI TENUTA IP55 (10MT.); 8GF5760: SUPPORTO SBARRE GRAD.15X5/20X5/30X5.

## P320 I241 — ALPHA BOX

57 articles; profile `enclosures`; kinds: device=57; unresolved kind: 0; without technical/software values: 6.

Populated filters: article_kind=57, depth=29, height=51, width=45.

Supported but unpopulated: diameter, ip_rating, licence_type, software_delivery, software_version. Ambiguous: none.

Imported examples: 8GM10302BB30: ALPHA BOX H300 B300 P150+P.MONT.+P.CIE; 8GM10403BB30: ALPHA BOX H400 B300 P200+P.MONT.+P.CIE.

## P320 I260 — MORSETTI 8WA2

18 articles; profile `terminals`; kinds: accessory=3; unresolved kind: 15; without technical/software values: 18.

Populated filters: article_kind=3.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_current, rated_voltage, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 8WA2867: MORSETTO DI ALIMENTAZIONE; 8WA2868: MORSETTODI ALIMENTAZIONE.

## P320 I262 — MORSETTI 8WH

548 articles; profile `terminals`; kinds: accessory=72; unresolved kind: 476; without technical/software values: 547.

Populated filters: article_kind=72, width=1.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_current, rated_voltage, software_delivery, software_version. Ambiguous: none.

Imported examples: 8WH10000AF00: MORSETTO GR.2,5 COLORE GRIGIO; 8WH10000AF01: MORSETTO PASS. GR.2,5 MM BLU.

## P320 I270 — CONTRASSEGNI 8WA8

10 articles; profile `accessories`; kinds: accessory=10; unresolved kind: 0; without technical/software values: 10.

Populated filters: article_kind=10.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 8WH90001GD00: COPERTURA X MORS. MOLLA 3 LIV.; 8WH90604BA00: PORTATARGH X MORS MOLLA 3 LIV..

## P360 I740 — INTERR. SCATOLATI 3V

123 articles; profile `protection`; kinds: accessory=87, device=32; unresolved kind: 4; without technical/software values: 123.

Populated filters: article_kind=119.

Supported but unpopulated: coil_voltage, declared_breaking_capacity, depth, diameter, height, ip_rating, licence_type, poles, rated_current, rated_residual_current, rated_short_circuit_capacity, rated_ultimate_breaking_capacity, rated_voltage, residual_current_type, software_delivery, software_version, supply_voltage, trip_curve, trip_unit_type, width. Ambiguous: none.

Imported examples: 4NC51120CB21: TRASF.AMPEROMETRICO, CL 1,  50A/1A, 2,5V; 4NC51122CB21: TRASF.AMPEROMETRICO 50/5A 1,2VA CL 1.

## P360 I741 — INTERR. SCATOLATI 3VL-UL

80 articles; profile `protection`; kinds: accessory=17, device=16; unresolved kind: 47; without technical/software values: 64.

Populated filters: article_kind=33, declared_breaking_capacity=16, rated_current=16, poles=2.

Supported but unpopulated: coil_voltage, depth, diameter, height, ip_rating, licence_type, rated_residual_current, rated_short_circuit_capacity, rated_ultimate_breaking_capacity, rated_voltage, residual_current_type, software_delivery, software_version, supply_voltage, trip_curve, trip_unit_type, width. Ambiguous: none.

Imported examples: IT2CFS11AUX: AUX 1NO PER CFS 30-800A PER CFSNFPA2; IT2CFS22AUX: AUX 1NO 2NC PER CFS 30-800A PER CFSNFPA2.

## P360 I745 — INTERR APERTI 3WL 3 POLI

52 articles; profile `protection`; kinds: accessory=5, software=8, device=5; unresolved kind: 34; without technical/software values: 42.

Populated filters: article_kind=18, rated_voltage=4, software_version=6.

Supported but unpopulated: coil_voltage, declared_breaking_capacity, depth, diameter, height, ip_rating, licence_type, poles, rated_current, rated_residual_current, rated_short_circuit_capacity, rated_ultimate_breaking_capacity, residual_current_type, software_delivery, supply_voltage, trip_curve, trip_unit_type, width. Ambiguous: software_delivery=1.

Imported examples: 3KC90008TL50: ATC6500 DISPOSITIVO DI COMMUTAZIONE; 3KC90008TL68: COPERTURA PROTETTIVA X ATC6300.

## P360 I746 — POWER MONITORING DEVICE

43 articles; profile `measurement`; kinds: device=39; unresolved kind: 4; without technical/software values: 43.

Populated filters: article_kind=39.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 7KM22002EA301CA1: PAC2200 5A M-BUS; 7KM22002EA301DA1: PAC2200 5A MODBUS RTU.

## P360 I74L — INTERR. AUTOM. SCATO

8676 articles; profile `protection`; kinds: device=3156, accessory=342; unresolved kind: 5178; without technical/software values: 5539.

Populated filters: article_kind=3498, declared_breaking_capacity=3109, poles=3133, rated_current=3067, trip_unit_type=3105, rated_voltage=2.

Supported but unpopulated: coil_voltage, depth, diameter, height, ip_rating, licence_type, rated_residual_current, rated_short_circuit_capacity, rated_ultimate_breaking_capacity, residual_current_type, software_delivery, software_version, supply_voltage, trip_curve, width. Ambiguous: none.

Imported examples: 3VA10102ED320AA0: INT.AUT.3VA 100A 3P 16KA TM FTFM L/T; 3VA10102ED360AA0: INT.AUT.3VA 100A 3P 16KA TM FTFM B/T.

## P360 I851 — SEZ SOTTOCARICO A FU

414 articles; profile `switching`; kinds: device=211, accessory=9; unresolved kind: 194; without technical/software values: 229.

Populated filters: article_kind=220, rated_current=185, poles=36.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_voltage, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 3NP11131BC20: SEZ.FUS. STRET. NH000 125A 60MM MORS.INF; 3NP11131BC26: SEZ.FUS.NH000 125A AL.INF.60MM MOR.+1CO.

## P360 I852 — SEZ SOTTOCARICO A FU

306 articles; profile `switching`; kinds: device=92, accessory=57; unresolved kind: 157; without technical/software values: 216.

Populated filters: article_kind=149, rated_current=88, poles=87, rated_voltage=1, ip_rating=1.

Supported but unpopulated: depth, diameter, height, licence_type, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 3NJ41013BF01: SEZ A FUS NH00 1 POLO SEZ 160A; 3NJ41033BF01: SEZ. VERT. 3P-SEZ NH00 160A ALL.M8.

## P360 I853 — SEZ SOT CON SENZA FU

1094 articles; profile `switching`; kinds: device=533, accessory=130; unresolved kind: 431; without technical/software values: 570.

Populated filters: article_kind=663, poles=503, rated_current=524, rated_voltage=73.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 3KC03162ME000AA0: COMM MANUALE MTSE ORIZZONT. DIN 16A 3P; 3KC03222ME000AA0: COMM MANUALE MTSE ORIZZONT. DIN 32A 3P.

## P360 I85A — SEZ SOTTOCARICO ITL

276 articles; profile `switching`; kinds: device=275, accessory=1; unresolved kind: 0; without technical/software values: 198.

Populated filters: article_kind=276, rated_voltage=78.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, poles, rated_current, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 3KA71113AA00: SEZIONATORE 3X32A SENZA COMANDO; 3KA71123AA00: SEZIONATORE 3X45A SENZA COMANDO.

## P360 I85F — SEZ SOTTOCARICO ITL

479 articles; profile `switching`; kinds: device=290, accessory=29; unresolved kind: 160; without technical/software values: 401.

Populated filters: article_kind=319, rated_voltage=78.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, poles, rated_current, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 3KA71013AF00: COMMUTATORE 3X16A DIN; 3KA71013AF01: COMMUTATORE 3X25A DIN.

## P360 I887 — INT PRINC E DI EMERG

662 articles; profile `switching`; kinds: device=562, accessory=32; unresolved kind: 68; without technical/software values: 592.

Populated filters: article_kind=594, ip_rating=6, rated_current=61, rated_voltage=3, poles=60.

Supported but unpopulated: depth, diameter, height, licence_type, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 3LD20030TK51: INT.PRINC.3X16A FIX.FRONT.; 3LD20030TK53: INT.EMER.3X16A FIX.FRONT..

## P360 I888 — SIST DI DISTRIBUZ A

136 articles; profile `accessories`; kinds: accessory=136; unresolved kind: 0; without technical/software values: 136.

Populated filters: article_kind=136.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 8US12104AF00: ADAT.X SBARRE 60MM X3K.52/53,3NP42; 8US12111NS10: ADATT. SBARRE 60MM X 3RA6.

## P360 I894 — POWER MONITORING DEVICE

3 articles; profile `measurement`; kinds: device=3; unresolved kind: 0; without technical/software values: 3.

Populated filters: article_kind=3.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 7KM10200BA011DA0: PAC1020 (VERS. 230V AC/DC); 7KM22002EA001JB1: PAC2200 INSERZ. TA MODBUS TCP (CLP).

## P372 I747 — CONDENSATORI

225 articles; profile `reactive`; kinds: accessory=3; unresolved kind: 222; without technical/software values: 225.

Populated filters: article_kind=3.

Supported but unpopulated: apparent_power, depth, diameter, height, ip_rating, licence_type, rated_current, rated_voltage, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 4LP14: BOBINA FILTRO 12,5KVAR-400V-50HZ  7%; 4LP16: BOBINA FILTRO 25KVAR-400V-50HZ  7%.

## P372 I769 — SIVACON

1249 articles; profile `enclosures`; kinds: device=27, accessory=399; unresolved kind: 823; without technical/software values: 337.

Populated filters: article_kind=426, ip_rating=420, height=435, width=620, depth=216.

Supported but unpopulated: diameter, licence_type, software_delivery, software_version. Ambiguous: height=4, depth=1.

Imported examples: 8MR21224A: SOFFIANTE COMPATTO 230VAC,250W; 8MR21224AB: SOFFIANTE COMPATTO 24VDC,250W.

## P373 I73M — BLINDOSBARRE MOELLER

555 articles; profile `distribution`; kinds: none; unresolved kind: 555; without technical/software values: 543.

Populated filters: ip_rating=12.

Supported but unpopulated: article_kind, depth, diameter, height, licence_type, poles, rated_current, rated_voltage, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 8PS50420AA003AA3: BD2-AK02X-RCBO163NC-PLT2; 8PS50420AA003AA4: BD2-AK02X-RCBO203NC-PLT2.

## P380 I213 — VALVOLE NH

9 articles; profile `measurement`; kinds: device=9; unresolved kind: 0; without technical/software values: 9.

Populated filters: article_kind=9.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 7KT12805MA00: TRAFO APRIBILE SEM3 50:0.1; 7KT12805MA01: TRAFO APRIBILE SEM3 125:0.1.

## R132 IC10 — SIMATIC STEP 7 TIA PORTAL E CLASSIC

37 articles; profile `software`; kinds: software=37; unresolved kind: 0; without technical/software values: 5.

Populated filters: article_kind=37, licence_type=7, software_version=29, software_delivery=11.

Supported but unpopulated: depth, diameter, height, ip_rating, width. Ambiguous: software_version=2.

Imported examples: 6ES78104CE120JB5: STEP 7 V5.7 SP3 JAPANESE DL, FL; 6ES78104CE120JE5: STEP 7 V5.7 SP3 JAPANESE UPGRADE DL.

## R132 IC12 — SIMATIC, S7-1200

167 articles; profile `automation`; kinds: device=33, accessory=1; unresolved kind: 133; without technical/software values: 141.

Populated filters: analog_inputs=18, article_kind=34, digital_inputs=22, digital_outputs=20, analog_outputs=5.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ES72111AE400XB0: CPU 1211C, DC/DC/DC, 6DI/4DO/2AI; 6ES72111BE400XB0: CPU 1211C, AC/DC/RELAY, 6DI/4DO/2AI.

## R132 IC13 — SIMATIC, S7-300 CPU

8 articles; profile `automation`; kinds: accessory=6; unresolved kind: 2; without technical/software values: 8.

Populated filters: article_kind=6.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ES79538LF310AA0: S7 MICRO MEMORY CARD, 64KB; 6ES79538LG310AA0: S7 MICRO MEMORY CARD, 128KB.

## R132 IC14 — SIMATIC, S7-1500

37 articles; profile `automation`; kinds: device=25; unresolved kind: 12; without technical/software values: 37.

Populated filters: article_kind=25.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ES71944AP000AA0: ET 200PRO, CM CPU 2PN M12, 7/8; 6ES75004AP000AB0: BMW S7-1518-4 PN/DP.

## R132 IC16 — SIMATIC, S7-1500H

15 articles; profile `automation`; kinds: device=9, accessory=3; unresolved kind: 3; without technical/software values: 15.

Populated filters: article_kind=12.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ES75000HQ000AB0: S7-1500H SYSTEM BUNDLE, CPU 1517H; 6ES75000JP000AB0: S7-1500HF SYSTEM BUNDLE, CPU 1518HF.

## R132 IC17 — ET200SP OPEN CONTROLLER

13 articles; profile `automation`; kinds: device=4; unresolved kind: 9; without technical/software values: 13.

Populated filters: article_kind=4.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ES76772DB420GB0: SIMATIC CPU 1515SP PC2; 6ES76772DB420GB1: SIMATIC CPU1515SP PC2.

## R132 IC19 — SCE R132

22 articles; profile `automation`; kinds: none; unresolved kind: 22; without technical/software values: 22.

Populated filters: none.

Supported but unpopulated: analog_inputs, analog_outputs, article_kind, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ED10573SA200YA1: LOGO! 8 TRAINING PACKAGE 12/24RCE; 6ED10573SA200YB1: LOGO! 8 TRAINING PACKAGE 230RCE.

## R132 IC20 — MODULO LOGICO LOGO!

58 articles; profile `automation`; kinds: device=12; unresolved kind: 46; without technical/software values: 46.

Populated filters: article_kind=12, digital_inputs=12, digital_outputs=12, analog_inputs=6.

Supported but unpopulated: analog_outputs, depth, diameter, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ED10521CC080BA2: LOGO! 24CE, 8DI(4AI)/4DO, 400 BLOCKS; 6ED10521CC080BA3: LOGO! 24CE, 8DI(4AI)/4DO, 800 BLOCKS.

## R134 IC41 — STEP 7 TIA PORTAL OPZIONI

30 articles; profile `software`; kinds: software=30; unresolved kind: 0; without technical/software values: 7.

Populated filters: article_kind=30, software_delivery=10, software_version=19.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, width. Ambiguous: none.

Imported examples: 6ES78105AA002YL0: STEP 7 PROFESSIONAL COMBO SUS PER UCL; 6ES78105CC002YE0: SIMATIC S7 STEP7 PRO EPL LIC.

## R134 IC43 — SW OPEN CONTROLLER

21 articles; profile `software`; kinds: software=21; unresolved kind: 0; without technical/software values: 17.

Populated filters: article_kind=21, software_delivery=2, software_version=2.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, width. Ambiguous: none.

Imported examples: 6ES76727AC010YA0: SIMATIC SOFTWARE CONTROLLER CPU 1507S; 6ES76727AC010YG0: SIMATIC SOFTWARE CONTROLLER CPU 1507S DL.

## R134 IC44 — STEP 7 TIA PORTAL

117 articles; profile `software`; kinds: software=117; unresolved kind: 0; without technical/software values: 4.

Populated filters: article_kind=117, software_delivery=61, licence_type=18, software_version=94.

Supported but unpopulated: depth, diameter, height, ip_rating, width. Ambiguous: software_version=5.

Imported examples: 6ES78104BC010YX2: STEP7 SW UPDATE SERVICE SUS; 6ES78104CC120JA5: STEP7 V5.7  JAPANESE FLOATING LIC..

## R135 IC51 — S7-300 IO

13 articles; profile `automation`; kinds: none; unresolved kind: 13; without technical/software values: 13.

Populated filters: none.

Supported but unpopulated: analog_inputs, analog_outputs, article_kind, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ES73921BJ001AB0: FRONT CONN, 20PIN, SPRING CONT., 100PCS; 6ES73922XX000AA0: LABELING STRIPS 20-PIN, 10 PCS.

## R135 IC52 — S7-1500 IO

86 articles; profile `automation`; kinds: device=56, accessory=6; unresolved kind: 24; without technical/software values: 47.

Populated filters: article_kind=62, digital_inputs=10, digital_outputs=15, analog_inputs=10, analog_outputs=6.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ES71555AA000AA0: ET 200MP, IM 155-5 PN BA; 6ES71555AA010AB0: ET 200MP, IM 155-5 PN ST.

## R135 IC53 — SIMATIC DP IO

160 articles; profile `automation`; kinds: device=113, accessory=1; unresolved kind: 46; without technical/software values: 134.

Populated filters: article_kind=114, digital_inputs=8, digital_outputs=11, analog_inputs=6, analog_outputs=2.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ES57108MA11: STANDSECTIONAL RAIL 35MM, LENGTH 483MM; 6ES57108MA21: STANDSECTIONAL RAIL 35MM, LENGTH 530MM.

## R135 IC54 — SIMATIC DP ET200 SP

257 articles; profile `automation`; kinds: device=108, accessory=1; unresolved kind: 148; without technical/software values: 193.

Populated filters: article_kind=109, digital_inputs=19, digital_outputs=24, analog_inputs=16, analog_outputs=5.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ES71316BF000CA0: ET 200SP, DI 8X24VDC HF; 6ES71316BF000DA0: ET 200SP, DI 8X24VDC HIGH SPEED.

## R135 IC55 — SIPLUS RIC

9 articles; profile `automation`; kinds: software=1, device=1; unresolved kind: 7; without technical/software values: 9.

Populated filters: article_kind=2.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6AG60030CF010AA0: SIPLUS RIC PER SIMATIC WIN AC DL; 6AG60031CF010DA0: SIPLUS RIC FOR SIMATIC S7-300 LICENCE DL.

## R135 IC56 — SIMATIC MODBUS SIMEAS

155 articles; profile `automation`; kinds: accessory=4, device=2; unresolved kind: 149; without technical/software values: 155.

Populated filters: article_kind=6.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 2XV94501MB00: SIMATIC MODBUS/TCP CP; 2XV94501MB02: SIMATIC MODBUS/TCP PN-CPU.

## R135 IC57 — SCE R135

5 articles; profile `automation`; kinds: none; unresolved kind: 5; without technical/software values: 5.

Populated filters: none.

Supported but unpopulated: analog_inputs, analog_outputs, article_kind, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ES71556AU000AB0: TRAINING BUNDLE ET 200SP BASIC; 6ES71556AU000AB1: SCHULUNGSPAKET ET 200SP ENERGY.

## R136 IC60 — SIMATIC FAILSAFE SW

55 articles; profile `software`; kinds: software=55; unresolved kind: 0; without technical/software values: 11.

Populated filters: article_kind=55, software_delivery=18, software_version=39.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, width. Ambiguous: none.

Imported examples: 6ES78331FA002YX0: STEP 7  SAFETY ADVANCED, EPL-MASTER; 6ES78331FA132YQ0: STEP 7 SAFETY ADV. EPL-ROYALTY.

## R136 IC61 — S7-300F, SIMATIC DP FAILSAFE

28 articles; profile `automation`; kinds: device=21, accessory=1; unresolved kind: 6; without technical/software values: 19.

Populated filters: analog_inputs=2, article_kind=22, digital_inputs=2, digital_outputs=5, ip_rating=1.

Supported but unpopulated: analog_outputs, depth, diameter, height, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ES71366AA000CA1: ET 200SP, F-AI 4XI (0)4..20MA HF; 6ES71366AB000CA1: ET 200SP, F-AI 4XU 0..10V HF.

## R136 IC62 — S7-1200F,F-SW BASIC

13 articles; profile `automation`; kinds: device=10; unresolved kind: 3; without technical/software values: 3.

Populated filters: analog_inputs=6, article_kind=10, digital_inputs=10, digital_outputs=10, analog_outputs=2.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ES72121AF400XB0: CPU 1212FC ,DC/DC/DC, 8DI/6DO/2AI; 6ES72121AF500XB0: CPU 1212FC ,DC/DC/DC, 8DI/6DQ.

## R136 IC63 — S7-1500F, F-SW ADV.

52 articles; profile `automation`; kinds: device=23; unresolved kind: 29; without technical/software values: 49.

Populated filters: article_kind=23, digital_inputs=1, digital_outputs=1, analog_inputs=1.

Supported but unpopulated: analog_outputs, depth, diameter, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ES75004FP000AB0: BMW CPU 1518F-4 PN/DP; 6ES75101SK030AB0: CPU1510SP F-1 PN, 300KB PROG., 1MB DATA.

## R136 IC64 — SCE R136

6 articles; profile `automation`; kinds: none; unresolved kind: 6; without technical/software values: 6.

Populated filters: none.

Supported but unpopulated: analog_inputs, analog_outputs, article_kind, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ES71366BA000AB1: TRAINING BUNDLE SAFETY ET 200SP; 6ES75121SK004AB2: PACCH. DI FORMAZIONE CPU 1512SP F-1 PN.

## R141 IH01 — HMI PANELS

471 articles; profile `automation`; kinds: device=109, accessory=20; unresolved kind: 342; without technical/software values: 466.

Populated filters: article_kind=129, ip_rating=5.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6AV21232DB030AX0: SIMATIC HMI KTP400 BASIC; 6AV21232GA030AX0: SIMATIC HMI KTP700 BASIC DP.

## R141 IH04 — IPC CUSTOM

224 articles; profile `automation`; kinds: software=5, device=113; unresolved kind: 106; without technical/software values: 223.

Populated filters: article_kind=118, ip_rating=1.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 2XV94501CB00: SOFTNET TF/APRED/UNIX SPARC; 2XV94501CF03: SOFTBUS-SOFTNET-S7/SPARC.

## R141 IH05 — IPC CUSTOM

98 articles; profile `automation`; kinds: none; unresolved kind: 98; without technical/software values: 98.

Populated filters: none.

Supported but unpopulated: analog_inputs, analog_outputs, article_kind, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6AV21446QE031AS0: OEM STAZIONE OPER. TP1500 COMFORT PANEL; 6AV66461BA120AA1: SIMATIC ITC1200 V3.

## R141 IH07 — SCE: HMI SOFTWARE

8 articles; profile `automation`; kinds: none; unresolved kind: 8; without technical/software values: 8.

Populated filters: none.

Supported but unpopulated: analog_inputs, analog_outputs, article_kind, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6AV21232DB030AA0: SCHOOL PACKAGE KTP400 BASIC / XB005; 6AV21232DB030AA1: SCHOOL PACKAGE KTP400 BASIC / XB005.

## R141 IH08 — PRODOTTI SIPLUS

598 articles; profile `automation`; kinds: device=6; unresolved kind: 592; without technical/software values: 588.

Populated filters: ip_rating=8, article_kind=6, digital_inputs=1, digital_outputs=1.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, height, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6AG10101AU004AA0: SIPLUS SIMOCODE PRO V (BASIC UNIT 2); 6AG10210AD122CA2: SIPLUS IPC 127 E.

## R144 IH40 — RACK PC/BOXPC

528 articles; profile `automation`; kinds: accessory=9, device=433; unresolved kind: 86; without technical/software values: 528.

Populated filters: article_kind=442.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6AG40210AA200AA1: MOUNTING SET DIN-RAIL, IPC127E; 6AG40210AA200AA2: KIT MONTAGGIO A PARETE, IPC127E.

## R144 IH41 — FIELD PG

20 articles; profile `automation`; kinds: device=9, accessory=2; unresolved kind: 9; without technical/software values: 20.

Populated filters: article_kind=11.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ES77302AA020EB0: SIMATIC IPC MD-57A; 6ES77302AA160FB0: SIMATIC IPC MD-57A.

## R144 IH42 — PANEL PC

375 articles; profile `automation`; kinds: device=292, accessory=5; unresolved kind: 78; without technical/software values: 375.

Populated filters: article_kind=297.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6AG41423FE103AB0: SIMATIC IPC BX-39A; 6AG41525BB103AB1: SIMATIC IPC BX-32A.

## R144 IH43 — SIMATIC BASIC IPC

314 articles; profile `automation`; kinds: device=314; unresolved kind: 0; without technical/software values: 314.

Populated filters: article_kind=314.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6AG40113BA340AX1: SIMATIC IPC RW-543A; 6AG40113BC140AX1: SIMATIC IPC RW-543A.

## R1DS ILG9 — SIMATIC SYSTEM, PLATFORM

81 articles; profile `software`; kinds: software=81; unresolved kind: 0; without technical/software values: 50.

Populated filters: article_kind=81, software_version=25, software_delivery=15.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, width. Ambiguous: none.

Imported examples: 6AV21152BA023AA0: WINCC RT PROF. V19 (128) SW PACKAGE; 6ES71950AA050XA0: ASIC ASPC2 STEP E2 LEADFREE, 6 PC.

## R1OS IE10 — HUMAN MACHINE INTERFACE SW

2069 articles; profile `software`; kinds: software=2069; unresolved kind: 0; without technical/software values: 302.

Populated filters: article_kind=2069, software_version=1235, software_delivery=704, licence_type=49.

Supported but unpopulated: depth, diameter, height, ip_rating, width. Ambiguous: software_version=480.

Imported examples: 6AV21000AA023AA5: SIMATIC WINCC BASIC V19; 6AV21000AA023AH5: WINCC BASIC V19 DL.

## R1OS IE11 — WINCC OA

843 articles; profile `software`; kinds: software=843; unresolved kind: 0; without technical/software values: 571.

Populated filters: article_kind=843, licence_type=7, software_delivery=267.

Supported but unpopulated: depth, diameter, height, ip_rating, software_version, width. Ambiguous: none.

Imported examples: 6AV63551AA318HA0: WINCC OA - TOPOLOGY PACKAGE; 6AV63551AA318HB0: WINCC OA - APM PACKAGE.

## R1OS IE12 — SIMATIC WINCC

136 articles; profile `software`; kinds: software=136; unresolved kind: 0; without technical/software values: 78.

Populated filters: article_kind=136, software_version=47, software_delivery=31.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, width. Ambiguous: none.

Imported examples: 6AV21040BA070AA0: WINCC RUNTIME ADVANCED 128 V17; 6AV21040BA070AH0: WINCC RUNTIME ADVANCED 128, V17 DL.

## R1OS IE13 — ENERGYMANAGEMENT

108 articles; profile `software`; kinds: software=108; unresolved kind: 0; without technical/software values: 51.

Populated filters: article_kind=108, software_version=46, software_delivery=41, licence_type=2.

Supported but unpopulated: depth, diameter, height, ip_rating, width. Ambiguous: none.

Imported examples: 6AV21081CF000BB0: S7 EE-MONITOR S7-1500/1200; 6AV21081CF000BH0: S7 EE-MONITOR S7-1500/1200 DL.

## R1OS IE14 — BRAUMAT

141 articles; profile `software`; kinds: software=141; unresolved kind: 0; without technical/software values: 95.

Populated filters: article_kind=141, software_delivery=42, software_version=2, licence_type=2.

Supported but unpopulated: depth, diameter, height, ip_rating, width. Ambiguous: none.

Imported examples: 6DL52100AX080YA5: BRAUMAT,SISTAR ENGINEERING 8.1 SP1; 6DL52100AX080YE5: BRAUMAT,SISTAR ENGINEER. UP 7.5>8.1 SP1.

## R1OS IE16 — SCE: WINCC CLASSIC

6 articles; profile `software`; kinds: software=6; unresolved kind: 0; without technical/software values: 3.

Populated filters: article_kind=6, software_version=3, software_delivery=1.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, width. Ambiguous: none.

Imported examples: 6AV63711DH081AV5: WINCC/WEB NAV TRAINER PACKAGE V8.1 ASIA; 6AV63711DH081AX5: WINCC/WEB NAV TRAINER PACKAGE V8.1.

## R1OS IE29 — HMI R1OS OTHERS

8 articles; profile `software`; kinds: software=8; unresolved kind: 0; without technical/software values: 1.

Populated filters: article_kind=8, software_version=7.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, software_delivery, width. Ambiguous: none.

Imported examples: 6AV21550HM017LB0: SIMATIC CFL V1.1 (1 HMI RT) PROMO DL; 6AV21550LM017LA0: SIMATIC LIVE LINK V1.0 DL - PROMOTION.

## R220 I0HT — SIDOOR

55 articles; profile `motors`; kinds: device=6, software=1; unresolved kind: 48; without technical/software values: 55.

Populated filters: article_kind=7.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_current, rated_power, rated_torque, rated_voltage, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 6FB11030AT103MC0: MOTORE AT40 (400 KG) ROTAZIONE SX; 6FB11030AT103MD0: SIDOOR M5 L MOTORE AT.

## R220 I657 — SINAMICS G120 PM 240

115 articles; profile `drives`; kinds: device=115; unresolved kind: 0; without technical/software values: 14.

Populated filters: article_kind=115, ip_rating=92, rated_power=101, rated_voltage=92.

Supported but unpopulated: depth, diameter, height, licence_type, rated_current, rated_torque, software_delivery, software_version, supply_voltage, width. Ambiguous: rated_voltage=9.

Imported examples: 6SL32101PB130AL0: SINAMICS PM240-2 IP20-FSA-A-230V-0.55KW; 6SL32101PB130UL0: SINAMICS PM240-2 IP20-FSA-U-230V-0.55KW.

## R220 I658 — SINAMICS G120 OPZIONI

1 articles; profile `accessories`; kinds: device=1; unresolved kind: 0; without technical/software values: 1.

Populated filters: article_kind=1.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6SL32550BW010NA0: SINAMICS CONTROL UNIT ADAPTER KIT CUA20.

## R220 I659 — SINAMICS G120 DOC/ACCESSORI

124 articles; profile `accessories`; kinds: accessory=71, device=53; unresolved kind: 0; without technical/software values: 116.

Populated filters: article_kind=124, ip_rating=8.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6SE64002FA006AD0: MICROMASTER 4 FILTRO EMC; 6SE64002FL010AB0: MICROMASTER 4 FILTRO EMC.

## R220 I660 — SINAMICS G120 PM250

25 articles; profile `drives`; kinds: device=25; unresolved kind: 0; without technical/software values: 0.

Populated filters: article_kind=25, ip_rating=25, rated_power=25, rated_voltage=25.

Supported but unpopulated: depth, diameter, height, licence_type, rated_current, rated_torque, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6SL32250BE255AA1: SINAMICS PM250-IP20-FSC-A-400V 5,5KW; 6SL32250BE275AA1: SINAMICS PM250-IP20-FSC-A-400V 7,5KW.

## R220 I661 — SINAMICS G120D

10 articles; profile `drives`; kinds: device=10; unresolved kind: 0; without technical/software values: 10.

Populated filters: article_kind=10.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_current, rated_power, rated_torque, rated_voltage, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6SL35440FB201FA0: SINAMICS G120D CU240D-2 PN; 6SL35440FB201PA0: SINAMICS G120D CU240D-2 DP.

## R220 I664 — SINAMICS G110D

1 articles; profile `accessories`; kinds: device=1; unresolved kind: 0; without technical/software values: 1.

Populated filters: article_kind=1.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6SL35550PA002AA0: SINAMICS G120D USB INTERFACE CABLE.

## R220 I666 — SINAMICS G120C

93 articles; profile `drives`; kinds: device=91; unresolved kind: 2; without technical/software values: 2.

Populated filters: article_kind=91, rated_power=91.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_current, rated_torque, rated_voltage, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6SL32101KE118AB2: SINAMICS G120C USS/MB 0,55KW FILA; 6SL32101KE118AF2: SINAMICS G120C PN 0,55KW FILA.

## R220 I667 — SINAMICS G120 POWER

112 articles; profile `drives`; kinds: device=112; unresolved kind: 0; without technical/software values: 1.

Populated filters: article_kind=112, ip_rating=111, rated_power=111, rated_voltage=111.

Supported but unpopulated: depth, diameter, height, licence_type, rated_current, rated_torque, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6SL32101NE113AG1: SINAMICS PM230 IP20-FSA-A-400V- 0.37KW; 6SL32101NE113UG1: SINAMICS PM230 IP20-FSA-U-400V- 0.37KW.

## R220 I668 — SINAMICS V20

81 articles; profile `drives`; kinds: device=79; unresolved kind: 2; without technical/software values: 31.

Populated filters: article_kind=79, rated_power=50, rated_voltage=50.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_current, rated_torque, software_delivery, software_version, supply_voltage, width. Ambiguous: rated_voltage=1.

Imported examples: 6SL32000UF010AA0: SINAMICS V20, FSA REPLACEMENT FAN; 6SL32000UF020AA0: SINAMICS V20, FSB REPLACEMENT FAN.

## R220 I669 — SINAMICS V90

313 articles; profile `drives`; kinds: device=221, accessory=8; unresolved kind: 84; without technical/software values: 95.

Populated filters: article_kind=229, rated_voltage=218, rated_power=29.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_current, rated_torque, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 1FL60222AF211AA1: SERVOMOTORE 1FL6 3AC 230V; 1FL60222AF211AB1: SERVOMOTORE 1FL6 3AC 230V.

## R220 I66A — SINAMICS S210

21 articles; profile `drives`; kinds: device=21; unresolved kind: 0; without technical/software values: 5.

Populated filters: article_kind=21, rated_current=2, rated_voltage=14, rated_power=12.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_torque, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6SL32030BE235HA0: SINAMICS S210, EMC-FILTER C2, 3AC, 35A; 6SL32030BE265HA0: SINAMICS S210, EMC-FILTER C2, 3AC, 65A.

## R220 I66B — SIMOTICS 1FK2

1575 articles; profile `motors`; kinds: device=685, accessory=670; unresolved kind: 220; without technical/software values: 891.

Populated filters: article_kind=1355, rated_torque=684.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_current, rated_power, rated_voltage, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 1FK21020AG000MA0: MOTORE SINCRONO 1FK2-HD 0,16 NM; 1FK21020AG000SA0: MOTORE SINCRONO 1FK2-HD 0,16 NM.

## R220 I66X — SINAMICS G120X

2133 articles; profile `drives`; kinds: device=2133; unresolved kind: 0; without technical/software values: 0.

Populated filters: article_kind=2133, ip_rating=2132, rated_power=2133.

Supported but unpopulated: depth, diameter, height, licence_type, rated_current, rated_torque, rated_voltage, software_delivery, software_version, supply_voltage, width. Ambiguous: rated_voltage=2132.

Imported examples: 6SL32201YC160UF0: G120X IP20 200-240V 2.2KW FSB UF; 6SL32201YC180UB0: G120X IP20 200-240V 3KW FSB UF.

## R220 IG28 — SINAMICS S200

889 articles; profile `drives`; kinds: device=702, accessory=1; unresolved kind: 186; without technical/software values: 187.

Populated filters: article_kind=703, rated_voltage=702, rated_power=34.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_current, rated_torque, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 1FL21022AF000HC0: SERVOMOTOR 1FL2,3AC 400V; 1FL21022AF000MC0: SERVOMOTOR 1FL2,3AC 400V.

## R221 IG60 — MC DIGITALIZATION SOFTWARE

92 articles; profile `software`; kinds: software=90, accessory=2; unresolved kind: 0; without technical/software values: 25.

Populated filters: article_kind=92, software_version=59, software_delivery=21.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, width. Ambiguous: none.

Imported examples: 6AU18101HA340XB0: SINAMICS DCC V3.4 LICENSE KEY; 6SL30540FB101BA0: SINAMICS S120 CF CARD V5.1 SP1.

## R251 I65G — SIMATIC S7-1500T

46 articles; profile `automation`; kinds: software=5, device=23, accessory=2; unresolved kind: 16; without technical/software values: 41.

Populated filters: article_kind=30, software_delivery=5.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_version, supply_voltage, width. Ambiguous: software_version=4.

Imported examples: 6DL89130AK200AK5: SIMIT SP V10.2 UG ENG. S V10.1->V10.2 DL; 6DL89130AK300AK5: SIMIT SP V10.3 UG ENG. S V10.2->V10.3 DL.

## R261 IMD1 — DI MC DIGITAL DRIVE TRAIN

10 articles; profile `accessories`; kinds: accessory=10; unresolved kind: 0; without technical/software values: 10.

Populated filters: article_kind=10.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6AT80024AA00: CMS2000 SCHIRMAUFLAGE ZUBEHOER; 6AT80024AB00: SIPLUS CMS2000 VIB-SENSOR S01.

## R315 I0HA — SITOP POWER SUPPLY

243 articles; profile `power`; kinds: device=226; unresolved kind: 17; without technical/software values: 89.

Populated filters: article_kind=226, output_voltage=121, rated_current=46, ip_rating=5.

Supported but unpopulated: apparent_power, depth, diameter, height, licence_type, rated_power, rated_voltage, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 6EP12320AA00: SCHUECO ARTICLE 262 683, NT-AP-AW2-A3; 6EP12510AA10: SCHUECO ARTICLE 262 486, NT-AP-AW2-A1.

## R315 I0HB — SIMATIC TOP CONNECT

183 articles; profile `accessories`; kinds: accessory=147, device=36; unresolved kind: 0; without technical/software values: 183.

Populated filters: article_kind=183.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6EP53065BG00: CAB SET FRC 6M 50PIN A 8 IDC-CONN.; 6EP54065AA00: TRANSF MODULE 50PIN. 1TO1 W/O LED.

## R320 I0NA — SCALANCE NETWORKS

521 articles; profile `networking`; kinds: software=8, device=201, accessory=6; unresolved kind: 306; without technical/software values: 508.

Populated filters: article_kind=215, ip_rating=9, software_delivery=4.

Supported but unpopulated: depth, diameter, digital_inputs, digital_outputs, height, licence_type, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6GK15000AA10: 12M BUS TERMINAL; 6GK15000AB00: RS 485 BUS TERMINAL.

## R322 I05B — SIMATIC IDENT AND RTLS

428 articles; profile `networking`; kinds: accessory=67, software=7; unresolved kind: 354; without technical/software values: 423.

Populated filters: article_kind=74, ip_rating=1, software_delivery=4.

Supported but unpopulated: depth, diameter, digital_inputs, digital_outputs, height, licence_type, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6GF33200AC02: CAB CONF USB, MV320 CON; 6GF33200AC03: CAB CONF SUB-D, MV320 CON, NV-CON.

## R322 I0NF — SIMATIC NET

323 articles; profile `networking`; kinds: software=130, accessory=3, device=2; unresolved kind: 188; without technical/software values: 194.

Populated filters: article_kind=135, software_delivery=40, software_version=91, ip_rating=1.

Supported but unpopulated: depth, diameter, digital_inputs, digital_outputs, height, licence_type, supply_voltage, width. Ambiguous: none.

Imported examples: 6GF35001TP03: TRAINER-PACKAGE MV540 INCL. OBJECT RECOG; 6GF35002AP01: PROMOT.PACKAGE MV550 S - W/O LICENCES.

## R323 I0NH — SCALANCE WIRELESS AND CABLING

830 articles; profile `networking`; kinds: software=2, device=54, accessory=1; unresolved kind: 773; without technical/software values: 829.

Populated filters: article_kind=57, ip_rating=1.

Supported but unpopulated: depth, diameter, digital_inputs, digital_outputs, height, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6GK15000EA02: PROFIBUS BUS CONNECTOR; 6GK15000FC10: PB FC RS 485 PLUG 180.

## R336 I0G2 — DCS HW

220 articles; profile `automation`; kinds: software=4, accessory=6, device=47; unresolved kind: 163; without technical/software values: 130.

Populated filters: ip_rating=73, article_kind=57, software_delivery=1, digital_inputs=1, digital_outputs=8, analog_inputs=5, analog_outputs=2.

Supported but unpopulated: depth, diameter, height, licence_type, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6DL28040AD30: EX-GEHAEUSE 650X450X230 IP65 Z1 39KE; 6DL28040AD31: EX-GEH 650X450X230 IP65 Z1 39KE M16-40.

## R336 I0G3 — ET 200SP HA

74 articles; profile `automation`; kinds: device=41, accessory=2; unresolved kind: 31; without technical/software values: 48.

Populated filters: article_kind=43, digital_inputs=9, digital_outputs=7, analog_inputs=7, analog_outputs=3.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6DL11316BH000PH1: ET 200SP HA, DI 16X24VDC; 6DL11316BH600PH1: ET 200SP HA, DI 16X24VDC NPN HA.

## R338 I0GJ — SIMATIC S7 400-400F

132 articles; profile `automation`; kinds: device=20; unresolved kind: 112; without technical/software values: 132.

Populated filters: article_kind=20.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ES74000HR014AB0: S7-400H SYSTEM BUNDLE AC, CPU 412-5H; 6ES74000HR024AB0: S7-400H SYSTEM BUNDLE AC, CPU 414-5H.

## R362 I0GY — SIMATIC PCS NEO HW

12 articles; profile `automation`; kinds: device=5; unresolved kind: 7; without technical/software values: 12.

Populated filters: article_kind=5.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6DL41701RB012XX0: SIMATIC CN 4100 RACK 4 SLOT, 6X ETHERNET; 6DL41724AX410XX0: SIMATIC CN 4100 EXTENSION MODULE RS232.

## R363 I0G2 — SIMATIC PCS 7 HW

460 articles; profile `automation`; kinds: none; unresolved kind: 460; without technical/software values: 460.

Populated filters: none.

Supported but unpopulated: analog_inputs, analog_outputs, article_kind, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6ES74001JA110AA1: PCS 7-400 RACK, UR2 XTR, 9 SLOTS; 6ES74002JA100AA1: PCS 7-400 RACK, UR2-H XTR, 18 SLOTS.

## R364 I0NS — SIMIT

146 articles; profile `software`; kinds: software=146; unresolved kind: 0; without technical/software values: 7.

Populated filters: article_kind=146, software_version=35, software_delivery=105.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, width. Ambiguous: software_version=75.

Imported examples: 6DL50007AA570XH5: TELECONTROL BASIC ES V7.5 FOR WINCC DL; 6DL50027AA570XH0: TELECONTROL SRV V7.5 F.WINCC (6 ST.) DL.

## R365 INY0 — SIMATIC PCS 7 E NEO SW

1395 articles; profile `software`; kinds: software=1395; unresolved kind: 0; without technical/software values: 148.

Populated filters: article_kind=1395, software_version=962, software_delivery=522, licence_type=85.

Supported but unpopulated: depth, diameter, height, ip_rating, width. Ambiguous: software_version=212.

Imported examples: 6BG00000AA001GA0: SIMATIC PCS MYEXPERT BASIC S; 6DL50007AA470XA5: TELECONTROL BASIC ES V74 FOR WINCC.

## R3P0 I08B — TRASM./CONVERT.

1065 articles; profile `measurement`; kinds: device=419, accessory=23; unresolved kind: 623; without technical/software values: 1065.

Populated filters: article_kind=442.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 7MC10003BA21: FLUE-GAS RESISTANCE THERMOMETER 1000MM; 7MC10061DA11: LOW-PRESS. RESIST. THERMO. 100MM/1PT100.

## R3P0 I08E — POSIZIONATORI SIPART

9 articles; profile `measurement`; kinds: device=8; unresolved kind: 1; without technical/software values: 9.

Populated filters: article_kind=8.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 6DR50101EG000AA0: SIPART PS2 SMART; 6DR50101NN010AA3: SIPART PS2 SMART.

## R3P0 I08Z — MILLTRONICS LEVELS

52 articles; profile `measurement`; kinds: device=48, accessory=1; unresolved kind: 3; without technical/software values: 52.

Populated filters: article_kind=49.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 7ML56301AC000JB0: CLS200,STANDARD,ROD VERSN,THREAD/FLANGE; 7ML56313BA000DB0: CLS200,STANDRD,CABLE VERSN,THREAD/FLANGE.

## R3P2 I08X — MI VP - VALVE POSITIONER

635 articles; profile `measurement`; kinds: accessory=7, device=464, software=4; unresolved kind: 160; without technical/software values: 633.

Populated filters: article_kind=475, ip_rating=2.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: supply_voltage=1.

Imported examples: 6DR40041D: CONSOLE 80 X 30 X 20 MM FOR ROTARY DRIVE; 6DR40041ES: POSITION TRANSMITTER (POTENTIOMETER).

## R3P3 I08I — FLOW INSTRUMENTS

4596 articles; profile `measurement`; kinds: device=3978, accessory=29, software=1; unresolved kind: 588; without technical/software values: 4569.

Populated filters: article_kind=4008, ip_rating=27.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 7ME26102KD000AA0: SITRANS FX330 FLANGED DESIGN; 7ME26102KF000AA0: SITRANS FX330 FLANGED DESIGN.

## R3P3 I08R — MISURATORI DI PORTATA CLAMP ON

216 articles; profile `measurement`; kinds: device=28, accessory=26; unresolved kind: 162; without technical/software values: 196.

Populated filters: article_kind=54, ip_rating=20.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 7ME35701JA400AA1: SITRANS FS220 IP65 (NEMA 4X); 7ME35701JA400CP1: SITRANS FS220 IP65 (NEMA 4X).

## R3P5 I08F — SIST. DOSAGGIO E PES

435 articles; profile `measurement`; kinds: accessory=17, device=3, software=4; unresolved kind: 411; without technical/software values: 435.

Populated filters: article_kind=24.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: software_version=1.

Imported examples: 7MH31101AA1: SET OF 2 ROUND-HEAD BOLT GUIDES; 7MH31101BA1: SET OF 2 ROUND-HEAD BOLT GUIDES.

## R3P5 I08N — MILLTRONICS LEVELS

1750 articles; profile `measurement`; kinds: device=657, accessory=54; unresolved kind: 1039; without technical/software values: 1747.

Populated filters: article_kind=711, ip_rating=3.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 7MH71021CB10: SITRANS WF330 FLOWMETER; 7MH71021EB10: SIEMENS MILLTRONICS E-SERIES FLOWMETER.

## R711 I0T4 — ILM 3RC7 E 3RA8

37 articles; profile `starters`; kinds: device=12; unresolved kind: 25; without technical/software values: 25.

Populated filters: article_kind=12, current_setting_max=12, current_setting_min=12.

Supported but unpopulated: depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, rated_current, rated_power, rated_voltage, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RA84111KE00: ILF ST DIRECT STARTER 1.2-12 A (S00); 3RA84111KE10: ILF HF DIRECT STARTER 1.2-12 A (S00).

## R711 I330 — SIRIUS NG - CONTATTORI S00

823 articles; profile `contactors`; kinds: device=635, accessory=15; unresolved kind: 173; without technical/software values: 203.

Populated filters: article_kind=650, coil_voltage=581, rated_power=607, rated_voltage=9, poles=81.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_current, software_delivery, software_version, width. Ambiguous: coil_voltage=19.

Imported examples: 3RT20151AB01: CONT3KW,1L,AC 24V,S00 VT; 3RT20151AB011AA0: CONT3KW,1L,AC 24V,S00 VT MONT.ORIZ..

## R711 I333 — SIRIUS NG - SALVAMOTORI S0

215 articles; profile `motor_protection`; kinds: device=140; unresolved kind: 75; without technical/software values: 165.

Populated filters: article_kind=140, current_setting_max=50, current_setting_min=50.

Supported but unpopulated: declared_breaking_capacity, depth, diameter, height, ip_rating, licence_type, poles, rated_current, rated_voltage, software_delivery, software_version, trip_unit_type, width. Ambiguous: none.

Imported examples: 3RV20210AA10: CIRCUIT-BREAKER SCREW CONNECTION 0,16A; 3RV20210BA10: CIRCUIT-BREAKER SCREW CONNECTION 02A.

## R711 I334 — SIRIUS NG - SALVAMOTORI S2/S3

175 articles; profile `motor_protection`; kinds: device=152; unresolved kind: 23; without technical/software values: 73.

Populated filters: article_kind=152, current_setting_max=102, current_setting_min=102, declared_breaking_capacity=94.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, poles, rated_current, rated_voltage, software_delivery, software_version, trip_unit_type, width. Ambiguous: none.

Imported examples: 3RV20314BA10: INTAUT.S2 14-20A 65KA VT CL.10; 3RV20314BA15: INTAUT.S2 14-20A 1L,1R 65KA VT CL.10.

## R711 I335 — SIRIUS NG  - ACCES. SALVAMOTORI

89 articles; profile `accessories`; kinds: accessory=87, device=2; unresolved kind: 0; without technical/software values: 85.

Populated filters: article_kind=89, ip_rating=4.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RV29010H: TAPPO C.AUX FRONT.3RV2; 3RV29011A: CONT.AUS.LAT.1L,1R,VT,X3RV2 S00-S0.

## R711 I336 — SIRIUS NG  - CONTATTORI S0

852 articles; profile `contactors`; kinds: device=759, accessory=14; unresolved kind: 79; without technical/software values: 127.

Populated filters: article_kind=773, coil_voltage=636, rated_power=698, rated_current=3, rated_voltage=1, poles=41.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, software_delivery, software_version, width. Ambiguous: coil_voltage=65.

Imported examples: 3RT20231AB00: CONT4KW,1L,1R,AC 24V 50HZ,S0 VT; 3RT20231AB04: CONT4KW,2L,2R,AC 24V 50HZ,S0 VT.

## R711 I337 — SIRIUS NG  - TELEINVERTITORI

231 articles; profile `contactors`; kinds: device=143; unresolved kind: 88; without technical/software values: 94.

Populated filters: article_kind=143, coil_voltage=122, rated_power=114, rated_voltage=11.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, poles, rated_current, software_delivery, software_version, width. Ambiguous: coil_voltage=14.

Imported examples: 3RA23158XB301AB0: INV3KW,AC 24V,S00 VT; 3RA23158XB301AF0: INV3KW,AC 110V,S00 VT.

## R711 I338 — SIRIUS NG  - CONTATTORI S2

485 articles; profile `contactors`; kinds: device=387, accessory=6; unresolved kind: 92; without technical/software values: 167.

Populated filters: article_kind=393, coil_voltage=237, rated_power=277, rated_current=7.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, poles, rated_voltage, software_delivery, software_version, width. Ambiguous: coil_voltage=113.

Imported examples: 3RT20351AB00: CONTS2 18,5KW 1L,1R 24V 50HZ VT; 3RT20351AB001AA0: CONTS2 18,5KW 1L,1R 24V 50HZ VT M.OR..

## R711 I339 — SIRIUS NG  - COMB. STELLA-TRIANGOLO

121 articles; profile `contactors`; kinds: device=114; unresolved kind: 7; without technical/software values: 49.

Populated filters: article_kind=114, coil_voltage=60, rated_power=62.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, poles, rated_current, rated_voltage, software_delivery, software_version, width. Ambiguous: coil_voltage=12.

Imported examples: 3RA24158XE311BB4: AS-T  X COM.I-O-L 7.5KW DC 24V,S00,VT; 3RA24158XE312BB4: AS-T  X COM.I-O-L 7.5KW DC 24V,S00,ML.

## R711 I33A — SIRIUS NG - CONTATTORI AUX E INTERFACCIA

520 articles; profile `contactors`; kinds: device=284, accessory=26; unresolved kind: 210; without technical/software values: 284.

Populated filters: article_kind=310, coil_voltage=236.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, poles, rated_current, rated_power, rated_voltage, software_delivery, software_version, width. Ambiguous: coil_voltage=9.

Imported examples: 3RH21221AB00: CONTAUS.2L,2R AC 24V,S00,VT; 3RH21221AB001AA0: CONT.RELAY,2NO+2NC,AC24V 50/60HZ.

## R711 I33B — SIRIUS NG - SALVAMOTORI S00

291 articles; profile `motor_protection`; kinds: device=259; unresolved kind: 32; without technical/software values: 260.

Populated filters: article_kind=259, current_setting_max=31, current_setting_min=31.

Supported but unpopulated: declared_breaking_capacity, depth, diameter, height, ip_rating, licence_type, poles, rated_current, rated_voltage, software_delivery, software_version, trip_unit_type, width. Ambiguous: none.

Imported examples: 3RV20110AA10: INTAUT.S00, 0.11-0.16A,VT; 3RV20110AA15: INTAUT.S00, 0.11-0.16A,VT.

## R711 I340 — SIRIUS NG  - ACCES. PARTENZE COMPATTE

37 articles; profile `accessories`; kinds: accessory=35, device=2; unresolved kind: 0; without technical/software values: 35.

Populated filters: article_kind=37, digital_inputs=2.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RA68128AB: ALIMENVITE USCITA MOLLA  63A  3 POSTI; 3RA68128AC: ALIMENVITE USCITA MOLLA  63A  3 POSTI.

## R711 I341 — SIRIUS NG  - PARTENZE COMPATTE

101 articles; profile `starters`; kinds: device=80; unresolved kind: 21; without technical/software values: 21.

Populated filters: article_kind=80, rated_power=75, rated_voltage=49, current_setting_max=5, current_setting_min=5.

Supported but unpopulated: depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: rated_voltage=31.

Imported examples: 3RA61200AB30: AVVDIR UC 24V 0,09KW S. MORS; 3RA61200BB30: AVV DIR UV 24V 0,37KW S. MORS.

## R711 I342 — SIRIUS MODULI AS-I PARTENZE COMPATTE

6 articles; profile `automation`; kinds: device=5; unresolved kind: 1; without technical/software values: 6.

Populated filters: article_kind=5.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RA69703A: MODULO AS-I PER 3RA6; 3RA69703B: MODULO AS -I CON DUE INGRESSI LOCALI.

## R711 I343 — SIRIUS NG - RELF CONTROLLO CORRENTE

31 articles; profile `measurement`; kinds: device=30; unresolved kind: 1; without technical/software values: 31.

Populated filters: article_kind=30.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RR21411AA30: RELE' CONTRS00 ANALOG.1.6-16A VT; 3RR21411AW30: RELE' CONTRS00 ANALOG.1.6-16A VT.

## R711 I344 — SIRIUS NG - ACCES.CONT/PARTENZES00-S12

389 articles; profile `accessories`; kinds: accessory=370, device=19; unresolved kind: 0; without technical/software values: 389.

Populated filters: article_kind=389.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RA29081A: CACCIAVT SIRIUS   DIM3.0X0.5X100; 3RA29100: COPPIOMB.X MOD.FUNZ..

## R711 I345 — SIRIUS SOFT STARTERS 3RW30

52 articles; profile `starters`; kinds: device=51; unresolved kind: 1; without technical/software values: 1.

Populated filters: article_kind=51, rated_power=51, rated_voltage=49, supply_voltage=23, rated_current=4.

Supported but unpopulated: current_setting_max, current_setting_min, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, width. Ambiguous: supply_voltage=22, rated_voltage=2.

Imported examples: 3RW30131BB04: SOFTSTARTER SIRIUS 400V 1,5KW AUS 24; 3RW30131BB14: SOFTSTARTER 400V 1,5KW AUS 110-220V.

## R711 I346 — SIRIUS NG  - RELF TERMICI EL.MECC

174 articles; profile `overload`; kinds: device=171; unresolved kind: 3; without technical/software values: 45.

Populated filters: article_kind=171, current_setting_max=129, current_setting_min=129.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RU21160AB0: RELE' TERS00 0,11-0,16 A VT; 3RU21160AB1: RELE' TERS00 MONT.SEP.0,11-0,16 A VT.

## R711 I347 — SIRIUS NG  - MOD. FUNZ. TEMP. - STAR/DELTA

25 articles; profile `control`; kinds: device=17; unresolved kind: 8; without technical/software values: 25.

Populated filters: article_kind=17.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, poles, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RA28111CW10: RELE TEM EL.ON-DELAY 24-240V AC-DC; 3RA28112CW10: RELE TEM EL.ON-DELAY 24-240V AC-DC.

## R711 I348 — SIRIUS NG  - AVVIATORI COMBINATI S00

707 articles; profile `starters`; kinds: device=443; unresolved kind: 264; without technical/software values: 264.

Populated filters: article_kind=443, current_setting_max=303, current_setting_min=303, rated_voltage=432, rated_current=21.

Supported but unpopulated: depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, rated_power, software_delivery, software_version, supply_voltage, width. Ambiguous: rated_voltage=11.

Imported examples: 3RA21100BA151AP0: AVVD.S00 0.14-0.2A,AC 230V VT G.DIN; 3RA21100BA151BB4: AVVDIR.S00 0.14-0.2A,DC 24V VT G.DIN.

## R711 I34A — SIRIUS NG  - ACCESS. RELF TERMICI

13 articles; profile `accessories`; kinds: accessory=13; unresolved kind: 0; without technical/software values: 13.

Populated filters: article_kind=13.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RB39800A: RESET MECCANICO X 3RUB30-3RB31,S00-S0; 3RB39800B: CABLE RELEASE WITH HOLDER.

## R711 I350 — SIRIUS NG  - RELF TERMICI ELETTRONICI

106 articles; profile `overload`; kinds: device=106; unresolved kind: 0; without technical/software values: 0.

Populated filters: article_kind=106, current_setting_max=106, current_setting_min=106.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RB30161NB0: RELE' EL0.32-1.25 A  S00,CL.10  VT; 3RB30161NE0: RELE' EL0.32-1.25 A  S00,CL.10  ML.

## R711 I370 — SIRIUS NG CONTATTORI S3

356 articles; profile `contactors`; kinds: device=341; unresolved kind: 15; without technical/software values: 51.

Populated filters: article_kind=341, rated_power=234, coil_voltage=225, rated_current=29.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, poles, rated_voltage, software_delivery, software_version, width. Ambiguous: coil_voltage=69.

Imported examples: 3RT20353SB30: CONT.18,5KW1L,1RUC20-33VMLF-PLC-IN; 3RT20353SF30: CONT18.5KW84-155VAC-DCF-PLC-IN.

## R711 I372 — TEMPORIZZATORI 7PV

12 articles; profile `control`; kinds: device=11; unresolved kind: 1; without technical/software values: 12.

Populated filters: article_kind=11.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, poles, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 7PV15081AW30: TIME RELAY, MULTI-FUNCTION; 7PV15081BW30: TIME RELAY, MULTI-FUNCTION.

## R711 I373 — SIRIUS NG - MOD. FUNZ. COMUNICAZIONE

34 articles; profile `accessories`; kinds: accessory=34; unresolved kind: 0; without technical/software values: 34.

Populated filters: article_kind=34.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RA27110DB00: MODCOLLEG.X IO-L-AVV.INV.VT, 3RT2 S00-; 3RA27110EE02: CONNET8CM X MOD.FUNZ.3RA27 14P.

## R711 I452 — PULSANTI 3SU1 STANDARD

2003 articles; profile `control`; kinds: device=577, accessory=67; unresolved kind: 1359; without technical/software values: 2000.

Populated filters: article_kind=644, ip_rating=3.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, licence_type, poles, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3SU10000AA100AA0: PULS. PIATTO PASSO-PASSO NERO; 3SU10000AA200AA0: PULS. PIATTO PASSO-PASSO ROSSO.

## R711 I453 — PULSANTI 3SU1 COMMUNICATION

69 articles; profile `automation`; kinds: device=16, accessory=17; unresolved kind: 36; without technical/software values: 69.

Populated filters: article_kind=33.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3SU14001EA102AA0: MODULO AS-I 2 INGRESSI SICURI VITE-MOLLA; 3SU14001EA104AA0: MODULO AS-I 2 INGR.SICURI PERF.ISOLANTE.

## R711 I454 — PULSANTI 3SU1 SAFETY

171 articles; profile `control`; kinds: device=97; unresolved kind: 74; without technical/software values: 171.

Populated filters: article_kind=97.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, poles, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3SU10001GB200AA0: PULS.F.EMERG ROTAZIONE 30MM; 3SU10001HA200AA0: PULS.F.EMERG TRAZIONE 40MM.

## R711 I597 — SIRIUS NG RELÈ TERMICI ELETTROMECCANICI S3

20 articles; profile `overload`; kinds: device=20; unresolved kind: 0; without technical/software values: 0.

Populated filters: article_kind=20, current_setting_max=20, current_setting_min=20.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RU21464FB0: RELE' TERS3 28-40A VT; 3RU21464FD0: RELE' TERS3 28-40A ML.

## R711 I598 — SIRIUS NG RELÈ TERMICI ELETTRONICI S3

8 articles; profile `overload`; kinds: device=8; unresolved kind: 0; without technical/software values: 0.

Populated filters: article_kind=8, current_setting_max=8, current_setting_min=8.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RB31434UB0: RELE' ELETS3 12.5-50A CL30 VT; 3RB31434UD0: RELE' ELETS3 12.5-50A CL30 ML.

## R711 I67E — SIRIUS NG MSP S3

26 articles; profile `motor_protection`; kinds: device=25; unresolved kind: 1; without technical/software values: 26.

Populated filters: article_kind=25.

Supported but unpopulated: current_setting_max, current_setting_min, declared_breaking_capacity, depth, diameter, height, ip_rating, licence_type, poles, rated_current, rated_voltage, software_delivery, software_version, trip_unit_type, width. Ambiguous: none.

Imported examples: 3RV20314SA150BA0: CIRCUIT BREAKER, SCREW-TYPE, 14 A; 3RV23414FC10: INT.AUT.S3 X AVV.40A 65KA.

## R711 I706 — CONTATTORI SIRIUS II

573 articles; profile `contactors`; kinds: device=502; unresolved kind: 71; without technical/software values: 77.

Populated filters: article_kind=502, rated_power=397, rated_voltage=179, coil_voltage=107, rated_current=98.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, poles, software_delivery, software_version, width. Ambiguous: coil_voltage=84.

Imported examples: 3RT10541AB36: CONTS6 55KW CONV. 23-26VUC; 3RT10541AD36: CONTS6 55KW CONV. 42-48VUC.

## R711 I715 — INT. AUTOMATICI S00

58 articles; profile `motor_protection`; kinds: device=26; unresolved kind: 32; without technical/software values: 36.

Populated filters: article_kind=26, current_setting_max=21, current_setting_min=21, declared_breaking_capacity=21.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, poles, rated_current, rated_voltage, software_delivery, software_version, trip_unit_type, width. Ambiguous: rated_current=1.

Imported examples: 3RV10110AA10: INTAUT.3X12A S00 0,11-0,16A 100KA; 3RV10110AA15: INT3X12A S00 0,11-0,16A 100KA 1L,1.

## R711 I71A — SIRIUS MSP ACCESSORI

59 articles; profile `accessories`; kinds: device=4, accessory=55; unresolved kind: 0; without technical/software values: 47.

Populated filters: article_kind=59, ip_rating=12.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RV19035B: LAMPSEGNAL.110-120V X CUSTODIE; 3RV19035C: LAMP SEGNAL.220-240V X CUSTODIE.

## R711 I720 — SIRIUS AS INTERF 3RK

107 articles; profile `starters`; kinds: device=37; unresolved kind: 70; without technical/software values: 47.

Populated filters: article_kind=37, current_setting_max=1, current_setting_min=1, digital_inputs=15, ip_rating=44, rated_current=1, digital_outputs=7.

Supported but unpopulated: depth, diameter, height, licence_type, rated_power, rated_voltage, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RD10000BA000EP0: SIMATIC ET 200SP E-STARTER; 3RD10000BB000EP0: SIMATIC ET 200SP E-STARTER 0.7 - 7.0 A.

## R711 I721 — SIRIUS AS INTERF ALI

75 articles; profile `accessories`; kinds: device=5, accessory=68, software=2; unresolved kind: 0; without technical/software values: 67.

Populated filters: article_kind=75, ip_rating=6, software_version=2.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, licence_type, software_delivery, supply_voltage, width. Ambiguous: none.

Imported examples: 3RK14088KE000AA2: AS-I MOD GUASTO TERRA L=22,5 IP20; 3RK14088KG000AA2: MOD AS-I GUASTO DI TERRA, IP20,  MOLLA.

## R711 I722 — SIRIUS AS INTERF. PA

119 articles; profile `starters`; kinds: device=48; unresolved kind: 71; without technical/software values: 119.

Populated filters: article_kind=48.

Supported but unpopulated: current_setting_max, current_setting_min, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, rated_current, rated_power, rated_voltage, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RK13156KS410AA0: MOTOR STARTER M200D AS-I BASIC; 3RK13156KS410AA3: MOTOR STARTER M200D AS-I BASIC.

## R711 I723 — SIRIUS PARTENZE MOTO

86 articles; profile `starters`; kinds: device=28, accessory=9; unresolved kind: 49; without technical/software values: 62.

Populated filters: article_kind=37, rated_voltage=4, rated_current=2, current_setting_max=18, current_setting_min=18, digital_inputs=1.

Supported but unpopulated: depth, diameter, digital_outputs, height, ip_rating, licence_type, rated_power, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RK13040HS006AA0: ET 200PRO RSM MOD SEZ; 3RK13040HS008AA0: ET 200 PRO ASM 400V.

## R711 I724 — SIRIUS NET PROFIBUS

103 articles; profile `accessories`; kinds: device=13, accessory=90; unresolved kind: 0; without technical/software values: 103.

Populated filters: article_kind=103.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RK13080AA000CP0: AVVIATORE DIRETTO HIGH FEATURE; 3RK13080BA000CP0: AVVIATORE INVERTITORE HIGH FEATURE.

## R711 I725 — CONTATTORI STATICI 3

679 articles; profile `contactors`; kinds: device=369, accessory=3; unresolved kind: 307; without technical/software values: 315.

Populated filters: article_kind=372, rated_current=364, coil_voltage=1.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, poles, rated_power, rated_voltage, software_delivery, software_version, width. Ambiguous: coil_voltage=368.

Imported examples: 3RF20201AA02: RELE STAT 20A 24-230V 24VDC 45MM; 3RF20201AA04: RELE STAT 20A 460V 24VDC 45MM.

## R711 I726 — MOD.CONTR.POTENZA

40 articles; profile `accessories`; kinds: accessory=40; unresolved kind: 0; without technical/software values: 40.

Populated filters: article_kind=40.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RF29000BA88: SPARE PART DIN-RAIL ADAPTER; 3RF29000EA18: MODCONVERT. 0-10V 24VAC-DC.

## R711 I727 — SOFT STARTERS 3RW40

111 articles; profile `starters`; kinds: device=93, accessory=1; unresolved kind: 17; without technical/software values: 14.

Populated filters: article_kind=94, rated_power=93, rated_voltage=86, supply_voltage=62, rated_current=1.

Supported but unpopulated: current_setting_max, current_setting_min, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, width. Ambiguous: supply_voltage=28, rated_voltage=7.

Imported examples: 3RW40241BB04: SOFTSTARTER S0 5,5KW 400V, 24V AUS; 3RW40241BB05: SOFTSTARTER S0 7,5KW 500V, 24V AUS.

## R711 I728 — SOFT STARTERS 3RW44

11 articles; profile `software`; kinds: software=11; unresolved kind: 0; without technical/software values: 1.

Populated filters: article_kind=11, software_version=10.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, software_delivery, width. Ambiguous: none.

Imported examples: 3ZS16331XE040YA0: PCS 7 LIBRARY BLOCK 3RW44 V9.1; 3ZS16331XE050YA0: PCS 7 LIB SOFT STARTER 3RW44 LEGACY V10.

## R711 I729 — ACCESSORI X CONTATTO

281 articles; profile `accessories`; kinds: accessory=281; unresolved kind: 0; without technical/software values: 281.

Populated filters: article_kind=281.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RA19111A: ELCOL. ELETTR.MECC.(MIN.10PZ); 3RA19111AA00: ELCOL. ELETTR.MECC.(1CONF=1PZ).

## R711 I72M — SIRIUS AS INTERF MASTER

5 articles; profile `networking`; kinds: device=2; unresolved kind: 3; without technical/software values: 5.

Populated filters: article_kind=2.

Supported but unpopulated: depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RK71366SC000BC1: AS-I MASTER SAFETY ET200SP V30; 3RK71376SA000BC1: AS-I MASTER ET200SP V30.

## R711 I739 — ACCESSORI X RELE' TE

13 articles; profile `accessories`; kinds: accessory=13; unresolved kind: 0; without technical/software values: 13.

Populated filters: article_kind=13.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RB19000B: ELEMFISSAG.X 3RB1246(MIN.10 PZ); 3RB19000BA000FH0: PLUG-IN LUGS S00-S3.

## R711 I750 — FINECORSA 3SE37/3

156 articles; profile `control`; kinds: device=50, accessory=25; unresolved kind: 81; without technical/software values: 145.

Populated filters: article_kind=75, poles=2, diameter=9.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, digital_inputs, digital_outputs, height, ip_rating, licence_type, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3SE22430XX: FIN.SIC.A CH.LARGO 1L,2R 30N, METRICO; 3SE22430XX18: SAFETY POSITION SWITCH.

## R711 I757 — ACCESSORI 3RM1

7 articles; profile `accessories`; kinds: accessory=7; unresolved kind: 0; without technical/software values: 7.

Populated filters: article_kind=7.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RM19101AA: SBARRE COLLEG X 2 PARTENZE MOTORE; 3RM19101BA: SBARRE COLLEG X 3 PARTENZE MOTORE.

## R711 I761 — SIRIUS SAFETY RELAY

85 articles; profile `control`; kinds: device=39, software=5, accessory=8; unresolved kind: 33; without technical/software values: 70.

Populated filters: article_kind=52, supply_voltage=7, software_version=5, width=3.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, poles, rated_current, software_delivery. Ambiguous: supply_voltage=3.

Imported examples: 3SK11111AB30: DISPSIC STD 3 F-RO 1NC US=24V AC-DC VT; 3SK11111AW20: DISPSIC STD 3 F-RO 1NC US=110-230V AC VT.

## R711 I762 — AVVIATORI MOTOR 3RM1

73 articles; profile `starters`; kinds: device=71; unresolved kind: 2; without technical/software values: 2.

Populated filters: article_kind=71, current_setting_max=71, current_setting_min=71, rated_voltage=37.

Supported but unpopulated: depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, rated_current, rated_power, software_delivery, software_version, supply_voltage, width. Ambiguous: rated_voltage=34.

Imported examples: 3RA90123RM01: 3RM1 STARTERKIT; 3RM10011AA04: AVVIATMOT.DIRET 0,1-0,5A 24V VT.

## R711 I801 — CONTATT AUSIL, INTER

257 articles; profile `contactors`; kinds: accessory=181, device=74; unresolved kind: 2; without technical/software values: 247.

Populated filters: article_kind=255, coil_voltage=9, rated_current=3.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, poles, rated_power, rated_voltage, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 3TH42440AB0: CONT.AUS.10A 4L,4R 24V 50HZ; 3TH42440AC2: CONT.AUS.10A 4L,4R 24V 50-60HZ.

## R711 I803 — CONTATT. COMBIN. CON

38 articles; profile `accessories`; kinds: accessory=38; unresolved kind: 0; without technical/software values: 38.

Populated filters: article_kind=38.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: coil_voltage=2.

Imported examples: 3TX42100R: PACKAGE OF 19 PLATE FRAMES; 3TX64260A: PIASTRA ADATTAMENTO PER 3TB42.

## R711 I804 — CONTATT. COMBIN. CON

33 articles; profile `accessories`; kinds: accessory=33; unresolved kind: 0; without technical/software values: 33.

Populated filters: article_kind=33.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3TX42100H: CONFEZIONE CON 100 CONTRASSEGNI; 3TX42100J: PACKAGE OF 100 LABEL HOLDERS.

## R711 I805 — CONTATT. COMBIN. DI

201 articles; profile `accessories`; kinds: accessory=117, device=84; unresolved kind: 0; without technical/software values: 191.

Populated filters: article_kind=201, coil_voltage=10.

Supported but unpopulated: analog_inputs, analog_outputs, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: coil_voltage=3.

Imported examples: 3RA19543A: BLOC.MEC. X 3RT135 - 3RT137; 3RH19511SA11: 2. HILFSSCH. FUER 3RT135, 3RT136, 3RT137.

## R711 I807 — CONTATT. X MOTORI IN

271 articles; profile `contactors`; kinds: device=158, accessory=55; unresolved kind: 58; without technical/software values: 174.

Populated filters: article_kind=213, coil_voltage=96, rated_power=3, rated_voltage=3.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, poles, rated_current, software_delivery, software_version, width. Ambiguous: coil_voltage=5.

Imported examples: 3TC44130BK2: CONTATT.GR.2 CC 1L,1R 120VAC SP.; 3TC44165CQ0: CONTACTOR SIZE 2 2-POLE.

## R711 I808 — RELE' TERMICI SIRIUS

24 articles; profile `overload`; kinds: device=24; unresolved kind: 0; without technical/software values: 0.

Populated filters: article_kind=24, current_setting_max=24, current_setting_min=24.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RB20561FC2: RELE' ELS6 50-200A CL.10; 3RB20561FF2: RELE' ELS3 50-200A CL.10 C-C.

## R711 I810 — MINICONTATTORI

23 articles; profile `contactors`; kinds: device=22; unresolved kind: 1; without technical/software values: 5.

Populated filters: article_kind=22, coil_voltage=17, rated_power=1, rated_voltage=1.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, poles, rated_current, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 3TG10010AC2: PICCOLO CONT. 3L,1R 24V 50-60HZ; 3TG10010AG2: PICCOLO CONT. 3L,1R 110V 50-60HZ.

## R711 I812 — RELE' TERMICI ELETTR

12 articles; profile `overload`; kinds: device=12; unresolved kind: 0; without technical/software values: 6.

Populated filters: article_kind=12, current_setting_max=6, current_setting_min=6.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RB22834AA1: RELE' ELS00-S12 MONOSTABILE; 3RB22834AC1: RELE' ELS00-S12 MONOSTABILE C-C.

## R711 I815 — RELE' DI INTERFACCIA

162 articles; profile `control`; kinds: device=88, accessory=61; unresolved kind: 13; without technical/software values: 155.

Populated filters: article_kind=149, rated_current=7.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, poles, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RQ10001EB00: COUPLING RELAY IM; 3RQ10001EW00: COUPLING RELAY IM.

## R711 I817 — TEMPORIZZATORI

71 articles; profile `control`; kinds: accessory=3; unresolved kind: 68; without technical/software values: 71.

Populated filters: article_kind=3.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, poles, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RP1902: CALOTTA PIOMBABILE (MIN5PZ); 3RP19020B: SEALABLE COVER.

## R711 I821 — INT AUT 63A, 3VU, 3V

9 articles; profile `control`; kinds: device=8, accessory=1; unresolved kind: 0; without technical/software values: 9.

Populated filters: article_kind=9.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, poles, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3UG46251CW30: RELECONTR.COR.DI GUASTO 24-240VAC; 3UG46252CW30: RELECONTR.COR.DI GUASTO 24-240VAC ML.

## R711 I831 — PULSANTI 3SB1/2

309 articles; profile `control`; kinds: device=68, accessory=3; unresolved kind: 238; without technical/software values: 309.

Populated filters: article_kind=71.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, poles, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3SB20000AB01: PULSANTE PIATTO NERO 16MM; 3SB20000AC01: PULSANTE PIATTO ROSSO 16MM.

## R711 I833 — COLONNE DI SEGNALAZIONE

204 articles; profile `signalling`; kinds: device=27, accessory=25; unresolved kind: 152; without technical/software values: 189.

Populated filters: article_kind=52, supply_voltage=15.

Supported but unpopulated: depth, diameter, height, ip_rating, licence_type, software_delivery, software_version, width. Ambiguous: supply_voltage=2.

Imported examples: 8WD42001AB: LUCE FISSA ROSSA 50MM; 8WD42001AC: LUCE FISSA 12-230 V UC VERDE.

## R711 I836 — SIMOCODE

141 articles; profile `control`; kinds: accessory=19, software=34; unresolved kind: 88; without technical/software values: 123.

Populated filters: article_kind=53, software_version=16, ip_rating=1, software_delivery=4.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, licence_type, poles, rated_current, supply_voltage, width. Ambiguous: none.

Imported examples: 3UF18683GA00: TRASF.AMPER.X 3UB1 205-820A; 3UF19001KA00: TERMINALE PER SIMOCODE.

## R711 I837 — DISPOSITIVI DI SICUR

49 articles; profile `control`; kinds: device=23, accessory=3, software=7; unresolved kind: 16; without technical/software values: 45.

Populated filters: article_kind=33, digital_outputs=2, digital_inputs=2.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, height, ip_rating, licence_type, poles, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RK31111AA10: MSS BASIC 4-8FDI,1FRO,1FDO,24VDC VITE; 3RK31112AA10: MSS BASIC 4-8FDI,1FRO, 1FDO,24VDC MOLLA.

## R711 I840 — FINECORSA STANDARD 3SE5

744 articles; profile `control`; kinds: accessory=57, device=239; unresolved kind: 448; without technical/software values: 727.

Populated filters: article_kind=296, diameter=15, ip_rating=2.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, digital_inputs, digital_outputs, height, licence_type, poles, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3SE50000AA01: LEVA IN MET 27MM CON ROT PLAST D19MM; 3SE50000AA02: LEVA IN MET 27MM CON ROT ACCIAIO D19MM.

## R711 I841 — FINECORSA 3SE

12 articles; profile `control`; kinds: device=1, accessory=5; unresolved kind: 6; without technical/software values: 12.

Populated filters: article_kind=6.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, poles, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3SE55320FC05: POSITION SWITCH; 3SX3170: PERNO CON ROTELLA P FINECORSA.

## R711 I842 — FINECORSA DI SICUREZZA 3SE5

93 articles; profile `accessories`; kinds: accessory=85, device=8; unresolved kind: 0; without technical/software values: 87.

Populated filters: article_kind=93, diameter=4, ip_rating=2.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, digital_inputs, digital_outputs, height, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3SE50000AA011AJ0: TWIST LEVER FOR 3SE5; 3SE50000AA111AJ0: TWIST LEVER FOR 3SE5.

## R711 I880 — CONVERTITORI D'INTER

36 articles; profile `control`; kinds: device=36; unresolved kind: 0; without technical/software values: 36.

Populated filters: article_kind=36.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, poles, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RS70001AE00: CONVSEG. IN.0-10V OUT.0-10V 24VUC; 3RS70001CE00: CONVSEG. IN.0-10V OUT.0-20MA 24VUC.

## R711 I882 — RELE' DI CONTROLLO T

22 articles; profile `control`; kinds: device=10; unresolved kind: 12; without technical/software values: 22.

Populated filters: article_kind=10.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, poles, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RQ20001AW00: MORSINTERF. 1W 24-240VUC VITE; 3RQ20001BW00: MORSINTERF. 2W 24-240VUC VITE.

## R711 I883 — RELE' DI PROT MOTORE

30 articles; profile `control`; kinds: device=27; unresolved kind: 3; without technical/software values: 30.

Populated filters: article_kind=27.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, poles, rated_current, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RN20001AA30: SGANC BASE 1W 24VAC/DC VT; 3RN20001AW30: SGANC BASE 1W 24-240VAC/DC VT.

## R711 I885 — RELE' DI CONTROLLO

128 articles; profile `control`; kinds: device=73; unresolved kind: 55; without technical/software values: 126.

Populated filters: article_kind=73, rated_current=2.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, poles, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3UG45011AA30: RELECONTR. LIV. LIQUIDI 24VUC; 3UG45011AW30: RELECONTR. LIV. LIQUIDI 24-240VUC.

## R711 I980 — SIRIUS SOFT STARTERS 3RW50

128 articles; profile `starters`; kinds: device=128; unresolved kind: 0; without technical/software values: 0.

Populated filters: article_kind=128, rated_current=128, rated_voltage=128, supply_voltage=64.

Supported but unpopulated: current_setting_max, current_setting_min, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, rated_power, software_delivery, software_version, width. Ambiguous: supply_voltage=64.

Imported examples: 3RW50552AB04: SOFTSTARTER 400V 143A AUS 24V AC/DC ML; 3RW50552AB05: SOFTSTARTER 500V 143A AUS 24V AC/DC ML.

## R711 I981 — SIRIUS SOFT STARTERS 3RW52

288 articles; profile `starters`; kinds: device=288; unresolved kind: 0; without technical/software values: 0.

Populated filters: article_kind=288, rated_current=288, rated_voltage=36, supply_voltage=36.

Supported but unpopulated: current_setting_max, current_setting_min, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, rated_power, software_delivery, software_version, width. Ambiguous: rated_voltage=252.

Imported examples: 3RW52131AC04: SOFTSTARTER 400V AC 13A AUS 24V AC/DC VITE; 3RW52131AC05: SOFTSTARTER 500V AC 13A AUS 24V AC/DC VITE.

## R711 I982 — SIRIUS SOFT STARTERS 3RW55

272 articles; profile `starters`; kinds: device=260, software=10; unresolved kind: 2; without technical/software values: 2.

Populated filters: article_kind=270, rated_current=260, rated_voltage=92, supply_voltage=56, software_version=10.

Supported but unpopulated: current_setting_max, current_setting_min, depth, diameter, digital_inputs, digital_outputs, height, ip_rating, licence_type, rated_power, software_delivery, width. Ambiguous: rated_voltage=168, supply_voltage=36.

Imported examples: 3RW55131HA04: SOFTSTARTER 400V AC 13A AUS 24V AC/DC VITE; 3RW55131HA05: SOFTSTARTER 500V AC 13A AUS 24V AC/DC VITE.

## R711 I983 — SIRIUS SOFT STARTERS 3RW59

143 articles; profile `accessories`; kinds: accessory=143; unresolved kind: 0; without technical/software values: 142.

Populated filters: article_kind=143, ip_rating=1.

Supported but unpopulated: analog_inputs, analog_outputs, coil_voltage, depth, diameter, digital_inputs, digital_outputs, height, licence_type, software_delivery, software_version, supply_voltage, width. Ambiguous: none.

Imported examples: 3RW59000CC00: COM CONNECTION CABLE 3RW50; 3RW59000GL00: HINGED LID 3RW50.

## R716 I780 — IMPEDENZE 4EM

83 articles; profile `reactive`; kinds: accessory=62; unresolved kind: 21; without technical/software values: 83.

Populated filters: article_kind=62.

Supported but unpopulated: apparent_power, depth, diameter, height, ip_rating, licence_type, rated_current, rated_voltage, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 4EF11050GB: SINEW F 3AC500V 4A 100HZ/8KHZ; 4EF11053GB: SINEW F 3AC500V 17,5A 100HZ/8KHZ.

## R716 I872 — TRASFORMAT FINO 16 K

430 articles; profile `power`; kinds: device=391; unresolved kind: 39; without technical/software values: 165.

Populated filters: article_kind=391, ip_rating=262, apparent_power=91.

Supported but unpopulated: depth, diameter, height, licence_type, output_voltage, rated_current, rated_power, rated_voltage, software_delivery, software_version, width. Ambiguous: apparent_power=21.

Imported examples: 4AM23424TN000EA0: TRAFO MON 0020KVA 230+-5%/24V IP00; 4AM23424TN000EA1: SAFETY ISOLATING TRANSFORMER,.

## R716 I877 — ALIMENT 4AV

31 articles; profile `power`; kinds: device=26; unresolved kind: 5; without technical/software values: 31.

Populated filters: article_kind=26.

Supported but unpopulated: apparent_power, depth, diameter, height, ip_rating, licence_type, output_voltage, rated_current, rated_power, rated_voltage, software_delivery, software_version, width. Ambiguous: none.

Imported examples: 4AV20002EB000A: ALIM. MONO 230-400VSEC24VCC /25A; 4AV20012EB000A: ALIM. MONO 115-230-400VSEC24VCC /25A.
