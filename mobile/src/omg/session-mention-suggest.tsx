/**
 * The "#" popup above a composer: type a hash and relevant sessions appear,
 * the box's own folder first, then keyword matches on title, last prompt and
 * project; tap one and it replaces the "#word" with a session reference, the
 * way the web composer does.
 *
 * Rendered IN FLOW above the field, like SkillSuggest, so the composer's own
 * height measurement already accounts for it and nothing is covered. All
 * behaviour lives in `createSessionMentionPicker`; this file only draws.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Reanimated, { FadeIn, FadeOut } from "react-native-reanimated";

import { GlassSurface } from "./glass";
import { PressableScale } from "./motion";
import { useOmg } from "./provider";
import {
  applySessionMention,
  createSessionMentionPicker,
  fetchMentionableSessions,
  sessionFolderName,
  type SessionMentionScope,
} from "./session-mention";
import { Text } from "./text";
import { useTheme } from "./theme";

export function SessionMentionSuggest({
  value,
  onChangeText,
  scope,
  disabled = false,
}: {
  value: string;
  /** Receives the whole new draft with the reference inserted. */
  onChangeText: (next: string) => void;
  scope?: SessionMentionScope;
  /** Closed while the field is not editable (a live dictation take). */
  disabled?: boolean;
}) {
  const { client } = useOmg();
  const { colors, type, space, radius } = useTheme();
  // One controller per client: a machine switch disposes the old one, so a
  // late answer from the previous box can never be shown for the new one.
  const picker = useMemo(
    () =>
      createSessionMentionPicker({
        fetch: (query, s) =>
          client
            ? fetchMentionableSessions(client, query, s)
            : Promise.reject(new Error("no machine")),
      }),
    [client],
  );
  useEffect(() => () => picker.dispose(), [picker]);
  const scopeCwd = scope?.cwd ?? null;
  const scopeSid = scope?.sessionId ?? null;
  // The caret is taken to be at the end, as SkillSuggest does: RN's
  // selection events lag a keystroke.
  useEffect(() => {
    picker.update({ value, scope: { cwd: scopeCwd, sessionId: scopeSid }, disabled });
  }, [picker, value, scopeCwd, scopeSid, disabled]);
  const { active, items } = useSyncExternalStore(picker.subscribe, picker.getState, picker.getState);

  if (!active || !items.length) return null;

  return (
    <Reanimated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(100)}>
      <GlassSurface
        variant="regular"
        fallbackColor={colors.popover}
        style={{
          borderRadius: radius.xl,
          overflow: "hidden",
          marginBottom: space.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.borderSoft,
        }}
      >
        <ScrollView
          keyboardShouldPersistTaps="always"
          style={{ maxHeight: 220 }}
          contentContainerStyle={{ padding: 4 }}
        >
          {items.map((session, index) => {
            const folder = sessionFolderName(session.cwd) || session.project;
            const label = session.title || session.sessionId.slice(0, 8);
            return (
              <PressableScale
                key={session.sessionId}
                onPress={() => onChangeText(applySessionMention(value, active, session))}
                dim={0.6}
                accessibilityRole="button"
                accessibilityLabel={`Reference session ${label}`}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                  paddingHorizontal: space.md,
                  paddingVertical: 8,
                  borderRadius: radius.md,
                  backgroundColor: index === 0 ? colors.card : "transparent",
                }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: session.live ? colors.brand : colors.textMuted,
                    opacity: session.live ? 1 : 0.4,
                  }}
                />
                <View style={{ flex: 1, flexDirection: "row", alignItems: "baseline", minWidth: 0 }}>
                  <Text style={{ ...type.subhead, fontWeight: "600", color: colors.brand }}>#</Text>
                  <Text
                    numberOfLines={1}
                    style={{ ...type.subhead, fontWeight: "600", color: colors.text, flexShrink: 1 }}
                  >
                    {label}
                  </Text>
                </View>
                {folder ? (
                  <Text
                    numberOfLines={1}
                    style={{
                      ...type.footnote,
                      color: session.sameFolder ? colors.brand : colors.textMuted,
                      maxWidth: 120,
                    }}
                  >
                    {folder}
                  </Text>
                ) : null}
              </PressableScale>
            );
          })}
        </ScrollView>
      </GlassSurface>
    </Reanimated.View>
  );
}
