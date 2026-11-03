// Finding autopilot: every open finding gets a session that checks it, fixes
// it, and closes it with evidence, without waiting for a person to tap it.
//
// Before this, a finding only moved when someone opened the feed. On this box
// that left 64 open and 68 stuck in "session": stale outages, duplicate
// reports and plain "report sent" receipts mixed in with real problems, and
// nothing told the agents that the cause had gone away.
//
// The autopilot is the dispatcher only. It never decides an outcome itself.
// The session it starts re-checks the problem, acts, and records the result
// through omg_update_finding (status + note), so every closed finding carries
// the evidence of whoever closed it. Recurrence (store.ts recordRecurrence)
// still reopens anything that comes back.
//
// Off unless <data>/auto/autopilot.json says { "enabled": true }. It runs off
// the auto scheduler's 60 s tick.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { localServeBaseUrl, PATHS } from "../config.ts";
import { USERS } from "../users.ts";
import { getAutoAgent, listFindings, updateFinding, type Finding, type Severity } from "./store.ts";

export type AutopilotConfig = {
  enabled: boolean;
  /** Findings with a session in flight at once. */
  maxConcurrent: number;
  /** New dispatches per rolling hour. */
  maxPerHour: number;
  /** Dispatches per finding before it is handed to a human. */
  maxAttempts: number;
  /** A session that has not closed its finding by then is treated as stuck. */
  inFlightMs: number;
  /** Coding agent for the sessions. Empty = the box default. */
  agent?: string;
  model?: string;
  /** Auto agent ids whose findings the autopilot leaves alone. */
  excludeAgents: string[];
};

export const AUTOPILOT_DEFAULTS: AutopilotConfig = {
  enabled: false,
  maxConcurrent: 3,
  maxPerHour: 8,
  maxAttempts: 2,
  inFlightMs: 3 * 60 * 60_000,
  agent: "claude",
  excludeAgents: [],
};

const configPath = () => join(PATHS.data, "auto", "autopilot.json");

export async function loadAutopilotConfig(): Promise<AutopilotConfig> {
  const f = Bun.file(configPath());
  if (!(await f.exists())) return { ...AUTOPILOT_DEFAULTS };
  try {
    const raw = (await f.json()) as Partial<AutopilotConfig>;
    return { ...AUTOPILOT_DEFAULTS, ...raw, excludeAgents: raw.excludeAgents ?? [] };
  } catch {
    // A broken file must not silently turn the autopilot on or off in a way
    // nobody asked for. Treat it as off, and say so in the tick log.
    return { ...AUTOPILOT_DEFAULTS, enabled: false };
  }
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, med: 1, low: 2 };

/** Findings this tick may dispatch, most urgent first. Pure, for tests. */
export function pickCandidates(rows: Finding[], cfg: AutopilotConfig): Finding[] {
  return rows
    .filter(
      (f) =>
        f.status === "open" &&
        !f.needsHuman &&
        (f.autopilot?.attempts ?? 0) < cfg.maxAttempts &&
        !cfg.excludeAgents.includes(f.agentId),
    )
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        (b.lastSeenAt ?? b.createdAt) - (a.lastSeenAt ?? a.createdAt),
    );
}

/** Findings whose autopilot session is still inside its window. Pure, for tests. */
export function inFlight(rows: Finding[], cfg: AutopilotConfig, now: number): Finding[] {
  return rows.filter(
    (f) => f.status === "session" && f.autopilot && now - f.autopilot.lastAt < cfg.inFlightMs,
  );
}

/** Autopilot sessions that ran out of time without closing their finding. Pure, for tests. */
export function stuck(rows: Finding[], cfg: AutopilotConfig, now: number): Finding[] {
  return rows.filter(
    (f) => f.status === "session" && f.autopilot && now - f.autopilot.lastAt >= cfg.inFlightMs,
  );
}

