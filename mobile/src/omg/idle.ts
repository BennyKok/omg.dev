import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How long a FOREGROUNDED app may go untouched before the person counts as
 * away.
 *
 * The same number the dashboard uses, for the same reason. Presence is what
 * holds a cloud Computer out of hibernation, and "the app is foregrounded" is
 * not evidence that anybody is there. On the web that gap billed a paying
 * account 6.80 compute hours out of the 7.49 after midnight on 2026-09-01,
 * against a 40-hour monthly allowance, while its owner slept.
 *
 * A phone is less exposed than a browser tab, because iOS backgrounds the app
 * when the screen auto-locks and backgrounding already releases the lease. It
 * is not unexposed: auto-lock can be set to Never, and the leak is then exactly
 * the browser's.
 *
 * Ten minutes is chosen against the worse failure, which is pausing under
 * somebody who is still working. It is far longer than reading a diff or
 * watching an agent run, and the control plane refuses to pause a machine whose
 * agent is busy or launching regardless, so going idle mid-run releases the
 * lease and changes nothing.
 */
export const USER_IDLE_TIMEOUT_MS = 10 * 60_000;

/**
 * Is somebody actually operating this app?
 *
 * `foregrounded` answers "is the app on screen". This adds "and has anyone
 * touched it recently", which is the half that decides whether compute is being
 * used or merely billed.
 *
 * Returns `markActive` rather than subscribing to anything itself: React Native
 * has no global input event, so the touch has to be observed by a view. The
 * provider passes it to a responder-capture that never intercepts.
 */
export function useUserActive(foregrounded: boolean): {
  active: boolean;
  markActive: () => void;
} {
  const [idle, setIdle] = useState(false);
  // Mirrors `idle` so a touch can rearm the timer without a state update.
  // Every touch would otherwise re-render the whole provider subtree.
  const idleRef = useRef(false);
  const rearmRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // A backgrounded app is already away, and the clock would be measuring a
    // screen nobody can touch.
    if (!foregrounded) {
      rearmRef.current = null;
      return;
    }
    // Coming back to the app IS the interaction. Requiring a second gesture
    // would strand someone on a machine they just opened.
    if (idleRef.current) {
      idleRef.current = false;
      setIdle(false);
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        idleRef.current = true;
        setIdle(true);
      }, USER_IDLE_TIMEOUT_MS);
    };
    rearmRef.current = arm;
    arm();
    return () => {
      rearmRef.current = null;
      if (timer) clearTimeout(timer);
    };
  }, [foregrounded]);

  const markActive = useCallback(() => {
    if (idleRef.current) {
      idleRef.current = false;
      setIdle(false);
    }
    rearmRef.current?.();
  }, []);

  return { active: foregrounded && !idle, markActive };
}
