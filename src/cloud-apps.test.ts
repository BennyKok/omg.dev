import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCloudAppsClient } from "../packages/cloud/src/apps.ts";
import {
  GUEST_PROJECT_ROOT,
  collectProjectFiles,
  deployFolder,
  handleCloudAppsRequest,
  loadProjectLink,
} from "./cloud-apps.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omg-cloud-apps-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("collectProjectFiles walks a folder and prefixes /home/user/project", () => {
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "index.ts"), "export {}\n");
  writeFileSync(join(dir, "package.json"), '{"name":"app"}\n');
  mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "x", "index.js"), "skip");
  writeFileSync(join(dir, ".env"), "SECRET=1");
  writeFileSync(join(dir, ".env.local"), "SECRET=2");
  mkdirSync(join(dir, ".agents", "skills"), { recursive: true });
  writeFileSync(join(dir, ".agents", "skills", "SKILL.md"), "agent-only");
  writeFileSync(join(dir, "AGENTS.md"), "agent-only");
  writeFileSync(join(dir, "CLAUDE.md"), "agent-only");

  const collected = collectProjectFiles(dir);
  const paths = collected.files.map((file) => file.path).sort();
  expect(paths).toEqual([`${GUEST_PROJECT_ROOT}/package.json`, `${GUEST_PROJECT_ROOT}/src/index.ts`]);
  expect(collected.skippedSecrets.sort()).toEqual([".env", ".env.local"]);
  const pkg = collected.files.find((file) => file.path.endsWith("package.json"));
  expect(Buffer.from(pkg!.content, "base64").toString("utf8")).toContain('"name":"app"');
});

test("deployFolder posts files, waits until ready, and writes .omg/project.json", async () => {
  writeFileSync(join(dir, "index.html"), "<h1>hi</h1>");
  const statuses = ["building", "ready"];
  const client = createCloudAppsClient({
    getAuthToken: async () => "tok",
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("/deploy-source")) {
        return json({
          slug: "hi",
          url: "https://hi.omgs.app",
          status: "accepted",
          projectId: "proj-1",
          runId: "run-1",
          dashboardUrl: "https://omg.dev/proj-1",
        });
      }
      if (url.includes("/apps/status")) {
        const phase = statuses.shift() ?? "ready";
        return json({ slug: "hi", phase, url: "https://hi.omgs.app", status: phase });
      }
      return json({}, 404);
    },
    endpoints: { controlPlaneOrigin: "https://backend.example" },
  });

  const result = await deployFolder(client, {
    cwd: dir,
    name: "Hi",
    wait: true,
    intervalMs: 1,
    sleep: async () => {},
  });
  expect(result.slug).toBe("hi");
  expect(result.latest?.phase).toBe("ready");
  expect(loadProjectLink(dir)).toEqual({ slug: "hi", projectId: "proj-1", name: "Hi" });
});

test("handleCloudAppsRequest deploys through the local /api/cloud/apps/deploy route", async () => {
  writeFileSync(join(dir, "index.html"), "<h1>hi</h1>");
  const req = new Request("http://127.0.0.1/api/cloud/apps/deploy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: dir, name: "Hi" }),
  });
  const response = await handleCloudAppsRequest(req, new URL(req.url), {
    getAccessToken: async () => "tok",
    controlPlaneUrl: "https://backend.example",
    fetch: async (input) => {
      const url = String(input);
      expect(url).toBe("https://backend.example/api/cli/apps/deploy-source");
      return json({
        slug: "hi",
        url: "https://hi.omgs.app",
        status: "accepted",
        projectId: "proj-1",
        runId: "run-1",
        dashboardUrl: "https://omg.dev/proj-1",
      });
    },
  });
  expect(response?.status).toBe(200);
  const body = (await response?.json()) as { slug: string };
  expect(body.slug).toBe("hi");
});

test("handleCloudAppsRequest returns null for unrelated paths", async () => {
  const req = new Request("http://127.0.0.1/api/cloud/session");
  expect(await handleCloudAppsRequest(req, new URL(req.url), { getAccessToken: async () => null })).toBeNull();
});
