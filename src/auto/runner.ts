// Runs one auto agent: build a prompt from the agent's instruction + the
// dismiss-feedback block, pipe it to a real headless Claude session with
// read-only tools, and parse the findings out of the result. Most runs should
// return [] — silence is the default, not a padded report.
//
// A run may surface MORE than one finding. It used to be capped at exactly one,
// which quietly cost coverage: seven agents fire in the same six-minute window
// each morning, so a day with three simultaneous problems surfaced three of
// them at best and the rest were discarded with no trace. The cap now lives at
// MAX_FINDINGS_PER_RUN and drops the least severe, never the outage.

import { PATHS } from "../config.ts";
import { notifyAll, type PushNotification } from "../push.ts";
import { projectName } from "../projects.ts";
import { runInCwd } from "./cwd-lock.ts";
import { claudeAccountConfigDir, resolveClaudeAccount } from "../claude-accounts.ts";
import { claudeAccountEnv } from "../claude-creds.ts";
import {
  type AutoAgent,
  type Finding,
  type Severity,
  addFinding,
  clearRunning,
  recordRecurrence,
  listFindings,
  markRunning,
} from "./store.ts";

/**
 * How many findings one run may file.
 *
 * Not a quality bar — the strictness lives in the prompt. This is a blast-radius
 * cap so a confused agent can't file fifty rows and fifty pushes in one tick.
 */
const MAX_FINDINGS_PER_RUN = 5;

const SYSTEM = `You are an autonomous watch agent. Carry out the instruction below.

You have read-only tools (Read, Grep, Glob, WebSearch, WebFetch) — use them to
gather your own context. Decide what, if anything, is worth surfacing as a
notification right now. Be strict: most runs should surface nothing. Only
surface something concrete, high-leverage, and actionable — never filler.

Report every INDEPENDENT problem you find, not just the most important one — two
unrelated problems are two findings. This is not licence to pad: if one thing is
worth surfacing, report one; if nothing is, report none. Never split one problem
across several findings to look thorough, and never merge two unrelated problems
into one finding. At most ${MAX_FINDINGS_PER_RUN} per run; if you somehow have
more, keep the most severe.

Respond with ONLY a JSON object as the final thing you output. No prose around
it, no markdown fence. One of:

{"findings": []}

or

{"findings": [{"title": "<one line>", "severity": "high" | "med" | "low", "reasoning": ["<short bullet>", "..."], "suggest": "<one-line concrete fix>"}]}

Each finding must stand alone: its title names one specific problem, and its
reasoning and suggest refer only to that problem.

Rules: title is one line. At most 4 short reasoning bullets per finding. No essay.`;

function normSeverity(s: unknown): Severity {
  const v = String(s ?? "").toLowerCase();
  if (v.startsWith("h")) return "high";
  if (v.startsWith("l")) return "low";
  return "med";
}

/** Sort order for the per-run cap: most severe first. */
const SEVERITY_RANK: Record<Severity, number> = { high: 0, med: 1, low: 2 };

/**
 * Render a finding as the notification carried inside the push.
 *
 * The service worker used to build this itself by fetching /api/auto/findings
 * after a contentless wake. That only works when the app and this box share an
 * origin, so the text is composed here instead and encrypted into the message.
 */
function findingNotification(finding: Finding, occurrences?: number, project?: string): PushNotification {
  const body = finding.suggest || finding.reasoning?.[0] || "New activity in your sessions";
  return {
    title: occurrences && occurrences > 1 ? `${finding.title} (×${occurrences})` : finding.title,
    body,
    url: "/",
    tag: `finding-${finding.id}`,
    project,
  };
}

