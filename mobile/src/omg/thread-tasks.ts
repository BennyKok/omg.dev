/**
 * Threads on the phone. Every rule is shared with the server and the web app
 * in packages/protocol/src/threads.ts; this re-exports what the phone uses.
 */

export {
  THREAD_PULL_ARM,
  THREAD_PULL_HINT,
  threadPullStage,
  mentionsOmg,
  authorHue,
  authorName,
  replySummary,
  repliesTo,
  startsMessageGroup,
  topLevelMessages,
  cardMessageIds,
  latestTaskEvent,
  sameSession,
  TASK_STATE_LABEL,
  taskCardFor,
  taskCardState,
  type TaskCardState,
} from "../../../packages/protocol/src/threads";
