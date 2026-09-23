import { describe, expect, test } from "bun:test";
import { sideNavCurrentKey, sideNavRows } from "./side-nav-items";

const keys = (rows: { key: string }[]) => rows.map((row) => row.key);

describe("sideNavRows", () => {
  test("offers every destination a phone has, surfaces first and Settings last", () => {
    // This is the reachability contract. The drawer is the ONLY page
    // navigation on a phone now: the bottom bar and the overflow menu are
    // both gone, so a page missing here is a page with no route to it.
    expect(keys(sideNavRows({ tab: "live" }))).toEqual([
      "live",
      "bots",
      "auto",
      "notifications",
      "artifacts",
      "computer",
      "board",
      "settings",
    ]);
  });

  test("marks exactly one row, and marks the tab you are on", () => {
    for (const tab of ["live", "bots", "auto", "notifications", "artifacts", "board"]) {
      const rows = sideNavRows({ tab });
      const current = rows.filter((row) => row.current);
      expect(current.map((row) => row.key)).toEqual([tab]);
    }
  });

  test("a settings sub-page keeps Settings marked", () => {
    // Opening Settings > Usage used to leave nothing marked, so the drawer
    // looked like it had lost its place.
    for (const tab of ["usage", "coding-agents", "connectors", "changelog", "more"]) {
      expect(sideNavCurrentKey(tab)).toBe("settings");
      expect(sideNavRows({ tab }).find((row) => row.current)?.key).toBe("settings");
    }
  });

  test("a session or any other Live detail keeps Chat marked", () => {
    expect(sideNavRows({ tab: "sessions" }).find((row) => row.current)?.key).toBe("live");
  });

  test("the View switches drop their surfaces, as they dropped dock segments", () => {
    expect(keys(sideNavRows({ tab: "live", showBots: false }))).not.toContain("bots");
    expect(keys(sideNavRows({ tab: "live", showSchedules: false }))).not.toContain("auto");
    expect(keys(sideNavRows({ tab: "live", showBots: false, showSchedules: false }))).toEqual([
      "live",
      "notifications",
      "artifacts",
      "computer",
      "board",
      "settings",
    ]);
  });

  test("a role's hidden pages are absent, and Chat takes the mark", () => {
    const rows = sideNavRows({ tab: "board", hiddenPages: ["board", "computer"] });
    expect(keys(rows)).not.toContain("board");
    expect(keys(rows)).not.toContain("computer");
    // The tab they were on is gone, so the drawer must still show a place
    // rather than nothing.
    expect(rows.find((row) => row.current)?.key).toBe("live");
  });

  test("a host that owns Settings gets no Settings row", () => {
    expect(keys(sideNavRows({ tab: "live", showSettings: false }))).not.toContain("settings");
  });

  test("extensions sit before Settings and can be the current row", () => {
    const rows = sideNavRows({
      tab: "my-ext",
      extensions: [{ id: "my-ext", label: "My Extension" }],
    });
    expect(keys(rows).slice(-2)).toEqual(["my-ext", "settings"]);
    expect(rows.find((row) => row.current)?.key).toBe("my-ext");
    expect(rows.find((row) => row.key === "my-ext")?.label).toBe("My Extension");
  });
});
