import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { handleCloudAppsRequest, loadProjectLink, saveProjectLink } from "./cloud-apps.ts";

// A wrong link makes the next deploy replace a different live app, so these
// pin the refusals as well as the happy path. They drive the real route.

let root: string;
let shop: string;
let other: string;

const APPS = [
  { slug: "pen-pals-seats-c9cfx", name: "Pen Pals Seats", projectId: "p_a" },
  { slug: "pen-pals-seats-bd2sp", name: "Pen Pals Seats", projectId: "p_b" },
  { slug: "old-cloud", name: "Old Cloud" },
];

beforeEach(() => {
  const base = join(homedir(), ".cache/lfg/tmp");
  mkdirSync(base, { recursive: true });
  root = mkdtempSync(join(base, "cloud-apps-link-"));
  shop = join(root, "shop");
  other = join(root, "other");
  mkdirSync(shop);
  mkdirSync(other);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function call(path: string, body: unknown) {
  const req = new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await handleCloudAppsRequest(req, new URL(req.url), {
    getAccessToken: async () => "tok",
    controlPlaneUrl: "https://backend.example",
    fetch: async (input) => {
      expect(String(input)).toBe("https://backend.example/api/cli/apps/list");
      return new Response(JSON.stringify({ apps: APPS }), { headers: { "Content-Type": "application/json" } });
    },
    projectFolders: async () => [shop, other],
  });
  return { status: response!.status, body: (await response!.json()) as any };
}

test("links a folder to the exact app it names, by id", async () => {
  const linked = await call("/api/cloud/apps/link", { cwd: shop, slug: "pen-pals-seats-bd2sp" });
  expect(linked.status).toBe(200);
  expect(linked.body).toMatchObject({ slug: "pen-pals-seats-bd2sp", projectId: "p_b", changed: true });
  expect(loadProjectLink(shop)).toEqual({ slug: "pen-pals-seats-bd2sp", projectId: "p_b", name: "Pen Pals Seats" });

  const again = await call("/api/cloud/apps/link", { cwd: shop, slug: "pen-pals-seats-bd2sp" });
  expect(again.body.changed).toBe(false);
});

test("refuses an app that another folder already deploys to", async () => {
  saveProjectLink(other, { slug: "pen-pals-seats-c9cfx", projectId: "p_a", name: "Pen Pals Seats" });
  const refused = await call("/api/cloud/apps/link", { cwd: shop, slug: "pen-pals-seats-c9cfx" });
  expect(refused.status).toBe(409);
  expect(refused.body.error).toContain(other);
  expect(loadProjectLink(shop)).toBeNull();
});

test("keeps an existing link unless replace is set", async () => {
  saveProjectLink(shop, { slug: "pen-pals-seats-c9cfx", projectId: "p_a", name: "Pen Pals Seats" });
  const refused = await call("/api/cloud/apps/link", { cwd: shop, slug: "pen-pals-seats-bd2sp" });
  expect(refused.status).toBe(409);
  expect(loadProjectLink(shop)?.projectId).toBe("p_a");

  const replaced = await call("/api/cloud/apps/link", { cwd: shop, slug: "pen-pals-seats-bd2sp", replace: true });
  expect(replaced.status).toBe(200);
  expect(loadProjectLink(shop)?.projectId).toBe("p_b");
});

test("refuses an unknown app, and an app whose id Cloud did not return", async () => {
  expect((await call("/api/cloud/apps/link", { cwd: shop, slug: "nope" })).status).toBe(404);
  expect((await call("/api/cloud/apps/link", { cwd: shop, slug: "old-cloud" })).status).toBe(409);
  expect(loadProjectLink(shop)).toBeNull();
});

test("unlink removes the link and leaves the folder", async () => {
  saveProjectLink(shop, { slug: "pen-pals-seats-c9cfx", projectId: "p_a", name: "Pen Pals Seats" });
  const first = await call("/api/cloud/apps/unlink", { cwd: shop });
  expect(first.body).toEqual({ unlinked: true });
  expect(loadProjectLink(shop)).toBeNull();
  expect(existsSync(shop)).toBe(true);
  expect((await call("/api/cloud/apps/unlink", { cwd: shop })).body).toEqual({ unlinked: false });
});
