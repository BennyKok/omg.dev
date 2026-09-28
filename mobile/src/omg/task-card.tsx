import { Pressable, View } from "react-native";
import { Text } from "./text";
import { useTheme } from "./theme";
import { TASK_STATE_LABEL, type TaskCardState } from "./thread-tasks";

/** A task omg started from a thread, drawn where it was started. Tap opens the task. */
export function TaskCard({
  sessionId,
  title,
  project,
  state,
  onOpen,
}: {
  sessionId: string;
  title: string;
  project: string | null;
  state: TaskCardState;
  onOpen?: () => void;
}) {
  const { colors, type, space, radius } = useTheme();
  const tint =
    state === "working"
      ? colors.primary
      : state === "needs-you"
        ? colors.warning
        : state === "failed"
          ? colors.danger
          : state === "done"
            ? colors.success
            : colors.textMuted;
  const shortId = sessionId.slice(0, 8);
  return (
    <Pressable
      testID={`task-card-${shortId}`}
      accessibilityRole="button"
      accessibilityLabel={`Task ${TASK_STATE_LABEL[state]}: ${title}${project ? `, ${project}` : ""}`}
      onPress={onOpen}
      style={({ pressed }) => ({
        alignSelf: "stretch",
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: colors.borderStrong,
        backgroundColor: pressed ? colors.cardPressed : colors.card,
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: space.sm,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tint }} />
        <Text style={{ ...type.footnote, fontWeight: "600", color: tint }}>{TASK_STATE_LABEL[state]}</Text>
        <View style={{ flex: 1 }} />
        <Text style={{ ...type.caption, color: colors.textMuted, fontVariant: ["tabular-nums"] }}>{shortId}</Text>
      </View>
      <View style={{ gap: 2 }}>
        <Text numberOfLines={2} style={{ ...type.headline, color: colors.text }}>{title}</Text>
        {project ? (
          <Text numberOfLines={1} style={{ ...type.subhead, color: colors.textSecondary }}>{project}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
