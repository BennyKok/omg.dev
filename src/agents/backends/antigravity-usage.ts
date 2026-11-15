// Antigravity plan usage, read from agy's own read-only `/usage` command.
//
// `agy -p /usage --output-format json` answers locally from the quota agy
// already tracks: no model turn (`num_turns: 0`, zero tokens) and no prompt.
// omg.dev never reads agy's Google credentials and never calls Google's quota
// API itself; agy owns both, the same as for sessions and the status probe.
//
// One run costs about 4 s and 230 MB, so callers cache the result for minutes,
// not seconds. A signed-out agy waits for a login instead of exiting, so every
// run is killed after a time limit.
import { mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { antigravityEnv } from "./antigravity-env.ts";

export type AntigravityUsageWindow = {
  label: string;
  /** 0–100 percent of the window consumed, or null if unknown. */
  pct: number | null;
  resetsAt: number | null;
};

export type AntigravityUsageReading =
  | { ok: true; windows: AntigravityUsageWindow[] }
  | { ok: false; note: string };

type UsageBucket = {
  name?: unknown;
  window?: unknown;
  remaining_fraction?: unknown;
  reset_time?: unknown;
};

type UsageGroup = { name?: unknown; buckets?: unknown };

function windowName(window: unknown, name: unknown): string {
  if (window === "5h") return "5 hr";
  if (window === "weekly") return "Weekly";
  if (typeof window === "string" && window) return window;
  return typeof name === "string" && name ? name : "Limit";
}

/** Short group names for the ring legend; unknown groups keep agy's name. */
function groupName(name: unknown): string {
  if (typeof name !== "string" || !name.trim()) return "Antigravity";
  if (name === "Gemini Models") return "Gemini";
  if (name === "Claude and GPT models") return "Claude/GPT";
  return name.replace(/^Gemini 4 /, "");
}

/**
 * Turn the JSON `agy -p /usage --output-format json` prints into usage windows.
 * Each quota bucket is one window: "<group> <window>", percent used.
 */
export function parseAntigravityUsage(stdout: string): AntigravityUsageReading {
  let parsed: {
    status?: unknown;
    response?: unknown;
    command?: { name?: unknown; data?: { groups?: unknown } };
  };
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return { ok: false, note: "Antigravity usage answer was not JSON" };
  }
  if (parsed.status !== "SUCCESS") {
    const said = typeof parsed.response === "string" ? parsed.response.trim().split("\n")[0] : "";
    return { ok: false, note: said ? `Antigravity: ${said.slice(0, 160)}` : "Antigravity usage is unavailable" };
  }
  const groups = Array.isArray(parsed.command?.data?.groups) ? (parsed.command!.data!.groups as UsageGroup[]) : [];
  const windows: AntigravityUsageWindow[] = [];
  for (const group of groups) {
    const buckets = Array.isArray(group?.buckets) ? (group.buckets as UsageBucket[]) : [];
    for (const bucket of buckets) {
      const remaining = bucket?.remaining_fraction;
      const pct =
        typeof remaining === "number" && Number.isFinite(remaining)
          ? Math.max(0, Math.min(100, (1 - remaining) * 100))
          : null;
      const reset = typeof bucket?.reset_time === "string" ? Date.parse(bucket.reset_time) : NaN;
      windows.push({
        label: `${groupName(group.name)} ${windowName(bucket?.window, bucket?.name)}`,
        pct,
        resetsAt: Number.isFinite(reset) ? reset : null,
      });
    }
  }
  if (!windows.length) return { ok: false, note: "Antigravity reported no usage limits" };
  return { ok: true, windows };
}

function probeDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "lfg", "antigravity-probe");
}

/** Run agy's read-only `/usage` command and parse it. Never throws. */
export async function readAntigravityUsage(binary: string, timeoutMs = 20_000): Promise<AntigravityUsageReading> {
  const dir = probeDir();
  const logFile = join(dir, `usage-${randomUUID()}.log`);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!Bun.which(binary) && !(await Bun.file(binary).exists()))
      return { ok: false, note: "Antigravity is not installed" };
    const proc = Bun.spawn([binary, "--log-file", logFile, "-p", "/usage", "--output-format", "json"], {
      cwd: dir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      env: antigravityEnv(),
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]).finally(() =>
      clearTimeout(timer),
    );
    if (timedOut) return { ok: false, note: "Antigravity did not answer. Check that it is signed in." };
    return parseAntigravityUsage(stdout);
  } catch (error) {
    return { ok: false, note: error instanceof Error ? error.message : String(error) };
  } finally {
    rmSync(logFile, { force: true });
  }
}
