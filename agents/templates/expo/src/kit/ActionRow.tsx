// A pressable row with its own action button (for example delete).
//
// Why: a delete icon nested INSIDE a `Pressable` row also fires the row on web
// (the click bubbles). Here the row and the action are siblings, so they can
// never trigger each other.
//
//   <ActionRow onPress={() => toggle(t)} action={{ label: "Delete", icon: <Trash2 size={18} />, onPress: () => remove(t) }}>
//     <Text>{t.title}</Text>
//   </ActionRow>
import type { ReactNode } from "react";
import { Pressable, StyleSheet, type StyleProp, View, type ViewStyle } from "react-native";

export function ActionRow({ children, onPress, action, style }: {
  children: ReactNode;
  onPress?: () => void;
  action: { label: string; icon: ReactNode; onPress: () => void };
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.row, style]}>
      <Pressable accessibilityRole="button" onPress={onPress} style={styles.main}>{children}</Pressable>
      <Pressable accessibilityLabel={action.label} accessibilityRole="button" hitSlop={8} onPress={action.onPress} style={styles.action}>
        {action.icon}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  main: { flex: 1, minWidth: 0 },
  action: { padding: 8 },
});
