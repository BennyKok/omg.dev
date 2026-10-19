import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { handleCloudAppsRequest, loadProjectLink, saveProjectLink } from "./cloud-apps.ts";

// omg_app_rename drives this route. Cloud moves the app; locally, every folder
// linked to the old slug must follow, or env/visibility calls lose the app.

let root: string;
let shop: string;
let other: string;

beforeEach(() => {
  const base = join(homedir(), ".cache/lfg/tmp");
  mkdirSync(base, { recursive: true });
  root = mkdtempSync(join(base, "cloud-apps-rename-"));
  shop = join(root, "shop");
  other = join(root, "other");
  mkdirSync(shop);
  mkdirSync(other);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function call(body: unknown, reply: () => Response) {
  const sent: Array<{ url: string; body: unknown }> = [];
  const req = new Request("http://127.0.0.1/api/cloud/apps/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await handleCloudAppsRequest(req, new URL(req.url), {
    getAccessToken: async () => "tok",
    controlPlaneUrl: "https://backend.example",
    fetch: async (input, init) => {
      sent.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return reply();
    },
    projectFolders: async () => [shop, other],
  });
  return { status: response!.status, body: (await response!.json()) as any, sent };
}

const moved = () =>
  new Response(
    JSON.stringify({ ok: true, slug: "new-shop", previousSlug: "old-shop", url: "https://new-shop.omgs.app" }),
    { headers: { "Content-Type": "application/json" } },
  );

test("renames through Cloud and relinks only the folders on the old slug", async () => {
  saveProjectLink(shop, { slug: "old-shop", projectId: "p_shop", name: "Shop" });
  saveProjectLink(other, { slug: "other-app", projectId: "p_other", name: "Other" });

  const res = await call({ slug: "old-shop", newSlug: "new-shop" }, moved);
  expect(res.status).toBe(200);
  expect(res.sent).toEqual([
    { url: "https://backend.example/api/cli/apps/rename", body: { slug: "old-shop", newSlug: "new-shop" } },
  ]);
  expect(res.body).toMatchObject({ slug: "new-shop", url: "https://new-shop.omgs.app", relinkedFolders: [shop] });
  expect(loadProjectLink(shop)).toEqual({ slug: "new-shop", projectId: "p_shop", name: "Shop" });
  expect(loadProjectLink(other)?.slug).toBe("other-app");
});

test("a refused rename changes no local link", async () => {
  saveProjectLink(shop, { slug: "old-shop", projectId: "p_shop", name: "Shop" });
  const res = await call({ slug: "old-shop", newSlug: "taken" }, () =>
    new Response(JSON.stringify({ error: "That subdomain is already taken" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }));
  expect(res.status).not.toBe(200);
  expect(loadProjectLink(shop)?.slug).toBe("old-shop");
});

test("requires slug and newSlug", async () => {
  for (const body of [{ newSlug: "x-app" }, { slug: "old-shop" }]) {
    const res = await call(body, moved);
    expect(res.status).toBe(400);
    expect(res.sent).toHaveLength(0);
  }
});
