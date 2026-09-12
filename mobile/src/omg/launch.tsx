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
import { Dimensions, StyleSheet, View } from "react-native";
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

import { BrandMark, BrandWordmark } from "./brand-mark";
import { launch } from "./palette";
import { Text } from "./text";
import { useTheme } from "./theme";

/** One full pass of the highlight through the caption. */
const SHIMMER_MS = 1500;
/** How many characters the bright part of the wave spans. */
const SHIMMER_WIDTH = 4;
/**
 * THE CAPTION IS READ, NOT GLIMPSED.
 *
 * It used to be `type.footnote` (13pt/400) drawn in `colors.textMuted`, whose
 * alpha is 0.6 — and the shimmer then multiplied that by as little as 0.45, so
 * the resting text sat at an effective 0.27 alpha on the background. That is
 * below any usable contrast, and because only the 4-character wave rose out of
 * it the line read as a moving smudge rather than a sentence. Two changes: a
 * one-tier-brighter token (`textSecondary`, alpha 0.78) and a floor under the
 * shimmer, so the dim state is still legible and the wave is a highlight on
 * top of readable text instead of the only readable part.
 */
const SHIMMER_FLOOR = 0.72;
const SHIMMER_LIFT = 1 - SHIMMER_FLOOR;
/** 15pt/600: a launch caption is the only text on screen, so it carries weight. */
const CAPTION_TYPE = { fontSize: 15, fontWeight: "600", letterSpacing: -0.1 } as const;

/**
 * THE GLOW, AND WHY IT IS 24 STACKED CIRCLES.
 *
 * The landing paints its hero with
 * `radial-gradient(ellipse 80% 55% at 50% 12%, brand 20%, transparent 72%)`.
 * There is no radial gradient available here: `expo-linear-gradient` is linear
 * only, and `react-native-svg` — which has `RadialGradient` — is not a
 * dependency. Adding a native module for one decorative layer would also mean
 * a new binary rather than an OTA update.
 *
 * Concentric circles reproduce it exactly rather than approximately. CSS
 * interpolates a radial gradient LINEARLY in alpha between its stops, and N
 * evenly-spaced rings of equal alpha accumulate to the same linear ramp: at
 * distance d the number of rings covering it is N(1 - d/R), so the composited
 * alpha falls straight off to zero at the edge. 24 rings puts each step near
 * 1/255, which is below a visible band.
 *
 * RING_ALPHA is solved, not guessed: stacking k layers of alpha a gives
 * 1 - (1 - a)^k, so a = 1 - (1 - GLOW_ALPHA)^(1/N) lands the centre on the
 * landing's 20% exactly instead of the 18% that GLOW_ALPHA/N would give.
 *
 * 64 RINGS, NOT 24. At 24 the arithmetic said each step was about one level of
 * 255, and on device the rings were plainly visible anyway: the eye finds a
 * circular contour far below the threshold it needs for a flat edge, which is
 * ordinary Mach banding. 64 puts each step under one level — 0.0035 of a 249
 * level span — and the contours go.
 */
const GLOW_ALPHA = 0.2;
const GLOW_RINGS = 64;
const RING_ALPHA = 1 - Math.pow(1 - GLOW_ALPHA, 1 / GLOW_RINGS);
/** Radius against the short edge, and the squash that makes it the ellipse. */
const GLOW_RADIUS_RATIO = 0.85;
const GLOW_SQUASH = 0.72;

function RadialGlow({ rgb }: { rgb: string }) {
  // Read once at render. A splash does not outlive a rotation, and reacting to
  // one would restart the breathing animation mid-pulse.
  const { width, height } = Dimensions.get("window");
  const radius = Math.min(width, height) * GLOW_RADIUS_RATIO;

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.screen, { transform: [{ scaleY: GLOW_SQUASH }] }]}
    >
      {Array.from({ length: GLOW_RINGS }, (_, i) => {
        // Largest ring first, so later (smaller) children paint on top.
        const d = radius * 2 * (1 - i / GLOW_RINGS);
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              width: d,
              height: d,
              borderRadius: d / 2,
              backgroundColor: `rgba(${rgb}, ${RING_ALPHA})`,
            }}
          />
        );
      })}
    </View>
  );
}