/**
 * Parse the agent's final text into zero or more raw findings.
 *
 * `null` means the output was unparseable; `[]` means the agent deliberately
 * surfaced nothing. The caller logs those differently — they look identical
 * from outside, and conflating them is how a broken agent hides as a quiet one.
 *
 * EVERY shape the agents have ever been told to emit is accepted, including the
 * single-finding `{"finding": ...}` contract this replaced. That is not
 * politeness: the stored agent prompts are user-owned rows written against the
 * old contract, they are not migrated by this change, and a model that follows
 * its own prompt over the system prompt must keep working. A stricter parser
 * would turn those runs into silence — and silence is indistinguishable from a
 * healthy quiet run, so the regression would be invisible.
 */
export function parseFindings(text: string): unknown[] | null {
  const tryParse = (s: string): any => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const objects = (v: unknown[]): unknown[] =>
    v.filter((x) => x != null && typeof x === "object" && !Array.isArray(x));

  let j: any = tryParse(text.trim());
  if (!j) {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) j = tryParse(fence[1].trim());
  }
  if (!j) {
    // last balanced-ish object in the text
    const m = text.match(/\{[\s\S]*\}/);
    if (m) j = tryParse(m[0]);
  }
  if (!j) {
    // ...or a bare top-level array of findings
    const m = text.match(/\[[\s\S]*\]/);
    if (m) j = tryParse(m[0]);
  }
  if (j == null || typeof j !== "object") return null;

  // A bare array of findings.
  if (Array.isArray(j)) return objects(j);

  // {"findings": [...]} — the current contract.
  if ("findings" in j) {
    const v = j.findings;
    if (v == null) return [];
    if (!Array.isArray(v)) return null;
    return objects(v);
  }

  // {"finding": {...}} / {"finding": null} — the legacy single-finding contract.
  if ("finding" in j) {
    const v = j.finding;
    if (v == null) return [];
    if (typeof v !== "object") return null;
    return Array.isArray(v) ? objects(v) : [v];
  }

  // A bare finding object with no envelope.
  if ("title" in j) return [j];
  return null;
}

const READONLY_TOOLS = ["Read", "Grep", "Glob", "WebSearch", "WebFetch"];

/**
 * Environment that bills this run to the agent's pinned Claude account, or
 * undefined to run as whichever account the box is signed in as.
 *
 * A pin that no longer resolves (the account was removed or signed out) does
 * NOT fail the run — a watch agent going silent is worse than one billing the
 * default account — but it says so in the log rather than switching quietly.
 */
function claudeAccountEnvFor(
  accountId: string | undefined,
  onLog: (s: string) => void,
): Record<string, string> | undefined {
  if (!accountId) return undefined;
  const account = resolveClaudeAccount(accountId);
  if (!account) {
    onLog(`[auto] pinned Claude account ${accountId} is not connected — using the default account`);
    return undefined;
  }
  const configDir = claudeAccountConfigDir(account.id);
  if (!configDir) {
    onLog(`[auto] no config dir for Claude account ${accountId} — using the default account`);
    return undefined;
  }
  onLog(`[auto] billing this run to ${account.label}`);
  return claudeAccountEnv(process.env, true, configDir);
}

