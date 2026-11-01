// The held sends under the composer. See HeldQueueCards.
import { useState, type ReactNode } from "react";
import { PresenceDock } from "./presence-dock";
import { ArrowUp, Check, ChevronDown, Clock3, Loader2, X } from "lucide-react";
import { api } from "../lib/omg-client";
import { cn } from "../lib/utils";
import type { OmgQueueMessage } from "../lib/omg-chat-transport";

/**
 * Id prefix for a card the composer painted before the server answered. Such
 * a card has no server row yet, so it cannot be edited, sent or removed; it
 * shows a spinner until the send response swaps in the real held row.
 */
export const LOCAL_HELD_ID_PREFIX = "local-held-";

/**
 * The server's answer for a held row that is no longer held: released by the
 * idle turn, or removed from another client. See serve.ts `/queue/:id`.
 */
function isAlreadyReleased(message: string): boolean {
  return /queued message not found|only a held message/i.test(message);
}

/** Held texts sent together, in queue order, as one message. */
export function joinHeldTexts(rows: { text: string }[]): string {
  return rows
    .map((row) => row.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The held sends under the composer: queue-mode text the server keeps back
 * until the running turn ends, then releases in this order. Each card is still
 * the user's draft, so it can be edited in place, sent now (steered into the
 * running turn), or dropped. The list is server state; the callbacks patch it
 * optimistically and the next queue frame confirms.
 */
export function HeldQueueCards({
  sessionId,
  items,
  busy,
  onChange,
  onError,
  onSendNow,
  request = api,
}: {
  sessionId: string;
  items: OmgQueueMessage[];
  busy: boolean;
  onChange: (update: (current: OmgQueueMessage[]) => OmgQueueMessage[]) => void;
  onError: (message: string | null) => void;
  /**
   * Stop waiting and steer the whole queue into the running turn as one
   * message. The caller paints `text` first, then awaits `release`, which
   * takes the rows out of the held queue and resolves to the text of the rows
   * it actually released. The caller sends THAT text, so a failed release
   * never sends twice. A rejection puts the cards back.
   */
  onSendNow: (text: string, release: () => Promise<string>) => Promise<void>;
  request?: <T>(path: string, init?: RequestInit) => Promise<T>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const base = `/api/sessions/${encodeURIComponent(sessionId)}/queue`;
  // A card can be released (or removed elsewhere) between opening it and
  // acting on it: the idle release and the tap race, and no UI state closes
  // that window. The server answers 404/409. That is not a failure the user
  // can act on: the text went, and its bubble arrives in the transcript, so
  // it is silent. Only other failures (network, server) are shown, because
  // those can be retried. Any failure re-reads the list: the optimistic edit
  // may have hidden a card the server still holds, or kept one it already sent.
  const fail = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (!isAlreadyReleased(message)) onError(message);
    void request<{ queue?: OmgQueueMessage[] }>(base, { cache: "no-store" })
      .then((res) => onChange(() => (res.queue ?? []).filter((item) => item.status === "held")))
      .catch(() => null);
  };

  const remove = async (id: string) => {
    onChange((current) => current.filter((item) => item.id !== id));
    try {
      await request(`${base}/${id}`, { method: "DELETE" });
    } catch (err) {
      fail(err);
    }
  };
  const save = async (id: string) => {
    const text = draft.trim();
    setEditingId(null);
    if (!text) return void remove(id);
    onChange((current) => current.map((item) => (item.id === id ? { ...item, text } : item)));
    try {
      await request(`${base}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
    } catch (err) {
      fail(err);
    }
  };
  // Send now takes the WHOLE queue, not just the tapped card: the user has
  // decided to stop waiting, and leaving the other cards behind would release
  // them one per idle turn after a reply that already saw the first. The
  // texts go in queue order as ONE steer, so the agent gets one turn.
  //
  // The cards leave and the caller paints the bubble in the same tick, so the
  // text never disappears while the deletes are in flight. The deletes still
  // run before the send, and only the rows whose delete succeeded are sent,
  // so a failed delete never duplicates a row: that card comes back (fail()
  // refreshes) and stays queued. Cards still waiting for their server row
  // (local ids) cannot be deleted yet, so they stay.
  const sendNow = async () => {
    const rows = items.filter((item) => !item.id.startsWith(LOCAL_HELD_ID_PREFIX) && item.text.trim());
    if (!rows.length) return;
    const ids = new Set(rows.map((item) => item.id));
    onChange((current) => current.filter((item) => !ids.has(item.id)));
    const failures: unknown[] = [];
    try {
      await onSendNow(joinHeldTexts(rows), async () => {
        const results = await Promise.allSettled(
          rows.map((item) => request(`${base}/${item.id}`, { method: "DELETE" })),
        );
        const released = rows.filter((_, index) => results[index]?.status === "fulfilled");
        results.forEach((result) => {
          if (result.status === "rejected") failures.push(result.reason);
        });
        if (!released.length) throw failures[0];
        return joinHeldTexts(released);
      });
    } catch (err) {
      return fail(err);
    }
    if (failures.length) fail(failures[0]);
  };

  const hidden = expanded ? 0 : Math.max(0, items.length - 1);
  const shown = expanded ? items : items.slice(0, 1);

  return (
    <div
      data-testid="held-queue"
      className={cn(
        // A card tucked UNDER the composer bar: narrower, centred, on a
        // dimmer surface, and layered below the bar with its bottom 12px
        // hidden behind it, so it reads as the next thing waiting beneath
        // the field rather than a panel sitting on top of it. The 1rem inset
        // on each side is what keeps it narrower on a phone, where max-w-2xl
        // never applies and w-full made it exactly as wide as the bar.
        "relative z-0 mx-auto -mb-3 flex w-[calc(100%-2rem)] max-w-2xl flex-col rounded-t-2xl border border-b-0 border-border bg-muted/70 pb-3 pt-0.5",
      )}
    >
      {/* No header line: the count is the +N chip, and the state is the
          clock (or a spinner while the queue is being sent) in the first
          row's number slot. Spoken for screen readers here. */}
      <span className="sr-only" role="status">
        {items.length === 1 ? "1 queued" : `${items.length} queued`}
        {busy ? "" : ", sending"}
      </span>
      {shown.map((item, index) => {
        const editing = editingId === item.id;
        const local = item.id.startsWith(LOCAL_HELD_ID_PREFIX);
        return (
          <div
            key={item.renderKey ?? item.id}
            className={cn(
              "flex items-start gap-2 px-3 py-1.5 text-sm text-foreground/85",
              index > 0 && "border-t border-foreground/[0.08]",
            )}
          >
            {expanded ? (
              <span className="mt-0.5 w-4 shrink-0 text-xs text-muted-foreground tabular-nums">{index + 1}</span>
            ) : (
              // Collapsed, the number slot says what this row is: queued
              // (a clock), or on its way (a spinner). With more behind it,
              // it also opens the list, like the +N chip.
              <button
                type="button"
                disabled={items.length < 2}
                onClick={() => setExpanded(true)}
                aria-expanded={items.length > 1 ? false : undefined}
                aria-label={items.length > 1 ? "Show all queued messages" : busy ? "Queued" : "Sending"}
                className="mt-0.5 flex h-5 w-4 shrink-0 items-start justify-center text-muted-foreground disabled:cursor-default"
              >
                {busy ? (
                  <Clock3 className="mt-[3px] size-3.5" aria-hidden="true" />
                ) : (
                  <Loader2 className="mt-[3px] size-3.5 animate-spin" aria-hidden="true" />
                )}
              </button>
            )}
            {editing ? (
              <textarea
                autoFocus
                value={draft}
                rows={Math.min(8, Math.max(1, draft.split("\n").length))}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingId(null);
                  } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void save(item.id);
                  }
                }}
                aria-label="Edit queued message"
                className="min-w-0 flex-1 resize-none bg-transparent leading-5 outline-none"
              />
            ) : (
              <button
                type="button"
                disabled={local}
                onClick={() => {
                  setDraft(item.text);
                  setEditingId(item.id);
                }}
                className={cn(
                  "min-w-0 flex-1 break-words text-left leading-5",
                  expanded ? "whitespace-pre-wrap" : "truncate",
                )}
                title="Edit"
              >
                {item.text}
              </button>
            )}
            {expanded && index === 0 && items.length > 1 ? (
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-expanded={true}
                aria-label="Show only the next queued message"
                className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className="size-3.5 rotate-180" aria-hidden="true" />
              </button>
            ) : null}
            {!expanded && hidden > 0 && index === 0 ? (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="shrink-0 rounded-full bg-foreground/[0.06] px-1.5 text-[11px] leading-5 text-muted-foreground tabular-nums hover:text-foreground"
                aria-label={`Show ${hidden} more queued`}
              >
                +{hidden}
              </button>
            ) : null}
            {local ? (
              <span className="shrink-0 p-1 text-muted-foreground" aria-label="Queueing">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              </span>
            ) : editing ? (
              <button
                type="button"
                onClick={() => void save(item.id)}
                className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground"
                aria-label="Save queued message"
              >
                <Check className="size-3.5" />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void sendNow()}
                  className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground"
                  aria-label={
                    items.length > 1 ? "Send all queued now, into the current turn" : "Send now, into the current turn"
                  }
                  title={items.length > 1 ? "Send all now" : "Send now"}
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void remove(item.id)}
                  className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground"
                  aria-label="Remove queued message"
                >
                  <X className="size-3.5" />
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The held cards' room above the composer: see PresenceDock. */
export function HeldQueueDock({
  items,
  children,
}: {
  items: OmgQueueMessage[];
  children: (items: OmgQueueMessage[]) => ReactNode;
}) {
  return <PresenceDock items={items}>{(shown) => children(shown as OmgQueueMessage[])}</PresenceDock>;
}
