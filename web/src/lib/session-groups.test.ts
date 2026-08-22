import { describe, expect, test } from "bun:test";

import { NO_PROJECT_LABEL, groupNodesByProject } from "./session-groups";

const node = (project: string | null, id: string) => ({ id, session: { project } });
const one = () => 1;
const short = (project: string) => project.split("/").pop() || project;

describe("groupNodesByProject", () => {
  test("puts each folder in its own group, labelled by its short name", () => {
    const groups = groupNodesByProject(
      [node("/home/dev/repos/vibes", "a"), node("/home/dev/repos/lfg", "b")],
      one,
      short,
    );
    expect(groups.map((group) => [group.label, group.count])).toEqual([
      ["lfg", 1],
      ["vibes", 1],
    ]);
  });

  // Sorted by label, not by insertion: `find`-style ordering would let two
  // refreshes return the folders differently and read as the list shuffling.
  test("orders folders by label so refreshes cannot reshuffle them", () => {
    const forward = groupNodesByProject(
      [node("/r/alpha", "a"), node("/r/beta", "b"), node("/r/gamma", "c")],
      one,
      short,
    );
    const reversed = groupNodesByProject(
      [node("/r/gamma", "c"), node("/r/beta", "b"), node("/r/alpha", "a")],
      one,
      short,
    );
    expect(forward.map((group) => group.label)).toEqual(["alpha", "beta", "gamma"]);
    expect(reversed.map((group) => group.label)).toEqual(["alpha", "beta", "gamma"]);
  });

  test("collapses every folder-less session into one group", () => {
    const groups = groupNodesByProject([node(null, "a"), node("", "b")], one, short);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "__no_project", label: NO_PROJECT_LABEL, project: "" });
    expect(groups[0].nodes).toHaveLength(2);
  });

  // A family counts its children, so the header is the number of sessions you
  // are about to see rather than the number of roots.
  test("counts a family, not just its root", () => {
    const groups = groupNodesByProject(
      [node("/r/one", "a"), node("/r/one", "b")],
      (item) => (item.id === "a" ? 3 : 1),
      short,
    );
    expect(groups[0].count).toBe(4);
    expect(groups[0].nodes).toHaveLength(2);
  });

  test("carries the raw project key so a group can scope to itself", () => {
    const groups = groupNodesByProject([node("/home/dev/repos/vibes", "a")], one, short);
    expect(groups[0].project).toBe("/home/dev/repos/vibes");
  });

  test("has nothing to group when there are no sessions", () => {
    expect(groupNodesByProject([], one, short)).toEqual([]);
  });
});
