// The held sends under the composer. See HeldQueueCards.
import { useState } from "react";
import { Check, ChevronDown, Clock3, X } from "lucide-react";
import { api } from "../lib/omg-client";
import { cn } from "../lib/utils";
import type { OmgQueueMessage } from "../lib/omg-chat-transport";

/**
 * The held sends under the composer: queue-mode text the server keeps back
 * until the running turn ends, then releases in this order. Each card is still
 * the user's draft, so it can be edited in place or dropped. The list is
 * server state; the callbacks patch it optimistically and the next queue frame
 * confirms.
 */
export function HeldQueueCards({
  sessionId,
  items,
  busy,
  onChange,
  onError,
  request = api,
}: {
  sessionId: string;
  items: OmgQueueMessage[];
  busy: boolean;
  onChange: (update: (current: OmgQueueMessage[]) => OmgQueueMessage[]) => void;
  onError: (message: string | null) => void;
  request?: <T>(path: string, init?: RequestInit) => Promise<T>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const base = `/api/sessions/${encodeURIComponent(sessionId)}/queue`;
  // A card can be released (or removed elsewhere) between opening it and
  // acting on it. The server answers 404/409; the honest message is that the
  // text already went, and the list is refreshed so the card leaves.
  const fail = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (/not found|only a held message/i.test(message)) {
      onError("That queued message was already sent.");
      void request<{ queue?: OmgQueueMessage[] }>(base, { cache: "no-store" })
        .then((res) => onChange(() => (res.queue ?? []).filter((item) => item.status === "held")))
        .catch(() => null);
      return;
    }
    onError(message);
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

  const hidden = expanded ? 0 : Math.max(0, items.length - 1);
  const shown = expanded ? items : items.slice(0, 1);

  return (
    <div
      data-testid="held-queue"
      className={cn(
        // A card tucked UNDER the composer bar: narrower, centred, on a
        // dimmer surface, and layered below the bar with its bottom 12px
        // hidden behind it, so it reads as the next thing waiting beneath
        // the field rather than a panel sitting on top of it.
        "relative z-0 mx-auto -mb-3 flex w-full max-w-2xl flex-col rounded-t-2xl border border-b-0 border-border bg-muted/70 pb-3",
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-label={expanded ? "Show only the next queued message" : "Show all queued messages"}
        className="user-queued-label flex w-full items-center gap-1 px-3 pb-1 pt-2 text-left"
      >
        <Clock3 className="size-3" aria-hidden="true" />
        <span className="flex-1">
          {items.length === 1 ? "1 queued" : `${items.length} queued`}
          {busy ? "" : " · sending"}
        </span>
        {items.length > 1 ? (
          <ChevronDown
            className={cn("size-3.5 transition-transform duration-150", expanded && "rotate-180")}
            aria-hidden="true"
          />
        ) : null}
      </button>
      {shown.map((item, index) => {
        const editing = editingId === item.id;
        return (
          <div
            key={item.id}
            className="flex items-start gap-2 border-t border-foreground/[0.08] px-3 py-1.5 text-sm text-foreground/85"
          >
            <span className="mt-0.5 w-4 shrink-0 text-xs text-muted-foreground tabular-nums">{index + 1}</span>
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
            {editing ? (
              <button
                type="button"
                onClick={() => void save(item.id)}
                className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground"
                aria-label="Save queued message"
              >
                <Check className="size-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void remove(item.id)}
                className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground"
                aria-label="Remove queued message"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
