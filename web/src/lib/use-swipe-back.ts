import { useEffect, type RefObject } from "react";
import { haptic } from "./haptics";
import { useLatestCallback } from "./use-latest-ref";
import { swipeBackCommits, swipeBackFinishMs, swipeBackIntent, swipeBackOffset } from "./swipe-back";
import { blocksSwipeBack, composerIsEditing } from "./swipe-back-target";

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
/** A full close, the same length the phone chat uses (SHEET_MS * 0.85). */
const FULL_CLOSE_MS = 357;
const SPRING_MS = 240;

/**
 * Swipe right anywhere on a full-screen phone page to close it, the same
 * gesture as the phone chat (lib/swipe-back). The page follows the finger;
 * a release past a third of the width, or a flick, finishes the close, and
 * anything less springs back. A drag that starts in a field being edited, in
 * code, a table or a sideways scroller belongs to that element.
 *
 * The listeners attach once per page element: `onBack` is read through a
 * stable callback, so a re-render mid-drag cannot drop the release.
 */
export function useSwipeBack(pageRef: RefObject<HTMLElement | null>, onBack: () => void, enabled = true) {
  const back = useLatestCallback(onBack);
  useEffect(() => {
    const page = pageRef.current;
    if (!page || !enabled) return;
    const st = { active: false, intent: "pending" as "pending" | "back" | "none", x0: 0, y0: 0, dx: 0, lastX: 0, lastT: 0, velocity: 0, closing: false };
    const place = (dx: number) => {
      page.style.transition = "none";
      page.style.transform = dx ? `translate3d(${dx}px, 0, 0)` : "";
    };
    const springBack = () => {
      page.style.transition = `transform ${SPRING_MS}ms ${EASE}`;
      page.style.transform = "";
      window.setTimeout(() => {
        if (!st.closing) page.style.transition = "";
      }, SPRING_MS + 20);
    };
    const finishBack = (dx: number) => {
      if (st.closing) return;
      st.closing = true;
      haptic("selection");
      const ms = swipeBackFinishMs(dx, page.clientWidth, FULL_CLOSE_MS);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        back();
      };
      page.style.transition = `transform ${ms}ms ${EASE}`;
      page.style.transform = "translate3d(100%, 0, 0)";
      page.addEventListener("transitionend", (event) => {
        if (event.propertyName === "transform") finish();
      });
      window.setTimeout(finish, ms + 80);
    };
    const onStart = (event: TouchEvent) => {
      if (st.closing || event.touches.length !== 1) return;
      const target = event.target instanceof Element ? event.target : null;
      // A composer permits a swipe until editing starts; other fields keep
      // their own focus, selection and paste gestures.
      if (target?.closest("form[data-composer-kind]") ? composerIsEditing(event.target) : blocksSwipeBack(event.target)) return;
      const touch = event.touches[0];
      Object.assign(st, { active: true, intent: "pending", x0: touch.clientX, y0: touch.clientY, dx: 0, lastX: touch.clientX, lastT: performance.now(), velocity: 0 });
    };
    const onMove = (event: TouchEvent) => {
      if (!st.active) return;
      const touch = event.touches[0];
      const dx = touch.clientX - st.x0;
      if (st.intent === "pending") {
        st.intent = swipeBackIntent(dx, touch.clientY - st.y0);
        if (st.intent === "none") {
          st.active = false; // the scroller, or the field, has this touch
          return;
        }
        if (st.intent === "pending") return;
        // The page is under the finger now: drop the entrance if it is still running.
        page.getAnimations().forEach((animation) => animation.cancel());
      }
      event.preventDefault();
      const now = performance.now();
      if (now > st.lastT) st.velocity = (touch.clientX - st.lastX) / (now - st.lastT);
      st.lastX = touch.clientX;
      st.lastT = now;
      st.dx = swipeBackOffset(dx);
      place(st.dx);
    };
    const onEnd = () => {
      if (!st.active) return;
      st.active = false;
      if (st.intent !== "back") return;
      if (swipeBackCommits(st.dx, page.clientWidth, st.velocity)) finishBack(st.dx);
      else springBack();
    };
    // The system took the touch. That is not the person letting go, so it never closes.
    const onCancel = () => {
      if (!st.active) return;
      st.active = false;
      if (st.intent === "back") springBack();
    };
    page.addEventListener("touchstart", onStart, { passive: true });
    page.addEventListener("touchmove", onMove, { passive: false });
    page.addEventListener("touchend", onEnd, { passive: true });
    page.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      page.removeEventListener("touchstart", onStart);
      page.removeEventListener("touchmove", onMove);
      page.removeEventListener("touchend", onEnd);
      page.removeEventListener("touchcancel", onCancel);
      // Never leave the page mid-drag with nothing listening for the release.
      if (st.active && st.intent === "back" && !st.closing) springBack();
    };
  }, [pageRef, back, enabled]);
}
