// The "What's new" drawer's Update button state machine, kept as a pure
// reducer so the bootId-change and 409 branches are testable without
// mounting the drawer or faking a poll loop.

export type UpdateFlowState =
  | { phase: "idle" }
  | { phase: "updating" }
  // `alreadyRunning` is a 409: someone else (another tab, another device)
  // started the update first. Same wait, different footer copy.
  | { phase: "restarting"; alreadyRunning: boolean; bootId: string }
  | { phase: "confirmed" }
  | { phase: "failed"; message: string };

export type UpdateFlowAction =
  | { type: "start" }
  | { type: "post-ok"; restarting: boolean; bootId: string }
  | { type: "post-conflict"; bootId: string }
  | { type: "post-error"; message: string }
  | { type: "boot-id"; bootId: string }
  | { type: "poll-timeout" }
  | { type: "retry" };

export const INITIAL_UPDATE_FLOW_STATE: UpdateFlowState = { phase: "idle" };

export function updateFlowReducer(
  state: UpdateFlowState,
  action: UpdateFlowAction,
): UpdateFlowState {
  switch (action.type) {
    case "start":
      return { phase: "updating" };
    case "post-ok":
      return action.restarting
        ? { phase: "restarting", alreadyRunning: false, bootId: action.bootId }
        : { phase: "confirmed" };
    case "post-conflict":
      return { phase: "restarting", alreadyRunning: true, bootId: action.bootId };
    case "post-error":
      return { phase: "failed", message: action.message };
    case "boot-id":
      if (state.phase !== "restarting") return state;
      return action.bootId !== state.bootId ? { phase: "confirmed" } : state;
    case "poll-timeout":
      return state.phase === "restarting"
        ? { phase: "failed", message: "omg.dev did not come back after restarting. Check the service logs." }
        : state;
    case "retry":
      return { phase: "idle" };
    default:
      return state;
  }
}

/** Structural, not `instanceof` — see isPlanLimitError in omg-client.ts for why. */
export function apiErrorStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && typeof (error as { status?: unknown }).status === "number"
    ? (error as { status: number }).status
    : undefined;
}
