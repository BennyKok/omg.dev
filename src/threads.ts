/**
 * THREADS: people-first chat. No agent runs behind a thread.
 *
 * A thread is a `Conversation` with `kind: "thread"` (conversations.ts owns
 * the record and its participants). Its messages are kept here, one JSONL
 * file per thread, because nothing else stores them: there is no session
 * transcript behind a thread.
 *
 * omg only acts when a message mentions `@omg`:
 *   - A quick question gets a one-shot reply from the hosted model
 *     (the same endpoint session titles use). Nothing keeps running.
 *   - A request for real work starts a TASK: an ordinary coding session in the
 *     thread's project, attached to the thread as an `execution` runtime.
 * When a task finishes a turn, the fleet watcher's completion event posts its
 * result back into the thread as a message from omg (`bridgeTaskCompletion`).
 * A task that needs a decision asks through the normal `/api/ask` path, and
 * clients show that question in the thread.
 */

import { appendFileSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, sep } from "node:path";
import { createFileArtifact, createImageArtifact, createVideoArtifact, imageArtifactMessagesSince } from "./artifacts.ts";
import { uploadsDir } from "./uploads.ts";
import { withThreadTaskEnvelope } from "./omg-capabilities.ts";
import { PATHS } from "./config.ts";
import {
  attachRuntimeSession,
  conversationHumanParticipantId,
  createThreadConversation,
  ensureConversationHuman,
  getConversation,
  listConversations,
  patchThreadConversation,
  threadForTaskSession,
  type Conversation,
} from "./conversations.ts";

import {
  mediaKindFor,
  mediaLabel,
  mentionedPeople,
  mentionsOmg,
  plainText,
  THREAD_TYPING_TTL_MS,
  type ThreadMedia,
  type ThreadPerson,
  type ThreadAuthor,
  type ThreadTyping,
  type ThreadMessage,
  type ThreadSummary,
  type ThreadTaskEvent,
  type ThreadTaskRow,
} from "../packages/protocol/src/threads.ts";

export { mentionsOmg };
export type { ThreadAuthor, ThreadMessage, ThreadSummary, ThreadTaskEvent, ThreadTaskRow };

const TITLE_MAX = 60;
/**
 * How much of a thread omg reads, in characters. The whole thread fits in all
 * but the longest ones; past this, the oldest messages drop first.
 */
const CONTEXT_CHARS = 40_000;

function threadsDir(): string {
  return join(PATHS.data, "threads");
}

function messagesPath(threadId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) throw new Error("invalid thread id");
  return join(threadsDir(), `${threadId}.jsonl`);
}

export function readThreadMessages(threadId: string, limit = 200): ThreadMessage[] {
  let raw = "";
  try {
    raw = readFileSync(messagesPath(threadId), "utf8");
  } catch {
    return [];
  }
  const rows: ThreadMessage[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as ThreadMessage);
    } catch {
      // A torn last line from a crash is skipped, not fatal.
    }
  }
  return rows.slice(-limit);
}

export function appendThreadMessage(
  threadId: string,
  message: Omit<ThreadMessage, "id" | "threadId" | "ts"> & { ts?: number },
): ThreadMessage {
  const row: ThreadMessage = {
    id: crypto.randomUUID(),
    threadId,
    ts: message.ts ?? Date.now(),
    author: message.author,
    text: message.text,
    ...(message.task ? { task: message.task } : {}),
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    ...(message.media?.length ? { media: message.media } : {}),
    ...(message.via ? { via: message.via } : {}),
  };
  mkdirSync(threadsDir(), { recursive: true });
  appendFileSync(messagesPath(threadId), `${JSON.stringify(row)}\n`, { mode: 0o600 });
  patchThreadConversation(threadId, { updatedAt: row.ts });
  // A sent message ends its author's typing, before the next poll shows both.
  setTyping(threadId, row.author, false);
  notifyThreadMessage(row);
  return row;
}

/* -------------------------------------------------------------------------- */
/* Files                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Keep an uploaded file with the thread and describe it for a message.
 *
 * It becomes an artifact of the thread, because that is the one route the
 * hosted proxy lets a phone's video player read with a signed grant, and it
 * brings previews, poster frames and dimensions with it. Only a file in the
 * upload folder is taken: a client names what it uploaded, and must not be
 * able to name any other file on the machine.
 */
