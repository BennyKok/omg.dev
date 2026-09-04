// Regression guards pinning that the /api/auto/agents* routes actually call
// through the ownership/cap/frequency guards, in the same spirit as the
// existing wiring checks in test/auto-agent-list-payload.test.ts and
// src/settings-validation.test.ts. assertCanModifyAutoAgent (see
// auto-agent-ownership.test.ts) is "the single authorization function" the
// plan calls for — these tests are what make sure every mutating route
// actually reaches it, since the routes themselves are inline in one very
// large fetch handler that isn't otherwise unit-testable in isolation.
import { describe, expect, test } from "bun:test";

const SERVE = await Bun.file(new URL("./serve.ts", import.meta.url)).text();

function block(marker: string, len = 900): string {
  const at = SERVE.indexOf(marker);
  expect(at, `marker not found: ${marker}`).toBeGreaterThanOrEqual(0);
  return SERVE.slice(at, at + len);
}

describe("POST /api/auto/agents (create/edit)", () => {
  const handler = block('if (path === "/api/auto/agents") {', 6000);

  test("edits look up the existing row and run it through the ownership guard before saving", () => {
    expect(handler).toContain("existingForEdit = await getAutoAgent(b.id)");
    expect(handler).toContain("await assertCanModifyAutoAgent(existingForEdit, callerBot)");
  });

  // A bot caller is forced onto itself inside resolveRequestedAutoAgentOwner
  // (see auto-agent-ownership.test.ts). What this pins is that the route reaches
  // that resolver instead of trusting the body's owner directly.
  test("a bot caller can never mint a row for a different owner — always forced to itself", () => {
    expect(handler).toContain("resolveRequestedAutoAgentOwner(callerBot, b.owner)");
    expect(SERVE).toContain('if (callerBot) return { ok: true, owner: { kind: "bot", botId: callerBot } };');
  });

  test("the per-bot cap is checked before saving", () => {
    expect(handler).toContain("countAutoAgentsOwnedByBot(");
    expect(handler).toContain("current >= settings.maxBotSchedules");
  });

  test("the minimum-interval floor is checked for any row that ends up bot-owned", () => {
    expect(handler).toContain("exceedsMaxFrequency(b.schedule");
  });

  // §8 migration wiring. The cap and the frequency ceiling are properties of a
  // row that ENDS UP bot-owned, not of the caller — otherwise a human-driven
  // migration would be a hole straight past the limits omg_schedule_routine
  // enforces on the bots themselves.
  test("owner resolution goes through the single exported resolver, not inline per-caller rules", () => {
    expect(handler).toContain("resolveRequestedAutoAgentOwner(callerBot, b.owner)");
    expect(handler).toContain("if (!resolvedOwner.ok) return err(resolvedOwner.status, resolvedOwner.error)");
  });

  test("the cap and frequency ceiling key off the resulting owner, not the caller", () => {
    expect(handler).toContain('const becomesBotOwned = owner?.kind === "bot" ? owner.botId : null');
    expect(handler).toContain("countAutoAgentsOwnedByBot(becomesBotOwned)");
    const gateAt = handler.indexOf("if (becomesBotOwned) {");
    const freqAt = handler.indexOf("exceedsMaxFrequency(b.schedule");
    expect(gateAt).toBeGreaterThanOrEqual(0);
    // The frequency check now lives INSIDE the becomes-bot-owned gate.
    expect(freqAt).toBeGreaterThan(gateAt);
  });

  test("a human-assigned owner bot must exist and be enabled before the row saves", () => {
    expect(handler).toContain("const target = await getBot(becomesBotOwned)");
    expect(handler).toContain('if (!target) return err(404, `unknown bot "${becomesBotOwned}"`)');
    expect(handler).toContain("if (!target.enabled)");
  });

  // Editing a routine in place must not be rejected by the cap it already
  // occupies a slot in.
  test("re-saving a row already owned by the target bot is exempt from the cap", () => {
    expect(handler).toContain("alreadyOwnedByTarget");
    expect(handler).toContain("!alreadyOwnedByTarget && current >= settings.maxBotSchedules");
  });

  test("GET scopes the listing to the caller's own rows when a bot is calling", () => {
    expect(handler).toContain("callerBot\n            ? agents.filter((a) => a.owner.kind === \"bot\" && a.owner.botId === callerBot)");
  });
});

