import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeAccountConfigDir, createClaudeAccount } from "./claude-accounts.ts";
import { getAllUsage, getProviderUsage, listUsageProviders } from "./usage.ts";

describe("usage providers", () => {
  const originalHome = process.env.HOME;
  const originalStore = process.env.LFG_CLAUDE_ACCOUNTS_PATH;
  const originalFetch = globalThis.fetch;
  let root = "";

  function connect(configDir: string, token: string): void {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: token } }),
      { mode: 0o600 },
    );
  }

  /** Anthropic's usage endpoint, answering with a per-token utilization. */
  function stubUsageEndpoint(byToken: Record<string, number>): { calls: string[] } {
    const calls: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input);
      const auth = String(
        (init?.headers as Record<string, string> | undefined)?.Authorization ?? "",
      );
      calls.push(url);
      if (!url.includes("api.anthropic.com")) throw new Error(`unexpected fetch ${url}`);
      const token = auth.replace("Bearer ", "");
      return new Response(
        JSON.stringify({
          five_hour: { utilization: byToken[token] ?? 0, resets_at: null },
          seven_day: { utilization: (byToken[token] ?? 0) / 2, resets_at: null },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    return { calls };
  }

  function setup(): { first: string; second: string } {
    root = mkdtempSync(join(tmpdir(), "lfg-usage-providers-"));
    process.env.HOME = join(root, "home");
    process.env.LFG_CLAUDE_ACCOUNTS_PATH = join(root, "data", "accounts.json");
    connect(join(process.env.HOME, ".claude"), "token-one");
    const second = createClaudeAccount();
    connect(claudeAccountConfigDir(second.id)!, "token-two");
    return { first: "default", second: second.id };
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalStore === undefined) delete process.env.LFG_CLAUDE_ACCOUNTS_PATH;
    else process.env.LFG_CLAUDE_ACCOUNTS_PATH = originalStore;
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  test("lists one Claude source per connected account, numbered once there are two", () => {
    const { first, second } = setup();
    const providers = listUsageProviders();
    const claude = providers.filter((provider) => provider.kind === "claude");

    expect(claude).toMatchObject([
      { id: `claude:${first}`, label: "Claude 1", accountId: first, accountNumber: 1 },
      { id: `claude:${second}`, label: "Claude 2", accountId: second, accountNumber: 2 },
    ]);
    // The other providers still come along, each as its own source.
    expect(providers.map((provider) => provider.kind)).toEqual([
      "claude",
      "claude",
      "codex",
      "cursor",
      "grok",
      "hermes",
      "opencode",
    ]);
  });

  test("cursor reads included spend and the on-demand cap from the dashboard", async () => {
    root = mkdtempSync(join(tmpdir(), "lfg-usage-providers-"));
    process.env.HOME = join(root, "home");
    mkdirSync(join(process.env.HOME, ".config", "cursor"), { recursive: true });
    writeFileSync(
      join(process.env.HOME, ".config", "cursor", "auth.json"),
      JSON.stringify({ accessToken: "cursor-token" }),
    );
    const calls: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input);
      const auth = String(
        (init?.headers as Record<string, string> | undefined)?.Authorization ?? "",
      );
      calls.push(url);
      if (auth !== "Bearer cursor-token") throw new Error("missing bearer token");
      if (url.endsWith("GetCurrentPeriodUsage")) {
        return new Response(
          JSON.stringify({
            billingCycleEnd: "1789207832000",
            planUsage: { totalSpend: 7594, limit: 40000 },
            spendLimitUsage: { individualLimit: 20000, individualRemaining: 15000 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("GetPlanInfo")) {
        return new Response(JSON.stringify({ planInfo: { planName: "Ultra" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const usage = await getProviderUsage("cursor", { force: true });
    expect(calls).toHaveLength(2);
    expect(usage).toMatchObject({ id: "cursor", kind: "cursor", available: true, plan: "Ultra" });
    expect(usage?.windows?.[0]).toMatchObject({
      label: "Included",
      resetsAt: 1789207832000,
    });
    expect(usage?.windows?.[0]?.pct).toBeCloseTo(18.985);
    expect(usage?.windows?.[1]).toMatchObject({ label: "On-demand cap", pct: 25 });
  });

  test("an expired cursor token says to sign in again", async () => {
    root = mkdtempSync(join(tmpdir(), "lfg-usage-providers-"));
    process.env.HOME = join(root, "home");
    mkdirSync(join(process.env.HOME, ".config", "cursor"), { recursive: true });
    writeFileSync(
      join(process.env.HOME, ".config", "cursor", "auth.json"),
      JSON.stringify({ accessToken: "cursor-token" }),
    );
    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0]) =>
      new Response("unauthorized", { status: 401 })) as typeof fetch;

    const usage = await getProviderUsage("cursor", { force: true });
    expect(usage).toMatchObject({ available: false });
    expect(usage?.note).toContain("cursor-agent login");
  });

  test("cursor with no CLI sign-in reports as not signed in", async () => {
    root = mkdtempSync(join(tmpdir(), "lfg-usage-providers-"));
    process.env.HOME = join(root, "home");

    const usage = await getProviderUsage("cursor", { force: true });
    expect(usage).toMatchObject({ available: false, note: "Not signed in on this box" });
  });

  test("a single connected account keeps the plain Claude label", () => {
    root = mkdtempSync(join(tmpdir(), "lfg-usage-providers-"));
    process.env.HOME = join(root, "home");
    process.env.LFG_CLAUDE_ACCOUNTS_PATH = join(root, "data", "accounts.json");
    connect(join(process.env.HOME, ".claude"), "token-solo");

    expect(listUsageProviders().filter((provider) => provider.kind === "claude")).toMatchObject([
      { id: "claude:default", label: "Claude", accountNumber: 1 },
    ]);
  });

  test("each account reports its own usage, fetched independently", async () => {
    const { first, second } = setup();
    const { calls } = stubUsageEndpoint({ "token-one": 30, "token-two": 80 });

    const one = await getProviderUsage(`claude:${first}`, { force: true });
    expect(calls).toHaveLength(1);
    expect(one).toMatchObject({ id: `claude:${first}`, kind: "claude", available: true });
    expect(one?.windows?.[0]).toMatchObject({ label: "5 hr", pct: 30 });

    // Asking for one account never drags the other's request along with it.
    const two = await getProviderUsage(`claude:${second}`, { force: true });
    expect(calls).toHaveLength(2);
    expect(two?.windows?.[0]).toMatchObject({ label: "5 hr", pct: 80 });
  });

  test("a fresh read is served from cache; force re-queries", async () => {
    const { first } = setup();
    const { calls } = stubUsageEndpoint({ "token-one": 42 });

    await getProviderUsage(`claude:${first}`, { force: true });
    expect(calls).toHaveLength(1);
    await getProviderUsage(`claude:${first}`);
    expect(calls).toHaveLength(1);
    await getProviderUsage(`claude:${first}`, { force: true });
    expect(calls).toHaveLength(2);
  });

  test("concurrent reads of one source share a single round-trip", async () => {
    const { second } = setup();
    const { calls } = stubUsageEndpoint({ "token-two": 55 });

    const [a, b] = await Promise.all([
      getProviderUsage(`claude:${second}`),
      getProviderUsage(`claude:${second}`),
    ]);
    expect(calls).toHaveLength(1);
    expect(a?.windows?.[0]?.pct).toBe(55);
    expect(b?.windows?.[0]?.pct).toBe(55);
  });

  test("an unknown source id is reported rather than guessed at", async () => {
    setup();
    expect(await getProviderUsage("claude:not-a-real-account")).toBeNull();
  });

  test("the combined feed carries every account and drops removed ones", async () => {
    const { first, second } = setup();
    stubUsageEndpoint({ "token-one": 10, "token-two": 20 });

    const all = await getAllUsage({ force: true });
    const claude = all.filter((provider) => provider.kind === "claude");
    expect(claude.map((provider) => provider.id)).toEqual([
      `claude:${first}`,
      `claude:${second}`,
    ]);
    expect(claude.map((provider) => provider.windows?.[0]?.pct)).toEqual([10, 20]);
    // Every source answers, including the ones with nothing signed in.
    expect(all.every((provider) => typeof provider.available === "boolean")).toBe(true);
  });
});
