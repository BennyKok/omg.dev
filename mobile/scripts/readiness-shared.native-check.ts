import { expect, mock, test } from "bun:test";
import { resolve } from "node:path";
mock.module(resolve(import.meta.dir, "../src/omg/transport.ts"), () => ({ ComputerGrantError: class extends Error {} }));
const { sharedReadiness } = await import("../src/omg/readiness");

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
