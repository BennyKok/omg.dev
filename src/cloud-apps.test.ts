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

test("a deploy that outlasts the wait budget returns pending instead of failing", async () => {
  writeFileSync(join(dir, "index.html"), "<h1>hi</h1>");
  let clock = 0;
  const client = createCloudAppsClient({
    getAuthToken: async () => "tok",
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("/deploy-source")) {
        return json({ slug: "hi", url: "https://hi.omgs.app", status: "accepted", projectId: "proj-1", runId: "run-1" });
      }
      return json({ slug: "hi", phase: "building", status: "building" });
    },
    endpoints: { controlPlaneOrigin: "https://backend.example" },
  });
  const result = await deployFolder(client, {
    cwd: dir,
    name: "Hi",
    wait: true,
    waitBudgetMs: 45_000,
    intervalMs: 1,
    now: () => clock,
    sleep: async () => { clock += 10_000; },
  });
  expect(result.pending).toBe(true);
  expect(result.slug).toBe("hi");
  expect(result.latest?.phase).toBe("building");
  expect(clock).toBeLessThanOrEqual(50_000);
});

test("a failed build within the budget still reports the build error", async () => {
  writeFileSync(join(dir, "index.html"), "<h1>hi</h1>");
  const client = createCloudAppsClient({
    getAuthToken: async () => "tok",
    fetch: async (input) => {
      if (String(input).includes("/deploy-source")) {
        return json({ slug: "hi", url: "https://hi.omgs.app", status: "accepted", projectId: "proj-1", runId: "run-1" });
      }
      return json({ slug: "hi", phase: "failed", status: "failed", buildError: "tsc failed" });
    },
    endpoints: { controlPlaneOrigin: "https://backend.example" },
  });
  await expect(deployFolder(client, { cwd: dir, wait: true, waitBudgetMs: 45_000, intervalMs: 1, sleep: async () => {} }))
    .rejects.toThrow("tsc failed");
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

function identityRequest(body: unknown) {
  return new Request("http://127.0.0.1/api/cloud/apps/identity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("omg_app_identity sends name, tagline and the icon file to Cloud", async () => {
  const iconPath = join(dir, "icon.svg");
  writeFileSync(iconPath, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  let sent: any = null;
  const req = identityRequest({ slug: "hi", name: "Hi There", tagline: "Say hi", iconPath });
  const response = await handleCloudAppsRequest(req, new URL(req.url), {
    getAccessToken: async () => "tok",
    controlPlaneUrl: "https://backend.example",
    fetch: async (input, init) => {
      expect(String(input)).toBe("https://backend.example/api/cli/apps/identity");
      sent = JSON.parse(String(init?.body));
      return json({ ok: true, slug: "hi", name: "Hi There", tagline: "Say hi", iconUrl: "https://cdn/x.svg" });
    },
  });
  expect(response?.status).toBe(200);
  expect(sent).toEqual({
    slug: "hi",
    name: "Hi There",
    tagline: "Say hi",
    icon: {
      contentType: "image/svg+xml",
      dataBase64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString("base64"),
    },
  });
});

test("omg_app_identity with only a slug sends no fields", async () => {
  let sent: any = null;
  const req = identityRequest({ slug: "hi" });
  await handleCloudAppsRequest(req, new URL(req.url), {
    getAccessToken: async () => "tok",
    controlPlaneUrl: "https://backend.example",
    fetch: async (_input, init) => {
      sent = JSON.parse(String(init?.body));
      return json({ ok: true, slug: "hi", name: "Hi", tagline: null, iconUrl: null });
    },
  });
  expect(sent).toEqual({ slug: "hi" });
});

test("omg_app_identity refuses a bad icon before any upload", async () => {
  writeFileSync(join(dir, "icon.webp"), "RIFF");
  writeFileSync(join(dir, "big.png"), Buffer.alloc(512 * 1024 + 1));
  for (const iconPath of [join(dir, "icon.webp"), join(dir, "big.png"), join(dir, "missing.png")]) {
    let called = false;
    const req = identityRequest({ slug: "hi", iconPath });
    const response = await handleCloudAppsRequest(req, new URL(req.url), {
      getAccessToken: async () => "tok",
      controlPlaneUrl: "https://backend.example",
      fetch: async () => {
        called = true;
        return json({});
      },
    });
    expect(response?.status).toBe(400);
    expect(called).toBe(false);
  }
});
