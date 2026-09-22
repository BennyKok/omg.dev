/**
 * Turns the machine wrote into the user's column.
 *
 * Several things ride on a session as ordinary `role: "user"` text without a
 * person typing them: a background task reporting home, a peer bot writing
 * in, an answered `omg_input` question, the launch prompt of a fork or a
 * continue, a bot rotation notice, a fired routine. Drawn as a sent bubble,
 * the marker is what the person sees.
 *
 * Keep this list in lockstep with mobile/src/omg/system-message.ts. The phone
 * owns the shapes; this copy is how the web transcript draws the same events.
 * test/system-message-parity.test.ts fails if they disagree.
 */

import { parseOmgPromptEnvelope } from "./omg-prompt-envelope";

export type SystemMessageKind =
  | "background-task"
  | "subagent"
  | "peer"
  | "bot-message"
  | "ask-answer"
  | "browser-login"
  | "fork"
  | "rotation"
  | "routine";

export type SystemMessage = {
  kind: SystemMessageKind;
  /** The one line the transcript shows in place of the bubble. */
  label: string;
  /** Short session or question id, when the wrapper carried one. */
  id?: string;
  /** Everything after the wrapper: what the expanded body shows. */
  body: string;
};

const SHORT_ID = /\b([0-9a-f]{8})(?:-[0-9a-f-]{27})?\b/i;

function shortId(text: string): string | undefined {
  const m = text.match(SHORT_ID);
  return m ? m[1].toLowerCase() : undefined;
}

/** Hostname of the site a browser-login notice names, when it names one. */
function loginHost(body: string): string | undefined {
  const m = body.match(BROWSER_LOGIN_ORIGIN);
  if (!m) return undefined;
  try {
    return new URL(m[1]).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function afterHeader(text: string, headerEnd: number): string {
  return text.slice(headerEnd).trim();
}

const BACKGROUND_TASK = /^\s*\[Background task ([^\]]*)\]/i;
const SUBAGENT = /^\s*\[subagent (progress|complete|blocked|failed)\]/i;
const PEER = /^\s*\[Peer message from ([^\]]*?)(?: \([^)]*\))? to [^\]]*\]/i;
const BOT_MESSAGE = /^\s*\[Message from ([^\]]+?) to bot ([^\]]+)\]/i;
const ASK_ANSWER = /^\s*\[ask-user answer ([^\]]+)\]\s*(?:Their reply:\s*)?/i;
// The steer message src/commands/serve.ts sends when the phone finished a
// login transfer. It is written for the MODEL (it carries the "verify the page
// before you trust these cookies" instruction), so the person gets the one
// fact they care about: which site is now signed in.
const BROWSER_LOGIN = /^\s*\[Browser login ([^\]]+)\]\s*/i;
const BROWSER_LOGIN_ORIGIN = /\bfor (https?:\/\/[^\s,]+)/i;
const ROTATION = /^\s*\[This conversation continues ([^\]]*)\]/i;
const ROUTINE = /^\s*\[Scheduled routine: ([^\]]*)\]/i;
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
 * Callers pass the text AFTER the omg.dev launch envelope has been split off.
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

  m = value.match(BROWSER_LOGIN);
  if (m) {
    const body = afterHeader(value, m[0].length);
    const host = loginHost(body);
    return {
      kind: "browser-login",
      label: host ? `Signed in to ${host}` : "Login transferred",
      id: shortId(m[1]),
      body,
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

/**
 * Whether the body is worth showing under the label.
 *
 * Most wrappers carry something a person wrote or an agent reported, and two
 * lines of it is the point of the row. A browser-login notice carries
 * instructions to the MODEL — verify the page, imported cookies alone do not
 * prove authentication — so previewing it puts the sentence the label exists
 * to replace straight back on screen. The sheet still holds all of it.
 */
export function systemMessageHasPreview(system: SystemMessage): boolean {
  return system.kind !== "browser-login";
}

/** Collapse a body to one run of prose for the two-line preview under the label. */
export function systemMessagePreview(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

/**
 * Classify a raw user-turn string, splitting the launch envelope first so a
 * fork's opener (inside USER TASK) is recognised the same way the phone does.
 */
export function classifyUserTurn(text: string | null | undefined): SystemMessage | null {
  const value = text ?? "";
  const envelope = parseOmgPromptEnvelope(value);
  return classifySystemMessage(envelope?.task ?? value);
}
