/**
 * TASK CARDS IN A THREAD: one rule for what a card says.
 *
 * A task's state has three sources, joined here:
 *   - the thread's own messages: omg posts `started`, then `finished` or
 *     `blocked` after each settled turn (src/threads.ts, bridgeTaskCompletion);
 *   - the live row: is the task busy right now, and does it still exist;
 *   - `/api/ask`: is the task waiting on a person's answer.
 *
 * Pure: no React, so scripts/thread-tasks.native-check.ts can test it.
 */

import type { ThreadMessage, ThreadTaskEvent, ThreadTaskRow } from "./threads";

export type TaskCardState = "working" | "needs-you" | "done" | "failed" | "ended";

export const TASK_STATE_LABEL: Record<TaskCardState, string> = {
  working: "Working",
  "needs-you": "Needs you",
  done: "Done",
  failed: "Failed",
  ended: "Ended",
};

/** The same id in either form: a full uuid or a short prefix. */
export function sameSession(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || (x.length >= 8 && y.startsWith(x)) || (y.length >= 8 && x.startsWith(y));
}

/** The newest event omg posted for a task. */
export function latestTaskEvent(messages: readonly ThreadMessage[], sessionId: string): ThreadTaskEvent | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const task = messages[i].task;
    if (task && sameSession(task.sessionId, sessionId)) return task.event;
  }
  return null;
}

/**
 * A question waiting on the person wins over everything but a running turn.
 * Then the live row: busy is working. An idle task is done once it has
 * reported and working until then; a task gone from the list is its last
 * report, or "ended".
 */
export function taskCardState(input: {
  event: ThreadTaskEvent | null;
  row: ThreadTaskRow | null | undefined;
  openAsk: boolean;
}): TaskCardState {
  const waiting = input.openAsk || input.row?.status === "blocked" || input.event === "blocked";
  if (waiting && !input.row?.busy) return "needs-you";
  if (input.row?.busy) return "working";
  if (input.event === "failed") return "failed";
  if (input.event === "finished") return "done";
  if (input.row && !input.row.ended) return "working";
  return "ended";
}

/**
 * Which messages draw a card. Each task is drawn once, at the message that
 * started it; later messages about the same task are plain omg messages,
 * because the card above already shows the live state.
 */
export function cardMessageIds(messages: readonly ThreadMessage[]): Set<string> {
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const message of messages) {
    const task = message.task;
    if (!task) continue;
    const key = task.sessionId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ids.add(message.id);
  }
  return ids;
}

/** Pull distances on Home, in points. A normal refresh fires well before the first. */
export const THREAD_PULL_HINT = 90;
export const THREAD_PULL_ARM = 150;

/** 0: nothing. 1: show "keep pulling". 2: armed, release starts a thread. */
export function threadPullStage(pull: number): 0 | 1 | 2 {
  if (pull >= THREAD_PULL_ARM) return 2;
  if (pull >= THREAD_PULL_HINT) return 1;
  return 0;
}
