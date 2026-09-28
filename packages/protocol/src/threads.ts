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
  /**
   * The top-level message this is a reply to, as in Slack. omg always answers
   * in the replies of the message that mentioned it, and a task's updates go
   * to the same replies. Absent: a top-level message.
   */
  replyTo?: string | null;
  /** Pictures, videos and files, drawn under the text as the session chat draws them. */
  media?: ThreadMedia[];
  /** Client only: sent, not yet stored. */
  pending?: boolean;
};

/**
 * One picture, video or file in a message. `path` is served by the machine
 * (a thread file, or a task's artifact) and needs the same grant as any
 * other box-served media.
 */
export type ThreadMedia = {
  kind: "image" | "video" | "file";
  path: string;
  name?: string | null;
  width?: number | null;
  height?: number | null;
  caption?: string | null;
};

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|avif|bmp)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm)$/i;

/** What a file is, from its name or type, for how a message draws it. */
export function mediaKindFor(name: string, mimeType?: string | null): ThreadMedia["kind"] {
  const type = (mimeType ?? "").toLowerCase();
  if (type.startsWith("image/") || IMAGE_EXT.test(name)) return "image";
  if (type.startsWith("video/") || VIDEO_EXT.test(name)) return "video";
  return "file";
}

/** Markdown down to the words, for one-line previews and notifications. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|\s)[*_]([^*_\s][^*_]*)[*_](?=\s|$|[.,!?;:])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Photo", "2 photos", "Video", "File": a message's media in a word, for a message with no text. */
export function mediaLabel(media: readonly ThreadMedia[] | undefined): string {
  if (!media?.length) return "";
  const kind = media.every((row) => row.kind === media[0].kind) ? media[0].kind : "file";
  const word = kind === "image" ? "photo" : kind === "video" ? "video" : "file";
  const label = media.length === 1 ? word : `${media.length} ${word}s`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export type ThreadProject = { cwd: string; name: string };

export type ThreadSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  project: ThreadProject | null;
  lastMessage: Pick<ThreadMessage, "author" | "text" | "ts" | "media"> | null;
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
  /** `avatar` is absolute (Gravatar) or box-relative (`/api/avatars/<file>`). */
  display: { name?: string | null; fallback: string; avatar?: string | null };
};

export type ThreadDetail = {
  /** The caller's participant id, so a client can put their own bubbles on the right. */
  me: string;
  thread: ThreadSummary;
  participants: ThreadParticipant[];
  messages: ThreadMessage[];
  tasks: ThreadTaskRow[];
  /** Who is writing right now, the caller left out. Absent on a machine from before typing. */
  typing?: ThreadTyping[];
};

