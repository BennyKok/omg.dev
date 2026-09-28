import { useCallback, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { Stack, useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Icon } from "../../src/components";
import { useOmg } from "../../src/omg/provider";
import { Text } from "../../src/omg/text";
import { useTheme } from "../../src/omg/theme";
import { createThread, THREAD_STARTERS } from "../../src/omg/threads";

/**
 * AN EMPTY THREAD, opened by pulling Home down past the thread threshold.
 *
 * Nothing exists on the machine yet. The first message creates the thread
 * (threads.ts), then this screen is replaced by the thread itself. Creating
 * the thread on open would leave a blank one behind every time a pull went a
 * little too far.
 */
export default function NewThreadScreen() {
  const router = useRouter();
  const { client } = useOmg();
  const { colors, type, space, radius, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canSend = !!client && text.trim().length > 0;

  const [sending, setSending] = useState(false);
  const send = useCallback(async () => {
    const prompt = text.trim();
    if (!client || !prompt || sending) return;
    setError(null);
    setSending(true);
    try {
      const thread = await createThread(client, prompt);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/thread/${thread.id}` as Href);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [client, text, sending, router]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View
          style={{
            paddingTop: insets.top + space.sm,
            paddingHorizontal: space.md,
            flexDirection: "row",
            alignItems: "center",
            gap: space.md,
          }}
        >
          <Pressable
            testID="thread-new-back"
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            hitSlop={8}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" }}
          >
            <Icon ios="chevron.left" android="arrow_back" size={18} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ ...type.headline, color: colors.text }}>New thread</Text>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: space.lg + 4, paddingTop: space.xl, gap: space.md }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={{ fontSize: 22, lineHeight: 28, fontWeight: "700", color: colors.text }}>
            What is on your mind?
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingTop: space.sm }}>
            {THREAD_STARTERS.map((starter) => (
              <Pressable
                key={starter}
                accessibilityRole="button"
                onPress={() => {
                  void Haptics.selectionAsync();
                  setText(starter);
                }}
                style={({ pressed }) => ({
                  height: 36,
                  paddingHorizontal: 16,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: colors.borderStrong,
                  backgroundColor: pressed ? colors.cardPressed : "transparent",
                  justifyContent: "center",
                })}
              >
                <Text style={{ ...type.callout, color: colors.text }}>{starter}</Text>
              </Pressable>
            ))}
          </View>
          {error ? <Text style={{ ...type.footnote, color: colors.danger }}>{error}</Text> : null}
        </ScrollView>

        <View style={{ paddingHorizontal: space.md, paddingBottom: Math.max(insets.bottom, space.md), paddingTop: space.sm }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: space.sm,
              borderRadius: radius.xl + 6,
              borderWidth: isDark ? 1 : 0,
              borderColor: colors.borderStrong,
              backgroundColor: colors.card,
              paddingLeft: 18,
              paddingRight: 6,
              paddingVertical: 6,
            }}
          >
            <TextInput
              testID="thread-new-input"
              autoFocus
              multiline
              value={text}
              onChangeText={setText}
              placeholder="Message"
              placeholderTextColor={colors.textMuted}
              style={{ flex: 1, minHeight: 36, maxHeight: 140, paddingVertical: 8, fontSize: 17, color: colors.text }}
            />
            <Pressable
              testID="thread-new-send"
              accessibilityRole="button"
              accessibilityLabel="Send"
              disabled={!canSend}
              onPress={() => void send()}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: canSend ? colors.text : colors.secondary,
              }}
            >
              <Icon ios="arrow.up" android="arrow_upward" size={16} weight="semibold" color={canSend ? colors.background : colors.textMuted} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
