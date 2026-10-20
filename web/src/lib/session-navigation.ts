import { useEffect, useRef } from "react";
import type { AnyRouter } from "@tanstack/react-router";
import { pathnameToSessionId, readLocationSessionId } from "./app-search";

export function embeddedSessionPath(sessionId?: string | null): string {
  const search = new URLSearchParams({ embed: "true" });
  if (sessionId) search.set("session", sessionId);
  return `/?${search.toString()}`;
}

/** Follow new host requests through the existing deep-link resolver. Keep the
 * router alive so navigation does not reset drafts, streams or loaded data. */
export function useHostSessionNavigation(router: AnyRouter, sessionId?: string | null) {
  const requested = sessionId || null;
  const previous = useRef(requested);
  useEffect(() => {
    if (previous.current === requested) return;
    previous.current = requested;
    const location = router.state.location;
    // A host can echo an in-app navigation. Do not open that session again.
    if (requested && (pathnameToSessionId(location.pathname) === requested ||
      location.search.session === requested)) return;
    void router.navigate({
      to: "/",
      search: { embed: true, ...(requested ? { session: requested } : {}) },
      replace: true,
    });
  }, [router, requested]);
}

/** A link is consumed once. A later URL request replaces it, while ordinary
 * data refreshes must never steal focus back to an already consumed link. */
export function usePendingSessionLink(sessionId: string | undefined) {
  const previous = useRef(sessionId);
  const pending = useRef<string | null>(sessionId ?? readLocationSessionId());
  if (previous.current !== sessionId) {
    previous.current = sessionId;
    pending.current = sessionId ?? null;
  }
  return pending;
}
