/**
 * Step 01 of the onboarding revamp: Welcome.
 *
 * Replaces the three pitch panels this app opened with. Those made three
 * claims before showing anything; this makes one and gets out of the way,
 * because step 02 is where the person starts answering rather than reading.
 *
 * The panels' one real lesson is kept: advance by a button that is always on
 * screen, never by a swipe nobody was told about.
 *
 * Design: "v2_omg.dev iOS onboarding", artboard "01 · Welcome (updated)".
 */
import { Image, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { agentIcon } from "./agent-icons";
import { BrandMark } from "./brand-mark";
import { PrimaryAction } from "./onboarding-chrome";
import { Text } from "./text";
import { useTheme } from "./theme";

/**
 * The marks under the illustration, in the design's order.
 *
 * DECORATION, not a roster. Nothing here reports whether an agent is
 * connected, and tapping does nothing. "These are the agents this runs" is
 * true before any account exists; a connection state is not knowable until
 * after sign-in and would be a lie on this screen.
 */
const TEAM = ["claude", "codex", "cursor", "opencode", "devin", "grok"] as const;

export function WelcomeScreen({ onStart }: { onStart: () => void }) {
  const { colors, space, type } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          flex: 1,
          paddingTop: insets.top + space.md,
          paddingHorizontal: space.lg + 4,
          gap: space.lg,
        }}
      >
        <View
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm }}
        >
          <BrandMark size={23} holeColor={colors.bg} />
          <Text style={{ ...type.title, color: colors.text }}>omg.dev</Text>
        </View>

        {/* The line breaks are the design's, not reflow. Two short sentences
            carry the rhythm here and letting them wrap on a narrow phone
            loses it.

            The headline stands alone. The supporting line that used to sit
            under it ("Start a task from your phone...") said the same thing
            twice, and the design drops it so the illustration carries the
            second beat instead. */}
        <Text style={{ ...type.largeTitle, color: colors.text, textAlign: "center" }}>
          {"Keep work moving.\nWherever you are."}
        </Text>

        {/* The illustration takes whatever height is left and fits INSIDE it,
            so a short window shrinks the picture rather than pushing the button
            off the bottom -- the words and the action must survive, the picture
            need not.

            `flex: 1` with `contain`, NOT an aspect-ratio box. An aspect-ratio
            box that gets shrunk keeps its content at full size and CROPS it,
            which showed on a real screen as a horizontal slice of the
            illustration. `contain` scales to fit whatever it is given. */}
        <View style={{ flex: 1, justifyContent: "center", gap: space.md, paddingBottom: space.lg }}>
          <Image
            source={require("../../assets/onboarding/welcome-grass.png")}
            style={{ flex: 1, width: "100%" }}
            resizeMode="contain"
            accessible
            accessibilityLabel="Someone lying on the grass, starting a task from their phone"
          />
          <View style={{ alignItems: "center", gap: space.sm }}>
            <Text style={{ ...type.footnote, color: colors.textMuted }}>Every agent, on the go.</Text>
            <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
              {TEAM.map((agent) => (
                <Image
                  key={agent}
                  source={agentIcon(agent)}
                  style={{ width: 22, height: 22, borderRadius: 5 }}
                  resizeMode="contain"
                />
              ))}
            </View>
          </View>
        </View>
      </View>

      <View style={{ paddingHorizontal: space.lg + 4, paddingBottom: insets.bottom + space.lg }}>
        <PrimaryAction label="Get started" onPress={onStart} />
      </View>
    </View>
  );
}
