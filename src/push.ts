// Web Push (PWA notifications) — VAPID auth, encrypted payload when we can.
//
// Two delivery shapes, and which one we use depends on what the subscription
// gave us:
//
//   1. Encrypted payload (RFC 8291 aes128gcm). The notice travels *inside* the
//      push, so the receiving service worker renders it straight from
//      event.data.json() without calling back to us. This is the only shape
//      that survives a split origin: when the UI is hosted elsewhere and the
//      box is self-hosted, the worker receiving the push lives on the host's
//      origin, where /api/push/pending is the host's server, not yours.
//   2. Payload-less, for subscriptions saved before we captured p256dh/auth.
//      The worker wakes and fetches the notice from /api/push/pending. Works
//      only same-origin, which is why it is now the fallback and not the plan.
//
// Either way the VAPID JWT (ES256 over P-256) is what authenticates us to the
// push service. Still zero npm dependencies; Bun's WebCrypto does all of it.
//
// Keys live in data/push/vapid.json (generated once). Browser subscriptions
// live in data/push/subscriptions.json and are pruned automatically when the
// push service reports them gone (404/410).

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { webcrypto } from "node:crypto";
import { PATHS } from "./config.ts";
import { encryptPushPayload } from "./push-encrypt.ts";
import { notifyNativeAll } from "./push-native.ts";

type JsonWebKey = webcrypto.JsonWebKey;

const dir = () => join(PATHS.data, "push");
const vapidPath = () => join(dir(), "vapid.json");
const subsPath = () => join(dir(), "subscriptions.json");

// mailto:/https: subject the push service uses to contact us about abuse.
const SUBJECT =
  process.env.LFG_VAPID_SUBJECT ||
  `mailto:${process.env.LFG_VAPID_EMAIL || "itechbenny@gmail.com"}`;

export type PushSubscription = {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
  user?: string | null;
  /**
   * Absolute origin (+ base path) the browser was on when it subscribed.
   *
   * A notification `url` is written as an app-relative path, which the service
   * worker resolves against ITS OWN scope. Same-origin that is the right
   * answer; on a hosted UI driving a self-hosted box it is the host's origin,
   * and the deep link lands wherever that path happens to point. Recording
   * where the subscription was made lets us send an absolute URL instead.
   */
  appBaseUrl?: string | null;
  // Payload-less pushes still need to identify event-specific notifications.
  // Queue those server-side per subscription; the service worker consumes one
  // after each wake through /api/push/pending. Only used for subscriptions we
  // cannot send an encrypted payload to.
  pendingNotifications?: PushNotification[];
};

export type PushNotification = {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
  /** Keep the notice on screen until acted on — used for questions. */
  requireInteraction?: boolean;
  /**
   * The project/repo this notice is about, e.g. "vibes" or "acme/payments" —
   * a label, never a question or a body of text. Web push never needed this
   * (title/body already carry the real content, delivered end-to-end
   * encrypted to a subscription only this box's VAPID key can address); it
   * exists so push-native.ts can build a native alert that names WHAT without
   * quoting the private text of the question/finding/ship post it's about.
   * See push-native.ts's file header for why that distinction matters there
   * and not here.
   */
  project?: string;
};

type VapidFile = {
  privateJwk: JsonWebKey;
  publicKeyB64Url: string;
  subject: string;
};

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Buffer.from(b)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function ensureDir() {
  await mkdir(dir(), { recursive: true });
}

// ---------- VAPID keypair (generate once, then persist) ----------

let cached: VapidFile | null = null;

async function vapid(): Promise<VapidFile> {
  if (cached) return cached;
  const f = Bun.file(vapidPath());
  if (await f.exists()) {
    cached = JSON.parse(await f.text()) as VapidFile;
    return cached;
  }
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey); // 65-byte uncompressed point
  const next: VapidFile = { privateJwk, publicKeyB64Url: b64url(raw), subject: SUBJECT };
  cached = next;
  await ensureDir();
  await Bun.write(vapidPath(), JSON.stringify(next, null, 2));
  return next;
}

/** The application server public key the browser passes to pushManager.subscribe(). */
export async function vapidPublicKey(): Promise<string> {
  return (await vapid()).publicKeyB64Url;
}

