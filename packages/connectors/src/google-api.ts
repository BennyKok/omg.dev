// Shared plumbing for omg's native Google connectors (Calendar, Sheets):
// authorised requests with one refresh on 401, Google's error message
// surfaced as-is, and results shaped as tool output.
import { scopeHint } from "./drive.ts";
import type { NativeCallResult, TokenSource } from "./gmail.ts";

export type Fetch = typeof fetch;

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

/** One JSON request. Refreshes the token once on 401; throws GoogleApiError on failure. */
export async function googleJson(
  token: TokenSource,
  url: string,
  init: RequestInit,
  fetchImpl: Fetch,
  service: string,
): Promise<unknown> {
  const go = async (force: boolean) =>
    fetchImpl(url, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
        Authorization: `Bearer ${await token(force)}`,
      },
    });
  let res = await go(false);
  // An access token can be revoked or expire early; refresh once and retry.
  if (res.status === 401) res = await go(true);
  const raw = await res.text();
  let body: unknown = {};
  try {
    body = raw ? (JSON.parse(raw) as unknown) : {};
  } catch {
    // A proxy or outage page is not JSON; report the status instead.
    if (res.ok) throw new GoogleApiError(`${service} returned a response that is not JSON`);
  }
  if (!res.ok) {
    const message = (body as { error?: { message?: string } }).error?.message ?? `${service} request failed (${res.status})`;
    throw new GoogleApiError(scopeHint(message), res.status);
  }
  return body;
}

export function textResult(value: unknown): NativeCallResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], isError: false };
}

export function errorResult(e: unknown): NativeCallResult {
  // A 401 after the retry means the sign-in is gone; the hub turns a throw
  // into "needs sign-in", so that one is not swallowed.
  if (e instanceof GoogleApiError && e.code === 401) throw e;
  return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
}

export function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !v.trim()) throw new GoogleApiError(`${key} is required`);
  return v.trim();
}

export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** The signed-in Google account's address, from Drive's `about` (any Drive scope reads it). */
export async function driveAboutEmail(token: TokenSource, fetchImpl: Fetch): Promise<string> {
  const about = (await googleJson(
    token,
    "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
    { method: "GET" },
    fetchImpl,
    "Drive",
  )) as { user?: { emailAddress?: string } };
  return about.user?.emailAddress ?? "";
}
