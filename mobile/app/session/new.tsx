import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOmg } from "../../src/omg/provider";
import { getPendingSession } from "../../src/omg/pending-session";
import { Text } from "../../src/omg/text";
import { useTheme } from "../../src/omg/theme";
import { SessionScreenBody } from "./[id]";

/**
 * A conversation that is still being created on the machine.
 *
 * This is the REAL chat screen, not a waiting page in front of it. The
 * composer's Start pushes here before `POST /api/sessions/new` resolves, and
 * `SessionScreenBody` opens at once with the prompt as its first row and no
 * session id. When the id arrives it is handed over in place, exactly the way
 * app/bots/[id]/index.tsx advances a bot chat's id after its first send. There
 * is no second screen and no route replace, so nothing transitions.
 */
export default function NewSessionScreen() {
  const { request } = useLocalSearchParams<{ request: string }>();
  const { client, user, bindingId } = useOmg();
  // The old screen replaced itself with `/session/{id}`, so it never outlived
  // its request. This one stays on this route for as long as the conversation
  // is open, and `pending-session.ts` keeps only the last sixteen requests. The
  // record is therefore held once it is found: a still-open chat must not turn
  // into the "no longer available" page because a later creation evicted it.
  // The lookup still repeats while it comes back empty, because the provider
  // can render before it knows the signed-in account the scope is built from.
  const latched = useRef<ReturnType<typeof getPendingSession>>(null);
  if (!latched.current) latched.current = getPendingSession(request ?? "", `${user?.id}:${bindingId}`);
  const pending = latched.current;
  const [sessionId, setSessionId] = useState<string | null>(pending?.sessionId ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!pending) return;
    let active = true;
    pending.result.then((id) => {
      if (active) setSessionId(id);
    }).catch((failure) => {
      if (active) setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => { active = false; };
  }, [pending]);

  // A message typed before the id lands waits for it, then takes the plain
  // send path. Once the id is known this seam is removed and the screen sends
  // exactly as it does for any other session.
  const deliver = useCallback(async (text: string) => {
    if (!pending || !client) return undefined;
    const id = await pending.result;
    await client.sendMessage(id, text);
    return { sessionId: id };
  }, [pending, client]);

  if (pending && !error) {
    return <>
      <Stack.Screen options={{ headerShown: false, animation: "none" }} />
      <SessionScreenBody
        screenKey={`pending:${pending.token}`}
        sessionId={sessionId}
        initialPrompt={pending.prompt}
        initialAgent={pending.agent}
        initialModel={pending.model}
        onDeliver={sessionId ? undefined : deliver}
      />
    </>;
  }
  return <NewSessionFailure prompt={pending?.prompt} error={error} />;
}

function NewSessionFailure({ prompt, error }: { prompt?: string; error: string | null }) {
  const router = useRouter();
  const { colors, type, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  return <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
    <Stack.Screen options={{ headerShown: false, animation: "none" }} />
    <View style={{ padding: space.lg, flexDirection: "row", alignItems: "center", gap: space.lg }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()}>
        <Text style={{ ...type.body, color: colors.text }}>Back</Text>
      </Pressable>
      <Text style={{ ...type.headline, color: colors.text }}>New conversation</Text>
    </View>
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      {prompt ? <View style={{ padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.card }}>
        <Text selectable style={{ ...type.body, color: colors.text }}>{prompt}</Text>
      </View> : null}
      <Text style={{ ...type.callout, color: colors.textSecondary }}>
        {error ?? "This request is no longer available. Return to your sessions."}
      </Text>
    </ScrollView>
  </View>;
}
