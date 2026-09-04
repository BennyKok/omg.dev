/**
 * Connect a Claude or ChatGPT (Codex) account from the phone.
 *
 * Same server, same three calls the web dashboard makes
 * (apps/web/src/App.tsx + lib/ai-oauth.ts in vibes), over plain HTTP:
 *
 *   POST /api/aiOAuth/exchangeCode          Claude: pasted code + PKCE verifier
 *   POST /api/aiOAuth/startCodexDeviceAuth  Codex: get a user code
 *   POST /api/aiOAuth/pollCodexDeviceAuth   Codex: wait for approval
 *
 * The control plane exchanges the code, encrypts the token, and pushes it to
 * infra, which is what makes the Computer's agents "Connected". The token
 * never touches the phone. What the phone does hold, briefly, is the PKCE
 * verifier for the Claude flow, in memory only, for the length of one attempt.
 *
 * Claude has no device flow, so it is the pi-style manual one: open the
 * authorize page in Safari, the person copies the code Anthropic shows them,
 * and pastes it here. The authorize URL is built exactly as the web builds it,
 * including `state = verifier`, which Anthropic echoes back after the `#` in
 * the code so the paste can be checked against the attempt that started it.
 */

import * as Crypto from "expo-crypto";

import { getAuthToken } from "./auth";
import { CONTROLPLANE_ORIGIN } from "./config";

export class ConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectError";
  }
}

async function controlPlane<T>(path: string, body: unknown): Promise<T> {
  const token = await getAuthToken();
  if (!token) throw new ConnectError("Please sign in again.");
  let response: Response;
  try {
    response = await fetch(`${CONTROLPLANE_ORIGIN}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ConnectError("Couldn't reach omg. Check your connection.");
  }
  const text = await response.text().catch(() => "");
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const message = (data as { message?: string; error?: string })?.message ?? (data as { error?: string })?.error;
    throw new ConnectError(message ?? `Request failed (${response.status})`);
  }
  return data as T;
}

/* ── Claude ─────────────────────────────────────────────────────────────── */

// Copied from the web's ai-oauth.ts. The client id is Claude Code's public
// OAuth client; it is not a secret and the web ships it the same way.
const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const ANTHROPIC_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const ANTHROPIC_SCOPE =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export type ClaudeConnectAttempt = {
  authorizationUrl: string;
  verifier: string;
  state: string;
  redirectUri: string;
};

/** Build one attempt: a fresh PKCE pair and the URL to open. */
export async function startClaudeConnect(): Promise<ClaudeConnectAttempt> {
  const verifier = base64url(await Crypto.getRandomBytesAsync(32));
  const challengeB64 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  const challenge = challengeB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const state = verifier;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: ANTHROPIC_CLIENT_ID,
    redirect_uri: ANTHROPIC_REDIRECT_URI,
    scope: ANTHROPIC_SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    code: "true",
  });
  return {
    authorizationUrl: `${ANTHROPIC_AUTHORIZE_URL}?${params.toString()}`,
    verifier,
    state,
    redirectUri: ANTHROPIC_REDIRECT_URI,
  };
}

/**
 * Accept what people actually paste: a raw code, `code#state`, a full callback
 * URL, or a bare query string. Ported from the web's parseManualOAuthCodeInput.
 */
export function parseClaudeCode(input: string, expectedState: string): string {
  const raw = input.trim();
  if (!raw) throw new ConnectError("Paste the code from Claude first.");
  let code = "";
  let state: string | null = null;
  if (raw.includes("://")) {
    const url = new URL(raw);
    code = url.searchParams.get("code") ?? "";
    state = url.searchParams.get("state");
  } else if (raw.includes("#")) {
    const [rawCode, rawState] = raw.split("#", 2);
    code = rawCode?.trim() ?? "";
    state = rawState?.trim() || null;
  } else if (raw.includes("code=")) {
    const params = new URLSearchParams(raw);
    code = params.get("code") ?? "";
    state = params.get("state");
  } else {
    code = raw;
  }
  if (!code) throw new ConnectError("Could not find a code in what you pasted.");
  if (state && state !== expectedState) {
    throw new ConnectError("That code is from a different attempt. Open Claude again and paste the new code.");
  }
  return code;
}

export async function finishClaudeConnect(attempt: ClaudeConnectAttempt, pasted: string): Promise<void> {
  const code = parseClaudeCode(pasted, attempt.state);
  const result = await controlPlane<{ ok: boolean; error?: string }>("/api/aiOAuth/exchangeCode", {
    provider: "anthropic",
    code,
    verifier: attempt.verifier,
    redirectUri: attempt.redirectUri,
  });
  if (!result.ok) {
    // Anthropic's own wording is a JSON blob ("invalid_grant"). Say what to do.
    const raw = result.error ?? "";
    throw new ConnectError(
      /invalid_grant|Invalid 'code'/i.test(raw)
        ? "Claude did not accept that code. Open Claude again and paste the new code."
        : raw || "Could not connect Claude.",
    );
  }
}

/* ── Codex ──────────────────────────────────────────────────────────────── */

export type CodexDeviceAuth = {
  deviceAuthId: string;
  userCode: string;
  verificationUrl: string;
  intervalMs: number;
};

export async function startCodexConnect(): Promise<CodexDeviceAuth> {
  const result = await controlPlane<
    | { ok: true; deviceAuthId: string; userCode: string; verificationUrl: string; intervalMs: number }
    | { ok: false; error: string }
  >("/api/aiOAuth/startCodexDeviceAuth", {});
  if (!result.ok) throw new ConnectError(result.error);
  return {
    deviceAuthId: result.deviceAuthId,
    userCode: result.userCode,
    verificationUrl: result.verificationUrl,
    intervalMs: Math.max(2000, result.intervalMs || 5000),
  };
}

/** One poll. "pending" until the person approves in the browser. */
export async function pollCodexConnect(
  auth: CodexDeviceAuth,
): Promise<"pending" | "connected"> {
  const result = await controlPlane<
    { status: "pending" } | { status: "connected" } | { status: "error"; error: string }
  >("/api/aiOAuth/pollCodexDeviceAuth", { deviceAuthId: auth.deviceAuthId, userCode: auth.userCode });
  if (result.status === "error") throw new ConnectError(result.error);
  return result.status;
}
