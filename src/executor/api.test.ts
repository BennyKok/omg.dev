import { describe, expect, test } from "bun:test";
import { executorApiAllowed, forwardExecutorApi, managementToolAllowed, runManagementTool } from "./api.ts";

const UPSTREAM = { origin: "http://127.0.0.1:4788", token: "secret" };

function capture(status = 200) {
  const calls: { url: string; method: string; headers: Headers; body: string | undefined }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return Response.json([{ id: "pol_1" }], { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("executorApiAllowed", () => {
  test("only the control-plane routes pass", () => {
    expect(executorApiAllowed("GET", "/policies")).toBe(true);
    expect(executorApiAllowed("POST", "/policies")).toBe(true);
    expect(executorApiAllowed("DELETE", "/policies/pol_1")).toBe(true);
    expect(executorApiAllowed("GET", "/tools")).toBe(true);
    expect(executorApiAllowed("GET", "/connections")).toBe(true);
    expect(executorApiAllowed("POST", "/connections")).toBe(true);
    expect(executorApiAllowed("DELETE", "/connections/org/github/main")).toBe(true);
    expect(executorApiAllowed("POST", "/connections/org/github/main/refresh")).toBe(true);
    expect(executorApiAllowed("GET", "/integrations/github")).toBe(true);
    expect(executorApiAllowed("DELETE", "/integrations/github")).toBe(true);
    // Still refused: execution control and anything not enumerated.
    expect(executorApiAllowed("POST", "/executions")).toBe(false);
    expect(executorApiAllowed("DELETE", "/connections/org/github/main/secrets")).toBe(false);
    expect(executorApiAllowed("GET", "/health")).toBe(false);
  });
});

describe("forwardExecutorApi", () => {
  test("refuses routes off the allowlist before touching the daemon", async () => {
    const { calls, fetchImpl } = capture();
    const res = await forwardExecutorApi(
      new Request("http://box/api/executor/api/executions", { method: "POST" }),
      "/executions",
      UPSTREAM,
      fetchImpl,
    );
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  test("503 when the daemon is down", async () => {
    const res = await forwardExecutorApi(new Request("http://box/api/executor/api/policies"), "/policies", null);
    expect(res.status).toBe(503);
  });

  test("forwards with the bearer, body and query, and strips upstream headers", async () => {
    const { calls, fetchImpl } = capture();
    const res = await forwardExecutorApi(
      new Request("http://box/api/executor/api/policies/pol_1?x=1", {
        method: "DELETE",
        headers: { "content-type": "application/json", authorization: "Bearer from-browser" },
        body: JSON.stringify({ owner: "org" }),
      }),
      "/policies/pol_1",
      UPSTREAM,
      fetchImpl,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:4788/api/policies/pol_1?x=1");
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer secret");
    expect(calls[0]!.body).toBe('{"owner":"org"}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "pol_1" }]);
  });
});

describe("management tools", () => {
  test("only the source-management tools are allowed", () => {
    expect(managementToolAllowed("executor.openapi.addSpec")).toBe(true);
    expect(managementToolAllowed("executor.mcp.addServer")).toBe(true);
    expect(managementToolAllowed("executor.coreTools.connections.list")).toBe(false);
    expect(managementToolAllowed("anything.else")).toBe(false);
  });

  test("refuses a non-management address before touching the daemon", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return Response.json({});
    }) as unknown as typeof fetch;
    const out = await runManagementTool("executor.coreTools.connections.list", {}, { origin: "http://x", token: "t" }, fetchImpl);
    expect(out.ok).toBe(false);
    expect(called).toBe(false);
  });

  test("runs an allowed tool via execute with autoApprove and the bearer", async () => {
    const calls: { url: string; headers: Headers; body: string }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body) });
      return Response.json({ status: "completed", text: "added", structured: { slug: "petstore" }, isError: false });
    }) as unknown as typeof fetch;
    const out = await runManagementTool(
      "executor.openapi.addSpec",
      { spec: { kind: "url", url: "https://ex/openapi.json" } },
      { origin: "http://127.0.0.1:4788", token: "sec" },
      fetchImpl,
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.structured).toEqual({ slug: "petstore" });
    expect(calls[0]!.url).toBe("http://127.0.0.1:4788/api/executions");
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer sec");
    const sent = JSON.parse(calls[0]!.body) as { code: string; autoApprove: boolean };
    expect(sent.autoApprove).toBe(true);
    expect(sent.code).toContain("tools.executor.openapi.addSpec(");
    expect(sent.code).toContain("https://ex/openapi.json");
  });

  test("no upstream is a clean failure", async () => {
    const out = await runManagementTool("executor.openapi.addSpec", {}, null);
    expect(out.ok).toBe(false);
  });
});
