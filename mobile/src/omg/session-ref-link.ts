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
 *
 * The behaviour, including the guard against a lookup that outlives a
 * machine switch, lives in `createSessionRefOpener`; this file only binds
 * it to the router.
 */
import { router } from "expo-router";

import { createSessionRefOpener } from "./session-mention";

const opener = createSessionRefOpener({
  navigate: (sessionId) => router.push(`/session/${sessionId}`),
});

/** The provider registers the live client so a plain markdown tap can look up ids. */
export const registerSessionRefResolver = opener.register;

/** True when `href` was a session reference and has been taken over. */
export const openSessionRef = opener.open;
