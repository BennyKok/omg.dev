import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { PrimaryButton } from "../../src/components";
import { useOmg } from "../../src/omg/provider";
import { loadSessionArtifacts, type SessionArtifact } from "../../src/omg/session-artifacts";
import { Text } from "../../src/omg/text";
import { useTheme } from "../../src/omg/theme";
import { TranscriptEntry } from "../../src/omg/transcript";

export default function SessionArtifactsScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const { client } = useOmg();
  const { colors, type, space } = useTheme();
  const [items, setItems] = useState<SessionArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    setItems([]);
    setLoading(true);
    setError(false);
    if (!client) { setError(true); setLoading(false); return; }
    void loadSessionArtifacts(path => client.transport.request(path), sessionId, () => active)
      .then(result => { if (active) setItems(result); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, sessionId, revision]));
  return <View testID={sessionId ? "session-artifacts-screen" : "all-artifacts-screen"} style={{ flex: 1, backgroundColor: colors.bg }}>
    <Stack.Screen options={{ title: "Artifacts" }} />
      <FlatList contentInsetAdjustmentBehavior="automatic" data={items} keyExtractor={item => item.id}
        contentContainerStyle={{ padding: space.lg, gap: space.lg }}
        refreshing={loading && items.length > 0} onRefresh={() => setRevision(n => n + 1)}
        renderItem={({ item }) => <View>
          <TranscriptEntry message={item} />
          {!sessionId && item.sessionId ? <Pressable accessibilityRole="link" accessibilityLabel="Open chat"
            onPress={() => router.push(`/session/${encodeURIComponent(item.sessionId)}`)}
            style={({ pressed }) => ({ alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: space.sm, opacity: pressed ? 0.5 : 1 })}>
            <Text style={{ ...type.footnote, color: colors.textSecondary }}>Open chat ›</Text>
          </Pressable> : null}
        </View>}
        ListEmptyComponent={loading ? <ActivityIndicator accessibilityLabel="Loading artifacts" /> : <Text style={{ ...type.callout, color: colors.textMuted }}>{error ? "Artifacts could not load." : (sessionId ? "No artifacts in this session yet." : "No artifacts on this computer yet.")}</Text>}
        ListFooterComponent={error ? <PrimaryButton label="Try again" onPress={() => setRevision(n => n + 1)} /> : null}
      />
  </View>;
}
