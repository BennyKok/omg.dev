import { useEffect, useMemo, useRef } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { chatHeaderHeight } from "../../../src/omg/chat-header";
import { ThreadAvatar } from "../../../src/omg/thread-details";
import { ThreadChatBar, TypingIndicator } from "../../../src/omg/chat-bar";
import { Text } from "../../../src/omg/text";
import { useTheme } from "../../../src/omg/theme";
import { MessageRow, MessageTask, repliesHref, ThreadHeader, ThreadPage, useThreadState } from "../../../src/omg/thread-screen";
import {
  mentionsOmg,
  replySummary,
  startsMessageGroup,
  TASK_STATE_LABEL,
  taskCardFor,
  topLevelMessages,
  typingIn,
  typingLabel,
} from "../../../src/omg/thread-tasks";
import type { ThreadMessage } from "../../../src/omg/threads";

/**
 * A THREAD, LAID OUT LIKE SLACK. No agent runs behind it, so this is not the
 * session screen: no agent face, no model line, no tool rows. Every message
 * sits on the left under its author's avatar, name and time. omg speaks only
 * when someone writes `@omg`, and always in the REPLIES of that message; the
 * main list shows "N replies" with the task's state, and the replies open as
 * their own page (replies/[root].tsx).
 */

export default function ThreadScreen() {
  // `replies` comes from a push: open that message's replies on arrival.
  const { id, replies: repliesParam } = useLocalSearchParams<{ id: string; replies?: string }>();
  const router = useRouter();
  const { colors, type, space } = useTheme();
  const insets = useSafeAreaInsets();
  const state = useThreadState(id);
  const { detail, messages, cards, openAskIds } = state;

  // A push lands on the thread, then opens the replies on top of it, so back
  // from the replies is the thread, as when you open them yourself.
  const openedFromPush = useRef(false);
  useEffect(() => {
    if (!id || !repliesParam || openedFromPush.current) return;
    openedFromPush.current = true;
    router.push(repliesHref(id, repliesParam));
  }, [id, repliesParam, router]);

  const top = useMemo(() => topLevelMessages(messages), [messages]);
  const newestFirst = useMemo(() => [...top].reverse(), [top]);
  const previousById = useMemo(() => {
    const map = new Map<string, ThreadMessage | undefined>();
    top.forEach((message, index) => map.set(message.id, top[index - 1]));
    return map;
  }, [top]);
  const mainTyping = useMemo(() => state.typingFor(null), [state.typingFor]);
  const mainTypingLabel = typingLabel(typingIn(detail?.typing, null), detail?.participants);
  const people = (detail?.participants ?? [])
    .filter((row) => row.kind === "human")
    .map((row) => row.display.name?.trim() || row.display.fallback);

  const repliesLine = (message: ThreadMessage) => {
    const summary = replySummary(messages, message.id);
    if (!summary) return null;
    const started = summary.taskSessionId ? messages.find((m) => m.task?.sessionId === summary.taskSessionId && cards.has(m.id)) : null;
    const task = started && detail ? taskCardFor(started, detail, messages, openAskIds) : null;
    return (
      <Pressable
        testID="thread-replies-link"
        accessibilityRole="button"
        accessibilityLabel={`${summary.count} ${summary.count === 1 ? "reply" : "replies"}${task ? `, task ${TASK_STATE_LABEL[task.state]}` : ""}`}
        onPress={() => id && router.push(repliesHref(id, message.id))}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 6, opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ flexDirection: "row", gap: 2 }}>
          {summary.authors.slice(0, 3).map((author, index) => (
            <ThreadAvatar key={index} author={author} size={20} />
          ))}
        </View>
        <Text style={{ ...type.subhead, fontWeight: "600", color: colors.primary }}>
          {summary.count} {summary.count === 1 ? "reply" : "replies"}
        </Text>
        {task ? (
          <Text style={{ ...type.footnote, fontWeight: "600", color: task.state === "needs-you" ? colors.warning : task.state === "done" ? colors.success : task.state === "working" ? colors.primary : colors.textMuted }}>
            · {TASK_STATE_LABEL[task.state]}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  return (
    <ThreadPage state={state}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Stack.Screen options={{ headerShown: false }} />
        <KeyboardAvoidingView
          style={{ flex: 1, paddingTop: chatHeaderHeight(insets.top) }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {detail && !top.length ? (
            <Text style={{ ...type.callout, color: colors.textMuted, padding: space.lg }}>
              Say something. Write @omg when you want omg to answer or start a task.
            </Text>
          ) : null}
          <FlatList
            inverted
            style={{ flex: 1 }}
            data={newestFirst}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <MessageRow message={item} first={startsMessageGroup(previousById.get(item.id), item)}>
                <MessageTask state={state} message={item} />
                {repliesLine(item)}
              </MessageRow>
            )}
            contentContainerStyle={{ paddingHorizontal: space.lg, paddingVertical: space.md }}
            keyboardDismissMode="interactive"
            ListHeaderComponent={state.error ? <Text style={{ ...type.footnote, color: colors.danger, paddingTop: space.sm }}>{state.error}</Text> : undefined}
          />

          <View style={{ paddingBottom: Math.max(insets.bottom, space.md) }}>
            <TypingIndicator testID="thread-typing" label={mainTypingLabel} />
            <ThreadChatBar
              testID="thread-input"
              placeholder={`Message ${detail?.thread.title ?? "the thread"}`}
              onSend={async (body, files) => {
                const message = await state.post(body, null, files);
                // Asking omg at the top level opens the replies it will answer in.
                if (message && id && mentionsOmg(body)) router.push(repliesHref(id, message.id));
              }}
              onTyping={mainTyping}
              mentions={state.mentionOptions}
            />
          </View>
        </KeyboardAvoidingView>

        <ThreadHeader
          state={state}
          title={detail?.thread.title ?? "Thread"}
          subtitle={people.length ? people.join(", ") : "Just you"}
          onBack={() => router.back()}
        />
      </View>
    </ThreadPage>
  );
}
