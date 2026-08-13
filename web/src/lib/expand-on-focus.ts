// DRAWER → PAGE MORPH, extracted so it is not the property of one component.
//
// A content-sized bottom sheet cannot win against the mobile soft keyboard: iOS
// never shrinks the layout viewport (WebKit bug 259770 — `interactive-widget`
// is still unshipped), so a bottom-anchored card has nothing to ride up on and
// simply gets shoved off the top. The fix that works everywhere is to stop
// being a card: focus a field and the sheet becomes a full-height page sized
// from the live visual viewport (`.lfg-sheet-page` in index.css), which is the
// one layout iOS handles natively — the keyboard just covers the bottom of a
// scroll container.
//
// BottomSheet has carried this since the auto-agent forms needed it. The raw
// <Drawer> surfaces that never went through BottomSheet — the new-session
// composer, the project folder picker, the resume sheet's search — were still
// fighting the keyboard on their own. This hook is that logic with no layout
// opinions attached, so any drawer can opt in with three props.

import { useEffect, useRef, useState } from "react";
import { deepActiveElement, isTypingTarget } from "./active-element";

/** How long a blur waits before it is believed. Long enough to cover the gap
 *  between blur and the click that caused it, short enough not to feel stuck. */
const FOLD_BACK_DELAY_MS = 260;

export type ExpandOnFocusHandlers = {
  /** True while the surface should wear `.lfg-sheet-page`. */
  paged: boolean;
  /** Cancel a pending fold-back. Exposed for callers that reveal a field
   *  programmatically and would otherwise race their own blur. */
  cancelExit: () => void;
  /** Force page mode on, e.g. right before focusing a field by hand. */
  expand: () => void;
  onPointerDownCapture: () => void;
  onFocusCapture: (e: { target: EventTarget | null }) => void;
  onBlurCapture: (e: { currentTarget: EventTarget | null }) => void;
};

/**
 * Drive page mode from focus. Spread the three handlers onto the element that
 * wraps the sheet's fields (usually DrawerContent) and use `paged` for the
 * class.
 *
 * @param enabled  Opt out entirely — a surface with no fields, or a caller that
 *                 drives `page` itself, should not pay for the listeners.
 */
export function useExpandOnFocus(enabled = true): ExpandOnFocusHandlers {
  const [paged, setPaged] = useState(false);
  const exitTimer = useRef<number | null>(null);

  const cancelExit = () => {
    if (exitTimer.current !== null) {
      window.clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
  };
  useEffect(() => cancelExit, []);

  // Leaving the last field folds the sheet back down, but never while there is
  // typed work in it — work in progress must not vanish under someone
  // dismissing the keyboard. The delay and the pointer-down cancel keep a tap
  // heading for the sheet's own buttons from being read as "left the field":
  // blur lands first and would otherwise re-lay-out the button out from under
  // the click.
  //
  // `root` is read from the event synchronously and passed in, because
  // DrawerContent is not a forwardRef and `currentTarget` is already nulled by
  // the time this timer runs.
  const scheduleExit = (root: HTMLElement | null) => {
    if (!enabled) return;
    cancelExit();
    exitTimer.current = window.setTimeout(() => {
      exitTimer.current = null;
      if (!root) return;
      // Focus moving between fields inside the sheet is not "left the sheet".
      if (root.contains(deepActiveElement())) return;
      const fields = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "input, textarea",
      );
      for (const field of fields) if (field.value.trim()) return;
      setPaged(false);
    }, FOLD_BACK_DELAY_MS);
  };

  return {
    paged: enabled && paged,
    cancelExit,
    expand: () => {
      if (!enabled) return;
      cancelExit();
      setPaged(true);
    },
    onPointerDownCapture: cancelExit,
    onFocusCapture: (e) => {
      if (!enabled) return;
      if (!isTypingTarget(e.target as Element)) return;
      cancelExit();
      setPaged(true);
    },
    onBlurCapture: (e) => scheduleExit(e.currentTarget as HTMLElement),
  };
}
