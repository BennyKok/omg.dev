/**
 * The one owner of the `#session` reference token.
 *
 * The composers write this token and agents read it, so the grammar must not
 * exist in two places. It lives in the protocol package because every
 * surface can reach it from here: the server and web through
 * `@omg-dev/protocol`, and the native app through a direct path into this
 * source tree (`mobile/metro.config.js` adds it to Metro's watch folders),
 * because `mobile/` consumes the published package and cannot wait for a
 * release to pick up a grammar change. No imports on purpose.
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

/** The short ref inside an `omg:session_` link, or null for any other href. */
export function sessionRefFromHref(href: string): string | null {
  const match = href.match(new RegExp(`^omg:session_(${SESSION_REF})$`));
  return match ? match[1] : null;
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

/**
 * Agents quote a session as a bare short id in inline code (`228efabd`),
 * because that is the form every omg.dev tool returns. The `omg:session_`
 * href for such a span, or null when the text is not a session id. Only the
 * exact 8-hex short form or a full UUID qualifies: anything looser would
 * turn ordinary code into links. A span that looks right but names no
 * session (an 8-char git sha) resolves to nothing, so the tap does nothing.
 */
export function sessionHrefFromCodespan(text: string): string | null {
  const t = text.trim();
  if (/^[0-9a-f]{8}$/i.test(t)) return `omg:session_${t}`;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
    return `omg:session_${t}`;
  }
  return null;
}

// ---- Opening a reference -------------------------------------------------
//
// The resolver lives here, next to the grammar, so the native app and the
// web UI climb the same ladder. It stays import-free: the client is typed
// structurally.

export type SessionIds = { sessionId?: string | null; nativeSessionId?: string | null };

/** The subset of OmgClient a reference lookup needs, so tests can fake it. */
export type SessionRefClient = {
  peekSessions(): SessionIds[] | null;
  listSessions(): Promise<SessionIds[]>;
  transport: { request<T>(path: string, init?: RequestInit): Promise<T> };
};

/**
 * Full id for a short ref within `list`. Null when nothing or more than one
 * session matches: a guess would open the wrong transcript.
 */
export function resolveSessionRef(ref: string, list: SessionIds[] | null): string | null {
  const lower = ref.toLowerCase();
  const matches = new Set<string>();
  for (const session of list ?? []) {
    for (const candidate of [session.sessionId, session.nativeSessionId]) {
      if (candidate && candidate.toLowerCase().startsWith(lower)) {
        matches.add(session.sessionId ?? candidate);
      }
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
}

/**
 * The same ladder omg.dev's MCP layer climbs for an agent-facing short id:
 * the sessions already in hand, then the live list, then the durable
 * catalog. Each rung is skipped once a rung below has answered.
 */
export async function resolveSessionRefWith(
  client: SessionRefClient,
  ref: string,
): Promise<string | null> {
  const peeked = resolveSessionRef(ref, client.peekSessions());
  if (peeked) return peeked;
  const listed = await client.listSessions().catch(() => null);
  const live = resolveSessionRef(ref, listed);
  if (live) return live;
  const found = await client.transport
    .request<{ sessions?: SessionIds[] }>("/api/sessions/find", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: ref, limit: 5 }),
    })
    .catch(() => null);
  return resolveSessionRef(ref, found?.sessions ?? null);
}

/**
 * The tap handler for a rendered reference, with the router injected.
 *
 * The lookup is asynchronous and the app can switch machine or sign out
 * while it runs. An answer is only acted on when the client it came from is
 * still the registered one: a session id from the previous box must never
 * be pushed onto the new one. Every failure is swallowed here, because a
 * markdown tap has nowhere to report and an unhandled rejection is worse
 * than a tap that does nothing.
 */
export function createSessionRefOpener(deps: {
  navigate: (sessionId: string) => void;
  resolve?: (client: SessionRefClient, ref: string) => Promise<string | null>;
}): {
  register(client: SessionRefClient | null): void;
  /** True when `href` was a session reference and has been taken over. */
  open(href: string): boolean;
} {
  const resolve = deps.resolve ?? resolveSessionRefWith;
  let current: SessionRefClient | null = null;
  let generation = 0;
  return {
    register(client) {
      generation += 1;
      current = client;
    },
    open(href) {
      const ref = sessionRefFromHref(href);
      if (!ref) return false;
      const client = current;
      if (!client) return true;
      const startedAt = generation;
      Promise.resolve()
        .then(() => resolve(client, ref))
        .then((full) => {
          if (full && current === client && generation === startedAt) deps.navigate(full);
        })
        .catch(() => {});
      return true;
    },
  };
}

