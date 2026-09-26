import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProjectPreviewService, expoGoHostExpiry } from "./project-previews.ts";

let dir: string;
let handle: ReturnType<typeof createProjectPreviewService>;
let listening = true;
let resolves = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omg-preview-"));
  listening = true;
  resolves = 0;
  handle = createProjectPreviewService({
    session: async id => id === "native-a" || id === "a" ? { id: "a", owner: "a@example.com" } : id === "b" ? { id: "b", owner: "b@example.com" } : null,
    viewer: req => req.headers.get("x-omg-viewer-email") ?? "",
    resolve: async (port, options) => {
      resolves++;
      return {
        url: `https://sandbox-${port}.preview.omgs.app/`,
        ...(options?.expoGo ? { expoGoUrl: `https://sandbox-${port}-expires-token.preview.omgs.app/` } : {}),
      };
    },
    listening: async () => listening,
    storePath: join(dir, "previews.json"),
    now: () => 123,
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function call(method: string, sessionId: string, body?: unknown, agent = false, viewer = "a@example.com") {
  const response = await handle(new Request(`http://localhost/api/project-preview?sessionId=${sessionId}`, {
    method,
    headers: { "content-type": "application/json", "x-omg-viewer-email": viewer, ...(agent ? { "x-omg-caller-session-id": sessionId } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  return { status: response.status, data: await response.json() as any };
}

test("the session agent publishes one durable owner-only live preview on any valid port", async () => {
  const created = await call("POST", "native-a", { port: 8081, title: "Expo" }, true);
  expect(created.status).toBe(200);
  expect(created.data.preview).toEqual({
    sessionId: "a", title: "Expo", url: "https://sandbox-8081.preview.omgs.app",
    port: 8081, kind: "sandbox-preview", visibility: "owner", temporary: true, createdAt: 123,
  });
  expect((await call("GET", "a")).data.preview).toEqual(created.data.preview);
  expect(JSON.parse(readFileSync(join(dir, "previews.json"), "utf8"))).toEqual([created.data.preview]);
  expect(resolves).toBe(1);
});

test("refuses an idle or invalid port before resolving cloud state", async () => {
  listening = false;
  expect((await call("POST", "a", { port: 5173 }, true)).status).toBe(409);
  expect((await call("POST", "a", { port: 0 }, true)).status).toBe(400);
  expect((await call("POST", "a", { port: 65_536 }, true)).status).toBe(400);
  expect((await call("POST", "a", { port: 8081.5 }, true)).status).toBe(400);
  expect(resolves).toBe(0);
});

test("prepares Expo Go before Metro starts and returns the secure launch URL", async () => {
  listening = false;
  const created = await call("POST", "a", { port: 8081, title: "Expo", expoGo: true }, true);
  expect(created.status).toBe(200);
  expect(created.data.expoGo).toEqual({
    proxyUrl: "https://sandbox-8081-expires-token.preview.omgs.app",
    url: "exps://sandbox-8081-expires-token.preview.omgs.app",
  });
  expect(resolves).toBe(1);
  const read = await call("GET", "a", undefined, false, "a@example.com");
  expect(read.data.preview.expoGoUrl).toBe("exps://sandbox-8081-expires-token.preview.omgs.app");
});

test("reading a preview reports whether its port still listens", async () => {
  await call("POST", "a", { port: 5173 }, true);
  expect((await call("GET", "a", undefined, false, "a@example.com")).data.live).toBe(true);
  listening = false;
  const stopped = await call("GET", "a", undefined, false, "a@example.com");
  expect(stopped.data.preview.port).toBe(5173);
  expect(stopped.data.live).toBe(false);
});

test("Expo Go is refused outside the Metro port range before the Cloud is called", async () => {
  listening = false;
  for (const port of [3001, 8766, 5173, 8100]) {
    const res = await call("POST", "a", { port, expoGo: true }, true);
    expect(res.status).toBe(400);
  }
  expect(resolves).toBe(0);
});

test("a web preview has no Expo Go link", async () => {
  const created = await call("POST", "a", { port: 5173 }, true);
  expect(created.data.preview.expoGoUrl).toBeUndefined();
});

test("a viewer or another agent cannot publish or read the preview", async () => {
  expect((await call("POST", "a", {}, false)).status).toBe(403);
  expect((await call("POST", "a", {}, true, "b@example.com")).status).toBe(200);
  expect((await call("GET", "a", undefined, false, "b@example.com")).status).toBe(403);
  expect((await call("POST", "a", {}, true)).status).toBe(200);
  expect((await call("POST", "a", {}, true, "a@example.com")).status).toBe(200);
  const wrongAgent = await handle(new Request("http://localhost/api/project-preview?sessionId=a", {
    method: "POST", headers: { "content-type": "application/json", "x-omg-caller-session-id": "b" }, body: "{}",
  }));
  expect(wrongAgent.status).toBe(403);
});

test("reads the expiry the Cloud signs into an Expo Go host", () => {
  const expires = Math.floor(Date.UTC(2026, 8, 24, 12) / 1000);
  expect(expoGoHostExpiry(`e7408bccf4cd-8081-${expires.toString(36)}-0123456789abcdef.preview.omgs.app`)).toBe(expires * 1000);
  expect(expoGoHostExpiry("e7408bccf4cd-8081.preview.omgs.app")).toBeUndefined();
});

test("an expired Expo Go link reads as not live and expired", async () => {
  const expires = 2_000_000;
  let clock = 1_000;
  const service = createProjectPreviewService({
    session: async id => id === "a" ? { id: "a", owner: "a@example.com" } : null,
    viewer: req => req.headers.get("x-omg-viewer-email") ?? "",
    resolve: async port => ({
      url: `https://sandbox-${port}.preview.omgs.app/`,
      expoGoUrl: `https://sandbox-${port}-${expires.toString(36)}-0123456789abcdef.preview.omgs.app/`,
    }),
    listening: async () => true,
    storePath: join(dir, "expiry-previews.json"),
    now: () => clock,
  });
  const post = await service(new Request("http://localhost/api/project-preview?sessionId=a", {
    method: "POST", headers: { "content-type": "application/json", "x-omg-caller-session-id": "a" },
    body: JSON.stringify({ port: 8081, expoGo: true }),
  }));
  expect(((await post.json()) as { preview: { expoGoExpiresAt?: number } }).preview.expoGoExpiresAt).toBe(expires * 1000);
  const read = () => service(new Request("http://localhost/api/project-preview?sessionId=a", { headers: { "x-omg-viewer-email": "a@example.com" } }))
    .then(r => r.json() as Promise<{ live?: boolean; expired?: boolean }>);
  expect(await read()).toMatchObject({ live: true });
  clock = expires * 1000;
  const after = await read();
  expect(after.live).toBe(false);
  expect(after.expired).toBe(true);
});

test("an Expo preview made before Metro runs is starting, not stopped, until its port first answers", async () => {
  listening = false;
  await call("POST", "a", { port: 8081, title: "Expo", expoGo: true }, true);
  const before = await call("GET", "a");
  expect(before.data.live).toBe(false);
  expect(before.data.starting).toBe(true);

  listening = true;
  const up = await call("GET", "a");
  expect(up.data.live).toBe(true);
  expect(up.data.starting).toBeUndefined();
  expect(up.data.preview.notStartedYet).toBeUndefined();

  // After it has run once, a dead port is a real stop, and that survives a restart.
  listening = false;
  const stopped = await call("GET", "a");
  expect(stopped.data.live).toBe(false);
  expect(stopped.data.starting).toBeUndefined();
  expect(JSON.parse(readFileSync(join(dir, "previews.json"), "utf8"))[0].notStartedYet).toBeUndefined();
});

test("a preview title escaped by the model reads as plain text", async () => {
  const created = await call("POST", "a", { port: 5173, title: "FitPulse - Health &amp; Fitness Tracker" }, true);
  expect(created.data.preview.title).toBe("FitPulse - Health & Fitness Tracker");
  const { plainTitle } = await import("./project-previews.ts");
  expect(plainTitle("&lt;b&gt; &quot;x&quot; &#39;y&#39; &amp;amp;")).toBe(`<b> "x" 'y' &amp;`);
});
