/**
 * What the Auto pages share: the prompt a finding launches with, the request
 * that launches it, and the one-line schedule an agent's report shows.
 *
 * Mirrors the web (web/src/App.tsx AgentReportSheet / FindingDetail): the
 * report page and the finding page on the phone are the same two surfaces,
 * so the words and the launch request are kept in one place here.
 */
import type { OmgClient } from "@omg-dev/client";

import type { AutoAgent, AutoFinding } from "./auto-agents";
import { describeCron, nextRunAt } from "./cron";

/** The prompt a session starts with when a finding is turned into work. */
export function findingSessionPrompt(finding: AutoFinding, agent: AutoAgent | undefined): string {
  return [
    `An automated watch agent ("${agent?.name ?? "Auto agent"}") flagged this:`,
    "",
    finding.title,
    ...(finding.reasoning?.length ? ["", "Reasoning:", ...finding.reasoning.map((r) => `- ${r}`)] : []),
    ...(finding.suggest ? ["", `Suggested fix: ${finding.suggest}`] : []),
    "",
    "Now do this: Go ahead and implement this fix now.",
  ].join("\n");
}

/**
 * The web's "Make the change": source settings are the defaults, with optional
 * launch choices from the session picker. The finding keeps its source folder.
 * A missing session id is a failure, not a resolved finding.
 */
export async function startSessionFromFinding(
  client: OmgClient,
  finding: AutoFinding,
  agent: AutoAgent | undefined,
  launch?: { agent: string; model?: string | null; thinkingLevel?: string | null; claudeAccountId?: string },
): Promise<string> {
  const res = await client.transport.request<{ sessionId?: string }>("/api/sessions/new", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: findingSessionPrompt(finding, agent),
      title: finding.title.trim().slice(0, 200),
      agent: launch?.agent ?? agent?.agent ?? undefined,
      model: launch ? launch.model ?? undefined : agent?.model ?? undefined,
      thinkingLevel: launch ? launch.thinkingLevel ?? undefined : agent?.thinkingLevel,
      claudeAccountId: launch ? launch.claudeAccountId : agent?.claudeAccountId,
      cwd: agent?.cwd ?? undefined,
    }),
  });
  if (!res?.sessionId) throw new Error("The session did not start. Please try again.");
  return res.sessionId;
}

/**
 * The prompt for one group's Triage & execute. A copy of the web's
 * buildAutoTriagePrompt (web/src/lib/auto-triage.ts), scoped to one agent:
 * the app pins a released @omg-dev/protocol, so it cannot import the web's.
 * Keep the two in step.
 */
export function autoTriagePrompt(findings: AutoFinding[], agent: AutoAgent | undefined): string {
  const agentName = agent?.name ?? findings[0]?.agentId ?? "Auto agent";
  const repo = agent?.cwd
    ? `\nSource repo: ${agent.cwd}${agent.project ? ` (project ${agent.project})` : ""}`
    : "";
  const snapshot = findings.map((finding) =>
    [
      `LFG auto finding reference: ${finding.id}`,
      `Agent: ${agentName}`,
      `Title: ${finding.title}`,
      ...(finding.reasoning?.length ? ["", "Reasoning:", ...finding.reasoning.map((r) => `- ${r}`)] : []),
      ...(finding.suggest ? ["", `Suggested fix: ${finding.suggest}`] : []),
    ].join("\n") + `\nSeverity: ${finding.severity ?? "unknown"}${repo}`,
  );
  return [
    `Triage and execute ${findings.length} open LFG auto-agent finding${findings.length === 1 ? "" : "s"}.`,
    "",
    "The human explicitly started the Triage & execute shortcut. This authorizes you to delegate actionable implementation work to linked LFG subagents. The scheduled auto agents have already run; do not just rerun every watcher.",
    "",
    "Workflow:",
    "1. Refresh the open findings with `lfg agents auto findings --status open --json`, then verify each claim against current code, runtime state, and recent work before acting. The finding ids in the snapshot below define this run's scope; use the refresh to remove stale items, not to pull unrelated findings into a project-scoped run.",
    "2. Group findings that share a root cause, repository, deployment surface, or likely file overlap. Keep unrelated or conflicting work in separate groups.",
    "3. Dismiss a finding only when evidence shows it is already resolved, duplicated, or purely informational. Use `lfg agents auto dismiss <findingId>` and record the evidence.",
    "4. Execute every safe, actionable group now by creating linked, visible LFG subagent sessions in the correct repo/worktree. Give each child the complete finding ids and context, require reproduction before edits, focused tests, repository instructions, deployment verification when applicable, and dismissal only after the fix is verified.",
    "5. Keep pricing, product-direction, destructive, irreversible, or genuinely ambiguous decisions open for the human. Explain the exact decision needed instead of inventing approval.",
    "6. Monitor the delegated sessions through completion. Do not stop after writing a triage plan or launching children; report final results, commits/PRs, verification, dismissed findings, and anything still open.",
    "",
    "Use LFG-managed delegation tools so every child remains linked to this parent session. Respect available concurrency and batch related findings instead of creating one child per finding.",
    "",
    "Finding snapshot captured when the shortcut was pressed (the live refresh above is authoritative):",
    "",
    ...snapshot.flatMap((entry, index) => [entry, ...(index < snapshot.length - 1 ? ["", "---", ""] : [])]),
  ].join("\n");
}

/**
 * The web's per-group Triage & execute: one session for every open finding
 * of one agent, in that agent's folder, on that agent's settings. The findings
 * stay open; the triage session dismisses each one after it is fixed.
 */
export async function startTriageFromFindings(
  client: OmgClient,
  findings: AutoFinding[],
  agent: AutoAgent | undefined,
): Promise<string> {
  const res = await client.transport.request<{ sessionId?: string }>("/api/sessions/new", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: autoTriagePrompt(findings, agent),
      title: `Triage ${findings.length} auto finding${findings.length === 1 ? "" : "s"}`,
      agent: agent?.agent ?? undefined,
      model: agent?.model ?? undefined,
      thinkingLevel: agent?.thinkingLevel,
      claudeAccountId: agent?.claudeAccountId,
      cwd: agent?.cwd ?? undefined,
    }),
  });
  if (!res?.sessionId) throw new Error("The triage session did not start. Please try again.");
  return res.sessionId;
}

function shortIn(ts: number, now: number): string {
  const diff = Math.max(0, ts - now);
  const m = Math.round(diff / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(diff / 3_600_000);
  if (h < 48) return `in ${h}h`;
  return `in ${Math.round(diff / 86_400_000)}d`;
}

function shortAgo(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(diff / 3_600_000);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

/** "Every hour · in 13m · ran 47m ago", the line under the agent's name on its report. */
export function agentScheduleLine(agent: AutoAgent, tz: string, now: number = Date.now()): string {
  const parts = [describeCron(agent.schedule)];
  if (agent.enabled) {
    const next = nextRunAt(agent.schedule, tz, now);
    if (next) parts.push(shortIn(next, now));
  } else {
    parts.push("paused");
  }
  if (agent.lastRunAt) parts.push(`ran ${shortAgo(agent.lastRunAt, now)}`);
  return parts.join(" · ");
}

/** "13h", the compact age the web prints beside a finding. */
export function findingAge(finding: AutoFinding, now: number = Date.now()): string {
  const ts = finding.lastSeenAt ?? finding.createdAt;
  if (!ts) return "";
  const diff = Math.max(0, now - ts);
  const m = Math.round(diff / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(diff / 3_600_000);
  if (h < 24) return `${h}h`;
  return `${Math.round(diff / 86_400_000)}d`;
}
