/**
 * Lucide glyphs, drawn from the icon FONT rather than from SVG.
 *
 * Every other glyph in this app is an SF Symbol, and that stays true — they
 * carry the system's optical weights and match the bar, the keyboard and the
 * menus for free. Lucide is here for the handful of places where the SF
 * Symbols catalogue has no honest equivalent: `desktopcomputer` is a Mac,
 * `pc` is a tower, and neither means "the machine this app is talking to".
 *
 * WHY A FONT AND NOT `lucide-react-native`.
 *
 * The React package renders through `react-native-svg`, which is a native
 * module. This app runs on a prebuilt dev client (and a TestFlight binary),
 * so adding a native module means an EAS rebuild and a reinstall on every
 * device before a single icon appears. The font ships the same 2045 glyphs as
 * an ordinary asset, loads at runtime, and needs no native code at all.
 *
 * The whole font is committed (~834K) rather than a subset of the two icons
 * used today. A subset would need regenerating every time someone reaches for
 * a third icon, and the failure mode when they forget is a tofu box on screen
 * — a bug that looks like a rendering problem rather than a missing build
 * step. Any name in `LUCIDE` below just works.
 *
 * Adding an icon: look its codepoint up in lucide-static's
 * `font/codepoints.json` (`npm pack lucide-static`) and add it to `LUCIDE`.
 * The map is deliberately small and explicit — a `Record<string, number>` of
 * all 2045 would let a typo compile.
 */
import { useFonts } from "expo-font";
import { Text } from "react-native";

/** Must match the key `useFonts` registers below, and nothing else uses it. */
export const LUCIDE_FONT_FAMILY = "Lucide";

/** Codepoints from lucide-static@1.31.0, `font/codepoints.json`. */
export const LUCIDE = {
  monitor: 0xe11d,
  settings: 0xe154,
  bot: 0xe1bb,
} as const;

export type LucideName = keyof typeof LUCIDE;

/**
 * Load once, at the root. Returns false until the font is registered; render
 * the splash rather than the app while that is true, because a glyph drawn
 * before the family exists falls back to the system font and shows a tofu box
 * that never repaints.
 */
export function useLucideFont(): boolean {
  const [loaded, error] = useFonts({
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    [LUCIDE_FONT_FAMILY]: require("../../assets/fonts/lucide.ttf"),
  });
  // A font that fails to load must not strand the app on its splash: two
  // missing icons is a bug, an app that never starts is a brick. Report it and
  // let the screens render.
  if (error) console.warn("[lucide] font failed to load:", error);
  return loaded || !!error;
}

/**
 * One glyph. Sized and coloured like `Icon`, so the two are interchangeable at
 * a call site and a row of mixed glyphs still lines up.
 */
export function LucideIcon({
  name,
  size = 20,
  color,
}: {
  name: LucideName;
  size?: number;
  color?: string;
}) {
  return (
    <Text
      // A glyph is not text: Dynamic Type would scale it out of the button it
      // sits in, and the button's own size is what carries the touch target.
      allowFontScaling={false}
      style={{
        fontFamily: LUCIDE_FONT_FAMILY,
        fontSize: size,
        // The em box IS the icon box in this font, so line height and width
        // track the size exactly and the glyph centres in whatever it is in.
        lineHeight: size,
        width: size,
        height: size,
        textAlign: "center",
        color,
      }}
    >
      {String.fromCodePoint(LUCIDE[name])}
    </Text>
  );
}