export async function keepThreadUpload(threadId: string, uploadedPath: string, name?: string | null): Promise<ThreadMedia> {
  let real: string;
  try {
    real = realpathSync(uploadedPath);
  } catch {
    throw new Error("attachment not found");
  }
  const root = realpathSync(uploadsDir());
  if (!real.startsWith(root + sep)) throw new Error("attachment is not an upload");
  const shown = name?.trim() || basename(real);
  const kind = mediaKindFor(shown);
  const input = { sessionId: threadId, path: real };
  const artifact =
    kind === "image" ? await createImageArtifact(input) : kind === "video" ? await createVideoArtifact(input) : createFileArtifact(input);
  return {
    kind,
    path: `/api/artifacts/${encodeURIComponent(artifact.id)}`,
    name: shown,
    width: artifact.width ?? null,
    height: artifact.height ?? null,
  };
}

/**
 * A file an agent session shows in a thread (omg_send_thread_message): any
 * file it can read, kept as that session's artifact, the way omg_display_image
 * keeps one, so the phone plays it through the same signed route.
 */
export async function keepSessionFile(sessionId: string, path: string): Promise<ThreadMedia> {
  const kind = mediaKindFor(path);
  const input = { sessionId, path };
  const artifact =
    kind === "image" ? await createImageArtifact(input) : kind === "video" ? await createVideoArtifact(input) : createFileArtifact(input);
  return {
    kind,
    path: `/api/artifacts/${encodeURIComponent(artifact.id)}`,
    name: basename(path),
    width: artifact.width ?? null,
    height: artifact.height ?? null,
  };
}

/** A thread by its id, an unambiguous prefix of it, or an `omg:thread_<id>` link. Null when none or several match. */
export function resolveThreadRef(ref: string): string | null {
  const id = ref.trim().replace(/^omg:thread_/, "").toLowerCase();
  if (!id) return null;
  const matches = listThreads().filter((row) => row.id.toLowerCase().startsWith(id));
  return matches.length === 1 ? matches[0].id : null;
}

/* -------------------------------------------------------------------------- */
/* Typing                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Who is writing, per thread. In memory only: typing is seconds old or it is
 * nothing, so a restart losing it is correct. A person's entry expires after
 * THREAD_TYPING_TTL_MS unless their client pings again; omg's lasts until
 * its answer is posted, with OMG_TYPING_MAX_MS as a backstop.
 */
const typingByThread = new Map<string, Map<string, ThreadTyping & { until: number }>>();
const OMG_TYPING_MAX_MS = 180_000;

function typingKey(author: ThreadAuthor): string {
  return author.kind === "omg" ? "omg" : `human:${author.participantId}`;
}

export function setTyping(
  threadId: string,
  author: ThreadAuthor,
  typing: boolean,
  replyTo: string | null = null,
  now = Date.now(),
): void {
  const rows = typingByThread.get(threadId) ?? new Map<string, ThreadTyping & { until: number }>();
  if (typing) {
    const ttl = author.kind === "omg" ? OMG_TYPING_MAX_MS : THREAD_TYPING_TTL_MS;
    rows.set(typingKey(author), { author, replyTo, until: now + ttl });
    typingByThread.set(threadId, rows);
  } else {
    rows.delete(typingKey(author));
    if (!rows.size) typingByThread.delete(threadId);
  }
}

