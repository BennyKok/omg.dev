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

export function formatSessionMentionToken(sessionId: string, title: string, kind: "session" | "thread" = "session"): string {
  if (kind === "thread") return formatThreadMentionToken(sessionId, title);
  const ref = shortSessionRef(sessionId);
  const label = sanitizeSessionLabel(title) || ref;
  return `[#${label}](omg:session_${ref})`;
}

// ---- Threads ---------------------------------------------------------------
//
// A thread is referenced the same way, `[#Thread title](omg:thread_<id>)`, so
// the `#` picker can offer both. The id is the full one: a thread link is
// opened by a client, which has no prefix lookup for threads, and an agent
// passes it to the thread tools as written (they accept a prefix too).

const THREAD_ID = "[0-9a-fA-F-]{8,36}";

export function formatThreadMentionToken(threadId: string, title: string): string {
  const label = sanitizeSessionLabel(title) || threadId.slice(0, SHORT_LEN);
  return `[#${label}](omg:thread_${threadId})`;
}

/** The thread id inside an `omg:thread_` link, or null for any other href. */
export function threadRefFromHref(href: string): string | null {
  const match = href.match(new RegExp(`^omg:thread_(${THREAD_ID})$`));
  return match ? match[1] : null;
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

export type SessionIds = {
  sessionId?: string | null;
  nativeSessionId?: string | null;
  /** Shown in place of a bare id when a reference is rendered. */
  title?: string | null;
  /** Agent kind, for the icon on a rendered reference. */
  agent?: string | null;
  /** Project name, shown as a badge on a rendered reference. */
  project?: string | null;
};

/** What a rendered reference shows. Stable per ref, so React can compare it. */
export type SessionRefLabel = { title: string | null; agent: string | null; project: string | null };

/** The subset of OmgClient a reference lookup needs, so tests can fake it. */
export type SessionRefClient = {
  peekSessions(): SessionIds[] | null;
  listSessions(): Promise<SessionIds[]>;
  transport: { request<T>(path: string, init?: RequestInit): Promise<T> };
};

/**
 * The one session in `list` that `ref` names. Null when nothing or more than
 * one session matches: a guess would open the wrong transcript.
 */
export function findSessionRef(ref: string, list: SessionIds[] | null): SessionIds | null {
  const lower = ref.toLowerCase();
  const matches = new Map<string, SessionIds>();
  for (const session of list ?? []) {
    for (const candidate of [session.sessionId, session.nativeSessionId]) {
      if (candidate && candidate.toLowerCase().startsWith(lower)) {
        matches.set(session.sessionId ?? candidate, session);
      }
    }
  }
  if (matches.size !== 1) return null;
  const [[id, session]] = [...matches];
  return { ...session, sessionId: id };
}

/** Full id for a short ref within `list`, or null (see `findSessionRef`). */
export function resolveSessionRef(ref: string, list: SessionIds[] | null): string | null {
  return findSessionRef(ref, list)?.sessionId ?? null;
}

/**
 * The same ladder omg.dev's MCP layer climbs for an agent-facing short id:
 * the sessions already in hand, then the live list, then the durable
 * catalog. Each rung is skipped once a rung below has answered.
 */
export async function lookupSessionRefWith(
  client: SessionRefClient,
  ref: string,
): Promise<SessionIds | null> {
  const peeked = findSessionRef(ref, client.peekSessions());
  if (peeked) return peeked;
  const listed = await client.listSessions().catch(() => null);
  const live = findSessionRef(ref, listed);
  if (live) return live;
  const found = await client.transport
    .request<{ sessions?: SessionIds[] }>("/api/sessions/find", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: ref, limit: 5 }),
    })
    .catch(() => null);
  return findSessionRef(ref, found?.sessions ?? null);
}

export async function resolveSessionRefWith(
  client: SessionRefClient,
  ref: string,
): Promise<string | null> {
  return (await lookupSessionRefWith(client, ref))?.sessionId ?? null;
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
  lookup?: (client: SessionRefClient, ref: string) => Promise<SessionIds | null>;
}): {
  register(client: SessionRefClient | null): void;
  /** True when `href` was a session reference and has been taken over. */
  open(href: string): boolean;
  /**
   * Title and agent for `ref`, or null while unknown. The first call for a
   * ref starts one lookup; `subscribe` fires when it lands. A ref that names
   * no session stays null so the caller keeps showing the id.
   */
  label(ref: string): SessionRefLabel | null;
  subscribe(listener: () => void): () => void;
} {
  const resolve = deps.resolve ?? resolveSessionRefWith;
  const lookup = deps.lookup ?? lookupSessionRefWith;
  let current: SessionRefClient | null = null;
  let generation = 0;
  // Titles belong to the registered client: a switch clears them.
  let labels = new Map<string, SessionRefLabel | null>();
  const toLabel = (session: SessionIds | null): SessionRefLabel | null =>
    session
      ? {
          title: session.title?.trim() || null,
          agent: session.agent?.trim() || null,
          project: session.project?.trim() || null,
        }
      : null;
  const pending = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    register(client) {
      generation += 1;
      current = client;
      const hadLabels = labels.size > 0;
      labels = new Map();
      pending.clear();
      // A reader can trigger registration from inside a render. Tell
      // subscribers later, and only when titles were actually dropped.
      if (hadLabels) queueMicrotask(notify);
    },
    label(ref) {
      const key = ref.toLowerCase();
      if (labels.has(key)) return labels.get(key) ?? null;
      const client = current;
      if (!client) return null;
      const known = findSessionRef(ref, client.peekSessions());
      if (known) {
        const found = toLabel(known);
        labels.set(key, found);
        return found;
      }
      if (pending.has(key)) return null;
      pending.add(key);
      const startedAt = generation;
      Promise.resolve()
        .then(() => lookup(client, ref))
        .catch(() => null)
        .then((session) => {
          if (current !== client || generation !== startedAt) return;
          pending.delete(key);
          labels.set(key, toLabel(session));
          notify();
        });
      return null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
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

