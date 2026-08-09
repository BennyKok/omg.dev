// Client-side Web Push enrolment. Talks to /api/push/* and the service worker
// registered in main.tsx. Payload-less: the SW fetches the finding itself, so
// here we only manage the subscription lifecycle.

import { omgFetch } from "./omg-client";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** True only where the browser can actually do Web Push (needs HTTPS + SW). */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** "granted" | "denied" | "default" | "unsupported" */
export function pushPermission(): NotificationPermission | "unsupported" {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * The service worker to subscribe through.
 *
 * NOT `navigator.serviceWorker.ready` on its own: that promise never settles
 * when no worker ever takes control of the page. Standalone lfg always
 * registers one, but an embedded surface runs inside a HOST page that may have
 * no worker at all — and there `ready` hangs forever, so the notification
 * toggle would spin silently after the permission prompt was granted. Time it
 * out and report the real reason instead.
 */
const SW_READY_TIMEOUT_MS = 5_000;

async function pushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  const existing = await navigator.serviceWorker.getRegistration().catch(() => null);
  if (existing) return existing;
  return await Promise.race([
    navigator.serviceWorker.ready.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS)),
  ]);
}

/** Whether this browser already holds a live push subscription. */
export async function isSubscribed(): Promise<boolean> {
  const reg = await pushRegistration();
  if (!reg) return false;
  return !!(await reg.pushManager.getSubscription());
}

/**
 * Ask permission, subscribe with the server's VAPID key, and register the
 * subscription with the backend. Returns true on success. Throws only on a
 * hard, surfaceable error (permission denied is returned as false).
 */
export async function enablePush(user?: string | null): Promise<boolean> {
  if (!pushSupported()) throw new Error("Push notifications aren't supported here");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const keyRes = await omgFetch("/api/push/vapid");
  if (!keyRes.ok) throw new Error("Could not load push key");
  const { key } = (await keyRes.json()) as { key: string };

  const reg = await pushRegistration();
  if (!reg) {
    throw new Error(
      "No service worker is available on this page, so notifications can't be delivered here",
    );
  }
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    });
  }

  const json = sub.toJSON() as { endpoint?: string; keys?: Record<string, string> };
  await omgFetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      // p256dh + auth are what let the server encrypt the notice INTO the push.
      // Without them delivery falls back to a wake-only push whose content the
      // worker must fetch — which only works same-origin.
      keys: json.keys,
      user: user ?? null,
      // Where this device actually runs the app, so deep links stay valid even
      // when the worker that opens them lives on a different origin.
      appBaseUrl: typeof window === "undefined" ? null : window.location.origin,
    }),
  });
  return true;
}

/** Unsubscribe locally and tell the backend to forget this endpoint. */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await omgFetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}

/**
 * Close one visible OS notification by tag — used when its subject is resolved
 * in-app (answering or dismissing a question clears its `ask-<id>` banner).
 *
 * Ask notifications are shown with `requireInteraction`, so without this they
 * sit on the lock screen forever after the question is already handled.
 */
export async function closePushNotification(tag: string): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    for (const notification of await reg.getNotifications({ tag })) notification.close();
    // The service worker derives the app badge from visible notifications, but
    // only recomputes it on push. Keep it honest from the page side too.
    const remaining = (await reg.getNotifications()).length;
    const badgeNavigator = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (remaining) await badgeNavigator.setAppBadge?.(remaining);
    else await badgeNavigator.clearAppBadge?.();
  } catch {
    // OS-surface cleanup is best-effort; the in-app state is the source of truth.
  }
}

/**
 * Acknowledge this device's visible push notifications after the person marks
 * the Notification Center read. The center keeps the durable history; this only
 * clears the transient OS surface.
 *
 * Closing the notifications matters as well as clearAppBadge(): the service
 * worker derives the next badge count from visible notifications, so leaving
 * old ones around would make the dot reappear on the next push.
 */
export async function acknowledgePushNotifications(): Promise<void> {
  if (typeof window === "undefined") return;

  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const notifications = (await reg?.getNotifications()) ?? [];
      for (const notification of notifications) notification.close();
    } catch {
      // Notification-center cleanup is independent of app badging support.
    }
  }

  const badgeNavigator = navigator as Navigator & {
    clearAppBadge?: () => Promise<void>;
  };
  try {
    await badgeNavigator.clearAppBadge?.();
  } catch {
    // Badging can be unavailable or denied independently of notifications.
  }
}
