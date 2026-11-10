// A session's finished team: the child sessions it started (and theirs) that
// have been closed. The live list (/api/sessions) only has running sessions,
// so a parent that closes its children used to lose them from its Team view
// at the moment they were done.
//
// The close path stamps the parent on the session's resume-catalog row
// (src/resume-cache.ts, parent_session_id); that catalog is the owner of
// closed sessions. This module walks the tree through both live and closed
// children and returns only the closed ones: the browser already has the live
// ones from the session list.
import { listEndedChildren, type EndedChildRow } from "./resume-cache.ts";
import { readSessionView, summarizeSessionPlan, type SessionPlanSummary } from "./session-plan.ts";

export type EndedTeamMember = {
  sessionId: string;
  parentSessionId: string;
  title: string;
  agent: string;
  endedAt: number;
  lastActivityAt: number | null;
  plan?: SessionPlanSummary;
};

type LiveRow = {
  sessionId: string | null;
  nativeSessionId?: string | null;
  parentSessionId?: string | null;
  parentNativeSessionId?: string | null;
};

const MAX_DEPTH = 6;
const MAX_MEMBERS = 200;

const firstLine = (text: string | null | undefined): string =>
  (text ?? "").split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 200) ?? "";

export function endedTeam(
  rootIds: readonly string[],
  live: readonly LiveRow[],
  query: (parentIds: readonly string[], limit: number) => EndedChildRow[] = listEndedChildren,
): EndedTeamMember[] {
  const liveIds = new Set<string>();
  for (const r of live) {
    if (r.sessionId) liveIds.add(r.sessionId);
    if (r.nativeSessionId) liveIds.add(r.nativeSessionId);
  }
  const seen = new Set<string>(rootIds);
  const out: EndedTeamMember[] = [];
  let frontier = [...seen];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length && out.length < MAX_MEMBERS; depth++) {
    const parents = new Set(frontier);
    const next: string[] = [];
    // Live children are not returned, but their closed children are.
    for (const r of live) {
      const parent = r.parentSessionId || r.parentNativeSessionId;
      if (!parent || !parents.has(parent) || !r.sessionId || seen.has(r.sessionId)) continue;
      seen.add(r.sessionId);
      next.push(r.sessionId);
      if (r.nativeSessionId && !seen.has(r.nativeSessionId)) {
        seen.add(r.nativeSessionId);
        next.push(r.nativeSessionId);
      }
    }
    for (const row of query(frontier, MAX_MEMBERS - out.length)) {
      if (seen.has(row.sessionId)) continue;
      seen.add(row.sessionId);
      next.push(row.sessionId);
      // A resumed session is live again: the session list already has it.
      if (liveIds.has(row.sessionId)) continue;
      const plan = summarizeSessionPlan(readSessionView(row.sessionId));
      out.push({
        sessionId: row.sessionId,
        parentSessionId: row.parentSessionId,
        title: firstLine(row.title) || firstLine(row.lastUserText) || "Untitled session",
        agent: row.backend || row.agent,
        endedAt: row.archivedAt,
        lastActivityAt: row.lastActivityAt,
        ...(plan ? { plan } : {}),
      });
    }
    frontier = next;
  }
  return out;
}
