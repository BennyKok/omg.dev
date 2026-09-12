/**
 * `#` session referencing for the composer.
 *
 * The input-field half of a session reference: detect a `#` trigger under the
 * caret, build the query URL, and produce the text to insert. Pure, so the
 * composer in App.tsx stays a thin shell. Ranking is the server's job
 * (`GET /api/sessions/mentionable`, `src/session-mentions.ts`): the same
 * folder comes first, then keyword matches, newest first.
 *
 * The inserted token carries the short session id. The grammar has a single
 * owner in `src/session-mention-token.ts`.
 */

import { formatSessionMentionToken } from "../../../src/session-mention-token.ts";

export type MentionableSession = {
  sessionId: string;
  title: string;
  cwd: string | null;
  project: string;
  lastUserText: string | null;
  lastActivityAt: number | null;
  agent: string;
  live: boolean;
  sameFolder: boolean;
};

export type SessionMentionState = {
  /** Index of the `#` itself. */
  start: number;
  /** Caret index, i.e. end of the typed query. */
  end: number;
  /** Lowercased text typed after the `#`. */
  query: string;
};

export type SessionMentionScope = {
  /** Folder of the composer's own session; its siblings rank first. */
  cwd?: string | null;
  /** The composer's own session, which is never offered to itself. */
  sessionId?: string | null;
};

/**
 * The trigger must follow start-of-text or whitespace so a colour (`#fff` is
 * glued to nothing, so it still opens; `x#1` does not) and a heading `# Title`
 * (closes at the space) behave sanely. Matching `@`, the query stops at the
 * first space.
 */
const MENTION_TRIGGER = /(^|\s)#([A-Za-z0-9._-]{0,80})$/;

export function sessionMentionAt(
  value: string,
  cursor: number | null | undefined,
): SessionMentionState | null {
  if (cursor == null) return null;
  const before = value.slice(0, cursor);
  const match = before.match(MENTION_TRIGGER);
  if (!match) return null;
  return {
    start: cursor - match[2].length - 1,
    end: cursor,
    query: match[2].toLowerCase(),
  };
}

export function sessionMentionUrl(query: string, scope: SessionMentionScope | undefined): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (scope?.cwd) params.set("cwd", scope.cwd);
  if (scope?.sessionId) params.set("exclude", scope.sessionId);
  const qs = params.toString();
  return `/api/sessions/mentionable${qs ? `?${qs}` : ""}`;
}

export function formatSessionMention(session: Pick<MentionableSession, "sessionId" | "title">): string {
  return `${formatSessionMentionToken(session.sessionId, session.title)} `;
}

/** Replace the active trigger with the reference. Returns new value and caret. */
export function applySessionMention(
  value: string,
  active: SessionMentionState,
  session: Pick<MentionableSession, "sessionId" | "title">,
): { value: string; cursor: number } {
  const replacement = formatSessionMention(session);
  return {
    value: value.slice(0, active.start) + replacement + value.slice(active.end),
    cursor: active.start + replacement.length,
  };
}

/** The worktree/checkout name, which is what tells sibling sessions apart. */
export function sessionFolderName(cwd: string | null): string {
  if (!cwd) return "";
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}
