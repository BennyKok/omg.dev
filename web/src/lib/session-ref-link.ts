/**
 * Clicking a session reference in a rendered message.
 *
 * Two shapes reach here: a `[#Title](omg:session_<ref>)` link, and a bare
 * short id in inline code (`228efabd`), which is how agents usually cite a
 * session. Both carry a short id and the session page keys on full ids, so a
 * click resolves the prefix first. The lookup ladder and the guard against a
 * lookup that outlives a Computer switch live in `createSessionRefOpener`
 * (`@omg-dev/protocol`), shared with the native app.
 *
 * App.tsx owns navigation and the session list, so it registers both here.
 * Markdown components only call `openSessionRef`.
 */
import {
  createSessionRefOpener,
  type SessionIds,
  type SessionRefLabel,
  type SessionRefClient,
} from "@omg-dev/protocol";

import { useCallback, useSyncExternalStore } from "react";

import { api, omgTransportGeneration } from "./omg-client";

let navigateTo: ((sessionId: string) => void) | null = null;
let peek: () => SessionIds[] | null = () => null;
let registeredGeneration = -1;

const opener = createSessionRefOpener({
  navigate: (sessionId) => navigateTo?.(sessionId),
});

function clientForCurrentTransport(): SessionRefClient {
  return {
    peekSessions: () => peek(),
    listSessions: () =>
      api<{ sessions?: SessionIds[] }>("/api/sessions").then((payload) => payload.sessions ?? []),
    transport: { request: api },
  };
}

/** App.tsx registers how to open a session page and what it already knows. */
export function registerSessionRefHandlers(handlers: {
  navigate: (sessionId: string) => void;
  peekSessions: () => SessionIds[] | null;
} | null): void {
  navigateTo = handlers?.navigate ?? null;
  peek = handlers?.peekSessions ?? (() => null);
}

// A host swaps the transport in place. A new client object makes the opener
// drop any lookup and any title still tied to the previous Computer.
function ensureClient(): void {
  const generation = omgTransportGeneration();
  if (generation !== registeredGeneration) {
    registeredGeneration = generation;
    opener.register(clientForCurrentTransport());
  }
}

/** True when `href` was a session reference and has been taken over. */
export function openSessionRef(href: string): boolean {
  ensureClient();
  return opener.open(href);
}

/**
 * The title of the session `ref` names, or null until it is known. A message
 * shows it in place of the bare id.
 */
export function useSessionRefLabel(ref: string | null): SessionRefLabel | null {
  const read = useCallback(() => {
    if (!ref) return null;
    ensureClient();
    return opener.label(ref);
  }, [ref]);
  return useSyncExternalStore(opener.subscribe, read, read);
}
