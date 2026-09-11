/**
 * The keyboard shortcuts card, opened with ⌘/ or from the Pages menu. Same
 * glass card as the agent picker, so it reads as part of the same app.
 */
import { StyleSheet, View } from "react-native";


import { Sheet } from "./sheet";
import { SHORTCUTS } from "./key-commands";
import { Text } from "./text";
import { useTheme } from "./theme";

export function ShortcutsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, type, space, radius } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} placement="center" maxWidth={420}>
            <View style={{ padding: space.lg, paddingTop: space.sm, gap: space.md }}>
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
    </Sheet>
  );
}
