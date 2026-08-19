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
  const handler = block('if (path === "/api/auto/agents") {', 4200);

  test("edits look up the existing row and run it through the ownership guard before saving", () => {
    expect(handler).toContain("existingForEdit = await getAutoAgent(b.id)");
    expect(handler).toContain("await assertCanModifyAutoAgent(existingForEdit, callerBot)");
  });

  test("a bot caller can never mint a row for a different owner — always forced to itself", () => {
    expect(handler).toContain('{ kind: "bot", botId: callerBot }');
  });

  test("the per-bot cap is checked on create, before saving", () => {
    expect(handler).toContain("countAutoAgentsOwnedByBot(callerBot)");
    expect(handler).toContain("current >= settings.maxBotSchedules");
  });

  test("the minimum-interval floor is checked for a bot caller", () => {
    expect(handler).toContain("exceedsMaxFrequency(b.schedule");
  });

  test("GET scopes the listing to the caller's own rows when a bot is calling", () => {
    expect(handler).toContain("callerBot\n            ? agents.filter((a) => a.owner.kind === \"bot\" && a.owner.botId === callerBot)");
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
    const handler = block('if (req.method === "DELETE") {\n            const sessions = await listSessions();', 1600);
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
