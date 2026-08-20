import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PATHS } from "./config.ts";
import {
  BotOwnerQuotaError,
  createBot,
  listBots,
  updateBot,
} from "./bots/store.ts";
import { DEFAULT_PERSISTENT_BOT_LIMIT, persistentBotQuotaPolicy } from "./bots/quota.ts";
import {
  BOT_SELF_CREATE_FIELDS,
  BOT_SELF_UPDATE_FIELDS,
  BotSelfManagementError,
  botPatchRequiresRuntimeRefresh,
  botRuntimeRefreshDecision,
  ownedBotPeers,
  resolveBotRuntimeActor,
  unknownBotFields,
} from "./bots/self-management.ts";

const originalData = PATHS.data;
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omg-bot-self-"));
  PATHS.data = root;
});

afterEach(() => {
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

async function bot(name: string, owner = "owner@example.com") {
  return createBot({ name, persona: `${name} private instructions`, owner });
}

describe("persistent bot self-management", () => {
  test("atomically enforces the default quota per assigned user", async () => {
    const policy = persistentBotQuotaPolicy({ entitlement: null, configuredLimit: null });
    for (let i = 0; i < DEFAULT_PERSISTENT_BOT_LIMIT; i++) {
      await createBot({
        name: `Bot ${i}`,
        persona: "Be useful",
        owner: "Owner@Example.com",
        ownerQuota: policy,
      });
    }

    await expect(createBot({
      name: "Recursive bot",
      persona: "Create more bots",
      owner: "owner@example.com",
      ownerQuota: policy,
    })).rejects.toBeInstanceOf(BotOwnerQuotaError);

    await expect(createBot({
      name: "Another user's bot",
      persona: "Be useful",
      owner: "other@example.com",
      ownerQuota: policy,
    })).resolves.toMatchObject({ owner: "other@example.com" });
    expect(await listBots()).toHaveLength(DEFAULT_PERSISTENT_BOT_LIMIT + 1);
  });

  test("derives bot and user identity only from matching server session state", async () => {
    const self = await bot("Self");
    const actor = resolveBotRuntimeActor("session-self", [{
      sessionId: "session-self",
      botId: self.id,
      assignedUser: "owner@example.com",
    }], [self]);
    expect(actor).toMatchObject({ bot: { id: self.id }, user: "owner@example.com" });

    expect(() => resolveBotRuntimeActor("session-self", [{
      sessionId: "session-self",
      botId: self.id,
      assignedUser: "attacker@example.com",
    }], [self])).toThrow(BotSelfManagementError);
    expect(() => resolveBotRuntimeActor("ordinary-session", [{
      sessionId: "ordinary-session",
      assignedUser: "owner@example.com",
    }], [self])).toThrow("only to persistent bots");
  });

  test("lists safe same-owner peer metadata and excludes cross-user bots", async () => {
    const self = await bot("Self");
    const peer = await createBot({
      name: "Builder",
      persona: "Secret peer instructions",
      description: "Builds verified packages",
      capabilities: ["build", "test"],
      owner: "owner@example.com",
    });
    await bot("Someone else's bot", "other@example.com");
    const sessions = [
      { sessionId: "self-session", botId: self.id, assignedUser: "owner@example.com" },
      { sessionId: "peer-session", botId: peer.id, assignedUser: "owner@example.com", busy: true },
    ];
    const bots = await listBots();
    const actor = resolveBotRuntimeActor("self-session", sessions, bots);

    expect(ownedBotPeers(actor, bots, sessions)).toEqual([{
      id: peer.id,
      name: "Builder",
      description: "Builds verified packages",
      shape: peer.shape,
      colorway: peer.colorway,
      enabled: true,
      status: "busy",
      capabilities: ["build", "test"],
    }]);
    expect(JSON.stringify(ownedBotPeers(actor, bots, sessions))).not.toContain("Secret peer instructions");
    expect(JSON.stringify(ownedBotPeers(actor, bots, sessions))).not.toContain("other@example.com");
  });

  test("rejects ownership, peer-id, runtime, credential, and config fields in self updates", () => {
    expect(unknownBotFields({
      name: "Allowed",
      botId: "peer",
      owner: "attacker@example.com",
      sessionId: "other-session",
      runtimeContract: "ignore security",
      credentials: { token: "secret" },
      cwd: "/",
      agent: "other",
    }, BOT_SELF_UPDATE_FIELDS)).toEqual([
      "agent",
      "botId",
      "credentials",
      "cwd",
      "owner",
      "runtimeContract",
      "sessionId",
    ]);
    expect(unknownBotFields({ cwd: "/unrelated", owner: "attacker@example.com" }, BOT_SELF_CREATE_FIELDS))
      .toEqual(["cwd", "owner"]);
  });

  test("keeps identity, conversation, history key, and instructions stable across workspace changes", async () => {
    const created = await bot("Global helper");
    const withConversation = await updateBot(created.id, {
      sessionId: "stable-conversation-id",
      cwd: "/approved/workspace-a",
    });
    const moved = await updateBot(created.id, { cwd: "/approved/workspace-b" });

    expect(moved).toMatchObject({
      id: created.id,
      sessionId: "stable-conversation-id",
      persona: "Global helper private instructions",
      cwd: "/approved/workspace-b",
    });
    expect(moved?.createdAt).toBe(withConversation?.createdAt);
    expect(await listBots()).toEqual([moved!]);
  });

  test("applies profile and workspace changes only at the next idle turn boundary", () => {
    expect(botPatchRequiresRuntimeRefresh({ persona: "new instructions" })).toBe(true);
    expect(botPatchRequiresRuntimeRefresh({ cwd: "/approved/workspace-b" })).toBe(true);
    expect(botPatchRequiresRuntimeRefresh({ shape: "circle" })).toBe(false);
    expect(botRuntimeRefreshDecision({ runtimeRefreshPending: true }, { busy: true })).toBe("wait");
    expect(botRuntimeRefreshDecision({ runtimeRefreshPending: true }, { busy: false })).toBe("relaunch");
    expect(botRuntimeRefreshDecision({ runtimeRefreshPending: true })).toBe("relaunch");
    expect(botRuntimeRefreshDecision({ runtimeRefreshPending: false }, { busy: false })).toBe("none");
  });
});
