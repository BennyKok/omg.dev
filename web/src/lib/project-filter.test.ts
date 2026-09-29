import { describe, expect, test } from "bun:test";
import {
  cacheProjectFilter,
  NO_PROJECT_FILTER,
  PROJECT_FILTER_TTL_MS,
  readCachedProjectFilter,
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

  test("keeps a folder picked in this visit that still exists", () => {
    expect(resolveInitialProjectFilter({ saved: "lfg", options })).toBe("lfg");
    expect(resolveInitialProjectFilter({ saved: NO_PROJECT_FILTER, options })).toBe(
      NO_PROJECT_FILTER,
    );
  });

  test("an unscoped list opens on no project, never on a folder nobody picked", () => {
    // A new chat from Home goes where this points. Opening on a folder sent a
    // first request into an old test repo (walkthrough 2026-09-29).
    expect(resolveInitialProjectFilter({ saved: "__all", options })).toBe(NO_PROJECT_FILTER);
  });

  test("a folder that has gone away falls to no project", () => {
    expect(resolveInitialProjectFilter({ saved: "deleted", options })).toBe(NO_PROJECT_FILTER);
  });

  test("with nothing to choose from, it changes nothing", () => {
    // Options arrive after the first render. Resolving against an empty list
    // would overwrite the saved folder with a guess before the real list
    // lands, and the guess would stick.
    expect(resolveInitialProjectFilter({ saved: "lfg", options: [] })).toBe("lfg");
    expect(resolveInitialProjectFilter({ saved: "__all", options: [] })).toBe("__all");
  });
});

describe("the remembered folder pick", () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      data,
    };
  }

  test("a visit with nothing picked opens on no project", () => {
    expect(readCachedProjectFilter(memoryStorage())).toBe(NO_PROJECT_FILTER);
    expect(readCachedProjectFilter(null)).toBe(NO_PROJECT_FILTER);
  });

  test("a pick made in this visit is read back", () => {
    const storage = memoryStorage();
    cacheProjectFilter("expo-go-probe", storage, 1_000);
    expect(readCachedProjectFilter(storage, 1_000 + 60_000)).toBe("expo-go-probe");
  });

  test("a pick older than the limit is dropped", () => {
    const storage = memoryStorage();
    cacheProjectFilter("expo-go-probe", storage, 1_000);
    expect(readCachedProjectFilter(storage, 1_000 + PROJECT_FILTER_TTL_MS)).toBe(NO_PROJECT_FILTER);
  });

  test("an old bare value from localStorage days is not trusted", () => {
    const storage = memoryStorage();
    storage.setItem("lfg_v2_project_filter", "expo-go-probe");
    expect(readCachedProjectFilter(storage)).toBe(NO_PROJECT_FILTER);
  });
});
