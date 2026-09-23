import { describe, expect, test } from "bun:test";
import {
  BOT_ROSTER_ROW_CLASS,
  isPrimarySurfaceTab,
  shouldShowBotsInSessionList,
  shouldShowInlineBotsSurfaceToggle,
} from "./mobile-bots-nav";
import { sideNavRows } from "./side-nav-items";

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

describe("shouldShowBotsInSessionList", () => {
  // Bots are reached through the Chat/Bots switch bar, on every width. The
  // desktop rail used to ALSO repeat them in a "Bots" group inside the Chat
  // list, so one conversation had two rows in the same rail and two places to
  // carry the same unread dot. Mobile never did this.
  test("keeps bot families out of Chat at every width", () => {
    expect(shouldShowBotsInSessionList()).toBe(false);
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

  // The dock this used to be compared against is gone. The three surfaces
  // are now rows in the side navigation, so the agreement worth pinning is
  // with that row model: a primary surface is a surface the drawer offers.
  test("agrees with the surfaces the side navigation offers", () => {
    const rows = sideNavRows({ tab: "live" }).map((row) => row.key);
    for (const tab of ["live", "bots", "auto"]) {
      expect(isPrimarySurfaceTab(tab)).toBe(true);
      expect(rows).toContain(tab);
    }
  });
});