async function runClaude(
  prompt: string,
  cwd: string,
  onLog: (s: string) => void,
  extraTools: string[] = [],
  opts: { model?: string; thinkingLevel?: string; claudeAccountId?: string } = {},
): Promise<string> {
  const allowedTools = [...READONLY_TOOLS, ...extraTools];
  onLog(`[auto] claude run (${prompt.length} chars) in ${cwd} [model: ${opts.model ?? "default"}; tools: ${allowedTools.join(",")}]`);
  // Route through the AI-SDK report backend instead of spawning `claude -p`
  // directly: it drives the same installed claude binary + subscription auth,
  // but stays on the AI SDK surface (same as the interactive harnesses) and
  // returns the assistant text directly — so we no longer parse the CLI's
  // --output-format json envelope. The agent's read-only toolset is preserved
  // via allowedTools (this also implicitly excludes AskUserQuestion, which a
  // headless run can't answer). cwd is honored because pipeToClaudeAiSdk runs
  // in this process and the auto runner has already chdir'd / the provider
  // inherits the cwd; we pass it through unchanged in behavior.
  const { pipeToClaudeAiSdk } = await import("../agents/backends/claude-ai-sdk.ts");
  try {
    // The provider drives claude in the current working directory; scope it to
    // the agent's cwd for the duration of the run. chdir is process-global, so
    // the whole chdir→run→restore is serialized under the shared cwd lock.
    return await runInCwd(cwd, () =>
      pipeToClaudeAiSdk(prompt, onLog, {
        allowedTools,
        model: opts.model,
        thinkingLevel: opts.thinkingLevel,
        // Scoped to this query only. Billing a run to a pinned account by
        // swapping process.env instead would have leaked across the whole
        // serve process: the cwd lock serializes auto runs against each other,
        // but not against interactive sessions, /api status polls or the voice
        // provider registry, all of which read process.env in the same process.
        env: claudeAccountEnvFor(opts.claudeAccountId, onLog),
      }),
    );
  } catch (e) {
    // The report backend throws on an empty generation; the old `claude -p`
    // path returned the (empty) output and let parseFinding treat it as
    // silence. Preserve that silent-by-default behavior: a run that produced
    // nothing yields "" → no parseable finding → null, not a thrown error.
    if (e instanceof Error && /empty result/i.test(e.message)) {
      onLog("[auto] ai-sdk produced no output — treating as silence");
      return "";
    }
    throw e;
  }
}

async function runSelectedBackend(
  agent: AutoAgent,
  prompt: string,
  cwd: string,
  onLog: (s: string) => void,
): Promise<string> {
  const backend = agent.agent ?? "aisdk";
  if (backend === "codex-aisdk") {
    onLog(`[auto] codex run (${prompt.length} chars) in ${cwd} [model: ${agent.model ?? "default"}]`);
    const { pipeToCodexAiSdk } = await import("../agents/backends/codex-aisdk-session.ts");
    return await runInCwd(cwd, () =>
      pipeToCodexAiSdk(prompt, onLog, {
        cwd,
        model: agent.model,
        thinkingLevel: agent.thinkingLevel,
      }),
    );
  }
  if (backend === "opencode") {
    onLog(`[auto] opencode run (${prompt.length} chars) in ${cwd} [model: ${agent.model ?? "default"}]`);
    const { pipeToOpencodeAiSdk } = await import("../agents/backends/opencode-aisdk-session.ts");
    return await runInCwd(cwd, () =>
      pipeToOpencodeAiSdk(prompt, onLog, {
        cwd,
        model: agent.model,
        thinkingLevel: agent.thinkingLevel,
      }),
    );
  }
  if (backend === "grok") {
    onLog(`[auto] grok run (${prompt.length} chars) in ${cwd} [model: ${agent.model ?? "default"}]`);
    const { pipeToGrokCli } = await import("../agents/backends/grok-cli.ts");
    return await runInCwd(cwd, () =>
      pipeToGrokCli(prompt, onLog, {
        cwd,
        model: agent.model,
        thinkingLevel: agent.thinkingLevel,
        writable: (agent.tools ?? []).includes("Bash"),
      }),
    );
  }
  if (backend === "cursor") {
    onLog(`[auto] cursor run (${prompt.length} chars) in ${cwd} [model: ${agent.model ?? "default"}]`);
    const { pipeToCursorCli } = await import("../agents/backends/cursor-cli.ts");
    return await runInCwd(cwd, () =>
      pipeToCursorCli(prompt, onLog, {
        cwd,
        model: agent.model,
        thinkingLevel: agent.thinkingLevel,
        writable: (agent.tools ?? []).includes("Bash"),
      }),
    );
  }
  if (backend === "fx") {
    onLog(`[auto] fx run (${prompt.length} chars) in ${cwd} [model: ${agent.model ?? "default"}]`);
    const { pipeToFxCli } = await import("../agents/backends/fx-cli.ts");
    return await runInCwd(cwd, () =>
      pipeToFxCli(prompt, onLog, {
        cwd,
        model: agent.model,
        writable: (agent.tools ?? []).includes("Bash"),
      }),
    );
  }
  if (backend === "hermes") {
    throw new Error("Hermes has been removed. Select another auto-agent backend.");
  }
  return await runClaude(prompt, cwd, onLog, agent.tools ?? [], {
    model: agent.model,
    thinkingLevel: agent.thinkingLevel,
    claudeAccountId: agent.claudeAccountId,
  });
}

