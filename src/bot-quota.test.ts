import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { createBot, listBots } from "./bots/store.ts";
import {
  BotOwnerQuotaError,
  DEFAULT_PERSISTENT_BOT_LIMIT,
  botQuotaLimitPayload,
  persistentBotQuota,
  persistentBotQuotaPolicy,
} from "./bots/quota.ts";

const originalData = PATHS.data;
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omg-bot-quota-"));
  PATHS.data = root;
});

afterEach(() => {
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

describe("persistent bot quota policy", () => {
  test("defaults to 20 and never derives a value from a plan name", () => {
    expect(persistentBotQuotaPolicy({ entitlement: null, configuredLimit: null })).toEqual({
      limit: DEFAULT_PERSISTENT_BOT_LIMIT,
      source: "default",
    });
    expect(persistentBotQuotaPolicy({
      entitlement: { plan: "free-or-team-is-not-policy", limit: 1, scheduleLimit: 1 },
      configuredLimit: null,
    })).toEqual({ limit: DEFAULT_PERSISTENT_BOT_LIMIT, source: "default" });
  });

  test("uses the admin override when no host bot entitlement exists", () => {
    expect(persistentBotQuotaPolicy({ entitlement: null, configuredLimit: "32" }))
      .toEqual({ limit: 32, source: "config" });
    expect(persistentBotQuotaPolicy({ entitlement: null, configuredLimit: "not-a-limit" }))
      .toEqual({ limit: DEFAULT_PERSISTENT_BOT_LIMIT, source: "default" });
  });

  test("an authoritative host value wins over local configuration", () => {
    expect(persistentBotQuotaPolicy({
      entitlement: { plan: "managed", limit: 4, scheduleLimit: 2, persistentBotLimit: 48 },
      configuredLimit: "99",
    })).toEqual({ limit: 48, source: "host_entitlement" });
  });
});

describe("persistent bot quota accounting", () => {
  test("disabled and idle records count, while another owner and legacy records do not", async () => {
    const mine = await createBot({ name: "Mine", persona: "p", owner: "Me@Example.com" });
    await createBot({ name: "Disabled", persona: "p", owner: "me@example.com" });
    await createBot({ name: "Other", persona: "p", owner: "other@example.com" });
    await createBot({ name: "Legacy", persona: "p" });
    // No session was started for any record. Stored state, not runtime state,
    // is the resource this quota measures.
    expect(mine.sessionId).toBeUndefined();
    const bots = await listBots();
    bots[1]!.enabled = false;
    expect(persistentBotQuota(bots, "me@example.com", { limit: 20, source: "default" }))
      .toEqual({ used: 2, limit: 20, remaining: 18, scope: "owner", source: "default" });
  });

  test("grandfathers ownerless legacy bots in a separate pool", async () => {
    await createBot({ name: "Legacy 1", persona: "p" });
    await createBot({ name: "Legacy 2", persona: "p" });
    const bots = await listBots();
    expect(persistentBotQuota(bots, undefined)).toEqual({
      used: 2,
      limit: null,
      remaining: null,
      scope: "legacy_pool",
      source: "legacy",
    });
    expect(persistentBotQuota(bots, "new-owner@example.com")).toMatchObject({
      used: 0,
      remaining: DEFAULT_PERSISTENT_BOT_LIMIT,
      scope: "owner",
    });
  });

  test("serializes a concurrent create storm at exactly the final slot", async () => {
    const policy = { limit: 20, source: "default" } as const;
    const results = await Promise.all(Array.from({ length: 30 }, async (_, index) => {
      try {
        await createBot({
          name: `Bot ${index}`,
          persona: "p",
          owner: "owner@example.com",
          ownerQuota: policy,
        });
        return "created" as const;
      } catch (error) {
        expect(error).toBeInstanceOf(BotOwnerQuotaError);
        return "limited" as const;
      }
    }));
    expect(results.filter((result) => result === "created")).toHaveLength(20);
    expect(results.filter((result) => result === "limited")).toHaveLength(10);
    expect(await listBots()).toHaveLength(20);
  });

  test("returns a structured error with the same typed quota snapshot", () => {
    const quota = { used: 20, limit: 20, remaining: 0, scope: "owner", source: "default" } as const;
    const error = new BotOwnerQuotaError("owner@example.com", quota);
    expect(botQuotaLimitPayload(error)).toEqual({
      code: "bot_quota_limit",
      error: "Persistent bot limit reached: 20 of 20 stored bots are in use. Delete a bot before creating another.",
      quota,
    });
  });
});
