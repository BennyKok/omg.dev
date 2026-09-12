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
// PAYLOAD. The alert carries the real `notification.title` and `.body`,
// trimmed to what iOS shows on the lock screen, with `project` as the
// subtitle. An earlier pass sent only a generic line ("omg shipped
// something / in lfg") so Expo's relay and Apple never saw the text. Benny
// reversed that on 2026-09-11: a notification that does not say WHAT
// shipped or WHICH question is waiting is not worth the buzz. The trade is
// explicit: Expo and APNs can read the alert in transit. Web push still
// carries the same text end-to-end encrypted (push.ts); native accepts the
// relay. The text itself is agent-authored at every call site: a ship's
// `summary`, the agent's last line for a finished session, the question for
// an ask. What the agent writes there is what the phone shows.
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

// Lock-screen budget. Benny's phone showed a four-line body on 2026-09-12
// and he called it too many words. One sentence, two lines at most.
const TITLE_MAX = 60;
const BODY_MAX = 90;

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** First sentence of an agent's message, then clipped — the verdict, not the essay. */
function firstSentence(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  const m = one.match(/^.+?[.!?](?=\s|$)/);
  return m ? m[0] : one;
}

/** The alert this device receives: the real title and body, project as subtitle. */
export function alertFor(notification: PushNotification): { title: string; subtitle?: string; body?: string } {
  const body = notification.body ? clip(firstSentence(notification.body), BODY_MAX) : undefined;
  return {
    title: clip(notification.title, TITLE_MAX) || "omg",
    ...(notification.project ? { subtitle: clip(notification.project, TITLE_MAX) } : {}),
    ...(body ? { body } : {}),
  };
}

async function sendBatch(tokens: NativeToken[], notification: PushNotification): Promise<void> {
  if (!tokens.length) return;
  const alert = alertFor(notification);
  const messages = tokens.map((t) => ({
    to: t.token,
    ...alert,
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
