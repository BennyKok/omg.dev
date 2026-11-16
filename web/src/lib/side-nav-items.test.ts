import { describe, expect, test } from "bun:test";
import { mobileHeader, sideNavCurrentKey, sideNavRows, tabFallsToSettings } from "./side-nav-items";

const keys = (rows: { key: string }[]) => rows.map((row) => row.key);

describe("sideNavRows", () => {
  test("offers every destination a phone has, surfaces first and Settings last", () => {
    // This is the reachability contract. The drawer is the ONLY page
    // navigation on a phone now: the bottom bar and the overflow menu are
    // both gone, so a page missing here is a page with no route to it.
    expect(keys(sideNavRows({ tab: "live" }))).toEqual([
      "live",
      "dashboard",
      "auto",
      "notifications",
      "artifacts",
      "computer",
      "settings",
    ]);
  });

  test("Bots and Board have no row; their tabs keep Chat marked", () => {
    // Bots is reached from the Chat/Bots switch, Board from the Pages menu.
    for (const tab of ["bots", "board"]) {
      const rows = sideNavRows({ tab });
      expect(keys(rows)).not.toContain(tab);
      expect(rows.find((row) => row.current)?.key).toBe("live");
    }
  });

  test("marks exactly one row, and marks the tab you are on", () => {
    for (const tab of ["live", "dashboard", "auto", "notifications", "artifacts"]) {
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

  test("the Schedules View switch drops its row, as it dropped a dock segment", () => {
    expect(keys(sideNavRows({ tab: "live", showSchedules: false }))).toEqual([
      "live",
      "dashboard",
      "notifications",
      "artifacts",
      "computer",
      "settings",
    ]);
  });

  test("a role's hidden pages are absent, and Chat takes the mark", () => {
    const rows = sideNavRows({ tab: "computer", hiddenPages: ["computer"] });
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

describe("mobileHeader", () => {
  test("Chats shows the menu button, and the menu page has no header control", () => {
    expect(mobileHeader("live")).toEqual({ control: "menu" });
    expect(mobileHeader("folders")).toEqual({ control: "none" });
  });

  test("every other page shows one Back arrow and its own name", () => {
    for (const [tab, title] of [
      ["dashboard", "Dashboard"],
      ["notifications", "Inbox"],
      ["artifacts", "Artifacts"],
      ["auto", "Schedules"],
      ["settings", "Settings"],
      ["bots", "Bots"],
      ["board", "Board"],
    ]) {
      expect(mobileHeader(tab)).toEqual({ control: "back", target: "live", targetLabel: "Chats", title });
    }
  });

  test("Back returns to the menu when the menu opened the page", () => {
    // Schedules and Artifacts are menu rows. They used to say Settings and
    // Inbox, pages the reader had not come from.
    for (const tab of ["dashboard", "notifications", "artifacts", "auto", "settings"]) {
      const head = mobileHeader(tab, { fromMenu: true });
      expect(head).toMatchObject({ control: "back", target: "folders", targetLabel: "Menu" });
    }
  });

  test("a page only Settings lists returns to Settings, wherever Settings was opened from", () => {
    for (const tab of ["usage", "coding-agents", "storage", "instructions", "connectors", "changelog", "more"]) {
      for (const fromMenu of [false, true]) {
        expect(mobileHeader(tab, { fromMenu })).toMatchObject({ control: "back", target: "settings" });
      }
    }
    expect(mobileHeader("storage")).toMatchObject({ title: "Storage & performance" });
  });

  test("under a host that owns Settings, its sub-pages return to Chats", () => {
    expect(mobileHeader("usage", { hasSettings: false })).toMatchObject({ target: "live", targetLabel: "Chats" });
  });

  test("an extension page shows the extension's label", () => {
    const head = mobileHeader("ext-a", { extensions: [{ id: "ext-a", label: "Reports" }] });
    expect(head).toMatchObject({ control: "back", target: "live", title: "Reports" });
  });
});

describe("tabFallsToSettings", () => {
  test("the Folders page, Dashboard, and every page with its own view do not draw Settings under them", () => {
    for (const tab of ["folders", "live", "dashboard", "notifications", "computer", "artifacts", "usage", "auto"]) {
      expect(tabFallsToSettings(tab)).toBe(false);
    }
  });

  test("Settings itself and an unknown tab show Settings", () => {
    expect(tabFallsToSettings("settings")).toBe(true);
    expect(tabFallsToSettings("no-such-page")).toBe(true);
  });
});
