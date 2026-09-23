import { describe, expect, test } from "bun:test";
import {
  NO_PROJECT_FILTER,
  projectFilterAfterPress,
  resolveInitialProjectFilter,
  NO_PROJECT_FILTER_LABEL,
  projectFilterLabel,
  sessionMatchesProjectFilter,
} from "./project-filter";

const shortProject = (project: string) => project.split("/").pop() || project;

describe("sessionMatchesProjectFilter", () => {
  test("__all keeps every session", () => {
    expect(sessionMatchesProjectFilter({ project: "duet" }, "__all")).toBe(true);
    expect(sessionMatchesProjectFilter({ project: "" }, "__all")).toBe(true);
    expect(sessionMatchesProjectFilter({}, "__all")).toBe(true);
  });

  test("a named project matches only itself", () => {
    expect(sessionMatchesProjectFilter({ project: "duet" }, "duet")).toBe(true);
    expect(sessionMatchesProjectFilter({ project: "lfg" }, "duet")).toBe(false);
    expect(sessionMatchesProjectFilter({ project: "" }, "duet")).toBe(false);
  });

  test("No project matches an explicit empty project", () => {
    expect(sessionMatchesProjectFilter({ project: "" }, NO_PROJECT_FILTER)).toBe(true);
    expect(sessionMatchesProjectFilter({ project: "duet" }, NO_PROJECT_FILTER)).toBe(false);
  });

  test("a legacy row with no project field is NOT a no-project chat", () => {
    // It predates the field and still falls back to its working directory.
    // Folding it in here would fill the scratch list with old repo sessions.
    expect(sessionMatchesProjectFilter({}, NO_PROJECT_FILTER)).toBe(false);
    expect(sessionMatchesProjectFilter({ project: null }, NO_PROJECT_FILTER)).toBe(false);
  });
});

describe("projectFilterLabel", () => {
  test("names both sentinels and shortens a real project", () => {
    expect(projectFilterLabel("__all", shortProject)).toBe("All projects");
    expect(projectFilterLabel(NO_PROJECT_FILTER, shortProject)).toBe(NO_PROJECT_FILTER_LABEL);
    expect(projectFilterLabel("/home/dev/repos/duet", shortProject)).toBe("duet");
  });
});

describe("projectFilterAfterPress", () => {
  test("an unselected pill scopes to it", () => {
    expect(projectFilterAfterPress("duet", "__all")).toBe("duet");
    expect(projectFilterAfterPress("duet", "lfg")).toBe("duet");
    expect(projectFilterAfterPress(NO_PROJECT_FILTER, "lfg")).toBe(NO_PROJECT_FILTER);
  });

  test("the selected pill clears the scope, including the no-project pill", () => {
    // The rail has no "All" pill, so a second press is the only way back to
    // every folder from the rail itself.
    expect(projectFilterAfterPress("duet", "duet")).toBe("__all");
    expect(projectFilterAfterPress(NO_PROJECT_FILTER, NO_PROJECT_FILTER)).toBe("__all");
  });
});

describe("resolveInitialProjectFilter", () => {
  const options = [NO_PROJECT_FILTER, "duet", "lfg", "vibes"];

  test("keeps a remembered folder that still exists", () => {
    expect(resolveInitialProjectFilter({ saved: "lfg", options })).toBe("lfg");
    expect(resolveInitialProjectFilter({ saved: NO_PROJECT_FILTER, options })).toBe(
      NO_PROJECT_FILTER,
    );
  });

  test("never parks on all, because the rail has no pill for it", () => {
    expect(resolveInitialProjectFilter({ saved: "__all", options })).toBe("duet");
  });

  test("a folder that has gone away falls to the preferred one", () => {
    expect(
      resolveInitialProjectFilter({ saved: "deleted", options, preferred: "vibes" }),
    ).toBe("vibes");
  });

  test("a preferred folder that is not listed is ignored", () => {
    expect(
      resolveInitialProjectFilter({ saved: "__all", options, preferred: "gone" }),
    ).toBe("duet");
  });

  test("prefers a real folder over the no-project scope", () => {
    // That scope is for starting something new, not somewhere to be parked
    // on by default.
    expect(resolveInitialProjectFilter({ saved: "__all", options })).not.toBe(
      NO_PROJECT_FILTER,
    );
  });

  test("a box with only the no-project scope settles there", () => {
    expect(
      resolveInitialProjectFilter({ saved: "__all", options: [NO_PROJECT_FILTER] }),
    ).toBe(NO_PROJECT_FILTER);
  });

  test("with nothing to choose from, it changes nothing", () => {
    // Options arrive after the first render. Resolving against an empty list
    // would overwrite the saved folder with a guess before the real list
    // lands, and the guess would stick.
    expect(resolveInitialProjectFilter({ saved: "lfg", options: [] })).toBe("lfg");
    expect(resolveInitialProjectFilter({ saved: "__all", options: [] })).toBe("__all");
  });
});