async function signJwt(aud: string): Promise<string> {
  const v = await vapid();
  const key = await crypto.subtle.importKey(
    "jwk",
    v.privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        aud,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: v.subject,
      }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  ); // raw r||s (IEEE P1363) — exactly what JWS ES256 wants
  return `${signingInput}.${b64url(sig)}`;
}

// ---------- subscription store ----------

export async function listSubscriptions(): Promise<PushSubscription[]> {
  const f = Bun.file(subsPath());
  if (!(await f.exists())) return [];
  try {
    return JSON.parse(await f.text()) as PushSubscription[];
  } catch {
    return [];
  }
}

async function writeSubscriptions(rows: PushSubscription[]): Promise<void> {
  await ensureDir();
  await Bun.write(subsPath(), JSON.stringify(rows, null, 2));
}

/** Only ever store an http(s) base url — this value ends up in a deep link. */
function safeBaseUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export async function saveSubscription(sub: PushSubscription): Promise<void> {
  if (!sub?.endpoint) return;
  const rows = await listSubscriptions();
  const existing = rows.find((r) => r.endpoint === sub.endpoint);
  const next = rows.filter((r) => r.endpoint !== sub.endpoint);
  next.push({
    endpoint: sub.endpoint,
    keys: sub.keys,
    user: sub.user ?? null,
    // A re-subscribe from a different surface (installed PWA vs hosted UI)
    // legitimately changes this, so take the new value when one is offered and
    // keep the old one when the caller is an older client that sends none.
    appBaseUrl: safeBaseUrl(sub.appBaseUrl) ?? existing?.appBaseUrl ?? null,
    pendingNotifications: existing?.pendingNotifications,
  });
  await writeSubscriptions(next);
}

export async function removeSubscription(endpoint: string): Promise<void> {
  const rows = await listSubscriptions();
  await writeSubscriptions(rows.filter((r) => r.endpoint !== endpoint));
}

/** Which user a given device (subscription endpoint) belongs to, if known. */
export async function subscriptionUser(endpoint: string): Promise<string | null> {
  const rows = await listSubscriptions();
  return rows.find((r) => r.endpoint === endpoint)?.user ?? null;
}

const MAX_PENDING_NOTIFICATIONS = 20;

/**
 * Queue an event-specific notification for the subscriptions this push targets
 * — by user, by explicit endpoint list, or both.
 */
export async function queuePushNotification(
  notification: PushNotification,
  opts: { user?: string | null; endpoints?: string[] } = {},
): Promise<void> {
  const rows = await listSubscriptions();
  const only = opts.endpoints ? new Set(opts.endpoints) : null;
  let changed = false;
  const next = rows.map((row) => {
    if (opts.user && row.user !== opts.user) return row;
    if (only && !only.has(row.endpoint)) return row;
    changed = true;
    return {
      ...row,
      pendingNotifications: [...(row.pendingNotifications ?? []), notification].slice(
        -MAX_PENDING_NOTIFICATIONS,
      ),
    };
  });
  if (changed) await writeSubscriptions(next);
}

/** Consume the oldest event-specific notification queued for one device. */
export async function takePushNotification(endpoint: string): Promise<PushNotification | null> {
  const rows = await listSubscriptions();
  const index = rows.findIndex((row) => row.endpoint === endpoint);
  const pending = index >= 0 ? rows[index].pendingNotifications ?? [] : [];
  const notification = pending[0];
  if (!notification) return null;
  const next = [...rows];
  next[index] = {
    ...next[index],
    pendingNotifications: pending.length > 1 ? pending.slice(1) : undefined,
  };
  await writeSubscriptions(next);
  return notification;
}

// ---------- sending ----------

/** Whether this subscription can receive an encrypted payload. */
export function canReceivePayload(sub: PushSubscription): boolean {
  return !!(sub.keys?.p256dh && sub.keys?.auth);
}

/**
 * Make a notification's deep link absolute against the surface the device
 * subscribed from, so a worker on another origin still opens the right app.
 * Already-absolute urls and unknown base urls pass through untouched.
 */