// The Schedules list toggles `enabled` inline. It cannot reuse the full-object
// POST above, because a list response carries a TRUNCATED prompt
// (AUTO_AGENT_LIST_PROMPT_CHARS) and re-posting the row would persist the
// preview over the real prompt. These pin that the PATCH reads the STORED row
// server-side, guards it like every other mutation, and touches nothing but
// `enabled`.
describe("PATCH /api/auto/agents/:id (inline enable toggle)", () => {
  const handler = block('if (m && req.method === "PATCH") {', 2600);

  test("runs the row through the same ownership guard before saving", () => {
    expect(handler).toContain("const agent = await getAutoAgent(m[1])");
    expect(handler).toContain("await assertCanModifyAutoAgent(agent, await callerBotId(req))");
    expect(handler).toContain("if (!allowed.ok) return err(allowed.status, allowed.error)");
  });

  test("rejects a non-boolean enabled", () => {
    expect(handler).toContain('if (b.enabled !== undefined && typeof b.enabled !== "boolean")');
  });

  // The whole point: name/prompt/schedule always come from the stored row, so
  // a truncated prompt in the client's list state can never reach the store.
  test("spreads the STORED row and never reads a prompt or schedule off the body", () => {
    expect(handler).toContain("saveAutoAgent({\n            ...agent,");
    expect(handler).not.toContain("b.prompt");
    expect(handler).not.toContain("b.schedule");
    expect(handler).not.toContain("b.name");
  });

  // The agent/model quick switch in the Schedules row goes through here, so it
  // must reach the SAME validator the full POST uses rather than trusting the
  // body. A model is only valid relative to a backend, so the stored backend
  // has to be the fallback — validating a grok row's model against claude
  // would reject every legitimate switch.
  test("runtime fields go through the shared validator, keyed off the stored backend", () => {
    expect(handler).toContain("resolveAutoAgentRuntime(b, storedBackend)");
    expect(handler).toContain("if (!runtime.ok) return err(runtime.status, runtime.error)");
  });

  test("an empty patch is rejected rather than saved as a no-op write", () => {
    expect(handler).toContain('if (!touched) return err(400, "no supported field to update")');
  });
});

// One validator, two routes. The inline row picker must not become a second,
// laxer copy of the backend/model/account rules.
describe("resolveAutoAgentRuntime — shared by POST and PATCH", () => {
  test("POST delegates to it instead of validating inline", () => {
    const post = block('if (path === "/api/auto/agents") {', 6000);
    expect(post).toContain("const runtime = resolveAutoAgentRuntime(b)");
    expect(post).toContain("if (!runtime.ok) return err(runtime.status, runtime.error)");
    // The inline copies are gone, not merely bypassed.
    expect(post).not.toContain('return err(400, "invalid codex model name")');
    expect(post).not.toContain('return err(400, "invalid cursor model name")');
  });

  test("the validator still enforces the account pin and thinking-level rules", () => {
    const fn = block("function resolveAutoAgentRuntime(", 4200);
    expect(fn).toContain("claudeAccountId is not supported for");
    expect(fn).toContain("Claude account is missing or not connected");
    expect(fn).toContain("thinkingLevel is not supported for");
    expect(fn).toContain("unknown auto agent provider");
  });
});

describe("DELETE /api/auto/agents/:id", () => {
  test("looks up the row and runs it through the ownership guard before deleting", () => {
    const guardAt = SERVE.indexOf("await assertCanModifyAutoAgent(agent, await callerBotId(req));\n          if (!allowed.ok) return err(allowed.status, allowed.error);\n          await deleteAutoAgent(m[1]);");
    expect(guardAt, "ownership guard not found directly ahead of deleteAutoAgent").toBeGreaterThanOrEqual(0);
  });
});

