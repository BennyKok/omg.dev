// The mobile side nav's row list. The phone drawer and the iPad rail footer
// both render exactly this, so "which rows, in which order, and which one is
// current" is the part worth pinning down; the drawing is verified on a device.
import { describe, expect, test } from "bun:test";

import {
  sideNavCurrentPage,
  sideNavRows,
} from "../mobile/src/omg/side-nav-items";

describe("mobile side nav rows", () => {
  test("lists the pages in order, with Live current on the list itself", () => {
    const rows = sideNavRows({ pathname: "/", keyboardShortcuts: false });
    expect(rows.map((row) => row.key)).toEqual([
      "live",
      "notifications",
      "schedules",
      "settings",
    ]);
    expect(rows.filter((row) => row.kind === "page" && row.current).map((row) => row.key)).toEqual([
      "live",
    ]);
  });

  test("lists the shortcuts card only when the binary can deliver key commands", () => {
    const without = sideNavRows({ pathname: "/", keyboardShortcuts: false });
    expect(without.some((row) => row.key === "shortcuts")).toBe(false);

    const withCard = sideNavRows({ pathname: "/", keyboardShortcuts: true });
    const last = withCard[withCard.length - 1];
    expect(last).toEqual({
      kind: "action",
      key: "shortcuts",
      label: "Keyboard shortcuts",
    });
  });

  test("marks the page you are on, and only that one", () => {
    const rows = sideNavRows({ pathname: "/settings", keyboardShortcuts: true });
    const current = rows.filter((row) => row.kind === "page" && row.current);
    expect(current.map((row) => row.key)).toEqual(["settings"]);
  });

  test("a transcript still belongs to Live", () => {
    // The iPad keeps the rail on screen beside an open session, so leaving
    // every row unselected there would say the reader is nowhere.
    expect(sideNavCurrentPage("/session/abc-123")).toBe("live");
    expect(sideNavCurrentPage("/auto/agent-7")).toBe("live");
  });

  test("a page's own sub-routes stay on that page", () => {
    expect(sideNavCurrentPage("/auto/agent-7/finding-2")).toBe("live");
    expect(sideNavCurrentPage("/notifications")).toBe("notifications");
    expect(sideNavCurrentPage("/schedules")).toBe("schedules");
  });

  test("the current row is never a dead row: every page row carries an href", () => {
    for (const row of sideNavRows({ pathname: "/schedules", keyboardShortcuts: true })) {
      if (row.kind === "page") expect(row.href.startsWith("/")).toBe(true);
    }
  });
});
