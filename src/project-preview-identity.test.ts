import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProjectPreviewService, previewProjectIdentity } from "./project-previews";
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "preview-identity-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function link(path: string, appId: string) {
  mkdirSync(join(path, ".omg"), { recursive: true });
  writeFileSync(join(path, ".omg/project.json"), JSON.stringify({ slug: appId, projectId: `project-${appId}`, name: appId }));
}
test("direct project metadata and the single generated child resolve the same identity", () => {
  expect(previewProjectIdentity(dir)).toBeNull();
  link(join(dir, "family-dinner-planner"), "supper-club");
  expect(previewProjectIdentity(dir)).toEqual({ appId: "supper-club", projectId: "project-supper-club" });
  expect(previewProjectIdentity(join(dir, "family-dinner-planner"))).toEqual(previewProjectIdentity(dir));
});
test("multiple generated projects do not silently select another app", () => {
  link(join(dir, "one"), "first-app"); link(join(dir, "two"), "second-app");
  expect(previewProjectIdentity(dir)).toBeNull();
});
test("stored audience claims cannot override current session metadata or cross owners", async () => {
  const file = join(dir, "previews.json");
  writeFileSync(file, JSON.stringify([{ sessionId: "session", title: "Preview", url: "https://test-8081.preview.omgs.app", port: 8081, kind: "sandbox-preview", visibility: "owner", temporary: true, createdAt: 1, appId: "forged-app", projectId: "forged-project" }]));
  const handle = createProjectPreviewService({ storePath: file, session: async () => ({ id: "session", owner: "owner@test", cwd: dir }), viewer: req => req.headers.get("x-viewer") ?? "", listening: async () => true, resolve: async () => ({ url: "https://test-8081.preview.omgs.app" }) });
  const req = (viewer: string) => new Request("https://test/api/project-preview?sessionId=session", { headers: { "x-viewer": viewer } });
  expect((await handle(req("other@test"))).status).toBe(403);
  expect((await (await handle(req("owner@test"))).json() as { preview: { appId?: string } }).preview.appId).toBeUndefined();
  link(dir, "real-app");
  const data = await (await handle(req("owner@test"))).json() as { preview: { appId: string; projectId: string } };
  expect(data.preview.appId).toBe("real-app"); expect(data.preview.projectId).toBe("project-real-app");
});
