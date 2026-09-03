import { describe, expect, test } from "bun:test";
import {
  BOT_ROSTER_ROW_CLASS,
  isPrimarySurfaceTab,
  mobileSurfaceDockBottom,
  mobileSurfaceToggleActive,
  shouldShowBotsInSessionList,
  shouldShowInlineBotsSurfaceToggle,
  shouldShowMobileSurfaceToggle,
} from "./mobile-bots-nav";

test("the mobile bot roster uses a flat rail-style row", () => {
  expect(BOT_ROSTER_ROW_CLASS).toContain("hover:bg-muted");
  expect(BOT_ROSTER_ROW_CLASS).not.toContain("border-border");
  expect(BOT_ROSTER_ROW_CLASS).not.toContain("bg-card");
  // 8px vertical padding paired with the 44px avatar in App.tsx (down from
  // 56px) puts the row pitch at 68px. The mockup's own 10px/12px density
  // (py-2.5, PR #208) still measured 84px because that density assumed the
  // large avatar; shrinking the avatar is what makes the row scannable.
  expect(BOT_ROSTER_ROW_CLASS).toContain("py-2");
  expect(BOT_ROSTER_ROW_CLASS).toContain("gap-3");
  expect(BOT_ROSTER_ROW_CLASS).not.toContain("py-2.5");
  expect(BOT_ROSTER_ROW_CLASS).not.toContain("py-4");
});

describe("shouldShowMobileSurfaceToggle", () => {
  test("shows on the Live tab at mobile widths", () => {
    expect(shouldShowMobileSurfaceToggle(true, "live")).toBe(true);
  });

  test("shows on the Bots tab at mobile widths", () => {
    expect(shouldShowMobileSurfaceToggle(true, "bots")).toBe(true);
  });

  test("shows on the Scheduled tab at mobile widths", () => {
    expect(shouldShowMobileSurfaceToggle(true, "auto")).toBe(true);
  });

  test("stays off an open bot conversation", () => {
    expect(shouldShowMobileSurfaceToggle(true, "bots", "bot_scout")).toBe(false);
  });

  test("stays hidden on desktop/tablet widths regardless of tab", () => {
    expect(shouldShowMobileSurfaceToggle(false, "live")).toBe(false);
    expect(shouldShowMobileSurfaceToggle(false, "bots")).toBe(false);
  });

  test("stays hidden on secondary pages, even on mobile", () => {
    // Notifications/Artifacts/Settings/extension tabs stay behind the
    // existing PagesMenu overflow — the toggle must not grow into a second
    // tab strip that also covers them.
    expect(shouldShowMobileSurfaceToggle(true, "notifications")).toBe(false);
    expect(shouldShowMobileSurfaceToggle(true, "artifacts")).toBe(false);
    expect(shouldShowMobileSurfaceToggle(true, "settings")).toBe(false);
    expect(shouldShowMobileSurfaceToggle(true, "some-extension-tab")).toBe(false);
  });
});

describe("mobileSurfaceToggleActive", () => {
  test("bots tab maps to the chat segment", () => {
    expect(mobileSurfaceToggleActive("bots")).toBe("chat");
  });

  test("auto tab maps to the scheduled segment", () => {
    expect(mobileSurfaceToggleActive("auto")).toBe("auto");
  });

  test("live and any other tab map to the sessions segment", () => {
    expect(mobileSurfaceToggleActive("live")).toBe("sessions");
    expect(mobileSurfaceToggleActive("notifications")).toBe("sessions");
  });
});

describe("shouldShowBotsInSessionList", () => {
  // Bots are reached through the Chat/Bots switch bar, on every width. The
  // desktop rail used to ALSO repeat them in a "Bots" group inside the Chat
  // list, so one conversation had two rows in the same rail and two places to
  // carry the same unread dot. Mobile never did this.
  test("keeps bot families out of Chat at every width", () => {
    expect(shouldShowBotsInSessionList()).toBe(false);
  });
});

describe("mobileSurfaceDockBottom", () => {
  test("sits above the Live composer", () => {
    expect(mobileSurfaceDockBottom(true)).toContain("--lfg-inline-composer-height");
  });

  test("uses the safe-area edge on the Bots roster", () => {
    expect(mobileSurfaceDockBottom(false)).toBe("var(--lfg-safe-bottom)");
  });
});

describe("shouldShowInlineBotsSurfaceToggle", () => {
  test("hidden at real mobile widths (persistent bottom toggle covers it)", () => {
    expect(shouldShowInlineBotsSurfaceToggle(true)).toBe(false);
  });

  test("shown in the tablet band, where there is no persistent bottom toggle", () => {
    expect(shouldShowInlineBotsSurfaceToggle(false)).toBe(true);
  });
});

describe("isPrimarySurfaceTab", () => {
  test("covers every segment of the switch bar", () => {
    expect(isPrimarySurfaceTab("live")).toBe(true);
    expect(isPrimarySurfaceTab("bots")).toBe(true);
    expect(isPrimarySurfaceTab("auto")).toBe(true);
  });

  // The regression this predicate exists for. Scheduled was missing from the
  // hand-written tab lists in the header, so it took the secondary-page
  // chrome and its back button ran a hardcoded setTab("settings") — you left
  // Scheduled through Settings no matter how you arrived.
  test("Scheduled is a peer of Live, not a page under Settings", () => {
    expect(isPrimarySurfaceTab("auto")).toBe(isPrimarySurfaceTab("live"));
  });

  test("secondary pages are not primary surfaces", () => {
    for (const tab of ["settings", "notifications", "artifacts", "computer", "board", "storage", "more"]) {
      expect(isPrimarySurfaceTab(tab)).toBe(false);
    }
  });

  // Every tab the switch bar can show must be a primary surface, or that tab
  // gets a back button out of a bar that has no "back".
  test("agrees with the tabs the mobile dock renders on", () => {
    for (const tab of ["live", "bots", "auto"]) {
      expect(shouldShowMobileSurfaceToggle(true, tab)).toBe(true);
      expect(isPrimarySurfaceTab(tab)).toBe(true);
    }
  });
});
