// The human-in-the-loop reply surface. Polls /api/ask for open questions raised
// by headless agents and lets the user answer by tapping a suggested option or
// typing. Answers POST back to /api/ask/<id>/answer, which wakes the agent.
//
// Questions used to own a whole page (a swipeable card deck at /ask). They are
// a form of notification, so they now live INSIDE the Notification Center as
// time-sensitive cells pinned above the feed — one inbox, answerable in place.
// What survives here is the shared state plus the cell itself:
//   • <AskProvider/>         — the single poll loop + queue, read by everything
//   • useAsk()               — questions + answer/dismiss for the feed
//   • <AskNavButton/>        — urgency badge; opens the Notification Center
//   • <QuestionNotification/>— one answerable question card
//   • <SessionQuestionPanel/>— the question, shown inside the session that asked
//   • useSessionQuestions()  — which questions belong to a session (one matcher)

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { routedToast as toast } from "@/lib/host-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import { omgFetch } from "@/lib/omg-client";
import { closePushNotification } from "@/lib/push";
import { listsLive, onListChange } from "@/lib/change-topics";
import { KeyRound, MessageCircleQuestion, Send, X } from "lucide-react";
import { QuestionCard, QuestionChoices } from "./question-card";

export type Question = {
  id: string;
  question: string;
  options?: string[];
  agentId?: string | null;
  sessionId?: string | null;
  /** A secure ask: the answer is one env value, typed in a password field. */
  secret?: { key: string } | null;
  createdAt: number;
};

const POLL_MS = 5000;

