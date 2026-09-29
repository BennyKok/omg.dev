import MenuView, { type MenuAction } from "@expo/ui/community/menu";
import { type ReactNode, useState } from "react";
import { ActivityIndicator, Platform, Pressable, View } from "react-native";

import { Icon } from "../components";
import { Text } from "./text";
import { useTheme } from "./theme";

/**
 * Save lives in the system context menu: press and hold the picture or the
 * video, the way Photos and Messages offer it. It used to be a caption row
 * under every video, which read as clutter. The row now appears only while the
 * file is being pulled or after a failure, because a menu cannot show progress.
 *
 * iOS only: Android's Share ignores `url`, so it would share nothing.
 */
export function MediaMenu({ save, noun, testID, children }: {
  save: () => Promise<void>;
  /** "video" or "image", for the progress and failure row. */
  noun: string;
  testID: string;
  children: ReactNode;
}) {
  const { colors, type, space, isDark } = useTheme();
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  if (Platform.OS !== "ios") return <View style={{ alignSelf: "flex-start" }}>{children}</View>;
  const run = () => {
    if (state === "busy") return;
    setState("busy");
    save()
      .then(() => setState("idle"))
      .catch(() => setState("failed"));
  };
  const actions: MenuAction[] = [{ id: "save", title: "Save or Share", image: "square.and.arrow.up" }];
  const status = state === "busy" ? `Preparing ${noun}` : "Could not download. Try again";
  return (
    <View style={{ alignSelf: "flex-start", gap: space.xs }}>
      <MenuView
        actions={actions}
        shouldOpenOnLongPress
        colorScheme={isDark ? "dark" : "light"}
        onPressAction={({ nativeEvent }) => {
          if (nativeEvent.event === "save") run();
        }}
        testID={`${testID}-menu`}
      >
        <View
          accessibilityHint="Press and hold for options"
          accessibilityActions={[{ name: "save", label: "Save or Share" }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "save") run();
          }}
        >
          {children}
        </View>
      </MenuView>
      {state === "idle" ? null : (
        <Pressable
          onPress={run}
          disabled={state === "busy"}
          accessibilityRole="button"
          accessibilityLabel={status}
          testID={`${testID}-save-status`}
          hitSlop={8}
          style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: space.xs, paddingVertical: 2 }}
        >
          {state === "busy" ? (
            <ActivityIndicator size="small" color={colors.textMuted} />
          ) : (
            <Icon ios="exclamationmark.circle" android="error" size={14} color={colors.textMuted} />
          )}
          <Text style={{ ...type.caption, color: colors.textMuted }}>{status}</Text>
        </Pressable>
      )}
    </View>
  );
}
