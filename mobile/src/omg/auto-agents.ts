/**
 * Auto agents — the ones that run on a timer instead of because you asked.
 *
 * An auto agent is JUST a prompt plus a cron schedule (see src/auto/store.ts).
 * It is NOT a session: it has no transcript, nothing to resume, and nothing to
 * archive. What it produces is a FINDING — one notification, at most, per run,
 * carrying its reasoning and a lifecycle. That distinction is the whole reason
 * these get their own section on the home screen rather than being folded into
 * Working/Idle, where tapping a row opens a transcript and swiping one
 * archives a session; both of those would be lies here.
 *
 * WHAT THE HOME SCREEN IS FOR, AND WHY THIS LIST IS FILTERED.
 *
 * This box has 34 auto agents. Rendering all of them would put ~2000pt of
 * configuration under the three sections that show live work, which is the
 * opposite of what the screen is for — and it is not what the web does either:
 * the web keeps the full roster on a MANAGEMENT page (/settings/computer/auto,
 * titled "Schedules") and surfaces findings on the live view. The phone has no
 * management page, so the home section shows the agents that have something to
 * say right now — an open finding, or a run in progress — and index.tsx says
 * out loud how many quiet ones were left out. See selectHomeAutoAgents.
 *
 * Both reads degrade to nothing rather than to an error, the same way
 * resumable.ts does: an older machine has no /api/auto/* at all, and someone
 * who opened this screen to see what is running should not be told about it.
 * They degrade INDEPENDENTLY, too — a machine that can list agents but not
 * findings still owes you the running ones.
 */

import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import { useOmg } from "./provider";
import { DEFAULT_SCHED_TZ } from "./cron";

/** Mirrors AutoAgent in src/auto/store.ts, plus what withAutoAgentMeta adds. */
export type AutoAgent = {
  id: string;
  name: string;
  /** Truncated server-side (`promptTruncated`). Not shown on a row; see the card. */
  prompt?: string;
  /** 5-field cron, evaluated by the machine in the payload's `tz`. */
  schedule: string;
  enabled: boolean;
  cwd?: string;
  /** Backend key — "grok", "codex-aisdk", …; absent on old rows means Claude. */
  agent?: string;
  model?: string;
  lastRunAt?: number;
  /** Computed server-side: worktree cwds collapse to the owning repo. */
  project?: string;
  /** Computed server-side: a scheduled run is in flight right now. */
  running?: boolean;
};

export type AutoFindingSeverity = "high" | "med" | "low";

/** Mirrors Finding in src/auto/store.ts. */
export type AutoFinding = {
  id: string;
  agentId: string;
  title: string;
  reasoning?: string[];
  suggest?: string;
  severity?: AutoFindingSeverity;
  createdAt?: number;
  /** How many times this has been independently reported. 1 on first sight. */
  occurrences?: number;
  lastSeenAt?: number;
};

export type AutoAgentsState = {
  agents: AutoAgent[];
  /** Open findings only — the ones still owed an answer. */
  findings: AutoFinding[];
  /** The MACHINE's schedule timezone, not the phone's. See cron.ts. */
  tz: string;
  loading: boolean;
  refresh: () => void;
};

/**
 * 30s. The rows make LIVE claims — "running", "next in 56m" — so this cannot
 * be resumable.ts's fetch-once, which would leave an agent advertising a run
 * that finished ten minutes ago and a countdown that never counts. It is
 * slower than the session list's 10s on purpose: cron granularity is a whole
 * minute, so nothing here can change faster than that, and this pulls the
 * entire roster plus every open finding rather than a delta.
 *
 * Re-fetching is also what keeps the relative labels honest — the card derives
 * "next in …" at render time, so a poll that re-renders is the clock. See
 * auto-agent-card.tsx.
 */
const AUTO_POLL_MS = 30_000;

