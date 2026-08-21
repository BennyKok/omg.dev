// Server-side ownership enforcement (docs/bot-owned-automations-plan.md §3):
// the single authorization policy every mutating /api/auto/agents* route funnels
// through, so a bot can't satisfy the guard on one path (the new bot-scoped
// tools) and skip it on another (the older, generic omg_save_auto_agent /
// omg_delete_auto_agent / omg_run_auto_agent, which already sat in every bot's
// tool catalog with zero enforcement before this landed).
import { describe, expect, test } from "bun:test";
import {
  assertCanModifyAutoAgent,
  resolveCallerBotId,
  resolveRequestedAutoAgentOwner,
} from "./serve.ts";
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

// Owner reassignment (docs/bot-owned-automations-plan.md §8): migrating the
// 38 pre-existing user-owned rows onto the existing bots requires a supported
// way to flip `owner` on a row that already exists. Before this, the only
// bot-owned rows were ones a bot minted itself, so a migration meant retyping
// every prompt. These pin the asymmetry that makes that safe: the human is
// admin over `owner`, and a bot is still forced onto itself.
describe("resolveRequestedAutoAgentOwner", () => {
  test("a bot caller is forced onto itself when it names no owner", () => {
    expect(resolveRequestedAutoAgentOwner("bot_a", undefined)).toEqual({
      ok: true,
      owner: { kind: "bot", botId: "bot_a" },
    });
  });

  // The core cross-bot vector: a bot naming a sibling's id in the body must not
  // move the row there. The claim is ignored outright, not validated.
  test("a bot caller naming a DIFFERENT bot is still forced onto itself", () => {
    expect(resolveRequestedAutoAgentOwner("bot_a", { kind: "bot", botId: "bot_b" })).toEqual({
      ok: true,
      owner: { kind: "bot", botId: "bot_a" },
    });
  });

  test("a bot caller cannot hand its own row back to the human either", () => {
    expect(resolveRequestedAutoAgentOwner("bot_a", { kind: "user" })).toEqual({
      ok: true,
      owner: { kind: "bot", botId: "bot_a" },
    });
  });

  // The tri-state that keeps every pre-existing writer (CLI, refine endpoint,
  // browser form) from silently re-homing a bot's routine to the human.
  test("a human caller naming no owner yields undefined — carry the row's owner forward", () => {
    expect(resolveRequestedAutoAgentOwner(null, undefined)).toEqual({ ok: true, owner: undefined });
    expect(resolveRequestedAutoAgentOwner(null, null)).toEqual({ ok: true, owner: undefined });
  });

  test("a human caller may hand an existing row to a bot — the §8 migration move", () => {
    expect(resolveRequestedAutoAgentOwner(null, { kind: "bot", botId: "bot_incident" })).toEqual({
      ok: true,
      owner: { kind: "bot", botId: "bot_incident" },
    });
  });

  test("a human caller may take a routine back off a bot", () => {
    expect(resolveRequestedAutoAgentOwner(null, { kind: "user" })).toEqual({
      ok: true,
      owner: { kind: "user" },
    });
  });

  test("botId is trimmed, and a blank one is a 400 rather than a bot-owned row with no bot", () => {
    expect(resolveRequestedAutoAgentOwner(null, { kind: "bot", botId: "  bot_x  " })).toEqual({
      ok: true,
      owner: { kind: "bot", botId: "bot_x" },
    });
    const blank = resolveRequestedAutoAgentOwner(null, { kind: "bot", botId: "   " });
    expect(blank).toEqual({
      ok: false,
      status: 400,
      error: "owner.botId is required for a bot-owned routine",
    });
  });

  test("a bot owner with no botId field at all is rejected, not silently dropped", () => {
    const result = resolveRequestedAutoAgentOwner(null, { kind: "bot" });
    expect(result.ok).toBe(false);
  });

  test("an unknown or non-string owner kind is a 400", () => {
    const unknown = resolveRequestedAutoAgentOwner(null, { kind: "team" });
    if (unknown.ok) throw new Error("expected rejection");
    expect(unknown.status).toBe(400);
    expect(unknown.error).toContain("team");
    expect(resolveRequestedAutoAgentOwner(null, { kind: 7 }).ok).toBe(false);
  });
});
