import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const SERVE = readFileSync(new URL("../src/commands/serve.ts", import.meta.url), "utf8");
const APP = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const MANAGED = readFileSync(new URL("../src/managed.ts", import.meta.url), "utf8");

describe("persistent bot runtime rotation wiring", () => {
  test("manual apply and automatic compaction use the same server primitive", () => {
    expect(SERVE).toContain('path.match(/^\\/api\\/bots\\/([^/]+)\\/rotate$/)');
    expect(SERVE).toContain("const outcome = await rotateBotSession(id, {");
    expect(SERVE).toContain('reason: retryingCompaction ? "compaction" : "config"');
    expect(SERVE).toContain('rotateBotSession(bot.id, { reason: "compaction" }');
    expect(SERVE).toContain("startBotCompactionSweep();");
  });

  test("rotation preserves conversation identity and records the applied runtime revision", () => {
    expect(SERVE).toContain("preserveExistingPrimary: true");
    expect(SERVE).toContain("replaceConversationPrimaryRuntime({");
    expect(SERVE).toContain("conversationId,");
    expect(MANAGED).toContain("appliedConfigRevision?: number;");
  });

  test("stages before closing and restores the live primary on close failure", () => {
    const staged = SERVE.indexOf("const staged = mutateBot(bot.id");
    const closed = SERVE.indexOf('source: `bot_rotation_${opts.reason}`');
    expect(staged).toBeGreaterThan(-1);
    expect(closed).toBeGreaterThan(staged);
    expect(SERVE).toContain("sessionId: previousSessionId ?? bot.sessionId");
    expect(SERVE).toContain('await stopReplacement("bot_rotation_close_rollback")');
    expect(SERVE).toContain('return serializeBotWork(id, async () => {\n              const deleting');
    const rotationBlock = SERVE.slice(
      SERVE.indexOf("async function rotateBotSession"),
      SERVE.indexOf("async function applyPendingBotRotation"),
    );
    expect(rotationBlock).not.toContain("force?: boolean");
  });

  test("the editor exposes truthful apply states", () => {
    expect(APP).toContain('data-bot-config-status={configStatus}');
    expect(APP).toContain('configStatus === "update-available" ? "Update available"');
    expect(APP).toContain('configStatus === "queued" ? "Refresh queued"');
    expect(APP).toContain('configStatus === "refreshing" ? "Refreshing"');
    expect(APP).toContain("Apply changes");
  });

  test("durable conversation ids, not rotating runtime ids, stay in bot routes", () => {
    expect(APP).toContain("onOpen(item.id, row.conversationId)");
    expect(APP).toContain("onOpenBot?.(bot.id, row.conversationId)");
  });
});
