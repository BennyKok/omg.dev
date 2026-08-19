/**
 * Pure decision logic for the mobile "Chat | Bot" surface toggle.
 *
 * Desktop reaches the bots surface through `SurfaceToggle` in the rail
 * header (`RailStage`), which only mounts at `isWide` widths. Mobile had no
 * equivalent direct control — Bots was reachable only through the `PagesMenu`
 * overflow. This module is the (testable) gating logic for the mobile
 * equivalent: a persistent toggle in the mobile header that mirrors the
 * desktop rail's Chat/Bot switch, without inventing a second navigation
 * idiom (no bottom tab bar, no drawer).
 *
 * Kept as pure functions, imported by App.tsx, so the render logic and the
 * unit-tested logic are the same source instead of two copies that can
 * drift apart.
 */

/** The two tabs the mobile surface toggle switches between. */
export type PrimaryMobileTab = "live" | "bots";

/** `SurfaceToggle`'s own active-segment vocabulary (desktop rail history). */
export type SurfaceToggleActive = "sessions" | "chat";

/** Flat roster treatment shared with the rail instead of the former card shell. */
export const MOBILE_BOT_ROSTER_ROW_CLASS =
  "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted";

/**
 * The persistent mobile header toggle (Live header + Bots header) shows only
 * at real mobile widths, and only on the two tabs it switches between. Other
 * pages (Notifications, Artifacts, Settings, extension tabs) stay reachable
 * through the existing `PagesMenu` overflow — this keeps exactly one
 * additional navigation affordance, not a competing tab-bar model.
 */
export function shouldShowMobileSurfaceToggle(
  isMobile: boolean,
  tab: string,
): tab is PrimaryMobileTab {
  return isMobile && (tab === "live" || tab === "bots");
}

/** Maps the current tab to `SurfaceToggle`'s active-segment value. */
export function mobileSurfaceToggleActive(tab: string): SurfaceToggleActive {
  return tab === "bots" ? "chat" : "sessions";
}

/**
 * `BotsView`'s roster page carries its own inline `SurfaceToggle` (used by
 * the tablet band, where `!isWide && !isMobile`). Once the persistent mobile
 * header toggle exists, real mobile would otherwise show both — the pinned
 * header one and the inline one scrolling in the page content. This keeps
 * the inline copy tablet-only so mobile shows exactly one toggle.
 */
export function shouldShowInlineBotsSurfaceToggle(isMobile: boolean): boolean {
  return !isMobile;
}
