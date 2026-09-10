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
 * The web's "Make the change": start a session on the finding's own agent,
 * model and folder. Returns the new session id when the server reports one.
 */
export async function startSessionFromFinding(
  client: OmgClient,
  finding: AutoFinding,
  agent: AutoAgent | undefined,
): Promise<string | null> {
  const res = await client.transport.request<{ sessionId?: string }>("/api/sessions/new", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: findingSessionPrompt(finding, agent),
      title: finding.title.trim().slice(0, 200),
      agent: agent?.agent ?? undefined,
      model: agent?.model ?? undefined,
      cwd: agent?.cwd ?? undefined,
    }),
  });
  return res?.sessionId ?? null;
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
