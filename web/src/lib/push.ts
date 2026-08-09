// Client-side Web Push enrolment. Talks to /api/push/* and manages the
// subscription lifecycle. The machine encrypts each notice into the push, so
// all that matters here is subscribing through a registration whose worker
// actually renders one.
//
// Which registration that is is NOT obvious on a hosted surface. A push
// subscription belongs to a service-worker registration, and a host page can
// easily have more than one: an app-shell or cache-drain worker at the root
// scope (no push handler at all) plus a dedicated push worker on a sub-scope
// that already holds the HOST's own subscription under the HOST's VAPID key.
// Picking the wrong one fails silently — the browser accepts the subscription
// and every notification is delivered to a worker that ignores it — so an
// embedded surface makes the host name its scope instead of guessing.

import { omgFetch } from "./omg-client";
import { isEmbedded } from "./embed";

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
 * A service-worker registration an embedding host dedicates to OMG.
 *
 * The host serves a worker that renders `event.data.json()` on a scope of its
 * own, and names it here. It must not be a scope whose registration already
 * carries the host's own push subscription: one registration holds exactly one
 * subscription, so sharing would force us either to hijack theirs (our sends
 * would then be rejected — different VAPID key) or to replace it (silently
 * killing the host's own notifications).
 */
export type HostPushConfig = {
  /** Scope of the dedicated registration, e.g. "/__omg_push/". */
  scope: string;
  /** Worker URL to register when that scope has no registration yet. */
  workerUrl?: string;
};

let hostPush: HostPushConfig | null = null;

/** Declared by the embedded surface before anything reads it. */
export function configureHostPush(config: HostPushConfig | null): void {
  hostPush = config;
}

/**
 * NOT `navigator.serviceWorker.ready` on its own: that promise never settles
 * when no worker ever takes control of the page. Standalone LFG always
 * registers one, but an embedded surface runs inside a host page that may have
 * none — and there `ready` hangs forever, so the notification toggle would spin
 * silently after the permission prompt was granted.
 */
const SW_READY_TIMEOUT_MS = 5_000;

/**
 * Dependencies are injectable so this can be tested without mutating global
 * `navigator`/`window` — doing that leaks into every other DOM test in the
 * suite depending on file order.
 */
export type PushRegistrationDeps = {
  container?: ServiceWorkerContainer;
  embedded?: boolean;
};

export async function resolvePushRegistration(
  deps: PushRegistrationDeps = {},
): Promise<ServiceWorkerRegistration | null> {
  const container =
    deps.container ??
    (typeof navigator !== "undefined" ? navigator.serviceWorker : undefined);
  if (!container) return null;
  if (!deps.container && !pushSupported()) return null;

  if (hostPush) {
    const declared = await container.getRegistration(hostPush.scope).catch(() => null);
    if (declared) return declared;
    if (!hostPush.workerUrl) return null;
    return await container
      .register(hostPush.workerUrl, { scope: hostPush.scope })
      .catch(() => null);
  }

  // Embedded with nothing declared: the registration serving this page belongs
  // to the host and there is no way to know whether its worker handles push.
  // Refuse rather than enrol into silence.
  if (deps.embedded ?? isEmbedded()) return null;

  const existing = await container.getRegistration().catch(() => null);
  if (existing) return existing;
  return await Promise.race([
    container.ready.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS)),
  ]);
}

/** Whether this browser already holds a live push subscription. */
export async function isSubscribed(): Promise<boolean> {
  const reg = await resolvePushRegistration();
  if (!reg) return false;
  return !!(await reg.pushManager.getSubscription());
}

/**
 * Whether a subscription was created with the key we are about to send under.
 *
 * A mismatch means the push service will reject every delivery with 403, which
 * surfaces as "notifications just stopped" and nothing else. It happens two
 * ways: the machine's data/push/vapid.json was regenerated, or the registration
 * belongs to another application entirely.
 */
export function subscriptionMatchesKey(
  subscription: { options?: { applicationServerKey?: ArrayBuffer | null } },
  key: Uint8Array,
): boolean {
  const existing = subscription.options?.applicationServerKey;
  if (!existing) return false;
  const bytes = new Uint8Array(existing);
  return bytes.length === key.length && bytes.every((b, i) => b === key[i]);
}

/**
 * The registration's subscription under our current VAPID key.
 *
 * A subscription created under a DIFFERENT key is dead weight: the push service
 * rejects every send with 403, which is what "notifications just stopped" looks
 * like after data/push/vapid.json was regenerated. Replace it rather than
 * re-registering it with the machine and reporting success. The registration is
 * either ours (standalone) or one the host dedicated to us, so nothing else can
 * be relying on it.
 */
export async function ensurePushSubscription(
  registration: ServiceWorkerRegistration,
  applicationServerKey: Uint8Array,
): Promise<PushSubscription> {
  const existing = await registration.pushManager.getSubscription();
  if (existing && subscriptionMatchesKey(existing, applicationServerKey)) return existing;
  if (existing) await existing.unsubscribe().catch(() => {});
  return await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey as BufferSource,
  });
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

  const reg = await resolvePushRegistration();
  if (!reg) {
    throw new Error(
      isEmbedded()
        ? "This host hasn't given OMG a service-worker scope for notifications yet"
        : "No service worker is available on this page, so notifications can't be delivered here",
    );
  }

  const sub = await ensurePushSubscription(reg, urlBase64ToUint8Array(key));

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
