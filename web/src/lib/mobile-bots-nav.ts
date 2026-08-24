/**
 * Pure decision logic for the mobile Chat/Bots/Scheduled surface toggle.
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

/** The three primary destinations in the mobile surface toggle. */
export type PrimaryMobileTab = "live" | "bots" | "auto";

/** `SurfaceToggle`'s own active-segment vocabulary (desktop rail history). */
export type SurfaceToggleActive = "sessions" | "chat" | "auto";

/**
 * Flat roster treatment for a bot roster, on every width.
 *
 * The desktop rail roster now renders at this same density. A bot row is the
 * same object on both surfaces — face, name, last line — so it gets one
 * treatment rather than a mobile one and a cramped desktop copy.
 * PR #208 ported the bot-mode mockup's `.roster-row` density
 * (10px vertical padding, 12px gap) verbatim and only got the row pitch from
 * 100px to 84px, because the mockup's own airiness assumes the same large
 * avatar this page renders (`size={56}` in App.tsx) — padding was never the
 * dominant term. `py-2` (8px vertical padding) here pairs with the smaller
 * 44px avatar in App.tsx to bring the row pitch to 68px, in the range of a
 * scannable native list (iOS Messages runs roughly a 52px avatar in a ~76px
 * row) rather than a settings screen.
 */
export const BOT_ROSTER_ROW_CLASS =
  "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted";

/**
 * The persistent mobile bottom toggle shows only at real mobile widths, and
 * only on the three tabs it switches between. Other
 * pages (Notifications, Artifacts, Settings, extension tabs) stay reachable
 * through the existing `PagesMenu` overflow — this keeps exactly one
 * additional navigation affordance, not a competing tab-bar model.
 */
export function shouldShowMobileSurfaceToggle(
  isMobile: boolean,
  tab: string,
  selectedBotId: string | null = null,
): tab is PrimaryMobileTab {
  return isMobile && (tab === "live" || tab === "auto" || (tab === "bots" && !selectedBotId));
}

/** Maps the current tab to `SurfaceToggle`'s active-segment value. */
export function mobileSurfaceToggleActive(tab: string): SurfaceToggleActive {
  if (tab === "bots") return "chat";
  if (tab === "auto") return "auto";
  return "sessions";
}

/**
 * Chat and Bots are strict, mutually exclusive data surfaces on every width.
 *
 * Mobile always worked this way. The desktop rail did not: it listed the same
 * bot conversations again in a "Bots" group above the fleet, so every bot
 * appeared twice — once in the Chat list and once on the Bots surface the
 * switch bar opens. One conversation with two rows in the same rail is two
 * places to look for the same unread dot, and the Chat list is the one that
 * cannot open a bot properly (no roster preview, no bot stage column).
 *
 * The switch bar stays. Bots are reached through it, not by mixing them into
 * the session list.
 */
export function shouldShowBotsInSessionList(): boolean {
  return false;
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
