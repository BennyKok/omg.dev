// Server-side ownership enforcement (docs/bot-owned-automations-plan.md §3):
// the single authorization policy every mutating /api/auto/agents* route funnels
// through, so a bot can't satisfy the guard on one path (the new bot-scoped
// tools) and skip it on another (the older, generic omg_save_auto_agent /
// omg_delete_auto_agent / omg_run_auto_agent, which already sat in every bot's
// tool catalog with zero enforcement before this landed).
import { describe, expect, test } from "bun:test";
import { assertCanModifyAutoAgent, resolveCallerBotId } from "./serve.ts";
import type { AutoAgent } from "../auto/store.ts";

function agent(owner: AutoAgent["owner"]): AutoAgent {
  return {
    id: "row-1",
    name: "Row",
    prompt: "p",
    schedule: "0 9 * * *",
    enabled: true,
    owner,
  };
}

describe("assertCanModifyAutoAgent", () => {
  test("a human/browser caller (no bot id) is always admin, over a user-owned row", async () => {
    const result = await assertCanModifyAutoAgent(agent({ kind: "user" }), null);
    expect(result.ok).toBe(true);
  });

  test("a human/browser caller is always admin, over a bot-owned row too", async () => {
    const result = await assertCanModifyAutoAgent(agent({ kind: "bot", botId: "bot_a" }), null);
    expect(result.ok).toBe(true);
  });

  test("a bot may modify its own row", async () => {
    const result = await assertCanModifyAutoAgent(agent({ kind: "bot", botId: "bot_a" }), "bot_a");
    expect(result.ok).toBe(true);
  });

  // The cross-bot denial case: a bot caller must never be able to touch an
  // automation owned by a DIFFERENT bot, even by guessing its id correctly.
  test("a bot is denied on a row owned by a different bot", async () => {
    const result = await assertCanModifyAutoAgent(agent({ kind: "bot", botId: "bot_b" }), "bot_a");
    expect(result).toEqual({ ok: false, status: 403, error: "not your automation" });
  });

  test("a bot is denied on a user-owned row — it cannot touch the human's own automations", async () => {
    const result = await assertCanModifyAutoAgent(agent({ kind: "user" }), "bot_a");
    expect(result).toEqual({ ok: false, status: 403, error: "not your automation" });
  });

  test("the denial is a 403, not a silent no-op or a content leak", async () => {
    const result = await assertCanModifyAutoAgent(agent({ kind: "bot", botId: "bot_b" }), "bot_a");
    if (result.ok) throw new Error("expected denial");
    expect(result.status).toBe(403);
  });
});

describe("resolveCallerBotId — ambient identity, never client-supplied", () => {
  const sessions: { sessionId: string | null; nativeSessionId: string | null; botId?: string }[] = [
    { sessionId: "sess-1", nativeSessionId: null, botId: "bot_a" },
    { sessionId: "sess-2", nativeSessionId: "native-2" },
    { sessionId: null, nativeSessionId: "native-3", botId: "bot_c" },
  ];

  test("no session id (no header set) resolves to null — the human/browser caller", () => {
    expect(resolveCallerBotId(sessions, null)).toBeNull();
  });

  test("a session id matching a bot session resolves to that bot's id", () => {
    expect(resolveCallerBotId(sessions, "sess-1")).toBe("bot_a");
  });

  test("a session id matching a non-bot session resolves to null", () => {
    expect(resolveCallerBotId(sessions, "sess-2")).toBeNull();
  });

  test("matches on nativeSessionId too", () => {
    expect(resolveCallerBotId(sessions, "native-3")).toBe("bot_c");
  });

  test("an unknown session id resolves to null rather than throwing", () => {
    expect(resolveCallerBotId(sessions, "sess-does-not-exist")).toBeNull();
  });
});
