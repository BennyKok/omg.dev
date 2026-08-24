// Fetching tool_use arguments that the server deliberately did not send.
//
// A run of tool calls renders as one pill showing a name and a count, like
// "49 Bash · 1 Read". The arguments behind it are not on screen until a reader
// opens the pill, and they are the bulk of a transcript: on a real
// 4 732-message session the messages the client keeps are 1 690 KB, of which
// 1 095 KB is tool_use arguments.
//
// So a capable client asks the server to leave them out (see
// DEFER_TOOL_ARGS_PARAM) and comes back for the ones a reader actually opens.
// The server marks each deferred call with `toolArgsLen`, which is how this
// module tells "the arguments are elsewhere" apart from "this call had none".
import { useCallback, useEffect, useRef, useState } from "react";
import { toolArgsPath } from "./transcript-paging";

export type ToolArgsState =
  | { status: "loading" }
  | { status: "ready"; args: string }
  | { status: "error"; error: string };

export type DeferredToolMessage = {
  id?: string;
  kind?: string;
  toolArgsLen?: number;
};

/**
 * True when this message's arguments were withheld and can be fetched.
 *
 * `toolArgsLen` of 0 is not deferred: the server sends a call with no
 * arguments unchanged, because there would be nothing to fetch.
 */
export function isDeferredToolUse(message: DeferredToolMessage): boolean {
  return (
    message.kind === "tool_use" &&
    typeof message.toolArgsLen === "number" &&
    message.toolArgsLen > 0 &&
    !!message.id
  );
}

/** Every message id in this group whose arguments still have to be fetched. */
export function deferredToolIds(messages: DeferredToolMessage[]): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    if (isDeferredToolUse(message) && message.id && !ids.includes(message.id)) ids.push(message.id);
  }
  return ids;
}

/**
 * One fetch of one call's arguments.
 *
 * Rejects with a readable message rather than a status code, because the only
 * consumer renders it straight into the opened pill.
 */
export async function fetchToolArgs(
  sid: string,
  messageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(toolArgsPath(sid, messageId));
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "Command details are no longer available"
        : `Could not load command details (${res.status})`,
    );
  }
  const body = (await res.json()) as { args?: unknown };
  return typeof body.args === "string" ? body.args : "";
}

/**
 * Arguments for the calls in an OPEN pill, keyed by message id.
 *
 * Fetches only while `open` is true, only once per id, and keeps what it has
 * on close, so reopening the same pill is instant. A component that unmounts
 * mid-flight does not set state. A failed id is forgotten rather than cached,
 * so closing and reopening the pill retries it.
 */
export function useDeferredToolArgs(
  sid: string | null | undefined,
  messages: DeferredToolMessage[],
  open: boolean,
  fetchImpl: typeof fetch = fetch,
): Record<string, ToolArgsState> {
  const [states, setStates] = useState<Record<string, ToolArgsState>>({});
  const mounted = useRef(true);
  const requested = useRef<Set<string>>(new Set());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (id: string) => {
      if (!sid) return;
      requested.current.add(id);
      setStates((prev) => ({ ...prev, [id]: { status: "loading" } }));
      try {
        const args = await fetchToolArgs(sid, id, fetchImpl);
        if (!mounted.current) return;
        setStates((prev) => ({ ...prev, [id]: { status: "ready", args } }));
      } catch (err) {
        if (!mounted.current) return;
        requested.current.delete(id);
        setStates((prev) => ({
          ...prev,
          [id]: {
            status: "error",
            error: err instanceof Error ? err.message : "Could not load command details",
          },
        }));
      }
    },
    [sid, fetchImpl],
  );

  const ids = deferredToolIds(messages).join(",");
  useEffect(() => {
    if (!open || !sid) return;
    for (const id of ids ? ids.split(",") : []) {
      if (!requested.current.has(id)) void load(id);
    }
  }, [open, sid, ids, load]);

  return states;
}
