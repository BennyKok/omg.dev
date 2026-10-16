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

type TreeNode = ComponentProps<typeof SessionGroups>["groups"][number]["nodes"][number];
const tree = (sessionId: string, children: TreeNode[] = [], busy = false) =>
  ({ session: { project: "site", title: sessionId, sessionId, agent: "claude", busy }, children }) as TreeNode;

test("a parent's subagents fold behind one row, as on iOS, and open on demand", async () => {
  const { resetSubagentGroupChoices } = await import("./lib/subagent-group-open");
  resetSubagentGroupChoices();
  // A grandchild spawned by a subagent belongs to the same flat group.
  const groups = [{ key: "site", project: "site", label: "site", count: 1, nodes: [
    tree("parent", [tree("child-a", [tree("grandchild")], true), tree("child-b")]),
  ] }];
  ui.render(<SessionGroups groups={groups} pinnedNodes={[]} pinnedCount={0} projectFilter="__all"
    renderItem={(session) => <div key={session.sessionId}>{session.title}</div>} />);
  expect(ui.text()).toContain("parent");
  expect(ui.text()).toContain("3 subagents");
  expect(ui.text()).toContain("1 working");
  expect(ui.text()).not.toContain("child-a");
  const toggle = ui.query('button[aria-label*="subagent"]') as HTMLButtonElement;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  ui.flush(() => toggle.click());
  expect(ui.text()).toContain("child-a");
  expect(ui.text()).toContain("grandchild");
  expect(ui.text()).toContain("child-b");
  ui.flush(() => (ui.query('button[aria-label*="subagent"]') as HTMLButtonElement).click());
  expect(ui.text()).not.toContain("grandchild");
});

test("a subagent open on the stage keeps its group open until the reader shuts it", async () => {
  const { resetSubagentGroupChoices } = await import("./lib/subagent-group-open");
  resetSubagentGroupChoices();
  const groups = [{ key: "site", project: "site", label: "site", count: 1, nodes: [tree("parent", [tree("child")])] }];
  ui.render(<SessionGroups groups={groups} pinnedNodes={[]} pinnedCount={0} projectFilter="__all" activeIds={["child"]}
    renderItem={(session) => <div key={session.sessionId}>{session.title}</div>} />);
  expect(ui.text()).toContain("1 subagent");
  expect(ui.text()).toContain("child");
  ui.flush(() => (ui.query('button[aria-label*="subagent"]') as HTMLButtonElement).click());
  expect((ui.query('button[aria-label*="subagent"]') as HTMLButtonElement).getAttribute("aria-expanded")).toBe("false");
});
