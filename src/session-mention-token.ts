/**
 * The one owner of the `#session` reference token.
 *
 * The composer writes this token and agents read it, so the grammar must not
 * exist in two places. No imports on purpose: the web bundle and the server
 * both pull it in directly, like `src/bots/mention-token.ts`.
 *
 * Shape: `[#Session title](omg:session_1234abcd)`
 *
 * The id is the 8-char short form agents already use (see
 * `SHORT_SESSION_ID_LENGTH` in `src/omg-capabilities.ts`, duplicated here
 * because this file must stay import-free). The MCP layer resolves any
 * unambiguous prefix, so an agent can pass it straight to
 * `omg_get_session_messages` or `omg_find_sessions`. A non-UUID native id is
 * kept whole, exactly as `shortSessionId` does.
 *
 * Why a markdown link: user rows are markdown-rendered, so the reader sees
 * `#title` instead of a raw id, and the `omg:` scheme is inert in a browser.
 */

const SHORT_LEN = 8;
const FULL_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SESSION_REF = "[0-9a-zA-Z._-]{6,64}";

export function shortSessionRef(sessionId: string): string {
  return FULL_UUID.test(sessionId) ? sessionId.slice(0, SHORT_LEN) : sessionId;
}

/** Global: callers that need per-match state must build their own instance. */
export function sessionMentionPattern(): RegExp {
  return new RegExp(`\\[#([^\\]\\n]{1,160})\\]\\(omg:session_(${SESSION_REF})\\)`, "g");
}

export type ParsedSessionMention = {
  /** Short id as written. Resolve it before use; never trust the label. */
  sessionRef: string;
  label: string;
};

/** Titles are free text and may contain link-ending characters. */
export function sanitizeSessionLabel(title: string): string {
  return title.replace(/[[\]()\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

export function formatSessionMentionToken(sessionId: string, title: string): string {
  const ref = shortSessionRef(sessionId);
  const label = sanitizeSessionLabel(title) || ref;
  return `[#${label}](omg:session_${ref})`;
}

/** Every reference in `text`, first-appearance order, one entry per session. */
export function parseSessionMentions(text: string): ParsedSessionMention[] {
  if (!text || !text.includes("](omg:session_")) return [];
  const seen = new Set<string>();
  const out: ParsedSessionMention[] = [];
  for (const match of text.matchAll(sessionMentionPattern())) {
    const sessionRef = match[2];
    if (seen.has(sessionRef)) continue;
    seen.add(sessionRef);
    out.push({ sessionRef, label: match[1] });
  }
  return out;
}
