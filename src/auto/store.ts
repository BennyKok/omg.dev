// Auto agents — the streamlined replacement for report-writing agents. An auto
// agent is JUST a prompt + a schedule. It runs as a real Claude session with
// read-only tools and, at most, emits ONE finding (a notification), not a
// report. Findings carry their reasoning and a lifecycle (open → dismissed /
// session). Dismissed findings are fed back into the prompt so the agent stops
// resurfacing the same thing — that's the anti-noise loop.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { PATHS } from "../config.ts";
import { thinkingLevelsForAgent } from "../agent-catalog.ts";
import { scheduleWakeHooksPush } from "./wake-hooks-push.ts";

export type Severity = "high" | "med" | "low";
export type AutoAgentBackend =
  | "aisdk"
  | "codex-aisdk"
  | "grok"
  | "cursor"
  | "opencode"
  | "hermes";

export type AutoAgent = {
  id: string;
  name: string;
  prompt: string; // the entire agent
  schedule: string; // 5-field cron expression
  enabled: boolean;
  cwd?: string; // where the Claude session runs; defaults to repo root
  agent?: AutoAgentBackend; // omitted for old rows = "aisdk" (Claude AI SDK)
  // Which Claude account a scheduled run bills to. Only the "aisdk" backend has
  // accounts; unset = whichever account the box is currently signed in as.
  claudeAccountId?: string;
  model?: string;
  thinkingLevel?: string;
  // Extra tools granted to this agent on top of the read-only default set
  // (Read/Grep/Glob/WebSearch/WebFetch). e.g. ["Bash"] for agents that need to
  // shell out to a data bridge. Empty/undefined = read-only.
  tools?: string[];
  lastRunAt?: number;
};

/**
 * Keep old Hermes rows visible, but never schedule them again.
 *
 * This is a read migration. It avoids rewriting the store during a status read,
 * and the next normal edit persists the disabled value.
 */
export function autoAgentEnabledForBackend(
  enabled: boolean,
  backend: AutoAgentBackend | undefined,
): boolean {
  return backend === "hermes" ? false : enabled;
}

export function normalizeStoredAutoAgents(agents: AutoAgent[]): AutoAgent[] {
  return agents.map((agent) =>
    agent.enabled !== autoAgentEnabledForBackend(agent.enabled, agent.agent)
      ? { ...agent, enabled: false }
      : agent
  );
}

// "resolved" is TERMINAL and is the only status that means the underlying
// problem is actually gone. Everything else — including "session" — only
// records what happened to the *notification*, not to the problem. That gap is
// why a correct, high-severity finding ("sqld WAL is 2.3 GB, checkpoints not
// truncating", 2026-07-12) spawned a session, the session ended, nobody
// re-checked, and the same failure caused a four-day backup outage ten days
// later. A finding is not done because someone looked at it.
export type FindingStatus =
  | "open"
  | "dismissed"
  | "session"
  | "read"
  | "resolved";

// Statuses where the underlying problem may still be live. Recurrence is
// measured against these — NOT against "open"/"dismissed" alone, which was the
// original bug: 302 of 396 findings sat in "session", so a repeat report never
// matched and was filed as brand new instead of escalating.
const UNRESOLVED: FindingStatus[] = ["open", "dismissed", "session", "read"];

export type Finding = {
  id: string;
  agentId: string;
  title: string;
  reasoning: string[];
  suggest?: string;
  severity: Severity;
  createdAt: number;
  status: FindingStatus;
  sessionId?: string;
  /** How many times an agent has independently reported this. 1 on first sight. */
  occurrences?: number;
  /** When it was most recently re-observed (differs from createdAt once it recurs). */
  lastSeenAt?: number;
};

const dir = () => join(PATHS.data, "auto");
const agentsPath = () => join(dir(), "agents.json");
const findingsPath = () => join(dir(), "findings.jsonl");

async function ensure() {
  await mkdir(dir(), { recursive: true });
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "agent"
  );
}

// ---------- agents ----------

export async function listAutoAgents(): Promise<AutoAgent[]> {
  const f = Bun.file(agentsPath());
  if (!(await f.exists())) return [];
  try {
    return normalizeStoredAutoAgents(JSON.parse(await f.text()) as AutoAgent[]);
  } catch {
    return [];
  }
}

export async function getAutoAgent(id: string): Promise<AutoAgent | null> {
  return (await listAutoAgents()).find((a) => a.id === id) ?? null;
}

/**
 * Keep a thinking level only if the backend that will run it actually accepts
 * that level. Returns undefined for a backend with no reasoning knob at all
 * (opencode), and for a level outside the backend's own vocabulary (a claude
 * "max" surviving a switch to grok, whose CLI exits on it).
 */
export function sanitizeThinkingLevel(
  level: string | undefined,
  backend: string | undefined,
): string | undefined {
  if (!level) return undefined;
  const allowed = thinkingLevelsForAgent(backend ?? "aisdk");
  return allowed?.includes(level) ? level : undefined;
}

