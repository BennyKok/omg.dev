// A Computer is reached over a slow, metered path. These tests protect two
// promises the client makes about it: overlapping identical reads cost one
// request, and a read never answers with data from before a write it follows.
import "../test-support/render";
import { beforeEach, describe, expect, test } from "bun:test";
import type { OmgTransport } from "@omg-dev/client";

const client = await import("./omg-client");

type Pending = { path: string; method: string; release: (response: Response) => void };

function controlledTransport() {
  const pending: Pending[] = [];
  const wait = (path: string, init?: RequestInit) =>
    new Promise<Response>((resolve) => {
      pending.push({ path, method: (init?.method ?? "GET").toUpperCase(), release: resolve });
    });
  const transport: OmgTransport = {
    fetch: (path, init) => wait(path, init),
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      return (await (await wait(path, init)).json()) as T;
    },
    async openSocket() {
      return {} as never;
    },
    async openLiveSocket() {
      return {} as never;
    },
  };
  return { transport, pending };
}

const json = (value: unknown) => Response.json(value);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let fake = controlledTransport();
beforeEach(() => {
  fake = controlledTransport();
  client.configureOmgTransport(fake.transport);
  client.resetComputerPausedGateForTest();
});

describe("overlapping reads", () => {
  test("identical JSON reads in flight together make one request, and each caller owns its result", async () => {
    const first = client.api<{ items: number[] }>("/api/threads");
    const second = client.api<{ items: number[] }>("/api/threads");
    await tick();
    expect(fake.pending.map((p) => p.path)).toEqual(["/api/threads"]);
    fake.pending[0].release(json({ items: [1, 2] }));
    const [a, b] = await Promise.all([first, second]);
    a.items.push(3);
    expect(b.items).toEqual([1, 2]);
  });

  test("identical omgFetch JSON reads share one request and both can read the body", async () => {
    const first = client.omgFetch("/api/ask?status=open", { cache: "no-store" });
    const second = client.omgFetch("/api/ask?status=open", { cache: "no-store" });
    await tick();
    expect(fake.pending).toHaveLength(1);
    fake.pending[0].release(json({ questions: [{ id: "q1" }] }));
    const [a, b] = await Promise.all([first, second]);
    expect(await a.json()).toEqual({ questions: [{ id: "q1" }] });
    expect(await b.json()).toEqual({ questions: [{ id: "q1" }] });
  });

  test("a file read is never held for a second caller; the second caller fetches its own", async () => {
    const first = client.omgFetch("/api/artifacts/a1/raw");
    const second = client.omgFetch("/api/artifacts/a1/raw");
    await tick();
    fake.pending[0].release(new Response("bytes", { headers: { "content-type": "application/octet-stream" } }));
    expect(await (await first).text()).toBe("bytes");
    await tick();
    expect(fake.pending).toHaveLength(2);
    fake.pending[1].release(new Response("bytes", { headers: { "content-type": "application/octet-stream" } }));
    expect(await (await second).text()).toBe("bytes");
  });

  test("a read that can be cancelled is never shared", async () => {
    const controller = new AbortController();
    void client.omgFetch("/api/settings", { signal: controller.signal });
    void client.omgFetch("/api/settings", { signal: controller.signal });
    await tick();
    expect(fake.pending).toHaveLength(2);
  });
});

describe("reads around a write", () => {
  test("a read asked for after a write starts fetches again instead of joining an older read", async () => {
    const before = client.api<{ sessions: string[] }>("/api/sessions");
    await tick();
    const write = client.api("/api/sessions", { method: "POST", body: "{}" });
    await tick();
    const after = client.api<{ sessions: string[] }>("/api/sessions");
    await tick();
    expect(fake.pending.map((p) => `${p.method} ${p.path}`)).toEqual([
      "GET /api/sessions",
      "POST /api/sessions",
      "GET /api/sessions",
    ]);
    fake.pending[0].release(json({ sessions: [] }));
    fake.pending[1].release(json({ ok: true }));
    fake.pending[2].release(json({ sessions: ["new"] }));
    expect(await before).toEqual({ sessions: [] });
    await write;
    expect(await after).toEqual({ sessions: ["new"] });
  });

  test("a read that started while a write was running does not answer a read asked after the write", async () => {
    const write = client.api("/api/sessions", { method: "POST", body: "{}" });
    await tick();
    const during = client.api<{ sessions: string[] }>("/api/sessions");
    await tick();
    fake.pending[0].release(json({ ok: true }));
    await write;
    const after = client.api<{ sessions: string[] }>("/api/sessions");
    await tick();
    expect(fake.pending.filter((p) => p.method === "GET")).toHaveLength(2);
    fake.pending[1].release(json({ sessions: [] }));
    fake.pending[2].release(json({ sessions: ["new"] }));
    expect(await during).toEqual({ sessions: [] });
    expect(await after).toEqual({ sessions: ["new"] });
  });
});
