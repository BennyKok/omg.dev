/**
 * First-run onboarding: what a Computer is, once, before the session list.
 *
 * ── Why a gate and not a route ────────────────────────────────────────────
 *
 * This mirrors ai-consent.tsx exactly: a hook that reports "loading" |
 * "needed" | "done", and a full-screen component the layout RETURNS rather
 * than pushes. A route would be reachable by deep link and would need its own
 * guard to stop a signed-in user landing on it; a gate cannot be navigated to
 * at all. _layout.tsx already reads as a list of gates, and this is one more
 * in that list rather than a second mechanism beside it.
 *
 * It sits AFTER consent. Consent is a legal precondition for sending anything
 * anywhere, so it must come first; explaining the product to someone who then
 * declines consent and gets signed out would be wasted words.
 *
 * ── Paged, but never by swipe ─────────────────────────────────────────────
 *
 * Three panels, advanced by a button that is always on screen, with dots
 * showing how many are left. plan.tsx's header records the real mistake to
 * avoid: content hidden behind a gesture nobody is told about. A visible
 * Continue is not that. Swipe is deliberately NOT wired up, so there is
 * exactly one way forward and it is the one being pointed at.
 *
 * One idea per panel, because this is the first thing a new account sees and
 * a list of three bullets reads like a settings pane rather than a welcome.
 *
 * ── The copy is not invented ──────────────────────────────────────────────
 *
 * Every claim below is taken from the App Store description, which is the
 * product's own words:
 *
 *   "Run Claude Code, Codex, OpenCode, and Pi on a dedicated cloud computer"
 *   "Your Computer keeps running after you close the app, with its files and
 *    sessions intact, so you can pick up later from the browser, over SSH, or
 *    back in the app."
 *   "Push notifications when an agent needs input or finishes a task"
 *
 * Do not add a point here that the description does not support. A first-run
 * screen that promises something the app does not do is the most expensive
 * place in the product to be wrong.
 */

import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";


import Reanimated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { Icon } from "../components";
import { agentIcon } from "./agent-icons";
import { BrandMark } from "./brand-mark";
import { useReduceMotionEnabled } from "./motion";
import { Text } from "./text";
import { brand, useTheme } from "./theme";

/**
 * Bump only when the POINTS below change materially, which re-shows the screen
 * to everyone. Fixing a typo is not material. Adding a fourth point is.
 */
export const ONBOARDING_VERSION = 1;

const storageKeyFor = (userId: string) => `omg:mobile:onboarding:${userId}`;

type Panel = {
  art: "mark" | "keeps-going" | "notify";
  title: string;
  body: string;
};

/**
 * Every claim is the App Store description's, restated shorter. Do not add a
 * panel the description does not support.
 */
export const PANELS: Panel[] = [
  {
    art: "mark",
    title: "Your own computer",
    body: "Claude Code, Codex, OpenCode and Pi run on a cloud machine of your own, not on this phone.",
  },
  {
    art: "keeps-going",
    title: "Runs while closed",
    body: "Files and sessions stay intact, so you can pick up later from the browser, over SSH, or back in here.",
  },
  {
    art: "notify",
    title: "Notified when needed",
    body: "A push notification lands when an agent finishes a task or gets stuck.",
  },
];

type OnboardingState = "loading" | "needed" | "done";

/** Only a plain run of digits counts. Same reasoning as ai-consent.tsx. */
function seenVersion(raw: string | null): number {
  if (!raw || !/^\d+$/.test(raw)) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : 0;
}

