/**
 * The keyboard shortcuts card, opened with ⌘/ or from the Pages menu. Same
 * glass card as the agent picker, so it reads as part of the same app.
 */
import { Modal, Pressable, StyleSheet, View } from "react-native";
import Reanimated, { Easing, FadeIn, FadeInDown, FadeOut, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassSurface } from "./glass";
import { SHORTCUTS } from "./key-commands";
import { Text } from "./text";
import { useTheme } from "./theme";

export function ShortcutsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, type, space, radius, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <Reanimated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(120)} style={StyleSheet.absoluteFill}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={{ flex: 1, backgroundColor: isDark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.25)" }}
          />
        </Reanimated.View>
        <Reanimated.View
          entering={FadeInDown.duration(170).easing(Easing.out(Easing.cubic))}
          exiting={FadeOutDown.duration(130)}
          style={{ width: "100%", maxWidth: 420, paddingHorizontal: 10, marginBottom: insets.bottom }}
        >
          <GlassSurface variant="regular" fallbackColor={colors.popover} style={{ borderRadius: 30, overflow: "hidden" }}>
            <View style={{ padding: space.lg, gap: space.md }}>
              <Text style={{ ...type.headline, color: colors.text }}>Keyboard shortcuts</Text>
              <View style={{ borderRadius: radius.xl, backgroundColor: colors.card, overflow: "hidden" }}>
                {SHORTCUTS.map((row, index) => (
                  <View
                    key={row.keys}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      minHeight: 40,
                      paddingHorizontal: space.lg,
                      gap: space.md,
                      borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                      borderTopColor: colors.borderSoft,
                    }}
                  >
                    <Text style={{ ...type.callout, color: colors.text, flex: 1 }}>{row.does}</Text>
                    <Text style={{ ...type.caption, color: colors.textMuted }}>{row.where}</Text>
                    <View
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: radius.sm,
                        backgroundColor: colors.secondary,
                        minWidth: 56,
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ ...type.footnote, fontWeight: "600", color: colors.text }}>{row.keys}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </GlassSurface>
        </Reanimated.View>
      </View>
    </Modal>
  );
}
