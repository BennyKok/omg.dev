/**
 * Bots roster — persistent agents you talk to, not tasks you launch.
 *
 * Phase 1 native port of the web's Bots page (docs/design/bot-mode/spec.md
 * §3, superseded in the details noted in bot-avatar.tsx and bot-roster-row.tsx
 * by the shipped web implementation this mirrors instead:
 * web/src/App.tsx's `BotsView` roster branch, web/src/lib/mobile-bots-nav.ts).
 *
 * NAVIGATION: REACHED BY A HEADER ICON BUTTON, NOT A RAIL TOGGLE.
 *
 * The spec's navigation section (§0.2-0.3, §2) is written entirely against
 * web furniture this app does not have — `PagesMenu`'s dropdown radio group
 * and a `Sessions | Chat` segmented toggle stacked in a left rail header.
 * This app has neither a rail nor a page-switcher menu: app/index.tsx already
 * reaches every cross-cutting destination (Notifications, Computers,
 * Settings) through a plain icon button in the home screen's nav bar that
 * pushes a full screen — bell -> /notifications, monitor -> the computer
 * picker, gear -> /settings. That is the app's own established idiom for
 * "a surface next to sessions, one tap away," and it already solves the
 * exact problem the web's toggle exists for (a persistent, always-visible
 * way to switch), so Bots gets the same treatment: a lucide `bot` glyph
 * button next to the existing three, pushing this screen. See app/index.tsx.
 *
 * Master-detail lives under the same route family the web uses (`/bots`
 * roster, `/bots/[id]` chat) rather than two unrelated tabs — mirrors how
 * `session/[id]` nests under the sessions surface. `[id].tsx` is the next
 * phase (bot chat); this file is the roster half only.
 *
 * "+ New bot" is visually present (both the header action and, empty-roster
 * only, the dashed row — §3.4) because leaving the roster's own create
 * affordance out would read as broken chrome, not as scope control. Tapping
 * either is a placeholder toast until the New/Edit Bot sheet exists — see
 * the PR description for why that sheet and bot chat are both held for a
 * separate steer.
 */

import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import type { OmgSession } from "@omg-dev/protocol";

import { EmptyState, Icon, IconButton } from "../../src/components";
import { PressableScale } from "../../src/omg/motion";
import { Text } from "../../src/omg/text";
import { useTheme } from "../../src/omg/theme";
import { useToast } from "../../src/omg/toast";
import { useOmg } from "../../src/omg/provider";
import { useBots, type Bot } from "../../src/omg/bots";
import { BotRosterRow } from "../../src/omg/bot-roster-row";

/** A session carries `botId` once it is bot-driven — see bot-mode-design.md's
 * `Session` type extension. Not yet in @omg-dev/protocol's OmgSession, same
 * situation as `nativeSessionId` in app/index.tsx, so it is read off the
 * wire value with a narrow cast rather than left untyped. */
type BotDrivenSession = OmgSession & { botId?: string; busy?: boolean };

export default function BotsScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const { colors, type, space } = useTheme();
  const { client } = useOmg();
  const toast = useToast();

  const { bots, loading, refresh } = useBots();
  const [pulling, setPulling] = useState(false);

  // Which bots are working right now, cross-referenced from the live
  // sessions list the same way the web does (`busyBySid` keyed through
  // `session.botId` in BotsView). A bot with no live session is simply not
  // in this set, which is the correct "idle" answer whether it has never
  // been messaged or its backing session just is not running at the moment.
  const [busyBotIds, setBusyBotIds] = useState<Set<string>>(new Set());
  const loadBusy = useCallback(async () => {
    if (!client) return;
    try {
      const sessions = (await client.listSessions()) as BotDrivenSession[];
      setBusyBotIds(new Set(sessions.filter((s) => s.busy && s.botId).map((s) => s.botId!)));
    } catch {
      // A failed poll leaves the previous working-state read rather than
      // wiping every dot — the roster itself still renders.
    }
  }, [client]);

  useFocusEffect(
    useCallback(() => {
      void loadBusy();
      const timer = setInterval(() => void loadBusy(), 10_000);
      return () => clearInterval(timer);
    }, [loadBusy]),
  );

  // Same cold-load settle window as SessionCard/AutoFindingCard — see the
  // long note on `animateEntry` in auto-agent-card.tsx. This screen fetches
  // bots and sessions independently, the same shape of race that motivated
  // that fix on the home screen.
  const mountedAtRef = useRef(Date.now());
  const COLD_LOAD_WINDOW_MS = 3500;
  const animateEntry = Date.now() - mountedAtRef.current >= COLD_LOAD_WINDOW_MS;

  const openBot = (bot: Bot) => {
    // TODO(bot chat): route to /bots/[id] once that screen exists.
    void bot;
    toast.show("Bot chat is coming soon.");
  };

  const createBot = () => {
    // TODO(New/Edit Bot sheet): open the create sheet once it exists.
    toast.show("Creating bots is coming soon.");
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "Bots",
      headerLargeTitle: true,
      headerRight: () => (
        <IconButton
          ios="plus"
          android="add"
          accessibilityLabel="New bot"
          onPress={createBot}
          size={20}
          color={colors.primary}
        />
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, colors]);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: space.xxl }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          onRefresh={() => {
            setPulling(true);
            refresh();
            void Promise.all([loadBusy()]).finally(() => setPulling(false));
          }}
          tintColor={colors.textMuted}
        />
      }
    >
      <Text
        style={{
          ...type.footnote,
          color: colors.textMuted,
          paddingHorizontal: space.lg,
          paddingTop: space.xs,
          paddingBottom: space.md,
        }}
      >
        Persistent agents you talk to, not tasks you launch.
      </Text>

      {bots.length === 0 && loading ? null : bots.length === 0 ? (
        <>
          <EmptyState
            title="No bots yet"
            detail="Give a persona a name and a memory — it'll be there next time you open this."
          />
          <PressableScale
            onPress={createBot}
            scale={0.98}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: space.sm,
              marginHorizontal: space.lg,
              marginTop: space.sm,
              paddingVertical: space.md,
              borderRadius: 18,
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: colors.borderStrong,
            }}
          >
            <Icon ios="plus" android="add" size={14} color={colors.textMuted} />
            <Text style={{ ...type.subhead, color: colors.textMuted }}>New bot</Text>
          </PressableScale>
        </>
      ) : (
        <View style={{ gap: space.sm }}>
          {bots.map((bot) => (
            <BotRosterRow
              key={bot.id}
              bot={bot}
              working={busyBotIds.has(bot.id)}
              onPress={() => openBot(bot)}
              animateEntry={animateEntry}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
