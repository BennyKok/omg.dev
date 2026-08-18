/**
 * Swipe-to-commit for a list row: drag left to reveal a backdrop action
 * (archive a session, dismiss a finding — whatever the row wants), release
 * past a distance or velocity threshold to commit, otherwise snap back.
 *
 * ONE HOOK, because it used to be two copies. SessionCard (swipe-to-archive)
 * and AutoFindingCard (swipe-to-dismiss, added by #127) carried byte-identical
 * PanResponder logic — same constants, same shape, same bug when one drifted
 * from the other. Tuning arbitration in one place and not the other is the
 * obvious failure mode with two copies; this is the shared primitive instead.
 *
 * PanResponder rather than react-native-gesture-handler: GH resolves in
 * node_modules as a transitive dependency of expo-router/react-native-screens
 * (present in full, native `apple/` source and podspec included — confirmed
 * 2026-08-18), but its native module is NOT in the binary already on devices
 * — checked with `nm` against the installed .app — so importing Swipeable
 * would throw at runtime for anyone on the current build, OTA or not. It only
 * reaches users through a new native build. PanResponder is React Native core
 * and rides along in the JS bundle, so THIS fix reaches the phone over the
 * air; see the PR description for the react-native-gesture-handler tradeoff
 * this project chose not to make here, and why.
 *
 * ARBITRATION AGAINST THE ENCLOSING SCROLLVIEW, RETUNED 2026-08-18, AND THE
 * CEILING THAT TUNING HIT. The row sits in a vertical ScrollView, so
 * `onMoveShouldSetPanResponderCapture` has to decide, per move event, whether
 * a drag is "the swipe" or "the scroll" — CAPTURE variant, because the card's
 * own PressableScale becomes the responder on touch-start, and a responder is
 * only dislodged by an ancestor asking during the capture phase.
 *
 * The previous gate — `dx < -8 && |dx| > |dy| * 1.5` — read as reasonable
 * directional arbitration on paper and was wrong in practice. Recorded on a
 * real device (iPhone 17 Pro sim): a clean horizontal swipe revealed the
 * backdrop every time; a slow diagonal at dx:dy ratio 1.4 (still a clearly
 * leftward, clearly swipe-shaped gesture to a human) NEVER revealed it, on
 * either row — the ratio required the drag to be 50% more horizontal than
 * vertical, stricter than how a thumb actually moves. That's the
 * "oftentimes" in the bug report.
 *
 * Loosening the ratio to 1.2 did not fix that same 1.4 diagonal — nor did
 * additionally dropping MIN_DX to 4, tried and reverted. Both measured on
 * video, not reasoned from the diff. The actual mechanism: UIScrollView's own
 * pan recognizer evaluates natively, with no bridge round-trip, and arms on
 * the first couple of points of vertical movement regardless of what the
 * touch's overall dx:dy ratio will turn out to be; PanResponder's capture
 * callback answers over the JS bridge, structurally later. On a gesture with
 * ANY real dy, native has usually already won before our callback is even
 * asked. The clean-horizontal case only ever worked because dy stayed ~0 —
 * there was nothing for the native recognizer to arm on, so no race ran at
 * all. No ratio or distance threshold in this file changes that outcome for
 * a genuinely diagonal drag; that is a JS-vs-native latency gap, not a
 * mistuned constant, and closing it needs arbitration that runs where
 * UIScrollView's own recognizer does — which is what
 * react-native-gesture-handler's `failOffsetY`/`activeOffsetX` are for.
 *
 * 1.2 and MIN_DX 10 are kept anyway: real, if partial, improvement — a drag
 * close to horizontal but not laser-straight now claims correctly instead of
 * losing to the old 1.5x gate — and every case tested here (drift-scroll with
 * persistent slight dx, fast flicks, edge-started scrolls) still scrolls
 * clean with no sideways jiggle. It is not the fix for a real diagonal swipe;
 * it is a safe, OTA-reachable improvement while that fix waits on a build.
 *
 * `onPanResponderTerminationRequest` is deliberately left at its RN default
 * (yields on request) rather than hard-locked to `false`: refusing to ever
 * give the gesture back is a different, untested change, and the failure
 * mode it would guard against (claim, then get stolen mid-drag) was never
 * observed here — every failure observed was "never claims," not "claims
 * then loses it."
 */
import { useMemo, useRef } from "react";
import { Dimensions, PanResponder } from "react-native";
import * as Haptics from "expo-haptics";
import { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

const SCREEN_WIDTH = Dimensions.get("window").width;

/** Leftward drag past this, or a fast enough flick, commits the row. */
const SWIPE_COMMIT_PX = 96;
const SWIPE_COMMIT_VELOCITY = 0.5;
/** How far the card travels before the backdrop behind it is at full strength. */
const REVEAL_WIDTH = 96;
/** Minimum leftward travel before a drag is even considered for the swipe. */
const MIN_DX = 10;
/** How much more horizontal than vertical a drag must be to claim the gesture. */
const HORIZONTAL_RATIO = 1.2;

export function useSwipeToCommit({
  enabled = true,
  onCommit,
  fastDuration,
  quickDuration,
}: {
  /** Omit/false to make the row unswipeable — panHandlers become inert. */
  enabled?: boolean;
  onCommit: () => void;
  /** Duration for the exit slide once committed — usually `motion.fast`. */
  fastDuration: number;
  /** Duration for the snap-back when released short of commit — usually `motion.quick`. */
  quickDuration: number;
}) {
  const translateX = useSharedValue(0);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_evt, gesture) =>
          enabled &&
          gesture.dx < -MIN_DX &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * HORIZONTAL_RATIO,
        onPanResponderMove: (_evt, gesture) => {
          if (gesture.dx < 0) translateX.value = Math.max(gesture.dx, -REVEAL_WIDTH * 1.4);
        },
        onPanResponderRelease: (_evt, gesture) => {
          const committed =
            gesture.dx < -SWIPE_COMMIT_PX || gesture.vx < -SWIPE_COMMIT_VELOCITY;
          if (committed) {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Slide the row out under its own exit rather than snapping back
            // and letting it vanish from a list update: the motion is the
            // confirmation that the swipe did something.
            translateX.value = withTiming(-SCREEN_WIDTH, { duration: fastDuration });
            onCommitRef.current();
          } else {
            translateX.value = withTiming(0, { duration: quickDuration });
          }
        },
        onPanResponderTerminate: () => {
          translateX.value = withTiming(0, { duration: quickDuration });
        },
      }),
    [enabled, translateX, fastDuration, quickDuration],
  );

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  // The backdrop only earns its pixels once the row has moved off them. Tied
  // to travel rather than faded on a timer so it cannot appear under a
  // stationary row.
  const revealStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.abs(translateX.value) / REVEAL_WIDTH),
  }));

  return { translateX, panResponder, cardStyle, revealStyle };
}
