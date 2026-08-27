/**
 * Auto agents — the ones that run on a timer instead of because you asked.
 *
 * An auto agent is JUST a prompt plus a cron schedule (see src/auto/store.ts).
 * It is NOT a session on its own: it has no transcript, nothing to resume.
 * What it produces is a FINDING — one notification, at most, per run,
 * carrying its reasoning and a lifecycle (open, dismissed, or graduated into
 * a real session). That distinction is the whole reason these get their own
 * section on the home screen rather than being folded into Working/Idle,
 * where tapping a row opens a transcript and swiping one archives a session —
 * here tapping (then "Start session") launches a NEW session seeded from the
 * finding, and swiping dismisses the finding, not a session that never
 * existed. See selectHomeAutoFindings and setFindingStatus below, and
 * startSessionFromFinding in app/index.tsx.
 *
 * WHAT THE HOME SCREEN IS FOR, AND WHY THIS LIST IS A FINDINGS LIST.
 *
 * This box can have dozens of auto agents. Rendering that roster would put
 * a wall of configuration under the three sections that show live work,
 * which is the opposite of what the screen is for — and it is not what the
 * web does either: the web keeps the full roster on a MANAGEMENT page
 * (/settings/computer/auto, titled "Schedules") and its live view shows only
 * open findings, one row each, agent-grouping and all (see the "Auto"
 * section in web/src/App.tsx). The phone has no management page, so this
 * mirrors the live view exactly rather than inventing a phone-only shape: the
 * home section shows one row per open finding, nothing about the quiet
 * agents that produced none. See selectHomeAutoFindings.
 *
 * Both reads degrade to nothing rather than to an error, the same way
 * resumable.ts does: an older machine has no /api/auto/* at all, and someone
 * who opened this screen to see what needs attention should not be told
 * about it. They degrade INDEPENDENTLY, too — a machine that can list
 * findings but not agents still owes you the findings, with a generic mark
 * where the agent's name and avatar would be (see AutoFindingRow).
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
  /**
   * Move a finding off the open list — dismissed (the user doesn't want to
   * act on it) or session (they graduated it into a real agent session; see
   * `startSessionFromFinding` in index.tsx). Optimistic: the row leaves the
   * screen immediately, matching `archiveSession`'s swipe. On failure the
   * optimistic removal is undone by a real refetch rather than by re-inserting
   * the stale object, so the phone never shows a finding the server has
   * already resolved a different way (from another device, or the web).
   */
  setFindingStatus: (id: string, status: "dismissed" | "session") => Promise<void>;
};

/**
 * 30s. A finding is a live fact — dismissed on another device, or graduated
 * into a session from the web — so this cannot be resumable.ts's fetch-once,
 * which would leave a row on screen the server has already closed out. It is
 * slower than the session list's 10s on purpose: these are cron-scheduled
 * writes, nothing here changes faster than a minute, and this pulls the
 * entire roster plus every open finding rather than a delta.
 *
 * Re-fetching is also what keeps each row's relative time honest — the card
 * derives it at render time, so a poll that re-renders is the clock. See
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

  // Optimistic: the row leaves `findings` the instant the user acts, the same
  // beat archiveSession drops a session out of its list. If the request
  // fails, don't splice the stale object back in — bump `tick` and let a real
  // refetch decide, which is also correct if the finding was independently
  // resolved elsewhere (another device, the web) in the meantime.
  const setFindingStatus = useCallback(
    async (id: string, status: "dismissed" | "session") => {
      if (!client) return;
      setFindings((prev) => prev.filter((f) => f.id !== id));
      try {
        await client.transport.request(`/api/auto/findings/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
      } catch {
        setTick((n) => n + 1);
      }
    },
    [client],
  );

  return { agents, findings, tz, loading, refresh, setFindingStatus };
}

const SEVERITY_RANK: Record<string, number> = { high: 0, med: 1, low: 2 };

export type AutoFindingRow = {
  finding: AutoFinding;
  /**
   * Undefined only in the gap between a finding arriving and its agent
   * roster catching up (they are two independent fetches; see
   * `useAutoAgents`). The row still renders — see auto-agent-card.tsx — with
   * a generic mark rather than being dropped, because an open finding is
   * never the thing to hide.
   */
  agent: AutoAgent | undefined;
};

/**
 * The open findings worth a row on the home screen, in the order they most
 * want a decision.
 *
 * ONE ROW PER FINDING, not per agent. This box can have dozens of auto
 * agents; almost none of that is news. What is news is a finding, and the
 * web's own live view (the "Auto" section in web/src/App.tsx) already proved
 * the right grain: a flat, chronological-by-severity list of findings, not a
 * roster of the agents that produced them. An agent with nothing open —
 * including one running right now — earns no row here; "running" is a
 * schedule-management fact (web's AutoManageView), not news.
 *
 * Order: worst severity first, then most recently seen — so the row at the
 * top is the one that most wants a decision, matching selectHomeAutoAgents's
 * old ordering minus the "running" tiebreaker that no longer applies.
 */
export function selectHomeAutoFindings(
  agents: AutoAgent[],
  findings: AutoFinding[],
): AutoFindingRow[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const rows = findings.map((finding) => ({ finding, agent: byId.get(finding.agentId) }));

  const sev = (row: AutoFindingRow) => SEVERITY_RANK[row.finding.severity ?? "low"] ?? 2;
  const seen = (row: AutoFindingRow) => row.finding.lastSeenAt ?? row.finding.createdAt ?? 0;

  rows.sort((a, b) => sev(a) - sev(b) || seen(b) - seen(a));
  return rows;
}
