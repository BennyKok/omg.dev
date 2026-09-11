/**
 * HELD SENDS, above the composer. A queue-mode send while the agent is busy
 * is kept on the machine until the turn ends, outside the message chain,
 * still the person's to edit or drop. The web shows these as cards under
 * its composer; here they sit just above the field, one row each: the
 * text, a pencil to edit in place, a cross to drop it.
 */
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import Reanimated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

import { Icon } from "../components";

import { Text, TextInput } from "./text";
import { useTheme } from "./theme";

/**
 * The machine's queue row, typed here rather than from @omg-dev/protocol:
 * the app pins the published package, and "held" is newer than that
 * release. `status` is a string on purpose.
 */
export type HeldRow = { id: string; text: string; status: string; error?: string };

export function HeldQueue({
  items,
  onEdit,
  onRemove,
}: {
  items: HeldRow[];
  onEdit: (id: string, text: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const { colors, type, space, radius } = useTheme();
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  if (!items.length) return null;

  return (
    <View style={{ gap: 6, marginBottom: space.xs }}>
      {items.map((item) => {
        const isEditing = editing?.id === item.id;
        const working = busyId === item.id;
        return (
          <Reanimated.View
            key={item.id}
            entering={FadeIn.duration(150)}
            exiting={FadeOut.duration(120)}
            layout={LinearTransition.duration(150)}
            style={{
              flexDirection: "row",
              alignItems: isEditing ? "flex-end" : "center",
              gap: space.sm,
              paddingLeft: space.md,
              paddingRight: space.xs,
              paddingVertical: isEditing ? 8 : 6,
              borderRadius: radius.lg,
              backgroundColor: colors.card,
            }}
          >
            <Icon ios="clock" android="schedule" size={12} color={colors.textMuted} />
            {isEditing ? (
              <TextInput
                value={editing.text}
                onChangeText={(text) => setEditing({ id: item.id, text })}
                multiline
                autoFocus
                scrollEnabled={false}
                style={{ ...type.callout, lineHeight: 20, color: colors.text, flex: 1, paddingVertical: 0 }}
              />
            ) : (
              <Pressable
                onPress={() => setEditing({ id: item.id, text: item.text })}
                accessibilityRole="button"
                accessibilityLabel="Edit the held message"
                style={{ flex: 1 }}
              >
                <Text numberOfLines={2} style={{ ...type.callout, color: colors.textSecondary }}>
                  {item.text}
                </Text>
              </Pressable>
            )}
            {working ? (
              <ActivityIndicator size="small" color={colors.textMuted} style={{ width: 32 }} />
            ) : isEditing ? (
              <Pressable
                onPress={() => {
                  const text = editing.text.trim();
                  if (!text || text === item.text) {
                    setEditing(null);
                    return;
                  }
                  setBusyId(item.id);
                  onEdit(item.id, text).finally(() => {
                    setBusyId(null);
                    setEditing(null);
                  });
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Save"
                style={({ pressed }) => ({ width: 32, height: 32, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
              >
                <Icon ios="checkmark" android="check" size={15} weight="semibold" color={colors.text} />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => {
                  setBusyId(item.id);
                  onRemove(item.id).finally(() => setBusyId(null));
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Remove the held message"
                style={({ pressed }) => ({ width: 32, height: 32, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
              >
                <Icon ios="xmark" android="close" size={13} weight="semibold" color={colors.textMuted} />
              </Pressable>
            )}
          </Reanimated.View>
        );
      })}
    </View>
  );
}
