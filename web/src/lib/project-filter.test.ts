import { describe, expect, test } from "bun:test";
import {
  NO_PROJECT_FILTER,
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
