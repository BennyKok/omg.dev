/**
 * Threads on the phone. The card rules are shared with the server and the web
 * app in packages/protocol/src/threads.ts; only Home's pull gesture is here.
 */

export {
  cardMessageIds,
  latestTaskEvent,
  sameSession,
  TASK_STATE_LABEL,
  taskCardFor,
  taskCardState,
  type TaskCardState,
} from "../../../packages/protocol/src/threads";

/** Pull distances on Home, in points. A normal refresh fires well before the first. */
export const THREAD_PULL_HINT = 90;
export const THREAD_PULL_ARM = 150;

/** 0: nothing. 1: show "keep pulling". 2: armed, release starts a thread. */
export function threadPullStage(pull: number): 0 | 1 | 2 {
  if (pull >= THREAD_PULL_ARM) return 2;
  if (pull >= THREAD_PULL_HINT) return 1;
  return 0;
}
