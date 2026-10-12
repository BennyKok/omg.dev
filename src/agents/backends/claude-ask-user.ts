// Claude's AskUserQuestion, answered from the omg.dev question card.
//
// The SDK harness used to disallow AskUserQuestion: under bypassPermissions the
// CLI's permission resolver still returns "ask" for it, and with no one to
// answer, the turn hung busy forever. So Claude asked in prose instead ("Do you
// want me to do X? yes or no") and no client ever saw a question.
//
// The SDK's canUseTool callback is the hook for exactly this. When Claude calls
// AskUserQuestion, this bridge puts each question on the registry `prompt`
// field — the same field OpenCode and the managed agent use, which every
// client already renders as a question card — and resolves the tool call with
// the user's choice in `updatedInput.answers`, keyed by question text, the
// shape the CLI's own permission component returns.
//
// An answer arrives three ways, all through the session command file:
//   - `answer` with an option index (the web card's tap),
//   - `send` with text while a question is open (the iOS card sends the label
//     as a message; anything typed in a composer lands here too). An exact
//     label picks that option, anything else is the user's own answer, which
//     AskUserQuestion accepts in place of the automatic "Other" choice,
//   - `dismiss`, which denies the tool so Claude continues without an answer.

import type { AisdkPrompt } from "../../aisdk-registry.ts";

type AskOption = { label?: unknown; description?: unknown };
type AskQuestion = { question?: unknown; header?: unknown; options?: unknown; multiSelect?: unknown };

/** One question of an AskUserQuestion call, read defensively from the input. */
export type ClaudeAskQuestion = {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
};

/** @internal exported for tests */
export function readAskUserQuestions(input: Record<string, unknown>): ClaudeAskQuestion[] {
  const raw = Array.isArray(input.questions) ? (input.questions as AskQuestion[]) : [];
  const out: ClaudeAskQuestion[] = [];
  for (const q of raw) {
    if (!q || typeof q.question !== "string" || !q.question.trim()) continue;
    const options = (Array.isArray(q.options) ? (q.options as AskOption[]) : [])
      .filter((o) => o && typeof o.label === "string" && o.label.trim())
      .map((o) => ({
        label: (o.label as string).trim(),
        ...(typeof o.description === "string" && o.description.trim()
          ? { description: o.description.trim() }
          : {}),
      }));
    out.push({
      question: q.question.trim(),
      ...(typeof q.header === "string" && q.header.trim() ? { header: q.header.trim() } : {}),
      options,
    });
  }
  return out;
}

/** @internal exported for tests */
export function promptForQuestion(q: ClaudeAskQuestion): AisdkPrompt {
  return {
    question: q.question,
    ...(q.header ? { header: q.header } : {}),
    options: q.options.map((o, index) => ({
      index,
      label: o.label,
      selected: false,
      ...(o.description ? { description: o.description } : {}),
    })),
  };
}

/**
 * The answer text for typed input: an exact label (case-insensitive) picks that
 * option's own label, anything else is the user's free-text answer.
 * @internal exported for tests
 */
export function answerForText(q: ClaudeAskQuestion, text: string): string {
  const typed = text.trim();
  const match = q.options.find((o) => o.label.toLowerCase() === typed.toLowerCase());
  return match ? match.label : typed;
}

type Pending = {
  question: ClaudeAskQuestion;
  resolve: (answer: string | null) => void;
};

export type ClaudeAskBridge = {
  /** True while a question waits for the user. */
  readonly waiting: boolean;
  /** Pick an option by index. Returns false when nothing is open or the index is out of range. */
  answerIndex(index: number): boolean;
  /** Use typed text as the answer. Returns false when no question is open. */
  answerText(text: string): boolean;
  /** Close the open question without an answer. */
  dismiss(): boolean;
  /**
   * Resolve one AskUserQuestion call. Returns the permission result for the
   * SDK's canUseTool: allow with the answers, or deny when dismissed/aborted.
   */
  ask(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<
    | { behavior: "allow"; updatedInput: Record<string, unknown> }
    | { behavior: "deny"; message: string }
  >;
};

export const DISMISSED_MESSAGE =
  "The user dismissed the question without answering. Do not ask it again with AskUserQuestion. Continue with your best judgement, or ask once in a normal message and end your turn.";

export function createClaudeAskBridge(hooks: {
  /** Publish (or clear, with null) the open question on the registry entry. */
  show: (prompt: AisdkPrompt | null) => void;
}): ClaudeAskBridge {
  let pending: Pending | null = null;

  const settle = (answer: string | null): boolean => {
    const current = pending;
    if (!current) return false;
    pending = null;
    hooks.show(null);
    current.resolve(answer);
    return true;
  };

  const askOne = (question: ClaudeAskQuestion, signal?: AbortSignal) =>
    new Promise<string | null>((resolve) => {
      // A second call while one is open replaces it; the old one is dropped.
      if (pending) settle(null);
      if (signal?.aborted) return resolve(null);
      pending = { question, resolve };
      hooks.show(promptForQuestion(question));
      signal?.addEventListener(
        "abort",
        () => {
          if (pending?.resolve === resolve) settle(null);
        },
        { once: true },
      );
    });

  return {
    get waiting() {
      return pending !== null;
    },
    answerIndex(index) {
      const option = pending?.question.options[index];
      if (!option) return false;
      return settle(option.label);
    },
    answerText(text) {
      if (!pending || !text.trim()) return false;
      return settle(answerForText(pending.question, text));
    },
    dismiss() {
      return settle(null);
    },
    async ask(input, signal) {
      const questions = readAskUserQuestions(input);
      if (!questions.length) {
        return { behavior: "deny", message: "AskUserQuestion needs at least one question." };
      }
      const answers: Record<string, string> = {};
      // Several questions in one call are shown one at a time, in order.
      for (const q of questions) {
        const answer = await askOne(q, signal);
        if (answer === null) return { behavior: "deny", message: DISMISSED_MESSAGE };
        answers[q.question] = answer;
      }
      return { behavior: "allow", updatedInput: { ...input, answers } };
    },
  };
}
