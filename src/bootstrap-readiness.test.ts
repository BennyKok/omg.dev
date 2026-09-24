import { expect, test } from "bun:test";
import { readinessBootstrap } from "./bootstrap-readiness";

test("readiness keeps the mobile roster and omits bulky catalog data", async () => {
  const response = await readinessBootstrap({
    codingAgents: async () => [{ key: "codex", label: "Codex", visible: false, status: { configured: true, accountConnected: false }, models: ["bulky"] }],
    repos: async () => [{ name: "work", cwd: "/work", instructions: "not needed" }],
  }, { version: "test", bootId: "process" });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-cache");
  expect(response.headers.get("Server-Timing")).toMatch(/^bootstrap;dur=[\d.]+$/);
  expect(await response.json()).toEqual({ version: "test", bootId: "process", codingAgents: [{ key: "codex", label: "Codex", visible: false, status: { configured: true, accountConnected: false } }], repos: [{ name: "work", cwd: "/work" }] });
});

test("rosters start in parallel and one failure does not discard the other", async () => {
  let release!: () => void;
  let repoStarted = false;
  const pending = readinessBootstrap({
    codingAgents: () => new Promise((_, reject) => { release = () => reject(Error("unavailable")); }),
    repos: async () => { repoStarted = true; return [{ name: "work", cwd: "/work" }]; },
  }, { version: "test", bootId: "process" });
  await Promise.resolve();
  expect(repoStarted).toBe(true);
  release();
  expect(await (await pending).json()).toMatchObject({ codingAgents: null, repos: [{ name: "work", cwd: "/work" }] });
});
