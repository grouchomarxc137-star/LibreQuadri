type Row = Readonly<Record<string, unknown>>;
const num = (row: Row, field: string) => Number(row[field] ?? 0);

/**
 * Project source choices onto their additive drawing-key effects. Choices on one label are
 * alternatives; second choices require their first option. Independent label components are
 * folded as sets of sums, so zero-effect axes do not multiply the whole configuration space.
 * Option identity and optional-axis semantics match the TiQuadri model import.
 */
export function enclosureProfileDeltas(definition: readonly Row[]): Set<number> {
  interface Option { key: string; parent: string | null; isDefault: boolean }
  interface Axis { options: Map<string, Option>; optional: boolean; neighbours: Set<number> }
  const axes = new Map<number, Axis>();
  const rules: { conditions: string[]; delta: number; label: number | null }[] = [];
  const addOption = (row: Row, slot: number, parent: string | null): string | null => {
    const label = num(row, `ID_Label_Modalita_${slot}`), value = num(row, `ID_Valore_Modalita_${slot}`);
    if (!label || !value) return null;
    let axis = axes.get(label);
    if (!axis) { axis = { options: new Map(), optional: false, neighbours: new Set() }; axes.set(label, axis); }
    const key = `${label}:${value}:${parent ?? "0"}`;
    if (!axis.options.has(key)) axis.options.set(key, { key, parent, isDefault: row[`Default_${slot}`] === true });
    return key;
  };
  for (const row of definition) {
    const first = addOption(row, 1, null), second = addOption(row, 2, first);
    const a = num(row, "ID_Label_Modalita_1"), b = num(row, "ID_Label_Modalita_2");
    if (first && second) { axes.get(a)!.neighbours.add(b); axes.get(b)!.neighbours.add(a); }
    const delta = num(row, "Aumenta_Famiglia");
    if (Number.isSafeInteger(delta) && delta !== 0) rules.push({
      conditions: [first, second].filter((key): key is string => key !== null), delta,
      label: first ? a : second ? b : null,
    });
  }
  for (const axis of axes.values()) {
    const roots = [...axis.options.values()].filter(option => option.parent === null);
    axis.optional = roots.length > 0 && !roots.some(option => option.isDefault);
  }
  const unconditional = rules.filter(rule => rule.label === null).reduce((sum, rule) => sum + rule.delta, 0);
  let sums = new Set([unconditional]);
  const visited = new Set<number>();
  for (const label of axes.keys()) {
    if (visited.has(label)) continue;
    const component: number[] = [], pending = [label];
    while (pending.length) {
      const next = pending.pop()!;
      if (visited.has(next)) continue;
      visited.add(next); component.push(next); pending.push(...axes.get(next)!.neighbours);
    }
    const effects = rules.filter(rule => rule.label !== null && component.includes(rule.label));
    if (!effects.length) continue;
    const selected = new Set<string>(), chosen: Option[] = [], deltas = new Set<number>();
    const enumerate = (index: number): void => {
      if (index === component.length) {
        if (chosen.some(option => option.parent !== null && !selected.has(option.parent))) return;
        // Omitting an optional axis is possible only if no available source default selects it.
        if (component.some(id => {
          const options = [...axes.get(id)!.options.values()];
          return !options.some(option => selected.has(option.key)) && options.some(option =>
            option.isDefault && (option.parent === null || selected.has(option.parent)));
        })) return;
        deltas.add(effects.filter(rule => rule.conditions.every(key => selected.has(key)))
          .reduce((sum, rule) => sum + rule.delta, 0));
        return;
      }
      const axis = axes.get(component[index]!)!;
      if (axis.optional) enumerate(index + 1);
      for (const option of axis.options.values()) {
        selected.add(option.key); chosen.push(option); enumerate(index + 1);
        chosen.pop(); selected.delete(option.key);
      }
    };
    enumerate(0);
    sums = new Set([...sums].flatMap(sum => [...deltas].map(delta => sum + delta)));
  }
  return new Set([...sums].filter(Number.isSafeInteger));
}

/** Missing/unknown permission is locked; repeated and dependent rows all contribute. */
export function placedAxisEditability(definition: readonly Row[]): Map<number, { permitted: number; locked: number }> {
  const result = new Map<number, { permitted: number; locked: number }>();
  for (const row of definition) for (const slot of [1, 2]) {
    const label = num(row, `ID_Label_Modalita_${slot}`);
    if (!label || !num(row, `ID_Valore_Modalita_${slot}`)) continue;
    const axis = result.get(label) ?? { permitted: 0, locked: 0 };
    if (row[`Modalita_${slot}_Modificabile_Nel_Pannello`] === true) axis.permitted++;
    else axis.locked++;
    result.set(label, axis);
  }
  return result;
}