/** Who is typing in a thread now, leaving out `exceptParticipant` (the caller). */
export function threadTyping(threadId: string, exceptParticipant?: string | null, now = Date.now()): ThreadTyping[] {
  const rows = typingByThread.get(threadId);
  if (!rows) return [];
  const out: ThreadTyping[] = [];
  for (const [key, row] of rows) {
    if (row.until <= now) {
      rows.delete(key);
      continue;
    }
    if (row.author.kind === "human" && row.author.participantId === exceptParticipant) continue;
    out.push({ author: row.author, replyTo: row.replyTo });
  }
  if (!rows.size) typingByThread.delete(threadId);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Push notifications                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Who each participant is, for push only. A participant id is a digest of the
 * person's address, and push is targeted by address, so the thread keeps the
 * one mapping it needs, next to its messages, on this box.
 */
function peoplePath(threadId: string): string {
  return messagesPath(threadId).replace(/\.jsonl$/, ".people.json");
}

function readPeople(threadId: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(peoplePath(threadId), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function rememberPerson(threadId: string, participantId: string, identity: string): void {
  const people = readPeople(threadId);
  if (people[participantId] === identity) return;
  people[participantId] = identity;
  mkdirSync(threadsDir(), { recursive: true });
  const path = peoplePath(threadId);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(people), { mode: 0o600 });
  renameSync(temp, path);
}

export type ThreadPush = {
  /** The address to target; null means every device on this box (a box with no identities). */
  user: string | null;
  notification: { title: string; body: string; url: string; tag: string };
};

let notifier: ((push: ThreadPush) => void) | null = null;

/** Set once at boot (serve.ts) to deliver thread pushes through notifyAll. */
export function setThreadNotifier(next: ((push: ThreadPush) => void) | null): void {
  notifier = next;
}

/**
 * Slack's rule. A top-level message tells everyone in the thread. A reply
 * tells only the people in that reply thread: whoever wrote the message it
 * answers, and whoever has replied to it. Never the author.
 */
export function threadRecipients(
  message: ThreadMessage,
  messages: readonly ThreadMessage[],
  everyone: readonly string[],
  /** Named with @: always told, wherever the message is. */
  mentioned: readonly string[] = [],
): string[] {
  const author = message.author.kind === "human" ? message.author.participantId : null;
  let pool: string[];
  if (!message.replyTo) {
    pool = [...everyone];
  } else {
    const inReplies = messages.filter((row) => row.id === message.replyTo || row.replyTo === message.replyTo);
    pool = inReplies.flatMap((row) => (row.author.kind === "human" ? [row.author.participantId] : []));
  }
  return [...new Set([...pool, ...mentioned])].filter((id) => id !== author);
}

function notifyThreadMessage(message: ThreadMessage): void {
  if (!notifier) return;
  const conversation = getConversation(message.threadId);
  if (!conversation || conversation.archivedAt) return;
  const messages = readThreadMessages(message.threadId, 500);
  const humans = conversation.participants.filter((row) => row.kind === "human" && !row.leftAt);
  const everyone = humans.map((row) => row.id);
  const mentioned = mentionedPeople(
    message.text,
    humans.flatMap((row) => (row.display.name ? [{ participantId: row.id, name: row.display.name }] : [])),
  );
  const recipients = threadRecipients(message, messages, everyone, mentioned);
  if (!recipients.length) return;
  const people = readPeople(message.threadId);
  const who = message.author.kind === "omg" ? "omg" : message.author.name;
  const body = `${who}: ${plainText(message.text) || mediaLabel(message.media)}`;
  const root = message.replyTo ?? null;
  const notification = {
    title: threadTitle(conversation, messages[0]),
    body: body.length <= 140 ? body : `${body.slice(0, 139)}…`,
    // The web route; iOS maps it to its own (push-native.ts toNativeAppUrl).
    url: `/threads/${message.threadId}${root ? `?replies=${encodeURIComponent(root)}` : ""}`,
    // One notice per reply thread, replaced as it grows, like a session's.
    tag: `thread-${message.threadId}-${root ?? "main"}`,
  };
  const targets = new Set<string | null>();
  for (const id of recipients) {
    const identity = people[id];
    // An address targets that person's devices. The one local person of a box
    // with no identities has no address, so every device is theirs.
    targets.add(identity?.includes("@") ? identity : null);
  }
  for (const user of targets) notifier({ user, notification });
}

function threadTitle(conversation: Conversation, first: ThreadMessage | undefined): string {
  const stored = conversation.title?.trim();
  if (stored) return stored;
  const text = first ? plainText(first.text) || mediaLabel(first.media) : "";
  if (!text) return "New thread";
  return text.length <= TITLE_MAX ? text : `${text.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

export function isThread(conversation: Conversation | null | undefined): conversation is Conversation {
  return conversation?.kind === "thread";
}

export function summarizeThread(conversation: Conversation): ThreadSummary {
  const messages = readThreadMessages(conversation.id);
  const last = messages.at(-1);
  return {
    id: conversation.id,
    title: threadTitle(conversation, messages[0]),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    project: conversation.threadProject ?? null,
    lastMessage: last ? { author: last.author, text: last.text, ts: last.ts, ...(last.media?.length ? { media: last.media } : {}) } : null,
  };
}

export function listThreads(): ThreadSummary[] {
  return listConversations()
    .filter((row) => isThread(row) && !row.archivedAt)
    .map(summarizeThread)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The participants as a client should draw them: each person's CURRENT
 * roster name and photo. A participant is stored with the name they had when
 * they joined and no photo, so this is looked up at read time, from the
 * participant-to-address map, and a renamed or re-photographed person shows
 * up as they are now, in old threads too.
 */
export function participantsForView(
  conversation: Conversation,
  roster: readonly { email: string; name?: string | null; avatar?: string | null }[],
): Conversation["participants"] {
  const people = readPeople(conversation.id);
  return conversation.participants.map((row) => {
    const identity = people[row.id];
    const profile = identity ? roster.find((user) => user.email.toLowerCase() === identity.toLowerCase()) : undefined;
    if (!profile) return row;
    return {
      ...row,
      display: {
        ...row.display,
        name: profile.name?.trim() || row.display.name || null,
        avatar: profile.avatar || row.display.avatar || null,
      },
    };
  });
}

/** A person's participant id in a thread. A box with no identities has one local person. */
/**
 * Everyone `@` can name in a thread: the machine's people (the roster) and
 * the thread's members, each with the participant id they have or would have.
 */
export function threadPeople(
  conversation: Conversation,
  roster: readonly { email: string; name?: string | null; avatar?: string | null }[],
): ThreadPerson[] {
  const members = new Set(conversation.participants.filter((row) => row.kind === "human" && !row.leftAt).map((row) => row.id));
  const out = new Map<string, ThreadPerson>();
  for (const user of roster) {
    const participantId = threadParticipantId(user.email);
    out.set(participantId, {
      participantId,
      name: threadDisplayName(user.email, user.name),
      avatar: user.avatar || null,
      member: members.has(participantId),
    });
  }
  for (const row of participantsForView(conversation, roster)) {
    if (row.kind !== "human" || row.leftAt || out.has(row.id)) continue;
    out.set(row.id, { participantId: row.id, name: row.display.name?.trim() || row.display.fallback, avatar: row.display.avatar ?? null, member: true });
  }
  return [...out.values()];
}

/**
 * Add the people a message names with `@Name` to the thread, before it is
 * stored, so they are members when it notifies. Only people on this machine
 * (the roster) can be added, never the author.
 */
export function addMentionedPeople(
  threadId: string,
  text: string,
  roster: readonly { email: string; name?: string | null }[],
  author: string,
): string[] {
  const people = roster.map((user) => ({ participantId: threadParticipantId(user.email), name: threadDisplayName(user.email, user.name), email: user.email }));
  const named = new Set(mentionedPeople(text, people));
  const added: string[] = [];
  for (const person of people) {
    if (!named.has(person.participantId) || person.email.toLowerCase() === author.toLowerCase()) continue;
    ensureConversationHuman({ conversationId: threadId, identity: person.email, name: person.name });
    rememberPerson(threadId, person.participantId, person.email);
    added.push(person.participantId);
  }
  return added;
}

export function threadParticipantId(identity: string): string {
  return conversationHumanParticipantId(identity) || "human:local";
}

/**
 * What a person is called in a thread. A box with no identities names its one
 * local person "You", never the placeholder identity it keys them by.
 */
export function threadDisplayName(identity: string, name?: string | null): string {
  return name?.trim() || (identity.includes("@") ? identity.split("@")[0] : "") || "You";
}

/** The person writing, as a thread participant. Joins them on first write. */
export function threadAuthor(threadId: string, identity: string, name?: string | null): ThreadAuthor {
  const participantId = threadParticipantId(identity);
  const display = threadDisplayName(identity, name);
  ensureConversationHuman({ conversationId: threadId, identity, name: display });
  rememberPerson(threadId, participantId, identity);
  return { kind: "human", participantId, name: display };
}

export function startThread(input: { identity: string; name?: string | null; title?: string | null }): Conversation {
  const thread = createThreadConversation({ ...input, name: threadDisplayName(input.identity, input.name) });
  rememberPerson(thread.id, threadParticipantId(input.identity), input.identity);
  return thread;
}

/* -------------------------------------------------------------------------- */
/* @omg                                                                        */
/* -------------------------------------------------------------------------- */

export type OmgDecision =
  | { action: "reply"; text: string }
  | { action: "task"; title: string; prompt: string }
  /** Pass the message to the task already running in these replies. */
  | { action: "tell_task"; text: string; ack?: string }
  /** Nothing for omg to say: people talking to people. */
  | { action: "none" };

export const OMG_THREAD_SYSTEM_PROMPT = [
  "You are omg, a teammate in a group chat thread. Someone mentioned you with @omg.",
  "You are given the whole thread. Read all of it: what people mean by \"this\" or \"it\" is almost always said earlier in the thread.",
  "Decide what they need.",
  "When they ask you to do, make, work on, build, design, write, research or fix something, start a TASK. A task is an agent with a computer: it can write code, design (names, logos, images, pages), write documents, research the web, and run commands. Answer with",
  '{"action":"task","title":"<at most 8 words>","prompt":"<complete, self-contained instructions for the agent: what to make, and every relevant detail from the thread>"}',
  "When they ask a question you can answer from what you know, or want an opinion or a quick idea, answer it yourself with",
  '{"action":"reply","text":"<your chat reply>"}',
  "Write a reply the way a teammate writes in a chat: one or two short sentences, plain words, no headings or bold labels, no restating the question, no closing offer. Say what you think, once.",
  "Do not ask a clarifying question when the thread already says what is meant; act on the most reasonable reading, and say what you assumed in the task title. Ask only when the request truly has no subject.",
  "Reply with the JSON object only.",
].join("\n");

/** Added when a task already runs in these replies: a follow-up goes to it, not to a new task. */
export const OMG_TASK_FOLLOWUP_RULE = [
  "A task already runs in these replies. When the message gives it more instructions, a correction, or an answer to its question, pass it on instead of starting a new task, with",
  '{"action":"tell_task","text":"<the message for the task, complete and self-contained>","ack":"<a few words back to the person, e.g. \"On it, shorter from here.\">"}',
].join("\n");

/** Added when someone asked a coding agent by name: omg briefs it, and does not answer instead. */
export function omgAgentRule(handle: string): string {
  return [
    `They asked ${handle}, a coding agent, by name. The work is ${handle}'s: start a task for it with the task JSON, a complete brief from the thread.`,
    "Do not answer the question yourself.",
  ].join("\n");
}

/**
 * Added when nobody mentioned omg: a person replied in a reply thread omg is
 * part of, and omg decides whether it has anything to add.
 */
export const OMG_UNMENTIONED_RULE = [
  "Nobody mentioned you this time. A person replied in a reply thread you are part of, and you read every reply there.",
  "Stay quiet with",
  '{"action":"none"}',
  "only when the reply is clearly not for you: people talking to each other about something else, or a bare thanks or ok.",
  "Answer when the reply asks you something, asks for work, or expects you to act. A short question like \"where?\" or \"any update?\" is for you: answer it from the thread.",
].join("\n");

/**
 * Added with the rule above when a task runs in these replies. There, the
 * replies are the work's conversation: a person steering it rarely names
 * omg, and on 2026-09-28 "Like super" and "Where" were met with silence
 * until someone wrote @omg.
 */
export const OMG_UNMENTIONED_TASK_RULE = [
  "These replies are where a task is being worked on, so a reply here is almost always about that work.",
  "A preference, a direction, a correction, a fragment of an idea (\"like super\", \"shorter\", \"not that one\") is for the task: pass it on with tell_task. Several short replies in a row are one thought: pass them on together, in one complete message.",
  "A half-finished sentence that the next reply will complete can wait: stay quiet on it only if it says nothing yet.",
  "When unsure, pass it on: a task that hears one extra remark loses nothing, and a person who is ignored has to say it again.",
].join("\n");

/**
 * Does this message wake omg? A mention always does. A reply without one
 * does when omg is already part of that reply thread: it answered there, or
 * the message that opened it asked omg.
 */
export function omgWake(message: ThreadMessage, messages: readonly ThreadMessage[]): "mention" | "reply" | null {
  if (message.author.kind === "omg") return null;
  if (mentionsOmg(message.text)) return "mention";
  const rootId = message.replyTo;
  if (!rootId) return null;
  const root = messages.find((row) => row.id === rootId);
  const omgThere = messages.some((row) => row.replyTo === rootId && row.author.kind === "omg");
  return omgThere || (root ? mentionsOmg(root.text) : false) ? "reply" : null;
}

/** The newest task started in a reply thread, the one a follow-up belongs to. */
export function taskInReplies(messages: readonly ThreadMessage[], rootId: string): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i];
    if (row.replyTo === rootId && row.task?.event === "started") return row.task.sessionId;
  }
  return null;
}

