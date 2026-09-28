import type { OmgClient } from "@omg-dev/client";

/**
 * Threads: people-first chat with no agent behind it. The machine owns them
 * (src/threads.ts in the lfg repository). omg joins only when a message says
 * `@omg`: it answers a quick question itself, or starts a task and posts the
 * task's result back into the thread.
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
  task?: { sessionId: string; event: ThreadTaskEvent; title?: string | null; project?: string | null };
  /** Client only: sent, not yet stored. */
  pending?: boolean;
};

export type ThreadSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  project: { cwd: string; name: string } | null;
  lastMessage: Pick<ThreadMessage, "author" | "text" | "ts"> | null;
};

export type ThreadTaskRow = {
  sessionId: string;
  title: string | null;
  project: string | null;
  busy: boolean;
  status: string | null;
  ended: boolean;
};

export type ThreadDetail = {
  me: string;
  thread: ThreadSummary;
  participants: { id: string; kind: string; display: { name?: string | null; fallback: string } }[];
  messages: ThreadMessage[];
  tasks: ThreadTaskRow[];
};

const json = { "Content-Type": "application/json" };

export function listThreads(client: OmgClient) {
  return client.transport.request<{ threads?: ThreadSummary[] }>("/api/threads").then((res) => res.threads ?? []);
}

export function createThread(client: OmgClient, text: string) {
  return client.transport
    .request<{ thread: ThreadSummary }>("/api/threads", { method: "POST", headers: json, body: JSON.stringify({ text }) })
    .then((res) => res.thread);
}

export function getThread(client: OmgClient, id: string) {
  return client.transport.request<ThreadDetail>(`/api/threads/${encodeURIComponent(id)}`);
}

export function sendThreadMessage(client: OmgClient, id: string, text: string) {
  return client.transport
    .request<{ message: ThreadMessage }>(`/api/threads/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ text }),
    })
    .then((res) => res.message);
}

export function updateThread(
  client: OmgClient,
  id: string,
  patch: { projectCwd?: string | null; title?: string | null; archived?: boolean },
) {
  return client.transport
    .request<{ thread: ThreadSummary }>(`/api/threads/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify(patch),
    })
    .then((res) => res.thread);
}

/** One line for a thread row on Home. */
export function threadPreview(thread: ThreadSummary): string {
  const last = thread.lastMessage;
  if (!last) return "No messages yet";
  const who = last.author.kind === "omg" ? "omg" : last.author.name;
  return `${who}: ${last.text.replace(/\s+/g, " ").trim()}`;
}

/** Starter prompts on an empty thread. Each one only fills the composer. */
export const THREAD_STARTERS = ["Brainstorm an idea", "Plan the week", "@omg what changed today?"] as const;
