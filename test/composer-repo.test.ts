import { describe, expect, test } from "bun:test";
import { resolveComposerRepo } from "../web/src/lib/composer-repo.ts";

const repos = [{ cwd: "/home/dev/repos/alpha" }, { cwd: "/home/dev/repos/beta" }];

describe("composer default repo", () => {
  test("keeps the last selection when it is still a known project", () => {
    expect(
      resolveComposerRepo({ lastCwd: "/home/dev/repos/beta", repos }),
    ).toBe("/home/dev/repos/beta");
  });

  test("falls back to the first available project when there is no last selection", () => {
    expect(resolveComposerRepo({ lastCwd: null, repos })).toBe("/home/dev/repos/alpha");
    expect(resolveComposerRepo({ lastCwd: "", repos })).toBe("/home/dev/repos/alpha");
  });

  test("falls back to the first project when the last selection is gone", () => {
    // The regression: a removed project (or a path remembered on another
    // device) used to win outright and pin the composer to a dead directory.
    expect(
      resolveComposerRepo({ lastCwd: "/home/dev/repos/deleted", repos }),
    ).toBe("/home/dev/repos/alpha");
  });

  test("a project-scoped live view still wins over both", () => {
    expect(
      resolveComposerRepo({
        scopedCwd: "/home/dev/repos/beta",
        lastCwd: "/home/dev/repos/alpha",
        repos,
      }),
    ).toBe("/home/dev/repos/beta");
  });

  test("holds the remembered value while the project list is still loading", () => {
    // Avoids flashing the wrong project on first paint; the value gets
    // validated on the next render once repos arrive.
    expect(
      resolveComposerRepo({ lastCwd: "/home/dev/repos/beta", repos: [] }),
    ).toBe("/home/dev/repos/beta");
  });

  test("returns empty when there is nothing to select", () => {
    expect(resolveComposerRepo({ lastCwd: null, repos: [] })).toBe("");
  });
});
