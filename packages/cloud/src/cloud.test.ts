import { expect, test } from "bun:test";

import {
  CLOUD_BINDING_ID,
  ComputerGrantError,
  OmgAuthError,
  SignOutFailedError,
  autoSelectBinding,
  bindingLabel,
  createCloudAuth,
  createControlPlaneClient,
  createDirectTransport,
  createGrantMinter,
  createMachineTransports,
  mintTargetForBinding,
  parseSharedBindingId,
  probeReadiness,
  resolveCloudEndpoints,
  sharedBindingId,
  waitForReady,
} from "./index";

type Call = { url: string; init?: RequestInit };

function fakeFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init });
      return handler(url, init);
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("resolveCloudEndpoints fills defaults and trims slashes", () => {
  const endpoints = resolveCloudEndpoints({ authOrigin: "https://auth.example/" });
  expect(endpoints.authOrigin).toBe("https://auth.example");
  expect(endpoints.controlPlaneOrigin).toBe("https://backend.omg.dev");
  expect(endpoints.sessionOrigin).toBe("https://sessions.omgs.app");
});

test("shared binding id round trips and decodes to the mint target", () => {
  const id = sharedBindingId("owner-1", "box:with:colons");
  expect(parseSharedBindingId(id)).toEqual({ ownerUserId: "owner-1", bindingId: "box:with:colons" });
  expect(mintTargetForBinding(id)).toEqual({ bindingId: "box:with:colons", ownerUserId: "owner-1" });
  expect(mintTargetForBinding("plain")).toEqual({ bindingId: "plain" });
  expect(parseSharedBindingId("shared::x")).toBeNull();
});

test("getAuthToken mints once for concurrent callers and reuses within the TTL", async () => {
  let mints = 0;
  let clock = 1_000;
  const { fetch, calls } = fakeFetch((url) => {
    if (url.endsWith("/token")) {
      mints += 1;
      return json({ token: `jwt-${mints}` });
    }
    return json({}, 404);
  });
  const auth = createCloudAuth({
    endpoints: { authOrigin: "https://auth.example" },
    fetch,
    requestOrigin: "https://omg.dev",
    now: () => clock,
  });

  const [a, b] = await Promise.all([auth.getAuthToken(), auth.getAuthToken()]);
  expect(a).toBe("jwt-1");
  expect(b).toBe("jwt-1");
  expect(mints).toBe(1);
  expect(calls[0]?.url).toBe("https://auth.example/token");
  expect(new Headers(calls[0]?.init?.headers).get("Origin")).toBe("https://omg.dev");

  clock += 10_000;
  expect(await auth.getAuthToken()).toBe("jwt-1");
  clock += 40_000;
  expect(await auth.getAuthToken()).toBe("jwt-2");

  auth.clearAuthToken();
  expect(await auth.getAuthToken()).toBe("jwt-3");
});

test("getAuthToken returns null on 401 and throws OmgAuthError on other failures", async () => {
  let status = 401;
  const { fetch } = fakeFetch(() => json({}, status));
  const auth = createCloudAuth({ fetch });
  expect(await auth.getAuthToken()).toBeNull();
  status = 500;
  await expect(auth.getAuthToken()).rejects.toBeInstanceOf(OmgAuthError);
});

test("signOut fails closed and treats 401 as already signed out", async () => {
  let status = 500;
  const { fetch } = fakeFetch((url) => (url.endsWith("/sign-out") ? json({}, status) : json({})));
  const auth = createCloudAuth({ fetch });
  await expect(auth.signOut()).rejects.toBeInstanceOf(SignOutFailedError);
  status = 401;
  await auth.signOut();
  const offline = createCloudAuth({
    fetch: async () => {
      throw new Error("offline");
    },
  });
  await expect(offline.signOut()).rejects.toBeInstanceOf(SignOutFailedError);
});

test("grant minter decodes shared ids and maps status codes to error codes", async () => {
  let status = 200;
  const { fetch, calls } = fakeFetch(() =>
    status === 200 ? json({ cookie: "grant-1", expiresInMs: 60_000 }) : json({}, status),
  );
  const mint = createGrantMinter({
    endpoints: { sessionOrigin: "https://sessions.example" },
    getAuthToken: async () => "jwt",
    fetch,
    now: () => 5_000,
  });

  const grant = await mint(sharedBindingId("owner", "box"));
  expect(grant).toEqual({ token: "grant-1", expiresAt: 65_000 });
  expect(calls[0]?.url).toBe("https://sessions.example/__omg/session-auth");
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ bindingId: "box", ownerUserId: "owner" });
  expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe("Bearer jwt");

  for (const [code, expected] of [
    [401, "unauthorized"],
    [402, "upgrade_required"],
    [403, "forbidden"],
    [503, "unavailable"],
  ] as const) {
    status = code;
    const error = await mint("box").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ComputerGrantError);
    expect((error as ComputerGrantError).code).toBe(expected);
  }

  const signedOut = createGrantMinter({ getAuthToken: async () => null, fetch });
  const error = await signedOut("box").catch((e: unknown) => e);
  expect((error as ComputerGrantError).code).toBe("unauthorized");
});

