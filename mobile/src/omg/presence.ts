/**
 * Keeps a cloud Computer out of its inactivity pause while someone is using it.
 *
 * The control plane splits reading state from expressing lifecycle demand:
 * authorizeCloudComputerSession is documented "mint/refresh traffic never
 * provisions, wakes, or extends a Computer", and probe() already owns the WAKE
 * half of that. Presence is the KEEP-AWAKE half — a renewable lease keyed by
 * (computerId, leaseId) whose expiry is the only thing standing between an
 * active session and the disconnect grace period (45s on the base plan). The
 * web dashboard renews one on an interval; an app that sends none watches its
 * Computer pause mid-session, which is the bug this module exists to fix.
 *
 * The protocol's one sharp edge: per leaseId, eventSeq must STRICTLY increase,
 * and a renew or release whose seq is not ahead of the stored one is answered
 * { stale: true } and ignored entirely. A counter that restarts at 1 on app
 * launch is a permanent, silent failure against a live lease. So the sequence
 * is derived from the wall clock — Date.now() cannot replay an old value
 * against a lease that has seen a newer one — with a persisted + in-memory
 * ratchet layered on top, because the clock alone can be set backwards and the
 * persisted value alone depends on a write landing. Each issued seq is the max
 * of the two guards, so going backwards requires both to fail at once.
 *
 * The seq space is scoped to the lease id, which is why a wiped AsyncStorage
 * is still safe: a fresh random lease id has no server-side lease to be stale
 * against, so starting its sequence over is harmless.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { STORAGE_KEYS } from "./config";

/** The control-plane transport, injected so this module stays free of auth. */
export type PresenceRpc = <T>(name: string, body?: unknown) => Promise<T>;

type RenewResponse = { stale?: boolean; expiresAt?: unknown };

/**
 * The renewal target is half the remaining lease, from the authoritative
 * expiresAt in each response. The floor stops a garbage expiresAt (zero,
 * past, NaN) from becoming a hot loop; the ceiling stops a far-future one
 * from opening a gap the 45s disconnect grace falls into.
 */
const MIN_RENEW_MS = 10_000;
/**
 * Hard ceiling, and it MUST stay under the disconnect grace (45s on the base
 * plan) rather than merely near it.
 *
 * `expiresAt` is a ms epoch on the SERVER's clock, and the half-life above is
 * computed against `Date.now()` on the phone's. transport.ts already documents
 * that those two disagree by minutes in the field — it deliberately prefers a
 * relative grant lifetime over an absolute `exp` for exactly this reason. A
 * phone running behind the server therefore computes a remaining lease far
 * longer than the real one, and any ceiling at or above the grace turns that
 * skew into a renewal that lands after the lease has already lapsed: the
 * Computer pauses mid-session, on a timer, and only on skewed devices.
 *
 * Clamping below the grace makes the worst case a slightly chattier heartbeat
 * instead of a paused machine.
 */
const MAX_RENEW_MS = 20_000;
/** When a response carries no usable expiresAt at all. */
const FALLBACK_RENEW_MS = 20_000;

let cachedLeaseId: string | null = null;
let leaseIdPromise: Promise<string> | null = null;
let lastEventSeq: number | null = null;

