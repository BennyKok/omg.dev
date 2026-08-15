/**
 * Native push notifications (APNs, reached through Expo's push relay).
 *
 * The web app's Web Push stack (see the machine's src/push.ts) doesn't apply
 * here: there is no service worker, no PushManager, no browser origin to hold
 * a subscription against. `expo-notifications` is the native equivalent —
 * it mints an Expo push token, the machine hands that token to Expo's push
 * API, and Expo forwards it to APNs using the project's own APNs key.
 *
 * WHEN THIS ASKS FOR PERMISSION: never on its own, and never at first launch.
 * `registerForPushNotifications` is inert until something calls it — wired to
 * the "Notifications" toggle in Settings, an explicit action taken after the
 * person has already seen the app do something. Asking at first launch (the
 * thing this file deliberately does NOT do) is the single biggest reason
 * people permanently deny a permission prompt: they have no context yet for
 * what they'd be saying yes to, and iOS does not let you ask again once
 * denied — only Settings.app can undo that. A first-run prompt trades a
 * one-time possible "yes" for a permanent, unrecoverable "no" from anyone who
 * was startled by it. Settings is also where the equivalent Web Push toggle
 * already lives on the dashboard, so this keeps the mental model identical
 * across surfaces rather than inventing a second place to turn it on.
 *
 * WHAT THIS DOES NOT DO: run in the background to fetch anything. The web
 * design's payload-less path relies on a service worker calling back to
 * /api/push/pending on every wake; there is no native equivalent of that
 * without a Notification Service Extension (a second Xcode target — the same
 * category of native-build work the Live Activity widget needs, and just as
 * out of scope for this phase). So the machine sends the real title/body
 * straight to Expo, and this file's job ends at registering the token and
 * routing a tap. See push-native.ts on the machine for the fuller rationale.
 *
 * DEGRADES HONESTLY: no EAS project id, no physical device (simulators have
 * no APNs identity), permission denied, or the machine unreachable all fail
 * into `registerForPushNotifications` returning a reason instead of throwing
 * — the caller decides what to show, and the app is exactly as usable as
 * before someone tapped the toggle.
 */

import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import type { OmgTransport } from "@omg-dev/client";

import { STORAGE_KEYS } from "./config";

// A push that arrives while the app is already open still deserves a banner
// and a badge bump — the default handler shows nothing, which reads as
// "notifications are broken" the first time someone tests the toggle they
// just turned on.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

export type PushPermissionStatus = "granted" | "denied" | "undetermined" | "unavailable";

/** Current permission state, without prompting — safe to call on every Settings mount. */
export async function pushPermissionStatus(): Promise<PushPermissionStatus> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return "unavailable";
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) return "granted";
  if (settings.status === "denied") return "denied";
  return "undetermined";
}

/** The token this device last registered with the machine, if any. */
export async function getStoredPushToken(): Promise<string | null> {
  return AsyncStorage.getItem(STORAGE_KEYS.nativePushToken);
}

export type PushRegistrationOutcome =
  /** Permission granted, token minted, machine has it. */
  | "registered"
  /** The person said no. Nothing else attempted. */
  | "denied"
  /** Not a case this can serve: wrong platform, no EAS project id, or (by
   *  far the most common cause locally) a simulator, which has no APNs
   *  identity to mint a token against. */
  | "unavailable"
  /** Permission was fine but minting the token or reaching the machine
   *  failed — worth retrying, unlike the other outcomes. */
  | "error";

/**
 * Ask for permission if it hasn't been decided yet, mint an Expo push token,
 * and register it with the machine bound to `user` (the same identity space
 * as web's `assignedUser` — an email, or null for "every device on this
 * box"). Call this from an explicit user action; see the file header for why.
 */
export async function registerForPushNotifications(
  transport: OmgTransport,
  user?: string | null,
): Promise<PushRegistrationOutcome> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return "unavailable";

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted && existing.status !== "denied") {
    const requested = await Notifications.requestPermissionsAsync();
    granted = requested.granted;
  }
  if (!granted) return "denied";

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return "unavailable";

  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    token = result.data;
  } catch {
    // The overwhelmingly common cause here is the iOS Simulator: it has no
    // APNs identity, so this rejects every time, on every account. A real
    // device is the only thing that can prove this branch is otherwise fine.
    return "unavailable";
  }

  try {
    await transport.request("/api/push/native/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, user: user ?? null, platform: Platform.OS }),
    });
  } catch {
    return "error";
  }

  await AsyncStorage.setItem(STORAGE_KEYS.nativePushToken, token);
  return "registered";
}

/** Turn notifications off: forget the token locally and tell the machine to drop it. */
export async function unregisterForPushNotifications(transport: OmgTransport): Promise<void> {
  const token = await getStoredPushToken();
  await AsyncStorage.removeItem(STORAGE_KEYS.nativePushToken);
  if (!token) return;
  await transport
    .request("/api/push/native/unregister", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
    .catch(() => {
      // Best-effort: the machine may be unreachable right now. The token is
      // already gone from this device's own record either way, and a stale
      // server-side row just means one more silently-dropped push later, not
      // a leak to anyone else — see push-native.ts's user-scoping.
    });
}

/**
 * Wire notification taps to in-app navigation. Mount ONCE, near the root —
 * this app's `_layout.tsx` is on the do-not-touch list for this change, so it
 * is not wired in here. The exact diff to apply there ships alongside this
 * file; the shape is: import `useNotificationTapRouting` and call it inside
 * `RootNavigator`, unconditionally (rules of hooks) near its existing
 * `const { authStatus } = useOmg()`, passing `authStatus === "signed-in"`.
 *
 * `ready` gates the actual navigation, not the hook call: a cold start that
 * launches straight from a notification tap delivers the tap before
 * `RootNavigator` has anything signed-in to show — `authStatus` is "loading"
 * for the first frames, and the branch above the signed-in Stack renders
 * `<Splash/>` with no Stack mounted at all yet. Pushing into a route nothing
 * is listening for yet is exactly the kind of race only a device proves either
 * way, so this waits for the caller to say the Stack is actually up rather
 * than assuming expo-router queues navigation correctly against an unmounted
 * tree. The response itself isn't lost by waiting: `useLastNotificationResponse`
 * holds onto it until `clearLastNotificationResponse` is called (never, here),
 * so the effect below re-runs and fires as soon as `ready` flips true.
 *
 * The machine sends `data.url` as an app-relative path it already resolved
 * from a web-style notification url (see push-native.ts's toNativeAppUrl) —
 * e.g. "/session/<id>" or "/notifications" — so this only ever pushes a path
 * this app's own router already understands, the same routes `omg://` deep
 * links resolve to.
 */
export function useNotificationTapRouting(ready: boolean): void {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();
  // useLastNotificationResponse re-delivers the SAME response object across
  // renders until a new one arrives, so without this a re-render (theme
  // change, auth refresh, anything) would re-fire the navigation.
  const handledId = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !response) return;
    const id = response.notification.request.identifier;
    if (handledId.current === id) return;
    handledId.current = id;
    const url = response.notification.request.content.data?.url;
    if (typeof url === "string" && url.startsWith("/")) {
      router.push(url);
    }
  }, [ready, response, router]);
}
