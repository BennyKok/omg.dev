import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MUSE_PROBE_FORCE_MIN_MS,
  MUSE_PROBE_TTL_MS,
  getProviderUsage,
  museProbeDue,
  museUsageWindows,
  parseMuseSubscriptionEvent,
} from "./usage.ts";
import { PATHS } from "./config.ts";

// Captured verbatim from api.meta.ai /v1/responses (stream) on 2026-09-02.
const SSE = [
  "event: response.created",
  'data: {"type":"response.created","response":{"id":"resp_1"}}',
  "",
  "event: response.subscription_usage",
  'data: {"subscription":{"tier":"27681631238169137","weekly":{"resets_at":1788739200,"used_percent":12},"window":{"resets_at":1788401795,"used_percent":40,"window_duration_mins":300}},"type":"response.subscription_usage"}',
  "",
  "event: response.output_item.added",
  'data: {"type":"response.output_item.added"}',
  "",
].join("\n");

describe("muse subscription parsing", () => {
  test("pulls the subscription object out of the stream", () => {
    expect(parseMuseSubscriptionEvent(SSE)).toEqual({
      tier: "27681631238169137",
      weekly: { resets_at: 1788739200, used_percent: 12 },
      window: { resets_at: 1788401795, used_percent: 40, window_duration_mins: 300 },
    });
    expect(parseMuseSubscriptionEvent(SSE.slice(0, 120))).toBeNull();
  });

  test("maps the 5-hour window and the weekly window onto usage rings", () => {
    expect(museUsageWindows(parseMuseSubscriptionEvent(SSE)!)).toEqual([
      { label: "5 hr", pct: 40, resetsAt: 1788401795000 },
      { label: "Weekly", pct: 12, resetsAt: 1788739200000 },
    ]);
  });

  test("a probe is due once the reading is an hour old, five minutes on force, or after a window reset", () => {
    const now = 10_000_000_000;
    const fresh = { at: now - 60_000, snapshot: { window: { resets_at: (now + 3_600_000) / 1000 } } };
    expect(museProbeDue(null, false, now)).toBe(true);
    expect(museProbeDue(fresh, false, now)).toBe(false);
    expect(museProbeDue(fresh, true, now)).toBe(false);
    expect(museProbeDue({ ...fresh, at: now - MUSE_PROBE_FORCE_MIN_MS }, true, now)).toBe(true);
    expect(museProbeDue({ ...fresh, at: now - MUSE_PROBE_TTL_MS }, false, now)).toBe(true);
    const rolled = { at: now - 10 * 60_000, snapshot: { window: { resets_at: (now - 1000) / 1000 } } };
    expect(museProbeDue(rolled, false, now)).toBe(true);
  });
});

describe("muse usage provider", () => {
  const realFetch = globalThis.fetch;
  const realHome = process.env.HOME;
  const realData = PATHS.data;
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lfg-usage-muse-"));
    process.env.HOME = join(root, "home");
    mkdirSync(join(process.env.HOME, ".config", "muse"), { recursive: true });
    mkdirSync(join(root, "data"), { recursive: true });
    (PATHS as { data: string }).data = join(root, "data");
    delete process.env.META_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env.HOME = realHome;
    (PATHS as { data: string }).data = realData;
    rmSync(root, { recursive: true, force: true });
  });

  test("probes once with the stored key, then serves the disk cache without a second prompt", async () => {
    writeFileSync(
      join(process.env.HOME!, ".config", "muse", "auth.json"),
      JSON.stringify({ schema_version: 1, providers: { meta: { api_key: "muse-key" } } }),
    );
    const calls: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push(String(input));
      const auth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
      if (auth !== "Bearer muse-key") throw new Error("missing bearer");
      const body = JSON.parse(String(init?.body)) as { max_output_tokens?: number; stream?: boolean };
      expect(body.max_output_tokens).toBe(16);
      expect(body.stream).toBe(true);
      return new Response(SSE, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;

    const first = await getProviderUsage("muse", { force: true });
    expect(first?.available).toBe(true);
    expect(first?.windows?.map((w) => w.pct)).toEqual([40, 12]);
    expect(calls).toHaveLength(1);

    // Same reading, forced through the in-memory cache: the disk cache is
    // fresh, so the probe is skipped and no prompt is spent.
    const second = await getProviderUsage("muse", { force: true });
    expect(second?.windows?.map((w) => w.pct)).toEqual([40, 12]);
    expect(calls).toHaveLength(1);
  });

  test("no credential reports as not signed in without touching the network", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network must not be used");
    }) as unknown as typeof fetch;
    const usage = await getProviderUsage("muse", { force: true });
    expect(usage?.available).toBe(false);
    expect(usage?.note).toBe("Not signed in on this box");
  });
});
