/**
 * A geometric trip-wire for the home list, not a fix.
 *
 * Benny has hit session/finding cards drawn on top of each other, with large
 * blank gaps elsewhere, on his real device — see the screenshot referenced in
 * the bug this file was added for. The content was always correct; only the
 * POSITIONS were wrong, which is the signature of a view left somewhere its
 * data no longer says it should be. `motion.tsx` already root-caused and
 * fixed one confirmed way that happens (a `exiting` animation stranding a
 * view out of flow when a re-render interrupts it — see that file's
 * "DO NOT ADD ONE" note) — but that fix has been reproduced, verified, and
 * live on a large real account without reproducing Benny's report again, so
 * either the fix is incomplete for some third path, or the failure needs
 * real-device timing (a Mac-hosted simulator has far more UI-thread headroom
 * than his phone) that a dev box cannot manufacture.
 *
 * Rather than guess at a fix for a mechanism nobody has caught in the act,
 * this instruments the actual invariant: no two rows should ever occupy
 * overlapping vertical space on screen. `Row` wraps each top-level list item,
 * measures its own on-screen frame after every layout pass via
 * `measureInWindow` (window coordinates, so rows in different sections —
 * different parent Views — are still comparable), and a debounced check
 * sorts all currently-mounted rows by their MEASURED top (not document
 * order, which would need its own bookkeeping and isn't the thing that can
 * go wrong here) and flags any pair whose vertical ranges intersect.
 *
 * On a hit: a console.error, unconditionally — harmless in a production
 * build with nobody attached to Metro, and free evidence the moment anyone
 * ever is. The TOAST is separate and deliberately gated: this is a
 * diagnostic for one bug report, not a feature, and a red "internal error"
 * toast firing on some unrelated user's phone for a transient, self-
 * correcting, sub-second layout race would be a worse experience than the
 * bug it is trying to catch. `notifyUser` decides whether the toast fires;
 * callers should pass it only for the account that reported this (see
 * `app/index.tsx`), or `__DEV__`, never unconditionally for everyone on the
 * production channel.
 *
 * Fires at most once per screen mount — this is a smoke detector, not a
 * running log, and a list that is actually broken will have plenty of other
 * evidence once this alarm has gone off once.
 *
 * Deliberately NOT wired into SessionCard/AutoFindingCard themselves: `Row`
 * is a plain, un-animated `View` wrapped one level OUTSIDE those components,
 * so it cannot change anything about their own Reanimated `entering`/`layout`
 * behaviour — it can only ever observe the frame Yoga already computed.
 */

import { useCallback, useMemo, useRef } from "react";
import { View, type LayoutChangeEvent } from "react-native";

import type { useToast } from "./toast";

type RowMeasurement = { id: string; top: number; bottom: number };

/** How much intersection counts as a real overlap, not float/rounding noise. */
const OVERLAP_THRESHOLD = 6;
/** Let a burst of layout passes settle before judging the result. */
const CHECK_DEBOUNCE_MS = 400;

export function useOverlapWatch(toast: ReturnType<typeof useToast>, notifyUser: boolean) {
  const measurements = useRef(new Map<string, RowMeasurement>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const runCheck = useCallback(() => {
    if (firedRef.current) return;
    const rows = Array.from(measurements.current.values()).sort((a, b) => a.top - b.top);
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      const overlap = prev.bottom - cur.top;
      if (overlap > OVERLAP_THRESHOLD) {
        firedRef.current = true;
        const message = `List rows overlap: "${prev.id}" over "${cur.id}" by ${Math.round(
          overlap,
        )}pt (${rows.length} rows on screen)`;
        // eslint-disable-next-line no-console
        console.error("[list-overlap-watch]", message, {
          prev,
          cur,
          allRows: rows,
        });
        if (notifyUser) toast.show(message, { intent: "error" });
        return;
      }
    }
  }, [toast, notifyUser]);

  const report = useCallback(
    (id: string, top: number, bottom: number) => {
      measurements.current.set(id, { id, top, bottom });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(runCheck, CHECK_DEBOUNCE_MS);
    },
    [runCheck],
  );

  const unregister = useCallback((id: string) => {
    measurements.current.delete(id);
  }, []);

  /**
   * One top-level list row. `id` should be the same stable key already used
   * for React reconciliation (`sessionStableId`, a finding id, …) — reusing
   * it means a row that remounts under a new key is correctly treated as a
   * new measurement, not compared against its own stale frame.
   */
  const Row = useMemo(() => {
    return function OverlapWatchRow({ id, children }: { id: string; children: React.ReactNode }) {
      const ref = useRef<View>(null);
      const onLayout = useCallback(
        (_e: LayoutChangeEvent) => {
          // The layout event's own `nativeEvent.layout` is PARENT-relative,
          // which is useless across sections (Working/Idle/Auto/Recent are
          // separate parent Views). `measureInWindow` gives screen
          // coordinates, so rows from different sections are still directly
          // comparable — which is exactly the comparison this exists to make.
          ref.current?.measureInWindow((_x, y, _width, height) => {
            report(id, y, y + height);
          });
        },
        [id],
      );
      return (
        <View ref={ref} onLayout={onLayout}>
          {children}
        </View>
      );
    };
  }, [report]);

  return { Row, unregister };
}
