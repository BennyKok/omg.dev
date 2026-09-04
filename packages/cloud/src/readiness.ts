/**
 * Is the Computer actually ready to answer, and if not, why?
 *
 * `GET /api/bootstrap` is the readiness authority for the whole surface. The
 * status codes are not interchangeable and collapsing them into "error" is
 * what turns a machine that is merely cold into a machine that looks broken.
 *
 * 425 in particular is not a failure. A reaped sandbox hibernates and wakes on
 * connect; the proxy answers 425 while that is in flight and the only correct
 * client behaviour is to wait and ask again.
 */

import type { OmgTransport } from "@omg-dev/client";

import { ComputerGrantError } from "./grant";

export type BootstrapRoster = {
  agents: {
    key: string;
    label: string;
    visible?: boolean;
    status?: { configured?: boolean; accountConnected?: boolean };
  }[];
  repos: { name: string; cwd: string }[];
};

export type ComputerReadiness =
  /** The roster rides along: one fetch, one owner, no second source of truth. */
  | { status: "ready"; version?: string; sessions: unknown[]; roster: BootstrapRoster }
  /** Asked and not yet heard. Not "waking": that is something the machine says. */
  | { status: "connecting" }
  /** Cold sandbox resuming, the proxy said 425. Retry, do not show an error. */
  | { status: "waking" }
  /** Too many live agents for this plan (429) or this box's local cap. */
  | { status: "agent-limit"; message: string }
  /** The runtime behind the proxy is down (502/503/504). */
  | { status: "unavailable"; message: string }
  /** The mint 403'd. Needs a different machine, not a retry loop. */
  | { status: "unauthorized"; message: string }
  | { status: "error"; message: string };

export async function probeReadiness(transport: OmgTransport): Promise<ComputerReadiness> {
  let response: Response;
  try {
    response = await transport.fetch("/api/bootstrap");
  } catch (error) {
    if (error instanceof ComputerGrantError && error.forbidden) {
      return { status: "unauthorized", message: error.message };
    }
    return {
      status: "unavailable",
      message: error instanceof Error ? error.message : "Couldn't reach your Computer.",
    };
  }

  const text = await response.text().catch(() => "");
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  const errorText = typeof body.error === "string" ? body.error : undefined;

  if (response.ok) {
    return {
      status: "ready",
      version: typeof body.version === "string" ? body.version : undefined,
      sessions: Array.isArray(body.sessions) ? body.sessions : [],
      roster: {
        // `codingAgents` is the launchable roster. `agents` on the same body
        // is AUTO agents, a different feature with a similar name.
        agents: Array.isArray(body.codingAgents)
          ? (body.codingAgents as BootstrapRoster["agents"])
          : [],
        repos: Array.isArray(body.repos) ? (body.repos as BootstrapRoster["repos"]) : [],
      },
    };
  }
  if (response.status === 425 || errorText === "sandbox waking") return { status: "waking" };
  if (response.status === 429) {
    return { status: "agent-limit", message: errorText ?? "Too many agents running." };
  }
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return { status: "unavailable", message: errorText ?? "Your Computer isn't responding." };
  }
  return {
    status: "error",
    message: errorText ?? `Couldn't open your Computer (${response.status})`,
  };
}

/**
 * Wait out a wake. Bounded on purpose: a cold resume is sub-second and a cold
 * provision is seconds, so a minute of 425s means something is wrong.
 */
export async function waitForReady(
  transport: OmgTransport,
  {
    timeoutMs = 60_000,
    intervalMs = 1_500,
    onWaking,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  }: {
    timeoutMs?: number;
    intervalMs?: number;
    onWaking?: (attempt: number) => void;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<ComputerReadiness> {
  const deadline = now() + timeoutMs;
  let attempt = 0;
  for (;;) {
    const readiness = await probeReadiness(transport);
    if (readiness.status !== "waking") return readiness;
    attempt += 1;
    onWaking?.(attempt);
    if (now() + intervalMs >= deadline) return readiness;
    await sleep(intervalMs);
  }
}
