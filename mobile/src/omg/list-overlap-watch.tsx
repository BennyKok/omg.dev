/**
 * A geometric trip-wire for the home list, not a fix.
 *
 * Benny has hit session/finding cards drawn on top of each other, with large
 * blank gaps elsewhere, on his real device — see the screenshot referenced in
 * the bug this file was added for. The content was always correct; only the
 * POSITIONS were wrong, which is the signature of a view left somewhere its
 * data no longer says it should be. `Row` wraps each top-level list item,
 * measures its own on-screen frame after every layout pass via
 * `measureInWindow` (window coordinates, so rows in different sections —
 * different parent Views — are still comparable), and a debounced check
 * sorts all currently-mounted rows by their MEASURED top (not document
 * order, which would need its own bookkeeping and isn't the thing that can
 * go wrong here) and flags any pair whose vertical ranges intersect.
 *
 * THIS FILE HAD A BUG, AND IT MATTERS WHO IT REACHED. The original
 * verification math was `prevBottom - curTop`, which silently assumes prev
 * is still above cur. A re-measurement does not guarantee that: if prev has
 * since settled somewhere well below cur, that formula turns a huge
 * SEPARATION into a huge fake OVERLAP. This shipped to Benny's device (the
 * real report that read "idle over recent, 57pt, 37 rows" is unverified —
 * it may be a genuine catch or it may be exactly this bug) before the fix
 * below existed. Fixed to the symmetric interval formula — `min(bottoms) -
 * max(tops)` — which is correct regardless of which row ends up on top the
 * second time.
 *
 * THE VERIFICATION ITSELF, added after a wave of suppressing every
 * Reanimated `entering`/`layout` animation on the list (see app/index.tsx)
 * still did not stop this from firing: a candidate hit schedules a SECOND,
 * independent `measureInWindow` pass on just the two offending rows after
 * `VERIFY_DELAY_MS`, and only reports if the SAME overlap survives. This is
 * what turned "two numbers that didn't match once" into "did this settle,"
 * and what proved — once the formula above was also fixed — that on this
 * simulator every candidate the detector has caught since has been a row
 * mid-relocation (typically an Auto row, moving 900-2000pt to its true
 * position), not a sustained overlap. That does not mean the bug is
 * imaginary — Benny's original screenshot, taken before this file existed,
 * is real, undebatable photographic evidence, and this simulator resolving
 * every candidate within `VERIFY_DELAY_MS` is consistent with the same
 * transient simply taking longer to settle on a loaded real device than on
 * a fast Mac. It means don't trust a raw "overlap found" line from before
 * this fix, on this device or his, as a confirmed finding on its own.
 *
 * On a hit: a console.error, unconditionally — harmless in a production
 * build with nobody attached to Metro, and free evidence the moment anyone
 * ever is. The TOAST is separate and deliberately gated: this is a
 * diagnostic for one bug report, not a feature, and a red "internal error"
 * toast firing on some unrelated user's phone for a transient, self-
 * correcting layout race would be a worse experience than the bug it is
 * trying to catch. `notifyUser` decides whether the toast fires; callers
 * should pass it only for the account that reported this (see
 * `app/index.tsx`), or `__DEV__`, never unconditionally for everyone on the
 * production channel.
 *
 * Fires at most once per screen mount, ONCE VERIFIED — this is a smoke
 * detector, not a running log, and a list that is actually broken will have
 * plenty of other evidence once this alarm has gone off once. An unverified
 * candidate that fails its re-check logs a `console.warn` and the check
 * keeps running — a later, genuine hit is still caught.
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
/**
 * `measureInWindow` is itself async — its callback resolves on a later tick,
 * not synchronously with the `onLayout` that requested it. Under a burst of
 * concurrent layout passes (many rows re-laying-out close together), two
 * rows' callbacks can resolve out of order relative to the actual native
 * tree, so the FIRST detection may be comparing one row's fresh frame
 * against another's already-stale one — a measurement race in this file,
 * not necessarily a real simultaneous overlap on screen. Before reporting,
 * re-measure the two offending rows fresh after a short quiet beat and only
 * report if the SAME overlap still holds. This is what turns "two numbers
 * that didn't match once" into "two rows genuinely occupying the same
 * pixels," which matters because both are real findings but only one is a
 * bug in the app rather than in this instrument.
 */
const VERIFY_DELAY_MS = 200;

export function useOverlapWatch(toast: ReturnType<typeof useToast>, notifyUser: boolean) {
  const measurements = useRef(new Map<string, RowMeasurement>());
  const rowRefs = useRef(new Map<string, React.RefObject<View | null>>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const measureNow = useCallback(
    (id: string): Promise<RowMeasurement | null> =>
      new Promise((resolve) => {
        const ref = rowRefs.current.get(id);
        if (!ref?.current) {
          resolve(null);
          return;
        }
        ref.current.measureInWindow((_x, y, _width, height) => {
          resolve({ id, top: y, bottom: y + height });
        });
      }),
    [],
  );

  const runCheck = useCallback(() => {
    if (firedRef.current) return;
    const rows = Array.from(measurements.current.values()).sort((a, b) => a.top - b.top);
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      const overlap = prev.bottom - cur.top;
      if (overlap > OVERLAP_THRESHOLD) {
        // Candidate hit — verify before committing to it. Nothing else in
        // this pass can fire while a verification is in flight (firedRef
        // only gets set once the verification actually confirms), so a
        // real, sustained overlap will simply be re-caught on the next
        // debounced check if this particular candidate turns out stale.
        void (async () => {
          await new Promise((r) => setTimeout(r, VERIFY_DELAY_MS));
          const [freshPrev, freshCur] = await Promise.all([measureNow(prev.id), measureNow(cur.id)]);
          if (!freshPrev || !freshCur) return;
          // SYMMETRIC interval overlap, not `freshPrev.bottom - freshCur.top`
          // — that formula silently assumes prev is still above cur, which
          // the first pass guarantees (rows are sorted by top before this
          // runs) but a re-measurement does NOT: if prev has since settled
          // to a position well below cur, `prev.bottom - cur.top` is a huge
          // POSITIVE number that means "far apart, wrong order," not
          // "overlapping" — min(bottoms) - max(tops) is correct regardless
          // of which one ended up on top the second time.
          const freshOverlap =
            Math.min(freshPrev.bottom, freshCur.bottom) - Math.max(freshPrev.top, freshCur.top);
          if (freshOverlap <= OVERLAP_THRESHOLD) {
            // eslint-disable-next-line no-console
            console.warn("[list-overlap-watch] candidate did not survive verification — measurement race, not a real overlap", {
              candidate: { prev, cur, overlap },
              reverified: { freshPrev, freshCur, freshOverlap },
            });
            return;
          }
          if (firedRef.current) return;
          firedRef.current = true;
          const message = `List rows overlap: "${prev.id}" over "${cur.id}" by ${Math.round(
            freshOverlap,
          )}pt (${rows.length} rows on screen) — VERIFIED twice`;
          // eslint-disable-next-line no-console
          console.error("[list-overlap-watch]", message, {
            firstMeasurement: { prev, cur, overlap },
            reverified: { freshPrev, freshCur, freshOverlap },
            allRows: rows,
          });
          if (notifyUser) toast.show(message, { intent: "error" });
        })();
        return;
      }
    }
  }, [toast, notifyUser, measureNow]);

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
    rowRefs.current.delete(id);
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
      rowRefs.current.set(id, ref);
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
