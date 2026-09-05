import { expect, test } from "bun:test";

import {
  createCloudMachineProxy,
  parseMachinePath,
  type ProxyClientSocket,
} from "./cloud-machine-proxy.ts";

type Call = { url: string; init?: RequestInit };

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetch, calls };
}

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const account = { getAccessToken: async () => "cli-token" };

test("parseMachinePath splits the binding id from the machine path and keeps the query", () => {
  expect(parseMachinePath(new URL("http://box/api/cloud/machines/cloud/api/sessions?x=1"))).toEqual({
    bindingId: "cloud",
    path: "/api/sessions?x=1",
  });
  expect(parseMachinePath(new URL("http://box/api/cloud/machines/abc"))).toEqual({
    bindingId: "abc",
    path: "/",
  });
  expect(parseMachinePath(new URL("http://box/api/cloud/machines/"))).toBeNull();
  expect(parseMachinePath(new URL("http://box/api/sessions"))).toBeNull();
});

test("http requests are forwarded with a minted grant and retried once on 401", async () => {
  let mints = 0;
  let firstRequest = true;
  const { fetch, calls } = fakeFetch((url, init) => {
    if (url.endsWith("/__omg/session-auth")) {
      mints += 1;
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer cli-token");
      expect(JSON.parse(String(init?.body))).toEqual({ bindingId: "box-1" });
      return jsonResponse({ cookie: `grant-${mints}`, expiresInMs: 600_000 });
    }
    if (url === "https://sessions.example/api/sessions?limit=2") {
      if (firstRequest) {
        firstRequest = false;
        return jsonResponse({ error: "expired" }, 401);
      }
      return jsonResponse({ sessions: [] }, 200, {
        "set-cookie": "omg_session_auth=secret",
        "access-control-allow-origin": "https://app.omg.dev",
        "x-omg-request-id": "req-1",
      });
    }
    return jsonResponse({}, 404);
  });
  const proxy = createCloudMachineProxy({ account, sessionOrigin: "https://sessions.example", fetch });

  const req = new Request("http://box/api/cloud/machines/box-1/api/sessions?limit=2", {
    headers: { cookie: "local=1", "x-lfg-session-id": "s1", origin: "http://box" },
  });
  const response = await proxy.handleHttp(req, new URL(req.url));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ sessions: [] });
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  expect(response.headers.get("x-omg-request-id")).toBe("req-1");

  const upstream = calls.filter((c) => c.url.startsWith("https://sessions.example/api/"));
  expect(upstream).toHaveLength(2);
  expect(new Headers(upstream[0]?.init?.headers).get("Authorization")).toBe("Bearer grant-1");
  expect(new Headers(upstream[1]?.init?.headers).get("Authorization")).toBe("Bearer grant-2");
  expect(new Headers(upstream[0]?.init?.headers).has("cookie")).toBe(false);
  expect(new Headers(upstream[0]?.init?.headers).has("origin")).toBe(false);
  expect(new Headers(upstream[0]?.init?.headers).get("x-lfg-session-id")).toBe("s1");
  expect(mints).toBe(2);

  // The refreshed grant is reused; no third mint for the next request.
  firstRequest = false;
  await proxy.handleHttp(req, new URL(req.url));
  expect(mints).toBe(2);
});

test("a POST body is replayed on the retry and one mint serves concurrent requests", async () => {
  let mints = 0;
  const bodies: string[] = [];
  const { fetch } = fakeFetch(async (url, init) => {
    if (url.endsWith("/__omg/session-auth")) {
      mints += 1;
      await new Promise((r) => setTimeout(r, 5));
      return jsonResponse({ cookie: "grant", expiresInMs: 600_000 });
    }
    bodies.push(new TextDecoder().decode(init?.body as Uint8Array));
    return jsonResponse({ ok: true });
  });
  const proxy = createCloudMachineProxy({ account, sessionOrigin: "https://sessions.example", fetch });
  const make = () =>
    new Request("http://box/api/cloud/machines/cloud/api/sessions/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hi" }),
    });
  const [a, b] = await Promise.all([
    proxy.handleHttp(make(), new URL(make().url)),
    proxy.handleHttp(make(), new URL(make().url)),
  ]);
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  expect(mints).toBe(1);
  expect(bodies).toEqual([JSON.stringify({ prompt: "hi" }), JSON.stringify({ prompt: "hi" })]);
});

test("mint failures become readable errors with the right status", async () => {
  for (const [status, expected] of [
    [401, 401],
    [402, 402],
    [403, 403],
    [500, 502],
  ] as const) {
    const { fetch } = fakeFetch(() => jsonResponse({}, status));
    const proxy = createCloudMachineProxy({ account, sessionOrigin: "https://sessions.example", fetch });
    const req = new Request("http://box/api/cloud/machines/cloud/api/bootstrap");
    const response = await proxy.handleHttp(req, new URL(req.url));
    expect(response.status).toBe(expected);
    expect(((await response.json()) as { error: string }).error).toBeTruthy();
  }
  const signedOut = createCloudMachineProxy({
    account: { getAccessToken: async () => null },
    sessionOrigin: "https://sessions.example",
    fetch: fakeFetch(() => jsonResponse({})).fetch,
  });
  const req = new Request("http://box/api/cloud/machines/cloud/api/bootstrap");
  expect((await signedOut.handleHttp(req, new URL(req.url))).status).toBe(401);
});

