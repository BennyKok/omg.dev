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

import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "../../src/omg/text";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { OmgSession } from "@omg-dev/protocol";
import type { OmgConnectionStatus } from "@omg-dev/client";

import {
  EmptyState,
  HomeComposer,
  Icon,
  PrimaryButton,
  SectionHeader,
  SessionCard,
  StatusDot,
} from "../../src/components";
import { BrandMark } from "../../src/omg/brand-mark";
import { useOmg } from "../../src/omg/provider";
import { LIQUID_GLASS } from "../../src/omg/glass";
import { useTheme } from "../../src/omg/theme";
import { bindingLabel } from "../../src/omg/format";
import { CLOUD_BINDING_ID } from "../../src/omg/config";

/**
 * The agent a composer session launches on. Omitting `agent` from
 * POST /api/sessions/new makes the server pick "aisdk" (verified in
 * src/commands/serve.ts), so the avatar simply shows that default.
 */
const COMPOSER_AGENT = "aisdk";

export default function SessionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark, type, space, radius } = useTheme();
  const { client, readiness, probe, bindingId, bindings, machinesLoading } = useOmg();

  const [sessions, setSessions] = useState<OmgSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: space.xl }}
        keyboardShouldPersistTaps="handled"
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
        {/* Top bar: the mark on the left, the machine chip on the right. The
            chip is also the machine picker link. */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingTop: insets.top + space.sm,
            paddingHorizontal: space.lg,
            paddingBottom: space.xs,
          }}
        >
          <BrandMark size={30} />
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => router.push("/computers")}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              // Glass reads as floating chrome, which is what this chip is.
              backgroundColor: LIQUID_GLASS ? "transparent" : colors.card,
              borderRadius: radius.pill,
              overflow: "hidden",
              height: 34,
              paddingHorizontal: space.md,
              opacity: pressed ? 0.6 : 1,
              borderWidth: isDark ? StyleSheet.hairlineWidth : 0,
              borderColor: colors.borderSoft,
            })}
          >
            <StatusDot busy={currentBinding?.online ?? false} size={7} />
            <Text
              numberOfLines={1}
              style={{ ...type.footnote, color: colors.textSecondary, maxWidth: 160 }}
            >
              {machineName}
            </Text>
            {machinesLoading ? (
              <ActivityIndicator size="small" color={colors.textMuted} />
            ) : (
              <Icon ios="chevron.down" android="keyboard_arrow_down" size={11} color={colors.textMuted} />
            )}
          </Pressable>
        </View>

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
          <View style={{ alignItems: "center", paddingVertical: space.xxl * 2, gap: space.md }}>
            <ActivityIndicator color={colors.textMuted} />
            <Text style={{ ...type.callout, color: colors.textSecondary }}>Waking your computer…</Text>
            <Text style={{ ...type.footnote, color: colors.textMuted, textAlign: "center", paddingHorizontal: space.xl }}>
              It hibernated to save resources. This usually takes a moment.
            </Text>
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
          <View style={{ paddingVertical: space.xxl }}>
            <ActivityIndicator color={colors.textMuted} />
          </View>
        ) : (
          <>
            {error ? (
              <Text style={{ ...type.footnote, color: colors.danger, paddingHorizontal: space.lg, paddingTop: space.sm }}>
                {error}
              </Text>
            ) : null}

            {sessions.length === 0 && !loading ? (
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
    </KeyboardAvoidingView>
  );
}