/** Someone writing in a thread: a person at their keyboard, or omg preparing an answer. */
export type ThreadTyping = {
  author: ThreadAuthor;
  /** The top-level message whose replies they are writing in; null for the main list. */
  replyTo: string | null;
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
  return `${who}: ${plainText(last.text) || mediaLabel(last.media)}`;
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

/** Slack's rule: a message joins the one above when the same author wrote it within this long. */
export const THREAD_GROUP_MS = 5 * 60_000;

/**
 * Whether a message starts a new group: its own avatar, name and time. The
 * rest of a group is just text under the first message.
 */
export function startsMessageGroup(previous: ThreadMessage | undefined, message: ThreadMessage): boolean {
  if (!previous) return true;
  if (message.ts - previous.ts > THREAD_GROUP_MS) return true;
  if (previous.author.kind !== message.author.kind) return true;
  if (message.author.kind === "human" && previous.author.kind === "human") {
    return previous.author.participantId !== message.author.participantId;
  }
  return false;
}

/** A stable avatar colour for a person, from their participant id. */
export function authorHue(author: ThreadAuthor): number {
  if (author.kind === "omg") return 11;
  let hash = 0;
  for (const char of author.participantId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

export function authorName(author: ThreadAuthor): string {
  return author.kind === "omg" ? "omg" : author.name;
}

/** Top-level messages: what the main list shows. */
export function topLevelMessages(messages: readonly ThreadMessage[]): ThreadMessage[] {
  return messages.filter((message) => !message.replyTo);
}

/** The replies to one top-level message, oldest first. */
export function repliesTo(messages: readonly ThreadMessage[], rootId: string): ThreadMessage[] {
  return messages.filter((message) => message.replyTo === rootId);
}

export type ReplySummary = {
  count: number;
  lastTs: number;
  /** Who replied, first reply first, each once. */
  authors: ThreadAuthor[];
  /** The task started in these replies, if any, for a state chip on the root. */
  taskSessionId: string | null;
};

/** The "N replies" line under a top-level message, or null when it has none. */
export function replySummary(messages: readonly ThreadMessage[], rootId: string): ReplySummary | null {
  const replies = repliesTo(messages, rootId);
  if (!replies.length) return null;
  const authors: ThreadAuthor[] = [];
  for (const reply of replies) {
    const same = authors.some((a) =>
      a.kind === reply.author.kind &&
      (a.kind === "omg" || (reply.author.kind === "human" && a.participantId === reply.author.participantId)));
    if (!same) authors.push(reply.author);
  }
  const task = [...replies].reverse().find((reply) => reply.task)?.task ?? null;
  return { count: replies.length, lastTs: replies[replies.length - 1].ts, authors, taskSessionId: task?.sessionId ?? null };
}

/**
 * Pull Home's list down past the refresh to start a thread. Distances in
 * points (iOS) or CSS pixels (web). A normal refresh fires well before the
 * first; the second arms the thread, and releasing then opens it.
 */
export const THREAD_PULL_HINT = 90;
export const THREAD_PULL_ARM = 150;

/** 0: nothing. 1: show "keep pulling". 2: armed, release starts a thread. */
export function threadPullStage(pull: number): 0 | 1 | 2 {
  if (pull >= THREAD_PULL_ARM) return 2;
  if (pull >= THREAD_PULL_HINT) return 1;
  return 0;
}

/** Who `@` offers in a thread. omg is the one member that is not a person. */
export const THREAD_MENTIONS: readonly { name: string; hint: string }[] = [
  { name: "omg", hint: "Answer, or start a task" },
];

/**
 * An `@word` being typed at the end of the text (the caret is taken to be at
 * the end, as the phone's other pickers do): where it starts and what is
 * typed so far. Null when the text does not end in a mention.
 */
export function threadMentionAt(text: string): { start: number; query: string } | null {
  const m = text.match(/(^|\s)@([A-Za-z0-9._-]{0,40})$/);
  if (!m) return null;
  return { start: text.length - m[2].length - 1, query: m[2] };
}

/** The mentions whose name starts with what is typed. */
export function matchThreadMentions(query: string, mentions = THREAD_MENTIONS) {
  const q = query.toLowerCase();
  return mentions.filter((mention) => mention.name.toLowerCase().startsWith(q));
}

/** Replace the `@word` being typed with `@name `. */
export function applyThreadMention(text: string, at: { start: number }, name: string): string {
  return `${text.slice(0, at.start)}@${name} `;
}

/**
 * How to draw a message's author: the participant's current name and photo
 * when the thread knows them (the server fills both from the roster), else
 * the name the message was written under. omg has no photo; it wears its mark.
 */
export function authorView(
  author: ThreadAuthor,
  participants: readonly ThreadParticipant[] | undefined,
): { name: string; avatar: string | null } {
  if (author.kind === "omg") return { name: "omg", avatar: null };
  const row = participants?.find((participant) => participant.id === author.participantId);
  return {
    name: row?.display.name?.trim() || author.name,
    avatar: row?.display.avatar?.trim() || null,
  };
}

/* -------------------------------------------------------------------------- */
/* Typing                                                                      */
/* -------------------------------------------------------------------------- */

/** A person's typing ping lasts this long, so a closed tab stops showing as typing. */
export const THREAD_TYPING_TTL_MS = 6_000;
/** While the field has text, a client repeats its ping this often. */
export const THREAD_TYPING_PING_MS = 3_000;

/**
 * Who shows as typing in one view. The replies of `rootId`, or the main list
 * when it is null. omg always answers in replies, so the main list also shows
 * omg when it is answering anywhere: otherwise an @omg asked from the main
 * list would look ignored.
 */
export function typingIn(typing: readonly ThreadTyping[] | undefined, rootId: string | null): ThreadTyping[] {
  return (typing ?? []).filter((row) => row.replyTo === rootId || (rootId === null && row.author.kind === "omg"));
}

/** "Alex is typing", "omg is typing", "Alex and Sam are typing", "Several people are typing". */
export function typingLabel(typing: readonly ThreadTyping[], participants?: readonly ThreadParticipant[]): string | null {
  const names = [...new Set(typing.map((row) => authorView(row.author, participants).name))];
  if (!names.length) return null;
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return "Several people are typing";
}

/**
 * The client half of typing: feed it the field's text on every change. It
 * sends `true` when text appears and again every THREAD_TYPING_PING_MS while
 * it stays, and `false` once when the field empties. One owner for the
 * throttle, shared by iOS and the web.
 */
export function typingPinger(send: (typing: boolean) => void, now: () => number = Date.now): (text: string) => void {
  let last = 0;
  let on = false;
  return (text: string) => {
    if (text.trim()) {
      const at = now();
      if (on && at - last < THREAD_TYPING_PING_MS) return;
      on = true;
      last = at;
      send(true);
    } else if (on) {
      on = false;
      last = 0;
      send(false);
    }
  };
}
