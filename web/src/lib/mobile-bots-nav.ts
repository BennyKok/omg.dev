/**
 * Pure decision logic for the mobile "Chat | Bot" surface toggle.
 *
 * Desktop reaches the bots surface through `SurfaceToggle` in the rail
 * header (`RailStage`), which only mounts at `isWide` widths. Mobile uses one
 * compact dock above the composer instead, with strict data separation between
 * Chat sessions and persistent Bots.
 *
 * Kept as pure functions, imported by App.tsx, so the render logic and the
 * unit-tested logic are the same source instead of two copies that can
 * drift apart.
 */

/** The two tabs the mobile surface toggle switches between. */
export type PrimaryMobileTab = "live" | "bots";

/** `SurfaceToggle`'s own active-segment vocabulary (desktop rail history). */
export type SurfaceToggleActive = "sessions" | "chat";

/**
 * Flat roster treatment on the Bots page — larger than the compact rail, but
 * not airier. The row keeps its 56px avatar; the padding and gap come from the
 * bot-mode mockup (docs/design/bot-mode/mockup.html `.roster-row`: 10px
 * vertical padding, 12px gap). `py-4` here put the row pitch at 100px, which
 * read as a settings list with four items rather than a roster you scan.
 */
export const MOBILE_BOT_ROSTER_ROW_CLASS =
  "flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted";

/**
 * The persistent mobile bottom toggle shows only at real mobile widths, and
 * only on the two tabs it switches between. Other
 * pages (Notifications, Artifacts, Settings, extension tabs) stay reachable
 * through the existing `PagesMenu` overflow — this keeps exactly one
 * additional navigation affordance, not a competing tab-bar model.
 */
export function shouldShowMobileSurfaceToggle(
  isMobile: boolean,
  tab: string,
  selectedBotId: string | null = null,
): tab is PrimaryMobileTab {
  return isMobile && (tab === "live" || (tab === "bots" && !selectedBotId));
}

/** Maps the current tab to `SurfaceToggle`'s active-segment value. */
export function mobileSurfaceToggleActive(tab: string): SurfaceToggleActive {
  return tab === "bots" ? "chat" : "sessions";
}

/** Mobile Chat and Bots are strict, mutually exclusive data surfaces. */
export function shouldShowBotsInSessionList(isMobile: boolean): boolean {
  return !isMobile;
}

export function mobileSurfaceDockBottom(aboveComposer: boolean): string {
  return aboveComposer
    ? "var(--lfg-inline-composer-height, var(--lfg-composer-clear))"
    : "var(--lfg-safe-bottom)";
}

/**
 * `BotsView`'s roster page carries its own inline `SurfaceToggle` (used by
 * the tablet band, where `!isWide && !isMobile`). The persistent mobile dock
 * would otherwise duplicate this inline control. This keeps the inline copy
 * tablet-only so mobile shows exactly one toggle.
 */
export function shouldShowInlineBotsSurfaceToggle(isMobile: boolean): boolean {
  return !isMobile;
}