export function resolveNotificationUrl(
  notification: PushNotification,
  appBaseUrl?: string | null,
): PushNotification {
  if (!notification.url || !appBaseUrl) return notification;
  try {
    return { ...notification, url: new URL(notification.url, appBaseUrl).toString() };
  } catch {
    return notification;
  }
}

async function sendOne(
  sub: PushSubscription,
  notification?: PushNotification,
): Promise<{ gone: boolean }> {
  const aud = new URL(sub.endpoint).origin;
  const jwt = await signJwt(aud);
  const pub = await vapidPublicKey();
  const headers: Record<string, string> = {
    Authorization: `vapid t=${jwt}, k=${pub}`,
    TTL: "120",
    Urgency: "high",
    "Content-Length": "0",
  };
  let body: Uint8Array | undefined;

  if (notification && canReceivePayload(sub)) {
    try {
      const encrypted = await encryptPushPayload({
        p256dh: sub.keys!.p256dh!,
        auth: sub.keys!.auth!,
        payload: JSON.stringify(resolveNotificationUrl(notification, sub.appBaseUrl)),
      });
      body = encrypted.body;
      Object.assign(headers, encrypted.headers);
    } catch (e) {
      // A malformed key pair on one subscription must not silence the push:
      // fall back to the payload-less wake, which at least reaches devices on
      // the same origin as the API.
      console.warn(
        `[push] payload encryption failed, sending wake-only: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers,
    body,
  });
  // 404/410 = subscription expired/unsubscribed → caller prunes it.
  const gone = res.status === 404 || res.status === 410;
  // Anything else non-2xx is a real failure we can do nothing about here, but
  // silence makes it undebuggable: a 403 (the VAPID key no longer matches the
  // one the browser subscribed with, e.g. after data/push/vapid.json was
  // regenerated) otherwise presents as "notifications just stopped" with
  // nothing in the logs to explain it.
  if (!res.ok && !gone) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    console.warn(
      `[push] ${aud} rejected delivery: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
    );
  }
  return { gone };
}

/**
 * Fan a payload-less push out to every subscription (optionally only those
 * tagged to a given user). Prunes dead subscriptions. Never throws — push is
 * best-effort and must not block the caller (a finding write).
 *
 * Also fans the same `{ user, notification }` out to native (APNs, via
 * push-native.ts) devices. This is the ONLY integration point deliberately —
 * every caller (session-push.ts's fleet bridge, /api/ask, ship, findings,
 * client-error reports) already funnels "is this worth notifying" through a
 * call to notifyAll, so hooking in here means native gets every one of those
 * decisions for free instead of a second, divergent copy of when-to-notify
 * logic living somewhere else.
 */
export async function notifyAll(
  opts: { user?: string | null; notification?: PushNotification } = {},
): Promise<void> {
  await notifyNativeAll(opts).catch((e) => {
    console.warn(`[push] native fan-out failed: ${e instanceof Error ? e.message : String(e)}`);
  });
  let rows = await listSubscriptions();
  // Targeted notification → ONLY devices bound to that user. A device with no
  // bound user does NOT catch another user's pushes (that was the leak).
  if (opts.user) rows = rows.filter((r) => r.user === opts.user);
  if (!rows.length) return;
  if (opts.notification) {
    // Queue ONLY for devices that cannot take an encrypted payload. A device
    // that receives the notice inside the push never reads its queue, so
    // queueing for it would leave the entry to be shown — stale — behind some
    // later wake-only push.
    const legacy = rows.filter((r) => !canReceivePayload(r));
    if (legacy.length) {
      await queuePushNotification(opts.notification, { endpoints: legacy.map((r) => r.endpoint) });
    }
  }
  const dead: string[] = [];
  await Promise.all(
    rows.map(async (sub) => {
      try {
        const { gone } = await sendOne(sub, opts.notification);
        if (gone) dead.push(sub.endpoint);
      } catch (e) {
        // Transient network error to one push service — don't retry here (the
        // next notify will), but say so, otherwise a push service we can't
        // reach at all looks identical to having nothing to send.
        console.warn(`[push] delivery failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
  );
  if (dead.length) {
    const keep = (await listSubscriptions()).filter((r) => !dead.includes(r.endpoint));
    await writeSubscriptions(keep);
  }
}
