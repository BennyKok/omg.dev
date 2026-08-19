import { describe, expect, test } from "bun:test";
import {
  MOBILE_BOT_ROSTER_ROW_CLASS,
  mobileSurfaceToggleActive,
  shouldShowInlineBotsSurfaceToggle,
  shouldShowMobileSurfaceToggle,
} from "./mobile-bots-nav";

test("the mobile bot roster uses a flat rail-style row", () => {
  expect(MOBILE_BOT_ROSTER_ROW_CLASS).toContain("hover:bg-muted");
  expect(MOBILE_BOT_ROSTER_ROW_CLASS).not.toContain("border-border");
  expect(MOBILE_BOT_ROSTER_ROW_CLASS).not.toContain("bg-card");
});

describe("shouldShowMobileSurfaceToggle", () => {
  test("shows on the Live tab at mobile widths", () => {
    expect(shouldShowMobileSurfaceToggle(true, "live")).toBe(true);
  });

  test("shows on the Bots tab at mobile widths", () => {
    expect(shouldShowMobileSurfaceToggle(true, "bots")).toBe(true);
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

  test("live and any other tab map to the sessions segment", () => {
    expect(mobileSurfaceToggleActive("live")).toBe("sessions");
    expect(mobileSurfaceToggleActive("notifications")).toBe("sessions");
  });
});

describe("shouldShowInlineBotsSurfaceToggle", () => {
  test("hidden at real mobile widths (persistent header toggle covers it)", () => {
    expect(shouldShowInlineBotsSurfaceToggle(true)).toBe(false);
  });

  test("shown in the tablet band, where there is no persistent header toggle", () => {
    expect(shouldShowInlineBotsSurfaceToggle(false)).toBe(true);
  });
});
