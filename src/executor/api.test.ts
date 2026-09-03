import { describe, expect, test } from "bun:test";
import { executorApiAllowed, forwardExecutorApi } from "./api.ts";

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
    expect(executorApiAllowed("POST", "/executions")).toBe(false);
    expect(executorApiAllowed("DELETE", "/connections/org/github/main")).toBe(false);
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
