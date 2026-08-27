/**
 * The launch screen: the mark, a line of shimmering text, and a way out.
 *
 * WHAT THIS REPLACES. The app used to reach the session list before it knew
 * anything, and the list said what it could — which for the first second was
 * "Connecting to …" with an empty machine name, because the bindings had not
 * loaded yet. A sentence naming no computer is worse than no sentence: it is
 * the app admitting, in the first frame someone sees, that it does not know
 * what it is doing. Skeleton cards under it made a second promise the same
 * frame could not keep.
 *
 * So nothing structural is shown until there is something true to say. The
 * mark stays, the caption says which of the two slow things is happening
 * ("Connecting…" / "Waking your computer…"), and the machine's name only
 * appears once there is one.
 *
 * THE SHIMMER IS PER-CHARACTER, not a gradient sweep. A gradient needs a mask
 * to be clipped to glyphs (`@react-native-masked-view` is in the tree but not
 * in package.json — a native module we do not declare is exactly the trap that
 * shipped a broken binary here once already), and an unmasked streak lightens
 * the background as much as the text, which reads as a rectangle passing by. A
 * wave of brightness travelling through the letters needs no native module at
 * all, runs on the UI thread, and is what "shimmer" actually looks like.
 *
 * THE EXIT IS THE POINT. Fading a loading screen out leaves the impression the
 * app was waiting; pushing the mark toward the viewer as it goes reads as the
 * app opening. Caption first (it has nothing more to say), then the mark
 * swells and dissolves, and the surface underneath — already mounted, already
 * laid out — is simply there.
 */

import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Reanimated, {
  Easing,
  type SharedValue,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { BrandMark } from "./brand-mark";
import { Text } from "./text";
import { useTheme } from "./theme";

/** One full pass of the highlight through the caption. */
const SHIMMER_MS = 1500;
/** How many characters the bright part of the wave spans. */
const SHIMMER_WIDTH = 4;

/**
 * THE EXIT IS A ZOOM PAST THE VIEWER, NOT A RESIZE.
 *
 * The first version grew the mark by 35% over 460ms on an ease-OUT curve, and
 * on device that reads as exactly what it is: an icon changing size and then
 * disappearing. Three things were wrong. 1.35x is a size change, not motion
 * toward you. Ease-out means it moves fastest at the START and coasts to a
 * stop — the shape of something settling, when this wants the shape of
 * something launching. And 460ms is long enough to watch.
 *
 * So: a short DIP first (the anticipation every fast move needs — a thing that
 * pulls back before it goes reads as intent rather than a glitch), then an
 * accelerating rush to 7x in a quarter of a second. Seven, because the mark
 * has to leave the screen: 64pt at 7x is 448pt against a 393pt-wide phone, so
 * it passes the viewer rather than stopping in front of them.
 */
const CAPTION_OUT_MS = 120;
const DIP_MS = 110;
const ZOOM_MS = 250;
const DIP_SCALE = 0.9;
const ZOOM_SCALE = 7;

function ShimmerText({ text }: { text: string }) {
  const { colors, type } = useTheme();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: SHIMMER_MS, easing: Easing.linear }),
      -1,
      false,
    );
  }, [progress, text]);

  const chars = [...text];

  return (
    <View style={{ flexDirection: "row" }}>
      {chars.map((char, index) => (
        <ShimmerChar
          // Position IS the identity here: the same letter appears many times
          // in one caption and each occurrence lights at a different moment.
          key={`${index}-${char}`}
          char={char}
          index={index}
          total={chars.length}
          progress={progress}
          color={colors.textMuted}
          style={type.footnote}
        />
      ))}
    </View>
  );
}

function ShimmerChar({
  char,
  index,
  total,
  progress,
  color,
  style,
}: {
  char: string;
  index: number;
  total: number;
  progress: SharedValue<number>;
  color: string;
  style: object;
}) {
  const animated = useAnimatedStyle(() => {
    // The wave enters from before the first letter and leaves after the last,
    // so the caption goes fully quiet between passes instead of the highlight
    // teleporting back to the start.
    const head = progress.value * (total + SHIMMER_WIDTH * 2) - SHIMMER_WIDTH;
    const distance = Math.abs(index - head);
    const lift = Math.max(0, 1 - distance / SHIMMER_WIDTH);
    return { opacity: 0.45 + lift * 0.55 };
  });

  return (
    <Reanimated.View style={animated}>
      <Text style={{ ...style, color }}>{char === " " ? " " : char}</Text>
    </Reanimated.View>
  );
}

