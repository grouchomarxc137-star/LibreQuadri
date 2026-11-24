import type {
  AttributeParseInput,
  AttributeParseResult,
  AttributeParser,
  ParsedAttributeValue,
} from "../attribute-enrichment.js";

/*
 * BTicino (marchio BTI) METEL short-description parser. Rules were verified on
 * the 872 classified BTI protection products of BTILSP021 (2026-09-21); see
 * db/seed/README.md. It proposes values only; the generic engine applies
 * category applicability and validation. Deliberately NOT parsed: values from
 * product codes, DIN modules, voltage, DC type, Im, selectivity, adjustable/HPI
 * features and product series.
 */

/** Width of the METEL description field; a full field may be truncated. */
const METEL_DESCRIPTION_LENGTH = 43;

const POLES: Readonly<Record<string, string>> = {
  "1P": "1p", "1P+N": "1p_n", "1PN": "1p_n", "2P": "2p", "3P": "3p", "4P": "4p",
};
const RESIDUAL_TYPES: Readonly<Record<string, string>> = {
  AC: "ac", A: "a", F: "f", B: "b", "A-S": "a", AS: "a",
};

/** "4,5" -> 4.5 (METEL descriptions use the Italian decimal comma). */
function decimal(text: string): number {
  return Number(text.replace(",", "."));
}

function parse({ description }: AttributeParseInput): AttributeParseResult {
  const tokens = description.toUpperCase().split(/\s+/).filter(token => token.length > 0);
  const candidates = new Map<string, ParsedAttributeValue[]>();
  const add = (code: string, value: ParsedAttributeValue) => {
    const list = candidates.get(code) ?? [];
    if (!list.some(existing => existing.kind === value.kind && existing.value === value.value)) list.push(value);
    candidates.set(code, list);
  };
  const number = (code: string, value: number) => add(code, { kind: "number", value });
  const option = (code: string, value: string) => add(code, { kind: "option", value });

  // "solo magnet(ico)": magnetic-only breakers; the stated current is not a thermal In.
  const magneticOnly = tokens.some((token, index) => token === "SOLO" && /^MAGN/.test(tokens[index + 1] ?? ""));
  const truncated = description.length === METEL_DESCRIPTION_LENGTH;

  tokens.forEach((token, index) => {
    const afterCurva = index > 0 && tokens[index - 1] === "CURVA";
    let match: RegExpExecArray | null;
    if (POLES[token]) option("poles", POLES[token]);
    if (afterCurva && /^[BCDKZ]$/.test(token)) option("trip_curve", token.toLowerCase());
    if ((match = /^([BCDKZ])(\d{1,3})$/.exec(token))) {
      option("trip_curve", match[1].toLowerCase());
      if (!magneticOnly) number("rated_current", Number(match[2]));
    }
    if (!magneticOnly && (match = /^(\d{1,3}(?:,\d+)?)A$/.exec(token))) number("rated_current", decimal(match[1]));
    if ((match = /^(\d{1,3}(?:,\d+)?)KA$/.exec(token))) number("declared_breaking_capacity", decimal(match[1]));
    if ((match = /^(\d{4,5})A$/.exec(token))) number("declared_breaking_capacity", Number(match[1]) / 1000);
    // Only the known truncation: a bare ampere value cut off at the end of a full field.
    if (truncated && index === tokens.length - 1 && (match = /^(\d{4,5})$/.exec(token))) {
      number("declared_breaking_capacity", Number(match[1]) / 1000);
    }
    if ((match = /^(\d{1,4})MA\??$/.exec(token))) number("rated_residual_current", Number(match[1]));
    // A letter after "curva" is a trip curve, never a residual-current type.
    if (!afterCurva && RESIDUAL_TYPES[token]) option("residual_current_type", RESIDUAL_TYPES[token]);
  });

  const values = new Map<string, ParsedAttributeValue>();
  const ambiguous: string[] = [];
  for (const [code, list] of candidates) {
    if (list.length === 1) values.set(code, list[0]);
    else ambiguous.push(code);
  }
  return { values, ambiguous: ambiguous.sort() };
}

export const btiDescriptionParser: AttributeParser = {
  code: "bti.description",
  version: "1",
  parse,
};