export function buildAutopilotPrompt(f: Finding, agentName: string, agentPrompt: string | undefined): string {
  const seen = new Date(f.lastSeenAt ?? f.createdAt).toISOString();
  return `You are the finding autopilot on this box. The auto agent "${agentName}" filed the finding below. The owner has asked for this box to run fully automatically: check it, fix it, verify the fix, and close it yourself. Do not wait for the owner unless the rules below say so.

# The finding (id ${f.id})
- Title: ${f.title}
- Severity: ${f.severity}
- Last seen: ${seen}${(f.occurrences ?? 1) > 1 ? ` (reported ${f.occurrences} times)` : ""}
- Reasoning:
${f.reasoning.map((r) => `  - ${r}`).join("\n") || "  - (none)"}
${f.suggest ? `- Agent's suggestion: ${f.suggest}` : ""}

# What the agent that filed it watches
${(agentPrompt ?? "(prompt unavailable)").slice(0, 3000)}

# Steps
1. Re-check it now. Findings go stale: an outage may have been planned maintenance, a key may already be revoked, another session may have fixed it. Look for live sessions already working on the same thing (omg_list_sessions, omg_find_sessions) and do not duplicate or interfere with them.
2. Decide which case it is, and close it with omg_update_finding (id "${f.id}") and a "note" that states what you checked and what you found or changed:
   - Gone or stale, with proof it is gone now: status "resolved".
   - Not a problem at all (a "report sent" receipt, a duplicate of another open finding, a false alarm): status "dismissed". Name the duplicate's id if there is one.
   - Real: fix it at the root, in the repo's normal workflow (worktree, tests, its landing or PR path). Then verify the fix in the real system, and set "resolved" only after that check passes. If the fix is merged but cannot be verified yet, set "resolved" with a note saying what will prove it; recurrence reopens it if it comes back.
   - Only the owner can finish it (a decision, his dashboard or account, a payment, anything below that needs approval): status "open", needsHuman true, and a note with the exact step he must take.
3. When the root cause is the watching agent itself (a check that reads stale data, files receipts as findings, or misses planned maintenance), fix that agent too, with omg_save_auto_agent, so the same false finding does not come back.
4. Close your own session when done: omg_close_session with no id.

# Rules
- Follow every rule in the CLAUDE.md and AGENTS.md files that apply. Those always win.
- Stop and set needsHuman for: anything irreversible or destructive to production data, money or billing changes, emails or messages to customers or anyone outside the team, app-store submissions or releases, deleting accounts, apps or backups, and changes on a host another live session owns.
- Never print a secret value. Never weaken a security control to make a finding go away.
- One finding, one session. If you find a different problem, file nothing; mention it in your note.`;
}

async function dispatch(f: Finding, cfg: AutopilotConfig, now: number): Promise<string> {
  const agent = await getAutoAgent(f.agentId).catch(() => null);
  const cwd = agent?.cwd ?? PATHS.root;
  const body = {
    prompt: buildAutopilotPrompt(f, agent?.name ?? f.agentId, agent?.prompt),
    title: `Autopilot: ${f.title}`.slice(0, 120),
    cwd,
    worktree: existsSync(join(cwd, ".git")),
    agent: cfg.agent || undefined,
    model: cfg.model || undefined,
    spawnedBy: "finding",
    user: USERS[0],
  };
  const attempt = (f.autopilot?.attempts ?? 0) + 1;
  const res = await fetch(`${localServeBaseUrl()}/api/sessions/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `autopilot-${f.id}-${attempt}` },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { sessionId?: string; error?: string };
  if (!res.ok || !data.sessionId) throw new Error(data.error || `HTTP ${res.status}`);
  await updateFinding(f.id, {
    status: "session",
    sessionId: data.sessionId,
    autopilot: { attempts: attempt, lastAt: now, sessionId: data.sessionId },
  });
  return data.sessionId;
}

// Dispatch times in the last hour, kept in memory. A restart forgets them,
// which can at most allow one extra hour's budget; maxConcurrent still holds.
const recent: number[] = [];
let ticking = false;

export async function autopilotTick(onLog: (s: string) => void = () => {}, now = Date.now()): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const cfg = await loadAutopilotConfig();
    if (!cfg.enabled) return;
    let rows = await listFindings();

    // A session that did not close its finding in time: retry once more, or
    // hand it to the owner. Either way the finding is visible in the feed again.
    for (const f of stuck(rows, cfg, now)) {
      const gaveUp = (f.autopilot?.attempts ?? 0) >= cfg.maxAttempts;
      await updateFinding(f.id, {
        status: "open",
        needsHuman: gaveUp || undefined,
        note: gaveUp
          ? `Autopilot gave up: ${cfg.maxAttempts} sessions did not close this finding (last ${f.autopilot?.sessionId?.slice(0, 8) ?? "?"}).`
          : `Autopilot session ${f.autopilot?.sessionId?.slice(0, 8) ?? "?"} did not close this finding in time; retrying.`,
      });
      onLog(`[autopilot] ${gaveUp ? "handed to owner" : "will retry"}: ${f.title}`);
    }
    rows = await listFindings();

    while (recent.length && now - recent[0] >= 60 * 60_000) recent.shift();
    const budget = Math.min(cfg.maxConcurrent - inFlight(rows, cfg, now).length, cfg.maxPerHour - recent.length);
    if (budget <= 0) return;

    for (const f of pickCandidates(rows, cfg).slice(0, budget)) {
      try {
        const sid = await dispatch(f, cfg, now);
        recent.push(now);
        onLog(`[autopilot] dispatched ${sid.slice(0, 8)} for ${f.id}: ${f.title}`);
      } catch (e) {
        // Count the failed try so a finding the server keeps refusing does
        // not block the queue; it reaches maxAttempts and goes to the owner.
        const attempts = (f.autopilot?.attempts ?? 0) + 1;
        await updateFinding(f.id, {
          autopilot: { attempts, lastAt: now },
          ...(attempts >= cfg.maxAttempts
            ? { needsHuman: true, note: `Autopilot could not start a session: ${String(e).slice(0, 300)}` }
            : {}),
        });
        onLog(`[autopilot] dispatch failed for ${f.id}: ${e}`);
      }
    }
  } finally {
    ticking = false;
  }
}