export function LaunchScreen({
  /** What is happening, in the app's own words. Never names a machine we have not resolved. */
  label,
  /**
   * The surface behind this is ready. Plays the exit and then calls
   * `onFinished`; until it is true this screen holds, however long that takes.
   */
  done,
  onFinished,
}: {
  label: string;
  done?: boolean;
  onFinished?: () => void;
}) {
  const { colors } = useTheme();
  const breathe = useSharedValue(0);
  const scale = useSharedValue(1);
  const fade = useSharedValue(1);
  const backdrop = useSharedValue(1);
  const caption = useSharedValue(1);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    breathe.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [breathe]);

  useEffect(() => {
    if (!done || leaving) return;
    setLeaving(true);

    /**
     * One value per thing that moves, not one progress driving all of them.
     * These four are deliberately out of step — the caption is gone before the
     * dip, the page appears while the mark is still travelling — and expressing
     * that as offsets into a shared timeline meant every timing tweak silently
     * re-cut the others.
     */
    caption.value = withTiming(0, { duration: CAPTION_OUT_MS });

    scale.value = withDelay(
      CAPTION_OUT_MS,
      withSequence(
        withTiming(DIP_SCALE, { duration: DIP_MS, easing: Easing.out(Easing.quad) }),
        withTiming(ZOOM_SCALE, { duration: ZOOM_MS, easing: Easing.in(Easing.cubic) }),
      ),
    );

    // The mark stays SOLID for most of the rush and blinks out at the end.
    // Fading while it travels turns a launch into a dissolve.
    fade.value = withDelay(
      CAPTION_OUT_MS + DIP_MS + ZOOM_MS * 0.62,
      withTiming(0, { duration: ZOOM_MS * 0.38 }, (finished) => {
        if (finished && onFinished) runOnJS(onFinished)();
      }),
    );

    // The page underneath is revealed WHILE the mark is still on its way out,
    // so the app is already there as the mark passes — rather than the mark
    // leaving and a black frame waiting behind it.
    backdrop.value = withDelay(
      CAPTION_OUT_MS + DIP_MS + ZOOM_MS * 0.3,
      withTiming(0, { duration: ZOOM_MS * 0.55 }),
    );
  }, [done, leaving, scale, fade, backdrop, caption, onFinished]);

  const markStyle = useAnimatedStyle(() => {
    if (!leaving) {
      return {
        opacity: 0.55 + breathe.value * 0.45,
        transform: [{ scale: 0.97 + breathe.value * 0.03 }],
      };
    }
    return { opacity: fade.value, transform: [{ scale: scale.value }] };
  });

  const captionStyle = useAnimatedStyle(() => ({ opacity: caption.value }));

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  return (
    <Reanimated.View
      pointerEvents={leaving ? "none" : "auto"}
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }, backdropStyle]}
    >
      {/**
       * TWO LAYERS, EACH CENTRED ON THE SCREEN — not one centred column of
       * mark-above-caption.
       *
       * As a column the PAIR was centred, which put the mark's own centre
       * above the screen's by half the caption's height plus its gap. Invisible
       * at rest, and very visible at 7x: a view scales about its own centre, so
       * the mark rushed out along a line that missed the middle of the screen
       * and the zoom read as drifting off toward the top. The mark owns the
       * centre now and the caption is offset from it.
       */}
      <Reanimated.View style={[StyleSheet.absoluteFill, styles.screen, markStyle]}>
        <BrandMark size={64} holeColor={colors.bg} />
      </Reanimated.View>
      <Reanimated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.screen, styles.caption, captionStyle]}
      >
        <ShimmerText text={label} />
      </Reanimated.View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    justifyContent: "center",
  },
  caption: {
    // Pushed below the mark, which is centred: half of 64, and a gap.
    paddingTop: 64 + 36,
  },
});
