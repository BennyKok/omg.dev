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
// The two clients share one design: a rounded card, the question, then a flush list of full-width rows lettered A, B,
// C: no gaps, no row corners, a hairline divider between rows, running to the
// card's edges. The old wrapped pills were 28–32px tall and hard to hit on a
// phone; a row is at least 52px and carries the option's description.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { api } from "@/lib/omg-client";
import { cn } from "@/lib/utils";
import { attemptAsync, errorMessage } from "@/lib/attempt";

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
 * One question in the conversation: what the agent asked, its lettered
 * answers, and a dismiss. The composer below takes a
 * free answer, so the card has no reply box of its own.
 */
export function QuestionCard({
  question,
  choices,
  onPick,
  onDismiss,
  disabled = false,
  pendingIndex = null,
  dismissing = false,
  children,
}: {
  question: ReactNode;
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
        {/* Just the question. The agent's short header ("Ship plan") is not
            drawn: it repeats the question in fewer words. */}
        <div className="min-w-0 flex-1 text-[15px] font-medium leading-snug text-foreground">{question}</div>
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

/** Identity of one prompt: a new question or a new option list is a new prompt. */
export function promptSignature(prompt: SessionPrompt | null | undefined): string {
  return prompt ? `${prompt.question ?? ""}|${prompt.options.map((o) => o.label).join("|")}` : "";
}

/**
 * How long an answered prompt stays hidden while the server still reports it.
 * The clearing `prompt` event normally lands well inside this window; if it has
 * not, the answer did not take and the card comes back so the person can retry.
 */
export const PROMPT_RESTORE_MS = 8000;

/**
 * The harness prompt of one session (OpenCode question, Claude AskUserQuestion,
 * TUI selector), answered by option index through /api/sessions/:id/answer.
 *
 * Answering is optimistic. A tap hides the card at once and the request runs
 * behind it, because the clearing `prompt` event is a full round trip (and the
 * answer route itself lists sessions first), which read as a dead tap. Hiding
 * also removes the stale options, so a second tap cannot fire another /answer
 * that overshoots the next TUI selector — the old "answer bricks" symptom. A
 * failed request, or a prompt that is still there after PROMPT_RESTORE_MS,
 * brings the card back.
 *
 * `composerSendSeq` increments when the session composer sends a message. The
 * server treats a message sent while a question is open as its answer, so the
 * card goes the same way a tap does.
 */
export function SessionPromptPanel({
  prompt,
  sid,
  onError,
  composerSendSeq = 0,
}: {
  prompt: SessionPrompt | null;
  sid: string | null;
  onError: (error: string | null) => void;
  composerSendSeq?: number;
}) {
  "use memo";
  const sig = promptSignature(prompt);
  // The signature of the prompt answered locally and not yet cleared upstream.
  const [answeredSig, setAnsweredSig] = useState<string | null>(null);

  // Once the server clears the prompt, forget the local answer: the same
  // question asked again later is a new question.
  useLayoutEffect(() => {
    if (!sig) setAnsweredSig(null);
  }, [sig]);

  // A composer send answers whatever is open at that moment.
  const lastSendSeq = useRef(composerSendSeq);
  useLayoutEffect(() => {
    if (composerSendSeq === lastSendSeq.current) return;
    lastSendSeq.current = composerSendSeq;
    if (sig) setAnsweredSig(sig);
  }, [composerSendSeq, sig]);

  // Safety valve: the answer did not land, so show the prompt again.
  useEffect(() => {
    if (answeredSig === null || answeredSig !== sig) return;
    const timer = setTimeout(() => setAnsweredSig(null), PROMPT_RESTORE_MS);
    return () => clearTimeout(timer);
  }, [answeredSig, sig]);

  if (!prompt || !sid || answeredSig === sig) return null;

  const settle = async (path: "answer" | "dismiss", body?: unknown) => {
    const answered = sig;
    setAnsweredSig(answered);
    onError(null);
    await attemptAsync(
      () =>
        api(`/api/sessions/${sid}/${path}`, {
          method: "POST",
          ...(body === undefined
            ? {}
            : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        }),
      (e) => {
        onError(errorMessage(e));
        setAnsweredSig((current) => (current === answered ? null : current));
      },
    );
  };

  return (
    <QuestionCard
      question={prompt.question ?? "Waiting for a choice"}
      // No `selected` here: on a TUI selector it marks the cursor row, not a
      // choice the person made.
      choices={prompt.options.map(({ label, description }) => ({ label, description }))}
      onDismiss={() => void settle("dismiss")}
      onPick={(position) => {
        const option = prompt.options[position];
        if (option) void settle("answer", { index: option.index });
      }}
    />
  );
}