export async function runAutoAgent(
  agent: AutoAgent,
  onLog: (s: string) => void = () => {},
): Promise<Finding[]> {
  // Mark in-flight synchronously (before the first await) so a manual /run is
  // already "running" by the time the POST returns; always clear when done.
  markRunning(agent.id);
  try {
    return await runAutoAgentInner(agent, onLog);
  } finally {
    clearRunning(agent.id);
  }
}

/**
 * Prior-findings context appended to an agent's prompt.
 *
 * Dismissal silences an OPINION, not a broken system. Feeding every dismissed
 * title back as "do NOT resurface" also muted recurring health checks: a daily
 * e2e went red, the finding was dismissed, and the agent then stayed silent
 * through every later red run — the test stayed broken for a day with nothing
 * alerting. It also contradicted store.ts, which deliberately counts
 * `dismissed` as UNRESOLVED so repeats escalate. The two mechanisms were
 * fighting and the prompt won.
 *
 * So HIGH severity is never suppressed. If one recurs the agent reports it,
 * recordRecurrence matches the still-unresolved title, and the occurrence
 * count escalates it back into a notification. Low/med dismissals still stick,
 * which is where the anti-noise value actually was.
 *
 * Exported for test — this rule is the difference between a muted outage and
 * an alert, so it is worth pinning directly.
 */
export function buildFindingFeedback(mine: Finding[]): string {
  const dismissed = mine
    .filter((f) => f.status === "dismissed" && f.severity !== "high")
    .slice(0, 20);
  const open = mine.filter((f) => f.status === "open").slice(0, 20);

  let feedback = "";
  if (dismissed.length) {
    feedback +=
      "\n\n## The human DISMISSED these — do NOT resurface them:\n" +
      dismissed.map((f) => `- ${f.title}`).join("\n");
  }
  if (open.length) {
    feedback +=
      "\n\n## Already open (don't repeat):\n" +
      open.map((f) => `- ${f.title}`).join("\n");
  }
  return feedback;
}

export type FindingDraft = {
  title: string;
  severity: Severity;
  reasoning: string[];
  suggest?: string;
};

/**
 * Normalize raw parsed findings into what will actually be filed: drop the
 * untitled, order most-severe-first, then cap.
 *
 * Order before cap is the whole point. A confused agent that lists five nits
 * ahead of one outage must not have the outage truncated away — the cap has to
 * drop the least important finding, never the most. Exported because that
 * guarantee is worth pinning directly in a test rather than inferring it from
 * the runner's behavior.
 */
export function rankAndCap(
  parsed: unknown[],
  onLog: (s: string) => void = () => {},
): FindingDraft[] {
  const candidates = parsed
    .map((raw) => {
      const f = raw as Record<string, unknown>;
      return {
        title: String(f.title ?? "").trim(),
        severity: normSeverity(f.severity),
        reasoning: Array.isArray(f.reasoning) ? f.reasoning.map((r) => String(r)).slice(0, 6) : [],
        suggest: f.suggest ? String(f.suggest) : undefined,
      };
    })
    .filter((f) => {
      if (!f.title) onLog("[auto] finding had no title — skipping");
      return f.title.length > 0;
    })
    // Drop verbatim repeats within one run. A model listing the same problem
    // twice is an artifact, not evidence of persistence, so it must not reach
    // recordRecurrence and inflate the occurrence count. Distinct-but-similar
    // titles are deliberately NOT merged here — that is recurrence's job, and
    // it is scoped to exclude rows this same run already consumed.
    .filter((f, i, all) => {
      const first = all.findIndex((o) => o.title.toLowerCase() === f.title.toLowerCase());
      if (first !== i) onLog(`[auto] dropping duplicate finding in same run: ${f.title}`);
      return first === i;
    })
    // Sort is stable, so the agent's own ordering survives within a severity.
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  if (candidates.length > MAX_FINDINGS_PER_RUN) {
    onLog(
      `[auto] agent reported ${candidates.length} findings — keeping the ${MAX_FINDINGS_PER_RUN} most severe`,
    );
  }
  return candidates.slice(0, MAX_FINDINGS_PER_RUN);
}

