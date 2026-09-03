import { describe, expect, test } from "bun:test";
import { serveExecutorMcpRequest } from "./proxy.ts";

const UPSTREAM = { origin: "http://127.0.0.1:4788", token: "secret-token" };

function capture() {
  const calls: { url: string; init: RequestInit & { headers: Headers } }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), init: { ...init, headers } });
    return new Response("event: message\ndata: {}\n\n", {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "mcp-session-id": "sess-1",
        "x-upstream-private": "hidden",
      },
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("serveExecutorMcpRequest", () => {
  test("503 when the daemon is not running", async () => {
    const res = await serveExecutorMcpRequest(new Request("http://box/mcp/executor", { method: "POST" }), null);
    expect(res.status).toBe(503);
  });

  test("forwards to the daemon /mcp with the bearer and MCP headers", async () => {
    const { calls, fetchImpl } = capture();
    const req = new Request("http://box/mcp/executor?session=abc", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": "sess-1",
        authorization: "Bearer from-the-agent",
        cookie: "omg=1",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const res = await serveExecutorMcpRequest(req, UPSTREAM, fetchImpl);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("http://127.0.0.1:4788/mcp");
    expect(call.init.method).toBe("POST");
    expect(call.init.headers.get("authorization")).toBe("Bearer secret-token");
    expect(call.init.headers.get("mcp-session-id")).toBe("sess-1");
    expect(call.init.headers.get("accept")).toContain("text/event-stream");
    expect(call.init.headers.get("cookie")).toBeNull();
    expect(new TextDecoder().decode(call.init.body as ArrayBuffer)).toContain("tools/list");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("mcp-session-id")).toBe("sess-1");
    expect(res.headers.get("x-upstream-private")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain("event: message");
  });

  test("GET carries no body", async () => {
    const { calls, fetchImpl } = capture();
    await serveExecutorMcpRequest(new Request("http://box/mcp/executor", { method: "GET" }), UPSTREAM, fetchImpl);
    expect(calls[0]!.init.body).toBeUndefined();
  });

  test("502 when the daemon does not answer", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const res = await serveExecutorMcpRequest(new Request("http://box/mcp/executor", { method: "POST" }), UPSTREAM, fetchImpl);
    expect(res.status).toBe(502);
  });
});
