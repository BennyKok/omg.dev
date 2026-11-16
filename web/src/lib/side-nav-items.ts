/**
 * The rows of the mobile side navigation, as data.
 *
 * Pure and DOM-free so the order, the gating and the current-row logic can be
 * tested without mounting anything.
 */

/** Which glyph a row draws. The component owns the actual icon components. */
export type SideNavIcon =
  | "chat"
  | "dashboard"
  | "bots"
  | "schedules"
  | "notifications"
  | "artifacts"
  | "computer"
  | "board"
  | "settings"
  | "extension";

export type SideNavRow = {
  /** The tab id to navigate to. Extensions use their own id. */
  key: string;
  label: string;
  icon: SideNavIcon;
  /** True for the row the current tab belongs to. Exactly one row has it. */
  current: boolean;
};

/**
 * Tabs that are reached from Settings and have no row of their own.
 *
 * Without this, opening Settings > Usage left no row marked, and the drawer
 * looked like it had lost its place. Mirrors iOS, where every page that is
 * not one of the listed six resolves to the row that owns it.
 */
const SETTINGS_TABS = new Set([
  "settings",
  "usage",
  "coding-agents",
  "changelog",
  "term",
  "browser",
  "storage",
  "devices",
  "remote-access",
  "instructions",
  "connectors",
  "more",
]);

const PAGES: { key: string; label: string; icon: SideNavIcon }[] = [
  // The three surfaces the bottom bar used to switch between, in the order it
  // showed them, so muscle memory survives the move into the drawer.
  // Bots is not listed: it is reached from the Chat/Bots switch on the Live
  // surface, and a second entry here made the drawer longer for a page most
  // people never open.
  { key: "live", label: "Chats", icon: "chat" },
  { key: "dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "auto", label: "Schedules", icon: "schedules" },
  // Then the destinations that used to be behind the overflow menu.
  // The Inbox: questions, findings and finished work. On a phone it is also
  // the page one swipe left of Chats (lib/phone-pages.ts).
  { key: "notifications", label: "Inbox", icon: "notifications" },
  { key: "artifacts", label: "Artifacts", icon: "artifacts" },
  { key: "computer", label: "Computer", icon: "computer" },
  // Board is not listed either. It reads the same sessions as Chat laid out by
  // state, and stays reachable from the Pages menu on wide layouts.
];

/** The row key the given tab belongs to. */
export function sideNavCurrentKey(tab: string): string {
  if (SETTINGS_TABS.has(tab)) return "settings";
  if (PAGES.some((page) => page.key === tab)) return tab;
  // An extension tab is its own row; anything else unknown is a Live detail
  // (a session, a bot conversation), which belongs to Chat.
  return tab;
}

export function sideNavRows(input: {
  tab: string;
  /** Pages the viewer's role removes entirely (src/policy/roles.ts). */
  hiddenPages?: readonly string[];
  /** Settings > View switch, the same one that used to hide a dock segment. */
  showSchedules?: boolean;
  /** False under a host that owns its own settings surface. */
  showSettings?: boolean;
  extensions?: readonly { id: string; label: string }[];
}): SideNavRow[] {
  const {
    tab,
    hiddenPages = [],
    showSchedules = true,
    showSettings = true,
    extensions = [],
  } = input;
  const hidden = new Set(hiddenPages);
  const currentKey = sideNavCurrentKey(tab);
  const rows: SideNavRow[] = [];
  const push = (key: string, label: string, icon: SideNavIcon) => {
    if (hidden.has(key)) return;
    rows.push({ key, label, icon, current: key === currentKey });
  };

  for (const page of PAGES) {
    if (page.key === "auto" && !showSchedules) continue;
    push(page.key, page.label, page.icon);
  }
  for (const extension of extensions) push(extension.id, extension.label, "extension");
  // Last, as on iOS. It is the row you reach for least often and the one that
  // holds everything without a row of its own.
  if (showSettings) push("settings", "Settings", "settings");

  // Never leave the drawer with nothing marked. A viewer whose role hides the
  // current page, or a tab no row claims, still gets its place shown on Chat,
  // which is where the shell sends them anyway.
  if (rows.length && !rows.some((row) => row.current)) {
    const live = rows.find((row) => row.key === "live");
    if (live) live.current = true;
  }
  return rows;
}

export type MobileHeader =
  | { control: "menu" }
  | { control: "none" }
  | {
      control: "back";
      /** The tab Back opens. */
      target: "live" | "folders" | "settings";
      /** The name of that tab, for the accessible label. */
      targetLabel: string;
      /** The page's own name, drawn beside the Back arrow. */
      title: string;
    };

/** Page names for the phone header. An extension supplies its own label. */
const PAGE_TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  auto: "Schedules",
  notifications: "Inbox",
  artifacts: "Artifacts",
  bots: "Bots",
  board: "Board",
  settings: "Settings",
  usage: "Usage",
  "coding-agents": "Coding agents",
  changelog: "Changelog",
  term: "Terminal",
  browser: "Browser",
  storage: "Storage & performance",
  devices: "Linked devices",
  "remote-access": "Remote access",
  instructions: "Custom instructions",
  connectors: "Tool access",
  more: "More",
};