export function useOnboarding(userId: string | null): {
  state: OnboardingState;
  complete: () => void;
} {
  const [state, setState] = useState<OnboardingState>("loading");

  useEffect(() => {
    let cancelled = false;
    // No account yet means nobody to have onboarded. The gate is only
    // consulted once signed in, so park rather than invent an answer.
    if (!userId) {
      setState("loading");
      return;
    }
    setState("loading");
    AsyncStorage.getItem(storageKeyFor(userId))
      .then((raw) => {
        if (cancelled) return;
        setState(seenVersion(raw) >= ONBOARDING_VERSION ? "done" : "needed");
      })
      .catch(() => {
        /*
         * Fail to "done", which is the DELIBERATE INVERSE of consent.
         *
         * Consent fails to "needed" because transmitting without approval is
         * far worse than one extra screen. Here the trade runs the other way:
         * a genuinely new account reads `null`, not an error, so it still sees
         * the screen. An actual read ERROR means storage exists and cannot be
         * read, which in practice means a RETURNING user — and re-explaining
         * the product to them on every launch is the worse failure.
         */
        if (!cancelled) setState("done");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const complete = useCallback(() => {
    if (!userId) return;
    // Flip the UI first. Persisting is best-effort: a storage failure should
    // re-show next launch, not trap someone on a screen they just dismissed.
    setState("done");
    void AsyncStorage.setItem(storageKeyFor(userId), String(ONBOARDING_VERSION)).catch(() => {});
  }, [userId]);

  return { state, complete };
}

/** Test/support hook: forget one account's run so the screen shows again. */
export async function resetOnboarding(userId: string): Promise<void> {
  await AsyncStorage.removeItem(storageKeyFor(userId));
}

/* ── Animated art, one per panel ───────────────────────────────────────────
 *
 * Ported from apps/web/src/components/onboarding/OnboardingArt.tsx in vibes,
 * which is the reference this screen is trying to match. Same idea: replace a
 * static glyph with a small on-brand motion illustration that says the panel's
 * message a second time. Same tile too — a brand-tinted squircle with an inset
 * ring, not a plain filled circle.
 *
 * Every loop is skipped under Reduce Motion, which renders the resting state.
 * The hook comes from motion.tsx rather than a local AccessibilityInfo call,
 * so this reads the same source as the shared animation builders.
 *
 * The web halo uses a CSS blur, which React Native has no cheap equivalent
 * for. A large, low-alpha disc that breathes reads close enough and costs one
 * view rather than an offscreen pass.
 * ─────────────────────────────────────────────────────────────────────────── */

const TILE = 104;
/** Same ratio as the web tile's rounded-[1.9rem] on 84px. */
const TILE_RADIUS = 38;

function useTileStyle() {
  return {
    width: TILE,
    height: TILE,
    borderRadius: TILE_RADIUS,
    backgroundColor: "rgba(255, 85, 48, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(255, 85, 48, 0.18)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };
}

/**
 * Panel 1 — the four coding agents rush inward and are absorbed into the mark.
 *
 * Adapted from FeaturesConverge.tsx on the web, which slides feature chips in
 * from the edges and absorbs them into the omg logo to say "it is all already
 * inside". Same beat, different cast: the chips here are the REAL agent marks
 * from agent-icons.ts, the same PNGs the session list uses, so the thing being
 * absorbed is the thing the user is about to run.
 *
 * Four, not nine. These are the four the App Store description names, and a
 * ring of nine at this size is a smudge.
 */
const AGENTS: { agent: string; x: number; y: number }[] = [
  { agent: "claude", x: -62, y: -34 },
  { agent: "codex", x: 62, y: -34 },
  { agent: "opencode", x: -62, y: 34 },
  { agent: "pi", x: 62, y: 34 },
];

const CONVERGE_MS = 2600;

/**
 * How far a "breath" pulls the four marks in, and how much it dims and
 * shrinks them at the deepest point of the inhale. All three floors are well
 * above zero on purpose: PULL never reaches 1 (full pull to centre), DIM
 * never reaches 1 (full transparency), SHRINK never reaches 1 (zero scale).
 * That is the fix for the missing-Claude bug — see the file-level note below.
 *
 * PULL IS BOUNDED BY GEOMETRY, NOT TASTE. The scatter radius is
 * hypot(62, 34) = 70.7. The mark is 60 across, so 30 of that is its radius,
 * and a chip is 38 across, so 19 more is its half-width. A chip centre nearer
 * than 49 therefore overlaps the mark, and it needs a few points of daylight
 * on top of that to still read as four marks around a disc rather than a
 * huddle on top of one:
 *
 *   max pull = 1 - 57 / 70.7 ≈ 0.19
 *
 * It was first set to 0.45, which is more than twice that. Nothing about that
 * is visible in a resting screenshot — the chips are correctly spread at
 * breath = 0 — and it satisfies "no chip is ever invisible", which was the
 * bug being fixed. It only shows at the top of the inhale, where all four
 * climb onto the mark. If you raise this, re-derive it from the numbers
 * above and then LOOK at a frame near peak breath, not at rest.
 */
const BREATH_PULL = 0.15;
const BREATH_DIM = 0.28;
const BREATH_SHRINK = 0.12;

function AgentChip({
  x,
  y,
  agent,
  breath,
}: {
  x: number;
  y: number;
  agent: string;
  breath: SharedValue<number>;
}) {
  const { colors, radius } = useTheme();

  const style = useAnimatedStyle(() => {
    "worklet";
    // breath is 0 (fully spread, resting) .. 1 (deepest inhale). The three
    // floors above keep every term short of its extreme, so at breath = 1
    // the chip is still there — smaller, dimmer, pulled inward — never gone.
    const pull = 1 - breath.value * BREATH_PULL;
    return {
      opacity: 1 - breath.value * BREATH_DIM,
      transform: [
        { translateX: x * pull },
        { translateY: y * pull },
        { scale: 1 - breath.value * BREATH_SHRINK },
      ],
    };
  });

  return (
    <Reanimated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          width: 38,
          height: 38,
          borderRadius: radius.md,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <Image source={agentIcon(agent)} style={{ width: 24, height: 24 }} resizeMode="contain" />
    </Reanimated.View>
  );
}

/*
 * All four marks breathe INWARD TOGETHER, in sync with a pulse on the omg
 * mark, rather than each independently rushing in and fading to nothing.
 *
 * The earlier version ran four independent loops, a quarter-cycle apart, so
 * that "one is always arriving while another is being absorbed" — but
 * "absorbed" meant opacity all the way to 0, and each chip's own trip through
 * 0 is exactly the frame where that brand is not on screen. Benny caught
 * Claude missing; a multi-frame screenshot sampling later caught Codex and Pi
 * doing the same thing on their own turns. Four independent zeros, staggered,
 * is still four zeros.
 *
 * One SHARED value fixes it two ways at once: nothing ever hits an extreme
 * (see BREATH_* floors above), and there is no stagger left to expose a solo
 * dip — all four move as one chest breathing, so whatever is true of one
 * frame is true of all four marks in it.
 */
function MarkArt({ still }: { still: boolean }) {
  const { colors } = useTheme();
  const breath = useSharedValue(0);

  useEffect(() => {
    if (still) return;
    breath.value = withRepeat(
      withTiming(1, { duration: CONVERGE_MS / 2, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [still, breath]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.28 + 0.22 * breath.value,
    transform: [{ scale: 0.92 + 0.16 * breath.value }],
  }));
  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.06 * breath.value }] }));

  return (
    <View style={{ width: 190, height: 132, alignItems: "center", justifyContent: "center" }}>
      <Reanimated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            width: 96,
            height: 96,
            borderRadius: 48,
            backgroundColor: "rgba(255, 85, 48, 0.28)",
          },
          glowStyle,
        ]}
      />
      {AGENTS.map((a) => (
        <AgentChip key={a.agent} x={a.x} y={a.y} agent={a.agent} breath={breath} />
      ))}
      <Reanimated.View style={markStyle}>
        <BrandMark size={60} holeColor={colors.bg} />
      </Reanimated.View>
    </View>
  );
}

