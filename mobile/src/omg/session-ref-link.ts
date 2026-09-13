/**
 * Tapping a `[#Title](omg:session_<ref>)` reference in a transcript.
 *
 * The ref is the 8-char short id and the session screen keys on full ids,
 * so the tap resolves the prefix through the client before it navigates the
 * way every other surface opens a session (`router.push("/session/<id>")`).
 * `omg:` is also this app's own URL scheme, so the href must never reach
 * `Linking.openURL`: it would re-enter the app as a deep link it cannot
 * route. Ordinary links are not this module's concern and pass straight
 * through.
 */
import { router } from "expo-router";

import { resolveSessionRefWith, sessionRefFromHref, type SessionRefClient } from "./session-mention";

let current: SessionRefClient | null = null;

/** The provider registers the live client so a plain markdown tap can look up ids. */
export function registerSessionRefResolver(client: SessionRefClient | null): void {
  current = client;
}

/** True when `href` was a session reference and has been taken over. */
export function openSessionRef(href: string): boolean {
  const ref = sessionRefFromHref(href);
  if (!ref) return false;
  const client = current;
  if (!client) return true;
  void resolveSessionRefWith(client, ref).then((full) => {
    if (full) router.push(`/session/${full}`);
  });
  return true;
}
