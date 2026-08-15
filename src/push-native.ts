// Native push (APNs, via Expo's push relay) — the phone app's analogue of
// push.ts, called from the SAME places push.ts is (notifyAll fans out to
// both). A phone cannot do VAPID web push: there is no service worker, no
// PushManager, and no origin to hold a browser subscription. Expo's push
// service is the practical way to reach APNs without hand-rolling HTTP/2 +
// token auth to Apple directly — it takes a token minted by the installed
// app (`expo-notifications`' `getExpoPushTokenAsync`) and a JSON payload, and
// forwards it to Apple using the APNs key configured on the EAS project.
//
// Kept as its own store rather than widening PushSubscription in push.ts:
// a native token has no endpoint, no p256dh/auth keys, no appBaseUrl — every
// one of those fields would become "optional and meaningless for this row",
// which is worse for both shapes than one extra module.
//
// PAYLOAD, revised. First pass here sent `notification.title`/`.body`
// straight to Expo's relay, the same way almost every Expo app does it. That
// was wrong for this product: the payload-less-on-wake design on the web side
// is preferred there NOT because it's a fallback (it's the fallback only in
// the sense that encrypted-in-payload is available and this isn't) but
// because a browser subscription's encryption keys mean the relay literally
// cannot read the notice — nothing about this app's actual notifications
// (an agent asking whether to force-push over a release branch, a finding's
// suggested fix, a ship post's summary) was ever designed to be legible to a
// third party in transit. Native has no equivalent of that encryption without
// a Notification Service Extension — a second Xcode target, the same
// category of native-build work as the Live Activity widget extension this
// phase deliberately punts on (see mobile/docs/LIVE-ACTIVITY.md) — so instead
// of matching the web's cryptography, this matches its GUARANTEE by other
// means: the alert Expo/APNs actually carries is built from `notification.tag`
// and `notification.project` only (see `safeAlert` below), never from
// `.title`/`.body`. Those still travel to push.ts's web subscriptions (a
// browser's own encrypted channel, or same-origin same-box fetch) — this file
// just never forwards them onward to Expo. The real text is one tap away,
// fetched from the machine over the account's own authenticated transport
// once the app is open — the same shape as the web's payload-less path, just
// without a background wake driving the fetch.
//
// USER SCOPING mirrors push.ts exactly: a token is bound to a `user` string
// at register time, and a targeted send filters to tokens for that user only
// — the same rule that keeps one person's questions off another's device.
// This is now the WHOLE privacy model on native (no per-subscriber encryption
// key to fall back on), so it is covered by its own test below, same as
// push.test.ts covers it for web.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import type { PushNotification } from "./push.ts";

const dir = () => join(PATHS.data, "push");
const tokensPath = () => join(dir(), "native-tokens.json");

export type NativeToken = {
  token: string;
  user?: string | null;
  platform?: "ios" | "android" | null;
  updatedAt: number;
};

async function ensureDir() {
  await mkdir(dir(), { recursive: true });
}

export async function listNativeTokens(): Promise<NativeToken[]> {
  const f = Bun.file(tokensPath());
  if (!(await f.exists())) return [];
  try {
    return JSON.parse(await f.text()) as NativeToken[];
  } catch {
    return [];
  }
}

async function writeNativeTokens(rows: NativeToken[]): Promise<void> {
  await ensureDir();
  await Bun.write(tokensPath(), JSON.stringify(rows, null, 2));
}

/** Register / refresh a device's Expo push token. */
export async function saveNativeToken(input: {
  token: string;
  user?: string | null;
  platform?: string | null;
}): Promise<void> {
  if (!input?.token) return;
  const rows = await listNativeTokens();
  const next = rows.filter((r) => r.token !== input.token);
  next.push({
    token: input.token,
    user: input.user ?? null,
    platform: input.platform === "ios" || input.platform === "android" ? input.platform : null,
    updatedAt: Date.now(),
  });
  await writeNativeTokens(next);
}

/** Drop a token (notifications turned off / signed out on that device). */
export async function removeNativeToken(token: string): Promise<void> {
  const rows = await listNativeTokens();
  await writeNativeTokens(rows.filter((r) => r.token !== token));
}

/**
 * A web-style notification `url` ("/", "/?session=abc", "/notifications") to
 * the app-relative path the native router understands. The two apps share the
 * same route shapes (expo-router's `/session/[id]` mirrors the web's
 * `?session=` query), so this is a translation, not a second routing table.
 */