test("a sleeping cloud Computer is woken once and the request waits for it", async () => {
  let clock = 0;
  let bootstraps = 0;
  const wakes: string[] = [];
  const { fetch } = fakeFetch((url, init) => {
    if (url.endsWith("/__omg/session-auth")) return jsonResponse({ cookie: "g", expiresInMs: 600_000 });
    if (url === "https://backend.example/api/cli/computer/wake") {
      wakes.push(String(new Headers(init?.headers).get("Authorization")));
      return jsonResponse({ status: "waking" });
    }
    bootstraps += 1;
    return bootstraps < 3 ? jsonResponse({ error: "sandbox waking" }, 425) : jsonResponse({ ok: true });
  });
  const proxy = createCloudMachineProxy({
    account,
    sessionOrigin: "https://sessions.example",
    controlPlaneUrl: "https://backend.example",
    fetch,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  const req = new Request("http://box/api/cloud/machines/cloud/api/bootstrap");
  const response = await proxy.handleHttp(req, new URL(req.url));
  expect(response.status).toBe(200);
  expect(bootstraps).toBe(3);
  expect(wakes).toEqual(["Bearer cli-token"]);

  // A paired box is never woken from here: 425 passes through untouched.
  const other = new Request("http://box/api/cloud/machines/box-9/api/bootstrap");
  bootstraps = 0;
  expect((await proxy.handleHttp(other, new URL(other.url))).status).toBe(425);
  expect(wakes).toHaveLength(1);
});

test("the wait is bounded and the last 425 is returned", async () => {
  let clock = 0;
  const { fetch } = fakeFetch((url) =>
    url.endsWith("/__omg/session-auth")
      ? jsonResponse({ cookie: "g", expiresInMs: 600_000 })
      : url.endsWith("/computer/wake")
        ? jsonResponse({})
        : jsonResponse({ error: "sandbox waking" }, 425),
  );
  const proxy = createCloudMachineProxy({
    account,
    sessionOrigin: "https://sessions.example",
    controlPlaneUrl: "https://backend.example",
    fetch,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    wakeWaitMs: 10_000,
  });
  const req = new Request("http://box/api/cloud/machines/cloud/api/bootstrap");
  const response = await proxy.handleHttp(req, new URL(req.url));
  expect(response.status).toBe(425);
  expect(clock).toBeLessThanOrEqual(10_000);
});

class FakeUpstream {
  static instances: FakeUpstream[] = [];
  readyState = 0;
  binaryType = "blob";
  sent: unknown[] = [];
  closed = false;
  private listeners = new Map<string, Array<(event: any) => void>>();
  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    FakeUpstream.instances.push(this);
  }
  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, event: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.emit("open");
  }
}

function fakeClient(
  data: unknown,
): ProxyClientSocket & { sent: unknown[]; closedWith: Array<[number | undefined, string | undefined]> } {
  return {
    data,
    readyState: 1,
    sent: [],
    closedWith: [],
    send(frame) {
      this.sent.push(frame);
    },
    close(code, reason) {
      this.readyState = 3;
      this.closedWith.push([code, reason]);
    },
  };
}

test("websockets dial the session origin with the grant subprotocol and relay both ways", async () => {
  FakeUpstream.instances = [];
  const { fetch } = fakeFetch(() => jsonResponse({ cookie: "grant-ws", expiresInMs: 600_000 }));
  const proxy = createCloudMachineProxy({
    account,
    sessionOrigin: "https://sessions.example",
    fetch,
    WebSocket: FakeUpstream as unknown as typeof globalThis.WebSocket,
  });
  const url = new URL("http://box/api/cloud/machines/cloud/api/live/ws?user=benny");
  const data = proxy.upgradeData(url);
  expect(data).toEqual({ cloudProxy: { bindingId: "cloud", path: "/api/live/ws?user=benny" } });
  const client = fakeClient(data);
  expect(proxy.isProxySocket(client)).toBe(true);
  expect(proxy.isProxySocket(fakeClient({ computer: true }))).toBe(false);

  proxy.open(client);
  // Frames sent before the upstream is up are queued, not dropped.
  proxy.message(client, '{"type":"subscribe"}');
  await new Promise((r) => setTimeout(r, 10));
  const upstream = FakeUpstream.instances[0]!;
  expect(upstream.url).toBe("wss://sessions.example/api/live/ws?user=benny");
  expect(upstream.protocols).toEqual(["lfg-bearer.grant-ws"]);
  expect(upstream.sent).toEqual([]);
  upstream.open();
  expect(upstream.sent).toEqual(['{"type":"subscribe"}']);

  proxy.message(client, "next");
  expect(upstream.sent).toEqual(['{"type":"subscribe"}', "next"]);
  upstream.emit("message", { data: '{"type":"event"}' });
  expect(client.sent).toEqual(['{"type":"event"}']);

  upstream.emit("close", { code: 1006, reason: "" });
  expect(client.closedWith).toEqual([[1011, ""]]);

  const second = fakeClient(proxy.upgradeData(url));
  proxy.open(second);
  await new Promise((r) => setTimeout(r, 10));
  proxy.close(second);
  expect(FakeUpstream.instances[1]?.closed).toBe(true);
});

test("a websocket whose grant cannot be minted is closed with a policy code", async () => {
  FakeUpstream.instances = [];
  const proxy = createCloudMachineProxy({
    account: { getAccessToken: async () => null },
    sessionOrigin: "https://sessions.example",
    fetch: fakeFetch(() => jsonResponse({})).fetch,
    WebSocket: FakeUpstream as unknown as typeof globalThis.WebSocket,
  });
  const client = fakeClient(proxy.upgradeData(new URL("http://box/api/cloud/machines/cloud/api/live/ws")));
  proxy.open(client);
  await new Promise((r) => setTimeout(r, 10));
  expect(FakeUpstream.instances).toHaveLength(0);
  expect(client.closedWith[0]?.[0]).toBe(1008);
});
