// A session's team: the omg child sessions it started, their children, and
// what each one is doing.
//
// The session list App.tsx already polls (/api/sessions, every 5 s) is the
// source: every row carries its parent, its working flag, its last message,
// and, when its agent keeps one, a short plan summary (see sessionListRow in
// src/commands/serve.ts). App publishes the list here; the plan pane reads the
// tree under one session. No second fetch and no per-child subscription.
import { useEffect, useSyncExternalStore } from "react";
import { omgFetch } from "@/lib/omg-client";

export type TeamPlanSummary = {
  done: number;
  total: number;
  current?: string;
  running: Array<{ title: string; kind?: string; detail?: string }>;
  finished: number;
  /** The child's own status headline (omg_panel), when it keeps one. */
  headline?: string;
};

/** The fields of a session-list row the team view reads. */
export type TeamSessionRow = {
  sessionId: string | null;
  nativeSessionId?: string | null;
  parentSessionId?: string | null;
  parentNativeSessionId?: string | null;
  agent?: string;
  agentLabel?: string | null;
  title?: string | null;
  lastUserText?: string | null;
  busy?: boolean;
  status?: "ok" | "blocked";
  statusDetail?: string | null;
  startedAt?: number | null;
  lastActivityAt?: number | null;
  last?: { role?: string; kind?: string; text?: string; ts?: number };
  plan?: TeamPlanSummary;
  /** Closed: from /api/sessions/<id>/ended-team, not the live list. */
  endedAt?: number;
};

export type TeamState = "working" | "blocked" | "idle" | "done";

export type TeamMember = {
  id: string;
  /** The agent's own id for the session, when it differs. Questions may carry either. */
  nativeId: string | null;
  title: string;
  agent: string;
  state: TeamState;
  /** One line: what it did or said last. */
  activity: string;
  lastActivityAt: number | null;
  plan: TeamPlanSummary | null;
  children: TeamMember[];
};

const MAX_DEPTH = 6;

/** The first useful line of a session title. Some titles are a whole prompt. */
export function teamTitle(row: TeamSessionRow): string {
  const raw = (row.title || row.lastUserText || "").replace(/^undefined\s*/, "");
  const line = raw.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line || "Untitled session";
}

export function agentName(row: Pick<TeamSessionRow, "agent" | "agentLabel">): string {
  if (row.agentLabel) return row.agentLabel;
  const a = row.agent ?? "";
  if (a === "aisdk" || a === "claude") return "Claude";
  if (a === "codex" || a === "codex-aisdk") return "Codex";
  if (a === "opencode") return "OpenCode";
  return a ? a[0].toUpperCase() + a.slice(1) : "Agent";
}

