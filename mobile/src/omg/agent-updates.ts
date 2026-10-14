/**
 * "Update all agents" from the phone: start the run on the Computer, report
 * each agent's step while it runs, and end with what happened.
 *
 * The Computer owns the run. It answers the POST at once, then reports
 * `setupRunning`, `setupProgress` and, when the run ends, `setupResult` on
 * each agent in `/api/coding-agents`. The summary text is the same code the
 * web uses (packages/protocol/src/coding-agent-setup-outcome.ts).
 */
import {
  setupOutcome,
  type SetupOutcome,
  type SetupResultInfo,
  type SetupWatchAgent,
} from "../../../packages/protocol/src/coding-agent-setup-outcome";

export type AgentUpdateTransport = {
  request<T>(path: string, init?: RequestInit): Promise<T>;
};

type AgentStatusPayload = {
  key: string;
  label?: string;
  status?: {
    version?: string;
    setupRunning?: boolean;
    setupProgress?: { percent: number; label: string };
    setupResult?: SetupResultInfo;
  };
};

/** One row of the live list on the settings screen. */
export type AgentUpdateRow = {
  key: string;
  label: string;
  running: boolean;
  /** 0 to 100. Absent when the Computer does not report a step. */
  percent?: number;
  step?: string;
};

export type AgentUpdateOptions = {
  onProgress?: (rows: AgentUpdateRow[]) => void;
  /** Injected by tests. */
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  timeoutMs?: number;
};

function rowsFor(watched: SetupWatchAgent[], agents: AgentStatusPayload[]): AgentUpdateRow[] {
  return watched.map((item) => {
    const status = agents.find((agent) => agent.key === item.key)?.status;
    return {
      key: item.key,
      label: item.label,
      running: status?.setupRunning === true,
      ...(status?.setupProgress
        ? { percent: status.setupProgress.percent, step: status.setupProgress.label }
        : {}),
    };
  });
}

export async function runAgentUpdateAll(
  transport: AgentUpdateTransport,
  options: AgentUpdateOptions = {},
): Promise<SetupOutcome> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let started: { kinds?: string[]; agents?: AgentStatusPayload[] };
  try {
    started = await transport.request("/api/coding-agents/update-all", { method: "POST" });
  } catch (e) {
    // A box older than the route answers the per-agent POST's 404.
    if ((e as { status?: number })?.status === 404) {
      throw new Error("Your Computer needs a software update before it can update agents.");
    }
    throw e;
  }
  // The run has started but no installer has finished yet, so these are the
  // versions from before the update.
  const before = started.agents ?? [];
  const watched: SetupWatchAgent[] = (started.kinds ?? []).map((key) => {
    const agent = before.find((item) => item.key === key);
    return { key, label: agent?.label ?? key, fromVersion: agent?.status?.version };
  });
  options.onProgress?.(rowsFor(watched, before));

  // Bounded: an installer that hangs should not keep a spinner up forever.
  const deadline = Date.now() + (options.timeoutMs ?? 15 * 60_000);
  let latest: AgentStatusPayload[] | null = null;
  while (Date.now() < deadline) {
    await sleep(options.pollMs ?? 2000);
    const payload = await transport
      .request<{ agents?: AgentStatusPayload[] }>("/api/coding-agents")
      .catch(() => null);
    if (!payload) continue;
    latest = payload.agents ?? [];
    options.onProgress?.(rowsFor(watched, latest));
    const outcome = setupOutcome(
      watched,
      latest.map((agent) => ({
        key: agent.key,
        status: {
          setupRunning: agent.status?.setupRunning === true,
          version: agent.status?.version,
          setupResult: agent.status?.setupResult,
        },
      })),
    );
    if (!outcome) continue;
    // A Computer older than `setupResult` cannot say per agent how the run
    // ended. Its setup log still names a failure.
    const reportsResults = latest.some((agent) => agent.status?.setupResult);
    if (!reportsResults) {
      const log = await transport
        .request<{ error?: string | null }>("/api/coding-agents/setup/log")
        .catch(() => null);
      if (log?.error) {
        const error = log.error.split("\n")[0] ?? log.error;
        return { ok: false, title: "Update failed", description: error, rows: [] };
      }
    }
    return outcome;
  }
  throw new Error("Still updating on your Computer. Check back in a few minutes.");
}
