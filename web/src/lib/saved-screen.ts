// Saved screen: the last startup state of a Computer, drawn at once on the
// next page load while the live one loads.
//
// A hosted Computer page waited for the first /api/bootstrap before it drew
// anything: about 0.9 s on a running Computer and about 14 s on a sleeping one
// (measured 2026-10-17). The person's own threads and projects were known
// from the last visit. This keeps a trimmed copy of that answer in this
// browser, keyed by the host (account and machine), and the app draws it
// until the live answer replaces it.
//
// A saved screen is never "ready": the app does not set the runtime version
// from it, so sending stays off and the host keeps its connection rules.
//
// Stored per key under one prefix, so sign-out clears every copy at once.

const PREFIX = "omg:saved-screen:v1:";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** A copy larger than this is not kept. A typical one is about 20 KB. */
const MAX_CHARS = 256 * 1024;

type Json = Record<string, unknown>;

export interface SavedScreen {
  savedAt: number;
  /** The trimmed bootstrap answer. Same field names as /api/bootstrap. */
  payload: Json;
}

function isRecord(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function without(value: unknown, keys: readonly string[]): unknown {
  if (!isRecord(value)) return value;
  const copy: Json = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

function list(value: unknown, keys: readonly string[]): unknown[] {
  return Array.isArray(value) ? value.map((item) => without(item, keys)) : [];
}

// Message text, prompts, account identities, setup commands and findings stay
// on the Computer. The saved screen draws titles, projects and people only.
const SESSION_TEXT = ["lastUserText", "last", "transcriptPath", "tmuxTarget", "pid", "conversation", "cmd"];
const AGENT_ACCOUNT = ["profile", "accounts", "providers", "installCommand", "loginCommand", "setupResult", "setupProgress"];
const AUTO_AGENT_TEXT = ["prompt", "connectorUser"];

/** The parts of a bootstrap answer that may be kept in browser storage. */
export function trimBootstrapForSaving(payload: unknown): Json {
  const p = isRecord(payload) ? payload : {};
  const auto = isRecord(p.auto) ? p.auto : {};
  const viewer = isRecord(p.viewer) ? p.viewer : null;
  return {
    computer: p.computer ?? null,
    codingAgents: list(p.codingAgents, AGENT_ACCOUNT).map((agent) =>
      isRecord(agent) ? { ...agent, checks: [], instructions: [] } : agent,
    ),
    models: Array.isArray(p.models) ? p.models : [],
    settings: without(p.settings, ["customInstructions"]) ?? null,
    sessions: list(p.sessions, SESSION_TEXT),
    sessionPins: Array.isArray(p.sessionPins) ? p.sessionPins : [],
    viewer: viewer ? { managed: viewer.managed === true, participantId: viewer.participantId ?? null } : null,
    users: Array.isArray(p.users) ? p.users : [],
    repos: Array.isArray(p.repos) ? p.repos : [],
    auto: { tz: auto.tz, agents: list(auto.agents, AUTO_AGENT_TEXT) },
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The saved screen for `key`, or null when there is none or it is too old. */
export function readSavedScreen(key: string, now = Date.now()): SavedScreen | null {
  const store = storage();
  if (!store || !key) return null;
  try {
    const raw = store.getItem(PREFIX + key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<SavedScreen>;
    if (typeof saved.savedAt !== "number" || !isRecord(saved.payload)) return null;
    if (now - saved.savedAt > MAX_AGE_MS || saved.savedAt > now + 60_000) {
      store.removeItem(PREFIX + key);
      return null;
    }
    return { savedAt: saved.savedAt, payload: saved.payload };
  } catch {
    return null;
  }
}

/** Keep a trimmed copy of a live bootstrap answer. Never throws. */
export function writeSavedScreen(key: string, payload: unknown, now = Date.now()): void {
  const store = storage();
  if (!store || !key) return;
  try {
    const raw = JSON.stringify({ savedAt: now, payload: trimBootstrapForSaving(payload) });
    if (raw.length > MAX_CHARS) {
      store.removeItem(PREFIX + key);
      return;
    }
    store.setItem(PREFIX + key, raw);
  } catch {
    // Full or blocked storage. The next load waits for live data, as before.
  }
}

/**
 * Remove saved screens. With `keep`, only keys it rejects are removed, so a
 * host can drop every account but the signed-in one. Call with no argument
 * on sign-out.
 */
export function clearSavedScreens(keep?: (key: string) => boolean): void {
  const store = storage();
  if (!store) return;
  try {
    const remove: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const name = store.key(i);
      if (name?.startsWith(PREFIX) && !keep?.(name.slice(PREFIX.length))) remove.push(name);
    }
    for (const name of remove) store.removeItem(name);
  } catch {
    // Blocked storage holds nothing to clear.
  }
}
