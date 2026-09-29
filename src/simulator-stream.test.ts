import { describe, expect, test } from "bun:test";
import type { ProjectPreview } from "../packages/protocol/src/project-preview.ts";
import { brokerProvider, parseStream, simulatorStreamProvider } from "./simulator-stream.ts";

const preview: ProjectPreview = {
  sessionId: "s-1",
  title: "App",
  url: "https://web.example",
  port: 8081,
  kind: "sandbox-preview",
  visibility: "owner",
  temporary: true,
  createdAt: 1,
  expoGoUrl: "exps://box-8081-tok.preview.omgs.app",
};

function fakeFetch(answer: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answer), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("simulatorStreamProvider", () => {
  test("the env forces it on or off", () => {
    expect(simulatorStreamProvider({ LFG_PREVIEW_SIMULATOR: "0" })).toBeNull();
    const on = simulatorStreamProvider({ LFG_PREVIEW_SIMULATOR: "1" });
    expect(on?.available?.() ?? true).toBe(true);
  });

  test("otherwise the control plane's features file decides, re-read after 5 s", () => {
    let t = 0;
    let features: { simulator?: unknown } = {};
    const p = simulatorStreamProvider({}, { readFeatures: () => features, now: () => t });
    expect(p?.available?.()).toBe(false); // no file: hidden
    features = { simulator: true };
    expect(p?.available?.()).toBe(false); // cached
    t = 5_001;
    expect(p?.available?.()).toBe(true);
    features = { simulator: "yes" };
    t = 10_002;
    expect(p?.available?.()).toBe(false); // only a real true enables it
  });

  test("status posts the session and Expo Go link to the broker with the token", async () => {
    const { f, calls } = fakeFetch({ state: "starting", streamId: "abc", phase: "opening" });
    const p = brokerProvider({ fetch: f, baseUrl: () => "https://cp.test", token: () => "tok" });
    expect(await p.status(preview)).toEqual({ state: "starting", streamId: "abc", phase: "opening" });
    expect(calls[0]?.url).toBe("https://cp.test/api/cli/sim/status");
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ sessionId: "s-1", expoGoUrl: preview.expoGoUrl });
  });

  test("the guest proxy path sends no token of its own", async () => {
    const { f, calls } = fakeFetch({ state: "idle" });
    await brokerProvider({ fetch: f, baseUrl: () => "http://169.254.0.1:9090/cloud", token: () => null }).status(preview);
    expect(calls[0]?.url).toBe("http://169.254.0.1:9090/cloud/api/cli/sim/status");
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  test("status is cached for 2 s; start and stop bypass the cache", async () => {
    let t = 0;
    const { f, calls } = fakeFetch({ state: "idle" });
    const p = brokerProvider({ fetch: f, baseUrl: () => "https://cp.test", token: () => null, now: () => t });
    await p.status(preview);
    await p.status(preview);
    expect(calls).toHaveLength(1);
    t = 2_001;
    await p.status(preview);
    expect(calls).toHaveLength(2);
    await p.start(preview);
    await p.stop(preview);
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["status", "status", "start", "stop"]);
  });

  test("auth and network failures become honest states", async () => {
    const denied = brokerProvider({ fetch: fakeFetch({}, 403).f, baseUrl: () => "https://cp.test", token: () => null });
    expect((await denied.start(preview)).state).toBe("unavailable");
    const down = brokerProvider({
      fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch,
      baseUrl: () => "https://cp.test",
      token: () => null,
    });
    expect((await down.status(preview)).state).toBe("error");
  });
});

describe("parseStream", () => {
  test("ready needs an https stream page", () => {
    expect(parseStream({ state: "ready", streamUrl: "http://x" }).state).toBe("error");
    expect(parseStream({ state: "ready", streamUrl: "https://s/sim/a?token=t", streamId: "a", expiresAt: 5 })).toEqual({
      state: "ready", streamUrl: "https://s/sim/a?token=t", streamId: "a", expiresAt: 5,
    });
  });

  test("unknown states and fields are dropped", () => {
    expect(parseStream({ state: "exploded" }).state).toBe("error");
    expect(parseStream({ state: "queued", queuePosition: 2, extra: "x", phase: "nope" })).toEqual({ state: "queued", queuePosition: 2 });
  });
});
