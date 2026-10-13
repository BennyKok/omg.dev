// One look for every question an agent asks.
//
// Two sources reach a session: a harness prompt (OpenCode's question tool,
// Claude's AskUserQuestion, a Claude TUI selector — the live `prompt` event)
// and an ask-user question (omg_input / omg_ask_user, from /api/ask). They are
// owned and answered differently, but to the person they are the same thing:
// the agent stopped and needs a choice. Both render through QuestionCard, and
// every option list — including the Notification Center cell — renders through
// QuestionChoices, so a question looks and taps the same wherever it appears.
//
// The card sits IN the transcript, at the end of the stream, like the iOS
// card (mobile/src/omg/question-card.tsx) and the website login card: a
// question is a turn in the conversation, not a tray docked on the composer.
// The two clients share one design: a rounded card, the agent's optional
// header, the question, then a flush list of full-width rows lettered A, B,
// C: no gaps, no row corners, a hairline divider between rows, running to the
// card's edges. The old wrapped pills were 28–32px tall and hard to hit on a
// phone; a row is at least 52px and carries the option's description.

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { api } from "@/lib/omg-client";
import { cn } from "@/lib/utils";

export type QuestionChoice = { label: string; description?: string | null; selected?: boolean };

/** A, B, C … Z, then 27, 28 … — a question never has that many options. */
export function choiceLetter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

export function QuestionChoices({
  choices,
  onPick,
  disabled = false,
  pendingIndex = null,
}: {
  choices: QuestionChoice[];
  onPick: (index: number) => void;
  disabled?: boolean;
  /** The option whose answer is in flight; it shows a spinner in its letter. */
  pendingIndex?: number | null;
}) {
  if (!choices.length) return null;
  return (
    <ol className="-mx-3 -mb-3 mt-3 divide-y divide-border border-t border-border" aria-label="Answers">
      {choices.map((choice, index) => {
        const active = pendingIndex === index || !!choice.selected;
        const letter = choiceLetter(index);
        return (
          <li key={`${index}:${choice.label}`}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(index)}
              aria-label={`${letter}. ${choice.label}`}
              data-choice={letter}
              className={cn(
                "group flex min-h-[52px] w-full items-center gap-2.5 px-3 py-2 text-left",
                "transition-colors duration-150",
                "disabled:pointer-events-none disabled:opacity-60",
                active ? "bg-muted" : "hover:bg-muted/60 active:bg-muted",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold tabular-nums",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground group-active:border-primary group-active:bg-primary group-active:text-primary-foreground",
                )}
              >
                {pendingIndex === index ? <Loader2 className="size-3.5 animate-spin" /> : letter}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium leading-snug break-words text-foreground">
                  {choice.label}
                </span>
                {choice.description ? (
                  <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground break-words">
                    {choice.description}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One question in the conversation: the agent's optional header, what it
 * asked, its lettered answers, and a dismiss. The composer below takes a
 * free answer, so the card has no reply box of its own.
 */
export function QuestionCard({
  question,
  header,
  choices,
  onPick,
  onDismiss,
  disabled = false,
  pendingIndex = null,
  dismissing = false,
  children,
}: {
  question: ReactNode;
  header?: string | null;
  choices: QuestionChoice[];
  onPick: (index: number) => void;
  onDismiss?: () => void;
  disabled?: boolean;
  pendingIndex?: number | null;
  dismissing?: boolean;
  children?: ReactNode;
}) {
  return (
    <article className="question-card mb-2 overflow-hidden rounded-2xl border bg-card p-3" aria-label="Question">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {header ? (
            <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-primary">{header}</div>
          ) : null}
          <div className={cn("text-[15px] font-medium leading-snug text-foreground", header && "mt-0.5")}>
            {question}
          </div>
        </div>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            disabled={disabled}
            aria-label="Dismiss question"
            title="Dismiss — the agent stops waiting"
            className="-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            {dismissing ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-4" />}
          </button>
        ) : null}
      </div>
      {children}
      <QuestionChoices choices={choices} onPick={onPick} disabled={disabled} pendingIndex={pendingIndex} />
    </article>
  );
}

export type SessionPromptOption = { index: number; label: string; selected?: boolean; description?: string };
export type SessionPrompt = { question?: string; header?: string; options: SessionPromptOption[] };

const DISMISS = -1;

/**
 * The harness prompt of one session (OpenCode question, Claude AskUserQuestion,
 * TUI selector), answered by option index through /api/sessions/:id/answer.
 */
export function SessionPromptPanel({
  prompt,
  sid,
  onError,
}: {
  prompt: SessionPrompt | null;
  sid: string | null;
  onError: (error: string | null) => void;
}) {
  // Selecting an option drives the harness (or the tmux selector) and the
  // panel only clears on the next prompt event. Without a lock the stale
  // options stay clickable, so a second click fires another /answer that
  // overshoots the (now different) selector — the "answer bricks" symptom.
  const sig = prompt ? `${prompt.question ?? ""}|${prompt.options.map((o) => o.label).join("|")}` : "";
  // The in-flight option index, or DISMISS while the skip is in flight.
  const [pending, setPending] = useState<number | null>(null);

  // Reset the lock whenever the prompt itself changes (answered → new / gone).
  useLayoutEffect(() => {
    setPending(null);
  }, [sig]);

  // Safety valve: if the prompt didn't clear (answer didn't land), re-enable so
  // the user can retry instead of being stuck on a dead panel.
  useEffect(() => {
    if (pending === null) return;
    const timer = setTimeout(() => setPending(null), 4000);
    return () => clearTimeout(timer);
  }, [pending]);

  if (!prompt || !sid) return null;
  const locked = pending !== null;
  const pendingPosition = pending === null || pending === DISMISS
    ? null
    : prompt.options.findIndex((o) => o.index === pending);

  return (
    <QuestionCard
      question={prompt.question ?? "Waiting for a choice"}
      header={prompt.header}
      // No `selected` here: on a TUI selector it marks the cursor row, not a
      // choice the person made.
      choices={prompt.options.map(({ label, description }) => ({ label, description }))}
      disabled={locked}
      pendingIndex={pendingPosition}
      dismissing={pending === DISMISS}
      onDismiss={async () => {
        setPending(DISMISS);
        onError(null);
        try {
          await api(`/api/sessions/${sid}/dismiss`, { method: "POST" });
        } catch (e) {
          onError(e instanceof Error ? e.message : String(e));
          setPending(null);
        }
      }}
      onPick={async (position) => {
        const option = prompt.options[position];
        if (!option) return;
        setPending(option.index);
        onError(null);
        try {
          await api(`/api/sessions/${sid}/answer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ index: option.index }),
          });
        } catch (e) {
          onError(e instanceof Error ? e.message : String(e));
          setPending(null);
        }
      }}
    />
  );
}