async function runAutoAgentInner(
  agent: AutoAgent,
  onLog: (s: string) => void = () => {},
): Promise<Finding[]> {
  const mine = (await listFindings()).filter((f) => f.agentId === agent.id);
  const feedback = buildFindingFeedback(mine);

  const prompt = `${SYSTEM}\n\n## Instruction\n${agent.prompt}${feedback}`;
  // The agent's base repo (chosen from the repo list in the UI) is where it runs
  // and from which it inherits .claude/settings.json. If it's unset, fall back to
  // the repo root but say so loudly — a missing base means the agent is watching
  // the wrong tree, which is exactly the silent-misconfig we want surfaced.
  const cwd = agent.cwd ?? PATHS.root;
  if (!agent.cwd) {
    onLog(`[auto] WARNING: agent "${agent.id}" has no base repo (cwd) — defaulting to ${PATHS.root}; set one in the editor`);
  }
  // For the native push alert only — see push-native.ts — which names the
  // project a finding is about instead of quoting the finding itself.
  const project = projectName(cwd);
  const result = await runSelectedBackend(agent, prompt, cwd, onLog);

  const parsed = parseFindings(result);
  if (parsed === null) {
    onLog("[auto] no parseable finding — treating as silence");
    return [];
  }
  if (parsed.length === 0) {
    onLog("[auto] agent surfaced nothing");
    return [];
  }

  const filed: Finding[] = [];
  // Rows this run has already claimed. Recurrence matching is digit-insensitive,
  // so without this the second of two per-host findings merges into the first.
  const consumed = new Set<string>();
  for (const c of rankAndCap(parsed, onLog)) {
    // Recurrence is signal, not noise. Previously a repeat observation was
    // dropped on the floor; now it bumps the occurrence count and re-surfaces
    // the finding, so "reported 4 times" becomes visible instead of invisible.
    //
    // `consumed` keeps that scoped ACROSS runs only. Two findings from the same
    // run never collapse into each other, however similar their titles look to
    // the digit-stripping matcher — rankAndCap has already removed the verbatim
    // repeats, so anything still here is a distinct problem.
    const recurred = await recordRecurrence(agent.id, c.title, consumed);
    if (recurred) {
      consumed.add(recurred.id);
      const n = recurred.occurrences ?? 2;
      onLog(`[auto] recurrence #${n} of an unresolved finding: ${c.title}`);
      // Re-notify on escalation thresholds rather than on every repeat: the 2nd
      // sighting says "this is persistent", and every 5th says "this is still
      // being ignored". Silence in between avoids retraining you to swipe it away.
      if (n === 2 || n % 5 === 0) {
        void notifyAll({ notification: findingNotification(recurred, n, project) }).catch(() => {});
      }
      filed.push(recurred);
      continue;
    }
    const finding = await addFinding({
      agentId: agent.id,
      title: c.title,
      severity: c.severity,
      reasoning: c.reasoning,
      suggest: c.suggest,
    });
    consumed.add(finding.id);
    onLog(`[auto] new finding: ${c.title}`);
    // Wake installed PWAs via Web Push, carrying the finding in the message so
    // devices on a hosted surface can render it without calling back to this
    // box. Best-effort — never let a push failure sink the run.
    void notifyAll({ notification: findingNotification(finding, undefined, project) }).catch(() => {});
    filed.push(finding);
  }
  return filed;
}
