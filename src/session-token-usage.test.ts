import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fromStored, sessionTokenUsage } from "./session-token-usage.ts";

const roots: string[] = [];

function fixturePath(provider: "codex" | "claude", rows: unknown[]): string {
  const root = join(tmpdir(), `lfg-session-usage-${crypto.randomUUID()}`);
  roots.push(root);
  const dir = provider === "codex" ? join(root, ".codex", "sessions") : join(root, ".claude", "projects");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "session.jsonl");
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n"));
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("sessionTokenUsage", () => {
  test("reads authoritative Codex counters and estimates prompt categories", async () => {
    const path = fixturePath("codex", [
      {
        type: "session_meta",
        payload: { base_instructions: { text: "fallback base instructions" } },
      },
      {
        type: "turn_context",
        payload: { model: "gpt-test", summary: "A compacted conversation summary." },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "developer",
          content: [
            { type: "input_text", text: "General system rules." },
            {
              type: "input_text",
              text: "<skills_instructions>## Skills\n- imagegen</skills_instructions>",
            },
          ],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "=== USER TASK ===\nBuild the usage view." }],
        },
      },
      {
        type: "response_item",
        payload: { type: "function_call", arguments: "{\"cmd\":\"pwd\"}" },
      },
      {
        type: "response_item",
        payload: { type: "function_call_output", output: "/work" },
      },
      {
        type: "event_msg",
        timestamp: "2026-07-28T00:00:00Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 12_000,
              cached_input_tokens: 8_000,
              output_tokens: 900,
              reasoning_output_tokens: 300,
              total_tokens: 12_900,
            },
            last_token_usage: { input_tokens: 4_000, output_tokens: 200 },
            model_context_window: 10_000,
          },
        },
      },
    ]);

    const usage = await sessionTokenUsage(crypto.randomUUID(), path);

    expect(usage.source).toBe("codex-transcript");
    expect(usage.context).toEqual({ used: 4_200, max: 10_000, free: 5_800, percent: 42 });
    expect(usage.totals).toMatchObject({
      input: 4_000,
      output: 900,
      cacheRead: 8_000,
      reasoning: 300,
      total: 12_900,
    });
    expect(usage.categories.map((category) => category.name)).toEqual(
      expect.arrayContaining([
        "System prompt",
        "Skills",
        "User messages",
        "Tool calls",
        "Tool results",
        "Compaction summary",
        "Other context",
      ]),
    );
    expect(usage.categories.every((category) => category.accuracy === "estimated")).toBe(true);
  });

  test("deduplicates repeated Claude transcript envelopes by request id", async () => {
    const usage = {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 40,
    };
    const path = fixturePath("claude", [
      {
        type: "assistant",
        requestId: "request-1",
        timestamp: "2026-07-28T00:00:00Z",
        message: { id: "message-1", model: "claude-test", usage },
      },
      {
        type: "assistant",
        requestId: "request-1",
        timestamp: "2026-07-28T00:00:01Z",
        message: { id: "message-1", model: "claude-test", usage },
      },
    ]);

    const result = await sessionTokenUsage(crypto.randomUUID(), path);

    expect(result.source).toBe("claude-transcript");
    expect(result.context.used).toBe(100);
    expect(result.totals).toMatchObject({
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheWrite: 40,
      total: 100,
    });
  });
});

describe("fromStored", () => {
  // Shape taken from a real recorded snapshot. `getContextUsage()` returns a
  // layout of the whole window: the non-deferred rows tile `maxTokens`, so the
  // array carries a "Free space" remainder plus deferred (advertised but not
  // loaded) tool schemas.
  const snapshot = {
    updatedAt: 1_700_000_000_000,
    model: "opus",
    context: {
      model: "opus",
      totalTokens: 317_342,
      maxTokens: 1_000_000,
      rawMaxTokens: 1_000_000,
      percentage: 32,
      categories: [
        { name: "System prompt", tokens: 214, color: "#a78bfa" },
        { name: "System tools", tokens: 13_590, color: "#60a5fa" },
        { name: "MCP tools", tokens: 878, color: "#34d399" },
        { name: "MCP tools (deferred)", tokens: 254_465, color: "#fbbf24", isDeferred: true },
        { name: "System tools (deferred)", tokens: 13_101, color: "#fb7185", isDeferred: true },
        { name: "Memory files", tokens: 1_680, color: "#22d3ee" },
        { name: "Skills", tokens: 1_875, color: "#c084fc" },
        { name: "Messages", tokens: 299_105, color: "#94a3b8" },
        { name: "Free space", tokens: 682_658, color: "#94a3b8" },
      ],
    },
    totals: {
      input: 2_051,
      output: 176_903,
      cacheRead: 45_176_018,
      cacheWrite: 697_512,
      reasoning: 0,
      total: 46_052_484,
      costUsd: 33.9897,
    },
  };

  test("reports only categories that consume context", () => {
    const usage = fromStored(snapshot);
    expect(usage.categories.map((category) => category.name)).toEqual([
      "System prompt",
      "System tools",
      "MCP tools",
      "Memory files",
      "Skills",
      "Messages",
    ]);
  });

  test("categories sum to the reported context use, not the window size", () => {
    const usage = fromStored(snapshot);
    const sum = usage.categories.reduce((total, category) => total + category.tokens, 0);
    expect(sum).toBe(317_342);
    expect(usage.context.used).toBe(317_342);
    // The regression: unfiltered rows summed to 1,267,566 — past `maxTokens`.
    expect(sum).toBeLessThanOrEqual(usage.context.max ?? 0);
  });

  test("keeps deferred tool schemas out of the breakdown", () => {
    const usage = fromStored(snapshot);
    expect(usage.categories.some((category) => category.name.includes("deferred"))).toBe(false);
    expect(usage.categories.some((category) => category.name === "Free space")).toBe(false);
  });

  test("drops the reserved autocompact buffer", () => {
    const usage = fromStored({
      ...snapshot,
      context: {
        ...snapshot.context,
        totalTokens: 50_995,
        maxTokens: 967_000,
        categories: [
          { name: "Messages", tokens: 34_600, color: "#94a3b8" },
          { name: "Autocompact buffer", tokens: 33_000, color: "#fbbf24" },
          { name: "Free space", tokens: 875_502, color: "#94a3b8" },
        ],
      },
    });
    expect(usage.categories.map((category) => category.name)).toEqual(["Messages"]);
  });

  test("still reports totals when no context snapshot exists", () => {
    const usage = fromStored({ ...snapshot, context: null });
    expect(usage.categories).toEqual([]);
    expect(usage.totals?.total).toBe(46_052_484);
    expect(usage.context.used).toBeNull();
    expect(usage.accuracy).toBe("mixed");
  });
});
