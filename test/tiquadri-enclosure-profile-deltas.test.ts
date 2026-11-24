import { describe, expect, it } from "vitest";
import { enclosureProfileDeltas, placedAxisEditability } from "../src/main/sources/tiquadri/enclosure-profile-deltas.js";

const choice = (label: number, value: number, delta: number, extra = {}) => ({
  ID_Label_Modalita_1: label, ID_Valore_Modalita_1: value,
  Aumenta_Famiglia: delta, Default_1: value === 1, ...extra,
});

describe("TiQuadri enclosure drawing deltas", () => {
  it("combines independent axes without combining alternatives on one axis", () => {
    expect([...enclosureProfileDeltas([
      choice(1, 1, 0), choice(1, 2, 1), choice(1, 3, 2), choice(1, 4, 3),
      choice(3, 1, 0), choice(3, 2, 4),
    ])].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("sums every matching row once and deduplicates equal resulting keys", () => {
    const repeated = choice(1, 2, 2);
    expect([...enclosureProfileDeltas([choice(1, 1, 0), repeated, repeated,
      choice(2, 1, 0), choice(2, 2, 4)])].sort((a, b) => a - b)).toEqual([0, 4, 8]);
  });

  it("respects parent options, including a label occurring in both source slots", () => {
    const rows = [choice(1, 1, 1, { ID_Label_Modalita_2: 2, ID_Valore_Modalita_2: 10 }),
      choice(1, 2, 8, { ID_Label_Modalita_2: 2, ID_Valore_Modalita_2: 20 }),
      choice(2, 1, 0)];
    // Selecting the root option on label 2 matches neither conditional row; selecting a child
    // matches only its own parent, never the cross-parent sum 9.
    expect([...enclosureProfileDeltas(rows)].sort((a, b) => a - b)).toEqual([0, 1, 8]);
  });

  it("supports optional omission, unconditional effects and negative deltas", () => {
    expect([...enclosureProfileDeltas([choice(0, 0, 2), choice(1, 2, -3)])]
      .sort((a, b) => a - b)).toEqual([-1, 2]);
    expect([...enclosureProfileDeltas([choice(1, 1, 0.5)])]).toEqual([0]);
  });

  it("folds many independent axes without enumerating their full Cartesian product", () => {
    const rows = Array.from({ length: 40 }, (_, i) => [choice(i + 1, 1, 0), choice(i + 1, 2, 1)]).flat();
    expect([...enclosureProfileDeltas(rows)].sort((a, b) => a - b))
      .toEqual(Array.from({ length: 41 }, (_, i) => i));
  });
});

it("requires permission from every contributing row in either slot, including duplicates", () => {
  const permitted = choice(1, 1, 0, { Modalita_1_Modificabile_Nel_Pannello: true,
    ID_Label_Modalita_2: 2, ID_Valore_Modalita_2: 10, Modalita_2_Modificabile_Nel_Pannello: true });
  expect(placedAxisEditability([permitted, permitted, choice(2, 2, 0),
    choice(3, 1, 0, { Modalita_1_Modificabile_Nel_Pannello: false }),
    choice(0, 0, 0, { Modalita_1_Modificabile_Nel_Pannello: true })]))
    .toEqual(new Map([[1, { permitted: 2, locked: 0 }], [2, { permitted: 2, locked: 1 }],
      [3, { permitted: 0, locked: 1 }]]));
});