/**
 * Resolve the stored Claude account pin on a save.
 *
 * Two separate rules, and the first one is why this takes a tri-state:
 *
 *  - `undefined` = the caller never mentioned the field (CLI edits, the refine
 *    endpoint), so keep whatever is stored. `null`/`""` = the caller explicitly
 *    chose "Claude · Auto", so CLEAR it. Collapsing those two into one value is
 *    what made un-pinning impossible: the editor omits an empty field,
 *    `JSON.stringify` drops `undefined`, and a `??` merge then handed the old
 *    pin straight back — the agent kept billing the account the user had just
 *    unpinned, and reopening the sheet showed the chip back where it started.
 *  - Only "aisdk" has accounts, so a pin never survives a switch to another
 *    backend. Same trap as sanitizeThinkingLevel above: a field that means
 *    something for one backend must not sit in a row nothing re-validates.
 */
export function claudeAccountForBackend(
  requested: string | null | undefined,
  stored: string | undefined,
  backend: AutoAgentBackend | undefined,
): string | undefined {
  const accountId = requested === undefined ? stored : requested || undefined;
  if (!accountId) return undefined;
  // undefined backend = an old row, which means "aisdk" (see the type above).
  return backend === undefined || backend === "aisdk" ? accountId : undefined;
}

export async function saveAutoAgent(input: {
  id?: string;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  cwd?: string;
  agent?: AutoAgentBackend;
  /** undefined = leave the stored pin alone; null/"" = clear it. */
  claudeAccountId?: string | null;
  model?: string;
  thinkingLevel?: string;
  tools?: string[];
}): Promise<AutoAgent> {
  await ensure();
  const list = await listAutoAgents();
  let id = input.id;
  if (!id) {
    id = slug(input.name);
    let n = 2;
    while (list.some((a) => a.id === id)) id = `${slug(input.name)}-${n++}`;
  }
  const existing = list.find((a) => a.id === id);
  const backend = input.agent ?? existing?.agent;
  const agent: AutoAgent = {
    id,
    name: input.name,
    prompt: input.prompt,
    schedule: input.schedule,
    enabled: autoAgentEnabledForBackend(input.enabled, backend),
    cwd: input.cwd ?? existing?.cwd,
    agent: backend,
    claudeAccountId: claudeAccountForBackend(
      input.claudeAccountId,
      existing?.claudeAccountId,
      backend,
    ),
    model: input.model ?? existing?.model,
    // Carry the level forward on a plain edit, but never past a backend
    // switch that can't take it. The editor already omits thinkingLevel for a
    // backend with no reasoning knob (opencode), so a bare `??` merge resurrected
    // the level the agent held as claude — writing a record that no longer
    // validates. Nothing re-checks a stored row, so the break only surfaced
    // later, at launch, as a 400 from POST /api/sessions/new.
    thinkingLevel: sanitizeThinkingLevel(input.thinkingLevel ?? existing?.thinkingLevel, backend),
    tools: input.tools ?? existing?.tools,
    lastRunAt: existing?.lastRunAt,
  };
  const next = existing
    ? list.map((a) => (a.id === id ? agent : a))
    : [...list, agent];
  await Bun.write(agentsPath(), JSON.stringify(next, null, 2));
  scheduleWakeHooksPush();
  return agent;
}

export async function deleteAutoAgent(id: string): Promise<void> {
  await ensure();
  const list = await listAutoAgents();
  await Bun.write(
    agentsPath(),
    JSON.stringify(
      list.filter((a) => a.id !== id),
      null,
      2,
    ),
  );
  scheduleWakeHooksPush();
}

export async function setLastRun(id: string, ts: number): Promise<void> {
  const list = await listAutoAgents();
  if (!list.some((a) => a.id === id)) return;
  await Bun.write(
    agentsPath(),
    JSON.stringify(
      list.map((a) => (a.id === id ? { ...a, lastRunAt: ts } : a)),
      null,
      2,
    ),
  );
}

// ---------- in-flight runs (in-memory; serve process only) ----------
// Which agents are mid-run right now, so the UI can show a live spinner. This
// is deliberately NOT persisted: a run can't outlive the process, and on a
// fresh start nothing is running. markRunning is called synchronously at the
// top of a run so a manual /run reflects as "running" before the POST returns.
const inFlight = new Set<string>();

export function markRunning(id: string): void {
  inFlight.add(id);
}

export function clearRunning(id: string): void {
  inFlight.delete(id);
}

export function isRunning(id: string): boolean {
  return inFlight.has(id);
}

// ---------- findings ----------

export async function listFindings(status?: string): Promise<Finding[]> {
  const f = Bun.file(findingsPath());
  if (!(await f.exists())) return [];
  const rows = (await f.text())
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Finding);
  rows.sort((a, b) => b.createdAt - a.createdAt);
  return status ? rows.filter((r) => r.status === status) : rows;
}