function newLeaseId(): string {
  // Math.random is deliberate: expo-crypto is a native module, and an OTA
  // bundle that imports a module missing from the installed binary crashes
  // on launch. This id only has to be unique per install, not unguessable.
  return `ios-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function saveLeaseId(id: string): Promise<string> {
  cachedLeaseId = id;
  await AsyncStorage.setItem(STORAGE_KEYS.presenceLeaseId, id).catch(() => {});
  return id;
}

async function loadLeaseId(): Promise<string> {
  if (cachedLeaseId) return cachedLeaseId;
  const [savedLease, savedSeq] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEYS.presenceLeaseId),
    AsyncStorage.getItem(STORAGE_KEYS.presenceEventSeq),
  ]);
  const parsed = Number(savedSeq);
  lastEventSeq = Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 0;
  return saveLeaseId(savedLease && savedLease.length <= 128 ? savedLease : newLeaseId());
}

function leaseId(): Promise<string> {
  if (!leaseIdPromise) {
    leaseIdPromise = loadLeaseId();
    // A failed storage read must not wedge presence for the process's life.
    leaseIdPromise.catch(() => {
      leaseIdPromise = null;
    });
  }
  return leaseIdPromise;
}

/**
 * A stale answer means the server holds a newer seq for this lease id than we
 * have ever issued — the id escaped to another holder (an iCloud backup
 * restored onto a second phone is the realistic path). Minting a fresh id is
 * the clean escape: new lease, no stale history, and the old lease expires on
 * its own within one grace period.
 */
async function regenerateLeaseId(): Promise<string> {
  const id = await saveLeaseId(newLeaseId());
  leaseIdPromise = Promise.resolve(id);
  return id;
}

function nextEventSeq(): number {
  const next = Math.max((lastEventSeq ?? 0) + 1, Date.now());
  lastEventSeq = next;
  // Fire-and-forget: the in-memory ratchet covers the write window, and the
  // clock floor covers a lost write. The persisted value is the guard for a
  // clock that moves backwards across a restart.
  void AsyncStorage.setItem(STORAGE_KEYS.presenceEventSeq, String(next)).catch(() => {});
  return next;
}

/**
 * Renew immediately, then at half the remaining lease, until stop() is
 * called. stop() releases with a freshly issued seq, so it lands even against
 * a renew that is still in flight — the in-flight request carries an older
 * seq and is the one the server ignores, whichever arrives second.
 *
 * Every failure is swallowed after at most one log line per streak: presence
 * is best-effort, and a dropped heartbeat must never reach the UI.
 */
export function startCloudPresence(rpc: PresenceRpc): { stop: () => void } {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let activeLeaseId: string | null = null;
  let failureLogged = false;
  // stop() is reachable from both the effect cleanup and signOut, and both
  // fire on a sign-out; a second stop must not send a second release.
  let stopped = false;

  const schedule = (expiresAt: unknown) => {
    if (cancelled) return;
    const half =
      typeof expiresAt === "number" && Number.isFinite(expiresAt)
        ? (expiresAt - Date.now()) / 2
        : FALLBACK_RENEW_MS;
    const delay = Math.min(Math.max(half, MIN_RENEW_MS), MAX_RENEW_MS);
    timer = setTimeout(() => void tick(), delay);
  };

  const tick = async (): Promise<void> => {
    if (cancelled) return;
    let id: string;
    try {
      id = await leaseId();
    } catch {
      schedule(undefined);
      return;
    }
    if (cancelled) return;
    activeLeaseId = id;
    try {
      // "browser" is not a default: the server accepts exactly "browser" or
      // "terminal", and this app is a UI client, not a terminal.
      const res = await rpc<RenewResponse>("renewCloudComputerPresence", {
        leaseId: id,
        kind: "browser",
        eventSeq: nextEventSeq(),
      });
      if (cancelled) return;
      failureLogged = false;
      if (res?.stale) {
        activeLeaseId = await regenerateLeaseId();
      }
      schedule(res?.expiresAt);
    } catch (error) {
      if (cancelled) return;
      if (!failureLogged) {
        failureLogged = true;
        console.warn(
          "[omg] cloud presence renew failed (will retry quietly):",
          error instanceof Error ? error.message : error,
        );
      }
      schedule(undefined);
    }
  };

  void tick();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      cancelled = true;
      if (timer) clearTimeout(timer);
      // No release before the first renew has gone out: there is no
      // server-side lease to end, and the seq ratchet has not been seeded.
      if (activeLeaseId && lastEventSeq !== null) {
        void rpc("releaseCloudComputerPresence", {
          leaseId: activeLeaseId,
          eventSeq: nextEventSeq(),
        }).catch(() => {});
      }
    },
  };
}
