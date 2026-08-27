/**
 * iMessage sign-in: the phone texts a code to the omg line, the gateway
 * approves it, and this client polls until the session cookie lands.
 *
 * Mirrors the web client (apps/web/src/components/auth/imessage-sign-in-button.tsx)
 * against the better-auth plugin at apps/auth/src/imessage-sign-in.ts:
 *
 *   POST /api/auth/imessage-sign-in/start  -> { code, secret, expiresAt }
 *   POST /api/auth/imessage-sign-in/finish -> { status: "pending" | "complete" }
 *
 * (`approve` is gateway-only, authenticated with the server secret — never
 * called from a client.)
 *
 * Same fetch contract as auth.ts: React Native's NSURLSession/OkHttp jar
 * persists the Set-Cookie that `finish` issues, so no cookie machinery here.
 */


import { OmgAuthError } from "./auth";
import { AUTH_ORIGIN } from "./config";

const BASE = `${AUTH_ORIGIN}/api/auth/imessage-sign-in`;

/** The omg iMessage line, from apps/web/src/lib/imessage-contact.ts. */
export const IMESSAGE_SMS_NUMBER = "+12692283731";

export type ImessageChallenge = {
  /** Display code, already formatted "XXXX-XXXX" by the server. */
  code: string;
  /** 256-bit browser secret; proves this device started the challenge. */
  secret: string;
  /** ISO timestamp; the server-side challenge TTL is 10 minutes. */
  expiresAt: string;
};

export type ImessageFinishStatus = "pending" | "complete";

async function post<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new OmgAuthError("Couldn't reach omg. Check your connection.", 0);
  }
  const text = await response.text().catch(() => "");
  let data: unknown = {};
  try {
    data = text ? (JSON.parse(text) as unknown) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const message =
      (data as { message?: string; error?: string })?.message ??
      (data as { error?: string })?.error ??
      `iMessage sign-in failed (${response.status})`;
    throw new OmgAuthError(message, response.status);
  }
  return data as T;
}

/**
 * Issue a new sign-in code. Codes are IP rate limited and the server can
 * report success while silently refusing, so callers must never auto-retry
 * this — surface the error and let the person decide.
 */
export async function startImessageSignIn(): Promise<ImessageChallenge> {
  const data = await post<Partial<ImessageChallenge>>("start");
  if (
    typeof data?.code !== "string" ||
    typeof data?.secret !== "string" ||
    typeof data?.expiresAt !== "string"
  ) {
    throw new OmgAuthError("Could not start iMessage sign-in.", 500);
  }
  return data as ImessageChallenge;
}

/**
 * One poll of the challenge. "complete" means the session cookie was set on
 * this response; the caller then re-reads the session. Expired or invalid
 * challenges throw and must end the flow rather than be retried.
 */
export async function finishImessageSignIn(
  challenge: ImessageChallenge,
): Promise<ImessageFinishStatus> {
  const data = await post<{ status?: string }>("finish", {
    code: challenge.code,
    secret: challenge.secret,
  });
  return data?.status === "complete" ? "complete" : "pending";
}

/**
 * Deep link into Messages with the body pre-filled.
 *
 * Uses the `?&body=` hybrid, byte for byte what buildImessageSmsHref() in
 * apps/web/src/lib/imessage-contact.ts sends. Splitting on Platform.OS to give
 * each platform its "exact" separator looks tidier and is a worse idea: this
 * URL is handled by the OS, not by us, and the hybrid is the form that has
 * actually been shipping to real phones from the web client. Being clever here
 * buys nothing and risks a link that silently opens Messages with an empty
 * body — which looks like the feature is broken, not like a URL nit.
 */
export function buildImessageSmsUrl(body: string): string {
  return `sms:${IMESSAGE_SMS_NUMBER}?&body=${encodeURIComponent(body)}`;
}

export function imessageSignInBody(code: string): string {
  return `sign in to omg ${code}`;
}