test("machine transports share one grant per binding and forget on demand", async () => {
  let mints = 0;
  const mint = async (bindingId: string) => {
    mints += 1;
    return { token: `${bindingId}-${mints}`, expiresAt: Date.now() + 600_000 };
  };
  const { fetch, calls } = fakeFetch(() => json({ ok: true }));
  const transports = createMachineTransports({
    endpoints: { sessionOrigin: "https://sessions.example" },
    mintSessionGrant: mint,
    fetch,
  });

  const first = transports.get("box-a");
  expect(transports.get("box-a")).toBe(first);
  await Promise.all([first.request("/api/one"), first.request("/api/two")]);
  expect(mints).toBe(1);
  expect(calls.map((c) => c.url)).toEqual([
    "https://sessions.example/api/one",
    "https://sessions.example/api/two",
  ]);
  expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe("Bearer box-a-1");

  transports.forget("box-a");
  expect(transports.get("box-a")).not.toBe(first);
  await transports.get("box-a").request("/api/three");
  expect(mints).toBe(2);
});

test("direct transport hits the given origin with no auth", async () => {
  const { fetch, calls } = fakeFetch((url) =>
    url.endsWith("/api/fail") ? json({ error: "nope" }, 500) : json({ hello: "world" }),
  );
  const transport = createDirectTransport("http://100.64.0.2:8766/", { fetch });
  expect(await transport.request("/api/hello")).toEqual({ hello: "world" });
  expect(calls[0]?.url).toBe("http://100.64.0.2:8766/api/hello");
  expect(new Headers(calls[0]?.init?.headers).has("Authorization")).toBe(false);
  await expect(transport.request("/api/fail")).rejects.toThrow("nope");
});

test("control plane lists machines with each read allowed to fail alone", async () => {
  const { fetch, calls } = fakeFetch((url) => {
    if (url.endsWith("/listComputerBindings")) {
      return json({ bindings: [{ id: "box-1", online: true, computerUrl: "http://studio.tail:8766" }] });
    }
    if (url.endsWith("/getCloudComputer")) return json({ status: "live" });
    if (url.endsWith("/listSharedComputers")) return json({ error: "boom" }, 500);
    return json({}, 404);
  });
  const client = createControlPlaneClient({
    endpoints: { controlPlaneOrigin: "https://backend.example" },
    getAuthToken: async () => "jwt",
    fetch,
  });
  const list = await client.listMachines();
  expect(list.bindings.map((b) => b.id)).toEqual(["box-1"]);
  expect(list.cloud?.status).toBe("live");
  expect(list.sharedComputers).toEqual([]);
  expect(list.error).toBeNull();
  expect(calls.every((c) => c.url.startsWith("https://backend.example/api/computer/"))).toBe(true);
  expect(bindingLabel(list.bindings[0]!)).toBe("studio");

  const down = createControlPlaneClient({
    getAuthToken: async () => "jwt",
    fetch: async () => json({ error: "down" }, 503),
  });
  const failed = await down.listMachines();
  expect(failed.error).toBe("down");
  expect(failed.bindings).toEqual([]);
});

test("shared machines become bindings with the opaque shared id", async () => {
  const { fetch } = fakeFetch((url) =>
    url.endsWith("/listSharedComputers")
      ? json({
          computers: [
            { ownerUserId: "u1", bindingId: "b1", email: "ada@example.com", name: "Ada Lovelace", sharedAt: 1, hostname: "studio" },
          ],
        })
      : json({}),
  );
  const client = createControlPlaneClient({ getAuthToken: async () => "jwt", fetch });
  const [shared] = await client.listSharedComputers();
  expect(shared?.id).toBe("shared:u1:b1");
  expect(shared?.computerUrl).toBeNull();
  expect(shared?.ownerName).toBe("Ada Lovelace");
  expect(shared?.machineLabel).toBe("studio");
});

test("autoSelectBinding picks the one online box, else an unblocked cloud, else nothing", () => {
  expect(autoSelectBinding({ bindings: [{ id: "a" }, { id: "b", online: true }], cloud: null })).toBe("b");
  expect(autoSelectBinding({ bindings: [], cloud: { status: "live" } })).toBe(CLOUD_BINDING_ID);
  expect(autoSelectBinding({ bindings: [], cloud: { status: "upgrade_required" } })).toBeNull();
  expect(autoSelectBinding({ bindings: [{ id: "a" }], cloud: { status: "live" } })).toBeNull();
});

test("readiness maps bootstrap responses and waits out a wake", async () => {
  const responses = [
    json({ error: "sandbox waking" }, 425),
    json({ version: "1.2.3", sessions: [{}], codingAgents: [{ key: "claude", label: "Claude" }], repos: [] }),
  ];
  const transport = createDirectTransport("http://box", {
    fetch: async () => responses.shift() ?? json({}, 500),
  });
  const waking: number[] = [];
  const ready = await waitForReady(transport, {
    intervalMs: 1,
    sleep: async () => {},
    onWaking: (n) => waking.push(n),
  });
  expect(waking).toEqual([1]);
  expect(ready.status).toBe("ready");
  if (ready.status === "ready") {
    expect(ready.version).toBe("1.2.3");
    expect(ready.roster.agents[0]?.key).toBe("claude");
  }

  const forbidden = await probeReadiness({
    ...transport,
    fetch: async () => {
      throw new ComputerGrantError("revoked", "forbidden");
    },
  });
  expect(forbidden).toEqual({ status: "unauthorized", message: "revoked" });

  const limit = await probeReadiness(
    createDirectTransport("http://box", { fetch: async () => json({ error: "cap" }, 429) }),
  );
  expect(limit).toEqual({ status: "agent-limit", message: "cap" });
});
