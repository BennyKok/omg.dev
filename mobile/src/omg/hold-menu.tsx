import MenuView, { type MenuAction } from "@expo/ui/community/menu";
import Constants from "expo-constants";
import type { ReactNode } from "react";
import { ActionSheetIOS, Pressable, type StyleProp, type ViewStyle } from "react-native";

/**
 * TestFlight binaries up to build 84 crash in `ExpoViewShadowNode::layout`
 * when a MenuView trigger is laid out: MenuView hosts its child in SwiftUI
 * through `RNHostView matchContents`, and the prebuilt expo-modules-core in
 * those binaries frees the hosted child while it still reads it. Every
 * message in the transcript sat in one, so a long transcript crashed often
 * (five reports on 2026-09-30 alone). The fix is native (the expo-modules-core
 * patch in `patches/`), so only a newer binary has it.
 *
 * On an affected binary the same actions open from a plain long press as an
 * action sheet, which involves no hosted view. Local builds report build
 * number 1 and carry the fix, so they are not counted as affected.
 */
const LAST_AFFECTED_BUILD = 84;
const buildNumber = Number(Constants.platform?.ios?.buildNumber ?? NaN);
export const NATIVE_HOLD_MENU_SAFE = !(buildNumber > 1 && buildNumber <= LAST_AFFECTED_BUILD);

/** A press-and-hold menu. The native context menu where it is safe, an action sheet where it is not. */
export function HoldMenu({ actions, onAction, isDark, style, testID, children }: {
  actions: MenuAction[];
  onAction: (id: string) => void;
  isDark: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children: ReactNode;
}) {
  if (NATIVE_HOLD_MENU_SAFE) {
    return (
      <MenuView
        actions={actions}
        shouldOpenOnLongPress
        colorScheme={isDark ? "dark" : "light"}
        style={style}
        testID={testID}
        onPressAction={({ nativeEvent }) => onAction(nativeEvent.event)}
      >
        {children}
      </MenuView>
    );
  }
  const open = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...actions.map((action) => action.title), "Cancel"],
        cancelButtonIndex: actions.length,
        userInterfaceStyle: isDark ? "dark" : "light",
      },
      (index) => {
        const action = actions[index];
        // MenuView reports `id`, which defaults to `title`.
        if (action) onAction(action.id ?? action.title);
      },
    );
  };
  return (
    <Pressable onLongPress={open} delayLongPress={350} style={style} testID={testID}>
      {children}
    </Pressable>
  );
}
