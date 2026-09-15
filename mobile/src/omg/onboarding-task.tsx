/**
 * Step 03: choose your first task.
 *
 * One screen, four variants. The lane picked in step 02 supplies the header,
 * the tool badges and the three tasks, all from onboarding-tasks.ts -- the
 * design draws this as four artboards, but they differ only in their contents,
 * so four components would be three copies waiting to drift apart.
 *
 * ── The tool badges are not buttons ───────────────────────────────────────
 *
 * They say which workflows this lane fits. They do NOT connect anything and
 * are not pressable: the example tasks run on sample inputs, and an account is
 * connected only when something actually needs it -- which, per the flow, is
 * after the first session. A badge that looked tappable and did nothing would
 * be worse than no badge.
 *
 * ── The fourth row is not a task ──────────────────────────────────────────
 *
 * "Start with my own idea" carries a chevron rather than a radio, because it
 * leaves for a different screen instead of selecting in place. Same reason the
 * design draws it that way.
 *
 * Design: artboards "03 · Choose your first task" and 03B / 03C / 03D.
 */
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { Icon } from "../components";
import { laneFor, type InterestKey } from "./onboarding-tasks";
import { PrimaryAction, StepHeader, StepHeading } from "./onboarding-chrome";
import { Text } from "./text";
import { useTheme } from "./theme";

export function TaskScreen({
  interest,
  chosenTaskId,
  onChooseTask,
  onOwnIdea,
  onContinue,
  onBack,
}: {
  interest: InterestKey;
  chosenTaskId: string | null;
  onChooseTask: (taskId: string) => void;
  onOwnIdea: () => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const { colors, radius, space, type } = useTheme();
  const insets = useSafeAreaInsets();
  const lane = laneFor(interest);
  if (!lane) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      {/* The lane in the corner: four versions of one title that differ only
          below the fold would otherwise read as the screen failing to change. */}
      <StepHeader onBack={onBack} trailing={lane.label} />
      <View style={{ flex: 1, paddingHorizontal: space.lg + 4, gap: space.lg }}>
        <StepHeading title={"Choose your\nfirst task."} body="Pick a task or start with your own idea." />

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {lane.tools.map((tool) => (
            <View
              key={tool}
              accessible
              accessibilityLabel={`Works with ${tool}`}
              style={{
                paddingHorizontal: space.md,
                paddingVertical: 8,
                borderRadius: radius.sm,
                backgroundColor: colors.card,
              }}
            >
              <Text style={{ ...type.subhead, color: colors.text }}>{tool}</Text>
            </View>
          ))}
        </View>

        <View style={{ gap: space.sm }}>
          {lane.tasks.map((task) => {
            const selected = task.id === chosenTaskId;
            return (
              <Pressable
                key={task.id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => {
                  void Haptics.selectionAsync();
                  onChooseTask(task.id);
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  paddingHorizontal: space.lg,
                  paddingVertical: 16,
                  borderRadius: radius.lg,
                  borderWidth: selected ? 2 : 1,
                  borderColor: selected ? colors.text : colors.border,
                  backgroundColor: selected ? colors.card : "transparent",
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text style={{ ...type.body, color: colors.text, flex: 1 }}>{task.label}</Text>
                <Chosen on={selected} />
              </Pressable>
            );
          })}

          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens a blank prompt"
            onPress={() => {
              void Haptics.selectionAsync();
              onOwnIdea();
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingHorizontal: space.lg,
              paddingVertical: 16,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.border,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ ...type.body, color: colors.text, flex: 1 }}>Start with my own idea</Text>
            {/* A chevron, not a radio: this leaves for another screen rather
                than selecting in place. */}
            <View style={{ width: 24, alignItems: "center", flexShrink: 0 }}>
              <Icon ios="chevron.right" android="chevron_right" size={15} color={colors.textMuted} />
            </View>
          </Pressable>
        </View>
      </View>

      <View style={{ paddingHorizontal: space.lg + 4, paddingBottom: insets.bottom + space.lg }}>
        <PrimaryAction label="Continue" onPress={onContinue} disabled={!chosenTaskId} />
      </View>
    </View>
  );
}

/** Same trailing lane as step 02: drawn either way so nothing shifts. */
function Chosen({ on }: { on: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: on ? colors.text : "transparent",
        borderWidth: on ? 0 : 1.5,
        borderColor: colors.border,
      }}
    >
      {on ? <Icon ios="checkmark" android="check" size={12} color={colors.bg} /> : null}
    </View>
  );
}