export function toNativeAppUrl(url?: string | null): string {
  if (!url) return "/";
  try {
    const parsed = new URL(url, "https://omg.invalid");
    const session = parsed.searchParams.get("session");
    if (session) return `/session/${encodeURIComponent(session)}`;
    return parsed.pathname || "/";
  } catch {
    return "/";
  }
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Expo's push API accepts up to 100 messages per request.
const BATCH_SIZE = 100;

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

type ExpoTicket = { status: "ok" | "error"; message?: string; details?: { error?: string } };

/**
 * Every call site's `tag` follows a `<kind>-<id>` convention (see push.ts's
 * callers: `ask-`, `session-`, `shipped-`, `finding-`). Reading the kind back
 * out of it means this needs no change when a new call site is added with the
 * same convention, and no second enum kept in sync with push.ts by hand.
 */
function alertTitleFor(tag?: string | null): string {
  if (tag?.startsWith("ask-")) return "omg needs your input";
  if (tag?.startsWith("session-")) return "omg finished a session";
  if (tag?.startsWith("shipped-")) return "omg shipped something";
  if (tag?.startsWith("finding-")) return "omg found something";
  return "omg";
}

/**
 * The alert this device actually receives — see the file header for why this
 * is built from `tag`/`project` and never from `notification.title`/`.body`.
 */
function safeAlert(notification: PushNotification): { title: string; body?: string } {
  return {
    title: alertTitleFor(notification.tag),
    body: notification.project ? `in ${notification.project}` : undefined,
  };
}

async function sendBatch(tokens: NativeToken[], notification: PushNotification): Promise<void> {
  if (!tokens.length) return;
  const alert = safeAlert(notification);
  const messages = tokens.map((t) => ({
    to: t.token,
    title: alert.title,
    body: alert.body,
    sound: "default",
    // requireInteraction has no APNs equivalent; "time-sensitive" is the
    // closest analogue (breaks through Focus/Do Not Disturb) and needs no
    // extra client-side entitlement beyond what expo-notifications already
    // declares.
    ...(notification.requireInteraction ? { priority: "high", interruptionLevel: "time-sensitive" } : {}),
    data: { url: toNativeAppUrl(notification.url), tag: notification.tag ?? null },
  }));

  let res: Response;
  try {
    res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
    });
  } catch (e) {
    console.warn(`[push-native] delivery request failed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    console.warn(`[push-native] Expo push relay rejected the batch: ${res.status}${detail ? ` — ${detail}` : ""}`);
    return;
  }

  const body = (await res.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
  const tickets = body?.data ?? [];
  const dead: string[] = [];
  tickets.forEach((ticket, i) => {
    if (ticket?.status !== "error") return;
    const token = tokens[i]?.token;
    const code = ticket.details?.error;
    console.warn(`[push-native] ${token ?? "?"} rejected: ${code ?? ticket.message ?? "unknown error"}`);
    // DeviceNotRegistered = uninstalled or unpaired; the others (e.g.
    // MessageTooBig, MessageRateExceeded) are not the token's fault.
    if (code === "DeviceNotRegistered" && token) dead.push(token);
  });
  if (dead.length) {
    const keep = (await listNativeTokens()).filter((r) => !dead.includes(r.token));
    await writeNativeTokens(keep);
  }
}

/**
 * Fan a notification out to native devices (optionally scoped to one user).
 * Same contract as push.ts's notifyAll: best-effort, never throws — a push
 * failure must not block whatever just wrote the finding/question/ship post.
 * A no-op with no APNs key configured on EAS: Expo's relay itself reports the
 * per-ticket error and this just logs it, exactly like an unreachable push
 * service does for web.
 */
export async function notifyNativeAll(
  opts: { user?: string | null; notification?: PushNotification } = {},
): Promise<void> {
  // Nothing to show without a title — there is no payload-less wake path here
  // (see file header), so a wake-only notify() call is simply a no-op on native.
  if (!opts.notification?.title) return;
  let rows = await listNativeTokens();
  if (opts.user) rows = rows.filter((r) => r.user === opts.user);
  if (!rows.length) return;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    await sendBatch(batch, opts.notification).catch((e) => {
      console.warn(`[push-native] batch failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
}
