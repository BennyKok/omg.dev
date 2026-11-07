// The phone's side-by-side pages, as data.
//
//   Folders  ←  Chats  →  Inbox  →  Computer
//
// Chats (the "live" tab) is home. All four are flat pages, each its own tab:
// a swipe right on Chats opens Folders, a swipe left walks to the Inbox (the
// "notifications" tab) and then the Computer. The tab stays the one owner of
// "which page is up": a swipe only picks the next tab.
//
// Pure and DOM-free, so the order and the gesture rules are tested without a
// touch screen.

/** The tabs in swipe order, left to right. */
export const PHONE_PAGE_TABS = ["folders", "live", "notifications", "computer"] as const;

/** What a swipe can open. */
export type PhonePageTarget = (typeof PHONE_PAGE_TABS)[number];

/** Travel before a release counts as a page swipe, in px. */
export const PHONE_PAGE_SWIPE_MIN_PX = 56;
/** A swipe must be this much more sideways than vertical. */
export const PHONE_PAGE_SWIPE_RATIO = 1.6;
/** On the Computer, only a swipe that starts this close to the left edge leaves it. */
export const PHONE_PAGE_EDGE_PX = 28;

export function isPhonePageTab(tab: string): tab is (typeof PHONE_PAGE_TABS)[number] {
  return (PHONE_PAGE_TABS as readonly string[]).includes(tab);
}

/**
 * Where a swipe goes from `tab`. "right" means the finger moved right, which
 * brings in the page on the left. Null when there is no page that way.
 */
export function phonePageAfterSwipe(tab: string, direction: "left" | "right"): PhonePageTarget | null {
  if (!isPhonePageTab(tab)) return null;
  const index = PHONE_PAGE_TABS.indexOf(tab);
  return PHONE_PAGE_TABS[direction === "right" ? index - 1 : index + 1] ?? null;
}

/**
 * Whether a finished touch was a page swipe, and which way.
 *
 * `startX` is where the touch began. On the Computer the desktop under the
 * finger takes drags, so only a swipe right from the left edge counts there.
 */
export function phonePageSwipe(input: {
  tab: string;
  dx: number;
  dy: number;
  startX: number;
}): "left" | "right" | null {
  const { tab, dx, dy, startX } = input;
  if (Math.abs(dx) < PHONE_PAGE_SWIPE_MIN_PX) return null;
  if (Math.abs(dx) < Math.abs(dy) * PHONE_PAGE_SWIPE_RATIO) return null;
  const direction = dx > 0 ? "right" : "left";
  if (tab === "computer" && (direction === "left" || startX > PHONE_PAGE_EDGE_PX)) return null;
  return direction;
}

/**
 * Whether a touch on `target` belongs to something else: a text field, or an
 * element between it and `root` that scrolls sideways (a code block, a chip
 * row). Those keep their own drag and never turn the page.
 */
export function scrollsSideways(target: Element, root: Element): boolean {
  if (target.closest("input, textarea, select, [contenteditable='true'], [data-no-page-swipe]")) return true;
  for (let node: Element | null = target; node && node !== root; node = node.parentElement) {
    if (node.scrollWidth <= node.clientWidth + 1) continue;
    const overflow = getComputedStyle(node).overflowX;
    if (overflow === "auto" || overflow === "scroll") return true;
  }
  return false;
}