/**
 * Parse the model's JSON. Anything unreadable becomes a task when omg was
 * asked by name, and silence when it was not: an unasked omg must never
 * start work on a guess.
 */
export function parseOmgDecision(raw: string | null | undefined, request: string, unmentioned = false): OmgDecision {
  const text = (raw ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try {
      const value = JSON.parse(json) as { action?: unknown; text?: unknown; title?: unknown; prompt?: unknown; ack?: unknown };
      if (value.action === "none") return { action: "none" };
      if (value.action === "tell_task" && typeof value.text === "string" && value.text.trim()) {
        const ack = typeof value.ack === "string" ? value.ack.trim().slice(0, 140) : "";
        return { action: "tell_task", text: value.text.trim(), ...(ack ? { ack } : {}) };
      }
      if (value.action === "reply" && typeof value.text === "string" && value.text.trim()) {
        return { action: "reply", text: value.text.trim() };
      }
      if (value.action === "task" && typeof value.prompt === "string" && value.prompt.trim()) {
        const title = typeof value.title === "string" && value.title.trim() ? value.title.trim() : request;
        return { action: "task", title: title.slice(0, 80), prompt: value.prompt.trim() };
      }
    } catch {
      // fall through
    }
  }
  if (unmentioned) return { action: "none" };
  return { action: "task", title: request.slice(0, 80), prompt: request };
}