async function writeFindings(rows: Finding[]): Promise<void> {
  await ensure();
  await Bun.write(
    findingsPath(),
    rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""),
  );
}

export async function addFinding(input: {
  agentId: string;
  title: string;
  reasoning: string[];
  suggest?: string;
  severity: Severity;
}): Promise<Finding> {
  const rows = await listFindings();
  const finding: Finding = {
    id: randomBytes(6).toString("hex"),
    agentId: input.agentId,
    title: input.title,
    reasoning: input.reasoning,
    suggest: input.suggest,
    severity: input.severity,
    createdAt: Date.now(),
    status: "open",
  };
  rows.push(finding);
  await writeFindings(rows);
  return finding;
}

export async function updateFinding(
  id: string,
  patch: Partial<Pick<Finding, "status" | "sessionId">>,
): Promise<Finding | null> {
  const rows = await listFindings();
  let found: Finding | null = null;
  const next = rows.map((r) => {
    if (r.id === id) {
      found = { ...r, ...patch };
      return found;
    }
    return r;
  });
  if (!found) return null;
  await writeFindings(next);
  return found;
}

// ---------- finding actions (instrumentation) ----------
// Which CTA a user actually taps on a finding, and whether they had typed an
// instruction first. The FindingSheet stacks several affordances (composer
// send, one-tap "Make the change", copy for an existing session, dismiss);
// without this we have no data on which one earns its place. Append-only JSONL,
// fire-and-forget — never blocks the user action.

export type FindingActionPath =
  | "reply"
  | "execute"
  | "copy"
  | "dismiss"
  // Tuned the agent that produced the finding instead of acting on the finding
  // itself. Tracked with the rest so the CTA mix stays measurable — a path that
  // isn't logged looks like nobody uses it.
  | "feedback";

export type FindingActionEvent = {
  findingId: string;
  path: FindingActionPath;
  hadText: boolean;
  at: number;
};

const findingActionsPath = () => join(dir(), "finding-actions.jsonl");

export async function logFindingAction(input: {
  findingId: string;
  path: FindingActionPath;
  hadText: boolean;
}): Promise<void> {
  await ensure();
  const ev: FindingActionEvent = {
    findingId: input.findingId,
    path: input.path,
    hadText: input.hadText,
    at: Date.now(),
  };
  const f = Bun.file(findingActionsPath());
  const prev = (await f.exists()) ? await f.text() : "";
  await Bun.write(findingActionsPath(), prev + JSON.stringify(ev) + "\n");
}

// Dedup: a finding with the same normalized title for this agent that is still
// open (or was dismissed) should not be re-added. Keeps the stream from
// re-accumulating the same item every run.
// Normalise a title for recurrence matching. Numbers are stripped because the
// same problem is usually re-reported with a moved number — "sqld WAL is 2.3 GB"
// and "sqld WAL is 3.1 GB" are one problem getting worse, not two problems.
// Exact-title matching treated them as unrelated and filed both as new.
export const normTitleForTest = (t: string) => normTitle(t);

const normTitle = (t: string) =>
  t
    .toLowerCase()
    .replace(/[\d.,]+\s*(gb|mb|kb|tb|b|ms|s|%|×|x)?/g, "#")
    .replace(/[^a-z#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Record that an agent has just observed `title` again.
 *
 * Returns the existing finding when this is a recurrence, after bumping its
 * occurrence count and re-surfacing it. Returns null when it is genuinely new
 * and the caller should file it.
 *
 * The old behaviour (hasOpenSimilar -> skip) SILENTLY DISCARDED repeat
 * observations. That is the worst possible response: the signal that a problem
 * is persistent — the single most useful thing an agent can tell you — was the
 * one signal thrown away. A thing reported four times is not noise, it is the
 * thing you should be doing.
 */
export async function recordRecurrence(
  agentId: string,
  title: string,
): Promise<Finding | null> {
  const rows = await listFindings();
  const now = Date.now();
  const key = normTitle(title);
  const match = rows.find(
    (r) =>
      r.agentId === agentId &&
      UNRESOLVED.includes(r.status) &&
      normTitle(r.title) === key,
  );
  if (!match) return null;

  const occurrences = (match.occurrences ?? 1) + 1;
  // Re-surface it. A recurrence that stays "dismissed"/"read" is invisible
  // again, which is how these got lost the first time. "session" is preserved
  // so an in-flight session is not yanked out from under whoever owns it.
  const status: FindingStatus =
    match.status === "session" ? "session" : "open";

  const next = rows.map((r) =>
    r.id === match.id ? { ...r, occurrences, lastSeenAt: now, status } : r,
  );
  await writeFindings(next);
  return { ...match, occurrences, lastSeenAt: now, status };
}

/** @deprecated use recordRecurrence — kept so existing callers keep compiling. */
export async function hasOpenSimilar(
  agentId: string,
  title: string,
): Promise<boolean> {
  return (await recordRecurrence(agentId, title)) !== null;
}
