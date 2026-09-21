import { expect, test } from "bun:test";
import { basename, projectKey, sessionMatchesProject } from "../src/omg/project-filter";

/**
 * THE REGRESSION, WITH THE REAL DATA.
 *
 * This is the App Store demo account's box, copied from its own /api/bootstrap
 * response: one repo labelled `personal`, living in `/home/user/project`, and
 * every session on it stamped `project: "project"`.
 *
 * Deriving the filter from `name` gives "personal", which equals nothing any
 * session carries, so the list renders empty and looks exactly like a new
 * account. Three real sessions were invisible in the app this way.
 */
const DEMO_REPO = { name: "personal", cwd: "/home/user/project", project: "project" };

test("a renamed repo still matches the sessions the box stamped", () => {
  const filter = projectKey(DEMO_REPO);
  expect(filter).toBe("project");
  for (const cwd of [
    "/home/user/lfg-worktrees/lfg-6c1d9a",
    "/home/user/lfg-worktrees/lfg-f0f191",
    "/home/user/lfg-worktrees/lfg-35f296",
  ]) {
    expect(sessionMatchesProject({ project: "project", cwd }, filter)).toBe(true);
  }
});

test("the label is not the key, so matching on it would be the bug", () => {
  expect(sessionMatchesProject({ project: "project" }, DEMO_REPO.name)).toBe(false);
});

test("a repo whose label was never changed still works", () => {
  const repo = { name: "lfg", cwd: "/home/user/repos/lfg", project: "lfg" };
  expect(projectKey(repo)).toBe("lfg");
  expect(sessionMatchesProject({ project: "lfg" }, projectKey(repo))).toBe(true);
  expect(sessionMatchesProject({ project: "vibes" }, projectKey(repo))).toBe(false);
});

test("an older box that sends no project key falls back to the label", () => {
  expect(projectKey({ name: "personal", cwd: "/home/user/project" })).toBe("personal");
  expect(projectKey({ name: "", cwd: "/home/user/project" })).toBe("project");
});

test("a session with no project stamp is matched by its folder", () => {
  expect(sessionMatchesProject({ cwd: "/home/user/repos/lfg" }, "lfg")).toBe(true);
  expect(sessionMatchesProject({ cwd: "/home/user/repos/vibes" }, "lfg")).toBe(false);
});

test("nothing matches when no project is selected", () => {
  expect(sessionMatchesProject({ project: "lfg" }, null)).toBe(false);
  expect(sessionMatchesProject({ cwd: "/home/user/repos/lfg" }, null)).toBe(false);
});

test("basename ignores a trailing slash", () => {
  expect(basename("/home/user/project/")).toBe("project");
  expect(basename("project")).toBe("project");
});

test("the unassigned tab matches only explicit no-project chats", () => {
  expect(sessionMatchesProject({ project: "", cwd: "/home/user/.omg/chats/one" }, "")).toBe(true);
  expect(sessionMatchesProject({ project: "lfg" }, "")).toBe(false);
  expect(sessionMatchesProject({ cwd: "/home/user/repos/lfg" }, "")).toBe(false);
  expect(sessionMatchesProject({ project: "", cwd: "/home/user/.omg/chats/one" }, "one")).toBe(false);
});
