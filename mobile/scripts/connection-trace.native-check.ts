import { expect, test } from "bun:test";
import { clearConnectionTimings, connectionTimings, recordConnectionTiming, requestStage, tracedFetch, readConnectionJson, traceConnectionTransport } from "../src/omg/connection-trace";
import { createGrantTransport } from "@omg-dev/client";

test("trace is bounded and request categories omit URLs and secrets", () => {
  clearConnectionTimings();
  expect(requestStage("https://host/api/sessions/private-id/messages?token=secret")).toBe("messages");
  for (let i = 0; i < 110; i++) recordConnectionTiming("bootstrap.headers");
  expect(connectionTimings()).toHaveLength(100);
  expect(JSON.stringify(connectionTimings())).not.toContain("private-id");
});

test("instrumentation preserves fetch bodies and SDK error semantics", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ error: "test refusal", code: "test-code" }, { status: 403, headers: { "Server-Timing": "bootstrap;dur=4.5" } })) as typeof fetch;
  try {
    clearConnectionTimings();
    const response = await tracedFetch("https://host/api/bootstrap");
    expect(response.status).toBe(403);
    expect((await readConnectionJson(response, "bootstrap")).code).toBe("test-code");
    expect(response.bodyUsed).toBe(true);
    expect(connectionTimings().some(t => t.stage === "bootstrap.parse")).toBe(true);
    expect(connectionTimings().find(t => t.stage === "bootstrap.server")?.durationMs).toBe(4.5);
    const transport = traceConnectionTransport(createGrantTransport({ baseUrl: "https://host", getGrant: async () => ({ token: "not-logged", expiresAt: Date.now() + 600000 }), fetch: tracedFetch }));
    await expect(transport.request("/api/sessions")).rejects.toMatchObject({ status: 403, code: "test-code" });
    expect(JSON.stringify(connectionTimings())).not.toContain("not-logged");
  } finally { globalThis.fetch = original; }
});

test("socket preparation and handshake have separate markers", async () => {
  clearConnectionTimings();
  const socket = new EventTarget();
  const transport = traceConnectionTransport({
    request: async () => ({}) as never,
    fetch: async () => new Response(),
    openSocket: async () => socket as any,
    openLiveSocket: async () => socket as any,
  });
  await transport.openLiveSocket();
  expect(connectionTimings().map(t => t.stage)).toEqual(["socket.prepare"]);
  socket.dispatchEvent(new Event("open"));
  expect(connectionTimings().map(t => t.stage)).toEqual(["socket.prepare", "socket.handshake", "socket.open"]);
});
