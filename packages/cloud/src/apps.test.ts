import { expect, test } from "bun:test";

import {
  CloudAppsError,
  createCloudAppsClient,
  isDeployDone,
  isDeployFailed,
} from "./apps";

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

test("createCloudAppsClient attaches a bearer token when one exists", async () => {
  const { fetch, calls } = fakeFetch((url) => {
    if (url.endsWith("/api/cli/whoami")) return json({ userId: "u1", email: "ada@example.com" });
    return json({}, 404);
  });
  const client = createCloudAppsClient({
    getAuthToken: async () => "tok-1",
    fetch,
    endpoints: { controlPlaneOrigin: "https://backend.example" },
  });
  expect(await client.whoami()).toEqual({ userId: "u1", email: "ada@example.com" });
  expect(calls[0]?.url).toBe("https://backend.example/api/cli/whoami");
  expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe("Bearer tok-1");
});

test("createCloudAppsClient still calls Cloud with no token so a proxy can inject one", async () => {
  const { fetch, calls } = fakeFetch(() => json({ userId: "sandbox-owner" }));
  const client = createCloudAppsClient({
    getAuthToken: async () => null,
    fetch,
    endpoints: { controlPlaneOrigin: "https://backend.example" },
  });
  expect(await client.whoami()).toEqual({ userId: "sandbox-owner" });
  expect(new Headers(calls[0]?.init?.headers).has("Authorization")).toBe(false);
});

test("deploySource posts the files-only body and listApps unwraps {apps}", async () => {
  const { fetch, calls } = fakeFetch((url) => {
    if (url.endsWith("/api/cli/apps/deploy-source")) {
      return json({
        slug: "hello",
        url: "https://hello.omgs.app",
        status: "accepted",
        projectId: "p1",
        runId: "r1",
        dashboardUrl: "https://omg.dev/p1",
      });
    }
    if (url.endsWith("/api/cli/apps/list")) return json({ apps: [{ slug: "hello", name: "Hello" }] });
    return json({}, 404);
  });
  const client = createCloudAppsClient({
    getAuthToken: async () => "tok",
    fetch,
    endpoints: { controlPlaneOrigin: "https://backend.example" },
  });
  const deployed = await client.deploySource({
    idempotencyKey: "k1",
    name: "Hello",
    files: [{ path: "/home/user/project/index.html", content: "aGVsbG8=" }],
  });
  expect(deployed.slug).toBe("hello");
  const posted = JSON.parse(String(calls[0]?.init?.body)) as { idempotencyKey: string; files: unknown[] };
  expect(posted.idempotencyKey).toBe("k1");
  expect(posted.files).toHaveLength(1);
  expect(await client.listApps()).toEqual([{ slug: "hello", name: "Hello" }]);
});

test("Cloud errors surface status and message", async () => {
  const { fetch } = fakeFetch(() => json({ error: "slug is required" }, 400));
  const client = createCloudAppsClient({
    getAuthToken: async () => "tok",
    fetch,
    endpoints: { controlPlaneOrigin: "https://backend.example" },
  });
  try {
    await client.getStatus("");
    throw new Error("expected failure");
  } catch (error) {
    expect(error).toBeInstanceOf(CloudAppsError);
    expect((error as CloudAppsError).status).toBe(400);
    expect((error as CloudAppsError).message).toBe("slug is required");
  }
});

test("deploy phase helpers treat ready as done and failed as fatal", () => {
  expect(isDeployDone({ phase: "ready" })).toBe(true);
  expect(isDeployDone({ status: "succeeded" })).toBe(true);
  expect(isDeployFailed({ phase: "failed" })).toBe(true);
  expect(isDeployFailed({ status: "error" })).toBe(true);
  expect(isDeployDone({ phase: "building" })).toBe(false);
});
