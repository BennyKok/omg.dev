import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, withAlpha } from "../components";
import { EdgeFade, TOP_FADE_HEIGHT } from "./edge-fade";
import { GlassSurface } from "./glass";
import { DropdownMenu, type MenuOption } from "./menu";
import { useTheme } from "./theme";

/**
 * One size for every item in a chat bar: the back disc, the overflow disc and
 * the composer's attach button are the same class of control.
 */
export const CHAT_BAR_ITEM = 44;

function Disc({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <GlassSurface
      variant="clear"
      fallbackColor={colors.card}
      style={{
        width: CHAT_BAR_ITEM,
        height: CHAT_BAR_ITEM,
        borderRadius: CHAT_BAR_ITEM / 2,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {children}
    </GlassSurface>
  );
}

/**
 * THE CHAT PAGE'S BAR: a back disc, the identity in the middle, and the
 * overflow menu on its own disc. One owner for the session chat and a thread.
 *
 * Drawn by the screen, not the navigator (see the session screen for why the
 * native bar could not hold 44pt items). It floats over the content with a
 * fade under it; the screen reserves `chatHeaderHeight(insets.top)` above
 * its first row.
 */
export function ChatHeaderBar({
  onBack,
  menuOptions,
  menuLabel,
  children,
}: {
  onBack: () => void;
  menuOptions: MenuOption[];
  /** What VoiceOver calls the overflow button, e.g. "Session actions". */
  menuLabel: string;
  /** The identity: avatar, title and subtitle. It takes the remaining width. */
  children: ReactNode;
}) {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <>
      <EdgeFade
        edge="top"
        color={colors.bg}
        style={{
          position: "absolute",
          top: insets.top + CHAT_BAR_ITEM + space.xs,
          left: 0,
          right: 0,
          height: TOP_FADE_HEIGHT,
          opacity: 0.85,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          paddingTop: insets.top,
          paddingHorizontal: space.md,
          paddingBottom: space.xs,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          backgroundColor: withAlpha(colors.bg, 0.85),
        }}
      >
        <Disc>
          <Pressable
            testID="chat-header-back"
            onPress={onBack}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => ({
              width: CHAT_BAR_ITEM,
              height: CHAT_BAR_ITEM,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Icon ios="chevron.backward" android="arrow_back" size={17} color={colors.text} />
          </Pressable>
        </Disc>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.sm }}>{children}</View>
        {menuOptions.length ? (
          <Disc>
            <DropdownMenu options={menuOptions} style={{ width: CHAT_BAR_ITEM, height: CHAT_BAR_ITEM }}>
              <View
                testID="chat-header-menu"
                accessibilityRole="button"
                accessibilityLabel={menuLabel}
                style={{ width: CHAT_BAR_ITEM, height: CHAT_BAR_ITEM, alignItems: "center", justifyContent: "center" }}
              >
                {/* Three dots, not ellipsis.circle: the disc is already the circle. */}
                <Icon ios="ellipsis" android="more_horiz" size={20} color={colors.text} />
              </View>
            </DropdownMenu>
          </Disc>
        ) : null}
      </View>
    </>
  );
}

/** How much room the bar takes at the top of the screen. */
export function chatHeaderHeight(insetTop: number, gap = 4): number {
  return insetTop + CHAT_BAR_ITEM + gap;
}
