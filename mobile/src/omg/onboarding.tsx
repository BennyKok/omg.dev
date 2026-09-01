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
 * ── Why one screen and not a carousel ─────────────────────────────────────
 *
 * Three points fit. A swipe carousel would hide two thirds of them behind a
 * gesture nobody is told about, which is the same mistake plan.tsx's header
 * comment already records about hiding tiers behind a swipe. One screen, all
 * three visible, one button.
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
import { ScrollView, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AndroidSymbol, SFSymbol } from "expo-symbols";

import { Icon, PrimaryButton, Separator } from "../components";
import { Text } from "./text";
import { useTheme } from "./theme";

/**
 * Bump only when the POINTS below change materially, which re-shows the screen
 * to everyone. Fixing a typo is not material. Adding a fourth point is.
 */
export const ONBOARDING_VERSION = 1;

const storageKeyFor = (userId: string) => `omg:mobile:onboarding:${userId}`;

type Point = {
  icon: { ios: SFSymbol; android: AndroidSymbol };
  title: string;
  detail: string;
};

export const POINTS: Point[] = [
  {
    icon: { ios: "chevron.left.forwardslash.chevron.right", android: "code" },
    title: "Claude Code, Codex, OpenCode and Pi",
    detail: "Each one runs on a dedicated cloud computer, not on this phone.",
  },
  {
    icon: { ios: "clock.arrow.circlepath", android: "history" },
    title: "It keeps running when you close the app",
    detail:
      "Files and sessions stay intact, so you can pick up later from the browser, over SSH, or back in here.",
  },
  {
    icon: { ios: "bell.fill", android: "notifications" },
    title: "You get told when something needs you",
    detail: "A push notification when an agent finishes a task or needs input.",
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

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const { colors, space, type, radius } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.xl,
          gap: space.lg,
        }}
      >
        <Text style={{ ...type.largeTitle, color: colors.text }}>Your cloud Computer</Text>
        <Text style={{ ...type.body, color: colors.textMuted }}>
          omg.dev runs coding agents on a durable machine you can reach from your phone.
        </Text>

        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: radius.lg,
            paddingVertical: space.xs,
          }}
        >
          {POINTS.map((point, index) => (
            <View key={point.title}>
              {index > 0 ? <Separator inset="text" /> : null}
              <View style={{ flexDirection: "row", gap: space.md, padding: space.md }}>
                <Icon
                  ios={point.icon.ios}
                  android={point.icon.android}
                  size={20}
                  color={colors.textMuted}
                />
                <View style={{ flex: 1, gap: space.xs }}>
                  <Text style={{ ...type.headline, color: colors.text }}>{point.title}</Text>
                  <Text style={{ ...type.footnote, color: colors.textMuted }}>{point.detail}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View
        style={{
          padding: space.lg,
          paddingBottom: insets.bottom + space.lg,
          gap: space.sm,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <PrimaryButton label="Start" onPress={onDone} />
      </View>
    </View>
  );
}
