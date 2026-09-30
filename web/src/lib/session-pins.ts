export const PINNED_SESSIONS_KEY = "lfg_pinned_sessions";
export const LEGACY_MOBILE_PINNED_SESSIONS_KEY = "lfg_mobile_pinned_sessions";

export function legacyPinnedSessions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter(
          (value): value is string => typeof value === "string" && !!value,
        ),
      ),
    ];
  } catch {
    return [];
  }
}

export function readLegacyPinnedSessions(storage: Storage = localStorage): string[] {
  return [
    ...new Set([
      ...legacyPinnedSessions(storage.getItem(PINNED_SESSIONS_KEY)),
      ...legacyPinnedSessions(storage.getItem(LEGACY_MOBILE_PINNED_SESSIONS_KEY)),
    ]),
  ];
}

export function clearLegacyPinnedSessions(storage: Storage = localStorage): void {
  storage.removeItem(PINNED_SESSIONS_KEY);
  storage.removeItem(LEGACY_MOBILE_PINNED_SESSIONS_KEY);
}

export function togglePinnedSession(current: readonly string[], sessionId: string): string[] {
  return current.includes(sessionId)
    ? current.filter((id) => id !== sessionId)
    : [...current, sessionId];
}

type PinScopeSession = {
  sessionId?: string | null;
  nativeSessionId?: string | null;
  tmuxName?: string | null;
  parentSessionId?: string | null;
  parentNativeSessionId?: string | null;
};

/**
 * The session list the Chat roster shows: the project-scoped rows plus every
 * pinned family from `candidates`, whatever project it belongs to.
 *
 * A pin is a "keep this in front of me" choice, so a project filter must not
 * hide it. A pin on a delegated child lifts its whole family, the same rule
 * the roster uses to draw the Pinned group, so parent/child nesting survives.
 * `scoped` must be a subset of `candidates` in the same order; the result
 * keeps that order. Returns `scoped` itself when nothing is added, so a memo
 * that depends on it does not see a new identity on every poll.
 */
export function withPinnedFamilies<T extends PinScopeSession>(
  scoped: T[],
  candidates: readonly T[],
  pins: readonly string[],
): T[] {
  if (!pins.length) return scoped;
  const byKey = new Map<string, T>();
  for (const session of candidates) {
    if (session.sessionId) byKey.set(session.sessionId, session);
    if (session.nativeSessionId) byKey.set(session.nativeSessionId, session);
  }
  const rootOf = (session: T): T => {
    let current = session;
    const seen = new Set<T>([current]);
    for (;;) {
      const parentKey = current.parentSessionId || current.parentNativeSessionId;
      const parent = parentKey ? byKey.get(parentKey) : undefined;
      if (!parent) return current;
      // Bad data can link a family in a loop. Every member of the loop must
      // agree on one root, so pick the smallest id deterministically.
      if (seen.has(parent)) {
        return [...seen].sort((l, r) =>
          (l.sessionId ?? l.nativeSessionId ?? "").localeCompare(r.sessionId ?? r.nativeSessionId ?? ""),
        )[0]!;
      }
      seen.add(parent);
      current = parent;
    }
  };
  const pinSet = new Set(pins);
  const isPinned = (session: T) =>
    [session.sessionId, session.nativeSessionId, session.tmuxName].some(
      (key) => !!key && pinSet.has(key),
    );
  const pinnedRoots = new Set<T>();
  for (const session of candidates) {
    if (isPinned(session)) pinnedRoots.add(rootOf(session));
  }
  if (!pinnedRoots.size) return scoped;
  const inScope = new Set<T>(scoped);
  let added = false;
  const result = candidates.filter((session) => {
    if (inScope.has(session)) return true;
    if (!pinnedRoots.has(rootOf(session))) return false;
    added = true;
    return true;
  });
  return added ? result : scoped;
}