/** Panel 2 — it keeps going: a ring pulses outward, over and over. */
function KeepsGoingArt({ still }: { still: boolean }) {
  const tile = useTileStyle();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (still) return;
    pulse.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.out(Easing.ease) }), -1, false);
  }, [still, pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - pulse.value),
    transform: [{ scale: 0.85 + 0.4 * pulse.value }],
  }));

  return (
    <View style={{ width: TILE, height: TILE, alignItems: "center", justifyContent: "center" }}>
      <Reanimated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            width: TILE,
            height: TILE,
            borderRadius: TILE_RADIUS,
            borderWidth: 2,
            borderColor: brand.orange,
          },
          ringStyle,
        ]}
      />
      <View style={tile}>
        <Icon ios="clock.arrow.circlepath" android="history" size={46} color={brand.orange} />
      </View>
    </View>
  );
}

/** Panel 3 — a bell rings and a coral badge pops in. Straight from the web. */
function NotifyArt({ still }: { still: boolean }) {
  const tile = useTileStyle();
  const { type } = useTheme();
  const swing = useSharedValue(0);
  const badge = useSharedValue(still ? 1 : 0);

  useEffect(() => {
    if (still) return;
    swing.value = withRepeat(
      withSequence(
        withTiming(-1, { duration: 130 }),
        withTiming(0.8, { duration: 130 }),
        withTiming(-0.6, { duration: 130 }),
        withTiming(0.4, { duration: 130 }),
        withTiming(0, { duration: 130 }),
        withDelay(1200, withTiming(0, { duration: 0 })),
      ),
      -1,
      false,
    );
    badge.value = withRepeat(
      withSequence(
        withDelay(650, withTiming(1.25, { duration: 160, easing: Easing.out(Easing.back(2)) })),
        withTiming(1, { duration: 120 }),
        withDelay(1200, withTiming(0, { duration: 0 })),
      ),
      -1,
      false,
    );
  }, [still, swing, badge]);

  // transformOrigin so the bell pivots from its crown, the way a bell swings,
  // rather than spinning about its middle.
  const bellStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${14 * swing.value}deg` }] }));
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badge.value }] }));

  return (
    <View style={tile}>
      <View>
        <Reanimated.View style={[{ transformOrigin: "top center" }, bellStyle]}>
          <Icon ios="bell.fill" android="notifications" size={44} color={brand.orange} />
        </Reanimated.View>
        <Reanimated.View
          style={[
            {
              position: "absolute",
              right: -6,
              top: -4,
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: brand.orange,
              alignItems: "center",
              justifyContent: "center",
            },
            badgeStyle,
          ]}
        >
          <Text style={{ ...type.caption, color: "#ffffff", fontWeight: "700" }}>1</Text>
        </Reanimated.View>
      </View>
    </View>
  );
}

function PanelArt({ art, still }: { art: Panel["art"]; still: boolean }) {
  if (art === "mark") return <MarkArt still={still} />;
  if (art === "keeps-going") return <KeepsGoingArt still={still} />;
  return <NotifyArt still={still} />;
}

/**
 * A big, brand-coloured, full-width button.
 *
 * Not `PrimaryButton`. That one is the system blue used on the settings-shaped
 * screens, and this is the first screen a new account sees, sitting directly
 * under an orange mark — blue there reads as a stock control on someone else's
 * template. Repainting PrimaryButton globally is a bigger call than this
 * screen should make on its own, so the divergence is local and deliberate.
 */
function BigButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { radius, type } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: brand.orange,
        borderRadius: radius.pill,
        paddingVertical: 18,
        alignItems: "center",
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text style={{ ...type.headline, color: "#ffffff" }}>{label}</Text>
    </Pressable>
  );
}

/** How far along, as dots. Three panels is few enough to show them all. */
function Dots({ count, index }: { count: number; index: number }) {
  const { colors, space } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: space.xs, justifyContent: "center" }}>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={{
            width: i === index ? 20 : 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: i === index ? brand.orange : colors.borderStrong,
          }}
        />
      ))}
    </View>
  );
}

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const { colors, space, type } = useTheme();
  const insets = useSafeAreaInsets();
  const still = useReduceMotionEnabled();
  const [index, setIndex] = useState(0);

  const panel = PANELS[index];
  const last = index === PANELS.length - 1;

  /*
   * Advance, or finish. Guarding on `last` rather than incrementing and
   * letting a render off the end of the array decide: PANELS[3] is undefined,
   * and a crash on the welcome screen is the worst possible first impression.
   */
  const next = useCallback(() => {
    if (last) onDone();
    else setIndex((current) => current + 1);
  }, [last, onDone]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          paddingTop: insets.top + space.md,
          paddingHorizontal: space.lg,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Skip is always available. Someone who already knows what this is
            should not have to tap through three panels to reach their work. */}
        <View style={{ width: 44 }} />
        <Dots count={PANELS.length} index={index} />
        <Pressable accessibilityRole="button" onPress={onDone} hitSlop={12}>
          <Text style={{ ...type.subhead, color: colors.textMuted }}>Skip</Text>
        </Pressable>
      </View>

      <View style={{ flex: 1, alignItems: "center", paddingHorizontal: space.xl }}>
        {/*
         * Centering this block in the FULL remaining flex (the old
         * `justifyContent: "center"`) put it dead-centre between the header
         * and the button. That reads fine on panel 1, whose art+copy is the
         * tallest, but panels 2 and 3 are shorter, so the same centring
         * left a gap under the copy that was often bigger than the gap
         * above the art — the block visually floats, disconnected from the
         * Continue button beneath it.
         *
         * Two unequal spacers instead of one centred block: more room above
         * (near the dots, which already reads as a header) than below, so
         * the content sits closer to the button it leads into, for every
         * panel's content height, without a hard-coded pixel offset.
         */}
        <View style={{ flex: 1 }} />
        <View style={{ alignItems: "center", gap: space.xl }}>
          {/*
           * Keyed on the panel so switching remounts the art and its loop
           * restarts from the top. Without the key, Reanimated keeps the
           * previous shared values running and panel 3's bell would arrive
           * mid-swing, which reads as a glitch rather than a ring.
           */}
          <PanelArt key={panel.art} art={panel.art} still={still} />

          <View style={{ gap: space.md }}>
            <Text style={{ ...type.largeTitle, color: colors.text, textAlign: "center" }}>
              {panel.title}
            </Text>
            <Text
              style={{
                ...type.body,
                color: colors.textMuted,
                textAlign: "center",
                lineHeight: 24,
              }}
            >
              {panel.body}
            </Text>
          </View>
        </View>
        <View style={{ flex: 0.6 }} />
      </View>

      <View
        style={{
          padding: space.lg,
          paddingBottom: insets.bottom + space.lg,
        }}
      >
        <BigButton label={last ? "Start" : "Continue"} onPress={next} />
      </View>
    </View>
  );
}
