import { View } from "react-native";
import Reanimated, { interpolate, Extrapolation, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { Icon } from "../components";
import { Text } from "./text";
import { useTheme } from "./theme";
import { THREAD_PULL_ARM } from "./thread-tasks";

const OMG_ORANGE = "#FF5530";
const SIZE = 44;

/**
 * WHAT A PULL ON HOME IS ABOUT TO DO, drawn as it happens (the Paper design,
 * "10 · Threads", screens 4 and 5). A chat mark in a ring: the ring fills
 * orange as the finger travels, and at the arm distance it is a solid orange
 * disc with "Release to start a thread". Driven by the pull distance on the
 * UI thread, so the list does not re-render per frame; only the label, which
 * changes at the arm point, comes from React state.
 */
export function ThreadPullIndicator({
  pull,
  armed,
  top,
}: {
  pull: SharedValue<number>;
  armed: boolean;
  top: number;
}) {
  const { colors, type } = useTheme();
  const shown = useAnimatedStyle(() => ({
    opacity: interpolate(pull.value, [24, 70], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(pull.value, [0, THREAD_PULL_ARM], [-12, 0], Extrapolation.CLAMP) }],
  }));
  // The fill grows from the centre until it covers the ring at the arm point.
  const fill = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pull.value, [40, THREAD_PULL_ARM], [0, 1], Extrapolation.CLAMP) }],
    opacity: interpolate(pull.value, [40, THREAD_PULL_ARM], [0.35, 1], Extrapolation.CLAMP),
  }));
  return (
    <Reanimated.View
      pointerEvents="none"
      testID="thread-pull-hint"
      style={[{ position: "absolute", left: 0, right: 0, top, alignItems: "center", gap: 8, zIndex: 1 }, shown]}
    >
      <View
        style={{
          width: SIZE,
          height: SIZE,
          borderRadius: SIZE / 2,
          borderWidth: 2,
          borderColor: armed ? OMG_ORANGE : colors.borderStrong,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <Reanimated.View
          style={[
            { position: "absolute", width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: OMG_ORANGE },
            fill,
          ]}
        />
        <Icon ios="bubble.left" android="chat_bubble_outline" size={18} weight="semibold" color={armed ? "#ffffff" : colors.textSecondary} />
      </View>
      <Text style={{ ...type.footnote, fontWeight: armed ? "600" : "400", color: armed ? colors.text : colors.textMuted }}>
        {armed ? "Release to start a thread" : "Pull to start a thread"}
      </Text>
    </Reanimated.View>
  );
}