/**
 * The launch surface: the landing's background with its glow on it.
 *
 * Exported because `app/_layout.tsx` shows a second, caption-less splash while
 * auth and consent settle. That screen and this one have to be the same
 * surface — two hand-rolled copies of "the launch look" is how one of them
 * ends up stale — so the backdrop lives here and both render it.
 */
export function LaunchBackdrop({ children }: { children?: React.ReactNode }) {
  const { isDark } = useTheme();
  const tokens = isDark ? launch.dark : launch.light;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: tokens.bg }]}>
      <RadialGlow rgb={tokens.glowRgb} />
      {children}
    </View>
  );
}

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
/** Disc diameter of the mark on the launch screen, and the lockup's cap height. */
const MARK_SIZE = 64;
const WORDMARK_SIZE = 30;

const CAPTION_OUT_MS = 120;
const DIP_MS = 110;
const ZOOM_MS = 250;
const DIP_SCALE = 0.9;
const ZOOM_SCALE = 7;

function ShimmerText({ text, color }: { text: string; color: string }) {
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
          color={color}
          style={CAPTION_TYPE}
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
    return { opacity: SHIMMER_FLOOR + lift * SHIMMER_LIFT };
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
  const { isDark } = useTheme();
  const tokens = isDark ? launch.dark : launch.light;
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
    <Reanimated.View pointerEvents={leaving ? "none" : "auto"} style={[StyleSheet.absoluteFill, backdropStyle]}>
      <LaunchBackdrop />
      {/**
       * ONE LAYER PER THING, EACH CENTRED ON THE SCREEN — not one centred
       * column of mark-above-wordmark-above-caption.
       *
       * As a column the STACK was centred, which put the mark's own centre
       * above the screen's by half of everything below it. Invisible at rest,
       * and very visible at 7x: a view scales about its own centre, so the mark
       * rushed out along a line that missed the middle of the screen and the
       * zoom read as drifting off toward the top. The mark owns the centre and
       * everything else is offset from it.
       *
       * `paddingTop` on a centred box moves its content down by HALF the
       * padding, because the padding shrinks the box it is centring in. Hence
       * the doubled offsets below — read them as `2 * distance-below-centre`.
       */}
      <Reanimated.View style={[StyleSheet.absoluteFill, styles.screen, markStyle]}>
        <BrandMark size={MARK_SIZE} holeColor={tokens.glowCentre} />
      </Reanimated.View>
      {/**
       * THE WORDMARK LEAVES WITH THE CAPTION, NOT WITH THE MARK.
       *
       * The mark's exit is a 7x rush past the viewer, and type at 7x is an
       * unreadable wall crossing the screen. The lockup's two halves therefore
       * part company on the way out: the type goes quietly, and the mark — the
       * only thing that reads at any size — does the travelling.
       */}
      <Reanimated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.screen, styles.wordmark, captionStyle]}
      >
        <BrandWordmark
          size={WORDMARK_SIZE}
          mark={false}
          color={tokens.text}
          mutedColor={tokens.textMuted}
          holeColor={tokens.glowCentre}
        />
      </Reanimated.View>
      <Reanimated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.screen, styles.caption, captionStyle]}
      >
        <ShimmerText text={label} color={tokens.textMuted} />
      </Reanimated.View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    justifyContent: "center",
  },
  wordmark: {
    // Centre sits MARK_SIZE/2 + 28 below the screen centre, doubled.
    paddingTop: (MARK_SIZE / 2 + 28) * 2,
  },
  caption: {
    // Clear of the wordmark's own half-height as well as the mark's.
    paddingTop: (MARK_SIZE / 2 + 28 + WORDMARK_SIZE / 2 + 26) * 2,
  },
});
