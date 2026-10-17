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
//
// A saved copy must never break the page. It is discarded when:
// - it was written by another app version or format (a data shape change);
// - it fails the shape check below;
// - the last page that drew it crashed before its first draw completed (the
//   "drawing" marker was still set on the next load);
// - deriving the first screen from it throws (the app calls discard).

import { FRONTEND_VERSION } from "./version-diagnostics";

const PREFIX = "omg:saved-screen:v1:";
/** Set while a saved copy is being drawn; see markSavedScreenDrawn. */
const DRAWING = "#drawing";
/** Bump when the saved record or payload shape changes. */
const FORMAT = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** A copy larger than this is not kept. A typical one is about 20 KB. */
const MAX_CHARS = 256 * 1024;

type Json = Record<string, unknown>;

export interface SavedScreen {
  format: number;
  /** The app version that wrote it. Another version never reads it. */
  app: string | null;
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

const isList = (value: unknown) => value === undefined || Array.isArray(value);
const listOfRecords = (value: unknown) => isList(value) && ((value as unknown[] | undefined) ?? []).every(isRecord);

/** The shape the first screen reads. Anything else is discarded, not drawn. */
export function validSavedPayload(payload: unknown): payload is Json {
  if (!isRecord(payload)) return false;
  const auto = payload.auto;
  return (
    listOfRecords(payload.codingAgents) &&
    isList(payload.models) &&
    listOfRecords(payload.sessions) &&
    ((payload.sessions as unknown[] | undefined) ?? []).every((s) => typeof (s as Json).id === "string") &&
    (payload.sessionPins === undefined || (Array.isArray(payload.sessionPins) && payload.sessionPins.every((id) => typeof id === "string"))) &&
    listOfRecords(payload.users) &&
    listOfRecords(payload.repos) &&
    (payload.settings === undefined || payload.settings === null || isRecord(payload.settings)) &&
    (payload.viewer === undefined || payload.viewer === null || isRecord(payload.viewer)) &&
    (auto === undefined || (isRecord(auto) && listOfRecords(auto.agents)))
  );
}

/** Remove the saved screen for `key`. Never throws. */
export function discardSavedScreen(key: string): void {
  const store = storage();
  if (!store || !key) return;
  try {
    store.removeItem(PREFIX + key);
    store.removeItem(PREFIX + key + DRAWING);
  } catch {
    // Blocked storage.
  }
}

/**
 * The saved screen for `key`, or null. A copy that is too old, from another
 * app version or format, of the wrong shape, or whose last draw never
 * completed is removed and not returned. Marks the copy as being drawn; call
 * markSavedScreenDrawn once the first screen is on the page.
 */
export function readSavedScreen(key: string, now = Date.now()): SavedScreen | null {
  const store = storage();
  if (!store || !key) return null;
  try {
    const raw = store.getItem(PREFIX + key);
    if (!raw) return null;
    if (store.getItem(PREFIX + key + DRAWING)) {
      // The last page that drew this copy never finished its first draw.
      discardSavedScreen(key);
      return null;
    }
    const saved = JSON.parse(raw) as Partial<SavedScreen>;
    const usable =
      saved.format === FORMAT &&
      (saved.app ?? null) === FRONTEND_VERSION &&
      typeof saved.savedAt === "number" &&
      now - saved.savedAt <= MAX_AGE_MS &&
      saved.savedAt <= now + 60_000 &&
      validSavedPayload(saved.payload);
    if (!usable) {
      discardSavedScreen(key);
      return null;
    }
    store.setItem(PREFIX + key + DRAWING, "1");
    return { format: FORMAT, app: FRONTEND_VERSION, savedAt: saved.savedAt!, payload: saved.payload as Json };
  } catch {
    discardSavedScreen(key);
    return null;
  }
}

/** The first screen drawn from the saved copy is on the page. */
export function markSavedScreenDrawn(key: string): void {
  try {
    storage()?.removeItem(PREFIX + key + DRAWING);
  } catch {
    // Blocked storage.
  }
}

/** Keep a trimmed copy of a live bootstrap answer. Never throws. */
export function writeSavedScreen(key: string, payload: unknown, now = Date.now()): void {
  const store = storage();
  if (!store || !key) return;
  try {
    const raw = JSON.stringify({ format: FORMAT, app: FRONTEND_VERSION, savedAt: now, payload: trimBootstrapForSaving(payload) });
    if (raw.length > MAX_CHARS) {
      discardSavedScreen(key);
      return;
    }
    store.setItem(PREFIX + key, raw);
    store.removeItem(PREFIX + key + DRAWING);
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
