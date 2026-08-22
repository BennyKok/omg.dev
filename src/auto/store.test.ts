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
