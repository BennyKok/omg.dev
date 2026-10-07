/**
 * Meta (Facebook) app events: the ONE place the app reports conversions to
 * Meta, so ad campaigns can measure installs, sign-ups and paid plans.
 *
 * Measurement only. There is no Facebook Login and no user id is sent.
 *
 * ── Off unless the build was configured ───────────────────────────────────
 *
 * app.config.js adds the Meta plugin, and `extra.meta.enabled`, only when EAS
 * provides META_APP_ID and META_CLIENT_TOKEN. Every other build (local, Mac,
 * e2e, an older binary running a newer OTA bundle) has no App ID, and every
 * call below is a silent no-op there. The native-module check covers the OTA
 * case: a bundle can say "enabled" on a binary that predates the SDK.
 *
 * ── Each conversion counts once ───────────────────────────────────────────
 *
 * Sign-in re-runs on every launch, and StoreKit replays transactions. A
 * campaign optimised on a doubled purchase spends against a lie, so every
 * event carries a key and a key is sent at most once per install.
 *
 * Purchases are logged HERE, not by the SDK's automatic in-app purchase
 * logging. Leave "Log in-app purchases automatically" OFF in the Meta app
 * dashboard, or each purchase is counted twice.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { isNewAccount } from "./onboarding-gate";

export const META_EVENTS = {
  registration: "fb_mobile_complete_registration",
  purchase: "fb_mobile_purchase",
  firstTask: "first_run_task_started",
} as const;

/** What actually talks to Meta. Swapped out by the native check. */
export type MetaSink = {
  logEvent(name: string, params: Record<string, string | number>): void;
  logPurchase(amount: number, currency: string, params: Record<string, string | number>): void;
  requestTracking(): Promise<void>;
};

/** What remembers which keys were sent. AsyncStorage in the app. */
export type MetaMemory = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

const SENT_PREFIX = "omg.meta.sent.";

function configured(): boolean {
  // Required here, not at the top: onboarding-launch.ts imports this module,
  // and pure modules must not pull react-native into their checks.
  const { NativeModules, Platform } = require("react-native") as typeof import("react-native");
  if (Platform.OS !== "ios") return false;
  const Constants = (require("expo-constants") as typeof import("expo-constants")).default;
  const extra = Constants.expoConfig?.extra as { meta?: { enabled?: boolean } } | undefined;
  return extra?.meta?.enabled === true && NativeModules.FBAppEventsLogger != null;
}

/** Resolves once the app is in the foreground and active. */
function untilActive(): Promise<void> {
  const { AppState } = require("react-native") as typeof import("react-native");
  if (AppState.currentState === "active") return Promise.resolve();
  return new Promise((resolve) => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      sub.remove();
      resolve();
    });
  });
}

function nativeSink(): MetaSink {
  // Required lazily so a build without the SDK never touches its module.
  const { AppEventsLogger } = require("react-native-fbsdk-next") as typeof import("react-native-fbsdk-next");
  return {
    logEvent: (name, params) => AppEventsLogger.logEvent(name, params),
    logPurchase: (amount, currency, params) => AppEventsLogger.logPurchase(amount, currency, params),
    requestTracking: async () => {
      const tracking = require("expo-tracking-transparency") as typeof import("expo-tracking-transparency");
      const current = await tracking.getTrackingPermissionsAsync();
      // iOS shows the prompt once. Asking again after an answer is a no-op,
      // but the check keeps the intent readable.
      if (current.status !== "undetermined") return;
      // iOS drops the request, with no prompt and no error, when the app is
      // not active. Sign-in restores at launch, often before that. A prompt
      // that never appears is the usual App Review rejection for tracking
      // ("we were unable to locate the App Tracking Transparency request").
      await untilActive();
      await tracking.requestTrackingPermissionsAsync();
    },
  };
}

let sink: MetaSink | null | undefined;
let memory: MetaMemory = AsyncStorage;

function activeSink(): MetaSink | null {
  if (sink === undefined) {
    try {
      sink = configured() ? nativeSink() : null;
    } catch {
      // Measurement never breaks the caller. No platform means no Meta.
      sink = null;
    }
  }
  return sink;
}

/** Test seam. `null` turns Meta off; `undefined` restores the real check. */
export function setMetaTarget(next: MetaSink | null | undefined, store?: MetaMemory): void {
  sink = next;
  if (store) memory = store;
}

/** Run `send` once for `key`, ever, on this install. Never throws. */
async function once(key: string, send: (target: MetaSink) => void): Promise<boolean> {
  const target = activeSink();
  if (!target) return false;
  try {
    const storageKey = SENT_PREFIX + key;
    if (await memory.getItem(storageKey)) return false;
    // Mark before sending: a crash between the two loses one event, which is
    // the cheaper error than counting one twice.
    await memory.setItem(storageKey, String(Date.now()));
    send(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * A session answered with a user. Called on every launch and every sign-in.
 *
 * Asks for tracking permission here, after sign-in and never on first launch,
 * and reports a sign-up when the account is new.
 */
export async function noteSignedIn(user: { id: string; createdAt?: string }): Promise<void> {
  const target = activeSink();
  if (!target) return;
  try {
    await target.requestTracking();
  } catch {
    // A refused or failed prompt only makes the data coarser.
  }
  if (isNewAccount(user.createdAt) !== true) return;
  await once(`registration.${user.id}`, (t) => t.logEvent(META_EVENTS.registration, {}));
}

/** The transaction id StoreKit gave this purchase, when it is readable. */
function transactionIdOf(raw: unknown, fallback: string): string {
  const record = (raw ?? {}) as Record<string, unknown>;
  for (const key of ["transactionId", "id", "originalTransactionIdentifierIOS"]) {
    const value = record[key];
    if ((typeof value === "string" && value) || typeof value === "number") return String(value);
  }
  return fallback;
}

/**
 * Apple charged for a plan. Call only for a NEW purchase, never for a restore:
 * a restore is not revenue.
 *
 * `price` and `currency` are StoreKit's own numbers for this storefront. A
 * product without them is still counted, at zero, rather than dropped.
 */
export async function notePurchase(input: {
  productId: string;
  signedTransaction: string;
  raw: unknown;
  price?: number;
  currency?: string;
}): Promise<void> {
  const id = transactionIdOf(input.raw, input.signedTransaction.slice(-48));
  const amount = typeof input.price === "number" && Number.isFinite(input.price) ? input.price : 0;
  const currency = input.currency || "USD";
  await once(`purchase.${id}`, (t) =>
    t.logPurchase(amount, currency, {
      fb_content_id: input.productId,
      fb_content_type: "subscription",
      fb_order_id: id,
    }),
  );
}

/** The new user's first task started on their Computer. */
export async function noteFirstTaskStarted(): Promise<void> {
  await once("first-task", (t) => t.logEvent(META_EVENTS.firstTask, {}));
}
