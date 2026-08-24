// AutoAgentOwner (docs/bot-owned-automations-plan.md §1): every automation
// records who owns it — the user, or a specific bot. This covers the read
// migration that backfills existing ownerless rows, the owner-scoped store
// helpers bot deletion and the per-bot cap rely on, and saveAutoAgent's owner
// defaulting/carry-forward rules.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "../config.ts";

const originalData = PATHS.data;
let testData = "";
let store: typeof import("./store.ts");

beforeAll(async () => {
  testData = await mkdtemp(join(tmpdir(), "lfg-auto-store-"));
  PATHS.data = testData;
  store = await import("./store.ts");
});

afterEach(async () => {
  await rm(join(testData, "auto"), { recursive: true, force: true });
});

afterAll(async () => {
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

describe("normalizeStoredAutoAgents — the owner backfill migration", () => {
  test("a pre-existing row with no owner silently becomes owner: user", () => {
    const legacy = {
      id: "old-row",
      name: "Old row",
      prompt: "check something",
      schedule: "0 9 * * *",
      enabled: true,
      // No `owner` field at all — exactly what every row written before this
      // feature shipped looks like on disk.
    } as unknown as import("./store.ts").AutoAgent;
    const [normalized] = store.normalizeStoredAutoAgents([legacy]);
    expect(normalized.owner).toEqual({ kind: "user" });
  });

  test("a row that already carries an owner is left untouched (no rewrite)", () => {
    const botOwned: import("./store.ts").AutoAgent = {
      id: "bot-row",
      name: "Bot row",
      prompt: "check something",
      schedule: "0 9 * * *",
      enabled: true,
      owner: { kind: "bot", botId: "bot_abc" },
    };
    const [normalized] = store.normalizeStoredAutoAgents([botOwned]);
    expect(normalized).toBe(botOwned); // same object identity: no rewrite happened
  });

  test("the owner backfill and the hermes-disable rule both apply independently", () => {
    const legacyHermes = {
      id: "old-hermes",
      name: "Old hermes",
      prompt: "check something",
      schedule: "0 9 * * *",
      enabled: true,
      agent: "hermes",
    } as unknown as import("./store.ts").AutoAgent;
    const [normalized] = store.normalizeStoredAutoAgents([legacyHermes]);
    expect(normalized.owner).toEqual({ kind: "user" });
    expect(normalized.enabled).toBe(false);
  });

  test("listAutoAgents backfills on read for rows written before this feature shipped", async () => {
    await Bun.write(
      join(testData, "auto", "agents.json"),
      JSON.stringify([
        { id: "legacy", name: "Legacy", prompt: "p", schedule: "0 9 * * *", enabled: true },
      ]),
    );
    const [agent] = await store.listAutoAgents();
    expect(agent.owner).toEqual({ kind: "user" });
  });
});

describe("saveAutoAgent — owner defaulting and carry-forward", () => {
  test("a create with no owner specified defaults to user", async () => {
    const agent = await store.saveAutoAgent({
      id: "created-default",
      name: "Created",
      prompt: "p",
      schedule: "0 9 * * *",
      enabled: true,
    });
    expect(agent.owner).toEqual({ kind: "user" });
  });

  test("a create can be explicitly given a bot owner", async () => {
    const agent = await store.saveAutoAgent({
      id: "created-bot",
      name: "Bot-created",
      prompt: "p",
      schedule: "0 9 * * *",
      enabled: true,
      owner: { kind: "bot", botId: "bot_123" },
    });
    expect(agent.owner).toEqual({ kind: "bot", botId: "bot_123" });
  });

  test("editing without passing owner carries the existing owner forward untouched", async () => {
    await store.saveAutoAgent({
      id: "carried",
      name: "Carried",
      prompt: "p",
      schedule: "0 9 * * *",
      enabled: true,
      owner: { kind: "bot", botId: "bot_carry" },
    });
    const edited = await store.saveAutoAgent({
      id: "carried",
      name: "Carried (renamed)",
      prompt: "p2",
      schedule: "0 10 * * *",
      enabled: true,
      // owner omitted — must not silently reassign to "user".
    });
    expect(edited.owner).toEqual({ kind: "bot", botId: "bot_carry" });
  });
});

describe("owner-scoped store helpers", () => {
  async function seed() {
    await store.saveAutoAgent({
      id: "a1", name: "A1", prompt: "p", schedule: "0 9 * * *", enabled: true,
      owner: { kind: "bot", botId: "bot_a" },
    });
    await store.saveAutoAgent({
      id: "a2", name: "A2", prompt: "p", schedule: "0 9 * * *", enabled: true,
      owner: { kind: "bot", botId: "bot_a" },
    });
    await store.saveAutoAgent({
      id: "b1", name: "B1", prompt: "p", schedule: "0 9 * * *", enabled: true,
      owner: { kind: "bot", botId: "bot_b" },
    });
    await store.saveAutoAgent({
      id: "u1", name: "U1", prompt: "p", schedule: "0 9 * * *", enabled: true,
      owner: { kind: "user" },
    });
  }

  test("countAutoAgentsOwnedByBot counts only that bot's rows", async () => {
    await seed();
    expect(await store.countAutoAgentsOwnedByBot("bot_a")).toBe(2);
    expect(await store.countAutoAgentsOwnedByBot("bot_b")).toBe(1);
    expect(await store.countAutoAgentsOwnedByBot("bot_nonexistent")).toBe(0);
  });

  test("deleteAutoAgentsOwnedByBot removes only that bot's rows and reports the count", async () => {
    await seed();
    const removed = await store.deleteAutoAgentsOwnedByBot("bot_a");
    expect(removed).toBe(2);

    const remaining = await store.listAutoAgents();
    expect(remaining.map((a) => a.id).sort()).toEqual(["b1", "u1"]);
  });

  test("deleting a bot with no owned rows is a no-op that reports zero", async () => {
    await seed();
    const removed = await store.deleteAutoAgentsOwnedByBot("bot_never_existed");
    expect(removed).toBe(0);
    expect(await store.listAutoAgents()).toHaveLength(4);
  });
});

describe("normTitle — recurrence matching keeps #NNN error codes distinct", () => {
  // The worked example that motivated this: a client-error finding titled
  // "Minified React error #185…" and a later one titled "…#310…" used to
  // normalize to the identical key (digit-stripping treated "185" and "310"
  // the same as it treats a byte count or a timestamp). In production that
  // meant every future React-error report — regardless of code — silently
  // recurred onto whichever one was filed first, so a stale #185 finding kept
  // absorbing an unrelated, active #310 regression's occurrences.
  const react185 =
    "Frontend error: Minified React error #185; visit https://react.dev/errors/185 for the full message";
  const react310 =
    "Frontend error: Minified React error #310; visit https://react.dev/errors/310 for the full message";

  test("different #NNN error codes normalize to different keys", () => {
    expect(store.normTitleForTest(react185)).not.toEqual(store.normTitleForTest(react310));
  });

  test("the same #NNN error code still normalizes identically across reports", () => {
    const again =
      "Frontend error: Minified React error #185; visit https://react.dev/errors/185 for a second time";
    // Only the trailing sentence differs, same as the real reporter's fixed
    // "for the full message or use the non-minified…" suffix would collapse
    // to the same generic text either way — the point under test is that the
    // #185 identifier itself still matches #185.
    expect(store.normTitleForTest(react185).includes("#185")).toBe(true);
    expect(store.normTitleForTest(again).includes("#185")).toBe(true);
  });

  test("recordRecurrence files #185 and #310 as separate findings, not one merged row", async () => {
    const first = await store.addFinding({
      agentId: "client-error",
      title: react185,
      reasoning: ["Kind: react"],
      severity: "high",
    });
    // A recurrence of the SAME code re-surfaces the existing row.
    const recurredSame = await store.recordRecurrence("client-error", react185);
    expect(recurredSame?.id).toBe(first.id);
    expect(recurredSame?.occurrences).toBe(2);

    // A DIFFERENT code must not match the #185 row — recordRecurrence returns
    // null (genuinely new) so the caller files it as its own finding, instead
    // of silently inflating #185's occurrence count for a #310 problem.
    const recurredOther = await store.recordRecurrence("client-error", react310);
    expect(recurredOther).toBeNull();

    const second = await store.addFinding({
      agentId: "client-error",
      title: react310,
      reasoning: ["Kind: react"],
      severity: "high",
    });
    expect(second.id).not.toBe(first.id);

    const rows = await store.listFindings();
    const clientErrorRows = rows.filter((r) => r.agentId === "client-error");
    expect(clientErrorRows).toHaveLength(2);
  });

  test("incidental numbers (byte counts, percentages) still collapse across reports", () => {
    // Unlike an error code, these numbers are telemetry, not identity — a
    // moved number is the same problem worsening and must keep merging.
    expect(store.normTitleForTest("sqld WAL is 2.3 GB")).toEqual(
      store.normTitleForTest("sqld WAL is 3.1 GB"),
    );
    expect(store.normTitleForTest("box-1 disk 91% full")).toEqual(
      store.normTitleForTest("box-2 disk 93% full"),
    );
  });
});

describe("fix-dispatch lifecycle — the #185 postmortem", () => {
  // Worked example: a #185 client-error finding, fix dispatched, fix landed
  // four minutes later, and the finding still read "open" two months on
  // because nothing ever wrote the outcome back. These are the store-level
  // links dispatchFixAgent was missing; src/auto/fix-landing.ts is what
  // discovers "landed" from git and drives them.
  const react185Title =
    "Frontend error: Minified React error #185; visit https://react.dev/errors/185 for the full message";

  async function file185(): Promise<import("./store.ts").Finding> {
    return store.addFinding({
      agentId: "client-error",
      title: react185Title,
      reasoning: ["Kind: react", "Component: useSpeechPlayback"],
      severity: "high",
    });
  }

  test("attachFixSession links the dispatched session and clears stale landing evidence", async () => {
    const finding = await file185();
    const linked = await store.attachFixSession(finding.id, "session-a");
    expect(linked?.status).toBe("session");
    expect(linked?.sessionId).toBe("session-a");

    // A finding gone through a whole landed-then-recurred-then-redispatched
    // cycle must not keep showing the OLD commit as if it still applied.
    await store.markFixLanded(finding.id, "deadbee", 1000);
    const relinked = await store.attachFixSession(finding.id, "session-b");
    expect(relinked?.status).toBe("session");
    expect(relinked?.fixCommit).toBeUndefined();
    expect(relinked?.fixLandedAt).toBeUndefined();
  });

  test("markFixLanded only fires from status:session — a human's dismiss/resolve wins over a late signal", async () => {
    const finding = await file185();
    // Never dispatched (no "session" status yet) — nothing to confirm.
    expect(await store.markFixLanded(finding.id, "66732e8")).toBeNull();

    await store.attachFixSession(finding.id, "session-a");
    await store.updateFinding(finding.id, { status: "dismissed" });
    // A landing check that resolves after the human already acted must not
    // overwrite their call.
    expect(await store.markFixLanded(finding.id, "66732e8")).toBeNull();
    const rows = await store.listFindings("dismissed");
    expect(rows.find((r) => r.id === finding.id)?.status).toBe("dismissed");
  });

  test("promoteLandedFixes resolves a fix-landed finding only after the grace window, and only if it hasn't recurred", async () => {
    const finding = await file185();
    await store.attachFixSession(finding.id, "session-a");
    const landedAt = 10_000;
    await store.markFixLanded(finding.id, "66732e8", landedAt);

    // Still inside the grace window — stays fix-landed, not resolved.
    const tooSoon = await store.promoteLandedFixes(landedAt + store.FIX_LANDED_GRACE_MS - 1);
    expect(tooSoon).toHaveLength(0);
    expect((await store.listFindings("fix-landed")).map((r) => r.id)).toContain(finding.id);

    // The #185 finding went quiet for two months — the grace window is long
    // gone, so it promotes.
    const promoted = await store.promoteLandedFixes(landedAt + store.FIX_LANDED_GRACE_MS);
    expect(promoted.map((r) => r.id)).toContain(finding.id);
    const resolvedRow = (await store.listFindings("resolved")).find((r) => r.id === finding.id);
    expect(resolvedRow?.status).toBe("resolved");
    expect(resolvedRow?.fixCommit).toBe("66732e8");
  });

  test("a recurrence during the grace window reopens the finding instead of letting it silently resolve", async () => {
    const finding = await file185();
    await store.attachFixSession(finding.id, "session-a");
    const landedAt = 10_000;
    await store.markFixLanded(finding.id, "66732e8", landedAt);

    // Same #185 error reported again before the grace window elapses — the
    // fix didn't actually hold.
    const recurred = await store.recordRecurrence("client-error", react185Title);
    expect(recurred?.id).toBe(finding.id);
    expect(recurred?.status).toBe("open");

    // Even well past the grace window, promoteLandedFixes must not touch a
    // finding that reopened — it is no longer "fix-landed".
    const promoted = await store.promoteLandedFixes(landedAt + store.FIX_LANDED_GRACE_MS * 10);
    expect(promoted.map((r) => r.id)).not.toContain(finding.id);
    const row = (await store.listFindings()).find((r) => r.id === finding.id);
    expect(row?.status).toBe("open");
  });
});

// The Schedules list toggles `enabled` inline via PATCH /api/auto/agents/:id,
// which is implemented as `saveAutoAgent({ ...storedRow, enabled })`. That
// spread is the whole safety argument for the route, so pin it here: a toggle
// must move `enabled` and NOTHING else.
describe("saveAutoAgent — the inline enable toggle spread", () => {
  const full = {
    name: "Repo review",
    // Deliberately longer than AUTO_AGENT_LIST_PROMPT_CHARS (200). The list
    // response truncates to a preview, so if a toggle ever went through the
    // client's list state instead of the stored row, this is the field that
    // would silently lose its tail.
    prompt: `You are a code reviewer for the vibes repo. ${"detail ".repeat(60)}end-marker`,
    schedule: "0 9 * * *",
    enabled: true,
    cwd: "/home/dev/repos/vibes",
    agent: "grok" as const,
    model: "grok-4.5",
    tools: ["Bash"],
  };

  test("toggling enabled off preserves the full prompt and every other field", async () => {
    const created = await store.saveAutoAgent(full);
    expect(created.prompt.length).toBeGreaterThan(200);

    const stored = await store.getAutoAgent(created.id);
    expect(stored).not.toBeNull();
    const toggled = await store.saveAutoAgent({ ...stored!, enabled: false });

    expect(toggled.enabled).toBe(false);
    // Everything else is byte-identical to what was stored.
    expect({ ...toggled, enabled: true }).toEqual({ ...stored!, enabled: true });
    expect(toggled.prompt).toBe(full.prompt);
    expect(toggled.prompt.endsWith("end-marker")).toBe(true);
    expect(toggled.owner).toEqual({ kind: "user" });
    expect(toggled.model).toBe("grok-4.5");
    expect(toggled.tools).toEqual(["Bash"]);
  });

  test("toggling back on is a clean round trip, not a one-way door", async () => {
    const created = await store.saveAutoAgent(full);
    const off = await store.saveAutoAgent({ ...(await store.getAutoAgent(created.id))!, enabled: false });
    const on = await store.saveAutoAgent({ ...(await store.getAutoAgent(off.id))!, enabled: true });
    expect(on.enabled).toBe(true);
    expect(on).toEqual(created);
  });

  test("a bot-owned row keeps its owner across a toggle", async () => {
    const created = await store.saveAutoAgent({ ...full, owner: { kind: "bot", botId: "landing-bot" } });
    const toggled = await store.saveAutoAgent({ ...(await store.getAutoAgent(created.id))!, enabled: false });
    expect(toggled.owner).toEqual({ kind: "bot", botId: "landing-bot" });
  });
});
