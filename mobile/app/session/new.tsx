import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOmg } from "../../src/omg/provider";
import { getPendingSession } from "../../src/omg/pending-session";
import { Text } from "../../src/omg/text";
import { useTheme } from "../../src/omg/theme";

export default function NewSessionScreen() {
  const { request } = useLocalSearchParams<{ request: string }>();
  const { user, bindingId } = useOmg();
  const pending = getPendingSession(request ?? "", `${user?.id}:${bindingId}`);
  const router = useRouter();
  const { colors, type, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!pending) return;
    let active = true;
    pending.result.then((id) => {
      if (active) router.replace(`/session/${id}`);
    }).catch((failure) => {
      if (active) setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => { active = false; };
  }, [pending, router]);
  return <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
    <Stack.Screen options={{ headerShown: false, animation: "none" }} />
    <View style={{ padding: space.lg, flexDirection: "row", alignItems: "center", gap: space.lg }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()}>
        <Text style={{ ...type.body, color: colors.text }}>Back</Text>
      </Pressable>
      <Text style={{ ...type.headline, color: colors.text }}>New conversation</Text>
    </View>
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      {pending ? <View style={{ padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.card }}>
        <Text selectable style={{ ...type.body, color: colors.text }}>{pending.prompt}</Text>
      </View> : null}
      {pending && !error ? <View style={{ flexDirection: "row", gap: space.sm }}>
        <ActivityIndicator color={colors.textMuted} />
        <Text accessibilityRole="text" style={{ ...type.callout, color: colors.textSecondary }}>Starting conversation…</Text>
      </View> : <Text style={{ ...type.callout, color: colors.textSecondary }}>
        {error ?? "This request is no longer available. Return to your sessions."}
      </Text>}
    </ScrollView>
  </View>;
}
