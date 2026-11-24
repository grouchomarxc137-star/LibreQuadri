import { useEffect, useMemo, useState } from "react";
import type {
  ConfigModelDetail, ConfigurationApi, ConfigurationRequest, ConfigurationResult,
} from "../../shared/configuration.js";
import { changeChoice, configurationRequest } from "./presentation.js";

export interface ModelConfigurationState {
  readonly modelId: number | null;
  readonly model: ConfigModelDetail | null;
  readonly modelError: boolean;
  /** Choices made by the user; the resolver applies defaults, rules and availability. */
  readonly explicit: readonly number[];
  readonly result: ConfigurationResult | null;
  readonly resolving: boolean;
  readonly resolveError: boolean;
  /**
   * The resolved option ids of the first resolution after the model loaded (the saved choices of a project
   * item, resolved against the current catalogue). Later results are compared with it, so catalogue drift
   * alone never reads as a change; null until that first resolution settles.
   */
  readonly baseline?: readonly number[] | null;
}

export const emptyModelConfiguration: ModelConfigurationState = {
  modelId: null, model: null, modelError: false, explicit: [], result: null, resolving: false, resolveError: false,
};

/** True once the current resolution differs from the baseline: a genuine change of the resolved choices. */
export function configurationChanged(state: Pick<ModelConfigurationState, "baseline" | "result">): boolean {
  const { baseline, result } = state;
  if (!baseline || !result) return false;
  const current = new Set(result.selectedOptionIds);
  return current.size !== baseline.length || baseline.some(id => !current.has(id));
}

/** Value codes can occur on several branches of one axis; saved parent choices disambiguate them. */
export function restoredOptionIds(model: ConfigModelDetail,
  savedSelections: readonly { dimensionCode: string; valueCode: string }[]): number[] {
  const saved = new Map(savedSelections.map(row => [row.dimensionCode,row.valueCode]));
  const axes = new Map(model.axes.map(axis => [axis.id,axis]));
  const options = new Map(model.axes.flatMap(axis => axis.options.map(option => [option.id,option] as const)));
  const matchesParents = (optionId: number, seen = new Set<number>()): boolean => {
    const option = options.get(optionId);
    if (!option || seen.has(optionId)) return false;
    if (option.parentOptionId === null) return true;
    const parent = options.get(option.parentOptionId);
    const parentAxis = parent && axes.get(parent.axisId);
    if (!parent || !parent.active || !parentAxis || saved.get(parentAxis.dimensionCode) !== parent.valueCode) return false;
    seen.add(optionId);
    return matchesParents(parent.id,seen);
  };
  return savedSelections.flatMap(row => model.axes.flatMap(axis => {
    if (axis.dimensionCode !== row.dimensionCode) return [];
    const candidates = axis.options.filter(option => option.active && option.valueCode === row.valueCode &&
      matchesParents(option.id));
    return candidates.length === 1 ? [candidates[0]!.id] : [];
  }));
}

/** Loads one model and keeps its backend resolution current; older responses never overwrite newer state. */
export class ModelConfigurationSession {
  state: ModelConfigurationState = emptyModelConfiguration;
  private productId: number | undefined;
  private generation = 0;
  private baselineGeneration = 0;
  constructor(private readonly api: Pick<ConfigurationApi, "model" | "resolve">,
    private readonly changed: (state: ModelConfigurationState) => void) {}

  private publish(state: ModelConfigurationState) { this.state = state; this.changed(state); }

  select(modelId: number | null, productId?: number,
    savedSelections: readonly { dimensionCode: string; valueCode: string }[] = [],
    initialOptionIds?: readonly number[]) {
    const generation = ++this.generation;
    this.productId = productId;
    if (modelId === null) { this.publish(emptyModelConfiguration); return; }
    this.publish({ ...emptyModelConfiguration, modelId, baseline: null });
    this.api.model(modelId).then(model => {
      if (generation !== this.generation) return;
      const explicit = initialOptionIds ? [...initialOptionIds] : restoredOptionIds(model,savedSelections);
      this.publish({ ...this.state, model, explicit });
      this.baselineGeneration = generation;
      this.resolve(generation);
    }, () => { if (generation === this.generation) this.publish({ ...this.state, modelError: true }); });
  }

  choose(axisId: number, optionId: number | null) {
    const { model, explicit, result } = this.state;
    if (!model) return;
    this.publish({ ...this.state, explicit: changeChoice(model, explicit, result?.selectedOptionIds ?? [], axisId, optionId) });
    this.resolve(++this.generation);
  }

  /** The request that produced the current result, for the configured-item insertion. */
  request(): ConfigurationRequest | null {
    return this.state.model ? configurationRequest(this.state.model.id, this.state.explicit, this.productId) : null;
  }

  private resolve(generation: number) {
    const request = this.request();
    if (!request) return;
    this.publish({ ...this.state, result: null, resolving: true, resolveError: false });
    this.api.resolve(request).then(result => {
      if (generation !== this.generation) return;
      const baseline = generation === this.baselineGeneration && !this.state.baseline ? result.selectedOptionIds : this.state.baseline;
      this.publish({ ...this.state, result, resolving: false, baseline });
    }, () => { if (generation === this.generation) this.publish({ ...this.state, resolving: false, resolveError: true }); });
  }

  dispose() { this.generation++; }
}

export function useModelConfiguration(api: Pick<ConfigurationApi, "model" | "resolve">,
  modelId: number | null, productId?: number,
  savedSelections: readonly { dimensionCode: string; valueCode: string }[] = [],
  initialOptionIds?: readonly number[]) {
  const [state, setState] = useState(emptyModelConfiguration);
  const session = useMemo(() => new ModelConfigurationSession(api, setState), [api]);
  useEffect(() => () => session.dispose(), [session]);
  const selectionKey = JSON.stringify(savedSelections);
  const initialKey = initialOptionIds === undefined ? undefined : JSON.stringify(initialOptionIds);
  useEffect(() => { session.select(modelId, productId, JSON.parse(selectionKey),
    initialKey === undefined ? undefined : JSON.parse(initialKey)); },
    [session, modelId, productId, selectionKey, initialKey]);
  return { state, session };
}
