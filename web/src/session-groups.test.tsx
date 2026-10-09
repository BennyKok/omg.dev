import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "./test-support/render";
import type { ComponentProps } from "react";
const { SessionGroups } = await import("./App");

let ui: Mounted;
beforeEach(() => { ui = mount(); });
afterEach(() => ui.cleanup());

test("the mobile session list separates all projects with headers and filter controls", () => {
  const changes: string[] = [];
  const node = (project: string, title: string) => ({ session: { project, title, sessionId: title }, children: [] }) as ComponentProps<typeof SessionGroups>["groups"][number]["nodes"][number];
  const groups = ["site", "api"].map((project) => ({ key: project, project, label: project, count: 1, nodes: [node(project, `${project} task`)] }));
  const render = (filter: string) => ui.render(<SessionGroups groups={groups.filter((group) => filter === "__all" || group.project === filter)}
    pinnedNodes={[]} pinnedCount={0} projectFilter={filter} onProjectChange={(value) => changes.push(value)}
    renderItem={(session) => <div key={session.sessionId}>{session.title}</div>} />);
  render("__all");
  expect(ui.text()).toContain("site · 1");
  expect(ui.text()).toContain("api · 1");
  expect(ui.text()).toContain("site task");
  expect(ui.text()).toContain("api task");
  ui.flush(() => (ui.query('[aria-label="Show only site"]') as HTMLButtonElement).click());
  expect(changes).toEqual(["site"]);
  render("site");
  expect(ui.text()).toContain("site · 1");
  expect(ui.text()).not.toContain("api task");
  ui.flush(() => (ui.query('[aria-label="Show every folder"]') as HTMLButtonElement).click());
  expect(changes).toEqual(["site", "__all"]);
});
