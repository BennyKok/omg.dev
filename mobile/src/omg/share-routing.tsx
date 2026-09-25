/**
 * What a share from another app does: it starts a session.
 *
 * The Share Extension (`plugins/with-share-extension.js`) opens
 * `omg:///share?...`. `system-path.ts` stops expo-router from routing it, and
 * this hook turns it into a new session whose first message asks the agent to
 * read or watch the shared link. `share-intent.ts` owns the URL format and the
 * prompt.
 *
 * It mirrors `useAppIntentRouting`: `ready` gates the HANDLING, not the
 * listening. A share is often a cold start, so the URL arrives before there
 * is a signed-in stack. It is held and handled once `ready` turns true.
 *
 * `Linking.getInitialURL` answers with the same cold-start URL every time the
 * effect runs again. Each share carries a unique id, and a handled id is never
 * handled twice, so a re-render cannot start the same session twice.
 */
import { useCallback, useEffect, useRef } from "react";
import { Linking } from "react-native";
import { useRouter } from "expo-router";
import type { OmgClient } from "@omg-dev/client";

import { openPromptSession } from "./app-intent-routing";
import { sharedContent, sharePrompt, type SharedContent } from "./share-intent";

/** Module scope, so a remount of the root layout keeps the record. */
const handled = new Set<string>();

export function useShareRouting(ready: boolean, client: OmgClient | null, scope: string): void {
  const router = useRouter();
  const waiting = useRef<SharedContent | null>(null);

  const start = useCallback((content: SharedContent) => {
    if (handled.has(content.id)) return;
    if (!ready || !client) {
      waiting.current = content;
      return;
    }
    handled.add(content.id);
    waiting.current = null;
    openPromptSession(client, scope, sharePrompt(content), router);
  }, [ready, client, scope, router]);

  useEffect(() => {
    let active = true;
    const handle = (url: string | null | undefined) => {
      const content = sharedContent(url);
      if (active && content) start(content);
    };
    if (waiting.current) start(waiting.current);
    void Linking.getInitialURL().then(handle).catch(() => {});
    const subscription = Linking.addEventListener("url", ({ url }) => handle(url));
    return () => {
      active = false;
      subscription.remove();
    };
  }, [start]);
}
