// Installs happy-dom globals so the gate's focus/visibility listeners are real.
import "../test-support/render";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { OmgTransport } from "@omg-dev/client";

const client = await import("./omg-client");
const { evlog } = await import("./evlog");
const { PAUSED_GATE_MAX_MS, PAUSED_GATE_START_MS } = await import("./computer-paused-gate");

type Call = { path: string; method: string };

function pausedJson(): Response {
  return new Response(JSON.stringify({ error: "computer_paused", code: "computer_paused" }), {
    status: 425,
    headers: { "content-type": "application/json" },
  });
}

function fakeTransport(answer: { status: number }) {
  const calls: Call[] = [];
  const sockets: string[] = [];
  const transport: OmgTransport = {
    async fetch(path, init) {
      calls.push({ path, method: (init?.method ?? "GET").toUpperCase() });
      return answer.status === 425 ? pausedJson() : Response.json({ ok: true }, { status: answer.status });
    },
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      calls.push({ path, method: (init?.method ?? "GET").toUpperCase() });
      if (answer.status >= 400) {
        throw Object.assign(new Error("computer_paused"), { status: answer.status, code: "computer_paused" });
      }
      return { ok: true } as T;
    },
    async openSocket(path) {
      sockets.push(path);
      return {} as never;
    },
    async openLiveSocket() {
      sockets.push("/api/live/ws");
      return {} as never;
    },
  };
  return { transport, calls, sockets };
}

let now = 1_000_000;
let answer = { status: 425 };
let fake = fakeTransport(answer);

beforeEach(() => {
  now = 1_000_000;
  answer = { status: 425 };
  fake = fakeTransport(answer);
  client.configureOmgTransport(fake.transport);
  client.resetComputerPausedGateForTest(() => now);
});

afterEach(() => {
  client.resetComputerPausedGateForTest();
});

describe("paused Computer gate", () => {
  test("a paused answer holds background polls off the network until the wait ends", async () => {
    await expect(client.api("/api/sessions")).rejects.toMatchObject({ status: 425 });
    expect(fake.calls).toHaveLength(1);

    // Held locally: same 425 shape, no network call.
    await expect(client.api("/api/sessions")).rejects.toMatchObject({ status: 425, code: "computer_paused" });
    const held = await client.omgFetch("/api/install");
    expect(held.status).toBe(425);
    expect(await held.json()).toMatchObject({ error: "computer_paused" });
    evlog("ws_client_reconnect", { attempt: 1 });
    await Promise.resolve();
    await expect(client.openOmgLiveSocket()).rejects.toMatchObject({ code: "computer_paused" });
    expect(fake.calls).toHaveLength(1);
    expect(fake.sockets).toHaveLength(0);

    now += PAUSED_GATE_START_MS;
    await client.omgFetch("/api/install");
    expect(fake.calls).toHaveLength(2);
  });

  test("the wait doubles on each paused answer and stops at a minute", async () => {
    const waits: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      await client.omgFetch("/api/sessions");
      const before = fake.calls.length;
      const probe = await client.omgFetch("/api/sessions");
      expect(probe.status).toBe(425);
      expect(fake.calls.length).toBe(before);
      // Walk the clock to the moment the gate opens, and record the wait.
      let waited = 0;
      while ((await client.omgFetch("/api/sessions"), fake.calls.length === before)) {
        now += 1_000;
        waited += 1_000;
      }
      waits.push(waited);
    }
    expect(waits[0]).toBe(PAUSED_GATE_START_MS);
    expect(waits[1]).toBe(PAUSED_GATE_START_MS * 2);
    expect(Math.max(...waits)).toBe(PAUSED_GATE_MAX_MS);
  });

  test("a burst of paused answers from one page load counts once", async () => {
    await Promise.all([
      client.omgFetch("/api/sessions"),
      client.omgFetch("/api/install"),
      client.omgFetch("/api/bootstrap"),
    ]);
    expect(fake.calls).toHaveLength(3);
    now += PAUSED_GATE_START_MS;
    await client.omgFetch("/api/sessions");
    expect(fake.calls).toHaveLength(4);
  });

  test("user actions always reach the Computer, because they are what wakes it", async () => {
    await client.omgFetch("/api/sessions");
    answer.status = 200;
    await expect(client.api("/api/sessions/new", { method: "POST", body: "{}" })).resolves.toEqual({ ok: true });
    expect(fake.calls.map((call) => call.method)).toEqual(["GET", "POST"]);
    // The success proved the Computer is up, so polling resumes at once.
    await client.omgFetch("/api/sessions");
    expect(fake.calls).toHaveLength(3);
  });

  test.each([
    ["window focus", () => window.dispatchEvent(new window.Event("focus"))],
    ["coming back online", () => window.dispatchEvent(new window.Event("online"))],
    ["a visible tab", () => document.dispatchEvent(new window.Event("visibilitychange"))],
  ] as const)("%s opens the gate at once", async (_label, userReturns) => {
    await client.omgFetch("/api/sessions");
    await client.omgFetch("/api/sessions");
    expect(fake.calls).toHaveLength(1);
    userReturns();
    answer.status = 200;
    const response = await client.omgFetch("/api/sessions");
    expect(response.status).toBe(200);
    expect(fake.calls).toHaveLength(2);
    await expect(client.openOmgLiveSocket()).resolves.toBeDefined();
  });

  test("switching to another Computer does not inherit the old one's sleep", async () => {
    await client.omgFetch("/api/sessions");
    const other = fakeTransport({ status: 200 });
    client.configureOmgTransport(other.transport);
    await client.omgFetch("/api/sessions");
    expect(other.calls).toHaveLength(1);
  });

  test("an awake Computer is never held", async () => {
    answer.status = 200;
    for (let i = 0; i < 5; i += 1) await client.omgFetch("/api/sessions");
    expect(fake.calls).toHaveLength(5);
  });
});
