/**
 * HELD SENDS, tucked under the composer. A queue-mode send while the agent
 * is busy is kept on the machine until the turn ends, outside the message
 * chain, still the person's to edit or drop.
 *
 * Same shape as the web's HeldQueueCards: one card, narrower than the
 * field and slid under its bottom edge, so it reads as the next thing
 * waiting beneath the field rather than a panel on top of it. A header
 * counts the queue; collapsed, only the first message shows (truncated,
 * with a +N chip); expanded, all of them, numbered, in the order they will
 * go. Tap a message to edit it in place, the cross to drop it.
 */
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
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

/** How far the card's bottom sits under the field above it. */
export const HELD_QUEUE_TUCK = 12;

export function HeldQueue({
  items,
  busy,
  onEdit,
  onRemove,
}: {
  items: HeldRow[];
  /** Whether the agent is still working. Off, the queue is on its way out. */
  busy: boolean;
  onEdit: (id: string, text: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const { colors, type, space } = useTheme();
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return null;

  const hidden = expanded ? 0 : Math.max(0, items.length - 1);
  const shown = expanded ? items : items.slice(0, 1);
  const count = items.length === 1 ? "1 queued" : `${items.length} queued`;

  return (
    <Reanimated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(120)}
      layout={LinearTransition.duration(150)}
      style={{
        // Narrower than the field, centred, and its bottom hidden behind the
        // field: the row after this one paints over it.
        marginHorizontal: space.lg,
        marginBottom: -(HELD_QUEUE_TUCK + space.sm),
        paddingBottom: HELD_QUEUE_TUCK,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        borderWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: 0,
        borderColor: colors.border,
        backgroundColor: colors.secondary,
        overflow: "hidden",
      }}
    >
      <Pressable
        onPress={() => setExpanded((open) => !open)}
        disabled={items.length < 2}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? "Show only the next queued message" : "Show all queued messages"}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          paddingHorizontal: space.md,
          paddingTop: 8,
          paddingBottom: 4,
        }}
      >
        <Icon ios="clock" android="schedule" size={11} color={colors.textMuted} />
        <Text style={{ ...type.caption, color: colors.textMuted, flex: 1 }}>
          {count}
          {busy ? "" : " · sending"}
        </Text>
        {items.length > 1 ? (
          <Icon
            ios={expanded ? "chevron.up" : "chevron.down"}
            android={expanded ? "expand_less" : "expand_more"}
            size={11}
            weight="semibold"
            color={colors.textMuted}
          />
        ) : null}
      </Pressable>
      {shown.map((item, index) => {
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
              alignItems: isEditing || expanded ? "flex-start" : "center",
              gap: space.sm,
              paddingLeft: space.md,
              paddingRight: space.xs,
              paddingVertical: 4,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.border,
            }}
          >
            <Text
              style={{
                ...type.caption,
                color: colors.textMuted,
                width: 14,
                fontVariant: ["tabular-nums"],
                lineHeight: 20,
                paddingTop: isEditing || expanded ? 6 : 0,
              }}
            >
              {index + 1}
            </Text>
            {isEditing ? (
              <TextInput
                value={editing.text}
                onChangeText={(text) => setEditing({ id: item.id, text })}
                multiline
                autoFocus
                scrollEnabled={false}
                accessibilityLabel="Edit queued message"
                style={{ ...type.callout, lineHeight: 20, color: colors.text, flex: 1, paddingVertical: 6 }}
              />
            ) : (
              <Pressable
                onPress={() => setEditing({ id: item.id, text: item.text })}
                accessibilityRole="button"
                accessibilityLabel="Edit the queued message"
                style={{ flex: 1, paddingVertical: 6 }}
              >
                <Text
                  numberOfLines={expanded ? undefined : 1}
                  style={{ ...type.callout, lineHeight: 20, color: colors.textSecondary }}
                >
                  {item.text}
                </Text>
              </Pressable>
            )}
            {!expanded && hidden > 0 && index === 0 ? (
              <Pressable
                onPress={() => setExpanded(true)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Show ${hidden} more queued`}
                style={{
                  paddingHorizontal: 6,
                  height: 20,
                  justifyContent: "center",
                  borderRadius: 10,
                  backgroundColor: colors.card,
                }}
              >
                <Text style={{ ...type.caption, color: colors.textMuted, fontVariant: ["tabular-nums"] }}>
                  +{hidden}
                </Text>
              </Pressable>
            ) : null}
            {working ? (
              <ActivityIndicator size="small" color={colors.textMuted} style={{ width: 32 }} />
            ) : isEditing ? (
              <Pressable
                onPress={() => {
                  const text = editing.text.trim();
                  if (text === item.text) {
                    setEditing(null);
                    return;
                  }
                  setBusyId(item.id);
                  // Emptied is dropped, as on the web.
                  (text ? onEdit(item.id, text) : onRemove(item.id)).finally(() => {
                    setBusyId(null);
                    setEditing(null);
                  });
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Save queued message"
                style={({ pressed }) => ({
                  width: 32,
                  height: 32,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.5 : 1,
                })}
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
                accessibilityLabel="Remove queued message"
                style={({ pressed }) => ({
                  width: 32,
                  height: 32,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.5 : 1,
                })}
              >
                <Icon ios="xmark" android="close" size={13} weight="semibold" color={colors.textMuted} />
              </Pressable>
            )}
          </Reanimated.View>
        );
      })}
    </Reanimated.View>
  );
}