function toolLabel(text: string): string {
  if (text.startsWith("$ ")) return "Running a command";
  const name = text.split(/[:\s{]/, 1)[0] ?? "";
  if (!name) return "Using a tool";
  if (name === "Bash" || name === "exec_command" || name === "command_execution") return "Running a command";
  if (name === "mcp_tool_call") return "Using a tool";
  return `Using ${name.replace(/^mcp__.+?__/, "")}`;
}

/** What the session did or said last, as one plain line. */
export function teamActivity(row: TeamSessionRow): string {
  if (row.endedAt) return row.plan?.headline || "Closed";
  if (row.status === "blocked") return row.statusDetail || "Blocked";
  const last = row.last;
  const text = (last?.text ?? "").trim();
  if (!last || !text) return "";
  if (last.kind === "thinking") return "Thinking";
  if (last.kind === "tool_use" || last.kind === "tool_result") return toolLabel(text);
  // A report from a child arrives as "[Background task <title> · <id>]\n\n<body>".
  const body = text.replace(/^\[[^\]\n]*\]\s*/, "").replace(/^\[subagent [a-z]+\]\s*/i, "");
  const line = body
    .split("\n")
    .map((l) => l.replace(/^[-*>#\s]+/, "").replace(/\*\*/g, "").trim())
    .find(Boolean);
  if (!line) return "";
  if (last.role === "user") return `Message: ${line}`;
  return line;
}

export function teamState(row: TeamSessionRow): TeamState {
  if (row.endedAt) return "done";
  if (row.status === "blocked") return "blocked";
  return row.busy ? "working" : "idle";
}

/** The tree under `sid`, in the order the children were started. */
export function buildTeam(rows: readonly TeamSessionRow[], sid: string | null | undefined): TeamMember[] {
  if (!sid) return [];
  const byParent = new Map<string, TeamSessionRow[]>();
  for (const row of rows) {
    const parent = row.parentSessionId || row.parentNativeSessionId;
    if (!parent || !row.sessionId) continue;
    const list = byParent.get(parent) ?? [];
    list.push(row);
    byParent.set(parent, list);
  }
  const seen = new Set<string>([sid]);
  const childrenOf = (row: { sessionId: string | null; nativeSessionId?: string | null }, depth: number): TeamMember[] => {
    if (depth >= MAX_DEPTH) return [];
    const keys = [row.sessionId, row.nativeSessionId].filter((k): k is string => !!k);
    const kids = keys.flatMap((k) => byParent.get(k) ?? []);
    return kids
      .filter((k) => {
        if (seen.has(k.sessionId!)) return false;
        seen.add(k.sessionId!);
        return true;
      })
      .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
      .map((k) => ({
        id: k.sessionId!,
        nativeId: k.nativeSessionId && k.nativeSessionId !== k.sessionId ? k.nativeSessionId : null,
        title: teamTitle(k),
        agent: agentName(k),
        state: teamState(k),
        activity: teamActivity(k),
        lastActivityAt: k.endedAt ?? k.lastActivityAt ?? k.last?.ts ?? null,
        plan: k.plan ?? null,
        children: childrenOf(k, depth + 1),
      }));
  };
  const self = rows.find((r) => r.sessionId === sid || r.nativeSessionId === sid);
  return childrenOf(self ?? { sessionId: sid }, 0);
}

/** Every member of the tree, depth first. */
export function flattenTeam(team: readonly TeamMember[]): TeamMember[] {
  return team.flatMap((m) => [m, ...flattenTeam(m.children)]);
}

// The list App.tsx last published. A module store, like session-ref-link's
// registration: App owns the list; readers only subscribe.
let rows: readonly TeamSessionRow[] = [];
const listeners = new Set<() => void>();

export function publishTeamSessions(next: readonly TeamSessionRow[]): void {
  if (next === rows) return;
  rows = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Closed members per session, fetched while a view of that session is open.
// The live list has only running sessions; the server keeps the rest.
type EndedMember = {
  sessionId: string;
  parentSessionId: string;
  title: string;
  agent: string;
  endedAt: number;
  lastActivityAt: number | null;
  plan?: TeamPlanSummary;
};
const ENDED_POLL_MS = 30_000;
const ended = new Map<string, readonly TeamSessionRow[]>();
const endedWatchers = new Map<string, { count: number; timer: ReturnType<typeof setInterval> | null }>();

/** Rows for closed members, in the live list's shape. */
export function endedRows(members: readonly EndedMember[]): TeamSessionRow[] {
  return members.map((m) => ({
    sessionId: m.sessionId,
    parentSessionId: m.parentSessionId,
    agent: m.agent,
    title: m.title,
    startedAt: m.lastActivityAt ?? m.endedAt,
    lastActivityAt: m.lastActivityAt,
    endedAt: m.endedAt,
    ...(m.plan ? { plan: m.plan } : {}),
  }));
}

export function publishEndedTeam(sid: string, members: readonly EndedMember[]): void {
  const prev = ended.get(sid);
  const next = endedRows(members);
  if (prev && JSON.stringify(prev) === JSON.stringify(next)) return;
  ended.set(sid, next);
  listeners.forEach((l) => l());
}

async function fetchEnded(sid: string): Promise<void> {
  try {
    const res = await omgFetch(`/api/sessions/${encodeURIComponent(sid)}/ended-team`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { members?: EndedMember[] };
    publishEndedTeam(sid, Array.isArray(data.members) ? data.members : []);
  } catch {
    // The next tick retries; the live team still shows.
  }
}

function watchEnded(sid: string): () => void {
  let w = endedWatchers.get(sid);
  if (!w) {
    w = { count: 0, timer: null };
    endedWatchers.set(sid, w);
    void fetchEnded(sid);
    w.timer = setInterval(() => void fetchEnded(sid), ENDED_POLL_MS);
  }
  w.count++;
  return () => {
    const cur = endedWatchers.get(sid);
    if (!cur || --cur.count > 0) return;
    if (cur.timer) clearInterval(cur.timer);
    endedWatchers.delete(sid);
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const teamCache = new WeakMap<readonly TeamSessionRow[], Map<string, { ended: readonly TeamSessionRow[] | undefined; team: TeamMember[] }>>();
const EMPTY: TeamMember[] = [];

/** Live rows plus closed ones; a closed row that is live again (resumed) yields to the live one. */
function withEnded(live: readonly TeamSessionRow[], closed: readonly TeamSessionRow[] | undefined): readonly TeamSessionRow[] {
  if (!closed?.length) return live;
  const ids = new Set<string>();
  for (const r of live) {
    if (r.sessionId) ids.add(r.sessionId);
    if (r.nativeSessionId) ids.add(r.nativeSessionId);
  }
  return [...live, ...closed.filter((r) => !ids.has(r.sessionId!))];
}

/**
 * The team under `sid`: live members from the session list, closed ones from
 * the server. Same array until either changes.
 */
export function useSessionTeam(sid: string | null | undefined): TeamMember[] {
  useEffect(() => {
    if (!sid || !UUID.test(sid)) return;
    return watchEnded(sid);
  }, [sid]);
  return useSyncExternalStore(
    subscribe,
    () => {
      if (!sid) return EMPTY;
      let bySid = teamCache.get(rows);
      if (!bySid) {
        bySid = new Map();
        teamCache.set(rows, bySid);
      }
      const closed = ended.get(sid);
      let hit = bySid.get(sid);
      if (!hit || hit.ended !== closed) {
        const team = buildTeam(withEnded(rows, closed), sid);
        hit = { ended: closed, team: team.length ? team : EMPTY };
        bySid.set(sid, hit);
      }
      return hit.team;
    },
    () => EMPTY,
  );
}
