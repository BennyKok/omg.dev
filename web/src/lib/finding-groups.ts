// One report per auto agent, not one row per finding.
//
// An hourly watch that files a fresh finding every run and never gets
// dismissed grows a pile: five rows all captioned "Fleet Health" in the Auto
// section, differing only in a truncated title. The rows compete with each
// other and with real sessions for the same list. Grouping states the agent
// once and carries the count, so the feed says "Fleet Health · 4" and the
// report sheet is where the four get read.

export type GroupableFinding = {
  id: string;
  agentId: string;
  severity: "high" | "med" | "low";
  createdAt: number;
  lastSeenAt?: number;
  occurrences?: number;
};

export type AgentReport<F extends GroupableFinding> = {
  agentId: string;
  /** Worst severity across the agent's open findings. */
  severity: F["severity"];
  /** Most recent sighting across the group; what the row's time shows. */
  latestAt: number;
  /** Worst first, then most recently seen first. */
  findings: F[];
};

const SEVERITY_RANK: Record<GroupableFinding["severity"], number> = {
  high: 0,
  med: 1,
  low: 2,
};

/** When this finding was last observed: a recurrence moves it, a first sighting is its creation. */
export function findingSeenAt(f: GroupableFinding): number {
  return f.lastSeenAt ?? f.createdAt;
}

/** Worst first, then most recently seen first. Stable for equal keys. */
export function sortFindings<F extends GroupableFinding>(findings: readonly F[]): F[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      findingSeenAt(b) - findingSeenAt(a),
  );
}

/**
 * Group open findings by the agent that filed them. Reports are ordered the
 * same way findings inside them are: worst severity first, then the group
 * with the newest sighting first. An agent's report therefore rises when it
 * files something worse or something new, and sinks as its findings age.
 */
export function groupFindingsByAgent<F extends GroupableFinding>(
  findings: readonly F[],
): AgentReport<F>[] {
  const byAgent = new Map<string, F[]>();
  for (const f of findings) {
    const list = byAgent.get(f.agentId) ?? [];
    list.push(f);
    byAgent.set(f.agentId, list);
  }
  const reports: AgentReport<F>[] = [];
  for (const [agentId, list] of byAgent) {
    const sorted = sortFindings(list);
    reports.push({
      agentId,
      severity: sorted[0].severity,
      latestAt: Math.max(...sorted.map(findingSeenAt)),
      findings: sorted,
    });
  }
  return reports.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.latestAt - a.latestAt,
  );
}
