import { describe, expect, test } from "bun:test";
import {
  pathnameToSessionId,
  pathnameToTab,
  sessionToPath,
  shouldNavigateToTab,
  shouldPrioritizeSession,
  TAB_VALUES,
  tabToPath,
} from "../web/src/lib/app-search";

describe("Notification Center route", () => {
  test("uses notifications as the canonical page", () => {
    expect(pathnameToTab("/notifications")).toBe("notifications");
    expect(tabToPath("notifications")).toBe("/notifications");
  });

  test("keeps old shipped links compatible", () => {
    expect(pathnameToTab("/shipped")).toBe("notifications");
    expect(tabToPath("shipped")).toBe("/notifications");
  });

  // Agent questions used to own a page at /ask. They are a form of
  // notification, so they moved into the Notification Center and the page went
  // away — but pushed links, bookmarks and the service worker's deep links can
  // still point at /ask.
  test("folds the retired ask page into notifications", () => {
    expect(pathnameToTab("/ask")).toBe("notifications");
    expect(tabToPath("ask")).toBe("/notifications");
  });

  test("ask is no longer a page of its own", () => {
    expect(TAB_VALUES).not.toContain("ask");
    expect(TAB_VALUES).toContain("notifications");
  });
});

describe("Session path routing", () => {
  test("parses and builds /sessions/<id> paths while keeping Live as the active tab", () => {
    const sid = "a1b2c3d4-0000-1111-2222-333333333333";
    const path = sessionToPath(sid);
    expect(path).toBe(`/sessions/${sid}`);
    expect(pathnameToSessionId(path)).toBe(sid);
    expect(pathnameToTab(path)).toBe("live");
  });

  test("prioritizes session rendering on both ?session= search links and /sessions/<id> paths", () => {
    expect(shouldPrioritizeSession({ session: "abc" }, "/")).toBe(true);
    expect(shouldPrioritizeSession({}, "/sessions/abc")).toBe(true);
    expect(shouldPrioritizeSession({}, "/")).toBe(false);
    expect(shouldPrioritizeSession({}, "/settings")).toBe(false);
  });

  test("navigates back to / when selecting live from an open /sessions/<id> or /threads/<id> route", () => {
    expect(shouldNavigateToTab("live", "live", "/")).toBe(false);
    expect(shouldNavigateToTab("live", "live", "/sessions/abc")).toBe(true);
    expect(shouldNavigateToTab("live", "live", "/threads/t1")).toBe(true);
    expect(shouldNavigateToTab("settings", "live", "/settings")).toBe(true);
  });
});
