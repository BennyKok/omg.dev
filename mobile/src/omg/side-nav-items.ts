/**
 * WHAT IS IN THE SIDE NAV, as data.
 *
 * The rows used to be an inline array inside an overflow menu on the Live
 * header. Two surfaces draw them now — the phone's drawer and the iPad rail's
 * footer — so the list is stated once, here, and both render the same thing.
 *
 * Deliberately free of react-native AND of expo-symbols: this file only names
 * rows and decides which one is current, which is the part worth testing, and
 * a test should not need Metro (or the app's node_modules) to ask the
 * question. The glyph for each row lives with the view in side-nav.tsx.
 *
 * The computer switcher is NOT here. It is not a page, it carries live machine
 * state, and its options already have an owner in computer-picker.ts.
 */

export type SideNavPageKey = "live" | "notifications" | "schedules" | "settings";

/** Every row key the nav can draw, pages plus the one action. */
export type SideNavRowKey = SideNavPageKey | "shortcuts";

export type SideNavRow =
  | {
      kind: "page";
      key: SideNavPageKey;
      label: string;
      href: string;
      /** The row for the screen you are already on. Drawn selected, never navigates. */
      current: boolean;
    }
  | { kind: "action"; key: "shortcuts"; label: string };

const PAGES: { key: SideNavPageKey; label: string; href: string }[] = [
  { key: "live", label: "Live", href: "/" },
  { key: "notifications", label: "Notifications", href: "/notifications" },
  { key: "schedules", label: "Schedules", href: "/schedules" },
  { key: "settings", label: "Settings", href: "/settings" },
];

/**
 * Which page row a path belongs to.
 *
 * Live owns every path that is not one of the other pages — a transcript
 * (`/session/<id>`) opened from the list is still inside Live, and on the iPad
 * the rail stays on screen beside it, so leaving every row unselected there
 * would say the reader is nowhere.
 */
export function sideNavCurrentPage(pathname: string): SideNavPageKey {
  for (const page of PAGES) {
    if (page.key === "live") continue;
    if (pathname === page.href || pathname.startsWith(`${page.href}/`)) return page.key;
  }
  return "live";
}

/**
 * Every row the side nav draws, in order.
 *
 * `keyboardShortcuts` is passed in rather than read here: only the running
 * binary knows whether it can deliver key commands (key-commands.ts), and that
 * answer needs react-native to ask.
 */
export function sideNavRows(input: {
  pathname: string;
  keyboardShortcuts: boolean;
}): SideNavRow[] {
  const current = sideNavCurrentPage(input.pathname);
  const rows: SideNavRow[] = PAGES.map((page) => ({
    kind: "page",
    ...page,
    current: page.key === current,
  }));
  if (input.keyboardShortcuts) {
    rows.push({ kind: "action", key: "shortcuts", label: "Keyboard shortcuts" });
  }
  return rows;
}
