import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { PrimaryButton } from "../../src/components";
import { useOmg } from "../../src/omg/provider";
import { loadSessionArtifacts, type SessionArtifact } from "../../src/omg/session-artifacts";
import { Text } from "../../src/omg/text";
import { useTheme } from "../../src/omg/theme";
import { TranscriptEntry } from "../../src/omg/transcript";

export default function SessionArtifactsScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
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
    if (!client || !sessionId) { setError(true); setLoading(false); return; }
    void loadSessionArtifacts(path => client.transport.request(path), sessionId, () => active)
      .then(result => { if (active) setItems(result); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, sessionId, revision]));
  return <View testID="session-artifacts-screen" style={{ flex: 1, backgroundColor: colors.bg }}>
    <Stack.Screen options={{ title: "Artifacts" }} />
      <FlatList contentInsetAdjustmentBehavior="automatic" data={items} keyExtractor={item => item.id}
        contentContainerStyle={{ padding: space.lg, gap: space.lg }}
        refreshing={loading} onRefresh={() => setRevision(n => n + 1)}
        renderItem={({ item }) => <TranscriptEntry message={item} />}
        ListEmptyComponent={loading ? <ActivityIndicator accessibilityLabel="Loading artifacts" /> : <Text style={{ ...type.callout, color: colors.textMuted }}>{error ? "Artifacts could not load." : "No artifacts in this session yet."}</Text>}
        ListFooterComponent={error ? <PrimaryButton label="Try again" onPress={() => setRevision(n => n + 1)} /> : null}
      />
  </View>;
}
