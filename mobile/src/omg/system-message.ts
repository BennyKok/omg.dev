/**
 * Turns the machine wrote into the user's column.
 *
 * Several things ride on a session as ordinary `role: "user"` text without a
 * person typing them: a background task reporting home, a peer bot writing
 * in, an answered `omg_input` question, the launch prompt of a fork or a
 * continue, a bot rotation notice, a fired routine. Each arrives wrapped in a
 * marker the server or the harness chose so the MODEL can tell them apart.
 * Drawn as a sent bubble, that marker is what the person sees: `[Background
 * task ios app · 542a7801]` in their own words, on the right, in a card.
 *
 * This module is the ONE list of those shapes for the phone. `classify` says
 * what a turn is and how to introduce it; `session-preview.ts` asks the same
 * list when it decides whether a turn is fit to be a row's preview, so a new
 * wrapper is added here once and both places learn it.
 *
 * The web keeps its own copy of the preview half in
 * web/src/lib/transcript-status.ts (isMachineryPreviewText). The subagent
 * markers match src/bots/transcript.ts (isSubagentUpdateText), the rotation
 * notice matches src/bots/rotation.ts (rotationNoticeText), and the fork
 * opener matches the prompt built by `/api/sessions/:id/fork` in
 * src/commands/serve.ts. When one of those changes, change it here.
 */

export type SystemMessageKind =
  | "background-task"
  | "subagent"
  | "peer"
  | "bot-message"
  | "ask-answer"
  | "fork"
  | "rotation"
  | "routine";

export type SystemMessage = {
  kind: SystemMessageKind;
  /** The one line the transcript shows in place of the bubble. */
  label: string;
  /** Short session or question id, when the wrapper carried one. */
  id?: string;
  /** Everything after the wrapper: what the sheet shows, and what previews. */
  body: string;
};

const SHORT_ID = /\b([0-9a-f]{8})(?:-[0-9a-f-]{27})?\b/i;

function shortId(text: string): string | undefined {
  const m = text.match(SHORT_ID);
  return m ? m[1].toLowerCase() : undefined;
}

/** Text after the first line, for the wrappers that put the body on its own lines. */
function afterHeader(text: string, headerEnd: number): string {
  return text.slice(headerEnd).trim();
}

const BACKGROUND_TASK = /^\s*\[Background task ([^\]]*)\]/i;
const SUBAGENT = /^\s*\[subagent (progress|complete|blocked|failed)\]/i;
const PEER = /^\s*\[Peer message from ([^\]]*?)(?: \([^)]*\))? to [^\]]*\]/i;
const BOT_MESSAGE = /^\s*\[Message from ([^\]]+?) to bot ([^\]]+)\]/i;
const ASK_ANSWER = /^\s*\[ask-user answer ([^\]]+)\]\s*(?:Their reply:\s*)?/i;
const ROTATION = /^\s*\[This conversation continues ([^\]]*)\]/i;
const ROUTINE = /^\s*\[Scheduled routine: ([^\]]*)\]/i;
// The fork route's opener. Continue uses the same prompt (it differs only in
// archiving the source), so the label cannot say which one it was.
const FORK_OPENER = /^\s*You are starting a fresh agent session from an existing (?:lfg|omg\.dev) session\./i;
const FORK_TITLE = /^Source title:\s*(.*)$/im;
const FORK_ID = /^Source session id:\s*(\S+)$/im;
const FORK_EXTRA = /^User's extra prompt:\s*\n?/im;

const SUBAGENT_LABEL: Record<string, string> = {
  progress: "Background task reported in",
  complete: "Background task completed",
  blocked: "Background task is blocked",
  failed: "Background task failed",
};

/**
 * What a machine-written user turn is, or null for something a person typed.
 *
 * Callers pass the text AFTER the omg.dev launch envelope has been split off
 * (see omg-prompt-envelope.ts): a fork's opener sits inside `=== USER TASK ===`.
 */
export function classifySystemMessage(text: string | null | undefined): SystemMessage | null {
  const value = (text ?? "").trim();
  if (!value) return null;

  let m = value.match(BACKGROUND_TASK);
  if (m) {
    const who = m[1].trim();
    const id = shortId(who);
    const title = who.replace(/\s*·\s*[0-9a-f]{8}\s*$/i, "").trim();
    const name = title && title !== id ? title : "";
    return {
      kind: "background-task",
      label: name ? `${name} reported in` : "Background task reported in",
      id,
      body: afterHeader(value, m[0].length),
    };
  }

  m = value.match(SUBAGENT);
  if (m) {
    return {
      kind: "subagent",
      label: SUBAGENT_LABEL[m[1].toLowerCase()] ?? "Background task reported in",
      body: afterHeader(value, m[0].length),
    };
  }

  m = value.match(PEER);
  if (m) {
    return {
      kind: "peer",
      label: `Message from ${m[1].trim()}`,
      id: shortId(m[0]),
      body: afterHeader(value, m[0].length),
    };
  }

  m = value.match(BOT_MESSAGE);
  if (m) {
    return {
      kind: "bot-message",
      label: `Message from ${m[1].trim()} to ${m[2].trim()}`,
      body: afterHeader(value, m[0].length),
    };
  }

  m = value.match(ASK_ANSWER);
  if (m) {
    return {
      kind: "ask-answer",
      label: "You answered a question",
      id: shortId(m[1]) ?? m[1].trim(),
      body: afterHeader(value, m[0].length),
    };
  }

  m = value.match(ROTATION);
  if (m) {
    const why = m[1].trim();
    return {
      kind: "rotation",
      label: `Conversation continues ${why.replace(/\.\s*Earlier history[^]*$/i, "").trim()}`,
      body: afterHeader(value, m[0].length),
    };
  }

  m = value.match(ROUTINE);
  if (m) {
    return {
      kind: "routine",
      label: `Routine ${m[1].trim()} ran`,
      body: afterHeader(value, m[0].length),
    };
  }

  if (FORK_OPENER.test(value)) {
    const title = value.match(FORK_TITLE)?.[1]?.trim();
    const id = shortId(value.match(FORK_ID)?.[1] ?? "");
    const extraAt = value.search(FORK_EXTRA);
    const body = extraAt >= 0 ? value.slice(extraAt).replace(FORK_EXTRA, "").trim() : value;
    return {
      kind: "fork",
      label: title ? `Started from ${title}` : "Started from another session",
      id,
      body,
    };
  }

  return null;
}

/** Collapse a body to one run of prose for the two-line preview under the label. */
export function systemMessagePreview(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}
