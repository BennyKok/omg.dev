/**
 * A bot's chat — the missing half of Bot Mode on this app.
 *
 * The roster, the mascot avatars and the full-page create/edit flow already
 * shipped (feat/mobile-omg-foundation); tapping a roster row opened edit,
 * which app/bots/index.tsx's own doc comment called a truthful stand-in for
 * a screen that did not exist yet ("you can at least see and change what you
 * made"). This is that screen. The roster row now opens HERE instead — see
 * the change to app/bots/index.tsx's `openBot` — and edit moves to a header
 * action reached from inside the chat (the "Edit bot" overflow item added to
 * SessionScreenBody's bot-mode menu).
 *
 * NOT A NEW TRANSCRIPT COMPONENT. A bot's `sessionId` is a normal managed
 * session (see src/commands/serve.ts's `POST /api/bots/:id/messages`), so
 * this mounts the exact same session screen every other session uses
 * (app/session/[id].tsx's `SessionScreenBody`), passing it `bot` (swaps the
 * header identity, hides fork/close, adds "Edit bot", bubbles the bot's
 * turns) and `onDeliver` (routes the composer's send through the bot
 * endpoint instead of the plain session send/resume path). Everything else —
 * streaming, the composer, load-more, dictation, attachments — is the same
 * code a normal session runs, unmodified.
 *
 * OWNS THE RESOLVED SESSION ID AS ITS OWN STATE, seeded from the bot record
 * and updated once the first message mints (or reattaches) a backing
 * session. `SessionScreenBody` reacts to that the same way it already reacts
 * to a route's `id` changing — no new mechanism, see its own doc comment.
 * The URL stays `/bots/<botId>` the whole time: a bot chat's address names
 * the bot, not whichever session happens to be its current backing process.
 */

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { SessionScreenBody } from "../../session/[id]";
import { useBots, sendBotMessage } from "../../../src/omg/bots";
import { useOmg } from "../../../src/omg/provider";
import { useTheme } from "../../../src/omg/theme";

export default function BotChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { client } = useOmg();
  const { bots, loading } = useBots();
  const bot = bots.find((b) => b.id === id) ?? null;

  // The chat's own source of truth for which session it is showing — seeded
  // from the bot record, then advanced in place by `deliver` below. Not read
  // from `bot.sessionId` on every render: a background roster refetch must
  // not yank the open chat to a stale id, the same reasoning EditBotScreen's
  // `initial` ref gives for not re-seeding from a live-refetched `bot`.
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  useEffect(() => {
    if (!bot || seededFor === bot.id) return;
    setChatSessionId(bot.sessionId ?? null);
    setSeededFor(bot.id);
  }, [bot, seededFor]);

  const deliver = useCallback(
    async (text: string, mode: "steer" | "queue") => {
      if (!client || !bot) return undefined;
      const result = await sendBotMessage(client, bot.id, text, mode);
      if (result?.sessionId) setChatSessionId(result.sessionId);
      return result;
    },
    [client, bot],
  );

  // Same reasoning as app/bots/[id]/edit.tsx: a spinner for the brief window
  // before the roster's own fetch resolves, never a chat screen for a bot
  // that does not exist.
  if (!bot) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        {loading ? <ActivityIndicator color={colors.textMuted} /> : null}
      </View>
    );
  }

  return <SessionScreenBody sessionId={chatSessionId} bot={bot} onDeliver={deliver} />;
}
