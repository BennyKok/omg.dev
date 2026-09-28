/**
 * Threads on the wire, and the rules every client draws them with.
 *
 * One owner for the server (src/threads.ts), iOS and the web app. A thread is
 * people-first chat with no agent behind it; omg joins only on `@omg`, and a
 * task it starts is drawn as a card whose state is decided by
 * `taskCardState` below. Keeping that rule here is what stops the phone and
 * the web from disagreeing about whether a task "needs you".
 */

export type ThreadAuthor =
  | { kind: "human"; participantId: string; name: string }
  | { kind: "omg" };

export type ThreadTaskEvent = "started" | "finished" | "blocked" | "failed";

export type ThreadMessage = {
  id: string;
  threadId: string;
  ts: number;
  author: ThreadAuthor;
  text: string;
  /** Present on omg's task messages: which task, and what happened to it. */
  task?: { sessionId: string; event: ThreadTaskEvent; title?: string | null; project?: string | null };
  /** Client only: sent, not yet stored. */
  pending?: boolean;
};

export type ThreadProject = { cwd: string; name: string };

export type ThreadSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  project: ThreadProject | null;
  lastMessage: Pick<ThreadMessage, "author" | "text" | "ts"> | null;
};

export type ThreadTaskRow = {
  sessionId: string;
  title: string | null;
  project: string | null;
  busy: boolean;
  status: string | null;
  /** Not in the live session list any more. */
  ended: boolean;
};

export type ThreadParticipant = {
  id: string;
  kind: string;
  role?: string;
  display: { name?: string | null; fallback: string };
};

export type ThreadDetail = {
  /** The caller's participant id, so a client can put their own bubbles on the right. */
  me: string;
  thread: ThreadSummary;
  participants: ThreadParticipant[];
  messages: ThreadMessage[];
  tasks: ThreadTaskRow[];
};

export type TaskCardState = "working" | "needs-you" | "done" | "failed" | "ended";

export const TASK_STATE_LABEL: Record<TaskCardState, string> = {
  working: "Working",
  "needs-you": "Needs you",
  done: "Done",
  failed: "Failed",
  ended: "Ended",
};

/** Only an explicit mention wakes omg. An address like x@omg.dev does not. */
export const OMG_MENTION = /(^|[^\w@])@omg\b/i;

export function mentionsOmg(text: string): boolean {
  return OMG_MENTION.test(text);
}

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

/** One line for a thread row: who spoke last, and what they said. */
export function threadPreview(thread: Pick<ThreadSummary, "lastMessage">): string {
  const last = thread.lastMessage;
  if (!last) return "No messages yet";
  const who = last.author.kind === "omg" ? "omg" : last.author.name;
  return `${who}: ${last.text.replace(/\s+/g, " ").trim()}`;
}

/** The task a message is about, as the card needs it. Pure, for both clients. */
export function taskCardFor(
  message: ThreadMessage,
  detail: Pick<ThreadDetail, "tasks">,
  messages: readonly ThreadMessage[],
  openAskSessionIds: readonly (string | null | undefined)[],
): { sessionId: string; title: string; project: string | null; state: TaskCardState } | null {
  const task = message.task;
  if (!task) return null;
  const row = detail.tasks.find((t) => sameSession(t.sessionId, task.sessionId));
  return {
    sessionId: task.sessionId,
    title: row?.title || task.title || "Task",
    project: row?.project || task.project || null,
    state: taskCardState({
      event: latestTaskEvent(messages, task.sessionId),
      row,
      openAsk: openAskSessionIds.some((id) => sameSession(task.sessionId, id)),
    }),
  };
}
