// Prompt enhancer for the "new auto agent" form. The user types a rough idea of
// what they want watched; this rewrites it into a crisp, well-structured watch
// agent instruction that matches what the runner expects (gather your own
// context with read-only tools, surface AT MOST one concrete finding, silence
// is the default). It's a pure text generation — no tools — so it can't wander
// off reading the repo; it only sharpens the words.

import { pipeToClaudeAiSdk } from "../agents/backends/claude-ai-sdk.ts";
import { runInCwd } from "./cwd-lock.ts";

// Read-only tools the compose/enhance pass uses to inspect the target repo so
// the generated prompt is grounded in real paths, frameworks, and tooling —
// not generic guesses. No Bash/Write: this only reads.
const INSPECT_TOOLS = ["Read", "Grep", "Glob"];

// Run a one-shot generation, optionally inspecting `cwd`. When a repo is given
// we grant read-only tools and scope the process cwd to it (serialized via the
// shared lock) so the model can actually look at the codebase; otherwise it's a
// pure tool-less rewrite.
async function generate(
  prompt: string,
  cwd: string | undefined,
  onLog: (s: string) => void,
): Promise<string> {
  if (cwd) {
    return runInCwd(cwd, () =>
      pipeToClaudeAiSdk(prompt, onLog, { allowedTools: INSPECT_TOOLS }),
    );
  }
  // No repo → no tools. Keeping the list empty also implicitly excludes
  // AskUserQuestion, which a headless caller can't answer.
  return pipeToClaudeAiSdk(prompt, onLog, { allowedTools: [] });
}

const REPO_NOTE = `\n\nYou are running INSIDE the agent's target repo with read-only tools (Read, Grep, Glob). INSPECT IT before writing: look at the directory layout, manifests (package.json, go.mod, etc.), config, frameworks, and key source/doc files. Ground the instruction in the REAL paths, tools, and conventions you find here — name actual files and directories, not placeholders. Do not invent paths you haven't confirmed exist.`;

const META = `You are a prompt engineer. Rewrite the user's rough idea into a sharp instruction for an autonomous "watch agent".

How that agent runs (write the instruction to fit this, do NOT restate it):
- It runs on a schedule as a real Claude session with READ-ONLY tools (Read, Grep, Glob, WebSearch, WebFetch) and gathers its own context.
- Each run it decides whether there is ONE finding worth surfacing as a notification. Most runs should surface nothing — silence is the default, not a padded report.

Write the enhanced instruction so it:
- Opens by naming what the agent watches and why it matters ("You watch ...").
- Says concretely WHERE to look (paths, repos, URLs, signals) and WHAT counts as actionable vs noise.
- Is strict about the bar: only surface something concrete, high-leverage, and actionable; never filler or routine status.
- Stays tight — a few short paragraphs or bullet sections. No preamble, no meta commentary.

Output ONLY the enhanced instruction text. No markdown code fence, no "Here is", no surrounding quotes.`;

export async function enhanceAutoPrompt(
  rough: string,
  name: string | undefined,
  cwd: string | undefined,
  onLog: (s: string) => void = () => {},
): Promise<string> {
  const idea = rough.trim();
  if (!idea) throw new Error("nothing to enhance — write a rough idea first");
  const header = name?.trim() ? `Agent name: ${name.trim()}\n\n` : "";
  const prompt = `${META}${cwd ? REPO_NOTE : ""}\n\n## The user's rough idea\n${header}${idea}`;
  const out = await generate(prompt, cwd, onLog);
  const cleaned = stripFence(out).trim();
  if (!cleaned) throw new Error("enhancer produced no output");
  return cleaned;
}

// One-shot "compose": turn a single freeform prompt ("watch X and tell me when
// Y") into a complete auto-agent draft — a name, a cron schedule, and the
// enhanced watch instruction. This backs the single-box create UI: the user
// types one thing, we derive the rest. Schedule/name are best-effort defaults
// the user can tweak afterward in the full editor.

export type ComposedAgent = { name: string; schedule: string; prompt: string };

const COMPOSE_META = `You turn a user's single freeform request into a complete autonomous "watch agent" definition.

The agent runs on a schedule as a real Claude session with READ-ONLY tools (Read, Grep, Glob, WebSearch, WebFetch), gathers its own context, and each run decides whether there is ONE finding worth surfacing as a notification. Most runs surface nothing — silence is the default.

Return ONLY a JSON object (no prose, no code fence) with exactly these keys:
{
  "name": "<short kebab-case id, 2-4 words, e.g. dep-cve-watch>",
  "schedule": "<5-field cron expression for how often to run; infer cadence from the request, default \\"0 9 * * *\\" (daily 9am) if unstated>",
  "prompt": "<the full watch instruction, written exactly as the enhanced prompt described below>"
}

The "prompt" value must:
- Open by naming what the agent watches and why it matters ("You watch ...").
- Say concretely WHERE to look (paths, repos, URLs, signals) and WHAT counts as actionable vs noise.
- Be strict about the bar: only surface something concrete, high-leverage, and actionable; never filler or routine status.
- Stay tight — a few short paragraphs or bullet sections.`;

export async function composeAutoAgent(
  rough: string,
  cwd: string | undefined,
  onLog: (s: string) => void = () => {},
): Promise<ComposedAgent> {
  const idea = rough.trim();
  if (!idea) throw new Error("nothing to compose — describe the agent first");
  const prompt = `${COMPOSE_META}${cwd ? REPO_NOTE : ""}\n\n## The user's request\n${idea}`;
  const out = await generate(prompt, cwd, onLog);
  const obj = parseJsonObject(out);
  if (!obj) throw new Error("composer did not return valid JSON");
  const name = slugName(String(obj.name ?? "").trim()) || "watch-agent";
  const schedule = validCron(String(obj.schedule ?? "").trim())
    ? String(obj.schedule).trim()
    : "0 9 * * *";
  const composedPrompt = stripFence(String(obj.prompt ?? "")).trim();
  if (!composedPrompt) throw new Error("composer produced no prompt");
  return { name, schedule, prompt: composedPrompt };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const tryParse = (s: string): any => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let j = tryParse(text.trim());
  if (!j) {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) j = tryParse(fence[1].trim());
  }
  if (!j) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) j = tryParse(m[0]);
  }
  return j && typeof j === "object" ? j : null;
}

function slugName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// A 5-field cron with each field a plausible token. Mirrors the scheduler's own
// 5-field expectation — we only need to reject obviously-bad output here.
function validCron(expr: string): boolean {
  const f = expr.split(/\s+/);
  return f.length === 5 && f.every((p) => /^[\d*,\-/]+$/.test(p));
}

// The meta-prompt asks for raw text, but models sometimes wrap it in a fence
// anyway. Strip a single leading/trailing ``` block if the whole thing is one.
function stripFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:[a-z]*)?\n([\s\S]*?)\n```$/i);
  return m ? m[1] : t;
}
