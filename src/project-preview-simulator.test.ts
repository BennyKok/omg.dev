import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ProjectPreview, SimulatorStreamProvider } from "../packages/protocol/src/project-preview.ts";
import { createProjectPreviewService } from "./project-previews.ts";
import { simulatorStreamProvider } from "./simulator-stream.ts";

let dir: string;
const calls: string[] = [];
let failStatus = false;

const provider: SimulatorStreamProvider = {
  status: async (preview: ProjectPreview) => {
    calls.push(`status ${preview.expoGoUrl}`);
    if (failStatus) throw new Error("mac offline");
    return { state: "ready", streamUrl: "https://sim.example/stream/abc" };
  },
  start: async (preview) => { calls.push(`start ${preview.port}`); return { state: "starting" }; },
  stop: async (preview) => { calls.push(`stop ${preview.port}`); },
};

function service(simulator: SimulatorStreamProvider | null) {
  return createProjectPreviewService({
    session: async id => id === "a" ? { id: "a", owner: "a@example.com" } : null,
    viewer: req => req.headers.get("x-omg-viewer-email") ?? "",
    resolve: async (port, options) => ({
      url: `https://sandbox-${port}.preview.omgs.app/`,
      ...(options?.expoGo ? { expoGoUrl: `https://sandbox-${port}-expires-token.preview.omgs.app/` } : {}),
    }),
    listening: async () => true,
    storePath: join(dir, "previews.json"),
    now: () => 123,
    simulator,
  });
}

async function call(handle: ReturnType<typeof service>, method: string, path: string, body?: unknown, agent = false) {
  const response = await handle(new Request(`http://localhost${path}?sessionId=a`, {
    method,
    headers: { "content-type": "application/json", "x-omg-viewer-email": "a@example.com", ...(agent ? { "x-omg-caller-session-id": "a" } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  return { status: response.status, data: await response.json() as any };
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "omg-sim-")); calls.length = 0; failStatus = false; });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("with the flag off, the snapshot has no simulator level and the action is 404", async () => {
  const handle = service(null);
  await call(handle, "POST", "/api/project-preview", { port: 8081, expoGo: true }, true);
  const snapshot = await call(handle, "GET", "/api/project-preview");
  expect(snapshot.data.preview.expoGoUrl).toBeTruthy();
  expect("simulator" in snapshot.data).toBe(false);
  expect((await call(handle, "POST", "/api/project-preview/simulator", { action: "start" })).status).toBe(404);
});

test("with a provider, an Expo snapshot carries the stream state for the card", async () => {
  const handle = service(provider);
  await call(handle, "POST", "/api/project-preview", { port: 8081, expoGo: true }, true);
  const snapshot = await call(handle, "GET", "/api/project-preview");
  expect(snapshot.data.simulator).toEqual({ state: "ready", streamUrl: "https://sim.example/stream/abc" });
  expect(calls).toEqual(["status exps://sandbox-8081-expires-token.preview.omgs.app"]);
});

test("a plain web preview never offers the simulator", async () => {
  const handle = service(provider);
  await call(handle, "POST", "/api/project-preview", { port: 5173 }, true);
  expect("simulator" in (await call(handle, "GET", "/api/project-preview")).data).toBe(false);
  expect(calls).toEqual([]);
});

test("a failing provider reports an error state and keeps the card", async () => {
  failStatus = true;
  const handle = service(provider);
  await call(handle, "POST", "/api/project-preview", { port: 8081, expoGo: true }, true);
  const snapshot = await call(handle, "GET", "/api/project-preview");
  expect(snapshot.data.preview).toBeTruthy();
  expect(snapshot.data.simulator.state).toBe("error");
});

test("the owner's card starts and stops the simulator; the agent cannot", async () => {
  const handle = service(provider);
  await call(handle, "POST", "/api/project-preview", { port: 8081, expoGo: true }, true);
  expect((await call(handle, "POST", "/api/project-preview/simulator", { action: "start" }, true)).status).toBe(403);
  expect((await call(handle, "POST", "/api/project-preview/simulator", { action: "start" })).data).toEqual({ state: "starting" });
  expect((await call(handle, "POST", "/api/project-preview/simulator", { action: "stop" })).data).toEqual({ state: "idle" });
  expect((await call(handle, "POST", "/api/project-preview/simulator", { action: "reboot" })).status).toBe(400);
  expect(calls).toEqual(["start 8081", "stop 8081"]);
});

test("the level is hidden unless the control plane enables it; the env forces it", () => {
  expect(simulatorStreamProvider({}, { readFeatures: () => ({}) })?.available?.()).toBe(false);
  expect(simulatorStreamProvider({}, { readFeatures: () => ({ simulator: true }) })?.available?.()).toBe(true);
  expect(simulatorStreamProvider({ LFG_PREVIEW_SIMULATOR: "0" })).toBeNull();
  expect(simulatorStreamProvider({ LFG_PREVIEW_SIMULATOR: "1" })?.available?.() ?? true).toBe(true);
});
