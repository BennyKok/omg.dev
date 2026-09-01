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
import { Pressable, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AndroidSymbol, SFSymbol } from "expo-symbols";

import { Icon } from "../components";
import { Text } from "./text";
import { brand, useTheme } from "./theme";

/**
 * Bump only when the POINTS below change materially, which re-shows the screen
 * to everyone. Fixing a typo is not material. Adding a fourth point is.
 */
export const ONBOARDING_VERSION = 1;

const storageKeyFor = (userId: string) => `omg:mobile:onboarding:${userId}`;

type Panel = {
  icon: { ios: SFSymbol; android: AndroidSymbol };
  title: string;
  body: string;
};

/**
 * Every claim is the App Store description's, restated shorter. Do not add a
 * panel the description does not support.
 */
export const PANELS: Panel[] = [
  {
    icon: { ios: "chevron.left.forwardslash.chevron.right", android: "code" },
    title: "Your agents get a real computer",
    body: "Claude Code, Codex, OpenCode and Pi run on a cloud machine of your own, not on this phone.",
  },
  {
    icon: { ios: "clock.arrow.circlepath", android: "history" },
    title: "Close the app. It keeps going.",
    body: "Files and sessions stay intact, so you can pick up later from the browser, over SSH, or back in here.",
  },
  {
    icon: { ios: "bell.fill", android: "notifications" },
    title: "You will know when it needs you",
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

      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: space.xl,
          gap: space.xl,
        }}
      >
        <View
          style={{
            width: 148,
            height: 148,
            borderRadius: 74,
            // The brand at low alpha rather than `colors.card`: a grey disc
            // under an orange mark reads as a placeholder for missing art.
            backgroundColor: "rgba(255, 85, 48, 0.14)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon ios={panel.icon.ios} android={panel.icon.android} size={60} color={brand.orange} />
        </View>

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
