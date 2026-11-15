import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseAntigravityUsage, readAntigravityUsage } from "./antigravity-usage.ts";

// Captured from `agy -p /usage --output-format json` (agy 1.5.9, Google AI Pro).
const SAMPLE = JSON.stringify({
  conversation_id: "",
  status: "SUCCESS",
  response: "Gemini Models\tWeekly Limit Remaining\t100%\t2026-11-22T05:33:02Z\n",
  num_turns: 0,
  usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  command: {
    name: "usage",
    data: {
      groups: [
        {
          name: "Gemini Models",
          buckets: [
            { id: "gemini-weekly", window: "weekly", remaining_fraction: 0.75, reset_time: "2026-11-22T05:33:02Z" },
            { id: "gemini-5h", window: "5h", remaining_fraction: 1, reset_time: "2026-11-15T10:33:02Z" },
          ],
        },
        {
          name: "Claude and GPT models",
          buckets: [{ id: "3p-5h", window: "5h", remaining_fraction: 0.1, reset_time: "2026-11-15T10:32:55Z" }],
        },
        {
          name: "Gemini 4 Argon",
          buckets: [{ id: "gemini-argon-wtu-weekly", window: "weekly", remaining_fraction: 0.5, reset_time: "bad" }],
        },
      ],
    },
  },
});

describe("parseAntigravityUsage", () => {
  test("turns each quota bucket into a percent-used window", () => {
    const reading = parseAntigravityUsage(SAMPLE);
    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.windows.map((w) => w.label)).toEqual([
      "Gemini Weekly",
      "Gemini 5 hr",
      "Claude/GPT 5 hr",
      "Argon Weekly",
    ]);
    expect(reading.windows.map((w) => Math.round(w.pct!))).toEqual([25, 0, 90, 50]);
    expect(reading.windows[0]!.resetsAt).toBe(Date.parse("2026-11-22T05:33:02Z"));
    expect(reading.windows[3]!.resetsAt).toBeNull();
  });

  test("reports a failed or empty answer as unavailable", () => {
    expect(parseAntigravityUsage("not json").ok).toBe(false);
    const failed = parseAntigravityUsage(JSON.stringify({ status: "ERROR", response: "You are not logged in.\nmore" }));
    expect(failed).toEqual({ ok: false, note: "Antigravity: You are not logged in." });
    expect(parseAntigravityUsage(JSON.stringify({ status: "SUCCESS", command: { data: { groups: [] } } })).ok).toBe(false);
  });
});

describe("readAntigravityUsage", () => {
  const base = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "lfg", "tmp");
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  function fakeAgy(body: string): string {
    mkdirSync(base, { recursive: true });
    dir = mkdtempSync(join(base, "agy-usage-"));
    const path = join(dir, "agy");
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
  }

  test("runs the read-only /usage command and parses its JSON", async () => {
    const agy = fakeAgy(`echo "$@" > "$(dirname "$0")/args"; cat <<'JSON'\n${SAMPLE}\nJSON`);
    const reading = await readAntigravityUsage(agy);
    expect(reading.ok).toBe(true);
    const seen = await Bun.file(join(dir, "args")).text();
    expect(seen).toContain("-p /usage --output-format json");
  });

  test("gives up on an agy that never answers", async () => {
    const agy = fakeAgy("exec sleep 30");
    const reading = await readAntigravityUsage(agy, 300);
    expect(reading).toEqual({ ok: false, note: "Antigravity did not answer. Check that it is signed in." });
  });

  test("says when agy is not installed", async () => {
    expect(await readAntigravityUsage("/nonexistent/agy")).toEqual({ ok: false, note: "Antigravity is not installed" });
  });
});
