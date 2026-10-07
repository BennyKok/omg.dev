import { expect, mock, test } from "bun:test";
import { resolve } from "node:path";
mock.module(resolve(import.meta.dir, "../src/omg/transport.ts"), () => ({ ComputerGrantError: class extends Error {} }));
const { sharedReadiness, subscribeReadinessRecovery } = await import("../src/omg/readiness");

test("focus and foreground share bootstrap; a later check still reads fresh state", async () => {
  let calls = 0, finish!: (r: Response) => void;
  const transport = { fetch: () => { calls++; return new Promise<Response>(r => { finish = r; }); } } as any;
  const a = sharedReadiness(transport), b = sharedReadiness(transport);
  expect(a).toBe(b); expect(calls).toBe(1);
  finish(Response.json({ sessions: [], codingAgents: [], repos: [] }));
  expect((await a).status).toBe("ready"); await b;
  const c = sharedReadiness(transport); expect(calls).toBe(2);
  finish(new Response("down", { status: 503 }));
  expect((await c).status).toBe("unavailable");
});

test("switching computers does not share readiness between transports", async () => {
  const a = { fetch: async () => Response.json({ sessions: [], version: "a" }) } as any;
  const b = { fetch: async () => Response.json({ sessions: [], version: "b" }) } as any;
  expect(await sharedReadiness(a)).toMatchObject({ status: "ready", version: "a" });
  expect(await sharedReadiness(b)).toMatchObject({ status: "ready", version: "b" });
});

test("compact and legacy bootstrap responses preserve the readiness roster", async () => {
  const roster = { codingAgents: [{ key: "codex", label: "Codex", status: { configured: true } }], repos: [{ name: "work", cwd: "/work" }] };
  for (const body of [roster, { ...roster, sessions: [{ sessionId: "old" }], models: ["unused"] }]) {
    let requested = "";
    const transport = { fetch: async (path: string) => { requested = path; return Response.json(body); } } as any;
    expect(await sharedReadiness(transport)).toMatchObject({ status: "ready", roster: { agents: roster.codingAgents, repos: roster.repos } });
    expect(requested).toBe("/api/bootstrap?view=readiness");
  }
});

test("socket recovery rechecks a failed bootstrap once per recovery and unsubscribes", async () => {
  type State = Parameters<Parameters<Parameters<typeof subscribeReadinessRecovery>[0]["subscribeConnection"]>[0]>[0];
  const listeners = new Set<(state: State) => void>();
  const live = { subscribeConnection: (listener: (state: State) => void) => {
    listeners.add(listener);
    listener({ status: "offline", attempt: 0 });
    return () => { listeners.delete(listener); };
  } };
  let calls = 0;
  const transport = { fetch: async () => {
    calls++;
    return calls === 1 ? Response.json({}, { status: 503 }) : Response.json({ sessions: [] });
  } } as Parameters<typeof sharedReadiness>[0];
  let result = await sharedReadiness(transport);
  expect(result.status).toBe("unavailable");
  const stop = subscribeReadinessRecovery(live, async () => { result = await sharedReadiness(transport); });
  const emit = (status: State["status"]) => { for (const l of listeners) l({ status, attempt: 0 }); };
  emit("live");
  emit("live");
  await Bun.sleep(5);
  expect(result.status).toBe("ready");
  expect(calls).toBe(2);
  emit("reconnecting");
  emit("live");
  await Bun.sleep(5);
  expect(calls).toBe(3);
  stop();
  emit("live");
  expect(listeners.size).toBe(0);
  expect(calls).toBe(3);
});
