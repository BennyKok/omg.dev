/**
 * Is the Computer actually ready to answer, and if not, why?
 *
 * `GET /api/bootstrap` is the readiness authority for the whole surface — the
 * first call the client makes after it has a grant, and the one whose failure
 * mode decides which screen a person sees. The status codes are not
 * interchangeable and collapsing them into "error" is what turns a machine that
 * is merely cold into a machine that looks broken.
 *
 * 425 in particular is not a failure. A reaped sandbox hibernates and wakes on
 * connect; the proxy answers 425 while that is in flight and the only correct
 * client behaviour is to wait and ask again. Observed live on 2026-08-12
 * against a cold cloud Computer.
 */

import type { OmgTransport } from "@omg-dev/client";

export type ComputerReadiness =
  | { status: "ready"; version?: string; sessions: unknown[] }
  /** Cold sandbox resuming. Retry — do not surface an error. */
  | { status: "waking" }
  /** Too many live agents for this plan (429) or this box's local cap. */
  | { status: "agent-limit"; message: string }
  /** The runtime behind the proxy is down (502/503/504). */
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

export async function probeReadiness(
  transport: OmgTransport,
): Promise<ComputerReadiness> {
  let response: Response;
  try {
    response = await transport.fetch("/api/bootstrap");
  } catch (error) {
    return {
      status: "unavailable",
      message: error instanceof Error ? error.message : "Couldn't reach your Computer.",
    };
  }

  const text = await response.text().catch(() => "");
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  if (response.ok) {
    return {
      status: "ready",
      version: typeof body?.version === "string" ? body.version : undefined,
      sessions: Array.isArray(body?.sessions) ? body.sessions : [],
    };
  }

  // 425 Too Early is the wake signal. 503 with the same body shape shows up on
  // some paths mid-resume, so treat an explicit "waking" error as waking
  // regardless of which of the two codes carried it.
  if (response.status === 425 || body?.error === "sandbox waking") {
    return { status: "waking" };
  }
  if (response.status === 429) {
    return { status: "agent-limit", message: body?.error ?? "Too many agents running." };
  }
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return {
      status: "unavailable",
      message: body?.error ?? "Your Computer isn't responding.",
    };
  }
  return {
    status: "error",
    message: body?.error ?? `Couldn't open your Computer (${response.status})`,
  };
}

/**
 * Wait out a wake. Bounded on purpose: a cold Firecracker resume is sub-second
 * and a cold provision is seconds, so a minute of 425s means something is wrong
 * and the person deserves to be told rather than watched a spinner forever.
 */
export async function waitForReady(
  transport: OmgTransport,
  {
    timeoutMs = 60_000,
    intervalMs = 1_500,
    onWaking,
  }: { timeoutMs?: number; intervalMs?: number; onWaking?: (attempt: number) => void } = {},
): Promise<ComputerReadiness> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  for (;;) {
    const readiness = await probeReadiness(transport);
    if (readiness.status !== "waking") return readiness;
    attempt += 1;
    onWaking?.(attempt);
    if (Date.now() + intervalMs >= deadline) return readiness;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
