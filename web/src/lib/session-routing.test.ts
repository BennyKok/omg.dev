import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import "../test-support/render";
import type { OmgTransport } from "@omg-dev/client";

const {
  remoteMachineForSession,
  resetSessionRoutingForTest,
  routedTransportForPath,
  SESSION_OWNERS_STORAGE_KEY,
  sessionIdForPath,
  setSessionOwners,
} = await import("./session-routing");
const { MACHINE_STORAGE_KEY } = await import("./machines");
const { api, configureOmgTransport, omgDirectUrl } = await import("./omg-client");

const originalFetch = globalThis.fetch;
const baseCalls: string[] = [];
const peerCalls: string[] = [];
const base = {
  fetch: async (path: string) => {
    baseCalls.push(path);
    return Response.json({ from: "base" });
  },
  request: async (path: string) => {
    baseCalls.push(path);
    return { from: "base" };
  },
  openSocket: async () => {
    throw new Error("unused");
  },
  openLiveSocket: async () => {
    throw new Error("unused");
  },
} as unknown as OmgTransport;

beforeEach(() => {
  resetSessionRoutingForTest();
  window.localStorage.removeItem(MACHINE_STORAGE_KEY);
  baseCalls.length = 0;
  peerCalls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    peerCalls.push(String(input));
    return Response.json({ from: "peer" });
  }) as typeof fetch;
  configureOmgTransport(base);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetSessionRoutingForTest();
  window.localStorage.removeItem(MACHINE_STORAGE_KEY);
});

describe("sessionIdForPath", () => {
  test("reads the session from the path or the sessionId query", () => {
    expect(sessionIdForPath("/api/sessions/abc")).toBe("abc");
    expect(sessionIdForPath("/api/sessions/abc/send")).toBe("abc");
    expect(sessionIdForPath("/api/sessions/abc?full=1")).toBe("abc");
    expect(sessionIdForPath("/api/sessions/a%20b/title")).toBe("a b");
    expect(sessionIdForPath("/api/term?sessionId=abc&cols=80")).toBe("abc");
    expect(sessionIdForPath("/api/term/list?sessionId=abc")).toBe("abc");
    expect(sessionIdForPath("/api/sessions")).toBeNull();
    expect(sessionIdForPath("/api/settings")).toBeNull();
    expect(sessionIdForPath("/api/term?session=lfg")).toBeNull();
  });
});

describe("session routing", () => {
  test("a linked machine's session goes through that machine's proxy prefix; others stay on the app's transport", async () => {
    setSessionOwners([{ sessionId: "remote-1", machineId: "peer-1" }]);

    expect(remoteMachineForSession("remote-1")).toBe("peer-1");
    expect(remoteMachineForSession("local-1")).toBeNull();

    expect(await api("/api/sessions/remote-1/title", { method: "POST", body: "{}" })).toEqual({ from: "peer" });
    expect(peerCalls).toEqual(["/api/peers/machines/peer-1/api/sessions/remote-1/title"]);

    expect(await api("/api/sessions/local-1/title", { method: "POST", body: "{}" })).toEqual({ from: "base" });
    expect(await api("/api/settings")).toEqual({ from: "base" });
    expect(baseCalls).toEqual(["/api/sessions/local-1/title", "/api/settings"]);

    // Images and files in a remote transcript load from that machine too.
    expect(omgDirectUrl("/api/sessions/remote-1/files/out.png")).toBe(
      "/api/peers/machines/peer-1/api/sessions/remote-1/files/out.png",
    );
  });

  test("a session owned by the machine the app booted on is not re-routed", () => {
    window.localStorage.setItem(MACHINE_STORAGE_KEY, JSON.stringify({ id: "peer-1", name: "Studio" }));
    setSessionOwners([
      { sessionId: "on-peer", machineId: "peer-1" },
      { sessionId: "on-local", machineId: "local" },
    ]);
    expect(routedTransportForPath("/api/sessions/on-peer")).toBeNull();
    // Switched onto peer-1, this box's own sessions go back to the plain origin.
    const local = routedTransportForPath("/api/sessions/on-local");
    expect(local?.assetUrl?.("/api/sessions/on-local")).toBe("/api/sessions/on-local");
  });

  test("the owner map is kept for the tab, so a reload routes before the first poll", () => {
    setSessionOwners([{ sessionId: "remote-1", machineId: "peer-1" }]);
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_OWNERS_STORAGE_KEY) ?? "{}")).toEqual({
      "remote-1": "peer-1",
    });
  });
});
