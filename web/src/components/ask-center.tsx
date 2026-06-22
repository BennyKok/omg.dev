// AskCenter — the human-in-the-loop reply surface. Polls /api/ask for open
// questions raised by headless agents (the supervisor) and lets the user answer
// by tapping a suggested option or typing. Answers POST back to
// /api/ask/<id>/answer, which wakes the agent's blocked long-poll.
//
// Fully self-contained (own polling + state) so it can be dropped into the app
// tree with a single mount and no coupling to App's state.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageCircleQuestion, Send, X } from "lucide-react";

type Question = {
  id: string;
  question: string;
  options?: string[];
  agentId?: string | null;
  sessionId?: string | null;
  createdAt: number;
};

const POLL_MS = 5000;

export function AskCenter() {
  const [open, setOpen] = useState<Question[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const seen = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      // Prefer this device's filtered feed (scoped to the push-bound user) so we
      // never surface another user's question. Falls back to the open list when
      // notifications aren't enabled on this device.
      let feedUrl = "/api/ask?status=open";
      try {
        if ("serviceWorker" in navigator && "PushManager" in window) {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          if (sub?.endpoint)
            feedUrl = `/api/push/pending?endpoint=${encodeURIComponent(sub.endpoint)}`;
        }
      } catch {
        // no subscription — keep the unscoped fallback
      }
      const res = await fetch(feedUrl, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { questions: Question[] };
      const qs = data.questions || [];
      // Oldest-first so we work the queue in order.
      qs.sort((a, b) => a.createdAt - b.createdAt);
      setOpen(qs);
      for (const q of qs) {
        if (!seen.current.has(q.id)) {
          seen.current.add(q.id);
          toast("An agent needs your input", { description: q.question });
        }
      }
    } catch {
      // transient — next tick retries
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [refresh]);

  const current = open[0] ?? null;

  const answer = useCallback(
    async (text: string) => {
      if (!current || busy || !text.trim()) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/ask/${current.id}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer: text.trim(), via: "web" }),
        });
        if (!res.ok) throw new Error(await res.text());
        setDraft("");
        // Drop it locally so the next question shows immediately; the poll
        // reconciles shortly after.
        setOpen((prev) => prev.filter((q) => q.id !== current.id));
        toast("Sent to the agent");
      } catch {
        toast.error("Could not send your answer");
      } finally {
        setBusy(false);
      }
    },
    [current, busy],
  );

  if (!current) return null;

  const queued = open.length - 1;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-primary/30 bg-background p-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.28)]">
        <div className="mb-2 flex items-start gap-2">
          <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <MessageCircleQuestion className="size-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Agent needs your input{queued > 0 ? ` · ${queued} more` : ""}
            </div>
            <div className="mt-0.5 text-sm font-medium leading-snug">{current.question}</div>
          </div>
        </div>

        {current.options?.length ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {current.options.map((o) => (
              <Button
                key={o}
                variant="tint"
                size="sm"
                disabled={busy}
                onClick={() => void answer(o)}
              >
                {o}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-1.5">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a reply…"
            rows={1}
            className="max-h-28 min-h-9 flex-1 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void answer(draft);
              }
            }}
          />
          <Button
            size="icon-sm"
            disabled={busy || !draft.trim()}
            onClick={() => void answer(draft)}
            aria-label="Send answer"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
