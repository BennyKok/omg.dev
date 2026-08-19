/**
 * One bot, as a roster row — the Bots screen's equivalent of SessionCard.
 *
 * WHY A BORDERED CARD, NOT THE WEB'S FLAT ROW. The web's mobile roster
 * (`MOBILE_BOT_ROSTER_ROW_CLASS`, web/src/lib/mobile-bots-nav.ts) is a flat
 * hover row with no border — it deliberately matches the desktop RAIL's list
 * item shell, because on web the roster sits right next to that rail. This
 * app has no rail. Its own home list (SessionCard, components.tsx) tried the
 * flat/grouped-list shape first and moved to a bordered card per row after
 * real on-device testing — see the long comment on SessionCard for why: "a
 * session IS a separate object... the list is short enough that it was never
 * a scanning problem." A bot is the same kind of object (its own identity,
 * its own state), so it gets the app's own established row shape rather than
 * importing the web's, which was tuned for a different navigation context.
 *
 * Otherwise this mirrors AutoFindingCard/SessionCard closely on purpose:
 * same card shell, same avatar-left/text-middle/state-right anatomy, same
 * `useListItemMotion`/`animateEntry` contract for cold-load list settling
 * (see the long note on that flag in auto-agent-card.tsx — Bots gets a
 * second independently-fetched section on a future combined home surface,
 * so the same suppression window will matter there too, even though this
 * screen is not that home surface yet).
 */

import { View } from "react-native";
import Reanimated from "react-native-reanimated";

import { Icon } from "../components";
import { Text } from "./text";
import { BotAvatar } from "./bot-avatar";
import { PressableScale, useListItemMotion } from "./motion";
import { useTheme } from "./theme";
import { relativeTime } from "./format";
import { botPreviewText, type Bot } from "./bots";

export function BotRosterRow({
  bot,
  working,
  onPress,
  animateEntry = true,
}: {
  bot: Bot;
  /** Whether the bot's backing session is currently busy. */
  working?: boolean;
  onPress: () => void;
  /** See the identical prop on SessionCard/AutoFindingCard for why. */
  animateEntry?: boolean;
}) {
  const { colors, radius, type, space } = useTheme();
  const listMotion = useListItemMotion();
  const disabled = !bot.enabled;

  const preview = botPreviewText(bot);

  return (
    <Reanimated.View
      entering={animateEntry ? listMotion.entering : undefined}
      layout={animateEntry ? listMotion.layout : undefined}
    >
      <PressableScale
        onPress={onPress}
        scale={0.97}
        accessibilityRole="button"
        accessibilityLabel={`${bot.name}${disabled ? ", disabled" : ""}`}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          marginHorizontal: space.lg,
          paddingHorizontal: space.lg,
          paddingVertical: 10,
          minHeight: 60,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: colors.borderStrong,
          backgroundColor: pressed ? colors.cardPressed : colors.card,
          opacity: disabled ? 0.7 : 1,
        })}
      >
        <View style={disabled ? { opacity: 0.45 } : undefined}>
          <BotAvatar colorway={bot.colorway} size={44} working={!disabled && !!working} />
        </View>

        <View style={{ flex: 1, gap: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{
              ...type.callout,
              fontWeight: "600",
              color: disabled ? colors.textMuted : colors.text,
            }}
          >
            {bot.name}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              ...type.caption,
              fontWeight: "400",
              color: colors.textMuted,
            }}
          >
            {disabled ? preview : working ? `Working — ${preview}` : preview}
          </Text>
        </View>

        {bot.lastMessageAt ? (
          <Text
            style={{
              ...type.caption,
              fontSize: 10,
              fontVariant: ["tabular-nums"],
              color: colors.textMuted,
              opacity: 0.7,
            }}
          >
            {relativeTime(bot.lastMessageAt)}
          </Text>
        ) : null}

        {disabled ? (
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 999,
              backgroundColor: colors.secondary,
            }}
          >
            <Text style={{ ...type.caption, fontSize: 10, color: colors.textMuted }}>Disabled</Text>
          </View>
        ) : null}

        <Icon ios="chevron.right" android="chevron_right" size={14} color={colors.textMuted} />
      </PressableScale>
    </Reanimated.View>
  );
}
