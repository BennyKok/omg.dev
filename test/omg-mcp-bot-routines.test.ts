// The bot-scoped routine tools (docs/bot-owned-automations-plan.md §3d/§4):
// omg_list_my_routines / omg_schedule_routine / omg_unschedule_routine, plus
// the caller-identity header every auto-agent MCP call now carries so the
// server can enforce ownership underneath. Uses a per-URL fetch mock (unlike
// test/omg-mcp-auto-agents.test.ts's single shared `reply`) because a single
// tool call here fans out to more than one endpoint (e.g. omg_list_my_routines
// reads both /api/auto/agents and /api/settings).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { serveOmgMcpRequest } from "../src/mcp-http.ts";

const originalFetch = globalThis.fetch;
const originalBase = process.env.LFG_BASE;
const originalLfgSession = process.env.LFG_SESSION_ID;
const originalOmgSession = process.env.OMG_SESSION_ID;

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };
let calls: Call[] = [];
type Responder = (call: Call) => { status?: number; body: unknown };
let routes: Record<string, Responder> = {};

function routeKey(method: string, pathname: string): string {
  return `${method} ${pathname}`;
}

beforeEach(() => {
  calls = [];
  routes = {};
  process.env.LFG_BASE = "http://127.0.0.1:9876";
  // This agent's own harness runs inside an omg.dev-managed session, which
  // exports LFG_SESSION_ID/OMG_SESSION_ID for its own real session id — the
  // exact ambient fallback callerSessionId() reads. Left set, every "no
  // caller" test would pick up this process's own session id instead of
  // truly having none.
  delete process.env.LFG_SESSION_ID;
  delete process.env.OMG_SESSION_ID;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    let body: unknown;
    if (typeof init?.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of new Headers(init?.headers).entries()) headers[k.toLowerCase()] = v;
    const u = new URL(String(url));
    const call: Call = { url: String(url), method: init?.method ?? "GET", body, headers };
    calls.push(call);
    const responder = routes[routeKey(call.method, u.pathname)];
    if (!responder) return Response.json({ error: `no mock route for ${call.method} ${u.pathname}` }, { status: 404 });
    const { status = 200, body: respBody } = responder(call);
    return Response.json(respBody as Record<string, unknown>, { status });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBase === undefined) delete process.env.LFG_BASE;
  else process.env.LFG_BASE = originalBase;
  if (originalLfgSession === undefined) delete process.env.LFG_SESSION_ID;
  else process.env.LFG_SESSION_ID = originalLfgSession;
  if (originalOmgSession === undefined) delete process.env.OMG_SESSION_ID;
  else process.env.OMG_SESSION_ID = originalOmgSession;
});

type ToolReply = { text: string; isError: boolean };

