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
 * Home can omit the section on an older machine without /api/auto/*. Detail
 * pages also receive findingsError so a failed read is not described as a
 * closed finding. The reads fail INDEPENDENTLY — a machine that can list
 * findings but not agents still owes you the findings, with a generic mark
 * where the agent's name and avatar would be (see AutoFindingRow).
 */

import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import { autoCollection, type AutoSnapshot } from "./auto-collection";
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
  /** Who the schedule belongs to. Absent on old rows means the user. */
  owner?: { kind: "user" } | { kind: "bot"; botId: string };
  cwd?: string;
  /** Backend key — "grok", "codex-aisdk", …; absent on old rows means Claude. */
  agent?: string;
  model?: string;
  thinkingLevel?: string;
  claudeAccountId?: string;
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
  findingsError: string | null;
  refresh: () => void;
  /**
   * Move a finding off the open list — dismissed (the user doesn't want to
   * act on it) or session (they graduated it into a real agent session; see
   * `startSessionFromFinding` in index.tsx). Remove it after the server confirms
   * the change. A failed request rejects so the screen can keep the finding
   * and explain the error.
   */
  setFindingStatus: (id: string, status: "dismissed" | "session") => Promise<void>;
  /**
   * Flip one schedule on or off — the Schedules row switch, as on the web's
   * AutoManageView. PATCH /api/auto/agents/:id carries every other field
   * forward server-side, so this never has to know the untruncated prompt.
   * Optimistic; a failure refetches rather than
   * guessing at the row's real state.
   */
  setAgentEnabled: (id: string, enabled: boolean) => Promise<void>;
};

/**
 * Re-render this often so each row's relative time stays honest. The card
 * derives "5 min ago" at render time; the network poll used to be the clock.
 */
const CLOCK_MS = 30_000;

export function useAutoAgents(): AutoAgentsState {
  const { client, bindingId } = useOmg();
  const [agents, setAgents] = useState<AutoAgent[]>([]);
  const [findings, setFindings] = useState<AutoFinding[]>([]);
  const [tz, setTz] = useState<string>(DEFAULT_SCHED_TZ);
  const [loading, setLoading] = useState(true);
  const [findingsError, setFindingsError] = useState<string | null>(null);
  const [, setClock] = useState(0);

  const refresh = useCallback(() => {
    if (client) void autoCollection(client).refresh();
  }, [client]);

  // A machine switch invalidates both lists outright: auto agents belong to
  // the box they run on, and showing the previous machine's schedules would
  // describe a fleet this one has never heard of. Same reasoning as
  // resumable.ts.
  useEffect(() => {
    setAgents([]);
    setFindings([]);
    setFindingsError(null);
  }, [bindingId]);

  // Only while the screen is focused, matching the session list: a
  // backgrounded app has no business talking to the machine. Focus also reads
  // at once, so a screen is never stale on arrival.
  useFocusEffect(
    useCallback(() => {
      if (!client) return;
      const collection = autoCollection(client);
      const apply = (snapshot: AutoSnapshot) => {
        setAgents(snapshot.agents);
        setFindings(snapshot.findings);
        if (snapshot.tz) setTz(snapshot.tz);
        setFindingsError(snapshot.findingsError);
        setLoading(false);
      };
      const cached = collection.peek();
      if (cached) apply(cached);
      else setLoading(true);
      const off = collection.subscribe(apply);
      if (cached) void collection.refresh();
      const clock = setInterval(() => setClock((n) => n + 1), CLOCK_MS);
      return () => {
        off();
        clearInterval(clock);
      };
    }, [client]),
  );

  // Keep the finding visible until the request succeeds. Screens can show a
  // busy action and remain in place on failure instead of claiming dismissal.
  const setFindingStatus = useCallback(
    async (id: string, status: "dismissed" | "session") => {
      if (!client) throw new Error("Connect to your Computer and try again.");
      try {
        await client.transport.request(`/api/auto/findings/${encodeURIComponent(id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        setFindings((prev) => prev.filter((f) => f.id !== id));
      } catch (error) {
        refresh();
        throw error;
      }
    },
    [client, refresh],
  );

  const setAgentEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      if (!client) return;
      setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, enabled } : a)));
      try {
        await client.transport.request(`/api/auto/agents/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });
      } catch {
        refresh();
      }
    },
    [client, refresh],
  );

  return { agents, findings, tz, loading, findingsError, refresh, setFindingStatus, setAgentEnabled };
}

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

/** Open findings, newest report first, with their owning agent. */
export function selectHomeAutoFindings(
  agents: AutoAgent[],
  findings: AutoFinding[],
): AutoFindingRow[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  return sortFindingRows(findings).map((finding) => ({ finding, agent: byId.get(finding.agentId) }));
}

/** One report per agent, with its newest finding first. */
export type AutoFindingGroup = {
  agentId: string;
  agent: AutoAgent | undefined;
  rows: AutoFindingRow[];
};

/**
 * ONE ROW PER AGENT WHEN IT HAS MORE THAN ONE FINDING. An hourly watch that
 * files a fresh finding every run and never gets dismissed grows a pile: five
 * rows all captioned "User Health Watch", differing only in a truncated
 * title, competing with real sessions for the same list. Grouping states the
 * agent once and carries the count; the rows open under it. Same rule as the
 * web's groupFindingsByAgent (web/src/lib/finding-groups.ts).
 *
 * Input is `selectHomeAutoFindings` output, already newest-first, so each
 * group is positioned by its most recently reported finding.
 */
export function groupHomeAutoFindings(rows: AutoFindingRow[]): AutoFindingGroup[] {
  const groups = new Map<string, AutoFindingGroup>();
  for (const row of rows) {
    const agentId = row.finding.agentId;
    const group = groups.get(agentId) ?? { agentId, agent: row.agent, rows: [] };
    group.rows.push(row);
    groups.set(agentId, group);
  }
  return [...groups.values()];
}

/** Findings ordered by latest report, falling back to first sight. Does not mutate input. */
export function sortFindingRows(findings: AutoFinding[]): AutoFinding[] {
  const seen = (f: AutoFinding) => f.lastSeenAt ?? f.createdAt ?? 0;
  return [...findings].sort((a, b) => seen(b) - seen(a));
}
