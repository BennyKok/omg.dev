/**
 * The session list — the app's home.
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
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { OmgSession } from "@omg-dev/protocol";

import { Card, EmptyState, PrimaryButton, SectionLabel, Separator, SessionRow, StatusDot } from "../../src/components";
import { useOmg } from "../../src/omg/provider";
import { useTheme } from "../../src/omg/theme";
import { bindingLabel } from "../../src/omg/format";
import { CLOUD_BINDING_ID } from "../../src/omg/config";

export default function SessionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, type, space, radius } = useTheme();
  const { client, readiness, probe, bindingId, bindings, machinesLoading } = useOmg();

  const [sessions, setSessions] = useState<OmgSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [connection, setConnection] = useState<string>("connected");

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) =>
      [s.title, s.lastUserText, s.agent].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [sessions, query]);

  const working = filtered.filter((s) => s.busy);
  const idle = filtered.filter((s) => !s.busy);

  const openSession = (id: string | null) => {
    if (!id) return;
    void Haptics.selectionAsync();
    router.push(`/session/${id}`);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: space.xxl * 2 }}
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
      {/* Which computer am I on — and a way to change it. */}
      <Pressable
        onPress={() => router.push("/computers")}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.lg,
          paddingVertical: space.sm,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <StatusDot busy={currentBinding?.online ?? false} />
        <Text style={{ ...type.footnote, color: colors.textMuted }}>{machineName}</Text>
        <Text style={{ ...type.footnote, color: colors.primary }}>Change</Text>
        {machinesLoading ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
      </Pressable>

      <Text style={{ ...type.largeTitle, color: colors.text, paddingHorizontal: space.lg }}>
        Sessions
      </Text>

      {connection !== "connected" && ready ? (
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
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search sessions"
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
              style={{
                backgroundColor: colors.card,
                borderRadius: radius.md,
                paddingHorizontal: space.md,
                height: 38,
                color: colors.text,
                ...type.callout,
              }}
            />
          </View>

          {error ? (
            <Text style={{ ...type.footnote, color: colors.danger, paddingHorizontal: space.lg, paddingTop: space.sm }}>
              {error}
            </Text>
          ) : null}

          {sessions.length === 0 && !loading ? (
            <EmptyState
              title="No sessions yet"
              detail="Start one from omg on the web, and it shows up here."
            />
          ) : null}

          {working.length > 0 ? (
            <>
              <SectionLabel>{`Working · ${working.length}`}</SectionLabel>
              <Card>
                {working.map((s, i) => (
                  <View key={s.sessionId ?? i}>
                    {i > 0 ? <Separator inset={space.lg} /> : null}
                    <SessionRow
                      title={s.title || s.lastUserText || "Untitled session"}
                      subtitle={s.title ? s.lastUserText : null}
                      agent={s.agent}
                      busy
                      blocked={s.status === "blocked"}
                      lastActivityAt={s.lastActivityAt}
                      onPress={() => openSession(s.sessionId)}
                    />
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {idle.length > 0 ? (
            <>
              <SectionLabel>{`Idle · ${idle.length}`}</SectionLabel>
              <Card>
                {idle.map((s, i) => (
                  <View key={s.sessionId ?? i}>
                    {i > 0 ? <Separator inset={space.lg} /> : null}
                    <SessionRow
                      title={s.title || s.lastUserText || "Untitled session"}
                      subtitle={s.title ? s.lastUserText : null}
                      agent={s.agent}
                      blocked={s.status === "blocked"}
                      lastActivityAt={s.lastActivityAt}
                      onPress={() => openSession(s.sessionId)}
                    />
                  </View>
                ))}
              </Card>
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
