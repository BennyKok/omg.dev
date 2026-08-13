/**
 * A native list-of-choices menu — the one place this app draws its own
 * "pick one of these" UI, and only because a UIAlertController on iOS (via
 * ActionSheetIOS) IS that picker: no separate screen to push, no custom sheet
 * to reimplement in a way that will never quite match Apple's own. Android
 * gets an Alert, that platform's equivalent list-of-choices dialog.
 *
 * Pulled out of session/[id].tsx, which was the first screen to need this,
 * so the Computer picker can share the exact same behaviour rather than
 * growing a second, slightly different, native menu.
 */
import { ActionSheetIOS, Alert, Platform } from "react-native";

export type MenuAction = {
  label: string;
  destructive?: boolean;
  /** Listed but not tappable — e.g. a plan-blocked Computer in the picker. */
  disabled?: boolean;
  onPress: () => void;
};

export function showActionMenu(title: string, actions: MenuAction[]) {
  if (!actions.length) return;
  if (Platform.OS === "ios") {
    const labels = actions.map((a) => a.label);
    const destructive = actions.findIndex((a) => a.destructive);
    const disabledButtonIndices = actions
      .map((a, i) => (a.disabled ? i : -1))
      .filter((i) => i >= 0);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: [...labels, "Cancel"],
        cancelButtonIndex: labels.length,
        // -1 is "no destructive button" to some callers and an out-of-range
        // index to others; omitting the key is unambiguous.
        ...(destructive >= 0 ? { destructiveButtonIndex: destructive } : {}),
        ...(disabledButtonIndices.length ? { disabledButtonIndices } : {}),
      },
      (index) => {
        const action = actions[index];
        if (action && !action.disabled) action.onPress();
      },
    );
    return;
  }
  Alert.alert(title, undefined, [
    // Alert has no notion of a disabled button; a disabled row is simply not
    // offered rather than shown and silently ignored on tap.
    ...actions
      .filter((a) => !a.disabled)
      .map((a) => ({
        text: a.label,
        style: a.destructive ? ("destructive" as const) : ("default" as const),
        onPress: a.onPress,
      })),
    { text: "Cancel", style: "cancel" as const },
  ]);
}