describe("POST /api/auto/agents/:id/run", () => {
  const handler = block(String.raw`agents\/([a-z0-9_-]+)\/run$/);`, 1400);

  test("runs it through the ownership guard before doing anything else", () => {
    expect(handler).toContain("await assertCanModifyAutoAgent(agent, await callerBotId(req))");
  });

  test("a bot-owned row never reaches the headless runAutoAgent — it delivers the nudge instead", () => {
    const branchAt = handler.indexOf('agent.owner.kind === "bot"');
    const deliverAt = handler.indexOf("deliverBotMessage(bot, routineNudgeText(agent))");
    const headlessAt = handler.indexOf("void runAutoAgent(agent, (l) => console.log(l))");
    expect(branchAt).toBeGreaterThanOrEqual(0);
    expect(deliverAt).toBeGreaterThan(branchAt);
    // The bot branch returns before the function body reaches the headless call.
    expect(handler.indexOf("return json({ ok: true });", branchAt)).toBeLessThan(headlessAt);
  });
});

describe("DELETE /api/bots/:id — deletion cascade", () => {
  test("removes the bot's own routines before/alongside deleting the bot itself", () => {
    const handler = block('if (req.method === "DELETE") {\n            return serializeBotWork(id', 2100);
    const cascadeAt = handler.indexOf("deleteAutoAgentsOwnedByBot(id)");
    const deleteBotAt = handler.indexOf("await deleteBot(id)");
    expect(cascadeAt, "deleteAutoAgentsOwnedByBot not called from bot deletion").toBeGreaterThanOrEqual(0);
    expect(deleteBotAt).toBeGreaterThanOrEqual(0);
    expect(cascadeAt).toBeLessThan(deleteBotAt);
  });
});

describe("caller identity threading", () => {
  test("mcp.ts's api() sets the caller-session header on every outgoing call", async () => {
    const mcp = await Bun.file(new URL("./mcp.ts", import.meta.url)).text();
    expect(mcp).toContain("CALLER_SESSION_HEADER");
    expect(mcp).toContain('"X-Omg-Caller-Session-Id"');
    expect(mcp.indexOf("async function api<T>")).toBeLessThan(mcp.indexOf("[CALLER_SESSION_HEADER]: sid"));
  });

  test("the header is read ambiently server-side, never as a client-supplied override elsewhere", () => {
    expect(SERVE).toContain('req.headers.get("x-omg-caller-session-id")');
  });
});

// The refine route used to hold the request open for the whole model call —
// a minute-plus against a real repo — which a phone's fetch timeout threw away
// while the server finished and saved anyway. These pin that it answers
// first and does the work after, publishing its progress for the poll.
describe("POST /api/auto/agents/:id/refine (feedback → rewritten instruction)", () => {
  const handler = block("/refine$/", 4500);

  test("claims the agent before answering, and refuses a second concurrent rewrite", () => {
    expect(handler).toContain('if (!markRefining(agent.id)) return err(409');
  });

  test("answers 202 and carries the rewrite on in the background", () => {
    expect(handler).toContain("void (async () => {");
    expect(handler).toContain("return json({ ok: true, agent: withAutoAgentMeta(agent) }, { status: 202 })");
    // The model call happens inside the detached block, not before the response.
    expect(handler.indexOf("void (async () => {")).toBeLessThan(handler.indexOf("await refineAutoPrompt("));
  });

  test("settles the state both ways so the poll can end on success or the real error", () => {
    expect(handler).toContain("() => settleRefine(agent.id)");
    expect(handler).toContain("settleRefine(agent.id, msg)");
  });

  test("saves against the row as it is when the model returns, not the snapshot it started from", () => {
    expect(handler).toContain("const current = await getAutoAgent(agent.id)");
    expect(handler).toContain('if (!current) throw new Error("the agent was deleted while it was being updated")');
  });

  test("the agent payload carries the refine state for the browser poll", () => {
    expect(SERVE).toContain("refine: refineStatus(a.id)");
  });
});

