import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";

/*
 * Renderer-only application status (docs/R17_VISUAL_DESIGN.md §3.7): the latest operation
 * message shown in the status bar's live region, and the context segments each workspace
 * publishes for itself. Nothing here reaches the main process.
 */
/** `ok` marks a completed operation (green check), `valid` a valid drag position (green dot). */
export type StatusTone = "neutral" | "ok" | "valid";

/** One status-bar segment: `label <b>value</b> unit`, all optional except the id. */
export interface StatusSegment {
  readonly id: string;
  readonly label?: string;
  readonly value?: string;
  readonly unit?: string;
  /** Full text for a segment that may be truncated. */
  readonly title?: string;
}

export interface StatusState {
  readonly message: string | null;
  readonly tone: StatusTone;
  /** Context segments keyed by the workspace that published them. */
  readonly segments: Readonly<Record<string, readonly StatusSegment[]>>;
}

export type StatusAction =
  | { readonly type: "announce"; readonly message: string | null; readonly tone: StatusTone }
  | { readonly type: "segments"; readonly source: string; readonly segments: readonly StatusSegment[] | null };

export const initialStatusState: StatusState = { message: null, tone: "neutral", segments: {} };

function sameSegments(a: readonly StatusSegment[], b: readonly StatusSegment[]): boolean {
  return a.length === b.length && a.every((segment, index) => {
    const other = b[index]!;
    return segment.id === other.id && segment.label === other.label && segment.value === other.value &&
      segment.unit === other.unit && segment.title === other.title;
  });
}

/** Unchanged input returns the same state, so publishing from an effect cannot loop. */
export function statusReducer(state: StatusState, action: StatusAction): StatusState {
  switch (action.type) {
    case "announce":
      return state.message === action.message && state.tone === action.tone ? state
        : { ...state, message: action.message, tone: action.tone };
    case "segments": {
      const current = state.segments[action.source];
      if (action.segments === null) {
        if (!current) return state;
        const { [action.source]: _removed, ...rest } = state.segments;
        return { ...state, segments: rest };
      }
      if (current && sameSegments(current, action.segments)) return state;
      return { ...state, segments: { ...state.segments, [action.source]: action.segments } };
    }
  }
}

export interface StatusActions {
  /** Replace the status message. */
  announce(message: string | null, tone?: StatusTone): void;
  /** Publish (or with null withdraw) the context segments of one workspace. */
  setSegments(source: string, segments: readonly StatusSegment[] | null): void;
}

const noActions: StatusActions = { announce: () => undefined, setSegments: () => undefined };

export const StatusStateContext = createContext<StatusState>(initialStatusState);
const StatusActionsContext = createContext<StatusActions>(noActions);

export function StatusProvider({ children }: { readonly children: ReactNode }) {
  const [state, dispatch] = useReducer(statusReducer, initialStatusState);
  const actions = useMemo<StatusActions>(() => ({
    announce: (message, tone = "neutral") => dispatch({ type: "announce", message, tone }),
    setSegments: (source, segments) => dispatch({ type: "segments", source, segments }),
  }), []);
  return <StatusActionsContext.Provider value={actions}>
    <StatusStateContext.Provider value={state}>{children}</StatusStateContext.Provider>
  </StatusActionsContext.Provider>;
}

/** Stable actions; using them does not re-render the caller when the status changes. */
export function useStatusActions(): StatusActions {
  return useContext(StatusActionsContext);
}

export function useStatusState(): StatusState {
  return useContext(StatusStateContext);
}
