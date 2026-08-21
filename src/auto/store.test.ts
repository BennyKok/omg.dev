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
