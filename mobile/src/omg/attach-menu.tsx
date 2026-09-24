/**
 * The composer's "+" menu, drawn by the app instead of by SwiftUI.
 *
 * WHY NOT DropdownMenu. The "+" sits inside the composer's Liquid Glass
 * surface. On iOS 26 a system menu presented from inside a glass view morphs
 * THAT GLASS into the menu, so pressing "+" made the whole composer turn into
 * the Photo Library / Take Photo / Choose File list and vanish (reported with a
 * screenshot, 2026-09-24). The composer has to stay where it is while you pick.
 *
 * A transparent Modal with a small card anchored above the trigger does that:
 * nothing native is presented from the glass, so there is nothing to morph.
 * Tapping outside the card closes it. The rows are the same MenuOption list the
 * native menu took, so the picking in file-picker.ts is unchanged.
 */
import * as Haptics from "expo-haptics";
import { type SFSymbol } from "expo-symbols";
import { type ReactNode, useRef, useState } from "react";
import { type HostInstance, Modal, Platform, Pressable, useWindowDimensions, View } from "react-native";

import { Icon } from "../components";
import { type MenuOption } from "./menu";
import { Text } from "./text";
import { useTheme } from "./theme";

const CARD_WIDTH = 230;
const GAP = 8;
const EDGE = 12;

/** Material names for the few SF Symbols the attach rows use. */
const ANDROID: Record<string, string> = {
  "photo.on.rectangle": "photo-library",
  camera: "photo-camera",
  folder: "folder",
};

type Anchor = { x: number; y: number };

export function AttachMenuButton({
  options,
  size,
  children,
}: {
  options: MenuOption[];
  size: number;
  /** The "+" glyph. Pressing it opens the card. */
  children: ReactNode;
}) {
  const { colors, radius, type, isDark } = useTheme();
  const { width, height } = useWindowDimensions();
  const trigger = useRef<HostInstance>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const open = () => {
    trigger.current?.measureInWindow((x, y) => {
      void Haptics.selectionAsync();
      setAnchor({ x, y });
    });
  };
  const close = () => setAnchor(null);
  /**
   * The pick waits for the card to be GONE. The pickers present their own
   * view controller, and iOS refuses to present while this Modal is still
   * dismissing, so a pick fired straight from the row can silently do nothing.
   * `onDismiss` is iOS only; Android has no such race and runs it at once.
   */
  const pending = useRef<(() => void) | null>(null);
  const runPending = () => {
    const run = pending.current;
    pending.current = null;
    run?.();
  };

  const left = anchor
    ? Math.max(EDGE, Math.min(anchor.x, width - CARD_WIDTH - EDGE))
    : 0;
  const bottom = anchor ? height - anchor.y + GAP : 0;

  return (
    <>
      <Pressable
        ref={trigger}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel="Attach a file"
        testID="composer-attach"
        hitSlop={6}
        style={({ pressed }) => ({
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        {children}
      </Pressable>
      <Modal
        visible={!!anchor}
        transparent
        animationType="fade"
        onRequestClose={close}
        onDismiss={runPending}
        supportedOrientations={["portrait", "landscape"]}
      >
        {/* The backdrop is a SIBLING of the card, not its parent. A
            Pressable is one accessibility element on iOS, so wrapping the
            card in it hid every row from VoiceOver (and from Maestro). */}
        <View style={{ flex: 1 }}>
          <Pressable
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Close attach menu"
          />
          <View
            accessibilityRole="menu"
            style={{
              position: "absolute",
              left,
              bottom,
              width: CARD_WIDTH,
              borderRadius: radius.xl,
              borderCurve: "continuous",
              backgroundColor: colors.popover,
              paddingVertical: 6,
              shadowColor: "#000",
              shadowOpacity: isDark ? 0.5 : 0.18,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 8 },
              elevation: 8,
            }}
          >
            {options.map((option, index) => (
              <Pressable
                key={`${index}-${option.label}`}
                accessibilityRole="menuitem"
                accessibilityState={{ disabled: !!option.disabled }}
                disabled={option.disabled}
                onPress={() => {
                  void Haptics.selectionAsync();
                  pending.current = option.onPress ?? null;
                  close();
                  if (Platform.OS !== "ios") runPending();
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 14,
                  minHeight: 46,
                  paddingHorizontal: 18,
                  backgroundColor: pressed ? colors.cardPressed : "transparent",
                })}
              >
                {option.icon ? (
                  <Icon
                    ios={option.icon as SFSymbol}
                    android={(ANDROID[option.icon] ?? "add") as never}
                    size={20}
                    color={colors.text}
                  />
                ) : null}
                <Text style={{ ...type.body, color: colors.text }}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </>
  );
}
