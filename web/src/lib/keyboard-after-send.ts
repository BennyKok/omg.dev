// What the keyboard does after you send a message.
//
// On a phone the on-screen keyboard covers half the screen, so it closes the
// moment you send and the reply has room. On a tablet or a computer the field
// keeps focus: an iPad with a hardware keyboard shows only a small floating
// bar, and blurring the field hides that bar and resizes the page, then the
// next keystroke brings both back.
//
// This used to be decided by measuring how far the page shrank when the field
// was focused. The page asks for `interactive-widget=resizes-content`, so on a
// phone the whole layout shrinks with the keyboard, the difference measured
// was zero, and a phone's keyboard stayed open after every send.

/** The shortest side of a phone screen is well under this; a small tablet's is not. */
const PHONE_SHORT_SIDE_PX = 600;

export function closesKeyboardAfterSend(device: { coarsePointer: boolean; screenWidth: number; screenHeight: number }): boolean {
  return device.coarsePointer && Math.min(device.screenWidth, device.screenHeight) < PHONE_SHORT_SIDE_PX;
}

/** The same decision for the device this page is on. */
export function closesKeyboardAfterSendHere(): boolean {
  if (typeof window === "undefined") return false;
  return closesKeyboardAfterSend({
    coarsePointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
    screenWidth: window.screen?.width ?? window.innerWidth,
    screenHeight: window.screen?.height ?? window.innerHeight,
  });
}