async function callTool(
  name: string,
  args: Record<string, unknown> = {},
  sessionId?: string,
): Promise<ToolReply> {
  const url = sessionId
    ? `http://127.0.0.1:8766/mcp?session=${encodeURIComponent(sessionId)}`
    : "http://127.0.0.1:8766/mcp";
  const res = await serveOmgMcpRequest(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  const parsed = (await res.json()) as { result?: { content?: { text?: string }[]; isError?: boolean } };
  return { text: parsed.result?.content?.[0]?.text ?? "", isError: parsed.result?.isError === true };
}

// A bot-backed session row, the shape /api/sessions returns.
function botSession(sessionId: string, botId: string) {
  return { sessionId, nativeSessionId: null, botId };
}

describe("caller-identity header", () => {
  test("every /api/auto/agents* call from an MCP tool carries the caller's session id", async () => {
    routes[routeKey("GET", "/api/auto/agents")] = () => ({ body: { agents: [], tz: "UTC" } });
    await callTool("omg_list_auto_agents", {}, "sess-task-1");

    expect(calls[0]?.headers["x-omg-caller-session-id"]).toBe("sess-task-1");
  });

  test("no caller session (no query/header) means no caller-identity header at all", async () => {
    routes[routeKey("GET", "/api/auto/agents")] = () => ({ body: { agents: [], tz: "UTC" } });
    await callTool("omg_list_auto_agents", {});

    expect(calls[0]?.headers["x-omg-caller-session-id"]).toBeUndefined();
  });
});

describe("omg_list_my_routines", () => {
  test("is refused outside a bot conversation", async () => {
    routes[routeKey("GET", "/api/sessions")] = () => ({ body: { sessions: [] } });
    const out = await callTool("omg_list_my_routines", {}, "sess-task-1"); // a task session, no botId
    expect(out.isError).toBe(true);
    expect(out.text).toContain("only available inside a bot conversation");
  });

  test("lists the caller's own routines and the configured cap", async () => {
    routes[routeKey("GET", "/api/sessions")] = () => ({ body: { sessions: [botSession("sess-bot-1", "bot_xyz")] } });
    routes[routeKey("GET", "/api/auto/agents")] = () => ({
      body: { agents: [{ id: "r1", name: "R1", owner: { kind: "bot", botId: "bot_xyz" } }], tz: "UTC" },
    });
    routes[routeKey("GET", "/api/settings")] = () => ({ body: { settings: { maxBotSchedules: 5 } } });

    const out = await callTool("omg_list_my_routines", {}, "sess-bot-1");

    expect(out.isError).toBe(false);
    const parsed = JSON.parse(out.text);
    expect(parsed.routines).toEqual([{ id: "r1", name: "R1", owner: { kind: "bot", botId: "bot_xyz" } }]);
    expect(parsed.cap).toBe(5);
  });
});

describe("omg_schedule_routine", () => {
  test("is refused outside a bot conversation", async () => {
    routes[routeKey("GET", "/api/sessions")] = () => ({ body: { sessions: [] } });
    const out = await callTool(
      "omg_schedule_routine",
      { name: "Morning check", prompt: "check inbox", schedule: "0 9 * * *" },
      "sess-task-1",
    );
    expect(out.isError).toBe(true);
    expect(out.text).toContain("only available inside a bot conversation");
  });

  test("forces the owner to the caller's own bot id, stated explicitly in the request", async () => {
    routes[routeKey("GET", "/api/sessions")] = () => ({ body: { sessions: [botSession("sess-bot-1", "bot_xyz")] } });
    routes[routeKey("POST", "/api/auto/agents")] = (call) => ({
      body: { agent: { id: "morning-check", ...(call.body as object) } },
    });

    const out = await callTool(
      "omg_schedule_routine",
      { name: "Morning check", prompt: "check inbox", schedule: "0 9 * * *" },
      "sess-bot-1",
    );

    expect(out.isError).toBe(false);
    const createCall = calls.find((c) => c.method === "POST" && c.url.includes("/api/auto/agents"));
    expect(createCall?.body).toMatchObject({
      name: "Morning check",
      owner: { kind: "bot", botId: "bot_xyz" },
    });
  });

  test("surfaces a cap-exceeded 409 as an actionable tool error, not a bare status code", async () => {
    routes[routeKey("GET", "/api/sessions")] = () => ({ body: { sessions: [botSession("sess-bot-1", "bot_xyz")] } });
    routes[routeKey("POST", "/api/auto/agents")] = () => ({
      status: 409,
      body: { error: "you already have 5/5 scheduled routines — delete one with omg_unschedule_routine before creating another" },
    });

    const out = await callTool(
      "omg_schedule_routine",
      { name: "One too many", prompt: "p", schedule: "0 9 * * *" },
      "sess-bot-1",
    );

    expect(out.isError).toBe(true);
    expect(out.text).toContain("delete one with omg_unschedule_routine");
  });
});

describe("omg_unschedule_routine", () => {
  test("is refused outside a bot conversation", async () => {
    routes[routeKey("GET", "/api/sessions")] = () => ({ body: { sessions: [] } });
    const out = await callTool("omg_unschedule_routine", { id: "r1" }, "sess-task-1");
    expect(out.isError).toBe(true);
    expect(out.text).toContain("only available inside a bot conversation");
  });

  test("deletes through the same DELETE route the generic tool uses, carrying the caller header", async () => {
    routes[routeKey("GET", "/api/sessions")] = () => ({ body: { sessions: [botSession("sess-bot-1", "bot_xyz")] } });
    routes[routeKey("DELETE", "/api/auto/agents/r1")] = () => ({ body: { ok: true } });

    const out = await callTool("omg_unschedule_routine", { id: "r1" }, "sess-bot-1");

    expect(out.isError).toBe(false);
    const del = calls.find((c) => c.method === "DELETE");
    expect(del?.url).toBe("http://127.0.0.1:9876/api/auto/agents/r1");
    expect(del?.headers["x-omg-caller-session-id"]).toBe("sess-bot-1");
  });

  // The cross-bot denial case, as seen from the MCP tool: the server 403s
  // (see assertCanModifyAutoAgent), and the tool surfaces that as an error
  // rather than pretending it succeeded.
  test("a 403 from the server (not the caller's routine) surfaces as a tool error", async () => {
    routes[routeKey("GET", "/api/sessions")] = () => ({ body: { sessions: [botSession("sess-bot-1", "bot_xyz")] } });
    routes[routeKey("DELETE", "/api/auto/agents/someone-elses")] = () => ({
      status: 403,
      body: { error: "not your automation" },
    });

    const out = await callTool("omg_unschedule_routine", { id: "someone-elses" }, "sess-bot-1");

    expect(out.isError).toBe(true);
    expect(out.text).toContain("not your automation");
  });
});

describe("existing generic tools now enforce ownership underneath, unchanged in shape", () => {
  test("omg_delete_auto_agent from a bot session still just proxies DELETE, header included", async () => {
    routes[routeKey("GET", "/api/sessions")] = () => ({ body: { sessions: [botSession("sess-bot-1", "bot_xyz")] } });
    routes[routeKey("DELETE", "/api/auto/agents/wal-check")] = () => ({ body: { ok: true } });

    const out = await callTool("omg_delete_auto_agent", { id: "wal-check" }, "sess-bot-1");

    expect(out.isError).toBe(false);
    const del = calls.find((c) => c.method === "DELETE");
    expect(del?.headers["x-omg-caller-session-id"]).toBe("sess-bot-1");
  });

  test("omg_delete_auto_agent surfaces the server's cross-bot 403 rather than swallowing it", async () => {
    routes[routeKey("GET", "/api/sessions")] = () => ({ body: { sessions: [botSession("sess-bot-1", "bot_xyz")] } });
    routes[routeKey("DELETE", "/api/auto/agents/not-mine")] = () => ({
      status: 403,
      body: { error: "not your automation" },
    });

    const out = await callTool("omg_delete_auto_agent", { id: "not-mine" }, "sess-bot-1");

    expect(out.isError).toBe(true);
    expect(out.text).toContain("not your automation");
  });
});
