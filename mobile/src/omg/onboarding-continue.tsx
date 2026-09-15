/**
 * Step 05: continue your {word}!
 *
 * The card is the REAL session, not a picture of one. It is the transcript
 * that was created from the prompt written in step 03, live, scrollable, and
 * tappable -- tapping it and the button both land in the same place.
 *
 * ── Why the fade ──────────────────────────────────────────────────────────
 *
 * The card is clipped, so it needs to say so. A hard cut reads as a rendering
 * bug; a fade reads as "there is more". The transcript itself uses the same
 * device at its own edges, so this is the app's existing vocabulary rather
 * than a new one.
 *
 * ── The word is theirs ────────────────────────────────────────────────────
 *
 * "Continue your design!" / "code!" / "insights!" / "sales!", from the lane
 * chosen in step 02, falling back to "chat" for anyone who took the custom
 * path and never picked one. See headlineWord() in onboarding-tasks.ts.
 *
 * Design: artboard "05 · Continue your chat [09]".
 */
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";

import { headlineWord, type InterestKey } from "./onboarding-tasks";
import { PrimaryAction, StepHeader, StepHeading } from "./onboarding-chrome";
import { useTheme } from "./theme";

export function ContinueScreen({
  interest,
  transcript,
  onOpen,
  onBack,
}: {
  interest: InterestKey | null;
  /** The live transcript for the session created in step 03. */
  transcript: ReactNode;
  onOpen: () => void;
  onBack: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <StepHeader onBack={onBack} />
      <View style={{ flex: 1, paddingHorizontal: space.lg + 4, gap: space.lg }}>
        <StepHeading
          title={`Continue your\n${headlineWord(interest)}!`}
          body="Keep track of your agent."
        />

        {/*
         * Scrollable AND tappable, which Benny asked for explicitly. The
         * transcript scrolls under the finger; a tap anywhere on the card
         * opens the same session the button does, so there is no dead area on
         * something that looks like the thing you want.
         */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open this session"
          onPress={onOpen}
          style={{
            flex: 1,
            borderRadius: radius.xl,
            borderWidth: 1,
            borderColor: colors.border,
            overflow: "hidden",
          }}
        >
          {transcript}
          {/* Says the card is clipped. A hard cut reads as a rendering bug. */}
          <LinearGradient
            pointerEvents="none"
            colors={["transparent", colors.bg]}
            style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 56 }}
          />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: space.lg + 4, paddingBottom: insets.bottom + space.lg }}>
        <PrimaryAction label="Let me in" onPress={onOpen} />
      </View>
    </View>
  );
}
