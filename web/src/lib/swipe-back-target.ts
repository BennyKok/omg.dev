// Which touches belong to a page's swipe back (lib/swipe-back) and which
// belong to the element under the finger. Shared by the phone chat and the
// phone new-session screen, so both pages answer a drag the same way.

function isTextEditingElement(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "file", "hidden", "radio", "range", "reset", "submit"].includes(
    el.type,
  );
}

export function composerIsEditing(target: EventTarget | null): boolean {
  const el = target instanceof HTMLElement ? target : null;
  const form = el?.closest("form");
  if (!form) return false;

  const active = document.activeElement;
  return active instanceof HTMLElement && form.contains(active) && isTextEditingElement(active);
}

function hasHorizontalScrollAncestor(target: EventTarget | null): boolean {
  let el = target instanceof HTMLElement ? target : null;
  while (el && el !== document.body) {
    const style = window.getComputedStyle(el);
    const overflowX = style.overflowX;
    const canScrollX =
      el.scrollWidth > el.clientWidth + 2 &&
      (overflowX === "auto" || overflowX === "scroll" || overflowX === "overlay");
    if (canScrollX) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Whether a drag starting on `target` belongs to that element rather than to
 * the chat's swipe back: something being edited or selected, code and tables
 * a person reads across, and anything that scrolls sideways. Buttons and
 * links are not here: a drag is not a tap, and most of a transcript is rows
 * you can tap, so excluding them made the gesture start only some of the time.
 */
export function blocksSwipeBack(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  if (hasHorizontalScrollAncestor(target)) return true;
  return !!el.closest(
    [
      "input",
      "textarea",
      "select",
      "table",
      "pre",
      "code",
      "[contenteditable='true']",
      "[data-no-composer-swipe]",
    ].join(","),
  );
}
