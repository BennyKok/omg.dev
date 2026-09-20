// The launch prompt for "continue from this session", and the only reader of
// it.
//
// `POST /api/sessions/:id/continue` writes this envelope, so the first user
// message of a continued session is the envelope, not what the person wanted.
// Automatic titles read the first user message, which is how a session about
// a rename bug ended up titled "Review auto-rename feature status" — the title
// of the TEMPLATE, not of the work.
//
// Builder and parser therefore live together. When the wording changes, the
// parser changes with it in the same file, instead of silently failing to
// match and quietly degrading every title on continued sessions.

/** Used when the caller continues a session without saying what to do next. */
export const CONTINUE_PROMPT_DEFAULT_EXTRA =
  "Review the source transcript and continue with the most useful next step.";

const OPENING_LINE = "You are starting a fresh agent session from an existing lfg session.";
const EXTRA_HEADING = "User's extra prompt:";

export type ContinuePromptFields = {
  sourceId: string;
  /** Title of the session being continued. Best available label, never empty. */
  title: string;
  cwd: string;
  /** Absolute path of the source transcript JSONL. */
  transcript: string;
  /** What the human typed, if anything. */
  extra?: string | null | undefined;
};

/** Compose the launch prompt for a continued session. */
export function buildContinueSessionPrompt(fields: ContinuePromptFields): string {
  return [
    OPENING_LINE,
    "",
    "This is NOT a resume. Treat the source transcript as read-only context, then follow the user's extra prompt below.",
    "",
    `Source session id: ${fields.sourceId}`,
    `Source title: ${fields.title}`,
    `Source cwd: ${fields.cwd}`,
    `Source transcript JSONL: ${fields.transcript}`,
    "",
    "Read the transcript file directly before acting.",
    "",
    EXTRA_HEADING,
    fields.extra?.trim() || CONTINUE_PROMPT_DEFAULT_EXTRA,
  ].join("\n");
}

export type ParsedContinuePrompt = {
  /** Title of the source session, as recorded in the envelope. */
  sourceTitle: string | null;
  /** What the human typed, or null when they accepted the default. */
  extra: string | null;
};

/**
 * Read a continue envelope back, or return null when `text` is not one.
 *
 * The default extra prompt comes back as `null` rather than as its own text.
 * It describes the mechanism ("review the transcript and continue"), so using
 * it as title material produces a title about continuing rather than about the
 * work. A caller that gets `{ sourceTitle, extra: null }` should fall back to
 * the source title, which at least names the thread.
 */
export function parseContinueSessionPrompt(text: string): ParsedContinuePrompt | null {
  if (!text.includes(OPENING_LINE)) return null;
  const headingAt = text.indexOf(EXTRA_HEADING);
  const extraRaw = headingAt === -1 ? "" : text.slice(headingAt + EXTRA_HEADING.length).trim();
  const titleMatch = /^Source title: (.*)$/m.exec(text);
  return {
    sourceTitle: titleMatch?.[1]?.trim() || null,
    extra: !extraRaw || extraRaw === CONTINUE_PROMPT_DEFAULT_EXTRA ? null : extraRaw,
  };
}

/**
 * The part of a launch prompt worth titling.
 *
 * A continued session yields the human's own instruction, falling back to the
 * source title. Anything else is returned unchanged.
 */
export function unwrapContinueSessionPrompt(text: string): string {
  const parsed = parseContinueSessionPrompt(text);
  if (!parsed) return text;
  return parsed.extra ?? parsed.sourceTitle ?? "";
}
