import { type MenuAction } from "@expo/ui/community/menu";
import { HoldMenu } from "./hold-menu";
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
  const { colors, type, space } = useTheme();
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  if (Platform.OS !== "ios") return <View style={{ alignSelf: "flex-start" }}>{children}</View>;
  const run = () => {
    if (state === "busy") return;
    setState("busy");
    save()
      .then(() => setState("idle"))
      .catch(() => setState("failed"));
  };
  const status = state === "busy" ? `Preparing ${noun}` : "Could not download. Try again";
  return (
    <View style={{ alignSelf: "flex-start", gap: space.xs }}>
      <SaveMenu onSave={run} testID={`${testID}-menu`}>{children}</SaveMenu>
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

const ACTIONS: MenuAction[] = [{ id: "save", title: "Save or Share", image: "square.and.arrow.up" }];

/**
 * Just the press-and-hold menu, with no progress row. The full-screen viewer
 * uses this directly and shows its own status over the black backdrop. iOS
 * only; callers decide what Android gets.
 */
export function SaveMenu({ onSave, testID = "save-menu", children }: {
  onSave: () => void;
  testID?: string;
  children: ReactNode;
}) {
  const { isDark } = useTheme();
  return (
    <HoldMenu
      actions={ACTIONS}
      isDark={isDark}
      onAction={(id) => {
        if (id === "save") onSave();
      }}
      testID={testID}
    >
      <View
        accessibilityHint="Press and hold for options"
        accessibilityActions={[{ name: "save", label: "Save or Share" }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "save") onSave();
        }}
      >
        {children}
      </View>
    </HoldMenu>
  );
}
