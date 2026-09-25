/**
 * WHAT "OPEN THE APP" MEANS, when the thing that opened it named no
 * destination.
 *
 * The widget and the Live Activity both use `omg:///` when nothing in
 * particular is waiting on you. Left to expo-router, that got PUSHED: a video
 * from the device shows a widget tap landing on Home with a back chevron, and
 * swiping it away revealing the session that was already on screen underneath.
 * The stack was Home, session, Home -- a second copy of the root stacked over
 * the place you actually were.
 *
 * Two halves, and both are needed:
 *
 *  - `app/+native-intent.ts` returns null for that URL, which is how
 *    expo-router is told a link carries no destination. That stops the push,
 *    on a cold start and a warm one alike.
 *  - This hook then does the thing the tap actually meant: pop back to the
 *    Home that already exists. `dismissTo` is what the rest of the app uses to
 *    reach "/" (see navigateWorkspace in sessions-screen.tsx), and unlike a
 *    push it cannot produce a second one.
 *
 * Suppressing the link alone would have left you stranded in whatever session
 * you had open, which is not what tapping a fleet widget means.
 */
import { useEffect, useRef } from "react";
import { Linking } from "react-native";
import { useRouter } from "expo-router";

import { isSharePath } from "./share-intent";
import { systemPathTarget } from "./system-path";

export function useRootOpenRouting(ready: boolean): void {
  const router = useRouter();
  const pending = useRef<string | null>(null);

  useEffect(() => {
    /**
     * `ready` gates the navigation, not the listening. A cold start launched
     * by a widget tap delivers the URL before there is a signed-in Stack to
     * pop within, so the URL is held and replayed the moment there is one --
     * the same race `useNotificationTapRouting` documents.
     */
    const goHome = () => {
      try {
        router.dismissTo("/");
      } catch {
        // A stack that is already at its root, or not yet mounted. Either way
        // the destination is where we are, so there is nothing to recover.
      }
    };

    const handle = (url: string | null | undefined) => {
      // A URL WITH a destination belongs to expo-router; only the empty one is
      // ours. `systemPathTarget` is the single definition of which is which.
      if (!url || systemPathTarget(url) !== null) return;
      // A share is also dropped by expo-router, but it has a destination:
      // `share-routing.tsx` pushes its new session. Going home would race it.
      if (isSharePath(url)) return;
      if (!ready) { pending.current = url; return; }
      goHome();
    };

    if (ready && pending.current) {
      pending.current = null;
      goHome();
    }

    void Linking.getInitialURL().then(handle).catch(() => {});
    const subscription = Linking.addEventListener("url", ({ url }) => handle(url));
    return () => subscription.remove();
  }, [ready, router]);
}