/**
 * The whole thread as omg reads it, oldest first: every top-level message,
 * each followed by its replies (indented), so a reply is read in the place it
 * was said. Past CONTEXT_CHARS the oldest lines drop, never the newest.
 */
export function transcriptForModel(messages: readonly ThreadMessage[]): string {
  const said = (row: ThreadMessage) =>
    [row.text, ...(row.media ?? []).map((m) => `[${m.kind}${m.name ? `: ${m.name}` : ""}]`)].filter(Boolean).join(" ");
  const who = (row: ThreadMessage) => `${row.author.kind === "omg" ? "omg" : row.author.name}`;
  const lines: string[] = [];
  for (const top of messages.filter((row) => !row.replyTo)) {
    lines.push(`${who(top)}: ${said(top)}`);
    for (const reply of messages.filter((row) => row.replyTo === top.id)) {
      lines.push(`    ↳ ${who(reply)} (reply): ${said(reply)}`);
    }
  }
  // Replies whose top-level message is gone still count.
  for (const orphan of messages.filter((row) => row.replyTo && !messages.some((top) => top.id === row.replyTo))) {
    lines.push(`    ↳ ${who(orphan)} (reply): ${said(orphan)}`);
  }
  let total = 0;
  const kept: string[] = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    total += lines[i].length + 1;
    if (total > CONTEXT_CHARS) break;
    kept.unshift(lines[i]);
  }
  if (kept.length < lines.length) kept.unshift("(earlier messages left out)");
  return kept.join("\n");
}

