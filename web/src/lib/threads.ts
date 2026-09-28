import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./omg-client";
import type { ThreadDetail, ThreadMessage, ThreadSummary } from "../../../packages/protocol/src/threads";

/**
 * Threads on the web: people-first chat with no agent behind it. The machine
 * owns them (src/threads.ts); the card rules are shared with iOS in
 * packages/protocol/src/threads.ts.
 */

export type { ThreadDetail, ThreadMessage, ThreadSummary };

const json = { "Content-Type": "application/json" };

/**
 * Who is writing. A hosted Computer stamps the viewer on every request; a
 * self-hosted box learns it from the profile picked in this browser, the same
 * `user` the bot and session lists send.
 */
function asUser(user?: string | null): string {
  return user ? `?user=${encodeURIComponent(user)}` : "";
}

export function listThreads(): Promise<ThreadSummary[]> {
  return api<{ threads?: ThreadSummary[] }>("/api/threads").then((res) => res.threads ?? []);
}

export function createThread(text: string, user?: string | null): Promise<ThreadSummary> {
  return api<{ thread: ThreadSummary }>("/api/threads", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ text, ...(user ? { user } : {}) }),
  }).then((res) => res.thread);
}

export function getThread(id: string, user?: string | null): Promise<ThreadDetail> {
  return api<ThreadDetail>(`/api/threads/${encodeURIComponent(id)}${asUser(user)}`);
}

export function sendThreadMessage(
  id: string,
  text: string,
  user?: string | null,
  /** A top-level message id, to post in its replies. */
  replyTo?: string | null,
): Promise<ThreadMessage> {
  return api<{ message: ThreadMessage }>(`/api/threads/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ text, ...(user ? { user } : {}), ...(replyTo ? { replyTo } : {}) }),
  }).then((res) => res.message);
}

export function updateThread(
  id: string,
  patch: { projectCwd?: string | null; title?: string | null; archived?: boolean },
): Promise<ThreadSummary> {
  return api<{ thread: ThreadSummary }>(`/api/threads/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: json,
    body: JSON.stringify(patch),
  }).then((res) => res.thread);
}

/**
 * Poll while the tab is visible, and refresh at once when it comes back. The
 * same shape as the ask center's list, which is the other list this app keeps
 * without a socket.
 */
function usePolled<T>(load: () => Promise<T>, everyMs: number, onValue: (value: T) => void) {
  const latest = useRef({ load, onValue });
  latest.current = { load, onValue };
  const run = useCallback(async () => {
    try {
      latest.current.onValue(await latest.current.load());
    } catch {
      // A machine from before threads answers 404; keep what we have.
    }
  }, []);
  useEffect(() => {
    void run();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, everyMs);
    const wake = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [run, everyMs]);
  return run;
}

export function useThreads(): { threads: ThreadSummary[]; refresh: () => Promise<void>; archive: (id: string) => void } {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const refresh = usePolled(listThreads, 10_000, setThreads);
  const archive = useCallback(
    (id: string) => {
      setThreads((rows) => rows.filter((row) => row.id !== id));
      void updateThread(id, { archived: true }).catch(() => void refresh());
    },
    [refresh],
  );
  return { threads, refresh, archive };
}

export function useThread(
  id: string | null,
  user?: string | null,
): { detail: ThreadDetail | null; refresh: () => Promise<void> } {
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  useEffect(() => setDetail(null), [id]);
  const load = useCallback(() => (id ? getThread(id, user) : Promise.resolve(null)), [id, user]);
  const refresh = usePolled(load, 3_000, (value) => {
    if (value) setDetail(value);
  });
  // A different thread loads at once, not on the next tick.
  useEffect(() => {
    void refresh();
  }, [load, refresh]);
  return { detail, refresh };
}
