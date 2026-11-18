import { useEffect, useRef, useState, type RefObject } from "react";
import { omgFetch } from "./omg-client";

export type BtwChatCommand =
  | { matched: false }
  | { matched: true; question: string };

export interface BtwTurn {
  id: string;
  question: string;
  answer: string;
  streaming: boolean;
  error?: string;
}

/**
 * Match `/btw` or `/btw <question>` at the start of composer text.
 */
export function parseBtwCommand(text: string): BtwChatCommand {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/btw(?:\s+([\s\S]*))?$/i);
  if (!match) return { matched: false };
  return { matched: true, question: (match[1] ?? "").trim() };
}

/**
 * Stream a tool-free `/btw` side question for a session over SSE.
 */
export async function streamBtwQuestion(input: {
  sessionId: string;
  question: string;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  signal?: AbortSignal;
  onDelta: (chunk: string) => void;
}): Promise<string> {
  const response = await omgFetch(
    `/api/sessions/${encodeURIComponent(input.sessionId)}/btw`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        question: input.question,
        history: input.history,
      }),
      signal: input.signal,
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let message = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed?.error) message = parsed.error;
    } catch {
      if (body.trim()) message = body.trim();
    }
    throw new Error(message);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Streaming response body is unavailable");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep = buffer.indexOf("\n\n");
    while (sep !== -1) {
      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf("\n\n");

      for (const line of rawEvent.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const rawJson = line.slice(5).trim();
        if (!rawJson) continue;
        const event = JSON.parse(rawJson) as {
          type?: string;
          text?: string;
          error?: string;
        };
        if (event.type === "delta" && typeof event.text === "string") {
          fullText += event.text;
          input.onDelta(event.text);
        } else if (event.type === "done" && typeof event.text === "string") {
          if (!fullText && event.text) {
            fullText = event.text;
            input.onDelta(event.text);
          }
        } else if (event.type === "error") {
          throw new Error(event.error || "Side question failed");
        }
      }
    }
  }

  return fullText;
}

export function useBtwSession(input: {
  sid: string | null | undefined;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onPromoteText: (text: string) => void;
  focusInputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { sid, open: controlledOpen, onOpenChange, onPromoteText, focusInputRef } = input;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === "function" ? next(open) : next;
    if (onOpenChange) onOpenChange(resolved);
    else setUncontrolledOpen(resolved);
  };
  const [turns, setTurns] = useState<BtwTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const turnsRef = useRef<BtwTurn[]>([]);
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (onOpenChange) onOpenChange(false);
    else setUncontrolledOpen(false);
    setTurns([]);
    setStreaming(false);
  }, [sid, onOpenChange]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === ";") {
        e.preventDefault();
        const next = !openRef.current;
        if (onOpenChange) onOpenChange(next);
        else setUncontrolledOpen(next);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange]);

  async function ask(question: string) {
    const q = question.trim();
    if (!sid || !q || streaming) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const history = turnsRef.current
      .filter((t) => !t.error && t.answer.trim().length > 0)
      .flatMap((t) => [
        { role: "user" as const, text: t.question },
        { role: "assistant" as const, text: t.answer },
      ]);

    const id = `btw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setTurns((prev) => [...prev, { id, question: q, answer: "", streaming: true }]);
    setStreaming(true);

    const finish = () => {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setStreaming(false);
      }
    };

    try {
      await streamBtwQuestion({
        sessionId: sid,
        question: q,
        history,
        signal: controller.signal,
        onDelta: (chunk) => {
          setTurns((prev) =>
            prev.map((t) => (t.id === id ? { ...t, answer: t.answer + chunk } : t)),
          );
        },
      });
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, streaming: false } : t)),
      );
      finish();
    } catch (err) {
      finish();
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, streaming: false, error: message } : t)),
      );
    }
  }

  function clear() {
    abortRef.current?.abort();
    abortRef.current = null;
    setTurns([]);
    setStreaming(false);
  }

  function close() {
    abortRef.current?.abort();
    abortRef.current = null;
    setOpen(false);
    setStreaming(false);
  }

  function promote(turn: BtwTurn) {
    if (!turn.answer.trim()) return;
    onPromoteText(`From /btw (${turn.question}):\n\n${turn.answer}`);
    setOpen(false);
    setTimeout(() => focusInputRef.current?.focus(), 20);
  }

  return {
    open,
    setOpen,
    turns,
    streaming,
    ask,
    clear,
    close,
    promote,
  };
}
