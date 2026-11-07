import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { default: AppsList } = await import("./apps-list");
const { buildLocalProjects } = await import("./apps-home");

let ui: Mounted;
const originalFetch = globalThis.fetch;
beforeEach(() => {
  ui = mount();
  globalThis.fetch = (async () => Response.json({ facets: { projects: [] } })) as typeof fetch;
});
afterEach(() => {
  ui.cleanup();
  globalThis.fetch = originalFetch;
});

test("projects on this computer are grouped with their sessions, newest work first", () => {
  const repos = [
    { cwd: "/home/me/alpha", project: "alpha", name: "alpha" },
    { cwd: "/home/me/beta", project: "beta", name: "beta" },
  ];
  const sessions = [
    { sessionId: "s1", cwd: "/home/me/beta/src", lastActivityAt: 20 },
    { sessionId: "s2", cwd: "/home/me/alpha", lastActivityAt: 10 },
    { sessionId: "s3", cwd: "/elsewhere", lastActivityAt: 30 },
  ];
  const local = buildLocalProjects(repos, sessions, (repo) => repo.project);
  expect(local.map((item) => [item.name, item.sessions.map((s) => s.sessionId)])).toEqual([
    ["beta", ["s1"]],
    ["alpha", ["s2"]],
  ]);
});

test("the Apps page lists local folders and opens one by its project", async () => {
  const opened: string[] = [];
  const local = [{ project: "alpha", name: "alpha", sessions: [{ sessionId: "s2", lastActivityAt: 10 }], lastActivityAt: 10 }];
  ui.render(<AppsList local={local} onOpenProject={(project) => opened.push(project)} />);
  await ui.flushAsync();
  expect(ui.text()).toContain("Projects · 1");
  expect(ui.text()).toContain("On this computer");
  expect(ui.text()).not.toContain("Published");
  (ui.queryAll("button").find((b) => b.textContent?.includes("alpha")) as HTMLButtonElement).click();
  expect(opened).toEqual(["alpha"]);
});

test("with no projects it says how to start one", async () => {
  ui.render(<AppsList local={[]} onOpenProject={() => {}} />);
  await ui.flushAsync();
  expect(ui.text()).toContain("No projects yet");
});
