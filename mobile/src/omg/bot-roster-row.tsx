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
 * same card shell, same 16h/10v padding and minHeight 60, same
 * `useListItemMotion`/`animateEntry` contract for cold-load list settling
 * (see the long note on that flag in auto-agent-card.tsx — Bots gets a
 * second independently-fetched section on a future combined home surface,
 * so the same suppression window will matter there too, even though this
 * screen is not that home surface yet).
 *
 * Working is one signal: the avatar's corner dot. The subtitle is the last
 * message preview only — no "Working —" prefix, no timestamp, no Disabled
 * pill, no chevron. A disabled bot dims the avatar, not the card.
 *
 * The avatar itself is the one deliberate departure from SessionCard: it
 * carries the real rasterised mascot (shape + colorway, bot-avatar.tsx) on a
 * rounded-square plate rather than SessionCard's circular AgentAvatar — see
 * bot-avatar.tsx's own doc comment for why that shape break has to survive
 * even as everything else here converges on SessionCard's shell.
 */

import { View } from "react-native";
import Reanimated from "react-native-reanimated";

import { Text } from "./text";
import { BotAvatar } from "./bot-avatar";
import { PressableScale, useListItemMotion } from "./motion";
import { useTheme } from "./theme";
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
        })}
      >
        <View style={disabled ? { opacity: 0.45 } : undefined}>
          <BotAvatar shape={bot.shape} colorway={bot.colorway} size={28} working={!disabled && !!working} />
        </View>

        <View style={{ flex: 1, gap: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{
              ...type.callout,
              fontWeight: "600",
              color: colors.text,
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
            {preview}
          </Text>
        </View>
      </PressableScale>
    </Reanimated.View>
  );
}
