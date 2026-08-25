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
