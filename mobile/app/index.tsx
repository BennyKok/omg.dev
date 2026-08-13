/**
 * The session list — the app's home, matching the web Computer one-to-one:
 * the mark and a machine chip up top, WORKING/IDLE sections as dot + label +
 * count headers sitting on the page background, each session its own rounded
 * card, and a composer pinned to the bottom that actually starts sessions.
 *
 * The important behaviour here is not the list, it is `readiness`. A Computer
 * that is merely cold answers 425 while it resumes, and the whole point of
 * separating that from an error is that this screen must say "waking" rather
 * than "broken". Getting that wrong is the difference between a product that
 * feels asleep and one that feels dead.
 */

import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Reanimated, { useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated";
import { Text } from "../src/omg/text";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { OmgSession } from "@omg-dev/protocol";
import type { OmgConnectionStatus } from "@omg-dev/client";

import {
  EmptyState,
  HomeComposer,
  Icon,
  IconButton,
  PrimaryButton,
  SectionHeader,
  SessionCard,
  StatusDot,
} from "../src/components";
import { BrandMark } from "../src/omg/brand-mark";
import { useOmg } from "../src/omg/provider";
import { useToast } from "../src/omg/toast";
import { LIQUID_GLASS } from "../src/omg/glass";
import { SessionListSkeleton } from "../src/omg/skeleton";
import { useTheme } from "../src/omg/theme";
import { bindingLabel } from "../src/omg/format";
import { CLOUD_BINDING_ID } from "../src/omg/config";

/**
 * The agent a composer session launches on. Omitting `agent` from
 * POST /api/sessions/new makes the server pick "aisdk" (verified in
 * src/commands/serve.ts), so the avatar simply shows that default.
 */
const COMPOSER_AGENT = "aisdk";

export default function SessionsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors, isDark, type, space, radius } = useTheme();
  const { client, readiness, probe, bindingId, bindings, machinesLoading } = useOmg();

  const [sessions, setSessions] = useState<OmgSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (error) toast.show(error, { intent: "error" });
  }, [error, toast]);
  /**
   * Live-socket health. The SDK's statuses are connecting | live | reconnecting
   * | offline — there is no "connected", and comparing against that string made
   * the banner permanently true. Worse, subscribeConnection does NOT open the
   * socket (only subscribeTranscript does), so this screen sat at "connecting"
   * forever and told everyone their computer was reconnecting when nothing was
   * wrong. Only a genuine drop is worth saying out loud.
   */
  const [connection, setConnection] = useState<OmgConnectionStatus>("connecting");
  const [draft, setDraft] = useState("");
  const [starting, setStarting] = useState(false);

  const ready = readiness?.status === "ready";

  const load = useCallback(async () => {
    if (!client || !ready) return;
    setLoading(true);
    try {
      setSessions(await client.listSessions());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client, ready]);

  // Refresh when the tab regains focus rather than on a blind interval: the
  // live socket already pushes status, so polling only matters for the gap
  // while this screen was not on screen.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Surface a dropped socket without stealing the screen — the list is still
  // valid, it is just not updating.
  useEffect(() => {
    if (!client) return;
    return client.live.subscribeConnection((state) => setConnection(state.status));
  }, [client]);

  const currentBinding = useMemo(
    () => bindings.find((b) => b.id === bindingId) ?? null,
    [bindings, bindingId],
  );

  const machineName = currentBinding
    ? bindingLabel(currentBinding)
    : bindingId === CLOUD_BINDING_ID
      ? "Cloud computer"
      : "No computer";

  const working = sessions.filter((s) => s.busy);
  const idle = sessions.filter((s) => !s.busy);

  const openSession = (id: string | null) => {
    if (!id) return;
    void Haptics.selectionAsync();
    router.push(`/session/${id}`);
  };

  /**
   * The composer Start button. Same request the web's composer sends
   * (POST /api/sessions/new); `agent` is omitted so the box runs its default,
   * and `cwd` rides along when the paired machine reports a folder.
   */
  const startSession = useCallback(async () => {
    const prompt = draft.trim();
    if (!prompt || !client || starting) return;
    setStarting(true);
    try {
      const res = await client.transport.request<{ sessionId?: string }>("/api/sessions/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          cwd: currentBinding?.defaultFolder ?? undefined,
        }),
      });
      setDraft("");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
      if (res?.sessionId) router.push(`/session/${res.sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }, [client, currentBinding, draft, starting, load, router]);

  /**
   * The web's "Smart clear": archive every idle session in one request. Busy
   * sessions are never in the list, so nothing running is touched.
   */
  const smartClear = useCallback(() => {
    if (!client) return;
    const ids = idle.map((s) => s.sessionId).filter((id): id is string => !!id);
    if (!ids.length) return;
    Alert.alert(
      `Archive ${ids.length} idle session${ids.length === 1 ? "" : "s"}?`,
      "They can be resumed later.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await client.transport.request("/api/sessions/close-all", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ source: "live_clear_idle", scope: "idle", sessionIds: ids }),
                });
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            })();
          },
        },
      ],
    );
  }, [client, idle, load]);

  /**
   * The bar is the system's, not ours.
   *
   * This screen used to draw its own row — mark, machine chip, gear — because
   * KeyboardAvoidingView measures against its PARENT, so a native header would
   * have needed its height fed back as `keyboardVerticalOffset`. Moving the
   * keyboard to `useAnimatedKeyboard` removed that constraint entirely: the
   * lift is driven by the real keyboard frame and does not care what sits
   * above it. So the header is now a real UINavigationBar with the system
   * large title, which collapses on scroll, carries the system material, and
   * matches every other iOS app for free.
   *
   * Set here rather than in _layout.tsx because the right-hand items need this
   * screen's machine state, and the deps below are what keep them current.
   */
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerLargeTitle: true,
      title: "Sessions",
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <Pressable
            onPress={() => router.push("/computers")}
            accessibilityRole="button"
            accessibilityLabel={`Computer: ${machineName}. Change`}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <StatusDot busy={currentBinding?.online ?? false} size={7} />
            <Text
              numberOfLines={1}
              style={{ ...type.footnote, color: colors.textSecondary, maxWidth: 130 }}
            >
              {machineName}
            </Text>
          </Pressable>
          <IconButton
            ios="gearshape"
            android="settings"
            accessibilityLabel="Settings"
            onPress={() => router.push("/settings")}
            size={18}
            color={colors.textSecondary}
          />
        </View>
      ),
    });
  }, [navigation, router, machineName, currentBinding?.online, colors, type, space]);

  // Same UI-thread keyboard tracking as the session screen; see the note there
  // for why KeyboardAvoidingView cannot be made to feel right.
  const keyboard = useAnimatedKeyboard();
  const keyboardLift = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, keyboard.height.value - insets.bottom),
  }));

  return (
    <Reanimated.View style={[{ flex: 1 }, keyboardLift]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: space.xl }}
        keyboardShouldPersistTaps="handled"
        // Lets the system large title collapse into the bar on scroll, and
        // insets content below it instead of starting underneath.
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => {
              void probe();
              void load();
            }}
            tintColor={colors.textMuted}
          />
        }
      >
        {(connection === "reconnecting" || connection === "offline") && ready ? (
          <Text
            style={{
              ...type.caption,
              color: colors.warning,
              paddingHorizontal: space.lg,
              paddingTop: space.xs,
            }}
          >
            Reconnecting…
          </Text>
        ) : null}

        {/* Readiness owns the screen when the machine is not serving. */}
        {!bindingId ? (
          <EmptyState
            title="No computer selected"
            detail="Choose which computer this app should talk to."
            action={<PrimaryButton label="Choose a computer" onPress={() => router.push("/computers")} />}
          />
        ) : readiness?.status === "waking" ? (
          // Skeleton cards, not a spinner: the sessions that were here before
          // hibernation are coming back, not being discovered fresh, and the
          // shape of the list underneath the copy says so without a word
          // changing. See probe() in ../src/omg/provider.tsx for why this
          // state exists at all.
          <View style={{ gap: space.lg, paddingTop: space.xl }}>
            <View style={{ alignItems: "center", gap: space.xs, paddingHorizontal: space.xl }}>
              <Text style={{ ...type.callout, color: colors.textSecondary }}>Waking your computer…</Text>
              <Text style={{ ...type.footnote, color: colors.textMuted, textAlign: "center" }}>
                It hibernated to save resources. This usually takes a moment.
              </Text>
            </View>
            <SessionListSkeleton count={2} />
          </View>
        ) : readiness?.status === "agent-limit" ? (
          <EmptyState
            title="Too many agents running"
            detail={readiness.message}
            action={<PrimaryButton label="Try again" onPress={() => void probe()} />}
          />
        ) : readiness && readiness.status !== "ready" ? (
          <EmptyState
            title={
              readiness.status === "unavailable"
                ? "Your computer isn't responding"
                : "Couldn't open your computer"
            }
            detail={"message" in readiness ? readiness.message : undefined}
            action={
              <View style={{ gap: space.sm }}>
                <PrimaryButton label="Try again" onPress={() => void probe()} />
                <PrimaryButton
                  label="Choose another"
                  tone="quiet"
                  onPress={() => router.push("/computers")}
                />
              </View>
            }
          />
        ) : !readiness ? (
          // Nothing is known yet — not even whether the machine is awake.
          // This is the state on every cold open, so it gets the full list
          // skeleton rather than a spinner on an otherwise-blank screen.
          <SessionListSkeleton style={{ paddingTop: space.xl }} />
        ) : (
          <>
            {sessions.length === 0 && loading ? (
              // First fetch on this machine, nothing on screen to disturb.
              // Once `sessions` is non-empty, RefreshControl (pull-to-refresh)
              // is the loading affordance instead — real rows must never be
              // swapped out for skeletons under someone's thumb.
              <SessionListSkeleton style={{ paddingTop: space.xl }} />
            ) : sessions.length === 0 && !loading ? (
              <EmptyState
                title="No sessions yet"
                detail="Start one below and it shows up here."
              />
            ) : null}

            {working.length > 0 ? (
              <>
                <SectionHeader label="Working" count={working.length} dotColor={colors.brand} />
                <View style={{ gap: space.md }}>
                  {working.map((s, i) => (
                    <SessionCard
                      key={s.sessionId ?? i}
                      title={s.title || s.lastUserText || "Untitled session"}
                      subtitle={s.title ? s.lastUserText : null}
                      agent={s.agent ?? s.agentLabel}
                      busy
                      blocked={s.status === "blocked"}
                      onPress={() => openSession(s.sessionId)}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {idle.length > 0 ? (
              <>
                <SectionHeader
                  label="Idle"
                  count={idle.length}
                  dotColor={colors.success}
                  actionLabel="Smart clear"
                  onAction={smartClear}
                />
                <View style={{ gap: space.md }}>
                  {idle.map((s, i) => (
                    <SessionCard
                      key={s.sessionId ?? i}
                      title={s.title || s.lastUserText || "Untitled session"}
                      subtitle={s.title ? s.lastUserText : null}
                      agent={s.agent ?? s.agentLabel}
                      blocked={s.status === "blocked"}
                      onPress={() => openSession(s.sessionId)}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* The composer only makes sense against a serving machine; readiness
          states own the whole screen until then. */}
      {ready ? (
        <HomeComposer
          value={draft}
          onChangeText={setDraft}
          onStart={() => void startSession()}
          starting={starting}
          projectLabel={currentBinding ? bindingLabel(currentBinding) : null}
          agent={COMPOSER_AGENT}
          bottomInset={insets.bottom}
        />
      ) : null}
    </Reanimated.View>
  );
}
