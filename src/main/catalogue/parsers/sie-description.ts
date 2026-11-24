import type { AttributeParseInput, AttributeParseResult, AttributeParser, ParsedAttributeValue } from "../attribute-enrichment.js";
import { SIE_FAMILY_PROFILES } from "./sie-families.js";

const N = String.raw`\d+(?:[.,]\d+)?`;
const decimal = (value: string) => Number(value.replace(",", "."));
const electrical = new Set(["protection", "motor_protection", "fuses", "switching", "contactors", "starters", "overload", "distribution", "power", "reactive", "motors", "drives", "terminals", "control"]);
// Leading article nouns take precedence over the statistical family's title.
const accessory = /^(?:ACCESSOR|SPARE\b|RICAMB|CALOTT|COPERT|COVER\b|TAPPO\b|MANIGL|LEVA\b|TWIST LEVER|GUIDA\b|RAIL\b|PIASTR|PANELLO|PANNELLO|PORTA\b|BASE\b|MORSETT|MORS[ .]|CONNET|CONN[ .]|CAVO\b|CABLE\b|CAB\b|PROLUNGA|LINEA A UN CAVO|ONE-CABLE|SHIELD\b|STAFF|SUPPORT|ADAT|ADAPT|MOUNT|ELE[MNC]|BLOC[ .]MEC|BLOCCO MEC|CONT[ .](?:AUS|AUX)|CONTATTI\b|AUX\b|BOB[ .]|BOBINA\b|SGMIN|SGANC[ .](?:MIN|AP)|VARIST|DIODO|FILTRO\b|EMC.FILTER|SURGE SUPPRESS|SEAL|GUARNIZ|RESET\b|TRASF[ .]AMPER|EARTHRING|SET OF|PACKAGE OF|CONFEZIONE|LIBRET|MANUAL\b|DOCUMENT|USB\b|MEMORY CARD|S7 MICRO MEMORY)/;
const software = /(?:\b(?:SOFTWARE|LICENSE|LICEN[ZS]|LIBRARY|LIBRERIE|WINCC|STEP\s*7|STEP7|SIMIT|BRAUMAT|SISTAR|SOFTNET|RUNTIME|SUS)\b|\b(?:SIMOCODE|SAFETY|SOFT STARTER) ES\b)/;
const device = /^(?:INT[ .]|INTAUT|MTD\b|DIFF[ .]|BLOCCO DIFF|SPD\b|FUS[ .]|SEZ|COMMUT|COMM MAN|CONT(?:ATT|ACT|[ .]|\d|S\d|AUS)|PICCOLO CONT|MOTOR CONTACT|INV\d|REVCOMB|AS-T\b|AVV|AVDIR|PARTENZA\b|SOFTSTARTER|SOFT STARTER|MOTOR STARTER|ILF\b|RELE|TIME RELAY|COUPLING RELAY|DISPSIC|SGANC BASE|SGANC STAND|PULS|FIN[ .]|POS[ .]|POSITION SWITCH|SIRIUS POSITION|BASIC SWITCH|MSS\b|LUCE\b|LAMP|SITRANS\b|SIPART\b|PAC\d|CONTAORE|CONVSEG|TRAFO\b|TRANSFORMER|ALIM[ .]|SITOP\b|LOGO!POWER|MOTORE\b|SERVOMOTOR|SINAMICS\b|G120X\b|CPU\b|SIMATIC (?:CPU|HMI|IPC|ET|CN)|S7-\d|ET\s?200|LOGO!\b|SCALANCE\b|AS-I (?:MOD|MASTER)|MODULO AS-I|IO-LINK MODUL[OE]|SIMBOX|ALPHA (?:BOX|SP)|ARMADIO|ARM[ .]|STRUTTURA)/;

