import type { OmgClient } from "@omg-dev/client";

/**
 * Threads: people-first chat with no agent behind it. The machine owns them
 * (src/threads.ts in the lfg repository). omg joins only when a message says
 * `@omg`: it answers a quick question itself, or starts a task and posts the
 * task's result back into the thread.
 */

import type { ThreadDetail, ThreadMessage, ThreadSummary } from "../../../packages/protocol/src/threads";

export type {
  ThreadAuthor,
  ThreadDetail,
  ThreadMessage,
  ThreadSummary,
  ThreadTaskEvent,
  ThreadTaskRow,
} from "../../../packages/protocol/src/threads";
export { threadPreview } from "../../../packages/protocol/src/threads";

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

/** Post a message; with `replyTo`, into that top-level message's replies. */
export function sendThreadMessage(client: OmgClient, id: string, text: string, replyTo?: string | null) {
  return client.transport
    .request<{ message: ThreadMessage }>(`/api/threads/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ text, ...(replyTo ? { replyTo } : {}) }),
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

/** Starter prompts on an empty thread. Each one only fills the composer. */
export const THREAD_STARTERS = ["Brainstorm", "Plan the week", "@omg what changed?"] as const;
