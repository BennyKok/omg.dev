import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProjectPreviewService } from "./project-previews.ts";

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
