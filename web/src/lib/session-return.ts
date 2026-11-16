/**
 * The way back after following a linked session.
 *
 * A report, a fork opener or a peer message names another session, and its
 * card opens that session in place. The person then wants to return to the
 * conversation they were reading. This keeps the one jump (from, to) so the
 * destination transcript can offer "Back to <from>".
 *
 * One entry only. A new jump replaces it, going back clears it, and it never
 * outlives the page: it is a reading aid, not navigation history.
 */
import { useSyncExternalStore } from "react";

import { pathnameToSessionId } from "./app-search";
import { openSessionId, openSessionRef } from "./session-ref-link";

type Jump = { from: string; to: string };

let jump: Jump | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function sameSession(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
}

/** Record a jump from `from` to the session `to` names (a short or full id). */
export function rememberJump(from: string | null, to: string): void {
  jump = from && !sameSession(from, to) ? { from, to } : null;
  emit();
}

export function clearJump(): void {
  if (!jump) return;
  jump = null;
  emit();
}

/**
 * Open the session `ref` names from a card, and remember where the person was
 * so the destination can lead back. `from` defaults to the session in the URL.
 */
export function openLinkedSession(ref: string, from?: string | null): void {
  const origin =
    from ?? (typeof window === "undefined" ? null : pathnameToSessionId(window.location.pathname));
  rememberJump(origin, ref);
  void openSessionRef(`omg:session_${ref}`);
}

/** The session to go back to while `sid` is the one a card just opened. */
export function returnTargetFor(sid: string | null | undefined): string | null {
  if (!sid || !jump) return null;
  return sameSession(sid, jump.to) ? jump.from : null;
}

export function useReturnTarget(sid: string | null | undefined): string | null {
  const read = () => returnTargetFor(sid);
  return useSyncExternalStore(subscribe, read, read);
}

/** Go back to `from` and forget the jump. */
export function goBackTo(from: string): void {
  clearJump();
  openSessionId(from);
}
