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

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  mentionsOmg,
  type ThreadAuthor,
  type ThreadMessage,
  type ThreadSummary,
  type ThreadTaskEvent,
  type ThreadTaskRow,
} from "../packages/protocol/src/threads.ts";

export { mentionsOmg };
export type { ThreadAuthor, ThreadMessage, ThreadSummary, ThreadTaskEvent, ThreadTaskRow };

const TITLE_MAX = 60;
const CONTEXT_MESSAGES = 20;

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
  };
  mkdirSync(threadsDir(), { recursive: true });
  appendFileSync(messagesPath(threadId), `${JSON.stringify(row)}\n`, { mode: 0o600 });
  patchThreadConversation(threadId, { updatedAt: row.ts });
  return row;
}

function threadTitle(conversation: Conversation, first: ThreadMessage | undefined): string {
  const stored = conversation.title?.trim();
  if (stored) return stored;
  const text = first?.text.replace(/\s+/g, " ").trim() ?? "";
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
    lastMessage: last ? { author: last.author, text: last.text, ts: last.ts } : null,
  };
}

export function listThreads(): ThreadSummary[] {
  return listConversations()
    .filter((row) => isThread(row) && !row.archivedAt)
    .map(summarizeThread)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A person's participant id in a thread. A box with no identities has one local person. */
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
  return { kind: "human", participantId, name: display };
}

export function startThread(input: { identity: string; name?: string | null; title?: string | null }): Conversation {
  return createThreadConversation({ ...input, name: threadDisplayName(input.identity, input.name) });
}

/* -------------------------------------------------------------------------- */
/* @omg                                                                        */
/* -------------------------------------------------------------------------- */

export type OmgDecision =
  | { action: "reply"; text: string }
  | { action: "task"; title: string; prompt: string };

export const OMG_THREAD_SYSTEM_PROMPT = [
  "You are omg, a teammate in a group chat thread. Someone mentioned you with @omg.",
  "Decide what they need.",
  "If they ask for real work that needs a computer (changing code, building, deploying, running commands, reading or writing a project's files), answer with",
  '{"action":"task","title":"<at most 8 words>","prompt":"<complete, self-contained instructions for a coding agent, including the relevant context from the thread>"}',
  "Otherwise answer the question yourself, with",
  '{"action":"reply","text":"<a short, plain answer, at most 4 sentences>"}',
  "Reply with the JSON object only.",
].join("\n");

/** Parse the model's JSON. Anything unreadable becomes a task, which is the safe default. */
export function parseOmgDecision(raw: string | null | undefined, request: string): OmgDecision {
  const text = (raw ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try {
      const value = JSON.parse(json) as { action?: unknown; text?: unknown; title?: unknown; prompt?: unknown };
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
  return { action: "task", title: request.slice(0, 80), prompt: request };
}

function transcriptForModel(messages: readonly ThreadMessage[]): string {
  return messages
    .slice(-CONTEXT_MESSAGES)
    .map((row) => `${row.author.kind === "omg" ? "omg" : row.author.name}: ${row.text}`)
    .join("\n");
}

/** The prompt a task session starts with: the request plus the thread it came from. */
export function taskPromptFromThread(prompt: string, messages: readonly ThreadMessage[]): string {
  return [
    prompt,
    "",
    "This task was started from a team chat thread. Recent messages, oldest first:",
    transcriptForModel(messages),
    "",
    "When you are done, end with a short summary: what changed and anything the team must do. It is posted back to the thread.",
    "If you need a decision from the person, ask with `omg_input`.",
  ].join("\n");
}

export type ThreadDeps = {
  /** One-shot model call. Returns the raw text, or null when no model is reachable. */
  complete: (system: string, user: string) => Promise<string | null>;
  /** Start a coding session. Returns its id. */
  startTask: (input: { prompt: string; title: string; cwd: string | null; user: string }) => Promise<string>;
};

/**
 * Answer an @omg mention. Called after the person's message is stored, so a
 * slow model never delays their own message.
 */
export async function answerMention(
  threadId: string,
  request: string,
  identity: string,
  deps: ThreadDeps,
  /** The top-level message whose replies omg answers in. */
  rootId: string,
): Promise<ThreadMessage> {
  const all = readThreadMessages(threadId);
  // What omg reads: the recent main conversation, then this reply thread.
  const context = [
    ...all.filter((row) => !row.replyTo).slice(-CONTEXT_MESSAGES),
    ...all.filter((row) => row.replyTo === rootId).slice(-CONTEXT_MESSAGES),
  ];
  const cleaned = request.replace(/@omg\b/gi, "").trim() || request;
  const raw = await deps
    .complete(OMG_THREAD_SYSTEM_PROMPT, `Thread so far:\n${transcriptForModel(context)}\n\nRequest: ${cleaned}`)
    .catch(() => null);
  const decision = parseOmgDecision(raw, cleaned);
  if (decision.action === "reply") {
    return appendThreadMessage(threadId, { author: { kind: "omg" }, text: decision.text, replyTo: rootId });
  }
  const conversation = getConversation(threadId);
  const project = conversation?.threadProject ?? null;
  try {
    const sessionId = await deps.startTask({
      prompt: taskPromptFromThread(decision.prompt, context),
      title: decision.title,
      cwd: project?.cwd ?? null,
      user: identity,
    });
    attachRuntimeSession({ conversationId: threadId, sessionId, kind: "execution" });
    return appendThreadMessage(threadId, {
      author: { kind: "omg" },
      text: project ? `Started a task in ${project.name}.` : "Started a task.",
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

function firstLines(text: string, max = 3): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, max)
    .join("\n")
    .slice(0, 600);
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
    last?: { role?: string; kind?: string; text?: string } | null;
  } | null,
): ThreadMessage | null {
  const thread = threadForTaskSession(sessionId);
  if (!thread || thread.archivedAt) return null;
  const blocked = session?.status === "blocked";
  const last = session?.last;
  const said = last?.role === "assistant" && last.text ? firstLines(last.text) : "";
  // A task's updates go to the replies it was started in.
  const started = readThreadMessages(thread.id).find((row) => row.task?.sessionId === sessionId);
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
    },
    replyTo: started?.replyTo ?? null,
  });
}

/** The live state of each task a thread started. */
export function threadTasks(
  conversation: Conversation,
  live: ReadonlyArray<{ sessionId?: string | null; title?: string | null; project?: string | null; busy?: boolean | null; status?: string | null }>,
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
