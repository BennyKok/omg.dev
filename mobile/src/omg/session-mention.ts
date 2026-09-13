/**
 * The "#" session reference behind the composer popup.
 *
 * Mirrors the web (web/src/lib/session-mention.ts): the same
 * `/api/sessions/mentionable` endpoint, the same trigger grammar, the same
 * inserted token, so a reference typed on the phone reads exactly as one
 * typed in the browser and the agent needs no second contract.
 *
 * The token grammar is imported from its one owner in the protocol package
 * by path (see mobile/metro.config.js). It is never copied here.
 *
 * `createSessionMentionPicker` is the whole behaviour of the popup with no
 * React in it, so the debounce, the request sequencing and the close rules
 * can be tested without a native harness.
 */
import type { OmgClient } from "@omg-dev/client";

import {
  formatSessionMentionToken,
  sessionRefFromHref,
} from "../../../packages/protocol/src/session-mention-token";

export { sessionRefFromHref };

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

/** The "#word" under the caret, or null when the caret is not on one. */
export function sessionMentionAt(
  value: string,
  cursor: number | null | undefined,
): SessionMentionState | null {
  if (cursor == null) return null;
  const before = value.slice(0, cursor);
  const match = before.match(/(^|\s)#([A-Za-z0-9._-]{0,80})$/);
  if (!match) return null;
  return { start: cursor - match[2].length - 1, end: cursor, query: match[2].toLowerCase() };
}

export function sessionMentionPath(query: string, scope: SessionMentionScope | undefined): string {
  const parts: string[] = [];
  if (query) parts.push(`q=${encodeURIComponent(query)}`);
  if (scope?.cwd) parts.push(`cwd=${encodeURIComponent(scope.cwd)}`);
  if (scope?.sessionId) parts.push(`exclude=${encodeURIComponent(scope.sessionId)}`);
  parts.push("limit=20");
  return `/api/sessions/mentionable?${parts.join("&")}`;
}

export function fetchMentionableSessions(
  client: OmgClient,
  query: string,
  scope: SessionMentionScope | undefined,
): Promise<MentionableSession[]> {
  return client.transport
    .request<{ sessions?: MentionableSession[] }>(sessionMentionPath(query, scope))
    .then((r) => (Array.isArray(r.sessions) ? r.sessions : []));
}

/** The text after choosing `session` for the "#word" described by `active`. */
export function applySessionMention(
  value: string,
  active: SessionMentionState,
  session: Pick<MentionableSession, "sessionId" | "title">,
): string {
  const token = formatSessionMentionToken(session.sessionId, session.title);
  return `${value.slice(0, active.start)}${token} ${value.slice(active.end)}`;
}

/** The worktree/checkout name, which is what tells sibling sessions apart. */
export function sessionFolderName(cwd: string | null): string {
  if (!cwd) return "";
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

// ---- Picker controller ----------------------------------------------------

export type SessionMentionPickerState = {
  active: SessionMentionState | null;
  items: MentionableSession[];
};

export type SessionMentionPickerInput = {
  value: string;
  scope?: SessionMentionScope;
  /** Closed while the field is not editable (a live dictation take). */
  disabled?: boolean;
};

export type SessionMentionPicker = {
  update(input: SessionMentionPickerInput): void;
  getState(): SessionMentionPickerState;
  subscribe(listener: () => void): () => void;
  /**
   * Closes the picker and drops every pending request; a later `update`
   * starts again from nothing. Reversible on purpose: React StrictMode runs
   * an effect's setup, cleanup, setup in development, so a cleanup that
   * disposed for good would leave the memoised picker dead on the second
   * setup.
   */
  reset(): void;
};

const CLOSED: SessionMentionPickerState = { active: null, items: [] };

/**
 * A result is only ever shown for the request that is still current. Every
 * change of query, folder, excluded session, or visibility advances a
 * sequence number, and a response that carries an older number is dropped:
 * a slow answer for "#lo" must not land on top of the list for "#login",
 * and nothing may reopen a picker the user has already closed.
 */
export function createSessionMentionPicker(deps: {
  fetch: (query: string, scope: SessionMentionScope) => Promise<MentionableSession[]>;
  debounceMs?: number;
}): SessionMentionPicker {
  const debounceMs = deps.debounceMs ?? 140;
  const listeners = new Set<() => void>();
  let state: SessionMentionPickerState = CLOSED;
  let seq = 0;
  let key: string | null = null;
  let scopeKey: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const emit = (next: SessionMentionPickerState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const cancelPending = () => {
    seq += 1;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    update({ value, scope, disabled }) {
      const active = disabled ? null : sessionMentionAt(value, value.length);
      if (!active) {
        if (key !== null) {
          key = null;
          scopeKey = null;
          cancelPending();
          emit(CLOSED);
        }
        return;
      }
      const cwd = scope?.cwd ?? null;
      const sessionId = scope?.sessionId ?? null;
      const nextScopeKey = JSON.stringify([cwd, sessionId]);
      const nextKey = `${active.query}|${nextScopeKey}`;
      if (nextKey === key) {
        // Same request, the trigger merely moved: keep the list, refresh the
        // span it will replace.
        if (state.active?.start !== active.start || state.active?.end !== active.end) {
          emit({ active, items: state.items });
        }
        return;
      }
      // A new query keeps the previous list up so the popup does not blink on
      // every keystroke. A new folder or session is a different ranking, so
      // the old list is wrong and goes.
      const keepItems = key !== null && scopeKey === nextScopeKey;
      key = nextKey;
      scopeKey = nextScopeKey;
      cancelPending();
      emit({ active, items: keepItems ? state.items : [] });
      const mine = seq;
      const run = () => {
        timer = null;
        deps.fetch(active.query, { cwd, sessionId }).then(
          (items) => {
            if (mine === seq) emit({ active: state.active, items });
          },
          () => {
            if (mine === seq) emit({ active: state.active, items: [] });
          },
        );
      };
      if (active.query && debounceMs > 0) timer = setTimeout(run, debounceMs);
      else run();
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset() {
      key = null;
      scopeKey = null;
      cancelPending();
      if (state !== CLOSED) emit(CLOSED);
    },
  };
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

// ---- Resolving a tapped reference ----------------------------------------

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
