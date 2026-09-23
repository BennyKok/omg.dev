/**
 * The rows of the mobile side navigation, as data.
 *
 * Pure and DOM-free so the order, the gating and the current-row logic can be
 * tested without mounting anything. This mirrors
 * `mobile/src/omg/side-nav-items.ts`, which exists for the same reason.
 *
 * The two lists are deliberately NOT identical. iOS has an Archive page and
 * no Bots, Computer or Board; the web has those three and no Archive. What is
 * shared is the shape: the machine first (drawn by the panel, not listed
 * here), then the surfaces you switch between, then the pages, then Settings
 * last.
 */

/** Which glyph a row draws. The component owns the actual icon components. */
export type SideNavIcon =
  | "chat"
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
  "instructions",
  "connectors",
  "more",
]);

const PAGES: { key: string; label: string; icon: SideNavIcon }[] = [
  // The three surfaces the bottom bar used to switch between, in the order it
  // showed them, so muscle memory survives the move into the drawer.
  { key: "live", label: "Chat", icon: "chat" },
  { key: "bots", label: "Bots", icon: "bots" },
  { key: "auto", label: "Schedules", icon: "schedules" },
  // Then the destinations that used to be behind the overflow menu.
  { key: "notifications", label: "Notifications", icon: "notifications" },
  { key: "artifacts", label: "Artifacts", icon: "artifacts" },
  { key: "computer", label: "Computer", icon: "computer" },
  { key: "board", label: "Board", icon: "board" },
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
  /** Settings > View switches, the same ones that used to hide dock segments. */
  showBots?: boolean;
  showSchedules?: boolean;
  /** False under a host that owns its own settings surface. */
  showSettings?: boolean;
  extensions?: readonly { id: string; label: string }[];
}): SideNavRow[] {
  const {
    tab,
    hiddenPages = [],
    showBots = true,
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
    if (page.key === "bots" && !showBots) continue;
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