/** The prompt a task session starts with: the request plus the thread it came from. */
export function taskPromptFromThread(prompt: string, messages: readonly ThreadMessage[]): string {
  return [
    prompt,
    "",
    "This task was started from a team chat thread. The whole thread, oldest first:",
    transcriptForModel(messages),
    "",
    "Reply into the thread as the rules above say: short, plain, and your last message stands alone.",
  ].join("\n");
}

export type ThreadDeps = {
  /** One-shot model call. Returns the raw text, or null when no model is reachable. */
  complete: (system: string, user: string) => Promise<string | null>;
  /** Start a coding session. Returns its id. */
  /** `agent` is a coding agent's key when someone asked it by name; otherwise Settings' default runs. */
  startTask: (input: { prompt: string; title: string; cwd: string | null; user: string; agent?: string | null }) => Promise<string>;
  /** Send a follow-up to a running task, as its next turn. */
  tellTask: (input: { sessionId: string; text: string; user: string }) => Promise<void>;
};

/**
 * Answer a message that wakes omg (see omgWake): an @omg mention, or a reply
 * in a reply thread omg is part of. Called after the person's message is
 * stored, so a slow model never delays their own message. Returns what omg
 * posted, or null when it chose to stay quiet.
 */
export async function answerMention(
  threadId: string,
  request: string,
  identity: string,
  deps: ThreadDeps,
  /** The top-level message whose replies omg answers in. */
  rootId: string,
  /** Nobody named omg; it may stay quiet. */
  unmentioned = false,
  /** A coding agent asked by name (`@codex`): the work is a task, and it runs with that agent. */
  agent: { key: string; handle: string } | null = null,
): Promise<ThreadMessage | null> {
  // What omg reads: the whole thread, every reply thread included.
  const context = readThreadMessages(threadId, 5_000);
  const named = agent ? new RegExp(`@(omg|${agent.handle})\\b`, "gi") : /@omg\b/gi;
  const cleaned = request.replace(named, "").trim() || request;
  // Asked by name, omg shows as typing in the replies until it posts. Unasked,
  // it may say nothing, and dots that end in silence would read as a lost reply.
  if (!unmentioned) setTyping(threadId, { kind: "omg" }, true, rootId);
  try {
    return await decideAndAnswer(threadId, cleaned, identity, deps, rootId, context, unmentioned, agent);
  } finally {
    if (!unmentioned) setTyping(threadId, { kind: "omg" }, false);
  }
}