// Flatten markdown to a one-line plain-text preview (toasts, the collapsed
// cell). Questions written by agents often arrive full of headings and lists;
// previews should read as a sentence, not render as a document.
export function stripMd(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/^#{1,6}\s+/gm, "") // heading markers
    .replace(/^\s*[-*+]\s+/gm, "") // list bullets
    .replace(/`([^`]+)`/g, "$1")
    // Underscore emphasis only at word edges, as in CommonMark: a name like
    // FISH_AUDIO_API_KEY must keep its underscores.
    .replace(/\*\*([^*]+)\*\*|\*([^*]+)\*|(?<!\w)__([^_]+)__(?!\w)|(?<!\w)_([^_]+)_(?!\w)/g, "$1$2$3$4")
    .replace(/\s+/g, " ")
    .trim();
}

type AskContextValue = {
  questions: Question[];
  busy: boolean;
  answer: (q: Question, text: string) => Promise<void>;
  answerInSession: (q: Question, text: string) => Promise<void>;
  submitSecret: (q: Question, value: string) => Promise<boolean>;
  dismiss: (q: Question) => Promise<void>;
  dismissAll: () => Promise<void>;
};

const AskContext = createContext<AskContextValue | null>(null);

export function useAsk(): AskContextValue {
  const ctx = useContext(AskContext);
  if (!ctx) throw new Error("useAsk must be used within <AskProvider>");
  return ctx;
}

// Owns the single poll loop + queue so the nav badge and the Notification
// Center read one source of truth — and the feed never fetches questions a
// second time.
export function AskProvider({ children }: { children: React.ReactNode }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [busy, setBusy] = useState(false);
  const seen = useRef<Set<string>>(new Set());
  // Questions answered or dismissed here. They leave the list the moment the
  // person acts, and a poll that was already in flight must not bring them
  // back before the server has recorded the answer. Ids are never reused.
  const settled = useRef<Set<string>>(new Set());

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
      const res = await omgFetch(feedUrl, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { questions: Question[] };
      const qs = (data.questions || []).filter((q) => !settled.current.has(q.id));
      // Oldest-first so we work the queue in order.
      qs.sort((a, b) => a.createdAt - b.createdAt);
      setQuestions(qs);
      for (const q of qs) {
        if (!seen.current.has(q.id)) {
          seen.current.add(q.id);
          toast("An agent needs your input", {
            description: stripMd(q.question).slice(0, 140),
          });
        }
      }
    } catch {
      // transient — next tick retries
    }
  }, []);

  useEffect(() => {
    void refresh();
    // A new question is announced on the live socket the moment an agent asks
    // it. Poll only while disconnected.
    const t = setInterval(() => {
      if (listsLive()) return;
      void refresh();
    }, POLL_MS);
    const stopChanges = onListChange("ask", () => void refresh());
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      clearInterval(t);
      stopChanges();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [refresh]);

  // Take a question out of the list now, before its request. `restore` puts
  // it back when that request fails, so the person can try again.
  const settleLocally = useCallback((q: Question) => {
    settled.current.add(q.id);
    setQuestions((prev) => prev.filter((x) => x.id !== q.id));
    void closePushNotification(`ask-${q.id}`);
  }, []);
  const restore = useCallback(
    (q: Question) => {
      settled.current.delete(q.id);
      setQuestions((prev) =>
        prev.some((x) => x.id === q.id)
          ? prev
          : [...prev, q].sort((a, b) => a.createdAt - b.createdAt),
      );
      void refresh();
    },
    [refresh],
  );

  // Optimistic: the card goes on the tap. Waiting for the round trip left a
  // spinner on a question the person had already answered.
  const answer = useCallback(
    async (q: Question, text: string) => {
      if (!text.trim() || settled.current.has(q.id)) return;
      settleLocally(q);
      try {
        const res = await omgFetch(`/api/ask/${q.id}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer: text.trim(), via: "web" }),
        });
        if (!res.ok) throw new Error(await res.text());
        toast("Sent to the agent");
      } catch {
        restore(q);
        toast.error("Could not send your answer");
      }
    },
    [settleLocally, restore],
  );

  // The person answered by typing in the owning session's own composer. That
  // text is already on its way to the agent through the normal send path, so
  // this call only RESOLVES the question: it records the answer, wakes any
  // blocked long-poll, and takes the push banner down. `deliver: false` stops
  // the server from injecting the same sentence into the session a second time.
  // It stays quiet on purpose — the composer already showed the send.
  const answerInSession = useCallback(async (q: Question, text: string) => {
    const body = text.trim();
    if (!body) return;
    // A secure ask is answered only by its password field. A composer message
    // is ordinary chat and must not resolve it.
    if (q.secret) return;
    settleLocally(q);
    try {
      await omgFetch(`/api/ask/${q.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: body, via: "web", deliver: false }),
      });
    } catch {
      // The message itself still went to the agent. Let the next poll show
      // the question again if the server still has it open.
      settled.current.delete(q.id);
    }
  }, [settleLocally]);

  // The value goes to the runtime, which saves it to the project .env and the
  // hosted app. It never enters the transcript, and the agent gets the key
  // name only.
  const submitSecret = useCallback(
    async (q: Question, value: string): Promise<boolean> => {
      if (busy || !value.trim()) return false;
      setBusy(true);
      try {
        const res = await omgFetch(`/api/ask/${q.id}/secret`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value }),
        });
        const body = (await res.json().catch(() => null)) as
          | { error?: string; saved?: { key: string; cloud: string; cloudError?: string } }
          | null;
        if (!res.ok) {
          toast.error(body?.error || "Could not save the key");
          return false;
        }
        setQuestions((prev) => prev.filter((x) => x.id !== q.id));
        void closePushNotification(`ask-${q.id}`);
        if (body?.saved?.cloud === "failed") {
          toast.error(`${q.secret?.key ?? "Key"} saved locally. The hosted app was not updated.`);
        } else {
          toast(`${q.secret?.key ?? "Key"} saved`);
        }
        return true;
      } catch {
        toast.error("Could not save the key");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  // Dismissing is how a person says "I'm not answering this" — the asking agent
  // stops waiting and moves on. Clear the cell locally, and take the sticky OS
  // banner down with it so the notification doesn't outlive the question.
  // Optimistic, like answer: the cell goes first and returns on failure.
  const dismissOne = useCallback(
    async (q: Question) => {
      settleLocally(q);
      try {
        const res = await omgFetch(`/api/ask/${q.id}/dismiss`, { method: "POST" });
        if (!res.ok) throw new Error(await res.text());
      } catch (e) {
        restore(q);
        throw e;
      }
    },
    [settleLocally, restore],
  );

  const dismiss = useCallback(
    async (q: Question) => {
      if (settled.current.has(q.id)) return;
      try {
        await dismissOne(q);
        toast("Question dismissed — the agent will stop waiting");
      } catch {
        toast.error("Could not dismiss the question");
      }
    },
    [dismissOne],
  );

  // Clearing a backlog one X at a time is the thing people actually complain
  // about, so the whole stack goes in one action. Independent requests: one
  // failure must not strand the rest.
  const dismissAll = useCallback(async () => {
    if (busy) return;
    const targets = questions;
    if (!targets.length) return;
    setBusy(true);
    try {
      const results = await Promise.allSettled(targets.map((q) => dismissOne(q)));
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed)
        toast.error(
          failed === targets.length
            ? "Could not dismiss the questions"
            : `Dismissed ${targets.length - failed}, ${failed} failed`,
        );
      else
        toast(
          `Dismissed ${targets.length} question${targets.length === 1 ? "" : "s"}`,
        );
    } finally {
      setBusy(false);
      void refresh();
    }
  }, [busy, questions, dismissOne, refresh]);

  return (
    <AskContext.Provider
      value={{ questions, busy, answer, answerInSession, submitSecret, dismiss, dismissAll }}
    >
      {children}
    </AskContext.Provider>
  );
}

// Top-right island button — the urgency signal. Shows an unanswered count badge
// and a gentle pulse when agents are waiting. Tapping opens the Notification
// Center, where the questions themselves are answered.
export function AskNavButton({
  active,
  onOpen,
}: {
  active?: boolean;
  onOpen: () => void;
}) {
  const { questions } = useAsk();
  const count = questions.length;
  // Nothing waiting: this is a pure urgency affordance, so it stays out of the
  // island entirely rather than sitting there inert.
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? "page" : undefined}
      aria-label={`${count} question${count === 1 ? "" : "s"} for you`}
      title={`${count} waiting for you`}
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary transition-colors duration-200 ease-out active:scale-[0.96]",
      )}
    >
      {!active ? (
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/15" />
      ) : null}
      <MessageCircleQuestion className="relative size-[18px]" />
      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
        {count > 9 ? "9+" : count}
      </span>
    </button>
  );
}

// Which open questions belong to one session. The same session can have an LFG
// id and a provider-native id (especially after resume), so callers pass both
// aliases and either one owns the question. This is the single matcher: the
// in-conversation panel, the composer, and the live card all read it, so the
// three surfaces cannot disagree about whether a session is waiting on you.
export function useSessionQuestions(
  sessionIds: Array<string | null | undefined>,
): Question[] {
  const { questions } = useAsk();
  // Join to a primitive so a fresh array literal per render does not re-run
  // the filter (SessionCard is memoized and renders on every transcript tick).
  const key = sessionIds.filter((id): id is string => !!id).join("\u0000");
  return useMemo(() => {
    if (!key) return [];
    const aliases = new Set(key.split("\u0000"));
    return questions.filter((q) => !!q.sessionId && aliases.has(q.sessionId));
  }, [questions, key]);
}

// Keep an ask-user question in the conversation that raised it.
//
// The cards render IN the transcript, at the end of the stream (ChatStream
// places them), the same place and the same QuestionCard as a harness prompt
// and as the iOS client. They have NO reply box: the session composer below
// is the reply box, and it resolves the question as it sends (see
// SessionChatBody). Two inputs for one question was a bug once already.
export function SessionQuestionPanel({
  sessionIds,
}: {
  sessionIds: Array<string | null | undefined>;
}) {
  const matching = useSessionQuestions(sessionIds);
  if (!matching.length) return null;
  return (
    <>
      {matching.map((q) => (
        <SessionAskCard key={q.id} q={q} />
      ))}
    </>
  );
}

function SessionAskCard({ q }: { q: Question }) {
  const { busy, answer, dismiss } = useAsk();
  const options = q.secret ? [] : (q.options ?? []);
  return (
    <QuestionCard
      question={
        <MessageResponse className={QUESTION_MARKDOWN}>{q.question}</MessageResponse>
      }
      choices={options.map((label) => ({ label }))}
      disabled={busy}
      onDismiss={() => void dismiss(q)}
      onPick={(index) => {
        const label = options[index];
        if (label) void answer(q, label);
      }}
    >
      {q.secret ? <SecretField q={q} /> : null}
    </QuestionCard>
  );
}

// Demote headings: a question card must never look like a pile of h1s.
const QUESTION_MARKDOWN = cn(
  "text-[15px] leading-snug",
  "[&_h1]:text-[15px] [&_h2]:text-[15px] [&_h3]:text-[15px] [&_h4]:text-[15px]",
  "[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold",
  "[&_h1]:mt-2 [&_h2]:mt-2 [&_h3]:mt-1.5 [&_h1]:mb-1 [&_h2]:mb-1 [&_h3]:mb-1",
  "[&_p]:my-1 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5",
);

// One answerable question, shaped like a notification rather than a page. Rests
// collapsed at two lines; tapping the question returns to its conversation,
// while the explicit More action opens the full text and reply box in place.
// Suggested options stay visible because they are the one-tap path.
//
// `showReplyBox` is false wherever the surface around the card already owns a
// reply input — the session conversation. Two reply boxes for one question is
// the bug this flag exists to prevent.
export function QuestionNotification({
  q,
  compactPreview = true,
  showReplyBox = true,
  onOpenSession,
}: {
  q: Question;
  compactPreview?: boolean;
  showReplyBox?: boolean;
  onOpenSession?: (sessionId: string) => void;
}) {
  const { busy, answer, dismiss } = useAsk();
  const [open, setOpen] = useState(!compactPreview);
  const [draft, setDraft] = useState("");

  // A new question in this slot starts fresh.
  useEffect(() => {
    setDraft("");
  }, [q.id]);

  const preview = stripMd(q.question);
  return (
    <article className="border-b border-border/50 last:border-b-0">
      <div className="flex w-full items-start gap-3 px-4 py-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
          <MessageCircleQuestion className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 text-[13px]">
            {/* The whole cell reads as "go here", not only its preview line:
                the title is the first thing tapped on a phone. */}
            {q.sessionId && onOpenSession ? (
              <button
                type="button"
                onClick={() => onOpenSession(q.sessionId as string)}
                title="Open the session that asked"
                className="min-w-0 truncate font-semibold underline-offset-2 hover:underline"
              >
                Needs your input
              </button>
            ) : (
              <span className="min-w-0 truncate font-semibold">Needs your input</span>
            )}
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {timeAgo(q.createdAt)}
            </span>
            {/* Always visible, never hover-gated. A question you cannot clear
                is a notification that owns you: it pins the nav badge, keeps a
                requireInteraction banner on the lock screen, and the person has
                no way out except answering. Reveal-on-hover also does not exist
                on the phone this is mostly read on. */}
            <button
              type="button"
              onClick={() => void dismiss(q)}
              disabled={busy}
              aria-label="Dismiss question"
              title="Dismiss — the agent stops waiting"
              className="-my-1 -mr-1.5 flex size-7 shrink-0 self-center items-center justify-center rounded-full text-muted-foreground/70 transition-[color,background-color,transform] duration-150 hover:bg-destructive/10 hover:text-destructive active:scale-[0.94] disabled:pointer-events-none disabled:opacity-40"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {open ? (
            <MessageResponse
              className={cn(
                "mt-0.5 text-[13px] leading-relaxed",
                // Demote headings: a question card must never look like a pile
                // of h1s inside a notification row.
                "[&_h1]:text-[13px] [&_h2]:text-[13px] [&_h3]:text-[13px] [&_h4]:text-[13px]",
                "[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold",
                "[&_h1]:mt-2 [&_h2]:mt-2 [&_h3]:mt-1.5 [&_h1]:mb-1 [&_h2]:mb-1 [&_h3]:mb-1",
                "[&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5",
              )}
            >
              {q.question}
            </MessageResponse>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (q.sessionId && onOpenSession) onOpenSession(q.sessionId);
                else setOpen(true);
              }}
              title={q.sessionId ? "Open corresponding session" : "Show full question"}
              className="mt-0.5 block w-full text-left"
            >
              <span className="line-clamp-2 text-[13px] leading-relaxed text-foreground/90">
                {preview}
              </span>
            </button>
          )}

          {q.secret ? <SecretField q={q} /> : null}

          {!q.secret && q.options?.length ? (
            <QuestionChoices
              choices={q.options.map((label) => ({ label }))}
              disabled={busy}
              onPick={(index) => {
                const label = q.options?.[index];
                if (label) void answer(q, label);
              }}
            />
          ) : null}

          {open && showReplyBox && !q.secret ? (
            <div className="mt-2 flex items-end gap-1.5">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a reply…"
                rows={1}
                autoFocus={compactPreview}
                className="max-h-32 min-h-9 flex-1 resize-none text-[13px]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void answer(q, draft);
                  }
                }}
              />
              <Button
                size="icon-sm"
                disabled={busy || !draft.trim()}
                onClick={() => void answer(q, draft)}
                aria-label="Send answer"
              >
                <Send className="size-4" />
              </Button>
            </div>
          ) : null}

          {/* Footer actions. "Open session" is here as well as on the preview
              line, because an expanded card has no preview left to tap and the
              answer often needs the conversation to make sense. */}
          {!open || (q.sessionId && onOpenSession) ? (
            <div className="mt-1.5 flex items-center gap-3 text-[11px] font-medium text-primary">
              {!open ? (
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  className="transition-opacity hover:opacity-80"
                >
                  More
                </button>
              ) : null}
              {q.sessionId && onOpenSession ? (
                <button
                  type="button"
                  onClick={() => onOpenSession(q.sessionId as string)}
                  title="Open the session that asked"
                  className="transition-opacity hover:opacity-80"
                >
                  Open session
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

// The secure field for one env value. Shown on every surface, including the
// session panel that has no reply box: the composer there is plain chat, and a
// key typed into it would land in the transcript.
export function SecretField({ q }: { q: Question }) {
  const { busy, submitSecret } = useAsk();
  const [value, setValue] = useState("");
  useEffect(() => {
    setValue("");
  }, [q.id]);
  const key = q.secret?.key ?? "";
  const save = async () => {
    if (await submitSecret(q, value)) setValue("");
  };
  return (
    <form
      className="mt-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <KeyRound className="size-3" />
        <span className="font-mono">{key}</span>
      </label>
      <div className="flex items-center gap-1.5">
        <input
          type="password"
          name={`secret-${q.id}`}
          aria-label={`Value for ${key}`}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste the value"
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" size="sm" disabled={busy || !value.trim()}>
          Save
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Saved to the project .env and the hosted app. The agent sees the name only.
      </p>
    </form>
  );
}

function timeAgo(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
