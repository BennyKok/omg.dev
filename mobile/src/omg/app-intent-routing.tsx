/**
 * What a Siri or Shortcuts invocation does to the stack.
 *
 * `app-intents/StartOmgSessionIntent.swift` opens the app and dispatches
 * `startSession` with the spoken task. This hook is the JavaScript half.
 *
 * It mirrors `useRootOpenRouting`: `ready` gates the HANDLING, not the
 * listening. An intent is the common cold start for this app -- the phone was
 * locked, the phrase launched it -- so the invocation arrives long before
 * there is a signed-in stack to push onto. expo-app-intents persists every
 * invocation until it is removed, so an unhandled one simply waits, and the
 * effect re-reads the queue the moment `ready` turns true.
 *
 * Delivery is at-least-once per the library, so handling is keyed on the
 * invocation id and each id is removed as soon as it is turned into a route.
 * Without that a relaunch could start the same session twice.
 */
import { useCallback, useEffect, useRef } from "react";
import { useRouter, type Href } from "expo-router";
import * as AppIntents from "expo-app-intents";
import type { AppIntentInvocation } from "expo-app-intents";
import type { OmgClient } from "@omg-dev/client";

import { startPendingSession } from "./pending-session";

/**
 * Start a session with the server's default agent and open its chat at once.
 * Shared by the Siri intent and by a share from another app
 * (`share-routing.tsx`), so both take the composer's creation path.
 *
 * Neither carries a folder, so the session goes to "Chats without a
 * project", the same endpoint the composer uses when that chip is selected.
 * Plain `/api/sessions/new` would let the server pick a repository.
 */
export function openPromptSession(
  client: OmgClient,
  scope: string,
  prompt: string,
  router: ReturnType<typeof useRouter>,
): void {
  const pending = startPendingSession(scope, prompt, () =>
    client.transport.request<{ sessionId?: string }>("/api/sessions/new-unassigned", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    }));
  router.push(`/session/new?request=${pending.token}` as Href);
}

/** The invocation name dispatched by StartOmgSessionIntent.perform(). */
const START_SESSION = "startSession";

export function useAppIntentRouting(
  ready: boolean,
  client: OmgClient | null,
  scope: string,
): void {
  const router = useRouter();
  /**
   * Ids already turned into a route. `removePendingInvocationAsync` is the
   * durable record, but it is a round trip: two deliveries of the same id can
   * both arrive before the first removal lands, and this closes that window.
   */
  const handled = useRef(new Set<string>());

  const start = useCallback((invocation: AppIntentInvocation) => {
    if (handled.current.has(invocation.id)) return;
    const prompt = typeof invocation.params.prompt === "string" ? invocation.params.prompt.trim() : "";
    if (!prompt || !client) return;
    handled.current.add(invocation.id);
    void AppIntents.removePendingInvocationAsync(invocation.id).catch(() => {});
    /**
     * The same owner the composer's Start uses. Creation outlives this hook
     * and navigation does not wait on the POST, so the chat opens at once with
     * the spoken prompt as its first row.
     *
     * The agent and model are left to the server. An intent has no access to
     * the picker state on the home screen. It carries no folder, so the chat
     * is created without a project.
     */
    openPromptSession(client, scope, prompt, router);
  }, [client, scope, router]);

  useEffect(() => {
    if (!ready || !client) return;
    let active = true;
    // The queue holds anything that arrived while the app was closed or
    // signed out. Read it once on becoming ready, then follow live ones.
    void AppIntents.getPendingInvocationsAsync()
      .then((pending) => {
        if (!active) return;
        for (const invocation of pending) {
          if (invocation.name === START_SESSION) start(invocation);
        }
      })
      .catch(() => {});
    const subscription = AppIntents.addAppIntentListener((invocation) => {
      if (invocation.name === START_SESSION) start(invocation);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [ready, client, start]);
}