async function decideAndAnswer(
  threadId: string,
  cleaned: string,
  identity: string,
  deps: ThreadDeps,
  rootId: string,
  context: ThreadMessage[],
  unmentioned: boolean,
  agent: { key: string; handle: string } | null,
): Promise<ThreadMessage | null> {
  const runningTask = taskInReplies(context, rootId);
  const system = [
    OMG_THREAD_SYSTEM_PROMPT,
    ...(runningTask ? [OMG_TASK_FOLLOWUP_RULE] : []),
    ...(unmentioned ? [OMG_UNMENTIONED_RULE] : []),
    ...(unmentioned && runningTask ? [OMG_UNMENTIONED_TASK_RULE] : []),
    ...(agent ? [omgAgentRule(agent.handle)] : []),
  ].join("\n\n");
  const raw = await deps
    .complete(
      system,
      `The whole thread, oldest first:\n${transcriptForModel(context)}\n\n${unmentioned ? "The new reply" : "The message that mentioned you"}: ${cleaned}`,
    )
    .catch(() => null);
  const parsed = parseOmgDecision(raw, cleaned, unmentioned && !agent);
  // Asked by name, an agent always gets the work: omg only writes its brief.
  const decision: OmgDecision =
    agent && (parsed.action === "reply" || parsed.action === "none")
      ? { action: "task", title: cleaned.slice(0, 80), prompt: cleaned }
      : parsed;
  if (unmentioned) {
    // A silence is a decision, not an error: say which, so a missed reply can be traced.
    console.log(`[threads] omg read an unmentioned reply in ${threadId}: ${raw === null ? "model unreachable, stayed quiet" : decision.action}`);
  }
  if (decision.action === "none") return null;
  if (decision.action === "reply") {
    return appendThreadMessage(threadId, { author: { kind: "omg" }, text: decision.text, replyTo: rootId });
  }
  if (decision.action === "tell_task") {
    if (!runningTask) return null;
    try {
      await deps.tellTask({ sessionId: runningTask, text: decision.text, user: identity });
      // A few words back, in omg's own voice, so the person knows they were heard.
      return appendThreadMessage(threadId, { author: { kind: "omg" }, text: decision.ack || "Passed that to the task.", replyTo: rootId });
    } catch (error) {
      return appendThreadMessage(threadId, {
        author: { kind: "omg" },
        text: `I could not reach the task: ${error instanceof Error ? error.message : String(error)}`,
        replyTo: rootId,
      });
    }
  }
  const conversation = getConversation(threadId);
  const project = conversation?.threadProject ?? null;
  try {
    const sessionId = await deps.startTask({
      prompt: withThreadTaskEnvelope(taskPromptFromThread(decision.prompt, context), {
        threadTitle: conversation ? summarizeThread(conversation).title : null,
      }),
      title: decision.title,
      cwd: project?.cwd ?? null,
      user: identity,
      agent: agent?.key ?? null,
    });
    attachRuntimeSession({ conversationId: threadId, sessionId, kind: "execution" });
    return appendThreadMessage(threadId, {
      author: { kind: "omg" },
      text: `Started a ${agent ? `${agent.handle} ` : ""}task${project ? ` in ${project.name}` : ""}.`,
      task: { sessionId, event: "started", title: decision.title, project: project?.name ?? null },
      replyTo: rootId,
    });
  } catch (error) {
    return appendThreadMessage(threadId, {
      author: { kind: "omg" },
      text: `I could not start the task: ${error instanceof Error ? error.message : String(error)}`,
      replyTo: rootId,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Task results                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What a task said in the turn that just finished: its last written answer
 * after the last message it was sent. Thinking and tool calls are not an
 * answer, and neither is anything from an earlier turn. Null when the
 * transcript has not caught up with the turn yet.
 */
export function turnAnswer(messages: readonly { role: string; kind?: string | null; text?: string | null }[]): string | null {
  let lastUser = -1;
  messages.forEach((row, index) => {
    if (row.role === "user") lastUser = index;
  });
  for (let i = messages.length - 1; i > lastUser; i -= 1) {
    const row = messages[i];
    if (row.role === "assistant" && (row.kind ?? "text") === "text" && row.text?.trim()) return row.text;
  }
  return null;
}

/** How much of a task's answer a thread keeps. Clients render it as markdown, so it is kept whole up to here. */
const RESULT_CHARS = 8_000;

function resultText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > RESULT_CHARS ? `${trimmed.slice(0, RESULT_CHARS).trimEnd()}…` : trimmed;
}

/** The pictures and videos a task showed since `after`, as a message's media. */
function taskMediaSince(sessionId: string, after: number): ThreadMedia[] {
  return imageArtifactMessagesSince(sessionId, after)
    .filter((row) => row.kind === "image" || row.kind === "video" || row.kind === "file")
    .map((row) => ({
      kind: row.kind as ThreadMedia["kind"],
      path: row.url,
      name: row.title || row.name || null,
      width: row.width ?? null,
      height: row.height ?? null,
      caption: row.caption ?? null,
    }));
}

/**
 * A task in a thread finished a turn: post what it said. One message per
 * settled turn, so a task that is asked a follow-up reports again.
 */
export function bridgeTaskCompletion(
  sessionId: string,
  session: {
    title?: string | null;
    project?: string | null;
    status?: string | null;
    statusDetail?: string | null;
    agent?: string | null;
    last?: { role?: string; kind?: string; text?: string } | null;
  } | null,
): ThreadMessage | null {
  const thread = threadForTaskSession(sessionId);
  if (!thread || thread.archivedAt) return null;
  const blocked = session?.status === "blocked";
  const last = session?.last;
  const said = last?.role === "assistant" && last.text ? resultText(last.text) : "";
  // A task's updates go to the replies it was started in.
  const rows = readThreadMessages(thread.id, 5_000);
  const started = rows.find((row) => row.task?.sessionId === sessionId);
  // What it showed this turn: everything since its last message in the thread.
  const previous = rows.findLast((row) => row.task?.sessionId === sessionId);
  const media = taskMediaSince(sessionId, previous?.ts ?? 0);
  const text = blocked
    ? session?.statusDetail?.trim() || "The task is blocked and needs you."
    : said || "The task finished its turn.";
  return appendThreadMessage(thread.id, {
    author: { kind: "omg" },
    text,
    task: {
      sessionId,
      event: blocked ? "blocked" : "finished",
      title: session?.title ?? null,
      project: session?.project || null,
      ...(session?.agent ? { agent: session.agent } : {}),
    },
    replyTo: started?.replyTo ?? null,
    media,
  });
}

/** The live state of each task a thread started. */
export function threadTasks(
  conversation: Conversation,
  live: ReadonlyArray<{ sessionId?: string | null; title?: string | null; project?: string | null; busy?: boolean | null; status?: string | null; agent?: string | null }>,
): ThreadTaskRow[] {
  return conversation.runtimeSessions
    .filter((entry) => entry.kind === "execution")
    .map((entry) => {
      const row = live.find((session) => session.sessionId === entry.sessionId);
      return {
        sessionId: entry.sessionId,
        title: row?.title ?? null,
        project: row?.project || null,
        busy: !!row?.busy,
        status: row?.status ?? null,
        ended: !row,
        agent: row?.agent ?? null,
      };
    });
}

export function threadUpdate(
  id: string,
  patch: { title?: string | null; project?: { cwd: string; name: string } | null; archived?: boolean },
): Conversation | null {
  return patchThreadConversation(id, {
    ...(patch.title !== undefined ? { title: patch.title?.trim() || null } : {}),
    ...(patch.project !== undefined ? { threadProject: patch.project } : {}),
    ...(patch.archived !== undefined ? { archivedAt: patch.archived ? Date.now() : null } : {}),
  });
}
