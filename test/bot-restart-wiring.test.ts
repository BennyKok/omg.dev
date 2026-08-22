import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const SERVE = readFileSync(new URL("../src/commands/serve.ts", import.meta.url), "utf8");
const STORE = readFileSync(new URL("../src/bots/store.ts", import.meta.url), "utf8");
const APP = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const ROTATION = readFileSync(new URL("../src/bots/rotation.ts", import.meta.url), "utf8");

const restartRoute = SERVE.slice(
  SERVE.indexOf("Explicit runtime lifecycle action for a persistent bot conversation"),
  SERVE.indexOf("Apply a pending configuration change by rotating the bot"),
);
const botMenu = APP.slice(
  APP.indexOf("function BotConversationMenu("),
  APP.indexOf("function BotsView("),
);
const regularSessionMenu = APP.slice(
  APP.indexOf("function SessionActionsMenu("),
  APP.indexOf("function RailSessionContextMenu("),
);

describe("persistent bot manual restart wiring", () => {
  test("uses the conversation-aware rotation owner with runtime CAS", () => {
    expect(restartRoute).toContain('path.match(/^\\/api\\/bots\\/([^/]+)\\/restart$/)');
    expect(restartRoute).toContain('reason: "restart"');
    expect(restartRoute).toContain("expectedRuntimeSessionId");
    expect(restartRoute).toContain("const outcome = await rotateBotSession(id");
  });

  test("uses verified viewer access and rejects client-selected identity", () => {
    expect(restartRoute).toContain("botViewerFromRequest(req, undefined)");
    expect(restartRoute).toContain("visibleBotsForViewer([existing], viewer, rosterEmails(), undefined)");
    expect(restartRoute).not.toContain("body.user");
    expect(restartRoute).toContain('"bot_restart_forbidden"');
  });

  test("returns typed success and failure states, and never a queued restart", () => {
    expect(restartRoute).toContain('state: outcome.rotated ? "restarted" : "already-restarted"');
    expect(restartRoute).toContain('"bot_restart_failed"');
    // A restart that cannot run is a failure the caller can retry, not a
    // pending state parked behind the wedged turn it exists to clear.
    expect(restartRoute).not.toContain('state: "queued"');
    expect(restartRoute).not.toContain("activeChildren");
    expect(APP).not.toContain("Restart queued");
  });

  test("admits a restart unconditionally and carries its undelivered queue", () => {
    const rotation = SERVE.slice(
      SERVE.indexOf("async function rotateBotSession"),
      SERVE.indexOf("async function applyPendingBotRotation"),
    );
    expect(ROTATION).toContain('if (reason === "restart") return { ready: true };');
    expect(rotation).toContain("botRotationAdmission(bot.id, primary, sessions, opts.reason)");
    // The queue gate is for automatic rotations only.
    expect(rotation).toContain('if (queueSessionId && opts.reason !== "restart")');
    // Undelivered sends move onto the replacement instead of being stranded in
    // the retired session's queue, and only after the old primary is closed.
    expect(rotation).toContain("takeUndeliveredQueue(previousSessionId)");
    expect(rotation.indexOf("takeUndeliveredQueue(previousSessionId)")).toBeGreaterThan(
      rotation.indexOf('source: `bot_rotation_${opts.reason}`'),
    );
    // A child told the old parent id at spawn still finds the bot afterwards.
    expect(SERVE).toContain("candidate.archivedSessionIds?.includes(targetSessionId)");
  });

  test("persists enough state to resume a queued restart after reload", () => {
    expect(STORE).toContain("rotationExpectedSessionId?: string | null;");
    expect(SERVE).toContain('bot.rotationState === "queued" && bot.rotationReason === "restart"');
    expect(SERVE).toContain("expectedRuntimeSessionId: bot.rotationExpectedSessionId");
  });

  test("inherits stage-before-stop and rollback from the one rotation owner", () => {
    const rotation = SERVE.slice(
      SERVE.indexOf("async function rotateBotSession"),
      SERVE.indexOf("async function applyPendingBotRotation"),
    );
    expect(rotation.indexOf("const staged = mutateBot(bot.id")).toBeGreaterThan(-1);
    expect(rotation.indexOf('source: `bot_rotation_${opts.reason}`')).toBeGreaterThan(
      rotation.indexOf("const staged = mutateBot(bot.id"),
    );
    expect(rotation).toContain('await stopReplacement("bot_rotation_attach_rollback")');
    expect(rotation).toContain('await stopReplacement("bot_rotation_close_rollback")');
  });

  test("exposes the accessible action only in the bot conversation menu", () => {
    expect(botMenu).toContain('label="Restart session"');
    expect(botMenu).toContain('aria-label="Restart session"');
    expect(botMenu).toContain('confirmLabel="Confirm restart"');
    expect(botMenu).not.toContain("Queue restart after current work");
    expect(regularSessionMenu).not.toContain("Restart session");
    expect(SERVE).not.toContain("/api/sessions/:id/restart");
  });

  test("uses the same bot menu in wide desktop and responsive chat headers", () => {
    const sessionCard = APP.slice(
      APP.indexOf("const SessionCard = memo("),
      APP.indexOf("const ChatStream = memo("),
    );
    const botsView = APP.slice(APP.indexOf("function BotsView("));
    const selectedBotView = botsView.slice(botsView.indexOf("if (bot) {"), botsView.indexOf("No bots yet."));
    expect(sessionCard).toContain("!collapsedView && headerBot && editBot");
    expect(sessionCard).toContain("<BotConversationMenu");
    expect(sessionCard).not.toContain('aria-label={`${headerBot.name} settings`}');
    expect(selectedBotView.match(/<BotConversationMenu/g)).toHaveLength(2);
    expect(botMenu).toContain("Restart unavailable — bot is disabled");
    expect(botMenu).toContain("Restart unavailable — start the conversation first");
  });
});