/** Only explicit, unambiguous article facts. Codes identify no electrical rating. */
export function parseSiemensDescription(input: AttributeParseInput): AttributeParseResult {
  const profile = input.statisticalFamilyIssuerSigla === "SIE"
    ? SIE_FAMILY_PROFILES[input.statisticalFamilyCode ?? ""] : undefined;
  if (!profile) return { values: new Map(), ambiguous: [] };
  const description = input.description.toUpperCase().replace(/\s+/g, " ").trim();
  const candidates = new Map<string, Map<string | number, ParsedAttributeValue>>();
  const uncertain = new Set<string>();
  const add = (code: string, value: string | number) => {
    if (typeof value === "number" && (!Number.isFinite(value) || value <= 0)) return;
    const values = candidates.get(code) ?? new Map();
    values.set(value, typeof value === "number" ? { kind: "number", value } : { kind: "option", value });
    candidates.set(code, values);
  };
  const matches = (text: string, regex: RegExp, visit: (m: RegExpMatchArray) => void) => {
    for (const m of text.matchAll(regex)) visit(m);
  };
  const isAccessory = accessory.test(description) && !(profile === "terminals" && /^MORSETTO\b/.test(description));
  const kind = isAccessory ? "accessory" : software.test(description) || profile === "software" ? "software"
    : device.test(description) ? "device" : profile === "accessories" ? "accessory" : undefined;
  if (kind) add("article_kind", kind);

  if (kind === "software") {
    // Multiple versions (including upgrade source/target) remain ambiguous.
    matches(description, /\bV(\d+(?:\.\d+){0,2})(?![\dA-Z.])/g, m => add("software_version", `v${m[1]!.replaceAll(".", "_")}`));
    matches(description, /\b(FLOATING|SINGLE|TRIAL|RENTAL)(?:[ -]LICEN[CS]E)?\b/g, m => add("licence_type", m[1]!.toLowerCase()));
    if (/\bFL\b/.test(description)) add("licence_type", "floating");
    if (/\bSL\b/.test(description)) add("licence_type", "single");
    if (/\bSUS\b|SW UPDATE SERVICE|SOFTWARE UPDATE SERVICE/.test(description)) add("software_delivery", "sus");
    if (/\bUPG(?:RADE)?\b|\bUPGR\b|\bUG\b/.test(description)) add("software_delivery", "upgrade");
    if (/\bUPDATE\b/.test(description) && !/UPDATE SERVICE/.test(description)) add("software_delivery", "update");
  } else {
    // A rating after "for another device" belongs to that device, not this article.
    const own = description.split(/\s+(?:PER|FOR|FUER|FÜR|X)\s+/)[0]!;
    matches(own, /\bIP\s*([0-6X][0-9X])(?!\w)/g, m => {
      if (m[1] !== "XX") add("ip_rating", `ip${m[1]!.toLowerCase()}`);
    });
    // Dimensions need an explicit axis or ordered axis legend; a bare 30MM could be a length, diameter or pitch.
    matches(own, new RegExp(String.raw`\b(H|B|W|L|P|D)\s*(${N})(?![\d.,])`, "g"), m => {
      const axis: Record<string, string> = { H: "height", B: "width", W: "width", L: "width", P: "depth", D: "depth" };
      // Axis abbreviations are reviewed only for sheet-metal/enclosure families.
      if (profile !== "enclosures") return;
      // L is also used for rail length. Only the reviewed H… L… panel notation means width.
      if (m[1] === "L" && !/\bH\s*\d/.test(own)) return;
      const code = axis[m[1]!]!;
      // Siemens has pre-truncated fields of several lengths, e.g. terminal H1/B6/P2.
      // A short final unitless axis value cannot establish an enclosure dimension.
      if (m.index! + m[0].length === own.length && /^\d{1,2}$/.test(m[2]!)) uncertain.add(code);
      else add(code, decimal(m[2]!));
    });
    matches(own, new RegExp(String.raw`\bHXWXD\s*(${N})\s*X\s*(${N})\s*X\s*(${N})`, "g"), m => {
      add("height", decimal(m[1]!)); add("width", decimal(m[2]!)); add("depth", decimal(m[3]!));
    });
    matches(own, new RegExp(String.raw`\b(?:DIAM(?:ETRO)?[ .]*|Ø\s*)(${N})\s*MM\b`, "g"), m => add("diameter", decimal(m[1]!)));
    matches(own, new RegExp(String.raw`\b(?:WIDTH|LARGHEZZA|HEIGHT|ALTEZZA|DEPTH|PROFONDITA)\s*[:=]?\s*(${N})\s*MM\b`, "g"), m => {
      add(/^(WIDTH|LARGHEZZA)/.test(m[0]) ? "width" : /^(HEIGHT|ALTEZZA)/.test(m[0]) ? "height" : "depth", decimal(m[1]!));
    });
    // Explicit coil/auxiliary supply labels are accepted even on replacement coils.
    const labelledVoltage = new RegExp(String.raw`\b(BOB(?:INA|\.)?|COIL|AUS|US|SUPPLY|ALIM(?:ENTAZIONE)?)\s*[=:]?\s*(?:AC\s*|DC\s*)?(${N})(?:\s*[-/]\s*(${N}))?\s*V(?![A-Z])`, "g");
    let voltageText = own.replace(labelledVoltage, (full: string, label: string, first: string, second?: string) => {
      const attr = /^(BOB|COIL)/.test(label) ? "coil_voltage" : "supply_voltage";
      if (second) uncertain.add(attr); else add(attr, decimal(first));
      return " ";
    });
    voltageText = voltageText.replace(new RegExp(String.raw`(${N})(?:\s*[-/]\s*(${N}))?\s*V\s*(?:AC|DC|UC)?\s+AUS\b`, "g"),
      (full: string, first: string, second?: string) => { if (second) uncertain.add("supply_voltage"); else add("supply_voltage", decimal(first)); return " "; });
    if (profile === "contactors") voltageText = voltageText.replace(
      new RegExp(String.raw`${N}\s*KW\s*/\s*(${N})\s*V`, "g"), (full: string, value: string) => {
        if (kind === "device") add("rated_voltage", decimal(value)); return " ";
      });
    if (kind === "device") {
      const voltageCode = profile === "contactors" ? "coil_voltage" : profile === "power" ? "output_voltage"
        : profile === "signalling" ? "supply_voltage" : "rated_voltage";
      // Unlabelled voltage is unsafe in measurement/control descriptions (signal, load and supply can coexist).
      if (!["automation", "networking", "measurement", "control", "overload"].includes(profile) && !/^SPD\b/.test(own)
        && (profile !== "power" || /^(?:SITOP (?:PSU|MODULAR|SMART)|LOGO!POWER)/.test(own))) {
        const voltage = new RegExp(String.raw`(?<![\d.,])(${N})(?:\s*[-/]\s*(${N}))?\s*V(?:AC|DC|CA|CC|UC|C\.A\.|C\.C\.)?(?![A-Z0-9])`, "g");
        matches(voltageText, voltage, m => { if (m[2]) uncertain.add(voltageCode); else add(voltageCode, decimal(m[1]!)); });
      }
      let currentText = own;
      if (electrical.has(profile)) {
        // Remove current ranges before reading nominal current, never use the upper bound as In.
        currentText = own.replace(new RegExp(String.raw`\bIC[NU]\s*${N}\s*(?:KA|A)\b`, "g"), " ")
          .replace(new RegExp(String.raw`(?<![\d.,])(${N})\s*-\s*(${N})\s*A(?![A-Z])`, "g"), (full: string, min: string, max: string) => {
          if (["motor_protection", "overload", "starters"].includes(profile)) {
            add("current_setting_min", decimal(min)); add("current_setting_max", decimal(max));
          }
          return " ";
        });
        // In residual devices, a small A value after TIPO denotes residual current.
        currentText = currentText.replace(new RegExp(String.raw`(TIPO\s*(?:AC|AG|AS|A|F|B)\s*)(${N})\s*A(?![A-Z])`, "g"), (full: string, prefix: string, val: string) => {
          if (profile === "protection") add("rated_residual_current", decimal(val) * 1000);
          return prefix;
        });
        if (/^(?:MTD|DIFF|BLOCCO DIFF)/.test(own)) currentText = currentText.replace(
          new RegExp(String.raw`\b(${N})\s*A\s+(?=TIPO\b)`, "g"), (full: string, val: string) => {
            add("rated_residual_current", decimal(val) * 1000); return " ";
          });
        matches(currentText, new RegExp(String.raw`(?<![\w.,/-])(${N})\s*A(?![A-Z0-9])`, "g"), m => add("rated_current", decimal(m[1]!)));
        const powerText = own.replace(/\b(?:CONT(?:S\d+)?|INV|REVCOMB)(?=\d)/g, " ")
          .replace(new RegExp(String.raw`${N}\s*[-/]\s*${N}\s*K(?:W|VA)\b`, "g"), " ");
        matches(powerText, new RegExp(String.raw`(?<![\w.,])(${N})\s*KW(?![A-Z])`, "g"), m => add("rated_power", decimal(m[1]!)));
        matches(powerText, new RegExp(String.raw`(?<![\w.,/])(${N})\s*KVA(?![A-Z])`, "g"), m => {
          // Imported TRAFO MON 0020KVA is an undocumented decimal encoding.
          if (!/^0\d/.test(m[1]!)) {
            const power = decimal(m[1]!);
            // The imported family explicitly says transformers up to 16 kVA, yet has 63/213KVA tokens.
            if (input.statisticalFamilyCode === "R716 I872" && power > 16) uncertain.add("apparent_power");
            else add("apparent_power", power);
          }
        });
        matches(own, new RegExp(String.raw`(?<![\w.,])(${N})\s*NM(?![A-Z])`, "g"), m => add("rated_torque", decimal(m[1]!)));
        matches(own, /\b([1-4])\s*P(?:\s*\+\s*(N))?(?![A-Z0-9])/g, m => add("poles", `${m[1]}p${m[2] ? "_n" : ""}`));
      }
      if (["protection", "motor_protection"].includes(profile) && !/^SPD\b/.test(own)) {
        matches(currentText, new RegExp(String.raw`\b([ABCDKEZ])\s*(${N})\s*A?(?![\w.,])`, "g"), m => { add("trip_curve", m[1]!.toLowerCase()); add("rated_current", decimal(m[2]!)); });
        matches(own, /\bCURVA\s*([ABCDKEZ])\b/g, m => add("trip_curve", m[1]!.toLowerCase()));
        matches(own, new RegExp(String.raw`\bIC(N|U)\s*(${N})\s*(KA|A)\b`, "g"), m => add(m[1] === "N" ? "rated_short_circuit_capacity" : "rated_ultimate_breaking_capacity", decimal(m[2]!) / (m[3] === "A" ? 1000 : 1)));
        // Unlabelled kA remains declared capacity; never label it Icn or Icu.
        const unlabelled = own.replace(new RegExp(String.raw`\bIC[NU]\s*${N}\s*(?:KA|A)\b`, "g"), " ");
        matches(unlabelled, new RegExp(String.raw`(?<![\w.,])(${N})\s*KA\b`, "g"), m => add("declared_breaking_capacity", decimal(m[1]!)));
        // The reviewed 4500A/6000A/10000A notation denotes declared capacity, not In.
        matches(unlabelled, /\b(4500|6000|10000)A\b/g, m => add("declared_breaking_capacity", Number(m[1]) / 1000));
        const high = candidates.get("rated_current");
        if (high) for (const v of [4500, 6000, 10000]) high.delete(v);
        matches(own, new RegExp(String.raw`(?<![\w.,-])(${N})\s*MA(?![A-Z])`, "g"), m => add("rated_residual_current", decimal(m[1]!)));
        matches(own, new RegExp(String.raw`\bTIPO\s*(?:AC|AG|AS|A|F|B)\s*(${N})\s*MA\b`, "g"), m => add("rated_residual_current", decimal(m[1]!)));
        matches(own, /\bTIPO\s*(AC|AG|AS|A|F|B)(?![A-Z])/g, m => { if (["AC", "A", "F", "B"].includes(m[1]!)) add("residual_current_type", m[1]!.toLowerCase()); });
        if (/\bTM\b/.test(own)) add("trip_unit_type", "thermomagnetic");
        if (/\bETU\d/.test(own)) {
          const trip = /(?:ETU\d*\s*)(LSIG|LSI|LI)(?![A-Z])/.exec(own);
          add("trip_unit_type", trip ? `electronic_${trip[1]!.toLowerCase()}` : "electronic");
        }
      }
      if (["automation", "networking", "control", "starters", "accessories"].includes(profile)) {
        const ios: Record<string, string> = { DI: "digital_inputs", DO: "digital_outputs", DQ: "digital_outputs", AI: "analog_inputs", AO: "analog_outputs", AQ: "analog_outputs" };
        matches(own, /\b(\d+)\s*(DI|DO|DQ|AI|AO|AQ)(?![A-Z])/g, m => add(ios[m[2]!]!, Number(m[1])));
        matches(own, /\b(DI|DO|DQ|AI|AO|AQ)\s+(\d+)X/g, m => add(ios[m[1]!]!, Number(m[2])));
      }
    }
  }
  const values = new Map<string, ParsedAttributeValue>();
  for (const [code, options] of candidates) {
    if (options.size > 1) uncertain.add(code);
    else if (options.size === 1 && !uncertain.has(code)) values.set(code, [...options.values()][0]!);
  }
  return { values, ambiguous: [...uncertain].sort() };
}

export const sieDescriptionParser: AttributeParser = { code: "sie.description", version: "1", parse: parseSiemensDescription };