/**
 * The phone header of a page: one control in the top-left corner, and the
 * page's name beside it.
 *
 * - Chats (`live`) is home and shows the menu button (`SideNavButton`).
 * - The menu page (`folders`) is chromeless and draws its own top row.
 * - Every other page shows ONE Back arrow with the page's name on the same
 *   line. Back has two rules, and no page picks its own:
 *     1. A page that Settings lists and the menu does not (Usage, Coding
 *        agents, ...) returns to Settings. Settings is its only parent.
 *     2. Any other page returns to where you opened it from: the menu when
 *        `fromMenu` is true, and Chats otherwise.
 *
 * Back used to be a fixed label per page (`< Chats`, `< Inbox`, `< Settings`).
 * Schedules said Settings and Artifacts said Inbox even when the menu opened
 * them, so the corner named a page the reader had not come from.
 */
export function mobileHeader(
  tab: string,
  options: {
    /** True when the page was opened from the phone's menu page. */
    fromMenu?: boolean;
    /** False under a host that owns Settings. Its sub-pages return to Chats. */
    hasSettings?: boolean;
    extensions?: readonly { id: string; label: string }[];
  } = {},
): MobileHeader {
  const { fromMenu = false, hasSettings = true, extensions = [] } = options;
  if (tab === "folders") return { control: "none" };
  if (tab === "live") return { control: "menu" };
  const title =
    PAGE_TITLES[tab] ?? extensions.find((extension) => extension.id === tab)?.label ?? "Settings";
  const settingsChild = SETTINGS_TABS.has(tab) && tab !== "settings";
  if (settingsChild && hasSettings) {
    return { control: "back", target: "settings", targetLabel: "Settings", title };
  }
  return fromMenu
    ? { control: "back", target: "folders", targetLabel: "Menu", title }
    : { control: "back", target: "live", targetLabel: "Chats", title };
}

/** Tabs that draw their own page in the shell. Anything else falls to Settings. */
const OWN_PAGE_TABS = new Set([
  "live",
  "dashboard",
  "folders",
  "auto",
  "usage",
  "coding-agents",
  "notifications",
  "artifacts",
  "changelog",
  "term",
  "bots",
  "storage",
  "devices",
  "remote-access",
  "computer",
  "board",
  "instructions",
  "connectors",
  "more",
]);

/**
 * Whether the shell draws the Settings page for `tab`. Settings is the
 * fallback for any tab without a page of its own, so a new page must be
 * listed in OWN_PAGE_TABS. The phone's Folders page was not, and Settings
 * was drawn under its folder list.
 */
export function tabFallsToSettings(tab: string): boolean {
  return !OWN_PAGE_TABS.has(tab);
}
