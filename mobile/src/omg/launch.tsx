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
 * The launch surface: the landing's background, flat.
 *
 * NO GLOW. The landing puts a brand radial behind its hero and this screen
 * carried a copy of it; Benny took it out. The background is one colour now,
 * which also means the mark's bite is filled with that colour again rather
 * than with the glow's centre.
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
 * accelerating rush in a quarter of a second.
 *
 * THE FACTOR IS SET BY THE MARK'S SIZE, not chosen for its own sake: the mark
 * has to leave the screen. It was 7x while the mark was 64pt, which put it at
 * 448pt against a 393pt-wide phone. The horizontal lockup shrank the mark to
 * 41pt, where 7x is 287pt and the mark would stop in front of the viewer
 * instead of passing them. 11x restores the same margin: 451pt.
 */
/**
 * THE LOCKUP IS HORIZONTAL, exactly as the landing header draws it: mark, gap,
 * then the type. It used to be a 64pt mark with the type stacked underneath.
 *
 * The gap is the wordmark's own ratio (0.26 of the cap height) so the spacing
 * matches BrandWordmark's built-in lockup rather than drifting from it.
 */
const WORDMARK_SIZE = 40;
const MARK_SIZE = Math.round(WORDMARK_SIZE * 1.02);
const LOCKUP_GAP = Math.round(WORDMARK_SIZE * 0.26);

const CAPTION_OUT_MS = 120;
const DIP_MS = 110;
const ZOOM_MS = 250;
const DIP_SCALE = 0.9;
const ZOOM_SCALE = 11;

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
  /**
   * 0 at rest, 1 once the mark has reached the screen centre.
   *
   * A HORIZONTAL LOCKUP PUTS THE MARK OFF CENTRE, and a view scales about its
   * own centre — so zooming it where it sits would send it out along a line to
   * the left of the middle, which reads as the mark falling off the side
   * rather than launching. It slides to the centre first, under the caption's
   * own 120ms, so the move is over before the dip begins and is read as the
   * lockup collapsing to its mark rather than as a separate step.
   */
  const slide = useSharedValue(0);
  /** Lockup width, measured: the slide distance depends on the type's width. */
  const [lockupWidth, setLockupWidth] = useState(0);
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
    slide.value = withTiming(1, { duration: CAPTION_OUT_MS, easing: Easing.inOut(Easing.quad) });

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
  }, [done, leaving, scale, fade, backdrop, caption, slide, onFinished]);

  // Distance right to the lockup's own centre, which is the screen's centre.
  const markShift = lockupWidth / 2 - MARK_SIZE / 2;

  const markStyle = useAnimatedStyle(() => {
    if (!leaving) {
      return {
        opacity: 0.55 + breathe.value * 0.45,
        transform: [{ scale: 0.97 + breathe.value * 0.03 }],
      };
    }
    // translateX BEFORE scale: the transforms apply in order, so the mark is
    // already centred when it is scaled about its own centre.
    return {
      opacity: fade.value,
      transform: [{ translateX: markShift * slide.value }, { scale: scale.value }],
    };
  });

  const captionStyle = useAnimatedStyle(() => ({ opacity: caption.value }));

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  return (
    <Reanimated.View pointerEvents={leaving ? "none" : "auto"} style={[StyleSheet.absoluteFill, backdropStyle]}>
      <LaunchBackdrop />
      {/**
       * TWO LAYERS, EACH CENTRED ON THE SCREEN — the lockup and the caption —
       * rather than one centred column of lockup-above-caption.
       *
       * As a column the PAIR was centred, which put the lockup's own centre
       * above the screen's by half the caption's height plus its gap.
       * Invisible at rest, and very visible during the exit: a view scales
       * about its own centre, so the mark rushed out along a line that missed
       * the middle of the screen and the zoom read as drifting toward the top.
       * The lockup owns the centre and the caption is offset from it.
       *
       * `paddingTop` on a centred box moves its content down by HALF the
       * padding, because the padding shrinks the box it is centring in. Hence
       * the doubled offset below — read it as `2 * distance-below-centre`.
       */}
      <View style={[StyleSheet.absoluteFill, styles.screen]} pointerEvents="none">
        <View
          style={styles.lockup}
          onLayout={(e) => setLockupWidth(e.nativeEvent.layout.width)}
        >
          <Reanimated.View style={markStyle}>
            <BrandMark size={MARK_SIZE} holeColor={tokens.bg} />
          </Reanimated.View>
          {/**
           * THE TYPE LEAVES WITH THE CAPTION, NOT WITH THE MARK.
           *
           * The mark's exit is a rush past the viewer, and type at 11x is an
           * unreadable wall crossing the screen. The lockup's two halves part
           * company on the way out: the type goes quietly while the mark —
           * the only half that reads at any size — does the travelling.
           */}
          <Reanimated.View style={captionStyle}>
            <BrandWordmark
              size={WORDMARK_SIZE}
              mark={false}
              color={tokens.text}
              mutedColor={tokens.textMuted}
            />
          </Reanimated.View>
        </View>
      </View>
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
  lockup: {
    alignItems: "center",
    flexDirection: "row",
    gap: LOCKUP_GAP,
  },
  caption: {
    // Clear of the lockup's own half-height, plus a gap.
    paddingTop: (MARK_SIZE / 2 + 30) * 2,
  },
});