export function useAutoAgents(): AutoAgentsState {
  const { client, bindingId } = useOmg();
  const [agents, setAgents] = useState<AutoAgent[]>([]);
  const [findings, setFindings] = useState<AutoFinding[]>([]);
  const [tz, setTz] = useState<string>(DEFAULT_SCHED_TZ);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // A machine switch invalidates both lists outright: auto agents belong to
  // the box they run on, and showing the previous machine's schedules would
  // describe a fleet this one has never heard of. Same reasoning as
  // resumable.ts.
  useEffect(() => {
    setAgents([]);
    setFindings([]);
  }, [bindingId]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setLoading(true);

    // Two independent requests, NOT Promise.all: a rejection there would throw
    // away a good response alongside the bad one, and the two endpoints can
    // fail apart (findings is newer than agents).
    const agentsRead = client.transport
      .request<{ agents?: AutoAgent[]; tz?: string }>("/api/auto/agents")
      .then((payload) => {
        if (cancelled) return;
        setAgents(payload.agents ?? []);
        if (payload.tz) setTz(payload.tz);
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      });

    const findingsRead = client.transport
      .request<{ findings?: AutoFinding[] }>("/api/auto/findings?status=open")
      .then((payload) => {
        if (!cancelled) setFindings(payload.findings ?? []);
      })
      .catch(() => {
        if (!cancelled) setFindings([]);
      });

    void Promise.all([agentsRead, findingsRead]).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [client, tick]);

  // Only while the screen is focused, matching the session list: a
  // backgrounded app has no business talking to the machine.
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => setTick((n) => n + 1), AUTO_POLL_MS);
      return () => clearInterval(timer);
    }, []),
  );

  return { agents, findings, tz, loading, refresh };
}

const SEVERITY_RANK: Record<string, number> = { high: 0, med: 1, low: 2 };

export type AutoAgentRow = {
  agent: AutoAgent;
  /** This agent's open findings, newest first. */
  findings: AutoFinding[];
};

/**
 * The agents worth a row on the home screen, in the order they deserve one.
 *
 * An agent qualifies by having an open finding or by running right now.
 * Everything else is a schedule that is behaving — real, but not news, and the
 * home screen is a news surface. A disabled agent with a stale finding still
 * qualifies: the finding is open regardless of whether the agent will ever run
 * again, and hiding it would strand it where nothing else on the phone lists
 * findings at all.
 *
 * Order: running first (it is about to change), then by worst severity, then
 * by most findings, then by most recent — so the row at the top is the one
 * that most wants a decision.
 */
export function selectHomeAutoAgents(
  agents: AutoAgent[],
  findings: AutoFinding[],
): AutoAgentRow[] {
  const byAgent = new Map<string, AutoFinding[]>();
  for (const finding of findings) {
    const list = byAgent.get(finding.agentId);
    if (list) list.push(finding);
    else byAgent.set(finding.agentId, [finding]);
  }
  for (const list of byAgent.values()) {
    list.sort((a, b) => (b.lastSeenAt ?? b.createdAt ?? 0) - (a.lastSeenAt ?? a.createdAt ?? 0));
  }

  const rows: AutoAgentRow[] = [];
  for (const agent of agents) {
    const own = byAgent.get(agent.id) ?? [];
    if (!own.length && !agent.running) continue;
    rows.push({ agent, findings: own });
  }

  const worst = (row: AutoAgentRow) =>
    row.findings.reduce((acc, f) => Math.min(acc, SEVERITY_RANK[f.severity ?? "low"] ?? 2), 3);
  const newest = (row: AutoAgentRow) =>
    row.findings.reduce((acc, f) => Math.max(acc, f.lastSeenAt ?? f.createdAt ?? 0), 0);

  rows.sort(
    (a, b) =>
      Number(!!b.agent.running) - Number(!!a.agent.running) ||
      worst(a) - worst(b) ||
      b.findings.length - a.findings.length ||
      newest(b) - newest(a),
  );
  return rows;
}
